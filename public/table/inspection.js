import {
  COLORS,
  DICE_SETS,
  DICE_FINISH_FALLBACK,
  DIE_SIDES,
  OBJECT_FINISHES,
  PROPS,
  dispenserDefinition,
  objectFinish,
  readableInk,
  recolorPalette,
} from '../../shared/pieces.js';

// Owns inspection previews, their controls, deferred double-clicks, and pointer rotation.
export function createInspection({
  canInteract = () => true,
  makeBrowsePreview,
  THREE,
  scene,
  camera,
  controls,
  canvas,
  kinds,
  config,
  deviceClass,
  getRoom,
  getPieceVisual,
  setOriginalVisible,
  meshPropsOf,
  byId,
  queryAll,
  setBtnLabel,
  buildTextureChips,
  saveDiceDefault,
  clearDiceDefault,
  onReleaseHand,
  onSingleClick,
  doc = document,
  now = () => performance.now(),
  delay = setTimeout,
  cancelDelay = clearTimeout,
}) {
  let diceTextures = [];
  let finishDieRef = null;
  const refreshTextureChips = () => {
    if (finishDieRef) buildTextureChips(byId('dieTextures'), (url) => finishDieRef('custom', url));
    const group = byId('dieCustomGroup');
    if (group && !diceTextures.length) group.hidden = true;
  };
  function setDiceTextures(textures) {
    diceTextures = textures;
    refreshTextureChips();
  }
  queryAll('[data-place]').forEach((b) => (b.onclick = () => placeDrawn(b.dataset.place))); // drawn-card placement
  {
    const body = byId('inspectColorBody'),
      text = byId('inspectColorText'),
      teamBtn = byId('inspectTeamBtn');
    const commit = () => {
      if (!inspect || !inspect.origId) return;
      const b = parseInt(body.value.slice(1), 16);
      if (inspect.type === 'die') {
        const t = parseInt(text.value.slice(1), 16);
        inspect.props = { ...(inspect.props || {}), color: b, textColor: t };
        swapInspect(inspect.props); // preview on the inspected die
        getRoom().send('recolor', { id: inspect.origId, color: b, textColor: t });
      } else if (inspect.type === 'dispenser') {
        // poker/coin stack tint
        inspect.props = { ...(inspect.props || {}), color: b };
        swapInspect(inspect.props);
        getRoom().send('recolor', { id: inspect.origId, color: b });
      } else {
        // custom prop
        inspect.props = { ...(inspect.props || {}), color: b };
        swapInspect(inspect.props);
        getRoom().send('recolor', { id: inspect.origId, color: b });
      }
    };
    const toHex = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0'); // local (hexStr is defined lower — TDZ)
    // Paint the inspected die: body = color, numbers auto-contrasted for legibility. Reused by
    // the freeform body picker and the preset swatches; commits through the normal recolor path.
    const paintDie = (color) => {
      if (!inspect || inspect.type !== 'die') return;
      body.value = toHex(color);
      if (text) text.value = toHex(readableInk(color));
      commit();
    };
    const finishObject = (key, finishImg) => {
      if (
        !inspect ||
        (inspect.type !== 'die' && inspect.type !== 'prop' && inspect.type !== 'dispenser')
      )
        return;
      const isDie = inspect.type === 'die';
      const propModel = inspect.props && (PROPS[inspect.props.shape] || inspect.props.model);
      const dispSpec = inspect.props && dispenserDefinition(inspect.props);
      const dispenserModel =
        dispSpec &&
        (inspect.props.asset ||
          dispSpec.model ||
          (PROPS[dispSpec.item] && PROPS[dispSpec.item].model));
      if (!isDie && !propModel && !dispenserModel) return;
      const props = { ...(inspect.props || {}) };
      if (isDie && key === 'matte') {
        delete props.finish;
        delete props.finishImg;
      } else if (isDie && key === 'custom') {
        props.finish = 'custom';
        if (finishImg) props.finishImg = finishImg;
      } else {
        props.finish = key;
        delete props.finishImg;
      }
      inspect.props = props;
      swapInspect(props); // rebuild the inspect preview with the new look
      if (inspect.origId) {
        const extra = key === 'custom' ? { finish: key, finishImg } : { finish: key };
        getRoom().send('recolor', { id: inspect.origId, ...extra });
      }
    };
    finishDieRef = finishObject; // let a late diceList rebuild the inspector's texture chips
    if (body) {
      // live preview while dragging: props tint blunt; stacks reclone (cached, cheap)
      body.oninput = () => {
        if (!inspect) return;
        const c = parseInt(body.value.slice(1), 16);
        if (inspect.type === 'prop') tintInspect(c);
        else if (inspect.type === 'dispenser') swapInspect({ ...(inspect.props || {}), color: c });
      };
      body.onchange = () => {
        if (inspect && inspect.type === 'die' && text)
          text.value = toHex(readableInk(parseInt(body.value.slice(1), 16))); // auto-contrast numbers to the new body
        commit();
      };
    }
    if (text) text.onchange = commit; // an explicit number override still wins
    if (teamBtn)
      teamBtn.onclick = () => {
        // go bowl: black ⇄ white interior
        if (!inspect || inspect.type !== 'dispenser') return;
        const team = inspect.props.team ? 0 : 1;
        inspect.props = { ...(inspect.props || {}), team };
        teamBtn.textContent = team ? 'White' : 'Black';
        swapInspect(inspect.props);
        getRoom().send('recolor', { id: inspect.origId, team });
      };
    const swatchRow = byId('dieSwatches'); // preset body colors (the named dice sets)
    if (swatchRow)
      for (const s of DICE_SETS) {
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'swatch';
        chip.title = s.name;
        chip.style.background = toHex(s.color);
        chip.onclick = () => paintDie(s.color);
        swatchRow.appendChild(chip);
      }
    const dieFinRow = byId('dieFinishes'); // shared die / built-in-object material picker
    if (dieFinRow) {
      for (const f of OBJECT_FINISHES) {
        if (DICE_FINISH_FALLBACK[f.key] && deviceClass() === 'phone') continue; // GPU-heavy on phones
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.dataset.finish = f.key;
        chip.innerHTML = '<span class="lbl"></span>';
        chip.querySelector('.lbl').textContent = f.name;
        chip.onclick = () => finishObject(f.key);
        dieFinRow.appendChild(chip);
      }
      refreshTextureChips(); // Custom textures live in their own #dieTextures menu
    }
    const defBtn = byId('inspectDefaultBtn'); // remember this die's color as my default for its type
    if (defBtn)
      defBtn.onclick = () => {
        if (!inspect || inspect.type !== 'die' || !inspect.props) return;
        const sides = +inspect.props.sides;
        if (!DIE_SIDES.includes(sides)) return;
        const b = parseInt(byId('inspectColorBody').value.slice(1), 16); // read what's on screen now
        const t = parseInt(byId('inspectColorText').value.slice(1), 16);
        const finish = inspect.props.finish || 'matte'; // save the die's WHOLE look, not just color
        const finishImg = inspect.props.finishImg; // the custom texture, if this die wears one
        saveDiceDefault(sides, b, t, finish, finishImg); // local only — never synced
        setBtnLabel(defBtn, `Saved · d${sides}`);
        defBtn.disabled = true; // brief confirmation
        delay(() => {
          if (byId('inspectDefaultBtn') === defBtn) {
            setBtnLabel(defBtn, 'Set as my default');
            defBtn.disabled = false;
          }
        }, 1300);
      };
    const resetBtn = byId('inspectResetBtn'); // forget this type's default + plain this die
    if (resetBtn)
      resetBtn.onclick = () => {
        if (!inspect || inspect.type !== 'die' || !inspect.props) return;
        const sides = +inspect.props.sides;
        if (DIE_SIDES.includes(sides)) clearDiceDefault(sides);
        paintDie(0xf4f1ea); // back to plain ivory (ink auto)
        setBtnLabel(resetBtn, 'Reset ✓');
        delay(() => {
          if (byId('inspectResetBtn') === resetBtn) setBtnLabel(resetBtn, 'Reset');
        }, 1200);
      };
  }

  // --- Prop / dispenser recolor swatches (built per-object from the piece's allowed palette) ---
  // Recolor the inspected prop/dispenser to a freeform/palette color (preview + send).
  function recolorInspectedColor(hex) {
    if (!inspect || (inspect.type !== 'prop' && inspect.type !== 'dispenser')) return;
    const color = hex == null ? COLORS.neutralProp : hex;
    inspect.props = { ...(inspect.props || {}), color };
    if (inspect.type === 'dispenser') swapInspect(inspect.props);
    else tintInspect(color);
    const body = byId('inspectColorBody');
    if (body) body.value = hexStr(color); // keep the freeform picker in sync
    getRoom().send('recolor', { id: inspect.origId, color });
  }
  // Recolor the inspected TEAM piece by switching its set (0/1) — colors are fixed, so this
  // picks a side, not a hue. Preview uses the set's color; the server stores props.team.
  function recolorInspectedTeam(i, hex) {
    if (!inspect) return;
    inspect.props = { ...(inspect.props || {}), team: i ? 1 : 0 };
    if (inspect.type === 'dispenser') swapInspect(inspect.props);
    else tintInspect(hex);
    getRoom().send('recolor', { id: inspect.origId, team: i ? 1 : 0 });
  }
  // Rebuild the #propSwatches row for the inspected object from its allowed palette (recolorPalette):
  // a team piece gets its two set colors, a limited-palette piece (coins) gets that palette, a
  // general prop gets the full palette. Returns the descriptor so the caller can hide the freeform
  // picker when the object is constrained.
  function rebuildPropSwatches(opt) {
    const row = byId('propSwatches');
    if (row) {
      row.innerHTML = '';
      if (opt)
        opt.swatches.forEach((s, i) => {
          const chip = doc.createElement('button');
          chip.type = 'button';
          chip.className = 'swatch' + (s.hex == null ? ' neutral' : '');
          chip.title = s.name;
          if (s.hex != null) chip.style.background = hexStr(s.hex);
          chip.onclick = opt.team
            ? () => recolorInspectedTeam(i, s.hex)
            : () => recolorInspectedColor(s.hex);
          row.appendChild(chip);
        });
    }
    return opt;
  }

  // ----- inspect: freeze an enlarged item in front of the camera --------------
  // Local & visual. Two entries: (a) inspect an on-table piece by cloning its
  // scene mesh (a face-down card is back-only, so nothing leaks); (b) DRAW a card
  // from a deck, whose front the server sends privately to us alone, then place it.
  let inspect = null; // { pivot, origId, drag, drawn, placed }
  let pendingClick = null; // defers a single-click so a double-click can pre-empt it
  const INSPECTABLE = (type) =>
    type === 'die' || type === 'card' || type === 'prop' || type === 'dispenser'; // not boards/decks

  // Core inspect: park `mesh` enlarged in front of the camera. opts: { origId,
  // type, drawn }. A 'card' is stood upright; a 'drawn' card shows the action panel.
  function inspectMesh(mesh, opts = {}) {
    releaseInspect();
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.visible = true;

    // Scale to a consistent on-screen size and centre the mesh within a pivot.
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = config.inspect.fit / (Math.max(size.x, size.y, size.z) || 1);
    mesh.position.copy(center).multiplyScalar(-1);

    const pivot = new THREE.Group();
    pivot.add(mesh);
    pivot.scale.setScalar(scale);
    if (opts.type === 'card') pivot.rotateX(Math.PI / 2); // a card lies flat (face = +Y); stand it up

    if (!camera.parent) scene.add(camera); // camera must be in the graph for its children to render
    camera.add(pivot);
    pivot.position.set(0, -config.inspect.drop, -config.inspect.dist);

    inspect = {
      pivot,
      origId: opts.origId || null,
      type: opts.type,
      props: null,
      drag: null,
      drawn: !!opts.drawn,
      placed: false,
      hid: opts.hid || null,
      onClose: opts.onClose || null,
      browse: !!opts.browse,
      dispose: opts.dispose || null,
    };
    controls.enabled = false;
    byId('inspectHint').hidden = !!opts.drawn || !!opts.browse; // a drawn card shows the action panel instead
    byId('drawActions').hidden = !opts.drawn;
    {
      const db = byId('drawActions') && byId('drawActions').querySelector('[data-place="deck"]');
      if (db) db.hidden = !!opts.hid;
    } // a hand card has no deck to return to
    const piece0 = opts.origId && getRoom().state.pieces.get(opts.origId);
    const props0 = piece0 ? JSON.parse(piece0.props || '{}') : {};
    const spec = opts.type === 'dispenser' ? dispenserDefinition(props0) : null;
    const teamMode = !!(spec && spec.team); // go bowl → black/white toggle
    const colorMode =
      opts.type === 'die' ||
      (opts.type === 'prop' && props0.tintMaterial !== null) ||
      !!(spec && (spec.color || (props0.asset && props0.asset.item.tintMaterial !== null))); // freeform picker
    const colorable = (colorMode || teamMode) && !opts.drawn;
    const row = byId('inspectColorRow');
    if (row) {
      row.hidden = !colorable;
      if (colorable) {
        inspect.props = props0;
        if (opts.type === 'dispenser') inspect.props.count = piece0.count; // carry stack height into reclone previews
        const isDie = opts.type === 'die';
        const propSpec = opts.type === 'prop' ? PROPS[inspect.props.shape] : null;
        const customProp =
          opts.type === 'prop' && !!inspect.props.model && inspect.props.tintMaterial !== null;
        const dispenserModel =
          opts.type === 'dispenser' &&
          spec &&
          (props0.asset || spec.model || (PROPS[spec.item] && PROPS[spec.item].model));
        const finishSpec =
          opts.type === 'dispenser' && spec && spec.body === 'stack'
            ? PROPS[spec.item]
            : propSpec || spec;
        // A prop/dispenser's ALLOWED palette (team set / limited palette / general) — mirrors the
        // spawn cards, so an object can't be tinted off its intended colors. null for a die.
        const opt = colorMode && !isDie ? recolorPalette(opts.type, props0, spec) : null;
        rebuildPropSwatches(opt);
        const constrained = !!(opt && !opt.free); // team piece or limited palette → no freeform
        const bodyLab = byId('inspectBodyLab'),
          textLab = byId('inspectTextLab'),
          teamLab = byId('inspectTeamLab');
        if (bodyLab) bodyLab.hidden = teamMode || constrained; // hide the freeform picker when the object is constrained
        if (textLab) textLab.hidden = !isDie; // dice also get a number color
        if (teamLab) teamLab.hidden = !teamMode;
        if (colorMode && bodyLab) {
          bodyLab.firstChild.nodeValue = isDie ? 'Body ' : 'Color ';
          byId('inspectColorBody').value = hexStr(
            inspect.props.color ?? (isDie ? 0xf4f1ea : 0xffffff),
          ); // die = ivory blank face
          if (isDie) byId('inspectColorText').value = hexStr(inspect.props.textColor ?? 0x141414); // die = ink numbers
        }
        const defBtn = byId('inspectDefaultBtn'); // dice only: "make this my default d?"
        if (defBtn) {
          defBtn.hidden = !isDie;
          defBtn.disabled = false;
          setBtnLabel(defBtn, 'Set as my default');
        }
        const swRow = byId('dieSwatches');
        if (swRow) swRow.hidden = !isDie; // dice sets (dice only)
        const isModelDie = isDie && !!inspect.props.model; // a pipped .glb die: standard finishes, no custom texture
        const dcg = byId('dieCustomGroup');
        if (dcg) dcg.hidden = !isDie || isModelDie || !diceTextures.length; // Custom textures: dice only, when any exist
        const dfRow = byId('dieFinishes');
        if (dfRow) {
          const finishable = isDie || !!propSpec || customProp || !!dispenserModel;
          dfRow.hidden = !finishable;
          const cur = finishable
            ? isDie
              ? inspect.props.finish || 'matte'
              : objectFinish(finishSpec || {}, inspect.props.finish)
            : null;
          dfRow
            .querySelectorAll('[data-finish]')
            .forEach((c) => c.classList.toggle('on', c.dataset.finish === cur));
        }
        const propRow = byId('propSwatches');
        if (propRow) propRow.hidden = !(opt && opt.swatches.length); // per-object palette
        const resetBtn = byId('inspectResetBtn');
        if (resetBtn) {
          resetBtn.hidden = !isDie;
          setBtnLabel(resetBtn, 'Reset');
        }
        if (teamMode) {
          const tb = byId('inspectTeamBtn');
          if (tb) tb.textContent = inspect.props.team ? 'White' : 'Black';
        }
      }
    }
  }
  const hexStr = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  // Rebuild the inspected mesh with new props (live preview for die colors and
  // dispenser color/team). Cheap for stacks — they reclone from the cached model.
  function swapInspect(props) {
    if (
      !inspect ||
      !inspect.pivot ||
      (inspect.type !== 'die' && inspect.type !== 'prop' && inspect.type !== 'dispenser')
    )
      return;
    const old = inspect.pivot.children[0];
    if (old) inspect.pivot.remove(old);
    if (inspect.type === 'dispenser') props = { ...props, _seed: inspect.origId }; // keep the preview's scramble stable
    const mesh = kinds[inspect.type].mesh(props);
    mesh.userData.id = inspect.origId;
    inspect.pivot.add(mesh);
  }

  // Live-tint the inspected mesh (its materials are its own — see enterInspect).
  function tintInspect(color) {
    if (!inspect || !inspect.pivot) return;
    const props = inspect.props || {};
    const definition = inspect.type === 'dispenser' ? dispenserDefinition(props) : null;
    const slot =
      inspect.type === 'dispenser' && props.asset
        ? definition?.appearance === 'custom'
          ? definition.tintMaterial
          : props.asset.item.tintMaterial
        : (definition?.tintMaterial ?? props.tintMaterial);
    if (slot === null) return;
    const matches = (name) =>
      typeof slot !== 'string' ||
      (typeof name === 'string' && (name === slot || name.startsWith(slot + '.')));
    inspect.pivot.traverse((node) => {
      if (node.isMesh && node.material)
        (Array.isArray(node.material) ? node.material : [node.material]).forEach(
          (m) => matches(m.name) && m.color && m.color.setHex(color),
        );
    });
  }

  // Inspect an on-table piece by cloning its mesh (the clone respects hidden info —
  // a face-down card clones back-only), then hide the real piece behind the copy.
  function enterInspect(id) {
    const entry = getPieceVisual(id);
    if (!entry) return;
    const piece = getRoom().state.pieces.get(id);
    const fresh =
      (entry.type === 'die' || entry.type === 'prop' || entry.type === 'dispenser') && piece
        ? kinds[entry.type].mesh(meshPropsOf(piece, id)) // own materials → live-recolorable, no shared-material bleed
        : entry.mesh.clone(true); // clone respects hidden info (face-down card = back only)
    inspectMesh(fresh, { origId: id, type: entry.type });
    setOriginalVisible(id, false);
  }

  function releaseInspect() {
    if (!inspect) return;
    const wasHand = inspect.hid;
    const onClose = inspect.onClose;
    if (inspect.drawn && !inspect.placed && !inspect.hid)
      getRoom().send('inspectPlace', { where: 'deck' }); // a real drawn card closed without choosing → back to deck
    camera.remove(inspect.pivot);
    inspect.dispose?.(); // only owned browse-preview resources; normal inspections borrow theirs
    if (inspect.origId) setOriginalVisible(inspect.origId, true);
    inspect = null;
    controls.enabled = true;
    byId('inspectHint').hidden = true;
    byId('drawActions').hidden = true;
    const row = byId('inspectColorRow');
    if (row) row.hidden = true;
    onClose?.();
    if (wasHand) onReleaseHand(); // restore the hand we hid for the inspect
  }

  // Resolve a drawn card to its destination: field-up | field-down | hand | deck.
  function placeDrawn(where) {
    if (!inspect) return;
    if (inspect.hid) {
      // hand-card inspect: play with the chosen face, or keep it in hand
      if (where === 'field-up') getRoom().send('playCard', { hid: inspect.hid, faceDown: false });
      else if (where === 'field-down')
        getRoom().send('playCard', { hid: inspect.hid, faceDown: true });
      inspect.placed = true; // 'hand' just closes; 'deck' is hidden for hand cards
      releaseInspect();
      return;
    }
    if (!inspect.drawn) return;
    getRoom().send('inspectPlace', { where });
    inspect.placed = true;
    releaseInspect();
  }

  function handleDeferredClick(id, type, single) {
    const isSecondClick =
      pendingClick && pendingClick.id === id && now() - pendingClick.t < config.input.dblMs;
    if (isSecondClick) {
      cancelDelay(pendingClick.timer);
      pendingClick = null;
      if (type === 'deck') getRoom().send('drawInspect', { deckId: id });
      else enterInspect(id);
      return;
    }
    if (pendingClick) cancelDelay(pendingClick.timer);
    pendingClick = {
      id,
      t: now(),
      timer: delay(() => {
        pendingClick = null;
        onSingleClick(single, id);
      }, config.input.clickMs),
    };
  }
  const isActive = () => !!inspect;
  const isInspecting = (id) => inspect?.origId === id;
  const isDrawn = () => !!inspect?.drawn;
  function beginPointer(e) {
    if (!inspect) return false;
    if (e.primary) {
      inspect.drag = { sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    }
    return true;
  }
  function movePointer(e) {
    if (!inspect) return false;
    const drag = inspect.drag;
    if (drag) {
      const dx = e.clientX - drag.px,
        dy = e.clientY - drag.py;
      drag.px = e.clientX;
      drag.py = e.clientY;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > config.input.inspectPx)
        drag.moved = true;
      inspect.pivot.quaternion.premultiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.01, dx * 0.01, 0)),
      );
    }
    return true;
  }
  function endPointer(e) {
    if (!inspect) return false;
    const drag = inspect.drag;
    if (drag) {
      inspect.drag = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
      if (!drag.moved) releaseInspect();
    }
    return true;
  }
  function bindRoom(room) {
    room.onMessage('inspectCard', ({ front, back, tile, geom }) => {
      if (!canInteract()) return;
      inspectMesh(kinds.card.mesh({ front, back, tile, geom }), { drawn: true, type: 'card' });
    }); // drawn card — front is ours alone; tile/geom → correct proportions
  }

  return {
    bindRoom,
    cancel: () => {
      if (pendingClick) cancelDelay(pendingClick.timer);
      pendingClick = null;
      releaseInspect();
    },
    isActive,
    isInspecting,
    isDrawn,
    isInspectable: INSPECTABLE,
    inspectMesh,
    showBrowseCard(props, onClose) {
      if (inspect?.browse) inspect.onClose = null; // replacing a preview keeps the server lease
      const preview = makeBrowsePreview(props);
      inspectMesh(preview.mesh, { type: 'card', browse: true, onClose, dispose: preview.dispose });
    },
    closeBrowseCard() {
      if (inspect?.browse) {
        inspect.onClose = null;
        releaseInspect();
      }
    },
    enterInspect,
    releaseInspect,
    placeDrawn,
    handleDeferredClick,
    beginPointer,
    movePointer,
    endPointer,
    setDiceTextures,
  };
}
