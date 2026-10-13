# Mahjong wall

The approved **Build wall** button appears beside Spawn on the Mahjong library card,
using the existing Set selector. Text and the Tabler `wall` icon remain visible in
compact/full desktop and touch layouts. Keyboard uses native focus and Enter/Space;
touch targets are at least 44px. Helpers and GMs use the existing spawn permission.

The action creates one fresh, privately shuffled set at the table center. The quantity
stepper continues to govern pouch Spawn; Build wall creates one wall. Existing pieces,
private hands, table dimensions and grid settings remain in place. No pouch is consumed.
Pre-Built Games offers the approved **Mahjong (136 tiles)** and **Mahjong (144 tiles)**
entries with the existing Set up icon, layouts and table-clear confirmation. These
GM-only actions replace the game with the chosen wall and two Rounded Pips D6 dice in
its center. They create no pouch and leave hands empty; rolling and taking tiles are
manual. Fit and capacity for the wall plus both dice are checked before clearing the
old game, so expected failures preserve existing pieces and hands.

| Set | Tiles | Stacks per side | Layers |
| --- | --- | --- | --- |
| Standard | 136 | 17 | 2 |
| Flowers/seasons | 144 | 18 | 2 |

The supplied traditional-wall reference replaces the flush frame arrangement. Each
row projects past its neighbor by about one stack: the top row extends right, the right
row down, the bottom row left and the left row up. `cornerOverhangStacks: 1` adds a
half-width offset to each row and moves its center inward by the same amount, keeping
the other end beside the neighboring wall without intersections. Tile gaps are 0.002,
corner clearance is 0.02 per join. The rectangular table-edge margin is 0.04 units;
other shapes retain their existing 0.1 margin.
Current tile half-extents remain 0.34 × 0.473 × 0.14. Actual outer spans, including the
projecting ends, are 13.218 / 13.900 table units; both fit the default 20 × 14 rectangle. Curved tables use
the shared shape-aware containment test for every footprint corner. Tables are never
silently enlarged and tiles are never silently rescaled.

Each tile has its own dynamic body and concealed card record. Fronts remain in
`room.cardData`; synchronized props contain public Mahjong geometry/back only. Existing
grab, flip, take-to-hand, recolor, combine and stacking actions work normally. Moving a
bottom tile wakes the layer above. Wall breaking, dice, dealing and dead-wall handling
remain manual; no rules/scoring or enforced draw order are introduced.

## Implementation boundary

Existing inventory construction, card transfer, geometry and message policy are reused.
A focused shared layout and server operation are added because the ordinary single-piece
spawn and starter/deal paths do not own multi-piece wall preflight or rollback.

Before spawning, the server checks capacity for the entire wall, all tile corners inside
the actual table shape, and overlap with existing piece-body AABBs at the wall positions.
Public walls ignore parked GM-hidden objects, matching their exclusion from public physics
and preventing an obstruction error from revealing hidden-object presence. GM-hidden
wall requests can check the complete authoritative scene.
Failures report an actionable error without partial creation. Cards are created through
`spawnTableCard`, aligned to row yaw and initially asleep at rest; `snap:false` keeps an
active grid from pulling the wall apart. Unexpected failures remove all new synchronized
pieces, private faces and bodies, including an orphan body from an incomplete spawn.
The existing guarded message error boundary handles the exception.

`spawnPayload` normalizes `layout:'wall'` only for Mahjong deck spawns. The registered
piece handler checks helper permission and delegates to an injected `spawnMahjongWall`.
It retains hidden-spawn request provenance and sends the shuffle cue only after success.
Existing save/restore carries ordinary piece transforms and private face data; no new
snapshot schema, persistent wall membership or database migration is required.

Starter orchestration extends `createStarterSetup` with the same injected wall operation;
no second wall builder is introduced. Both shared starter definitions use one dice
configuration. Dice spawn through the ordinary lifecycle at shared D6 rest height,
with upright orientation and normal dynamic physics. The server starter handler accepts
only own registry keys and reports expected preflight failures through `serverError`.

## Files and functions

