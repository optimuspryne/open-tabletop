import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { disposeHierarchy, releaseCanvasOnDispose } from '../public/rendering/resources.js';

test('owned GPU resources and canvas storage are freed once while shared maps survive', () => {
  const canvas = { width: 256, height: 256 };
  const owned = releaseCanvasOnDispose(new THREE.CanvasTexture(canvas), canvas);
  const shared = new THREE.Texture();
  shared.userData.ottSharedTexture = true;
  const finish = new THREE.Texture();
  finish.userData.ottSharedFinish = true;
  const material = new THREE.MeshStandardMaterial({
    map: owned,
    emissiveMap: owned,
    roughnessMap: finish,
  });
  const label = new THREE.MeshBasicMaterial({ map: shared });
  const geometry = new THREE.BoxGeometry();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, [material, label]), new THREE.Mesh(geometry, material));
  const calls = new Map();
  for (const resource of [owned, shared, finish, material, label, geometry])
    resource.addEventListener('dispose', () => calls.set(resource, (calls.get(resource) || 0) + 1));
  disposeHierarchy(root);
  disposeHierarchy(root);
  assert.deepEqual(canvas, { width: 0, height: 0 });
  for (const resource of [owned, material, label, geometry]) assert.equal(calls.get(resource), 1);
  assert.equal(calls.has(shared), false);
  assert.equal(calls.has(finish), false);
  assert.equal(root.userData.ottDisposed, true);
});
