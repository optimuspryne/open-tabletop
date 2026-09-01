# Device Matrix

The set of device profiles the table is expected to work on, and — for each — the layout
_branch_ it should land in. It exists for the same reason `docs/GESTURES.md` does: a whole
layout path can be wrong for one class of device and everything still looks fine on the
machine you happen to be testing on. GESTURES.md is the ledger of _what a finger can reach_;
this file is the ledger of _which layout each device gets_, and `scripts/device-matrix.mjs`
is the test that holds the code to it.

Read this with `public/styles.css` and `public/client.js`. Two media queries decide almost
everything about the chrome, and they are deliberately **not** the same query:

- **`SHEET_MQ` = `(max-width: 900px), (pointer: coarse)`** (`client.js:5299`, kept in step
  with the `.region, .sheet` rule at `styles.css:267`). When it matches, corner regions and
  menus become bottom **sheets** — full-width, bottom-anchored, rounded top corners. When it
  does not, they are floating desktop panels. The bound is wider than a phone and includes
  _any_ coarse pointer, so tablets and touch laptops get the touch layout rather than a
  desktop overlay they cannot place precisely.
- **`(pointer: fine)`** (`client.js:229`) gates the **movable/dockable** panels — the
  drag-to-float behaviour is desktop-only. A coarse pointer keeps the docked layout regardless
  of width.
- **`(max-width: 560px)`** (`styles.css:2060`) swaps the topbar **wordmark** (`.brandFull`)
  for the compact **mark** (`.brandMark`).

The important thing the matrix guards is that these are **three independent switches on two
axes** — viewport width and pointer type — and the code mixes them. A narrow desktop window
gets sheets but keeps movable panels; a wide tablet gets sheets _because_ it is coarse even
though it is far wider than 900px. A regression that collapses the two axes into one (e.g.
gating sheets on width alone) passes every phone test and breaks every tablet. So the matrix
is chosen to put each switch in both states independently of the others.

## Profiles

`sheet` = `SHEET_MQ` matches (bottom-sheet chrome). `fine` = `(pointer: fine)` matches
(movable panels). `mark` = compact logo (`≤ 560px`). `touch` = the profile is rendered with
touch emulation on, which is what makes the pointer coarse.

| Profile              |  W×H     | touch | sheet | fine | mark | What it proves |
|----------------------|----------|:-----:|:-----:|:----:|:----:|----------------|
| `desktop-1440`       | 1440×900 |   —   |   ✗   |  ✓   |  ✗   | The baseline desktop: floating panels, wordmark. |
| `laptop-1280`        | 1280×800 |   —   |   ✗   |  ✓   |  ✗   | Still docked/floating above the width bound. |
| `desktop-narrow-720` | 720×900  |   —   |   ✓   |  ✓   |  ✗   | Width clause **alone**: a narrow _fine-pointer_ window gets sheets, yet keeps movable panels (the two axes are independent). |
| `tablet-landscape`   | 1024×768 |   ✓   |   ✓   |  ✗   |  ✗   | Pointer clause **alone**: 1024px is well over 900, so only `pointer: coarse` can force the sheet layout here. The tablet regression the wide bound was written for. |
| `tablet-portrait`    | 820×1180 |   ✓   |   ✓   |  ✗   |  ✗   | Both clauses; portrait tablet, still a wordmark. |
| `phone-390`          | 390×844  |   ✓   |   ✓   |  ✗   |  ✓   | Phone: sheets, no movable panels, compact mark. |
| `phone-360`          | 360×780  |   ✓   |   ✓   |  ✗   |  ✓   | The narrow end of the phone range. |

`desktop-1440` and the `coarse-390`-shaped phone already exist as the two viewports in
`component-parity.mjs`; this matrix is the superset that also covers the tablet and
narrow-desktop corners where the two queries disagree.

## What the test asserts, per profile

`scripts/device-matrix.mjs` renders each profile against the real `public/` (no server, no
room needed — the layout switches are pure CSS + `matchMedia`) and checks:

1. **Sheet branch.** `matchMedia(SHEET_MQ).matches` equals the table's `sheet` column, **and**
   a real `.sheet` element actually got the bottom-sheet CSS (rounded top corners, bottom
   anchor). Asserting both catches the failure the `styles.css` comment warns about by name:
   `SHEET_MQ` in `client.js` and the media query in `styles.css` drifting out of step, so the
   JS thinks it is a sheet while the CSS lays it out as a panel or vice-versa.
2. **Movable-panel branch.** `matchMedia('(pointer: fine)').matches` equals the `fine` column
   — the switch that decides whether panels can be dragged out to float (`client.js:229`).
3. **Logo.** Exactly one of `.brandFull` / `.brandMark` is displayed, matching the `mark`
   column (`≤ 560px`).
4. **Modal reachability.** With the Add-to-Library modal revealed, its close (`✕`) button sits
   fully inside the viewport on every profile — the check that a full-screen mobile modal has
   not pushed its dismiss control off the top under a browser chrome / `dvh` gap.

A profile also fails if the page raised any uncaught error while loading, and if the seat
control (`#seatBtn`) is missing from the markup entirely.

## Running it

```
npm run test:devices
```

Needs a browser (it drives headless Chromium through `scripts/lib/headless.mjs`), so — like
`test:input` and `test:components` — it is **not** part of `npm run check`, which must keep
working on a machine with no browser.

## Scope

This matrix is about **which layout branch renders**, not about whether every gesture in that
layout is reachable by finger — that is GESTURES.md's job, and `test:input` is its automated
half. The two are complementary: this file stops a device from getting the _wrong_ chrome;
GESTURES.md / `test:input` stop the _right_ chrome from having a dead control. A genuinely new
device concern usually wants a row here **and** a look at both.
