# Open Tabletop website

The public landing page and wiki live here, separate from the running game app.
Serve this directory as the web root. It contains ordinary HTML, CSS, images, and one optional
local homepage slideshow module. There are no framework dependencies, database connections,
or deployment build step.
Do not serve the repository root, which also contains application configuration and secrets.

## Local preview

From the repository root:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory website
```

Open `http://127.0.0.1:4173/index.html`. The game server does not need to run.
Refreshing the page loads edits; no game server restart is required.

## Files and maintenance

All 18 pages reuse `assets/logo-wordmark.svg`, an unchanged copy of the app logo, in the
header and footer. The shared `.brand-logo` and `.footer-logo` classes size it for both
desktop and phone layouts. Header home links and logo images retain accessible names.

- `index.html`: the approved landing page, seven-slide showcase, GitHub link, and live public demo links.
- `showcase.js`: the optional slideshow enhancement; all page content and navigation retain
  their static fallback. This module runs independently of the game app.
- `styles.css`: the website's shared tokens, button styles, desktop sidebar, and responsive layout.
  It uses the application's token naming conventions with the approved website palette.
  Game CSS stays separate so either surface can change without affecting the other.
- `assets/tabletop.webp`: a WebP derivative of the existing `public/logo-mark.svg` artwork.
  It is artwork, not a gameplay screenshot. The original remains unchanged.
- `assets/favicon.png`: a 64-pixel derivative of that same artwork.
- `wiki/index.html` and `first-game.html`: orientation and joining or hosting a game.
- `wiki/docker.html`, `node.html`, `linux.html`, `proxmox.html`, and `portainer.html`:
  installation procedures, based on the corresponding sections of the repository README.
- `wiki/configuration.html`, `accounts.html`, `email.html`, and `networking.html`:
  environment settings, roles, recovery, and proxy setup. Account recovery details come from
  `docs/ACCOUNT_SECURITY.md` as well as the README.
- `wiki/controls.html`, `pieces.html`, `assets.html`, and `saving.html`:
  gameplay and asset guides, based on the README and `docs/GESTURES.md`.
- `wiki/maintenance.html` and `troubleshooting.html`: backups, upgrades, and common failures.
  Version-specific upgrade details remain in `docs/RELEASING.md`.

Edit the HTML directly. Each article links to its source documentation. Update the relevant
wiki pages when source instructions change; do not assume the website updates automatically.
Verify action names and menu paths against the current markup and handlers, not only the README.
The first version inherited obsolete README instructions; the Assets and Scenes, first-game,
controls, pieces, saving, and Node.js guides have now been checked against `public/table.html`,
`public/editor/editor-panel.js`, the table shell, and the save/load handlers. The source README,
`docs/ARCHITECTURE.md`, and `docs/REFERENCE.md` were corrected in the same pass, with the change recorded in `CHANGELOG.md`. No production
functions or helpers changed. The Assets and Scenes guide also includes separate upload
instructions for double-sided tiles, panorama/cubemap skyboxes, and dice textures, checked
against the upload forms and dice preference controls. Static link/content checks and narrow/wide asset-guide layout
checks cover the correction; following each workflow in a live game remains manual acceptance.
If adding or renaming a page, update both desktop and mobile navigation and the previous/next
links on the affected pages. Use relative file URLs so the site works at a domain root or under
a subdirectory. Page titles and descriptions are part of each page's head.

The copy uses plain language without em dashes. Documentation distinguishes current source
from published images. Keep those version qualifications when updating installation examples.
The public demo links are enabled with user approval and open the demo in the same tab.

## Accessibility and device behavior

All page copy, the initial chess image and site navigation work without JavaScript. Every page has a skip link, one main
heading, a main landmark, and visible keyboard focus. The wiki uses a sidebar above 760px
and a native expandable contents list at narrower widths. Pointer capability separately
increases touch link targets. The contents summary works with tap, click, Enter, and Space.
Code examples wrap; wide tables scroll inside focusable regions without widening the page.
No gameplay input routing or compact/full app setting changes are involved.

## Validation

```bash
npm run check
npm run test:components
npm run test:devices
npm run test:input
npm run test:website
```

