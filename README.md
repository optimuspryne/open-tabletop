<p align="center">
  <a href="https://open-tabletop.com" target="_blank">
    <img src="/public/logo-wordmark.svg" width="256">
  </a>
</p>

# Open Tabletop

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
> `image: optimuspryne/open-tabletop:0.12.2` to pull the published image instead. Upgrading later is
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
docker run --name open-tabletop-app -p 2567:2567 -v ott-assets:/data/assets \
  -e DATABASE_URL=postgresql://tabletop_app:…@dbhost:5432/tabletop \
  -e MIGRATE_DATABASE_URL=postgresql://tabletop:…@dbhost:5432/tabletop \
  -e REDIS_URL=redis://redis-host:6379 \
  optimuspryne/open-tabletop:0.12.2
# MIGRATE_DATABASE_URL (owner role) lets the app build/upgrade the schema itself;
# omit it (or set AUTO_MIGRATE=false) to apply postgres/*.sql by hand instead.
# For a remote DB, append `?sslmode=no-verify`
# (encrypt only) or `?sslmode=verify-full` (verified — needs the CA) to the URL, and
# turn on `ssl` server-side.
```
Open **http://localhost:2567**, create an account, then explicitly promote it to
administrator status:

```bash
docker exec open-tabletop-app npm run admin:grant -- your@email.example
```
Once an admin account has been created, it can be used to promote other accounts to admin status.

### Deploying via 'Stack' in Portainer

#### Web Editor ####

There's no custom database image — deploy against **stock `postgres`**. The app builds
and migrates its own schema on boot (via `MIGRATE_DATABASE_URL`). Database setup requires
the least-privilege `tabletop_app` role; administrator provisioning is described after
the stack. Since the web editor can't
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

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 12

  app:
    image: optimuspryne/open-tabletop:0.12.2
    restart: unless-stopped
    container_name: open-tabletop-app
    depends_on:
      db:
        condition: service_healthy           # wait until the role is in place
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://tabletop_app:${APP_DB_PASSWORD}@db:5432/tabletop
      # Owner (DDL) role — the app builds & migrates the schema on boot (migrate.js).
      MIGRATE_DATABASE_URL: postgresql://tabletop:${DB_PASSWORD}@db:5432/tabletop
      ASSETS_DIR: /data/assets
      REDIS_URL: redis://redis:6379
      # PORT: 2567
    ports:
      - "2567:2567"
    volumes:
      - ./assets:/data/assets                  # uploaded decks/boards/props/skyboxes
```
Open **http://localhost:2567**, create an account, then explicitly promote it to
administrator status:

```bash
docker exec open-tabletop-app npm run admin:grant -- your@email.example
```
Once an admin account has been created, it can be used to promote other accounts to admin status.

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

- **Authoritative shared table.** The server simulates every movable object with
  cannon-es and synchronizes transforms through Colyseus. Players can grab, throw,
  flip, rotate, recolor, keep upright, snap to a square/hex grid, and batch-operate
  a local multi-selection without exposing physics authority to the browser.
- **Dice and personal trays.** Numbered d4, d6, d8, d10, d12, and d20 share their
  mesh/collider geometry. Body and number colors are independent. Each seat can
  open a private-positioned tray, stock dice into it, roll or re-rack only that
  seat's dice, and clear it.
- **Props and dispensers.** Built-ins include primitive solids, checkers, Go
  stones, coins, poker chips, a generic token, and a complete modeled chess set.
  Finite chip/coin stacks dispense matching pieces and shrink; Go bowls dispense
  unlimited team-colored stones. Compatible pieces dropped back onto a dispenser
  are absorbed. Custom `.glb` props support scale, orientation, collider choice,
  standing behavior, and material tinting.
- **Cards, decks, hands, and tiles.** Standard decks support optional jokers,
  private hands, face-down cards, shuffle/split, draw-to-hand, deal-and-drag,
  draw-to-inspect, hold-to-show, and whole-hand drops. The same hidden-information
  system powers dominoes, letter tiles, mahjong, custom card geometry, and deck
  skins such as the bentwood box. See the detailed section below.
- **Boards, grids, and measurement.** Built-in modeled Chess/Checkers and Go
  boards plus the procedural Wordy board can calibrate the room grid. GMs control
  cell size, offsets, snap anchor, square/hex style, visibility, color, height,
  measurement units, and rounding. Players can place durable rulers, lines,
  circles, and cones; a live preview is shown while positioning them.
- **Seven one-click games.** Chess, Checkers, Go, Dominoes, Wordy McWordface,
  Mahjong, and Poker Night set up their board, pieces, deck, starting hands,
  bowls, or chip stacks as appropriate.
- **Room presentation and collaboration.** Resizable/recolorable felt, built-in
  or custom equirectangular/cubemap skyboxes, seated name/avatar markers, turn
  tracking, attention pings, a shared timer, scoreboard and GM notes, public chat,
  private notebooks, and a tilt-up single-drawer whiteboard.
