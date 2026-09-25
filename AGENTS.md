# Before implementing a feature

- Before adding new functions or helpers, inspect the existing code for behavior that can be
  reused or extended with a small, compatible change. Use the code-discovery workflow below
  and inspect relevant callers before choosing an approach.
- When several functions perform nearly the same work, consider consolidating their genuinely
  shared behavior into a focused helper, module, registry, or class with explicit variants.
  Choose the abstraction from shared rules, dependencies, and state ownership; do not force a
  class or broad generalization merely because implementations look similar.
- Add a new implementation when existing code cannot accommodate the feature cleanly. Briefly
  explain the reuse, extension, or new-boundary decision in the implementation summary.

# Coding workflow

- Commits are allowed without additional approval. Never push without explicit user approval;
  the user wants to test changes thoroughly before pushing.
- Inspect the working tree before editing or committing. Preserve unrelated user and other-task
  changes, including model replacements and tuned constants. Stage only task-related changes
  unless explicitly asked to include others; avoid unrelated formatting.
- During staged gameplay/UI refactors, leave each cohesive slice ready for in-app testing before
  proceeding, unless a larger sequence was explicitly authorized. This does not prohibit local
  commits or require approval for each routine implementation choice within an approved UI design.
  UI changes must follow the mock-up approval requirement below.
- Summarize every file touched and the functions/helpers added, changed, or removed.
- Record changes in `CHANGELOG.md` under `[Unreleased]` during implementation.
- Update `docs/REFERENCE.md` and `docs/ARCHITECTURE.md` when relevant during documentation
  updates, alongside the changelog and implementation plans; do not defer them until pushing.

# Product and architecture boundaries

- Open Tabletop simulates physical objects and lets people enforce game rules. Do not introduce
  legal-move enforcement, automatic scoring, dice-roll accounting, or other deliberately excluded
  features unless explicitly requested. See [ROADMAP.md](docs/ROADMAP.md).
- The server owns physics, inventory, permissions, and shared game state. Browser modules own
  rendering and interaction. Camera, selection, graphics quality, and audio preferences stay
  local unless a feature explicitly requires synchronization.
- Move related state and behavior together into focused modules with explicit dependencies.
  Keep entry points responsible for orchestration and preserve simulation/render-loop ordering.
  Avoid mutable global contexts, circular imports, generic utility dumping grounds, and
  extractions made solely to reduce line count. Separate organizational changes from behavior
  changes where practical. See [CLIENT_REFACTOR.md](docs/CLIENT_REFACTOR.md).
- Reuse shared geometry, collider, snapping, validation, and protocol definitions. Put shared
  data/calculations in `shared/` when both runtimes need them; keep rendering and physics-engine
  adapters in their own runtimes. Use named configuration values for adjustable behavior.
  Verify physics, diagnostics, and rendering against the shared definitions while preserving
  intentional differences such as invisible tray walls.

# Privacy, authorization, and persistence

- Treat all synchronized state as public. Keep deck order, concealed faces, private hands,
  inspections, and restricted reveals in server-only storage, delivering content only to its
  authorized recipients. Preserve this boundary through saves, reconnects, transfers, and cleanup.
- Normalize untrusted payloads before lookup or mutation. Enforce permissions server-side and
  recheck live access after asynchronous reads before privileged actions or responses.
- Use the established HTTP/message/lifecycle error boundaries. Database failures must not become
  empty results or successful saves; log safe context without secrets or private payloads.
- Check capacity and compatibility before consuming cards or dispenser items. Failed placement
  must retain recoverable inventory. Preserve card metadata, account-based durable hand ownership,
  save ordering, and backward compatibility with existing snapshots. Keep portable scenes distinct
  from game snapshots containing player data.
- See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for these invariants and
  [REFERENCE.md](docs/REFERENCE.md) for their current implementation contracts.

# UI and input

