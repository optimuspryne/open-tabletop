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
  See [capture notes](../website/assets/showcase/README.md).
- `showcase/go.png`, `dominoes.png`, `mahjong.png`, and `wordy.png` are approved staged
  mockups captured October 14, 2026 with the app's production renderer and bundled models,
  including the project's original Go, Dominoes, Mahjong and Wordy models. These are isolated
  arranged scenes, not screenshots of saved multiplayer games. Existing model, face-art,
  texture and Tabler licenses apply as recorded below. No AI-generated or externally sourced
  screenshot artwork was added. Their unchanged 1086 x 912 PNG originals ship with the site.
- The homepage's four Tabler outline icons reuse the existing MIT-licensed icon sprite builder;
  the separate website subset preserves the same attribution and license as the game icons.

---

## 3D models - `public/static_assets/models/`

All 101 bundled GLBs ship once in the approved lossless encoding at their existing
canonical filenames. Uncompressed comparison copies and temporary derivative
paths were removed at the owner's request. Source authors/licenses/required credits
below remain applicable, including JustinARay's CC BY chess attribution. Offline
Meshopt/lossless-WebP changes preserve decoded attributes, oriented triangles,
image pixels and material slots; source image encodings remain where WebP would
increase size or alter pixels. No new artwork/model source is added. Per-file
source/final hashes, sizes and validation are in `models/manifest.json`. Authoring
masters remain in the separate asset workspace. The MIT meshoptimizer source and
license are under `public/vendor/meshoptimizer/`, with its approved in-app credit.

### Chess pieces  - `pieces/chess/`
- **Author:** JustinARay - https://opengameart.org/users/justinaray
- **Source:** https://opengameart.org/content/low-poly-chess-set
- **License:** CC-BY 4.0"

### Pipped dice - `/dice/`
- **Author:** Modanung - https://opengameart.org/users/modanung
- **Source:** https://opengameart.org/content/low-poly-dice-with-lods
- **License:** CC0 (public domain)"

### Open Tabletop original models

`boards/wordy_board.glb`:

- **Author/source:** Project owner's original Wordy board, edited with Codex and supplied from
  `Open-Tabletop_Asset_Builders/3d_models/original/GLB/wordy_board.glb`.
  The editable source is `3d_models/original/BLEND/wordy_board_uv_fixed.blend` in that asset workspace.
- **License:** Distributed under the repository license, with the other Open Tabletop originals.
- The supplied geometry/materials are retained through the lossless encoding above. Authored wood/normal textures, raised squares,
  premium-square colors, star and DL/DW/TL/TW lettering are preserved. Runtime centering/scaling
  retains Wordy's 11-unit width; measured grid spacing and offsets align tile snapping.

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
- All eight GLBs use the lossless encoding above, preserving authored materials and 0.45 mm
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

Only `flowLotus.png` and `flowPeony.png` remain from the original tile PNG set, for
saved flower identities without matching GLBs. The 42 replaced PNGs have been removed,
including the former plum/bamboo fallbacks derived from the bonus kit SVGs. Current
tile models retain the artwork and provenance described above; active faces use
generated text during model loading or failure.

The two retained original PNGs:

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

The opt-in cozy room prototype (`public/rendering/cozy-room.js`) also reuses the
credited oak original for its trim and fallback furnishings. The woven rug is generated
procedurally by project code (1024px desktop/tablet, 512px phones, with a fine
weave and the original border proportions). The soft 128px furniture contact map is also an
original procedural gradient; no third-party image is added. The authored
furniture below supplies the chair, shelf and lamp. The AI-generated approval mock-up is a design
reference and is not used as a runtime asset.

The companion `Open-Tabletop_Asset_Builders/3d_models/original/cozy_room_v1/` asset
study reuses the unchanged oak color image and new normal/roughness derivatives.
Its chair, game shelf, floor lamp and woven-linen maps were created for Open Tabletop
with Codex in Blender, under the repository license with other project originals.
The owner's Go bowl, chess board and pouch are style references; none of their original
models or maps were replaced. The owner's corrected
`3d_models/original/BLEND/cozy_room_assets_fixed.blend` is now the authoritative
source for `public/static_assets/models/environments/cozy/cozy-chair.glb`,
`cozy-game-shelf.glb` and `cozy-floor-lamp.glb`. Chair/lamp authored geometry and materials from the fixed exports are preserved
through lossless encoding. The shelf now uses the existing grain-aligned oak UV layer
from a separate `cozy_plants_v1/cozy-room-shelf-uv.blend` derivative, with unchanged
frame/tray geometry, images, materials and owner alignments. Only review-stage
placement is removed. The source blend is never overwritten by export. The later
`cozy_shelf_v2/cozy-game-shelf-collection.blend` derivative replaces generic props
with display copies of existing built-in coin, poker-chip, Go bowl/stone, domino,
domino-box and pouch models under the repository license. Card faces/backs reuse
Mesmedir's CC0 bridge deck credited above. Shelf-only coin/chip/stone meshes are
simplified, except for the full-detail top coin in each stack. Shelf-only embedded
image derivatives are capped at 512px; gameplay source geometry remains intact. The oak frame/tray and basket
positions are retained. No new third-party runtime asset or attribution is introduced.
See [Art Direction](ART_DIRECTION.md) and the asset pack's README for source files and
the measured export checks. No additional third-party models or textures are included.

