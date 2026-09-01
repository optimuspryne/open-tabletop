# Changelog

All notable changes to Open Tabletop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [RELEASING.md](RELEASING.md) for what each version bump means and how releases are cut.

## [Unreleased]

### Added
- **A two-finger transform on touch.** While you hold a piece, a second finger turns the gesture
  into a photo-editor transform: the **angle** between your fingers rotates the piece, the
  **distance** between them raises and lowers it. Both are free because the camera is already
  disabled during a hold, so two fingers there were not pan/dolly. The twist is 1:1 — turn your
  fingers 45° and the piece turns 45° — where the mouse's Alt-drag maps horizontal pixels to an
  angle at a tuned rate. It snaps to the same 15° the mouse uses, which doubles as the dead zone
  that stops a stray finger nudging a piece. This closes the last gesture that had no touch path
  at all.
- **Every piece's menu on right-click.** The long-press menu was touch-only; a mouse reached each
  piece's verbs as one hard-coded action per kind — and *nothing whatsoever* for a prop or a
  board. Right-click now raises the same list a finger does, for every kind but a card, whose
  whole vocabulary (take, move, flip) is shorter than the menu that would replace it. Right-drag
  is untouched, so a deck or dispenser still moves that way.
- **Move, dragged straight out of the menu.** The menu's Move item used to arm the *next* drag:
  tap it, dismiss the menu, find the deck again, drag that. Press it now and the piece comes with
  you in the same gesture. It exists because a plain drag on a deck deals from it rather than
  moving it.
- **`W` / `S` / `A` / `D` and the arrow keys** raise, lower and turn whatever you are holding or
  have selected, repeating while held — a keyboard slider alongside the on-screen ▲▼ and ⟲⟳
  clusters, at the same rates.
- **Alt-drag rotation for a held piece.** Alt and a sideways drag turns it in 15° steps; add
  Shift for smooth, unsnapped turning.
- **The whiteboard says who has it.** The board's owner was synced state that nothing surfaced,
  so nobody could see it was in use and a second person double-clicking it got silence. It now
  shows "*name* is drawing" to everyone but the holder, and tells you who has it when you try to
  take a board someone else is using.
- **How to Play, rebuilt.** Four tabs — Mouse & Keyboard, Touch, Table & Tools, Coming Soon —
  styled like the library modals, with each named control carrying the Tabler icon that control
  actually shows. The previous panel mentioned touch **zero times**: every instruction was a
  click, a named mouse button, a wheel or a key, so a player opening the app on an iPad was being
  told in detail how to use a mouse. The radial menu, the Select tool, the height controls, the
  selection toolbar and the one-finger/two-finger hand rule were all shipped and all
  undocumented. The developer gesture ledger
  (`docs/GESTURES.md`) has been reconciled to match the rebuilt panel.
- **Colour swatches on library cards at every size.** The swatch run was `display: none` in short
  landscape, so colour choice was simply unavailable there. It sits behind a trigger now, reusing
  the existing pop-group pattern.
- **A train dispenser and train pieces** join the built-in props, alongside new lighting and
  texture-resolution knobs.
- **A device-layout test matrix.** `npm run test:devices` renders the table at seven device
  profiles in headless Chromium and asserts each lands in the right layout branch — bottom-sheet
  vs floating panels, the movable-panel pointer gate, the compact vs full logo, and the modal
  close staying on-screen. The two switches are on independent axes (viewport width and pointer
  type), so a regression that collapses them passes every phone and breaks every tablet; the
  matrix puts each in both states. Documented in `docs/DEVICE_MATRIX.md`; kept out of
  `npm run check`, like the input and component suites, since it needs a browser. A companion
  manual checklist, `docs/DEVICE_QA.md`, runs the on-device pass for the *feel* of each gesture
  that automation can't judge.
- **Physics/render profiling instrumentation.** `?perf=1` on the table URL (or
  `window.ottPerf(true)`) shows a client overlay read from `renderer.info` — FPS, frame ms, draw
  calls, triangles, geometry/texture/program counts, JS heap (`public/perf.js`). `PERF_LOG=1` makes
  the server log a per-second `world.step` time, awake-vs-total body count, and tick health
  (`TableRoom.update`). Dev-only, off by default, for the "plays well at real scale" work.
- **Graphics quality tiers.** Low / Medium / High presets that trade the fill-rate costs profiling
  flagged on tablets — pixel ratio, shadow-map size and soft/hard filtering, antialiasing. Coarse-
  pointer devices default to Medium and desktops to High; the choice is saved per device at
  Settings → UI → Graphics, with an **Apply & reload** button that commits the parts (antialias,
  and the pixel ratio on iOS) that need a fresh GL context. On an older iPad, Low holds 60fps.

