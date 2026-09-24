// Semantic intent routing. Device event translation stays in controls.js; feature state stays
// in the injected controllers. Branch order is intentional and covered by regression tests.
export function createInputRouter({
  getRoom,
  canvas,
  controls,
  selection,
  overlays,
  whiteboard,
  inspection,
  trays,
  pieces,
  setPointer,
  pickId,
  touchHitPx,
  getPieceMeshes,
  panCamera,
  openPieceMenu,
  sendPing,
  highlightPiece,
  editLabels,
  byId,
  doc = document,
}) {
  const document = doc;
  const releaseCapture = (e) => {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {}
  };
  const onPointerDown = (e) => {
    const wasArmed = pieces.consumeArmedMove(); // Move is one-shot: this press consumes it (if on that piece) or cancels it
    if (overlays.isMeasuring()) {
      // Measure mode: left-drag lays the selected overlay (A = press)
      if (overlays.beginMeasure(e)) {
        controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (whiteboard.isOwning()) {
      // drawing on the whiteboard: start a stroke
      if (e.primary) {
        setPointer(e);
        if (whiteboard.beginStroke()) canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (inspection.beginPointer(e)) return;
    if (!getRoom() || (!e.primary && !e.secondary)) return;
    setPointer(e);
    const id = pickId(e.touch ? touchHitPx : 0);
    // Multi-select gesture: the additive modifier (Shift) or the Select tool. Click a piece → toggle
    // it in/out; drag empty felt → marquee box. Consumes the gesture so it never grabs or orbits.
    if (selection.beginPointer(e, id)) {
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      pieces.clear();
      return;
    }
    if (!id) {
      // no piece under the cursor
      if (e.primary) {
        if (overlays.beginMove(e)) {
          // left-click an overlay you own (or GM) → select + drag to move
          controls.enabled = false;
          canvas.setPointerCapture(e.pointerId);
          pieces.clear();
          return;
        }
        overlays.select(null); // left-click empty felt → deselect
        selection.clear(); // …and drop any multi-selection (design-tool convention)
      }
      pieces.clear();
      return; // empty felt → let OrbitControls orbit/pan
    }
    pieces.press(e, id, wasArmed);
  };
  const onPointerMove = (e) => {
    if (selection.movePointer(e)) return;
    if (overlays.isMeasuring()) {
      // live local preview of the overlay being dragged out
      overlays.updateMeasure(e);
      return;
    }
    if (whiteboard.isOwning()) {
      // extend the current stroke along the board surface
      if (whiteboard.isDrawing()) {
        setPointer(e);
        whiteboard.extendStroke();
      }
      return;
    }
    if (inspection.movePointer(e)) return;
    if (overlays.isMoving()) {
      // dragging a selected overlay: translate both ends, synced (throttled)
      overlays.updateMove(e);
      return;
    }
    pieces.move(e);
  };
  const endGesture = (e) => {
    if (selection.endPointer(e)) {
      releaseCapture(e);
      controls.enabled = !inspection.isActive();
      return;
    }
    if (overlays.isMeasuring()) {
      // release: commit the overlay if the drag was long enough
      if (overlays.finishMeasure(e)) {
        controls.enabled = true;
        releaseCapture(e);
      }
      return;
    }
    if (whiteboard.isOwning()) {
      // finish the stroke and send it
      if (whiteboard.isDrawing()) whiteboard.endStroke();
      releaseCapture(e);
      return;
    }
    if (inspection.endPointer(e)) return;
    if (overlays.isMoving()) {
      // release a moved overlay: commit its final position
      overlays.finishMove(e);
      controls.enabled = true;
      releaseCapture(e);
      return;
    }
    if (!pieces.release(e)) return;
    controls.enabled = !inspection.isActive();
    releaseCapture(e);
    pieces.clear();
  };
  // The piece to act on for a keyboard shortcut: the held one, else whatever's hovered.
  const heldOrHoveredId = () => pieces.pressedId() || pickId();

  // Keyboard shortcuts (ignored while typing in an input). Delete/Backspace removes
  // a piece, U toggles its upright/flat behaviour, G toggles its snap-to-grid.
  // The held rotate/raise keys (A/D/W/S and the arrows) are NOT here — they repeat while
  // held, so the keyboard profile in controls.js owns them and raises rotateAxis / raiseAxis.
  const onKeyDown = (e) => {
    const room = getRoom();
    if (!room) return;
    if (e.key === 'Escape' && trays.isViewing()) {
      trays.close();
      return;
    }
    if (e.key === 'Escape' && selection.escape()) return;
    if (e.key === 'Escape' && overlays.isMeasuring()) {
      const r = byId('regionTR');
      if (r && r._close) r._close();
      else overlays.exit();
      return;
    }
    if (e.key === 'Escape' && whiteboard.isOwning()) {
      whiteboard.release();
      return;
    }
    if (e.key === 'Escape' && inspection.isActive()) {
      inspection.releaseInspect();
      return;
    }
    if (e.key === 'Escape' && overlays.hasSelection()) {
      overlays.select(null);
      return;
    }
    const typing =
      document.activeElement &&
      (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (typing) return;

    if (inspection.isDrawn()) {
      // f/d/h/r place a drawn card. This sits BELOW the typing guard: it used to sit above it, so
      // typing "d" in chat with a peek open dealt the card face-down.
      const where = { f: 'field-up', d: 'field-down', h: 'hand', r: 'deck' }[e.key.toLowerCase()];
      if (where) {
        inspection.placeDrawn(where);
        return;
      }
    }

    if (selection.command(e.key)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (e.key === 'Backspace') e.preventDefault();
      if (overlays.removeSelected()) return; // a selected overlay takes priority
      if (selection.removeSelected()) return;
      const id = heldOrHoveredId();
      if (id) {
        room.send('remove', { id });
        if (pieces.pressedId() === id) {
          pieces.clear();
          controls.enabled = true;
        }
      }
    } else if (e.key === 'u' || e.key === 'U') {
      // toggle keep-upright / lie-flat
      const id = heldOrHoveredId();
      if (id) room.send('setStand', { id });
    } else if (e.key === 'g' || e.key === 'G') {
      // toggle snap-to-grid for this piece
      const id = heldOrHoveredId();
      if (id) room.send('setSnap', { id });
    } else if ((e.key === 'l' || e.key === 'L') && !e.repeat) {
      if (!inspection.isActive() && !whiteboard.isOwning() && !overlays.isMeasuring()) {
        const id = heldOrHoveredId();
        if (id) editLabels(id);
      }
    } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
      // ping the table at the cursor
      sendPing();
    }
  };

  return {
    press: onPointerDown, // pointerdown → the dispatcher (grab/deal, marquee, overlay, modal starts)
    move: onPointerMove, // pointermove → drag routing for every mode
    release: endGesture, // pointerup / pointercancel → commit/settle the gesture
    command: onKeyDown, // keydown → the command router (Esc-exits, batch ops, per-piece verbs, ping)
    secondaryPress: (p) => {
      // touch long-press → context menu on a piece, or ping on empty felt
      if (
        !getRoom() ||
        overlays.isMeasuring() ||
        whiteboard.isOwning() ||
        inspection.isActive() ||
        selection.isActive()
      )
        return; // a modal tool owns the gesture
      const id = pieces.pressedId(); // the piece the press landed on (null on empty felt)
      pieces.consumePress(); // consume the gesture: no grab on further move, no tap on release
      if (id) openPieceMenu(id, p);
      else {
        setPointer({ clientX: p.x, clientY: p.y });
        sendPing();
      } // long-press empty felt → ping
    },
    hasHeld: pieces.hasHeld,
    // Axis keys keep their object meaning only where that action has a target. Otherwise the input
    // profile routes the same physical key to camera panning.
    hasAxisTarget: (name) =>
      name === 'raiseAxis' ? pieces.hasHeld() : pieces.hasHeld() || selection.size > 0,
    panCamera: (right, forward) => {
      if (
        !getRoom() ||
        inspection.isActive() ||
        whiteboard.isOwning() ||
        trays.isViewing() ||
        trays.isCameraMoving()
      )
        return;
      panCamera(right, forward);
    },
    // Turn the held piece by a raw angle — the device-agnostic form of the Alt-drag dial.
    // The touch profile raises it from a two-finger twist; a gamepad stick would too.
    rotateHeld: pieces.rotateHeld,
    snapHeld: pieces.snapHeld,
    ping: (p) => {
      if (
        !getRoom() ||
        inspection.isActive() ||
        whiteboard.isOwning() ||
        overlays.isMeasuring() ||
        selection.isActive()
      )
        return;
      setPointer({ clientX: p.x, clientY: p.y });
      const id = pickId();
      if (id) highlightPiece(id);
      else sendPing();
    },
    // Turn the selection (or the held piece) one small step. The continuous complement to the
    // [ / ] 45° keys, and what the ⟲ / ⟳ hold buttons and the A/D + arrow keys all drive.
    rotateAxis: pieces.rotateAxis,
    raiseAxis: pieces.raiseAxis,
    // double-click the board to own it and draw; true if a claim was sent
    doubleClick: (p) => {
      return whiteboard.claimAt(p, getPieceMeshes());
    },
  };
}
