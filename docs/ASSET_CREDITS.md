# Asset Credits

Bundled assets - 3D models, sound effects, skyboxes, tile art, textures, and UI icons - come from
the creators below. Licenses vary: most art is **CC0** (public domain), a few are **CC BY**,
and the UI icons are **MIT**.
Attribution is given here in full as a courtesy for the CC0 assets and as a **licence
obligation** for the CC BY ones. The CC BY entries are also surfaced in the in-app
**Credits** panel (see `public/credits.js`), which is where the visible-credit
requirement is actually met.

---

## Original room companion — `models/environments/shared/gray-pup-in-bed.glb`

The gray reclining terrier and slate-blue dog bed are original Open Tabletop
geometry/materials authored with Codex in Blender under the repository license
(GPL-3.0), from the owner's photograph and corrections. The photograph is a visual
reference only and is not embedded or redistributed. No third-party models,
textures or additional attribution requirements are introduced.

The accepted detailed source remains unchanged in companion
`3d_models/original/pup_in_bed_v2/pup-in-bed.blend`. Its separate
`pup_room_integration_v1/prepare_runtime.py` derivative preserves the pose, gray
palette, bed, complete ear shells and rooted fur strands, with every fur strand retained as a tapered surface ribbon,
simplified skin and material batching for scenery. The ordinary derivative is
227,104 triangles / 14 batches / 7,450,420 bytes; the canonical lossless Meshopt
payload is 4,765,964 bytes, with no texture dependencies. The publisher verifies
decoded geometry/materials and desktop/touch pixels against that derivative;
separate room renders compare the derivative with the accepted high-detail master.
Source/export hashes, approval and actual checks are retained beside the source
and in the app model manifest. This is shared visual scenery in the four furnished
rooms; the original seated study is not bundled.

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

Poker Night (`public/rendering/rooms/poker-night-theme.js`) reuses the credited
CC0 walnut map, original Cozy plaster maps and original rubber-plant GLB below.
Paneled walls, beveled leather chairs, sideboard, carafe/glasses, pendant, curtain
folds, woven rug and landscape pictures are original procedural project artwork
under the repository license. Rug/landscape canvases are 512px desktop and 256px
phone maximum; contact shadows reuse the existing original gradient. The initial procedural pass included no new
third-party asset or replacement GLB. The built-in imagegen approval
concept and its full prompt are preserved in `docs/mockups/poker-night-concept.*`
as design references only; neither is used by the runtime.

The companion `3d_models/original/poker_night_v1/` Blender redesign is a later
approved source for eight bundled models, preserving the owner-edited curtains
and tiebacks. Its nine model/material masters and
leather/rug/landscape/detail maps are original project work under the repository
license, reusing the credited CC0 walnut color and the unchanged original rubber
plant for review context. Actual Cycles renders, packed `.blend`, source scripts
and provenance/geometry reports are retained there. No new third-party asset was
downloaded. Eight GLBs are published under `models/environments/poker-night/`, with two walnut
detail maps in the shell palette. The original source remains unchanged.

The companion `3d_models/original/medieval_tavern_v1/` approved Blender source contains
original project geometry and procedural stone/plaster/cloth materials, a modeled
cup emblem and actual Cycles room/seated review renders, under the repository
license. It reuses the already credited CC0 oak image and original Cozy oak normal
derivative; both are packed without altering the originals. No external asset,
font or image-generation insert was downloaded. Eight optimized GLBs are bundled
under `models/environments/medieval-tavern/`; four shell maps are bundled as
`textures/tavern-{stone,plaster}-{color,normal}.png`. Procedural review relief is
adapted to original periodic 512px color/normal maps; clear glazing uses alpha
PBR. The approved `.blend` and its materials remain unchanged. See the bundled
model directory's README for source hash, scope and portability details.

The Tavern window revisions preserve the owner's unsaved horizontal shutter
placement in an input snapshot and shift the leaves clear of the wall in a
separate `.blend` copy. The current `medieval-tavern-window-reveal.blend` mirrors
the reviewed left shutter for the right leaf, as requested in the second fit review.
The original approval file/materials and other seven model derivatives are
preserved; provenance hashes are in the bundled model README and companion fit
reports. Adaptive runtime trestles are original project rendering geometry.

