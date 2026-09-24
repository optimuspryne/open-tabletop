# Roadmap easy wins — implementation handoff

Implemented locally: GM object labels (#13), low-stock labels (#23), shared object highlighting
(#24), and baseline silhouette placards (#16). Alternate placard shapes/flair remain planned.
The user reports all manual tests green and has approved this batch for commit, including the
startup fix, sharper placards, and larger avatar uploads. No migration or dependency changes
are required; deploying the batch requires a server restart and client refresh.

## Behavior and reuse

- GM **Labels…** in the object menu edits its persistent name and eligible stock warning. **L**
  provides keyboard access, including cards whose desktop right-click remains Flip.
- Low-stock warnings use an explicit full quantity and appear strictly below the chosen
  percentage. Refills leave the reference fixed. Splits copy settings; deck combines retain the
  lowest deck's settings, and dispenser gathers retain the first selected stack's settings.
- Middle-click an object while nothing is held, or choose **Highlight**, to show a shared
  3.2-second pulsing halo. Repeats refresh one effect per object. Held-object rotation, empty-table
  pings, selection, materials, and physics retain their existing behavior.
- Placards are larger silhouettes with an avatar face, accent outline, name plate, and existing
  SHOWING badge. Their geometry/materials/textures are released on replacement and removal.
  A sharpness follow-up redraws their artwork at 640×896 on Low/Medium and 960×1344 on High
  without increasing world size. New avatar uploads from lobby/table are 512×512 JPEGs at quality
  0.85 with a shared 512 KiB encoded-data limit. Existing avatars need re-uploading for more detail.
- Label settings reuse public piece props, existing scene/game persistence, menu routing, and
  dialog components. A focused label controller owns its editor and sprite lifecycle; shared
  validation serves both runtimes. Highlights extend the existing effects/message controllers.
  Future GM hiding still requires server-side delivery filtering for all annotations/effects.
- Tile and tile-box sounds are recorded as owner-confirmed Claude-created CC0 assets; no
  third-party attribution is required for these files.

## Verification

- `npm run check`: passed; lint, formatting, CSS checks, and **640 tests** in the final batch.
- `npm run test:input`: **57/57** browser input checks passed.
- `npm run test:components`: passed for desktop and 390 px touch fixtures, including production
  bootstrap, GM menu actions, dialog lifecycle, threshold updates, permissions, and resource cleanup.
  A startup follow-up adds delayed piece hydration to production bootstrap and tests absent room,
  absent state, and absent pieces during label rendering/editing, cleanup, and recovery.
- `npm run test:devices`: all **7** device/layout profiles passed.
- `git diff --check`: passed. Local links in changed documentation checked.
- Rendered previews of the halo, silhouette textures, and phone label dialog were visually reviewed.
  This does not establish live multiplayer synchronization, real-device gesture feel, or GPU cost.
- Resolution follow-up: `npm run check` passed (638 tests). A browser probe verified Low/Medium
  640×896 and High 960×1344 textures with anisotropic filtering; an enlarged before/after preview
  confirmed sharper text and outlines. Check normal/close zoom after refreshing clients.
- Avatar upload follow-up: `npm run check` passed (640 tests), plus desktop/touch component checks.
  Real lobby and table upload controls both encoded a detailed test image at 512×512 (250,043
  data-URL characters, within the new cap). Restart the server, refresh clients, and re-upload an
  original avatar; verify the new image remains after signing back in. The user subsequently
  reported all manual tests green and approved the completed batch for commit.

Smoke test with a GM and a second viewer: name/move/save/reload an object; draw/refill across a
stock threshold; highlight a moving object from desktop and touch; check occupied-seat placard
readability. Reusable regression checklist: [DEVICE_QA.md](DEVICE_QA.md).

## Changed-file inventory

| File | Functions or responsibility changed |
| --- | --- |
| `public/client.js` | Instantiate/inject label controller, update annotations in the render loop, and dispose them on removal. |
| `public/rendering/core.js` | Add named `CONFIG.highlight` tuning values. |
| `public/rendering/graphics.js` | Restyle `makePlayerTexture`; ignore/cancel avatar redraw after disposal. |
| `public/table.html` | Add label editor and desktop/touch/GM help. |
| `public/table/controls.js` | Update semantic middle-click comments. |
| `public/table/effects.js` | Add highlight request, texture, spawn, update, and cleanup helpers; extend `bindPings`, `updatePings`, and `disposeSurface`. |
| `public/table/input-router.js` | Route piece highlights and GM label shortcut through existing guards. |
| `public/table/piece-labels.js` | New `createPieceLabels`, with editor, texture creation, update, and removal ownership. |
| `public/table/piece-ui.js` | Extend `pieceMenuItems` and contextual guide with Highlight and GM Labels actions. |
| `public/table/presence.js` | Enlarge `refreshMarker`; add `disposeMarker`, used on refresh and `removePlayerVis`; `bindControls` uses shared avatar upload settings. |
| `public/table/table-shell.js` | Register label dialog with existing dialog/focus handling. |
| `shared/piece-labels.js` | New limits, `normalizePieceLabels`, `finiteStockCount`, and `lowStockText`. |
| `server/deck-state.js` | Preserve annotations in `deckSpawnProps`. |
| `server/game/handlers/pieces.js` | Register GM-only `setPieceLabels`; preserve annotations in `gatherDispensers`. |
| `server/game/handlers/room-features.js` | Register validated/throttled `highlightPiece` broadcast. |
| `server/game/piece-lifecycle.js` | Preserve normalized deck annotations during spawn/reconstruction. |
| `scripts/component-parity.mjs` | Exercise real label/effect controllers, menus, dialog and lifecycle behavior on desktop/touch. |
| `test/backend-piece-handlers.js` | Validate label permissions/payloads and dispenser-gather metadata preservation. |
| `test/backend-piece-lifecycle.js` | Verify deck annotation reconstruction without publishing private cards. |
| `test/backend-room-feature-handlers.js` | Validate highlight targets, spoof rejection, throttling, revocation, and no piece mutation. |
| `test/input-router.js` | Cover highlight targeting/modal guards and label shortcut behavior. |
| `test/piece-labels.js` | Cover shared limits, thresholds, unsupported/infinite containers, and count wording. |
| `test/presence.js` | Verify placard resource disposal and avatar resizing/protocol delivery. |
| `shared/avatar.js` | Shared upload size/quality/encoded-length settings and relocated `isBoundedImageDataURL`. |
| `public/landing.js` | `fileToAvatarDataURL` uses shared 512×512/quality settings. |
| `server.js` | Import shared avatar validator for existing room and HTTP registrations. |
| `server/http/routes/rooms.js` | Allow the larger avatar data URL plus JSON envelope in the profile route. |
| `test/avatar.js` | Verify legacy/new avatar acceptance, encoded-size rejection, HTTP parsing and save boundaries. |
| `CHANGELOG.md` | Record implementation and preceding roadmap updates under Unreleased. |
| `docs/ARCHITECTURE.md` | Document controller ownership, public-state boundaries, and earlier roadmap reconciliation. |
| `docs/ASSET_CREDITS.md` | Record tile sound provenance and owner-confirmed CC0 distribution. |
| `docs/DEVICE_QA.md` | Add pending multiplayer/device smoke checks. |
| `docs/GESTURES.md` | Record desktop/touch highlight and GM-label paths. |
| `docs/REFERENCE.md` | Document modules, protocol, persistence, thresholds, merge policy, and rendering lifecycle. |
| `docs/ROADMAP.md` | Preserve earlier reconciliations/additions; distinguish implementation from pending play tests/customization. |
| `docs/EASY_WINS.md` | This implementation, verification, and file-inventory handoff. |
