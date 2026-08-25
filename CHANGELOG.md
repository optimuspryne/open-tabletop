# Changelog

All notable changes to Open Tabletop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [RELEASING.md](RELEASING.md) for what each version bump means and how releases are cut.

## [Unreleased]


### Accessibility
- Lobby forms now use real <form> semantics (Enter-to-submit, labelled
  fields), status messages announce via aria-live, and toggle buttons
  expose aria-pressed. Link-style controls and the avatar are now
  keyboard-operable.
- Admin console: real (non-nested) top-bar buttons, column headers
  scoped for screen readers, an aria-live status line for storage
  cleanup, and a page heading for structure.
- Add-to-Library editor modal: inputs now have associated labels /
  aria-labels, buttons are consistently typed, and the collider-shape
  controls are screen-reader legible.
- Add-to-Library editor modal is now a keyboard-operable dialog: focus
  moves in on open and returns on close, Escape closes it, Tab stays
  within it, and the type tabs are a proper ARIA tablist with arrow-key
  navigation.
### Added
- **Play cards from your hand in 3D.** Dragging a card out of your hand now shows the *real* card
  hovering over the table (replacing the old flat 2D ghost), so you can see exactly where it will
  land. It floats just above the felt so it clears boards and tiles (e.g. the Wordy grid) instead
  of sinking into them, and your hand hides while you drag so it never blocks the view. Release over
  the table to play it there.
- **Choose a card's face as you play it.** On touch, a **one-finger** drag or tap plays face-down
  and a **two-finger** drag or tap plays face-up (the hovering preview flips live as your second
  finger lands); on desktop, left plays face-down and right plays face-up.
- **Inspect a hand card.** Double-click a card (desktop) or tap its **eye** button (any device) to
  blow it up to a big, flippable view — handy when the cards are small and hard to read. From there
  you can send it to the table face-up / face-down or keep it in hand.
- **Scrollable hand.** A large hand keeps the cards full-size and scrolls, with **‹ ›** chevrons on
  each side (swipe works too on touch); it caps its width to stay clear of the on-screen controls.
- **Felt & grid-line color presets.** The felt and grid-line colors now offer quick preset swatches
  (greens/blues/reds/greys for felt; white/grey/black plus accents for lines) beside the freeform
  picker.
- **Interface sizing.** Two scale knobs — one for chrome (icons, controls, spacing) and one for text
  — drive the size of the whole UI, so it's larger and easier to tap, with the two tunable
  independently. Labels can be shown alongside icons via a full-interface mode.
- **Settings.** A new **Settings** button (top nav) opens a full library-style modal with tabs — **UI**
  (a Full/Compact label toggle and an accent-color picker, both saved on your device) and **Sounds**
  (volume + mute, plus a Credits & Licenses table).
- **Music player.** The Tools "Sound" item is now **Music**, opening a slim player docked top-right
  (play/pause, next, shuffle, pick track) that collapses to a single button.
- **Compact / full labels everywhere, and remembered.** A **Full labels** toggle now sits in the
  lobby next to Log out (alongside the in-room Settings toggle), and your choice is saved on the
  device and applied on every page — lobby, table, editor, and admin.

