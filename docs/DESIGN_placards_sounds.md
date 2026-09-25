# Placard presets and tile sounds — 2026-09-24

Implemented locally; the user approved the corrected masculine head and tile sounds and requested a commit.
Comprehensive live multiplayer and real-device checks were not separately reported.
The user approved the eight-preset lineup and per-account ownership before implementation.

## Scope and reuse

Settings → Placard offers Body 1 (feminine), Body 2 (masculine), pointed-ear/floppy-ear dogs,
shorthair/fluffy cats, frog and gecko. Solid, gradient, stripes, dots, stars and checkerboard use
two custom colors. Avatar faces, name plates and seat-color outlines retain their roles.
The preview shares the actual marker painter. Save persists to the account; Default is a preview
until saved. These are stylized silhouettes, not detailed breed models or uploaded textures.

Extend the existing marker texture and Settings shell. A focused rendering module owns the new
paths/patterns; a settings controller owns drafts and acknowledgment. The room-access registry is
the existing owner of cross-room account connections, so it serializes account saves and publishes
completed changes. Server normalization and participation checks remain authoritative. A fresh
join/reconnect reads the durable account setting; migration 021 is also in the fresh-install schema.
No profile is copied into portable scenes. Existing avatars are preserved.

Three tile-flip clips and three box-shake shuffle clips are original deterministic synthesis,
without source recordings. Existing named tile metadata selects them; paper cues stay unchanged.
Mixed flips emit one cue per material rather than one per piece. The existing audio manager owns
random variants, volume and mute. Python/ffmpeg is an offline authoring tool, never a runtime dependency.

## Files and functions

| Files | Changes |
| --- | --- |
| `shared/placards.js` | Add preset/default registries, strict `normalizePlacard`, forgiving saved-data `readPlacard`. |
| `public/rendering/placards.js` | Add authored silhouette paths, `star`, and `drawPlacard`, shared by actual marker and preview. |
| `public/rendering/graphics.js` | Extend `makePlayerTexture` to delegate drawing; retain avatar/texture lifecycle and quality. |
| `public/table/placard-settings.js` | Add `createPlacardSettings` with control/message binding, draft preview, hydration, save/failure/late-ack handling. |
| `public/table/presence.js` | Extend `createPresence`, `bindRoom`, `bindMessages`, `bindControls` to own the editor and refresh changed marker/preview. |
| `public/table.html`, `public/styles.css` | Add Settings tab, labeled controls, live status/preview and wrapping layout; update in-app help. |
| `postgres/021_user_placards.sql`, `postgres/schema.sql` | Add durable `users.placard`, defaults and fresh-install migration bookkeeping; do not rewrite prior numbered migrations. |
| `server/user-queries.js` | Extend `publicUserRow` with normalized account appearance (also used by auth reads). |
| `server/database.js`, `db.js` | Add and export `setUserPlacard`. |
| `server/room-access.js` | Extend `readAccess`/`reconnect`; add serialized `savePlacard` across registered account connections and refresh stale pending appearance reads. |
| `server/game/schema.js`, `server/game/player-seats.js` | Add `Player.placard` and hydrate it in `createJoinedPlayer`. |
| `shared/room-capabilities.js`, `server/game/handlers/members.js` | Classify/register `setPlacard` as personal, validate and acknowledge only successful writes. |
| `server/game/handlers/cards.js` | Extend `registerCardHandlers` flip/shuffle handlers to select tile cues. |
| `server/game/handlers/pieces.js` | Extend `registerPieceHandlers` group flip to deduplicate material cues. |
| `public/table/effects.js`, `public/table/audio.js` | Extend `bindTableEffects` shuffle dispatch and register six new clips in `SOUNDS`. |
| `scripts/generate-tile-sounds.py` | Add deterministic `impact`/`generate` synthesis and offline OGG encoding. |
| `public/static_assets/sounds/tile-flip-1.ogg`, `tile-flip-2.ogg`, `tile-flip-3.ogg` | Add three short tile-flip variants. |
| `public/static_assets/sounds/tile-shuffle-1.ogg`, `tile-shuffle-2.ogg`, `tile-shuffle-3.ogg` | Add three short box-shake variants. |
| `public/credits.js`, `docs/ASSET_CREDITS.md` | Record original procedural synthesis and CC0 provenance, separate from older Claude-created cues. |
| `test/placards.js` | Cover invalid/legacy settings, actor-only writes, cross-room updates, reconnect, failures, ordered writes and revoked queued access. |
| `test/backend-card-handlers.js`, `test/backend-piece-handlers.js` | Cover named tile/material sound routing, concealed-face retention and mixed-group deduplication. |
| `test/backend-member-handlers.js`, `test/backend-database-factory.js` | Extend registration and real facade coverage. |
| `test/integration/database.js`, `scripts/test-database.mjs` | Cover real account persistence, fresh schema, and migration 021 on an existing avatar-bearing account. |
| `scripts/component-parity.mjs` | Add desktop/touch appearance flow, all preset/pattern texture rendering, failed saves/late acknowledgments, decoded non-clipping audio, and effect routing. |
| `CHANGELOG.md`, `docs/ROADMAP.md`, `docs/DESIGN_future_backlog.md` | Record implemented scope and user approval of appearance and tile sounds. |
| `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/GESTURES.md`, this document | Record contracts, ownership, controls, file/function summary and verification. |

## Verification

- `npm run check`: lint, formatting, canonical CSS and 767 tests passed.
- `npm run test:integration`: 20 tests passed, including account persistence and migration-upgrade setup.
- `npm run test:components`: full desktop/coarse-touch suite passed, including sound decoding and late acknowledgments.
- `npm run test:devices`: all seven profiles passed.
- Gallery and actual desktop/390px Settings panel screenshots inspected; no clipping found.
- Input intents/gestures were not changed; no `test:input` run required.

The sandbox initially blocked local HTTP listeners and Docker; the same suites were run with
those test capabilities enabled. No production database was used. Existing component fixtures
report expected thumbnail-path 404s; those do not indicate missing new sound assets.

## Manual smoke test

Restart the server to apply migration 021; refresh all browsers.

1. Settings → Placard: preview all eight silhouettes and patterns, set colors, save. Another
   player should see the change; your own seat retains its YOU chip. Check names/avatar readability.
2. Join a different room, open another tab and reconnect: appearance should follow the account.
   Change it in one tab and check the others. Repeat while spectating or timed out.
3. On phone/tablet, tap through controls, inspect the preview and save. Check actual seat views
   at normal zoom with several players. Automated layout is not real-device feel/GPU validation.
4. Flip and shuffle Dominoes, Wordy and Mahjong. Compare ordinary cards and a mixed selection.
   Listen for comfortable levels/variation; verify SFX mute/volume and separate music settings.
5. Save failure should keep the draft and prior shared appearance; no success should be reported.

The user approved committing this work after reviewing the masculine-head correction and tile sounds.
No push or release is authorized by that approval; the smoke-test list remains a reference, not a claim
that every scenario was manually verified.