- For every requested change that adds, modifies, or removes UI elements, first present a concrete
  mock-up or example showing the proposed result and obtain explicit user approval before
  implementing the UI change. Preparing the mock-up or example is allowed before approval.
  Include affected compact/full and desktop/touch layouts where relevant, and show the resulting
  layout for removals. If the design materially changes, present the revised example for approval.
- Design all UI with accessibility in mind: prefer semantic controls, provide meaningful accessible
  names (including `aria-label` for icon-only controls), and expose relevant states to assistive
  technology. Support keyboard-only operation, logical focus order, visible focus indicators and
  appropriate focus management. Provide hover hints with keyboard-focus and touch equivalents;
  essential information or actions must not depend on hover alone. Maintain readable contrast,
  usable touch targets and cues that do not rely on color alone, including in compact mode.
- Use shared design tokens, canonical component classes, and Tabler icon helpers for static and
  generated UI. Preserve compact/full modes, keyboard accessibility, and desktop/touch behavior.
  Regenerate icon sprites through `npm run build:icons` when adding icons.
- When adding or changing UI elements, consider appropriate Tabler icons, especially for compact
  mode where labels may be hidden. Present the user with concrete icon options and their intended
  controls, ask for their choice before adding or replacing icons, then implement the selected
  icons using the shared helpers and sprite workflow. Preserve accessible names and tooltips in
  compact mode. Previously approved icon choices do not need repeated confirmation.
- Route device input through the existing intent layer. Decide and document the touch path for
  new interactions, updating the in-app help and [GESTURES.md](docs/GESTURES.md) when relevant.
  Keep viewport width and pointer capability as distinct layout concerns; use
  [DEVICE_MATRIX.md](docs/DEVICE_MATRIX.md) and [DEVICE_QA.md](docs/DEVICE_QA.md).

# Verification

- Run `npm run check` for code changes. Also run `test:input` for input changes,
  `test:components` for DOM/component changes, `test:devices` for responsive-layout changes,
  and `test:integration` for database/query/migration changes when applicable.
- Add regression tests for meaningful behavior and failure cases, not assertions that merely
  require code to live in a particular file. Documentation-only edits need consistency, link,
  and diff checks rather than the full runtime suite.
- When adding or extracting a capability, verify production exports, dependency injection,
  registrations, and the real caller path as well as isolated helpers.
- Report checks actually run, blockers, and remaining manual testing. Automated passes do not
  establish real-device gesture feel, GPU performance, or multiplayer correctness. For interaction
  changes, provide a short smoke-test list and state whether a refresh or server restart is needed.

# Deployment and assets

- Use new numbered migrations for schema changes; do not rewrite migrations already shipped.
  Preserve separate migration/runtime database roles. Document changes to environment variables,
  ports, storage, and upgrade requirements. Follow [RELEASING.md](docs/RELEASING.md) for releases;
  never replace a published version tag.
- Preserve the build-free, self-hosted browser setup and existing Content-Security-Policy.
  Do not introduce new infrastructure or build tooling as incidental cleanup.
- Preserve uploaded originals and authored model materials unless the task requires changing
  them. Dispose temporary rendering resources and bound caches without disposing shared resources
  still in use. Record sources/licenses for added bundled assets in
  [ASSET_CREDITS.md](docs/ASSET_CREDITS.md) and maintain applicable in-app credits.

# Documentation and historical context

- Treat older plans and chat history as context, not proof of current implementation or ongoing
  authorization. Current user instructions and this file take precedence over stale workflow
  guidance in plans. Verify implementation claims against current source.
- Preserve historical changelog entries. Keep active plans current and distinguish implemented,
  automatically tested, and manually verified status; do not mark user testing complete by inference.

# Code discovery

Use the codebase-memory MCP graph before filesystem searches for structural code discovery.
Confirm the project/generation, discover symbols with `search_graph`, trace relevant callers and
callees, and read exact snippets. Check index coverage for evidence paths; read source directly
for gaps or stale results. Use text search for literals/configuration and insufficient graph results.
