# Architecture

A web-based, physics-driven tabletop where any game can be played, because the
engine only ever simulates _physical objects_ and lets humans enforce the rules.

Staged feature plans are separate from this description of the running system:
[DESIGN_next_features.md](DESIGN_next_features.md) plans time-out/spectator permissions, private
deck browsing and asset collections; [DESIGN_future_backlog.md](DESIGN_future_backlog.md) records
lighter discovery briefs for the remaining work. Proposed boundaries and persistence changes
there remain proposed except for the participation-policy foundation recorded below.

## Two worlds, kept apart

The single most important idea: there are two parallel representations of the
table, and separating them is what makes everything work.

- **The physics world** lives in exactly one place — the server. It is a
  cannon-es simulation of bodies (mass, position, velocity, colliders) and is
  the sole source of truth for where everything is. It knows nothing about
  "cards" or "dice", only shapes colliding.
- **The render world** lives on every client — a Three.js scene of meshes.
  Clients run **no physics at all**. They receive positions and draw them.

Colyseus is the bridge: it keeps a chunk of server memory (the "state")
synchronized to every client, sending only what changed, ~60×/second.

    server simulates  →  Colyseus syncs state  →  clients interpolate & draw
    clients send intent (grab/move/release/…)  →  server applies it

Because one authoritative simulation owns all physics, no two clients can
disagree and no client can cheat the physics — they aren't running any.
cannon-es was chosen specifically because it is pure JavaScript, so the exact
same physics code runs unchanged on Node.

## Kinds vs. instances (where OO belongs)

Two things both feel like "objects", but they are fundamentally different:

- An **instance** is a specific die on the table right now. Instances live in
  synced state — serialized and rebuilt on every client many times a second — so
  they **must** be flat, plain records:
  `{ type, props, owner, x/y/z, quaternion, count }`. A rich class instance
  wouldn't survive serialization.
- A **kind** is the _concept_ "a d20", "the chess king", "the standard deck" —
  geometry, collider, textures, behavior. One exists per type, created once.
  **This is where object-orientation belongs.**

So: **rich kinds, flat instances** — the _type-object / flyweight_ pattern.
Variation lives in `props`, not in a proliferation of types: one `die` kind
reads `props.sides`; one `card` kind reads `props.front/back`; one `prop` kind
reads `props.shape` (or a `.glb` `model`) and `props.scale/color/team`.

## Files

The client used to be one inline module; it is now an acyclic composition rooted in
`public/client.js`. Shared policy feeds core rendering and mesh builders, while focused
`public/table/` feature modules receive mutable runtime dependencies explicitly instead of
importing a room singleton:

- **`shared/pieces.js`** — the single source of truth for physics dimensions,
  masses, colors, dice vertices, and the prop/board registries. Imported by
  _both_ sides so a collider and its mesh are built from the same numbers.
- **`shared/overlays.js`** — the shared protocol policy for overlay kinds,
  measurement defaults, overlay capacity, and whiteboard validation/history limits.
  The server remains authoritative and the browser still owns Three.js builders.
- **`shared/board-geometry.js`** — validated normalized board outlines, half-extents, and convex-prism
  vertices/faces shared by image-board rendering, physics, and collider diagnostics.
- **`server.js`** — the authority and composition root: the cannon-es world,
  Colyseus room classes, remaining table-message handlers, HTTP/security setup,
  and the private (non-synced) memory that holds secrets. Card, movement, and
  membership handlers live under `server/game/handlers/`; HTTP route factories
  live under `server/http/routes/`. All physics tuning remains in one `SIM` block.
- **`server/game/schema.js`** — the synchronized Colyseus state boundary. It owns
  the eight `Schema` classes (`Piece`, `Player`, `Timer`, `ScoreRow`, `Whiteboard`,
  `RoomScale`, `Overlay`, and root `State`), their ordered `defineTypes`
  declarations, constructor defaults, and `MapSchema` collection construction.
  `server.js` imports these types when composing `TableRoom`; the process-wide
  encoder buffer setting deliberately remains in that entry point.
- **`server/game/starters.js`** — one-click starter-game orchestration. It reads
  shared `STARTERS`/board/piece definitions and coordinates room-owned clearing,
  board calibration, authoritative spawning, initial dealing, and persistence.
  Deck construction, geometry projection, capacity, and spawn height are injected
  from `server.js`, keeping the module deterministic and independently testable.
- **`server/game/table-bounds.js`** — physical table floor and containment-ring
  construction. `server.js` injects the `SIM` table/wall dimensions, while the
  module reads the shared table outline, replaces obsolete Cannon bodies, and
  rebuilds personal trays after every table-size or shape change.
- **`server/game/table-scale.js`** — measurement-scale persistence and board-grid calibration.
  `server.js` injects the grid-lift ceiling; the module snapshots and validates synchronized scale
  state, reads board metadata/collider dimensions, and schedules saves after successful square or
  hex calibration while the room keeps stable forwarding methods.
- **`server/game/piece-operations.js`** — authoritative recoloring and self-righting policy.
  It resolves effective and natural stand modes from synchronized props and shared piece
  definitions, and applies validated color/team/material `colorProps` results through the
  piece-props codec. Bundled and uploaded model props, modeled dispensers/stacks, and pipped dice
  use the shared standard-finish allowlist; dice-only custom textures cannot enter the model-object
  override path.
  `TableRoom` retains forwarding methods for piece handlers and the physics update loop.
- **`server/game/piece-lifecycle.js`** — authoritative synchronized-piece and Cannon-body
  lifecycle. It creates both representations together, removes every existing body/state/private
  map entry together, and owns footprint-aware release snapping, throw caps, landing cues, and
  compatible deck/dispenser absorption. Physics tuning, deck builders, and small presentation rules are
  injected; collider maintenance remains behind the room API.
- **`server/game/collider-maintenance.js`** — deck and finite-stack collider reconstruction.
  Ordinary decks derive their footprint from shared card/tile geometry and their height from the
  live count; modeled decks retain their authored fixed box, while modeled and infinite
  dispensers retain their authored collider. `TableRoom` keeps stable forwarding methods.
- **`server/game/placement-operations.js`** — synchronized transform publication and snapped-piece
  placement policy. It freezes settled dynamic pieces as collidable static bodies, restores them
  before movement, and combines the synchronized snap flag with live grid availability.
  `TableRoom` keeps stable forwarding methods so simulation ordering remains in `update`.
- **`server/game/physics-update.js`** — the ordered physics passes around the authoritative step:
  pre-step held-piece servoing, self-righting, footprint-aware snap-pin maintenance, and scripted
  flips; post-step tray/table escape recovery and synchronized transform publication. `TableRoom.update` retains
  the profiled `world.step` and makes the complete heartbeat order explicit.
- **`server/game/dispenser-operations.js`** — dispenser child-spec and inventory lifecycle rules.
  It resolves spawned props through shared `dispensedSpec`, leaves infinite sources unchanged,
  and delegates finite-stack removal or collider resizing back to the room after consumption.
- **`server/game/library.js`** — room-facing saved-library orchestration. It saves table decks
  through injected image storage and database access, maps asset kinds to their list readers and
  client messages, and rechecks live admin access after private-list reads before delivery.
- **`server/game/member-service.js`** — member-list delivery and waiting-lobby coordination. It
  rechecks live GM rank after database reads, broadcasts only to currently authorized clients,
  and fans admission/decline notifications out through the injected matchmaker.
- **`server/game/trays.js`** — personal tray physics and lifecycle operations. It owns
  tray-bound rebuilding, resize repositioning, randomized drop placement, size-aware Scoop
  placement, per-seat clearing, and scene restoration; `TableRoom` keeps small forwarding methods
  and the general `seatOf` ownership helper.
- **`server/` support modules** — shared permission and validation rules,
  card/deck state helpers, the piece-props codec, upload validation, database and
  session/Redis configuration, bootstrap-admin provisioning, async HTTP and
  Colyseus boundaries, auth context, and the extracted handler/router modules.
  These are deliberately dependency-injected so the backend seams can be tested
  without starting a room or listener.
- **`db.js`** — the Postgres connection pool and **every** query: the saved
  library (deck / board / prop / scene / skybox _metadata_; image/model files stay
  on disk) plus users, rooms, membership, and each room's durable settings, including its
  owner-selected lighting default. Config
  accepts `DATABASE_URL`, `DATABASE_URL_FILE`, or non-secret connection metadata
  paired with `DATABASE_PASSWORD_FILE` (the Compose default).
