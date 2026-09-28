import {
  MAP_FOG,
  fogBoardSize,
  parseFog,
  decodeFogMask,
  normalizeFogStroke,
  paintFog,
} from '../../shared/map-fog.js';
import { boardGeometry, boardHalfExtents } from '../../shared/board-geometry.js';
import { piecePropsOf } from './piece-view.js';
import { fogWallPositions } from './map-fog-volume.js';

// Visual map covering only. This controller never hides pieces or alters their physics.
export function createMapFog({
  THREE,
  scene,
  camera,
  ray,
  pointer,
  canvas,
  controls,
  meshes,
  getRoom,
  getRank,
  canInteract,
  setPointer,
  byId,
  onEnter,
  toast,
  doc = document,
}) {
  const entries = new Map();
  let selected = '',
    active = false,
    mode = 'reveal',
    preview = false,
    thicknessDraft = null,
    drag = null,
    pending = null;
  let cursor = [0, 0],
    panelOpen = false;
  let controlsBound = false,
    controlsSignature = '';
  const allowed = () => getRank() >= 2 && canInteract();
  const entry = () => entries.get(selected);
  const radiusWorld = () => {
    const radius = Number(byId('fogRadius')?.value);
    const per = getRoom()?.state?.scale?.worldPerUnit || 1;
    return Math.max(
      MAP_FOG.minRadius,
      Math.min(MAP_FOG.maxRadius, (radius > 0 ? radius : 1) * per),
    );
  };
  const updateTexture = (e, mask) => {
    if (e.mask?.every((byte, i) => byte === mask[i])) return;
    e.mask = mask.slice();
    const image = e.context.createImageData(MAP_FOG.resolution, MAP_FOG.resolution);
    for (let i = 0; i < MAP_FOG.resolution ** 2; i++) {
      image.data[i * 4] = 21;
      image.data[i * 4 + 1] = 27;
      image.data[i * 4 + 2] = 32;
      image.data[i * 4 + 3] = mask[i >> 3] & (1 << (i & 7)) ? 255 : 0;
    }
    e.context.putImageData(image, 0, 0);
    e.texture.needsUpdate = true;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(fogWallPositions(mask, e.size, e.outline), 3),
    );
    e.walls.geometry.dispose();
    e.walls.geometry = geometry;
  };
  const remove = (id) => {
    const e = entries.get(id);
    if (!e) return;
    scene.remove(e.group);
    e.surface.geometry.dispose();
    e.surface.material.dispose();
    e.walls.geometry.dispose();
    e.walls.material.dispose();
    e.texture.dispose();
    e.ring.geometry.dispose();
    e.ring.material.dispose();
    entries.delete(id);
  };
  const build = (id, piece, props, size) => {
    const image = doc.createElement('canvas');
    image.width = image.height = MAP_FOG.resolution;
    const texture = new THREE.CanvasTexture(image);
    texture.generateMipmaps = false;
    // Exact mask-cell edges must meet the vertical walls without filtered transparency gaps.
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    // Models use their shared bounding footprint; authored outlines apply to flat boards only.
    const { vertices, faces } = boardGeometry(
        props.model || props.board ? { ...props, outline: undefined } : props,
      ),
      positions = [],
      uv = [];
    const top = faces[1];
    for (let i = 1; i < top.length - 1; i++)
      for (const index of [top[0], top[i], top[i + 1]]) {
        const [x, y, z] = vertices[index];
        positions.push(x, y + MAP_FOG.lift, z);
        uv.push(x / size.w + 0.5, 0.5 - z / size.d);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        alphaTest: 0.01,
        forceSinglePass: true,
      }),
    );
    surface.raycast = () => {};
    const bottom = new THREE.Mesh(geometry, surface.material);
    bottom.position.y = -2 * (boardHalfExtents(props)[1] + MAP_FOG.lift);
    bottom.raycast = () => {};
    const walls = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x151b20,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      }),
    );
    walls.position.y = -boardHalfExtents(props)[1] - MAP_FOG.lift;
    walls.raycast = () => {};
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.raycast = () => {};
    ring.renderOrder = 8;
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(surface, ring, bottom, walls);
    scene.add(group);
    const e = {
      group,
      surface,
      bottom,
      walls,
      outline: faces[0].map((index) => [vertices[index][0], vertices[index][2]]),
      ring,
      texture,
      context: image.getContext('2d'),
      props: piece.props,
      size,
      top: boardHalfExtents(props)[1],
      raw: null,
      fog: null,
      piece,
    };
    entries.set(id, e);
    return e;
  };
  const cancelStroke = () => {
    const old = drag;
    drag = null;
    if (old) {
      const e = entries.get(old.id);
      if (e?.fog) updateTexture(e, decodeFogMask(e.fog.mask));
      try {
        canvas.releasePointerCapture(old.pointerId);
      } catch {
        /* already released */
      }
    }
  };
  const exit = () => {
    cancelStroke();
    thicknessDraft = null;
    if (active) controls.enabled = true;
    active = false;
    canvas.classList.remove('fog-painting');
    refreshControls();
  };
  const refreshControls = () => {
    const e = entry(),
      editable = allowed() && !!e && !pending;
    const enable = byId('fogEnabled');
    if (!enable) return;
    const scale = getRoom()?.state?.scale;
    const signature = [
      selected,
      e?.fog?.revision,
      e?.fog?.enabled,
      editable,
      active,
      mode,
      preview,
      !!pending,
      scale?.worldPerUnit,
      scale?.unitLabel,
      thicknessDraft?.thickness,
    ].join('|');
    if (signature === controlsSignature) return;
    controlsSignature = signature;
    const radius = byId('fogRadius');
    radius.min = MAP_FOG.minRadius / (scale?.worldPerUnit || 1);
    radius.max = MAP_FOG.maxRadius / (scale?.worldPerUnit || 1);
    const per = scale?.worldPerUnit || 1,
      thickness = byId('fogThickness'),
      value = thicknessDraft?.thickness ?? e?.fog?.thickness ?? 0;
    thickness.max = MAP_FOG.maxThickness / per;
    thickness.step = MAP_FOG.thicknessStep / per;
    thickness.value = value / per;
    // Keep focus during a save so keyboard users can continue after the patch arrives.
    thickness.disabled = !allowed() || !e;
    thickness.setAttribute('aria-disabled', String(!editable));
    const thicknessLabel = `${Number((value / per).toFixed(2))} ${scale?.unitLabel || 'u'}`;
    byId('fogThicknessValue').textContent = thicknessLabel;
    thickness.setAttribute('aria-valuetext', thicknessLabel);
    enable.checked = !!e?.fog?.enabled;
    enable.disabled = !editable;
    for (const id of ['fogReveal', 'fogCover', 'fogCoverAll', 'fogRevealAll', 'fogRadius'])
      byId(id).disabled = !editable || !e.fog?.enabled;
    byId('fogUndo').disabled = !editable || !e.fog?.revision;
    byId('fogDone').disabled = !active;
    byId('fogMap').disabled = !editable;
    byId('fogGMView').setAttribute('aria-pressed', String(!preview));
    byId('fogPlayerView').setAttribute('aria-pressed', String(preview));
    for (const [id, value] of [
      ['fogReveal', 'reveal'],
      ['fogCover', 'cover'],
    ]) {
      byId(id).classList.toggle('on', active && mode === value);
      byId(id).setAttribute('aria-pressed', String(active && mode === value));
    }
    byId('fogUnit').textContent = getRoom()?.state?.scale?.unitLabel || 'u';
    const hint = !e
      ? 'Load a board from the Library to use fog.'
      : pending
        ? 'Saving fog…'
        : !allowed()
          ? 'Only active GMs can edit map fog.'
          : !e.fog?.enabled
            ? 'Enable fog to cover this map. Disabling keeps its exploration.'
            : active
              ? `${mode === 'reveal' ? 'Reveal' : 'Cover'} mode: drag or tap the map. Keyboard: arrows move the brush; Enter stamps. Done restores camera movement.`
              : 'Painting off. Fog stays in place. Choose Reveal or Cover to paint.';
    if (byId('fogHint').textContent !== hint) byId('fogHint').textContent = hint;
  };
  const rebuildPicker = () => {
    const picker = byId('fogMap');
    if (!picker) return;
    const ids = [...entries.keys()];
    if (!entries.has(selected)) {
      selected = ids[0] || '';
      cursor = [0, 0];
      cancelStroke();
    }
    const signature = ids.map((id) => id + ':' + entries.get(id).props).join('|');
    if (picker.dataset.maps !== signature) {
      picker.dataset.maps = signature;
      picker.replaceChildren();
      for (const id of ids) {
        const option = doc.createElement('option');
        option.value = id;
        option.textContent = piecePropsOf(entries.get(id).piece).label || 'Board';
        picker.append(option);
      }
      if (!ids.length) {
        const option = doc.createElement('option');
        option.textContent = 'No board';
        picker.append(option);
      }
    }
    picker.value = selected;
  };
  const sync = () => {
    const room = getRoom();
    if (thicknessDraft && (!allowed() || !room?.state?.pieces?.has(thicknessDraft.id)))
      thicknessDraft = null;
    for (const [id] of entries) if (!room?.state?.pieces?.has(id)) remove(id);
    room?.state?.pieces?.forEach((piece, id) => {
      if (piece.type !== 'board') return;
      let e = entries.get(id);
      if (!e || e.props !== piece.props) {
        const props = piecePropsOf(piece),
          size = fogBoardSize(piece.type, props);
        if (e) {
          cancelStroke();
          remove(id);
        }
        if (!size) return;
        e = build(id, piece, props, size);
      }
      if (e.raw !== (piece.fog || '')) {
        if (thicknessDraft?.id === id) thicknessDraft = null;
        if (drag?.id === id) cancelStroke();
        e.raw = piece.fog || '';
        e.fog = parseFog(e.raw);
        // Corrupt state fails covered in the renderer; the server rejects corrupt saves.
        updateTexture(
          e,
          decodeFogMask(e.fog?.mask) || new Uint8Array(MAP_FOG.resolution ** 2 / 8).fill(255),
        );
      }
      const mesh = meshes.get(id)?.mesh;
      e.group.visible = !!mesh?.visible && (e.fog?.enabled ?? true);
      if (mesh) {
        mesh.updateMatrixWorld(true);
        e.group.matrix.copy(mesh.matrixWorld);
        e.group.matrixWorldNeedsUpdate = true;
      }
      const opacity = getRank() >= 2 && !preview ? MAP_FOG.gmOpacity : 1;
      for (const material of [e.surface.material, e.walls.material]) {
        if (material.transparent !== opacity < 1) {
          material.transparent = opacity < 1;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
        material.depthWrite = opacity === 1;
      }
      const thickness =
        thicknessDraft?.id === id ? thicknessDraft.thickness : e.fog?.thickness || 0;
      e.surface.position.y = thickness;
      e.walls.scale.y = 2 * (e.top + MAP_FOG.lift) + thickness;
      e.ring.visible = active && id === selected && !!e.fog?.enabled;
      e.ring.position.set(cursor[0], e.top + thickness + MAP_FOG.lift * 2, cursor[1]);
      e.ring.scale.setScalar(radiusWorld());
    });
    if (!allowed() && active) exit();
    if (getRank() < 2) {
      preview = false;
      panelOpen = false;
    }
    rebuildPicker();
    if (active && !entry()?.fog?.enabled) exit();
    if (
      pending &&
      (!entries.has(pending.id) ||
        entry()?.fog?.revision !== pending.revision ||
        pending.ack === pending.revision)
    ) {
      pending = null;
      thicknessDraft = null;
    }
    refreshControls();
  };
  const sendEdit = (data) => {
    const e = entry();
    if (!allowed() || !e?.fog || pending) return;
    pending = { id: selected, revision: e.fog.revision };
    getRoom().send('fogEdit', { ...pending, ...data });
    refreshControls();
  };
  const start = (next = mode) => {
    if (!allowed() || !entry()?.fog?.enabled || pending) return;
    cancelStroke();
    onEnter();
    mode = next;
    active = true;
    controls.enabled = false;
    canvas.classList.add('fog-painting');
    canvas.focus();
    refreshControls();
  };
  const hitPoint = (event) => {
    const e = entry();
    if (!e?.group.visible) return null;
    setPointer(event);
    ray.setFromCamera(pointer, camera);
    e.group.updateMatrixWorld(true);
    const hits = [];
    // Keep fog out of ordinary piece picking, but target its actual raised surface while painting.
    THREE.Mesh.prototype.raycast.call(e.surface, ray, hits);
    const hit = hits[0];
    if (!hit) return null;
    const p = e.group.worldToLocal(hit.point.clone()),
      size = e.size;
    return [
      Math.max(-size.w / 2, Math.min(size.w / 2, p.x)),
      Math.max(-size.d / 2, Math.min(size.d / 2, p.z)),
    ];
  };
  const extend = (p) => {
    const e = entry(),
      last = drag.points.at(-1);
    if (
      Math.hypot(p[0] - last[0], p[1] - last[1]) <
      Math.min(e.size.w, e.size.d) / MAP_FOG.resolution / 2
    )
      return;
    if (drag.points.length >= MAP_FOG.maxPoints) {
      // Bound one stroke without changing already-painted geometry or silently dropping its end.
      finish({ pointerId: drag.pointerId });
      toast('Fog stroke saved. Lift and start another stroke to continue.');
      return;
    }
    drag.points.push(p);
    paintFog(drag.mask, { mode: drag.mode, radius: drag.radius, points: [last, p] }, e.size);
    updateTexture(e, drag.mask);
  };
  const begin = (event) => {
    if (!active || !allowed() || pending || !event.primary) return false;
    if (drag) {
      if (drag.pointerId !== event.pointerId) cancelStroke();
      return false;
    }
    const p = hitPoint(event);
    if (!p) return false;
    const e = entry();
    cursor = p;
    drag = {
      id: selected,
      pointerId: event.pointerId,
      mode,
      radius: radiusWorld(),
      points: [p],
      mask: decodeFogMask(e.fog.mask),
    };
    paintFog(drag.mask, drag, e.size);
    updateTexture(e, drag.mask);
    return true;
  };
  const move = (event) => {
    if (drag && event.pointerId !== drag.pointerId) return;
    const p = hitPoint(event);
    if (!p) return;
    cursor = p;
    if (drag) extend(p);
  };
  function finish(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.cancelled || !allowed()) {
      cancelStroke();
      return;
    }
    const stroke = normalizeFogStroke(drag, entry()?.size);
    cancelStroke();
    if (stroke) sendEdit({ action: 'stroke', ...stroke });
  }
  const command = (event) => {
    if (!active) return false;
    if (event.key === 'Escape') {
      exit();
      byId('fogReveal')?.focus();
      return true;
    }
    if (doc.activeElement !== canvas) return false;
    const axes = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = axes[event.key],
      e = entry();
    if (delta && e) {
      const step = Math.max(radiusWorld() / 4, Math.min(e.size.w, e.size.d) / MAP_FOG.resolution);
      cursor = [
        Math.max(-e.size.w / 2, Math.min(e.size.w / 2, cursor[0] + delta[0] * step)),
        Math.max(-e.size.d / 2, Math.min(e.size.d / 2, cursor[1] + delta[1] * step)),
      ];
      return true;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (!event.repeat)
        sendEdit({ action: 'stroke', mode, radius: radiusWorld(), points: [cursor] });
      return true;
    }
    return false;
  };
  const bindControls = () => {
    if (controlsBound) return;
    controlsBound = true;
    canvas.tabIndex = 0;
    if (!canvas.hasAttribute('aria-label')) canvas.setAttribute('aria-label', 'Tabletop');
    byId('fogEnabled').onchange = () =>
      sendEdit({ action: 'enable', enabled: byId('fogEnabled').checked });
    byId('fogMap').onchange = () => {
      exit();
      selected = byId('fogMap').value;
      cursor = [0, 0];
      sync();
    };
    byId('fogReveal').onclick = () => start('reveal');
    byId('fogCover').onclick = () => start('cover');
    byId('fogRadius').onchange = () => {
      cancelStroke();
      byId('fogRadius').value = radiusWorld() / (getRoom()?.state?.scale?.worldPerUnit || 1);
      refreshControls();
    };
    const thickness = byId('fogThickness');
    thickness.oninput = () => {
      if (!allowed() || !entry()?.fog || pending) {
        controlsSignature = '';
        refreshControls();
        return;
      }
      cancelStroke();
      thicknessDraft = {
        id: selected,
        thickness: Math.max(
          0,
          Math.min(
            MAP_FOG.maxThickness,
            Number(thickness.value) * (getRoom()?.state?.scale?.worldPerUnit || 1),
          ),
        ),
      };
      sync();
    };
    thickness.onchange = () => {
      if (thicknessDraft) sendEdit({ action: 'thickness', thickness: thicknessDraft.thickness });
    };
    const cancelThickness = () => {
      thicknessDraft = null;
      controlsSignature = '';
      sync();
    };
    thickness.addEventListener('pointercancel', cancelThickness);
    thickness.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelThickness();
      }
    });
    byId('fogDone').onclick = () => {
      exit();
      byId('fogReveal').focus();
    };
    byId('fogUndo').onclick = () => {
      cancelStroke();
      sendEdit({ action: 'undo' });
    };
    byId('fogCoverAll').onclick = () => {
      cancelStroke();
      sendEdit({ action: 'all', mode: 'cover' });
    };
    byId('fogRevealAll').onclick = () => {
      cancelStroke();
      sendEdit({ action: 'all', mode: 'reveal' });
    };
    byId('fogGMView').onclick = () => {
      preview = false;
      sync();
    };
    byId('fogPlayerView').onclick = () => {
      preview = true;
      sync();
    };
    canvas.addEventListener('lostpointercapture', cancelStroke);
    doc.defaultView?.addEventListener('blur', cancelStroke);
    doc.defaultView?.addEventListener('blur', cancelThickness);
    sync();
  };
  const bindRoom = (room) => {
    exit();
    pending = null;
    selected = '';
    preview = false;
    for (const id of entries.keys()) remove(id);
    room.onMessage('fogEdited', (message) => {
      if (room !== getRoom()) return;
      if (pending?.id === message.id) pending.ack = message.revision;
      sync();
    });
    room.onMessage('serverError', (message) => {
      if (room !== getRoom()) return;
      if (message?.operation === 'fogEdit') {
        pending = null;
        thicknessDraft = null;
        cancelStroke();
        sync();
      }
    });
  };
  return {
    bindControls,
    bindRoom,
    sync,
    begin,
    move,
    finish,
    command,
    exit,
    isActive: () => active,
    open: () => {
      panelOpen = true;
      sync();
      if (allowed() && entry()?.fog?.enabled) start();
    },
    close: () => {
      panelOpen = false;
      preview = false;
      exit();
    },
    applyRole: () => {
      if (getRank() < 2 && panelOpen) byId('regionTR')?._close?.();
      sync();
    },
  };
}
