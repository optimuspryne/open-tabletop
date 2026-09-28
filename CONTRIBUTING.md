# Contributing to Open Tabletop

Contributions are welcome: bug reports, documentation improvements, accessibility
fixes, tests, and code.

Open Tabletop recreates sitting at a physical table with friends. It simulates
objects; people enforce the game rules. Please read [the roadmap](docs/ROADMAP.md)
before proposing substantial features. Rules enforcement, automatic scoring, and
dice-roll accounting are outside the current scope.

## Before starting

Check existing issues and pull requests for related work. For substantial features,
architectural changes, or new dependencies, open an issue to discuss the problem
and proposed approach before investing in implementation. Small fixes and
documentation corrections can go straight to a pull request.

For UI changes, share a concrete mock-up or example and get maintainer approval
before implementation. Include affected desktop/touch and compact/full layouts,
including the resulting layout when removing controls. Propose icon choices where
applicable and agree on them before implementation.

## Reporting bugs

Include:

- What you expected and what actually happened.
- Steps to reproduce, preferably from a fresh room.
- The application version or commit.
- Browser, operating system, and input device.
- Deployment method when relevant.
- Relevant screenshots or sanitized logs.

For multiplayer problems, describe which players were affected and whether
reconnecting or reloading changed the behavior. Do not include passwords, session
tokens, private card data, or other sensitive information in reports.

Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Local development

Fork and clone the repository, then install dependencies:

```sh
npm ci
cp .env.example .env
```

Follow the [README](README.md) to configure PostgreSQL, Redis, and the initial
administrator, then start the application:

```sh
npm start
```

The README also documents Docker Compose setup and Node.js requirements. Use a
development database and keep credentials and local configuration out of commits.

The browser application has no build step. Test multiplayer changes with separate
browser sessions or devices.

## Implementation guidelines

- Inspect existing behavior and callers before adding a new helper. Reuse or
  extend existing code when it fits cleanly.
- Keep changes focused. Avoid unrelated formatting and refactoring.
- Keep physics, inventory, permissions, and shared game state on the server.
  Keep rendering and interaction in the browser.
- Keep camera, selection, graphics, and audio preferences local unless
  synchronization is explicitly needed.
- Treat synchronized state as public. Deck order, concealed faces, private hands,
  and restricted reveals must remain server-only and reach only authorized
  recipients, including through saves and reconnects.
- Validate untrusted input and enforce permissions on the server. Recheck live
  access after asynchronous reads before privileged actions or responses.
- Preserve saved-game compatibility and recoverable inventory when an operation
  fails. Keep portable scenes distinct from game snapshots containing player data.
- Preserve the build-free browser setup and Content Security Policy.
- Add new numbered database migrations; do not rewrite shipped ones. Preserve
  separate migration and runtime database roles.

See [Architecture](docs/ARCHITECTURE.md) and [Reference](docs/REFERENCE.md) for
detailed contracts.

## UI and input

Use shared design tokens, component classes, and Tabler icon helpers. When adding
icons, regenerate the sprite with `npm run build:icons`.

Support keyboard navigation, visible focus, meaningful accessible names, readable
contrast, and usable touch targets. Essential actions and information must be
available without hover, and cues must not rely on color alone.

Route input through the existing intent layer. Consider both pointer capability
and viewport width, and preserve compact and full modes. Document new touch
interactions in the in-app help and gesture guide.

See [Gestures](docs/GESTURES.md), [Device matrix](docs/DEVICE_MATRIX.md), and
[Device QA](docs/DEVICE_QA.md).

## Verification

For code changes, run:

```sh
npm run check
```

Also run the checks relevant to your change:

| Change | Command |
| --- | --- |
| Input handling | `npm run test:input` |
| DOM or components | `npm run test:components` |
| Responsive layout | `npm run test:devices` |
| Database, queries, or migrations | `npm run test:integration` |

Add regression tests for meaningful behavior and failure cases.
Documentation-only changes need link, consistency, and diff checks.

Report which checks you ran and any failures or checks you could not run. Automated
tests do not replace manual testing of touch gestures, rendering performance, or
multiplayer behavior.

## Submitting a pull request

Explain:

- The problem and resulting behavior.
- The scope of the change and important design decisions, including reuse of
  existing behavior or the need for a new module or helper.
- The files and functions/helpers added, changed, or removed.
- Automated checks and manual testing performed.
- Remaining limitations or testing needed.
- Whether users need a browser refresh, server restart, or migration.

Include screenshots or recordings for visible changes and a short smoke-test
list for interaction changes.

Add an entry under `[Unreleased]` in `CHANGELOG.md`. Update affected documentation,
including architecture, reference, and gesture guidance where relevant. Document
changes to deployment configuration and upgrade requirements.

Keep each pull request focused enough to review and test independently.

## Assets and licensing

See [LICENSE](LICENSE) for the project license.

Only contribute assets you have permission to redistribute. Record sources and
licenses in [Asset credits](docs/ASSET_CREDITS.md), and update in-app attribution
when required. Preserve uploaded originals and authored model materials unless
changing them is part of the task.
