#!/usr/bin/env node
// Regenerates the inline Tabler icon sprite in every HTML page from the ICONS list below.
// Tabler Icons are MIT-licensed (Copyright (c) 2020-2026 Paweł Kuna); see docs/licenses/tabler-icons-LICENSE
// and docs/ASSET_CREDITS.md. The embedded SVGs ship under that license.
//
//   To add an icon:  add its Tabler *outline* name to ICONS, then run `npm run build:icons`.
//   To remove one:   delete it here and rebuild (the sprite is generated, never hand-edited).
//
// Pin REF to a Tabler release tag (e.g. 'v3.34.0') for a fully reproducible build; 'main' tracks latest.
import { readFile, writeFile } from 'node:fs/promises';

const REF = 'main';
const PAGES = ['public/table.html', 'public/editor.html', 'public/index.html', 'public/admin.html'];

// The full set of icons used across the app, grouped loosely by where they first appeared.
const ICONS = [
  // Tools menu
  'notes', 'message-dots', 'scoreboard', 'stopwatch', 'ruler-2', 'select-all', 'volume', 'restore', 'chalkboard', 'help',
  // Top nav + Room Controls + dice
  'home-move', 'dice-5', 'plus', 'number-4-small', 'number-6-small', 'number-8-small', 'number-10-small', 'number-12-small', 'number-20-small',
  'settings', 'building-warehouse', 'books', 'library-plus', 'movie', 'users', 'device-floppy', 'brand-airtable', 'geometry', 'grid-4x4', 'sunset-2', 'trash', 'ampersand',
  // Interactions + hamburgers
  'zoom-in', 'armchair', 'cards', 'arrow-bar-down', 'hand-move', 'tools',
  // Measure / selection / tray / rail / hold
  'ruler-measure', 'circle', 'cone', 'line', 'arrow-big-up-line', 'grid-3x3', 'eye-up', 'hand-grab', 'deselect',
  'refresh-dot', 'recycle', 'package-off', 'u-turn-left', 'square-chevron-left', 'square-chevron-right', 'color-swatch',
  'rotate-2', 'rotate-clockwise-2', 'arrow-narrow-up-dashed', 'arrow-narrow-down-dashed',
  // Show / Drop hand + universal close
  'friends', 'play-card', 'eye-cancel', 'eye-check', 'arrow-down-bar', 'arrow-up-bar', 'x',
  // Library card buttons
  'new-section', 'category-plus', 'square-rounded-plus', 'go-game', 'checks',
  // Modal internals (chat/score/timer/measure/sound/whiteboard)
  'send-2', 'user-plus', 'clock', 'hourglass-low', 'clock-play', 'clock-pause', 'refresh', 'wiper', 'wiper-wash',
  'ear-off', 'ear', 'music-off', 'music', 'player-play', 'player-pause', 'player-track-next', 'arrows-shuffle', 'chalkboard-off', 'writing-sign', 'writing',
  // Customize Table / Scale & Grid / Members
  'arrow-autofit-width', 'arrow-autofit-height', 'dots', 'check', 'cancel', 'square', 'hexagon', 'eye', 'eye-off', 'box-align-top-left',
  'user-up', 'user-down', 'user-cog', 'user-minus', 'app-window-center', 'arrows-cross',
  // Rail / hand
  'chevrons-right', 'square-chevron-down', 'square-chevron-up',
  // Lobby + admin
  'user-shield', 'login', 'logout', 'shield-check', 'shield-x', 'door-enter', 'cursor-text', 'door-off', 'edit', 'arrow-back-up',
  // Library admin curation
  'copy', 'flag-check', 'flag-cancel',
];

async function fetchSymbol(name) {
  const url = `https://raw.githubusercontent.com/tabler/tabler-icons/${REF}/icons/outline/${name}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const raw = await res.text();
  const m = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!m) throw new Error(`${name}: no <svg> body`);
  const inner = m[1].replace(/\s+/g, ' ').trim();
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
}

const dupes = ICONS.filter((n, i) => ICONS.indexOf(n) !== i);
if (dupes.length) { console.error('Duplicate icon names:', [...new Set(dupes)].join(', ')); process.exit(1); }

const symbols = await Promise.all(ICONS.map(fetchSymbol));
const sprite = `<svg class="icon-sprite" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symbols.join('')}</svg>`;

for (const page of PAGES) {
  let html = await readFile(page, 'utf8');
  html = html.includes('class="icon-sprite"')
    ? html.replace(/<svg class="icon-sprite"[\s\S]*?<\/svg>/, () => sprite)
    : html.replace(/(<body[^>]*>)/, (m) => `${m}\n${sprite}`);
  await writeFile(page, html);
}
console.log(`Built sprite: ${ICONS.length} icons \u2192 ${PAGES.length} pages`);
