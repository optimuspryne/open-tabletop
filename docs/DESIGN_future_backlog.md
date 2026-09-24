# Future backlog: discovery briefs

Status: **planning notes, not implementation-ready specifications**. Baseline: `b7390c6`.
These briefs cover the remaining open areas in [ROADMAP.md](ROADMAP.md), apart from the detailed
[time-out/spectator, deck browsing, and collections plans](DESIGN_next_features.md).
They preserve likely starting approaches and questions for a future source audit. Effort labels
are relative; they are not delivery estimates or evidence that the underlying design is settled.

Completed object labels, low-stock warnings, highlights, placard styling/resolution, and avatar
uploads are not being reopened. Placard customization remains a separate optional extension.

The participation foundation is committed as `c51423a`; durable GM time-outs and transition
cleanup are now implemented with user-reported functional and UI approval. See the
[time-out checkpoint](DESIGN_next_features.md#stage-2-time-out-checkpoint--2026-09-24).
The shared request registry supplies guarded registration for future inventories/notecards and
other gameplay features. Self-service spectator entry/seating is implemented with user-approved functionality and UI;
comprehensive live multiplayer/touch coverage is not inferred; see the
[spectator checkpoint](DESIGN_next_features.md#stage-3-spectator-checkpoint--2026-09-24).
Private deck browsing is also implemented locally with GM-only defaults and a per-deck player
toggle; the user reports manual tests passing (2026-09-24), committed as `f14a4f1`. Shared,
site-admin-managed collections are committed as `7856d03`; automated checks passed and the user
approved functionality and the final UI (2026-09-24). See the [collections checkpoint](DESIGN_next_features.md#collections-checkpoint--2026-09-24).
No backlog feature below is implemented by these slices.

## Where to investigate first

| Area | Roadmap scope | Assessment | First investigation |
| --- | --- | --- | --- |
| Object hiding, fog, GM staging | 14, 4, distribution §3 | Large architectural work | Authorized state delivery and collision/privacy behavior |
| Player inventories | 21 | Large | Full object serialization and recoverable transfers |
| Drawable notecards | 17 | Large | Per-object drawing ownership and concealed artwork |
| Asset/collection export/import | 19 | Large | Typed dependency graph and bounded package format |
| Rulebooks/builder | 20 | Very large; split into releases | Markdown-only reader prototype and pagination |
| Interactive tutorial | 2 | Medium | Choose walkthrough versus starter scene |
| User-authored games/starters | 7 | Medium-to-large | Gap between saved scenes and reusable starter definitions |
| Placard shapes/flair | Remaining part of 16 | Small-to-medium if built-in presets | Readability/scale mockups and ownership of customization |
| Additional content/deck skins | Distribution §2 | Small content increments; skins medium | Asset readiness, licensing, editor/geometry compatibility |
| Reliability/device polish | Distribution §§1/5 | Variable, measured first | Reproducible reconnect, load and device scenarios |
| Tile cue variants/shared browser helpers | Parked threads | Small focused slices | Current sound dispatch and genuinely duplicated behavior |
| Public demo | Distribution §4, optional | Operational project | Hosting, reset, upload and abuse limits |

Do not bundle the first five into one overhaul. Hiding needs its own proof of concept; inventories
and notecards should each prove one lossless object lifecycle before adding UI polish. Collections
can ship before export/import. A read-only Markdown rulebook is a useful release before a full builder.

## Concealment: hidden objects, fog of war, and GM staging

**Goal:** hide an individual object from players while showing a ghosted version to GMs; later
support concealed areas and a preparation zone. Include persistent labels, held-by labels, count
warnings, highlights, previews and sound events in the visibility policy.

**First slice:** one hidden ordinary prop, seen by a GM and absent from a player client's delivered
state. Audit synchronized state, custom messages, reconnect hydration, asset references, scene/game
exports and inspection paths before choosing a per-viewer projection. A client-side `visible=false`
or transparent material is not sufficient. Visibility roles can change while a load is in flight.

**Decisions:** do hidden objects collide with visible pieces, and can those collisions reveal them?
Is hidden geometry part of the same simulation, isolated until reveal, or non-colliding? Which
GMs share hidden content? How are height, fog boundaries and partial coverage defined? What
happens to selection/ownership when an object is hidden while held? A file/face already delivered
cannot be made unknown; distinguish future delivery protection from revoking old knowledge.

**Stages:** verify private state delivery; implement per-object Hide/Reveal and cleanup; prove
save/load/reconnect and role transitions; only then design area-based fog and GM staging on the
same visibility rules. These are three deliverables, not three menu labels for the same feature.

**Acceptance bar:** a second client cannot recover newly concealed state through normal room
messages; ghosting is clear to authorized GMs; no public pickup label/ping leaks the object; save,
restart, removal, role changes and collision policy behave consistently. This requires a deeper
architecture review than the completed cosmetic labels/highlights.

## Player inventories

**Goal:** store a tabletop object per room/account and place that same object back later.
Preserve custom asset references, properties, contained cards/items, orientation where useful,
and private faces. Do not duplicate objects or turn this into automatic game-rule accounting.

**First slice:** store/retrieve an ordinary prop with a stable inventory entry ID, explicit server
ownership and a persistence contract. Then expand to containers, decks, tiles and other types.
Reuse established account-hand recovery patterns where their invariants match; do not force a
full physics object into the current hand-card record merely to reuse its UI.

**Questions:** private or room-visible inventory lists? Can GMs inspect/reassign items? Must an
object be held or unowned before storing? Which objects are ineligible (table, trays, overlays,
shared boards)? Do inventory changes survive immediately or at a room checkpoint? How do room
capacity, deleted assets, duplicate tabs and room resets interact with retrieval?

**Main risk:** database transactions alone cannot atomically cover a live physics object and a
stored entry. Define the consistency/recovery boundary before coding: serialized room operations,
idempotent requests, a durable snapshot/journal strategy, and explicit compensation for failed
spawn/save. A full table or database failure leaves one recoverable owner of the object.

**Acceptance bar:** repeated requests, crashes/restarts, failed placement, disconnects and concurrent
retrieval preserve exactly one object plus all contents. Inventory survives the account reconnecting
but is excluded from portable scene templates. Treat time-out/spectator participation as a prerequisite
permission check, not a client-only disabled button.

## Drawable mini-whiteboards / notecards

**Goal:** a larger, heavier card-like object that can be drawn on in Inspect and passed face-up or
face-down for games such as Telestrations.

**First slice:** one drawable face, inspect-to-edit, pen/eraser/clear, flip, and saved artwork.
Use shared dimensions/mass/collider definitions for rendering and physics. Evaluate reuse of the
existing whiteboard's drawing tools separately from its room-wide ownership/broadcast model.
A concealed notecard needs per-object authorized drawing delivery.

**Questions:** who may read/edit a face-down notecard? Does taking it into a hand reserve editing?
Is artwork represented as bounded strokes, a raster image, or both? Where are generated images
stored, how are revisions saved, and when are temporary textures/files cleaned up? Is Undo needed
in the first release? What happens when another player picks up or flips an actively edited card?

**Stages:** geometry/handling; private drawing ownership and revision checks; persistence/transfer;
then touch ergonomics, preview performance and history controls. Export must include authored
artwork when allowed. Bound stroke/image growth without silently discarding a player's work.

**Acceptance bar:** artwork survives saves and transfers; face-down previews do not reveal it;
two editors cannot overwrite each other silently; pen input does not drag the physical card;
time-out releases editing safely; large drawings remain responsive on phones/tablets.

## Asset and collection export/import

**Goal:** portable single assets or collections, including their required files and metadata.
Design this alongside the collection identity model, but implement after collection CRUD/filtering.

**First slice:** a versioned manifest and dry-run dependency report for one simple asset, then a
complete round trip. Treat every reference by type: deck faces/backs, models and materials,
colliders, sky faces, generated artwork and scene dependencies need explicit resolvers.
Preserve uploaded originals and authored materials. Do not copy entire asset directories.

**Questions:** what may ordinary users export versus admins? Which sources may be redistributed?
Should duplicates be kept, reused by content hash, or replaced only with explicit selection?
How are missing dependencies, version mismatch and name conflicts presented before import?
What happens to ownership and public/private flags on the destination installation?

**Stages:** format/schema and dependency walkers; bounded export; staged import/validation;
transactional metadata/reference remapping; collection membership; multi-type compatibility tests.
Use package-local IDs, never installation database IDs as portable identity. Reject path traversal,
absolute paths, symlinks and excessive expanded sizes/counts. Do not automatically fetch arbitrary
remote URLs. Failed import cleans up only its own temporary/new resources.

**Acceptance bar:** round trips work on a second installation without broken references; failed
imports leave existing assets intact; duplicate names/IDs cannot overwrite unrelated assets;
packages contain no live hands, player inventories, sessions, tokens or private room snapshots.

### Dice texture package checkpoint — 2026-09-24

**Implemented locally; automated checks passed; user-reported manual testing passed (2026-09-24).** User approved the
admin-only first slice. Custom dice textures provide one lossless asset/image round trip before
adding dependency walkers for other types or collection membership. Imports always create new
private copies owned by the importing admin; duplicate names are allowed and never overwrite.

Library → Import / export assets accepts `.ott.json` files and asks the server to validate them
before showing the proposed name, dimensions, byte size and included image count. The admin can
rename, then explicitly choose **Import private copy**. Custom dice overflow menus offer **Export**.
The shared Library body scrolls normally on desktop/touch; controls use native keyboard behavior.
Packages carry no account IDs, server paths, room/player state or publishing instructions.

Version 1 uses a JSON manifest with package-local IDs and one base64 image with a SHA-256 checksum.
Limits: one dice texture, one PNG/JPEG/GIF/WebP image, 8 MiB original, 16 megapixels, single frame,
12 MiB request/file, 80-character name. Exact schema validation rejects unsupported versions,
missing/extra dependencies, arbitrary paths/URLs and unknown fields. Export reads only generated
local dice filenames and refuses symlinks. Import writes a fresh exclusive filename and reuses
transactional dice insertion, rechecking admin access after asynchronous work and before commit.
Definite failures remove only that newly written file; uncertain commits retain it for recovery
and existing orphan cleanup after its normal grace period. No database migration is needed.

Files/functions in this slice:

| File | Change |
| --- | --- |
| `shared/asset-package.js` | Add format/size constants, `AssetPackageError`, and `packageName`. |
| `server/assets/packages.js` | Add strict `inspectAssetPackage`, image decoding, and `createAssetPackages` with bounded `exportDice`/exclusive-file `importDice`. Reuse image magic validation. |
| `server/http/routes/asset-packages.js`, `server.js` | Add/register admin-authenticated export, preview and import routes using the existing rate limiter and async error boundary. |
| `server/database.js`, `db.js` | Let existing `insertDice` accept a transaction query; add/export `importDicePackage` with rollback and uncertain-commit handling. |
| `public/editor/asset-packages.js` | Add `createAssetPackageController`, preview/import/download flow, errors, duplicate-submit protection and identity cleanup. |
| `public/editor/editor-panel.js` | Connect the controller to room/admin lifecycle, refresh dice after import, and add the custom dice Export action. |
| `public/table.html`, `public/styles.css` | Add bounded, wrapping library import controls and help; reuse canonical components and existing Tabler icons. |
| `test/asset-packages.js` | Cover round trips, original bytes, bad packages/paths, admin loss, write failures, rollback and production HTTP router. |
| `test/backend-database-factory.js`, `test/integration/database.js` | Verify production facade and actual PostgreSQL private insertion/rollback. |
| `scripts/component-parity.mjs` | Exercise preview, rename, failure/retry, reachable import controls, role loss and the real dice export action on desktop/touch. |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/GESTURES.md`, both design plans | Record scope, contracts, controls and current verification status. |

Verification: `npm run check` passed (731 tests in the current shared working tree);
`test:integration` passed (14 tests); `test:components` passed desktop/coarse-touch scenes;
`test:input` passed (57/57); `test:devices` passed all seven profiles. The final package-specific
browser flow and desktop/touch screenshots were checked separately after the last controller
changes. `git diff --check` passed. Automated round trips use separate temporary asset stores;
a second live installation and specific real-device coverage were not separately reported.

Manual smoke tests (restart server and refresh browser):

1. As a site admin, export an uploaded custom dice texture from its **More actions → Export** menu.
2. Import that package on this or a second installation. Preview the name/image information,
   rename it, and import. Confirm a separate private texture appears under Dice → Custom/All
   (enable Uncollected if collection filters hide it), and applying it preserves the original look.
3. Import it again with the same name: both copies should remain independent; the original remains.
4. Try malformed JSON or change the package checksum: see an error without a new asset.
5. Check desktop and touch scrolling, keyboard focus, Import/Cancel, and a non-admin account
   without the transfer controls. Full multi-installation and real-device coverage were not
   separately reported in the user's successful manual test.

## Physical rulebooks and builder

**Goal:** a spawnable book whose Inspect view reads a rules document, plus custom uploads and a
Markdown authoring workflow. Built-in content needs explicit redistribution permission/provenance.

**First release:** Markdown-only custom rulebook with title, deterministic page breaks, readable
inspection, navigation/search as appropriate, and saved source. Decide whether pagination uses
explicit authored separators or a fixed layout; do not depend on each viewer's screen size to
assign page numbers. Render sanitized content under the existing CSP; no embedded script execution.

**Later releases:** ordered image pages; multipage PDF import/reading with bounded page counts and
resource use; then a builder with edit/preview, page management and save-as-copy. Image/PDF sources
remain viewable originals; editable Markdown conversion is a separate feature, not an assumption.
Keep heavy decoding out of the render loop and bound cached page textures.

**Questions:** does each viewer keep their own reading page, or can a GM invite others to a page?
What is stored versus generated? Are external links/images allowed? What accessibility and text
selection are required? Should the closed object's geometry vary with page count? Can players
read while another is editing, and how are revisions published?

**Acceptance bar:** clear reading on phone and desktop; preserved source/order; safe malformed-input
handling; no unbounded PDF/texture memory; no lost edits; compatible collection/export references.
This is a document product inside the tabletop and should be staged accordingly.

## Tutorial and custom games

**Interactive tutorial (item 2):** choose a dismissible overlay in an ordinary room or a dedicated
starter scene before implementation. Start with picking up, inspecting, flipping, drawing and
camera controls. Detect physical interaction milestones rather than legal game moves. Keep
progress local unless cross-device persistence is explicitly needed. Do not reset a live group's
table to teach one player. Acceptance: skip/restart works, mouse/touch instructions match the device,
and completing/dismissing the tutorial leaves no forced UI state.

**User-authored games (item 7):** compare existing saved scenes with the desired starter workflow.
Start with naming and saving a reusable setup plus explicit seat/hand initialization, not a rules
engine. Determine whether starter content contains assets by reference or packages them; private
hands/player identities must not enter portable templates. Define what applying a starter replaces,
capacity checks and confirmation for destructive reset. Acceptance: another authorized host can
load the setup predictably, with no copied player data or silent partial placement.

## Optional placard customization

The baseline silhouette and sharper avatars are complete. Remaining scope is selectable built-in
shapes, accent/flair presets and possibly per-player decoration. Begin with two or three mockups
using identical name/face bounds and test all occupied seats at normal zoom. Store a bounded preset
ID, not arbitrary shader/code payloads. Decide account-wide versus room-local preference before
adding persistence. Acceptance: identity remains legible, color contrast works, and decorations
do not hide cards or substantially increase draw/texture cost. Arbitrary uploaded placard models
are a separate larger feature.

## Content and small finish work

- **Tokens, markers, RPG battlemaps, starter games and tile art:** small independent additions
  once geometry, source/licensing and mobile preview cost are known. Audit the relevant painter
  or asset registry at implementation time; avoid adding rule enforcement with the content.
- **Uploaded deck skins:** medium feature. First specify supported geometry/collider and tint
  slots, thumbnailing, how a model fits changing stack height, and source preservation. Prove
  one uploaded skin on cards and tiles before exposing a broad builder. Include export dependencies.
- **Tile shuffle/flip sounds:** small finish. Audit event dispatch and existing sound assets,
  choose appropriate variants, update credits only if new provenance requires it, and test mute,
  volume, mixed card/tile play and repeated events. Existing Claude-created tile/box cues are CC0.
- **Shared browser helpers:** narrowly consolidate genuinely repeated API/auth/button behavior
  after checking current callers. Older roadmap module/line references are historical clues, not
  proof of duplication. Keep error behavior, HTTP auth and existing UI components compatible;
  follow [CLIENT_REFACTOR.md](CLIENT_REFACTOR.md) and [DRY_CLEANUP.md](DRY_CLEANUP.md).

## Reliability, device polish, and optional demo

**Large scenes/saves:** implementation safeguards already exist; remaining work is repeatable
end-to-end validation at the current capacity limit and near snapshot-size limits. Record save
failure feedback, reload/restart results, card conservation, asset memory, frame timing and device.
Do not raise caps again solely because an older benchmark was fast.

**Reconnect and connection feedback:** reproduce loss of connectivity during grabs, inspection,
browsing, drawing, avatar uploads and saves. Separate reconnecting, retryable failure and revoked
access in the UI. Preserve recoverable inventory; test backgrounded phones and duplicate tabs.
Use an explicit failure matrix before deciding which indicators or retry controls are missing.

**Touch/gesture polish and optional group rotation handle:** use [GESTURES.md](GESTURES.md),
[DEVICE_MATRIX.md](DEVICE_MATRIX.md) and [DEVICE_QA.md](DEVICE_QA.md) to identify precise gaps.
Current rotation controls are implemented; a grab-and-spin handle is optional refinement. The
user's easy-wins sign-off does not establish a full device/browser matrix for future changes.
Require real-device feel checks after automated layout/input coverage.

**Placed-face texture eviction:** a later measured memory optimization, not a blanket cache purge.
First determine reference ownership across table, hand, inspection and preview use. Dispose only
when the last consumer is gone; compare repeated spawn/remove/inspect cycles on constrained devices.

**Public demo:** optional operational work. Define account/room expiration, table resets, upload
limits, storage quotas, moderation/contact and update ownership before provisioning. Treat the
demo as disposable, isolated from private installations. Cost/hosting choices need fresh research
when the work starts; this brief selects no provider or deployment.

## From discovery to implementation

For any brief, inspect current ownership and callers, write the unresolved decisions and failure
cases, then produce a detailed design before a broad code change. Keep server authority, private
card/hand boundaries, build-free hosting, shared geometry, and bounded resource lifetimes intact.
Use new migrations where needed and separate portable content from account-bearing room saves.
Update the roadmap/reference/architecture/changelog alongside each shipped slice, with automated
checks and actual manual verification reported separately. No runtime features are implemented by
this document.
