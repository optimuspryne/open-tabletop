# Asset Credits

Bundled assets - 3D models, sound effects, skyboxes, tile art, textures, and UI icons - come from
the creators below. Licenses vary: most art is **CC0** (public domain), a few are **CC BY**,
and the UI icons are **MIT**.
Attribution is given here in full as a courtesy for the CC0 assets and as a **licence
obligation** for the CC BY ones. The CC BY entries are also surfaced in the in-app
**Credits** panel (see `public/credits.js`), which is where the visible-credit
requirement is actually met.

---

## 3D models - `public/static_assets/models/`

### Chess pieces  - `pieces/chess/`
- **Author:** JustinARay - https://opengameart.org/users/justinaray
- **Source:** https://opengameart.org/content/low-poly-chess-set
- **License:** CC-BY 4.0"

### Pipped dice - `/dice/`
- **Author:** Modanung - https://opengameart.org/users/modanung
- **Source:** https://opengameart.org/content/low-poly-dice-with-lods
- **License:** CC0 (public domain)"

### Open Tabletop original models

`boards/checker_chess_board.glb`, `boards/go_board.glb`, `decks/bag.glb`,
`pieces/misc/gobowl.glb`, `pieces/misc/coin.glb`, `pieces/checkers/checker.glb`, 
`pieces/checkers/crowned_checker.glb`, and `pieces/misc/token.glb`

- **Author/source:** Original models created for Open Tabletop.
- **License:** Distributed under the repository license.

---

## Sound effects - `public/static_assets/sounds/`
All CC0 (public domain).

- **Synthesized tile flip/shuffle cues** — `tile-flip-{1,2,3}.ogg` and
  `tile-shuffle-{1,2,3}.ogg` were procedurally synthesized with Codex for Open Tabletop
  (2026-09-24), using no recordings or third-party samples. CC0. The reproducible authoring
  source is `scripts/generate-tile-sounds.py` (Python stdlib plus ffmpeg/libvorbis).
- **Original tile pickup/drop and tile-box cues** — `tile-pickup-*.ogg`, `tile-drop-*.ogg`
  and `tiledeck-*.ogg` were created with
  Claude for Open Tabletop, as confirmed by the project owner. Distributed as CC0; no
  third-party attribution is required. This note records provenance.

- **54 Casino Sound Effects** - Kenney (https://opengameart.org/users/kenney)
  - https://opengameart.org/content/54-casino-sound-effects-cards-dice-chips
- **Card Game Sounds** - HaelDB (https://opengameart.org/users/haeldb)
  - https://opengameart.org/content/card-game-sounds
- **Playing Card Sounds** - BMacZero (https://opengameart.org/users/bmaczero)
  - https://opengameart.org/content/playing-card-sounds
- **Sound Effects Pack** - OwlishMedia (https://opengameart.org/users/owlishmedia)
  - https://opengameart.org/content/sound-effects-pack

---

## Skyboxes - `public/static_assets/sky/equirect/`

- **Cloudy Skyboxes** - Screaming Brain Studios
  (https://opengameart.org/users/screaming-brain-studios)
  - https://opengameart.org/content/cloudy-skyboxes-0
- **License:** CC0 (public domain)

---

## Tile art - `public/static_assets/mahjong/faces/`

- **Mahjong Tileset** - CodeInfernoGames
  (https://opengameart.org/users/codeinfernogames)
  - https://opengameart.org/content/mahjong-tileset
- **License:** CC BY 3.0. Author requests a link to https://codeinferno.com

---

## Table rim texture - `public/static_assets/textures/`

- **5 Wood Textures** - by **Luke.RUSTLTD**, https://opengameart.org/content/5-wood-textures
- **License:** CC0 (public domain; no attribution required - credited here as a courtesy). Four of
  the set are used as the selectable wooden table rim, re-encoded to JPEG:
  `public/static_assets/textures/wood-mahogany.png` (default), `wood-walnut.png`, `wood-birch.png`,
  `wood-green.png`, `wood-oak.png`.

---

## Felt texture - `public/static_assets/textures/felt.jpg`

- **Felt Backgrounds** - by **jbp4444**, https://opengameart.org/content/felt-backgrounds
- **License:** CC0 (public domain; no attribution required - credited here as a courtesy). Scans of
  real felt; used desaturated as the tintable felt surface (`public/static_assets/textures/felt.jpg`).

---

## UI icons - inline sprite in `public/table.html`, `editor.html`, `index.html`, `admin.html`

### Tabler Icons
- **Author:** Paweł Kuna and contributors - https://github.com/tabler/tabler-icons
- **Source:** https://tabler.io/icons (outline style)
- **Usage:** ~122 outline SVGs embedded as `<symbol>` elements in the inline icon sprite,
  regenerated from a single list by `scripts/build-icons.mjs` (`npm run build:icons`).
- **License:** MIT - Copyright (c) 2020-2026 Paweł Kuna. Full text in
  [`docs/licenses/tabler-icons-LICENSE`](licenses/tabler-icons-LICENSE).


## White marble texture — `public/static_assets/textures/marble-white.webp`

- **Author:** Behrtron.
- **Source:** [4k Seamless White Marble Stone Textures Public Domain](https://opengameart.org/content/4k-seamless-white-marble-stone-textures-public-domain).
- **License:** CC0 (public domain), confirmed on the source page; no attribution required.
  Also credited in the in-app Credits panel as a courtesy.
- **Original:** The user-supplied 4096×4096 JPEG is preserved byte-for-byte as
  `public/static_assets/textures/marble-white-source.jpg`.
- **Rendering derivative:** `marble-white.webp`, 512×512, generated with Sharp `resize(512,512)`
  and `webp({quality:90})`. Used by the existing tintable Marbled finish on dice and objects;
  the source pack's optional normal/specular maps are not used.