### Changed
- **Piece cap raised 80 → 250.** Profiling showed the server shrugs off ~144 physics bodies, so
  the old limit was far more conservative than the simulation needs.
- **Shadows redraw on demand.** `renderer.shadowMap.autoUpdate` is off; the render loop refreshes
  the shadow map only on frames where a caster actually moved, so an idle table (even while the
  camera orbits) stops repaying the soft-shadow pass every frame. Groundwork for graphics tiers;
  dev fill-rate knobs (`?px` / `?shadow` / `?aa`, live `window.ottPixelRatio` / `window.ottShadow`)
  land with it. No params → unchanged defaults.
- **A finger-held piece starts 15% higher.** A finger sits *on* the piece it is holding where a
  cursor only points at it, so the float height that reads fine with a mouse left the piece under
  your fingertip on a tablet. Keyed off the gesture, not the device, so a laptop with a
  touchscreen gets the right lift for each grab.
- **The room code sits under the room name**, flush to the same left edge, rather than competing
  with it for one line.
- **Room Settings is now Table Settings**, and is where the whiteboard is shown and positioned.
- **Clearer library labels** — Card Decks/Tiles, Game Boards, 3D Objects, Pre-Built Games, and
  Image/Text Based Decks.
- **The mobile ⊕ fan names the buttons it proxies** — Dice Box, Library, Multi-Select.
- **A deck's right-click shortcuts moved into its menu.** Shuffle was the single right-click and
  Split the double; both are menu items now, which also means a deck's right-click no longer
  waits to find out whether a second one is coming.
- **Private notes follow your account, not your session**, so they survive a reconnect.

### Fixed
- **Drawing cards off a deck could exceed the piece cap.** `dealToTable` / `dealDrag` spawned a
  tile per draw with no cap check — the only paths that skipped it — so a whole deck (e.g. the
  144-tile Mahjong wall) could be dealt onto the table past the limit. Both now respect it.
- **A full table now says so instead of failing silently.** Deal, spawn, and hand-to-table were
  silent `break`/`return` at the cap; they now show a "Table is full" toast.
- **The "•••" menu on custom library assets did nothing.** Its group is shaped exactly like what
  the generic pop-out wiring claims, so two click handlers landed on one button: the first opened
  and portaled the menu, the second read it as already-open and shut it in the same tick. The
  button looked completely inert.
- **A two-finger transform could fling the piece.** The transform holds the piece still while
  your fingers travel, so lifting the second finger snapped the piece to where the first had
  drifted — and that jump landed inside the throw estimator's window, so the further you twisted
  the harder the throw. The drag re-anchors instead.
- **Double-tap did nothing on iPad and iPhone.** WebKit does not synthesize a `dblclick` from a
  double-tap the way Chrome does, so claiming the whiteboard — and every other double-click
  gesture — was silently unreachable on iOS and iPadOS.
- **Typing `d` in chat with a deck peek open dealt the card face-down.** The peek's F/D/H/R keys
  were handled above the guard that ignores keystrokes aimed at a text field.
- **Mobile and landscape modal overrides never applied.** A media query adds no specificity, so a
  later top-level `:is(#a,#b,#c)` block outweighed them at every viewport.
- **Toast and body text inherited the browser's default colour**, which was near-black on the
  dark theme.

### Removed
- **`S` no longer saves a hovered deck.** It collided with the new W/A/S/D bindings and opened a
  blocking prompt mid-gesture; saving lives in the Add to Library modal.
- **Save… is gone from the deck menu**, for the same reason.
- **Double-right-click no longer splits a deck** — Split is a menu item.

### Internal
- **`docs/GESTURES.md`** catalogues every gesture, its touch equivalent and a status, so a new
  gesture is added with its touch story decided rather than discovered on an iPad later. The
  roadmap had marked this done for a while without it existing.
- **Three browser harnesses**, none of which need a server or a database: `css-parity` snapshots
  every element across six viewports and three pages (and its `--lint` mode runs in
  `npm run check` with no browser at all); `test:input` drives synthetic pointers and keys at the
  input seam, where a whole path can be missing for one device family with nothing to show for
  it; `test:components` boots the real modules and snapshots the DOM the app *builds*, which the
  stubbed snapshots structurally could not see. All three run in CI.
