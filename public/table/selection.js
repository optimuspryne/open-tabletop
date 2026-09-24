import {
  KINDS as PHYS,
  PALETTE,
  COLORS,
  readableInk,
  recolorPalette,
  dispenserDefinition,
  dispenserVariant,
  customDispenserForItem,
  dispensedSpec,
  dispenserForItem,
  itemMatchesDispenser,
} from '../../shared/pieces.js';

// Compatibility rules operate only on piece data. Unrelated/missing pieces are ignored;
// compose and gather are hints for the UI, with authoritative validation on the server.
export function selColorDesc(piece) {
  if (piece.type === 'die') return { sig: 'free', team: false, swatches: PALETTE };
  if (piece.type !== 'prop' && piece.type !== 'dispenser') return null; // cards, etc.
  let props;
  try {
    props = JSON.parse(piece.props || '{}');
  } catch {
    props = {};
  }
  const dispDef = piece.type === 'dispenser' ? dispenserDefinition(props) : null;
  const opt = recolorPalette(piece.type, props, dispDef);
  if (!opt) return null;
  const key = opt.swatches.map((s) => s.hex).join(',');
  const sig = opt.team ? 'team:' + key : opt.free ? 'free' : 'pal:' + key;
  return { sig, team: opt.team, swatches: opt.swatches };
}

// Match geometry, snap and visibility; only secret cards require a shared back.
export function cardFamilySig(piece) {
  if (piece.type !== 'card' && piece.type !== 'deck') return null;
  let props;
  try {
    props = JSON.parse(piece.props || '{}');
  } catch {
    props = {};
  }
  return JSON.stringify([
    props.open ? null : props.back || 'back',
    props.tile ?? null,
    props.geom ?? null,
    !!props.open,
    !!props.snap,
  ]);
}

// Infinite bowls cannot be merged; finite dispensers must share their identity and variant.
export function dispenserSig(piece) {
  if (piece.type !== 'dispenser') return null;
  let props;
  try {
    props = JSON.parse(piece.props || '{}');
  } catch {
    props = {};
  }
  const def = dispenserDefinition(props);
  if (!def || def.infinite) return null;
  return dispenserVariant(props);
}

export function composeState(pieces, sigOf) {
  let sig = null;
  let n = 0;
  for (const piece of pieces) {
    if (!piece) continue;
    const s = sigOf(piece);
    if (s == null) continue;
    n++;
    if (sig == null) sig = s;
    else if (s !== sig) return 'mixed';
  }
  return n >= 2 ? 'ok' : null;
}

// Prefer merging dispensers, then absorption into one dispenser, then creating a new one.
// Pass a collection that can be iterated again for the dispenser compatibility check.
export function gatherPlan(pieces) {
  const disps = [];
  const items = [];
  for (const piece of pieces) {
    if (!piece) continue;
    if (piece.type === 'dispenser') disps.push(piece);
    else if (piece.type === 'prop') {
      let props;
      try {
        props = JSON.parse(piece.props || '{}');
      } catch {
        props = {};
      }
      if (dispenserForItem(props.shape) || customDispenserForItem(props)) items.push(props);
    }
  }
  if (disps.length >= 2)
    return {
      state: composeState(pieces, dispenserSig),
      msg: 'gatherDispensers',
      okTitle: 'Merge into one dispenser',
    };
  if (disps.length === 1) {
    let dp;
    try {
      dp = JSON.parse(disps[0].props || '{}');
    } catch {
      dp = {};
    }
    const want = dispensedSpec(dp);
    if (items.some((p) => itemMatchesDispenser(want, p)))
      return { state: 'ok', msg: 'absorbIntoDispenser', okTitle: 'Add the loose pieces to it' };
    return { state: null };
  }
  if (items.length >= 2) {
    const sig = (p) =>
      p.asset
        ? JSON.stringify([String(p.asset.id), p.color ?? null, p.finish ?? null])
        : JSON.stringify([p.shape, p.color ?? null, p.team ?? null]);
    const s0 = sig(items[0]);
    if (items.some((p) => sig(p) !== s0))
      return { state: 'mixed', msg: 'dispenseFromPieces', okTitle: '' };
    return { state: 'ok', msg: 'dispenseFromPieces', okTitle: 'Gather into a new dispenser' };
  }
  return { state: null };
}

