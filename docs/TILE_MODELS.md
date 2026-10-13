# Authored tile model support

## Scope and extension decision

The owner requested reusable model support before supplying remade Mahjong assets, with
Shogi and other tile families expected later. The existing card/deck protocol, shared
geometry and object-material helpers are extended. A small immutable family registry
replaces domino-specific branching; one renderer and one appearance-control module remain.
The approved desktop/compact/touch layout and icons are unchanged. Domino and Mahjong
are enabled model families; Shogi is not yet a set.

The owner's Domino half-extents are preserved: `w: 0.25`, `h: 0.5`, `t: 0.05` in
`TILES.domino` (full width × length × thickness: 0.5 × 1 × 0.1). Model fitting and colliders
use these same values, and tests derive their expected dimensions from `cardGeom`.

## Mahjong integration

The owner approved the supplied engraved models and Base/Back/Material controls, and
selected 136 tiles by default. The existing family registry, renderer, geometry, private
inventory and appearance controls are reused; no new gameplay engine/helper is needed.

- `shared/tile-models.js`: registers 34 standard and eight bonus faces using image refs.
  `base` and `back` materials map to the saved `base` and `inset` appearance fields;
  `colorLabels` names the latter Back. Engraved symbol colors remain authored.
- `public/ui/tile-appearance.js`: `createTileAppearanceControls().setProps` uses family
  color labels in visible text and accessible names. Layout, icons and gestures are reused.
- `public/editor/editor-panel.js`: `renderBuiltin` loads GLB thumbnails through
  `tilePreviewURL` and adds the approved labeled Set selector: standard 136 by default,
  or 144 with flowers/seasons. `public/styles.css` places it between title/spawn controls,
  fits the card width and provides a 44px touch target in both full and compact modes.
- `shared/pieces.js`: retains Mahjong dimensions, half-extents 0.34 × 0.473 × 0.14;
  updates the face catalog's description and bonus catalog: plum, orchid, chrysanthemum,
  bamboo and four seasons. Old lotus/peony refs are not reassigned to different flowers.
- `server/game/deck-builders.js`: `buildMahjongWall` creates 136 privately shuffled tiles,
  four of each ordinary face. Exact `true` adds eight single bonuses for 144. Its historical
  name still builds pouch inventory, not a wall. `server/message-validation.js`'s
  `spawnPayload` accepts `bonusTiles` only as a Mahjong boolean; `createPieceLifecycle`'s
  `spawn` in `server/game/piece-lifecycle.js` passes the normalized option to the builder.
- `public/static_assets/models/pieces/mahjong/`: 46 unchanged supplied GLBs: 42 faces,
  concealed model, three red fives reserved for later. The concealed model is already
  oriented back-up. Known open face-down tiles rotate their face model through the renderer.
- `public/static_assets/mahjong/faces/flowPlum.png`, `flowBamboo.png`: 360×480 image fallbacks
  rendered from the bonus kit's original SVGs with Sharp, on ivory `#efead8`. Existing image
  assets are unchanged; these new refs remain readable during loading or on GLB failure.
- `test/mahjong.js`: validates all bundled GLBs, exact inventory/model membership,
  concealment, legacy bonuses, appearance transfers and remaining-stock recoloring.
  `test/backend-deck-builders.js` verifies both 136/144 counts. `test/backend-piece-lifecycle.js`
  verifies validated spawns, malformed/family-mismatched flags and inventory restore.
  `test/tile-models.js` now
  uses an unregistered fixture for future-family extension tests.
- `scripts/component-parity.mjs`: exercises all 42 actual GLBs, collider fitting,
  concealed orientation, symbol colors, hand preview and inspector/selection messages
  in its desktop and touch profiles, including compact controls. It also exercises the
  real selector-to-spawn caller, defaults, keyboard focus, width, order and touch sizing.
- `CHANGELOG.md`, `ASSET_CREDITS.md`, `REFERENCE.md`, `ARCHITECTURE.md` record behavior,
  provenance, contracts and boundaries; `ROADMAP.md` updates the current inventory count
  while retaining the older profiling record. `DEVICE_QA.md` adds manual variant checks.
  Standard art is FluffyStuff's CC0 artwork; bonus art is original CC0 botanical artwork
  with outlined Noto Serif CJK lettering (no fonts bundled).

New sets default to 136, with an optional 144-tile inventory. Six existing bonus refs map
to matching GLBs; old lotus/peony remain image-only, while new plum/bamboo have distinct refs.
No migration changes saved faces, inventory, hands or authored model sources.
Physical wall construction uses a separate layout/operation module; see [Mahjong wall](MAHJONG_WALL.md).
Real-device performance and gameplay
smoke testing remain pending; the supplied set is about 39.6 MB with roughly 1.09 million
triangles across all unique assets, and the renderer shares template geometry.

