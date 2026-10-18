import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createSkybox } from '../public/table/skybox.js';

function fixture({
  device = 'desktop',
  preference,
  blocked = false,
  failCanvas = false,
  saved = {},
} = {}) {
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
    setAttribute() {},
    classList: {
      toggle(key, on) {
        this.on = on;
      },
    },
  }));
  const controls = Object.fromEntries(
    ['skyTilt', 'skyTiltDegrees', 'skyRotation', 'skyRotationDegrees', 'skyOrientationStatus'].map(
      (id) => [id, { value: '', disabled: false, setAttribute() {} }],
    ),
  );
  const stored = new Map(Object.entries(saved));
  const sky = createSkybox({
    THREE: { ...THREE, TextureLoader, CubeTextureLoader },
    scene,
    renderer: { capabilities: { getMaxAnisotropy: () => 8 } },
    deviceClass: () => device,
    storage: {
      getItem: (key) => {
        if (blocked) throw Error('blocked');
        return key === 'tabletop.skyRes' ? preference : (stored.get(key) ?? null);
      },
      setItem: (k, v) => {
        if (blocked) throw Error('blocked');
        if (k === 'tabletop.skyRes') preference = v;
        else stored.set(k, v);
      },
    },
    byId: (id) => (id === 'skyResRow' ? { querySelectorAll: () => chips } : controls[id]),
    doc: {
      createElement: () => ({
        getContext: () => (failCanvas ? null : { drawImage: (...args) => draws.push(args) }),
      }),
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
    controls,
    stored,
    angle: (id, value, event = 'input') => {
      controls[id].value = value;
      controls[id]['on' + event]();
    },
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

test('Low sky requests small sources before decode, and released fallback canvases are zeroed', () => {
  const f = fixture({ preference: 'low' });
  f.sky.sync('/sky/equirect/noon.png');
  assert.match(f.loads[0].ref, /quality=sky-low$/);
  const small = texture(512, 256);
  f.loads[0].loaded(small);
  assert.equal(f.draws.length, 0);
  assert.equal(f.scene.background, small);
  const faces = Array(6).fill('/assets/sky/0123456789abcdefab.png');
  f.sky.sync(JSON.stringify({ t: 'cube', f: faces }));
  assert.ok(f.loads[1].ref.every((ref) => ref.endsWith('?quality=sky-low')));
  f.sky.sync('/legacy.jpg');
  f.loads[2].loaded(texture());
  const canvas = f.scene.background.image;
  f.sky.sync('');
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});

test('legacy sky resizing keeps usable original textures if canvas allocation is unavailable', () => {
  const f = fixture({ preference: 'low', failCanvas: true });
  f.sky.sync('/legacy.jpg');
  const source = texture();
  f.loads[0].loaded(source);
  assert.equal(f.scene.background, source);
  f.sky.sync(JSON.stringify({ t: 'cube', f: Array(6).fill('/legacy-face.jpg') }));
  const cube = new THREE.CubeTexture(
    Array.from({ length: 6 }, () => ({ width: 2048, height: 2048 })),
  );
  f.loads[1].loaded(cube);
  assert.equal(f.scene.background, cube);
  assert.ok(cube.image.every((face) => face.width === 2048));
});

test('angles apply live without reloading; native zero orientation and owned resources restore', () => {
  const f = fixture({ preference: 'ultra' });
  f.sky.sync('/sky');
  const source = texture();
  f.loads[0].loaded(source);
  f.angle('skyTilt', '-25');
  f.angle('skyRotationDegrees', '45');
  assert.equal(f.loads.length, 1);
  assert.equal(f.scene.background, f.fallback);
  const mesh = f.scene.children[0];
  assert.equal(f.controls.skyTiltDegrees.value, '-25');
  assert.equal(f.controls.skyRotation.value, '45');
  assert.equal(f.stored.get('tabletop.skyTilt'), '-25');
  assert.equal(mesh.material.uniforms.tEquirect.value, source);
  const inverse = new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-25), Math.PI / 4, 0, 'YXZ'))
    .invert();
  assert.deepEqual(
    mesh.material.uniforms.skyRotation.value.elements,
    new THREE.Matrix3().setFromMatrix4(inverse).elements,
  );
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(4, 8, -2);
  camera.updateMatrixWorld();
  mesh.onBeforeRender(null, null, camera);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld), camera.position);
  const hits = [];
  mesh.raycast(null, hits);
  assert.deepEqual(hits, []);
  f.angle('skyTiltDegrees', '0');
  f.angle('skyRotation', '0');
  assert.equal(f.scene.background, source);
  assert.equal(mesh.visible, false);
  let geometryDisposed = false,
    materialDisposed = false;
  mesh.geometry.addEventListener('dispose', () => (geometryDisposed = true));
  mesh.material.addEventListener('dispose', () => (materialDisposed = true));
  f.sky.sync('');
  assert.equal(f.scene.children.length, 0);
  assert.ok(geometryDisposed && materialDisposed);
  assert.equal(source.userData.disposed, 1);
});

test('saved angles normalize; numeric edits and blocked storage retain usable session settings', () => {
  const f = fixture({ saved: { 'tabletop.skyTilt': 'Infinity', 'tabletop.skyRotation': '300' } });
  assert.equal(f.controls.skyTilt.value, '0');
  assert.equal(f.controls.skyRotation.value, '180');
  f.angle('skyTiltDegrees', '-200');
  assert.equal(f.controls.skyTilt.value, '-90');
  f.angle('skyTiltDegrees', '', 'change');
  assert.equal(f.controls.skyTiltDegrees.value, '-90');
  f.angle('skyRotationDegrees', 'NaN', 'change');
  assert.equal(f.controls.skyRotationDegrees.value, '180');
  const blocked = fixture({ blocked: true });
  blocked.angle('skyTilt', '15');
  assert.equal(blocked.controls.skyTiltDegrees.value, '15');
  blocked.setResolution('off');
  assert.equal(blocked.controls.skyTilt.disabled, true);
  blocked.angle('skyTilt', '40');
  blocked.setResolution('high');
  assert.equal(blocked.controls.skyTilt.value, '15');
  assert.equal(blocked.controls.skyTilt.disabled, false);
});

test('latest angles apply to pending loads, cubemaps, replacements and Off/on', () => {
  const f = fixture({ preference: 'ultra', saved: { 'tabletop.skyTilt': '10' } });
  f.sky.sync('/sky');
  f.angle('skyRotation', '80');
  f.loads[0].loaded(texture());
  assert.equal(f.scene.children.length, 1);
  f.sky.sync(JSON.stringify({ t: 'cube', f: Array(6).fill('/face') }));
  const cube = new THREE.CubeTexture(Array(6).fill({ width: 512, height: 512 }));
  f.loads[1].loaded(cube);
  assert.equal(f.scene.children.length, 1);
  assert.equal(f.scene.children[0].material.uniforms.tCube.value, cube);
  assert.equal(f.scene.children[0].material.uniforms.tFlip.value, -1);
  f.setResolution('off');
  assert.equal(f.scene.children.length, 0);
  f.setResolution('ultra');
  f.loads[2].loaded(new THREE.CubeTexture(Array(6).fill({ width: 512, height: 512 })));
  assert.equal(f.scene.children.length, 1);
  assert.equal(f.controls.skyRotationDegrees.value, '80');
});