### Changed
- **The whole UI moved from emoji to a consistent icon set.** Buttons across the table, editor,
  lobby, and admin pages now use [Tabler](https://tabler.io/icons) SVG icons with a themed hover
  hint, replacing the emoji labels — clearer and far more compact on phones and tablets. The icons
  are MIT-licensed; see `docs/ASSET_CREDITS.md`.
- **Consistent icon rules.** The icon set now follows shared rules: trash buttons are red and
  text-free everywhere; play / pause / reset / set / visibility-toggle buttons drop their text
  automatically; visibility toggles (show hand, whiteboard) use eye / eye-off; the timer uses the
  player play/pause icons; and measure "clear mine / clear all" use eraser / trash.
- **Member management.** A GM can be demoted to Helper *or* straight to Player (with the correct
  down-arrow icons), and member buttons always show their labels — role icons alone were ambiguous.
- **Lobby.** The room-code field and Join button now share one row; each room's approval state reads
  **Gated / Open** in full mode; and the room "Close" button is a standard red trash button.
- **Removed the redundant top-nav "+Dice" button** to reclaim toolbar space — dice are added from the
  Dice Box tray. The Dice Box keeps its label; the individual d4–d20 add buttons stay text-free.
- **Right rail widened ~25%** so its contents aren't cramped at the larger UI scale.
- **Bottom-left tool bar is now a vertical stack** (Interactions / Tools above Multi-Select), with its
  menus opening upward, and the turn indicator resized to match the toolbar buttons.
- **GM Controls** uses a distinct `user-cog` icon (the plain gear now belongs to Settings).

### Fixed
- **The compact / full labels preference sticks now.** It used to revert to full after leaving and
  returning, and only ever applied inside a room. It now persists per device and is restored on every
  page load (the load-time apply moved to `equalize.js`, since an inline script was blocked by CSP).
- **Dragging a card from your hand works on mobile.** The touch drag is now bound to the finger that
  started it (a second finger no longer fakes a drag), and a leftover-preview bug that could stick a
  card image on screen until refresh is gone.
- **Double-tapping the UI no longer zooms the page** on iOS / iPad (pinch-zoom still works).
- **The hand no longer slides under the bottom-corner controls** before it becomes scrollable.

### Internal
- **Icon build tooling.** `npm run build:icons` regenerates the inline SVG sprite in every page from
  a single icon list (`scripts/build-icons.mjs`) — adding an icon is a one-line edit, no hand-editing
  four HTML files.
- **Shared icon module.** `public/icons.js` holds the icon helpers (`applyIcons` / `setIcon` / hover
  hint) once; `client.js` and the lobby/admin scripts import it instead of keeping their own copies.

## [0.9.0] — 2026-08-22

### Added
- **Image decks fit their art — no crop or stretch.** Building an image deck with **Fit to image**
  on sizes the cards to the uploaded art's aspect ratio (portrait, landscape, or square), so tall or
  wide card designs are no longer cropped to a standard rectangle or padded with bars. The shape is
  saved with the deck and the whole stack takes it. Built on the same card-geometry system as tiles.
- **Tiles (Dominoes) + variable card geometry.** Cards can now be *tiles* — a card with its own
  footprint and thickness — via a shared `cardGeom` resolver that both the mesh and the physics
  collider read (so they never disagree). First payoff: a **Dominoes** starter game — a shuffled
  28-tile boneyard dealt 7 to each seated player's hand; play tiles from your hand onto the table
  and build the chain by hand (humans enforce the rules, scorepad tallies). The same geometry hook
  (`props.geom`) is what will let custom image decks match their art's aspect ratio (no crop/stretch).
- **One-click starter games.** A new **Games** tab in the built-in library sets up a whole game
  in a click (GM+): **Chess** and **Checkers** with every piece placed on the board, **Go** with
  a board and two stone bowls, and a **Poker night** with a deck and colored chip stacks. Loading
  one clears the table first. Their grids snap but stay hidden (see below).
- **Hide-grid toggle.** A grid can now snap pieces without drawing its lines — a **Hide grid
  (still snaps)** toggle in the Grid controls. Starter games use it by default.
- **Stand toggle on spawn cards.** Object spawn cards (built-in **and** custom) get a **⬆ Stand**
  toggle next to Snap: on spawns the piece in its natural pose (upright for tall pieces, flat for
  discs), off lets it tumble free.
- **Complete 54-card deck.** The deck now offers **Standard 54 (with Jokers)** alongside the 52,
  with a rendered joker face (one red, one black).
- **Custom dice colors with saved defaults.** Double-click a die to inspect it and set its
  **body** color — from a row of preset swatches or the freeform picker — and the **numbers
  auto-contrast** (dark or light) to stay legible. Hit **Set as my default** to remember that
  color for that die type (saved on your device only, like your accent), so every d? you spawn
  afterward comes up in your color; **Reset** forgets it. In your tray, the **Set** swatches
  recolor all your dice to a matching **named set** (Ivory, Bone, Onyx, Ruby, Emerald, …) in one
  click. A die's color is a shared property — everyone sees "your" dice — and rides scene save/load.
- Named dice sets live in `shared/pieces.js` (`DICE_SETS`) — edit or add your own.
- **Recolor a whole multi-selection.** With pieces selected, a **Recolor selection** bar appears
  and shows the palette the selection has in common — the general palette for dice/general props,
  the metals palette if you've selected only coins, or a team's two sets if you've selected only
  that team's pieces. One click recolors them all (dice numbers auto-contrast). If the selection
  mixes incompatible palettes (say a coin and a token), the bar greys out as unavailable. Cards
  and boards are ignored. Completes the multi-select batch ops.
- **Palette swatches in the recolor panel** for props and chip/coin stacks — the same colors
  as the spawn-card palette (now shared in `shared/pieces.js` as `PALETTE`), so recoloring an
  object is a click, not just the freeform picker. Each object offers only the colors it's meant
  to wear: **team pieces** (checkers, chess, go stones) pick between their two set colors, **coins**
  are limited to the metals palette, and general props keep the full palette plus the freeform
  picker. The constraint is enforced server-side, so it holds through group recolor too.
- **Tile games: Dominoes, Wordy McWordface, and Mahjong.** The card system now drives full tile
  games — each a one-click **Games** starter (and spawnable on its own from the library):
  - **Dominoes** — a shuffled double-six boneyard, 7 tiles dealt to each seated player's hand.
  - **Wordy McWordface** (a legally-distinct word game) — a 15×15 letter board with premium
    squares, a 100-tile letter bag, and a 7-tile rack per player. Played tiles **snap to the
    board's cells**.
  - **Mahjong** — the full 144-tile wall (characters, bamboo, circles, winds, dragons, flowers,
    seasons), dealt 13 to each hand. Faces are bundled art composited onto ivory tiles.
- **A procedural board framework.** Boards can be drawn from data instead of a `.glb`: a `BOARDS`
  entry with a `proc` painter (see `BOARD_PAINTERS` in `public/graphics.js`) renders its top on a
  canvas. Wordy McWordface's premium grid is the first; battlemaps and other grids are just another
  painter + entry, and everything (swapBoard, collider, grid calibration, library preview) keys off
  the same registry.
- **Custom card/tile shapes.** A fit-to-image deck can pick a silhouette — **Rounded**, **Square**,
  or **Hexagon**. Hexagons are true regular pointy-top hexes with a **matching 6-gon physics
  collider** (ready for future hex grids); the deck stack and hand preview take the shape too.
- **Custom card/tile thickness.** A thickness slider on fit-to-image decks, from a thin card to a
  chunky tile — a thick tile renders as a rounded solid with real sides.
- **Deck skins (modeled draw piles).** A deck can wear a 3D bag/box model instead of the card stack
  while still functioning as a normal draw pile (draw/deal/shuffle/hidden order unchanged) — see
  `DECK_MODELS` in `shared/pieces.js`. Dominoes, Wordy, and Mahjong deal from a **bentwood box**.
- **Single-click a deck to draw to your hand.** Left-*click* a deck now takes its top card straight
  into your hand; left-*drag* still deals to the table, right-click shuffles, double-left inspects.
- **Tile sound effects.** Tiles clack and their wooden boxes thunk — dominoes / word tiles / mahjong
  and their decks get their own drop and pickup cues, distinct from the paper card/deck sounds.

### Changed
- **Left-click on a deck draws to your hand** instead of dealing to the table (left-drag still
  deals) — the quick way to pull a tile or card for yourself.
- **A deck conforms to its cards exactly** — same footprint, same corner (a true circular arc, not
  a boxy Bézier), and same shape (rect or hex) — so the stack hugs the card silhouette on top
  instead of sitting inside a fixed, slightly-larger box.

### Fixed
- **Image-deck cards match their art.** Cards render thin at the uploaded image's exact dimensions
  and rounded corners (read from the art's own transparency), with no dark corner chunk and no
  thick cream frame.
- **Hexagon tiles are real hexagons.** They render as regular pointy-top hexes — they previously
  read as octagons, from a flat-top mesh whose thick side walls added apparent edges — aligned to
  their collider.
- **Draw-to-inspect shows the right shape.** Peeking the top of a tile deck previews the tile at its
  real proportions, not a standard card.
- **Saved scenes keep a tile deck's box skin** — reloading a room no longer reverts the box to a
  stacked deck.
- **Go's grid lines up** with its printed board, and **starter-game pieces spawn placed** — chess
  no longer scatters across the board on setup.

## [0.8.0] — 2026-08-21

### Added
- **Dice trays — personal rolling boxes.** Each seat gets its own walled tray on the track
  *behind* that player, so you can roll without disturbing the board. Press **🎲 Roll Dice** to
  hop your camera down into your tray (it appears the first time you do); add **d4–d20** from the
  tray toolbar, throw them by hand or hit **Roll all**, **Scoop** to re-rack, **Clear**, or **Put
  away**. The box is fully enclosed (an invisible lid) so nothing bounces out, and every tray is
  public — anyone can glance over and read your dice, the way they would at a real table. Trays
  and their dice ride scene save/load, and clear when a player leaves.
- **Multi-select.** Select several pieces at once — **Shift**-click to toggle, **Shift**-drag (or
  the new **⬚ Select** tool) to marquee-box a group; they highlight in your own accent color
  (private to you). Then act on the whole group:
  - **Drag** any selected piece to move the whole formation together.
  - **Delete** removes them all; **`[`** / **`]`** rotate the formation ±45°.
  - **U** stand/lie-flat, **G** snap-to-grid (toggled as a unit); **R** rolls every selected die,
    **F** flips every selected card, **H** takes every selected card into your hand.

### Changed
- **Dice are sized (and their numbers scaled) from single knobs, colliders included.** `DIE_SCALE`
  resizes every die — mesh *and* physics collider, d6 included — and `DIE_GLYPH` sets number
  legibility, so there are no hand-entered collider boxes to keep in sync. Dice now read a touch
  smaller and clearer by default.
- **Dispensed stacks tumble.** Poker-chip and coin stacks now sit at slightly varied facings
  (seeded per dispenser) instead of machine-perfect alignment, so a stack looks stacked by hand.

### Upgrading
- Nothing to do — the new state (personal trays, tray dice) rides the existing room/scene JSON,
  so there's no migration. Pull `0.8.0` and restart.

## [0.7.0] — 2026-08-20

### Added
- **Grids & snap-to-grid** — a GM can lay a **square grid** over the table surface, and
  pieces snap to it. The grid is set up from the new **Scale & Grid** pop-out (Room
  Controls → **📐 Scale & Grid**):
  - **Snap is a per-piece flag**, just like *stand-upright*: press **G** on a held piece
    to toggle it, and every piece carries a **Snap** toggle in its spawn card (default
    **on** for grid games — Go, checkers, chess — and **off** for everything else). A
    snapped piece locks to its cell in X/Z and then falls to the surface, and once it
    settles it's **pinned** so a bump can't nudge it off-grid.
  - **Snap to cell centers or intersections** — a per-grid choice, so stones can sit on
    the crossings of a Go board while checkers sit inside the squares.
  - **Fit a grid to a board** — type how many cells the board is across and hit **▦ Align**;
    the grid sizes and lines itself up to that board, including **rectangular cells** (Go's
    slightly taller-than-wide grid) and a **grid offset** for nudging it into place.
  - **Appearance** — the grid's **line color** and its **height** above the felt are both
    adjustable.
- **Image boards keep their proportions** — uploading a battlemap now **locks its aspect
  ratio** and fills in the board's width × depth from the image's own proportions, so maps
  no longer come in stretched. You can still resize; the ratio holds.

### Changed
- **Customize Table is now two movable pop-outs.** The old modal split into a slim
  **Customize Table** (width, depth, felt) and a dedicated **Scale & Grid** panel (unit
  calibration and all the grid controls). Both are draggable, so you can slide them aside
  while lining a grid up against the board.
- **Scenes now capture scale & grid.** Saving a scene records the room's measurement unit
  and calibration *and* its full grid layout — cell size, offset, snap anchor, line color,
  and height — alongside the table, pieces, and overlays, so a saved board comes back
  measured and gridded exactly as you left it.
- **Calibration is inline** — setting a measurement scale or fitting a grid to a board now
  happens in the panel itself instead of a browser prompt.
- **Middle-click nudges facing by 45°** (was 90°), for finer aiming of directional pieces.

### Upgrading
- Nothing to do — the grid and scale settings ride in the existing `scale` JSON on a room,
  so there's no new migration. Pull `0.7.0` and restart.

## [0.6.0] — 2026-08-20

### Added
- **Dispensers — chip stacks, coin trays & Go bowls** — a new piece type that hands out
  uniform, public copies of an item, reusing the deck's interaction grammar: **left-click
  or left-drag deals one out** (a drag carries it, like dealing a card), **right-drag moves**
  the whole container, and **dropping a matching item back onto it returns it** (a finite
  stack grows; the bowl just takes it back). Spawn them from the **Built-In library →
  Dispensers** tab:
  - **Poker chips** and **Coins** — pick a color (coins get a metals palette) and a
    starting amount; the stack is drawn from your chip/coin model stacked to match, and
    shrinks as you deal.
  - **Go bowl** — an unlimited bowl of stones in a team color (black/white), from a
    bundled model.
  Double-click a dispenser to **inspect and recolor** it (a color picker for chip/coin
  stacks, a black/white toggle for the bowl); every item it dispenses afterward inherits
  the change.
- **Hover count** — mousing over a deck or dispenser shows a small readout of how many are
  left inside (`∞` for a Go bowl), updated live as pieces are dealt or dispensed.

### Changed
- **The custom `open-tabletop-db` image is retired.** Deploy against stock `postgres`
  (or any managed Postgres) — the app builds and migrates its own schema now, so the only
  one-time setup is creating the least-privilege `tabletop_app` role. The compose file does
  that automatically; Portainer stacks inject it as an inline `config` (or run a short SQL
  snippet once). Existing deployments on the old db image keep working unchanged.

### Fixed
- The compose/Portainer role setup now also sets `ALTER DEFAULT PRIVILEGES`, so tables
  created by future migrations are automatically readable/writable by `tabletop_app`
  (previously only tables that existed at first DB init were granted).

## [0.5.0] — 2026-08-19

### Added
- **Automatic schema migrations** — the app now applies any pending database migrations
  itself on startup (tracked in a `schema_migrations` table), so upgrading no longer needs
  a manual `psql -f` step: `docker compose pull && up` catches the database up on its own.
  Migrations run as a separate owner/DDL role via `MIGRATE_DATABASE_URL` — the running
  server keeps its least-privilege role — and work against any Postgres (the bundled db
  image, stock Postgres, or a managed instance). Set `AUTO_MIGRATE=false`, or leave
  `MIGRATE_DATABASE_URL` unset, to keep managing migrations by hand.

### Upgrading
- Set **`MIGRATE_DATABASE_URL`** to an owner/DDL connection string — the compose file now
  does this for you (`postgresql://tabletop:${DB_PASSWORD}@db:5432/tabletop`). On first
  boot the app records your existing schema as the migration baseline (nothing is replayed)
  and applies anything new from then on. **No manual `psql` step and no database-image
  rebuild** — for this release or future schema changes. To keep the old manual workflow,
  set `AUTO_MIGRATE=false` or leave `MIGRATE_DATABASE_URL` unset. Upgrade sequentially from
  releases older than 0.4.0.

## [0.4.0] — 2026-08-19

### Added
- **Live measurement previews** — when someone drags out a ruler or template, everyone
  at the table now watches it form in real time (in the dragger's seat color), not just
  see it appear on release.
- **Move & delete individual overlays** — click a ruler/template you placed (or any, as
  a GM) to select it, drag to reposition it, and press **Delete** to remove just that one
  (**Esc** deselects). Previously overlays could only be placed or cleared en masse.

### Changed
- **The Library Editor now shares the game table's full interface** — the same Tools
  (Measure, Scoreboard, Sound, Timer, Notes, Chat, Whiteboard) and movable/resizable
  pop-out panels, plus the streamlined Customize Table, so building assets looks and
  behaves exactly like sitting at a table (minus the player-facing How-to-Play).

## [0.3.1] — 2026-08-19

### Fixed
- Floating panels no longer stretch to the full width of the screen, and their resize
  grip is always reachable — the docked full-width rule was leaking into the popped-out
  state.
- The Measure panel's contents no longer clip into its rounded corner (it was the one
  pop-out with no padding of its own).

### Changed
- **Every pop-out panel is now resizable** (previously only Chat, Notes, and the
  Whiteboard panel), and panels reflow their contents as you resize: button rows become
  even grids and list/log panels grow their content instead of leaving empty space.
  Titled pop-outs also get consistent padding by default.
- **Customize Table** was streamlined into labelled sections, with Width × Depth on one
  row, inch/cm/mm **plus a Custom** unit as toggle buttons, themed input fields, and
  controls that cap and centre in a wide panel instead of stretching edge-to-edge.
- **The Tools menu** is now a compact two-column grid instead of one tall column.

## [0.3.0] — 2026-08-18

### Added
- **Measurement & templates** — a new **📏 Measure** tool (Tools menu). Set a per-room
  unit scale — calibrate from the current table width or an inch/cm/mm preset — then drag
  on the table to lay a **ruler** (distance), **circle** (radius/burst), **cone** (range),
  or **line** (lane), each labelled in your unit. These flat, non-physics **overlays** sync
  to everyone and ride the save/scene snapshot, so a GM checkpoint, the auto-save-on-empty,
  and saved library scenes all restore them. Placement is bounded by per-room and
  per-player caps, and clearing is scoped — everyone gets **Clear mine**; a GM also gets
  **Clear all**.
- **Movable & resizable panels** — on desktop, drag any pop-out panel (Measure, Chat,
  Notes, Timer, Scoreboard, Whiteboard, Sound, Members, …) by its title bar to place it
  anywhere, and drag its corner to resize it to taste. Your layout is remembered
  per-browser, and **↺ Reset panel layout** (Tools menu) re-docks everything. Touch
  devices keep the fixed docked layout.

### Upgrading
- **Existing self-hosted databases:** this release adds a `scale` column to `rooms` via a
  migration that is **not** auto-applied. Run it once against your database before (or
  right after) upgrading:
  `psql -U tabletop -d tabletop -f postgres/010_room_scale.sql`
  It's safe and idempotent (`ADD COLUMN IF NOT EXISTS`). Fresh installs get it automatically
  from the baked schema — no action needed.

## [0.2.0] — 2026-08-17

### Added
- **Resumable games** — a saved or auto-saved table now restores the whole
  in-progress game, not just the visible pieces. Deck order, face-down card faces,
  and each player's private hand all survive a reload; hands rebind to their owner's
  account when they rejoin, and a GM can reassign a hand whose owner doesn't return
  from the Members panel. A turn held by an absent player shows as "waiting on
  {name}" until they return or the GM advances.

### Fixed
- Face-down cards no longer come back face-up when a scene or saved game is reloaded.
- A card drawn to inspect at the moment of a save is folded back onto its deck
  instead of being lost.

## [0.1.0] — 2026-08-17

Initial public release.

### Added
- **Multiplayer physics core** — server-authoritative simulation (Colyseus + cannon-es)
  with a Three.js client; pieces are real rigid bodies you grab, drag, throw, and stack.
- **Piece system** — boards, cards, decks, dice (d4/d6/d8/d10/d12/d20), timers, and
  arbitrary 3D props/tokens, built on a generic "kind vs instance" model so new pieces
  can be added.
- **Rooms & lobby** — create or join games by code with capacity limits, on a per-room
  configurable table (resizable size, skybox, felt color, default spawn pieces) chosen
  at room setup and durable across restarts.
- **Game Master role** — the first joiner is GM and can spawn/delete pieces, advance
  turn order, and close the room, with succession to the next player if they leave.
- **Cards, decks & hands** — front/back textures, flip, shuffle, split, deal to table,
  deal-drag, private per-player hands, play from hand, take to hand, and dump-hand.
- **Custom assets** — upload custom card textures and 3D models (with a per-model
  "stands upright" self-righting toggle), created in a dedicated editor.
- **Scenes** — admin-curated library setups (e.g. chess, checkers, poker night)
  capturing table + board + pieces, loaded by the GM as a full replace.
- **Durable room extras** — a per-room scoreboard, GM-only room notes, and a shared
  whiteboard; the scoreboard and notes survive restarts and are exempt from table Reset.
- **Accounts & admin** — user accounts with device tokens; the first account to sign up
  becomes admin; an admin console for managing users and assets.
- **Audio** — sound effects that fire on real physics impacts (a dropped piece thuds
  when it actually lands), random sound-variant pools per action, per-channel volume
  and mute, and a background music player with an in-app credits panel.

### Security
- Parameterized SQL throughout; scrypt password hashing with constant-time comparison;
  256-bit device tokens stored as SHA-256 hashes.
- Enforced Content-Security-Policy, rate limiting on auth and upload endpoints, and a
  least-privilege database role for the application.

### Deployment
- Docker Compose stack (app + Postgres) with multi-arch images published to Docker Hub,
  a Portainer-friendly configuration, and a custom Postgres image that bakes in the
  schema and role initialization.

[Unreleased]: https://github.com/optimuspryne/open-tabletop/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.9.0
[0.8.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.8.0
[0.7.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.7.0
[0.6.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.6.0
[0.5.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.5.0
[0.4.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.4.0
[0.3.1]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.3.1
[0.3.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.3.0
[0.2.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.2.0
[0.1.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.1.0
