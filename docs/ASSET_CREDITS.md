# Asset Credits

Bundled assets - 3D models, sound effects, skyboxes, tile art, textures, and UI icons - come from
the creators below. Licenses vary: most art is **CC0** (public domain), a few are **CC BY**,
and the UI icons are **MIT**.
Attribution is given here in full as a courtesy for the CC0 assets and as a **licence
obligation** for the CC BY ones. The CC BY entries are also surfaced in the in-app
**Credits** panel (see `public/credits.js`), which is where the visible-credit
requirement is actually met.

---

## Website artwork - `website/assets/`

- `logo-wordmark.svg` is an unchanged copy of `public/logo-wordmark.svg`, reused for website
  header and footer branding under the repository's existing terms.

- `tabletop.webp` and `favicon.png` are resized derivatives of the existing Open Tabletop
  `public/logo-mark.svg` artwork, distributed under the repository's existing terms.
- The original SVG is unchanged. The logo derivatives are branding, not gameplay captures.
- `showcase/chess.png`, `cards.png`, `dice.png`, and `library.png` are original browser
  captures of staged local rooms, taken September 29, 2026. Their page placement was approved
  and applied to the landing page and Assets and scenes guide. They include bundled assets whose credits appear below; specifically,
  the chess models are JustinARay's CC BY 4.0 work and need attribution when published.
  See [capture notes](../website/assets/showcase/README.md). No generated imagery was used.

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

`pieces/mahjong/` (34 standard faces, three reserved red-five variants and `concealed.glb`):

- **Model author/source:** Engraved models authored for the project owner with Codex,
  supplied from `Open-Tabletop_Asset_Builders/3d_models/original/GLB/mahjong_glb/`.
  The authoring kit is `3d_models/original/BLEND/mahjong_engraved_kit.zip`.
- **Face artwork:** FluffyStuff, [riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles),
  dedicated to the public domain under [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
- **Model license:** Distributed under the repository license, with the other Open Tabletop originals.
- Original GLB bytes, colored recessed engravings, ivory `base` and green `back` materials
  are preserved. Runtime fitting matches shared Mahjong dimensions. Base/Back color and
  finish overrides are per instance; engraved symbol colors remain authored. The blank
  white dragon is intentionally unmarked. Red fives are bundled but unused by default.

`pieces/mahjong/Flower1_Plum.glb`, `Flower2_Orchid.glb`, `Flower3_Chrysanthemum.glb`,
`Flower4_Bamboo.glb` and `Season1_Spring.glb` through `Season4_Winter.glb`:

- **Model/artwork source:** Original botanical designs and matching engraved models created
  for the project owner with Codex. Supplied from the `mahjong_bonus_kit/mahjong_glb/`
  folder in the companion tile-authoring chat's outputs; the kit includes editable SVGs,
  `mahjong_bonus.blend` and `build_engraved_mahjong_bonus.py`.
- **Artwork license:** CC0, as recorded in the supplied kit's `README.txt`.
- **Model license:** Distributed under the repository license, with the other Open Tabletop originals.
- **Lettering:** Outlined Noto Serif CJK, [Noto CJK](https://github.com/notofonts/noto-cjk),
  SIL Open Font License. No font files are embedded or redistributed. The resulting
  artwork can retain its own license; see the [OFL FAQ, 1.1–1.1.2](https://openfontlicense.org/ofl-faq/).
- All eight GLBs are bundled byte for byte, preserving authored materials and 0.45 mm
  engraved recesses. The original botanical artwork complements FluffyStuff's CC0 set.

`pieces/dominoes/Domino_0_0.glb` through `Domino_6_6.glb` (28 double-six pairs),
and `pieces/dominoes/Domino_Concealed.glb`:

- **Author/source:** Project owner's original domino models, supplied from
  `Open-Tabletop_Asset_Builders/3d_models/original/GLB/domino_glb/`.
- **License:** Distributed under the repository license, with the other Open Tabletop originals.
- Original GLB bytes and `base`/`inset` materials are preserved. Runtime fitting centers
  each model and matches the shared domino dimensions; color/finish overrides are per instance.

`boards/checker_chess_board.glb`, `boards/go_board.glb`, `decks/bag.glb`, `decks/dominoes_box.glb`,
`pieces/misc/gobowl.glb`, `pieces/misc/coin.glb`, `pieces/checkers/checker.glb`, 
`pieces/checkers/crowned_checker.glb`, and `pieces/misc/token.glb`

- **Author/source:** Original models created for Open Tabletop.
- **License:** Distributed under the repository license.

---

## Sound effects - `public/static_assets/sounds/`
All CC0 (public domain).

- **Ceramic tile cues** — `ceramic-tile-pickup-{1,2,3}.ogg`,
  `ceramic-tile-drop-{1,2,3,4}.ogg`, `ceramic-tile-flip-{1,2,3}.ogg` and
  `ceramic-tile-shuffle-{1,2,3}.ogg` are original procedural synthesis created with
  Codex for Open Tabletop (2026-10-12), with no recordings or third-party samples.
  CC0. `scripts/generate-tile-sounds.py` reproduces the waveforms using Python stdlib
  and ffmpeg/libvorbis. Its default command authors this set; `--legacy` authors the
  earlier flip/shuffle placeholders. These new files are the active tile cue pools;
  the older files below are preserved, and tile-box cues retain their original sounds.
  Timbre and timing were tuned against the project owner's supplied
  `mahjong_tile_{1,2,3,4}.ogg` and `Shuffle_the_mahjong_tiles.ogg` examples from
  `Mahjong_Sound_Pack_2026_02_24`. Those recordings are references only: no recording
  samples or waveform data are copied into the bundled cues, and the pack is not redistributed.
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

`flowPlum.png` and `flowBamboo.png` are CC0 derivatives of the bonus kit's original
`Flower1_Plum.svg` and `Flower4_Bamboo.svg`, rendered with Sharp to 360×480 PNG and
flattened onto ivory `#efead8`. They provide image fallbacks for the new GLB identities.
Their botanical artwork/outlined Noto lettering have the same provenance as the bonus
models above. All pre-existing tile PNGs remain unchanged.

The original tile PNG set (excluding these two new fallbacks):

- **Mahjong Tileset** - CodeInfernoGames
  (https://opengameart.org/users/codeinfernogames)
  - https://opengameart.org/content/mahjong-tileset
- **License:** CC BY 3.0. Author requests a link to https://codeinferno.com

---

## Playing-card art - `public/static_assets/cards/bridge/`

- **Bridge-Sized Playing Card Deck (PNG, CC0)** — Mesmedir, derived from
  Dmitry Fomin's 2017 Wikimedia Commons playing-card collection.
- **Source:** https://opengameart.org/content/bridge-sized-playing-card-deck-png-cc0
- **License:** CC0 (public domain).
- The 56 PNG originals from `playingcards_bridgesize_png.zip` are unchanged:
  52 faces (`C`, `D`, `H`, `S`, ranks 1–13), red/black jokers (`X-R`, `X-B`),
  and blue/red backs (`Back-B`, `Back-R`). Browser thumbnails use the existing
  on-demand WebP derivative service; originals retain their alpha corners.
- Courtesy credit is also shown in the in-app Credits panel.

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
- **Usage:** 167 outline SVGs, including `wall` for Mahjong's approved Build wall action and
  `cloud-fog` for the fog tool, embedded as `<symbol>` elements in the inline icon sprite,
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