| File | Change |
| --- | --- |
| `shared/mahjong-wall.js` | Adds `MAHJONG_WALL`, `mahjongWallLayout`, `mahjongWallFits`; updates layout/configuration for traditional projecting corners, tight row spacing and actual outer span. Fit remains shared and shape-aware. |
| `server/game/mahjong-wall.js` | Adds `createMahjongWall` / returned `spawnMahjongWall`; inventory, preflight, private placement and rollback. |
| `server.js` | Instantiates the wall factory and injects it into the production piece handler and starter factory; `loadStarter` validates own registry keys and reports preflight errors. |
| `server/game/starters.js` | Extends `createStarterSetup` / `setupStarter` with pre-clear kit checks, injected wall creation and configured dice spawning; retains other games' dealing. |
| `shared/pieces.js` | Adds `MAHJONG_STARTER_DICE`; updates `STARTERS` / `STARTER_LIST` with the two wall kits, without automatic dealing. |
| `server/game/handlers/pieces.js` | `registerPieceHandlers` adds the wall spawn branch through existing capability/role/visibility policy. |
| `server/message-validation.js` | `spawnPayload` accepts only the Mahjong wall layout variant. |
| `public/editor/editor-panel.js` | `ICON_FOR`, `btn`, `renderBuiltin` add the approved labeled button and selected-set request; `renderBuiltin` adds bonus starter thumbnails using existing Set up controls. |
| `public/styles.css` | Keeps the wall label visible and gives the touch button a 44px minimum height; both Mahjong Set up buttons have 44px minimum touch targets. |
| `scripts/build-icons.mjs`, `public/table.html`, `public/index.html`, `public/admin.html` | Registers/regenerates `wall`; existing symbol bytes remain unchanged. Table help describes both sets and failure behavior. |
| `scripts/component-parity.mjs` | Exercises icon, visible compact label, keyboard focus, permission tag and real selected-set spawn caller; both starter entries, cancellation, exact requests and layout bounds. |
| `test/backend-starters.js` | Adds both kit counts, dice configuration, empty hands/no dealing, pre-clear capacity/fit protection and inherited-ID rejection. |
| `test/mahjong-wall.js` | Checks counts, shared dimensions, projecting corner direction/clearance, rotational symmetry, tight spacing, actual span, non-overlap and containment of projecting ends. |
| `test/backend-mahjong-wall.js` | Checks private independent bodies, support removal, preflight, rollback, helper policy, hidden obstruction privacy and real snapshot/restore stability; both starters through production wall/dice physics. Obstruction fixtures now use actual projecting tile positions. |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/MAHJONG_WALL.md`, `docs/TILE_MODELS.md` | Record implementation, starter behavior, file/function changes and boundaries. |
| `docs/GESTURES.md`, `docs/DEVICE_QA.md`, `docs/ASSET_CREDITS.md` | Record input path, manual QA and the approved MIT Tabler icon. |

## Verification

- `npm run check`: lint, format, CSS checks and all 1,009 runtime tests passed.
- `npm run test:input`: all 58 checks passed.
- `npm run test:devices`: all seven profiles passed.
- `npm run test:components`: full desktop/touch component suite and notecard checks
  at 1280/390/360px passed. Existing fixture-only image-derivative 404s remain; the wall
  icon, action and Mahjong models loaded successfully.
- Targeted geometry/server tests passed for both sizes, including Cannon gravity after
  support removal, hidden obstruction privacy and a restored 144-tile wall.
- Both starter variants passed through the production wall/dice lifecycle, including
  settling under Cannon gravity without moving the wall. Focused full/compact desktop
  and touch UI checks passed for variant selection, cancellation and 44px targets.
- A 144-tile production-renderer preview was visually checked against the default table.
  Sprite rebuilding added only `i-wall`; existing symbol bytes are unchanged.
- The revised traditional layout passed all 22 focused geometry, server-wall and starter
  tests. A fresh top-down production-GLB preview matches the supplied overhang direction.
- `git diff --check`: passed. No database schema/query changes were made, so the database
  integration suite was not required.

Restart the server, refresh the browser and build a new wall; existing/saved layouts
retain their positions. In Library → Decks & Tiles → Tiles, choose
each set and press Build wall. Confirm row/layer counts, pick up bottom/top tiles, flip
and take to hand, then save/reload. Repeat with another client to verify concealment and
hidden-GM placement. Test an occupied/small table and too few free slots. Real-device
gesture feel, multiplayer behavior and GPU performance remain pending user testing.

Also test both entries under Library → Pre-Built Games: confirm the
table-clear prompt, empty hands and two center dice, then roll the dice and take tiles
manually. Verify a small-table refusal keeps the previous game intact.
