# Architecture

A web-based, physics-driven tabletop where any game can be played, because the
engine only ever simulates *physical objects* and lets humans enforce the rules.

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
- A **kind** is the *concept* "a d20", "the chess king", "the standard deck" —
  geometry, collider, textures, behavior. One exists per type, created once.
  **This is where object-orientation belongs.**

So: **rich kinds, flat instances** — the *type-object / flyweight* pattern.
Variation lives in `props`, not in a proliferation of types: one `die` kind
reads `props.sides`; one `card` kind reads `props.front/back`; one `prop` kind
reads `props.shape` (or a `.glb` `model`) and `props.scale/color/team`.

## Files

The client used to be one inline module; it is now a small **linear import
chain** (`shared ← core ← graphics ← client`) so the codebase stays navigable:

- **`shared/pieces.js`** — the single source of truth for physics dimensions,
  masses, colours, dice vertices, and the prop/board registries. Imported by
  *both* sides so a collider and its mesh are built from the same numbers.
- **`server.js`** — the authority: the cannon-es world, the Colyseus room, all
  message handlers, the Postgres-backed asset library (via `db.js`), and the
  private (non-synced) memory that holds secrets. All physics tuning is in one
  `SIM` config block.
- **`db.js`** — the Postgres connection pool and **every** query: the saved
  library (deck / board / prop / scene / skybox *metadata*; image/model files stay
  on disk) plus users, rooms, membership, and each room's durable settings. Config
  comes from the environment only (`DATABASE_URL` / `DATABASE_URL_FILE`).
- **`auth.js`** — password hashing (scrypt) and device-token hashing, built on
  Node's `crypto` alone (no dependencies).
- **`public/core.js`** — scene/camera/renderer/controls + the environment map,
  plus the `CONFIG` (client feel) and `LIGHTING` tunable blocks.
- **`public/graphics.js`** — every `<canvas>` texture builder, all mesh builders,
  the `.glb` model loading/measuring helpers, and the `KIND` registry. Pure:
  props in, meshes out — no shared runtime state.
- **`public/client.js`** — the tightly-coupled runtime: networking, interaction
  (click vs. drag, inspect, scroll-height), seats/markers, and the interpolating
  render loop. Holds the mutable session state (`room`, `down`, `inspect`,
  `meshes`, `buffers`).
- **`public/audio.js`** — the sound layer: a Web Audio **SFX** manager (short
  clips pooled per logical name, played fire-and-forget) plus an HTML5 `<audio>`
  **background-music** player. Volumes/mutes/shuffle are per-player, in
  `localStorage`; nothing here is synced (see "Sound & music").
- **`public/credits.js`** — the attribution manifest: the `MUSIC` playlist (which
  drives *both* the music player and the credits panel) plus `SFX_CREDITS` and
  `LIB_CREDITS`. The CC-BY music makes the in-app credits mandatory, not cosmetic.
- **The pages** — `index.html` + `landing.js` (the lobby: quick-join, login, room
  list, host request), `table.html` (the game table, which loads the client
  chain), `editor.html` + `editor-panel.js` (the admin-only library editor,
  reusing the game client — `editor.html` now shares the game table's full HUD
  plus the Add-to-Library builder, so building assets looks and behaves like
  sitting at a table), `admin.html` + `admin.js` (the admin console), and
  `styles.css` (all UI styling: the design-token `:root` block, then a layer of
  shared component primitives the pages compose from — `.panel`/`.popout` pop-out
  panels, `.field` inputs, `.chip`, `.miniLabel`, `.tile`, `.actions` — over the
  per-page layouts. Restyling a control means editing its one class, not every
  `#id` that uses it).
- **Project dirs** — `postgres/` (SQL migrations, applied in order
  `001`→…→`009`, plus `schema.sql` as the flattened baseline), `docs/` (these
  documents), `docker/` (`init-app-role.sh`, which creates the least-privilege app
  role on first DB start; the `Dockerfile` itself lives at the repo root).

## Public vs. secret (how hidden information works)