`models/environments/cozy/cozy-game-shelf.glb` now holds the approved 7,485,328-byte
lossless Meshopt/WebP payload from `cozy_shelf_compression_v1/`. All decoded
geometry, 15 RGBA images, named material slots and active nodes were verified
against the prior 15,942,228-byte export. The uncompressed app copy was removed
at the owner's request; no Blender source was changed. See `models/manifest.json`
and the model publishing guide for provenance and future export verification.

`models/environments/cozy/cozy-window.glb` and `textures/cozy-*.png`:

- **Source:** Companion `3d_models/original/room_shell_v1/build_room_shell.py` and
  editable `cozy-room-shell.blend`, authored for Open Tabletop with Codex. Window
  framing/hardware are original geometry; the app adds clear glazing without an
  image insert so the selected skybox is visible.
- **Wood maps:** Existing Luke.RUSTLTD CC0 oak, with a lighter floor-color derivative
  and the study's oak normal/roughness derivatives. Source authoring files and
  standalone texture maps remain unchanged. Bundled maps: `cozy-floor-oak-color.png`, `cozy-oak-normal.png`,
  `cozy-oak-roughness.png`.
- **Plaster maps:** Original deterministic periodic surface maps,
  `cozy-plaster-color.png`, `cozy-plaster-normal.png`, `cozy-plaster-roughness.png`.
  Distributed under the repository license with other project originals.
- All maps are 512×512; the window GLB embeds its oak maps. The shell approval image
  is an AI design reference only; no generated concept image is used at runtime.

`models/environments/cozy/cozy-ceiling.glb`: companion
`3d_models/original/cozy_ceiling_v1/cozy-vaulted-ceiling.blend` and GLB contain
original exposed-beam/skylight geometry authored for Open Tabletop with Codex,
under the repository license. Packed oak/plaster/bronze materials come from the
saved room-shell source above; oak retains Luke.RUSTLTD CC0 provenance. Review
daylight is a Blender sky shader, not a new third-party texture or runtime sky.
The approved master stays unchanged. `export_runtime.py` exports a derivative
with dimension-fitting metadata and simple alpha glazing; the offline publisher
verifies/bundles its 1,123,540-byte lossless Meshopt/WebP asset. Existing in-app CC0
wood attribution covers the reused maps; no new third-party source is introduced.

`models/environments/cozy/cozy-{rubber-plant,snake-plant,pothos}.glb`:

- **Source:** Companion `3d_models/original/cozy_plants_v1/build_plants.py` and
  editable `cozy-plants.blend`, authored for Open Tabletop with Codex in Blender.
  Original curved leaf/stem meshes, rounded planters and soil; original deterministic
  512px color, tangent-normal and roughness maps for botanical veins/variegation,
  ceramic, terracotta and soil. Distributed under the repository license.
- No additional third-party models, texture downloads or AI images are bundled.
  The approved plant mock-up is an AI-generated design reference only.
- `cozy_plants_v1/export_shelf_uv.py` activates the existing oak UV layer in a separate
  shelf derivative. Oak color and derived normal/roughness maps retain the CC0
  provenance above; the owner's source file remains unchanged.

---

## Felt texture - `public/static_assets/textures/felt.jpg`

- **Felt Backgrounds** - by **jbp4444**, https://opengameart.org/content/felt-backgrounds
- **License:** CC0 (public domain; no attribution required - credited here as a courtesy). Scans of
  real felt; used desaturated as the tintable felt surface and desktop fine bump
  detail (`public/static_assets/textures/felt.jpg`). The original is unchanged.

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


## Meshopt decoder — `public/vendor/meshoptimizer/`

- **Source:** `meshoptimizer@0.24.0`, upstream
  [meshoptimizer JavaScript tools](https://github.com/zeux/meshoptimizer/tree/v0.24/js).
- **Authors:** Arseny Kapoulkine; reference JavaScript implementation by Jasper St. Pierre.
- **License:** MIT; the complete upstream copyright/license notice is retained in
  `public/vendor/meshoptimizer/LICENSE.md` and the unchanged decoder's header.
- `meshopt_decoder_reference.js` SHA-256:
  `2fad1a37ec276ddd0e1eaa1b389f2fcb1d57d684cbcb38de4116a95ba8925ef3`.
- Used only by the room GLTFLoader for trusted bundled scenery, without WebAssembly
  compilation/eval or CSP changes. Upstream notes that this reference implementation
  is not performance optimized; see its bundled README for measured scope/limits.
- The approved **Settings → Credits → Libraries** entry links to meshoptimizer
  and lists MIT in desktop/touch, full/compact layouts using the existing renderer.

## Colyseus browser SDK — `public/vendor/colyseus.js`

- **Source:** `@colyseus/sdk@0.18.5`, unchanged `package/dist/colyseus.js` from the
  [published npm tarball](https://registry.npmjs.org/@colyseus/sdk/-/sdk-0.18.5.tgz).
- **Author/license:** Endel Dreyer, MIT. The complete upstream notice is retained
  in [`public/vendor/colyseus-LICENSE.txt`](../public/vendor/colyseus-LICENSE.txt)
  and ships in the production image. The existing in-app Colyseus library credit applies.
- **Integrity:** SHA-256
  `96557215f2411918b1eed792ed99983ff3df129cf9512fa12a0faf89a11410f4`;
  verified registry tarball integrity and embedded schema version are recorded in
  [the SDK provenance](../public/vendor/colyseus-README.md).
- Self-hosted UMD global, with no CDN/build step or new CSP permission. The
  [upgrade record](COLYSEUS_018_ASSESSMENT.md) covers server/browser compatibility.
