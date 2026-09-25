# Open Tabletop — Roadmap

_Last reconciled 2026-09-23 against v0.18.0 source and documentation. Completed implementation
does not imply that the manual device or large-scene checks have been signed off._

## North star

A self-hosted, physics-driven virtual tabletop that recreates **sitting at a real table with
friends** — you manipulate physical objects, and humans enforce the rules. As of 0.9.0 the engine
is coherent enough that the goal shifts from "our tool" to **"something any group can stand up and
play on."** Everything below is weighed against two questions: *does it feel like a real table?*
and *can a hobbyist host it for their friends without a fight?*

## Guiding principles (the filter)

These are why some obvious features are deliberately absent — keep them in mind when prioritizing.

- **Physical-first.** Simulate objects; let people enforce rules. No rules engine, no legal-move
  checking, no scorekeeping the table wouldn't do itself.
- **Trust by transparency, not accounting.** State is public; you verify a roll by *looking at the
  dice*, not by reading a log. (This is exactly why the dice-roll log was dropped.)
- **Local where it can be, synced where it must be.** Selection, camera, accent color, audio are
  per-player and never touch the network; only the shared physical objects sync.
- **Hostable by a hobbyist.** One image, stock Postgres, self-applied migrations, upgrades on a
  blind `docker pull`. Every added moving part is a tax on the person running it.

---

## Architecture note — the server split (historical v0.12.2 snapshot, 2026-09-01)

The following records the earlier split, not the current backlog. Subsequent extraction moved
schema definitions, deck builders, starter setup, and focused room behavior into `server/game/`.
`TableRoom` remains the orchestration entry point in `server.js`; see
[ARCHITECTURE.md](ARCHITECTURE.md) and [REFERENCE.md](REFERENCE.md) for current ownership.

A DRY pass broke the server monolith into 33 files. What moved:

```
server/http/routes/     admin · auth · rooms · uploads
server/http/            async-route · auth-context
server/game/handlers/   cards · library · members · movement ·
                        overlays · pieces · room-features · room-state
server/game/            props-codec · safe-message · scene-persistence
server/                 database · database-config · permissions · physics ·
                        rate-limit · redis-config · session-config · deck-state ·
                        message-validation · auth-validation · room-queries ·
                        user-queries · library-queries · bootstrap-admin ·
                        assets/upload-validation
```

The seams came out clean — community detection over the call graph finds a distinct router
cluster (`createAuthRouter` / `createRoomsRouter` / `createAdminRouter` / `requireUser`,
cohesion 0.89) and a fully cohesive query layer (`roomRow` / `publicUserRow` / `listBoards`,
cohesion 1.0).

**What had NOT moved at that checkpoint:** `server.js` still carried ~120 symbols, including the whole `TableRoom`
class (lines 560–2044, ~1,485 lines) plus `EditorRoom` (2045), `LobbyRoom` (2221), the Colyseus schema classes
(`Piece`, `Player`, `Overlay`, `State`, `Whiteboard`, `Timer`, `ScoreRow`, `RoomScale`), the
starter builders (`buildDominoSet`, `buildMahjongWall`, `buildScrabbleBag`, `buildSimpleDeck`)
and `bootstrap`. See "Finish the server split" under Parked threads. Note: 0.11.0 extracted more
handler modules (movement, cards, room-state, overlays, physics, scene-persistence), but `TableRoom`
itself had not moved — `server.js` was **2278 lines**, *larger* than at 0.9.0 (2039). The 0.11.0
changelog's "substantially reduces `server.js`" is relative to what it would otherwise have been,
not an absolute shrink.

Where things lived at that checkpoint: `BOARD_PAINTERS` was in `public/rendering/graphics.js`;
snap logic was split across `shared/pieces.js` (`snapToCell`, `gridActive`),
`server/game/handlers/pieces.js` (`applySnap`) and `public/client.js` (`pieceSnap`, `snapXZ`);
`setupStarter` was still `TableRoom.setupStarter` (`server.js:1062`).