Mahjong integration verification:

- `npm run check`: passed lint, formatting, CSS parity and all 992 tests.
- `npm run test:components`: component parity passed the full desktop/touch suite; all
  active Mahjong GLBs loaded. The wrapper ended with signal exit 143 after reporting all
  three notecard assertion passes. A separate `node scripts/notecard-test.mjs` rerun passed
  at 1280/390/360px and exited 0. The fixture still reports eight unrelated/procedural
  image-derivative 404 paths, not failed GLB requests.
- `npm run test:devices`: all seven profiles passed.
- `npm run test:input`: all 58 checks passed after adding the native set selector.
- All 46 bundled GLBs match their supplied originals byte for byte. Production-renderer
  previews were visually checked for standard faces, the concealed back and all eight bonuses.
- `git diff --check`: passed. No database change was made; the database integration
  suite was not rerun for this slice.

Restart the server for 136/144 inventory creation, then refresh the browser for registry/UI
changes. Smoke-test each fresh pouch's count, draw/reveal/conceal, Base/Back/Material controls,
private-hand play onto a stack and save/reload (including an old bonus tile). User testing,
multiplayer behavior and real-device GPU performance remain pending.

## Adding a family when its assets are ready

1. Preview the authored family and obtain the required UI/model approval before enabling
   it. Bundle and validate the GLBs, preserving originals and recording provenance/credits.
2. Add the family to `shared/tile-models.js` → `TILE_MODELS`. Supply its display name,
   `appearanceKey: 'tileAppearance'`, default `{base,inset,finish}`, and
   `materialSlots: {base: 'base', inset: 'inset'}` (or the authored material names).
   Supply `concealed` as the neutral GLB URL and `faces` as exact authorized front-ref
   keys mapped to `{url, turn}`. `turn: true` rotates 180° about the vertical axis.
   This immutable allowlist bounds cached templates and prevents arbitrary model URLs.
3. Keep dimensions in `TILES`/`props.geom`, independent of asset units/origins. The shared
   renderer recenters and scales each axis to `cardGeom`. Current supported card/tile
   colliders are rectangular and hexagonal; model fitting currently uses the rectangular
   branch. A Shogi pentagon needing a matching collider requires a shared shape extension,
   with rendering/physics verification when that set is integrated.
4. Reuse existing identity references whenever possible. Mahjong's current fronts are
   `MAHJONG.base + id + '.png'`; map those exact references to GLBs to retain existing
   hands/saves. Its default 136-tile inventory uses 34 distinct faces plus a concealed model;
   the optional 144-tile inventory uses eight extra bonus faces. Legacy lotus/peony use
   image fallback, preserving their identities rather than mapping to plum/bamboo.
   A genuinely new set also needs a builder, validated spawn/face references, inventory
   persistence and approved library UI. Model registration alone does not create a set.
5. Use a concealed model without identifying face geometry/materials. Hidden clients
   receive no private front; the browser uses the common model. Public open face-down
   tiles rotate their known model to expose the authored underside.
6. Add asset completeness, concealment, color/finish, transfer and real caller tests.
   The existing inspector, selection Recolor and hand thumbnails detect registered
   families. A new library card/thumbnail caller must use `tilePreviewURL`. No game rules,
   legal-move validation or automatic scoring are part of this extension.

All families support independent Base/Inset colors (Base/Back for Mahjong) and one shared finish, with Original
(GLB) plus existing object finishes and phone fallbacks. A bag's colors are separate from
its inventory appearance. Only remaining stock receives a bag patch; already drawn tiles
retain their styles. Generic messages use `tileAppearance`; Domino retains the saved
`dominoAppearance` property and legacy message/API aliases, avoiding a snapshot migration.

## File and helper summary for this refactor

