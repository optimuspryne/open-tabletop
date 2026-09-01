// public/clicks.js — what a completed click means.
//
// Pure, so the policy can be tested without a room, a renderer or a browser. client.js owns the
// consequences (open the menu, send the verb, defer for a double); this file owns the decision.

/**
 * Route a click that never became a drag.
 *
 * @param type        the piece kind ('card', 'die', 'deck', 'prop', 'dispenser', 'board')
 * @param secondary   true for a right-click / the touch long-press
 * @param inspectable whether this kind can be inspected up close (INSPECTABLE in client.js)
 * @returns 'menu'   open the piece's menu
 *          'verb'   fire the kind's single click action immediately
 *          'double' a verb that must wait, in case a second click makes it a double
 *
 * Right-click means "show me this piece's menu" for every kind but a card. A card's whole
 * vocabulary is take / move / flip, so a menu there is more work than the gesture it replaces —
 * every other kind has verbs that were otherwise keys-only, and a prop or a board had no
 * right-click action at all.
 */
export function clickRoute(type, secondary, inspectable) {
  if (secondary) return type === 'card' ? 'verb' : 'menu';
  return inspectable || type === 'deck' ? 'double' : 'verb';
}
