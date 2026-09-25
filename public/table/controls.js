// public/table/controls.js — the input seam.
//
// Device PROFILES translate raw input (mouse buttons + wheel today; touch and, later,
// a gamepad) into a small, device-agnostic INTENT vocabulary. table/input-router.js
// dispatches the intents to feature controllers in the current mode. Adding a device =
// a new profile that raises the same intents, with no change in the semantic router.
//
// Intent vocabulary (Phase 0 — the mouse + keyboard reference profile):
//   press / move / release     the pointer lifecycle: grab/deal, marquee, overlay + modal
//                              drags, and click classification. Carries a logical pointer whose
//                              primary / secondary / additive flags stand in for button / shift;
//                              rotate / fineRotate describe the desktop Alt-drag gesture.
//   command(key)               a keyboard command: Esc-exits, batch ops, per-piece verbs, ping.
//   raiseAxis(dir)             raise (+1) / lower (-1) the held piece one step.
//   rotateAxis(dir)            turn the selection (or held piece) one small step, either way.
//   rotateHeld(radians)        turn the held piece by a raw angle (the profile does not snap).
//   panCamera(right, forward)  translate the idle desktop camera relative to its current view.
//   doubleClick(pt) -> bool    double-activation on the board (whiteboard claim); true if consumed.
//   snapHeld() / ping(pt)      middle-click: rotate held / highlight object or ping empty table.
//   hasHeld() -> bool          is a piece held? (a profile uses this to disambiguate a control).
//   hasAxisTarget(name)        should WASD/arrows transform an object, or pan the camera?
//
// A profile passes screen coords / semantic flags only; the router and its controllers own 3D projection and
// what each intent MEANS in the current mode. Touch and gamepad are additive sibling profiles.

const pt = (e) => ({ x: e.clientX, y: e.clientY });

// A device-agnostic "logical pointer": exactly the fields the semantic dispatcher reads.
// `button`/`shiftKey` pass through raw on mouse; a touch profile will synthesize them
// (e.g. long-press → button 2, the Select tool → shiftKey). No event METHODS are exposed
// because the dispatcher bodies don't call any.
const logical = (e) => ({
  clientX: e.clientX,
  clientY: e.clientY, // helpers (setPointer / overlayPoint) read these
  primary: e.button === 0, // left-click / tap
  secondary: e.button === 2, // right-click / (touch) long-press
  additive: e.shiftKey, // multi-select add/toggle ((touch) the Select tool)
  rotate: e.altKey, // Alt while dragging a held piece → horizontal rotation
  fineRotate: e.altKey && e.shiftKey, // Shift+Alt bypasses the normal angle snap
  pointerId: e.pointerId, // for pointer capture on the canvas
  touch: e.pointerType === 'touch', // so client.js can show touch-only affordances (height control)
  transforming: false, // set true while a two-finger twist/pinch owns the held piece
});

// A device-agnostic key command: exactly the fields the command router reads.
const logicalKey = (e) => ({
  key: e.key,
  shiftKey: !!e.shiftKey,
  repeat: e.repeat,
  preventDefault: () => e.preventDefault(),
});