| File | Change |
| --- | --- |
| `shared/tile-models.js` | Adds immutable `TILE_MODELS`, `tileModelFamily` and `tileModel`; owns family mappings, concealed model, material slots and defaults. |
| `shared/pieces.js` | Adds `normalizeTileAppearance`, `tileAppearanceOf`, `tileAppearanceProps`; generalizes `cardPublicProps` and `colorProps`, reexports registry helpers and retains domino compatibility aliases. Preserves tuned dimensions and corrects their comment. |
| `public/rendering/tiles.js` | Replaces `dominoes.js` with `createTileRenderer`; generic load readiness/event, shared template geometry, owned painting, fitting and fallback/disposal. |
| `public/rendering/graphics.js` | Dispatches `cardMesh` through the shared renderer, paints configured material names, replaces `dominoPreviewURL` with `tilePreviewURL`, includes family/orientation in cache keys and derives thumbnail aspect from geometry. |
| `public/ui/tile-appearance.js` | Replaces `domino-appearance.js` with `createTileAppearanceControls`; uses family defaults/names while retaining approved DOM/CSS layout. |
| `public/table/inspection.js` | `createInspection`, `swapInspect`, `enterInspect` use registry capabilities, shared controls and generic patches while retaining owned-preview cleanup. |
| `public/table/selection.js` | `selColorDesc`/`refreshSelTools` use `tile:<family>` compatibility and shared controls; mixed families cannot share a picker. |
| `public/table/hand.js` | `inspectHandCard`, drag previews and `renderHand` use family appearance transfers, ownership and generic thumbnails, including image-ref families. |
| `public/client.js`, `public/editor/editor-panel.js` | Inject/call the production `tilePreviewURL` helper. |
| `server/deck-state.js` | `takeTopCard`, `absorbedEntry`, `inspectedEntry`, `deckSpawnProps` preserve generic and legacy appearance metadata; unstyled legacy entries remain bare strings. |
| `server/message-validation.js` | `groupRecolor`/`recolorPayload` accept generic patches, preserve legacy input, reject ambiguous dual fields and mixed object/dice patches. |
| `server/game/piece-operations.js` | `recolorPiece` applies validated family patches to remaining private entry overrides without coupling other fields or bag colors. |
| `server/game/piece-lifecycle.js` | `spawn`/`releasePiece` use generic family appearance and capture original defaults before absorption into a styled deck. |
| `server/game/handlers/cards.js` | `combine` captures each member/entry's effective style through the same shared transfer helper. |
| `scripts/component-parity.mjs` | Tests the production generic renderer/preview/control callers and reads expected fitted dimensions from `cardGeom`. |
| `test/dominoes.js`, `test/selection.js` | Follow the shared renderer/entry contract and family selection signatures; retain legacy protocol regressions. |
| `test/tile-models.js` | Adds a second-family fixture covering registration, concealment, defaults, fitting, deduplication/material isolation, generic validation, legacy storage, private metadata and independent bag patches. |
| `test/backend-card-handlers.js` | Adds real combine and pouch Recolor-to-draw regressions for unstyled tiles and individually styled deck entries. |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/GESTURES.md`, `docs/DOMINO_MODELS.md`, this record | Update contracts, scope, extension guidance and verification; original integration history remains distinct. |

No asset files, new infrastructure/dependencies, database schema, icons or layout changes
are introduced in this refactor. Other files already changed by the original Domino
integration remain part of that earlier scope, documented in `DOMINO_MODELS.md`.

## Verification

Implementation is complete. Checks run:

- `npm run check`: lint, formatting, CSS and all 957 tests passed (including the pouch recolor follow-up).
- `npm run test:input`: all 58 checks passed.
- `npm run test:devices`: all seven profiles passed.
- Pouch regression handler suite: all 30 tests passed with Node test isolation disabled
  inside the sandbox.
- `npm run test:components`: passed, including all 29 Domino models and shared appearance
  callers on desktop/390px touch, plus notecard editor checks at 1280/390/360px.
- `git diff --check` and updated documentation links pass.

Repository HTTP/browser fixtures and isolated test subprocesses used authorized execution
outside the sandbox. The component harness reported eight missing derivative thumbnails
in static fixtures (Mahjong WebP paths); the suite passed and all new model checks loaded
successfully. Automated passes do not establish real-device gesture feel, GPU performance
or live multiplayer correctness.

Restart the server and refresh browser clients before manual testing:

1. Spawn Dominoes; confirm the smaller dimensions and common concealed back.
2. Inspect a tile, independently change Base/Inset and choose a shared finish.
3. Recolor a bag/group, draw remaining stock, combine differently styled tiles and redraw.
4. Flip, take/show/play from a private hand, return, save/reload and reconnect.
5. Confirm Mahjong uses its engraved GLBs and common green-backed concealed model;
   repeat in compact/touch and check an old flower/season tile still uses its image.

Manual Mahjong testing remains pending. Shogi is not integrated.

Pouch recolor follow-up: the owner reported that fresh draws retained their colors, then
identified a missing server restart. New browser controls require the updated server message
validation; a browser refresh alone leaves the old handler running. No production change
was needed. A regression now sends Base/Inset/finish group messages through production
piece handlers and verifies all mixed bare/styled stock in hand, table and inspection draws.
The regression passes; post-restart user verification has not been reported.
