# Changelog

All notable changes to Open Tabletop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [RELEASING.md](RELEASING.md) for what each version bump means and how releases are cut.

## [Unreleased]

## [0.6.0] — 2026-08-20

### Added
- **Dispensers — chip stacks, coin trays & Go bowls** — a new piece type that hands out
  uniform, public copies of an item, reusing the deck's interaction grammar: **left-click
  or left-drag deals one out** (a drag carries it, like dealing a card), **right-drag moves**
  the whole container, and **dropping a matching item back onto it returns it** (a finite
  stack grows; the bowl just takes it back). Spawn them from the **Built-In library →
  Dispensers** tab:
  - **Poker chips** and **Coins** — pick a colour (coins get a metals palette) and a
    starting amount; the stack is drawn from your chip/coin model stacked to match, and
    shrinks as you deal.
  - **Go bowl** — an unlimited bowl of stones in a team colour (black/white), from a
    bundled model.
  Double-click a dispenser to **inspect and recolour** it (a colour picker for chip/coin
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
  at the table now watches it form in real time (in the dragger's seat colour), not just
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

[Unreleased]: https://github.com/optimuspryne/open-tabletop/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.6.0
[0.5.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.5.0
[0.4.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.4.0
[0.3.1]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.3.1
[0.3.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.3.0
[0.2.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.2.0
[0.1.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.1.0
