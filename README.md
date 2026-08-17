# Open Tabletop — Multiplayer (Colyseus)

An authoritative-physics virtual tabletop where *any* game can be played,
because the engine only simulates physical objects and lets people enforce the
rules. One server runs a single cannon-es world and syncs piece transforms to
every client over Colyseus; clients render and send intent, never physics.

## Run

```bash
npm install
# Copy the .env.example file `cp .env.example .env.  Then set `DATABASE_URL` to the `tabletop_app` connection string. `npm start` auto-loads `.env`.
# set up Postgres and DATABASE_URL first — see "Database" below
npm start
```

Open **http://localhost:2567** in two browser windows (or two devices on your
LAN → use your machine's IP) and move pieces around together.

## Database

Postgres now backs three things: the saved-asset **library** (deck / board / prop
/ scene / skybox metadata), **user accounts**, and **rooms + membership** (plus
each room's durable settings — scoreboard, notes, table size, skybox). Live piece
state and private hands are still all in-memory. One-time setup:

1. **Database + owner role** (as a superuser):
   `CREATE ROLE tabletop LOGIN PASSWORD '…';` then
   `CREATE DATABASE tabletop OWNER tabletop;`
2. **Least-privilege app role** (as a superuser): create `tabletop_app`, a
   CRUD-only role (no `CREATE`/`DROP`/`TRUNCATE`/`ALTER`) that the running
   server connects as. Grant it `SELECT/INSERT/UPDATE/DELETE` on the tables and
   `USAGE` on the sequences.
3. **Schema** (as the *owner*). For a **fresh install** (a new Docker volume, a
   clean dev DB), apply the consolidated baseline in one shot:
   `psql -U tabletop -d tabletop -f postgres/schema.sql`.
   To **upgrade an existing database**, apply the numbered migrations in order
   instead — `001_custom_assets.sql` → `002_auth.sql` → `003_asset_visibility.sql`
   → `004_host_status.sql` → `005_room_board.sql` → `006_room_table.sql` →
   `007_scenes.sql` → `008_room_skybox.sql` → `009_room_state.sql`. (`schema.sql` is the flattened end
   state of all of them;
   the per-migration backfills matter on a populated DB but are no-ops on an empty
   one, so they're dropped from the baseline.)
4. **Point the app at it:** `cp .env.example .env`, set `DATABASE_URL` to the
   `tabletop_app` connection string. `npm start` auto-loads `.env`.
5. **The first account is admin automatically** — sign up in the UI and you're
   the admin; no SQL needed. Admins grant admin/host to others from the console.
   (To promote someone later: `UPDATE users SET is_admin = true WHERE
   lower(username) = lower('them');`.)

Config comes from `DATABASE_URL`, or `DATABASE_URL_FILE` (a path to a file holding
it — the Docker-secrets pattern, taking priority). There's no hardcoded fallback, so
a missing config fails loudly at startup. For a remote DB, append `?sslmode=no-verify`
(encrypt only) or `?sslmode=verify-full` (verified — needs the CA) to the URL, and
turn on `ssl` server-side.

## Run with Docker

The repo ships a `Dockerfile` and `docker-compose.yml` that bring up the app **and**
Postgres — including the two-role DB setup (owner + least-privilege app role), applied
automatically on first start.

```bash
cp .env.example .env      # set DB_PASSWORD and APP_DB_PASSWORD
docker compose up -d      # builds the image, starts Postgres, then the app
```

Open **http://localhost:2567**. On the first run, Compose applies `postgres/schema.sql`
and creates the `tabletop_app` role via `docker/init-app-role.sh`. Two named volumes
persist state: `db-data` (the database) and `assets` (uploaded decks/boards/props/skyboxes).

The **first account you sign up becomes admin automatically** — no SQL step needed.

### Single container (bring your own Postgres)

If you already run Postgres (managed or otherwise), skip Compose and run just the
app image against it:

```bash
docker build -t open-tabletop .
docker run -p 2567:2567 -v ott-assets:/data/assets \
  -e DATABASE_URL=postgresql://tabletop_app:…@dbhost:5432/tabletop open-tabletop
