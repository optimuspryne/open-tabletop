import {
  createColliderSurface,
  disposeColliderSurface,
  colliderSurfaceHeight,
} from '../rendering/collider-surface.js';
import { colliderSpec } from '../../shared/collider-spec.js';
import { meshPropsOf } from './piece-view.js';
// Transient table visuals and their lifetimes; the root retains the frame and binding order.
export function createTableEffects({
  THREE,
  config: CONFIG,
  scene,
  camera,
  ray,
  pointer,
  meshes,
  getRoom,
  getSessionId,
  getBoardTopY,
  nameTag,
  disposeSprite,
  playSfx,
  clock = () => performance.now(),
}) {
  // Attention pings: a translucent ring pulses out on the table with the pinger's
  // name. Triggered by middle-click or P (see the handlers), broadcast to everyone,
  // and animated + expired by the render loop.
  const pings = []; // { ring, label, start }
  function sendPing() {
    // raycast the cursor onto the table and ask the server to broadcast
    if (!getRoom()) return;
    ray.setFromCamera(pointer, camera);
    const spot = new THREE.Vector3();
    if (
      ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -getBoardTopY()), spot)
    ) {
      getRoom().send('ping', { x: spot.x, z: spot.z });
    }
  }
  function bindPings(room) {
    room.onMessage('ping', ({ sid, x, z }) => spawnPing(sid, x, z)); // someone's "look here" marker
  }

  function bindTableEffects(room) {
    room.onMessage('shuffled', ({ id }) => {
      startAnim(id, 'shuffle');
      playSfx('shuffle');
    }); // everyone sees + hears the riffle
    room.onMessage('sfx', ({ type } = {}) => playSfx(type)); // shared cue (roll/flip/deal) broadcast by the server
  }

  function spawnPing(sid, x, z) {
    const player = getRoom().state.players.get(sid);
    const color = player ? player.color : '#ffffff';
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CONFIG.ping.inner, CONFIG.ping.outer, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, getBoardTopY() + CONFIG.ping.lift, z);
    ring.renderOrder = 5;
    scene.add(ring);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nameTag(player ? player.name : '', color),
        transparent: true,
        depthTest: false,
      }),
    );
    label.scale.set(CONFIG.label.w, CONFIG.label.h, 1);
    label.position.set(x, getBoardTopY() + 0.6, z);
    label.renderOrder = 6;
    scene.add(label);
    pings.push({ ring, label, start: clock() });
  }

  const boardDropSurfaces = new Map();
  function boardDropHeight(x, z, fromY) {
    let height = 0;
    for (const [id, entry] of meshes) {
      if (entry.type !== 'board' || !entry.mesh.visible) continue;
      const piece = getRoom()?.state.pieces.get(id);
      if (!piece) continue;
      let cached = boardDropSurfaces.get(id);
      if (!cached || cached.props !== piece.props) {
        if (cached) disposeColliderSurface(cached.root);
        const spec = colliderSpec('board', meshPropsOf(piece, id));
        if (!spec) {
          boardDropSurfaces.delete(id);
          continue;
        }
        const root = new THREE.Group();
        root.add(createColliderSurface(spec));
        cached = { root, props: piece.props };
        boardDropSurfaces.set(id, cached);
      }
      cached.root.position.copy(entry.mesh.position);
      cached.root.quaternion.copy(entry.mesh.quaternion);
      height = Math.max(height, colliderSurfaceHeight(cached.root, x, z, fromY));
    }
    return height;
  }
  // ===== Cosmetic animation layer =============================================
  // Purely visual, event-driven flourishes (e.g. a deck riffle on shuffle). They
  // add a decaying offset ON TOP of the interpolated server transform — never touch
  // physics — using only rotation/position, which sample() resets each frame (so no
  // drift accumulates). Add a new one: a CONFIG.anim entry + a branch in applyAnim.
  const anims = new Map(); // id -> { kind, start }
  function startAnim(id, kind) {
    if (CONFIG.anim[kind]) anims.set(id, { kind, start: clock() });
  }
  function applyAnim(id, mesh) {
    const anim = anims.get(id);
    if (!anim) return;
    const cfg = CONFIG.anim[anim.kind];
    const progress = (clock() - anim.start) / cfg.dur;
    if (progress >= 1) {
      anims.delete(id);
      return;
    }
    if (anim.kind === 'shuffle') {
      // riffle: a fast fading side-to-side wiggle + a little lift-and-settle
      mesh.rotateY(Math.sin(progress * Math.PI * cfg.cycles) * cfg.yaw * (1 - progress));
      mesh.position.y += Math.sin(progress * Math.PI) * cfg.bob;
    }
  }

  // "If dropped" marker: a flat ring on the table under whatever you're holding,
  // showing where it would land if released now (straight down).
  const dropMarker = new THREE.Mesh(
    new THREE.RingGeometry(CONFIG.marker.inner, CONFIG.marker.outer, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: CONFIG.marker.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  dropMarker.rotation.x = -Math.PI / 2;
  dropMarker.renderOrder = 3;
  dropMarker.visible = false;
  scene.add(dropMarker);
  const _dropBox = new THREE.Box3(),
    _dropSize = new THREE.Vector3(); // reused each frame to size the ring to the held piece

  function updatePings() {
    for (let i = pings.length - 1; i >= 0; i--) {
      // expand + fade each active ping, then dispose
      const p = pings[i],
        t = (clock() - p.start) / CONFIG.ping.dur;
      if (t >= 1) {
        scene.remove(p.ring);
        p.ring.geometry.dispose();
        p.ring.material.dispose();
        disposeSprite(p.label);
        pings.splice(i, 1);
        continue;
      }
      p.ring.scale.setScalar(1 + t * CONFIG.ping.grow);
      p.ring.material.opacity = 0.75 * (1 - t);
      p.label.material.opacity = t < 0.6 ? 1 : (1 - t) / 0.4; // hold, then fade near the end
      p.label.position.y = getBoardTopY() + 0.6 + t * 0.35; // drift up a touch
    }
  }
  function updateDropMarker(down) {
    const held = down && down.grabbed && meshes.get(down.id); // landing spot under the held piece
    if (held) {
      _dropBox.setFromObject(held.mesh);
      _dropBox.getSize(_dropSize); // fit the ring to the piece's footprint
      dropMarker.scale.setScalar(
        (Math.max(_dropSize.x, _dropSize.z) / 2 + 0.12) / CONFIG.marker.outer,
      );
      const me = getRoom() && getRoom().state.players.get(getSessionId()); // tint to my seat color
      if (me && me.color) dropMarker.material.color.set(me.color);
      dropMarker.position.set(
        held.mesh.position.x,
        boardDropHeight(held.mesh.position.x, held.mesh.position.z, held.mesh.position.y) +
          CONFIG.marker.lift,
        held.mesh.position.z,
      );
      dropMarker.visible = true;
    } else {
      dropMarker.visible = false;
    }
  }

  return {
    sendPing,
    bindPings,
    bindTableEffects,
    applyAnim,
    updatePings,
    updateDropMarker,
    disposeSurface(id) {
      const surface = boardDropSurfaces.get(id);
      if (surface) disposeColliderSurface(surface.root);
      boardDropSurfaces.delete(id);
    },
  };
}