export function selectionPalette(pieces) {
  let common = null;
  for (const piece of pieces) {
    if (!piece) continue;
    const desc = selColorDesc(piece);
    if (!desc) continue; // ignore non-colorable (they'd be skipped anyway)
    if (!common) common = desc;
    else if (desc.sig !== common.sig) return { mixed: true };
  }
  return common;
}

// Own local selection, highlights, toolbar state, and semantic selection gestures.
// The shell retains input priority, pointer capture, and camera-control arbitration.
export function createSelection({
  THREE,
  scene,
  camera,
  canvas,
  meshes,
  marker,
  getRoom,
  getBoardTopY,
  byId,
  doc = document,
  getStyle = getComputedStyle,
}) {
  const document = doc;
  const selectedPieces = () => [...selection].map((id) => getRoom()?.state.pieces.get(id));
  // Selection is private to this client; the server validates every batch action.
  const selection = new Set(); // selected piece ids (mine only)
  let selMode = false; // the Select tool is active → a felt drag boxes instead of orbiting
  let marquee = null; // { sx, sy, add } while boxing; null otherwise
  let selGesture = false; // a shift/select pointer gesture is in progress (so pointerup finalizes it)
  const selRings = new Map(); // id -> highlight ring mesh (pooled)
  const SEL_COLOR = '#c9a25a'; // fallback if the accent var isn't a valid hex
  // MY UI accent colour (the one chosen in the lobby, stored as the `--accent` CSS var). The
  // selection is private to me, so it's tinted with my own accent.
  const selColor = () => {
    const v = getStyle(document.documentElement).getPropertyValue('--accent').trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : SEL_COLOR;
  };

  const selectable = (id) => {
    const e = meshes.get(id);
    return !!e && PHYS[e.type].mass > 0;
  }; // static boards can't be selected
  function selToggle(id) {
    if (!selectable(id)) return;
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
  }
  function clearSelection() {
    selection.clear();
  }
  // Reflect a compose state onto its button: hidden when it doesn't apply, greyed when the
  // selection is mixed, enabled when it agrees.
  function setComposeBtn(el, state, okTitle, mixedTitle) {
    if (!el) return;
    el.hidden = state == null;
    const mixed = state === 'mixed';
    el.disabled = mixed;
    el.classList.toggle('disabled', mixed);
    el.title = mixed ? mixedTitle : okTitle;
  }
  // Recolor the whole selection to a freeform/palette color (Neutral → the neutral tint). Dice
  // numbers auto-contrast; the server applies the color only where it fits.
  function recolorSelColor(hex) {
    const room = getRoom();
    if (!selection.size || !room) return;
    const color = hex == null ? COLORS.neutralProp : hex;
    room.send('recolorGroup', { ids: [...selection], color, textColor: readableInk(color) });
  }
  // Recolor a team-only selection by switching every piece to set 0/1.
  function recolorSelTeam(i) {
    const room = getRoom();
    if (!selection.size || !room) return;
    room.send('recolorGroup', { ids: [...selection], team: i ? 1 : 0 });
  }
  // Rebuild the recolor bar to match the current selection: the shared palette's swatches when the
  // selection agrees, a disabled "mixed" state when it doesn't, hidden when nothing's recolorable.
  let selBarSig = null; // last-rendered state, to avoid rebuilding every frame
  function refreshSelTools() {
    const abar = byId('selActions');
    if (abar) abar.hidden = !selection.size; // batch-op bar shows for any selection (also in the editor, which has no recolor bar)
    setComposeBtn(
      byId('selCombine'),
      composeState(selectedPieces(), cardFamilySig),
      'Combine into one deck',
      'Match shape, snap and double-sided settings; secret cards must also share a back',
    );
    const gplan = gatherPlan(selectedPieces());
    setComposeBtn(
      byId('selGather'),
      gplan.state,
      gplan.okTitle,
      'This selection can’t be gathered',
    );
    // The 2-Sided toggle reflects the selection's current mode: it reads "Secret" once anything in the
    // selection is already double-sided (pressing it then makes them secret again), else "2-Sided".
    const twoBtn = byId('sel2Sided');
    if (twoBtn) {
      let anyOpen = false;
      for (const id of selection) {
        const piece = getRoom()?.state.pieces.get(id);
        if (!piece || (piece.type !== 'card' && piece.type !== 'deck')) continue;
        try {
          if (JSON.parse(piece.props || '{}').open) {
            anyOpen = true;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      const lbl = twoBtn.querySelector('.lbl');
      if (lbl) lbl.textContent = anyOpen ? 'Secret' : '2-Sided';
      twoBtn.title = anyOpen
        ? 'Make secret (flip conceals the front)'
        : 'Make double-sided (flip turns it over)';
    }
    const bar = byId('selRecolor');
    if (!bar) return;
    const desc = selection.size ? selectionPalette(selectedPieces()) : null;
    const sig = !selection.size ? '' : !desc ? 'none' : desc.mixed ? 'mixed' : desc.sig;
    bar.hidden = !selection.size || sig === 'none'; // no selection, or nothing colorable → hide
    if (bar.hidden) {
      selBarSig = null;
      return;
    }
    if (sig === selBarSig) return; // unchanged → keep the DOM
    selBarSig = sig;
    const row = byId('selSwatches'),
      note = byId('selNote');
    if (row) row.innerHTML = '';
    if (sig === 'mixed') {
      bar.classList.add('disabled');
      if (note) note.textContent = 'Mixed selection — recolor unavailable';
      return;
    }
    bar.classList.remove('disabled');
    if (note) note.textContent = 'Recolor selection';
    if (row)
      desc.swatches.forEach((s, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'swatch' + (s.hex == null ? ' neutral' : '');
        chip.title = s.name;
        if (s.hex != null)
          chip.style.background = '#' + ((s.hex >>> 0) & 0xffffff).toString(16).padStart(6, '0');
        chip.onclick = desc.team ? () => recolorSelTeam(i) : () => recolorSelColor(s.hex);
        row.appendChild(chip);
      });
  }
  function setSelMode(on) {
    selMode = on;
    document.querySelectorAll('.selectTool').forEach((b) => b.classList.toggle('on', on));
    canvas.classList.toggle('selecting', on);
  }
  // A flat ring under a selected piece, styled like dropMarker but tinted + opaque.
  function makeSelRing() {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(marker.inner, marker.outer, 40),
      new THREE.MeshBasicMaterial({
        color: selColor(),
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 3;
    scene.add(m);
    return m;
  }
  const _selBox = new THREE.Box3(),
    _selSize = new THREE.Vector3();
  function updateSelectionRings() {
    for (const [id, ring] of selRings)
      if (!selection.has(id) || !meshes.get(id)) {
        // drop stale rings
        scene.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
        selRings.delete(id);
      }
    for (const id of selection) {
      const entry = meshes.get(id);
      if (!entry) continue;
      let ring = selRings.get(id);
      if (!ring) {
        ring = makeSelRing();
        selRings.set(id, ring);
      } // tinted with my accent at creation
      _selBox.setFromObject(entry.mesh);
      _selBox.getSize(_selSize);
      ring.scale.setScalar((Math.max(_selSize.x, _selSize.z) / 2 + 0.15) / marker.outer);
      ring.position.set(
        entry.mesh.position.x,
        getBoardTopY() + marker.lift + 0.012,
        entry.mesh.position.z,
      );
    }
    refreshSelTools(); // the recolor bar: shown/hidden + its swatches match what's selected
  }
  // Screen-space marquee: a fixed-position div the drag paints, then every piece whose projected
  // centre lands inside joins the selection (replace, or add when Shift-held).
  const _selV = new THREE.Vector3();
  function showMarquee(x0, y0, x1, y1) {
    const el = byId('marquee');
    if (!el) return;
    const c = selColor();
    el.style.borderColor = c;
    el.style.background = c + '24'; // my colour + ~14% alpha (8-digit hex)
    el.style.left = Math.min(x0, x1) + 'px';
    el.style.top = Math.min(y0, y1) + 'px';
    el.style.width = Math.abs(x1 - x0) + 'px';
    el.style.height = Math.abs(y1 - y0) + 'px';
    el.hidden = false;
  }
  function hideMarquee() {
    const el = byId('marquee');
    if (el) el.hidden = true;
  }
  function finalizeMarquee(x0, y0, x1, y1, add) {
    if (!add) clearSelection();
    const rect = canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1),
      maxX = Math.max(x0, x1),
      minY = Math.min(y0, y1),
      maxY = Math.max(y0, y1);
    for (const [id, entry] of meshes) {
      if (PHYS[entry.type].mass <= 0) continue; // skip static boards
      _selV.copy(entry.mesh.position).project(camera);
      if (_selV.z > 1) continue; // behind the camera
      const sx = rect.left + (_selV.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-_selV.y * 0.5 + 0.5) * rect.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) selection.add(id);
    }
  }
  // Selection batch-op bar: touch-accessible equivalents of the U/G/R/F/H/Delete group keys.
  // Rotation lives in the edge clusters; recolor is built by refreshSelTools.
  function bindActions() {
    const send = (msg) => () => {
      const room = getRoom();
      if (room && selection.size) room.send(msg, { ids: [...selection] });
    };
    const on = (id, fn) => {
      const el = byId(id);
      if (el) el.onclick = fn;
    };
    on('selStand', send('setStandGroup'));
    on('selSnap', send('setSnapGroup'));
    on('selFlip', send('flipGroup'));
    on('sel2Sided', send('setOpenGroup'));
    on('selRoll', send('rollGroup'));
    on('selTake', send('takeGroup'));
    const compose = (msg) => () => {
      const room = getRoom();
      if (room && selection.size) {
        room.send(msg, { ids: [...selection] });
        clearSelection();
      }
    };
    on('selCombine', compose('combineIntoDeck'));
    on('selGather', () => {
      const room = getRoom();
      const plan = gatherPlan(selectedPieces());
      if (room && selection.size && plan.state === 'ok' && plan.msg) {
        room.send(plan.msg, { ids: [...selection] });
        clearSelection();
      }
    });
    on('selDelete', () => {
      const room = getRoom();
      if (room && selection.size) {
        room.send('removeGroup', { ids: [...selection] });
        clearSelection();
      }
    });
    on('selClear', () => clearSelection());
  }

  function bindModeControls() {
    document
      .querySelectorAll('.selectTool')
      .forEach((b) => (b.onclick = () => setSelMode(!selMode)));
  }
  function beginPointer(e, id) {
    if (!e.primary || !((e.additive && !e.rotate) || selMode)) return false;
    selGesture = true;
    if (id) selToggle(id);
    else {
      marquee = { sx: e.clientX, sy: e.clientY, add: e.additive || selMode };
      showMarquee(e.clientX, e.clientY, e.clientX, e.clientY);
    }
    return true;
  }
  function movePointer(e) {
    if (!marquee) return false;
    showMarquee(marquee.sx, marquee.sy, e.clientX, e.clientY);
    return true;
  }
  function endPointer(e) {
    if (!selGesture) return false;
    if (marquee) {
      finalizeMarquee(marquee.sx, marquee.sy, e.clientX, e.clientY, marquee.add);
      hideMarquee();
      marquee = null;
    }
    selGesture = false;
    return true;
  }
  function escape() {
    if (selMode) setSelMode(false);
    else if (selection.size) clearSelection();
    else return false;
    return true;
  }
  function sendBatch(msg, extra = {}, clear = false) {
    const room = getRoom();
    if (!room || !selection.size) return false;
    room.send(msg, { ids: [...selection], ...extra });
    if (clear) clearSelection();
    return true;
  }
  function command(key) {
    const msg = {
      u: 'setStandGroup',
      g: 'setSnapGroup',
      r: 'rollGroup',
      f: 'flipGroup',
      h: 'takeGroup',
    }[key.toLowerCase()];
    if (msg) return sendBatch(msg);
    if (key === '[' || key === ']') return sendBatch('rotateGroup', { dir: key === '[' ? -1 : 1 });
    return false;
  }
  return {
    get size() {
      return selection.size;
    },
    ids: () => [...selection],
    has: (id) => selection.has(id),
    remove: (id) => selection.delete(id),
    clear: clearSelection,
    cancel: () => {
      marquee = null;
      selGesture = false;
      hideMarquee();
      setSelMode(false);
      clearSelection();
    },
    isActive: () => selMode,
    escape,
    command,
    removeSelected: () => sendBatch('removeGroup', {}, true),
    beginPointer,
    movePointer,
    endPointer,
    update: updateSelectionRings,
    bindModeControls,
    bindActions,
  };
}
