# DESIGN — Back-end DRY & quality audit

**Scope:** the back-end surface only — `server.js`, `db.js`, `auth.js`, `migrate.js`,
and the authority-facing half of `shared/pieces.js`. Front-end files
(`public/client.js`, `graphics.js`, `core.js`, the HTML/CSS/UI scripts) are out of
scope by the "two worlds" split.

**Audited against:** `main` @ `6f8ad31` (the tree after the test-suite commit).
Test baseline at time of audit: `node --test` → **61 pass, 0 fail**.

**Nature of this doc:** a standing refactor checklist, not a feature spec. Nothing here
is urgent or user-visible; it's debt to pay down *before* the next feature lands on top of
it, so we don't end up changing one thing in four places. Line numbers are as-of the audited
tip and will drift — each item is anchored on a symbol name so it stays findable.

**Priority legend:** `P1` clear win, low risk, do first · `P2` worthwhile · `P3` optional /
judgment call.

---

## 0. Clean bill — what's already right (record, don't touch)

- **The physics/authority boundary is genuinely clean.** The client does not run a parallel
  cannon-es world; only `credits.js` (an easter-egg) touches CANNON, and the single `norm()`
  in `client.js` is a separate 2-D helper, not a copy of the server's 3-D one. The server is
  the sole physics authority, as designed. **No "third world" is warranted** — no physics or
  collider code should move out of `server.js`.
- `auth.js`, `migrate.js`, and `db.js` are exemplary: tight, single-responsibility,
  well-commented. They set the bar the rest of the file should meet.
- Comment quality is high overall (the physics tick `update()` carries ~32 comment lines over
  ~150). This is not an under-commented codebase — the comment findings below are specific
  defects, not a general gap.
- No `TODO`/`FIXME`/dead-code markers anywhere in the back-end tree.

---

## 1. Misplaced functions / "third world" question

No functions need to move between worlds. Two notes for the record:

- **1a — Vector helpers could be shared, but shouldn't move yet.** `sub`/`cross`/`dot`/`norm`/
  `averagePoint` (`server.js` ~L250–254) and `dieShape` are pure and would be testable in
  `shared/pieces.js`, but their only consumers (`colliderShape`/`buildCollider`) depend on
  cannon-es, which is server-only. Moving the cluster would pull physics toward the client for
  no current benefit. **Leave in `server.js`.** `P3`.

- **1b — The `SIM` ↔ `core.js CONFIG` mirror is a real drift hazard (cross-boundary).**
  `core.js` opens with `CONFIG` described as "the visual mirror of the server's SIM" (L10), so
  tuning values (spawn height, damping, deck-ride height) are deliberately restated on both
  sides — the client predicts visually, the server is authority. Neither can import the other's
  copy without bundling, so this is not mergeable as-is, but changing one side can silently
  drift the other.
  - Option A (cheap): a cross-reference comment on both `SIM` and `CONFIG` pointing at each
    other, so an edit on one side flags the other.
  - Option B (durable): extract the subset that *must* agree into `shared/pieces.js` and import
    it on both sides; leave client-only visual tunables in `CONFIG`.
  - Recommend Option A now, Option B the next time we touch physics feel. `P2` (coordination
    item — front-end chat must be looped in for Option B).

---

## 2. Near-duplicate helpers to combine (the DRY core)

- **2a — `props` codec. `P1`, highest payoff.**
  `JSON.parse(x.props || '{}')` appears **29×**; `.props = JSON.stringify(...)` **10×**. They
  are *inconsistent*: `L609` and `L2383` defensively wrap the parse in try/catch; the other ~27
  are bare and would throw — crashing the handler — if a `props` blob were ever malformed.
  - Fix: a `readProps(piece)` (parse-or-`{}`, try/catch inside) and `writeProps(piece, obj)`
    pair. Collapses all 39 sites to safe one-liners and makes the defensive parse uniform.
  - Bonus: a `mutateProps(piece, fn)` for the read→change→write sites (the group handlers)
    reads cleanly: `mutateProps(piece, p => { p.snap = !anySnap; })`.
  - Test: unit-test `readProps` against valid / empty / malformed / missing input.

- **2b — Overlay geometry mapping. `P1`, directly the "change it in 3 places" trap.**
  The six-field `x/z/x2/z2/w/ang` clamp-and-assign is written three different ways:
  unconditional in `overlayAdd` (~L1362–65), conditional in `overlayMove` (~L1371–76), and as
  an object literal in `overlayDrag` (~L1396). A 7th field means editing three spots.
  - Fix: `overlayGeom(msg)` → clamped `{x, z, x2, z2, w, ang}`. Unifies `overlayAdd` +
    `overlayDrag` immediately; `overlayMove` can reuse it for the "field present?" merge.
  - Note: `clampCoord` (L1350) is currently a local const in the handler-registration scope;
    it should travel with `overlayGeom`.

- **2c — `onAuth` preamble. `P2`.**
  All three `onAuth` (`TableRoom` L2285, `EditorRoom` L2609, `LobbyRoom` L3005) repeat the
  token→user resolve + 401 throw verbatim; two also repeat the room-by-code + 404 + membership
  block. `EditorRoom extends TableRoom` but overrides `onAuth` wholesale, re-doing the resolve.
  - Fix: module-level `resolveUser(options)` → user or throw 401; optionally
    `resolveRoomMembership(options)` → `{ user, room, membership }` or throw. Each `onAuth` keeps
    only its own rule (admin-only, admitted-role, not-yet-admitted).