```

The volume holds uploaded **files**; library **metadata** lives in Postgres. Pass
the DB URL via `DATABASE_URL` or `DATABASE_URL_FILE` (a mounted secret).

## What's in the box

- **Dice** d4–d20 (`↻ Dice` / the `☰ + Dice` menu). One `die` kind parameterized
  by `props.sides`; d6 is a numbered box, the rest numbered convex polyhedra
  whose mesh (client) and collider (server) come from one vertex list. Inspect a
  die (or prop) to recolor it — dice get **independent body and number colours**.
- **Props** (`+ Object`): built-in shapes (box, sphere, cone, pyramid, checker,
  go stone, coin, chip, token, chess set) and **custom `.glb` uploads**. Every
  prop has a **Scale**; models can be **tinted** (whole, one material slot, or
  left as-is) and **saved** for one-click re-spawn.
- **Cards, decks & hidden hands** — face-down stacks, private hands, custom
  decks from text or images, save/edit/clone, and **double-right-click to split**
  a deck in two. See below.
- **Boards** (`↷ Board`): two built-in `.glb` boards (Chess/Checkers, Go),
  **custom `.glb` board upload**, or a plain sized flat board.
- **Inspect** — double-click a piece to enlarge & rotate it; double-click a deck
  to privately **draw a card into inspect**, then send it to the field or hand.
  **Lean in** (Interactions menu) eases the camera closer for a look.
- **Whiteboard & skybox** — a shared tilt-up **whiteboard** to sketch on (one
  drawer at a time), and a room **skybox** (equirect or cubemap background,
  GM-applied, curated in the editor library).
- **Seats, presence & turns** — a seat per player, standing name/avatar markers,
  a turn indicator, private hand bar (collapsible).
- **Live table tools** — a shared **timer** (⏱, stopwatch or countdown), a
  **scoreboard** + GM room notes, a private per-player **notebook** (✎,
  ephemeral), **hold-to-show** cards to chosen players or the whole table (🃏,
  revealed face-up in your seat fan with a public "SHOWING n" badge), floating
  **name tags** over pieces others are holding, and an **attention ping**
  (middle-click / **P**) that pulses a colored ring at a spot. Player-facing
  actions live in a left **Interactions** menu, table utilities in a right
  **Tools** menu.
- **Accounts, rooms & roles** — sign up as a passwordless **player** (quick-join)
  or a password **host**; create rooms with join codes and an optional
  admit-to-join gate. Membership carries a **role** (owner → GM → helper →
  player) that gates the table tools, managed live from an in-table Members
  panel. See "Accounts, rooms & roles" below.
- **Admin console & curated library** — site **admins** manage all rooms and
  users at `/admin.html` (including a **storage cleanup** that trashes orphaned
  asset files), and curate the shared asset library in a dedicated **editor**
  (`/editor.html`): every deck/board/prop/scene/skybox is **public or private**,
  admins create/edit, and GMs/helpers spawn only what's been published. See
  "The asset library" below.

## Files

```
server.js            Colyseus rooms + authoritative cannon-es physics + HTTP (auth/rooms/admin) + Postgres
db.js                Postgres pool + all queries (library, users, rooms, membership)
auth.js              password hashing (scrypt) + device-token hashing (no deps)
shared/pieces.js     piece specs (mass, colliders, palettes, dice verts, prop/board registries) + timerLive
postgres/            SQL migrations 001–008 + schema.sql (fresh-install baseline) + grants_app_role.sql
docs/                ARCHITECTURE.md, REFERENCE.md, ASSET_CREDITS.md
docker/              Dockerfile
public/
  index.html         landing / lobby page (quick-join, login, room list, host request)
  landing.js         landing-page logic (auth calls, room list, host-access request)
  table.html         the game table shell: importmap + toolbar + panels + modals
  editor.html        admin-only library editor (reuses the table engine)
  editor-panel.js    the editor's library-management panel (publish / rename / delete / spawn)
  admin.html         admin console shell (rooms + users tables)
  admin.js           admin-console logic (room/user management, host approvals)
  styles.css         all UI styling (design-token :root block, shared chrome, page layouts)
  core.js            scene/camera/renderer/controls + the CONFIG and LIGHTING tunables
  graphics.js        every texture & mesh builder, model loading, the KIND registry
  client.js          the game-table runtime: networking, interaction, seats, render loop
  models/            bundled CC0 .glb assets (chess, checkers, go, misc, boards)