---

## The distribution push (priority order — reorder freely)

### 1. Plays well at real scale — robustness
The difference between "demo" and "we play here every week."
- ✅ Performance with **hundreds of pieces** on the table. The body count is lower than it looks —
  a deck is one body, not N (see the piece-model note below) — so reaching true hundreds means
  raising `SIM.maxPieces` first, then profiling.
- ✅ **Scene-save caps and failure feedback.** Library scenes and manual table checkpoints reject
  oversized payloads with an actionable message; manual Save acknowledges only a successful
  database write. Oversized-checkpoint rejection has regression coverage. **Still open:**
  large-scene end-to-end validation; this status does not record a manual stress-test pass.
- **Reconnection edges and connection-quality feedback — partially complete.** Session rejoin,
  hand/turn preservation, and authorization rechecks exist. Recovery UX, connection-quality
  feedback, and dropped-phone validation remain open.

**Instrumentation (2026-09-01).** Both halves are now measurable, off by default. Client:
`?perf=1` on the table URL (or `window.ottPerf(true)`) draws a `renderer.info` overlay — FPS,
frame ms, draw calls, triangles, geometry/texture/program counts (`public/rendering/perf.js`). Server:
`PERF_LOG=1` makes `TableRoom.update` log a per-second `world.step` time (avg/max), awake-vs-total
body count, and tick health. Real-hardware tools — measure on the low-end target, not headless.

**Piece-model note — what "hundreds of pieces" means here.** A deck is a single body with a
private `deckCards` list, not N bodies; the 144-tile Mahjong wall spawns as one deck piece, and
dealt tiles live in `this.hands` (also not physics). Only tiles spread onto the table are bodies,
and `SIM.maxPieces` (raised 80 → **250** on 2026-09-01) caps `state.pieces.size`. So a full wall
renders as one stacked mesh, and the many-bodies case is bounded at that cap.

**Two cap bugs — ✅ fixed 2026-09-01** (cap also raised 80 → 250):
1. `dealToTable` / `dealDrag` (`server/game/handlers/cards.js`) spawned a table body per draw
   with **no `maxPieces` guard** — the other spawn paths checked it, these two didn't, so a deck
   could be drawn out past the cap. Both now check `state.pieces.size >= maxPieces` before pulling
   a card.
2. Cap checks were silent `break`/`return`. A blocked deal / spawn / hand-drop now sends a
   `notice` toast ("Table is full …") via `TableRoom.notifyFull`; `handToTable` fires it when the
   cap cut a hand-spread short. Regression-tested in `test/backend-card-handlers.js`.

**First profiling pass (2026-09-01)** — load: the Mahjong wall spread to all 144 tiles.
- *Server (cannon-es): not the bottleneck.* 144 settled bodies ≈ 0.13 ms/step; a full scoop
  (~125 awake) peaks ~3 ms avg / 5.8 ms max against the 16.7 ms tick, never dropping a tick. The
  80 cap is far below what physics needs — raising it is safe on the server side.
- *Client (iPad Safari, no skybox): the bottleneck.* ~22 fps at REST with 144 tiles, still ~22 fps
  while moving them. FPS barely moved as draws went 187→330 and tris 22k→40k, so it is NOT draw or
  geometry bound — it's fixed per-frame fill-rate: `setPixelRatio(min(dpr,2))` = 2× (4× fragments)
  on retina, `antialias:true`, and a **4096² PCFSoftShadowMap** sun redrawn each frame
  (`public/rendering/core.js:45-80`). Those are ~constant in piece count — exactly the flat-22-fps signature.
