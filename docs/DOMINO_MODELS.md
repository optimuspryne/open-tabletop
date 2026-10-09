# Authored double-six dominoes

## Approved scope

The project owner approved the 28 supplied domino GLBs and concealed model, fitted to
the original 1 × 2 × 0.18 dimensions. The owner subsequently adjusted the shared
half-extents to w=0.25, h=0.5, t=0.05 (full 0.5 × 1 × 0.1). They also approved independent Base/Inset colors,
one finish for the whole domino, and labeled inspector/selection controls across desktop,
compact and touch layouts. The existing Recolor icon remains. No other built-in tile
family is enabled by this refactor; scoring, rules and upload workflows stay unchanged.

The current renderer, previews and appearance paths are shared tile-family support.
See [the extension contract and subsequent verification](TILE_MODELS.md); Domino remains
the first enabled family. The file/helper list below includes the original integration.

## Implementation boundaries

The existing card/deck engine and object material response are extended. One focused
rendering module owns the fixed model cache and async lifecycle; one UI module builds
the two appearances of the same controls. Public shape and appearance travel through
`cardPublicProps`, while faces, order and private entry overrides stay in server storage.
Returning/combining differently colored dominoes preserves their appearance. Recoloring
a bag applies to remaining stock; tiles already in hands or on the table retain theirs.
Original asset bytes/materials are preserved and fitted only at runtime. Storage uses
existing JSON; there are no migrations, environment changes or additional dependencies.

## File and helper summary

| File | Change |
| --- | --- |
| `shared/pieces.js` | Adds `DOMINO_APPEARANCE`, model path, `normalizeDominoAppearance`, `dominoAppearanceOf`, `dominoModel`, `cardPublicProps`; extends `colorProps` with validated, independent appearance patches. |
| `public/rendering/tiles.js` | Adds `createTileRenderer`: bounded template cache, model selection, per-instance painting, fitting, fallback and late-load disposal guard. |
| `public/rendering/graphics.js` | Extends `fitModel` for axis dimensions, dispatches `cardMesh` to models or `proceduralCardMesh`, adds `disposeCardMesh` and `tilePreviewURL`, registers card disposal and preserves browse-owned texture cleanup. |
| `public/ui/tile-appearance.js` | Adds `createTileAppearanceControls` for independent color patches, whole-model finish, mixed labels and phone finish support. |
| `public/table/inspection.js` | Adds domino appearance controls and extends `swapInspect`/`enterInspect`/`releaseInspect` to own, rebuild and dispose model previews. |
| `public/table/selection.js` | Extends `selColorDesc` and `createSelection`/`refreshSelTools` with the existing Recolor popover's domino controls and device class. |
| `public/table/piece-view.js` | Sets group shadow policy for asynchronously loaded descendants; keeps rebuilt cards hidden during inspection. |
| `public/table/hand.js` | Threads appearance into inspection/drag meshes, uses async model thumbnails and owned-card disposal. |
| `public/table/presence.js` | Renders authorized shown-card metadata and disposes fan card models. |
| `public/client.js` | Injects production card disposal, domino thumbnails and device class into hand/presence/selection. |
| `public/editor/editor-panel.js` | Uses authored domino thumbnails in the built-in tile library. |
| `public/table.html` | Adds inspector/selection containers and updates in-app appearance help; existing icons retained. |
| `public/styles.css` | Adds shared appearance layout and desktop/touch inspector docking using existing tokens. |
| `server.js` | Reuses `cardPublicProps` as `geoOf`; seated dealing honors entry appearance. |
| `server/deck-state.js` | Extends `takeTopCard`, `absorbedEntry`, `inspectedEntry`, `deckSpawnProps` to retain private per-tile appearance. |
| `server/message-validation.js` | Extends `groupRecolor`/single recolor validation for bounded appearance-only patches. |
| `server/game/handlers/cards.js` | Draw/deal/inspection paths resolve entry overrides; combine preserves each member's effective appearance. |
| `server/game/handlers/pieces.js` | Forwards the validated appearance patch through existing group recolor. |
| `server/game/handlers/room-features.js` | Authorized hand reveals include public tile shape/appearance. |
| `server/game/deck-browsing.js` | Private previews and transfers resolve entry appearance. |
| `server/game/piece-lifecycle.js` | Restores deck appearance and retains individual appearance on absorption. |
| `server/game/piece-operations.js` | Bag recolor patches remaining entry appearance independently; container colors remain separate. |
| `public/static_assets/models/pieces/dominoes/*.glb` | Adds unchanged copies of all 28 pair files and `Domino_Concealed.glb`. |
| `test/dominoes.js` | Adds asset, privacy, validation, inventory metadata, material isolation, deduplicated-load, failure and disposal regressions. |
| `test/backend-card-handlers.js` | Uses production public-props helper and tests real draw/deal/inspect/return paths for appearance and hidden faces. |
| `test/selection.js` | Tests domino-family group controls, mixed recolor families and defensive handling of malformed legacy props. |
| `scripts/component-parity.mjs` | Adds production-browser checks for all 29 GLBs, dimensions, concealment, materials, thumbnails, inspector/group callers and viewport fit. |
| `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/REFERENCE.md`, `docs/GESTURES.md`, `docs/ASSET_CREDITS.md`, this record | Documents behavior, contracts, provenance, controls and verification; historical entries retained. |

## Verification

The original domino integration passed the following checks before the shared-tile refactor
and owner size adjustment. Current verification is recorded in [TILE_MODELS.md](TILE_MODELS.md):

- `npm run check`: lint, formatting, CSS checks and all 949 tests passed.
- `npm run test:components`: passed, including all 29 GLBs and production appearance
  controls on desktop and 390px touch, plus the existing notecard tests at 1280/390/360px.
- `npm run test:input`: all 58 checks passed.
- `npm run test:devices`: all seven profiles passed.
- Original and bundled GLB bytes match; `git diff --check` passes.

Browser/HTTP fixtures require localhost access. The first sandboxed full test attempt
was stopped after the sandbox blocked HTTP fixtures; the final authorized run passed.
The component harness reports eight derivative-thumbnail 404s in its static fixtures;
the suite passed and its checks loaded every new domino GLB successfully.

Real-device gesture feel, GPU performance and live multiplayer testing are pending.
Restart the server and refresh browser clients before testing.

Manual smoke test:

1. Spawn Dominoes or load the starter; confirm authored faces and matching concealed backs.
2. Inspect a tile, change Base then Inset, choose a finish; confirm each color stays independent.
3. Use Select → Recolor for several tiles and a domino bag; draw after changing remaining stock.
4. Flip, take into a hand, inspect/play, return to a bag and redraw; verify appearance retention.
5. Show tiles to another player; verify authorized faces and styles while concealed tiles stay neutral.
6. Save/reload and reconnect; verify inventory, appearance and private hand ownership.
7. Repeat on touch/compact and with a phone finish fallback; verify controls and rendering.
