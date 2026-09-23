import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createSkybox } from '../public/table/skybox.js';

function fixture({ device = 'desktop', preference, blocked = false } = {}) {
  const scene = new THREE.Scene();
  const fallback = (scene.background = new THREE.Color('#123456'));
  const loads = [],
    draws = [];
  class TextureLoader {
    load(ref, loaded, progress, failed) {
      loads.push({ ref, loaded, failed });
    }
  }
  class CubeTextureLoader extends TextureLoader {}
  const chips = ['off', 'low', 'medium', 'high', 'ultra'].map((skyres) => ({
    dataset: { skyres },
    classList: {
      toggle(key, on) {
        this.on = on;
      },
    },
  }));
  const sky = createSkybox({
    THREE: { ...THREE, TextureLoader, CubeTextureLoader },
    scene,
    renderer: { capabilities: { getMaxAnisotropy: () => 8 } },
    deviceClass: () => device,
    storage: {
      getItem: () => {
        if (blocked) throw Error('blocked');
        return preference;
      },
      setItem: (k, v) => {
        preference = v;
      },
    },
    byId: () => ({ querySelectorAll: () => chips }),
    doc: {
      createElement: () => ({ getContext: () => ({ drawImage: (...args) => draws.push(args) }) }),
    },
  });
  sky.bindControls();
  return {
    sky,
    scene,
    fallback,
    loads,
    draws,
    chips,
    setResolution: (value) => chips.find((chip) => chip.dataset.skyres === value).onclick(),
  };
}
function texture(width = 4096, height = 2048) {
  const t = new THREE.Texture({ width, height });
  t.userData.disposed = 0;
  t.addEventListener('dispose', () => t.userData.disposed++);
  return t;
}

test('device resolution defaults cap equirects and configure mapping/color/anisotropy', () => {
  for (const [device, cap] of [
    ['phone', 512],
    ['tablet', 1024],
    ['desktop', 2048],
  ]) {
    const f = fixture({ device, blocked: true });
    f.sky.sync('/sky.jpg');
    const source = texture();
    f.loads[0].loaded(source);
    assert.equal(f.scene.background.image.width, cap);
    assert.equal(f.scene.background.image.height, cap / 2);
    assert.equal(f.scene.background.mapping, THREE.EquirectangularReflectionMapping);
    assert.equal(f.scene.background.colorSpace, THREE.SRGBColorSpace);
    assert.equal(f.scene.background.anisotropy, 8);
    assert.equal(source.userData.disposed, 1);
    assert.equal(f.draws.length, 1);
    f.sky.sync('/sky.jpg');
    assert.equal(f.loads.length, 1);
  }
});

test('uncapped textures are reused and replacing/removing a background disposes the old texture', () => {
  const f = fixture({ preference: 'ultra' });
  const a = texture(),
    b = texture();
  f.sky.sync('/a');
  f.loads[0].loaded(a);
  assert.equal(f.scene.background, a);
  f.sky.sync('/b');
  f.loads[1].loaded(b);
  assert.equal(a.userData.disposed, 1);
  f.sky.sync('');
  assert.equal(b.userData.disposed, 1);
  assert.equal(f.scene.background, f.fallback);
});

test('cubemaps downscale six faces and invalid descriptors reset to the flat background', () => {
  const f = fixture({ preference: 'low' });
  const faces = Array.from({ length: 6 }, (_, i) => '/face' + i);
  f.sky.sync(JSON.stringify({ t: 'cube', f: faces }));
  assert.deepEqual(f.loads[0].ref, faces);
  const source = new THREE.CubeTexture(faces.map(() => ({ width: 2048, height: 2048 })));
  let disposed = false;
  source.addEventListener('dispose', () => (disposed = true));
  f.loads[0].loaded(source);
  assert.equal(disposed, true);
  assert.equal(f.draws.length, 6);
  assert.ok(f.scene.background.image.every((face) => face.width === 512 && face.height === 512));
  assert.equal(f.scene.background.colorSpace, THREE.SRGBColorSpace);
  f.sky.sync('{broken');
  assert.equal(f.scene.background, f.fallback);
  f.sky.sync('{"t":"cube","f":[]}');
  assert.equal(f.loads.length, 1);
});

test('stale URL completions and failures cannot replace the latest skybox', () => {
  const f = fixture({ preference: 'ultra' });
  f.sky.sync('/a');
  f.sky.sync('/b');
  const current = texture(),
    stale = texture();
  f.loads[1].loaded(current);
  f.loads[0].loaded(stale);
  f.loads[0].failed();
  assert.equal(f.scene.background, current);
  assert.equal(stale.userData.disposed, 1);
  f.loads[1].failed();
  assert.equal(f.scene.background, f.fallback);
});

test('turning the sky off while it loads keeps the flat background when the old load finishes', () => {
  const f = fixture({ preference: 'ultra' });
  f.sky.sync('/a');
  f.setResolution('off');
  const stale = texture();
  f.loads[0].loaded(stale);
  assert.equal(f.scene.background, f.fallback);
  assert.equal(stale.userData.disposed, 1);
});

test('same-ref resolution changes and A-B-A replacements reject earlier requests', () => {
  const f = fixture({ preference: 'ultra' });
  f.sky.sync('/a');
  f.setResolution('low');
  const low = texture(),
    stale = texture();
  f.loads[1].loaded(low);
  const current = f.scene.background;
  f.loads[0].loaded(stale);
  f.loads[0].failed();
  assert.equal(f.scene.background, current);
  assert.equal(stale.userData.disposed, 1);
  f.sky.sync('/b');
  f.sky.sync('/a');
  const latest = texture(400, 200);
  f.loads[3].loaded(latest);
  f.loads[1].failed();
  assert.equal(f.scene.background, latest);
});
