import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from '../public/vendor/three/three.module.js';
import { createPieceView } from '../public/table/piece-view.js';

// Run the production frame loop with its feature adapters stubbed. The fixture records
// shadow requests as the renderer consumes them, without copying the cache algorithm.
const client = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
const frameSource = client.slice(
  client.indexOf('const effects = createTableEffects('),
  client.indexOf("\naddEventListener('resize'"),
);

function pieceMesh() {
  const root = new THREE.Group();
  const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  child.castShadow = true;
  root.add(child);
  return root;
}

function fixture({ scenery = false } = {}) {
  const meshes = new Map([['piece', { mesh: pieceMesh() }]]);
  const shadows = [];
  const order = [];
  const camera = new THREE.PerspectiveCamera();
  const renderer = {
    shadowMap: { needsUpdate: false },
    render() {
      order.push('render');
      shadows.push(this.shadowMap.needsUpdate);
      this.shadowMap.needsUpdate = false;
    },
  };
  let nextFrame;
  const pieceView = {
    updateVisibility() {},
  };
  const buffers = new Map();
  const { sample } = createPieceView({ createQuaternion: () => new THREE.Quaternion() });
  runInNewContext(frameSource, {
    THREE,
    CONFIG: {},
    scene: new THREE.Scene(),
    camera,
    roomEnvironment: scenery
      ? {
          update(position, target) {
            assert.equal(position, camera.position);
            assert.ok(target.isVector3);
            order.push('cutaway');
          },
        }
      : null,
    renderer,
    meshes,
    buffers,
    sample,
    ray: {},
    pointer: {},
    room: null,
    mySession: '',
    boardTopY: 0,
    nameTag() {},
    disposeSprite() {},
    playSfx() {},
    createTableEffects: () => ({ applyAnim() {}, updatePings() {}, updateDropMarker() {} }),
    colliderDebug: { update() {} },
    overlays: { syncSurface() {} },
    fog: { sync() {} },
    fogAuras: { update() {} },
    presence: { update() {} },
    pieceUi: { update() {}, updateHoldControls() {} },
    pieceView,
    pieceLabels: { update() {} },
    pieceDrag: { current() {} },
    selection: { update() {} },
    trays: { updateCamera: () => false },
    controls: {
      target: new THREE.Vector3(),
      update() {
        order.push('camera');
      },
    },
    leanOffset: new THREE.Vector3(),
    leanT: 0,
    leanActive: false,
    LEAN_AMOUNT: 0.2,
    DELAY: 0,
    performance: { now: () => 100 },
    perf: { frame() {} },
    requestAnimationFrame: (callback) => (nextFrame = callback),
  });
  return { meshes, shadows, order, camera, renderer, pieceView, buffers, frame: () => nextFrame() };
}

test('room cutaways sample the final camera before rendering, without changing default frame order', () => {
  const f = fixture({ scenery: true });
  assert.deepEqual(f.order, ['camera', 'cutaway', 'render']);
  f.order.length = 0;
  f.frame();
  assert.deepEqual(f.order, ['camera', 'cutaway', 'render']);
  assert.deepEqual(fixture().order, ['camera', 'render']);
});

test('stationary frames reuse shadows while camera orbit and explicit refreshes still work', () => {
  const f = fixture();
  f.frame();
  f.camera.position.set(3, 4, 5);
  f.frame();
  assert.deepEqual(f.shadows, [true, false, false]);
  f.renderer.shadowMap.needsUpdate = true;
  f.frame();
  f.frame();
  assert.deepEqual(f.shadows.slice(-2), [true, false]);
});

test('buffered movement, rotation and scale each refresh shadows once', () => {
  const f = fixture();
  const mesh = f.meshes.get('piece').mesh;
  f.buffers.set('piece', [{ t: 100, x: 2, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }]);
  f.frame();
  f.frame();
  assert.equal(mesh.position.x, 2);
  f.buffers.clear();
  mesh.rotation.y = 0.4;
  f.frame();
  f.frame();
  mesh.scale.y = 2;
  f.frame();
  f.frame();
  assert.deepEqual(f.shadows, [true, true, false, true, false, true, false]);
});

test('opposing piece movements do not cancel shadow invalidation', () => {
  const f = fixture();
  f.meshes.set('second', { mesh: pieceMesh() });
  f.frame();
  f.meshes.get('piece').mesh.position.x += 1;
  f.meshes.get('second').mesh.position.x -= 1;
  f.frame();
  f.frame();
  assert.deepEqual(f.shadows.slice(-2), [true, false]);
});

test('adding, removing and replacing pieces or late-loaded geometry refreshes shadows', () => {
  const f = fixture();
  const assertRefresh = () => {
    f.frame();
    f.frame();
    assert.deepEqual(f.shadows.slice(-2), [true, false]);
  };
  f.meshes.set('second', { mesh: pieceMesh() });
  assertRefresh();
  f.meshes.delete('second');
  assertRefresh();
  const mesh = pieceMesh();
  f.meshes.set('piece', { mesh });
  assertRefresh();
  mesh.children[0].geometry = new THREE.SphereGeometry();
  assertRefresh();
  const child = pieceMesh().children[0];
  mesh.remove(mesh.children[0]);
  mesh.add(child);
  assertRefresh();
  child.position.y = 0.5;
  assertRefresh();
  mesh.add(pieceMesh());
  assertRefresh();
});

test('visibility and casting changes are sampled after the visibility controller runs', () => {
  const f = fixture();
  const mesh = f.meshes.get('piece').mesh;
  f.pieceView.updateVisibility = () => {
    mesh.children[0].castShadow = false;
  };
  f.frame();
  f.frame();
  assert.deepEqual(f.shadows.slice(-2), [true, false]);
  mesh.visible = false;
  f.frame();
  f.frame();
  assert.deepEqual(f.shadows.slice(-2), [true, false]);
  f.pieceView.updateVisibility = () => {
    mesh.children[0].castShadow = true;
  };
  mesh.visible = true;
  f.frame();
  f.frame();
  assert.deepEqual(f.shadows.slice(-2), [true, false]);
});
