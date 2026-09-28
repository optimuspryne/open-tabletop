import { MAP_FOG, parseFog } from '../../shared/map-fog.js';
import { canHaveFogAura, parseFogAura, normalizeFogAura } from '../../shared/fog-auras.js';
import { boardHalfExtents } from '../../shared/board-geometry.js';
import { piecePropsOf } from './piece-view.js';

// A local editor and temporary radius preview. Only the server reveals exploration.
export function createFogAuras({
  THREE,
  scene,
  meshes,
  getRoom,
  getRank,
  canInteract,
  byId,
  onOpen,
}) {
  const modal = byId('fogAuraModal'),
    form = byId('fogAuraForm'),
    enabled = byId('fogAuraEnabled'),
    radius = byId('fogAuraRadius'),
    apply = byId('fogAuraApply'),
    status = byId('fogAuraStatus');
  let editing = null,
    ring = null,
    pending = null,
    error = '';
  const allowed = () => getRank() >= 2 && canInteract();
  const setStatus = (text) => {
    if (status.textContent !== text) status.textContent = text;
  };
  const close = () => {
    modal.hidden = true;
    editing = pending = null;
    error = '';
    if (ring) {
      scene.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
      ring = null;
    }
  };
  const update = () => {
    if (!editing) return;
    const room = getRoom(),
      piece = room?.state?.pieces?.get(editing.id);
    if (
      room !== editing.room ||
      !piece ||
      !allowed() ||
      !canHaveFogAura(piece.type, piecePropsOf(piece))
    )
      return close();
    if (
      pending?.ack &&
      (piece.fogAura === pending.value || (piece.fogAura || '') !== editing.previous)
    )
      return close();
    // A scale change must not silently reinterpret a draft radius.
    if ((room.state.scale?.worldPerUnit || 1) !== editing.scale) return close();
    apply.disabled = !!pending;
    enabled.disabled = !!pending;
    radius.disabled = !!pending || !enabled.checked;
    if (error) setStatus(error);
    ring.visible = false;
    const value = Number(radius.value) * editing.scale;
    const sourceMesh = meshes.get(editing.id)?.mesh;
    if (!sourceMesh?.visible || !enabled.checked || !Number.isFinite(value) || value <= 0) return;
    const boardEntry = [...room.state.pieces].find(([, p]) => p.type === 'board' && !p.hidden);
    const board = boardEntry?.[1],
      boardMesh = meshes.get(boardEntry?.[0])?.mesh;
    const fog = board && parseFog(board.fog);
    if (!boardMesh?.visible || !fog?.enabled) {
      if (!pending && !error)
        setStatus('Enable map fog to use this aura. Settings can still be saved.');
      return;
    }
    sourceMesh.updateMatrixWorld(true);
    boardMesh.updateMatrixWorld(true);
    const point = sourceMesh.getWorldPosition(new THREE.Vector3());
    boardMesh.worldToLocal(point);
    const local = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    local.scale(new THREE.Vector3(value, value, 1));
    local.setPosition(
      point.x,
      boardHalfExtents(piecePropsOf(board))[1] + fog.thickness + MAP_FOG.lift * 2,
      point.z,
    );
    ring.matrix.multiplyMatrices(boardMesh.matrixWorld, local);
    ring.matrixWorldNeedsUpdate = true;
    ring.visible = !piece.hidden;
    if (!pending && !error)
      setStatus(
        piece.hidden
          ? 'Hidden piece: its aura is paused.'
          : 'Radius preview is visible only to you.',
      );
  };
  function edit(id) {
    const room = getRoom(),
      piece = room?.state?.pieces?.get(id);
    if (!allowed() || !piece || !canHaveFogAura(piece.type, piecePropsOf(piece))) return;
    close();
    onOpen();
    const aura = parseFogAura(piece.fogAura);
    if (!aura) return;
    const scale = room.state.scale?.worldPerUnit || 1;
    editing = { id, room, scale, previous: piece.fogAura || '' };
    enabled.checked = aura.enabled;
    radius.min = MAP_FOG.minRadius / scale;
    radius.max = MAP_FOG.maxRadius / scale;
    radius.value = aura.radius / scale;
    byId('fogAuraUnit').textContent = room.state.scale?.unitLabel || 'u';
    byId('fogAuraPiece').textContent = piecePropsOf(piece).label || piece.type;
    setStatus('Radius preview is visible only to you.');
    ring = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    ring.matrixAutoUpdate = false;
    ring.raycast = () => {};
    ring.renderOrder = 8;
    scene.add(ring);
    modal.hidden = false;
    update();
  }
  byId('fogAuraClose').onclick = byId('fogAuraCancel').onclick = close;
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  // Native fields/buttons retain their keys; the table's global axis and command listeners do not.
  modal.addEventListener('keydown', (event) => event.stopPropagation());
  enabled.onchange = radius.oninput = update;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editing || pending || !allowed() || !form.reportValidity()) return;
    const aura = normalizeFogAura({
      v: 1,
      enabled: enabled.checked,
      radius: Number(radius.value) * editing.scale,
    });
    if (!aura) return;
    pending = { value: JSON.stringify(aura), ack: false };
    error = '';
    setStatus('Saving aura…');
    update();
    if (editing)
      editing.room.send('setFogAura', { id: editing.id, previous: editing.previous, aura });
  });
  const bindRoom = (room) => {
    close();
    room.onMessage('fogAuraEdited', (message) => {
      if (
        room !== getRoom() ||
        !pending ||
        message?.id !== editing?.id ||
        message.fogAura !== pending.value
      )
        return;
      pending.ack = true;
      update();
    });
    room.onMessage('serverError', (message) => {
      if (room !== getRoom() || !editing || message?.operation !== 'setFogAura') return;
      pending = null;
      error = message.message || 'Could not save the aura. Reopen its settings and try again.';
      update();
    });
  };
  return { edit, close, update, bindRoom, isActive: () => !!editing };
}