- *Memory:* opening the library used to evict/reload the Safari tab (texture pressure). **✅
  addressed 2026-09-01:** library thumbnails now load lazily (IntersectionObserver — visible
  cards only, was: every model eagerly) and dispose the loaded model right after snapshotting
  (was: never freed). **✅ both remaining memory levers addressed 2026-09-01:** `_prevCache` now
  FIFO-caps and `cardPreviewURL` disposes any face texture it built only for a preview; the
  skybox (~11 MB equirect) disposes its predecessor on switch and is suppressed entirely on the
  Low tier. (Deferred: refcount-based eviction of a *placed* piece's face texture when its last
  user is removed — bounded within a game, so left for later.)
- *So §12's levers are the right ones, ranked:* shadow-map size / soft-shadow quality (likely the
  biggest), render scale (pixel ratio), antialiasing — NOT instancing/LOD (draws aren't the
  limit). Skybox resolution (§11) is a memory lever, not an fps one; a low tier should also shrink
  the shadow map to relieve the library OOM.

**iPad knob A/B (2026-09-01)** — 144 tiles at rest, no skybox, each vs the ~20 fps baseline:
`&px=1` → **39 fps** (biggest single lever); `&shadow=1024` → 30; `&aa=0` → 31; all three → **60**
(vsync cap). Read: the frame is dominated by **main-pass fill** — pixel ratio (retina 2× = 4×
fragments) × per-fragment work (PBR + env map + PCF-*soft* shadow sampling), plus MSAA. Shadow
map *size* still moved rest fps even though the map isn't regenerated at rest (shadow-on-demand
verified working), because the cost is the per-fragment shadow *sampling* in the main pass, not
the regeneration. So shadow-on-demand helps during idle/motion but was not the rest hero — pixel
ratio is.

**§12 tiers — shipped.** The profiling above led to device-based defaults: phone → Low,
tablet → Medium, desktop → High, with a saved Settings override and URL development knobs.
All shipped tiers use soft shadows; pixel ratio, shadow-map size, and antialiasing vary by tier.
The earlier hard-shadow proposal was superseded after phone GPU testing.

### 2. A fresh room isn't a blank table — built-in content
Lowers the cold-start for a host who isn't going to model their own assets.
- ✅ **Standard 52 + jokers** deck (a "Standard 54 (with Jokers)" option with a rendered joker face).
- ✅ **One-click starter games** — Chess, Checkers, Go, Poker night, and (0.9.0) **Dominoes**,
  **Wordy McWordface**, and **Mahjong**, in the library **Games** tab (`STARTERS` in
  `shared/pieces.js`; `TableRoom.setupStarter`). Add more by editing that list.
