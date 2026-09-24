// Measurement overlays and their transient input state. The table shell forwards input
// intent and supplies the shared ray, scene, registry, room access, and label renderer.
export function createOverlays({
  THREE,
  scene,
  camera,
  ray,
  pointer,
  canvas,
  registry,
  measure,
  labelSize,
  nameTag,
  formatMeasure,
  disposeSprite,
  getRoom,
  send,
  getSessionId,
  getRank,
  getColor,
  getBoardMeshes,
  setPointer,
  byId,
  doc = document,
  now = () => performance.now(),
}) {
  const objects = new Map(); // id -> { group, label }
  const dragPreviews = new Map(); // session id -> { group, label }
  let measuring = false;
  let kind = 'ruler';
  let measureDrag = null;
  let previewGroup = null,
    previewLabel = null;
  let lastDragSent = 0;
  let selectedId = null,
    handles = null;
  let move = null;
  let surfaceSignature = '';
  const surfaceRay = new THREE.Raycaster();
  const surfaceOrigin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const boardHit = (raycaster) => {
    let nearest = null;
    for (const mesh of getBoardMeshes()) {
      if (!mesh.visible) continue;
      mesh.updateMatrixWorld(true);
      const hit = raycaster.intersectObject(mesh, true)[0];
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    return nearest;
  };
  // Use rendered board geometry, not its bounding box or physics collider: a
  // decorative wall/collider can rise far above the playable surface.
  const surfaceY = (x, z) => {
    surfaceRay.set(surfaceOrigin.set(x, 1000, z), down);
    const hit = boardHit(surfaceRay);
    return hit ? Math.max(0, hit.point.y) : 0;
  };
  const elevation = (x, z) => surfaceY(x, z) + measure.lift;
  const disposeGroup = (group) =>
    group.traverse((node) => {
      if (node.isMesh) {
        node.geometry.dispose();
        node.material.dispose();
      }
    });
  const labelSprite = (text, color, x, z, baseY) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nameTag(text, color),
        transparent: true,
        depthTest: false,
      }),
    );
    sprite.scale.set(labelSize.w, labelSize.h, 1);
    sprite.position.set(x, baseY + measure.labelLift, z);
    sprite.renderOrder = 6;
    return sprite;
  };
  const textFor = (overlay) =>
    formatMeasure(
      Math.hypot(overlay.x2 - overlay.x, overlay.z2 - overlay.z),
      getRoom().state.scale,
    );
  const canEdit = (overlay) => !!overlay && (overlay.owner === getSessionId() || getRank() >= 2);
  const pick = () => {
    ray.setFromCamera(pointer, camera);
    let best = null,
      bestDistance = Infinity;
    for (const [id, entry] of objects) {
      const hits = ray.intersectObject(entry.group, true);
      if (hits.length && hits[0].distance < bestDistance) {
        bestDistance = hits[0].distance;
        best = id;
      }
    }
    return best;
  };
  const select = (id) => {
    if (handles) {
      scene.remove(handles);
      disposeGroup(handles);
      handles = null;
    }
    selectedId = id && objects.has(id) ? id : null;
    if (!selectedId) return;
    const overlay = getRoom().state.overlays.get(selectedId);
    if (!overlay) {
      selectedId = null;
      return;
    }
    const next = new THREE.Group();
    const y = elevation(overlay.x, overlay.z) + 0.02;
    for (const [x, z] of [
      [overlay.x, overlay.z],
      [overlay.x2, overlay.z2],
    ]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.13, 0.2, 20),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y, z);
      ring.renderOrder = 7;
      next.add(ring);
    }
    scene.add(next);
    handles = next;
  };
  const clearDragPreview = (sessionId) => {
    const entry = dragPreviews.get(sessionId);
    if (!entry) return;
    scene.remove(entry.group);
    disposeGroup(entry.group);
    if (entry.label) disposeSprite(entry.label);
    dragPreviews.delete(sessionId);
  };
  const addPayload = (ax, az, bx, bz) => {
    const payload = { kind, x: ax, z: az, x2: bx, z2: bz };
    if (kind === 'cone') payload.ang = measure.coneAngle;
    if (kind === 'line') payload.w = measure.lineWidth;
    return payload;
  };
  const remove = (id) => {
    const entry = objects.get(id);
    if (!entry) return;
    scene.remove(entry.group);
    disposeGroup(entry.group);
    if (entry.label) disposeSprite(entry.label);
    objects.delete(id);
  };
  const add = (id, overlay) => {
    remove(id);
    const shape = registry[overlay.kind];
    if (!shape) return;
    const group = shape.build(overlay);
    const baseY = surfaceY(overlay.x, overlay.z);
    group.position.y = baseY + measure.lift;
    scene.add(group);
    const label = labelSprite(
      textFor(overlay),
      overlay.color,
      (overlay.x + overlay.x2) / 2,
      (overlay.z + overlay.z2) / 2,
      baseY,
    );
    scene.add(label);
    objects.set(id, { group, label });
    if (id === selectedId) select(id); // reposition handles after a synced move
  };
  const relabel = () => {
    for (const [id, entry] of objects) {
      const overlay = getRoom().state.overlays.get(id);
      if (overlay && entry.label) {
        entry.label.material.map.dispose();
        entry.label.material.map = nameTag(textFor(overlay), overlay.color);
        entry.label.material.needsUpdate = true;
      }
    }
  };
  const syncSurface = () => {
    // A GLB board starts as an empty group and gains its mesh after loading.
    // Reposition restored overlays when that happens (or the board moves/leaves).
    const signature = [...getBoardMeshes()]
      .map((mesh) =>
        [
          mesh.id,
          mesh.visible,
          mesh.children.length,
          mesh.position.x,
          mesh.position.y,
          mesh.position.z,
        ].join(':'),
      )
      .join('|');
    if (signature === surfaceSignature) return;
    surfaceSignature = signature;
    for (const [id, entry] of objects) {
      const overlay = getRoom()?.state.overlays.get(id);
      if (!overlay) continue;
      const y = surfaceY(overlay.x, overlay.z);
      entry.group.position.y = y + measure.lift;
      entry.label.position.y = y + measure.labelLift;
    }
    if (selectedId) select(selectedId);
  };
  const point = (event) => {
    setPointer(event);
    ray.setFromCamera(pointer, camera);
    const hit = new THREE.Vector3();
    const board = boardHit(ray);
    if (board) return board.point;
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  };
  const clearPreview = () => {
    if (previewGroup) {
      scene.remove(previewGroup);
      disposeGroup(previewGroup);
      previewGroup = null;
    }
    if (previewLabel) {
      disposeSprite(previewLabel);
      previewLabel = null;
    }
  };
  const drawPreview = (ax, az, bx, bz) => {
    clearPreview();
    const color = getColor();
    const overlay = {
      kind,
      color,
      x: ax,
      z: az,
      x2: bx,
      z2: bz,
      ang: measure.coneAngle,
      w: measure.lineWidth,
    };
    previewGroup = (registry[kind] || registry.ruler).build(overlay);
    const baseY = surfaceY(ax, az);
    previewGroup.position.y = baseY + measure.lift;
    scene.add(previewGroup);
    previewLabel = labelSprite(
      formatMeasure(Math.hypot(bx - ax, bz - az), getRoom().state.scale),
      color,
      (ax + bx) / 2,
      (az + bz) / 2,
      baseY,
    );
    scene.add(previewLabel);
  };
  const enter = () => {
    if (measuring) return;
    measuring = true;
    select(null);
    canvas.classList.add('measuring');
    byId('measureBtn')?.classList.add('on');
  };
  const exit = () => {
    if (!measuring) return;
    measuring = false;
    measureDrag = null;
    clearPreview();
    send('overlayDrag', {});
    canvas.classList.remove('measuring');
    byId('measureBtn')?.classList.remove('on');
  };
  const beginMeasure = (event) => {
    if (!event.primary) return false;
    const hit = point(event);
    if (!hit) return false;
    measureDrag = { ax: hit.x, az: hit.z };
    return true;
  };
  const updateMeasure = (event) => {
    if (!measureDrag) return;
    const hit = point(event);
    if (!hit) return;
    drawPreview(measureDrag.ax, measureDrag.az, hit.x, hit.z);
    const time = now();
    if (time - lastDragSent > 55) {
      lastDragSent = time;
      send('overlayDrag', addPayload(measureDrag.ax, measureDrag.az, hit.x, hit.z));
    }
  };
  const finishMeasure = (event) => {
    if (!measureDrag) return false;
    const hit = point(event);
    if (hit && Math.hypot(hit.x - measureDrag.ax, hit.z - measureDrag.az) >= measure.minDrag)
      send('overlayAdd', addPayload(measureDrag.ax, measureDrag.az, hit.x, hit.z));
    measureDrag = null;
    clearPreview();
    send('overlayDrag', {});
    return true;
  };
  const beginMove = (event) => {
    const id = pick();
    const overlay = id && getRoom().state.overlays.get(id);
    if (!id || !canEdit(overlay)) return false;
    select(id);
    const hit = point(event);
    move = {
      id,
      gx: hit ? hit.x : 0,
      gz: hit ? hit.z : 0,
      x: overlay.x,
      z: overlay.z,
      x2: overlay.x2,
      z2: overlay.z2,
      moved: false,
    };
    return true;
  };
  const movePayload = (hit) => {
    const dx = hit.x - move.gx,
      dz = hit.z - move.gz;
    return {
      id: move.id,
      x: move.x + dx,
      z: move.z + dz,
      x2: move.x2 + dx,
      z2: move.z2 + dz,
    };
  };
  const updateMove = (event) => {
    if (!move) return;
    const hit = point(event);
    if (!hit) return;
    const dx = hit.x - move.gx,
      dz = hit.z - move.gz;
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) move.moved = true;
    const time = now();
    if (time - lastDragSent > 55) {
      lastDragSent = time;
      send('overlayMove', movePayload(hit));
    }
  };
  const finishMove = (event) => {
    if (!move) return false;
    const hit = point(event);
    if (hit && move.moved) send('overlayMove', movePayload(hit));
    move = null;
    return true;
  };
  const removeSelected = () => {
    if (!selectedId) return false;
    send('overlayRemove', { id: selectedId });
    select(null);
    return true;
  };
  const bindControls = () => {
    const clearMine = byId('measureClear');
    if (clearMine) clearMine.onclick = () => send('overlayClear', { scope: 'mine' });
    const clearAll = byId('measureClearAll');
    if (clearAll) clearAll.onclick = () => send('overlayClear', { scope: 'all' });
    const kinds = doc.querySelectorAll('#measureKinds [data-kind]');
    const hint = byId('measureHint');
    const coneDegrees = Math.round((measure.coneAngle * 2 * 180) / Math.PI);
    const width = measure.lineWidth;
    const hints = {
      ruler: 'Drag A → B — the label reads the distance between them.',
      circle: 'Drag from the centre outward — the label reads the radius.',
      cone: `Drag from the origin — a ${coneDegrees}° cone opens along the drag.`,
      line: `Drag a lane ${width} unit${width === 1 ? '' : 's'} wide — the label reads its length.`,
    };
    const setKind = (next) => {
      kind = next;
      kinds.forEach((button) => button.classList.toggle('on', button.dataset.kind === next));
      if (hint) hint.textContent = hints[next] || '';
    };
    kinds.forEach((button) => {
      button.onclick = () => setKind(button.dataset.kind);
    });
    setKind(kind);
  };
  const receiveDrag = (message) => {
    if (!message || message.from == null) return;
    clearDragPreview(message.from);
    if (!message.kind) return;
    const overlay = {
      kind: message.kind,
      color: message.color || '#ffffff',
      x: message.x,
      z: message.z,
      x2: message.x2,
      z2: message.z2,
      w: message.w,
      ang: message.ang,
    };
    const group = (registry[message.kind] || registry.ruler).build(overlay);
    const baseY = surfaceY(overlay.x, overlay.z);
    group.position.y = baseY + measure.lift;
    scene.add(group);
    const label = labelSprite(
      textFor(overlay),
      overlay.color,
      (overlay.x + overlay.x2) / 2,
      (overlay.z + overlay.z2) / 2,
      baseY,
    );
    scene.add(label);
    dragPreviews.set(message.from, { group, label });
  };
  const bindRoom = (room, cb, onHydration) => {
    cb(room.state).overlays.onAdd((overlay, id) => {
      onHydration();
      add(id, overlay);
      ['x', 'z', 'x2', 'z2', 'w', 'ang', 'color'].forEach((field) =>
        cb(overlay).listen(field, () => add(id, overlay), false),
      );
    });
    cb(room.state).overlays.onRemove((overlay, id) => {
      onHydration();
      remove(id);
      if (id === selectedId) select(null);
    });
    room.onMessage('overlayDrag', receiveDrag);
  };
  return {
    isMeasuring: () => measuring,
    isMoving: () => !!move,
    isDraggingMeasure: () => !!measureDrag,
    hasSelection: () => !!selectedId,
    enter,
    cancel: () => {
      exit();
      move = null;
      select(null);
    },
    exit,
    select,
    relabel,
    syncSurface,
    clearDragPreview,
    beginMeasure,
    updateMeasure,
    finishMeasure,
    beginMove,
    updateMove,
    finishMove,
    removeSelected,
    bindControls,
    bindRoom,
  };
}