The approved companion Modern Bar source in
`Open-Tabletop_Asset_Builders/3d_models/original/modern_bar_v1/` contains original
geometry for the bar/shelves, leather chairs, booth, stools, steel table bases,
brick shell, window, illustrative 3D skyline, lights, plant and unbranded dressing.
New geometry/procedural materials are project originals under the repository
license. It reuses and packs the unchanged Luke.RUSTLTD CC0 walnut map credited
above; lettering uses Blender's built-in font. No external model/photo/font or
generated-image insert is downloaded. Source notes and actual Cycles room/seated
renders are retained. Thirteen losslessly optimized GLBs, including the approved
rear-wall door/nook additions, are bundled under
`models/environments/modern-bar/`; procedural review relief becomes original
periodic 512px normal/roughness maps inside derivative GLBs, retaining fine leather
grain. Alpha glazing replaces transmission. The runtime shell reuses the credited
walnut and original Tavern plaster/stone normal maps. No review light, table,
fixed chair roster or city backdrop is imported. The approved/editable `.blend`
files and original materials remain unchanged; source/export hashes and asset
scope are recorded in the bundled README and companion export report.
The original project `modern-bar-detail-fit.blend` revision supplies only the
corrected chair and table pendant: surface-fitted piping/rearward back lean and
smooth satin brass. The other nine assets retain the approved source. Per-asset
hashes identify both sources; no additional external asset or license is introduced.

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

The companion `room_backwalls_v1/` review adds original door/nook geometry using
the existing project materials and credited wood maps above. It directly reuses
the corrected Tavern window geometry and material data. No external model, image,
font or texture is downloaded. Editable sources and input/helper hashes are kept
with the review reports. The user approved these studies on 2026-10-17. Three
new optimized derivatives are now bundled: Modern Bar door/nook and Poker Night
door. Tavern reuses its existing corrected window GLB. Portable alpha and original
PBR adaptations change derivatives only; source files retain their authored
materials. The model READMEs and companion runtime report contain exact hashes.


## Remaining room-theme review studies — October 17, 2026

The companion `3d_models/original/remaining_room_themes_v1/` package contains
original geometry and procedural materials for eleven pending room themes, with
actual Blender render masters. New furniture, architecture, stylized exterior
dioramas, unbranded game boxes and abstract artwork are original project work
under the repository license. Sources reuse the existing credited CC0 oak color
texture by Luke.RUSTLTD; images are packed in the editable files. No third-party
model, photograph or font is downloaded, and no image-generation insert is used.

The review gallery uses system fonts; the contact sheet uses the locally installed
DejaVu Sans font. JPEGs are derivatives of the preserved PNG masters. This
original review slice added no bundled runtime GLB, texture, catalog entry or
in-app credit requirement. Current approvals are tracked in the review index;
Speakeasy runtime derivatives are documented below. See [the review index](ROOM_THEME_REVIEW.md)
and companion README for sources, exact file/helper inventory and audit reports.


## 1920s Speakeasy runtime derivatives — October 19, 2026