- ✅ **Tile games + variable card geometry** (0.9.0) — `cardGeom`/`TILES` (one resolver read by both
  the mesh and the collider), custom image-deck **shapes** (rounded/square/**hexagon**, hex with a
  matching 6-gon collider) and **thickness**, a **procedural board framework** (`BOARD_PAINTERS`,
  first used by the word grid), and **deck skins** (`DECK_MODELS`, e.g. the pouch). Tiles and
  their boxes also get their own sound cues. See `DESIGN_tiles.md`.
- ✅ **Dice colors** — named dice sets (`DICE_SETS`).
- ✅ **Model dispensers** — built-in and uploaded-model dispensers are supported. The train
  dispenser was an early example; its bundled assets were removed in v0.17.0. The Go bowl and
  custom-dispenser workflow remain available.
- Still open: more **tokens/markers**; **RPG battlemaps** (the procedural-board framework is the
  seam — add a `BOARD_PAINTERS` painter); a **user upload path for deck skins** (only the built-in
  pouch exists today — the `DECK_MODELS` plumbing is there, the editor UI isn't); more
  starter games and tile art.

### 3. Session tools that stay physical
Useful for real play *if* they don't drift into app-ledger territory.
- ✅ **Ordered turn passing.** GMs reorder the player list by drag or up/down buttons;
  Next Turn follows that synchronized order. This completes the ordered-player-list scope,
  without introducing initiative rolls or automatic rules.
- A **GM staging area / screen** — a hidden zone only the GM sees, for prepping the next encounter.
  Coordinate its hidden-state design with fog of war (backlog item 4) and per-object hiding
  (item 14), while retaining server-owned physics and authorized delivery of concealed content.

### 4. A host can stand it up in ten minutes
If the goal is other people hosting, the setup path *is* the product.
- **Quickstart polish.** ✅ Done -  A copy-paste `docker compose up` that just works with sane defaults;
  a short "first room" walkthrough; clearer env-var docs.
- **Release automation.** ✅ Done — `.github/workflows/release.yml` builds + pushes the multi-arch
  images and cuts the GitHub release on a `v*` tag (notes pulled from `CHANGELOG.md`), and
  `ci.yml` runs the test suite on every push/PR. Proven across the 0.10.0–0.12.2 releases.
- **A public demo / try-it instance** (optional) so a prospective host can feel it before hosting.

### 5. Meet people where they play — touch & mobile
The single biggest audience expansion. "Pull up the iPad at game night" is a core VTT use case.
**The 0.12.0 redesign delivered the bulk of this** — a purpose-built phone/tablet layout (bottom
sheets with peek/two-thirds/full drag stops, the ⊕ action fan, long-press-piece verbs, a pull-up
hand tray, icon hints on touch) on top of the existing message protocol (no server change). What
remains is gesture polish and proving the controls on real devices.
- **Audit the gesture surface.** ✅ Done — the catalog is `docs/GESTURES.md`: every gesture, its
  touch equivalent, and a status. Held-piece rotation/raising have two-finger and button paths;
  cards and decks support tap actions and long-press menus. The in-app How to Play includes a
  touch section. Remaining exact-angle/smooth-rotation differences are documented in the
  catalog's Gaps section; they do not mean rotation is unavailable on touch.
- **Touch equivalents.** ✅ Done - Long-press, two-finger, and on-screen affordances for the button/wheel
  gestures; make the Select tool the primary path where modifiers don't exist.
- **Responsive HUD.** ✅ Done - The rails/pop-outs assume desktop real estate; verify the tablet layout and
  the collapse behavior.
- **A device test matrix** ✅ Done - so "works on my machine" stops being the coverage.
- **Manual device validation remains open.** The unchecked `docs/DEVICE_QA.md` checklist is
  separate from implemented gestures and automated layout/component coverage.
---

## Feature backlog (added 2026-08-31)

Unordered — priority not yet assigned. Completed entries are marked explicitly; unmarked entries
describe planned work. Items 13–24 were added on 2026-09-23.

Implementation planning is documented separately so this list can stay concise:

- [Detailed next-feature plans](DESIGN_next_features.md): time-out/spectator mode (5/15), deck
  browsing (22), and custom asset collections (18), with proposed policies, stages and acceptance tests.
- [Future-work discovery briefs](DESIGN_future_backlog.md): the other open features, distribution
  work and small finish items that need a closer source/design review before implementation.

The participation-policy foundation is implemented locally (119 classified requests, guarded
registration and delayed-mutation checks), with user-reported manual tests green on 2026-09-24.
Durable time-out controls/persistence are now implemented with user-reported functional and UI approval; spectator
mode is implemented with self-service entry/exit and user-approved functionality/UI. Other designs remain proposed;
unresolved product choices are marked explicitly. The detailed document recommends an
implementation sequence without making the entire backlog a fixed priority queue.

1. ✅ **Table shape customization — DONE (2026-09-05, confirmed by Ben).** The play surface can
   be **round, oval, hex (flat-top) or a rounded
   rectangle**, not just a rectangle (`state.tableShape`, GM-set + durable, carried in scenes;
   migration 014). One shared `tableOutline(shape, hx, hz)` drives all three consumers: the physics
   wall ring (`buildBounds` — one box wall per outline edge; the floor stays a box), the felt mesh
   (`resizeTable` extrudes it), and the grid clip (`gridMesh` via `clipSegConvex`). round/hex are
   single-size (depth follows width). Shipped **decoupled from the hex grid** (item 3) — a hex grid
   never needed a hex table. Seats, hand-fans and personal trays carried over unchanged (trays
   already ride a circular track), so the deferred perimeter-following seating work stays parked
   and, confirmed in play, looks unnecessary.
2. **Interactive tutorial.** Nothing exists today beyond the player-facing How-to-Play panel.
   Worth deciding early whether this is an overlay walkthrough in a normal room or a scripted
   starter scene — the latter reuses `setupStarter` and stays physical-first.
3. ✅ **Hex grid + multi-cell footprints — DONE.** Hex grids and uploaded objects with 1–12 cell
   N×N footprints are implemented. See the completed entries below and `CHANGELOG.md`.
4. **Fog of war.** Planned area-based concealment. Coordinate authorized visibility with the
   GM staging area (§3) and per-object hiding (item 14); hiding individual objects is a distinct
   feature and does not by itself complete fog of war.
5. **Spectator mode — implemented; functionality and UI user-approved.** Players choose
   **More → Spectate / Return to play** or lobby **Watch**. New observers are seatless; converted
   players reserve seats/hands/trays and are skipped by turns. Durable self-mode shares the
   interaction policy with time-out but cannot clear it. See the stage 3 checkpoint and smoke tests
   in [DESIGN_next_features.md](DESIGN_next_features.md#stage-3-spectator-checkpoint--2026-09-24).
6. ✅ **Custom dispensers — DONE.** Admins can attach finite or infinite dispensers to uploaded
   objects in the editor, using a visible stack, generic container, or second uploaded model.
   Saved configurations support dispensing and gathering compatible pieces.
7. **Custom games.** `STARTERS` in `shared/pieces.js` is code-only today — adding a game means
   editing the list. This is the user-facing version: define, save and share a starter from
   inside the app. Saved library scenes already provide reusable table layouts; a dedicated
   starter-authoring workflow remains open. Deck-skin uploads are a separate gap in §2.
8.  **Hand Re-organization.** ✅ **shipped 2026-09-01** — a per-viewer Rearrange mode (drag hand
    cards to reorder, with Sort by rank/suit), sent to the server as a `reorderHand` permutation so
    the order survives a reconnect. Kept separate from the play-to-table gesture (a mode toggle).
9. ✅ **Custom dice / dice textures — DONE.** Finishes, uploaded textures for numbered dice,
   and built-in pipped d6 models are shipped. Optional texture tuning is not a completion blocker.
   - *Phase 1 — finishes: ✅ shipped 2026-09-01.* A material look layered on the die color:
     Matte / Satin / Glossy / Metallic (tinted from color) / Pearl (clearcoat+sheen) / Marbled
     (procedural swirl, tinted from color; triplanar-UV'd so it reads on the polyhedra too).
     Rides in `props.finish` (`DICE_FINISHES` in shared/pieces.js), per-player default in
     `ott-dice`, live-applied to tray dice via the `recolor` message (now carries `finish`).
     Pickers: per-die in the inspector, and all-my-dice in the tray controls.
   - *Phase 2 — custom textures: ✅ shipped 2026-09-02.* A host uploads a seamless image
     (editor → Add to Library → Dice Textures → `/upload?kind=dice`) into the reusable
     `custom_dice` library (migration 012, mirrors `custom_skyboxes`; host-only `saveDice`,
     public `listDice`). A die wears it via `finish:'custom'` + `finishImg` (a local
     `/assets/dice/` URL), synced on spawn/recolor and validated by `colorProps`/`dieSpawnProps`.
     Rendered as a triplanar map (async per-face composite on the d6), phone-safe (plain map, not
     in the fallback set). Applied from a dedicated **Custom** picker (sparkle) in the inspector
     and dice box; per-player default carries the texture. Phone fallbacks for GPU-heavy finishes
     are intentional. Image-backed custom finishes are not offered for the modeled pipped d6s.
   - *Pipped d6: ✅ shipped 2026-09-02.* Two built-in dice — Rounded Pips + Square Pips — as
     bundled `.glb` models (`DICE_MODELS`, `public/static_assets/models/pieces/dice/`), carried in `props.model`.
     A normal d6 for physics/value/collider; only the mesh differs. Body (`Ivory`) + pips (`Dots`)
     materials tinted by `color`/`textColor`, so they recolour like any die. Spawn from the dice
     box Add menu + the library built-in Dice tab (`dieModelPreviewURL`).
10. **Multi-select composition.** ✅ **shipped 2026-09-02** The selection tools support:
    1. Combine loose like cards into a **new deck** (discard pile → deck).
    2. **Merge two decks** — the inverse of the existing split.
    3. Gather dispenser-type objects into a **single dispenser**.
11. **More Room Customization.** ✅ **DONE** Lighting controls support direction, intensity,
    colors, shadow softness, presets, and owner-saved defaults; scenes can optionally include lighting.
    Skybox resolution: ✅ **shipped 2026-09-01** — a per-viewer off/low/medium/high/ultra control in
    Settings → UI → Graphics (a max equirect / cube-face width, downscaled at load; also disposed
    on switch). **Higher-resolution custom sources are supported:** Ultra keeps the uploaded
    source's native resolution. The 25 bundled skies are 2048×1024, so High and Ultra match on
    those assets. Replacing bundled artwork is optional content work, not unfinished resolution support.
12. **Graphics/Video Settings.** ✅ **Shipped** — three fill-rate tiers (low/medium/high;
    pixel ratio + shadow-map size + AA), device-defaulted (phone → Low, tablet → Medium,
    desktop → High) with an in-app control (Settings → UI → Graphics), a persisted per-device
    preference, and `?q=` /
    per-axis dev knobs. Driven by the first profiling pass (see §1). Skybox resolution (§11)
    is also shipped. Automatic device-based selection is complete; continuous FPS-driven tier
    adjustment is not implemented and was only a speculative extension, not a completion criterion.
13. ✅ **Persistent object labels (GM) — implemented; user reports manual tests passing.**
    **Labels…** in the right-click/touch menu creates, edits, or removes a label above an object.
    **L** edits the held/hovered object, including desktop cards whose right-click still flips.
    Labels follow movement and use saved, synchronized object props. Rendering follows object
    visibility; future GM-hidden objects (item 14) still require server-side concealment support.
14. **Hide individual objects from players (GM).** Add Hide/Reveal to the object's right-click
    menu and touch long-press menu. A hidden object remains visible to GMs as a translucent or
    ghosted object indicating its status; players cannot see or interact with it. Moving a hidden
    object must also conceal its pickup/held-by label and persistent label from players.
    Concealment must be enforced by server-controlled delivery, including reconnect and save/load,
    rather than only reducing opacity on a player's client. Coordinate with fog of war and GM
    staging; resolve collision and other indirect visibility cues during design.
15. **Player time-out mode (GM) — implemented; user-approved functionality and UI.** Temporarily stop a selected player from interacting with
    tabletop objects while allowing them to observe. Provide a clear GM control to apply and
    lift the restriction, and make the restricted state clear to the player. Explore temporarily
    using the same viewing-only permissions as spectator mode (item 5); implement both together
    if they share a clean boundary. Enforce restrictions server-side, handle any active grab when
    time-out begins, and preserve the player's identity and recoverable inventory when it ends.
16. ✅ **Player avatar placard styling — presets implemented; appearance user-approved.**
    Settings → Placard offers feminine/masculine bodies, two dog and two cat silhouettes, frog
    and gecko, with six patterns and two colors. Choices save per account across rooms/tabs;
    avatar faces, readable names and seat-color outlines remain. See [implementation notes](DESIGN_placards_sounds.md).
17. **Mini-whiteboard / notecard objects — drawing, zoom/pan and private hands implemented; stack extension implemented, user-tested and approved.** Give players a drawable physical object for games
    such as Telestrations: card-like handling, but a larger surface and greater mass than a normal
    card. Inspect opens a drawing surface; players can then place the board face-up or face-down
    and pass it around the table. Support mouse and touch drawing, retain artwork with the object
    through saves, and preserve concealed faces through inspection and transfer. Define editing
    and viewing access explicitly; this is a physical game component, not automated game rules.
    The first version provides private freehand editing, one editor per card, face-up/down placement,
    saved artwork, local zoom/pan, account-owned hands, private passing and compact Tabler controls.
    Approved finite stacks now support private top-card editing/return, draw, shuffle, split and
    combination; the user confirmed the notecard work functions correctly and approved it for commit.
    Paper styles and line/rectangle/ellipse helpers are implemented with approved UI, keyboard drawing,
    and automated regression coverage; the user confirmed it works great and approved it for commit. See [implementation and QA notes](DESIGN_notecards.md).
18. **Custom asset collections — implemented locally; functionality and UI user-approved.** Let users group multiple custom library assets into named
    collections. Library controls can show or hide collections to keep browsing manageable.
    Treat this as library organization/filtering, separate from per-object visibility on the table
    (item 14), and preserve each asset's access permissions.
19. **Collection and custom asset export/import.** Export individual custom assets or whole
    collections and import them into another installation. Include the required files and
    metadata, preserve collection membership, and plan for versioning, duplicate handling, and
    remapping internal references. Keep these portable asset packages distinct from live game
    snapshots containing player data. Design the package format alongside collections (item 18).
20. **Physical rulebooks and rulebook builder.** Add built-in rulebooks for selected games as
    spawnable 3D objects; Inspect opens their contents for reading and page navigation. Support
    uploaded/custom rulebooks from ordered image series, multipage PDFs, or Markdown files.
    Provide a dedicated rulebook-builder modal, similar in scope to the custom collider builder,
    with Markdown authoring/editing and page previews. Preserve source content and page order;
    image/PDF imports need a reading path without assuming they become editable Markdown.
    Include rulebooks in the custom library and plan their collection/export support. Choose
    built-in content with appropriate distribution rights and record its sources and licenses.
21. **Player inventories, persistent per room.** Let players move tabletop objects into a
    personal inventory and later place them back on the table. Store inventory by player account
    and room so it survives disconnects, reconnects, and room saves/restarts. Preserve the object's
    properties and any contained cards/items; storing and respawning transfers the object rather
    than duplicating it. A blocked placement must leave the inventory item recoverable. Define
    access and visibility rules, and keep player inventories out of portable scene templates.
22. **Browse through a deck — implemented locally; user reports manual tests passing.** GM-only by
    default, with a GM-set per-deck toggle for active players. Browse cards privately one by one.
    Each inspected card offers **Add to hand**, **Place face-up**, **Place face-down**,
    **Put on top of deck**, and **Put on bottom of deck**. Provide desktop and touch browsing
    controls. Reuses inspection and card-transfer behavior with expiring private leases, conflict
    guards and recoverable transfers. See the deck browsing checkpoint in
    [DESIGN_next_features.md](DESIGN_next_features.md#deck-browsing-checkpoint--2026-09-24).
23. ✅ **Prominent low-stock labels — implemented; user reports manual tests passing.** GMs use
    **Labels…** on decks, tile decks, and finite dispensers to choose a full quantity and percentage.
    A gold remaining-count label appears strictly below that threshold. The reference is explicit
    and stays fixed through refills; splits copy the source deck settings, combines use the
    lowest deck's settings, and dispenser gathers use the first selected stack's settings.
    Unlimited dispensers do not offer stock warnings.
    Labels share item 13's rendering and persistence; future hiding must enforce server visibility.
24. ✅ **Highlight an object for the table — implemented; user reports manual tests passing.**
    Middle-click a piece while nothing is held, or choose **Highlight** from its desktop/touch
    menu, to show everyone a pulsing halo for 3.2 seconds. Repeating refreshes one halo per object;
    it follows movement without changing materials, selection, or physics. Held-piece rotation
    and empty-table pings retain their gestures. Server requests validate live object IDs and
    throttle repeats. Input/server regressions and browser lifecycle/menu coverage exercise the
    feature. Future hidden-object, spectator, and time-out work must integrate this communication
    action with its visibility/permission policy; those modes are not implemented yet.

---

## Parked threads (finish-what-we-started)

Small, concrete, each completes an existing feature:
- ✅ **Finish the server split — recorded complete 2026-09-10.** Schema definitions, deck
  builders, starter setup, and focused room operations now have modules under `server/game/`.
  `server.js` retains room classes and orchestration. The architecture note above is the earlier
  checkpoint, not a request to repeat completed extractions.
- ✅ **Hex grids - DONE (confirmed by Ben).** The grid now offers a **hex** style beside square:
  `snapToCell` snaps to hex centres and `gridMesh` draws the hex lattice, pointy- or flat-top via
  the new `RoomScale.hexOrient` (hex size = `cellWorld`), with `calibrateGrid` fitting hexes to a
  board by count. Snap and render share the axial math in `shared/pieces.js`, so the client preview
  and the server authority agree. Built on the 0.9.0 hex-tile groundwork (pointy-top mesh + 6-gon
  collider), which drops onto the grid cleanly. Decoupled from **table shape** (backlog item 1,
  since shipped).
- ✅ **Multi-cell footprints — DONE.** Uploaded 3D objects can declare a 1–12 cell N×N footprint.
  Odd square footprints retain the configured centre/crossing phase; even footprints swap phase to
  sit between their two middle lattice anchors. Larger hex footprints remain hex-centred. The
  shared snap helper drives client drag previews and every server snap/pin path.
- **Free-drag group rotation** — ✅ **DONE via WASD, arrow keys, and two-finger mobile controls.**
  Multi-select rotates in 45° steps; the grab-and-spin handle remains deferred polish
  (`DESIGN_multiselect.md`).
- **Scrabble scoring / Mahjong scoring** — ✅ **CLOSED — not in scope.** The table stays
  physical-first and the scorepad tallies; this is a decision, not an oversight.
- ✅ **Tile shuffle/flip sounds — implemented; user-approved.** Three synthesized
  tile flips and three box-shake shuffles now use the existing audio manager and mute/volume
  preferences. Paper card cues remain distinct; mixed flips emit one cue per material.
- **Cross-file util module** — `api()`, the button factory and the auth-token read are still
  duplicated across `public/`. Re-verified 2026-09-01: `rows.js` now owns a shared `makeButton`
  that `client.js` imports (partial progress on the button-factory half), but `api()` is still
  copied in `admin.js` and `landing.js`, `landing.js` keeps its own `mkBtn`, and the token read
  (`localStorage.getItem('tabletop.token')`) is still inline in both `client.js` and `graphics.js`.
  A real extraction, scoped in `UI_backlog.md`.
- ✅ **Tile/box sound provenance — resolved.** The project owner confirmed the `tile-*.ogg`
  and `tiledeck-*.ogg` cues were created with Claude for Open Tabletop and are distributed as
  CC0. No third-party attribution is required; `docs/ASSET_CREDITS.md` records their provenance.

## Deliberately out (for now)

Recorded so they don't get re-proposed without the reasoning:
- **Dice-roll log** — dropped by design; verification is by reading the dice (see `DESIGN_dice_tray.md`).
- **Voice / video** — groups bring their own; out of scope.
- **Rules automation / enforcement** — against the physical-first principle (no word validation, no
  legal-move checks, no auto-scoring).

## References

`DESIGN_tiles.md`, `DESIGN_grid_snap.md`, `DESIGN_dice_tray.md`, `DESIGN_multiselect.md`,
`DESIGN_dispensers.md`, `DESIGN_measurement.md`, `RELEASING.md`, `UI_backlog.md`, `CHANGELOG.md`.
