# Gesture Surface

Every input gesture the table understands, and whether a finger can reach it. This is the
inventory the roadmap's "audit the gesture surface" bullet asks for — it exists so that a new
gesture is added with its touch story decided, not discovered later on an iPad.

Read this with `docs/REFERENCE.md` for the modules involved: `public/controls.js` owns the
device profile (raw pointer/key events → logical intents), `public/client.js` owns the intent
handlers (`press`, `release`, `secondaryPress`, `doubleClick`, `raiseAxis`, `snapHeld`, `ping`,
`command`). The point of that seam is that a touch profile can raise the same intents a mouse
does; the tables below are the ledger of how far that has gotten.

**Status key**

| | |
|---|---|
| ✅ | Reachable by touch, by a real equivalent gesture or an on-screen control |
| ⚠️ | Reachable, but by a different path with different ergonomics — worth knowing about |
| ❌ | No touch path. Mouse/keyboard only |

---

## Camera

Empty felt only — a press that hits a piece is consumed by the piece dispatcher
(`client.js:2572`) before OrbitControls sees it.

| Gesture                         | What it does                    | Touch | Status |
|---------------------------------|---------------------------------|---|---|
| Left-drag empty felt            | Orbit                           | One-finger drag | ✅ |
| Right-drag empty felt           | Pan                             | Two-finger drag | ✅ |
| Wheel (nothing held)            | Zoom                            | Two-finger pinch | ✅ |
| Interactions → ↩ My Seat        | Camera back to your seat        | Same button | ✅ |
| Interactions → Bird's Eye View  | Camera directly above the table | Same button | ✅ |
| Interactions → 🔎 Lean In / Out | Nudge the view in/out           | Same buttons | ✅ |

OrbitControls is constructed with defaults (`core.js:52`) apart from `maxPolarAngle` and damping,
so the touch bindings above are three.js's own: one finger rotates, two dolly and pan.

## Pieces

| Gesture | What it does | Touch | Status |
|---|---|---|---|
| Left-hold + drag | Pick up, move, release to drop/throw | Finger drag | ✅ |
| Wheel while holding | Raise / lower the held piece | Two-finger **pinch** while holding, or `.holdControls` ▲ / ▼ | ✅ |
| Alt + drag while holding | Rotate the held piece in 15° steps | Two-finger **twist** while holding | ✅ |
| Alt + Shift + drag | Smooth (unsnapped) rotation | ⟲ / ⟳ hold buttons (~7.5°/tick, continuous) | ⚠️ |
| Middle-click while holding | Rotate the held piece's facing to the next 45° step | Twist (15° steps, not 45°) | ⚠️ |
| Middle-click empty felt | Ping everyone | Long-press empty felt (`client.js:4977`) | ✅ |
| Double-left-click | Inspect up close | Double-tap | ✅ |
| Right-click a piece | Context verbs | Long-press → radial menu | ✅ |
| `Delete` / `Backspace` | Remove held-or-hovered piece | Radial → **Delete** | ✅ |
| `U` | Stand upright / lay flat | Radial → **Stand / lay flat** | ✅ |
| `G` | Toggle snap-to-grid | Radial → **Snap to grid** | ✅ |

**Long-press → radial menu** (`pieceMenuItems`, `client.js:4871`) is the workhorse of the touch
surface. It is filtered by piece kind and carries: Flip and Take to hand (cards); Roll (dice);
Draw to hand, Shuffle, Split (decks); Dispense (dispensers); Move (then drag) for
grab-2 kinds; Inspect (inspectables); and Stand / lay flat, Snap to grid, Delete for everything.
On a phone it arcs around the press point (`openRadial`); above `RADIAL_MAX` items, or on a
non-sheet layout, it falls back to a flat list.

**Two-finger twist and pinch** (`controls.js`) is the other half of the touch surface, and the
one gesture that is *better* than its mouse counterpart. While a piece is held, a second finger
turns the gesture into a photo-editor transform: the angle between the fingers rotates the piece,
the distance between them raises and lowers it. Both are free because the camera is already
disabled during a hold, so two fingers here are not pan/dolly. The twist is 1:1 — turn the
fingers 45°, the piece turns 45° — where the mouse's Alt-drag maps horizontal pixels to an angle
at a tuned 0.57°/px. Rotation snaps to the same 15° the mouse uses, which doubles as the dead
zone that stops a stray finger nudging a piece.

Because the piece stays put while the fingers travel, the pointer no longer lands on it when the
transform ends; the drag re-anchors instead of snapping (`public/drag.js`). That is a throw fix as
much as a position one — the jump would otherwise land inside the throw estimator's window and
fling the piece at the speed of the jump.

## Cards & decks

