# Open Tabletop — Roadmap

_Last groomed 2026-09-01, reconciled against v0.12.2 (+41 commits)._

## North star

A self-hosted, physics-driven virtual tabletop that recreates **sitting at a real table with
friends** — you manipulate physical objects, and humans enforce the rules. As of 0.9.0 the engine
is coherent enough that the goal shifts from "our tool" to **"something any group can stand up and
play on."** Everything below is weighed against two questions: *does it feel like a real table?*
and *can a hobbyist host it for their friends without a fight?*

## Guiding principles (the filter)

These are why some obvious features are deliberately absent — keep them in mind when prioritizing.

- **Physical-first.** Simulate objects; let people enforce rules. No rules engine, no legal-move
  checking, no scorekeeping the table wouldn't do itself.
- **Trust by transparency, not accounting.** State is public; you verify a roll by *looking at the
  dice*, not by reading a log. (This is exactly why the dice-roll log was dropped.)
- **Local where it can be, synced where it must be.** Selection, camera, accent color, audio are
  per-player and never touch the network; only the shared physical objects sync.
- **Hostable by a hobbyist.** One image, stock Postgres, self-applied migrations, upgrades on a
  blind `docker pull`. Every added moving part is a tax on the person running it.

---

## Architecture note — the server split (verified 2026-09-01, at v0.12.2)

A DRY pass broke the server monolith into 33 files. What moved:

```
server/http/routes/     admin · auth · rooms · uploads
server/http/            async-route · auth-context
server/game/handlers/   cards · library · members · movement ·
                        overlays · pieces · room-features · room-state
server/game/            props-codec · safe-message · scene-persistence
server/                 database · database-config · permissions · physics ·
                        rate-limit · redis-config · session-config · deck-state ·
                        message-validation · auth-validation · room-queries ·
                        user-queries · library-queries · bootstrap-admin ·
                        assets/upload-validation
```

The seams came out clean — community detection over the call graph finds a distinct router
cluster (`createAuthRouter` / `createRoomsRouter` / `createAdminRouter` / `requireUser`,
cohesion 0.89) and a fully cohesive query layer (`roomRow` / `publicUserRow` / `listBoards`,
cohesion 1.0).

**What did NOT move:** `server.js` still carries ~120 symbols, including the whole `TableRoom`
class (lines 560–2044, ~1,485 lines) plus `EditorRoom` (2045), `LobbyRoom` (2221), the Colyseus schema classes
(`Piece`, `Player`, `Overlay`, `State`, `Whiteboard`, `Timer`, `ScoreRow`, `RoomScale`), the
starter builders (`buildDominoSet`, `buildMahjongWall`, `buildScrabbleBag`, `buildSimpleDeck`)
and `bootstrap`. See "Finish the server split" under Parked threads. Note: 0.11.0 extracted more
handler modules (movement, cards, room-state, overlays, physics, scene-persistence), but `TableRoom`
itself never moved — `server.js` is now **2278 lines**, *larger* than at 0.9.0 (2039). The 0.11.0
changelog's "substantially reduces `server.js`" is relative to what it would otherwise have been,
not an absolute shrink.

Where things live now, for the threads below: `BOARD_PAINTERS` is in `public/graphics.js`;
snap logic is split across `shared/pieces.js` (`snapToCell`, `gridActive`),
`server/game/handlers/pieces.js` (`applySnap`) and `public/client.js` (`pieceSnap`, `snapXZ`);
`setupStarter` is still `TableRoom.setupStarter` (`server.js:1062`).

---

## The distribution push (priority order — reorder freely)

### 1. Plays well at real scale — robustness
The difference between "demo" and "we play here every week."
- Performance with **hundreds of pieces** on the table. The body count is lower than it looks —
  a deck is one body, not N (see the piece-model note below) — so reaching true hundreds means
  raising `SIM.maxPieces` first, then profiling.
- **Scene-save size** behavior (big saves, the cap, graceful failure).
- **Reconnection edges** and connection-quality feedback so a dropped phone rejoins cleanly.