```

The game client is a **linear import chain**: `shared ← core ← graphics ←
client`. `table.html` and `editor.html` load `client.js`; its `import`s pull in
the rest (the editor also loads `editor-panel.js`). The landing and admin pages
are standalone (`landing.js` / `admin.js`, plain `fetch` to the HTTP API).
Nothing is bundled or transpiled — Three.js (via an import map) and Colyseus are self-hosted under `public/vendor/`, so there are no third-party CDN fetches at runtime. That's also what makes the enforced `script-src 'self'` Content-Security-Policy possible.

## Tuning knobs (edit and reload)

- **`SIM`** in `server.js` — all physics: gravity, damping, card-stack stability
  (`SIM.cards.colliderThick` is the main dial), solver iterations, timestep,
  throw caps, self-righting.
- **`CONFIG`** in `public/core.js` — client feel: grab/scroll height, model
  normalization size, render delay, input thresholds, inspect zoom, drop-marker
  look, spawn-input ranges, texture resolutions.
- **`LIGHTING`** in `public/core.js` — hemisphere fill, sun, environment-map
  strength (three numbers).
- **Feature dials** — named constants you can nudge: `WHITEBOARD_MAX_STROKES` /
  `WHITEBOARD_RES` (whiteboard history cap + canvas resolution),
  `LEAN_AMOUNT` (how far "Lean in" dollies, `client.js`), `ORPHAN_MIN_AGE_MS`
  (cleanup age guard), `SCENE_MAX_BYTES` and `TABLE_LIMIT` (server guards).

## Add a new piece type

1. Add its physics spec to `shared/pieces.js` — an entry in `KINDS` (mass +
   shape) or, for a prop variant, in `PROPS` (mass + collider + `render` shape
   **or** a bundled `model` path).
2. Add/extend the mesh builder in `public/graphics.js` and, if it's a new kind,
   an entry in the `KIND` registry (mesh + interaction verbs).

Everything downstream — spawning, dragging, throwing, sync — then works
automatically, because it only ever handles generic "pieces".

## Decks, hidden hands & the privacy invariant

- **Deck**: a face-down stack. Its ordered cards live only in server memory
  (`deckCards`); synced state exposes just `type: deck` and `count` (the visible
  height). **Left-click** deals the top card face-down beside the deck;
  **left-drag** deals-and-carries; **right-drag** moves the deck; **right-click**
  shuffles; **double-click** draws privately into inspect (below).
- **Table card**: a dealt card's face is private (`cardData`) until taken or
  flipped. **Left-click** takes it into your hand; **right-click** reveals it.
  Faces show a traditional **corner index** (rank over suit, mirrored).
- **Hand** (bottom bar): your private cards, sent to you alone (`sendHand`),
  never broadcast. **Left** drag/click plays **face-down**; **right** drag/click
  plays **face-up**.

The invariant: **if it's synced it's public; if it's secret it's server-only.**
Deck order, face-down fronts, drawn-but-unplaced cards, and hands never enter the
broadcast state.

## Draw-to-inspect

Double-click a **deck** to draw its top card privately into an enlarged inspect
view (the front is sent to you alone, like a hand of one; the deck count drops
for everyone). Then place it: **F** field face-up · **D** field face-down · **H**
hand · **R** / click-away returns it to the top of the deck.

## Custom decks & card art

Card faces are texture *references*: `rank:A:♠:#000` (procedural), `text:…`
(procedural text card), `tback:…` (colored back), or a `data:`/URL image. The
**+ Deck** dialog builds a deck from text (one per line / comma / JSON) or
uploaded images, with a **"Save this deck as…"** field to persist it on creation.
There's also a "Spawn Built-in Deck" for a standard 52.

## The asset library (admin-curated)

The saved library (decks, boards, props, scenes, skyboxes) is **global** (every
room sees it) and **admin-curated**. Site admins create assets through an
**Add to Library** builder in a dedicated **editor** (`/editor.html`) — an
admin-only room that reuses the table engine, so an asset can be spawned and
tested live as it's built — and manage them (**publish/unpublish, rename, delete**)
from the shared **View Library**. Every asset carries a **public/private** flag:

