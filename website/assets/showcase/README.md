# Showcase captures

Captured from the running local app on September 29, 2026 using its ordinary UI.
These are original 1086 x 912 browser PNG screenshots, without image edits or generated content.
Their placement was approved and applied to the landing page and Assets and scenes guide.

| File | Contents | Page placement |
| --- | --- | --- |
| `chess.png` | Built-in chess, several moved pieces, blue felt, warm lighting, angled camera | Landing introduction |
| `cards.png` | Built-in playing cards, chip stacks, private hand, sunset skybox | Landing overview gallery |
| `dice.png` | Amber marbled dice in the personal dice box with its controls | Landing overview gallery |
| `library.png` | Objects & Dispensers with the Built-In filter | Assets and scenes wiki introduction |

Two dedicated local rooms preserve the staged content: **Website Showcase** (chess) and
**Website Showcase - Cards & Dice**. Both were explicitly saved using GM Controls > Save Table
and showed the Saved confirmation. Camera framing remains local and may need to be recreated.
Existing game rooms and library assets were not edited. Only built-in assets and finishes
were used in these captures. Custom-upload and double-sided tile workflows are not pictured.

Chess-piece models are by JustinARay, [Low Poly Chess Set](https://opengameart.org/content/low-poly-chess-set),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Include this attribution near a
published chess screenshot or in an accessible linked credits page. Other visible bundled
art is covered by [the asset credits](../../../docs/ASSET_CREDITS.md), including felt, wood,
sky and marble textures and Tabler icons.

The approved layout substitutes chess in the existing hero, adds a two-column
cards/dice gallery below the overview, and places the library capture above the Assets and
scenes instructions. At phone width the hero and gallery stack vertically. No icons change.
The original temporary mock-up remains separate from deployment content.

Initial desktop and 390px mock-up checks found loaded images and no horizontal overflow.
Review captures are in `/tmp/ott-showcase-review/`. The applied change updates
`website/index.html`, `website/styles.css`, and `website/wiki/assets.html`, reusing the existing
hero, overview, and responsive layout. The existing `scripts/website-test.mjs` page list now includes the Assets and scenes guide.
No JavaScript functions or helpers were added or changed.
Supporting capture notes, website README, asset credits, architecture/reference notes and
changelog record the integration. No push or publication was performed.

## Applied-layout verification

- `npm run check`: passed lint, formatting, CSS validation and all 914 tests.
- `npm run test:components`: passed component comparisons and all three notecard profiles;
  fixtures still report eight previously known missing bundled texture derivatives.
- `npm run test:devices`: all seven profiles passed.
- `npm run test:website`: all 25 page/profile checks passed, including the landing page and
  Assets and scenes at 1440, 760, 1024, 390 and 320 pixels. No missing website assets.
- Static website tests, targeted formatting and `git diff --check` passed after final edits.

Gallery images load eagerly so they are available at every responsive layout without
waiting for scrolling. This changes loading behavior only, not the approved placement.
Refresh the preview at `http://127.0.0.1:4173/`; no app server restart is required.