**Instrumentation (2026-09-01).** Both halves are now measurable, off by default. Client:
`?perf=1` on the table URL (or `window.ottPerf(true)`) draws a `renderer.info` overlay — FPS,
frame ms, draw calls, triangles, geometry/texture/program counts (`public/perf.js`). Server:
`PERF_LOG=1` makes `TableRoom.update` log a per-second `world.step` time (avg/max), awake-vs-total
body count, and tick health. Real-hardware tools — measure on the low-end target, not headless.

**Piece-model note — what "hundreds of pieces" means here.** A deck is a single body with a
private `deckCards` list, not N bodies; the 144-tile Mahjong wall spawns as one deck piece, and
dealt tiles live in `this.hands` (also not physics). Only tiles spread onto the table are bodies,
and `SIM.maxPieces` (80) caps `state.pieces.size`. So a full wall renders as one stacked mesh, and
the many-bodies case is normally bounded at 80.

**Two cap bugs to fix if the limit stays** (found 2026-09-01):
1. `dealToTable` / `dealDrag` (`server/game/handlers/cards.js`) spawn a table body per draw with
   **no `maxPieces` guard** — deal-to-hand, split, `handToTable`, starters and scene-restore all
   check it; these two don't. That is how all 144 wall tiles can be drawn onto the table past the
   80 cap. Add the same `state.pieces.size >= maxPieces` check before the spawn.
2. Every cap check is a silent `break`/`return` — overflow is dropped with no feedback
   (`handToTable` stops mid-spread; the rest stay in hand). Surface a "table full" signal. And
   decide whether 80 is the right number at all: a real Mahjong game's discards + exposed melds
   can cross it mid-game.

### 2. A fresh room isn't a blank table — built-in content
Lowers the cold-start for a host who isn't going to model their own assets.
- ✅ **Standard 52 + jokers** deck (a "Standard 54 (with Jokers)" option with a rendered joker face).
- ✅ **One-click starter games** — Chess, Checkers, Go, Poker night, and (0.9.0) **Dominoes**,
  **Wordy McWordface**, and **Mahjong**, in the library **Games** tab (`STARTERS` in
  `shared/pieces.js`; `TableRoom.setupStarter`). Add more by editing that list.
