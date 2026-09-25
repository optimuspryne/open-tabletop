// Real production material builders: image marble, independent coin tuning and owned cleanup.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const server = await serveDir({
  root: resolve('public'),
  mounts: { '/shared/': resolve('shared') },
  routes: {
    '/materials.html': {
      body: `<link rel="icon" href="data:,"><style>body{margin:0}</style><div id="app"></div><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>`,
    },
  },
});
let cdp;
try {
  cdp = await launch({ webgl: true });
  const page = await newPage(cdp, {
    url: `${server.origin}/materials.html?q=low`,
    width: 1100,
    height: 700,
    touch: true,
  });
  const result = await page.evaluate(`(async () => {
    const THREE = await import('three');
    const { KIND, diePreviewURL, propPreviewURL } = await import('/rendering/graphics.js');
    const { scene, camera, renderer, waitForVisualAssets } = await import('/rendering/core.js');
    const { PROPS, DICE_MODELS } = await import('/shared/pieces.js');
    const { disposeHierarchy } = await import('/rendering/resources.js');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const materials = root => {
      const out = [];
      root.traverse(n => { if (n.isMesh) out.push(...(Array.isArray(n.material) ? n.material : [n.material])); });
      return out;
    };
    // Cold-cache preview must wait for the source; disposed d6 faces must stay released.
    const pendingPreview = diePreviewURL(6, 'marbled');
    const removed = KIND.die.mesh({ sides: 6, finish: 'marbled' });
    const removedCanvases = materials(removed).map(m => m.map.image);
    KIND.die.dispose(removed);
    const preview = await pendingPreview;
    assert(preview?.startsWith('data:image/'), 'cold marble preview failed');
    assert(removedCanvases.every(c => c.width === 0), 'late marble redraw revived disposed canvas');
    const d6 = KIND.die.mesh({ sides: 6, finish: 'marbled', color: 0xf4f1ea, textColor: 0x141414 });
    const red = KIND.die.mesh({ sides: 20, finish: 'marbled', color: 0xb03030 });
    const blue = KIND.die.mesh({ sides: 4, finish: 'marbled', color: 0x315da8 });
    const pipped = KIND.die.mesh({ sides: 6, model: Object.keys(DICE_MODELS)[0], finish: 'marbled' });
    await waitForVisualAssets();
    const marbleMaps = [...materials(red), ...materials(blue), ...materials(pipped)].map(m => m.map).filter(t => t?.userData.ottSharedFinish);
    assert(marbleMaps.length >= 3 && new Set(marbleMaps).size === 1, 'marble duplicated across colors/models');
    assert(marbleMaps[0].image.width === 512, 'marble source was not bounded');
    assert(materials(red)[0].color.getHex() === 0xb03030, 'marble body tint lost');
    const face = materials(d6)[0].map.image;
    const pixels = face.getContext('2d').getImageData(0,0,face.width,face.height).data;
    const shades = new Set();
    for(let y=0; y<face.height; y+=4) for(let x=0; x<face.width*.2; x+=4) shades.add(pixels[(y*face.width+x)*4]);
    assert(shades.size > 15, 'd6 face has no marble detail outside its number');
    assert(!!(await propPreviewURL({shape:'coin',finish:'marbled'})), 'marbled model preview failed');
    // Deliberately tune coin values away from the shared metallic defaults.
    const tuning = PROPS.coin.finishTuning.metallic;
    const original = { ...tuning };
    tuning.metalness = .37; tuning.roughness = .07;
    const coin = KIND.prop.mesh({shape:'coin'});
    const stack = KIND.dispenser.mesh({disp:'coinStack',count:3});
    const matteCoin = KIND.prop.mesh({shape:'coin',finish:'matte'});
    const metalDice = [KIND.die.mesh({sides:6,finish:'metallic'}), KIND.die.mesh({sides:20,finish:'metallic'}), KIND.die.mesh({sides:6,model:Object.keys(DICE_MODELS)[0],finish:'metallic'})];
    await waitForVisualAssets();
    for(const root of [coin,stack]) {
      assert(materials(root).length > 0, 'coin/stack fixture did not load');
      assert(materials(root).every(m => m.metalness === .37 && m.roughness === .07), 'coin tuning did not reach standalone/stack materials');
    }
    assert(materials(matteCoin).every(m => m.metalness === 0), 'coin override overrode explicit matte finish');
    for(const root of metalDice) {
      const bodies = materials(root).filter(m=>m.isMeshStandardMaterial);
      assert(bodies.length > 0 && bodies.every(m=>m.metalness===.75 && m.roughness===.15), 'coin tuning leaked into dice');
    }
    Object.assign(tuning, original);
    const galleryCoin = KIND.prop.mesh({shape:'coin',color:0xd4af37});
    await waitForVisualAssets();
    for(const [i,root] of [d6,red,blue,pipped,galleryCoin].entries()) {
      root.position.set((i-2)*1.7,0,0);
      if(i!==4) root.rotation.set(.3,.35,.15);
      scene.add(root);
    }
    camera.fov=35; camera.updateProjectionMatrix();
    camera.position.set(0,4,7); camera.lookAt(0,0,0);
    renderer.domElement.style.visibility='visible'; renderer.render(scene,camera);
    // Repeated marble recolor must release canvases/GPU allocations just like other finishes.
    const baseline = {...renderer.info.memory};
    for(let i=0;i<24;i++) {
      const mesh=KIND.die.mesh({sides:i%2?20:6,finish:'marbled',color:0x552233+i*19});
      scene.add(mesh); renderer.render(scene,camera); scene.remove(mesh); KIND.die.dispose(mesh);
    }
    renderer.render(scene,camera);
    assert(renderer.info.memory.textures === baseline.textures && renderer.info.memory.geometries === baseline.geometries, 'marble recolor leaked resources');
    for(const root of [coin,matteCoin,...metalDice]) disposeHierarchy(root);
    // Stack clones borrow the cached prototype geometry; leave their lifetime to the page.
    return {sharedMarbleMaps:new Set(marbleMaps).size,marblePixels:marbleMaps[0].image.width,faceShades:shades.size,coinMetalness:.37,diceMetalness:.75,recolors:24};
  })().catch(error => ({ failure: error.stack }))`);
  assert.equal(result.failure, undefined, result.failure);
  assert.deepEqual(page.errors, []);
  assert.deepEqual(server.missing, []);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  await writeFile('/tmp/ott-material-preview.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify(result));
  await page.close();
} finally {
  await cdp?.close();
  server.close();
}
