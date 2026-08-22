// public/controls.js — the input seam.
//
// Device PROFILES translate raw input (mouse buttons + wheel today; touch and, later,
// a gamepad) into a small, device-agnostic INTENT vocabulary. public/client.js
// implements the intents and decides what each one MEANS in the current mode; it
// never reads a raw DOM event or a button number itself. Adding a device = a new
// profile that raises the same intents, with no change in client.js.
//
// Intent vocabulary (grows across Phase 0):
//   hasHeld()        -> bool  is a piece currently held? (a profile uses this to
//                             disambiguate a control it overloads)
//   snapHeld()                snap the held piece to the grid
//   ping(pt)                  drop an attention ping at screen point { x, y }
//   raiseAxis(dir)            raise (+1) / lower (-1) the held piece one step
//   doubleClick(pt)  -> bool  a double-activation at { x, y }; true if it was consumed
//   [0.2+] press / move / release, primaryTap, secondaryPress, inspect, rotate, command
//
// A profile passes screen coordinates only ({ x, y }); client.js owns any 3D projection.

const pt = (e) => ({ x: e.clientX, y: e.clientY });

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

  // Phase 0.2+ relocates the pointerdown / pointermove / pointerup / pointercancel
  // dispatcher and keydown here too, raising press/move/release + command/rotate.
  // Until then those listeners remain in client.js.
}
