import { reanchorOffset } from './drag.js';
import { clickRoute } from './clicks.js';
import { gridActive, gridFootprintCells, snapToCell } from '../../shared/pieces.js';
import { pieceProperty, piecePropsOf } from './piece-view.js';

// Own piece gestures and their protocol: grab/deal/dispense, throw estimation and transforms.
// The router chooses modes; the composition root reads only a small gesture summary.
export function createPieceDrag({
  THREE,
  config,
  kinds,
  meshes,
  controls,
  canvas,
  ray,
  pointer,
  camera,
  dragPlane,
  hit,
  selection,
  getRoom,
  getInspection,
  setPointer,
  openPieceMenu,
  playSfx,
  clamp,
  clock = () => performance.now(),
}) {
  const GRAB_HEIGHT = config.grab.height; // float height when a piece is first grabbed (scroll to raise/lower)
  // A finger sits ON the piece it is holding, where a cursor only points at it, so a touch grab
  // starts higher — enough to clear the fingertip without changing where anything lands. Keyed off
  // the gesture, not the device: a laptop with a touchscreen gets the right lift for each grab.
  const grabHeightFor = (touch) => GRAB_HEIGHT * (touch ? config.grab.touchLift : 1);
  const DRAG_MIN = config.grab.min,
    DRAG_MAX = config.grab.max,
    DRAG_STEP = config.grab.step;
  const DECK_DRAG_HEIGHT = config.grab.deckHeight; // dealt cards ride this high to clear the deck
  const DRAG_ROTATE_RAD_PER_PX = 0.01,
    DRAG_ROTATE_SNAP = Math.PI / 12; // Alt-drag: ~0.57°/px, snapped to 15° unless Shift is held
  const ROT_STEP = Math.PI / 24; // ~7.5° per tick for the held ⟲ / ⟳ buttons and the A/D keys

  // Turn the held piece (or the whole selection) by `raw` radians. Shared by the mouse's Alt-drag
  // dial and the touch two-finger twist, so both snap identically and neither loses sub-step
  // motion: the raw angle accumulates, and only the *applied* delta goes to the server.
  // Unsnapped mode is capped near the move send rate; snapped steps send the moment they land,
  // and the 15° quantum doubles as the dead zone that keeps a stray finger from nudging a piece.
  function applyHeldRotation(raw, fine = false) {
    const room = getRoom();
    if (!(down && down.grabbed) || !room) return;
    down.rotateRaw += raw;
    const angle = fine
        ? down.rotateRaw
        : Math.round(down.rotateRaw / DRAG_ROTATE_SNAP) * DRAG_ROTATE_SNAP,
      delta = angle - down.rotateSent,
      now = clock();
    if (Math.abs(delta) > 1e-4 && (!fine || now - down.lastRotateSent > 16)) {
      room.send('rotateGroup', { ids: down.group ? selection.ids() : [down.id], angle: delta });
      down.rotateSent = angle;
      down.lastRotateSent = now;
    }
  }
  let dragHeight = GRAB_HEIGHT;
  // XZ correction applied to the drag raycast. A two-finger transform holds the piece still while
  // the fingers travel, so when it ends the finger no longer points at the piece. Without this the
  // piece snaps to the finger — and, because that jump lands inside the throw estimator's window,
  // gets flung at the speed of the jump. Re-anchoring keeps the piece put and preserves the offset
  // for the rest of the drag.
  const dragOffset = new THREE.Vector3();
  const prevTarget = new THREE.Vector3(),
    throwVel = new THREE.Vector3(); // hand speed → throw velocity
  let lastMoveSent = 0,
    prevThrowTime = 0,
    down = null;
  let armedMove = null; // touch: a piece id whose next drag repositions it (the deck/dispenser "Move" menu item) instead of dealing
  const sfxKind = (t) =>
    t === 'card' ? 'card' : t === 'die' ? 'die' : t === 'deck' ? 'deck' : 'object'; // pickup family

  const heldTarget = new THREE.Vector3();
  // Whether a piece carries the per-piece snap-to-grid flag (like keep-upright).
  const pieceSnap = (id) => {
    const piece = getRoom()?.state.pieces.get(id);
    return piece ? !!pieceProperty(piece, 'snap', false) : false;
  };
  // The authored N×N grid footprint for a piece (1 for every legacy/ordinary piece).
  const pieceCells = (id) => {
    const piece = getRoom()?.state.pieces.get(id);
    return piece ? gridFootprintCells(piecePropsOf(piece)) : 1;
  };
  // Is this piece a TILE (a card/deck carrying a `tile` kind)? Drives tile-vs-card pickup sounds.
  const pieceIsTile = (id) => {
    const piece = getRoom()?.state.pieces.get(id);
    return piece ? !!pieceProperty(piece, 'tile', false) : false;
  };
  // The drag target to actually send: snapped to the nearest cell for a snap-flagged piece
  // on an active grid (so it tracks cell-to-cell as you drag), else the raw cursor point.
  const snapXZ = (x, z) =>
    down && down.snap && gridActive(getRoom().state.scale)
      ? snapToCell(x, z, getRoom().state.scale, down.cells)
      : { x, z };

  // Adoption must read the current gesture when the server responds, including after release.
  function bindRoom(room) {
    room.onMessage('dealt', ({ id }) => {
      // a card you dragged off a deck — adopt it as the dragged piece
      if (down && down.pendingDeal) {
        down.id = id;
        down.type = down.adoptType || 'card'; // 'card' from a deck, 'prop' from a dispenser
        down.kind = kinds[down.type];
        down.grabbed = true;
        down.pendingDeal = false;
        room.send('move', { id, x: hit.x, y: hit.y, z: hit.z });
      } else {
        room.send('release', { id, v: [0, 0, 0] }); // gesture already ended — just drop it
      }
    });
  }

  // Map a click-action name to the server message it sends.
  const sendAction = (action, id) => {
    const room = getRoom();
    if (action === 'takeCard') {
      room.send('takeCard', { id });
      playSfx(pieceIsTile(id) ? 'tile-pickup' : 'card-pickup');
    } else if (action === 'drawToHand') {
      room.send('drawToHand', { deckId: id });
      playSfx(pieceIsTile(id) ? 'tile-pickup' : 'card-pickup');
    } else if (action === 'deal') room.send('dealToTable', { deckId: id });
    else if (action === 'dispense') {
      room.send('dispense', { id });
      playSfx('object-pickup');
    } else if (action === 'flip') room.send('flip', { id });
    else if (action === 'shuffle') room.send('shuffle', { deckId: id });
    else if (action === 'roll') room.send('rollOne', { id });
  };

  // Handle a click (no drag). A left-click on an inspectable piece or a deck waits
  // briefly for a possible double-click (inspect / draw); everything else fires now.
  function handleClick(gesture) {
    const { id, type } = gesture;

    // Right-click raises the piece's menu — the same list the touch long-press builds — for every
    // kind BUT a card. A card's whole vocabulary is take / move / flip, so a menu is more work than
    // the gesture it replaces. Everything else has verbs that were otherwise keys-only or
    // undiscoverable, and a prop or a board had no right-click action at all (KIND gives them no
    // `rclick`), so the menu is what right-click means there now.
    //
    // A right-DRAG is unaffected: handleClick only runs when the gesture never became a drag, so a
    // deck or dispenser still moves on right-drag. The menu also absorbs the two deck shortcuts it
    // replaces — Shuffle was the single right-click, Split the double — which is why secondary no
    // longer takes part in the deferred double-click below.
    const route = clickRoute(type, gesture.secondary, getInspection().isInspectable(type));
    if (route === 'menu') {
      openPieceMenu(id, { x: gesture.sx, y: gesture.sy });
      return;
    }
    if (route === 'verb') {
      sendAction(gesture.primary ? gesture.kind.lclick : gesture.kind.rclick, id);
      return;
    }

    getInspection().handleDeferredClick(id, type, gesture.kind.lclick);
  }
  function press(e, id, wasArmed) {
    const type = meshes.get(id).type;
    // A left-drag on a SELECTED piece moves the whole selection; dragging an unselected piece drops
    // the selection first (design-tool convention). Right-drag (decks) is never a group move.
    const group = e.primary && selection.has(id);
    if (e.primary && !selection.has(id)) selection.clear();
    down = {
      id,
      type,
      kind: kinds[type],
      touch: e.touch,
      forceMove: wasArmed === id,
      primary: e.primary,
      secondary: e.secondary,
      sx: e.clientX,
      sy: e.clientY,
      dragging: false,
      grabbed: false,
      snap: pieceSnap(id),
      cells: pieceCells(id),
      group,
      rotateOnPress: e.rotate,
      rotating: false,
      rotateX: e.clientX,
      rotateRaw: 0,
      rotateSent: 0,
      lastRotateSent: 0,
      transformed: false,
    };
    dragOffset.set(0, 0, 0); // each grab starts anchored to its own finger
    controls.enabled = false; // this gesture belongs to the piece
    dragHeight = grabHeightFor(e.touch); // the lift offset; XZ tracks the fixed ground plane
    canvas.setPointerCapture(e.pointerId);
  }
  function move(e) {
    const room = getRoom();
    if (!down) return;
    // Once a touch owns a piece, aim the drag ray above the fingertip so the hand never hides the
    // object or its exact drop point. The initial hit-test still happens directly under the finger.
    setPointer(e, down.touch ? config.input.touchLeadPx : 0);
    ray.setFromCamera(pointer, camera);
    ray.ray.intersectPlane(dragPlane, hit);
    hit.y = dragHeight; // XZ from the fixed ground plane; height is the independent lift offset
    if (down.grabbed) {
      hit.x += dragOffset.x; // zero until a two-finger transform re-anchors the drag
      hit.z += dragOffset.z;
    }

    // First move past the click threshold decides what this drag means.
    if (!down.dragging) {
      if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) < config.input.dragPx) return; // still a click
      down.dragging = true;
      const kind = down.kind;
      const movesThis = down.forceMove || (kind.grab === 2 ? down.secondary : down.primary); // this kind's move button — or an armed touch "Move"
      if (movesThis) {
        // the button that moves this kind (2 = deck, 0 = most)
        down.grabbed = true;
        heldTarget.copy(hit);
        prevTarget.copy(hit);
        prevThrowTime = clock();
        throwVel.set(0, 0, 0);
        if (down.group)
          room.send('grabGroup', { ids: selection.ids(), anchor: down.id }); // claim the whole selection
        else room.send('grab', { id: down.id });
        playSfx(
          pieceIsTile(down.id)
            ? down.type === 'deck'
              ? 'tiledeck-pickup'
              : 'tile-pickup'
            : sfxKind(down.type) + '-pickup',
        ); // local, per object type (tiles/tile-boxes get their own)
        {
          const t = snapXZ(hit.x, hit.z);
          if (down.group) room.send('moveGroup', { x: t.x, y: hit.y, z: t.z });
          else room.send('move', { id: down.id, x: t.x, y: hit.y, z: t.z });
        }
      } else if (down.primary && (kind.ldrag === 'deal' || kind.ldrag === 'dispense')) {
        // Left-drag spawns one item and carries it out: a card off a deck, or a chip/stone
        // off a dispenser. Both reuse the server's "adopt the spawned piece" flow (see 'dealt').
        const dealing = kind.ldrag === 'deal';
        down.pendingDeal = true;
        down.adoptType = dealing ? 'card' : 'prop'; // what the carried piece becomes on adoption
        dragHeight = DECK_DRAG_HEIGHT; // lift above the source so the new piece doesn't fight its collider
        ray.setFromCamera(pointer, camera);
        ray.ray.intersectPlane(dragPlane, hit);
        hit.y = dragHeight;
        heldTarget.copy(hit);
        prevTarget.copy(hit);
        prevThrowTime = clock();
        throwVel.set(0, 0, 0);
        if (dealing) room.send('dealDrag', { deckId: down.id, x: hit.x, y: hit.y, z: hit.z });
        else room.send('dispenseDrag', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
        playSfx(dealing ? (pieceIsTile(down.id) ? 'tile-pickup' : 'card-pickup') : 'object-pickup'); // the new piece's drop follows on release
      }
    }

    if (down.grabbed) {
      if (e.transforming) {
        // A two-finger transform owns this gesture: the twist/pinch arrive as their own intents
        // (rotateHeld / raiseAxis), so the moving finger must not also drag the piece across the
        // felt. Freeze XZ the way the Alt-drag dial does, and keep the throw estimator anchored to
        // where the piece actually is, so lifting a finger can never fling it.
        throwVel.set(0, 0, 0);
        prevTarget.copy(heldTarget);
        prevThrowTime = clock();
        down.transformed = true; // the next plain move must re-anchor rather than snap
        return;
      }
      if (e.rotate) {
        // Alt turns the held-piece drag into a horizontal rotation dial. Accumulate raw pointer
        // motion so snapped rotation does not lose sub-step movement; Shift exposes that raw angle.
        if (!down.rotating) {
          down.rotating = true;
          if (!down.rotateOnPress) down.rotateX = e.clientX; // Alt pressed after the grab: anchor here
        }
        const raw = (e.clientX - down.rotateX) * DRAG_ROTATE_RAD_PER_PX;
        down.rotateX = e.clientX;
        applyHeldRotation(raw, e.fineRotate);
        throwVel.set(0, 0, 0); // rotating in place should never turn into a throw on release
        prevThrowTime = clock();
        return;
      }
      down.rotating = false;
      down.rotateOnPress = false;
      if (down.transformed) {
        // The transform just ended. The fingers moved while the piece stayed put, so bank that
        // separation as an offset instead of letting the piece jump to the finger (see drag.js —
        // the jump is also what flings it, since it lands inside the throw estimator's window).
        down.transformed = false;
        const o = reanchorOffset(heldTarget, hit, dragOffset);
        dragOffset.x = o.x;
        dragOffset.z = o.z;
        hit.x = heldTarget.x;
        hit.z = heldTarget.z;
      }
      heldTarget.copy(hit);
      const now = clock(),
        dt = (now - prevThrowTime) / 1000;
      if (dt > 0 && dt < 0.1)
        throwVel.lerp(
          hit
            .clone()
            .sub(prevTarget)
            .multiplyScalar(1 / dt),
          0.4,
        ); // smooth the hand speed
      prevTarget.copy(hit);
      prevThrowTime = now;
      if (now - lastMoveSent > 16) {
        const t = snapXZ(hit.x, hit.z);
        if (down.group) room.send('moveGroup', { x: t.x, y: hit.y, z: t.z });
        else room.send('move', { id: down.id, x: t.x, y: hit.y, z: t.z });
        lastMoveSent = now;
      } // ~60Hz throttle
    }
  }
  function release() {
    const room = getRoom();
    if (!down) return false;
    if (down.grabbed) {
      const throwVector =
        down.kind.grab === 2 || down.kind.heavy ? [0, 0, 0] : [throwVel.x, throwVel.y, throwVel.z]; // decks & mats don't fly
      if (down.group) room.send('releaseGroup', { v: throwVector });
      else room.send('release', { id: down.id, v: throwVector });
    } else if (!down.dragging) {
      // a click / tap
      handleClick(down);
    }
    return true;
  }
  // Pick a piece up NOW, at the pointer, as though a move-drag had just crossed the grab threshold.
  // The menu's Move item uses this on POINTERDOWN, so you press Move and keep dragging in one
  // gesture instead of tapping Move, then finding the deck again and dragging that. The piece jumps
  // to the pointer, which is the point: you already aimed at where the menu is.
  function beginMoveFromMenu(id, e) {
    const room = getRoom();
    const entry = meshes.get(id);
    if (!entry || !room) return false;
    setPointer(e, e.pointerType === 'touch' ? config.input.touchLeadPx : 0);
    ray.setFromCamera(pointer, camera);
    if (!ray.ray.intersectPlane(dragPlane, hit)) return false;
    dragHeight = grabHeightFor(e.pointerType === 'touch');
    hit.y = dragHeight;
    down = {
      id,
      type: entry.type,
      kind: kinds[entry.type],
      touch: e.pointerType === 'touch',
      forceMove: true,
      primary: true,
      secondary: false,
      sx: e.clientX,
      sy: e.clientY,
      dragging: true, // already past the threshold: this gesture can never be read as a click
      grabbed: true,
      snap: pieceSnap(id),
      cells: pieceCells(id),
      group: false,
      rotateOnPress: false,
      rotating: false,
      rotateX: e.clientX,
      rotateRaw: 0,
      rotateSent: 0,
      lastRotateSent: 0,
      transformed: false,
    };
    dragOffset.set(0, 0, 0);
    controls.enabled = false;
    heldTarget.copy(hit);
    prevTarget.copy(hit);
    prevThrowTime = clock();
    throwVel.set(0, 0, 0);
    room.send('grab', { id });
    playSfx(pieceIsTile(id) ? 'tiledeck-pickup' : sfxKind(entry.type) + '-pickup');
    const t = snapXZ(hit.x, hit.z);
    room.send('move', { id, x: t.x, y: hit.y, z: t.z });
    // Capture on the CANVAS even though the press landed on a menu button, so the rest of the drag
    // reaches the canvas handlers.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    return true;
  }

  function rotateAxis(dir) {
    const room = getRoom();
    if (!room || getInspection().isActive()) return; // a peek/inspect view owns the keyboard
    const ids = selection.size ? selection.ids() : down && down.grabbed ? [down.id] : [];
    if (ids.length) room.send('rotateGroup', { ids, angle: dir * ROT_STEP });
  }
  function raiseAxis(dir) {
    const room = getRoom();
    if (getInspection().isActive()) return; // ...and must not also nudge a piece behind it
    if (!(down && down.grabbed)) return;
    dragHeight = clamp(dragHeight + dir * DRAG_STEP, DRAG_MIN, DRAG_MAX); // up = raise
    // Raise the piece where it already is, rather than re-deriving XZ from the pointer. Identical
    // for the wheel (the cursor is still while scrolling), and necessary for the two-finger pinch,
    // where the fingers travel but the piece is meant to stay put and only change height.
    const t = snapXZ(heldTarget.x, heldTarget.z);
    if (down.group) room.send('moveGroup', { x: t.x, y: dragHeight, z: t.z });
    else room.send('move', { id: down.id, x: t.x, y: dragHeight, z: t.z });
  }

  return {
    bindRoom,
    press,
    move,
    release,
    beginMoveFromMenu,
    sendAction,
    rotateAxis,
    raiseAxis,
    rotateHeld: (radians) => applyHeldRotation(radians),
    isActive: () => !!down,
    hasHeld: () => !!(down && down.grabbed),
    pressedId: () => down && down.id,
    current: () =>
      down && { id: down.id, type: down.type, grabbed: down.grabbed, touch: down.touch },
    clear: () => {
      down = null;
    },
    consumePress: () => {
      if (down) down.dragging = true;
    },
    armMove: (id) => {
      armedMove = id;
    },
    consumeArmedMove: () => {
      const id = armedMove;
      armedMove = null;
      return id;
    },
    snapHeld: () => {
      if (down && down.grabbed) getRoom().send('snap', { id: down.id });
    },
  };
}