- **The input seam** (`public/controls.js`) translates raw events into a device-agnostic intent
  vocabulary that `public/client.js` implements, so adding a device is a new profile rather than
  edits throughout the client. The touch profile now raises double-tap, the long-press menu, the
  two-finger transform and the held axis keys through it.
- **Pure modules pulled out of `client.js` for testability** — `rows.js` (chat, member, score,
  unclaimed and toast builders), `drag.js` (drag re-anchor maths) and `clicks.js` (what a click
  means, per kind and button).
- **A CSS pass**: dead rules and classes swept, every icon size derived from `--ico-size` tiers,
  declarations shadowed by a later identical selector removed, redundant id selectors replaced by
  a `.panel-title` class, and `css:lint` extended to catch dead ids as well as dead classes.

## [0.12.2] — 2026-08-28
- Fixed missing icon SVGs for whiteboard controls.  Changed icons used for show/hide hand view, 
  drop face up/down buttons and room info collapse toggle.

## [0.12.1] — 2026-08-28

### Added
- **A logo.** The lobby and admin top bars now carry the Open Tabletop wordmark
  (SVG, swapping to the compact "OT" mark under 560px), and every page picks up the
  mark as its favicon. The text brand it replaces is gone.

## [0.12.0] — 2026-08-28

A full pass over the table interface — the HUD, every pop-out pane, both library
modals, the lobby, the admin console, and a purpose-built layout for phones and
tablets. No server change: every message the new UI sends already existed.

### Added
- **Phones and tablets get their own layout.** Any touch device (and any window under
  900px) now drives the interface with **bottom sheets** instead of anchored overlays.
  A sheet has three drag stops — a **peek** that keeps a chat you're watching on screen
  with its composer still reachable, two-thirds, and full — and you throw it between them;
  a flick down dismisses it. One sheet at a time, and switching panes is the chip row in
  its header rather than close-then-open.
- **One top bar.** The bar now carries ☰, the room name, the running timer value, turn
  state, and your avatar — the room **code** moved into a new **Room info** sheet (with
  Copy and, where the browser offers it, Share), and the turn pill collapses to a caret
  when it isn't your turn.
- **A ☰ drawer** folds both top clusters into one grouped list — Open, Room, Table, and
  Leave in the footer. Every row is a proxy for the real button, so role gating and the
  chat unread badge come along unchanged.
- **A seat button and a ⊕ fan, on every device.** One round **seat** button replaces both
  bottom hamburger bars: seat actions first, the roster below, anchored to the button and
  flipped by the space actually available. **⊕** fans out Roll dice / Spawn / Select /
  Measure in an arc that always opens toward the middle of the screen, so a press in any
  corner keeps every item on screen. On touch, long-pressing a **piece** opens the same
  fan with that piece's own verbs.
- **A pull-up hand tray.** The hand became a tab that shows a fanned card edge and a count;
  pull it up for show-faces, your cards, and the drop pair stacked above each other, which
  is what keeps every target thumb-sized on a 392px screen.
- **Icon hints on touch.** Compact chrome is forced on touch devices, so icon-only buttons
  now teach themselves: long-press any of them for the same themed hint desktop gets on hover.
- **Long-press tips, source badges and a ••• curation menu in the library.** Every asset
  card states whether it's **custom** or **built-in**, keeps Spawn and Edit inline, and moves
  Clone / Publish / Rename / Delete into an overflow menu — a popover on desktop, a bottom
  sheet on touch that names the asset in its header and confirms Delete inline instead of
  firing a browser dialog. Publish states the current state rather than flipping its label.
- **Library search spans every tab.** A query now searches all panes at once, groups the
  results by kind, and puts hit counts on the tab chips; clearing it returns you to the pane
  you were in. Result rows keep each item's real primary action.
- **An Amount stepper on dispenser cards**, so a chip or coin stack's starting count is set
  on the card. The infinite Go bowl says so instead of showing a disabled control.

### Changed
- **The table HUD reads as three groups, not eight buttons.** Top-left is two pills (Add to
  Library and Save Scene moved into the GM menu; How to Play and Settings into a `•••`
  overflow; Chat and Notes went icon-only), and the tools cluster, identity pill and dock
  now stack as one right-hand column. Score / Music / Measure are icon-only — Timer keeps
  its label because that text is the live value.
- **Every pop-out pane shares one anatomy** — a header with a hairline and ✕, a body, and a
  pinned footer only where the pane has a persistent action. Chat gained **timestamps** and
  right-aligns your own messages; the scoreboard's − / value / + now read as one inline
  stepper per row.
