// Exercise production dice builders and lifecycle in a real WebGL browser.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const server = await serveDir({
  root: resolve('public'),
  mounts: { '/shared/': resolve('shared') },
  routes: {
    '/memory.html': {
      body: `<div id="app"></div><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>`,
    },
  },
});
let cdp;
try {
  cdp = await launch({ webgl: true });
  for (const quality of ['low', 'medium', 'high']) {
    const page = await newPage(cdp, {
      url: `${server.origin}/memory.html?q=${quality}`,
      width: 1024,
      height: 768,
      touch: true,
    });
    const result = await page.evaluate(`(async () => {
      const THREE = await import('three');
      const { KIND, diePreviewURL } = await import('/rendering/graphics.js');
      const { CONFIG, renderer, camera, waitForVisualAssets } = await import('/rendering/core.js');
      const { createPieceView } = await import('/table/piece-view.js');
      await waitForVisualAssets();
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight());
      camera.position.set(0, 6, 9);
      camera.lookAt(0, 0, 0);
      const meshes = new Map(), buffers = new Map();
      const view = createPieceView({ scene, meshes, buffers, kinds: KIND, physics: { die: { mass: 1 } },
        createQuaternion: () => new THREE.Quaternion(), refreshCollider() {}, isInspected: () => false });
      const must = (condition, message) => { if (!condition) throw new Error(message); };
      for (const sides of [4, 6, 8, 10, 12, 20]) {
        must(!!diePreviewURL(sides), 'preview failed: ' + sides);
        const mesh = KIND.die.mesh({ sides });
        scene.add(mesh);
        renderer.render(scene, camera);
        scene.remove(mesh);
        KIND.die.dispose(mesh);
      }
      renderer.render(scene, camera);
      const baseline = { ...renderer.info.memory };
      let maxTextures = 0;
      const glyphs = new Map();
      for (let pass = 0; pass < 30; pass++) {
        for (let i = 0; i < 6; i++) {
          const props = { sides: i % 2 ? 20 : 6, color: 0x334455 + pass * 31, textColor: pass % 2 ? 0xffffff : 0x141414 };
          if (!meshes.has(i)) {
            const mesh = KIND.die.mesh(props);
            scene.add(mesh);
            meshes.set(i, { mesh, type: 'die' });
          } else {
            const previous = meshes.get(i).mesh;
            const images = [];
            previous.traverse(n => {
              for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : [])
                if (m.map?.isCanvasTexture && !m.map.userData.ottSharedTexture) images.push(m.map.image);
            });
            view.rebuildPiece(i, { type: 'die', props: JSON.stringify(props) });
            must(images.every(image => image.width === 0 && image.height === 0), 'old face canvas retained');
          }
          const mesh = meshes.get(i).mesh;
          mesh.position.x = (i - 2.5) * 1.2;
          mesh.traverse(n => {
            if (n.material?.map?.userData?.ottSharedTexture && n.material.isMeshBasicMaterial) {
              const map = n.material.map;
              glyphs.set(map.uuid, map);
              must(n.material.color.getHex() === props.textColor, 'ink tint changed');
            }
          });
        }
        renderer.render(scene, camera);
        maxTextures = Math.max(maxTextures, renderer.info.memory.textures);
      }
      must(glyphs.size === 20, 'number textures duplicated per color/die');
      const live = { ...renderer.info.memory };
      for (const { mesh } of meshes.values()) { scene.remove(mesh); KIND.die.dispose(mesh); }
      renderer.render(scene, camera);
      const after = { ...renderer.info.memory };
      must(after.geometries === baseline.geometries, 'geometries leaked');
      must(after.textures === baseline.textures, 'textures leaked');
      // A model removed before its asynchronous load completes must not reappear.
      const { DICE_MODELS } = await import('/shared/pieces.js');
      const modelProps = { sides: 6, model: Object.keys(DICE_MODELS)[0] };
      const model = KIND.die.mesh(modelProps);
      const liveModel = KIND.die.mesh(modelProps);
      KIND.die.dispose(model);
      await waitForVisualAssets();
      must(model.children.length === 0, 'late model attached after disposal');
      must(liveModel.children.length > 0, 'model fixture did not load');
      KIND.die.dispose(liveModel);
      return { quality: '${quality}', faceSize: CONFIG.tex.die, baseline, live, after, maxTextures, recolors: 174 };
    })()`);
    assert.equal(result.faceSize, quality === 'high' ? 512 : 256);
    assert.deepEqual(page.errors, []);
    console.log(JSON.stringify(result));
    await page.close();
  }
} finally {
  await cdp?.close();
  server.close();
}
