// Exercise the real GLB loader and tile/deck material builders on desktop and phone.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const server = await serveDir({
  root: resolve('public'),
  mounts: { '/shared/': resolve('shared') },
  routes: {
    '/tile-skins.html': {
      body: `<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><div id="app"></div><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>`,
    },
  },
});
let cdp;
try {
  cdp = await launch({ webgl: true });
  for (const width of [1100, 390]) {
    const page = await newPage(cdp, {
      url: `${server.origin}/tile-skins.html?q=low`,
      width,
      height: 700,
      touch: width === 390,
    });
    const result = await page.evaluate(`(async () => {
      const { KIND } = await import('/rendering/graphics.js');
      const { disposeHierarchy } = await import('/rendering/resources.js');
      const { deviceClass, waitForVisualAssets, scene, camera, renderer } = await import('/rendering/core.js');
      const { DECK_MODELS, DOMINO_APPEARANCE, DICE_FINISH_FALLBACK } = await import('/shared/pieces.js');
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const materials = root => {
        const out = [];
        root.traverse(node => { if (node.isMesh) out.push(...[node.material].flat()); });
        return out;
      };
      const signature = m => JSON.stringify({
        name:m.name, color:m.color.getHex(), roughness:m.roughness, metalness:m.metalness,
        map:m.map?.image?.src, normal:m.normalMap?.image?.src,
        opacity:m.opacity, transparent:m.transparent,
      });
      const loadDeck = async props => {
        const root = KIND.deck.mesh(props);
        await waitForVisualAssets();
        assert(materials(root).length > 0, 'deck model did not load');
        return root;
      };
      const props = {model:'dominoes_box', tile:'domino', color:'#ff0000'};
      const baseline = await loadDeck(props);
      const interior = root => materials(root).find(m => m.name === 'dominoBase');
      const shell = root => materials(root).filter(m => m.name !== 'dominoBase').map(signature);
      assert(interior(baseline)?.color.getHex() === DOMINO_APPEARANCE.base, 'default interior did not follow tile defaults');
      const authoredShell = JSON.stringify(shell(baseline));
      const finishes = ['original','glossy','metallic','marbled','brushed','pearl','translucent','glow'];
      for (const finish of finishes) {
        const effectiveFinish = deviceClass() === 'phone' ? DICE_FINISH_FALLBACK[finish] || finish : finish;
        const appearance = {base:0, inset:0x123456, finish};
        const deck = await loadDeck({...props, dominoAppearance:appearance});
        const tile = KIND.card.mesh({tile:'domino', front:'domino:1:2', dominoAppearance:appearance});
        assert(await tile.userData.tileModelReady, 'tile model did not load');
        await waitForVisualAssets();
        const a = interior(deck), b = materials(tile).find(m => m.name === 'base');
        assert(a?.color.getHex() === 0 && b?.color.getHex() === 0, finish + ': black base did not reach box/tile');
        assert(JSON.stringify(shell(deck)) === authoredShell, finish + ': finish changed shell materials');
        if (finish !== 'original') {
          for (const key of ['roughness','metalness','opacity','transparent','clearcoat','transmission'])
            assert(a[key] === b[key], finish + ': box/tile mismatch for ' + key);
          if (effectiveFinish === 'marbled') assert(a.map === b.map && a.map?.userData.ottSharedFinish, 'marble maps differ');
          if (effectiveFinish === 'brushed') assert(a.roughnessMap === b.roughnessMap && a.roughnessMap, 'brushed maps differ');
        }
        scene.add(deck, tile); renderer.render(scene, camera); scene.remove(deck, tile);
        disposeHierarchy(deck); KIND.card.dispose(tile);
        assert(interior(baseline).color.getHex() === DOMINO_APPEARANCE.base, 'recolor modified another box');
      }
      const noFamily = await loadDeck({model:'dominoes_box', dominoAppearance:{base:0,finish:'glossy'}});
      assert(interior(noFamily).color.getHex() === interior(baseline).color.getHex(), 'unregistered family applied tile appearance');
      disposeHierarchy(noFamily);
      const pouch = await loadDeck({model:'bag',tile:'domino',color:'#123456',textColor:'#abcdef',dominoAppearance:{base:0,finish:'glossy'}});
      assert(materials(pouch).find(m => m.name === 'bag').color.getHex() === 0x123456, 'container tint changed');
      assert(materials(pouch).find(m => m.name === 'string').color.getHex() === 0xabcdef, 'drawstring tint changed');
      disposeHierarchy(pouch);
      const prior = DECK_MODELS.dominoes_box.tileTints;
      DECK_MODELS.dominoes_box.tileTints = {missingSlot:'base'};
      try {
        const unmatched = await loadDeck({...props,dominoAppearance:{base:0,finish:'marbled'}});
        assert(JSON.stringify(shell(unmatched)) === authoredShell, 'missing slot changed shell');
        assert(interior(unmatched).color.getHex() === interior(baseline).color.getHex(), 'missing slot changed interior');
        disposeHierarchy(unmatched);
      } finally { DECK_MODELS.dominoes_box.tileTints = prior; }
      disposeHierarchy(baseline);
      return {device:deviceClass(), finishes:finishes.length};
    })().catch(error => ({failure:error.stack}))`);
    assert.equal(result.failure, undefined, result.failure);
    assert.equal(result.device, width === 390 ? 'phone' : 'desktop');
    assert.deepEqual(page.errors, []);
    console.log(JSON.stringify(result));
    await page.close();
  }
  assert.deepEqual(server.missing, []);
} finally {
  await cdp?.close();
  server.close();
}
