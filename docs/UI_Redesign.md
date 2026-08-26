# Open Tabletop — Table UI Redesign

Prototype (desktop + mobile, responsive, non-functional): `table-ui-prototype.html`.

## Why

Too many floating pop-out modals: cluttered, hard to access, and they force a constant fight between the mobile and desktop layouts — because a floating popout has no natural *collapsed* form, so every panel needs bespoke mobile handling.

**The fix:** dock everything into fixed edge clusters; buttons "hamburger" open into **shared anchored regions** (one region per cluster). A region is a sidebar-style overlay on desktop and a full-width bottom sheet on mobile — but the *same* open/close state and the *same* gated content underneath. Design the behavior once; the breakpoint reshapes it. **One responsive component set, not two UIs.**

## Status — as built (August 2026)

Phases 1–5 and the polish pass are **shipped**; phase 6 is **6a/6b done, 6c (mobile) outstanding**. What landed, and where it deviated from the design below:

- **Phases 1–2 (shared-region primitive + cluster migration): done.** `wireCluster(region, hams, opts)` is the primitive; Chat/Notes (top-left), Score/Music/Measure/Timer (top-right), and Interactions (bottom corners) all run on it, with floating-popout code deleted as each landed.
- **Phase 3 (Room Settings modal): done** — translucent tabbed modal with **Table Size & Color / Scale & Grid / Whiteboard** tabs. **No Skybox tab:** skyboxes are handled by the Library, so the standalone Skyboxes popout was removed outright rather than folded in.
- **Combined Library modal (added, beyond plan):** the custom-library and built-in-content modals merged into **one** `#libraryModal` — source toggle All / Custom / Built-In, GM-gated boards/sky/scenes/games tabs.
- **Phase 4 (Room Info dock + roster merge): done, no server touch.** Took the **two-section** path, not the `session → userId` map: everyone sees the live roster; GMs get a separate GM-only `#memberSection` (pending/offline + admit/kick/promote + unclaimed) below it, with the pending pulse relocated to the dock. Room Notes moved into the dock. `#me` self-editor kept through this phase.
- **Phase 5 (gating): done** — accreted across phases 2–4 (each cluster/modal inherited its gate on migration): Library → Helper+, GM Controls → GM+, Add/Save-Scene → Admin, Whiteboard → GM (via Room Settings), Room Notes → GM+, roster → GM+.
- **Polish pass (post-5):**
  - **Your Turn pill** (`#turnBtn`) — merged the turn indicator + Next Turn into one clickable pill, emphasized on your turn.
  - **Top-right identity box** — glassy `#identityBar`: Your Turn + avatar + **static name** (`#myName`, lobby-set, no table editor; avatar stays click-to-edit). This is where phase 5's "static name / editable avatar" actually landed.
  - **Room Info dock** — the old `#rightRail` split into `#rightStack` (positioning column) holding the identity box + a glassy `#roomInfo` dock (collapse glyph + title + code; Players / Room Notes / Members sections; collapses to just the header).
  - **Tools removed entirely** — How to Play moved to the top-left nav, Chat/Notes to a sub-row beneath it, the Tools menu + hamburger deleted.
  - **Real room name** — the back-end added `roomName` to synced `State`; the dock title reads it, falling back to owner-derived "⟨Owner⟩'s Table" when empty (workshop room / unnamed).
- **Phase 6:** **6a** Show/Drop flank the hand (`#handRow`, gated by hand presence) — done. **6b** seat cluster mirrored into both corners (`#hamBarRight`; `wireCluster` made side-aware to open the region toward center) — done. **6c** mobile pass — **outstanding** (separate track).
- **Dead-CSS sweep:** batch 1 (Tools) + batch 2 (removed modals/popouts + old rail) done; a few harmless mixed `.panel.resizable` selectors intentionally left.

The rest of this document is the original design intent, kept for rationale; read it against the status above where the two differ.

## Core model: cluster ↔ shared region

- A **cluster** is a group of buttons that shares **one** anchored expand region.
- **Within a cluster:** one open at a time (accordion); clicking the active button collapses it.
- **Across clusters:** independent on desktop (e.g. top-left Chat and top-right Music can be open at once). On **mobile** this collapses to one sheet at a time.
- Regions overlay the table **on demand** (not permanent docks). The only permanent chrome is the button rows + the Room Info dock — so the table's usable area isn't permanently reduced.
- This **generalizes patterns already in the code**: the Tools/Interactions mutually-exclusive hamburgers (`client.js` ~L973) and Music's collapse-toggle. Evolution, not a from-scratch paradigm.

## Desktop zones

- **Top-left** — buttons: Lobby, Settings, How to Play. Hamburgers (shared region): **Chat**, **Notes**.
- **Top-center** — **GM Controls** (menu, GM+). **Library** (hamburger region, Helper+) — its own cluster next to GM/Admin.
- **Top-right** — hamburgers (shared region): **Score, Music, Measure, Timer** (Timer shows its live value in the button when collapsed). **Your Turn** button (glance-able turn indicator + click to advance). **Avatar + username** (click avatar → small editor).
- **Right dock — Room Info** (permanent, collapsible to just Name + Code): Room Name + Code, **Player Roster** (merged — see below), **Room Notes** (GM-editable). Sizes to its content; scrolls if it ever exceeds the viewport (not full-height).
- **Bottom corners** (both sides, top-to-bottom): **Dice Box** (button → jump to dice box), **Multi-Select** (button → toggle), **Interactions** (the only hamburger here → My Seat / Lean In; opens to the side so the group stays tucked in the corner).
- **Bottom-center — Hand**, with **Show Hand** / **Drop Hand** hamburgers flanking it (pop up, clear of the hand; each expands its options — Show's audience picker, Drop's face-up/down).