- **private** (a new asset's default) — only admins can spawn it;
- **public** — admins still own curation, but GMs and helpers can now spawn it
  into their games too.

Both the editor and the game table share the same asset UI — a **View Library**
(browse + spawn/apply saved assets) and a **Built-Ins** picker (bundled shapes,
dice, boards, skyboxes) — plus a Room Controls **Skybox** picker (built-in +
custom, applied to the room). At a game table, helpers see only the decks/objects
they can spawn; boards, skyboxes and scenes are GM+. **Add to Library** (creation)
is editor-only, and the publish/rename/delete controls only appear for admins —
non-admin curation is server-refused as well. Admins can spawn *private* assets
anywhere (handy for prepping a campaign); the public flag widens *spawn* rights,
never *curation* rights.

**Metadata lives in Postgres** (`custom_decks` / `custom_boards` /
`custom_objects`), keyed by a row **id**, with `owner_id` (the creating admin)
and `is_public`; uploaded **image and model files stay on disk** under
`ASSETS_DIR` and are served from `/assets`. Uploaded images are **POSTed to
`/upload`** (not sent over the socket); `.glb` models to **`/upload-model`**.
Files get random names, so unrevealed fronts stay hidden.

```
saved-assets/            (ASSETS_DIR, default ./saved-assets — image/model FILES only)
  uploads/  decks/  boards/  props/
```

`/assets/<kind>/<file>` is served statically. Card faces are stored as
*references* (a `/assets/…` URL or a procedural string like `rank:A:♠:#000`),
never image bytes — so a full backup of image decks means dumping the DB **and**
copying `saved-assets/`. Bundled models live separately under `public/models/`
(trusted, shipped with the app — no upload path).

## Custom `.glb` models

Upload a model as a prop (**+ Object → Custom model…**) or a board
(**↷ Board → Upload**). Models are normalized (props to a target size, boards to
fit the table), given a box collider from their measured bounds, and can be
**tinted**. Built-in model pieces (chess, checkers, go, coin, chip, token) use a
fixed per-piece scale and precomputed colliders so a set keeps its real
proportions. `modelScale`, `modelRot`, and the tint mode all live in
`shared/pieces.js`. See `docs/ASSET_CREDITS.md` for bundled-asset licensing (all CC0).

## Accounts, rooms & roles

Two kinds of account: a **player** (passwordless — a display name plus a device
token kept in the browser, created by quick-join) and a **host** (has a
password). Anyone can join a room by code; only an **approved host** (or an
admin) can create one.

**Rooms** have a join code, an owner, and an optional **require-approval** gate.
With approval on, a joiner waits as *pending* until a GM admits them (the landing
page polls and auto-forwards on approval); with it off, they're admitted
immediately. Owners rename, toggle approval, and close their rooms from the
lobby; closing disposes the live room.

**Roles** rank **owner → GM → helper → player**, are per-room membership, and are
stamped onto the connection at join and enforced server-side:

- **player** — move/throw pieces, play their own hand.
- **helper** (+) — spawn built-in props/dice and public library decks/props.
- **GM** (+) — reshape/reset the table, spawn public boards, and manage members
  (admit / kick / promote) from the in-table Members panel.
- **owner** — the room's creator; a GM other GMs can't manage.

A site **admin** is a global flag, not a room role: admins join any room as a GM,
can spawn private library assets anywhere, and curate the library.

**Host approval:** creating rooms requires approved host access. Signing up with
a password lands an account in a **pending** state (they can still play, just not
host); a passwordless player can **request host access** (which sets a password).
An admin approves / rejects / revokes from the console — revoking keeps the
password, so they can re-request. Admins host regardless and stay out of the queue.

**The admin console** (`/admin.html`, admins only) lists every room (including
soft-deleted, with restore / purge) and every user (grant/revoke admin,
approve/reject/revoke host, delete). A pending-host count shows on the Users
header and on the lobby's Admin link.

## Security & production posture

The full accounts / rooms / roles / admin / library-curation layer is built, and the
hardening pass is complete: admin-gated + validated uploads (glTF magic + external-URI
stripping, image magic bytes), per-IP rate limits on uploads and auth, a per-user
cross-room **live kick**, a socket **push** for the "you're admitted" signal (with a
slow poll fallback), account **avatar uploads**, and an enforced **Content-Security-
Policy** — `script-src 'self'`, no `unsafe-*`, with Three and Colyseus self-hosted
under `public/vendor/` (no CDN). The first account to sign up is admin automatically.
Remaining optional hardening (post-parse model complexity limits, per-user storage
caps, a shared-store rate limiter for multi-instance) is noted in
`docs/ARCHITECTURE.md`.

## Notes

- `defineTypes()` (build-step-free schema) is deprecated but works in 0.17.
- No client build step: Three.js via import map, Colyseus SDK via unpkg.