The **synced state is public** — anything in it is one devtools-peek from being
read. It holds: each piece's transform/type/owner/props/count; each player's
seat, hand *count*, name, color, avatar, `showing` count (how many cards they're
revealing) and `handBack` (their hand's back image); the shared `timer` anchor;
the room dressing (`scores`, `notes`, `tableX/Z`, `whiteboard`, `skybox`,
`feltColor`); and whose turn it is — including, after a resumed game, the public
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
  (the card *content* goes only to that audience; the public part is the badge count)
- `pendingHands` — hands from a loaded/departed game awaiting their owner's return,
  keyed by account (`userId`); the public mirror is the `unclaimed` name map (and
  `turnPending` for the waiting turn), which carry names only, never cards

The invariant: **if it's synced it's public; if it's secret it's server-only.**
A face-down card's face has never been transmitted to any client, so there is
nothing to peek at. Revealing it *moves* the data from a secret map into public
props — only then does any client learn it, and the client rebuilds that card's
mesh from a blank back to a real face. Draw-to-inspect uses the same channel as
a hand: the drawn front goes to the drawer alone and sits in `pendingInspect`
until placed on the field / into a hand / back on the deck.

## The heartbeat

**Server, 60×/sec:** for every held piece, run the *velocity servo* (push the
body's velocity toward that player's drag target, clamped) so a held piece
follows the cursor while remaining a real dynamic body that shoves others; step
the cannon world (fixed timestep, sub-stepped — see `SIM.step`); then copy every
body's transform into synced state. Colyseus ships only changed fields, so
resting pieces cost ~nothing.

**Client, each frame:** as state patches arrive, push a timestamped snapshot of
every piece into a small per-piece buffer. To draw, render each piece as it was
**~60 ms ago** (`CONFIG.render.delay`), interpolating between the two real
snapshots bracketing that moment (lerp position, slerp rotation).

That deliberate delay is what makes motion smooth: rendering slightly in the past
guarantees two real samples to interpolate *between*, so fast pieces glide
instead of teleporting packet-to-packet. One uniform path for held/thrown/resting
pieces — no prediction seams.

## One action end to end: grab & throw

1. Press + move past a small threshold → client distinguishes *drag* from
   *click*, sends `grab {id}`.
2. Server marks the piece `owner: you`.
3. On move, client raycasts the cursor onto a horizontal plane (its height is
   the scroll-adjustable grab height) and streams `move {id, x,y,z}`; the servo
   pushes the body toward it. Meanwhile the client measures a smoothed cursor
   velocity, and a translucent ring previews the straight-down landing spot.
4. Release → client sends `release {id, v}` with that measured hand speed; the
   server clears the owner and sets the body's velocity to `v` (clamped;
   cards get a stricter cap to avoid tunnelling). Now it's a free body flying
   with real momentum, interpolated onto every screen.

Decoupling throw velocity (measured) from the servo (which only tracks the
cursor) is what fixed the old rubberband/jitter: the servo tracks tightly *and*
throws carry accurate momentum.

## Pieces today

Each **kind** is defined in two registries keyed by the same type id:

- `shared/pieces.js` → `KINDS`: the physics half, `{ mass, shape }`. The server's
  `buildCollider(type, props)` reads this; there are no per-type branches in
  `spawn`.
- client `KIND` (in `graphics.js`): the render + interaction half, `{ mesh,
  grab, ldrag, lclick, rclick }`. The pointer handler looks up `KIND[type]` and
  dispatches, instead of switching on type.

The kinds:

- **die** — parameterized by `props.sides` ∈ {4,6,8,10,12,20}. Numbered
  (below).
- **card** — thin box; faces are texture *references* (`front`, `back`).
  Face-down keeps `front` server-side (`cardData`) and shows only the public
  `back`, so uploaded card art is hidden exactly like ranks are. An **invisible
  thicker collider** (`SIM.cards.colliderThick`) keeps stacks stable while the
  mesh stays thin.
- **deck** — a public `back` + private ordered fronts (`deckCards`); public
  `count` scales the visible stack (`deckHeight`).
- **prop** — the workhorse. Either a **built-in shape** (`render.prim`:
  box/sphere/cone/cyl/lens) or a **`.glb` model** (`model` path). Colour comes
  from a picker, a two-colour **team** palette, or a per-material **tint**; a
  `stand` flag self-rights standing pieces. Universal `props.scale`.
- **board** — static (mass 0) but removable. A built-in model (`BOARDS`
  registry), an uploaded `.glb`, or a procedural flat box with an optional
  image. One board at a time; it's sat on the table by its half-height.

Procedural visuals are drawn onto `<canvas>` and used as `CanvasTexture`s (pips,
card faces, checkerboard, player markers), created through a helper that applies
**anisotropic filtering** so text/numbers stay crisp at grazing angles. 3D assets
are bundled CC0 `.glb` files under `public/models/` (see `ASSET_CREDITS.md`).