// Flat drawing input: pen strokes, explicit pan, wheel zoom and two-finger view transforms.
// A pinch cancels the unfinished stroke and suppresses drawing until all fingers lift.
export function attachDrawingControls(canvas, intents) {
  const pointers = new Map();
  let owner = null,
    mode = null,
    last = null,
    gesture = null,
    space = false;
  const point = (event) => [event.clientX, event.clientY];
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return {
      center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])),
    };
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (owner !== null && event.pointerType !== 'touch') return;
    if (mode && mode !== 'gesture' && !pointers.has(owner)) return;
    if (event.pointerType === 'touch' && pointers.size && mode !== 'gesture' && !last?.touch)
      return;
    if (!pointers.size) canvas.focus();
    pointers.set(event.pointerId, point(event));
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (pointers.size >= 2) {
      if (mode === 'draw') intents.cancel();
      mode = 'gesture';
      gesture = pair();
      return;
    }
    if (mode === 'gesture') return;
    owner = event.pointerId;
    last = { point: point(event), touch: event.pointerType === 'touch' };
    mode = event.button === 1 || space || intents.isPanning?.() ? 'pan' : 'draw';
    if (mode === 'draw' && !intents.press(logical(event))) mode = 'pan';
  });
  const move = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point(event));
    if (mode === 'gesture') {
      if (pointers.size < 2) return;
      const next = pair();
      intents.transform?.(gesture.center, next.center, next.distance / gesture.distance);
      gesture = next;
    } else if (owner === event.pointerId) {
      if (mode === 'draw') intents.move(logical(event));
      else intents.transform?.(last.point, point(event), 1);
      last.point = point(event);
    }
  };
  canvas.addEventListener('pointermove', move);
  const finish = (event, cancelled) => {
    if (!pointers.has(event.pointerId)) return;
    if (mode === 'draw' && owner === event.pointerId) {
      if (cancelled) intents.cancel();
      else {
        move(event);
        intents.release(logical(event));
      }
    }
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      owner = mode = gesture = last = null;
    } else if (mode === 'gesture' && pointers.size >= 2) gesture = pair();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', (event) => finish(event, false));
  canvas.addEventListener('pointercancel', (event) => finish(event, true));
  canvas.addEventListener('lostpointercapture', (event) => finish(event, true));
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (!pointers.size)
        intents.transform?.(
          point(event),
          point(event),
          Math.exp(
            -Math.max(
              -200,
              Math.min(
                200,
                event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1),
              ),
            ) * 0.002,
          ),
        );
    },
    { passive: false },
  );
  const host = canvas.closest('dialog') || canvas;
  host.addEventListener('keydown', (event) => {
    if (event.target === canvas && !pointers.size && intents.command?.(logicalKey(event))) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === ' ' && event.target === canvas) {
      space = true;
      event.preventDefault();
    }
  });
  host.addEventListener('keyup', (event) => {
    if (event.key === ' ') space = false;
  });
  canvas.addEventListener('blur', () => {
    space = false;
    intents.blur?.();
  });
  return {
    reset() {
      if (mode === 'draw') intents.cancel();
      const ids = [...pointers.keys()];
      pointers.clear();
      owner = mode = gesture = last = null;
      space = false;
      for (const id of ids) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    },
  };
}

// Touch double-tap. WebKit does not synthesize a `dblclick` from a double-tap (Chrome
// does), so on iOS/iPadOS the whiteboard claim was simply unreachable. The touch profile
// raises the same doubleClick intent itself; the native handler stands down when the last
// pointer was a finger, so Chrome doesn't fire both.
const DOUBLE_TAP_MS = 300; // the second tap must land within this
const DOUBLE_TAP_SLOP = 30; // ...and this close to the first
const TAP_SLOP = 10; // finger drift that still counts as a tap rather than a drag

const LONG_PRESS_MS = 500; // touch: hold a finger still this long → a secondary press (context menu)
const LONG_PRESS_SLOP = 6; // px of finger drift before the hold becomes a drag; matches the grab threshold (CONFIG.input.dragPx) so any move that grabs also cancels the hold

// Two-finger transform (iPad is the target device). While a piece is held, a second finger turns
// the gesture into a photo-editor style transform: the ANGLE between the fingers rotates the
// piece, the DISTANCE between them raises and lowers it. Both are free because the camera is
// already disabled while a piece is held, so two fingers are not pan/dolly here.
//
// No dead zone is needed on the twist: client.js snaps to 15°, so a stray finger has to turn
// more than 7.5° before anything is sent. The pinch quantises here instead, one height step per
// PINCH_PX_PER_STEP of spread — ~16 steps over the grab range, which is roughly a full
// open-hand pinch across an iPad.
const PINCH_PX_PER_STEP = 28;
const TWIST_MIN_SPREAD = 24; // fingers closer than this give a noisy angle — ignore the twist

// Contextual axis keys: with a held piece (or, for rotation, a selection) they mirror the ⟲ / ⟳
// and ▲ / ▼ buttons at those controls' tick rates. With no compatible object target they pan the
// camera continuously. Held rather than tapped, so neither path goes through the one-shot
// `command` bus.
const AXIS_KEYS = {
  // object intent, direction, repeat ms, camera-right, camera-forward
  a: ['rotateAxis', -1, 60, -1, 0],
  arrowleft: ['rotateAxis', -1, 60, -1, 0],
  d: ['rotateAxis', 1, 60, 1, 0],
  arrowright: ['rotateAxis', 1, 60, 1, 0],
  w: ['raiseAxis', 1, 120, 0, 1],
  arrowup: ['raiseAxis', 1, 120, 0, 1],
  s: ['raiseAxis', -1, 120, 0, -1],
  arrowdown: ['raiseAxis', -1, 120, 0, -1],
};
// Keystrokes belong to a focused field, not the table. the command router makes the same
// check for its own shortcuts; this path never reaches it, so it has to ask too.
const typingInAField = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

