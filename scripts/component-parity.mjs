#!/usr/bin/env node
/**
 * component-parity.mjs — snapshot the DOM the app BUILDS, not just the markup it ships.
 *
 * css-parity.mjs stubs page JavaScript so its snapshots are deterministic. The cost is a
 * blind spot: every component assembled at runtime — library cards, their controls, the
 * colour swatches — is invisible to it. Three changes shipped in one day needed a human
 * to look at them for exactly this reason.
 *
 * This runs the real modules. public/editor/editor-panel.js does not depend on client.js: it
 * receives the room through window.onOttRoom and nothing else, so a permissive stub room
 * is enough to reach the whole library UI with no server, no database and no auth.
 *
 * Two things the fixture must get right, both learned the hard way:
 *   - graphics.js builds a WebGLRenderer at import time, so the browser needs software
 *     GL. --disable-gpu (which css-parity uses) would also disable SwiftShader, and
 *     editor-panel.js would die before assigning its seams — every global reading
 *     `undefined` and looking like the module simply did not exist.
 *   - applyIcons() is called from client.js, which is stubbed here. Without calling it,
 *     every icon-bearing element measures wrong: the swatch trigger comes out 14x6px
 *     instead of 26x18, which reads exactly like a real tap-target bug.
 *
 * Output uses the same snapshot format as css-parity.mjs, so:
 *   node scripts/component-parity.mjs --out before.json
 *   node scripts/css-parity.mjs --diff before.json after.json
 *
 * Needs a browser; not part of `npm run check`. Run as `npm run test:components`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch, newPage, serveDir, snapshotExpression } from './lib/headless.mjs';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const SHARED = resolve(import.meta.dirname, '..', 'shared');

// A permissive stub: editor-panel only needs the handover to wire its UI. Nothing here
// reaches the network — every method is a no-op and every state read is undefined.
const STUB_ROOM = `(() => {
  const messages = new Map();
  return new Proxy({}, {
    get: (t, k) => k === 'sessionId' ? 'component-parity'
      : k === 'state' ? new Proxy({}, { get: () => undefined })
      : k === 'onMessage' ? (type, fn) => messages.set(type, fn)
      : k === 'send' ? (type, data) => {
          if (type === 'listCollections') messages.get('collectionList')?.({ request:data.request, collections:[], next:null });
        }
      : () => undefined,
  });
})()`;

// Becoming an admin with custom assets. Two things kept this whole surface unrendered until now:
// table.html ships `<body class="ui-full not-admin">` and it is client.js — stubbed here — that
// clears the class, so every .admin-only element was invisible in every scene; and the stub room
// serves no custom assets, so the Edit button and the "..." overflow (which only exist on a
// custom asset an admin owns) never rendered at all. That is the exact blind spot that let a
// dead "..." button ship.
const CUSTOM_ASSETS = {
  deck: [{ id: 'd1', name: 'Standard 54 - Pixel Red', isPublic: false, count: 54 }],
  board: [{ id: 'b1', name: 'Hex Field', isPublic: true }],
  prop: [{ id: 'p1', name: 'Dragon Mini', isPublic: false }],
  sky: [{ id: 'k1', name: 'Dusk Panorama', isPublic: true }],
  scene: [{ id: 'n1', name: 'Act II Setup', isPublic: false }],
};
const BE_ADMIN = `
  window.OTT_IS_ADMIN = true;
  document.body.classList.remove('not-admin', 'not-gm');`;
const WITH_ASSETS = `
  for (const [kind, list] of Object.entries(${JSON.stringify(CUSTOM_ASSETS)}))
    window.onLibraryList(kind, list);`;

// A gallery of the extracted row builders, rendered from fixtures. This is the point of
// pulling them out of client.js: every state a row can be in — pending member, GM seen by
// an owner, your own message, a message with no timestamp — is one object here, where
// producing the same set from a live room would mean six accounts and a real game.
const ROWS_FIXTURE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
<body><div id="gallery">
  <div class="pane" data-pane="chat"><div id="chatLog"></div></div>
  <ul id="memberList"></ul>
  <table><tbody id="scoreRows"></tbody></table>
  <div id="unclaimedHands"></div>
  <div id="toast"></div>
</div>
<script type="module">
import { chatRow, memberRow, emptyRow, scoreRow, scoreEmptyRow, unclaimedHead, unclaimedRow, toastContent } from '/ui/rows.js';
import { applyIcons } from '/ui/icons.js';
const log = document.getElementById('chatLog');
const ts = Date.UTC(2026, 0, 2, 15, 4);   // fixed: toLocaleTimeString must not drift
for (const [m, opt] of [
  [{ from: 'Ada', text: 'Your turn.', ts }, {}],
  [{ from: 'Ada', text: 'Your turn.', ts }, { mine: true }],
  [{ from: 'Grace', text: 'No timestamp on this one' }, {}],
  [{ from: 'Ada', text: 'A much longer message that has to wrap inside the log column.', ts }, {}],
  [{ from: '', text: '' }, {}],
]) log.appendChild(chatRow(m, opt));
const ul = document.getElementById('memberList');
const MEMBERS = [
  { username: 'pending-player', role: 'player', status: 'pending' },
  { username: 'a-player', role: 'player', status: 'admitted' },
  { username: 'a-helper', role: 'helper', status: 'admitted' },
  { username: 'a-gm', role: 'gm', status: 'admitted' },
  { username: 'the-owner', role: 'owner', status: 'admitted' },
];
for (const m of MEMBERS) ul.appendChild(memberRow(m, { myRank: 0, isSelf: false }));
for (const m of MEMBERS) ul.appendChild(memberRow(m, { myRank: 3, isSelf: false }));
ul.appendChild(memberRow(MEMBERS[1], { myRank: 3, isSelf: true }));
ul.appendChild(emptyRow());
const tb = document.getElementById('scoreRows');
for (const canEdit of [false, true])
  for (const r of [{ label: 'Ada', score: 12 }, { label: '', score: 0 }, { label: 'A very long team name', score: -3 }])
    tb.appendChild(scoreRow(r, 'id', { canEdit }));
tb.appendChild(scoreEmptyRow());
const uh = document.getElementById('unclaimedHands');
uh.appendChild(unclaimedHead());
const present = [['s1', 'Ada'], ['s2', 'Grace']];
uh.appendChild(unclaimedRow(7, 'Ada', { present }));
uh.appendChild(unclaimedRow(8, '', { present }));
uh.appendChild(unclaimedRow(9, 'Solo', { present: [] }));
document.getElementById('toast').append(
  ...toastContent('Hand dropped', 'trash', { label: 'Undo', fn: () => {} }, () => {}),
);
applyIcons(document);
window.__rowsReady = true;
</script></body>`;

// A compact specimen page makes visual states deterministic. Product scenes usually contain
// whichever states happen to occur after setup, which left hover-adjacent variants such as
// pressed, busy and disabled effectively untested even after they became shared primitives.
const COMPONENT_STATES_FIXTURE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
<body><main id="componentStates" class="panel">
  <div class="field-group"><span class="field-label">Buttons</span>
    <div class="button-row">
      <button class="button" id="stateButton">Default</button>
      <button class="button button--primary" id="statePrimary">Primary</button>
      <button class="button button--danger" id="stateDanger">Danger</button>
      <button class="button button--icon" id="stateIcon" aria-label="Icon button">⋯</button>
      <button class="button" id="statePressed" aria-pressed="true">Pressed</button>
      <button class="button" id="stateBusy" aria-busy="true">Busy</button>
      <button class="button" id="stateDisabled" disabled>Disabled</button>
    </div>
  </div>
  <div class="field-group"><label class="field-label" for="stateText">Controls</label>
    <input class="control" id="stateText" type="text" value="Text field">
    <input class="control control--compact" id="stateCompact" type="number" value="12">
    <select class="control control--select" id="stateSelect"><option>Dropdown</option></select>
    <select class="control control--select control--multiselect" id="stateMulti" multiple size="3">
      <option selected>Selected</option><option>Second</option><option>Third</option>
    </select>
    <input class="control" id="stateControlDisabled" type="text" value="Disabled" disabled>
  </div>
  <div class="button-row">
    <label class="checkbox"><input class="checkbox__input" id="stateCheckbox" type="checkbox">Unchecked</label>
    <label class="checkbox"><input class="checkbox__input" id="stateChecked" type="checkbox" checked>Checked</label>
    <label class="checkbox"><input class="checkbox__input" id="stateCheckboxDisabled" type="checkbox" disabled>Disabled</label>
  </div>
  <p class="help-text">Shared supporting text</p>
  <p class="status-text" role="status">Shared live status</p>
</main></body>`;

// Exercise the extracted surface mechanics without booting the table engine. The specimen
// keeps table-specific actions out of the utility while testing both precise and touch layouts.
const UI_SURFACES_FIXTURE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
<body>
  <button id="opener">Open dialog</button>
  <section id="testDialog" class="panel" hidden>
    <h3>Test dialog</h3><input id="dialogInput"><button class="close-x">Close</button>
  </section>
  <button id="clusterButton">Open cluster</button>
  <section id="testCluster" class="region" hidden>
    <button class="regionClose">Close</button>
    <div class="pane" data-pane="sample"><input id="clusterInput"></div>
  </section>
  <button id="drawerButton" aria-expanded="false">Menu</button>
  <section id="testDrawer" class="sheet" hidden></section>
  <button id="repeatButton">Hold</button>
  <div id="testRadial" hidden></div>
  <script type="module">
    import { createUiSurfaces } from '/ui/ui-surfaces.js';
    const ui = createUiSurfaces();
    const byId = (id) => document.getElementById(id);
    const dialog = byId('testDialog');
    ui.wireDialog(dialog, { modal: true });
    byId('opener').onclick = () => { dialog.hidden = false; };
    dialog.querySelector('.close-x').onclick = () => { dialog.hidden = true; };
    ui.wireCluster(byId('testCluster'), [{ btn: byId('clusterButton'), pane: 'sample' }]);
    const closeDrawer = ui.wireDrawer(byId('testDrawer'), byId('drawerButton'), () => {
      byId('testDrawer').replaceChildren();
      byId('testDrawer')._sheetReady = false;
      const row = document.createElement('button');
      row.className = 'drawerRow';
      row.textContent = 'Action';
      row.onclick = () => { closeDrawer(); window.drawerActions++; };
      byId('testDrawer').append(row);
    });
    const radial = ui.createRadialMenu(byId('testRadial'), {
      icons: { Action: 'dice-5' },
      onClose: () => { window.radialCloses++; },
    });
    window.drawerActions = 0;
    window.radialActions = 0;
    window.radialCloses = 0;
    window.repeatActions = 0;
    ui.holdRepeat(byId('repeatButton'), () => { window.repeatActions++; }, 30);
    window.surfaceFixture = { ui, radial };
  </script>
</body>`;

// Each scene: drive the real UI, then snapshot a subtree.
const SCENES = [
  {
    name: 'library-png-fallback',
    root: '#libraryModal',
    expect: {
      selector: '#nlb_dice .libPreview img[src], #nlb_decks .libPreview img[src]',
      min: 14,
    },
    drive: `
      ${BE_ADMIN}
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      // Safari can decode WebP but canvas.toDataURL('image/webp') returns PNG.
      const encode = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, ...args) {
        return encode.call(this, type === 'image/webp' ? 'image/png' : type, ...args);
      };
      try {
        window.onOttRoom(${STUB_ROOM});
        document.getElementById('lib2Btn').click();
        const modal = document.getElementById('libraryModal');
        for (const [kind, count] of [['dice', 8], ['decks', 4], ['boards', 2], ['objects', 3]]) {
          const list = document.getElementById('nlb_'+kind);
          modal.querySelector('[data-tab="'+list.closest('.libPane').dataset.pane+'"]').click();
          const boxes = [...list.querySelectorAll('.libPreview')].slice(0, count);
          assert(boxes.length === count, kind+' fixture is incomplete');
          for (const box of boxes) {
            box.scrollIntoView({block:'center'});
            for (let i=0; i<100; i++) {
              const imgs = [...box.querySelectorAll('img')];
              if (imgs.length && imgs.every(im=>im.complete && im.naturalWidth>0)) break;
              await new Promise(r=>setTimeout(r,50));
            }
            const imgs = [...box.querySelectorAll('img')];
            assert(imgs.length && imgs.every(im=>im.complete && im.naturalWidth>0), kind+' PNG preview did not decode');
            for (const im of imgs) {
              assert(im.src.startsWith('data:image/png;'), kind+' did not exercise PNG fallback');
              assert(im.naturalWidth<=320 && im.naturalHeight<=320, kind+' exceeded thumbnail bounds');
            }
          }
        }
      } finally {
        HTMLCanvasElement.prototype.toDataURL = encode;
      }
      (await import('/ui/icons.js')).applyIcons();`,
  },
  {
    name: 'library-image-thumbnails',
    root: '#libraryModal',
    expect: {
      selector: '#nlc_sky .libCard, #nlc_dice .libCard, #nlc_board .libCard, #nlc_mat .libCard',
      min: 5,
    },
    drive: `
      ${BE_ADMIN}
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const waitFor = async check => {
        for (let i=0; i<60; i++) { if (check()) return; await new Promise(r=>setTimeout(r,50)); }
        throw Error('Thumbnail did not load');
      };
      const ref = kind => '/assets/'+kind+'/0123456789abcdefab.png';
      window.onOttRoom(${STUB_ROOM});
      window.onLibraryList('sky', [
        {id:'s1',name:'Panorama',isPublic:true,url:ref('sky')},
        {id:'s2',name:'Cubemap',isPublic:true,url:JSON.stringify({t:'cube',f:Array(6).fill(ref('sky'))})},
      ]);
      for (const kind of ['dice','board','mat']) window.onLibraryList(kind,[{id:kind,name:kind,isPublic:true,url:ref('dice'),preview:ref(kind+'s')}]);
      document.getElementById('lib2Btn').click();
      const modal = document.getElementById('libraryModal');
      for (const kind of ['sky','dice','board','mat']) {
        const list = document.getElementById('nlc_'+kind);
        modal.querySelector('[data-tab="'+list.closest('.libPane').dataset.pane+'"]').click();
        for (const box of list.querySelectorAll('.libPreview')) {
          box.scrollIntoView({block:'center'});
          await waitFor(()=>box.querySelector('img')?.hasAttribute('src'));
          assert(box.querySelector('img').src.endsWith('.png.webp?quality=thumbnail'), kind+' loaded a raw original');
        }
      }
      const {createDicePreferences} = await import('/table/dice-preferences.js');
      let applied;
      const preferences = createDicePreferences({byId:()=>null,onTextures:()=>{}});
      preferences.setTextures([{id:'d',name:'Finish',url:ref('dice')}]);
      const row = document.createElement('div');
      preferences.buildTextureChips(row, value=>{applied=value;});
      assert(row.firstChild.style.backgroundImage.includes('.png.webp?quality=thumbnail'), 'Finish chip uses original');
      row.firstChild.click();
      assert(applied===ref('dice'), 'Finish action used thumbnail instead of original');
      const graphics = await import('/rendering/graphics.js');
      const canvas = document.createElement('canvas'); canvas.width=1200; canvas.height=600;
      const file = new File([await new Promise(r=>canvas.toBlob(r,'image/png'))], 'large.png', {type:'image/png'});
      const data = await graphics.imageFilePreviewURL(file);
      assert(data.startsWith('data:image/webp;'), 'Local file preview is not WebP');
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      assert(bitmap.width===320 && bitmap.height===160, 'Local file preview lost bounds or aspect'); bitmap.close();
      const input=document.getElementById('adDiceImg'), transfer=new DataTransfer(); transfer.items.add(file);
      input.files=transfer.files; input.dispatchEvent(new Event('change'));
      await waitFor(()=>input.parentElement.style.backgroundImage.includes('data:image/webp;'));
      input.dispatchEvent(new Event('change')); input.value=''; input.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,100));
      assert(input.parentElement.style.backgroundImage==='none', 'Cleared file preview reappeared after decode');
      assert(graphics.cardPreviewURL('text:Test').startsWith('data:image/webp;'), 'Procedural preview is not WebP');
      (await import('/ui/icons.js')).applyIcons();`,
  },
  {
    name: 'asset-packages',
    root: '#libraryModal',
    expect: { selector: '#assetPackagePanel', min: 1 },
    drive: `
      ${BE_ADMIN}
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      document.getElementById('tableLoading').remove();
      window.OTT_USER_ID = 'package-admin';
      const sent = [], requests = [], savedBoards = [];
      const room = ${STUB_ROOM};
      const send = room.send, messages = new Map();
      const groups = [{id:'10',name:'Package group',isPublic:false,revision:1,items:[{kind:'dice',id:'1'},{kind:'deck',id:'2'}]}];
      window.onOttRoom({
        onMessage: (type, fn) => { messages.set(type, fn); room.onMessage(type, fn); },
        send: (type, data) => {
          sent.push(type);
          if(type==='saveBoard') savedBoards.push(data);
          if (type === 'listCollections') messages.get('collectionList')?.({request:data.request,collections:window.OTT_IS_ADMIN ? groups : [],next:null});
          else send(type, data);
        }
      });
      document.getElementById('lib2Btn').click();
      (await import('/ui/icons.js')).applyIcons();
      const host = document.getElementById('assetPackagePanel'); host.open = true;
      assert(!host.hidden, 'Admin package controls hidden');
      const fetchOriginal = window.fetch;
      let fail = false, resolvePreview = null, packageKind = 'dice';
      window.fetch = async (url, options) => {
        if (!String(url).startsWith('/asset-packages/')) return fetchOriginal(url, options);
        requests.push([url, options]);
        if (url.endsWith('/preview')) {
          if (fail==='proxy') return {ok:false,status:413,json:async()=>{throw new SyntaxError('HTML response');}};
          if (resolvePreview) await new Promise(resolve => resolvePreview = resolve);
          return {ok:true, json:async()=>['board','mat','sky','prop'].includes(packageKind) ? {kind:packageKind,name:'Portable surface',model:packageKind==='board',collider:'compound',type:'cube',totalBytes:123,files:[{mediaType:'model/gltf-binary'}]} : packageKind==='collection' ? {kind:'collection',name:'Portable collection',count:64,members:Array.from({length:64},(_,i)=>({kind:i%2?'deck':'dice',name:i===0?'<b>Authored name</b>':'Collection asset '+(i+1),count:4,open:!!(i%2)})),totalBytes:123,files:[{width:32,height:32}]} : packageKind==='deck' ? {kind:'deck',name:'Portable tiles',count:4,open:true,deckModel:'bag',totalBytes:0,files:[]} : {kind:'dice',name:'Portable finish',totalBytes:123,files:[{width:32,height:32}]}};
        }
        if (url.includes('/import')) return {ok:!fail,json:async()=>fail?{error:'Import unavailable'}:{kind:packageKind,name:options.body instanceof File ? new URL(url,location.href).searchParams.get('name') : JSON.parse(options.body).name}};
        return {ok:true,blob:async()=>new Blob(['PK fixture'],{type:'application/zip'})};
      };
      // Exercise the real board Save -> uploadModel -> measureBoard -> room message path.
      const ordinaryFetch=window.fetch, modelRequests=[];
      const positions=new Float32Array([0,0,0, 1,0,0, 0,0.1,1]);
      const json=JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,0.1,1]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0});
      const text=new TextEncoder().encode(json+' '.repeat((4-json.length%4)%4));
      const model=new Uint8Array(28+text.length+36), view=new DataView(model.buffer);
      [0x46546c67,2,model.length,text.length,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true));
      model.set(text,20);view.setUint32(20+text.length,36,true);view.setUint32(24+text.length,0x004e4942,true);model.set(new Uint8Array(positions.buffer),28+text.length);
      window.fetch=async(url,options)=>{
        const ref=typeof url==='string'?url:url.url;
        if(ref.includes('/upload-model?')) { modelRequests.push([ref,options]); return {ok:true,json:async()=>({url:'/assets/boards/package-fixture.glb'})}; }
        if(ref.endsWith('/assets/boards/package-fixture.glb')) return new Response(model,{headers:{'Content-Type':'model/gltf-binary'}});
        return ordinaryFetch(url,options);
      };
      const picked=new DataTransfer();picked.items.add(new File([model],'board.glb',{type:'model/gltf-binary'}));
      document.getElementById('adBoardGlb').files=picked.files;
      document.getElementById('adBoardGlbName').value='Uploaded board';
      document.getElementById('adBoardGlbSize').value='8';
      const originalAlert=window.alert;window.alert=message=>{throw Error(message);};
      await document.getElementById('adBoardGlbSave').onclick();
      window.alert=originalAlert;
      assert(modelRequests.length===1 && modelRequests[0][0]==='/upload-model?kind=boards' && modelRequests[0][1].body instanceof File, 'Board Save uploads to the wrong category');
      assert(savedBoards.length===1 && savedBoards[0].board.model==='/assets/boards/package-fixture.glb','Uploaded board did not retain its board URL');
      const {uploadModel}=await import('/rendering/graphics.js');
      await uploadModel(new File([model],'object.glb'));
      assert(modelRequests.at(-1)[0]==='/upload-model?kind=props','Object upload default changed');
      window.fetch=ordinaryFetch;
      const file = document.getElementById('packageFile'), name = document.getElementById('packageName');
      const save = document.getElementById('packageImport'), cancel = document.getElementById('packageCancel');
      async function choose(text = 'PK fixture', legacy = false) {
        const transfer = new DataTransfer(); transfer.items.add(new File([text], legacy ? 'dice.ott.json' : 'assets.ott.zip', {type:legacy ? 'application/json' : 'application/zip'}));
        file.files = transfer.files; await file.onchange();
      }
      await choose();
      assert(!document.getElementById('packagePreview').hidden, 'Package preview missing');
      assert(file.files.length === 1, 'Preview lost the selected filename');
      assert(document.getElementById('packageContents').textContent.includes('32 × 32'), 'Dependency summary missing');
      assert(!requests.some(([url])=>url.includes('/import')), 'Preview mutated the library');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      save.scrollIntoView({block:'nearest'});
      const box=save.getBoundingClientRect();
      assert(box.top>=0 && box.bottom<=innerHeight && box.right<=innerWidth, 'Import action outside viewport');
      assert(save.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)), 'Import action is covered');
      name.value='Private copy'; fail=true; await save.onclick();
      assert(!save.disabled && !cancel.disabled && document.getElementById('packageStatus').textContent==='Import unavailable', 'Failure did not restore retry controls');
      fail=false; await save.onclick();
      assert(sent.includes('listDice') && document.getElementById('packagePreview').hidden, 'Import did not refresh and clear draft');
      assert(new URL(requests.filter(([url])=>url.includes('/import')).at(-1)[0],location.href).searchParams.get('name')==='Private copy', 'Edited name lost');
      fail='proxy'; await choose();
      assert(document.getElementById('packageStatus').textContent.includes('reverse-proxy upload limit'), 'Proxy HTML error was mistaken for invalid package JSON');
      fail=false;
      await choose('{', true); assert(document.getElementById('packageStatus').textContent.includes('not valid JSON'), 'Malformed file was not explained');
      resolvePreview = true;
      const pending=choose();
      while(typeof resolvePreview !== 'function') await new Promise(resolve=>setTimeout(resolve,0));
      window.OTT_IS_ADMIN=false; window.onLibraryAdmin(); resolvePreview(); await pending;
      assert(host.hidden && document.getElementById('packagePreview').hidden && !name.value, 'Late preview survived demotion');
      window.OTT_IS_ADMIN=true; window.onLibraryAdmin(); resolvePreview=null;
      window.onLibraryList('dice',[{id:'1',name:'Export fixture',isPublic:false,url:'/missing-fixture.png'}]);
      const originalClick = HTMLAnchorElement.prototype.click;
      let downloaded=false;
      HTMLAnchorElement.prototype.click=function(){downloaded=this.download==='dice-texture.ott.zip';};
      // Open the real library overflow (desktop popup or touch sheet).
      document.querySelector('#nlc_dice .pop-trigger').click();
      const exportButton=[...document.querySelectorAll('.sheet-backdrop button, .overflowMenu:not([hidden]) button')].find(b=>b.textContent.trim()==='Export');
      assert(exportButton,'Dice export action missing'); exportButton.click();
      await new Promise(resolve=>setTimeout(resolve,20));
      assert(downloaded && requests.some(([url])=>url.endsWith('/dice/1')), 'Export action is not wired to package download');
      packageKind='deck';
      await choose();
      assert(document.getElementById('packageContents').textContent.includes('Tile set · 4 cards / tiles · Pouch skin'), 'Tile shape/count/skin missing from preview');
      assert(document.getElementById('packageContents').textContent.includes('0 files included'), 'Generated deck incorrectly requires an image');
      const deckRefreshes=sent.filter(type=>type==='listDecks').length;
      await save.onclick();
      assert(sent.filter(type=>type==='listDecks').length===deckRefreshes+1, 'Deck import did not refresh deck list');
      window.onLibraryList('deck',[{id:'2',name:'Tile export',back:'back',first:'text:Tile',count:4,isPublic:false}]);
      document.querySelector('#libraryModal [data-tab="decks"]').click();
      document.querySelector('#nlc_deck .pop-trigger').click();
      HTMLAnchorElement.prototype.click=function(){downloaded=this.download==='deck.ott.zip';};
      downloaded=false;
      [...document.querySelectorAll('.sheet-backdrop button, .overflowMenu:not([hidden]) button')].find(b=>b.textContent.trim()==='Export').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      assert(downloaded && requests.some(([url])=>url.endsWith('/deck/2')), 'Deck export action not wired');
      for (const [kind, tab, refresh, expected] of [['board','boards','listBoards','Model board · compound collider'],['mat','mats','listMats','Player mat'],['sky','sky','listSkyboxes','6-face cubemap'],['prop','objects','listProps','3D model · compound collider']]) {
        packageKind=kind;
        await choose();
        assert(document.getElementById('packageContents').textContent.includes(expected), kind+' preview missing');
        const before=sent.filter(type=>type===refresh).length;
        await save.onclick();
        assert(sent.filter(type=>type===refresh).length===before+1, kind+' list did not refresh');
        assert(document.getElementById('packageStatus').textContent.includes('private'), kind+' success missing');
        window.onLibraryList(kind,[{id:'3',name:'Surface export',w:4,d:3,tex:'/missing-fixture.png',url:'/missing-fixture.png',geom:{w:2,h:1},isPublic:false}]);
        document.querySelector('#libraryModal [data-tab="'+tab+'"]').click();
        document.querySelector('#nlc_'+kind+' .overflowTrigger').click();
        HTMLAnchorElement.prototype.click=function(){downloaded=this.download===kind+'.ott.zip';};
        downloaded=false;
        const action=[...document.querySelectorAll('.sheet-backdrop button, .overflowMenu:not([hidden]) button')].find(b=>b.textContent.trim()==='Export');
        assert(action, kind+' export action missing'); action.click();
        await new Promise(resolve=>setTimeout(resolve,20));
        assert(downloaded && requests.some(([url])=>url.endsWith('/'+kind+'/3')), kind+' export action not wired');
      }
      packageKind='collection';
      HTMLAnchorElement.prototype.click=function(){downloaded=this.download==='collection.ott.zip';};
      downloaded=false;
      document.getElementById('collectionPanel').closest('details').open=true;
      const collectionExport=document.querySelector('[aria-label="Export saved collection Package group"]');
      assert(collectionExport, 'Collection export action missing');
      collectionExport.scrollIntoView({block:'nearest'});
      const exportBox=collectionExport.getBoundingClientRect();
      assert(exportBox.left>=0 && exportBox.right<=innerWidth && exportBox.top>=0 && exportBox.bottom<=innerHeight && collectionExport.contains(document.elementFromPoint(exportBox.left+exportBox.width/2,exportBox.top+exportBox.height/2)), 'Collection Export action is clipped or covered');
      collectionExport.click();
      await new Promise(resolve=>setTimeout(resolve,20));
      assert(downloaded && requests.some(([url])=>url.endsWith('/collection/10')), 'Collection export action not wired');
      HTMLAnchorElement.prototype.click=originalClick;
      await choose();
      const members=document.getElementById('packageMembers');
      assert(members.children.length===64 && !members.hidden && !members.querySelector('b'), 'Collection members missing or name parsed as markup');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      save.scrollIntoView({block:'nearest'});
      const collectionBox=save.getBoundingClientRect();
      assert(collectionBox.top>=0 && collectionBox.bottom<=innerHeight && save.contains(document.elementFromPoint(collectionBox.left+collectionBox.width/2,collectionBox.top+collectionBox.height/2)), 'Large collection hides Import action');
      const refreshes=Object.fromEntries(['listDice','listDecks','listBoards','listMats','listSkyboxes','listProps','listCollections'].map(type=>[type,sent.filter(value=>value===type).length]));
      name.value='Imported collection'; await save.onclick();
      assert(Object.entries(refreshes).every(([type,n])=>sent.filter(value=>value===type).length===n+1), 'Collection import did not refresh all relevant lists');
      assert(document.getElementById('packageStatus').textContent.includes('private collection') && members.hidden && !members.children.length, 'Collection success/reset incomplete');
      assert(new URL(requests.filter(([url])=>url.includes('/import')).at(-1)[0],location.href).searchParams.get('name')==='Imported collection', 'Collection rename lost');
      const binary=requests.filter(([url])=>url.includes('/import')).at(-1)[1];
      assert(binary.body instanceof File && binary.headers['Content-Type']==='application/zip', 'ZIP was converted to a JSON/base64 body');
      await choose('{}', true); name.value='Legacy collection'; await save.onclick();
      assert(JSON.parse(requests.filter(([url])=>url.includes('/import')).at(-1)[1].body).name==='Legacy collection', 'Legacy JSON import failed');
      await choose(); cancel.click();
      assert(members.hidden && !members.children.length, 'Cancel retained collection members');
      await choose();
      window.fetch=fetchOriginal;
    `,
  },
  {
    name: 'library-large-decks',
    root: '#libraryModal',
    expect: { selector: '#nlc_deck .libCard', min: 40 },
    drive: `
      ${BE_ADMIN}
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const waitFor = async (check, message) => {
        for (let i = 0; i < 60; i++) {
          if (check()) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw Error(message);
      };
      document.getElementById('tableLoading').remove();
      window.onOttRoom(${STUB_ROOM});
      const decks = Array.from({length:40}, (_, i) => ({
        id:String(i+1), name:'Deck '+i, count:54, isPublic:true,
        back:'text:Back '+i, first:'text:Front '+i,
      }));
      window.onLibraryList('deck', decks);
      document.getElementById('lib2Btn').click();
      const modal = document.getElementById('libraryModal');
      modal.querySelector('[data-tab="decks"]').click();
      const list = document.getElementById('nlc_deck');
      const cards = [...list.querySelectorAll('.libCard')];
      const last = cards.at(-1).querySelector('.libPreview');
      assert(!last.querySelector('img').hasAttribute('src'), 'Offscreen deck generated a preview eagerly');
      cards[0].scrollIntoView({block:'center'});
      await waitFor(() => [...cards[0].querySelectorAll('img')].every(im => im.hasAttribute('src')), 'Visible deck did not load both faces');
      assert(!last.querySelector('img').hasAttribute('src'), 'Loading first deck also loaded distant decks');
      window.onLibraryList('deck', structuredClone(decks));
      assert(list.querySelector('.libCard') === cards[0], 'Identical response rebuilt cards');
      modal.querySelector('.libSearch').value = 'Deck 39';
      modal.querySelector('.libSearch').dispatchEvent(new Event('input'));
      last.scrollIntoView({block:'center'});
      await waitFor(() => [...last.querySelectorAll('img')].every(im => im.hasAttribute('src')), 'Search-revealed deck did not load');
      assert([...last.querySelectorAll('img')].every(im => im.decoding === 'async'), 'Thumbnails block synchronous image decoding');
      const {cardPreviewURL} = await import('/rendering/graphics.js');
      assert(cardPreviewURL('/assets/decks/0123456789abcdefab.png', {thumbnail:true}).endsWith('?quality=thumbnail'), 'Library thumbnail option did not reach the image endpoint');
      assert(!cardPreviewURL('/assets/decks/0123456789abcdefab.png', {thumbnail:false}).includes('?'), 'Explicit standard preview resolution changed');
      window.onLibraryList('deck', decks.map((deck, i) => i ? deck : {...deck, name:'Renamed deck'}));
      assert(!cards[0].isConnected && last._loadThumb === null, 'Replaced list retained pending preview work');
      assert(list.querySelector('.libName').textContent.includes('Renamed deck'), 'Changed metadata did not rerender');
      modal.querySelector('.libSearchClear').click();
      document.getElementById('lib2Close').click();
      const retained = list.querySelector('.libCard');
      document.getElementById('lib2Btn').click();
      assert(list.querySelector('.libCard') === retained, 'Reopening rebuilt an unchanged deck list');
      (await import('/ui/icons.js')).applyIcons();`,
  },
  {
    name: 'asset-collections',
    root: '#libraryModal',
    expect: { selector: '.collectionChoice', min: 4 },
    drive: `
      ${BE_ADMIN}
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      window.OTT_USER_ID = 'collection-fixture';
      document.getElementById('tableLoading').remove();
      localStorage.removeItem('ott.collections.collection-fixture');
      const messages = new Map(), sent = [];
      let groups = [
        {id:'1', name:'Shared game', isPublic:true, revision:1, items:[{kind:'deck',id:'1'}]},
        {id:'2', name:'Second collection', isPublic:false, revision:1, items:[{kind:'deck',id:'1'}, {kind:'dice',id:'1'}]},
      ];
      const room = {onMessage:(type, fn)=>messages.set(type,fn), send:(type, value)=>{
        sent.push([type,value]);
        if(type==='listCollections') messages.get('collectionList')({request:value.request,collections:groups,next:null});
      }};
      window.onOttRoom(room);
      document.getElementById('lib2Btn').click();
      window.onLibraryList('deck',[{id:'1',name:'Collected deck',isPublic:true,count:3}]);
      window.onLibraryList('dice',[{id:'1',name:'Dice finish',isPublic:true,url:'/missing-fixture.png'}]);
      window.onLibraryList('prop',[{id:'2',name:'Uncollected prop',isPublic:true}, ...Array.from({length:60},(_,i)=>({id:String(i+3),name:'Extra asset '+i,isPublic:true}))]);
      const panel=document.getElementById('collectionPanel');
      panel.parentElement.open=true;
      const libraryBody=document.querySelector('#libraryModal .libraryBody');
      const reachable = (element, message) => {
        const rect=element.getBoundingClientRect();
        const target=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
        assert(rect.top>=0 && rect.bottom<=innerHeight && target && element.contains(target), message);
      };
      const checkExpandedFilters = () => {
        assert(panel.parentElement.scrollHeight <= panel.parentElement.clientHeight + 1,
          'Collections was squeezed into a separate clipped scroll strip');
        for(const label of panel.querySelectorAll('.collectionFilters label')) {
          label.scrollIntoView({block:'nearest'});
          reachable(label.querySelector('input'), 'Expanded collection filter is clipped by the asset list');
        }
        const newButton=panel.querySelector('[aria-label="New collection"]');
        newButton.scrollIntoView({block:'nearest'});
        reachable(newButton, 'Collection management action is clipped by the asset list');
        const collectionBounds=panel.parentElement.getBoundingClientRect();
        const paneBounds=document.querySelector('#libraryModal .libPane:not([hidden])').getBoundingClientRect();
        assert(collectionBounds.bottom<=paneBounds.top, 'Asset pane overlaps expanded Collections');
        libraryBody.scrollTop=0;
      };
      checkExpandedFilters();
      document.body.classList.replace('ui-full','ui-compact');
      checkExpandedFilters();
      document.body.classList.replace('ui-compact','ui-full');
      const click = text => { const b=[...panel.querySelectorAll('button')].find(b=>b.textContent===text || b.getAttribute('aria-label')===text); assert(b, 'Missing button: '+text); b.click(); };
      const filter = text => [...panel.querySelectorAll('.collectionFilters label')].find(label=>label.textContent.startsWith(text)).querySelector('input');
      assert(panel.querySelector('[aria-label="Show none"]'), 'All-visible collections did not offer Show none');
      const firstFilter = filter('Shared game');
      firstFilter.focus();
      firstFilter.click();
      assert(document.activeElement === firstFilter, 'Individual filter change lost keyboard focus');
      assert(panel.querySelector('[aria-label="Show all"]'), 'Mixed visibility did not offer Show all');
      assert(document.querySelector('#nlc_deck .libCard'), 'Union membership hid an asset in an enabled collection');
      filter('Second collection').click();
      assert(!document.querySelector('#nlc_deck .libCard'), 'Hidden member leaked through Uncollected');
      assert(document.querySelector('#nlc_prop .libCard'), 'Uncollected asset disappeared');
      assert(!document.querySelector('#nlc_dice .libCard'), 'Dice collection filter not wired');
      click('Show all');
      assert(document.querySelector('#nlc_dice .libCard'), 'Dice list missing from library');
      filter('Uncollected').click();
      click('Show none');
      assert(!filter('Uncollected').checked, 'Show none changed hidden Uncollected');
      assert(!document.querySelector('#nlc_deck .libCard') && !document.querySelector('#nlc_prop .libCard'), 'Show none did not apply filters');
      const savedHidden = JSON.parse(localStorage.getItem('ott.collections.collection-fixture'));
      assert(['1','2','uncollected'].every(id => savedHidden.includes(id)), 'Bulk hide did not persist independent preferences');
      click('Refresh collections');
      assert(panel.querySelector('[aria-label="Show all"]') && !filter('Uncollected').checked, 'Refresh lost bulk filter state');
      click('Show all');
      assert(!filter('Uncollected').checked && !document.querySelector('#nlc_prop .libCard'), 'Show all re-enabled Uncollected');
      assert(document.querySelector('#nlc_deck .libCard') && document.querySelector('#nlc_dice .libCard'), 'Show all failed to restore named members');
      assert(JSON.stringify(JSON.parse(localStorage.getItem('ott.collections.collection-fixture'))) === '["uncollected"]', 'Show all cleared the Uncollected preference');
      assert(document.activeElement === panel.querySelector('[aria-label="Show none"]'), 'Bulk toggle lost keyboard focus');
      filter('Uncollected').click();
      click('Show none');
      assert(filter('Uncollected').checked && document.querySelector('#nlc_prop .libCard'), 'Show none hid enabled Uncollected');
      click('Show all');
      assert(filter('Uncollected').checked, 'Show all changed enabled Uncollected');
      const existingGroups = groups;
      groups = [];
      click('Refresh collections');
      assert(panel.querySelector('[aria-label="Show all"]').disabled, 'Empty collection toggle is enabled');
      groups = existingGroups;
      click('Refresh collections');
      assert(panel.querySelector('[aria-label="Show none"]'), 'Refreshed collections have stale toggle label');
      click('Edit Shared game');
      const manager=panel.querySelector('.collectionManager');
      assert(!manager.hidden, 'Admin management did not open');
      const reachableSave = () => {
        const button=manager.querySelector('[aria-label="Save collection"]');
        const rect=button.getBoundingClientRect();
        assert(rect.top>=0 && rect.bottom<=innerHeight, 'Save collection is outside the viewport');
        const target=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
        assert(target && button.contains(target), 'Save collection is clipped or covered');
      };
      reachableSave();
      manager.querySelector('.collectionInventory').scrollTop=10000;
      reachableSave();
      manager.scrollIntoView({block:'end'});
      reachableSave();
      manager.querySelector('.collectionInventory').scrollTop=0;
      const name=manager.querySelector('[aria-label="Collection name"]');
      name.value='Updated shared game';
      const prop=[...manager.querySelectorAll('.collectionInventory label')].find(label=>label.textContent.includes('Uncollected prop'));
      prop.querySelector('input').click(); click('Save collection');
      const save=sent.at(-1);
      assert(save[0]==='updateCollection' && save[1].items.length===2 && save[1].revision===1, 'Membership save lost typed references/revision');
      assert(name.disabled,'Pending mutation still editable');
      messages.get('collectionError')({message:'This collection changed. Reload it before saving.'});
      assert(!name.disabled && name.value==='Updated shared game' && !manager.hidden, 'Conflict erased draft');
      messages.get('collectionsChanged')({});
      assert(name.value==='Updated shared game', 'Refresh erased unsaved draft');
      window.OTT_IS_ADMIN=false; groups=groups.filter(value=>value.isPublic); window.onLibraryAdmin();
      assert(manager.hidden && ![...panel.querySelectorAll('button')].some(b=>b.textContent==='New collection'), 'Demotion retained management UI');
      assert(!panel.textContent.includes('Second collection'), 'Demotion retained private collection');
      const bounds=panel.getBoundingClientRect(); assert(bounds.left>=0 && bounds.right<=innerWidth, 'Collection panel overflows viewport');
      localStorage.removeItem('ott.collections.collection-fixture');
      (await import('/ui/icons.js')).applyIcons();
    `,
  },
  {
    name: 'deck-browser',
    root: '#deckBrowseActions',
    expect: { selector: '#deckBrowseActions button', min: 8 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const { createDeckBrowser } = await import('/table/deck-browsing.js');
      const { createCardBrowsePreview, cardMesh } = await import('/rendering/graphics.js');
      const byId = id => document.getElementById(id), sent = [], messages = new Map(), previews = [];
      let timer, leave, closed = 0, allowed = true;
      const room = { send: (...args) => sent.push(args), onMessage: (name, fn) => messages.set(name, fn), onLeave: fn => { leave = fn; } };
      const browser = createDeckBrowser({ getRoom: () => room, byId, canInteract: () => allowed, toast() {},
        inspection: { cancel() {}, closeBrowseCard() { closed++; }, showBrowseCard(card, close) { previews.push({card, close}); } },
        repeat: fn => { timer = fn; return 1; }, stopRepeat() {} });
      browser.bindRoom(room); browser.open('1');
      assert(sent.at(-1)[0] === 'browseDeck', 'Browse did not request a private session');
      const card = { deckId: '1', token: 'lease', revision: 0, entryToken: 'entry', front: 'text:Secret', back: 'back', position: 1, count: 3 };
      messages.get('deckBrowseCard')(card);
      assert(!byId('deckBrowseActions').hidden && byId('deckBrowsePrevious').disabled, 'First card navigation is wrong');
      let escapedKey = false;
      const keyListener = () => { escapedKey = true; };
      window.addEventListener('keydown', keyListener);
      byId('deckBrowseActions').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      window.removeEventListener('keydown', keyListener);
      assert(!escapedKey && sent.at(-1)[0] === 'browseStep' && sent.at(-1)[1].direction === 1, 'Browse key escaped to table input');
      assert(byId('deckBrowseNext').disabled, 'Pending navigation allowed another request');
      messages.get('deckBrowseCard')({ ...card, revision: 1, entryToken: 'second', position: 2 });
      byId('deckBrowseActions').querySelector('[data-browse-action="hand"]').click();
      assert(sent.at(-1)[0] === 'browseAction' && sent.at(-1)[1].entryToken === 'second', 'Action lost private entry identity');
      messages.get('serverError')({ operation: 'deckBrowse' });
      assert(!byId('deckBrowseNext').disabled, 'Recoverable failure left controls locked');
      timer(); assert(sent.at(-1)[0] === 'browseKeepAlive', 'Active browser did not renew lease');
      byId('deckBrowseClose').click();
      assert(byId('deckBrowseActions').hidden && sent.at(-1)[0] === 'closeDeckBrowse' && closed > 0, 'Close retained preview or lease');
      const n = previews.length; messages.get('deckBrowseCard')(card);
      assert(previews.length === n, 'Late preview reopened a closed browser');
      allowed = false; browser.open('1'); assert(sent.at(-1)[0] !== 'browseDeck', 'Restricted player opened browsing');
      allowed = true; browser.open('1'); messages.get('deckBrowseCard')(card);
      const bounds = byId('deckBrowseActions').getBoundingClientRect();
      assert(bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Browse controls overflow viewport');
      // Private previews release newly loaded textures/materials but never resident table assets.
      const shared = cardMesh({ front: 'text:Resident', back: 'back' });
      const sharedTexture = shared.material[2].map;
      let sharedDisposed = 0, ownedDisposed = 0, materialDisposed = 0, geometryDisposed = 0;
      sharedTexture.addEventListener('dispose', () => sharedDisposed++);
      const borrowed = createCardBrowsePreview({ front: 'text:Resident', back: 'back' });
      borrowed.dispose(); assert(sharedDisposed === 0, 'Borrowed texture was disposed');
      const preview = createCardBrowsePreview({ front: 'text:Private-browse', back: 'back' });
      preview.mesh.material[2].map.addEventListener('dispose', () => ownedDisposed++);
      preview.mesh.material[2].addEventListener('dispose', () => materialDisposed++);
      preview.mesh.geometry.addEventListener('dispose', () => geometryDisposed++);
      preview.dispose(); preview.dispose();
      assert(ownedDisposed === 1 && materialDisposed === 1 && geometryDisposed === 0, 'Browse resource ownership is wrong');
      window.__closeDeckBrowserFixture = leave;
    `,
  },
  {
    name: 'lobby-watch',
    page: '/index.html',
    root: '#roomList',
    expect: { selector: '#roomList .roomRow', min: 2 },
    drive: `
      localStorage.setItem('tabletop.token', 'fixture');
      window.fetch = async (url) => ({ ok: true, json: async () => String(url).includes('/auth/token')
        ? { user: { id: '1', username: 'Viewer', email: 'viewer@example.test', isAdmin: false } }
        : { rooms: [
          { id: '1', name: 'A table with a longer descriptive name', code: 'WATCH1', role: 'player', status: 'admitted' },
          { id: '2', name: 'Another table', code: 'WATCH2', role: 'helper', status: 'admitted' },
        ] } });
      await import('/__landing-live.js');
      for (let i = 0; i < 20 && !document.querySelector('#roomList .roomRow'); i++) await new Promise(resolve => setTimeout(resolve, 20));
      const rows = [...document.querySelectorAll('#roomList .roomRow')];
      if (rows.length !== 2) throw Error('Lobby rooms did not render');
      for (const row of rows) {
        const watch = [...row.querySelectorAll('button')].find(button => button.textContent.trim() === 'Watch');
        if (!watch || watch.disabled) throw Error('Admitted player has no Watch action');
        if (!watch.querySelector('use[href="#i-eye"]')) throw Error('Watch eye icon is missing');
        if (row.scrollWidth > row.clientWidth + 1) throw Error('Watch action overflows lobby row');
      }
    `,
  },
  {
    name: 'client-bootstrap',
    root: '#controlsModal',
    expect: { selector: '#controlsModal:not([hidden])', min: 1 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const byId = (id) => document.getElementById(id);
      let join;
      const messages = new Map(), sent = [], patches = [];
      const state = {
        pieces: new Map(), players: new Map([['me', { name: 'Ada', role: 'owner', seat: 0,
          color: '#aa7755', avatar: '', hand: 0, showing: false, timedOut: false, participation: 'player' }]]),
        overlays: new Map(), trays: new Map(), scores: new Map(), unclaimed: new Map(),
        scale: { gridStyle: 'off', worldPerUnit: 1, unitLabel: 'ft', roundStep: 1, cellWorld: 1 },
        whiteboard: { enabled: false }, timer: { running: false, mode: 'up', base: 0, since: 0 },
        tableX: 40, tableZ: 28, tableShape: 'rectangle', roomName: 'Fixture table', skybox: '',
      };
      const room = { state: { ...state, pieces: undefined }, sessionId: 'me', reconnectionToken: 'fixture',
        onMessage: (key, fn) => messages.set(key, fn), onStateChange(fn) { patches.push(fn); }, onLeave() {},
        send: (...args) => sent.push(args), leave() {}, };
      const callbacks = (object) => new Proxy({ listen() {} }, {
        get: (target, key) => target[key] || {
          listen() {}, onRemove() {}, onAdd(fn) { object[key]?.forEach((value, id) => fn(value, id)); },
        },
      });
      window.Colyseus = {
        Client: class {
          joinOrCreate() { return new Promise(resolve => { join = resolve; }); }
          reconnect() { return new Promise(resolve => { join = resolve; }); }
        },
        getStateCallbacks: () => callbacks,
      };
      await import('/__client-live.js');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      byId('controlsBtn').click();
      assert(!byId('controlsModal').hidden, 'Production client did not wire the controls dialog');
      byId('controlsClose').click();
      join(room);
      await new Promise(resolve => setTimeout(resolve, 150));
      room.state.pieces = state.pieces;
      patches.forEach(fn => fn(room.state));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      assert(byId('sfxVol')?.oninput, 'Joined client did not finish binding controls');
      assert(messages.has('ping') && messages.has('pieceHighlighted') && messages.has('shuffled') && messages.has('dealt'), 'Missing effect/drag bindings');
      byId('sfxVol').value = '37'; byId('sfxVol').dispatchEvent(new Event('input'));
      const audio = await import('/table/audio.js');
      assert(Math.abs(audio.getSfxVolume() - 0.37) < 0.001, 'SFX volume did not reach audio adapter');
      const muted = audio.getSfxMuted(); byId('sfxMute').click();
      assert(audio.getSfxMuted() !== muted, 'SFX mute was not wired');
      const full = document.body.classList.contains('ui-full'); byId('uiModeToggle').click();
      assert(document.body.classList.contains('ui-full') !== full, 'UI mode did not toggle');
      byId('uiModeToggle').click();
      byId('accentCustom').value = '#123456'; byId('accentCustom').dispatchEvent(new Event('input'));
      assert(localStorage.getItem('ott-accent') === '#123456', 'Accent preference did not persist');
      byId('settingsBtn').click();
      assert(byId('creditsBody').textContent.includes('Libraries'), 'Credits did not render');
      byId('settingsClose').click();
      const roster = byId('players'), dock = byId('roomInfoBody');
      byId('seatBtn').click(); assert(byId('seatPop').contains(roster), 'Seat popover lost live roster');
      byId('roomInfoBtn').click();
      assert(byId('seatPop').hidden && byId('roomSheet').contains(dock) && dock.contains(roster), 'Room sheet did not return then borrow live nodes');
      byId('roomSheet')._close(); assert(byId('roomInfo').contains(dock), 'Room sheet failed to return dock');
      byId('dropBtn').click(); byId('dropDown').click();
      assert(sent.at(-1)[0] === 'handToTable' && sent.at(-1)[1].faceDown, 'Drop orientation lost');
      byId('toast').querySelector('button').click(); assert(sent.at(-1)[0] === 'handFromTable', 'Drop Undo lost');
      messages.get('diceList')([{ id: 'tex', name: 'Custom finish', url: '/fixture.png' }]);
      assert(byId('trayTextures').querySelectorAll('button').length === 1 && !byId('trayCustomGroup').hidden, 'Uploaded finish chips did not hydrate');
      byId('trayTextures').querySelector('button').click();
      assert(JSON.parse(localStorage.getItem('ott-dice'))['6'].finish === 'custom', 'Custom finish did not persist defaults');
      byId('drawerBtn').click();
      assert(byId('drawer').querySelector('.drawerRow'), 'Drawer proxies did not build');
      byId('drawer')._close();
      // The stub room does not finish scene loading; reveal the controls for hit testing.
      byId('tableLoading')?.remove();
      const selectButton = byId('selectBtn'), seatButton = byId('seatBtn');
      const selectBounds = selectButton.getBoundingClientRect(), seatBounds = seatButton.getBoundingClientRect();
      assert(selectBounds.width===seatBounds.width && selectBounds.height===seatBounds.height &&
        selectBounds.left===seatBounds.left && selectBounds.bottom<seatBounds.top && selectBounds.top>=0,
        'Multi-select must match Seat and sit directly above it');
      assert(document.elementFromPoint(selectBounds.x+selectBounds.width/2,selectBounds.y+selectBounds.height/2)?.closest('#selectBtn'),
        'Multi-select is not directly reachable');
      selectButton.click();
      assert(selectButton.getAttribute('aria-pressed')==='true' && selectButton.classList.contains('on') &&
        document.querySelector('canvas.selecting'), 'Floating multi-select did not activate selection');
      selectButton.click();
      assert(selectButton.getAttribute('aria-pressed')==='false' && !document.querySelector('canvas.selecting'),
        'Floating multi-select did not exit selection');
      byId('fabBtn').click(); assert(!byId('radial').hidden, 'Table action fan did not open');
      assert(!byId('radial').textContent.includes('Multi-Select'), 'Multi-select remains in the radial menu');
      byId('fabBtn').click();
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sheet = matchMedia('(max-width: 900px), (pointer: coarse)').matches;
      const cards = Array.from({length:20}, (_,i)=>({hid:String(i),front:'rank:A:♠:#000',back:'back'}));
      messages.get('hand')(cards);
      await frame();
      if (sheet) byId('handTab').click();
      await frame(); await frame();
      const chevrons = [...byId('hand').querySelectorAll('.handScrollBtn')];
      const scroll = byId('hand').querySelector('.handScroll');
      assert(chevrons.length===2 && chevrons.every(button=>!button.hidden), 'Hand scroll arrows require Rearrange before appearing');
      assert(chevrons[0].disabled && !chevrons[1].disabled, 'Initial hand scroll direction state is wrong');
      assert(!byId('hand').classList.contains('reordering'), 'Hand scrolling enabled Rearrange');
      for (const id of ['selectBtn','seatBtn','fabBtn'])
        assert((getComputedStyle(byId(id)).display==='none')===sheet, id+' visibility does not follow the hand tray');
      chevrons[1].click();
      for (let i=0; i<150 && scroll.scrollLeft===0; i++) await new Promise(resolve=>setTimeout(resolve,20));
      assert(scroll.scrollLeft>0, 'Hand scroll-right button does not move cards');
      scroll.scrollTo({left:scroll.scrollWidth,behavior:'instant'}); await frame();
      assert(!chevrons[0].disabled && chevrons[1].disabled, 'Hand scroll end state is wrong');
      if (sheet) { byId('handTab').click(); await frame(); }
      for (const id of ['selectBtn','seatBtn','fabBtn']) assert(getComputedStyle(byId(id)).display!=='none', id+' did not return after closing the hand');
      messages.get('hand')(cards.slice(0,1)); await frame();
      if (sheet) byId('handTab').click();
      await frame(); await frame();
      assert([...byId('hand').querySelectorAll('.handScrollBtn')].every(button=>button.hidden), 'A fitting hand retains scroll arrows');
      if (sheet) byId('handTab').click();
      messages.get('hand')([]); await frame();
      const me = room.state.players.get('me');
      me.timedOut = true;
      patches.forEach(fn => fn(room.state));
      assert(!byId('participationNotice').hidden && byId('dropBtn').inert, 'Time-out did not disable controls');
      const noticeBounds = byId('participationNotice').getBoundingClientRect();
      assert(noticeBounds.left >= 0 && noticeBounds.right <= innerWidth && noticeBounds.bottom <= innerHeight, 'Time-out notice escaped the viewport');
      const count = sent.length;
      room.send('drawInspect', { deckId: 'x' });
      room.send('saveMat', { spawn: true });
      assert(sent.length === count, 'Restricted client sent gameplay');
      room.send('chat', { text: 'Still here' });
      assert(sent.at(-1)[0] === 'chat', 'Time-out blocked chat');
      me.timedOut = false;
      patches.forEach(fn => fn(room.state));
      assert(byId('participationNotice').hidden && !byId('dropBtn').inert, 'Lifting time-out left controls disabled');
      assert(byId('participationBtn').querySelector('use[href="#i-eye"]'), 'Spectate eye icon is missing');
      byId('participationBtn').click();
      assert(sent.at(-1)[0] === 'setParticipation' && sent.at(-1)[1].participation === 'spectator', 'Self-service spectator toggle did not send');
      me.participation = 'spectator';
      patches.forEach(fn => fn(room.state));
      messages.get('participationSet')({ participation: 'spectator' });
      assert(byId('participationBtn').textContent === 'Return to play' && byId('dropBtn').inert, 'Spectator controls did not synchronize');
      assert(byId('participationBtn').querySelector('use[href="#i-device-gamepad"]') &&
        byId('participationBtn').getAttribute('aria-label') === 'Return to play', 'Return icon or accessible name is wrong');
      const spectatorSent = sent.length;
      room.send('drawInspect', { deckId: 'x' });
      assert(sent.length === spectatorSent, 'Spectator sent a gameplay request');
      byId('participationBtn').click();
      me.participation = 'player'; me.timedOut = true;
      patches.forEach(fn => fn(room.state));
      messages.get('participationSet')({ participation: 'player' });
      assert(byId('participationBtn').querySelector('use[href="#i-eye"]') &&
        byId('participationBtn').getAttribute('aria-label') === 'Spectate', 'Spectate icon or accessible name did not return');
      assert(byId('dropBtn').inert && !byId('participationNotice').hidden, 'Return to play bypassed time-out');
      me.timedOut = false;
      patches.forEach(fn => fn(room.state));
      byId('controlsBtn').click();
    `,
  },
  {
    name: 'piece-labels',
    root: '#pieceLabelsModal',
    expect: { selector: '#pieceLabelsModal:not([hidden]) .control', min: 3 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const THREE = await import('three');
      const { createPieceLabels } = await import('/table/piece-labels.js');
      const { createUiSurfaces } = await import('/ui/ui-surfaces.js');
      const byId = id => document.getElementById(id);
      const scene = new THREE.Scene(), sent = [];
      const piece = { type: 'deck', count: 12, props: JSON.stringify({ label: 'Adventure deck', lowStock: { reference: 52, percent: 25 } }) };
      const room = { state: { pieces: new Map([['42', piece]]) }, send: (...args) => sent.push(args) };
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      const meshes = new Map([['42', { mesh }]]);
      let rank = 3;
      let activeRoom = null;
      const labels = createPieceLabels({ THREE, scene, meshes, getRoom: () => activeRoom, getRank: () => rank });
      createUiSurfaces().wireDialog(byId('pieceLabelsModal'), { modal: true });
      for (const pending of [null, {}, { state: {} }]) {
        activeRoom = pending;
        labels.update(); labels.edit('42');
        assert(scene.children.length === 0 && byId('pieceLabelsModal').hidden, 'Incomplete state opened/rendered labels');
      }
      activeRoom = room;
      // Lose state with live resources and an open editor, then recover on the same controller.
      for (const pending of [null, {}, { state: {} }]) {
        labels.update(); labels.edit('42');
        const sprite = scene.children[0]; let released = 0;
        sprite.material.map.addEventListener('dispose', () => released++);
        sprite.material.addEventListener('dispose', () => released++);
        activeRoom = pending;
        byId('pieceLabelsForm').dispatchEvent(new Event('submit', { cancelable: true }));
        labels.update();
        assert(sent.length === 0 && byId('pieceLabelsModal').hidden, 'Missing state allowed label save');
        assert(released === 2 && scene.children.length === 0, 'Missing state retained label resources');
        activeRoom = room;
        labels.edit('42'); activeRoom = pending; labels.update();
        assert(byId('pieceLabelsModal').hidden, 'Missing state left editor open');
        activeRoom = room;
      }
      labels.update(); const original = scene.children[0];
      assert(original.isSprite && original.position.y > .5, 'Saved label not placed above object');
      mesh.position.y = 3; labels.update();
      assert(scene.children[0] === original && original.position.y > 3.5, 'Label movement recreated its texture');
      let disposed = 0;
      original.material.map.addEventListener('dispose', () => disposed++);
      original.material.addEventListener('dispose', () => disposed++);
      piece.count = 13; labels.update();
      assert(disposed === 2 && scene.children[0].scale.y < original.scale.y, 'Threshold label did not disappear or release resources');
      labels.edit('42');
      assert(!byId('pieceLabelsModal').hidden && byId('pieceStockReference').value === '52', 'Editor lost saved threshold');
      byId('pieceLabelText').value = 'Campaign deck';
      byId('pieceStockPercent').value = '40';
      byId('pieceLabelsForm').dispatchEvent(new Event('submit', { cancelable: true }));
      assert(sent.at(-1)[0] === 'setPieceLabels' && sent.at(-1)[1].lowStock.percent === 40, 'Editor did not send validated settings');
      assert(byId('pieceLabelsModal').hidden, 'Editor did not close');
      rank = 0; labels.edit('42'); assert(byId('pieceLabelsModal').hidden, 'Player opened GM editor');
      rank = 3; labels.edit('42'); rank = 0; labels.update();
      assert(byId('pieceLabelsModal').hidden, 'Demotion left editing open');
      rank = 3; labels.edit('42');
      byId('pieceLabelsModal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(byId('pieceLabelsModal').hidden, 'Escape did not close editor');
      mesh.visible = false; labels.update(); assert(scene.children.length === 0, 'Invisible object retained label');
      mesh.visible = true; piece.props = '{}'; labels.update(); assert(scene.children.length === 0, 'Cleared label remained');
      piece.type = 'prop'; labels.edit('42'); assert(byId('pieceStockFields').hidden, 'Ordinary prop offered stock settings');
      byId('pieceLabelsCancel').click();
      piece.type = 'deck'; labels.edit('42');
      byId('pieceStockEnabled').checked = true; byId('pieceStockEnabled').dispatchEvent(new Event('change'));
      await new Promise(resolve => setTimeout(resolve, 0));
      const save = byId('pieceLabelsForm').querySelector('[type=submit]').getBoundingClientRect();
      assert(save.bottom <= innerHeight && save.left >= 0 && save.right <= innerWidth, 'Label save control outside viewport');
    `,
  },
  {
    name: 'piece-ui-and-effects',
    root: '#pieceMenu',
    expect: { selector: '#pieceMenu:not([hidden]) button', min: 4 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const THREE = await import('three');
      const { createPieceUi } = await import('/table/piece-ui.js');
      const { createTableEffects } = await import('/table/effects.js');
      const byId = (id) => document.getElementById(id);
      const sent = [], messages = new Map(), sounds = [];
      const state = { players: new Map([['me', { color: '#ff0000', name: 'Ada' }]]), pieces: new Map([
        ['deck', { type: 'deck', count: 12, props: '{}' }],
        ['board', { type: 'board', props: JSON.stringify({ model: 'fixture.glb', box: [3, 0.5, 3] }) }],
      ]) };
      const room = { state, send: (...args) => sent.push(args), onMessage: (key, fn) => messages.set(key, fn) };
      const scene = new THREE.Scene();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      deck.position.set(0, 3, 0);
      const board = new THREE.Group(); board.position.y = 0.5;
      const meshes = new Map([['deck', { type: 'deck', mesh: deck }], ['board', { type: 'board', mesh: board }]]);
      let time = 0;
      const ray = { setFromCamera() {}, ray: { intersectPlane: (_plane, hit) => hit.set(2, 0, 4) } };
      const config = { ping: { inner: 0.1, outer: 0.2, dur: 1000, grow: 2, lift: 0.05 },
        highlight: { dur: 3200, pulseMs: 800, padding: 0.35, minSize: 0.8, textureSize: 64 },
        label: { w: 2, h: 1 }, marker: { inner: 0.1, outer: 0.2, opacity: 0.5, lift: 0.03 },
        anim: { shuffle: { dur: 1000, cycles: 3, yaw: 0.1, bob: 0.2 } } };
      const effects = createTableEffects({ THREE, config, scene, camera: {}, pointer: {}, ray, meshes,
        getRoom: () => room, getSessionId: () => 'me', getBoardTopY: () => 0.5,
        nameTag: () => new THREE.Texture(), playSfx: (name) => sounds.push(name), clock: () => time,
        disposeSprite: (sprite) => { scene.remove(sprite); sprite.material.map.dispose(); sprite.material.dispose(); } });
      effects.bindPings(room); effects.bindTableEffects(room);
      effects.sendPing(); assert(sent.at(-1)[0] === 'ping' && sent.at(-1)[1].x === 2, 'Ping projection did not send');
      messages.get('ping')({ sid: 'me', x: 2, z: 4 });
      const ring = scene.children.find(mesh => mesh.renderOrder === 5);
      let disposed = 0; ring.geometry.addEventListener('dispose', () => disposed++);
      ring.material.addEventListener('dispose', () => disposed++);
      time = 500; effects.updatePings(); assert(ring.scale.x === 2 && ring.material.opacity === 0.375, 'Ping timing drifted');
      time = 1001; effects.updatePings(); assert(disposed === 2 && !scene.children.includes(ring), 'Expired ping leaked');
      messages.get('shuffled')({ id: 'deck' }); time = 1501; effects.applyAnim('deck', deck);
      assert(sounds.at(-1) === 'shuffle' && deck.position.y > 3, 'Shuffle cue/animation lost');
      time = 2102; deck.position.y = 3; effects.applyAnim('deck', deck);
      assert(deck.position.y === 3, 'Expired animation still offsets the mesh');
      messages.get('sfx')({ type: 'card-drop' }); assert(sounds.at(-1) === 'card-drop', 'Shared sound not routed');
      messages.get('shuffled')({ id: 'deck', sfx: 'tile-shuffle' }); assert(sounds.at(-1) === 'tile-shuffle', 'Tile shuffle cue lost');
      messages.get('shuffled')({ id: 'deck', sfx: 'untrusted' }); assert(sounds.at(-1) === 'shuffle', 'Unexpected cue was accepted');
      messages.get('sfx')({ type: 'tile-flip' }); assert(sounds.at(-1) === 'tile-flip', 'Tile flip not routed');
      const marker = scene.children.find(mesh => mesh.renderOrder === 3);
      effects.updateDropMarker({ id: 'deck', grabbed: true });
      assert(marker.visible && Math.abs(marker.position.y - 1.03) < 0.001, 'Landing marker missed board collider');
      state.pieces.get('board').props = JSON.stringify({ model: 'fixture.glb', box: [3, 1, 3] });
      effects.updateDropMarker({ id: 'deck', grabbed: true });
      assert(Math.abs(marker.position.y - 1.53) < 0.001, 'Landing surface did not refresh changed props');
      effects.disposeSurface('board'); meshes.delete('board');
      effects.updateDropMarker({ id: 'deck', grabbed: true });
      assert(Math.abs(marker.position.y - 0.03) < 0.001, 'Removed board left stale landing height');
      effects.updateDropMarker(null); assert(!marker.visible, 'Idle landing marker visible');
      effects.highlightPiece('missing');
      assert(sent.at(-1)[0] === 'ping', 'Unknown object generated a highlight request');
      effects.highlightPiece('deck');
      assert(sent.at(-1)[0] === 'highlightPiece' && sent.at(-1)[1].id === 'deck', 'Highlight request lost');
      const show = messages.get('pieceHighlighted');
      const halos = () => scene.children.filter(child => child.isSprite);
      show({ id: 'missing', sid: 'me' });
      assert(!halos().length, 'Unknown object generated a halo');
      time = 3000; show({ id: 'deck', sid: 'me' });
      const halo = halos()[0], originalMaterial = deck.material, alpha = halo.material.opacity;
      assert(halo.position.y === 3 && halo.material.color.getHexString() === 'ff0000', 'Halo position/color wrong');
      const haloTexture = halo.material.map;
      let haloDisposed = 0;
      haloTexture.addEventListener('dispose', () => haloDisposed++);
      halo.material.addEventListener('dispose', () => haloDisposed++);
      time = 3400; deck.position.set(2, 4, 1); effects.updatePings();
      assert(halo.position.x === 2 && halo.position.y === 4 && halo.material.opacity < alpha, 'Halo did not follow/pulse');
      assert(deck.material === originalMaterial, 'Highlight replaced authored material');
      time = 5900; show({ id: 'deck', sid: 'me' });
      assert(halos().length === 1 && halos()[0] === halo, 'Repeated highlight stacked effects');
      time = 6500; effects.updatePings(); assert(halos().length === 1, 'Refresh did not extend lifetime');
      time = 9100; effects.updatePings();
      assert(!halos().length && haloDisposed === 2, 'Expired halo leaked resources');
      show({ id: 'deck', sid: 'me' });
      assert(halos()[0].material.map !== haloTexture, 'Disposed halo texture reused');
      const other = deck.clone(); meshes.set('other', { type: 'prop', mesh: other });
      state.pieces.set('other', { type: 'prop' }); show({ id: 'other', sid: 'me' });
      assert(halos().length === 2 && halos()[0].material.map === halos()[1].material.map, 'Halo texture is not shared');
      let sharedDisposed = 0; halos()[0].material.map.addEventListener('dispose', () => sharedDisposed++);
      effects.disposeSurface('other');
      assert(halos().length === 1 && sharedDisposed === 0, 'Removing an object disposed an active shared texture');
      deck.visible = false; effects.updatePings();
      assert(!halos().length && sharedDisposed === 1, 'Invisible object kept its halo');
      show({ id: 'deck', sid: 'me' }); assert(!halos().length, 'Invisible object acquired a halo');
      deck.visible = true;
      show({ id: 'deck', sid: 'me' });
      const savedDeck = state.pieces.get('deck'); state.pieces.delete('deck'); effects.updatePings();
      assert(!halos().length, 'Removed piece retained its halo'); state.pieces.set('deck', savedDeck);


      let held = null, sheet = false, capturedWhileVisible = false, radial, rank = 0;
      const selection = { size: 0 };
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const pieces = { current: () => held, isActive: () => !!held,
        sendAction: (...args) => sent.push(args), armMove: () => {},
        beginMoveFromMenu: () => { capturedWhileVisible = !byId('pieceMenu').hidden; return true; } };
      const ui = createPieceUi({ byId, canvas, meshes, kinds: { deck: { grab: 2 } }, getRoom: () => room,
        pieceDrag: pieces, hand: { drag: () => null, hoverCard: () => null, isDragging: () => false }, selection,
        inspection: { isActive: () => false, isInspectable: () => true },
        overlays: { isMeasuring: () => false, isMoving: () => false, isDraggingMeasure: () => false },
        whiteboard: { isOwning: () => false }, setPointer() {}, pickId: () => 'deck',
        isSheet: () => sheet, openRadial: (...args) => { radial = args; return true; },
        highlightPiece: (id) => sent.push(['menuHighlight', id]), getRank: () => rank,
        editLabels: (id) => sent.push(['menuLabels', id]) });
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 80 }));
      assert(byId('hoverCount').textContent === '12 cards', 'Hover count missing');
      state.pieces.get('deck').count = 8; ui.update();
      assert(byId('hoverCount').textContent === '8 cards', 'Hover count did not follow state');
      ui.openPieceMenu('deck', { x: 80, y: 80 });
      [...byId('pieceMenu').querySelectorAll('button')].find(b => b.textContent === 'Highlight').click();
      assert(sent.at(-1)[0] === 'menuHighlight' && sent.at(-1)[1] === 'deck', 'Desktop highlight action missing');
      ui.openPieceMenu('deck', { x: 80, y: 80 });
      const move = [...byId('pieceMenu').querySelectorAll('button')].find(b => b.textContent === 'Move');
      move.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, cancelable: true }));
      assert(capturedWhileVisible && byId('pieceMenu').hidden, 'Menu removed before Move capture');
      meshes.set('die', { type: 'die' }); sheet = true; ui.openPieceMenu('die', { x: 100, y: 100 });
      assert(radial[2].some(item => item.label === 'Roll'), 'Small piece menu did not use radial');
      radial[2].find(item => item.label === 'Highlight').fn();
      assert(sent.at(-1)[0] === 'menuHighlight' && sent.at(-1)[1] === 'die', 'Touch highlight action missing');
      assert(!radial[2].some(item => item.label === 'Labels…'), 'Player menu offered GM labels');
      rank = 2;
      for (const touch of [false, true]) {
        sheet = touch; ui.openPieceMenu('deck', { x: 80, y: 80 });
        const labelAction = [...byId('pieceMenu').querySelectorAll('button')].find(b => b.textContent === 'Labels…');
        assert(labelAction, 'GM label action missing from desktop/touch menu');
        labelAction.click();
        assert(sent.at(-1)[0] === 'menuLabels' && sent.at(-1)[1] === 'deck', 'GM label menu target lost');
      }
      held = { id: 'deck', type: 'deck', grabbed: true, touch: true }; ui.updateHoldControls();
      assert(!document.querySelector('.heightUp').hidden, 'Touch height controls missing');
      held = null; selection.size = 1; ui.updateHoldControls();
      assert(document.querySelector('.heightUp').hidden && !document.querySelector('.rotLeft').hidden, 'Selection controls confused with held controls');
      ui.update();
      if (matchMedia('(hover: hover) and (pointer: fine)').matches)
        assert(byId('controlGuide').textContent.includes('Deck'), 'Desktop guide did not render');
      else assert(byId('controlGuide').hidden, 'Touch guide should stay hidden');
      ui.openPieceMenu('deck', { x: 80, y: 80 });
    `,
  },
  {
    name: 'room-binders',
    root: '#regionTR',
    expect: { selector: '#scoreRows tr', min: 1 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const { createChat } = await import('/table/chat.js');
      const { createScoreboard } = await import('/table/scoreboard.js');
      const { createMembership } = await import('/table/membership.js');
      const { createTimer } = await import('/table/timer.js');
      const { createUiSurfaces } = await import('/ui/ui-surfaces.js');
      const { applyIcons, setIcon } = await import('/ui/icons.js');
      const byId = (id) => document.getElementById(id);
      const ui = createUiSurfaces();
      const messages = new Map(), sent = [], listeners = new Map(), collections = {}, tasks = new Map();
      let rank = 3, taskId = 0, tick;
      const delay = (fn) => { tasks.set(++taskId, fn); return taskId; };
      const cancelDelay = (id) => tasks.delete(id);
      const state = { notes: 'Shared notes', players: new Map([['me', { name: 'Ada', role: 'owner' }],
        ['other', { name: 'Bob', role: 'player' }]]), unclaimed: new Map([[7, 'Absent']]),
        timer: { running: true, mode: 'up', base: 60000, since: 1000, duration: 120000 } };
      const room = { state, onMessage: (key, fn) => messages.set(key, fn), send: (key, value) => {
        sent.push([key, value]);
        if (key === 'chatLog') messages.get('chatLog')({ log: [{ from: 'Ada', text: 'Restored', ts: 0 }] });
      } };
      const cb = (object) => ({
        scores: { onAdd: (fn) => { collections.scoreAdd = fn; }, onRemove: (fn) => { collections.scoreRemove = fn; } },
        unclaimed: { onAdd: (fn) => { collections.handAdd = fn; }, onRemove: (fn) => { collections.handRemove = fn; } },
        listen: (key, fn) => {
          if (!listeners.has(object)) listeners.set(object, new Map());
          listeners.get(object).set(key, fn);
        },
      });
      const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
      const chat = createChat({ getRoom: () => room, byId });
      byId('myName').textContent = 'Ada'; chat.bindRoom(room); chat.bindControls();
      assert(byId('chatLog').textContent.includes('Restored'), 'Chat replay was missed');
      messages.get('chatLog')({ log: [{ from: 'Bob', text: '<b>literal</b>', ts: 0 }] });
      assert(!byId('chatLog').textContent.includes('Restored') && !byId('chatLog').querySelector('b'), 'Chat replay or escaping failed');
      assert(byId('chatBtn').classList.contains('hasUnread'), 'Hidden chat did not flag unread');
      byId('chatInput').value = ' hello ';
      byId('chatInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      assert(sent.at(-1)[0] === 'chat' && sent.at(-1)[1].text === 'hello' && byId('chatInput').value === '', 'Chat Enter did not send');
      const score = createScoreboard({ getRoom: () => room, getRank: () => rank, byId,
        confirmAction: () => true, delay, cancelDelay });
      score.bindRoom(room, cb); score.hydrate(); score.bindControls();
      state.scores = new Map([['s1', { label: 'Team', score: 3 }]]);
      const row = state.scores.get('s1'); collections.scoreAdd(row); score.applyRole();
      assert(byId('scoreRows').querySelector('.scoreVal').textContent === '3', 'Late scoreboard hydration failed');
      button(byId('scoreRows'), '+').click(); assert(sent.at(-1)[1].delta === 1, 'Score adjust did not send');
      row.score = 5; listeners.get(row).get('score')();
      assert(byId('scoreRows').querySelector('.scoreVal').textContent === '5', 'Score patch did not render');
      byId('regionTR').hidden = false;
      const showPane = (name) => byId('regionTR').querySelectorAll('.pane').forEach((p) => {
        p.hidden = p.dataset.pane !== name; p.classList.toggle('on', p.dataset.pane === name);
      });
      showPane('score');
      if (ui.isSheet()) {
        byId('roomSheet').appendChild(byId('roomInfoBody'));
        byId('roomSheet').hidden = false; ui.openAsSheet(byId('roomSheet'));
      }
      byId('roomNotes').focus();
      assert(document.activeElement === byId('roomNotes'), 'Notes fixture did not open its input');
      byId('roomNotes').value = 'draft';
      state.notes = 'remote'; listeners.get(state).get('notes')();
      assert(byId('roomNotes').value === 'draft', 'Remote notes stomped editing');
      byId('roomNotes').dispatchEvent(new Event('input')); byId('roomNotes').blur();
      assert(tasks.size === 0 && sent.at(-1)[0] === 'roomNotes' && sent.at(-1)[1].text === 'draft', 'Notes blur did not flush once');
      listeners.get(state).get('notes')(); assert(byId('roomNotes').value === 'remote', 'Remote notes did not hydrate');
      rank = 0; score.applyRole();
      assert(!byId('scoreRows').querySelector('input') && byId('roomNotes').readOnly && byId('scoreEdit').hidden, 'Read-only score role failed');
      rank = 3; score.applyRole();
      byId('scoreAddName').value = 'New'; byId('scoreAdd').click(); assert(sent.at(-1)[1].label === 'New', 'Add score failed');
      byId('scoreClear').click(); assert(sent.at(-1)[1].action === 'clear', 'Clear scores failed');
      const members = createMembership({ getRoom: () => room, getSessionId: () => 'me', byId, applyIcons });
      members.bindMessages(room); members.bindRoom(room, cb); members.renderUnclaimed();
      messages.get('memberList')([{ userId: 9, username: 'Waiting', status: 'pending', role: 'player' }]);
      assert(!byId('memberPending').hidden, 'Pending membership indicator missing');
      button(byId('memberList'), 'Admit').click(); assert(sent.at(-1)[0] === 'admit' && sent.at(-1)[1].userId === 9, 'Admit did not send');
      messages.get('memberList')([{ userId: 9, username: 'Member', status: 'admitted', role: 'player', isSelf: false, timedOut: false }]);
      button(byId('memberList'), 'Time-out').click();
      assert(sent.at(-1)[0] === 'setPlayerTimeout' && sent.at(-1)[1].userId === 9 && sent.at(-1)[1].timedOut === true, 'Time-out control lost its target');
      messages.get('memberList')([{ userId: 9, username: 'Member', status: 'admitted', role: 'player', isSelf: false, timedOut: true }]);
      button(byId('memberList'), 'End time-out').click();
      assert(sent.at(-1)[1].timedOut === false, 'End time-out did not restore interaction');
      messages.get('memberList')([{ userId: 9, username: 'Member', status: 'admitted', role: 'player', isSelf: true, timedOut: true }]);
      assert(!byId('memberList').querySelector('button'), 'Self moderation was offered');
      const assign = byId('unclaimedHands').querySelector('select'); assign.value = 'other'; assign.dispatchEvent(new Event('change'));
      assert(sent.at(-1)[0] === 'reassignHand' && sent.at(-1)[1].toSessionId === 'other', 'Hand reassignment failed');
      state.unclaimed.clear(); collections.handRemove(); assert(!byId('unclaimedHands').children.length, 'Removed hand stayed visible');
      messages.get('memberList')([]); assert(byId('memberPending').hidden, 'Pending membership indicator stayed on');
      const timer = createTimer({ getRoom: () => room, byId, setIcon, now: () => 2000,
        repeat: (fn, ms) => { assert(ms === 100, 'Timer tick changed'); tick = fn; } });
      byId('roomInfo').appendChild(byId('roomInfoBody')); byId('roomSheet').hidden = true;
      ui.clearSheet(byId('roomSheet'));
      timer.bindControls(); showPane('timer');
      if (ui.isSheet()) ui.openAsSheet(byId('regionTR'));
      tick();
      assert(byId('timerReadout').textContent === '1:01' && !byId('timerMini').hidden, 'Timer anchor display failed');
      byId('timerToggle').click(); assert(sent.at(-1)[1].action === 'pause', 'Timer pause did not send');
      state.timer = { running: false, mode: 'down', base: 90000, duration: 120000 }; tick();
      assert(byId('timerReadout').textContent === '1:30' && !byId('timerDurRow').hidden && byId('timerMini').hidden, 'Remote timer mode failed');
      byId('timerDur').focus(); byId('timerDur').value = '7'; tick();
      assert(byId('timerDur').value === '7', 'Timer tick overwrote focused duration');
      byId('timerDur').dispatchEvent(new Event('change'));
      assert(sent.at(-1)[1].duration === 420000 && sent.at(-1)[1].mode === 'down', 'Timer duration conversion failed');
      byId('timerReset').click(); assert(sent.at(-1)[1].action === 'reset', 'Timer reset did not send');
      showPane('score'); applyIcons();`,
  },
  {
    name: 'room-settings',
    root: '#roomSettingsModal',
    expect: { selector: '#feltSwatches .swatch, #gridColorSwatches .swatch', min: 15 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const THREE = await import('three');
      const { createRoomSettings } = await import('/table/room-settings.js');
      const { createSkybox } = await import('/table/skybox.js');
      const { gridMesh } = await import('/rendering/graphics.js');
      const { normalizeLighting } = await import('/shared/lighting.js');
      const byId = (id) => document.getElementById(id);
      const fieldWrap = (id) => byId(id).closest('.stepper') || byId(id);
      const scene = new THREE.Scene();
      const state = { tableX: 10, tableZ: 7, tableShape: 'rect', feltColor: '#2f6b4f', rimWood: 'oak',
        scale: { worldPerUnit: 2, unitLabel: 'cm', roundStep: 0.5, gridStyle: 'square', cellWorld: 2,
          cellZ: 4, gridX: 0, gridZ: 0, gridLift: 0.05, gridColor: '#ffffff', snapAnchor: 'center' },
        lighting: normalizeLighting({ preset: 'neutral' }), whiteboard: {},
        pieces: new Map([['board', { type: 'board', props: '{"board":"chess"}' }]]),
        players: new Map([['me', { role: 'owner' }]]) };
      const sent = [], applied = [], listeners = new Map();
      let quality = 'high', reloaded = false;
      const room = { state, sessionId: 'me', send: (...args) => sent.push(args) };
      const listen = (object) => (key, fn) => {
        if (!listeners.has(object)) listeners.set(object, new Map());
        listeners.get(object).set(key, fn);
      };
      const cb = (object) => ({ listen: listen(object),
        lighting: { listen: listen(state.lighting) }, scale: { listen: listen(state.scale) } });
      const change = (object, key, value) => { object[key] = value; listeners.get(object).get(key)(); };
      const settings = createRoomSettings({ scene, gridMesh, gridLiftFallback: 0.05,
        resizeTable: () => {}, setTableColor: () => {}, setRimWood: () => {},
        applyLighting: (...args) => applied.push(args), getQuality: () => quality,
        setQuality: (value) => { quality = value; }, getRoom: () => room,
        onTableResize: () => {}, syncWhiteboardSettings: () => {}, relabelOverlays: () => {},
        byId, setIcon: () => {}, reload: () => { reloaded = true; },
        confirmAction: () => true, alertUser: (message) => { throw Error(message); },
      });
      settings.bindRoom(room, cb); settings.hydrate(); settings.bindControls();
      byId('roomSettings').click();
      assert(!byId('roomSettingsModal').hidden && byId('tableW').value === '20', 'Settings did not hydrate');
      document.querySelector('[data-tshape="round"]').click();
      assert(sent.at(-1)[0] === 'table' && sent.at(-1)[1].z === 10, 'Round shape did not lock depth');
      change(state, 'tableShape', 'round');
      assert(fieldWrap('tableD').hidden && byId('tableWLabel').textContent === 'Size', 'Round UI is not single-size');
      change(state, 'tableShape', 'rect');
      assert(!fieldWrap('tableD').hidden, 'Rectangular depth stayed hidden');
      document.querySelector('#tableWoods [data-wood]').click();
      assert(sent.at(-1)[0] === 'table' && sent.at(-1)[1].rimWood, 'Rim wood did not send');
      byId('feltSwatches').firstElementChild.click();
      assert(sent.at(-1)[0] === 'tableColor', 'Felt swatch did not send');
      document.querySelector('#roomSettingsModal [data-tab="grid"]').click();
      document.querySelector('#scaleUnits [data-unit="__custom__"]').click();
      assert(!byId('scaleCustomRow').hidden && document.activeElement === byId('scaleUnitCustom'), 'Custom units did not focus');
      byId('scaleUnitCustom').value = 'hex'; byId('scaleUnitCustom').dispatchEvent(new Event('change'));
      assert(sent.at(-1)[1].unitLabel === 'hex', 'Custom unit did not send');
      byId('gridCell').value = '3'; byId('gridCell').dispatchEvent(new Event('change'));
      assert(sent.at(-1)[1].cellWorld === 6, 'Cell size lost unit conversion');
      change(state.scale, 'gridStyle', 'hex');
      assert(!byId('gridOrientRow').hidden && fieldWrap('gridCellZ').hidden, 'Hex controls are wrong');
      document.querySelector('#gridOrients [data-orient="flat"]').click();
      assert(sent.at(-1)[1].hexOrient === 'flat', 'Hex orientation did not send');
      byId('gridCells').value = '7'; byId('gridCalib').click();
      assert(sent.at(-1)[0] === 'calibrateGrid' && sent.at(-1)[1].cells === 7, 'Calibration did not send');
      byId('gridHideTog').click(); assert(sent.at(-1)[1].gridHidden === true, 'Hide grid did not send');
      change(state.scale, 'gridHidden', true); assert(scene.children.length === 0, 'Hidden grid is still drawn');
      change(state.scale, 'gridHidden', false); assert(scene.children.length === 1, 'Grid did not return');
      const lightTab = document.querySelector('#roomSettingsModal [data-tab="lighting"]'); lightTab.click();
      assert(!document.querySelector('#roomSettingsModal [data-pane="lighting"]').hidden, 'Lighting tab did not open');
      const before = sent.length;
      byId('lightingAzimuth').value = '150'; byId('lightingAzimuth').dispatchEvent(new Event('input'));
      assert(applied.at(-1)[0].azimuth === 150 && sent.length === before, 'Lighting preview should stay local');
      byId('lightingGlobe').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, cancelable: true }));
      assert(applied.at(-1)[0].azimuth === 151, 'Lighting globe fine keyboard control failed');
      byId('lightingCancel').click(); assert(applied.at(-1)[0].azimuth === state.lighting.azimuth, 'Cancel did not restore lighting');
      byId('roomSettings').click(); byId('lightingAzimuth').value = '210'; byId('lightingAzimuth').dispatchEvent(new Event('input'));
      byId('lightingApply').click(); assert(sent.at(-1)[0] === 'lightingApply' && sent.at(-1)[1].azimuth === 210, 'Apply lost lighting draft');
      document.querySelector('#qualityRow [data-quality="low"]').click();
      assert(quality === 'low' && !byId('qualityApply').hidden, 'Quality change did not show Apply');
      byId('qualityApply').click(); assert(reloaded, 'Quality Apply did not reload');
      document.querySelector('#qualityRow [data-quality="high"]').click(); assert(byId('qualityApply').hidden, 'Original quality should hide Apply');
      const loads = []; let resolution = 'high';
      class Loader { load(ref, done) { loads.push(done); } }
      const sky = createSkybox({ THREE: { ...THREE, TextureLoader: Loader }, scene,
        renderer: { capabilities: { getMaxAnisotropy: () => 1 } }, deviceClass: () => 'desktop', byId,
        storage: { getItem: () => resolution, setItem: (key, value) => { resolution = value; } } });
      sky.bindControls(); sky.sync('/pending-sky');
      document.querySelector('#skyResRow [data-skyres="off"]').click();
      const stale = new THREE.Texture({ width: 1, height: 1 }); let disposed = false;
      stale.addEventListener('dispose', () => { disposed = true; }); loads[0](stale);
      assert(resolution === 'off' && disposed && scene.background === null, 'Sky Off did not reject pending texture');
      byId('roomSettings').click(); lightTab.click();`,
  },
  {
    name: 'placard-settings',
    root: '#settingsModal',
    expect: { selector: '#placard-shape option', min: 8 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const { createPlacardSettings } = await import('/table/placard-settings.js');
      const { PLACARD_SHAPES, PLACARD_PATTERNS, DEFAULT_PLACARD } = await import('/shared/placards.js');
      const { makePlayerTexture } = await import('/rendering/graphics.js');
      const byId = id => document.getElementById(id);
      const player = { name: 'Alex', color: '#c9a25a', avatar: '', showing: 0, placard: JSON.stringify(DEFAULT_PLACARD) };
      const sent = [], messages = new Map();
      const room = { state: { players: new Map([['me', player]]) },
        send: (...args) => sent.push(args), onMessage: (key, fn) => messages.set(key, fn) };
      const editor = createPlacardSettings({ byId, getRoom: () => room, getSessionId: () => 'me' });
      editor.bindMessages(room); editor.bindControls();
      byId('tableLoading').hidden = true;
      byId('settingsModal').hidden = false;
      for (const pane of byId('settingsModal').querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== 'placard';
      for (const tab of byId('settingsModal').querySelectorAll('[data-tab]')) tab.classList.toggle('on', tab.dataset.tab === 'placard');
      const edit = (key, value) => { byId('placard-' + key).value = value; byId('placard-' + key).dispatchEvent(new Event('input', { bubbles: true })); };
      const audio = new AudioContext();
      for (const kind of ['flip', 'shuffle']) for (let variant = 1; variant <= 3; variant++) {
        const response = await fetch('/sounds/tile-' + kind + '-' + variant + '.ogg');
        assert(response.ok, 'Tile sound asset missing');
        const buffer = await audio.decodeAudioData(await response.arrayBuffer());
        const samples = buffer.getChannelData(0);
        assert(buffer.duration > 0.3 && buffer.duration < 1.6 && samples.some(value => Math.abs(value) > 0.01), 'Tile cue is silent or unbounded');
        assert(samples.every(value => Math.abs(value) < 1), 'Tile sound clips');
      }
      await audio.close();
      const pixels = new Set();
      for (const shape of Object.keys(PLACARD_SHAPES)) {
        edit('shape', shape);
        for (const pattern of Object.keys(PLACARD_PATTERNS)) {
          edit('pattern', pattern);
          const texture = makePlayerTexture({ ...player, placard: JSON.stringify({ ...DEFAULT_PLACARD, shape, pattern }) });
          assert(texture.image.width >= 640, 'Placard lost texture detail');
          const data = texture.image.getContext('2d').getImageData(0, 0, 1, 1).data;
          assert(data[3] === 0, 'Silhouette has an opaque rectangular background');
          texture.dispose();
        }
        pixels.add(byId('placardPreview').toDataURL());
      }
      assert(pixels.size === 8 && sent.length === 0, 'Presets are identical or preview changed shared state');
      edit('shape', 'frog'); edit('pattern', 'stars'); edit('color', '#287e67'); edit('accent', '#e7bd54');
      byId('placardSave').click();
      assert(sent.at(-1)[0] === 'setPlacard' && sent.at(-1)[1].shape === 'frog', 'Save not wired');
      assert(byId('placardFields').disabled, 'Duplicate saves allowed');
      messages.get('serverError')({ operation: 'setPlacard', message: 'Please retry' });
      assert(!byId('placardFields').disabled && byId('placard-shape').value === 'frog', 'Failure lost draft');
      byId('placardSave').click();
      const saved = sent.at(-1)[1]; player.placard = JSON.stringify(saved);
      messages.get('placardSaved')(saved);
      assert(byId('placardStatus').textContent.includes('Saved'), 'No durable save acknowledgment');
      byId('placardReset').click();
      assert(byId('placard-shape').value === DEFAULT_PLACARD.shape && sent.length === 2, 'Reset saved without consent');
      edit('shape', 'frog'); edit('pattern', 'stars'); edit('color', '#287e67'); edit('accent', '#e7bd54');
      messages.get('placardSaved')(DEFAULT_PLACARD);
      assert(byId('placard-shape').value === 'frog' && byId('placardStatus').textContent.includes('unsaved'), 'Late acknowledgment overwrote the draft');
      const r = byId('placardSave').getBoundingClientRect();
      assert(r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight, 'Save control is clipped');
      byId('placard-shape').focus(); assert(document.activeElement === byId('placard-shape'), 'Keyboard control unavailable');
    `,
  },
  {
    name: 'player-presence',
    root: '#players',
    expect: { selector: '#players .prow', min: 3 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const THREE = await import('three');
      const { createPresence } = await import('/table/presence.js');
      const { seatAngle } = await import('/shared/pieces.js');
      const byId = (id) => document.getElementById(id);
      const me = { name: '<img src=x onerror=alert(1)>', role: 'gm', seat: 0, order: 0,
        color: '#c9a25a', avatar: '', hand: 2, showing: 0 };
      const other = { name: 'Bob', role: 'owner', seat: 1, order: 1,
        color: '#55aaff', avatar: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E', hand: 3, showing: 1 };
      const third = { ...other, name: 'Carol', role: 'player', seat: 2, order: 2, avatar: '' };
      const state = { players: new Map([['me', me], ['bob', other], ['carol', third]]),
        tableX: 10, tableZ: 7, turn: 'me', turnPending: '', roomName: '' };
      const sent = [], listeners = new Map(), messages = new Map();
      const room = { state, send: (...args) => sent.push(args), onMessage: (key, fn) => messages.set(key, fn) };
      let rank = 2, removed;
      const cb = (object) => ({
        players: { onAdd: (fn) => state.players.forEach(fn), onRemove: (fn) => { removed = fn; } },
        listen(key, fn) {
          if (!listeners.has(object)) listeners.set(object, new Map());
          listeners.get(object).set(key, fn);
        },
      });
      const change = (object, key, value) => { object[key] = value; listeners.get(object).get(key)(); };
      const presence = createPresence({
        THREE, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
        controls: { target: new THREE.Vector3(), update() {} },
        cardMesh: () => new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1.5)),
        makePlayerTexture: () => new THREE.Texture(), makeYouChipTexture: () => new THREE.Texture(),
        nameTag: () => new THREE.Texture(), disposeSprite: () => {}, resizeToCanvas: () => {},
        seatAngle, setSeatCameraReady: () => {}, label: { w: 2, h: 0.5, lift: 1 },
        getRoom: () => room, getSessionId: () => 'me', getRank: () => rank,
        getPieceVisual: () => null, getRevealed: () => [], setRevealed: () => {}, clearRevealed: () => {},
        onLocalRole: (role) => { rank = role === 'gm' ? 2 : 0; },
        onPlayersChanged: () => {}, onPlayerRemoved: () => {}, onHydration: () => {}, byId,
      });
      presence.bindMessages(room); presence.bindRoom(room, cb); presence.bindControls();
      const rows = () => [...byId('players').querySelectorAll('.prow[data-sid]')];
      assert(rows().map((row) => row.dataset.sid).join() === 'me,bob,carol', 'Roster order is wrong');
      assert(!byId('players').querySelector('[onerror]') && rows()[0].textContent.includes(me.name),
        'Player name was interpreted as HTML');
      assert(rows()[1].querySelector('.pav') && rows()[2].querySelector('.dot'), 'Avatar/color fallback is missing');
      assert(rows()[0].querySelector('.rolebadge').textContent === 'gm' && !rows()[2].querySelector('.rolebadge'),
        'Role badges are wrong');
      assert(byId('turnMini').textContent === 'Your Turn' && byId('turnBtn').classList.contains('myturn'),
        'Local turn is not emphasized');
      assert(byId('roomTitle').textContent === 'Bob’s Table', 'Owner-based room title is missing');
      const firstButtons = rows()[0].querySelectorAll('.turnOrderControls button');
      assert(firstButtons[0].disabled && !firstButtons[1].disabled, 'First row move limits are wrong');
      firstButtons[1].click();
      assert(sent.at(-1)[0] === 'turnOrder' && sent.at(-1)[1].order.join() === 'bob,me,carol',
        'Touch-accessible reorder button sent the wrong order');
      const transfer = new DataTransfer();
      rows()[2].dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true }));
      rows()[0].dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      assert(sent.at(-1)[1].order.join() === 'carol,me,bob', 'Drag reorder sent the wrong order');
      change(me, 'role', 'player');
      assert(!byId('players').querySelector('.turnOrderControls') && rows().every((r) => !r.draggable),
        'Demotion left turn-order controls enabled');
      change(me, 'role', 'gm');
      change(third, 'participation', 'spectator');
      assert(rows()[2].textContent.includes('spectator') && !rows()[2].querySelector('.turnOrderControls'),
        'Spectator status or turn exclusion is missing');
      rows()[0].querySelectorAll('.turnOrderControls button')[1].click();
      assert(sent.at(-1)[1].order.join() === 'bob,me', 'Reorder included a spectator');
      change(me, 'participation', 'spectator');
      assert([...byId('players').querySelectorAll('.turnOrderControls button')].every((button) => button.disabled) &&
        rows().every((r) => !r.draggable), 'Spectating GM retained enabled turn-order controls');
      change(me, 'participation', 'player');
      change(third, 'participation', 'player');
      change(state, 'turn', 'bob');
      assert(rows()[1].classList.contains('turn') && !byId('turnBtn').classList.contains('myturn') &&
        byId('turnBtn').getAttribute('aria-label').startsWith("Bob's turn"), 'Remote turn state is wrong');
      change(state, 'turnPending', 'Offline player');
      assert(byId('players').querySelector('.turn-waiting').textContent.includes('Offline player'),
        'Pending turn is missing');
      change(state, 'roomName', 'Friday game');
      assert(byId('roomTitle').textContent === 'Friday game', 'Room title did not update');
      byId('turnBtn').click();
      assert(sent.at(-1)[0] === 'nextTurn', 'Turn button did not advance');
      state.players.delete('carol'); removed(third, 'carol');
      assert(rows().length === 2, 'Departed player remained in roster');
      byId('roomInfo').classList.remove('collapsed');
      byId('roomInfo').hidden = false;`,
  },
  {
    name: 'selection-toolbar',
    root: '#selActions',
    expect: { selector: '#selSwatches .swatch', min: 2 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const THREE = await import('three');
      const { createSelection } = await import('/table/selection.js');
      const byId = (id) => document.getElementById(id);
      const scene = new THREE.Scene();
      const pieces = new Map();
      const meshes = new Map();
      const sent = [];
      const room = { state: { pieces }, send: (...args) => sent.push(args) };
      const selection = createSelection({
        THREE, scene, camera: new THREE.PerspectiveCamera(), canvas: document.createElement('canvas'),
        meshes, marker: { inner: 0.8, outer: 1, lift: 0.01 },
        getRoom: () => room, getBoardTopY: () => 0, byId,
      });
      selection.bindModeControls();
      selection.bindActions();
      const set = (id, type, props = {}) => {
        pieces.set(id, { type, props: JSON.stringify(props) });
        meshes.set(id, { type, mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)) });
      };
      const select = (...ids) => {
        selection.clear();
        for (const id of ids) {
          selection.beginPointer({ primary: true, additive: true }, id);
          selection.endPointer({});
        }
        selection.update();
      };
      set('a', 'die'); set('b', 'prop', { shape: 'poker_chip' });
      select('a', 'b');
      assert(!byId('selActions').hidden && !byId('selRecolor').hidden, 'Selection toolbar is hidden');
      const first = byId('selSwatches').firstElementChild;
      selection.update();
      assert(byId('selSwatches').firstElementChild === first, 'Unchanged palette rebuilt the DOM');
      first.click();
      assert(sent.at(-1)[0] === 'recolorGroup' && sent.at(-1)[1].ids.length === 2 &&
        'textColor' in sent.at(-1)[1], 'Color swatch did not recolor the selection');
      for (const [id, msg] of [
        ['selStand', 'setStandGroup'], ['selSnap', 'setSnapGroup'], ['selFlip', 'flipGroup'],
        ['sel2Sided', 'setOpenGroup'], ['selRoll', 'rollGroup'], ['selTake', 'takeGroup'],
      ]) {
        byId(id).click();
        assert(sent.at(-1)[0] === msg && selection.size === 2, 'Wrong batch action: ' + id);
      }
      set('b', 'prop', { shape: 'coin' }); selection.update();
      assert(byId('selRecolor').classList.contains('disabled') && !byId('selSwatches').children.length,
        'Mixed palette should disable recoloring');
      set('a', 'card', { back: 'a' }); set('b', 'deck', { back: 'b' }); selection.update();
      assert(byId('selRecolor').hidden && byId('selCombine').disabled, 'Mixed card families should not combine');
      set('a', 'card', { open: true, back: 'a' }); set('b', 'deck', { open: true, back: 'b' }); selection.update();
      assert(!byId('selCombine').disabled && byId('sel2Sided').querySelector('.lbl').textContent === 'Secret',
        'Open cards did not update compatibility and visibility label');
      byId('selCombine').click();
      assert(sent.at(-1)[0] === 'combineIntoDeck' && selection.size === 0, 'Combine did not send and clear');
      set('a', 'prop', { shape: 'poker_chip' }); set('b', 'prop', { shape: 'poker_chip' }); select('a', 'b');
      byId('selGather').click();
      assert(sent.at(-1)[0] === 'dispenseFromPieces' && selection.size === 0, 'Gather did not send and clear');
      select('a', 'b'); byId('selDelete').click();
      assert(sent.at(-1)[0] === 'removeGroup' && selection.size === 0, 'Delete did not send and clear');
      select('a'); byId('selClear').click(); selection.update();
      assert(byId('selActions').hidden && scene.children.length === 0, 'Clear left toolbar or rings visible');
      document.querySelector('.selectTool').click();
      assert(selection.isActive() && [...document.querySelectorAll('.selectTool')].every((b) => b.classList.contains('on')),
        'Select controls did not synchronize');
      assert(selection.beginPointer({ primary: true, touch: true }, 'a'), 'Touch Select tool did not select');
      selection.endPointer({}); selection.escape();
      assert(byId('selectBtn').getAttribute('aria-pressed')==='false', 'Escape left multi-select pressed');
      assert(!selection.isActive() && selection.has('a'), 'Escape did not leave selection intact after tool exit');
      byId('selectBtn').click();
      selection.beginPointer({primary:true,touch:matchMedia('(pointer: coarse)').matches,clientX:100,clientY:100},null);
      selection.movePointer({clientX:102,clientY:102});
      selection.endPointer({clientX:102,clientY:102});
      assert(!selection.isActive() && selection.has('a') && byId('selectBtn').getAttribute('aria-pressed')==='false' &&
        !byId('selectBtn').classList.contains('on'), 'Empty felt tap did not exit mode and synchronize the floating button');
      set('a', 'prop', { shape: 'go' }); set('b', 'prop', { shape: 'go', team: 1 }); select('a', 'b');
      byId('selSwatches').children[1].click();
      assert(sent.at(-1)[0] === 'recolorGroup' && sent.at(-1)[1].team === 1, 'Team swatch did not switch team');
      byId('selRecolor').classList.add('open');`,
  },
  {
    name: 'member-dock',
    root: '#roomInfo',
    expect: { selector: '#memberList .memberRow', min: 5 },
    drive: `
      const { memberRow } = await import('/ui/rows.js');
      const { applyIcons } = await import('/ui/icons.js');
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const dock = document.getElementById('roomInfo');
      document.body.append(dock);
      Object.assign(dock.style, { display: 'block', position: 'fixed', left: '20px', top: '20px', maxHeight: '90vh', overflowY: 'auto' });
      document.getElementById('roomTitle').textContent = 'Members';
      document.getElementById('roomInfoBody').style.display = 'flex';
      document.getElementById('roomInfoHead').style.display = 'flex';
      const section = document.getElementById('memberSection');
      for (const child of document.getElementById('roomInfoBody').children) child.hidden = child !== section;
      section.hidden = false;
      const list = document.getElementById('memberList');
      list.replaceChildren();
      const samples = [
        { username: 'Ben', role: 'owner', status: 'admitted', isSelf: true },
        { username: 'TestUser', role: 'player', status: 'admitted' },
        { username: 'A-very-long-unbroken-member-name', role: 'helper', status: 'admitted', timedOut: true },
        { username: 'Waiting to join', role: 'player', status: 'pending' },
        { username: 'Co-GM', role: 'gm', status: 'admitted' },
      ];
      for (const member of samples) list.append(memberRow(member, { myRank: 3, isSelf: !!member.isSelf }));
      applyIcons(list);
      assert(!list.firstChild.querySelector('button'), 'Owner received moderation actions');
      for (const width of [270, 240, 210]) {
        dock.style.width = width + 'px';
        for (const full of [false, true]) {
          document.body.classList.toggle('ui-full', full);
          for (const row of list.children) {
            const bounds = row.getBoundingClientRect();
            const identity = row.querySelector('.memberIdentity').getBoundingClientRect();
            assert(identity.width > 100 && identity.height > 0, 'Member identity collapsed');
            assert(row.scrollWidth <= row.clientWidth + 1, 'Member row overflows narrow dock');
            for (const button of row.querySelectorAll('button')) {
              const rect = button.getBoundingClientRect();
              assert(rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.top >= identity.bottom, 'Member action overlaps identity or escapes row');
              assert(button.scrollWidth <= button.clientWidth + 1, 'Member action text clipped');
              assert(button.scrollHeight <= button.clientHeight + 1, 'Member action label clipped vertically');
            }
          }
        }
      }
      dock.style.width = '270px';
    `,
  },
  {
    name: 'rows',
    page: '/__rows.html',
    root: '#gallery',
    expect: { selector: '.memberRow', min: 11 },
    settle: 250,
    drive: `void 0;`, // the fixture renders itself on import
  },
  {
    name: 'component-states',
    page: '/__component-states.html',
    root: '#componentStates',
    expect: { selector: '.button, .control, .checkbox__input', min: 15 },
    settle: 250,
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const style = (id) => getComputedStyle(document.getElementById(id));
      const normal = style('stateButton');
      const primary = style('statePrimary');
      const danger = style('stateDanger');
      const icon = style('stateIcon');
      const pressed = style('statePressed');
      const busy = style('stateBusy');
      const disabled = style('stateDisabled');
      assert(normal.fontFamily === style('stateText').fontFamily,
        'Buttons and controls do not share typography');
      assert(primary.borderTopColor !== normal.borderTopColor,
        'Primary button does not have a distinct border');
      assert(danger.color !== normal.color, 'Danger button does not have a distinct color');
      assert(icon.minWidth === '0px' && icon.paddingTop !== normal.paddingTop,
        'Icon button does not use the compact icon treatment');
      assert(pressed.borderTopColor === primary.borderTopColor,
        'Pressed state does not use the primary accent');
      assert(busy.cursor === 'progress', 'Busy button does not use the progress cursor');
      assert(disabled.cursor === 'not-allowed' && +disabled.opacity < +normal.opacity,
        'Disabled button is not visibly disabled');
      const input = style('stateText');
      const select = style('stateSelect');
      const multi = style('stateMulti');
      assert(input.backgroundColor === select.backgroundColor &&
        input.borderTopColor === select.borderTopColor,
        'Text fields and dropdowns do not share their base treatment');
      assert(select.backgroundImage !== 'none' && multi.backgroundImage === 'none',
        'Dropdown or multiselect indicator treatment regressed');
      assert(parseFloat(style('stateCompact').minHeight) < parseFloat(input.minHeight),
        'Compact control is not smaller than the base control');
      assert(style('stateControlDisabled').cursor === 'not-allowed' &&
        +style('stateControlDisabled').opacity < +input.opacity,
        'Disabled control is not visibly disabled');
      assert(style('stateChecked').backgroundColor !== style('stateCheckbox').backgroundColor,
        'Checked checkbox is not visually distinct');
      assert(style('stateCheckboxDisabled').cursor === 'not-allowed' &&
        +style('stateCheckboxDisabled').opacity < +style('stateCheckbox').opacity,
        'Disabled checkbox is not visibly disabled');`,
  },
  {
    name: 'ui-surfaces',
    page: '/__ui-surfaces.html',
    root: 'body',
    expect: { selector: '#testDialog[role="dialog"], #testRadial .radialItem', min: 3 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const { ui, radial } = window.surfaceFixture;
      const byId = (id) => document.getElementById(id);
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      byId('opener').focus();
      byId('opener').click();
      await tick();
      assert(byId('testDialog').getAttribute('aria-modal') === 'true', 'Dialog is not modal');
      assert(document.activeElement.id === (ui.isSheet() ? '' : 'dialogInput') ||
        (ui.isSheet() && document.activeElement.classList.contains('close-x')),
        'Dialog did not choose the appropriate first focus target');
      const dialogClose = byId('testDialog').querySelector('.close-x');
      dialogClose.focus();
      dialogClose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true,
        cancelable: true }));
      assert(document.activeElement.id === 'dialogInput', 'Modal Tab did not wrap to first control');
      byId('dialogInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab',
        shiftKey: true, bubbles: true, cancelable: true }));
      assert(document.activeElement === dialogClose, 'Modal Shift-Tab did not wrap to last control');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'Escape', bubbles: true }));
      await tick();
      assert(byId('testDialog').hidden && document.activeElement.id === 'opener',
        'Escape did not close the dialog and restore focus');
      byId('clusterButton').click();
      assert(!byId('testCluster').hidden && byId('testCluster')._close,
        'Cluster did not open');
      assert(byId('testCluster').classList.contains('at-two') === ui.isSheet(),
        'Cluster sheet mode does not match viewport');
      byId('testCluster').dispatchEvent(new KeyboardEvent('keydown',
        { key: 'Escape', bubbles: true }));
      assert(byId('testCluster').hidden, 'Cluster Escape did not close');
      byId('drawerButton').click();
      assert(!byId('testDrawer').hidden &&
        byId('drawerButton').getAttribute('aria-expanded') === 'true' &&
        byId('testDrawer').querySelector('.sheetGrab'), 'Drawer did not open as a sheet');
      byId('testDrawer').querySelector('.drawerRow').click();
      assert(byId('testDrawer').hidden && window.drawerActions === 1,
        'Drawer action did not close and dispatch');
      byId('repeatButton').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      byId('repeatButton').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      assert(window.repeatActions >= 2, 'Hold-repeat did not repeat');
      assert(radial.open(innerWidth / 2, innerHeight / 2, [
        { label: 'Action', fn: () => { window.radialActions++; } },
        { label: 'Other', icon: 'circle', fn: () => {} },
      ]), 'Radial menu did not open');
      assert(byId('testRadial').querySelectorAll('.radialItem').length === 2 &&
        byId('testRadial').querySelector('.ico-dice-5'), 'Radial items were not built');
      byId('testRadial').querySelector('.radialItem').click();
      assert(byId('testRadial').hidden && window.radialActions === 1 &&
        window.radialCloses === 1, 'Radial action did not close and dispatch');
      radial.open(innerWidth / 2, innerHeight / 2, [
        { label: 'Action', fn: () => {} }, { label: 'Other', fn: () => {} },
      ]);`,
  },
  {
    name: 'collider-editor',
    root: '.compoundEditor',
    expect: { selector: '.compoundEditor .button, .compoundEditor .control', min: 20 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const wait = async (test) => {
        for (let i = 0; i < 200; i++) {
          if (test()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Collider editor did not become ready');
      };
      const { openColliderEditor } = await import('/editor/compound-collider-editor.js');
      window.__componentParityCollider = openColliderEditor({
        source: '/models/pieces/chess/rook.glb',
        box: [0.5, 0.5, 0.5],
        value: { version: 1, shapes: [
          { type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], size: [0.7, 0.8, 0.7] },
          { type: 'outline', position: [0, -0.4, 0], rotation: [0, 0, 0],
            size: [0.9, 0.05, 0.9], outline: { type: 'clipped', cut: 0.18 } },
        ] },
      });
      await wait(() => document.querySelector('.compoundEditor [data-action="apply"]:not(:disabled)'));
      const dialog = document.querySelector('.compoundEditor');
      assert(dialog.matches('dialog.modal'), 'Collider editor does not use the shared modal shell');
      for (const selector of ['.modal__header', '.modal__title', '.modal__close',
        '.modal__body', '.modal__footer', '.button-row', '.field-group', '.field-label',
        '.help-text', '.status-text'])
        assert(dialog.querySelector(selector), 'Collider editor is missing ' + selector);
      for (const button of dialog.querySelectorAll('button:not(.modal__close)'))
        assert(button.classList.contains('button'),
          'Generated button lacks .button: ' + button.outerHTML.slice(0, 160));
      for (const button of dialog.querySelectorAll('button[data-icon]'))
        assert(button.classList.contains('button--icon'), 'Icon button lacks .button--icon');
      assert(dialog.querySelector('[data-action="apply"]').classList.contains('button--primary'),
        'Apply action lacks .button--primary');
      assert(dialog.querySelector('[data-action="clear"]').classList.contains('button--danger'),
        'Clear action lacks .button--danger');
      for (const control of dialog.querySelectorAll('input:not([type="checkbox"]), select'))
        assert(control.classList.contains('control'), 'Generated field lacks .control');
      for (const select of dialog.querySelectorAll('select:not([multiple])'))
        assert(select.classList.contains('control--select'), 'Dropdown lacks .control--select');
      const list = dialog.querySelector('select[multiple]');
      assert(list.classList.contains('control--select') &&
        list.classList.contains('control--multiselect'),
        'Shape list lacks the shared multiselect variants');
      const orbit = dialog.querySelector('[data-drag-mode="orbit"]');
      const move = dialog.querySelector('[data-drag-mode="move"]');
      assert(orbit.getAttribute('aria-pressed') === 'true', 'Default drag mode is not pressed');
      move.click();
      assert(move.getAttribute('aria-pressed') === 'true' &&
        orbit.getAttribute('aria-pressed') === 'false', 'Pressed drag mode did not move');
      const undo = dialog.querySelector('[data-action="undo"]');
      assert(undo.disabled && getComputedStyle(undo).cursor === 'not-allowed',
        'Initial undo action is not visibly disabled');
      assert(!dialog.querySelector('.ico-missing'), 'Collider editor contains a missing icon');`,
  },
  {
    name: 'modal-anatomy',
    root: '#settingsModal',
    expect: { selector: '.modal__header, .modal__body', min: 2 },
    drive: `
      const ids = ['settingsModal', 'roomSettingsModal', 'controlsModal',
        'libraryModal', 'addModal', 'sceneSaveModal'];
      for (const id of ids) {
        const backdrop = document.getElementById(id);
        const modal = backdrop.querySelector(':scope > .modal');
        if (!backdrop.classList.contains('modal-backdrop') || !modal ||
            !modal.querySelector('.modal__header') || !modal.querySelector('.modal__title') ||
            !modal.querySelector('.modal__close') || !modal.querySelector('.modal__body'))
          throw new Error(id + ' does not use the shared modal anatomy');
      }
      const sceneName = document.getElementById('sceneSaveName');
      if (!sceneName.closest('.field-group')?.querySelector('.field-label'))
        throw new Error('Scene save name does not use the shared field layout');
      for (const row of document.querySelectorAll('#addModal .saveFoot .row, .lightingActions'))
        if (!row.classList.contains('button-row') || !row.classList.contains('button-row--end'))
          throw new Error('Action row does not use the shared button-row layout');
      document.getElementById('settingsModal').hidden = false;`,
  },
  {
    name: 'library',
    root: '#libraryModal',
    expect: { selector: '.libCard', min: 40 },
    drive: `
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      (await import('/ui/icons.js')).applyIcons();`,
  },
  {
    // Regression guard. The overflow menu is a .pop-group whose shape matches what
    // wirePopGroups claims, so the generic wiring used to attach a SECOND click handler to the
    // trigger: the first opened and portaled the menu, the second read it as already-open and
    // shut it in the same tick. The button looked completely inert. Nothing caught it, because
    // the menu only renders for a custom asset an admin owns — a state no scene reached.
    name: 'library-overflow-open',
    root: '#libraryModal',
    // Desktop opens the portaled popover; a coarse pointer opens the action sheet instead. The
    // assertion is the thing that regressed either way: the trigger opens SOMETHING.
    expect: { selector: '.overflowMenu:not([hidden]), .sheet-backdrop', min: 1 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      document.querySelector('.libTab[data-tab="decks"]').click();
      ${WITH_ASSETS}
      (await import('/ui/icons.js')).applyIcons();
      await new Promise((r) => setTimeout(r, 60));
      document.querySelector('.overflowTrigger').click();
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    // The other half: dismissing must put the portaled menu BACK in its group. The generic
    // document closer runs first (wirePopGroups wires itself before any card renders), so if it
    // hides the menu where it stands, overflowMenu's own close() early-returns on the hidden
    // flag and never re-parents — leaving a dead menu in <body> for every card ever opened.
    name: 'library-overflow-dismissed',
    root: '#libraryModal',
    expect: { selector: '.pop-group > .overflowMenu', min: 1 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      document.querySelector('.libTab[data-tab="decks"]').click();
      ${WITH_ASSETS}
      (await import('/ui/icons.js')).applyIcons();
      await new Promise((r) => setTimeout(r, 60));
      document.querySelector('.overflowTrigger').click();
      await new Promise((r) => setTimeout(r, 60));
      document.getElementById('libraryModal').click();   // dismiss by clicking outside the menu
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    // The player's view of the library is the default one (body ships with .not-admin), so this
    // is the admin half: a custom asset in every kind, each carrying Edit and the "..." overflow.
    // Five kinds means a regression in any one of them shows up as a count, not just a diff.
    name: 'library-admin',
    root: '#libraryModal',
    expect: { selector: '.overflowTrigger', min: 5 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      ${WITH_ASSETS}
      (await import('/ui/icons.js')).applyIcons();
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    // Role-gated table chrome. .gm-only happens to render by default (nothing sets .not-gm until
    // client.js learns your rank), but .admin-only never did, so its markup went unsnapshotted
    // entirely — a change to it could not be seen by this suite at all.
    name: 'table-roles',
    root: 'body',
    expect: { selector: '.admin-only, .gm-only', min: 7 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      const { applyIcons, setIcon } = await import('/ui/icons.js');
      applyIcons();
      document.body.classList.remove('ui-full');
      document.getElementById('roomGrp').hidden = false;
      const timerLabel = document.querySelector('#timerBtn .lbl');
      if (getComputedStyle(timerLabel).display === 'none')
        throw new Error('Compact UI hides the timer value');
      const reset = document.getElementById('roomReset');
      const resetStyle = getComputedStyle(reset);
      const divider = getComputedStyle(reset, '::before');
      if (resetStyle.borderTopColor !== resetStyle.borderRightColor ||
          divider.position !== 'absolute' || divider.height !== '1px')
        throw new Error('Reset divider is part of the danger button border');
      const saveButton = document.getElementById('roomSaveState');
      if (!saveButton.querySelector(':scope > .ico'))
        throw new Error('Save Table is missing its Tabler icon');
      setIcon(saveButton, 'square-check');
      if (saveButton.querySelector(':scope > .ico > use')?.getAttribute('href') !== '#i-square-check' ||
          document.getElementById('i-square-check') === null)
        throw new Error('Save Table success icon is unavailable');
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    name: 'dice-add-menu',
    root: '#trayTools',
    expect: { selector: '.trayDie', min: 8 },
    drive: `
      (await import('/ui/icons.js')).applyIcons();
      const trayTools = document.getElementById('trayTools');
      trayTools.hidden = false;
      trayTools.querySelector('.trayDieMenu').hidden = false;
      const rects = [...trayTools.querySelectorAll('.trayDie')].map((button) =>
        button.getBoundingClientRect());
      const widths = rects.map(({ width }) => width);
      const heights = rects.map(({ height }) => height);
      if (Math.max(...widths) - Math.min(...widths) > 1 ||
          Math.max(...heights) - Math.min(...heights) > 1)
        throw new Error('Add-dice buttons do not share one size');
      if (Math.max(...heights) > 46)
        throw new Error('Add-dice buttons have regressed to oversized controls');
      if (new Set(rects.map(({ top }) => Math.round(top))).size !== 2)
        throw new Error('Add-dice buttons do not form two compact rows');
      if ([...trayTools.querySelectorAll('.trayDie')].some((button) =>
        button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1))
        throw new Error('Add-dice button content overflows its uniform footprint');
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    name: 'lighting-panel',
    root: '#roomSettingsModal',
    expect: { selector: '#lightingGlobe, .lightingControl', min: 4 },
    drive: `
      const core = await import('/rendering/core.js');
      core.applyLighting({ preset: 'custom', azimuth: 275, elevation: 25,
        keyIntensity: 1.4, keyColor: '#ff9955', ambientIntensity: 0.4,
        ambientColor: '#667799', shadowSoftness: 0.2 }, { duration: 0 });
      if (core.getLighting().azimuth !== 275) throw new Error('lighting preview did not apply');
      document.getElementById('roomSettingsModal').hidden = false;
      document.querySelectorAll('#roomSettingsModal .libPane').forEach((pane) =>
        pane.hidden = pane.dataset.pane !== 'lighting');
      document.querySelectorAll('#roomSettingsModal .libTab').forEach((tab) =>
        tab.classList.toggle('on', tab.dataset.tab === 'lighting'));
      (await import('/ui/icons.js')).applyIcons();`,
  },
  {
    name: 'scene-save-options',
    root: '#sceneSaveModal',
    expect: { selector: '#sceneSaveName, #sceneIncludeLighting, #sceneSaveConfirm', min: 3 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('sceneSaveBtn').click();`,
  },
  {
    name: 'library-swatches-open',
    root: '#libraryModal',
    expect: { selector: '.libCard', min: 40 },
    drive: `
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      (await import('/ui/icons.js')).applyIcons();
      document.querySelector('.swatchPop > .pop-trigger').click();`,
  },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'coarse-390', width: 390, height: 844, touch: true },
];

const out = {};
const server = await serveDir({
  root: ROOT,
  stubOnly: ['/client.js', '/landing.js'], // most scenes exercise controllers independently
  mounts: { '/shared/': SHARED },
  routes: {
    '/__landing-live.js': {
      body: await readFile(resolve(ROOT, 'landing.js'), 'utf8'),
      type: 'text/javascript',
    },
    '/__client-live.js': {
      body: await readFile(resolve(ROOT, 'client.js'), 'utf8'),
      type: 'text/javascript',
    },
    '/__rows.html': { body: ROWS_FIXTURE },
    '/__component-states.html': { body: COMPONENT_STATES_FIXTURE },
    '/__ui-surfaces.html': { body: UI_SURFACES_FIXTURE },
  },
});
const cdp = await launch({ webgl: true });

let bad = 0;
for (const vp of VIEWPORTS)
  for (const scene of SCENES) {
    const page = await newPage(cdp, {
      url: `${server.origin}${scene.page ?? '/table.html'}`,
      width: vp.width,
      height: vp.height,
      touch: vp.touch,
      settle: scene.settle ?? 900, // module graph + Three + the first render
    });
    // A drive that throws is a scene failure, not a suite crash. Before this, a missing element
    // in one scene's setup aborted the whole run with a stack trace, so the scenes after it never
    // reported at all — and the failure read as a broken harness rather than a broken component.
    let drove = true;
    try {
      await page.evaluate(`(async () => { ${scene.drive} })()`);
    } catch (err) {
      console.error(`  FAIL  ${scene.name} @${vp.name}: drive threw — ${err.message}`);
      bad++;
      drove = false;
    }
    await new Promise((r) => setTimeout(r, 500));

    // A harness that reports green on an empty page is worse than no harness.
    const found = await page.evaluate(
      `document.querySelectorAll(${JSON.stringify(scene.expect.selector)}).length`,
    );
    if (drove && found < scene.expect.min) {
      console.error(
        `  FAIL  ${scene.name} @${vp.name}: ${found} ${scene.expect.selector} rendered, ` +
          `expected at least ${scene.expect.min} — fixture broken`,
      );
      bad++;
    }
    if (page.errors.length) {
      console.error(`  FAIL  ${scene.name} @${vp.name}: page raised ${page.errors[0]}`);
      bad++;
    }

    const key = `${scene.name} @${vp.name}`;
    out[key] = JSON.parse(
      await page.evaluate(
        snapshotExpression({ root: scene.root, revealHidden: false, normalizeDataUrls: true }),
      ),
    );
    console.log(
      `  ${key}: ${found} ${scene.expect.selector}, ${Object.keys(out[key]).length} elements`,
    );
    await page.close();
  }

await cdp.close();
server.close();
if (server.missing.length)
  console.log(
    `  (${new Set(server.missing).size} asset paths 404'd: ${[...new Set(server.missing)].slice(0, 3).join(' ')}…)`,
  );

const file = process.argv[2] === '--out' ? process.argv[3] : null;
if (file) {
  await writeFile(file, JSON.stringify(out, null, 0));
  console.log(`wrote ${file}`);
}
if (bad) process.exitCode = 1;
