// public/controls.js — the input seam.
//
// Device PROFILES translate raw input (mouse buttons + wheel today; touch and, later,
// a gamepad) into a small, device-agnostic INTENT vocabulary. public/client.js
// implements the intents and decides what each one MEANS in the current mode; it
// never reads a raw DOM event or a button number itself. Adding a device = a new
// profile that raises the same intents, with no change in client.js.
//
// Intent vocabulary (Phase 0 — the mouse + keyboard reference profile):
//   press / move / release     the pointer lifecycle: grab/deal, marquee, overlay + modal
//                              drags, and click classification. Carries a logical pointer whose
//                              primary / secondary / additive flags stand in for button / shift.
//   command(key)               a keyboard command: Esc-exits, batch ops, per-piece verbs, ping.
//   raiseAxis(dir)             raise (+1) / lower (-1) the held piece one step.
//   doubleClick(pt) -> bool    double-activation on the board (whiteboard claim); true if consumed.
//   snapHeld() / ping(pt)      middle-click's two jobs (snap the held piece / ping the table).
//   hasHeld() -> bool          is a piece held? (a profile uses this to disambiguate a control).
//
// A profile passes screen coords / semantic flags only; client.js owns any 3D projection and
// what each intent MEANS in the current mode. Touch and gamepad are additive sibling profiles.

const pt = (e) => ({ x: e.clientX, y: e.clientY });

// A device-agnostic "logical pointer": exactly the fields client.js's dispatcher reads.
// `button`/`shiftKey` pass through raw on mouse; a touch profile will synthesize them
// (e.g. long-press → button 2, the Select tool → shiftKey). No event METHODS are exposed
// because the dispatcher bodies don't call any.
const logical = (e) => ({
  clientX: e.clientX, clientY: e.clientY, // helpers (setPointer / overlayPoint) read these
  primary: e.button === 0,                 // left-click / tap
  secondary: e.button === 2,               // right-click / (touch) long-press
  additive: e.shiftKey,                    // multi-select add/toggle ((touch) the Select tool)
  pointerId: e.pointerId,                  // for pointer capture on the canvas
});

// A device-agnostic key command: exactly the fields client.js's command router reads.
const logicalKey = (e) => ({
  key: e.key,
  repeat: e.repeat,
  preventDefault: () => e.preventDefault(),
});

// The reference profile: mouse + wheel. Reproduces the pre-seam bindings exactly.
// (Touch and gamepad become sibling profiles that raise the same intents.)
export function attachControls(dom, intents) {
  dom.addEventListener('contextmenu', (e) => e.preventDefault()); // right-click is ours

  dom.addEventListener('mousedown', (e) => {          // middle button: snap held / ping
    if (e.button !== 1) return;
    e.preventDefault();
    if (intents.hasHeld()) intents.snapHeld();
    else intents.ping(pt(e));
  });

  dom.addEventListener('wheel', (e) => {              // raise/lower a held piece
    if (!intents.hasHeld()) return;                   // not holding → let the camera zoom
    e.preventDefault();
    intents.raiseAxis(-Math.sign(e.deltaY));          // wheel up = raise
  }, { passive: false });

  dom.addEventListener('dblclick', (e) => {           // double-click the board to claim it
    if (intents.doubleClick(pt(e))) e.preventDefault();
  });

  // Pointer lifecycle → press / move / release. client.js keeps all its modal routing;
  // it just receives a logical pointer instead of the raw event. (0.3 replaces the
  // button reads inside those handlers with semantic primaryTap / secondaryPress / inspect.)
  dom.addEventListener('pointerdown',   (e) => intents.press(logical(e)));
  dom.addEventListener('pointermove',   (e) => intents.move(logical(e)));
  dom.addEventListener('pointerup',     (e) => intents.release(logical(e)));
  dom.addEventListener('pointercancel', (e) => intents.release(logical(e)));

  // keydown → command (keyboard profile). client.js's handler is the command router;
  // touch / gamepad profiles will raise the same commands from menu items / buttons.
  window.addEventListener('keydown', (e) => intents.command(logicalKey(e)));
}