- **`migrate.js`** — the startup schema migrator: on boot it applies any
  `postgres/NNN_*.sql` not yet recorded in the `schema_migrations` table, in order,
  as a privileged owner role (`MIGRATE_DATABASE_URL` or its password-file component
  form) kept **separate** from the app's least-privilege connection. Upgrades need no manual `psql` step, and it targets
  any Postgres (stock or managed — there's no custom db image). `AUTO_MIGRATE=false` opts out.
- **`auth.js`** — password hashing (scrypt) and device-token hashing, built on
  Node's `crypto` alone (no dependencies).
- **Browser module folders** — `public/editor/` owns library and board/collider authoring;
  `public/rendering/` owns scene, mesh/texture, surface-query, and performance support;
  `public/ui/` owns shared DOM mechanics; `public/table/` owns table features, input, and audio.
  `client.js`, `landing.js`, and `admin.js` remain page entry points at the public root, alongside
  the cross-feature `credits.js` manifest. HTML loads `editor/editor-panel.js` for the workshop
  and `ui/equalize.js` as the early classic deferred preference script on all three pages.
- **`public/rendering/core.js`** — scene/camera/renderer/controls + the environment map,
  plus the `CONFIG` (client feel) and startup `LIGHTING` tunable blocks. `applyLighting` maps the
  synchronized table-relative direction, colors, intensities, and softness onto the directional
  and hemisphere lights, easing remote changes over 500 ms. Bootstrap table/rim meshes stay
  hidden until `client.js` applies the joined room's synchronized shape, size, felt, rim, and grid.
  The WebGL canvas has a second readiness gate for the synchronized player-seat camera, and core
  tracks active Three.js texture/model requests through the shared loading manager.
- **`public/rendering/graphics.js`** — every `<canvas>` texture builder, all mesh builders,
  the `.glb` model loading/measuring helpers, and the `KIND` registry. Immutable thin-card,
  rounded-tile, and hex-prism geometries are shared by dimensional key so late-join hydration
  does not repeatedly triangulate identical pieces.
- **`public/client.js`** — the browser composition root and remaining table runtime: networking,
  controller construction, shared raycasting/camera adapters, and the ordered render
  loop. It retains shared session and scene state (`room`, `meshes`, `buffers`) while
  presence, selection, inspection, private hand, overlays, whiteboard, trays, room settings, and
  skybox controllers own feature state. A full-screen
  Loading Table cover remains above the runtime until the local mesh count matches synchronized
  pieces, the player's seat exists, visual assets are idle, and
  pieces/players/overlays remain unchanged for 300 ms. Two complete frames render before it fades,
  preventing both the bootstrap camera and late hydration from appearing to end users. On desktop,
  it translates the camera plus OrbitControls target for view-relative keyboard panning. Piece UI
  derives the contextual control guide from the held/hovered piece or private-hand card.
- **`public/table/table-shell.js`** — table-specific UI composition built on `ui-surfaces`:
  local panel layout/toasts, dialogs, clusters, drawer proxies, radial actions, and seat/room/hand
  surfaces. It borrows and returns live roster/dock nodes so feature renderers keep their targets.
- **`public/table/preferences.js`** — local audio/theme controls, settings/help tabs, credits,
  and track choices; playback remains in `audio.js`.
- **`public/table/dice-preferences.js`** — per-device dice defaults and finish lists. Inspection
  and tray controls reuse its saved-default and texture-chip callbacks; recoloring existing tray
  dice still sends the same server messages.
- **`public/table/piece-ui.js`** — piece menus, contextual guide, hover counts, and hold-control
  visibility. It reads controller state and delegates actions; gesture ownership stays in piece drag.
- **`public/table/piece-labels.js`** — GM label editor and persistent annotation sprites, using
  shared validation/count rules from `shared/piece-labels.js`. `setPieceLabels` requires GM rank
  server-side and preserves unrelated props. Public `label`/`lowStock` props use existing snapshot
  persistence; deck reconstruction explicitly retains them. These annotations describe containers,
  not their contents. Textures change only with displayed text and are disposed on replacement/removal.
  The controller tolerates a joined room before `state.pieces` arrives and resumes on hydration;
  losing the collection closes the editor and removes stale sprites.
  Visibility follows the rendered object; future concealment must filter server delivery too.
- Player placards retain their world dimensions while `makePlayerTexture` rasterizes the same
  layout at 2× resolution on Low/Medium and 3× on High. Existing texture filtering/disposal applies;
  new avatar uploads are center-cropped to 512×512 JPEG at quality 0.85 in both lobby and table.
  `shared/avatar.js` owns these settings and the data-URL validator used by HTTP and room messages
  (below 512 KiB, with JSON-envelope headroom on HTTP). Existing account/schema storage is reused;
  old images remain valid and gain detail only when re-uploaded from the original.
- **`public/table/effects.js`** — ping/highlight/shuffle state, visual lifetimes, landing marker, and cached
  board collision surfaces. The root still calls updates in order and disposes board surfaces on
  piece removal. Cosmetic transforms never alter authoritative simulation state.
  Object highlights are transient `highlightPiece` → `pieceHighlighted` messages, validated against
  live public pieces and throttled per connection. One pulsing sprite per object follows its rendered
  bounds for 3.2 seconds; repeats refresh it. Halo materials are disposed on removal/expiry and the
  shared texture when the final halo ends. No piece material, private face, or saved state is changed.
- **`public/table/input-router.js`** — semantic input ownership. `createInputRouter` returns the
  intent map consumed by `attachControls` and the on-screen hold controls. It preserves mode
  priority, Escape/typing guards, long-press routing, object-axis targeting, and camera-pan gates;
  device translation and keyboard repeat timing remain in `public/table/controls.js`.
- **`public/table/piece-drag.js`** — `createPieceDrag` owns piece press/drag state, click routing,
  menu Move, grab/deal/dispense and late `dealt` adoption, group movement, grid targets, rotation,
  touch re-anchoring, and throw estimation. It reuses shared snapping and existing click/drag
  helpers. Piece UI and the landing-marker update read a copied gesture summary. Room access, selection, inspection, raycasting, menu opening, and sound are injected;
  no mutable client context or feature-to-root import is introduced.
- **`public/table/piece-view.js`** — the first extracted table feature boundary. It owns defensive
  piece-property parsing, dispenser mesh props, piece add/remove/property bindings, patch
  snapshots/interpolation, current-mesh deck
  height synchronization, and the common remove/build/configure/restore/add/replace lifecycle used
  by card, piece, and deck rebuilds. `client.js` retains the `meshes` and `buffers` maps and injects
  builders, physics policy, inspection visibility, collider refresh, and quaternion construction.
  Initial piece meshes reuse the same configurator as replacements. Cross-feature owner/removal,
  board-height, and collider-surface effects are injected callbacks. Inspection requests
  original-mesh hide/reveal through `setOriginalVisible`.
- **`public/table/collider-debug.js`** — local-only collider diagnostic ownership. It constructs and
  disposes non-raycastable Three.js shells from the shared collider specification, stores the
  device preference, enforces the GM rank gate, refreshes variable shapes, and follows live mesh
  transforms through injected piece/mesh/rank lookups. It never mutates room state or physics.
- **`public/table/hand.js`** — the private-hand controller. It owns local cards, Show selection
  and audience, reveal data used by public fans, sorting/rearrangement, collapse preference, and
  hand-specific pointer gestures. `client.js` injects room access, card builders, scene/raycast
  helpers, inspection entry, and control-guide updates instead of sharing mutable hand globals.
- **`public/table/inspection.js`** — enlarged table-piece and private-card inspection. It owns
  the preview, color/team/finish controls, deferred click timing, drawn-card placement, and pointer
  rotation. The hand requests inspection through an injected callback; the composition root
  forwards room messages and supplies the piece-view visibility callback.
- **`public/table/presence.js`** — seats and seat-camera framing, public hand fans, player markers,
  the local YOU chip, held-piece labels, roster/turn presentation, and avatar/seat controls. It owns
  player state listeners and Show-fan messages, with explicit callbacks into the hand, hydration,
  local role gating, and departure cleanup. The membership controller owns member administration;
  the client keeps general role
  gates, table/track resize orchestration, and Lean In; the render loop calls `presence.update()`
  after interpolation so held-piece labels follow the current meshes.
- **`public/table/selection.js`** — local selection, Select-tool mode, marquee gestures, highlight
  rings, batch commands, and toolbar/recolor state. Compatibility and compose/gather planning
  operate on plain piece data. The composition root supplies room access, meshes, scene/camera,
  canvas, marker settings, and board height; it retains input priority, pointer capture, and
  camera-control arbitration, and removes selected IDs when pieces disappear or are grabbed remotely.
- **`public/table/room-settings.js`** — table/grid presentation and state listeners, scale panel and
  calibration controls, local lighting drafts, and graphics-quality UI. It reuses core rendering,
  graphics grid construction, and shared lighting/board definitions. Room changes go through the
  existing server messages; resize, whiteboard-panel, and overlay-label effects use injected callbacks.
- **`public/table/skybox.js`** — background texture loading, resolution caps, replacement/disposal,
  and viewer-local resolution controls. The client forwards synchronized refs and publishes its
  built-in catalog; the library retains asset selection and authorization-aware presentation.
- **`public/table/overlays.js`** — measurement geometry, rendered-board surface elevation,
  selection, drag previews, permissions, and overlay state/message bindings.
- **`public/table/whiteboard.js`** — whiteboard mesh, local stroke replay, ownership/camera mode,
  drawing gestures, settings controls, and room messages. It reads shared `WHITEBOARD_LIMITS`;
  server-side validation remains authoritative.
- **`public/table/trays.js`** — personal tray meshes, positioning, camera travel, and tray UI
  actions. The server remains responsible for tray physics, die ownership, and Scoop placement.
- **`public/table/chat.js`** — public message replay, unread/autoscroll behavior, and send controls.
- **`public/table/notebook.js`** — private notebook replay and debounced edits, separate from shared notes.
- **`public/table/scoreboard.js`** — synchronized score rows and public room notes, edit affordances,
  and controls, reusing the existing row builders. Focused room-note edits survive remote patches.
- **`public/table/timer.js`** — controls and a local 100 ms display tick from the synchronized timer
  anchor using shared `timerLive`; it preserves focused duration input and touch mini-readout behavior.
- **`public/table/membership.js`** — server-pushed membership lists, pending indicators, role actions,
  and unclaimed-hand assignment. Server authorization and root-level role gating stay unchanged.
- **`public/table/library-bindings.js`** — library-list routing, asset errors, and Save Table feedback.
  It normalizes dice lists for injected texture-picker updates; authoring stays in `editor-panel.js`.
- **`public/ui/ui-surfaces.js`** — reusable dialog focus, responsive sheets, clusters, drawer,
  radial menus, and hold-repeat behavior; table-specific composition lives in `table-shell.js`.
- **`public/table/controls.js`** — the input seam: mouse and touch profiles translate
  raw events into device-neutral pointer/command intents consumed by `table/input-router.js`. Touch holds
  raise the same secondary-press intent as a mouse context action; a menu action that starts a
  drag transfers pointer capture to the canvas before its temporary button is removed. Its keyboard
  profile runs deterministic held-key intervals: WASD/arrows pan the idle camera, while compatible
  held-piece/selection contexts retain their raise/lower and rotate meanings.
- **`public/table/audio.js`** — the sound layer: a Web Audio **SFX** manager (short
  clips pooled per logical name, played fire-and-forget) plus an HTML5 `<audio>`
  **background-music** player. Volumes/mutes/shuffle are per-player, in
  `localStorage`; nothing here is synced (see "Sound & music").
- **`public/credits.js`** — the attribution manifest: the `MUSIC` playlist (which
  drives _both_ the music player and the credits panel) plus `SFX_CREDITS` and
  `LIB_CREDITS`. The CC-BY music makes the in-app credits mandatory, not cosmetic.
- **`public/ui/icons.js` / `public/ui/equalize.js`** — shared icon/tooltip behavior plus
  early UI-mode restoration and grouped-action sizing across pages.
- **The pages** — `index.html` + `landing.js` (the lobby: quick-join, login, room
  list, host request), `table.html` (the game table, which loads the client
  chain and, with `?workshop=1`, the admin-only library workshop plus
  `editor/editor-panel.js`), `editor.html` (a compatibility redirect to that workshop),
  `admin.html` + `admin.js` (the admin console), and
  `styles.css` (all UI styling: the design-token `:root` block, then a layer of
  shared component primitives the pages compose from — `.panel`/`.popout` pop-out
  panels; `.button` with primary/danger/icon variants; `.control` with
  select/multiselect/compact variants; `.checkbox`; `.chip`; `.miniLabel`; `.tile`;
  `.button-row` with end/compact modifiers; `.field-group`, `.field-label`, `.help-text`, and
  `.status-text`; and `.modal-backdrop`/`.modal` with shared header, title, body, close, and footer
  anatomy — over the per-page layouts. Static and generated UI use those canonical names rather
  than maintaining a second compatibility vocabulary. Control colors, borders, radii, height,
  padding, and form rhythm come from the shared tokens and primitives, so restyling does not
  require editing per-feature `#id` rules).
- **Project dirs** — `postgres/` (numbered SQL migrations `001`→…→`017`,
  auto-applied in order by `migrate.js` on startup, plus `schema.sql` — the flattened
  fresh-install baseline that also seeds `schema_migrations`), `docs/` (these
  documents), `docker/` (`init-app-role.sh`, which creates the least-privilege app
  role on first DB start; the `Dockerfile` itself lives at the repo root), and
  `proxmox/` (the host-side LXC launcher and matching in-container bare-metal
  installer, extracted from the same selected source revision; the unprivileged
  Debian 13 LXC enables nesting for Redis's systemd user namespace and waits for
  an IPv4 address and default route before starting package setup).

## Trust and failure boundaries

The HTTP dependency tree uses a targeted npm override for `qs@6.16.0` to address
the array-limit bypass and stringification denial-of-service advisories
GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g. The lockfile records the patched
resolution without changing the Express/body-parser versions. This override should
be reassessed when their normal dependency ranges admit a patched `qs` release.

Every payload-bearing Colyseus message crosses `server/message-validation.js`
before authorization, lookup, physics, state, or database work. Normalizers accept
only plain objects with documented keys, finite numbers, bounded strings/batches,
and allowlisted identifiers/enums/nested records. They return a fresh trusted value
or `null`; invalid messages fail closed without partial work. Payloadless messages
are the only exception because they carry nothing to validate.

Piece creation has a second boundary: `server/game/piece-capacity.js` defines the
250-piece limit and `TableRoom.spawn` asserts capacity before creating physics or
synchronized state. Hand, dispenser, and card handlers check before consuming inventory;
library loads check after their database awaits so concurrent loads cannot reserve the
same last slot. The extracted `server/game/handlers/placement.js` owns hand/dispenser
placement. Whole-hand drops retain cards that do not fit; replacing an existing board
can still proceed at capacity. A rejected draft spawn retains the draft, while saving a
mat still persists its library record even when its optional table spawn is blocked.

Rejection also restores private UI state: a blocked inspected-card placement resends
the inspection, and a blocked hand play resends the unchanged hand. The browser reveals
the hand as soon as its drag ends, after hit-testing the drop while the hand is hidden,
so a rejected play cannot leave the hand bar invisible. On coarse-pointer layouts the private
hand uses a horizontally scrolling 72–88 px card strip with a fixed 30 px Inspect control, leaving
most of every card as an unambiguous play/reorder drag surface.

`server/game/physics-safety.js` bounds drag and hand-placement input coordinates to
±10,000 per axis, well outside the playable table. Group destinations are checked again
after adding offsets. The physics servo uses `dragVelocity` to reject non-finite derived
velocities before they reach Cannon; on failure it clears the target and ownership and
zeros the body's linear velocity.

Every table message registers through `guardedMessage` in `server/game/interaction-policy.js`.
Its explicit request-capability inventory rejects unclassified registrations. The pure
`canUseRoomCapability` predicate adds participation checks independently of role; existing
handler-specific rank, ownership and privacy checks remain in force. Server-owned auth fields
can deny gameplay for spectators/time-outs, or all requests while policy is loading. Missing
participation fields retain current admitted-player/editor behavior until durable policy loading
is implemented. This is a foundation only: there are no restriction controls, policy migration,
public status fields or transition cleanup yet. Future loading must fail closed, and future
transitions must release held objects and recover private inventory before exposing the feature.

Library loads recheck live participation after database reads. Pending private library/member
responses and moderation also recheck policy readiness before delivery or the next mutation. Mixed library save/spawn requests
check gameplay before starting and again before a delayed spawn, preserving any completed asset
save. Observation, communication, personal state, cleanup and authorized administration remain
available; table mutations (including peeks, reveals and hand reassignment) require gameplay.
Lifecycle physics/recovery/persistence are independent of this client-request gate.

The guard runs inside the existing `safeMessage` error boundary: synchronous throws and rejected
promises are logged with payload-free room/user/session context and converted to a
sanitized `serverError` (or the narrower asset/member error) for that client. The
browser throttles generic notices to prevent alert storms. `safeRoomTask` applies the
same policy to join-time and detached lifecycle work; authorization failures and
reconnection timeouts remain normal Colyseus control flow. Persistence, lobby calls,
and final room saves are awaited or explicitly contained, so rejected promises do not
escape unnoticed or disable later socket messages.

Postgres absence is a domain result; Postgres failure is an exception. The injected
library/user/room read modules preserve that distinction: a real not-found/empty/default
result remains `null`/`[]`/a default state, while connection/query failures reject into
the HTTP or Colyseus error boundary. An outage therefore cannot masquerade as bad
credentials, a missing room, an empty library/member list, or reset room settings.

HTTP authentication and upload limits use Redis atomic token buckets keyed by purpose
and resolved client IP. All replicas spend the same allowance; bucket TTLs remove stale
IPs, and Redis failure returns `503` instead of silently removing protection. The
in-memory adapter is limited to development/tests. Correct IP identity depends on an
exact `TRUST_PROXY_HOPS` deployment setting; Redis alone does not cluster Colyseus rooms.

## Public vs. secret (how hidden information works)

The **synced state is public** — anything in it is one devtools-peek from being
read. It holds: each piece's transform/type/owner/props/count; each player's
seat, hand _count_, name, color, avatar, `showing` count (how many cards they're
revealing) and `handBack` (their hand's back image); the shared `timer` anchor;
the room dressing (`scores`, `notes`, `tableX/Z`, `tableShape`, `whiteboard`, `trays` — which seats'
personal dice trays are out, `skybox`,
`feltColor`, `roomName`); and whose turn it is — including, after a resumed game, the public
`turnPending` name and the `unclaimed` (`userId → name`) map that the GM's
reassign UI reads. Names only ever appear there, never the cards themselves.

Secrets live in plain server-only maps that are **never** put in synced state:

- `deckCards` — a deck's actual ordered cards
- `cardData` — the hidden face of a face-down table card
- `hands` — each player's private cards, sent to that one player directly
- `drafts` — a deck being built in chunks (pre-finish)
- `pendingInspect` — a card drawn-to-inspect but not yet placed (yours alone)
- `notebooks` — each player's private notes (ephemeral; resent on reconnect)
- `shows` — an active hold-to-show: who is showing which of their cards to whom
  (the card _content_ goes only to that audience; the public part is the badge count)
- `pendingHands` — hands from a loaded/departed game awaiting their owner's return,
  keyed by account (`userId`); the public mirror is the `unclaimed` name map (and
  `turnPending` for the waiting turn), which carry names only, never cards

The invariant: **if it's synced it's public; if it's secret it's server-only.**
A face-down card's face has never been transmitted to any client, so there is
nothing to peek at. Revealing it _moves_ the data from a secret map into public
props — only then does any client learn it, and the client rebuilds that card's
mesh from a blank back to a real face. Draw-to-inspect uses the same channel as
a hand: the drawn front goes to the drawer alone and sits in `pendingInspect`
until placed on the field / into a hand / back on the deck.

## The heartbeat

**Server, 60×/sec:** for every held piece, run the _velocity servo_ (push the
body's velocity toward that player's drag target, clamped) so a held piece
follows the cursor while remaining a real dynamic body that shoves others; step
the cannon world (fixed timestep, sub-stepped — see `SIM.step`); then copy every
body's transform into synced state. Colyseus ships only changed fields, so
resting pieces cost ~nothing.

**Client, each frame:** as state patches arrive, push a timestamped snapshot of
every piece into a small per-piece buffer. To draw, render each piece as it was
**~60 ms ago** (`CONFIG.render.delay`), interpolating between the two real
snapshots bracketing that moment (lerp position, slerp rotation). The buffer maps and frame order
remain visible in `client.js`; `public/table/piece-view.js` owns the snapshot/apply/sample mechanics.

That deliberate delay is what makes motion smooth: rendering slightly in the past
guarantees two real samples to interpolate _between_, so fast pieces glide
instead of teleporting packet-to-packet. One uniform path for held/thrown/resting
pieces — no prediction seams.

### Measuring it

Both halves of the heartbeat are instrumented for the "plays well at real scale" work
(ROADMAP §1), and the split above is why the measurement is split too. Because resting bodies
sleep and cost no bandwidth, a table of hundreds of _settled_ pieces is nearly free on the
server step and the network — the cost lives in two different places. **Client render** cost is
paid every frame for whatever is drawn, moving or not (draw calls, triangles, shadows, skybox);
`public/rendering/perf.js` reads it off `renderer.info` behind `?perf=1`. **Server step + network** cost
spikes only when many bodies are _awake at once_ — a scoop, a shuffle, a dump; `PERF_LOG=1` logs
the per-tick `world.step` time and the awake-body count that drives it. So the render lever
(graphics-quality tiers) and the simulation lever are aimed at genuinely different bottlenecks,
and each is profiled on real hardware, not in the headless suites. A first pass found the client
frame **fill-rate bound, not draw bound** (FPS flat as draw calls rose), so the shadow map now
redraws only on frames where scene geometry moved (`shadowMap.autoUpdate = false`, driven from the
render loop), and `?px` / `?shadow` / `?aa` expose pixel ratio, shadow size, and antialias for
tuning on the target device.
That tuning is now a shipped, client-local **quality tier** (low/med/high, persisted per device,
defaulting to Low on phones, Medium on tablets, and High on desktops) in Settings → UI.
This selects a preset by device class, not a continuous FPS-driven adjustment. It is a per-viewer
render preference, never room state, so it stays out of the scene save. High also raises card detail:
procedural playing/text card canvases render at 1.5× the low/medium dimensions, and local uploaded faces select a larger
server derivative after the tier's required reload.

## One action end to end: grab & throw

1. Press + move past a small threshold → client distinguishes _drag_ from
   _click_, sends `grab {id}`. A mouse uses the exact raycast; after an exact touch miss,
   `pickId` probes an 18 px screen-space ring so a small piece remains selectable beneath a finger.
2. Server marks the piece `owner: you`.
3. On move, client raycasts the pointer onto a horizontal plane (its height is
   the scroll-adjustable grab height) and streams `move {id, x,y,z}`; touch drags project that ray
   48 px above the contact point so the held piece and drop location stay visible. The servo
   pushes the body toward it. Meanwhile the client measures a smoothed cursor
   velocity, and a translucent ring previews the straight-down landing spot.
4. Release → client sends `release {id, v}` with that measured hand speed; the
   server clears the owner and sets the body's velocity to `v` (clamped;
   cards get a stricter cap to avoid tunnelling). Now it's a free body flying
   with real momentum, interpolated onto every screen.

Decoupling throw velocity (measured) from the servo (which only tracks the
cursor) is what fixed the old rubberband/jitter: the servo tracks tightly _and_
throws carry accurate momentum.

**Snap-to-grid** (0.7.0) is a placement concern layered on top of this, not a change
to the sim. A piece carries a `snap` flag (per-piece, like `stand`; **G** toggles it).
When a grid is active (square cells or hex centres — one `snapToCell` for both), a
snapped piece's `move`/`release` XZ runs through the shared `snapToCell` quantiser — the same function on client (drag preview) and server
(authority), so they can't drift — and it's dropped **throw-free** (velocity zeroed)
rather than flung. It's still an ordinary rigid body; it just falls onto a quantised
point. The one part that _does_ touch body state is **pinning**: once a snapped piece
settles (its body goes to sleep, not merely slows — the old low-speed check pinned
pieces in mid-air), the server freezes it to a `STATIC` body so a bumped neighbour
can't slide it off its cell. A grab, or turning the flag or the grid off, unpins it.

Multi-cell footprints extend that placement layer without adding occupancy or pathfinding. An
uploaded object can author one validated `cells` hint (`1..12`) in its saved JSON record; the
server-authored asset snapshot carries it onto every spawned instance. `gridFootprintCells`
resolves that hint (or a built-in `PROPS` definition hint) with a 1×1 fallback. Square grids keep
odd N×N footprints on the configured centre/cross phase and swap the phase for even footprints;
hex grids keep every size centred on a hex. The client stores the resolved footprint in the drag
gesture, while `applySnap`, `releasePiece`, `maintainSnapPins`, and `spawnCardFlat` pass the same
value through the shared quantiser. Cannon collisions remain the only overlap authority.

### Multi-select

Selecting a clump and moving it as one _looks_ like new physics but isn't. A held piece is never
teleported: the server sets its `owner` and, every tick, servos **each** piece that client owns
toward its own target — it already supported one client driving many pieces to different points;
nothing had ever handed it more than one. So a group move is just: claim the selection
(`grabGroup` — only the **free** pieces, so two players can't co-own one), store each piece's
offset from the anchor in the server-only `groups` map, and each frame set every target to
`cursorPoint + offset` (`moveGroup`, one message regardless of count). The existing servo carries
the whole formation rigidly, and `releaseGroup` frees each piece through the same `releasePiece`
helper the single `release` uses.

The **selection itself is purely local** — a Set of ids owned by `createSelection` in
`public/table/selection.js`, never in synced state, so it adds no schema and no one sees yours.
The controller exposes membership/count queries and copied ID arrays without sharing its mutable
Set. The input router forwards semantic gestures and commands; `client.js` calls `selection.update()` in the render
loop to follow meshes, dispose stale rings, and refresh the toolbar, and retains group drag physics
messages. Shift-click and Select-tool taps toggle individual movable pieces. Dragging empty felt
with Shift or the Select tool paints a screen-space marquee that tests each piece's
_projected_ centre against the box — no 3D picking — and the highlight rings and marquee wear
that player's own accent color. Ownership is the conflict guard, so the selection can safely
auto-drop any piece someone else grabs or that gets removed, and never goes stale.

The **batch ops mirror the singles**: with a selection active a keystroke fans an existing
per-piece action across the set — **U**/**G** toggle stand / snap as a unit, **R** rolls the
dice, **F** flips the cards, **H** takes the cards to hand, and **`[`**/**`]`** rotate the whole
formation ±45° about its centroid (each position _and_ each facing; boards skipped). Each handler
is `<action>Group {ids}`, ungated exactly like its single form (only `removeGroup` stays helper+,
like single delete), and a mixed selection is fine because each key touches only its kind. None
of it is a new subsystem — it's the grab-and-throw servo and the existing per-piece actions,
addressed to a list instead of one id.

**Composition** goes one step past mirroring the singles: two batch ops with no single-piece form
turn a selection into a construction tool. `combineIntoDeck` consolidates the selected card-family
pieces — loose cards and whole decks alike — into one face-down deck (the top of the table becomes
the top of the deck), and `gatherDispensers` pours like dispensers into one summed stack. Both stay
"selection → one server-side piece": read the members, remove them, spawn the composite at the
centroid — no new state, the same ownership and validation path as every other handler. Each refuses
a heterogeneous selection rather than combining part of it, and the client greys the offer
to match. Cards must agree on geometry, snap and double-sided behavior; secret cards
also require matching backs. Double-sided tiles can retain different individual backs.
`cardCompatibilityKey` in `server/deck-state.js` supplies this rule to both server
Combine and drop-on-deck absorption in `releasePiece`. Proximity alone cannot
absorb a card: incompatible cards stay on the table with their private data intact.
Different front artwork is allowed when the shared properties match. Absorption
also retains cards with no recoverable front rather than silently deleting them.
The server refuses to combine a deck with an active private inspection, preventing the
inspected card from being duplicated or stranded. Combined arrays are bottom-first so
the highest table card is drawn first with `pop()`. The lowest selected deck supplies
the resulting skin and tints (or the lowest card if no deck is selected).

Dispenser consolidation is the same idea widened to loose tokens. The absorb rule was already
there — dropping a chip on its stack rejoins it — so `absorbIntoDispenser` (pour the selected loose
pieces into the one selected dispenser) and `dispenseFromPieces` (mint a new dispenser from loose
pieces that have one) are that rule run over a selection instead of waiting for a physical drop. The
match predicate now lives once in `shared/pieces.js` (`dispensedSpec` / `itemMatchesDispenser` /
`dispenserForItem` / `customDispenserForItem`), used by the drop-back path, both new handlers, and
the client's eligibility check, so the three can't drift. Built-ins match shape + tint/team; custom
items require the same server-authored asset ID + color + finish and must carry that asset's authored
dispenser. All of it — merge, absorb, mint — is one **Gather** button that picks the handler from
what's selected, the same way **Combine** unified loose cards and decks.

## Pieces today

Each **kind** is defined in two registries keyed by the same type id:

- `shared/pieces.js` → `KINDS`: piece identity, mass, and base shape metadata. Shared
  `colliderSpec(type, props)` interprets it with the piece's authored/live properties, and server
  `buildCollider` converts that renderer-neutral result to Cannon; `spawn` has no per-type collider
  branches.
- client `KIND` (in `graphics.js`): the render + interaction half, `{ mesh,
grab, ldrag, lclick, rclick }`. The pointer handler looks up `KIND[type]` and
  dispatches, instead of switching on type.

The kinds:

- **die** — parameterized by `props.sides` ∈ {4,6,8,10,12,20}. Numbered
  (below).
- **card** — a thin box _or a tile_. Faces are texture _references_ (`front`,
  `back`); face-down keeps `front` server-side (`cardData`) and shows only the public
  `back`, so uploaded art is hidden exactly like ranks are. Its footprint, thickness,
  corner, and **shape** come from `cardGeom(props)` — a plain card, a named tile
  (`props.tile`: domino/word/mahjong), or an explicit `props.geom` (custom image decks:
  fit-to-art aspect, chosen thickness, and a rounded/square/**hexagon** silhouette). See
  _Tiles_ below. A **double-sided tile** sets `props.open`: both `front` and `back` are public art
  that stay STABLE, and orientation is a separate `props.down` flag (set = the back face is up).
  Flip _turns it over_ by toggling `down` — no concealment, no `cardData` — and `cardMesh` renders
  the up/down face from (`open` && `down`). Keeping the faces stable (rather than swapping them) is
  what lets the hand and the fan always find the content face; a secret card has no `front` when
  face-down (it lives in `cardData`), which is the distinct, unchanged path.
- **double-sided / per-tile back** — the two axes that turn cards into game tiles. A deck card
  entry is a bare front ref _or_ a `{front, back}` pair (`cardFrontRef`/`cardBackRef`,
  `server/deck-state.js`), so one stack can hold tiles with different backs (a tree-back among
  forageable-backs). `props.open` (+ the `down` orientation flag) makes a card/deck's tiles turn over rather than
  conceal, and it rides through hands too (`spawnHandCard`; the public seat-fan shows a generic
  cover for an open card via `handBack`). Both axes ride the existing draw/deal/inspect/split/
  combine/hand and scene-save paths, and both fall back to today's behavior (string entry → shared
  `back`; no `open` → secret flip).
- **deck** — a public `back` + private ordered fronts (`deckCards`); public
  `count` scales the visible stack (`deckHeight`). A deck inherits its cards' geometry,
  and can wear a 3D **skin** (`DECK_MODELS`, e.g. a concealing **pouch**
  whose sack + drawstring recolor independently via slot `tints`) in place of the stack
  while still working as an ordinary draw pile. An `open` set also carries a runtime-only
  `cover` prop the server keeps pointed at the current top tile's back (repainted on every
  draw/shuffle/split), so a mixed-back stack shows a real card on top rather than a placeholder;
  the client rebuilds the deck mesh on any prop change to reflect it. The domino, letter, and Mahjong
  built-in inventories all use the enlarged low-poly pouch and its correspondingly enlarged collider.
- **dispenser** — a reusable source for an existing prop: finite poker/coin stacks
  shrink as they hand out copies, while Go bowls are unlimited. An admin can also attach a
  dispenser definition to an uploaded custom object, choosing a visible automatic item stack, a
  generic container, or a second uploaded `.glb`, plus finite/default-count or infinite supply.
  A runtime custom piece carries the server-authored snapshot
  `{asset:{id,item,dispenser},color?,finish?}`; that asset identity is what permits regrouping and
  prevents loose pieces from inventing dispensers. Left-click drops one beside the source,
  left-drag adopts the new item into the drag, and dropping a compatible item back onto a dispenser
  returns it.
- **prop** — the workhorse. Either a **built-in shape** (`render.prim`:
  box/sphere/cone/cyl/lens) or a **`.glb` model** (`model` path). Color comes
  from a picker, a two-color **team** palette, or a per-material **tint**; a
  `stand` flag self-rights standing pieces. Bundled definitions also select a default material
  finish, and `props.finish` carries a synchronized Inspect override. Universal `props.scale`.
- **board** — static (mass 0) but removable. A built-in model (`BOARDS`
  registry), an uploaded `.glb`, a **procedural** board drawn from data (a
  `BOARD_PAINTERS` painter, e.g. the word grid), or an outlined slab with an optional
  image and configurable thickness. One board at a time; it's sat on the table by its half-height.
- **mat** — a player mat: a large, single-faced, **movable** SURFACE that tiles and pieces rest on
  (per-player profession boards). Unlike the singleton `board`, every seat can have one. It reuses
  the tile image/geometry pipeline — `cardGeom`/`cardMesh`'s solid-slab path + the card box collider
  (a real flat top) — at a far larger size (`sanitizeMatGeom`), with heavier mass, high damping, no
  fling, and no card verbs, always lying flat. Stored in its own `custom_mats` library table
  (image + geom); spawned via `loadMat`/`saveMat`.

Procedural visuals are drawn onto `<canvas>` and used as `CanvasTexture`s (pips,
card faces, checkerboard, player markers), created through a helper that applies
**anisotropic filtering** so text/numbers stay crisp at grazing angles. 3D assets
are bundled `.glb` files under `public/static_assets/models/` (see `ASSET_CREDITS.md`); the current coin, Go-bowl,
and human-token models are original project assets.

### Models: scale, orientation, color, and material

- **Built-in model pieces** (chess/coin/chip/token) carry a fixed
  `modelScale` and a **precomputed collider** in `PROPS` (`{ box, type? }` — a box
  by default, or `sphere`/`cylinder`/`cone`/`flat`), so a set keeps its
  real relative sizes and the server never has to load a model. `.glb` files can
  bake a node scale, so sizes are measured _as loaded_. `npm run assets:colliders` performs that
  measurement directly from each registered GLB's accessor bounds and node transforms, applies
  the registry scaling/rotation rules, and reports copyable collider/scale suggestions. This keeps
  replacing a bundled model deterministic without pulling a 3D renderer into the server.
- **Custom uploads** are normalized (props to `CONFIG.model.size`, boards to a user-selected
  longest X/Z side, defaulting to `BOARD_SIZE`). The client measures the model and stores its
  uniform `modelScale` and collider half-extents `box` with the library record. Changing board
  size updates both together; it does not refit automatically to the table.
  Object creation can store a default standard finish and a tint policy (whole model, preserve
  authored colors, or one material name discovered from the GLB), previews it before upload, and
  later accepts the same synchronized Inspect override as bundled model props. Spawning goes
  through `loadProp`, which reads the record server-side and attaches its immutable asset snapshot
  rather than trusting copied client props.
- **`modelRot`** reorients a mis-authored model (e.g. laying a coin flat).
- **Tint modes** (in the loader): `team` recolors every slot; a color-picker
  prop recolors all; `tintMaterial:'name'` recolors **one** material slot (including Blender-style
  `.001` duplicates); `tintMaterial:null` preserves every authored material; `ownMaterial`
  keeps a bundled model's materials. glTF defaults materials to metallic, so tinting
  swaps eligible slots into a controlled surface material.
- **Object finishes** share one standard catalogue with numbered dice. A `PROPS` definition chooses
  its default using one boolean flag (`matte`, `satin`, `glossy`, `metallic`/legacy `metal`,
  `brushed`, `pearl`, `translucent`, `glow`, or `marbled`). `objectFinish` gives a valid
  per-instance `props.finish` precedence, so Inspect can override even a definition's finish with
  explicit `matte`. `finishMaterial` supplies the standard/physical shader parameters and
  procedural maps for primitive pieces. `modelFinishMaterial` clones compatible authored GLB
  materials/maps before applying the selected response, and `addModelFinishUV` supplies fallback
  projection UVs for procedural brushed/marbled maps. The model painter preserves pips and named
  tint slots independently. This path covers bundled/uploaded model props, modeled dispensers and
  stacks, and built-in pipped dice; low-end phones retain the dice finish fallbacks. `custom`
  remains procedural-dice-only because it requires a `finishImg` from the dice texture library.

### Uploaded board outlines

Image boards store `{w,d,tex?,thickness?,outline?}`; GLB boards store
`{model,modelScale,box,outline?}`. The optional outline selects rectangle, circle/oval, hexagon,
clipped corners, or a custom convex polygon. `shared/board-geometry.js` keeps outline coordinates
in normalized local X/Z space, so one authored outline scales with the board. The image mesh and
Cannon body use the same prism vertices/faces; GLBs retain their original visual mesh and use the
outline only for collision. Built-in boards keep their authored box colliders.

`public/editor/board-outline-editor.js` provides a top-down canvas shared by both upload/edit forms.
Image artwork and orthographic GLB snapshots serve as tracing references. The canvas respects the
board aspect ratio, supports corner-by-corner drawing with undo/clear, and restores saved outlines
when editing or cloning. Image boards retain width/depth and ratio-lock controls and add thickness;
GLBs expose uniform sizing through a longest-side target. Their outline controls independently
adjust width, depth, and Y-axis rotation, with a live tracing overlay and a reset-fit button.
This accommodates models exported diagonally within their enclosing box without resizing the
visual model. The corner-cut control remains accessible after numeric stepper enhancement.

Optional `outline.fit = {scale:[width,depth],rotation}` preserves the selected preset or custom
points. The shared normalizer accepts scales of 0.01–2 and rotations of -2π–2π radians.
`boardOutlinePoints(outline, aspect)` scales points, rotates in physical X/Z space, and converts
back to normalized coordinates; both the preview and `boardGeometry` supply the board aspect
ratio. Custom corner clicks apply the inverse transform. Fitted rectangles use convex geometry
in physics and diagnostics, while unchanged rectangles retain the existing box path. Fit settings
persist with the outline through library editing/loading and scene props. The image-board UI
continues to use its existing dimension controls.

The WebSocket boundary validates outlines through `normalizeBoardOutline` before either saving
or spawning. Custom polygons are limited to 3–32 points and must be nondegenerate, strictly convex,
and non-self-intersecting. Circles use a 32-sided approximation. These are single solid prisms:
there is no automatic image-alpha/model-hull extraction, hole subtraction, concave decomposition,
or mesh-collider generation. GLB assets can instead use the compound editor described below.

Existing board JSONB props and piece/scene props carry outlines and thickness without a database
migration. The library load handler explicitly retains the new fields. `swapBoard` places the body
at its resolved half-height, while grid calibration falls back to shared board dimensions when a
convex collider has no Cannon box half-extents. Legacy records default to rectangular outlines and
image thickness `0.1`. Regression tests cover geometry/debug parity, outward face winding, actual
piece contact versus removed corners, record validation, library loading, and shaped-board calibration.

### Custom compound colliders

Uploaded objects and GLB boards may store a `compoundCollider` instead of the object's primitive
`collider` or the board's `outline`. Image boards continue to use outlines. No database migration
is required: library records and piece/scene JSON props retain the layout through save, edit,
clone, load, and snapshots.

`shared/compound-collider.js` validates version-1 layouts of 1–16 box, sphere, cylinder, cone,
flat-slab, or outline-prism shapes. Each child has a position, full dimensions, and XYZ Euler rotation.
Positions and sizes are relative to the model's longest side (`2 * max(box)`); rotations are
radians. Uniform asset scaling therefore preserves the authored layout. Spheres require equal
dimensions; cylinders/cones require equal X/Z diameters. Flat slabs are boxes and cones use
16-sided tapered cylinders with a small top radius. Outline components carry their own
validated `outline`; their size's Y component sets thickness. Rectangle, clipped-corner,
triangle, hexagon, circle/oval, and custom simple concave footprints are available.
`shared/collider-outline.js` validates custom loops of 3–32 corners, rejects crossings,
self-touching/backtracking edges and degenerate outlines, and simplifies redundant straight
corners. Deterministic ear clipping followed by greedy convex merging generates solid sections.
Each section is extruded and recentered around an interior origin; its rotated offset preserves
the original geometry. `buildCollider` constructs those sections as Cannon convex polyhedra.
The editable outline remains one authored item in asset props and saved collections, while
`compoundColliderSpec` flattens its sections and records `sourceIndex` for editor selection.
Ordinary image/GLB board outlines retain their separate convex-only contract.

The 16 limit is an application performance budget, not a Cannon engine restriction. Validation
limits both authored components and total generated physics parts to 16. The editor displays
both counts; creation, duplicate, insertion, and outline edits must fit the same budget.
A concave outline can therefore consume several parts while remaining one editable item.
Enclosed holes and self-crossing loops are unsupported; an inward opening is supported.

`public/editor/compound-collider-editor.js` owns a Three.js preview, orbit controls, and a private
draft. Drag-mode buttons select orbit, move, rotate, or uniform resize; labeled camera controls
select perspective, top, front, or side views. Shape buttons add primitives directly.
It remains a native top-layer `<dialog>`, but composes the same `.modal`, `.modal__header`,
`.modal__title`, `.modal__body`, `.modal__close`, and `.modal__footer` primitives as the HTML
overlay modals. Generated controls additionally compose `.field-group`, `.field-label`,
`.help-text`, `.status-text`, and `.button-row`, leaving only viewport/grid geometry and native
`::backdrop` behavior feature-specific.
Numeric position/dimension fields display table units and rotation fields display degrees.
Typing and mouse-wheel edits update the preview immediately; Shift makes wheel steps finer and
Ctrl/Command makes them larger. Duplicate, delete, clear all, and undo operate on the draft.
Clear all is undoable; Apply is disabled until the draft contains a valid shape. Apply returns
the layout to the upload form, while Cancel discards changes. The editor disposes its renderer,
geometry, materials, textures, and controls on close. The upload form also rotates child
positions/orientations when the model's orientation changes. Existing box/flat components can
be converted through **Edit outline / clip corners**, preserving their dimensions and transform.
The embedded top-down outline editor updates the 3D draft as presets, corner cuts, and custom
corners change; incomplete custom outlines disable Apply. Controls scroll independently of the
preview/footer, and the outline editor can collapse while preserving its state.

`public/editor/collider-outline-drawing.js` provides **Draw outline in 3D** and **Edit outline in 3D**.
New outlines use a top/front/side plane through the selected component's center (or model origin).
Existing outlines use their own local plane and retain orientation. The camera aligns to the
plane, model geometry stays visible, and existing collider shells are temporarily hidden.
Click to place points and click the first point or Finish outline to close; drag points to edit,
scroll to zoom, optionally snap to the model-relative 0.1-unit grid, and enter thickness in table
units. Point undo/clear operate on a separate drawing draft. A live preview shows the generated
sections; invalid or over-budget outlines cannot finish. Finish inserts/replaces one component
as an undoable editor operation, while Cancel drawing preserves the collider draft. Camera and
controls are restored on exit, and Apply collider stays disabled during drawing.

Multi-selection uses the shape list, Ctrl/Command-click in the preview, or Select all.
Selected components move, rotate around a shared bounds center, and scale uniformly together;
duplicate/delete affect the whole selection. Individual selection restores per-component editing.
`public/editor/collider-groups.js` handles group bounds, rigid transforms, normalized capture, insertion,
and disposable geometry thumbnails. Out-of-range transforms or insertions are rejected atomically.

Saved collider collections are separate from layouts embedded in asset props. Migration **017**
adds `collider_presets` with owner, name, normalized JSONB layout, default longest-side size,
public/private visibility, and timestamps. Account deletion clears ownership while retaining
collections. `server/collider-preset-queries.js` scopes reads to public/owned/admin-visible rows
and restricts writes to owners/admins directly in SQL. `server/database.js` composes these queries;
`db.js` exports `colliderPresets` for the production HTTP router.

`server/http/routes/collider-presets.js` exposes authenticated list/get/create/replace/delete
operations at `/collider-presets`; list pages contain up to 50 records. The boundary validates
names, visibility, sizes, and compound layouts. `public/editor/collider-presets.js` provides the editor's
Saved collider collections panel with previews, save-selection, name/visibility updates,
replacement, deletion, and insertion at a chosen size. Library saves take effect immediately,
independently of the editor's Apply/Cancel draft. Insertion fetches the current accessible preset
and copies its components into the draft, selecting the new group. Asset layouts retain no preset
reference, so later preset edits, deletion, or visibility changes cannot modify existing copies.
The final compound retains the total 16-physics-part budget, including decomposed sections.

The WebSocket boundary rejects invalid layouts and conflicting collider/outline fields.
`compoundColliderSpec` resolves normalized data for both physics and diagnostic rendering.
`colliderSpec` selects that compound description as the authoritative collider, while
`colliderFromSpec` performs the only Cannon conversion. `buildCollider` coordinates those two
steps, and `attachCollider` attaches child offsets/orientations to one body. This permits gaps
between solids without triangle-mesh collision or boolean subtraction and keeps editor/debug
geometry identical to server collision rules. `boardSpawnHeight` uses rotated child bounds as well
as visual model bounds to place boards above the table. Grid calibration uses the board's overall
dimensions, rather than the first child's dimensions. Stand/lay-flat self-righting and held-piece
movement do not treat a compound child's Y offset as the legacy flat-collider origin shift.

Regression coverage includes validation, primitive geometry, offsets/rotations, scaling, gaps,
library loading, body creation, board placement/calibration, and stand/lay-flat behavior.
The optional browser smoke test runs with
`CHROME_BIN=/path/to/chromium node scripts/collider-editor-test.mjs` and exercises desktop/mobile
controls, numeric edits, wheel modifiers, drag, clear/undo, cancel, object/board saving, group
transforms, and preset save/insert/visibility. API validation and production database exports have
unit coverage; PostgreSQL integration tests verify persistence and owner/admin visibility rules.
`test/collider-outline.js` covers decomposition, invalid loops, part budgets, fitted/rotated
geometry, preset preservation, and actual Cannon contact/fall-through behavior.
`CHROME_BIN=/path/to/chromium node scripts/outline-drawing-test.mjs` exercises viewport drawing,
point edits, plane selection, snapping, and undo/cancel with real desktop/mobile pointer input.

### Drop-marker surface placement

`public/rendering/collider-surface.js` builds invisible Three.js collision geometry from the shared
collider descriptors. The client caches one surface tree per board and serialized props value,
rebuilds it when props change, and disposes it when the board is removed. Each query copies the
board mesh's interpolated position/quaternion, keeping compound child offsets and rotations local.

The held-piece drop marker casts downward from the held mesh's origin at its X/Z location.
The nearest board surface below that origin determines marker height, with the usual small
visual lift. Structures above the held origin and other pieces do not participate. With multiple
boards, the highest hit below the origin wins; gaps and locations outside all boards fall back
to table height zero. Sphere surfaces use triangulated preview geometry; other primitives and
convex outlines use their corresponding collision geometry. This changes only marker placement:
measurement and ping overlays still use the legacy board-wide height plane.

### Collider diagnostics

`shared/collider-spec.js` mirrors the authoritative collider selection as renderer-neutral data.
It covers primitive and compound props/boards, convex dice, cards/mats, fixed model skins, and the live heights
of decks and dispensers. The server still owns collision through Cannon; the shared descriptor is
the inspection contract used by the browser and its focused parity tests.

A GM can enable **Settings → UI → Physics diagnostics → Show colliders** locally.
`public/table/collider-debug.js` creates translucent, non-raycastable Three.js shells from those
descriptors and keeps them aligned with interpolated piece transforms. Its factory receives the
scene, piece/mesh/rank lookups, shared `colliderSpec`, and local storage; its public controller API
is `refresh`, `remove`, `sync`, `setEnabled`, `isEnabled`, `update`, and `dispose`. The overlay is
not synchronized, persisted with room state, or fed back into physics. Piece rebuild/count listeners
refresh variable shapes, the render loop calls `update`, and role changes remove the shells
immediately for non-GMs.

### Tiles: one geometry, both sides

Dominoes, word tiles, mahjong tiles, and custom-shaped image cards are all the **card**
kind with a different geometry — proof that the hard part (hidden information) was already
solved. A single resolver, `cardGeom(props) → {hw, hh, th, round, shape}`, is read by
**both** the client mesh (`cardMesh`) and the server collider (`buildCollider`), so a tile's
look and its physics footprint can never drift — the same guarantee `dieVerts` gives dice. It
resolves, in order: an explicit `props.geom` → a named `props.tile` (the `TILES` registry) →
the standard card.

Because a tile's _shape_ is public but its _face_ is private, the deck threads only the public
geometry — `tile` / `geom` / `snap`, via `geoOf` — through deck → hand → played tile, so a
face-down tile still shows its true silhouette while its face stays hidden (the privacy
invariant, unchanged). A hexagon card carries this all the way into physics: the mesh is a
regular pointy-top hex prism and the collider a matching 6-gon (cannon's default hexagon
already points the same way), so it drops cleanly onto the hex grid (`gridStyle: 'hex'`,
pointy- or flat-top; snap + render share the axial math in `snapToCell` / `gridMesh`).

The board and deck sides generalize the same way. A `proc` board paints its top from data
(`BOARD_PAINTERS`), so a premium word grid — or a later battlemap — is a painter plus a
`BOARDS` entry riding the existing swapBoard / collider / grid-calibration paths. And a deck
can swap its _visual_ for a `.glb` skin (`DECK_MODELS`) with no change to draw / deal /
shuffle / hidden order. Building the tile games meant adding data and faces, not a new engine.

## The dice family

A die is **one kind** parameterized by `props.sides`.

- `shared/pieces.js` stores each solid's **vertices**. d6 is an axis-aligned box;
  the rest are convex polyhedra (tetra/octa/icosa/dodeca + a pentagonal
  trapezohedron for d10).
- **Client** numbers every die: the d6 bakes a digit onto each box face, and the
  polyhedra lay a digit plane on each logical face (coplanar triangles grouped by
  normal, a sprite at each centroid). Both honour an optional per-die **body
  color** and **number color** (`props.color` / `props.textColor`), baked into
  the face textures so the two stay independent. Double-click a die (or prop) to
  inspect it and the overlay offers those color pickers; committing sends
  `recolor` and the tint syncs to everyone.
- **Server** builds a `CANNON.ConvexPolyhedron` from the _same_ vertices (hull
  faces from `convex-hull`, windings flipped outward) so the die tumbles and
  settles on a face. Visual and physics can't diverge; adding a size is a
  one-line vertex entry.

### Dice trays

Rolling on the play field scatters everything, so each seat gets its own **dice tray** — a
walled box on the same circular track as the whiteboard, parked directly _behind_ that player at
the seat's outward angle (`SEAT_ANGLES`). It is deliberately **personal, not shared**: a single
communal tray broke down the moment two people rolled at once, so `State.trays` is a
`MapSchema<boolean>` keyed by seat index and a player toggles only their own (`trayShow`, no rank
gate). Yet it stays fully **public** — the tray dice are ordinary `die` pieces tagged
`props.traySeat = N`, so they ride scene save/load and anyone can lean over and read a
neighbour's roll; there is no hidden per-seat physics world, and thus nothing to distrust. (A
running dice-roll _log_ was considered and dropped on purpose: the physical dice in a public tray
are the source of truth, and a ledger would pull the feel away from a real table.)

Two things let it fit the engine without new machinery. First, the tray is a real **physics
container** — floor + four walls + an invisible lid. The client renders `trayParts()` without
the lid; the server builds `trayCollisionParts()` with the same footprint and floor but walls
scaled by `TRAY.collisionWallScale` (currently `1.5`) and a lid raised to meet their tops. The
extra collision height contains dice without raising the visible walls. `server/game/trays.js`
owns `buildTrays()` and the related room operations; it rebuilds every enabled seat's bounds
at its angle (bodies tagged `__traySeat`) and slides the dice along on a table resize. The one
real subtlety is the **out-of-bounds net**: it yanks any stray body back to table centre, and a
tray sits _past_ the table edge, so a tray die is contained by _its own_ tray bounds (`inTray`,
keyed on `__traySeat`) instead of being teleported home. Second, "out of view" is a **local
camera** move, not height or a separate scene — the Roll button hops _your_ camera over your tray
(placing it first if it isn't out), Roll-all flings only your seat's dice with the gentler
`SIM.trayRoll` impulse, and Back tweens home; no one else's view stirs. `onLeave` puts a departing
player's tray away so it never lingers for the next occupant.

Scoop is a server-side placement operation, not a physics shove. The `trayScoop` handler calls
`scoopTrayDice()` for the caller's seat. It searches centre-first positions with each die's
bounding radius and a tunable gap, then puts the dice at floor level with motion cleared and
their bodies asleep. If they cannot fit without overlap in one layer, it leaves their positions
alone rather than stacking colliders and provoking a bounce.

**Table shape.** The play surface is rectangular by default but can be **round, oval, hex
(flat-top) or a rounded rectangle** (`state.tableShape`, GM-set and durable). One shared
`tableOutline(shape, hx, hz)` — a closed perimeter polygon over the existing `tableX/tableZ`
half-extents — is the single source the three consumers agree on: the physics rim
(`server/game/table-bounds.js` emits one box wall per outline edge for a non-rect shape; the
floor stays a box), the felt mesh
(`resizeTable` extrudes the same outline), and the grid (which clips to it via `clipSegConvex`).
round and hex are single-size (depth follows width). Seats, personal trays and cameras are left
as they were — trays already ride a circular track — so the first cut keeps seating unchanged on
the new shapes. The rim is a GM-selectable **wood** (`state.rimWood`, five textures, durable + in
scenes) swapped on the shared material; the felt is a desaturated fabric texture tinted by the felt
colour (mirrored-wrapped + gradient-flattened for seamless tiling).

## Live table tools

Small shared/private utilities that reuse the existing channels rather than new
machinery:

- **Timer** (shared) — the synced `timer` holds only an _anchor_
  (`running/mode/base/since/duration`), never a ticking number. Each client
  computes the live value locally via `timerLive()` (in `shared/pieces.js`, used
  by both sides), so a running clock produces **zero** per-second patches — the
  same "sync the minimum, compute presentation locally" idea as the render loop.
- **Notebook** (private) — a per-player scratchpad in the server-only `notebooks`
  map; never synced, resent on reconnect like a hand.
- **Show cards** (hold-to-show) — while held, the chosen cards go **face-up in the
  shower's seat fan, but only for the audience**: content is sent privately
  (`showFan`) exactly like a hand, while everyone — audience or not — sees a public
  `showing` badge count. Content and audience never enter synced state.
- **Held name tags** — a client-only sprite over any piece whose public `owner`
  isn't you. **Attention ping** (middle-click / `P`) — a table-location marker
  clamped to the table server-side and broadcast to all; public by nature, so no
  routing.
- **Whiteboard** (shared) — a tilt-up sketch surface. Its _public_ state
  (`enabled/angle/owner/dark`) is synced schema, but **strokes are not**: each
  stroke is a `wbStroke` message appended to a capped server history and broadcast
  to replay onto every client's canvas texture, with a late joiner pulling the
  backlog via `wbStrokes`. One drawer at a time (`wbClaim`/`wbRelease`). Same
  "sync the minimum" instinct as the timer — the picture is rebuilt from messages,
  never diffed as state.
- **Skybox** (shared, durable) — a room background: an equirect image or a 6-face
  cubemap, applied by GMs and curated in the editor library. The chosen `skybox`
  (a `/assets/sky/…` URL or a cubemap descriptor) is synced and persisted per room.
  `public/table/skybox.js` loads and caps textures using each viewer's resolution preference,
  disposes replaced textures, and rejects stale success/error callbacks by request version. Off
  and resolution changes invalidate pending loads even when the synchronized ref stays the same.
  Ultra retains native source resolution, including larger custom uploads. The bundled skies are
  2048×1024, so their High and Ultra results match; higher-resolution upload support is complete.
- **Scoreboard & room notes** (shared, durable) — a `scores` map (label/score
  rows) and a GM `notes` string, both synced and saved with the room.
- **Chat** (shared, ephemeral) — public room text. A `chat` message is sanitized
  server-side (whitespace collapsed, trimmed, 400-char cap), stamped with the
  sender's name, appended to a rolling `chatLog` (last 80), and broadcast as
  `chatMsg`; a late joiner pulls the backlog by requesting `chatLog`. Held only in
  server memory, gone on dispose — the same message-not-schema pattern as the
  whiteboard, not synced state.
- **Felt color** (shared, durable) — the table surface color. GM-set, synced as
  `feltColor`, and persisted per room (the client applies it via `setTableColor`).
- **Lighting** (shared current state + durable room default) — a compact synchronized object
  carries preset identity, table-relative azimuth/elevation, directional and ambient colors and
  intensities, and shadow softness. GMs and owners can preview drafts locally and apply the current
  setup; only the room owner can replace the durable default or reset it to factory Neutral. A
  shaded draggable globe exposes direction without coupling it to any player's camera.
- **Lean in** (client-only) — an Interactions-menu toggle that eases the camera
  toward the orbit target for a closer look. Applied as a per-frame offset that's
  undone before `controls.update()`, so it never corrupts the real orbit distance
  and never touches the network.

## The non-physics presentation layer

Pieces go through the physics pipeline. Everything else that shows up on or around
the table but _isn't_ a physical object — the timer, the whiteboard, pings, the
scoreboard, and the measurement overlays — is presentation-layer, and it all
shares one instinct: **sync the minimum, compute or render the rest locally.**

It is tempting to fold these into a single shared base — a "non-physics thing" class.
Resist it. _"Not a piece"_ is a negation, not a behaviour: these share the property
of not being physics bodies and almost nothing else. The timer has no geometry at
all (it's a DOM HUD widget); the whiteboard is a tilted surface on a polar track; an
overlay is flat on the felt in cartesian x/z. Their cardinality differs (singleton
anchor vs. singleton object vs. a collection), and — most of all — their _sync
mechanisms_ differ. A common base would be abstract methods every subclass fully
overrides, deleting no real duplication while coupling three systems that today
evolve independently. That's the wrong-abstraction trade: an indirection tax paid
for a resemblance, not a shared behaviour.

What _is_ reusable is the **choice of sync strategy**. There are three in the
codebase, and a new presentation-layer feature should pick one deliberately:

1. **Anchor + local compute** — for a value that changes continuously. Sync the
   _rule_, not the ticks. The **timer** syncs an anchor
   (`running/mode/base/since/duration`) and every client derives the live number via
   `timerLive()`; a running clock produces zero per-second patches.
2. **Public state + replayed buffer** — for heavy or streamed content that won't fit
   in schema. Keep a small _public_ state object in the schema, but stream the actual
   content as messages appended to a capped server-side history and replayed onto
   each client, with a late joiner pulling the backlog on request. The **whiteboard**
   does this: `whiteboard` state is synced, but strokes are `wbStroke` messages over
   a capped buffer, replayed via `wbStrokes`.
3. **Synced collection** — for a set of _static, public_ objects that fit directly in
   state. Just put them in a `MapSchema`; Colyseus delta-syncs them and a late joiner
   gets them in the initial state, so there's no replay machinery at all. This is the
   simplest of the three, and it's what the **overlays** use.

The other axis of reuse is a **registry**, but only where a presentation-layer
concern is a genuine _family_ of like things — the same condition that makes the
piece `KIND` registry pay off (see "Kinds vs. instances"). Measurement is exactly
that: rulers and circle/cone/line templates today, fog-of-war shapes and hidden
zones plausibly later, all flat-on-felt public geometry that differs only in how each
kind is drawn. So overlays get their own **`OVERLAY` registry** keyed by kind,
parallel to `KIND`: a new annotation type is one entry (a mesh/label builder), and
the place/move/remove/sync plumbing handles it generically — never a new subsystem.
This is the reusable framework for "things outside the physics world," scoped to
where the likeness is concrete instead of stretched across the whole HUD.

So the rule of thumb: reuse the _decision_ (which of the three strategies), and —
within a real family — a _registry_; do not reach for a superclass spanning
unlike systems. If a second feature ever genuinely needs the whiteboard's
replayed-buffer machinery (fog-of-war reveal history is a candidate), extract _that
one helper_ then, on the second real need — not preemptively across a resemblance.
The overlay subsystem and its schema/message set are spec'd in the measurement design
note.

### Overlays in practice: measurement and templates

The overlay layer is shipped. Every overlay — whatever its kind — is stored as **two
points plus two optional scalars**: an origin `A(x, z)`, a drag point `B(x2, z2)`, an
optional width `w`, and an optional angle `ang`. That one shape carries all four kinds,
which is why a single "press at A, drag to B" gesture places every one of them and why
the server needs no per-kind branches. `ruler` draws a bar A→B and reads the distance;
`circle` treats `|A→B|` as a radius and draws a filled disc with a ring outline;
`cone` fans a flat sector from apex A toward B with half-angle `ang` (default
`MEASURE.coneAngle`); `line` lays a lane of width `w` (default `MEASURE.lineWidth`)
along A→B. The **`OVERLAY` registry** in `graphics.js` (parallel to `KIND`) maps each
shared `OVERLAY_KINDS` value to its browser-only mesh builder. The registry is built
from that shared list and fails at module load if a builder is missing or extra, so
adding a kind means updating the protocol list and implementing its renderer — nothing
else in the place/move/remove/sync path changes.

Two things stay deliberately _out_ of the synced overlay. The **measure label** (the
floating "5 in") is a client-owned sprite, not schema, because it depends on the
room's `RoomScale` — every kind's label is just `formatMeasure(|A→B|, scale)` at the
A–B midpoint, so a `scaleSet` re-labels every overlay locally without touching state
(`relabelOverlays`). And the **live drag** is a purely local preview built from the
same registry builder; only the committed placement is sent (`overlayAdd`), the same
"sync on release, not per frame" restraint the piece-move throttle uses.

The **Measure tool** is a modal client mode (like whiteboard draw): entering it
disables OrbitControls and piece-grab, a kind-picker row selects which overlay the
drag lays, and release fires `overlayAdd` with the kind's scalars. The server
validates the kind, enforces the per-room (`OVERLAY_LIMITS.maxRoom`) and per-player
(`OVERLAY_LIMITS.maxPerPlayer`) caps so the map can't be spammed, clamps coordinates
to `MEASURE.maxLen`, stamps `owner` (the creator's `sessionId`, for the remove/clear
permission gate) and `color` (copied from the creator's seat color so it survives
them leaving), and drops it in the `overlays` map; Colyseus delta-sync does the rest,
so a late joiner gets every overlay in its initial state with no replay. Clearing is
scoped: `overlayClear { scope }` wipes only your own by default, and `scope: 'all'`
(GM-gated server-side) wipes the whole map.

`shared/overlays.js` owns those protocol names and limits, including the separate
whiteboard history and per-stroke coordinate caps. `server.js` converts the shared
kind array to a `Set` for authoritative validation; `message-validation.js`, scene
restoration, and the client history mirror consume the same policy without importing
renderer or room-state implementation details.

Overlays are wiped on table reset, but they **do ride the scene snapshot**: because
they're public geometry, `serializeScene` includes the `overlays` array (by value, and
without `owner` — a saved session's `sessionId`s are meaningless on reload), so a GM
checkpoint, the auto-save-on-empty, and a saved library scene all carry their placed
templates, and `applyScene` rebuilds them as **table-owned** (`owner: ''`, hence
GM-managed) after the pieces. Note this makes the annotations durable across a room
going empty and returning — they are no longer session-lifetime only. The room's
`scale` — the measurement calibration **and** the grid layout (cell size, offset, snap
anchor, line color, height) — is durable **two** ways: `saveRoomState`'s own `scale`
column restores it on room load, and (since 0.7.0) `serializeScene` also embeds it in
the scene snapshot, so a saved library scene reopens measured and gridded exactly as it
was, not just the live room. `applyScene` re-applies it via `applyScale`.
Those snapshot, restoration, and calibration rules live together in `server/game/table-scale.js`;
the `TableRoom` facades preserve the scene, durable-room, handler, and starter call contracts.

## Sound & music

Audio is deliberately kept off the schema — no sound state is ever synced. It
splits into two independent systems, both in `public/table/audio.js`:

**Sound effects (Web Audio).** Each logical cue in the `SOUNDS` map names a _list_
of files under `/sounds/`; on first use each is fetched and decoded into a pool,
and `playSfx(name)` picks a random variant so a repeated action doesn't sound
identical. Loading is tolerant — a 404 or decode error just drops that variant, so
the app runs fine before any audio is added. Everything funnels through one master
gain (the SFX volume, or 0 when muted). Browsers block audio until a gesture, so
the first `pointerdown` calls `resumeAudio()`.

The important architectural split is **who hears a cue**, and it mirrors the
authority model:

- **Pickup cues are local.** Grabbing a piece plays `…-pickup` on that client
  alone — a private "I picked this up," never broadcast.
- **Landing cues are server-authoritative.** On `release` the server arms
  `_released` for that piece; the body's cannon-es `collide` event fires the cue
  **once**, gated on the arm window (~3 s, else it "never landed" and disarms) and
  on `SIM.impact.minVel` (gentle grazes stay silent). It then `broadcast`s an
  `sfx` message so _everyone_ hears the same landing at the true physics moment,
  not when the dragger let go. Flips, deals, and shuffles broadcast `sfx` the same
  way. `dropSfx(type, props)` maps a piece to its clip base (`card`→`card-drop`,
  and so on) and picks the **tile** variant — `tile-drop` / `tiledeck-drop` (and the
  local `tile-pickup` / `tiledeck-pickup`) — when a piece carries a `tile` kind, so a
  domino clacks and its wooden box thunks instead of sounding like paper.

**Background music (HTML5 `<audio>`).** A separate streaming player, because
tracks are long files rather than short buffers. Its playlist is the `MUSIC` array
from `credits.js`; it auto-advances on `ended`, supports shuffle (avoiding an
immediate repeat), a manual track picker, and its own volume/mute — all per-player
in `localStorage`, none of it synced. Kevin MacLeod's tracks are **CC BY 4.0**,
which requires visible attribution, so `credits.js` also feeds a **credits panel**
(music + `SFX_CREDITS` + `LIB_CREDITS`); that panel is a licensing obligation, not
decoration.

## Bundled static assets

`public/static_assets/` contains the six shipped asset trees: `mahjong/`, `sky/`, `textures/`,
`models/`, `music/`, and `sounds/`. Their filesystem location is controlled only by
`STATIC_ASSETS_DIR` in `server/static-assets.js`; relative values resolve from the project root,
independently of the process working directory, and absolute paths are supported.

`staticAssetMounts` maps the stable category URLs (`/models/...`, `/sky/...`, etc.) to that root.
`createStaticAssetRouter` installs those mounts before general public-file serving and preserves
the one-day Mahjong face cache, default revalidation elsewhere, and Express range/HEAD behavior.
Saved model refs, Mahjong faces, sky descriptors, and browser texture/audio paths keep their
existing URLs. This avoids rewriting persisted rooms, scenes, or libraries when the directory
moves. No database migration or client asset-URL rewrite is needed.

The browser fixture server reuses `staticAssetMounts`; collider measurement uses
`staticAssetPath` for trusted registry URLs. These filesystem helpers are Node-only. Browser
modules continue to request the stable public paths. To relocate the bundle again, move the six
folders together, change `STATIC_ASSETS_DIR`, and restart the server. Deployments must provide the
configured directory; uploaded originals and their `ASSETS_DIR` configuration are independent.

## Persistence: the asset library

The saved **library** is split across two stores: **metadata in Postgres**
(`custom_decks` / `custom_boards` / `custom_objects` for props / `custom_scenes`
for whole-table snapshots / `custom_skyboxes`, each keyed by a bigint `id`),
**image/model files on disk** under `ASSETS_DIR`, served from `/assets`. A card
face or model is stored as a _reference_ (a `/assets/…` URL or a procedural
string), never bytes, so rows stay small and unrevealed art isn't in the DB.
`db.js` normalizes a model's URL into the `file_url` column and puts the rest in a
`props` jsonb bag, splicing them back on read. The running server connects as a
**CRUD-only role** (`tabletop_app`) — it can't run DDL — so a leaked app credential
can't reshape or drop the schema.

An uploaded object's optional custom-dispenser definition lives inside that existing `props`
JSONB: `{appearance,infinite,defaultCount?,model?,box?,scale?,modelRot?,collider?,tintMaterial?}`.
No schema migration is needed. `getProp` is exported through the production database facade so
`loadProp` can fetch the authoritative record, while `removePropDispenser` removes only the nested
definition (`props - 'dispenser'`) and preserves the object row and primary `file_url`.

Large uploaded face originals are not sent directly to the renderer. For local random-name card
and tile references, the pure `public/rendering/asset-texture-url.js` mapper supplies the versioned
`/asset-textures/v1/<kind>/<file>.webp` route. Low/medium use a maximum-768-pixel WebP under
`ASSETS_DIR/.texture-cache/v1/`; High adds `?quality=high` and uses a separate maximum-1536-pixel
copy under `.texture-cache/v1-high/`. `server/http/routes/asset-textures.js` creates either variant
lazily, coalesces concurrent requests for the same face, and serves the result immutably. New
standard-aspect card uploads retain a 1024×1432 PNG source so High has detail to derive; an older
upload remains bounded by its existing source because derivatives never enlarge. The cache variants
leave database references and originals unchanged; DOM library/hand previews deliberately request
the standard derivative even on High, while Three.js card faces can request the High variant.
Orphan purge removes matching derivatives when it trashes an original.
The admin Storage panel can start the same encoder as a bounded, process-local background prebuild
over all random-name JPG/JPEG/PNG uploads. Its status endpoint exposes scan/build progress and byte
totals, repeat starts reuse the running job, and neither the originals nor database references change.

Room-facing library operations are composed through `server/game/library.js`. `TableRoom` keeps
small `saveDeckById` and `sendAssetList` forwarding methods so existing handlers retain their room
contract. Filesystem writing and database access remain injected; message validation, creation and
curation permissions, and asset-specific load/spawn rules remain visible in the library handlers.

Separately, each **room** persists its non-piece **settings** — scoreboard, GM
notes, table size and shape, rim wood, skybox, felt color, and owner-selected lighting default — plus the GM/auto-save **game
snapshot** (see "Scene vs. game snapshot"), in the `rooms` row (via `getRoomState`/
`saveRoomState`, debounced by the room's `scheduleSave`). So those survive a
restart or an empty-table reset; live pieces and hands stay in memory during a
session and reach the row only through that snapshot.

Table shape, rim wood, and default lighting are read directly from their `rooms` columns during
room-state loading. Their restoration is independent of a scene snapshot, so an unsnapshotted
room retains those choices. When present, a scene can still apply its own saved table settings
afterward; a scene without lighting leaves the current lighting unchanged.

Because unreferenced `/assets` files pile up as the library and tables churn
(deleted decks, replaced skyboxes), an admin **orphan cleanup** (`/admin/orphans`)
uses `server/asset-cleanup.js` to collect references before identifying unused
files. File categories come from the upload allowlist, including mats. The database
collector uses the existing asset-table registry and one `UNION ALL` statement to
read whole-row JSON from every library table and `rooms` in a consistent snapshot.
Private library records and snapshots in soft-deleted rooms remain protected.

Live reference collection traverses synchronized state and private data: deck
contents, card faces, hands, unclaimed hands, pending inspections, drafts, reveals,
notebooks, chat, and the in-memory saved snapshot. It understands maps, sets, nested
objects, and JSON-encoded strings, without exposing that private data to the admin
response. Live rooms are scanned before and after the database await; disposing
rooms remain in `LIVE_ROOMS` until their final save finishes. This protects references
held by rooms that disappear during the scan and includes newly created live data.

The preview lists only unreferenced regular files older than 24 hours. Purge performs
a fresh scan and moves candidates to `saved-assets/.trash/` (recoverable, never a hard
delete). Recent files, directories, and symlinks are excluded. Database or live-state
reference failures abort the scan. Live reference tracking is process-local, matching
the current single-server deployment.

Each asset now carries an `owner_id` (the admin who created it) and an `is_public`
flag, and the library is **admin-curated**: creation and curation (publish/rename/
delete) are admin-only, while listing and spawning are visibility-gated — public
assets are spawnable by GMs/helpers, private ones only by admins (who can also
spawn them into any game room). Admins build and test assets in a dedicated
**editor room** (`EditorRoom`, with an admin-only `onAuth`) that reuses the whole
table engine. The game table and workshop share one combined **Library** modal
(built-ins, custom assets, games, and skyboxes), driven by `editor-panel.js` over
`window.onOttRoom`; **Add to Library** (creation)
is editor-only and the asset handlers refuse non-admin creation/curation.
Custom objects with an authored dispenser also appear in the Dispensers tab. Deleting that
dispenser card invokes the targeted metadata removal rather than generic asset deletion, so the
object and its primary model remain in the Objects tab.
See "Accounts, rooms & roles" below.

## Built-in deck inventories

`server/game/deck-builders.js` owns construction of standard playing cards,
double-six dominoes, the letter bag, and the Mahjong wall. `createDeckBuilders`
receives the existing server shuffle function and returns `buildSimpleDeck`,
`buildDominoSet`, `buildScrabbleBag`, and `buildMahjongWall`. Each builds a fresh
inventory, preserves its back/tile/model/snap metadata, and shuffles once. Dominoes, letters, and
Mahjong select the shared low-poly `bag` skin.

`TableRoom.spawn` chooses these inventories for standalone set spawning.
`server/game/starters.js` receives the same builder collection and chooses the
appropriate inventory while assembling a complete starter layout. Letter counts
and Mahjong face definitions come from `shared/pieces.js`; rendering their references
stays in the browser. The injected shuffle keeps initial deck creation and later
gameplay shuffles on the same Fisher–Yates implementation while allowing deterministic
inventory and layout tests.

## Starter-game layout boundary

`createStarterSetup` builds one `setupStarter(room, game)` function from the existing
deck builders, card-geometry projection, piece limit, and spawn height. Unknown starter
IDs return before changing the room. A valid starter first calls the same `clearTable`
path as Reset and scene replacement, so visible pieces, private hands, deck contents,
inspections, recovery state, turn ownership, overlays, and the previous checkpoint are
removed together before anything new is created.

Board starters then use the room's `swapBoard` and `calibrateGrid` operations. Their
pieces are placed upright on the calibrated cells and stop at the shared capacity limit;
starter grids remain active for snapping but hidden visually. Boardless starters disable
stale grid settings. Deck starters select the shared standard/domino/letter/Mahjong
builder, retain tile geometry, snapping, and their selected deck skin, and optionally deal the
configured starting hand to each seated player. Bowls and chip stacks use the ordinary
authoritative `spawn` boundary. `TableRoom.setupStarter` remains as a small forwarding
method so its caller-facing contract stays recognizable.

## Piece lifecycle boundary

`createPieceLifecycle({ deckBuilders, dropSfx, geoOf, sim })` returns the authoritative
`spawn`, `removePiece`, and `releasePiece` operations. Spawn asserts the final room capacity,
constructs the Cannon body and synchronized `Piece` as one operation, keeps deck order private,
and installs the existing one-shot landing cue. Removal clears the body, synchronized record,
drag/flip state, and private deck/card data through one path.

Release clears ownership before applying either shared-grid snapping or a type-specific capped
throw. It then performs the existing compatibility-checked card-to-deck and item-to-dispenser
absorption rules without exposing private card fronts. `TableRoom` retains thin forwarding methods,
so card, movement, piece/group, starter, persistence, and tray callers keep the same room contract.
Deck/stack collider rebuilding and dispenser item resolution are deliberately delegated through
the room's stable API; their implementations belong to separate focused modules rather than being
hidden inside the lifecycle boundary.

## Collider maintenance boundary

`server/game/collider-maintenance.js` owns shape replacement for deck and finite-stack count
changes. `updateDeckCollider(room, id)` and count-dependent `updateStackCollider(room, id)` call
`buildCollider` with the synchronized count, so initial construction, live resizing, browser debug
geometry, and drop-surface queries share `colliderSpec`. Modeled decks keep the fixed collider
declared by their skin. Ordinary finite stacks and custom automatic stacks follow capped visible
count; generic/custom-model and infinite sources retain their fixed authored/display collider and
are not needlessly awakened. `replaceCollider` reattaches the returned primitive or compound
contract, then refreshes Cannon's bounding radius and mass properties. `TableRoom` retains thin
forwarding methods for card, lifecycle, and dispenser callers.

On the browser, deck cover changes may replace the rendered mesh while count listeners remain
registered. `public/table/piece-view.js`'s
`syncDeckMeshHeight(meshes, id, count, deckHeight)` therefore looks up the current mesh for every
count update instead of retaining the original mesh reference, keeping the visual deck height in
step with the authoritative collider after deals and rebuilds.

## Placement operations boundary

`server/game/placement-operations.js` owns the small state transitions shared by spawning,
handlers, and the physics heartbeat. `writeTransform(piece, body)` publishes all position and
quaternion fields from the authoritative Cannon body. `pinPiece(room, id)` freezes only a dynamic,
unpinned body after clearing its motion; `unpinPiece(room, id)` restores a pinned body to awake
dynamic simulation. `wantsSnap(room, piece)` requires both an active synchronized grid and the
piece's synchronized snap flag.

The ordered pre-step simulation work is coordinated by `preparePieceMotion`: held pieces unpin
before servo movement, unheld snap-enabled pieces pin only after sleeping, stale pins are removed,
and scripted flips advance last. Thin room facades preserve callers in piece lifecycle, piece
handlers, and the physics loop without duplicating those state transitions.

## Physics update boundary

`server/game/physics-update.js` splits the motion phase into four independently testable passes.
`driveHeldPieces` applies the bounded velocity servo, angular damping, pinned-body release, and
standing-piece leveling. `selfRightPieces` nudges eligible awake bodies toward world-up while
leaving held, sleeping, toppled-upright, and offset-flat bodies alone. `maintainSnapPins` applies
the existing fast sleep tuning and pins only fully settled pieces on their exact grid cell.
`advanceFlips` interpolates scripted flips and returns completed bodies to dynamic simulation.

`preparePieceMotion(room, dt, sim)` calls those passes in their established order before the step.
Afterward, `recoverEscapedBodies(room, sim)` keeps personal-tray bodies in their enabled tray and
tests ordinary bodies against the real playable table shape. Rectangular tables already have a
matching floor and outside-wall layout, so recovery triggers only when the body centre crosses the
felt edge; a valid object may overlap the rim without being teleported. Other shapes use a fast
interior check that falls back to the current Cannon AABB near an edge, then project an escaped body
toward the nearest safe footprint. This prevents pieces from remaining outside shaped tables or
settling atop the invisible containment-wall ring. `publishTransforms(room)` then writes every
surviving body's final authoritative transform through the existing room facade.

`TableRoom.update` keeps the heartbeat visible as inspection recovery → pre-step motion → profiled
`world.step` → escape recovery → transform publication. The extracted module owns the cohesive
passes on either side without hiding simulation stepping or performance instrumentation.

## Table-boundary physics boundary

`createTableBounds({ tableThickness, wall })` captures the table-related `SIM` tuning and
returns `buildTableBounds(room, hx, hz, shape)`. Rebuilding first removes only the bodies
tracked in `room._bounds`, preserving pieces and other world bodies, then creates the static
box floor. Rectangular tables receive four axis-aligned outside walls; every other supported
shape receives a slightly overlapping oriented wall box for each edge from the shared
`tableOutline`, sealing its vertices while keeping browser rendering independent.

The shared `inTable(x, z, shape, hx, hz, inset)` predicate mirrors those playable shapes without
allocating an outline each tick. Post-step recovery uses its centre-only rectangle test where the
floor already matches the felt; for other shapes it checks the body's AABB corners, closing the
deliberate gap between the rectangular support slab and a non-rectangular felt.

`TableRoom.buildBounds` remains as a small forwarding method because room creation, durable
scene restoration, and live GM resizing already call that room API. The extracted builder
finishes by calling `room.buildTrays()`, keeping personal trays aligned with the resized table.

## Scale and grid settings boundary

Browser presentation lives in `public/table/room-settings.js`: it owns the grid mesh lifecycle,
converts displayed scale values, preserves focused input, and sends existing calibration/settings
messages. Its room binder updates table appearance and lighting through core rendering helpers;
initial hydration runs before the client reveals the table. Lighting previews stay local until
Apply, Cancel restores synchronized lighting, and room-owner defaults remain server-authorized.
Graphics quality and sky resolution stay per-device preferences.

`createTableScale({ gridLiftMax })` returns room-oriented snapshot, restoration, and calibration
operations. It owns the durable `RoomScale` field list and restoration clamps, so room-row and scene
loads apply the same compatibility rules. Calibration reads the active board's synchronized metadata
and Cannon half-extents (or shared board dimensions for convex colliders): square grids derive per-axis spacing and center/cross anchoring, built-ins may
pin printed-line spacing, and hex grids retain pointy/flat orientation while deriving hex size from
board width. Only successful calibration resets offsets and schedules a save.

`TableRoom.scaleSnapshot`, `applyScale`, and `calibrateGrid` remain thin forwarding methods because
room persistence, scene persistence, settings handlers, and starter setup already depend on that API.
The extraction changes ownership without changing synchronized state or saved formats.

## Personal tray operations boundary

`createTrayOperations` captures only injectable randomness and returns the room-oriented tray
operations. `TableRoom.trayCenterFor`, `buildTrays`, `repositionTrayDice`, `trayDropPos`,
`clearTraySeat`, and `applyTrays` remain recognizable forwarding methods for existing callers.
The extracted module depends on room capabilities (`world`, `state`, `bodies`, `removePiece`) and
shared tray geometry rather than the `TableRoom` class, which keeps early construction and scene
restoration independently testable. `seatOf` remains on the room because deals, permissions,
disconnect handling, and other non-tray features also consume it.
The same module exports `scoopTrayDice(room, seat)` for the room-feature handler; its private
`scoopLayout()` uses the shared `TRAY` spacing knobs and Cannon bounding radii.

## Synchronized state boundary

`server/game/schema.js` is the single server-side declaration site for the state
Colyseus reflects to browsers. Declaration order and field types are a wire contract:
clients reconstruct the schema from reflection rather than importing this Node module.
The module therefore contains only schema definitions and the shared `TABLE` defaults;
it does not configure listeners, rooms, physics, persistence, or process-wide encoder
capacity.

The root `State` constructs fresh maps for pieces, players, scores, personal dice trays,
unclaimed-hand labels, and overlays, plus fresh `Timer`, `Whiteboard`, and `RoomScale`
singletons for every room. `TableRoom.onCreate` installs that root and continues to own
durable restoration, handler registration, and all authoritative mutations. Extracting
the declarations changes their module boundary only: reflection order, defaults, late-join
serialization, and reconnect synchronization remain unchanged.

## Scene vs. game snapshot (`serializeScene` / `serializeGame`)

Card transfers share explicit preservation rules: `takeTableCard` handles both single
and group takes, including the double-sided flag and hidden-face lookup.
The same module's `spawnTableCard` centralizes placement for hands, deck draws,
inspection choices, and recovery. It decides which faces belong in public props
versus private `cardData`, and applies the double-sided `down` flag. Capacity checks,
inventory consumption, and destination selection remain explicit in the callers;
`spawnCardFlat` still handles grid snapping and physics orientation. The hand
placement method is a thin facade that supplies geometry and the chosen orientation.
`deckSpawnProps` supplies split, combine, and snapshot paths with geometry, snap/open
flags, skin and tints; derived cover and count are rebuilt on spawn.
`inspectedEntry` preserves individual backs for both live returns and disconnect cleanup.
Snapshotting returns pending inspections to the drawing end in reverse inspection order,
so the first inspected card remains the original top card. It operates on a copied deck
array and leaves the live inspection unchanged.

If another player empties the source deck during inspection, **Return to Deck**
recovers the inspected card as a standalone face-down card at the table center.
`server/game/inspection-recovery.js` shares this behavior with disconnect cleanup.
Geometry, individual backs, and double-sided behavior survive; a normal card's
front remains private. At capacity, connected players retain the inspection dialog
and can retry or move the card to their hand. Disconnected players' cards stay in
private `pendingInspect` with `recover: true`; simulation ticks retry when space opens.

Snapshots store missing-deck inspections in an optional `recoveryCards` array,
separate from `pieces`, so restoring a full table cannot truncate this inventory.
The entries contain card data and geometry, without player identity. Restoration
stages them for the same automatic recovery; pending overflow survives later saves.
Resetting the table clears these pending cards along with other inspections.
The overall snapshot size limit still applies.

Two serializers, layered on purpose:

- **`serializeScene`** produces the portable _template_: table size + shape + every piece
  (transform, and a deck's private card order / tile geometry / box **skin** / a
  face-down card's hidden front ride along so they rebuild faithfully) + the overlays +
  the room **`scale`** (measurement calibration and grid layout), and **no player
  identity**. Library scenes call this directly — they must stay hands-free. Their save dialog may
  opt into a normalized **lighting** snapshot; without that option the field is omitted, so loading
  the scene preserves the room's current illumination. A deck's
  skin is written under the same `deckModel` name the spawn path reads, so it round-trips.
  Finite dispensers also store their authoritative `count` alongside their props, preserving
  the remaining inventory in both portable templates and full-game checkpoints.
- **`serializeGame`** always includes current lighting, then wraps the scene with the live private layer: each held **hand**
  and the **turn**. The catch is that both are keyed by ephemeral **`sessionId`**,
  but anything that must survive a reload has to key on the stable
  **`client.auth.userId`** — so `serializeGame` resolves session → account as it
  writes, emitting `hands: [{ userId, name, cards }]` and `turn: { userId, name }`.
  Already-departed players are gone from `clientBy(sid)`, so their hands are read
  from `pendingHands` (account-keyed) instead of the live `hands` map. A pending
  turn retains its account and display name until reclaimed or explicitly advanced.
  During a temporary disconnect, active turn serialization falls back to the
  session's `handOwners` account and retained player name when `clientBy` has no
  client, preserving turn ownership in saves made during the reconnect window.

Hands remain separate per live session, but durable ownership is account-based within
each room. `handOwners` keeps that association through the reconnect window. Saving
appends every live and pending card for an account; identical-looking cards remain
distinct inventory. Disconnect cleanup also appends rather than replacing pending
cards. The first returning tab claims the combined hand once. Restoration assigns
fresh hand-card IDs to avoid collisions with newly drawn cards. These operations
share `server/game/hand-state.js` helpers.

The GM's **`stateSave`** ("Save Table State") captures a checkpoint; **`onDispose`**
captures the latest game through `saveFinalRoomState`, including hands-only and
completely empty games. An empty snapshot replaces a previously populated one so
old pieces cannot return on reopening. The final save cancels the pending debounce
timer and awaits persistence through `savedScene` → `saveRoomState`, alongside the
room's other durable settings. The existing `SCENE_MAX_BYTES` limit still applies;
an oversized final snapshot retains the previous checkpoint. Scene loading also
replaces `savedScene` with the loaded scene and schedules persistence.

Manual Save reports success only after its database write completes. Failure produces
`sceneError`, including a table without durable room storage. Background saves remain
debounced. All writes capture independent payloads and run in request order per room,
so an older background write cannot finish after and replace a newer checkpoint.
A failed write rejects its caller while allowing later queued saves to proceed.

`applyScene` rebuilds the pieces, restores each saved finite-dispenser count, and refreshes its
count-derived collider. The post-spawn assignment deliberately preserves gathered stacks above a
single dispenser's normal creation cap; snapshots without a count retain the legacy default. It
then _stages_ — never assigns — the private layer:
saved hands land in `pendingHands` (account-keyed) with a public `unclaimed`
(`userId → name`) map mirrored into synced state for the GM's reassign UI; the saved
turn lands in `pendingTurn` with a public `turnPending` name, and `state.turn` is
blanked because no live session holds it yet. Resolution happens on join: a returning
account reclaims its `pendingHands` entry (and `pendingTurn`, if it was theirs);
otherwise a GM reassigns an unclaimed hand to a present player via **`reassignHand`**,
and `advanceTurn`/**Next Turn** clears a stale `turnPending`. `onLeave` closes the
loop — after the reconnection window lapses, a departing player's hand is parked
back into `pendingHands` + `unclaimed` so it survives to the next snapshot.

The privacy invariant is preserved end to end: hands and faces sit in the snapshot's
jsonb but never enter synced state; on load they're rebuilt into the server-only
maps and each hand is delivered privately via `sendHand`, exactly as in a live game.

## Seats, presence, turns

On join the server assigns the lowest free seat, a color, and a name, and
creates a public `Player` (seat, hand count, name, color, avatar). The presence controller
parks _your_ camera at _your_ seat using the table-scaled `VIEW` pose (the default `zoom: 0.65`
keeps the near rail and hand close while retaining the play surface), draws public fans from
hand counts and backs, and stands a marker (avatar or silhouette + name) at each remote seat.
The local seat has a flat YOU chip instead. Explicitly revealed cards occupy leading fan slots;
all other faces remain private. Each player also has a
GM-reorderable `order` independent of their physical seat. `state.turn` holds a
session id, highlighted in the panel; "Next turn" walks that shared order.

## Browser room-binding order

`client.js` retains join/reconnect, controller composition, binding order, loading gates, session
errors/identity/exits, and the render loop. Feature modules register their own state/message
listeners. `hand`, chat, notebook, and library binders install replay handlers before requesting
private cards, chat history, private notes, or dice finishes. Library responses are ready before
`window.onOttRoom` hands the session to the editor panel. Shared room settings, membership, and
scoreboard binders retain the optional-schema guard and explicit initial hydration.

Patch dispatch remains ordered: `pieceView.recordState`, whiteboard synchronization, tray
synchronization, then skybox synchronization. Piece add/remove callbacks update loading readiness;
removal still releases inspection/selection/held labels and collider surfaces before dropping the
snapshot buffer. `pieceDrag.bindRoom` owns `dealt` responses and checks the live gesture before
adopting a spawned piece; replies after release are dropped with the existing release message.
`effects.bindPings`/`bindTableEffects` retain their original registration positions. Shell and
preference modules own their control wiring; the root retains session/role orchestration.

## Composition-root endpoint

The final cleanup leaves `client.js` at roughly 900 lines. It retains join/reconnect, session and
role handling, shared mesh/buffer maps, loading/error/exit handling, explicit controller dependencies,
shared raycast/camera adapters, binding order, and frame orchestration. Feature modules own their
local state; there is no catch-all client context or networking module.

The frame order remains interpolation → cosmetic piece animation → collider diagnostics → overlay
surfaces → presence → piece guide/counts → pings → landing marker → selection → tray/orbit/Lean In
camera → hold controls → shadow refresh → render → performance sample. Each phase is still visible
at the root. Board landing surfaces reuse the shared collider specification and existing surface
builders, replacing cached geometry when props change and releasing it on removal.

Shell proxies invoke the original controls, retaining role gates and unread state. Seat and room
surfaces move live DOM nodes and return them on close. Flat/radial piece menus transfer pointer
capture to the drag controller before dismissal. Personal preferences retain their existing storage
keys and remain local; credits remain available in Settings. Browser regressions execute the real
composition root through a simulated join in desktop and touch layouts as well as focused visual
lifecycle checks. Real-device gesture feel and multiplayer behavior remain manual checks.

## Semantic input and piece-drag boundaries

Device profiles translate DOM events into intents; the input router then chooses a feature without
owning its state. Pointer moves first offer the gesture to selection, measurement, whiteboard,
inspection, overlay movement, then piece dragging. Press and release preserve their distinct
priority and pointer-capture/camera transitions. Escape closes tray, selection, measure,
whiteboard, inspection, or selected overlay in that order before checking field focus. Ordinary
commands and drawn-card placement remain guarded while typing; keyboard axis repeat is guarded
by the device profile.

The piece-drag controller owns the mutable gesture and its timing/velocity/rotation accumulators.
The hand and piece drag still share the root's projection plane and scratch hit vector, preserving
the existing flow. `current()` returns only copied display fields, and controller construction
precedes the first render. The router calls the controller's release behavior before restoring the
camera and clearing the gesture, so a click that enters inspection keeps orbit disabled. Physics,
permissions, inventory, and authoritative snapping remain server-owned. Tests cover modal priority,
late deal replies, grid/group transforms, typing, and touch re-anchoring; browser checks exercise
the production root's startup in both pointer layouts.

## Private-hand controller boundary

The server still keeps card faces outside synchronized room state and sends each player their
own hand through the private `hand` message. `hand.bindRoom()` installs that handler before
requesting `handSync` after reconnect and owns drop-undo feedback. `inspection.bindRoom()` handles
private drawn-card previews; these bindings do not change the
protocol or where hidden information lives.

Within one browser, `createHand()` owns the private bar and its local modes: Show audience and
picked-card scope, hide/show preference, rearrangement and Sort, hover guidance, and play gestures.
The global hand pointer hooks moved with that state, including the live two-finger face-up choice,
unsynced drag preview, drop hit test, and cancellation cleanup. Hand-card inspection requests the
injected `inspection.inspectMesh` callback. Inspection owns the preview and its controls; it uses
the composition root's piece-view callback to hide or reveal the original table mesh.
`public/table/presence.js` lays out public fans, including the local player's face-down fan.
Temporary face-up cards remain stored behind `hand.setRevealed()`/`revealedFor()`; presence receives
those functions as callbacks and clears a departed player's reveals through `hand.clearRevealed()`.
This keeps Show data with the hand feature while presence owns seat layout and public visuals.

## Identity & reconnection

On join the client saves a reconnection token in `sessionStorage`; on reload it
calls `client.reconnect(token)` to rejoin as the same session (same seat, name,
avatar, hand). The server holds the seat for 30 s on an unexpected disconnect
(`allowReconnection`); on reconnect the client re-requests its own private hand
and notes (they aren't in shared state). Because `sessionStorage` is per-tab,
separate tabs stay distinct.

`server/room-access.js` tracks all authorized connections, including seats awaiting
reconnection. `onReconnect` rechecks the database session and the actual room's
membership before restoring access. Kicks cancel pending reconnect reservations;
revoked clients cannot dispatch queued game messages. The browser's `accessRevoked`
handler explains the exit and removes its stale reconnection token.

## The message protocol (intent up, state down)

- **Up (client → server):** `grab`, `move`, `release`, `flip`, `dealToTable`,
  `drawToHand`, `dealDrag`, `takeCard`, `playCard`, `handToTable`, `reorderHand`, `shuffle`,
  `splitDeck`, `drawInspect`,
  `inspectPlace`, `recolor`, `deckBegin`/`deckAppend`/`deckFinish`,
  `saveDeck`/`listDecks`/`loadDeck`, `saveProp`/`listProps`/`loadProp`,
  `removePropDispenser` (admin-only targeted custom-dispenser removal),
  `listBoards`/`saveBoard`/`loadBoard`, `sceneSave`/`sceneLoad`/`listScenes`,
  `saveSkybox`/`listSkyboxes`/`skybox`,
  `assetPublic`/`assetRename`/`assetDelete` (admin curation),
  `members`/`admit`/`kick`/`setRole`/`reassignHand` (GM member management),
  `stateSave` (GM checkpoints the live game into the room's `scene`),
  `loadStarter` (GM replaces the table with a built-in game),
  `dispense`/`dispenseDrag` (take one object from a dispenser),
  `overlayAdd`/`overlayMove`/`overlayRemove`/`overlayClear`/`overlayDrag`
  (persistent templates and ephemeral placement previews),
  `wbEnable`/`wbClaim`/`wbRelease`/`wbSet`/`wbStroke`/`wbClear`/`wbStrokes`
  (whiteboard), `chat`/`chatLog` (public chat — send, and request the backlog),
  `score`/`roomNotes`/`table`/`tableColor`/`scaleSet`/`calibrateGrid` (durable room
  settings: scoreboard, notes, table size, felt color, measurement + grid),
  `lightingApply`/`lightingRestore` (gm+ current-lighting control) and
  `lightingDefaultSave`/`lightingFactoryReset` (owner-only durable-default control),
  `setStand`/`setSnap`/`snap` (per-piece flags: keep-upright, snap-to-grid, and step
  facing by 45°),
  `trayShow`/`trayScoop`/`trayClear` (your personal dice tray: toggle it out, re-rack, clear),
  `grabGroup`/`moveGroup`/`releaseGroup` (multi-select group move via the servo) and
  `removeGroup`/`setStandGroup`/`setSnapGroup`/`rollGroup`/`flipGroup`/`takeGroup`/`rotateGroup`
  (batch ops mirroring the singles across a selection),
  `spawn`, `roll` (rolls the caller's tray dice), `rollOne`, `reset`, `nextTurn`, `remove`,
  `setName`, `setAvatar`,
  `notebook`, `timer`, `showStart`/`showStop`, `ping`, `handSync` (re-request my
  private hand after a reconnect). (Library load/edit key on a row **`id`** — the
  Postgres primary key — not a filename slug.)
- **Down (server → client):** synced state (pieces, players, turn, timer, scores,
  notes, tableX/Z, whiteboard, trays, skybox, felt color, room name, scale/grid, lighting,
  overlays, unclaimed hands, and a pending turn) plus direct messages — `hand` (your private
  cards), `dealt` (adopt a dealt card as the dragged piece), `inspectCard` (a drawn
  front for you alone), `notebook` (your private notes), `showFan` (cards someone
  is showing _you_), `ping` (a broadcast attention marker), `sfx` (a shared sound
  cue — landing/flip/deal), `shuffled` (play the riffle), `chatMsg`/`chatLog`
  (a broadcast chat line / the late-join backlog),
  `wbStroke`/`wbStrokes`/`wbClear` (whiteboard replay), `overlayDrag` (another
  player's live overlay preview), `whoami` (your
  admin flag — gates the creation UI), `memberList` (the room's members, for GMs),
  `roomClosed`/`kicked` (lifecycle notices), `stateSaved` (the GM's Save Table
  State went through), `notice` (a transient toast — e.g. the table hit the piece cap), and the
  library listings
  `deckList`/`boardList`/`propList`/`sceneList`/`skyList` (plus `skyError`/
  `sceneError` on a rejected save).

## Reset & room lifecycle

**Reset** wipes the table contents: every piece (boards included), active and pending
hands, unclaimed-hand labels, active and pending turns, piece/deck bookkeeping,
drag groups/targets, release and hand-drop undo records, active shows, placed
overlays, and the shared timer. `clearGameTable` owns the shared cleanup used by
Reset, starter changes, and scene loads; Reset separately resets the timer. Cleanup
invalidates the old checkpoint and schedules persistence, so a later settings save
cannot preserve the previous game. Scene loading then installs its replacement
checkpoint. Reset leaves the room's **durable settings** (scoreboard, GM notes, table size, skybox,
lighting —
room configuration, not table contents) plus ephemeral notebooks, chat history,
and the whiteboard drawing; the latter clears only on an explicit `wbClear`.
New rooms start **empty**
(the default-seed call is disabled); you build the table from the toolbar.

## Accounts, rooms & roles

The lobby/auth layer is built and enforced server-side. **Postgres** holds
accounts (passwords hashed with scrypt in `auth.js`; every browser credential is
stored only as a hash in an expiring `user_sessions` row), rooms, and per-room membership; asset **files** stay
on the volume and live table state stays in memory. Credentials come from the
environment, never code.

**Accounts.** A _player_ is passwordless (display name + device token); a _host_
has a password. Each browser login has its own hashed, expiring row in
`user_sessions`, so devices coexist and can be revoked independently. `onAuth`
resolves the token to a user and uses the live room's own code to resolve membership,
admits only admitted members (else rejects with a waiting/forbidden message), and
stamps the membership **role** — and the account's admin flag — onto the connection
(`client.auth`).

The supplied code must match the actual table or waiting lobby, including direct
`joinById` requests; matchmaking filters are not authorization. The shared
`createRoomAccess()` service owns these checks for tables, pending-member lobbies,
and the admin-only editor. It tracks token hashes privately and guards in-flight
authorization reads against changes affecting that token, user, or room.

Logout revokes connections using that token; logout-all revokes the account's
connections across devices. Admin-console privilege changes and account deletion
also disconnect affected live connections. Application-route invalidation is
immediate within the server process. A non-overlapping check every 30 seconds
also detects expired sessions and CLI/database privilege changes; failed database
authorization checks disconnect affected sessions rather than retaining cached access.

Account deletion preserves library assets. `purgeUser` uses the same internal
asset-table registry as asset administration and reference collection to release
ownership across decks, boards, objects, scenes, skyboxes, dice, and mats. Records,
content, and public/private visibility stay intact; releasing ownership does not
publish private assets. Ownership release, deletion of owned rooms, and user deletion
share one database transaction, so a failure rolls back those database changes.
The admin route disposes owned live rooms before that transaction and disconnects
the deleted user's remaining connections after it succeeds; live-room disposal is
outside the database rollback.

**Rooms & roles.** A room has an owner, a join code, and an optional
require-approval gate; roles rank **owner → GM → helper → player** (`RANK`), and
every privileged handler checks `this.rank(client)` — spawn = helper+,
reshape/reset/board = GM+, member management = GM+. **Admins** are a global flag
(`is_admin`), threaded through `onAuth` as `client.auth.isAdmin`: they join any
room as an owner and can act on private library assets anywhere. GMs manage members
(admit / kick / promote) live from the Members panel; the server pushes
`memberList` to GMs plus a pending-join pulse. Because `onAuth` turns a _pending_
joiner away from the table, they instead hold a socket to a tiny per-code
**`LobbyRoom`** while waiting; on admit/decline the table room calls into that lobby
(via the matchmaker) to push `admitted`/`declined` and release them — instant, with a
15s poll left as a fallback. A **site admin** can also kick a user out of _every_
live table at once (`kickUserEverywhere`, at `POST /admin/users/:id/kick` and on
user-delete); the per-room GM kick is separate and scoped to that one table.
Room-role updates and room kicks reach every matching tab and pending reconnect
in that room. They do not change the user's roles in other rooms. Site-wide kicks
also cover editor and waiting-lobby connections.

Authorization is checked again when asynchronous reads finish. Library loads
recheck the current room rank before spawning pieces, replacing a board, or
applying a scene; private assets also require current site-admin access. Member
kick/role handlers recheck the actor after the target-user lookup and before
submitting the database mutation. This prevents a request started before a kick
or demotion from using its earlier privileges to mutate the room afterward.

The same boundary protects response data: private library lists and deck data are
suppressed if admin access was lost, and member lists require current GM+ access.
A mat save that has already reached the database may finish, but losing admin
access prevents its subsequent table spawn. These checks do not cancel database
writes already submitted; synchronization of completed membership changes still
runs so live connections reflect the persisted result.

`server/game/member-service.js` owns member-list reads/broadcasts and the table-to-lobby
matchmaker fan-out, while `TableRoom` retains small forwarding methods. The membership handlers
continue to own mutation validation and role-policy checks, and `LobbyRoom` retains the remote
admit/decline endpoints that release waiting clients.

**Host approval.** Creating a room needs approved host access (`host_status =
'approved'`, or admin). A password signup starts **pending**; a passwordless
player can request host access (which sets a password); an admin approves /
rejects / revokes from the console (revoke keeps the password, so they can
re-request). Admins host regardless and are excluded from the pending count.

**Admin console.** `/admin.html` (guarded by `is_admin`) manages all rooms
(restore / purge soft-deleted) and users (grant/revoke admin, approve/reject/
revoke host, delete-with-cascade). Its Storage section also previews and trashes orphaned assets and
starts/polls the non-destructive uploaded-image WebP prebuild. A fresh installation provisions its first
administrator before the listener opens from `BOOTSTRAP_ADMIN_USERNAME`,
`BOOTSTRAP_ADMIN_EMAIL`, and a password file. The transaction is advisory-locked
and only permits an empty users table; normal signup never grants admin. Local
`admin:grant` / `admin:revoke` commands provide recovery without an HTTP bootstrap.

**Hardening.** The upload endpoints (`/upload`, `/upload-model`) are now gated by
`requireAdmin` server-side — the "admin-only" guarantee no longer rests on the UI —
and every upload is validated before it touches disk: `.glb` magic + version + a
JSON-chunk parse that **rejects any external buffer/image URI** (only `data:` is
allowed, so a model can't fetch or exfiltrate at load time), plus magic-byte checks
on images. A per-IP **token bucket** (burst 300, ~180/min sustained) throttles
uploads while still letting a whole deck's images through at once. Auth and upload
limits use an atomic Redis token bucket, namespaced by purpose and IP, so every app
replica consumes the same allowance. Redis assigns each bucket a full-refill TTL;
inactive IPs disappear automatically. Store failures fail closed with `503`, while a
documented memory adapter remains available only for local development/tests.
`TRUST_PROXY_HOPS` must match the exact reverse-proxy depth before forwarded client
addresses are trusted. Redis establishes shared infrastructure but does not alone
provide clustered Colyseus presence, room discovery, or socket routing.
**CSP is enforced:** Three + Colyseus are self-hosted under
`/vendor` (no CDN fetches), so the policy locks scripts to `'self'` plus one
allowlisted inline import-map hash — no `'unsafe-inline'`/`'unsafe-eval'` (Colyseus feature-detects
eval and falls back to its non-inline decoder). Violations POST to `/csp-report`. This
also shapes the client: a _new_ inline `<script>` would fail the hash allowlist, so the compact/full
labels preference is applied from **`equalize.js`** — a small external file loaded `defer` on every
page — which reads `localStorage['ott-ui-full']` and toggles `body.ui-full` before the module scripts
run (an inline version was silently blocked).
Remaining optional hardening: post-parse model complexity limits, per-user storage
caps. Defense in depth, not provably safe.

## Adding things

- **A new piece type:** one `KINDS` entry (mass + shape) + one client `KIND`
  entry (mesh + interaction). Everything downstream just works.
- **A die size:** one vertex entry in the shared dice data.
- **A built-in model piece:** a `PROPS` entry with `model` + `modelScale` +
  a `collider` (`{ box, type? }`, `type` = `sphere`/`cylinder`/`cone`/`flat`)
  (+ optional `team`/`tintMaterial`/`modelRot`/`stand` and one boolean default-finish flag).
- **A built-in board:** a `BOARDS` entry (`model`, `modelScale`, precomputed
  `box`, and optional measured grid spacing). Run `npm run assets:colliders -- <key>` after replacing
  its GLB to obtain the scale/collider recommendation, then verify the printed playing-area spacing
  separately when the model has a decorative border.