- **Show and Drop lost their panels.** Showing cards is a latched strip of faces above your
  hand — tap a face to show it, tap again to stop — and Drop is two buttons with a toast.
- **The Library is a window, not a list.** Sticky header, one tab grammar, a segmented
  All / Custom / Built-In control, and a horizontal card per asset (preview, name, badges,
  controls, actions) so card heights match. On a landscape phone the three header rows
  flatten into one and cards go four across.
- **Add to Library shares that window.** The builder's six panes now sit under the same
  sticky header and tab grammar; the thickness / shape / padding rows are indented under
  the **Fit to image** toggle they belong to; the fronts drop target shows a real thumbnail
  grid with a count ("52 selected", "+45") instead of the first file's preview; and each
  pane's Save / Save + Spawn pair states where the asset lands.
- **Room Settings and Settings wear the same window** as the two library modals, so all four
  read as one family.
- **The lobby is three cards** — Create, Join, Available rooms — with owner row actions behind
  the same `•••` overflow, and the pending row shows its live "watching" state. The admin
  console's tables are themed, its pending count is a real badge, and storage cleanup reads
  Scan → Clean up.
- **Tablets keep full-width sheets** rather than a docked pane — a deliberate call, recorded
  in `docs/UI_Redesign_Phase7.md` with the rejected alternative.
- **Accent color means one thing.** Accent is now interactive-and-state (icons, the turn pill,
  active chips, hover borders, focus rings); surfaces, body text, dividers and card faces stay
  neutral. Danger keeps its own red at every accent.

### Fixed
- **The library's ••• menu no longer gets clipped.** It has to live inside the card's action
  row, which sits in a scrolling pane inside a window that hides its overflow, so it was cut
  off on the first and last rows. It's now placed as its own layer from the button's position,
  flipping above or below by available space.
- **The Measure pane says what the selected shape does again** — ruler reads distance, circle
  radius, cone its spread, line its lane width, with the angle and width read from the real
  config.
- **Scale & Grid stopped colliding with itself.** Long labels ("Objects Snap-To?") overflowed a
  fixed 78px column and painted over the controls beside them; labels now wrap, the pane's chips
  run at label size, and number fields cap their width. **Round to** no longer shows
  `0.10000000149` — the value arrives as a 32-bit float and is displayed at typing precision.
- **The "Scan for orphaned files" icon** (and any other icon added since the sprite generator
  broke — see Internal) renders instead of leaving a blank space.
- **A full-screen modal's ✕ is always reachable on a phone.** A centred card taller than the
  *visual* viewport (`100vh` excludes the URL bar) pushed its own header off the top of the
  screen. Modals now pin to the top of a `dvh`-measured viewport, and library cards go
  list-shaped in portrait so the modal stops outgrowing the screen in the first place.
- **The roster in the seat popover is legible** — it was inheriting a near-black text color from
  where it's borrowed.
- **Dock rows fit on one line.** A global `min-width: 4.5em` on action buttons, plus toolbar-sized
  icons inside a 270px dock, were breaking player and member rows onto three lines.

### Internal
- **`npm run build:icons` works again.** It located the existing sprite with a regex anchored on
  `<svg class="icon-sprite"`; once the pages were formatted by Prettier that tag spans several
  lines, the match failed, `.replace()` became a silent no-op, and every icon added to the list
  since then never reached a page — while the script still reported success. It now matches the
  tag whatever the formatting and **fails loudly** if a page comes out unchanged. `search` was
  also missing from the icon list.
- **A `data-icon` with no matching sprite symbol is now visible.** It logs which id is missing and
  draws a dashed placeholder instead of rendering nothing.
- **A symbol may declare its own paint.** `.ico` sets `fill: none; stroke: currentColor`, which
  silently blanked fill-based (Tabler *filled*) symbols; the wrapper now honours a symbol's own
  `fill` / `stroke` / `stroke-width`.
- **`overflowMenu` and `openActionSheet` moved into `public/icons.js`**, which the lobby, table
  and admin pages already share.

## [0.11.0] — 2026-08-26

### Security
- Validate and normalize every payload-bearing table WebSocket message before it
  reaches authorization, physics, room state, private hands, or database calls.
  Batch sizes, nested asset records, identifiers, strings, coordinates, velocities,
  colors, enums, and uploaded-asset references now fail closed instead of being
  coerced or partially accepted.
