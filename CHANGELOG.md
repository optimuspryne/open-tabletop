# Changelog

All notable changes to Open Tabletop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [RELEASING.md](RELEASING.md) for what each version bump means and how releases are cut.

## [Unreleased]

### Added
- **Per-room measurement scale** — a durable, GM-set display/snap layer
  (`worldPerUnit` + freeform `unitLabel` + `roundStep`, plus reserved grid fields)
  over the fixed world scale. Calibrate from the current table width or a unit
  preset. Groundwork for the forthcoming measurement + templates tools; nothing is
  drawn yet.
- **Measurement helpers** (`shared/pieces.js`) — `formatMeasure` and `roundToStep`,
  the pure functions that turn a world distance into a display label; shared by both
  sides so a measurement reads identically everywhere.
- **Measure tool + templates** — a Tools-menu **📏 Measure** mode with a shape picker:
  drag on the table to lay a **ruler** (distance), **circle** (radius/burst), **cone**
  (range), or **line** (lane), each labelled in the room's unit via the measurement
  scale. These are flat, non-physics **overlays** synced to everyone. All four kinds run
  through one `OVERLAY` registry and a single "press A, drag to B" gesture.
- **Overlays persist + are bounded** — placed overlays now ride the scene snapshot, so a
  GM checkpoint, the auto-save-on-empty, and saved library scenes all restore them
  (as table-owned, GM-managed). Per-room and per-player caps keep the map bounded.
  Clearing is scoped: everyone gets **Clear mine**; a GM also gets **Clear all**.

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

[Unreleased]: https://github.com/optimuspryne/open-tabletop/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.2.0
[0.1.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.1.0