`test/website.js` is included in the normal test suite. It checks local routes, assets,
fragment targets, duplicate IDs, page metadata, the constrained local script, approved slides, and the active demo destination.
`scripts/website-test.mjs` checks the landing page and welcome, Docker, Portainer, and Assets
and scenes guides. It reuses `scripts/lib/headless.mjs` to check page overflow, image
loading, desktop/mobile navigation, and keyboard expansion at 320, 390, 760, 1024, and 1440px.
Set `WEBSITE_SCREENSHOTS` to an output directory to save selected desktop/mobile captures.

Manual acceptance: follow the landing-page buttons; navigate and reload wiki articles;
use the mobile contents list; tab through links; read a long command example on a phone;
confirm the demo opens the guest entry at play.open-tabletop.com. Automated touch emulation does not establish physical
device behavior. Installation commands are documentation, not executed by website tests.

## Hosting

Publish only this directory through a static host. No server rewrites or fallback route are
needed because links use explicit `.html` files. The website's restrictive meta CSP allows
only local images and styles; the homepage additionally allows its local script. Do not add
inline scripts, inline styles or remote dependencies. A host response CSP must also allow
`script-src 'self'` on the homepage for the optional slideshow to run; it does not change the
game application's CSP. Configure HTTPS
and any additional response headers in the host. Use the actual game app's origin for
`PUBLIC_ORIGIN`, not the marketing site's origin.

No publishing configuration or automatic deployment has been added. The project requires
explicit permission before pushing, including the source push used by Sites publishing.

## Initial implementation status (September 29, 2026)

- Layout and text navigation approved in this task, including the plain-language copy revision.
- Landing page and 17 static wiki pages implemented.
- Existing artwork reused; no generated gameplay imagery or third-party assets added.
- `npm run check` passed: lint, formatting, CSS checks, and 914 tests.
- `npm run test:components` and `npm run test:devices` passed. The existing component
  fixtures reported eight missing bundled texture-derivative requests; the website checks
  reported no missing assets.
- `npm run test:website` passed 20 page/profile checks, including native keyboard expansion
  of mobile navigation. Desktop and mobile landing/Docker-guide captures were inspected.
- Local routes, asset references, fragments, and the absence of em dashes were checked.
- The initial restricted-network check runs were stopped after they ceased progressing.
  The complete check suite passed when rerun with local networking available.
- User acceptance and physical-device checks were pending at that initial revision.
  The later slideshow and additional images have since received explicit design approval.

## Initial repository changes

- `package.json` adds `test:website`; no dependencies or runtime scripts change.
- `test/website.js` adds static route, content, and asset checks to the existing test suite.
- `scripts/website-test.mjs` adds the browser checks described above and reuses the existing
  headless harness rather than introducing browser tooling.
- `README.md` links to the website's local preview and maintenance instructions.
- `CHANGELOG.md` records the site under Unreleased without changing historical entries.
- `docs/ARCHITECTURE.md` documents the independent static website boundary.
- `docs/REFERENCE.md` lists the website entry points and verification commands.
- `docs/ASSET_CREDITS.md` records the two derivatives of the existing logo.

No production JavaScript functions, application routes, gameplay helpers, or server state
were added, changed, or removed. The website uses native HTML navigation and disclosure
controls. The full page inventory is above; the new verification code contains test entry
points only.

## Gameplay screenshots

The [capture notes](assets/showcase/README.md) distinguish the four original app screenshots
from the four approved Go, Dominoes, Mahjong and Wordy renderer mockups. The hero cycles through
seven images, a responsive gallery shows cards and dice, and the Assets and scenes guide shows
the library. Two dedicated rooms preserve the older staged content; the new mockups use isolated
renderer scenes. Keep the chess-model attribution when using its screenshot.

## Wiki accuracy review

The [September 29 review](WIKI_AUDIT.md) records all 17 pages, section-level findings,
implementation evidence, documentation sources and verification limits. Every article now has
specific source links and a review date. Current-source features are distinguished from the
pinned 0.20.0 image. Update this record and the article date when rechecking instructions.

The audit corrected installation order and grants, Compose forwarding and secret permissions,
role and participation restrictions, notecard-template ownership, scene replacement and
session-only data. It also added concrete paths for browsing, notecards, fog and table tools.
No production functions or helpers changed. Both static website checks and 90 page/device
browser checks passed; installation examples received syntax checks, not live provisioning.

## Public demo links

Every page header links to `https://play.open-tabletop.com`; the homepage also
features the primary Try public demo action, with self-hosting and GitHub secondary.
Phones stack the hero actions with full labels. The homepage and wiki introduction
explain account-free entry, inviting friends and the two-hour temporary table limit.
This is a static website change based on main. The demo application remains on
its separate long-lived `codex/public-demo-mode` branch; no demo runtime is merged here.
Deploy only the `website/` directory through the existing website publishing process.