- **Per-player controls.** Return to seat, Lean In, dice-tray controls, show/drop
  hand, role-aware help, and separate local SFX/music volume, mute, shuffle, and
  track selection. Held pieces show the holder's name; touch has long-press menus
  for the same common actions available to mouse users.
- **Accounts, rooms, and recovery.** Passwordless quick-join players and approved
  password hosts use persistent device sessions. Per-room roles, optional join
  approval with live admit/decline notification, reconnect support, durable room
  settings, explicit checkpoints, and auto-saved game snapshots keep play resumable.
- **Admin-curated library.** Admins create, test, publish, rename, and delete
  private/public decks, boards, props, scenes, and skyboxes in the live workshop.
  Asset metadata lives in Postgres, uploaded files live under `ASSETS_DIR`, and
  orphan cleanup moves unreferenced files to a recoverable trash directory.

## Files

```
server.js              composition root: Colyseus rooms, simulation, remaining handlers, HTTP/security
db.js                  production Postgres pool composed from server/database.js
auth.js                password hashing (scrypt) and device-token helpers
migrate.js             owner-role startup migration runner
package.json           runtime dependencies and npm scripts
.env.example           direct-run and Compose configuration examples

server/
  physics.js           Cannon world setup and collider construction
  database.js          injected library, user, room, membership, and state queries
  *-queries.js         focused library/user/room read-query modules
  *-config.js          database, Redis, and session configuration
  permissions.js       room-role ranking and authorization helpers
  message-validation.js socket payload normalizers and bounds
  rate-limit.js        Redis/memory token buckets and HTTP middleware
  bootstrap-admin.js   first-boot administrator provisioning
  assets/              image and self-contained GLB upload validation
  game/
    handlers/          movement, pieces, cards, library, rooms, overlays, and members
    scene-persistence.js portable scene/game serialization and restoration
    safe-message.js    Colyseus message and lifecycle error boundaries
    props-codec.js     canonical synced-piece props encoding
  http/
    routes/            auth, rooms/profile/host, admin, and upload routers
    async-route.js     async Express error boundary
    auth-context.js    Bearer-user and administrator guards

shared/pieces.js       shared piece physics/render data, registries, geometry, grids, and trays
postgres/              migrations 001–011, flattened schema, and app-role grants
scripts/               admin roles, icon generation, secret migration, DB integration runner
test/                  unit/harness tests plus PostgreSQL integration tests
docs/                  architecture, code reference, credits, release, and design notes
docker/                first-start least-privilege Postgres role setup
Dockerfile             production Node 22 image
docker-compose.yml     app + Postgres + Redis with Docker secret files

public/
  index.html/landing.js lobby, authentication, room list, and host requests
  table.html/client.js  table shell and runtime networking/interaction/render loop
  editor.html           compatibility redirect to table.html?workshop=1
  editor-panel.js       library workshop: create, curate, preview, and spawn assets
  admin.html/admin.js   site administration UI
  core.js               Three.js scene/camera/renderer plus CONFIG and LIGHTING
  graphics.js           textures, meshes, model loading, and the KIND registry
  controls.js           mouse/touch profiles converted to device-neutral intents
  audio.js/credits.js   local SFX/music playback and attribution manifests
  icons.js/equalize.js  shared icon behavior and early UI preference restoration
  styles.css            shared design tokens, components, and page layouts
  vendor/               self-hosted Three.js and Colyseus browser libraries
  models/, sounds/      bundled models and sound effects
```

The main game-client chain is `shared ← core ← graphics ← client`, with
`client` also importing `controls` and `audio ← credits`. `table.html` loads
`client.js` and `editor-panel.js`; `editor.html` redirects to its `?workshop=1` mode.
The landing and admin pages
are standalone (`landing.js` / `admin.js`, plain `fetch` to the HTTP API).
Nothing is bundled or transpiled — Three.js (via an import map) and Colyseus are self-hosted under `public/vendor/`, so there are no third-party CDN fetches at runtime. That's also what makes the enforced `script-src 'self'` Content-Security-Policy possible.

## Tuning knobs (edit and reload)

- **`SIM`** in `server.js` — simulation feel: gravity, damping, card-stack stability
  (`SIM.cards.colliderThick` is the main dial), solver iterations, timestep,
  throw/roll behavior, collision sounds, spawn/bounds behavior, self-righting,
  and the live-piece cap. Piece dimensions and collider construction themselves
  live in `shared/pieces.js` and `server/physics.js`.
- **`CONFIG`** in `public/core.js` — client feel: grab/scroll height, model
  normalization size, render delay, input thresholds, inspect zoom, drop-marker
  and measurement-overlay appearance, spawn/upload ranges, texture resolutions,
  and shuffle animation.