| Gesture | What it does                                 | Touch                                                                  | Status |
|---|----------------------------------------------|------------------------------------------------------------------------|--------|
| Left-click a table card | Take it into your hand                       | Tap or Radial → **Take to hand**                                       | ✅     |
| Right-click a table card | Flip it                                      | Radial → **Flip**                                                      | ✅     |
| Left-drag from a deck | Draw the top card                            | Finger drag                                                            | ✅     |
| Left-click a deck | Take top card into hand                      | Tap                                                                    | ✅     |
| Right-click a deck | Shuffle                                      | Radial → **Shuffle**                                                   | ✅     |
| Right-drag a deck | Pick up and move the whole deck              | Radial → **Move (then drag)**, then drag                               | ⚠️     |
| Double-right-click a deck | Split the deck                               | Radial → **Split**                                                     | ✅     |
| Double-click a deck | Peek at the top card                         | Double-tap                                                             | ✅     |
| `F` / `D` / `H` / `R` in the peek | Place face-up / face-down / to hand / return | The four `[data-place]` buttons in the peek overlay (`table.html:954`) | ✅     |

## Your private hand

| Gesture | What it does | Touch | Status |
|---|---|---|---|
| Left-drag (or click) a hand card out | Lands face-down | One-finger drag | ✅ |
| Right-drag (or click) a hand card out | Lands face-up | Two-finger drag | ✅ |
| ▾ / 🃏 Show hand | Hide / restore the hand | Same buttons | ✅ |

The finger-count rule lives in `touchIds` (`client.js:3063`) and is read live during the drag
(`client.js:3112`), so putting a second finger down mid-drag flips the card face-up before it
lands. That is the one gesture in the app with no mouse analogue — and no on-screen hint.

## Selection

| Gesture | What it does | Touch | Status |
|---|---|---|---|
| Shift + drag empty felt | Marquee-box a selection | Select tool on, then drag | ✅ |
| Shift + click a piece | Add / toggle in the selection | Select tool on, then tap | ✅ |
| `U` / `G` on a selection | Stand / snap the whole group | `#selStand` / `#selSnap` | ✅ |
| `F` / `R` / `H` on a selection | Flip cards / roll dice / take to hand | `#selFlip` / `#selRoll` / `#selTake` | ✅ |
| `Delete` on a selection | Remove the whole group | `#selDelete` | ✅ |
| `[` / `]` | Rotate the formation ∓45° | `.rotLeft` / `.rotRight`, hold to repeat at ~7.5°/tick | ⚠️ |

The Select tool (`.selectTool`, `client.js:1355`) is the touch stand-in for the Shift modifier:
while it is on, `selMode` forces `additive` true, so a felt drag boxes and a tap toggles.
`#selTools` is the touch stand-in for the group keys, and the edge clusters' ⟲ / ⟳ for `[` / `]` —
continuous rather than stepped, so a finger cannot land an exact 45°.

## Whiteboard & tools

| Gesture | What it does | Touch | Status |
|---|---|---|---|
| Double-click the whiteboard | Claim control | Double-tap (`controls.js`, `DOUBLE_TAP_MS`) | ✅ |
| `Escape` while owning | Release control | Tap away / the release control | ✅ |
| Draw | Draw | Finger drag | ✅ |
| `Escape` while measuring | Exit the measure tool | `#regionTR` close | ✅ |

WebKit does not synthesize `dblclick` from a double-tap the way Chrome does, so the touch
profile raises the `doubleClick` intent itself and the native handler stands down when the last
pointer was a finger. Before that, every double-click gesture in this document was silently
unreachable on iOS and iPadOS.

---

## Gaps

Two, in rough order of how much they cost a touch player:

1. **Exact-step formation rotation.** `[` / `]` turn a selection in ∓45° steps; the ⟲ / ⟳ hold
   buttons are continuous at ~7.5°/tick, so a finger cannot land a formation on an exact 45°.
   The two-finger twist covers a *held* piece (and a held selection, since the held-piece path
   routes to `[...selection]` when `down.group` is set), but a selection you are not holding is
   still button-only.
2. **Smooth rotation is coarser on touch.** Alt+Shift gives unsnapped rotation; the twist always
   snaps to 15°, and the hold buttons quantise to ~7.5°. Nothing on touch is truly free.

Worth recording, because the naming invites exactly one wrong reading: **`snap` and `setSnap`
are unrelated messages.** `snap` (`server/game/handlers/pieces.js:220`) rounds the held body's
yaw to `Math.PI / 4` and advances one step — it is the middle-click facing rotate, and it is the
only exact-45° step available for a held piece. `setSnap` (line 209) toggles the piece's
grid-snap prop — that is the `G` key and the radial's **Snap to grid**. The client-side intent
that sends the first is called `snapHeld` (`client.js:4982`), which reads like the second.

## The documentation gap

The in-app **How to Play** modal (`table.html:1564`) mentions touch **zero times**. Every one of
its instructions is phrased as a click, a drag with a named mouse button, a wheel, or a key.
A player who opens the app on an iPad is told, in detail, how to use a mouse.

The radial menu, the Select tool, the ▲/▼ height controls, `#selTools`, the one-finger /
two-finger hand rule, and double-tap-to-claim are all real, all shipped, and all undocumented.
Closing this is cheaper than any of the three gaps above and probably worth more.
