# Open Tabletop — Multiplayer (Colyseus)

An authoritative-physics virtual tabletop where *any* game can be played,
because the engine only simulates physical objects and lets people enforce the
rules. One server runs a single cannon-es world and syncs piece transforms to
every client over Colyseus; clients render and send intent, never physics.

## Run

```bash
npm install
npm start
```

Open **http://localhost:2567** in two browser windows (or two devices on your
LAN → use your machine's IP) and move pieces around together.

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

## Files

```
server.js            Colyseus room + authoritative cannon-es physics + HTTP + disk library
shared/pieces.js     piece specs (mass, colliders, palettes, dice verts, prop/board registries)
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

## Saving, editing & cloning (shared disk library)

- **Decks** save on creation (name field) or via **S** on a hovered deck. **Edit**
  a saved deck to swap its back image or append cards; **Save** overwrites,
  **Save as copy** clones.
- **Custom model props** save from the Custom-model dialog; **Edit** a saved prop
  to change scale/tint/stands, then **Save** or **Save as copy**.
- **Boards** save/load from the Board dialog (built-in, uploaded `.glb`, or flat).

The library is global (every room sees it) and lives on disk under `ASSETS_DIR`.
Uploaded images are **POSTed to `/upload`** (not sent over the socket); `.glb`
models to **`/upload-model`**. Files get random names and metadata JSON is never
web-served, so unrevealed fronts stay hidden.

```
saved-assets/                 (ASSETS_DIR, default ./saved-assets)
  uploads/  decks/  boards/  props/     images + <slug>.json metadata per category
```

`/assets/<kind>/<file>` is served statically **except** `.json` (blocked).
Bundled models live separately under `public/models/` (trusted, shipped with the
app — no upload path).

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
docker run -p 2567:2567 -v tabletop-assets:/data/assets tabletop
```

The `-v` mounts a named volume for the saved library so it survives restarts
(the container FS is otherwise ephemeral). Live game state and hands are
in-memory by design; new rooms start empty.

## Roadmap (not yet built)

A **role/auth + lobby layer** (Admin → Game Master → Helper → Player), with
Postgres-backed accounts/room-metadata/asset-metadata (asset *files* stay on the
volume), and a stateless hardening pass (glTF validation, upload caps/rate limits,
external-URI stripping, security headers). Uploads become admin-only by
construction. See the security notes in `ARCHITECTURE.md`.

## Notes

- `defineTypes()` (build-step-free schema) is deprecated but works in 0.17.
- No client build step: Three.js via import map, Colyseus SDK via unpkg.
