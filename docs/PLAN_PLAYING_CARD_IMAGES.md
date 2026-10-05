# Image-based standard decks

Status: decks and approved private-hand image follow-up implemented and automatically
tested. The user confirmed the feature works and looks good; the individual
multiplayer, reconnect, and real-device smoke checks below are not separately confirmed.

## Approved scope

The user supplied `playingcards_bridgesize_png.zip` and approved blue/red back
thumbnail choices for the 52/54-card library entries, blue by default, in full,
compact, desktop, and touch layouts. Preserve bridge proportions and the existing
rank/suit sorting. The follow-up approval replaces bundled playing-card hand labels
with complete face images in all four layouts, preserving the existing gestures
and controls. Legacy procedural rank cards retain text labels. No new icons were
proposed or added.

## Implementation decision

Reuse the existing image texture loader, thumbnail derivative service, native
controls, deck inventory/transfer/snapshot representation, and `geomFromImage`.
`shared/playing-cards.js` is the new boundary for the artwork catalog and playing
card identity: the server needs image inventory and geometry; the browser needs
rank/suit metadata without treating arbitrary image filenames as playing cards.
The two standard library entries now use one loop with an explicit joker variant.
Legacy procedural references continue to render; existing snapshots are not
rewritten. Exact catalog references can round-trip in asset packages; receiving
installations must include this bundled catalog. No migration, dependency,
environment setting, or build step was added.

The private-hand follow-up extends `renderHand`'s existing image branch rather
than adding a separate renderer or helper. It uses the shared bridge geometry,
existing bounded thumbnail URLs, and current private hand-message delivery.
Gesture handlers and the touch help/gesture contract remain unchanged.

## Files and function changes

| File | Change |
| --- | --- |
| `shared/playing-cards.js` | Added immutable face/joker/back catalogs, bridge geometry, `playingCardFace` identity lookup, and `bundledPlayingCardReference` exact membership gate. |
| `public/static_assets/cards/bridge/*.png` | Added all 56 unchanged originals: `C-1`–`C-13`, `D-1`–`D-13`, `H-1`–`H-13`, `S-1`–`S-13`, `X-B`, `X-R`, `Back-B`, `Back-R`. |
| `shared/image-thumbnails.js` | Extended bundled raster thumbnail eligibility to `/cards/`. |
| `server/static-assets.js` | Added the cards category to `staticAssetMounts`; updated category-count comment. |
| `server/game/deck-builders.js` | Extended `buildSimpleDeck` with a validated/defaulted back design, image inventory, and independent bridge geometry. |
| `server/game/piece-lifecycle.js` | `spawn` passes the back design to the builder and preserves an explicit spawn snap preference. |
| `server/message-validation.js` | `spawnPayload` accepts only blue/red standard-deck back IDs; rejects back selection on tile sets. |
| `server/assets/package-decks.js` | `generatedDeckReference` recognizes exact bundled card references alongside legacy procedural tags. |
| `public/rendering/graphics.js` | `parseCardFront` retains playing-card identity for bundled faces; `resolveTexture` loads their image refs; `cardMesh` applies image cap masking to recognized playing-card artwork too. |
| `public/editor/editor-panel.js` | Extended `spawnCard` with optional native back radios and a preview callback; consolidated standard entries in `renderBuiltin`; updated cards-starter thumbnails. |
| `public/styles.css` | Added focused library selector layout, thumbnail sizing, wrapping, and focus styles using existing tokens/classes; bundled hand faces use contain sizing to retain corner indices. |
| `public/table/hand.js` | Extended `renderHand`'s existing image branch to bundled rank/joker faces, with shared bridge aspect and accessible card/Inspect names. Sorting and gesture handlers remain unchanged; no new helper functions. |
| `public/credits.js` | Added courtesy CC0 playing-card credit to `ART_CREDITS`. |
| `test/backend-deck-builders.js` | Tests complete rank/suit/joker inventory, blue/red defaults, bridge aspect, fresh geometry, and shuffle behavior. |
| `test/backend-piece-lifecycle.js` | Tests production builders through normalized spawn, real collider maintenance, and reconstruction, with private faces and preserved back/geometry/snap. |
| `test/backend-messages.js` | Tests accepted and rejected spawn back payloads. |
| `test/backend-static-assets.js` | Includes every bundled card image in production HTTP catalog checks. |
| `test/backend-asset-textures.js` | Tests real bundled PNGs through alpha-preserving WebP thumbnails with unchanged originals. |
| `test/asset-texture-url.js` | Tests cards thumbnail URL mapping. |
| `test/hand.js` | Tests image faces, accessible card/Inspect names, legacy rank labels, joker inspection, and numeric rank/suit sorting through the existing hand controller. |
| `test/asset-packages.js` | Tests bundled image-deck export/import and rejection of arbitrary static references. |
| `scripts/component-parity.mjs` | Added full/compact deck selector and private-hand face scenes on desktop/touch, real image texture loading and bridge mesh checks, bounded bundled image fixtures, and retained legacy PNG fallback checks. Client bootstrap also delivers the new faces through its real private hand handler. |
| `CHANGELOG.md` | Recorded the feature under Unreleased, preserving other work. |
| `docs/ARCHITECTURE.md` | Documented catalog/state ownership, package compatibility, and the seventh static asset category. |
| `docs/REFERENCE.md` | Updated builders, catalog helpers, spawn controls, and static asset mounting contracts. |
| `docs/ASSET_CREDITS.md` | Recorded source, creator, CC0, original filenames, and thumbnail derivation. |
| `docs/PLAN_PLAYING_CARD_IMAGES.md` | This implementation and verification record. |