## GM Controls menu (revised)

Current menu: Members, Scenes, Save Table, Edit Table, Scale/Grid, Skyboxes, delete.

- **Remove Members** → the roster + admit/kick/promote + unclaimed-hands reassignment + the pending-to-join **pulse** all move to **Room Info**.
- **Fold** Edit Table + Scale/Grid + Skyboxes into the new **Room Settings** modal (one menu item).
- **Add:** **Whiteboard** (opens Room Settings → Whiteboard tab), **Add To Library** (Admin only), **Save Scene** (Admin only).
- **Net menu:** Scenes, Save Table, **Room Settings**, Add To Library (admin), Save Scene (admin), Delete. (Save Table and Save Scene intentionally coexist — different things.)

## Room Settings modal (new archetype)

A **third modal type**: visually like the library modals (sits on top, takes focus, tabbed) but **semi-transparent** so the table/grid stays visible while adjusting — the see-through *is* the live preview (drag a control, watch the table update underneath). It's the library `modalCard` + `wireTabs` + `wireDialog` stack plus a translucent variant — small, low-risk addition, not a new system.

- **Tabs:** Table Size & Color, Scale & Grid, **Whiteboard** (show + style + location — GM-only), Skybox.
- Replaces the individual Scale/Grid, Edit Table, Skyboxes popouts **and** the Whiteboard config popout.
- **Stretch (deferred):** a per-tab table-preview render — redundant with see-through, and a 2nd WebGL viewport is the costly part. Only if plain transparency proves insufficient.

## Roster merge (into Room Info)

Two feeds today: **live public players** (`room.state.players` — everyone already sees seat/name/avatar/turn/role) and the **DB member list** (GM-only — pending/offline members + the `userId` for actions).

- **Unified roster:** everyone sees the live roster; **GMs additionally** see pending/offline members, admit/kick/promote, and unclaimed-hands reassignment. The gating falls out for free — the extra data is already GM-scoped.
- **Join wrinkle:** the public player carries no `userId`, so a GM's Kick/Promote can't link a seated row to an account. **Clean fix:** server sends GMs a `session → userId` map (GM-only; no `userId` exposed publicly). *Alternative (no server change):* two sections in one dock, not a true dedupe. → **As built: the two-section alternative shipped** (no server map); the live roster and the GM member section sit as separate blocks in the dock.
- The **pending-to-join pulse** relocates here (off the GM Controls button).

## Gating rules (⚠ = behavior change from what ships today)

- **Library** (browse/spawn): **Helper+** (Helper / GM / Owner / Admin). ⚠ currently broader.
- **GM Controls** menu: **GM+**.
- **Add To Library / Save Scene**: **Admin** only.
- **Whiteboard** show/style/location/move: **GM-only** (Room Settings → Whiteboard tab); **drawing stays open to everyone** once a GM puts it up. ⚠ currently any player can toggle/move it.
- **Room Notes** editing: **GM+** (notes move out of the Scoreboard modal, where they live today).
- **Roster actions** (admit/kick/promote): **GM+**.

## Names & avatars

- **Name:** static at the table (account-set, from the lobby). No table name editor. ⚠ currently editable via the rail's `#nameInput`.
- **Avatar:** still editable — click the top-right avatar to open a small editor. (The rail's `#me` block — `#nameInput`/`#avatarInput`/editable `#myAv` — is removed.)

## Mobile collapse (per zone)

Same components, reshaped by the breakpoint:

- **Top clusters** → a single **☰ menu** (drawer) listing the grouped items; each opens as a **full-width bottom sheet**, **one at a time** (the deliberate break from desktop's "two at once").
- **Room Info** → a top-bar button → bottom sheet.
- **Bottom seat clusters** → one floating **seat button** → popover (Dice Box / Multi-Select / My Seat / Lean In).
- **Show/Drop hand** → stay flanking the hand.
- **Persistent** (always visible): the **Your Turn** indicator, the **avatar**, the **Timer** value, and the **Hand**.

## Whose-turn

"Your Turn" is a top-right button — a glance-able indicator **and** the advance-turn control. Stays persistent on mobile (top-bar pill), so turn-based games never lose the always-visible cue.

## Build phases

Staged deliberately — each is independently testable and shippable, so this never becomes a scary all-at-once rewrite. Touches `table.html` structure, a big chunk of `client.js` panel wiring, the `wireDialog` model, and a couple of server bits.

1. **Shared-region component primitive** — ✅ **done.** `wireCluster` built; Notes migrated first as the proof.
2. **Migrate the remaining clusters** — ✅ **done.** Chat → top-right tools → corner Interactions, deleting floating-popout code as each landed.
3. **Room Settings modal** — ✅ **done.** Table Size & Color / Scale & Grid / Whiteboard tabs. Skybox folded to the Library instead (no Skybox tab).
4. **Room Info dock + roster merge** — ✅ **done, without the server touch** — used the two-section roster (no session→userId map). Pending-pulse + room-notes moved to the dock.
5. **Gating changes** — ✅ **done.** whiteboard → GM, library → Helper+; static-name / editable-avatar landed in the polish pass (top-right identity box).
   - *(Polish pass, added after 5: Your Turn pill, glassy identity box, glassy Room Info dock + `#rightStack` rename, Tools removal, real room name, dead-CSS sweep.)*
6. **Mobile pass + real-device testing** — ⬜ **outstanding.** (6a Show/Drop-flank-hand and 6b right-corner mirror shipped; 6c mobile is the remaining track.)