- **`LIGHTING`** in `public/core.js` — hemisphere fill, sun, environment-map
  strength (three numbers).
- **Server limits** in `server.js` — `TABLE_LIMIT` (resizable-table bounds),
  `SCENE_MAX_BYTES` (snapshot-size guard), `GRID_LIFT_MAX` (maximum grid height),
  `OVERLAY_MAX` / `OVERLAY_MAX_PER_PLAYER` (placed-template caps), and
  `ORPHAN_MIN_AGE_MS` (cleanup age guard).
- **Whiteboard** — `WHITEBOARD_RES` and `WB` in `public/client.js` control canvas
  resolution and physical size/placement. `WHITEBOARD_MAX_STROKES` exists in both
  `server.js` and `public/client.js`; keep the two values equal so server history
  and the client's replay mirror have the same cap.
- **Input and cameras** in `public/client.js` — `LEAN_AMOUNT` controls the Lean In
  offset, `HAND_HOVER` the whole-hand drop preview height, `VIEW` the normal seat
  camera, and `TRAY_CAM` the dice-tray camera and transition. In
  `public/controls.js`, `LONG_PRESS_MS` / `LONG_PRESS_SLOP` control touch
  long-press timing and movement tolerance; keep the slop aligned with
  `CONFIG.input.dragPx`.
- **Rendering** — `SHADOW_MARGIN` in `public/core.js` pads the directional-light
  shadow camera around the live table.

## Add a piece variant or kind

The small path is a new **variant of an existing kind**. Add data to the relevant
registry in `shared/pieces.js` (`PROPS`, `BOARDS`, `DISPENSERS`, deck/tile data,
and so on), add any required mesh or painter support in `public/graphics.js`, and
expose it through the built-in or library UI. Existing spawning, synchronization,
movement, and scene persistence can then reuse that kind's established behavior.

A genuinely new synced **kind** touches more seams:

1. Add its mass/shape descriptor to `KINDS` in `shared/pieces.js` and its mesh plus
   interaction verbs to the client `KIND` registry in `public/graphics.js`.
2. Extend `spawnPayload` in `server/message-validation.js` with an exact,
   bounded props schema; unknown kinds are rejected rather than passed through.
3. Add collider construction in `server/physics.js` when the generic boxed-shape
   fallback is not sufficient.
4. Add a spawn/library UI path and any new socket handlers, including payload
   validation and the appropriate role checks.
5. Update client lifecycle behavior where needed: props/count-driven mesh rebuilds,
   inspection, touch menus, selection actions, labels, and special interactions.
6. Extend scene serialization/restoration if the kind carries hidden, ordered, or
   otherwise specialized server-only state. Plain public props already round-trip.
7. Add tests for spawn validation, mesh/collider geometry, authorization and custom
   handlers, plus scene round-tripping.

Generic movement and transform synchronization are reusable, but kind-specific
behavior is intentionally explicit at the trust, physics, UI, and persistence
boundaries.

## Decks, hidden hands & the privacy invariant

The public deck piece contains its back, geometry/skin, and card count; its ordered
fronts remain in the server-only `deckCards` map. The visible stack and collider
shrink with that public count, but clients cannot inspect the remaining order.

- **Deck actions:** left-click draws the top card directly to your private hand;
  left-drag deals it face-down and adopts it into the drag; right-drag moves the
  deck; right-click shuffles; double-click draws privately into inspect. The touch
  menu exposes draw, shuffle, split, move, inspect, and save actions. A loose card
  released onto a deck is absorbed into that deck.
- **Table cards:** a face-down card publishes only its back and geometry. Its front
  stays in `cardData` until the card is flipped or taken. Left-click takes a card
  to hand and right-click flips it; group actions can flip or take a selection.
- **Private hands:** only the owner receives the `hand` message containing card
  fronts. Other players see the public count and chosen hand-back image. Cards can
  be played face-up or face-down individually, the whole hand can be dropped around
  a chosen point, and hold-to-show sends selected cards only to the chosen audience
  while publishing merely a `SHOWING n` badge.
- **Tiles and custom geometry:** dominoes, letter tiles, mahjong, and custom-shaped
  image cards are still the `card` kind. Public geometry follows a card through
  deck → hand → table while its face remains private, so thickness, aspect,
  square/rounded/hex shape, and snap behavior survive every transition. A deck's
  optional 3D skin remains with the deck and round-trips through scene snapshots.
- **Persistence and reconnects:** a saved game stores hands and turns by stable
  account ID. Returning players reclaim them automatically; absent owners appear
  as unclaimed hands that a GM can reassign. A reconnect explicitly requests the
  private hand again because it is not part of synchronized room state.

The invariant is unchanged: **if it is synchronized, treat it as public; secrets
remain server-only and are sent directly only to their intended player or audience.**
That includes deck order, face-down fronts, hands, inspect draws, active show
audiences, and pending hands restored from a snapshot.

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