Eight original project GLBs in `models/environments/speakeasy/` derive from the
owner-approved companion `speakeasy_review_v4/speakeasy-piping-v4.blend`, SHA-256
`258e96c3c6cac4f341b0f8224f34b935494b92522138675f6d53e9e3dea0fe5d`.
Geometry, abstract artwork and portable material adaptations are original project
work under the repository license. Tinted joinery reuses Luke.RUSTLTD's existing
CC0 oak color map, already credited above and in-app. No new third-party asset or
attribution is introduced. The authored source and packed original texture are
preserved. `speakeasy_runtime_v1/` retains the exporter, raw GLBs/maps, per-object
transforms, source/export hashes and PNG runtime capture masters. The app carries
one compressed derivative per asset, totaling 3,571,016 bytes from 6,985,820 raw
export bytes. Runtime capture JPEGs illustrate the real production renderer.
The source table/cameras/lights and review chair roster are excluded; the gray
pup uses its already credited shared derivative. See [integration](PLAN_ROOM_THEMES.md#speakeasy-runtime-integration--october-19-2026).


## Ancient Temple runtime derivatives — October 19, 2026

Eight original project GLBs in `models/environments/ancient-temple/` derive from
the approved companion `temple_cyberpunk_review_v2/ancient-temple-v2.blend`, SHA-256
`f9d44c0b6ebab77ae916a7584c0c182a4b422b97b1aecd267c1d5eb2831714fc`.
All geometry, abstract relief/chart and portable procedural stone maps are project
originals under the repository license. No third-party model, image or font is
added. The room shell reuses the already credited project stone normal map; the
shared pup and preview's existing Cloudy - Clear Afternoon sky retain their
existing credits. Source materials and the original packed image remain intact.
Companion `ancient_temple_runtime_v1/` retains the raw GLBs/maps, exporter, transform/
bounds/smooth-face/hash report and runtime PNG capture masters. The app bundles
one compressed derivative per asset: 2,629,816 bytes from 4,998,200 raw bytes.
The shaft UV wrap is corrected in the derivative exporter for even stone scale;
its geometry, normals, materials/maps and approved native source are unchanged.
Review lights, game table, fixed roster and exterior placeholder/foliage are
excluded. Runtime JPEGs show the production renderer and an explicitly selected
existing sky. No additional in-app attribution is required. See [integration](PLAN_ROOM_THEMES.md#ancient-temple-runtime-integration--october-19-2026).


## Remaining nine room themes — October 19, 2026

66 original project GLBs in `models/environments/<theme-id>/` derive from the
latest reviewed native sources below. Runtime integration of all nine was
explicitly authorized October 19; final owner in-app acceptance remains pending.
The sources and packed images are unchanged. Derivatives total **61,445,704 bytes**
from 105,958,496 raw bytes (42.0% smaller), with zero validator errors/warnings.

| Theme | Companion native source under `3d_models/original/` | SHA-256 | Models |
| --- | --- | --- | ---: |
| Starship Lounge | `remaining_room_polish_v2/starship-lounge-v2.blend` | `e3693cd39bd7463506236f9be0fb4822380a6633f58a2b77639852dd522ec9ba` | 8 |
| Victorian Study | `remaining_room_polish_v2/victorian-study-v2.blend` | `2b9bfa65160f95c2bbfbb9e4c127a7802bfcb89a06432ac2d519d770b66bcbe5` | 7 |
| Mountain Cabin | `remaining_room_polish_v2/mountain-cabin-v2.blend` | `cf5dfab492cb87ab021de46b7a7d0b7da5d02f2860bc8352d5f8ccee07ace19e` | 8 |
| Pirate Captain's Cabin | `remaining_room_polish_v2/pirate-captains-cabin-v2.blend` | `10dceb7119545d1ac31ed60f8b549c7d28113adaa7a363163e8926c752a22b77` | 8 |
| Wizard's Workshop | `remaining_room_polish_v2/wizards-workshop-v2.blend` | `f91dd448e6b775abb8607d236ac2d1ba4e982d5689d0168051cf92e09c1f8abe` | 7 |
| Cyberpunk Back Room | `cyberpunk_review_v3/cyberpunk-pipe-returns-v3.blend` | `3c91a720f908f8ee957dfe95c77c904cf5c80129ab6e2ff772665ed67a937b29` | 7 |
| Japanese Game Café | `remaining_room_polish_v2/japanese-game-cafe-v3.blend` | `def01889a0dcc0d11008cb1233e9a812ba0c2788e31174eff2d19f350dd36bec` | 8 |
| Garden Conservatory | `garden_japanese_review_v2/garden-conservatory-v2.blend` | `e07b61c1d47b7e5b887b276b97c8dfee0dcd6e685932384c18743f8c6945130e` | 7 |
| Orbital Observation Deck | `remaining_room_polish_v2/orbital-observation-deck-v2.blend` | `cfecc3e371ca5fb078f0c853c674b36655fa2688ace1c63059e2f540e8e13d3b` | 6 |

Existing original geometry, connected conical ceiling covers, wall brackets,
fluorescent fixture/pipe returns and varied botanical meshes are retained. Older
Cyberpunk flat faces are smoothed in the unsaved export copy; its geometry and
approved source remain intact. The Victorian derivative clock rests on its
mantel. Shared evaluated-mesh/PBR helpers retain original scalar finishes and
bake the packed oak tint; procedural relief becomes periodic normal/roughness
maps only in exported derivatives. New maps/geometry are project originals under
the repository license. The previously credited packed CC0 oak texture, existing
runtime shell normals, shared pup and review sky keep their existing licenses.
No external asset, ImageGen output or additional in-app attribution is introduced.

Companion `remaining_rooms_runtime_v1/` holds guarded source inventories, exporter,
raw exports/maps, part/material/smooth-face/bounds/hash reports, desktop/touch
publication, production capture recipes/PNG masters and delivery audits. Canonical
app models/manifests retain decoded geometry/image/material/browser fingerprints.
[Current review, matching palettes and operating steps](ROOM_THEME_RUNTIME_REVIEW.md).

## Local room asset organization (October 19, 2026)

The eleven reviewed theme sources were consolidated into companion `3d_models/rooms/` on October 19, 2026. Authored source materials, packed images, sources/licenses and installed runtime binaries are unchanged. Historical package names below refer to retired drafts; current paths and hashes are in the final-room manifest. [Open the final-room index](../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md).

### Earlier room sources relocated (October 19, 2026)

Cozy, Poker Night, Medieval Tavern and Modern Bar now share the same companion `3d_models/rooms/<theme-id>/` organization as the eleven newer themes. Their final furnishings, corrected windows/lighting, ceiling and rear-wall sources are together, with original publisher inputs, runtime copies, maps and review/provenance records. The accepted gray pup master and scenery derivative live once under `rooms/_shared/gray-pup-in-bed/`. Original owner sources and approval inputs are retained; superseded drafts, backups, redundant ZIP bundles and unused compression candidates were removed. Old package names elsewhere in dated records describe history. [Current source index](../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md). The app model files/manifest/registry are unchanged.