Changed files: `index.html` (hero and navigation), all 17 `wiki/*.html` headers
(and wiki index introduction), `styles.css` (stacked phone actions), `README.md`;
`test/website.js` (live-link checks), `scripts/website-test.mjs` (responsive links/actions);
`CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` (current website contract).
No application functions, routes, dependencies or database behavior changed.

Verification for demo-link activation: `npm run check` passed (928 tests);
`npm run test:website` passed 25 page/viewport combinations; `npm run test:devices`
passed all seven profiles. Desktop and phone homepage screenshots were visually
reviewed. The broader `test:components` run was interrupted with SIGTERM (143)
during coarse-pointer scenarios, with no failures reported before interruption;
it is not recorded as a completed pass. Public deployment remains manual.


## Approved slideshow integration (October 14, 2026)

The approved carousel uses the existing hero, website tokens and button styles. It has a
six-second loop and 500ms crossfade, title/caption, counter, seven named selectors and the
approved Tabler previous, pause/play and next icons. Controls wrap below the selectors on
narrow screens; selector targets remain at least 24px wide and 44px high. No compact/full game
UI or gameplay input behavior changes. Native buttons support tap, click, Enter and Space;
manual changes announce the selected game, while automatic changes stay quiet. Manual
navigation stops autoplay, hover/focus/hidden tabs suspend it, and reduced motion starts paused
with no fade. Explicit Play can resume while the button remains focused. Image decoding finishes
before the visible image changes; a failed image retains the previous screenshot and announces
an error. With JavaScript disabled, the initial chess image and caption remain and controls hide.

Implementation inventory:

- `index.html`: approved seven-slide metadata and controls, two image layers, local module/CSP
  and generated four-icon sprite. Static SVG controls reuse the canonical sprite markup.
- `styles.css`: caption, stable image stage, crossfade, focus-compatible controls and responsive rows.
- `showcase.js`: new `initShowcase`, with local `schedule` and asynchronous `show` behavior.
  No game modules or runtime dependencies are imported.
- `assets/showcase/{go,dominoes,mahjong,wordy}.png`: unchanged approved originals;
  `assets/showcase/README.md`: capture provenance, placement and validation notes.
- `../scripts/build-icons.mjs`: reuses `fetchSymbol` and sprite generation with a `--website`
  subset. Run `npm run build:icons -- --website` after changing website icon names.
- `../eslint.config.js`: browser globals for the standalone website module.
- `../test/website.js`: static fallback, local-script and seven-image checks.
- `../scripts/website-test.mjs`: adds `checkShowcase` and its local `waitFor`/`select` test
  helpers to exercise the real homepage; existing responsive/navigation checks remain.
- This README, `../CHANGELOG.md`, `../docs/REFERENCE.md`, `../docs/ARCHITECTURE.md` and
  `../docs/ASSET_CREDITS.md`: implementation contracts, maintenance and provenance.

This extends the existing website and icon builder. The small website module is a new runtime
boundary because the separately published directory must not import game code. No game
functions, server routes, model materials or uploaded assets were changed or removed.

Manual acceptance: refresh the website, cycle through all seven images, use Pause/Play,
previous/next and the game selectors on desktop and a physical phone. Tab through controls
and activate with Enter/Space; confirm reduced-motion preference starts paused. No game
server restart is required. Source push and public deployment remain separate steps.

Slideshow verification completed October 14, 2026:

- `npm run check`: lint, formatting, CSS checks and all 1,030 tests passed.
- `npm run test:website`: 25 page/profile checks and the production slideshow checks passed,
  including native keyboard activation and taps at 1024, 390 and 320px. All website assets loaded.
- `npm run test:components`: desktop and coarse-pointer comparisons, three notecard profiles
  and three tile-preview profiles passed. The game component fixtures reported 10 missing
  bundled texture-derivative paths; these are outside the standalone website assets.
- `npm run test:devices`: all seven profiles passed. `npm run test:input`: 58/58 passed.
- Final targeted lint/format, documentation links and `git diff --check` passed. The four PNGs
  match the approved originals byte for byte. Desktop and phone captures of the integrated
  chess/Go layouts were visually reviewed. Physical-device acceptance remains manual.
