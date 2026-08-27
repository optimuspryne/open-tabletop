# Open Tabletop — Multiplayer (Colyseus)

An authoritative-physics virtual tabletop where *any* game can be played,
because the engine only simulates physical objects and lets people enforce the
rules. One server runs a single cannon-es world and syncs piece transforms to
every client over Colyseus; clients render and send intent, never physics.

## Quick start (Docker)

The fastest way to get a table up for your group. Docker Compose brings up the app **and** its
database together — the schema, the least-privilege DB role, and all future migrations are handled
for you.

```bash
git clone https://github.com/optimuspryne/open-tabletop.git
cd open-tabletop
cp .env.example .env        # set bootstrap admin username/email
mkdir -p secrets
openssl rand -base64 32 > secrets/db_owner_password.txt
openssl rand -base64 32 > secrets/app_db_password.txt
openssl rand -base64 32 > secrets/admin_password.txt
chmod 600 secrets/*.txt
docker compose up -d
```

Open **http://localhost:2567** (or your machine's LAN IP from another device) and sign in with the
bootstrap administrator configured above. Provisioning happens only against an empty users table;
restarts never reset its password. Two named volumes keep your data:
`db-data` (the database) and `assets` (uploaded decks/boards/props/skyboxes).

> **Don't want to build locally?** In `docker-compose.yml`, swap `build: .` for
> `image: optimuspryne/open-tabletop:0.10.0` to pull the published image instead. Upgrading later is
> `docker compose pull && docker compose up -d` — the app auto-applies any new migrations itself.
>
> **Playing beyond your LAN?** Put it behind a reverse proxy with TLS — see
> [Security & production posture](#security--production-posture).

Prefer to run it directly with Node, bring your own Postgres, or deploy through Portainer? Those
paths are below.

## Run via NPM

```bash
# Set up Postgres and Redis first — see "Database" and "Redis" below
git clone "https://github.com/optimuspryne/open-tabletop.git"
cd open-tabletop/
npm install
# Copy the .env.example file
cp .env.example .env
# Then set `DATABASE_URL` and `REDIS_URL` in .env.
# `npm start` auto-loads `.env`.
npm start
```

Open **http://localhost:2567** in two browser windows (or two devices on your
LAN → use your machine's IP) and move pieces around together.

## Database

Postgres now backs the saved-asset **library** (deck / board / prop / scene /
skybox metadata), **user accounts**, **rooms + membership**, and each room's
durable settings — scoreboard, notes, table size, skybox, felt color, and a
saved **game snapshot**. Live piece state and private hands are held in memory
*during a session*; they're persisted only through a snapshot — the GM's **Save
Table State**, or an auto-save when the room empties — written into the room's
`scene` column and rebuilt from it on load (see "Saving & resuming games"). One-time setup:

1. **Database + owner role** (as a superuser):
   `CREATE ROLE tabletop LOGIN PASSWORD '…';` then
   `CREATE DATABASE tabletop OWNER tabletop;`
2. **Least-privilege app role** (as a superuser): create `tabletop_app`, a
   CRUD-only role (no `CREATE`/`DROP`/`TRUNCATE`/`ALTER`) that the running
   server connects as. Grant it `SELECT/INSERT/UPDATE/DELETE` on the tables and
   `USAGE` on the sequences.
3. **Schema.** Two ways to do it:
   - **Let the app apply it (recommended).** Point **`MIGRATE_DATABASE_URL`** at the
     *owner* role (DDL-capable). On startup the server runs any pending
     `postgres/NNN_*.sql` migrations, tracked in a `schema_migrations` table — a blank
     database gets the whole schema built from `001` onward, an existing one gets only
     what's new, with **no manual step on upgrade**. The app's own `DATABASE_URL` stays
     the least-privilege `tabletop_app` role; DDL runs only through this separate owner
     URL, and only at boot. Works against stock Postgres or any managed instance.
   - **Or apply it by hand** (as the owner). Fresh install: `psql -U tabletop -d
     tabletop -f postgres/schema.sql` (the flattened current schema, which also
     seeds `schema_migrations`). Upgrade: apply the numbered migrations in order
     (`001_custom_assets.sql` → … → `011_user_sessions.sql`). Set **`AUTO_MIGRATE=false`**
     (or just leave `MIGRATE_DATABASE_URL` unset) to keep the app out of the schema.
     (The per-migration backfills matter on a populated DB but are no-ops on an empty
     one, so they're dropped from the baseline.)
4. **Point the app at it:** `cp .env.example .env`, set `DATABASE_URL` to the
   `tabletop_app` connection string (and `MIGRATE_DATABASE_URL` to the owner one for
   auto-migration). `npm start` auto-loads `.env`.
5. **Provision an administrator explicitly.** Set `BOOTSTRAP_ADMIN_USERNAME`,
   `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD_FILE` before the first
   start. Bootstrap runs only on an empty users table and never resets an existing
   administrator. To recover or promote an existing account, run
   `npm run admin:grant -- user@example.com`; use `admin:revoke` to remove access
   (the final administrator cannot be revoked).

Login credentials are separate, per-device sessions that expire after 30 days.
Set `SESSION_TTL_DAYS` to a whole number from 1–365 to change that lifetime.

Direct deployments normally use `DATABASE_URL` or `DATABASE_URL_FILE`. Docker Compose
uses non-secret host/name/user metadata plus `DATABASE_PASSWORD_FILE`; migration keys
use the same names with a `MIGRATE_` prefix. There's no hardcoded credential fallback,
so missing or partial config fails loudly at startup. For a remote DB, append `?sslmode=no-verify`
(encrypt only) or `?sslmode=verify-full` (verified — needs the CA) to the URL, and
turn on `ssl` server-side.

## Redis

Redis holds the shared token buckets for authentication and upload rate limits.
Set `REDIS_URL` (or `REDIS_URL_FILE`) for direct and clustered deployments. Production
startup fails if Redis is not configured, and protected requests fail closed with
`503` if it becomes unavailable. `RATE_LIMIT_STORE=memory` is an explicit local-only
fallback; its entries are periodically expired, but its limits are not shared between
processes. If TLS terminates at a reverse proxy, set `TRUST_PROXY_HOPS` to the exact
number of proxies between the client and this app; leaving it at `0` ignores forwarded
addresses.

## Run with Docker Compose

The repo ships a `Dockerfile` and `docker-compose.yml` that bring up the app, Postgres,
and an ephemeral Redis rate-limit store — including the two-role DB setup (owner +
least-privilege app role), applied automatically on first start.

```bash
git clone "https://github.com/optimuspryne/open-tabletop.git"
cd open-tabletop/
cp .env.example .env      # set bootstrap admin username/email
mkdir -p secrets
openssl rand -base64 32 > secrets/db_owner_password.txt
openssl rand -base64 32 > secrets/app_db_password.txt
openssl rand -base64 32 > secrets/admin_password.txt
chmod 600 secrets/*.txt
docker compose up -d      # builds the image, starts Postgres, then the app
```

Open **http://localhost:2567**. On the first run, Compose applies `postgres/schema.sql`
and creates the `tabletop_app` role via `docker/init-app-role.sh`. On later upgrades the
app **auto-applies any new migrations** itself at startup (via `MIGRATE_DATABASE_URL`),
so a `docker compose pull && up` is all it takes — no manual `psql` step. Two named
volumes persist state: `db-data` (the database) and `assets` (uploaded decks/boards/props/skyboxes).

The administrator named in `.env` is created from the mounted password secret only
when the users table is empty. Existing installations are left untouched. Recovery:
`docker compose exec app npm run admin:grant -- user@example.com`.

> **Upgrading an existing Compose install:** initialize
> `secrets/db_owner_password.txt` and `secrets/app_db_password.txt` with the
> **current** values of the old `DB_PASSWORD` and `APP_DB_PASSWORD` variables.
> `npm run secrets:migrate` performs that copy without printing either value and
> refuses to overwrite an existing secret.
> Existing Postgres volumes retain their role passwords; merely generating new
> secret values does not rotate them. After the secret-backed stack starts
> successfully, remove those two password entries from `.env`. Rotate them later
> only together with the corresponding PostgreSQL `ALTER ROLE` commands.

### Single container (bring your own Postgres)

If you already run Postgres (managed or otherwise), skip Compose and run just the
app image against it:

```bash
docker run -p 2567:2567 -v ott-assets:/data/assets \
  -e DATABASE_URL=postgresql://tabletop_app:…@dbhost:5432/tabletop \
  -e MIGRATE_DATABASE_URL=postgresql://tabletop:…@dbhost:5432/tabletop \
  optimuspryne/open-tabletop:0.10.0
# MIGRATE_DATABASE_URL (owner role) lets the app build/upgrade the schema itself;
# omit it (or set AUTO_MIGRATE=false) to apply postgres/*.sql by hand instead.
# For a remote DB, append `?sslmode=no-verify`
# (encrypt only) or `?sslmode=verify-full` (verified — needs the CA) to the URL, and
# turn on `ssl` server-side.
```

### Deploying via 'Stack' in Portainer

#### Web Editor ####

There's no custom database image — deploy against **stock `postgres`**. The app builds
and migrates its own schema on boot (via `MIGRATE_DATABASE_URL`), so the only one-time
setup is creating the least-privilege `tabletop_app` role. Since the web editor can't
mount local files, the stack below injects that role setup as an inline `config`. Set
`DB_PASSWORD` and `APP_DB_PASSWORD` in the stack's environment.

```yml
# Open Tabletop — app + stock Postgres (Portainer stack)
configs:
  app_role_init:                     # runs once on first DB init — creates the app role
    content: |
      CREATE ROLE tabletop_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO tabletop_app;
      GRANT USAGE, SELECT               ON ALL SEQUENCES IN SCHEMA public TO tabletop_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO tabletop_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public
        GRANT USAGE, SELECT               ON SEQUENCES TO tabletop_app;

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    container_name: open-tabletop-db
    environment:
      POSTGRES_USER: tabletop         # owner role — the app migrates the schema as this
      POSTGRES_DB: tabletop
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    configs:
      - source: app_role_init
        target: /docker-entrypoint-initdb.d/02-app-role.sql
    volumes:
      - ./db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tabletop -d tabletop"]
      interval: 5s
      timeout: 3s
      retries: 12

  app:
    image: optimuspryne/open-tabletop:0.11.0
    restart: unless-stopped
    container_name: open-tabletop-app
    depends_on:
      db:
        condition: service_healthy           # wait until the role is in place
    environment:
      DATABASE_URL: postgresql://tabletop_app:${APP_DB_PASSWORD}@db:5432/tabletop
      # Owner (DDL) role — the app builds & migrates the schema on boot (migrate.js).
      MIGRATE_DATABASE_URL: postgresql://tabletop:${DB_PASSWORD}@db:5432/tabletop
      ASSETS_DIR: /data/assets
      # PORT: 2567
    ports:
      - "2567:2567"
    volumes:
      - ./assets:/data/assets                  # uploaded decks/boards/props/skyboxes
```

On first boot the db creates `tabletop_app` from the inline config, and the app builds the
full schema via `MIGRATE_DATABASE_URL` (adopting an existing schema if you're pointing at
an old volume). The `assets` volume holds uploaded **files**; library **metadata** lives in
Postgres.

**Older Portainer/Compose without inline-`config` support?** Drop the `configs:` block and
the `db.configs:` entry, bring the stack up, then create the role once by hand:

```bash
docker exec -i open-tabletop-db psql -U tabletop -d tabletop <<'SQL'
CREATE ROLE tabletop_app LOGIN PASSWORD 'your-APP_DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO tabletop_app;
GRANT USAGE, SELECT               ON ALL SEQUENCES IN SCHEMA public TO tabletop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tabletop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tabletop_app;
SQL
docker restart open-tabletop-app
```

## Testing

```bash
npm test                  # fast unit/harness suite; no services required
npm run test:integration  # disposable PostgreSQL 16 integration suite
npm run check             # lint, formatting, and fast tests
```

`test:integration` starts a randomly named PostgreSQL container on a random local
port, applies the production schema and least-privilege app grants, runs the real
database tests, then removes the container and its storage. Docker is required;
Docker Compose is not. The runner refuses any database whose name does not end in
`_test`.

CI runs the same integration tests against its own PostgreSQL 16 service.

## What's in the box

- **Dice**
  * d4–d20 (the `☰ 🎲 Add Dice` or `🧱 Browse Built-Ins` menus).
  * One `die` kind parameterized by `props.sides`.
  * D6 is a numbered box, the rest are numbered convex polyhedra whose mesh (client) and collider (server) come from one vertex list.
  * Dice get **independent body and number colors**.
- **Props/Objects**
  * Built-In Objects (`🧱 Browse Built-Ins` menu):
  * Built-in basic shapes: box, pyramid, sphere, cuboid, cone, cylinder, truncated cone, hex prism, triangle prism, hex pyramid, checker, crowned checker, go stone (flattened sphere).
  * Built-in `.glb` files: coin, poker chip, token, chess pieces.
  * Custom `.glb` objects (`📚 Browse Custom Library` menu). Curated in the **Editor library**(admin accounts only)
- **Cards, decks & hidden hands** - Face-down stacks, private hands.
  * Built-in **standard 52-** and **54-card (with jokers)** decks (`🧱 Browse Built-Ins` menu).
  * Custom decks, image based or text based (`📚 Browse Custom Library` menu), curated in the **Editor library** (admin accounts only).
  * Image decks can **fit their art** (no crop/stretch) and choose a **shape** (rounded, square, or hexagon) and **thickness**.
  * **Left-click** a deck to draw its top card to your hand, **left-drag** to deal to the table, **right-click** to shuffle, **double-click** to peek (draw-to-inspect).
- **Tile games** — the same card system also drives *tiles* (a card with its own footprint, thickness, and shape). One-click **Games** (`🧱 Browse Built-Ins` → Games):
  * **Dominoes** (a double-six boneyard, dealt 7 to a hand), **Wordy McWordface** (a legally-distinct word game on a 15×15 premium board — played tiles snap to cells), and **Mahjong** (the full 144-tile wall, dealt 13 to a hand).
  * Their draw piles wear a **bentwood box** — a deck can take a 3D model *skin* while still working as a normal draw pile.
- **Boards** (`🧱 Browse Built-Ins` menu).
  * Two built-in `.glb` boards (Chess/Checkers and Go), plus **procedural boards** drawn from data (the Wordy McWordface premium grid).
  * Custom `.glb` or flat image boards (`📚 Browse Custom Library` menu), curated in the **Editor library** (admin accounts only)
- **`🖊️ Whiteboard`** A shared tilt-up **whiteboard** to sketch on.
  * Only one drawer at a time.  Marker color matches assigned player color.
  * Visibility, style, and location is GM controlled.
- **`🌄Skyboxes`** - Equirect or CubeMap backgrounds.
  * GM Controlled
  * Built-in Skyboxes (`🧱 Browse Built-Ins` menu).
  * Custom Skyboxes (`📚 Browse Custom Library` menu), curated in the **Editor library** (admin accounts only).
- **Seats, presence & turns**
  * A seat per player, standing name/avatar markers.
  * Automatically assigned color.
  * Turn indicator, turn can be advanced using the 'Next Turn' button.
  * On a **resumed game**, a turn whose owner hasn't rejoined yet shows as
    **"⏳ Waiting on {name}"** until they return or a GM advances the turn.
- **Live Table 'Tools'** - Look for the **'Tools'** menu on the right, collapsible.
  * **`📝 Private Notes`** A private, per-player ephemeral.
  * **`💬 Chat`** A public room chat, ephemeral.
  * **`📊 Scoreboard`** A shared scoreboard + GM room notes.
  * **`⏱️ Timer`** A shared clock, stopwatch or countdown.
  * **`🖊️ Whiteboard`** See the above section.
  * **`❔ How to Play`** A full list of controls, changes based on player role (player, helper, GM).
  * **`🔊 Sound`** Volume and music controls, private, per-player.  Controls sound effects and music volume levels separetely (or 'mute').  Music tracks (Provided by: [Kevin MacLeod, CC BY 4.0](https://incompetech.com/)) can be picked individually, played in alphabetical order, or shuffled. 
- **Player 'Interactions'** - Look for the **Interactions** menu on the left, collapsible.
  * `🔎 Lean In` zooms the camera view in slightly, to simulate 'leaning over the table'.
  * `↩ My Seat` snaps the camera back to the players assigned seat.
  * `🔄 Roll Dice` rolls all dice on the table.
  * `🃏 Show Hand` press **hold-to-show** to show cards to chosen players or the whole table. Revealed face-up in your seat fan with a public "SHOWING n" badge on your player card.
  * `🂠 Drop Hand` drop your entire hand on the table (face-up or face-down).
  * **Name tags** appear over pieces others are holding.
  * There is also an **attention ping** (middle-mouse-click / **P**) that pulses a colored ring at a spot.
- **Accounts Types**
  * 'Quick Join' Users: Enter a display name, an email, and a room code to quickly join — no sign-up needed to play. (The email is currently just a unique identifier; it doesn't have to be valid yet.) Rooms by default still require GM approval for entry.
  * GM Accounts:  Create an account with a password, then request 'host access' on your lobby view. An Admin needs to grant approval before you can host.  Once approved you can create rooms, spawn all public assets, promote/demote players, approve new entries, load scenes, change the skybox, save the table state and kick players from your rooms.
  * Admin Accounts: Only another Admin can promote a GM account to 'Admin' status.  Admins have full control: they can close and purge any room.  Kick any player from all active tables.  Delete any account, scan for orphaned assets to move to the trash. Demote and promote accounts.  Most importantly only Admins can add or delete items from the `📚 Custom Library` using the `📚 Library Editor`.
- **Room Roles**
  * Player: Can interact with objects/cards/decks on the table.  Can use all 'Interactions' and limited use of 'Tools'.
  * GM (Owner): Has full control of any rooms they create.
  * GM (Promoted): Can perform all GM functions, except: closing a room
  * Admin: Admins are default owners and GMs of any rooms.  They can close or delete any room. They can kick anyone, including GMs and Owners.
- **Curated Custom Library** - While logged in as an Admin at the 'lobby' page, click `⚙️ Admin` --> `📚 Library Editor`.  Here you can manage all of your custom assets.  All custom assets by default are set as 'private'.  Admins must 'publish' them before GMs can spawn them.
  * Upload custom objects as `.glb` files.  Scale, collider-shape and orientation can be set before upload.
  * Upload custom decks.  Image decks take a single 'back image' and numerous 'face images', colors can be fully customized.  You can enter an optional 'back text', and fronts take a list of 'front texts': one per-line, comma-separated or JSON format.  A .csv or .txt file can also be uploaded.
  * Upload custom boards.  Boards can either be `.glb` files (they will be automatically scaled), or a 2D image can be uploaded, with dimensions specified to create a custom 'image board'.
  * Upload custom skyboxes. You can upload panoramic or cubemap skyboxes.
  * Scenes: set up a table the way you like, then save it as a **scene** — a
    portable *template* (table size + pieces + deck order + face-down faces, but
    **no players, hands, or turn**) that loads onto any table. Resuming an
    in-progress game *with* its hands and turn is a separate, per-room mechanism —
    see "Saving & resuming games".

## Files

```
CHANGELOG.md         release notes (Keep a Changelog)
RELEASING.md         versioning + release process
server.js            Colyseus rooms + authoritative cannon-es physics + HTTP (auth/rooms/admin) + Postgres
db.js                Postgres pool + all queries (library, users, rooms, membership)
migrate.js           startup schema migrator (applies pending migrations, tracked in schema_migrations)
auth.js              password hashing (scrypt) + device-token hashing (no deps)
shared/pieces.js     piece specs (mass, colliders, palettes, dice verts, prop/board registries) + timerLive
postgres/            SQL migrations 001–010 + schema.sql (fresh-install baseline) + grants_app_role.sql
docs/                ARCHITECTURE.md, REFERENCE.md, ASSET_CREDITS.md
Dockerfile           app image build (node:22-alpine, npm ci --omit=dev)
docker-compose.yml   app + stock Postgres stack (reads .env for the two DB passwords)
docker/              init-app-role.sh (creates the least-priv app role on first DB start)
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
  audio.js           Web Audio SFX engine + HTML5 background-music player
  credits.js         music playlist + attribution manifest (SFX / music / libs)
  models/            bundled CC0 .glb assets (chess, checkers, go, misc, boards)
  sounds/            built-in sound effects (see "Sound effects" below)
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

## Saving & resuming games

There are two distinct kinds of "save," on purpose:

- A **scene** is a portable *template* — table size + pieces + deck order +
  face-down faces, and **nothing about players**. It's admin-curated in the editor
  library and loads onto *any* table (see "The asset library").
- A **game snapshot** is a scene *plus* the live private layer — each player's
  **hand** and whose **turn** it is — saved **per room** so a game in progress can
  be put down and picked back up. A **GM** writes one with **Save Table State**,
  and the server also **auto-saves** as the last player leaves and the room is
  about to dispose, so progress survives an empty room even if nobody clicked save.
  The snapshot lives in that room's `scene` column and is rebuilt on the next load.

Hands and the turn are keyed to **accounts**, not to the ephemeral session id, so
they rebind cleanly on return:

- A returning player automatically **reclaims their own hand** (and the turn, if
  it was theirs) on rejoin — matched by account, not by seat.
- A hand whose owner hasn't come back is held as **unclaimed**. The GM sees an
  **Unclaimed hands** list at the top of the **Members** panel and can hand each
  one to any present player from a **"Give to…"** picker.
- A turn left with an absent player shows in the turn panel as **"⏳ Waiting on
  {name}"** until that player rejoins or a GM presses **Next Turn**.

The privacy invariant holds across the whole cycle: deck order, face-down faces,
and hands are stored in the snapshot but **never enter broadcast state** — on load
they're rebuilt into server-only memory and each hand is sent privately to its
owner, exactly as in a live session.

## Custom decks & card art

Card faces are texture *references*: `rank:A:♠:#000` (procedural), `text:…`
(procedural text card), `tback:…` (colored back), a `data:`/URL image, or a
procedural tile face (`domino:a:b`, `letter:A:1`, or a bundled mahjong image). The
**+ Deck** dialog builds a deck from text (one per line / comma / JSON) or
uploaded images, with a **"Save this deck as…"** field to persist it on creation.
There's also a "Spawn Built-in Deck" for a standard 52.

An image deck can turn on **Fit to image** to size its cards to the uploaded art's
aspect (no crop/stretch), and then set the card **thickness** and **shape**
(rounded / square / hexagon). All of this is a single `props.geom` on the deck —
the same variable-geometry system tiles use — read by both the mesh and the
collider (see [ARCHITECTURE.md](docs/ARCHITECTURE.md)). A deck can also carry a
`deckModel` skin (a bag/box `.glb`) via the `DECK_MODELS` registry.

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

## Sound effects

Built-in sound effects live in `public/sounds/`. `*-drop` clips fire on the real
**physics impact** — the moment a piece lands on the table, not when you let go —
and everyone at the table hears the landing; `*-pickup` clips are local (only you
hear yourself grab something). Per-player effect/music volume and mute live under
the **🔊 Sound** tool.

Each action maps to a **list** of clips in the `SOUNDS` map in `public/audio.js`,
and one is picked at random each time it plays — drop several files in and name them
however you like (e.g. `die-roll-1.ogg`, `die-roll-2.ogg`); only the array decides
what's used. A bare string works too, and missing files are skipped silently, so the
app runs fine before you add any audio.

| action        | plays when                                                   | who hears it |
|---------------|--------------------------------------------------------------|--------------|
| die-roll      | one die rolls                                                | everyone     |
| dice-roll     | multiple dice roll                                           | everyone     |
| card-flip     | a card is flipped                                            | everyone     |
| card-pickup   | grab a card, deal-drag off a deck, or take one to hand       | you          |
| card-drop     | a dealt/played card lands, or one you dropped hits the table | everyone     |
| tile-pickup   | grab/draw a tile (domino, word tile, mahjong)               | you          |
| tile-drop     | a tile lands (dealt, played, or dropped)                    | everyone     |
| shuffle       | a deck is shuffled                                           | everyone     |
| die-pickup    | you grab a die                                               | you          |
| die-drop      | a die you dropped hits the table                            | everyone     |
| deck-pickup   | you grab a deck                                              | you          |
| deck-drop     | a deck you dropped hits the table                           | everyone     |
| tiledeck-pickup | you grab a tile deck (its wooden box)                     | you          |
| tiledeck-drop | a tile deck (box) you dropped hits the table                | everyone     |
| object-pickup | you grab a prop or board                                     | you          |
| object-drop   | a prop or board you dropped hits the table                  | everyone     |
| hand-drop     | you dump your whole hand to the table                       | everyone     |

Background music is a separate HTML5 player (playlist + credits from `credits.js`).
Bundled SFX should be CC0 (freesound.org's CC0 filter, kenney.nl) so they carry no
attribution burden; the music (Kevin MacLeod, CC BY 4.0) is credited in-app in the
**🔊 Sound** panel.

## Accounts, rooms & roles

Two kinds of account: a **player** (passwordless — a display name and an email (a unique id, not necessarily valid) plus a device
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
  (admit / kick / promote — and **reassign an unclaimed hand** from a resumed
  game) from the in-table Members panel.
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
stripping, image magic bytes), Redis-backed per-IP rate limits shared across app
replicas for uploads and auth, a per-user
cross-room **live kick**, a socket **push** for the "you're admitted" signal (with a
slow poll fallback), account **avatar uploads**, and an enforced **Content-Security-
Policy** — `script-src 'self'`, no `unsafe-*`, with Three and Colyseus self-hosted
under `public/vendor/` (no CDN). The first administrator is explicitly provisioned
from a password file before the public listener opens; ordinary signup never grants admin.
Remaining optional hardening (post-parse model complexity limits and per-user storage
caps) is noted in
`docs/ARCHITECTURE.md`.

## Notes

- `defineTypes()` (build-step-free schema) is deprecated but works in 0.17.
- No client build step: Three.js (via import map) and the Colyseus SDK are both
  self-hosted under `public/vendor/` — no third-party CDN fetches at runtime.
- Releases follow SemVer; see `CHANGELOG.md` for changes and `RELEASING.md` for
  how a release is cut.