- ✅ **Tile games + variable card geometry** (0.9.0) — `cardGeom`/`TILES` (one resolver read by both
  the mesh and the collider), custom image-deck **shapes** (rounded/square/**hexagon**, hex with a
  matching 6-gon collider) and **thickness**, a **procedural board framework** (`BOARD_PAINTERS`,
  first used by the word grid), and **deck skins** (`DECK_MODELS`, e.g. the bentwood box). Tiles and
  their boxes also get their own sound cues. See `DESIGN_tiles.md`.
- ✅ **Dice colors** — named dice sets (`DICE_SETS`).
- ✅ **Model dispensers** — a colorable `trainStack` dispenser (`train_dispenser.glb`) that pays
  out `train_piece` tokens: the first built-in model-dispenser beyond the Go bowl (`shared/pieces.js`).
- Still open: more **tokens/markers**; **RPG battlemaps** (the procedural-board framework is the
  seam — add a `BOARD_PAINTERS` painter); a **user upload path for deck skins** (only the built-in
  bentwood box exists today — the `DECK_MODELS` plumbing is there, the editor UI isn't); more
  starter games and tile art.

### 3. Session tools that stay physical
Useful for real play *if* they don't drift into app-ledger territory.
- **Initiative / turn order** (turn passing already exists — this is the ordered-list version).
- A **GM staging area / screen** — a hidden zone only the GM sees, for prepping the next encounter.
  The design challenge is doing this within the "public state" model without a second hidden sim.

### 4. A host can stand it up in ten minutes
If the goal is other people hosting, the setup path *is* the product.
- **Quickstart polish.** ✅ Done -  A copy-paste `docker compose up` that just works with sane defaults;
  a short "first room" walkthrough; clearer env-var docs.
- **Release automation.** ✅ Done — `.github/workflows/release.yml` builds + pushes the multi-arch
  images and cuts the GitHub release on a `v*` tag (notes pulled from `CHANGELOG.md`), and
  `ci.yml` runs the test suite on every push/PR. Proven across the 0.10.0–0.12.2 releases.
- **A public demo / try-it instance** (optional) so a prospective host can feel it before hosting.

### 5. Meet people where they play — touch & mobile
The single biggest audience expansion. "Pull up the iPad at game night" is a core VTT use case.
**The 0.12.0 redesign delivered the bulk of this** — a purpose-built phone/tablet layout (bottom
sheets with peek/two-thirds/full drag stops, the ⊕ action fan, long-press-piece verbs, a pull-up
hand tray, icon hints on touch) on top of the existing message protocol (no server change). What
remains is closing the known gesture gaps and proving it on real devices — not building the interface.
- **Audit the gesture surface.** ✅ Done — the catalog is `docs/GESTURES.md`: every gesture, its
  touch equivalent, and a status. Marquee/Shift-select, group drag, the tray camera hop,
  scroll-to-raise, right-drag-to-move and left-click-a-deck-to-draw each assume a mouse with
  buttons and a wheel; all but the rotation gestures now have a touch path. Three gaps remain
  open there — rotating a held piece (middle-click 45°, Alt+drag 15°, Alt+Shift smooth: none
  reachable by finger), exact-step formation rotation, and single-tap card verbs — plus the fact
  that the in-app "How to Play" mentions touch zero times.
- **Touch equivalents.** ✅ Done - Long-press, two-finger, and on-screen affordances for the button/wheel
  gestures; make the Select tool the primary path where modifiers don't exist.
- **Responsive HUD.** ✅ Done - The rails/pop-outs assume desktop real estate; verify the tablet layout and
  the collapse behavior.
- **A device test matrix** ✅ Done - so "works on my machine" stops being the coverage.
---

## Feature backlog (added 2026-08-31)

Unordered — priority not yet assigned. Each note records what exists today, so the work is
scoped against the real tree rather than from memory.

1. **Table shape customization.** Today the table is resizable and recolorable
   (`resizeTable` and `setTableColor`, `public/core.js:110–119`; `applyScale` /
   `scaleSnapshot` on `TableRoom`) but the surface is rectangular only. Shape is a new axis —
   round, oval, hex — and it touches the physics bounds (`TableRoom.buildBounds`), the tray
   layout (`buildTrays`, `seatAngle`, `trayCenterFor`) and the grid calibration
   (`calibrateGrid`), not just the mesh.
2. **Interactive tutorial.** Nothing exists today beyond the player-facing How-to-Play panel.
   Worth deciding early whether this is an overlay walkthrough in a normal room or a scripted
   starter scene — the latter reuses `setupStarter` and stays physical-first.
3. **Hex grid + multi-cell footprints.** *Already tracked* — see Parked threads below, where
   both halves are recorded with their existing groundwork. Listed here so the wishlist is
   complete; do not duplicate the entry.
4. **Fog of war.** No implementation today (`grep` for `fog`/`spectator` returns nothing).
   This is the item most in tension with **trust by transparency** and the public-state model —
   it needs the same design answer as the GM staging area (§5), and probably shares a mechanism
   with it. Decide the hidden-state story once, for both.
5. **Spectator mode.** No implementation today. Seat/role machinery already exists
   (`TableRoom.seatOf`, `canManage`, `canSetRole`, `rank`, `isAdmin`), so this is plausibly a
   new role that never gets a seat rather than a new connection path.
6. **Custom dispensers.** Built-in dispensers exist end to end — `dispenserMesh`
   (`public/graphics.js:1493–1583`), `TableRoom.dispenserItem` (`server.js:1175`),
   `afterDispense`, and `dispenserDragPayload` validation
   (`server/message-validation.js:264–269`). "Custom" means a user-defined dispenser in the
   editor; see `DESIGN_dispensers.md`.
7. **Custom games.** `STARTERS` in `shared/pieces.js` is code-only today — adding a game means
   editing the list. This is the user-facing version: define, save and share a starter from
   inside the app. Overlaps the "user upload path for deck skins" gap in §3.
8.  **Hand Re-organization** Players need the ability to re-organize the cards in their hands.  
9. **Custom dice / dice textures.** `DICE_SETS` gives named colored sets, with per-player
   defaults already persisted (`applyDiceSet`, `loadDiceDefaults`, `saveDiceDefault`,
   `clearDiceDefault`, `public/client.js:381–435`). Custom *textures* are the new part and
   need an upload path plus a `digitTexture`/`dieMesh` route for user art. 
10. **Multi-select composition.** Multi-select exists (`DESIGN_multiselect.md`) but only moves
   and rotates a selection. These three turn it into a construction tool:
   1. Combine loose like cards into a **new deck** (discard pile → deck).
   2. **Merge two decks** — the inverse of the existing split.
   3. Gather dispenser-type objects into a **single dispenser**.
11. **More Room Customization.**  Ability to adjust lighting (angles, intensity, color).  
    Ability to adjust skybox resolution.
12. **Graphics/Video Settings.** Ability to crank up or lower graphics quality.

   All three are "selection → new composite piece" on the server; the natural home is
   `server/game/handlers/cards.js` (deck ops) and `pieces.js` (generic composition), with
   `deck-state.js` holding the resulting state. Worth designing as one operation with three
   target kinds rather than three features.

---

## Parked threads (finish-what-we-started)

Small, concrete, each completes an existing feature:
- **Finish the server split** — the DRY pass extracted routes, message handlers, queries,
  validation, physics and config, but `TableRoom` (`server.js:560–2044`) is still a ~1,485-line
  class holding room lifecycle, seating, trays, scenes, hands, turns and starters. `EditorRoom`,
  `LobbyRoom`, the schema classes and the starter builders are also still in `server.js`. The
  remaining seam is `TableRoom` itself; the handler modules it now delegates to are the pattern
  to keep pulling against.
- **Hex grids** — the grid shipped square-only; hex needs an orientation choice and axial snap.
  Groundwork now exists: hexagon **tiles** already have regular pointy-top meshes + matching 6-gon
  colliders (0.9.0), so the remaining piece is a hex grid + snap that they drop onto. (See
  `DESIGN_grid_snap.md`, Phase 5, and `DESIGN_tiles.md`.)
- **Multi-cell footprints** — snap assumes 1×1; big-base minis need a per-kind `cells` hint.
- **Free-drag group rotation** — multi-select rotates in 45° steps; a grab-and-spin handle is the
  polish. (`DESIGN_multiselect.md`, deferred.)
- **Scrabble scoring / Mahjong scoring** — deliberately out (physical-first; the scorepad tallies),
  but noted so it's a decision, not an oversight.
- **Tile shuffle/flip sounds** — tiles got their own drop/pickup cues in 0.9.0, but shuffle and flip
  still use the generic card cues; a box-shake / tile-flip variant is a small finish.
- **Cross-file util module** — `api()`, the button factory and the auth-token read are still
  duplicated across `public/`. Re-verified 2026-09-01: `rows.js` now owns a shared `makeButton`
  that `client.js` imports (partial progress on the button-factory half), but `api()` is still
  copied in `admin.js` and `landing.js`, `landing.js` keeps its own `mkBtn`, and the token read
  (`localStorage.getItem('tabletop.token')`) is still inline in both `client.js` and `graphics.js`.
  A real extraction, scoped in `UI_backlog.md`.
- **ASSET_CREDITS — tile/box sound cues** — the Mahjong CC0 faces and the bentwood-box `.glb` are
  now credited in `docs/ASSET_CREDITS.md`. Still missing: the tile and tile-box drop/pickup cues
  (`public/sounds/tile-*.ogg`, `tiledeck-*.ogg`) — real audio files, not procedural, so they need a
  source line like the other sound packs.

## Deliberately out (for now)

Recorded so they don't get re-proposed without the reasoning:
- **Dice-roll log** — dropped by design; verification is by reading the dice (see `DESIGN_dice_tray.md`).
- **Voice / video** — groups bring their own; out of scope.
- **Rules automation / enforcement** — against the physical-first principle (no word validation, no
  legal-move checks, no auto-scoring).

## References

`DESIGN_tiles.md`, `DESIGN_grid_snap.md`, `DESIGN_dice_tray.md`, `DESIGN_multiselect.md`,
`DESIGN_dispensers.md`, `DESIGN_measurement.md`, `RELEASING.md`, `UI_backlog.md`, `CHANGELOG.md`.