- **2d — `settleBody(b)`. `P2`, trivial.**
  `velocity.setZero(); angularVelocity.setZero(); wakeUp()` (the "come to rest" trio) recurs —
  10 `angularVelocity.setZero` sites. One helper, clearer intent at each call site.

- **2e — `ownerOrGM(o, client)`. `P2`.**
  `!o || (o.owner !== client.sessionId && this.rank(client) < RANK.gm)` is verbatim in
  `overlayMove` (L1370) and `overlayRemove` (L1380), and generalizes to any owned entity.
  - Fix: `ownerOrGM(entity, client)` predicate.

- **2f — `db.js` read wrapper. `P3`, judgment call.**
  `try { … } catch (e) { console.error('[db] fn:', e.message); return <default> }` repeats on
  ~23 read functions. A `safeRead(label, fallback, fn)` wrapper halves those bodies — but the
  current form is extremely greppable and each fallback is explicit, so this is a taste call.
  Flagged, not recommended.

---

## 3. Cleanly abstractable clusters → smaller module

- **3a — Pull the stateless helpers out of `TableRoom` into `room-helpers.js`. `P2`.**
  `server.js` is one ~2,100-line `TableRoom` class whose methods lean on `this.state` /
  `this.bodies` / `this.broadcast`, so splitting the *class* is risky. The high-leverage move is
  extracting the **stateless** helpers into a server-local module: the `props` codec (2a),
  `overlayGeom` (2b), `settleBody` (2d), `ownerOrGM` (2e), the vector math (1a), and the deck
  builders (`buildSimpleDeck` / `buildDominoSet` / `buildScrabbleBag` / `buildMahjongWall` —
  already free, pure functions). This gives the "one place to change it" guarantee without a
  class carve-up, and makes each helper unit-testable in isolation.

- **3b — Overlay subsystem: stage, don't extract yet. `P3`.**
  The overlay schema + five handlers + caps are the most self-contained subsystem, but they're
  still tangled with room state today. Extract the pure pieces first (via 3a); revisit a fuller
  module only if overlays grow (Steps 4–5 add circle/cone/line templates + persistence).

- `db.js` needs no split — already a clean, single-responsibility module.

---

## 4. Formatting / naming

- **4a — Line density, not naming, is the readability cost. `P3`.**
  Naming is fine and *consistent* — `p`/`b`/`o` (piece/body/overlay), `dp` (deck-props) are
  uniform conventions, not sloppiness; leave them. The real cost is multi-statement one-liners:
  - `rollOne` (L1088, 307 chars)
  - `setSnapGroup` inner loop (L617, 245 chars)
  - Schema constructors (L376 State = **459 chars**; L326/364/366/378 similar)
  - Fix: unpack the multi-statement *logic* one-liners across lines. The schema constructors are
    borderline-acceptable as flat field lists — lower priority, optional.

---

## 5. Comments

- **5a — Stale, mislabeled banner. `P1` (one-line fix, actively misleading).**
  `L382` reads `// --- Physics world (identical setup to the single-player client) ---`, but the
  lines beneath it are caps/limits constants (`TABLE_LIMIT`, `SCENE_MAX_BYTES`,
  `WHITEBOARD_MAX_STROKES`, overlay caps). The *actual* physics-world banner + `buildWorld` are
  at `L397`. So `L382` is both wrong-section and references a single-player client that no longer
  exists.
  - Fix: retitle `L382` to e.g. "Room limits & caps" and delete the single-player clause.

---

## Suggested sequencing

Each item is independently shippable with its own test additions and a Conventional Commit.

1. **`readProps`/`writeProps`/`mutateProps` (2a)** — biggest safety + DRY win, touches 39 sites;
   land with unit tests for the codec.
2. **`overlayGeom` + `ownerOrGM` (2b, 2e)** — small, self-contained, closes the overlay
   "3-places" trap before Steps 4–5 add template kinds.
3. **`resolveUser` / `onAuth` preamble (2c)** and **`settleBody` (2d)**.
4. **Extract helpers into `room-helpers.js` (3a)** — mechanical once 1–3 exist as functions.
5. **Comment fix (5a)** and **line-density pass (4a)** — fold into whichever commit touches
   those regions, no standalone churn.
6. **`SIM`/`CONFIG` cross-reference (1b, Option A)** — coordinate with the front-end chat.

Docs to update as items land: `CHANGELOG.md [Unreleased]`; `ARCHITECTURE.md` only if the helper
module (3a) changes the described structure. No `REFERENCE.md` change — handler/message contracts
are unchanged by any of this (pure internal refactors).

---

## Checklist

- [ ] 2a — `readProps` / `writeProps` / `mutateProps` codec (+ tests)
- [ ] 2b — `overlayGeom(msg)` helper
- [ ] 2e — `ownerOrGM(entity, client)` predicate
- [ ] 2c — `resolveUser(options)` / `onAuth` preamble
- [ ] 2d — `settleBody(b)` helper
- [ ] 3a — extract stateless helpers → `room-helpers.js`
- [ ] 5a — fix stale "single-player client" banner (L382)
- [ ] 4a — unpack the worst multi-statement one-liners
- [ ] 1b — `SIM` ↔ `CONFIG` cross-reference (front-end coordination)
- [ ] 2f — (optional) `db.js` `safeRead` wrapper
- [ ] 1a — (optional) vector helpers → `shared/` if ever needed client-side
