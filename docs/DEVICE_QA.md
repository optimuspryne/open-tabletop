# Device QA Checklist

Manual, on-device QA for the gesture surface — the half a test can't do. `docs/GESTURES.md` is
the inventory of every gesture and whether a finger can reach it; `scripts/device-matrix.mjs`
proves the right *layout* renders per device automatically. What neither can judge is how a
control **feels** on real hardware — long-press delay, twist sensitivity, whether a throw lands
where your hand meant. That's what this list is for: pick up each device and run its section top
to bottom.

**How to use it**
- A checkbox means *the gesture is reachable and does the right thing* on that device.
- ⚠️ marks a spot where **feel** is the point, not just pass/fail — linger on those.
- The *Feel notes* lines are for ergonomics: too fast, too twitchy, hard to reach with a thumb.
- Anything that fails or feels off → note it against the matching row in `docs/GESTURES.md`, so
  the ledger stays honest.

Run it per release, or whenever a gesture or a layout branch changes.

---

## iPhone — Safari (WebKit)

*Phone viewport → **sheet** layout, coarse pointer, **compact logo mark**. The tightest screen, so watch thumb reach on the radial menu and edge clusters. WebKit is where the nastiest touch bugs have lived — test double-tap and the whiteboard claim especially hard here.*

#### Layout sanity (the automated matrix covers this — just eyeball it)
- [ ] Chrome is **bottom-sheet** style: corner regions and menus slide up from the bottom, full-width, not floating desktop panels
- [ ] Logo is the **compact mark**
- [ ] Any full-screen modal's **✕ is reachable** — not tucked under the browser's address bar (Safari's bottom bar can eat the last strip of screen)

#### Camera — *feel: does the view go where your hand expects?*
- [ ] One finger on empty felt **orbits**
- [ ] Two fingers **pan**
- [ ] Pinch **zooms** (and doesn't fight the two-finger pan)
- [ ] Press-and-hold empty felt sends a **ping** everyone can see
- [ ] Interactions → My Seat / Bird's Eye / Lean In·Out move the camera
- Feel notes: ______________________________________________

#### Picking things up — *feel: float height, throw, pick-up responsiveness*
- [ ] Touch-hold-drag **picks up and moves**; letting go while still moving **throws**
- [ ] ⚠️ The held piece floats at a **comfortable height under your fingertip** (it's lifted 15% vs the mouse — right amount?)
- [ ] Edge **Raise / Lower** buttons appear while holding and work
- [ ] Double-tap a piece **inspects** it; tap away closes
- Feel notes: ______________________________________________

#### Turning a piece (two fingers) — *feel: this is the gesture that should feel *better* than a mouse*
- [ ] ⚠️ Second finger down + **twist** rotates the held piece, snapping to 15° — sensitivity and dead-zone feel right?
- [ ] **Pinch** those two fingers raises/lowers; twist + pinch together, piece stays put under your fingers
- [ ] ⚠️ Edge **⟲ / ⟳** nudge a piece or selection, hold to repeat (~7.5°/tick) — too fast / too slow?
- Feel notes: ______________________________________________

#### The press-and-hold menu — *feel: long-press delay, arc placement, thumb reach*
- [ ] Press-and-hold any piece raises the **radial menu**, arced around your finger
- [ ] Items are correct per kind: Flip / Take (cards), Roll (dice), Draw / Shuffle / Split (decks), Dispense (dispensers)
- [ ] Every piece also offers Inspect, Stand / lay flat, Snap to grid, Delete
- [ ] On a deck/dispenser, **Move** — press it and keep dragging carries the whole thing
- [ ] ⚠️ Long-press delay feels right (not so short a drag triggers it, not so long it feels stuck)
- Feel notes: ______________________________________________

#### Cards & decks
- [ ] **Tap** a table card takes it to hand
- [ ] **Tap** a deck takes its top card; **drag off** a deck draws the top card
- [ ] **Double-tap** a deck peeks; the place buttons put it face-up / face-down / to hand / back
- [ ] Tap vs long-press don't get confused (no accidental menu on a quick tap)
- Feel notes: ______________________________________________

#### Your private hand — *feel: the one/two-finger rule has no on-screen hint*
- [ ] Hand sits at the bottom, only you see it; others see a face-down fan at your seat
- [ ] **One-finger** drag out lands **face-down**
- [ ] ⚠️ **Two-finger** drag out lands **face-up** — and adding/lifting a finger mid-drag flips it before it lands
- [ ] Hide hand / Show hand buttons
- Feel notes: ______________________________________________

#### Working with several pieces
- [ ] **Select** tool on → drag felt **boxes** a selection; tap **toggles** pieces
- [ ] Dragging any selected piece brings the **whole group**
- [ ] Selection toolbar: Stand / lay flat, Snap, Flip, Roll, Take, Delete
- [ ] ⚠️ ⟲ / ⟳ turn the formation continuously — note that an exact 45° isn't landable by finger
- Feel notes: ______________________________________________

#### Whiteboard & tools
- [ ] ⚠️ When a GM has the board out, **double-tap** it takes control (this was the WebKit silent-fail bug — verify hard)
- [ ] Draw with a finger; pen / eraser / clear controls work
- [ ] Release control (tap away / the release control)
- [ ] Measure tool opens and closes
- Feel notes: ______________________________________________

**Anything that failed or felt wrong → note it against the matching row in `docs/GESTURES.md`.**

_Tested: build/version ____________ · date ____________ · by _____________


---

## iPad — Safari (WebKit)

*Tablet viewport → **sheet** layout (forced by the coarse pointer even though it's well over 900px wide), coarse pointer, full **wordmark**. This is the profile the wide sheet bound was written for. The two-finger twist / pinch transform has the most room to shine here — judge it in both portrait and landscape.*

#### Layout sanity (the automated matrix covers this — just eyeball it)
- [ ] Chrome is **bottom-sheet** style: corner regions and menus slide up from the bottom, full-width, not floating desktop panels
- [ ] Logo is the full **wordmark**
- [ ] Any full-screen modal's **✕ is reachable** — not tucked under the browser's address bar

#### Camera — *feel: does the view go where your hand expects?*
- [ ] One finger on empty felt **orbits**
- [ ] Two fingers **pan**
- [ ] Pinch **zooms** (and doesn't fight the two-finger pan)
- [ ] Press-and-hold empty felt sends a **ping** everyone can see
- [ ] Interactions → My Seat / Bird's Eye / Lean In·Out move the camera
- Feel notes: ______________________________________________

#### Picking things up — *feel: float height, throw, pick-up responsiveness*
- [ ] Touch-hold-drag **picks up and moves**; letting go while still moving **throws**
- [ ] ⚠️ The held piece floats at a **comfortable height under your fingertip** (it's lifted 15% vs the mouse — right amount?)
- [ ] Edge **Raise / Lower** buttons appear while holding and work
- [ ] Double-tap a piece **inspects** it; tap away closes
- Feel notes: ______________________________________________

#### Turning a piece (two fingers) — *feel: this is the gesture that should feel *better* than a mouse*
- [ ] ⚠️ Second finger down + **twist** rotates the held piece, snapping to 15° — sensitivity and dead-zone feel right?
- [ ] **Pinch** those two fingers raises/lowers; twist + pinch together, piece stays put under your fingers
- [ ] ⚠️ Edge **⟲ / ⟳** nudge a piece or selection, hold to repeat (~7.5°/tick) — too fast / too slow?
- Feel notes: ______________________________________________

#### The press-and-hold menu — *feel: long-press delay, arc placement, thumb reach*
- [ ] Press-and-hold any piece raises the **radial menu**, arced around your finger
- [ ] Items are correct per kind: Flip / Take (cards), Roll (dice), Draw / Shuffle / Split (decks), Dispense (dispensers)
- [ ] Every piece also offers Inspect, Stand / lay flat, Snap to grid, Delete
- [ ] On a deck/dispenser, **Move** — press it and keep dragging carries the whole thing
- [ ] ⚠️ Long-press delay feels right (not so short a drag triggers it, not so long it feels stuck)
- Feel notes: ______________________________________________

#### Cards & decks
- [ ] **Tap** a table card takes it to hand
- [ ] **Tap** a deck takes its top card; **drag off** a deck draws the top card
- [ ] **Double-tap** a deck peeks; the place buttons put it face-up / face-down / to hand / back
- [ ] Tap vs long-press don't get confused (no accidental menu on a quick tap)
- Feel notes: ______________________________________________

#### Your private hand — *feel: the one/two-finger rule has no on-screen hint*
- [ ] Hand sits at the bottom, only you see it; others see a face-down fan at your seat
- [ ] **One-finger** drag out lands **face-down**
- [ ] ⚠️ **Two-finger** drag out lands **face-up** — and adding/lifting a finger mid-drag flips it before it lands
- [ ] Hide hand / Show hand buttons
- Feel notes: ______________________________________________

#### Working with several pieces
- [ ] **Select** tool on → drag felt **boxes** a selection; tap **toggles** pieces
- [ ] Dragging any selected piece brings the **whole group**
- [ ] Selection toolbar: Stand / lay flat, Snap, Flip, Roll, Take, Delete
- [ ] ⚠️ ⟲ / ⟳ turn the formation continuously — note that an exact 45° isn't landable by finger
- Feel notes: ______________________________________________

#### Whiteboard & tools
- [ ] ⚠️ When a GM has the board out, **double-tap** it takes control (this was the WebKit silent-fail bug — verify hard)
- [ ] Draw with a finger; pen / eraser / clear controls work
- [ ] Release control (tap away / the release control)
- [ ] Measure tool opens and closes
- Feel notes: ______________________________________________

**Anything that failed or felt wrong → note it against the matching row in `docs/GESTURES.md`.**

_Tested: build/version ____________ · date ____________ · by _____________


---

## Android phone — Chrome (Blink)

*Phone viewport → **sheet** layout, coarse pointer, **compact logo mark**. Blink, so this is the cross-check against the two WebKit devices: anything that behaves differently here vs iPhone is worth a note. Chrome's collapsing address bar is the classic `dvh` trap for the modal ✕.*

#### Layout sanity (the automated matrix covers this — just eyeball it)
- [ ] Chrome is **bottom-sheet** style: corner regions and menus slide up from the bottom, full-width, not floating desktop panels
- [ ] Logo is the **compact mark**
- [ ] Any full-screen modal's **✕ is reachable** — not tucked under the browser's address bar — Chrome's address bar collapses on scroll, the classic dvh trap

#### Camera — *feel: does the view go where your hand expects?*
- [ ] One finger on empty felt **orbits**
- [ ] Two fingers **pan**
- [ ] Pinch **zooms** (and doesn't fight the two-finger pan)
- [ ] Press-and-hold empty felt sends a **ping** everyone can see
- [ ] Interactions → My Seat / Bird's Eye / Lean In·Out move the camera
- Feel notes: ______________________________________________

#### Picking things up — *feel: float height, throw, pick-up responsiveness*
- [ ] Touch-hold-drag **picks up and moves**; letting go while still moving **throws**
- [ ] ⚠️ The held piece floats at a **comfortable height under your fingertip** (it's lifted 15% vs the mouse — right amount?)
- [ ] Edge **Raise / Lower** buttons appear while holding and work
- [ ] Double-tap a piece **inspects** it; tap away closes
- Feel notes: ______________________________________________

#### Turning a piece (two fingers) — *feel: this is the gesture that should feel *better* than a mouse*
- [ ] ⚠️ Second finger down + **twist** rotates the held piece, snapping to 15° — sensitivity and dead-zone feel right?
- [ ] **Pinch** those two fingers raises/lowers; twist + pinch together, piece stays put under your fingers
- [ ] ⚠️ Edge **⟲ / ⟳** nudge a piece or selection, hold to repeat (~7.5°/tick) — too fast / too slow?
- Feel notes: ______________________________________________

#### The press-and-hold menu — *feel: long-press delay, arc placement, thumb reach*
- [ ] Press-and-hold any piece raises the **radial menu**, arced around your finger
- [ ] Items are correct per kind: Flip / Take (cards), Roll (dice), Draw / Shuffle / Split (decks), Dispense (dispensers)
- [ ] Every piece also offers Inspect, Stand / lay flat, Snap to grid, Delete
- [ ] On a deck/dispenser, **Move** — press it and keep dragging carries the whole thing
- [ ] ⚠️ Long-press delay feels right (not so short a drag triggers it, not so long it feels stuck)
- Feel notes: ______________________________________________

#### Cards & decks
- [ ] **Tap** a table card takes it to hand
- [ ] **Tap** a deck takes its top card; **drag off** a deck draws the top card
- [ ] **Double-tap** a deck peeks; the place buttons put it face-up / face-down / to hand / back
- [ ] Tap vs long-press don't get confused (no accidental menu on a quick tap)
- Feel notes: ______________________________________________

#### Your private hand — *feel: the one/two-finger rule has no on-screen hint*
- [ ] Hand sits at the bottom, only you see it; others see a face-down fan at your seat
- [ ] **One-finger** drag out lands **face-down**
- [ ] ⚠️ **Two-finger** drag out lands **face-up** — and adding/lifting a finger mid-drag flips it before it lands
- [ ] Hide hand / Show hand buttons
- Feel notes: ______________________________________________

#### Working with several pieces
- [ ] **Select** tool on → drag felt **boxes** a selection; tap **toggles** pieces
- [ ] Dragging any selected piece brings the **whole group**
- [ ] Selection toolbar: Stand / lay flat, Snap, Flip, Roll, Take, Delete
- [ ] ⚠️ ⟲ / ⟳ turn the formation continuously — note that an exact 45° isn't landable by finger
- Feel notes: ______________________________________________

#### Whiteboard & tools
- [ ] ⚠️ When a GM has the board out, **double-tap** it takes control (this was the WebKit silent-fail bug — verify hard)
- [ ] Draw with a finger; pen / eraser / clear controls work
- [ ] Release control (tap away / the release control)
- [ ] Measure tool opens and closes
- Feel notes: ______________________________________________

**Anything that failed or felt wrong → note it against the matching row in `docs/GESTURES.md`.**

_Tested: build/version ____________ · date ____________ · by _____________


---

## Desktop — mouse + keyboard

*Desktop viewport → **floating / movable** panels, fine pointer, full **wordmark**. The precise-pointer baseline: this is where right-click menus, Alt/Shift rotation, the keyboard sliders and wheel-to-raise all live.*

#### Layout sanity
- [ ] Panels are **floating / movable** (drag one out to float it); no bottom sheets
- [ ] Logo is the full **wordmark**

#### Camera
- [ ] Left-drag empty felt **orbits**; right-drag **pans**; wheel **zooms**
- [ ] Middle-click empty felt (or **P**) **pings**
- [ ] Interactions buttons move the camera

#### Pieces
- [ ] Left-click-hold + drag **picks up / moves**; release while moving **throws**
- [ ] **Wheel** while holding raises / lowers
- [ ] **W** / **S** (or ↑ / ↓) raise / lower, repeating while held
- [ ] **Alt** + drag rotates in 15° steps
- [ ] ⚠️ **Alt + Shift** + drag = smooth, unsnapped rotation (the only truly free rotation anywhere — confirm it still is)
- [ ] **Middle-click** while holding rotates 45°
- [ ] **A** / **D** (or ← / →) rotate ~7.5°, repeating while held
- [ ] **Double-left-click** inspects
- [ ] **Delete** removes, **U** stands/lays, **G** toggles snap
- [ ] **Right-click** any piece but a card raises its menu; **right-drag** still moves

#### Cards & decks
- [ ] Left-click a card **takes** it; right-click **flips** it
- [ ] Left-click a deck takes the top; left-drag off it **draws** the top
- [ ] Right-click a deck → Shuffle / Split / Draw / **Move** (press and keep dragging out); right-drag also moves it
- [ ] Double-click a deck **peeks**; **F / D / H / R** place the card

#### Your hand
- [ ] Left-drag / click a card out lands **face-down**; right-drag / click lands **face-up**
- [ ] ▾ / 🃏 hide / show the hand

#### Selection
- [ ] **Shift + drag** empty felt marquees; **Shift + click** toggles a piece
- [ ] **U / G / F / R / H / Delete** act on the group (and the #sel toolbar buttons)
- [ ] ⚠️ **[** / **]** rotate the formation ∓45° in one action; **A / D** / ← / → step ~7.5°

#### Whiteboard & tools
- [ ] Double-click the board **claims** control; **Escape** releases; drawing works
- [ ] Measure tool opens; Escape / close exits

_Tested: build/version ____________ · date ____________ · by _____________


---
