#!/usr/bin/env node
// Optional browser regression test: CHROME_BIN=/path/to/chromium node scripts/collider-editor-test.mjs
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { launch, newPage, serveDir } from './lib/headless.mjs';
const root = resolve(import.meta.dirname, '..');
const server = await serveDir({
  root: resolve(root, 'public'),
  stubOnly: ['/client.js'],
  mounts: { '/shared/': resolve(root, 'shared') },
});
// Exercise the real number-stepper wrapper even though the networked table client is stubbed.
const clientSource = await readFile(resolve(root, 'public/client.js'), 'utf8');
const stepperSource = clientSource.slice(
  clientSource.indexOf('function enhanceNumberInputs()'),
  clientSource.indexOf('enhanceNumberInputs();') + 'enhanceNumberInputs();'.length,
);
let cdp;
try {
  cdp = await launch({ webgl: true });
  for (const width of [1440, 390]) {
    const page = await newPage(cdp, {
      url: server.origin + '/table.html',
      width,
      height: 900,
      settle: 1000,
    });
    await page.evaluate(stepperSource);
    const result = await page.evaluate(`(async()=>{
      const assert=(ok,message)=>{if(!ok)throw new Error(message);};
      const wait=async test=>{for(let i=0;i<200;i++){if(test())return;await new Promise(r=>setTimeout(r,25));}throw new Error('UI did not become ready');};
      document.getElementById('tableLoading').remove();
      window.OTT_IS_ADMIN=true;document.body.classList.remove('not-admin','not-gm');
      const sent=[];window.onOttRoom(new Proxy({}, {get:(t,k)=>k==='sessionId'?'test':k==='state'?new Proxy({}, {get:()=>undefined}):k==='send'?((...args)=>sent.push(args)):(()=>{})}));
      const actualFetch=window.fetch;let uploadTarget='/models/pieces/chess/rook.glb';
      window.fetch=(url,options)=>options?.method==='POST'&&String(url).startsWith('/upload-model')?Promise.resolve(new Response(JSON.stringify({url:uploadTarget}),{headers:{'content-type':'application/json'}})):actualFetch(url,options);
      const modelFetch=window.fetch;let presets=[],nextPresetId=1;
      window.fetch=async(url,options={})=>{
        if(!String(url).startsWith('/collider-presets'))return modelFetch(url,options);
        (window.presetNetwork||=[]).push([String(url),options.method]);
        const id=String(url).split('/')[2], method=options.method||'GET';
        let body={};
        if(method==='POST') {const preset={...JSON.parse(options.body),id:String(nextPresetId++),canEdit:true};presets.push(preset);body={preset};}
        else if(method==='PUT') {const index=presets.findIndex(p=>p.id===id);presets[index]={...presets[index],...JSON.parse(options.body)};body={preset:presets[index]};}
        else if(method==='DELETE') {presets=presets.filter(p=>p.id!==id);body={ok:true};}
        else body=id?{preset:presets.find(p=>p.id===id)}:{presets,nextOffset:null};
        return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
      };
      const choose=async(id,url)=>{const blob=await (await actualFetch(url)).blob();const files=new DataTransfer();files.items.add(new File([blob],'model.glb',{type:'model/gltf-binary'}));const input=document.getElementById(id);input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
      const openTab=tab=>{document.getElementById('addModal').hidden=false;document.querySelector('#addModal .libTab[data-tab="'+tab+'"]').click();};
      const modal=()=>document.querySelector('.compoundEditor');
      const button=name=>modal().querySelector('[data-action="'+name+'"]');
      const field=name=>modal().querySelector('[data-field="'+name+'"]');
      const add=type=>modal().querySelector('[data-add-shape='+type+']').click();
      const edit=(name,value)=>{const input=modal().querySelector('[aria-label="'+name+'"]');input.value=value;input.dispatchEvent(new Event('change'));input.dispatchEvent(new Event('blur'));};
      openTab('objects');await choose('adObjGlb',uploadTarget);
      document.getElementById('adObjCustomEdit').click();
      await wait(()=>modal()&&!button('apply').disabled);
      assert(modal().matches('dialog.modal.compoundEditor'),'Collider editor is not a shared native modal');
      for(const selector of ['.modal__header','.modal__title','.modal__close','.modal__body','.modal__footer'])
        assert(modal().querySelector(selector),'Collider editor is missing '+selector);
      add('cylinder');edit('position X',0.24);edit('rotation Z',45);
      assert(modal().querySelectorAll('[data-drag-mode]').length===4,'Missing drag modes');
      assert(modal().querySelectorAll('[data-add-shape]').length===6,'Missing add buttons');
      assert(!modal().querySelector('.ico-missing'),'Missing icon');
      const x=modal().querySelector('[aria-label="position X"]');
      x.focus();x.value='0.3';x.dispatchEvent(new Event('input'));
      assert(document.activeElement===x,'Live input lost focus');
      x.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,cancelable:true}));
      assert(Math.abs(+x.value-0.31)<1e-6,'Wheel step failed');
      x.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,shiftKey:true,cancelable:true}));
      assert(Math.abs(+x.value-0.311)<1e-6,'Fine wheel step failed');
      x.dispatchEvent(new WheelEvent('wheel',{deltaY:100,ctrlKey:true,cancelable:true}));
      assert(Math.abs(+x.value-0.211)<1e-6,'Coarse wheel step failed');
      x.blur();button('undo').click();
      assert(Math.abs(+modal().querySelector('[aria-label="position X"]').value-0.24)<1e-6,'Numeric undo failed');
      add('outline');
      const preset=modal().querySelector('#compoundShapeOutline');
      preset.value='hexagon';preset.dispatchEvent(new Event('change'));
      preset.value='custom';preset.dispatchEvent(new Event('change'));
      assert(button('apply').disabled,'Invalid outline can be applied');
      preset.value='hexagon';preset.dispatchEvent(new Event('change'));
      assert(!button('apply').disabled,'Returning to valid outline remains disabled');
      edit('size Y',0.1);
      assert(modal().querySelector('#compoundShapeOutline').value==='hexagon','Outline preset lost');
      button('duplicate').click();button('delete').click();button('delete').click();
      button('clear').click();
      assert(field('list').options.length===0&&button('clear').disabled&&button('apply').disabled,'Clear all failed');
      button('undo').click();
      assert(field('list').options.length===2&&!button('apply').disabled,'Undo clear all failed');
      button('clear').click();add('sphere');
      assert(field('list').options.length===1&&!button('apply').disabled,'Add after clear failed');
      button('undo').click();button('undo').click();
      button('duplicate').click();assert(field('list').options.length===3,'Duplicate failed');
      button('delete').click();assert(field('list').options.length===2,'Delete failed');
      button('undo').click();assert(field('list').options.length===3,'Undo failed');
      button('delete').click();button('apply').click();await wait(()=>!modal());
      await wait(()=>document.querySelector('#adObjColliders [data-collider=custom]').classList.contains('on'));
      const scale=document.getElementById('adObjScale').closest('.stepper');
      const scaleRect=scale.getBoundingClientRect(), plusRect=scale.lastElementChild.getBoundingClientRect();
      assert(plusRect.right<=scaleRect.right+1&&plusRect.width>20,'Scale stepper is clipped');
      document.getElementById('adObjCustomEdit').click();await wait(()=>modal()&&!button('apply').disabled);
      add('box');button('cancel').click();await wait(()=>!modal());
      assert(document.querySelector('#adObjColliders [data-collider=custom]').classList.contains('on'),'Cancel changed layout');
      document.getElementById('adObjName').value='Compound test';document.getElementById('adObjSave').click();
      await wait(()=>sent.some(item=>item[0]==='saveProp'));
      const saved=sent.find(item=>item[0]==='saveProp')[1].props;
      assert(saved.compoundCollider.shapes.length===2&&!saved.collider,'Object save lost custom collider');
      openTab('modelboards');uploadTarget='/models/boards/go_board.glb';await choose('adBoardGlb',uploadTarget);
      const mode=document.getElementById('adBoardColliderMode');mode.value='custom';mode.dispatchEvent(new Event('change'));
      await wait(()=>modal()&&!button('apply').disabled);
      add('flat');edit('rotation X',20);
      const beforeSize=modal().querySelector('[aria-label="size Y"]').value;
      button('outline').click();
      assert(modal().querySelector('[aria-label="size Y"]').value===beforeSize,'Conversion changed thickness');
      const outline=modal().querySelector('#compoundShapeOutline');outline.value='clipped';outline.dispatchEvent(new Event('change'));
      const cut=modal().querySelector('#compoundShapeCut');cut.value=25;cut.dispatchEvent(new Event('input'));
      button('apply').click();await wait(()=>!modal()&&document.getElementById('adBoardCustomStatus').textContent.startsWith('2 shapes'));
      document.getElementById('adBoardGlbName').value='Compound board';document.getElementById('adBoardGlbSave').click();
      await wait(()=>sent.some(item=>item[0]==='saveBoard'));
      const board=sent.find(item=>item[0]==='saveBoard')[1].board;
      assert(board.compoundCollider.shapes.length===2&&!board.outline,'Board save lost custom collider');
      assert(board.compoundCollider.shapes[1].outline.cut===0.25,'Board save lost component outline');
      const THREE=await import('three');
      const {createColliderSurface,colliderSurfaceHeight,disposeColliderSurface}=await import('/collider-surface.js');
      const root=new THREE.Group();
      root.add(createColliderSurface({type:'compound',shapes:[
        {type:'box',halfExtents:[2,0.1,2],offset:[0,0.1,0]},
        {type:'cylinder',radiusTop:0.4,radiusBottom:0.4,height:2,sides:16,offset:[0,1.2,0]},
        {type:'box',halfExtents:[0.4,0.1,0.4],offset:[1,3,0]}
      ]}));
      const near=(actual,expected)=>assert(Math.abs(actual-expected)<0.001,'Surface height '+actual+' != '+expected);
      near(colliderSurfaceHeight(root,1,1,4),0.2);
      near(colliderSurfaceHeight(root,0,0,4),2.2);
      near(colliderSurfaceHeight(root,1,0,2),0.2);
      near(colliderSurfaceHeight(root,3,0,4),0);
      root.position.set(3,0.5,1);root.rotation.y=Math.PI/4;
      near(colliderSurfaceHeight(root,3,1,5),2.7);
      disposeColliderSurface(root);
      const {compoundColliderSpec}=await import('/shared/compound-collider.js');
      const bridge=createColliderSurface({type:'compound',shapes:[
        {type:'box',halfExtents:[0.2,0.5,1],offset:[-0.8,0.5,0]},
        {type:'box',halfExtents:[0.2,0.5,1],offset:[0.8,0.5,0]}]});
      near(colliderSurfaceHeight(bridge,0,0,4),0);
      near(colliderSurfaceHeight(bridge,0.8,0,4),1);
      disposeColliderSurface(bridge);
      const prism=createColliderSurface(compoundColliderSpec({version:1,shapes:[{type:'outline',
        outline:{type:'clipped',cut:0.3},position:[0,0.05,0],size:[1,0.1,1],rotation:[0,0,0]}]},[1,1,1]));
      near(colliderSurfaceHeight(prism,0,0,3),0.2);
      near(colliderSurfaceHeight(prism,0.95,0.95,3),0);
      disposeColliderSurface(prism);
      const {captureGroup,insertGroup,transformGroup}=await import('/collider-groups.js');
      const layout={version:1,shapes:[
        {type:'box',position:[-0.3,0,0],rotation:[0,0,0],size:[0.1,0.4,0.4]},
        {type:'box',position:[0.3,0,0],rotation:[0,0,0],size:[0.1,0.4,0.4]}]};
      const turned=transformGroup(layout,[0,1],{rotation:[0,Math.PI/2,0],scale:2});
      near(turned.shapes[0].position[2],0.6);near(turned.shapes[1].position[2],-0.6);
      near(turned.shapes[0].size[0],0.2);
      assert(!transformGroup(layout,[0,1],{scale:100}),'Out-of-range group accepted');
      const captured=captureGroup(layout.shapes,2);
      const inserted=insertGroup({version:1,shapes:[]},captured,captured.size,2);
      near(inserted.shapes[0].position[0],-0.3);near(inserted.shapes[1].position[0],0.3);
      inserted.shapes[0].position[0]=1;
      near(layout.shapes[0].position[0],-0.3);
      // Reopen a real 3D preview for visual QA; no uploaded file or server needed.
      const module=await import('/compound-collider-editor.js');
      window.previewResult=module.openColliderEditor({source:uploadTarget,box:board.box,value:board.compoundCollider});
      await wait(()=>modal()&&!button('apply').disabled);
      return {objectShapes:saved.compoundCollider.shapes.length,boardShapes:board.compoundCollider.shapes.length};
    })()`);
    assert.equal(result.objectShapes, 2);
    assert.equal(result.boardShapes, 2);
    assert.deepEqual(page.errors, []);
    await page.evaluate(`(async()=>{
      const dialog=document.querySelector('.compoundEditor');
      const action=name=>dialog.querySelector('[data-action="'+name+'"]');
      const field=name=>dialog.querySelector('[data-preset="'+name+'"]');
      const wait=async test=>{for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,20));}throw Error('Preset UI not ready: '+JSON.stringify({status:field('status').textContent,refresh:field('refresh').disabled,save:field('save').disabled,name:field('name').value,list:field('list').innerHTML,network:window.presetNetwork}));};
      action('select-all').click();
      if(dialog.querySelector('[data-field="list"]').selectedOptions.length!==2)throw Error('Select all failed');
      const move=dialog.querySelector('[aria-label="group position 0"]');move.value='0.2';move.dispatchEvent(new Event('input'));
      action('undo').click();action('select-all').click();
      dialog.querySelector('.compoundPresets').open=true;
      await wait(()=>window.presetNetwork?.length && !field('refresh').disabled);
      field('name').value='Hollow board';field('visibility').value='public';field('save').click();
      await wait(()=>field('status').textContent.includes('saved'));
      if(field('list').options.length!==2||field('visibility').value!=='public')throw Error('Preset save failed');
      field('insert').click();await wait(()=>field('status').textContent.includes('inserted'));
      if(dialog.querySelector('[data-field="list"]').options.length!==4||dialog.querySelector('[data-field="list"]').selectedOptions.length!==2)throw Error('Preset insert failed');
      action('undo').click();
      field('visibility').value='private';field('metadata').click();await wait(()=>field('status').textContent.includes('updated'));
      if(field('visibility').value!=='private')throw Error('Visibility update failed');
      dialog.querySelector('.compoundPresets').open=false;
      const list=dialog.querySelector('[data-field="list"]');list.value='0';list.dispatchEvent(new Event('change'));
      dialog.querySelector('aside').scrollTop=0;
    })()`);
    await page.evaluate(`(() => {
      const dialog=document.querySelector('.compoundEditor');
      dialog.querySelector('.compoundPresets').open=true;
      dialog.querySelector('aside').scrollTop=dialog.querySelector('.compoundPresets').offsetTop-dialog.querySelector('aside').offsetTop;
    })()`);
    const libraryShot = await cdp.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
    await writeFile(`/tmp/collider-library-${width}.png`, Buffer.from(libraryShot.data, 'base64'));
    await page.evaluate(`document.querySelector('.compoundEditor .compoundPresets').open=false`);
    const dragPoint = await page.evaluate(`(() => {
      const dialog=document.querySelector('.compoundEditor');
      dialog.querySelector('[data-view="top"]').click();
      dialog.querySelector('[data-drag-mode=move]').click();
      const rect=dialog.querySelector('canvas').getBoundingClientRect();
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    })()`);
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', ...dragPoint, button: 'left', clickCount: 1 },
      page.sessionId,
    );
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: dragPoint.x + 35, y: dragPoint.y, button: 'left', buttons: 1 },
      page.sessionId,
    );
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: dragPoint.x + 35, y: dragPoint.y, button: 'left', clickCount: 1 },
      page.sessionId,
    );
    const moved = await page.evaluate(
      `+document.querySelector('.compoundEditor [aria-label="position X"]').value`,
    );
    assert.ok(Math.abs(moved) > 0.01, `Dragging must move the selected shape at ${width}px`);
    await page.evaluate(
      `document.querySelector('.compoundEditor [data-view="perspective"]').click()`,
    );
    await page.evaluate(`(() => {
      const list=document.querySelector('.compoundEditor [data-field="list"]');
      list.value='1';list.dispatchEvent(new Event('change'));
    })()`);
    await page.evaluate(`(async () => {
      const dialog=document.querySelector('.compoundEditor');
      const aside=dialog.querySelector('aside');
      const canvas=dialog.querySelector('.compoundViewport');
      const before=canvas.getBoundingClientRect().top;
      aside.scrollTop=aside.scrollHeight;
      if(!aside.scrollTop)throw Error('Controls must scroll independently');
      if(canvas.getBoundingClientRect().top!==before||dialog.scrollTop!==0)throw Error('Controls scrolled the preview');
      aside.scrollTop=0;
      const details=dialog.querySelector('.compoundOutline');
      details.querySelector('summary').click();
      await new Promise(r=>setTimeout(r,30));
      if(details.open)throw Error('Outline did not collapse');
      dialog.querySelector('[data-action="duplicate"]').click();
      if(dialog.querySelector('.compoundOutline').open)throw Error('Collapse state lost on rebuild');
      dialog.querySelector('[data-action="delete"]').click();
      aside.scrollTop=0;
    })()`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
    await writeFile(`/tmp/compound-editor-${width}.png`, Buffer.from(screenshot.data, 'base64'));
    console.log(
      `PASS collider editor at ${width}px: object/board save, groups, preset save/insert/visibility, transforms, undo, cancel`,
    );
    await page.evaluate(`(() => {
      const dialog=document.querySelector('.compoundEditor');
      const add=dialog.querySelector('[data-add-shape="box"]');
      for(let i=0;i<20;i++) add.click();
      if(!add.disabled||dialog.querySelector('[data-field="list"]').options.length!==16)throw new Error('Shape limit failed');
      dialog.querySelector('[data-action="cancel"]').click();
    })()`);
    await page.close();
  }
} finally {
  if (cdp) await cdp.close();
  await server.close();
}