No production functions were removed. Existing hand, transfer, persistence, and
starter orchestration modules remain the callers of the reused contracts.
Unrelated working-tree documentation, lockfile, and website changes were preserved.

## Verification

- `npm run check`: private-hand follow-up passed, 940 tests plus lint, formatting,
  and CSS checks, including production deck collider maintenance and image-hand
  rendering/sorting/inspection regressions.
- `npm run test:input`: passed, 58 checks.
- `npm run test:devices`: passed, all seven device profiles.
- `npm run test:components`: passed. Includes full/compact deck and private-hand scenes on
  desktop/emulated touch and notecard editor checks at 1280/390/360 px. Existing
  Mahjong thumbnail fixture 404 diagnostics remain unrelated to this change;
  all new playing-card thumbnails and table textures decoded successfully.
- All 54 private-hand faces decoded at bounded thumbnail sizes in full/compact
  desktop and emulated touch modes, with shared aspect and accessible Inspect
  names. The real client bootstrap/private hand callback also rendered new faces.
- Browser fixture: native ArrowRight back selection and preview updates passed
  in full/compact desktop and emulated touch layouts; screenshots inspected.
- PNG originals: all 56 match the supplied archive byte for byte.
- User feedback: the implemented feature works and looks good. The individual
  real-device, GPU-performance, multiplayer, and reconnect checks below remain
  unconfirmed; the feedback does not establish that every smoke-test step was run.

Initial sandbox HTTP tests could not bind localhost ports. Required HTTP/browser
verification was rerun with approved local execution outside the sandbox.

## In-app smoke test

Restart the server for the new static mount and spawn validator, then refresh clients.

1. Spawn each deck size with blue and red backs; verify 52/54 counts, previews,
   table artwork, and joker inclusion.
2. Deal cards, inspect/play/return them, and sort the hand by rank and suit.
3. Save/reload the room and reconnect a second player; verify backs and geometry
   persist without exposing concealed cards.
4. Confirm blue/red cards remain separate when merging into closed decks, and
   an older saved procedural deck still renders.
5. Try keyboard selection and a touch device in full and compact mode.
6. Verify the private strip shows full rank faces and both jokers; scroll, Inspect,
   sort, and play/reorder cards. Confirm another player cannot see those faces.

The private-hand follow-up needs a client refresh only. Restart the server as well
if the original deck-image/static-mount change has not been loaded yet.
