// public/drag.js — pure drag-anchor math.
//
// Split out of client.js so it can be tested without a browser, a renderer, or a room: these are
// plain numbers in, plain numbers out. client.js owns when to call this; this file owns the sign.

/**
 * Re-anchor a drag whose piece and pointer have separated.
 *
 * The two-finger transform holds a piece still while the fingers travel, so when it ends the
 * pointer no longer lands on the piece. Snapping the piece to the pointer both teleports it and —
 * because that jump lands inside the throw estimator's window — flings it at the speed of the
 * jump. Instead, bank the separation as an offset that every later raycast hit carries.
 *
 * @param held   where the piece actually is  ({x, z})
 * @param hit    where this frame's raycast landed, ALREADY carrying `offset` ({x, z})
 * @param offset the offset currently in force ({x, z})
 * @returns the offset that keeps the piece put, accumulated over any previous re-anchor
 *
 * Invariant: for the raw hit that produced `hit`, rawHit + result === held. Relative motion is
 * preserved — once re-anchored, moving the pointer by d moves the piece by d.
 */
export function reanchorOffset(held, hit, offset) {
  return {
    x: offset.x + (held.x - hit.x),
    z: offset.z + (held.z - hit.z),
  };
}