### Models: scale, orientation, colour

- **Built-in model pieces** (chess/checkers/go/coin/chip/token) carry a fixed
  `modelScale` and a **precomputed collider** in `PROPS` (`{ box, type? }` — a box
  by default, or `sphere`/`cylinder`/`cone`/`flat`), so a set keeps its
  real relative sizes and the server never has to load a model. `.glb` files can
  bake a node scale, so sizes are measured *as loaded*.
- **Custom uploads** are normalized (props to `CONFIG.model.size`, boards to fit
  the table); the client measures the model and sends the collider box with the
  spawn.
- **`modelRot`** reorients a mis-authored model (e.g. laying a coin flat).
- **Tint modes** (in the loader): `team` recolours every slot; a colour-picker
  prop recolours all; `tintMaterial:'name'` recolours **one** material slot and
  de-metals the rest (e.g. a chip body but not its white rim); `ownMaterial`
  keeps the model's materials. glTF defaults materials to metallic, so tinting
  swaps in a clean matte material and de-metals kept slots.

## The dice family

A die is **one kind** parameterized by `props.sides`.

- `shared/pieces.js` stores each solid's **vertices**. d6 is an axis-aligned box;
  the rest are convex polyhedra (tetra/octa/icosa/dodeca + a pentagonal
  trapezohedron for d10).
- **Client** numbers every die: the d6 bakes a digit onto each box face, and the
  polyhedra lay a digit plane on each logical face (coplanar triangles grouped by
  normal, a sprite at each centroid). Both honour an optional per-die **body
  colour** and **number colour** (`props.color` / `props.textColor`), baked into
  the face textures so the two stay independent. Double-click a die (or prop) to
  inspect it and the overlay offers those colour pickers; committing sends
  `recolor` and the tint syncs to everyone.
- **Server** builds a `CANNON.ConvexPolyhedron` from the *same* vertices (hull
  faces from `convex-hull`, windings flipped outward) so the die tumbles and
  settles on a face. Visual and physics can't diverge; adding a size is a
  one-line vertex entry.

## Live table tools

Small shared/private utilities that reuse the existing channels rather than new
machinery:

- **Timer** (shared) — the synced `timer` holds only an *anchor*
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
- **Whiteboard** (shared) — a tilt-up sketch surface. Its *public* state
  (`enabled/angle/owner/dark`) is synced schema, but **strokes are not**: each
  stroke is a `wbStroke` message appended to a capped server history and broadcast
  to replay onto every client's canvas texture, with a late joiner pulling the
  backlog via `wbStrokes`. One drawer at a time (`wbClaim`/`wbRelease`). Same
  "sync the minimum" instinct as the timer — the picture is rebuilt from messages,
  never diffed as state.
- **Skybox** (shared, durable) — a room background: an equirect image or a 6-face
  cubemap, applied by GMs and curated in the editor library. The chosen `skybox`
  (a `/assets/sky/…` URL or a cubemap descriptor) is synced and persisted per room.
- **Scoreboard & room notes** (shared, durable) — a `scores` map (label/score
  rows) and a GM `notes` string, both synced and saved with the room.
- **Chat** (shared, ephemeral) — public room text. A `chat` message is sanitized
  server-side (whitespace collapsed, trimmed, 400-char cap), stamped with the
  sender's name, appended to a rolling `chatLog` (last 80), and broadcast as
  `chatMsg`; a late joiner pulls the backlog by requesting `chatLog`. Held only in
  server memory, gone on dispose — the same message-not-schema pattern as the
  whiteboard, not synced state.
- **Felt colour** (shared, durable) — the table surface colour. GM-set, synced as
  `feltColor`, and persisted per room (the client applies it via `setTableColor`).
- **Lean in** (client-only) — an Interactions-menu toggle that eases the camera
  toward the orbit target for a closer look. Applied as a per-frame offset that's
  undone before `controls.update()`, so it never corrupts the real orbit distance
  and never touches the network.

## The non-physics presentation layer

Pieces go through the physics pipeline. Everything else that shows up on or around
the table but *isn't* a physical object — the timer, the whiteboard, pings, the
scoreboard, and the measurement overlays — is presentation-layer, and it all
shares one instinct: **sync the minimum, compute or render the rest locally.**