// The reference profile: mouse + wheel. Reproduces the pre-seam bindings exactly.
// (Touch and gamepad become sibling profiles that raise the same intents.)
export function attachControls(dom, intents) {
  dom.style.touchAction = 'none'; // the input layer owns touch here — no browser scroll/zoom/double-tap hijack
  dom.addEventListener('contextmenu', (e) => e.preventDefault()); // right-click is ours

  dom.addEventListener('mousedown', (e) => {
    // middle button: snap held / attention intent (object highlight or table ping)
    if (e.button !== 1) return;
    e.preventDefault();
    if (intents.hasHeld()) intents.snapHeld();
    else intents.ping(pt(e));
  });

  dom.addEventListener(
    'wheel',
    (e) => {
      // raise/lower a held piece
      if (!intents.hasHeld()) return; // not holding → let the camera zoom
      e.preventDefault();
      intents.raiseAxis(-Math.sign(e.deltaY)); // wheel up = raise
    },
    { passive: false },
  );

  let lastPointerType = 'mouse';
  let tapX = 0,
    tapY = 0, // where the current finger went down
    prevTapAt = 0,
    prevTapX = 0,
    prevTapY = 0; // the previous completed tap

  dom.addEventListener('dblclick', (e) => {
    // double-click the board to claim it
    if (lastPointerType === 'touch') return; // a finger's double-tap is raised in onUp
    if (intents.doubleClick(pt(e))) e.preventDefault();
  });

  // Pointer lifecycle → press / move / release. client.js keeps all its modal routing;
  // it just receives a logical pointer instead of the raw event. On touch, a finger held
  // still (no drag) escalates to secondaryPress → the context menu; mouse keeps right-click,
  // so a mouse hold never springs a menu.
  let lpTimer = null,
    lpX = 0,
    lpY = 0;
  const cancelLong = () => {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = null;
    }
  };

  // Live fingers on the canvas, and the transform (if any) that two of them own.
  const touches = new Map(); // pointerId → { x, y }
  let xf = null; // { a, b, angle, dist, pinch } while a two-finger transform runs

  const beginTransform = () => {
    const [a, b] = [...touches.keys()];
    const pa = touches.get(a),
      pb = touches.get(b);
    xf = {
      a,
      b,
      angle: Math.atan2(pb.y - pa.y, pb.x - pa.x),
      dist: Math.hypot(pb.x - pa.x, pb.y - pa.y),
      pinch: 0, // px of spread banked toward the next height step
    };
  };

  const updateTransform = () => {
    const pa = touches.get(xf.a),
      pb = touches.get(xf.b);
    if (!pa || !pb) return;
    const dx = pb.x - pa.x,
      dy = pb.y - pa.y,
      dist = Math.hypot(dx, dy),
      angle = Math.atan2(dy, dx);

    // Twist → rotation. Screen y grows downward, so atan2 increases CLOCKWISE on screen, while a
    // positive server angle turns the piece counter-clockwise from above — hence the negation, so
    // the piece follows the fingers. (If it ever reads backwards, this sign is the whole fix.)
    if (dist >= TWIST_MIN_SPREAD) {
      let d = angle - xf.angle;
      while (d > Math.PI) d -= 2 * Math.PI; // unwrap across ±π so a twist through the
      while (d < -Math.PI) d += 2 * Math.PI; // seam doesn't spin the long way round
      if (d) intents.rotateHeld(-d);
    }
    xf.angle = angle;

    // Pinch → height, one step per PINCH_PX_PER_STEP of spread. Banking the remainder means a
    // slow pinch still accumulates instead of being rounded away.
    xf.pinch += dist - xf.dist;
    xf.dist = dist;
    while (xf.pinch >= PINCH_PX_PER_STEP) {
      intents.raiseAxis(1);
      xf.pinch -= PINCH_PX_PER_STEP;
    }
    while (xf.pinch <= -PINCH_PX_PER_STEP) {
      intents.raiseAxis(-1);
      xf.pinch += PINCH_PX_PER_STEP;
    }
  };

  dom.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType || 'mouse';
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A second finger arriving while a piece is held is a transform, not a press: it must not
      // grab a second piece, open a marquee, or arm a long-press. Third and later fingers are
      // inert for the same reason.
      if (xf) return;
      if (touches.size === 2 && intents.hasHeld()) {
        cancelLong();
        beginTransform();
        return;
      }
    }
    intents.press(logical(e));
    if (e.pointerType === 'touch') {
      tapX = lpX = e.clientX;
      tapY = lpY = e.clientY;
      cancelLong();
      lpTimer = setTimeout(() => {
        lpTimer = null;
        intents.secondaryPress({ x: lpX, y: lpY });
      }, LONG_PRESS_MS);
    }
  });
  dom.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId))
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (xf) {
      cancelLong();
      updateTransform();
      // Only the grabbing finger still reports; `transforming` tells client.js to hold the piece
      // where it is, so a twist turns it instead of dragging it across the felt.
      if (e.pointerId === xf.a) intents.move({ ...logical(e), transforming: true });
      return;
    }
    if (lpTimer && Math.hypot(e.clientX - lpX, e.clientY - lpY) >= LONG_PRESS_SLOP) cancelLong();
    intents.move(logical(e));
  });
  const onUp = (e) => {
    cancelLong();
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (xf) {
      // Lifting either finger ends the transform. The partner's lift is swallowed entirely —
      // releasing on it would drop the piece the other finger is still holding — while the
      // grabbing finger falls through to the normal release.
      const wasPartner = e.pointerId === xf.b;
      xf = null;
      if (wasPartner) return;
    }
    intents.release(logical(e)); // release first, mirroring the native pointerup → dblclick order
    if (e.type !== 'pointerup' || e.pointerType !== 'touch') return;
    if (Math.hypot(e.clientX - tapX, e.clientY - tapY) >= TAP_SLOP) {
      prevTapAt = 0; // that was a drag, not a tap — it cannot open a double
      return;
    }
    const now = e.timeStamp || performance.now();
    const near = Math.hypot(e.clientX - prevTapX, e.clientY - prevTapY) < DOUBLE_TAP_SLOP;
    if (prevTapAt && now - prevTapAt < DOUBLE_TAP_MS && near) {
      prevTapAt = 0; // consumed, so a third tap starts a fresh pair
      intents.doubleClick({ x: e.clientX, y: e.clientY });
    } else {
      prevTapAt = now;
      prevTapX = e.clientX;
      prevTapY = e.clientY;
    }
  };
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);

  // keydown → command (keyboard profile). client.js's handler is the command router;
  // touch / gamepad profiles will raise the same commands from menu items / buttons.
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase(),
      axis = AXIS_KEYS[key];
    if (axis) {
      // An axis key is never also a command, whatever else is true of it — the OS auto-repeat
      // sends a stream of keydowns while one is held, and every one of them would otherwise
      // reach the command router.
      if (typingInAField()) return; // ...and preventDefault here would eat the character
      e.preventDefault(); // arrows would otherwise scroll whatever pane has focus
      // The auto-repeat is not usable as a tick either: its delay and rate are per-machine
      // settings. We run our own interval, so a repeat for a key already held is simply dropped.
      if (axisTimers.has(key)) return;
      const [name, dir, objectMs, panRight, panForward] = axis;
      const objectAxis = intents.hasAxisTarget(name);
      const tick = objectAxis
        ? () => intents[name](dir)
        : () => intents.panCamera(panRight, panForward);
      tick();
      axisTimers.set(key, setInterval(tick, objectAxis ? objectMs : 16));
      return;
    }
    intents.command(logicalKey(e));
  });
  window.addEventListener('keyup', (e) => stopAxis(e.key.toLowerCase()));
  // A key held while the window loses focus never sees its keyup, and the interval would run
  // forever. Losing focus stops every axis.
  addEventListener('blur', () => [...axisTimers.keys()].forEach(stopAxis));
}

const axisTimers = new Map(); // key → interval id, one per physically held key
const stopAxis = (key) => {
  const iv = axisTimers.get(key);
  if (iv === undefined) return;
  clearInterval(iv);
  axisTimers.delete(key);
};
