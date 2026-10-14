import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { serveDir, launch, newPage } from './lib/headless.mjs';

// Exercise the production graphics, hand DOM and seat fan together, including GPU
// snapshots. Unit tests separately assert the public projection and wire privacy.
const server = await serveDir({
  root: resolve('public'),
  mounts: { '/shared/': resolve('shared') },
  stubOnly: ['/client.js', '/editor/editor-panel.js'],
});
const browser = await launch({ webgl: true });
try {
  for (const device of [
    { width: 1280, height: 900 },
    { width: 390, height: 844, touch: true },
    { width: 320, height: 780, touch: true },
  ]) {
    const page = await newPage(browser, { url: server.origin + '/table.html', ...device });
    const result = await page.evaluate(`(async () => {
      const THREE = await import('three');
      const graphics = await import('/rendering/graphics.js');
      const core = await import('/rendering/core.js');
      document.getElementById('tableLoading').remove(); // the client hydration driver is stubbed
      const { createHand } = await import('/table/hand.js');
      const { createPresence } = await import('/table/presence.js');
      const { handFanGroups } = await import('/shared/hand-fan.js');
      const { seatAngle } = await import('/shared/pieces.js');
      const { applyIcons, setIcon } = await import('/ui/icons.js');
      const art = document.createElement('canvas'); art.width=256;art.height=256;
      const ctx=art.getContext('2d');ctx.fillStyle='#e6dfc5';ctx.fillRect(0,0,256,256);
      ctx.strokeStyle='#185e83';ctx.lineWidth=12;ctx.strokeRect(12,12,232,232);
      ctx.fillStyle='#141414';ctx.font='bold 64px sans-serif';ctx.textAlign='center';ctx.fillText('TILE',128,145);
      const front=art.toDataURL('image/png');
      const cards=[
        {hid:'d',tile:'domino',front:'domino:2:5',back:'domback'},
        {hid:'m',tile:'mahjong',front:'/mahjong/faces/bam1.png',back:'mjback'},
        {hid:'s',open:true,front,back:'text:#141414:#b9b198:#b9b198:PRIVATE_BACK',geom:{w:.35,h:.35,t:.06,round:.05}},
        {hid:'h',open:true,front,back:'text:#141414:#b9b198:#b9b198:PRIVATE_BACK',geom:{w:.35,h:.405,t:.06,shape:'hex'}},
        {hid:'wide',open:true,front,back:'text:#141414:#b9b198:#b9b198:PRIVATE_BACK',geom:{w:1,h:.35,t:.06,round:.05}},
      ];
      const live=graphics.cardMesh(cards[2]);
      const liveMap=live.material[0].map;let liveDisposed=false;
      liveMap.addEventListener('dispose',()=>{liveDisposed=true;});
      const previews=await Promise.all(cards.map(card=>graphics.tilePreviewURL(card,{tilt:12})));
      const borrowedTextureSurvives=!liveDisposed;
      graphics.KIND.card.dispose(live);
      const margins=await Promise.all(previews.map(async url=>{
        if(!url)return false;
        const image=new Image();image.src=url;await image.decode();
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        const x=c.getContext('2d');x.drawImage(image,0,0);const p=x.getImageData(0,0,c.width,c.height).data;
        let inside=0,border=0;for(let y=0;y<c.height;y++)for(let xx=0;xx<c.width;xx++){
          const alpha=p[(y*c.width+xx)*4+3];if(alpha>0)inside++;
          if(xx===0||y===0||xx===c.width-1||y===c.height-1)border+=alpha;
        }
        return inside>0 && border===0;
      }));
      const cached=await graphics.tilePreviewURL(cards[0],{tilt:12});
      const faceOn=await graphics.tilePreviewURL(cards[0]);
      const reveals=new Map(),messages=new Map(),calls=[];
      const player={seat:0,order:0,hand:cards.length,name:'Me',avatar:'',color:'#123456',handBack:'domback',handFan:JSON.stringify(handFanGroups(cards))};
      const room={state:{players:new Map([['me',player]]),tableX:10,tableZ:7},send(){},onMessage:(type,fn)=>messages.set(type,fn)};
      const presence=createPresence({THREE,scene:core.scene,camera:core.camera,controls:core.controls,
        cardMesh:props=>{calls.push(props);return graphics.cardMesh(props);},disposeCard:graphics.KIND.card.dispose,
        makePlayerTexture:graphics.makePlayerTexture,makeYouChipTexture:graphics.makeYouChipTexture,
        nameTag:graphics.nameTag,resizeToCanvas:graphics.resizeToCanvas,seatAngle,label:core.CONFIG.label,
        getRoom:()=>room,getSessionId:()=> 'me',getRank:()=>0,getRevealed:sid=>reveals.get(sid)||[],
        setRevealed:(sid,data)=>reveals.set(sid,data),getPieceVisual:()=>null,byId:()=>null,doc:{}});
      presence.rebuildSeats();await core.waitForVisualAssets();
      const fan=core.scene.children.find(node=>node.isGroup&&node.children.some(child=>child.userData.tileModel));
      const hiddenSafe=calls.every(props=>!props.front&&!props.back?.includes('PRIVATE')&&!JSON.stringify(props).includes(front));
      const models=fan.children.filter(child=>child.userData.tileModel).length;
      const covers=fan.children.filter(child=>!child.userData.tileModel).every(child=>{
        const materials=Array.isArray(child.material)?child.material:[child.material];return materials.every(material=>!material.map);
      });
      const geometryFits=fan.children.every((child,i)=>{
        if(!i)return true;
        const previous=new THREE.Box3().setFromObject(fan.children[i-1]);
        const next=new THREE.Box3().setFromObject(child);return previous.max.x<next.min.x;
      });
      const hand=createHand({scene:core.scene,camera:core.camera,renderer:core.renderer,cardMesh:graphics.cardMesh,
        tilePreviewURL:graphics.tilePreviewURL,parseCardFront:graphics.parseCardFront,cardPreviewURL:graphics.cardPreviewURL,
        applyIcons,setIcon,getRoom:()=>room,getSessionId:()=> 'me',byId:id=>document.getElementById(id),
        inspectMesh(){},syncControlGuide(){},toast(){},dragThreshold:5});
      hand.setCards(cards);document.getElementById('handRow').classList.add('trayOpen');await core.waitForVisualAssets();await new Promise(resolve=>requestAnimationFrame(resolve));
      const styles=[...document.querySelectorAll('#hand .handcard')].map(el=>{
        const s=getComputedStyle(el);return {contain:s.backgroundSize==='contain',unclipped:s.clipPath==='none',thumbnail:el.style.backgroundImage.includes('data:image'),width:el.getBoundingClientRect().width,named:!!el.getAttribute('aria-label')&&el.querySelector('.cardEye').getAttribute('aria-label')!=='Inspect card'};
      });
      const lifted=document.querySelector('#hand .tilePreview');lifted.style.transition='none';lifted.classList.add('sel');
      const selectionFits=lifted.getBoundingClientRect().top>=lifted.parentElement.getBoundingClientRect().top;
      lifted.classList.remove('sel');lifted.style.removeProperty('transition');
      const strip=lifted.parentElement;strip.scrollLeft=strip.scrollWidth;
      const end=strip.lastElementChild.getBoundingClientRect(),viewport=strip.getBoundingClientRect();
      const lastTileFits=end.left>=viewport.left-1&&end.right<=viewport.right+1;
      strip.scrollLeft=0;
      presence.bindMessages(room);calls.length=0;messages.get('showFan')({sid:'me',cards:[cards[0]]});await core.waitForVisualAssets();
      const restrictedShow=calls[0].front===cards[0].front&&calls.slice(1).every(props=>!props.front);
      core.camera.position.set(1,3,10.5);core.camera.lookAt(0,.25,6.2);core.setTableVisible(true);core.setSeatCameraReady();core.renderer.render(core.scene,core.camera);
      window.tileSmoke={hand,graphics,cards};
      return {margins,cached:cached===previews[0],tiltDiffers:faceOn!==previews[0],hiddenSafe,models,covers,geometryFits,restrictedShow,borrowedTextureSurvives,selectionFits,lastTileFits,styles,
        handFits:document.getElementById('handRow').getBoundingClientRect().right<=innerWidth+1};
    })()`);
    assert.deepEqual(page.errors, []);
    assert.ok(result.margins.every(Boolean), 'all angled silhouettes fit inside the image');
    for (const key of [
      'cached',
      'tiltDiffers',
      'hiddenSafe',
      'covers',
      'geometryFits',
      'restrictedShow',
      'borrowedTextureSurvives',
      'selectionFits',
      'lastTileFits',
      'handFits',
    ])
      assert.equal(result[key], true, `${key} at ${device.width}px`);
    assert.equal(result.models, 2, 'concealed Dominoes/Mahjong use authored models');
    assert.ok(
      result.styles.every(
        (style) =>
          style.contain && style.unclipped && style.thumbnail && style.width > 0 && style.named,
      ),
      JSON.stringify({ width: device.width, styles: result.styles }),
    );
    for (const full of [true, false]) {
      const fits = await page.evaluate(`(() => {
        document.body.classList.toggle('ui-full', ${full});
        document.body.classList.toggle('ui-compact', ${!full});
        return [...document.querySelectorAll('#hand .tilePreview')].every(el=>{
          const style=getComputedStyle(el),box=el.getBoundingClientRect();
          return style.backgroundSize==='contain'&&style.clipPath==='none'&&box.width>0&&box.height>0;
        });
      })()`);
      assert.equal(
        fits,
        true,
        `complete tile images in ${full ? 'full' : 'compact'} at ${device.width}px`,
      );
    }
    const screenshot = await browser.send(
      'Page.captureScreenshot',
      { format: 'png' },
      page.sessionId,
    );
    await writeFile(`/tmp/tile-hand-${device.width}.png`, Buffer.from(screenshot.data, 'base64'));
    console.log(`Tile previews, concealed fans and restricted Show pass at ${device.width}px.`);
    await page.close();
  }
  assert.ok(
    !server.missing.some((path) => path.includes('PRIVATE')),
    'hidden double-sided artwork is never requested',
  );
} finally {
  await browser.close();
  server.close();
}