- Replace process-local IP rate limits with an atomic Redis token bucket shared by
  every app replica. Limits now expire automatically, return `Retry-After`, fail
  closed while Redis is unavailable, and resolve client IPs through an explicitly
  configured reverse-proxy hop count.

### Reliability
- Make saved-library reads distinguish successful empty/not-found results from
  PostgreSQL failures. Database outages now reject and produce an explicit library
  error for the requesting socket instead of silently rendering an empty library.
- Apply the same failure distinction to login/session lookup and admin user reads,
  so an outage cannot masquerade as invalid credentials, an expired session, an
  empty user list, zero pending hosts, or a user with no owned rooms.
- Propagate room, membership, join, member-list, and durable room-state query
  failures. An outage can no longer resemble a missing room/member, an empty lobby,
  a rejected join, or a room reset to default settings.
- Add a Colyseus message error boundary and apply it to asynchronous library
  handlers. Synchronous throws and promise rejections now receive structured safe
  logging plus a sanitized client error without disabling later room messages.
- Apply the Colyseus boundary to asynchronous membership operations and await
  member-list and lobby refreshes, so their failures are reported without becoming
  unhandled rejections or disabling later room messages.
- Extend the same boundary to movement, card/deck, and hand-reassignment message
  modules, containing unexpected physics and room-state exceptions while keeping
  subsequent socket messages operational.
- Show sanitized Colyseus `serverError` responses to the affected player, with
  client-side throttling so cascading failures cannot create an alert storm.
- Route every inline table message through the shared Colyseus boundary, so
  unexpected synchronous room-state and physics failures are logged, reported,
  and contained consistently with extracted and asynchronous handlers.
- Await avatar persistence, initial member-list delivery, cross-instance lobby
  notifications, and final room-state flushes. Detached lifecycle work can no
  longer reject silently, while join-time list failures use the sanitized client
  error boundary without ejecting the player.

### Changed
- Split the remaining major table-server systems into focused modules for saved
  library messages, piece and group operations, room state and settings, overlays
  and whiteboards, chat and sharing features, physics construction, and scene
  persistence. This substantially reduces `server.js` while preserving the
  existing network protocol and gameplay behavior.
- Make the database layer pool-injectable so production keeps its existing shared
  connection while tests and other consumers can provide an isolated PostgreSQL
  pool.

### Internal
- Add ESLint and Prettier configuration plus `lint`, `format`, `format:check`, and
  combined `check` scripts; reformat the codebase and resolve the resulting lint
  warnings.
- Add CI quality and dependency-security gates for linting, formatting, fast tests,
  lockfile validation, and production dependency auditing.
- Add a disposable PostgreSQL 16 integration suite that applies the production
  schema and least-privilege grants, exercises real database constraints and CRUD,
  and cleans up its isolated container automatically. CI runs the same suite
  against an ephemeral PostgreSQL service.

## [0.10.0] — 2026-08-26

### Breaking
- **Docker Compose now requires secret files.** Before upgrading with the bundled
  `docker-compose.yml`, create `secrets/db_owner_password.txt`,
  `secrets/app_db_password.txt`, and `secrets/admin_password.txt`; database passwords
  are no longer read from `DB_PASSWORD` and `APP_DB_PASSWORD` in `.env`. Run
  `npm run secrets:migrate` to copy the two existing database values safely, then
  create the administrator password file separately. Deployments using direct
  `DATABASE_URL` / `MIGRATE_DATABASE_URL` environment variables remain supported.

### Security
- Replace perpetual single-device login tokens with expiring, independently
  revocable sessions. Multiple devices can stay signed in concurrently, logout
  now invalidates the server-side credential, and existing tokens receive a
  30-day expiry during migration.
- Replace first-signup administrator promotion with explicit first-boot provisioning
  from a Docker-mounted password secret. Provisioning runs before the public listener,
  is transactionally locked, and only creates an account on an empty users table.
- Add local `admin:grant` and `admin:revoke` recovery commands; revocation refuses to
  remove the final administrator.
- Move both Docker Compose database credentials from `.env`/container environment
  variables into mounted secrets, including password-file connection support for
  the application and migration roles.

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
- **The table shows its room name.** The room's display name is now synced to every client
  (`state.roomName`), so the table page can label which table you're sitting at.
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

[Unreleased]: https://github.com/optimuspryne/open-tabletop/compare/v0.11.0...HEAD
[0.12.2]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.12.2
[0.12.1]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.12.1
[0.12.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.12.0
[0.11.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.11.0
[0.10.0]: https://github.com/optimuspryne/open-tabletop/releases/tag/v0.10.0
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
