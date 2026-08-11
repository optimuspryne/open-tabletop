# Open Tabletop — Multiplayer (Colyseus)

An authoritative-physics virtual tabletop where *any* game can be played,
because the engine only simulates physical objects and lets people enforce the
rules. One server runs a single cannon-es world and syncs piece transforms to
every client over Colyseus; clients render and send intent, never physics.

## Run

```bash
npm install
# set up Postgres and DATABASE_URL first — see "Database" below
npm start
```

Open **http://localhost:2567** in two browser windows (or two devices on your
LAN → use your machine's IP) and move pieces around together.

## Database

The saved-asset **library** (custom decks/boards/props *metadata*) lives in
Postgres; live game state and hands are still all in-memory. One-time setup:

1. **Database + owner role** (as a superuser):
   `CREATE ROLE tabletop LOGIN PASSWORD '…';` then
   `CREATE DATABASE tabletop OWNER tabletop;`
2. **Migration** (as the owner): `psql -U tabletop -d tabletop -f 001_custom_assets.sql`
3. **Least-privilege app role** (as a superuser):
   `psql -U postgres -d tabletop -f grants_app_role.sql` — creates `tabletop_app`,
   a CRUD-only role (no `CREATE`/`DROP`/`TRUNCATE`/`ALTER`) that the running server uses.
4. **Point the app at it:** `cp .env.example .env`, set `DATABASE_URL` to the
   `tabletop_app` connection string. `npm start` auto-loads `.env`.
5. **(Optional) import an old disk library:** run once as the *owner* role —
   `node --env-file=.env import-assets.js`.

Config comes from `DATABASE_URL`, or `DATABASE_URL_FILE` (a path to a file holding
it — the Docker-secrets pattern, taking priority). There's no hardcoded fallback, so
a missing config fails loudly at startup. For a remote DB, append `?sslmode=no-verify`
(encrypt only) or `?sslmode=verify-full` (verified — needs the CA) to the URL, and
turn on `ssl` server-side.

## What's in the box

- **Dice** d4–d20 (`↻ Dice` / the `☰ + Dice` menu). One `die` kind parameterized
  by `props.sides`; d6 is a pipped box, the rest are numbered convex polyhedra
  whose mesh (client) and collider (server) come from one vertex list.
- **Props** (`+ Object`): built-in shapes (box, sphere, cone, pyramid, checker,
  go stone, coin, chip, token, chess set) and **custom `.glb` uploads**. Every
  prop has a **Scale**; models can be **tinted** (whole, one material slot, or
  left as-is) and **saved** for one-click re-spawn.
- **Cards, decks & hidden hands** — face-down stacks, private hands, custom
  decks from text or images, save/edit/clone. See below.
- **Boards** (`↷ Board`): two built-in `.glb` boards (Chess/Checkers, Go),
  **custom `.glb` board upload**, or a plain sized flat board.
- **Inspect** — double-click a piece to enlarge & rotate it; double-click a deck
  to privately **draw a card into inspect**, then send it to the field or hand.
- **Seats, presence & turns** — a seat per player, standing name/avatar markers,
  a turn indicator, private hand bar.
- **Live table tools** — a shared **timer** (⏱, stopwatch or countdown), a private
  per-player **notebook** (✎, ephemeral), **hold-to-show** cards to chosen players
  or the whole table (🃏, revealed face-up in your seat fan with a public "SHOWING
  n" badge), floating **name tags** over pieces others are holding, and an
  **attention ping** (middle-click / **P**) that pulses a colored ring at a spot.

## Files

```
server.js            Colyseus room + authoritative cannon-es physics + HTTP + Postgres library
db.js                Postgres pool + saved-library queries (deck/board/prop metadata)
import-assets.js     one-time: import existing saved-assets/*.json metadata into Postgres
shared/pieces.js     piece specs (mass, colliders, palettes, dice verts, prop/board registries) + timerLive
public/
  index.html         page shell: importmap + <link>/<script> to the files below
  styles.css         all UI styling (design-token :root block)
  core.js            scene/camera/renderer/controls + the CONFIG and LIGHTING tunables
  graphics.js        every texture & mesh builder, model loading, the KIND registry
  client.js          the runtime: networking, interaction, seats, render loop
  models/            bundled CC0 .glb assets (chess, checkers, go, misc, boards)
```

The client is split into a **linear import chain**: `shared ← core ← graphics ←
client`. `index.html` loads `client.js`; its `import`s pull in the rest. Nothing
is bundled — Three.js comes from a CDN import map, Colyseus from unpkg.

## Tuning knobs (edit and reload)

- **`SIM`** in `server.js` — all physics: gravity, damping, card-stack stability
  (`SIM.cards.colliderThick` is the main dial), solver iterations, timestep,
  throw caps, self-righting.
- **`CONFIG`** in `public/core.js` — client feel: grab/scroll height, model
  normalization size, render delay, input thresholds, inspect zoom, drop-marker
  look, spawn-input ranges, texture resolutions.
- **`LIGHTING`** in `public/core.js` — hemisphere fill, sun, environment-map
  strength (three numbers).

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

## Saving, editing & cloning (shared library)

- **Decks** save on creation (name field) or via **S** on a hovered deck. **Edit**
  a saved deck to swap its back image or append cards; **Save** overwrites,
  **Save as copy** clones.
- **Custom model props** save from the Custom-model dialog; **Edit** a saved prop
  to change scale/tint/stands, then **Save** or **Save as copy**.
- **Boards** save/load from the Board dialog (built-in, uploaded `.glb`, or flat).

The library is global (every room sees it). **Metadata lives in Postgres**
(`custom_decks` / `custom_boards` / `custom_objects`), keyed by a row **id**;
uploaded **image and model files stay on disk** under `ASSETS_DIR` and are served
from `/assets`. Uploaded images are **POSTed to `/upload`** (not sent over the
socket); `.glb` models to **`/upload-model`**. Files get random names, so
unrevealed fronts stay hidden.

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
`shared/pieces.js`. See `ASSET_CREDITS.md` for bundled-asset licensing (all CC0).

## Docker

```bash
docker build -t tabletop .
docker run -p 2567:2567 -v tabletop-assets:/data/assets \
  -e DATABASE_URL=postgresql://tabletop_app:…@dbhost:5432/tabletop tabletop
```

The `-v` mounts a named volume for the uploaded image/model **files** so they
survive restarts; the library **metadata** lives in your Postgres. Pass the
connection via `DATABASE_URL`, or `DATABASE_URL_FILE` pointing at a mounted
secret. Live game state and hands are in-memory by design; new rooms start empty.

## Roadmap (not yet built)

A **role/auth + lobby layer** (Admin → Game Master → Helper → Player), with
Postgres-backed **accounts and room metadata** (asset metadata already landed —
see Database; the `owner_id` columns are in place, nullable until users exist),
unlocking GM-only variants of the table tools. Plus a stateless hardening pass
(glTF validation, upload caps/rate limits, external-URI stripping, security
headers) and admin-only uploads. See the security notes in `ARCHITECTURE.md`.

## Notes

- `defineTypes()` (build-step-free schema) is deprecated but works in 0.17.
- No client build step: Three.js via import map, Colyseus SDK via unpkg.