It is tempting to fold these into a single shared base — a "non-physics thing" class.
Resist it. *"Not a piece"* is a negation, not a behaviour: these share the property
of not being physics bodies and almost nothing else. The timer has no geometry at
all (it's a DOM HUD widget); the whiteboard is a tilted surface on a polar track; an
overlay is flat on the felt in cartesian x/z. Their cardinality differs (singleton
anchor vs. singleton object vs. a collection), and — most of all — their *sync
mechanisms* differ. A common base would be abstract methods every subclass fully
overrides, deleting no real duplication while coupling three systems that today
evolve independently. That's the wrong-abstraction trade: an indirection tax paid
for a resemblance, not a shared behaviour.

What *is* reusable is the **choice of sync strategy**. There are three in the
codebase, and a new presentation-layer feature should pick one deliberately:

1. **Anchor + local compute** — for a value that changes continuously. Sync the
   *rule*, not the ticks. The **timer** syncs an anchor
   (`running/mode/base/since/duration`) and every client derives the live number via
   `timerLive()`; a running clock produces zero per-second patches.
2. **Public state + replayed buffer** — for heavy or streamed content that won't fit
   in schema. Keep a small *public* state object in the schema, but stream the actual
   content as messages appended to a capped server-side history and replayed onto
   each client, with a late joiner pulling the backlog on request. The **whiteboard**
   does this: `whiteboard` state is synced, but strokes are `wbStroke` messages over
   a capped buffer, replayed via `wbStrokes`.
3. **Synced collection** — for a set of *static, public* objects that fit directly in
   state. Just put them in a `MapSchema`; Colyseus delta-syncs them and a late joiner
   gets them in the initial state, so there's no replay machinery at all. This is the
   simplest of the three, and it's what the **overlays** use.

The other axis of reuse is a **registry**, but only where a presentation-layer
concern is a genuine *family* of like things — the same condition that makes the
piece `KIND` registry pay off (see "Kinds vs. instances"). Measurement is exactly
that: rulers and circle/cone/line templates today, fog-of-war shapes and hidden
zones plausibly later, all flat-on-felt public geometry that differs only in how each
kind is drawn. So overlays get their own **`OVERLAY` registry** keyed by kind,
parallel to `KIND`: a new annotation type is one entry (a mesh/label builder), and
the place/move/remove/sync plumbing handles it generically — never a new subsystem.
This is the reusable framework for "things outside the physics world," scoped to
where the likeness is concrete instead of stretched across the whole HUD.

So the rule of thumb: reuse the *decision* (which of the three strategies), and —
within a real family — a *registry*; do not reach for a superclass spanning
unlike systems. If a second feature ever genuinely needs the whiteboard's
replayed-buffer machinery (fog-of-war reveal history is a candidate), extract *that
one helper* then, on the second real need — not preemptively across a resemblance.
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
kind string to a mesh builder; adding a kind is one registry entry plus one string in
the server's `OVERLAY_KINDS` set — nothing else in the place/move/remove/sync path
changes.

Two things stay deliberately *out* of the synced overlay. The **measure label** (the
floating "5 in") is a client-owned sprite, not schema, because it depends on the
room's `RoomScale` — every kind's label is just `formatMeasure(|A→B|, scale)` at the
A–B midpoint, so a `scaleSet` re-labels every overlay locally without touching state
(`relabelOverlays`). And the **live drag** is a purely local preview built from the
same registry builder; only the committed placement is sent (`overlayAdd`), the same
"sync on release, not per frame" restraint the piece-move throttle uses.

The **Measure tool** is a modal client mode (like whiteboard draw): entering it
disables OrbitControls and piece-grab, a kind-picker row selects which overlay the
drag lays, and release fires `overlayAdd` with the kind's scalars. The server
validates the kind, enforces the per-room (`OVERLAY_MAX`) and per-player
(`OVERLAY_MAX_PER_PLAYER`) caps so the map can't be spammed, clamps coordinates to
`MEASURE.maxLen`, stamps `owner` (the creator's `sessionId`, for the remove/clear
permission gate) and `color` (copied from the creator's seat colour so it survives
them leaving), and drops it in the `overlays` map; Colyseus delta-sync does the rest,
so a late joiner gets every overlay in its initial state with no replay. Clearing is
scoped: `overlayClear { scope }` wipes only your own by default, and `scope: 'all'`
(GM-gated server-side) wipes the whole map.

Overlays are wiped on table reset, but they **do ride the scene snapshot**: because
they're public geometry, `serializeScene` includes the `overlays` array (by value, and
without `owner` — a saved session's `sessionId`s are meaningless on reload), so a GM
checkpoint, the auto-save-on-empty, and a saved library scene all carry their placed
templates, and `applyScene` rebuilds them as **table-owned** (`owner: ''`, hence
GM-managed) after the pieces. Note this makes the annotations durable across a room
going empty and returning — they are no longer session-lifetime only. The room's
`scale` is durable the same way, but through a different path: `saveRoomState`'s own
`scale` column, restored on room load.

## Sound & music

Audio is deliberately kept off the schema — no sound state is ever synced. It
splits into two independent systems, both in `public/audio.js`:

**Sound effects (Web Audio).** Each logical cue in the `SOUNDS` map names a *list*
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
  `sfx` message so *everyone* hears the same landing at the true physics moment,
  not when the dragger let go. Flips, deals, and shuffles broadcast `sfx` the same
  way. `sfxImpact(type)` maps a piece type to its clip base (`card`→`card-drop`,
  and so on).

**Background music (HTML5 `<audio>`).** A separate streaming player, because
tracks are long files rather than short buffers. Its playlist is the `MUSIC` array
from `credits.js`; it auto-advances on `ended`, supports shuffle (avoiding an
immediate repeat), a manual track picker, and its own volume/mute — all per-player
in `localStorage`, none of it synced. Kevin MacLeod's tracks are **CC BY 4.0**,
which requires visible attribution, so `credits.js` also feeds a **credits panel**
(music + `SFX_CREDITS` + `LIB_CREDITS`); that panel is a licensing obligation, not
decoration.

## Persistence: the asset library

The saved **library** is split across two stores: **metadata in Postgres**
(`custom_decks` / `custom_boards` / `custom_objects` for props / `custom_scenes`
for whole-table snapshots / `custom_skyboxes`, each keyed by a bigint `id`),
**image/model files on disk** under `ASSETS_DIR`, served from `/assets`. A card
face or model is stored as a *reference* (a `/assets/…` URL or a procedural
string), never bytes, so rows stay small and unrevealed art isn't in the DB.
`db.js` normalizes a model's URL into the `file_url` column and puts the rest in a
`props` jsonb bag, splicing them back on read. The running server connects as a
**CRUD-only role** (`tabletop_app`) — it can't run DDL — so a leaked app credential
can't reshape or drop the schema.

Separately, each **room** persists its non-piece **settings** — scoreboard, GM
notes, table size, skybox, and felt colour — plus the GM/auto-save **game
snapshot** (see "Scene vs. game snapshot"), in the `rooms` row (via `getRoomState`/
`saveRoomState`, debounced by the room's `scheduleSave`). So those survive a
restart or an empty-table reset; live pieces and hands stay in memory during a
session and reach the row only through that snapshot.

Because unreferenced `/assets` files pile up as the library and tables churn
(deleted decks, replaced skyboxes), an admin **orphan cleanup** (`/admin/orphans`)
grep-scans every DB row *and* every live table for `/assets/…` references, then
moves anything unreferenced and older than a day to `saved-assets/.trash/`
(recoverable, never a hard delete).

Each asset now carries an `owner_id` (the admin who created it) and an `is_public`
flag, and the library is **admin-curated**: creation and curation (publish/rename/
delete) are admin-only, while listing and spawning are visibility-gated — public
assets are spawnable by GMs/helpers, private ones only by admins (who can also
spawn them into any game room). Admins build and test assets in a dedicated
**editor room** (`EditorRoom`, with an admin-only `onAuth`) that reuses the whole
table engine. The game table and the editor share the same asset UI — **View
Library** and **Built-Ins** pickers (plus a Room Controls Skybox picker), driven
by `editor-panel.js` over `window.onOttRoom` — while **Add to Library** (creation)
is editor-only and the asset handlers refuse non-admin creation/curation.
See "Accounts, rooms & roles" below.

## Scene vs. game snapshot (`serializeScene` / `serializeGame`)

Two serializers, layered on purpose:

- **`serializeScene`** produces the portable *template*: table size + every piece
  (transform, and a deck's private card order / a face-down card's hidden front
  ride along so they rebuild faithfully), and **no player identity**. Library
  scenes call this directly — they must stay hands-free.
- **`serializeGame`** wraps a scene with the live private layer: each held **hand**
  and the **turn**. The catch is that both are keyed by ephemeral **`sessionId`**,
  but anything that must survive a reload has to key on the stable
  **`client.auth.userId`** — so `serializeGame` resolves session → account as it
  writes, emitting `hands: [{ userId, name, cards }]` and `turn: { userId, name }`.
  Already-departed players are gone from `clientBy(sid)`, so their hands are read
  from `pendingHands` (account-keyed) instead of the live `hands` map.

Two triggers write a snapshot into the room's `scene` jsonb: the GM's **`stateSave`**
("Save Table State") and the **`onDispose`** auto-save (only when the table isn't
empty, and only under `SCENE_MAX_BYTES`). Both go through `savedScene` →
`saveRoomState`, alongside the room's other durable settings.

`applyScene` rebuilds the pieces, then *stages* — never assigns — the private layer:
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

On join the server assigns the lowest free seat, a colour, and a name, and
creates a public `Player` (seat, hand count, name, colour, avatar). The client
parks *your* camera at *your* seat, draws every *other* player's hand as N fanned
face-down backs (from the public count — you see how many, never which), and
stands a marker (avatar or silhouette + name) at each seat. `state.turn` holds a
session id, highlighted in the panel; "Next turn" walks it around the seats.

## Identity & reconnection

On join the client saves a reconnection token in `sessionStorage`; on reload it
calls `client.reconnect(token)` to rejoin as the same session (same seat, name,
avatar, hand). The server holds the seat for 30 s on an unexpected disconnect
(`allowReconnection`); on reconnect the client re-requests its own private hand
and notes (they aren't in shared state). Because `sessionStorage` is per-tab,
separate tabs stay distinct.

## The message protocol (intent up, state down)

- **Up (client → server):** `grab`, `move`, `release`, `flip`, `dealToTable`,
  `dealDrag`, `takeCard`, `playCard`, `shuffle`, `splitDeck`, `drawInspect`,
  `inspectPlace`, `recolor`, `deckBegin`/`deckAppend`/`deckFinish`,
  `saveDeck`/`listDecks`/`loadDeck`, `saveProp`/`listProps`,
  `listBoards`/`saveBoard`/`loadBoard`, `sceneSave`/`sceneLoad`/`listScenes`,
  `saveSkybox`/`listSkyboxes`/`skybox`,
  `assetPublic`/`assetRename`/`assetDelete` (admin curation),
  `members`/`admit`/`kick`/`setRole`/`reassignHand` (GM member management),
  `stateSave` (GM checkpoints the live game into the room's `scene`),
  `wbEnable`/`wbClaim`/`wbRelease`/`wbSet`/`wbStroke`/`wbClear`/`wbStrokes`
  (whiteboard), `chat`/`chatLog` (public chat — send, and request the backlog),
  `score`/`roomNotes`/`table`/`tableColor` (durable room settings: scoreboard,
  notes, table size, felt colour),
  `spawn`, `roll`, `reset`, `nextTurn`, `remove`, `setName`, `setAvatar`,
  `notebook`, `timer`, `showStart`/`showStop`, `ping`, `handSync` (re-request my
  private hand after a reconnect). (Library load/edit key on a row **`id`** — the
  Postgres primary key — not a filename slug.)
- **Down (server → client):** synced state (pieces, players, turn, timer, scores,
  notes, tableX/Z, whiteboard, skybox) plus direct messages — `hand` (your private
  cards), `dealt` (adopt a dealt card as the dragged piece), `inspectCard` (a drawn
  front for you alone), `notebook` (your private notes), `showFan` (cards someone
  is showing *you*), `ping` (a broadcast attention marker), `sfx` (a shared sound
  cue — landing/flip/deal), `shuffled` (play the riffle), `chatMsg`/`chatLog`
  (a broadcast chat line / the late-join backlog),
  `wbStroke`/`wbStrokes`/`wbClear` (whiteboard replay), `whoami` (your
  admin flag — gates the creation UI), `memberList` (the room's members, for GMs),
  `roomClosed`/`kicked` (lifecycle notices), `stateSaved` (the GM's Save Table
  State went through), and the library listings
  `deckList`/`boardList`/`propList`/`sceneList`/`skyList` (plus `skyError`/
  `sceneError` on a rejected save).

## Reset & room lifecycle

**Reset** wipes the whole room to an empty table — every piece (boards included),
all hands, every private map, any active shows, and the shared timer. Two things
it leaves alone: the room's **durable settings** (scoreboard, GM notes, table
size, skybox — room configuration, not table contents), and the **whiteboard
drawing**, which clears only on an explicit `wbClear`. New rooms start **empty**
(the default-seed call is disabled); you build the table from the toolbar.

## Accounts, rooms & roles

The lobby/auth layer is built and enforced server-side. **Postgres** holds
accounts (passwords hashed with scrypt in `auth.js`; passwordless players carry a
hashed device token instead), rooms, and per-room membership; asset **files** stay
on the volume and live table state stays in memory. Credentials come from the
environment, never code.

**Accounts.** A *player* is passwordless (display name + device token); a *host*
has a password. `onAuth` resolves the token to a user and the room code to a room,
admits only admitted members (else rejects with a waiting/forbidden message), and
stamps the membership **role** — and the account's admin flag — onto the connection
(`client.auth`).

**Rooms & roles.** A room has an owner, a join code, and an optional
require-approval gate; roles rank **owner → GM → helper → player** (`RANK`), and
every privileged handler checks `this.rank(client)` — spawn = helper+,
reshape/reset/board = GM+, member management = GM+. **Admins** are a global flag
(`is_admin`), threaded through `onAuth` as `client.auth.isAdmin`: they join any
room as a GM and can act on private library assets anywhere. GMs manage members
(admit / kick / promote) live from the Members panel; the server pushes
`memberList` to GMs plus a pending-join pulse. Because `onAuth` turns a *pending*
joiner away from the table, they instead hold a socket to a tiny per-code
**`LobbyRoom`** while waiting; on admit/decline the table room calls into that lobby
(via the matchmaker) to push `admitted`/`declined` and release them — instant, with a
15s poll left as a fallback. A **site admin** can also kick a user out of *every*
live table at once (`kickUserEverywhere`, at `POST /admin/users/:id/kick` and on
user-delete); the per-room GM kick is separate and scoped to that one table.

**Host approval.** Creating a room needs approved host access (`host_status =
'approved'`, or admin). A password signup starts **pending**; a passwordless
player can request host access (which sets a password); an admin approves /
rejects / revokes from the console (revoke keeps the password, so they can
re-request). Admins host regardless and are excluded from the pending count.

**Admin console.** `/admin.html` (guarded by `is_admin`) manages all rooms
(restore / purge soft-deleted) and users (grant/revoke admin, approve/reject/
revoke host, delete-with-cascade). The **first account to sign up bootstraps as
admin** — the signup `INSERT` sets `is_admin` when the users table is empty
(an atomic `NOT EXISTS` in the same statement), so a fresh install needs no
manual SQL flip.

**Hardening.** The upload endpoints (`/upload`, `/upload-model`) are now gated by
`requireAdmin` server-side — the "admin-only" guarantee no longer rests on the UI —
and every upload is validated before it touches disk: `.glb` magic + version + a
JSON-chunk parse that **rejects any external buffer/image URI** (only `data:` is
allowed, so a model can't fetch or exfiltrate at load time), plus magic-byte checks
on images. A per-IP **token bucket** (burst 300, ~180/min sustained) throttles
uploads while still letting a whole deck's images through at once. The rate limiter
and the cross-room kick are in-process (single-instance); both would need a shared
store to scale out. **CSP is enforced:** Three + Colyseus are self-hosted under
`/vendor` (no CDN fetches), so the policy locks scripts to `'self'` plus three
inline-script hashes — no `'unsafe-inline'`/`'unsafe-eval'` (Colyseus feature-detects
eval and falls back to its non-inline decoder). Violations POST to `/csp-report`.
Remaining optional hardening: post-parse model complexity limits, per-user storage
caps. Defense in depth, not provably safe.

## Adding things

- **A new piece type:** one `KINDS` entry (mass + shape) + one client `KIND`
  entry (mesh + interaction). Everything downstream just works.
- **A die size:** one vertex entry in the shared dice data.
- **A built-in model piece:** a `PROPS` entry with `model` + `modelScale` +
  a `collider` (`{ box, type? }`, `type` = `sphere`/`cylinder`/`cone`/`flat`)
  (+ optional `team`/`tintMaterial`/`modelRot`/`stand`).
- **A built-in board:** a `BOARDS` entry (`model`, `modelScale`, precomputed
  `box`).
