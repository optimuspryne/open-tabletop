// public/credits.js — attribution for all baked-in assets, in one place.
//
// MUSIC drives BOTH the background-music player and the credits panel. Kevin MacLeod's
// tracks are CC BY 4.0, which REQUIRES a visible credit — the credits panel is it.
// To add a track: drop the file in public/music/ and add a { title, file } entry below.
//
// The credit-only arrays below (SFX / MODEL / ART / LIB) feed the same Credits panel.
// Most bundled assets are CC0 and listed here as a courtesy; the CC BY entries
// (bentwood box, chess/checker board, Mahjong faces) list their credit as a LICENCE
// OBLIGATION — the panel must render them. See docs/ASSET_CREDITS.md for the full,
// per-file record (source pages, sub-attributions, and license notes).
export const MUSIC = [
    { title: 'Adding the Sun', file: 'Adding the Sun.mp3' },
    { title: 'Almost Bliss', file: 'Almost Bliss.mp3' },
    { title: 'Andreas Theme', file: 'Andreas Theme.mp3' },
    { title: 'A Very Brady Special', file: 'A Very Brady Special.mp3' },
    { title: 'Beauty Flow', file: 'Beauty Flow.mp3' },
    { title: 'Canon In D For 8 Bit Synths', file: 'Canon In D For 8 Bit Synths.mp3' },
    { title: 'Canon in D for Two Harps', file: 'Canon in D for Two Harps.mp3' },
    { title: 'Canon in D for Two Renaissance Harps', file: 'Canon in D for Two Renaissance Harps.mp3' },
    { title: 'Canon In D Interstellar Mix', file: 'Canon In D Interstellar Mix.mp3' },
    { title: 'Del Rio Bravo', file: 'Del Rio Bravo.mp3' },
    { title: 'Devonshire Waltz Allegretto', file: 'Devonshire Waltz Allegretto.mp3' },
    { title: 'Energizing', file: 'Energizing.mp3' },
    { title: 'Envision', file: 'Envision.mp3' },
    { title: 'Evening', file: 'Evening.mp3' },
    { title: 'Grand Dark Waltz Trio Allegro', file: 'Grand Dark Waltz Trio Allegro.mp3' },
    { title: 'Grand Dark Waltz Trio Vivace', file: 'Grand Dark Waltz Trio Vivace.mp3' },
    { title: 'Guzheng City', file: 'Guzheng City.mp3' },
    { title: 'Late Night Radio', file: 'Late Night Radio.mp3' },
    { title: 'Limit 70', file: 'Limit 70.mp3' },
    { title: 'Lotus', file: 'Lotus.mp3' },
    { title: 'Mana Two - Part 1', file: 'Mana Two - Part 1.mp3' },
    { title: 'Mana Two - Part 2', file: 'Mana Two - Part 2.mp3' },
    { title: 'Mana Two - Part 3', file: 'Mana Two - Part 3.mp3' },
    { title: 'Midnight Tale', file: 'Midnight Tale.mp3' },
    { title: 'Morning', file: 'Morning.mp3' },
    { title: 'Night in Venice', file: 'Night in Venice.mp3' },
    { title: 'Past Sadness', file: 'Past Sadness.mp3' },
    { title: 'Pleasant Porridge', file: 'Pleasant Porridge.mp3' },
    { title: 'Sincerely', file: 'Sincerely.mp3' },
    { title: 'Smooth Lovin', file: 'Smooth Lovin.mp3' },
    { title: 'Starting Out Waltz Allegretto', file: 'Starting Out Waltz Allegretto.mp3' },
    { title: 'Starting Out Waltz Vivace', file: 'Starting Out Waltz Vivace.mp3' },
    { title: 'Study And Relax', file: 'Study And Relax.mp3' },
    { title: 'Vibing Over Venus', file: 'Vibing Over Venus.mp3' },
    { title: 'Wholesome', file: 'Wholesome.mp3' },
];

// The shared attribution applied to every MUSIC track.
export const MUSIC_CREDIT = {
  by: 'Kevin MacLeod', url: 'https://incompetech.com',
  license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

// Credit-only entries (no player involvement). Each: { title, by, url, license, note? }.
// `url` links the author's name in the panel; `note` carries any extra attribution
// (a sub-credited texture, a requested site link) or a licence caveat.

// Sound effects — public/sounds/ (all CC0; listed as a courtesy).
export const SFX_CREDITS = [
  { title: '54 Casino Sound Effects', by: 'Kenney',      url: 'https://opengameart.org/users/kenney',      license: 'CC0' },
  { title: 'Card Game Sounds',        by: 'HaelDB',      url: 'https://opengameart.org/users/haeldb',      license: 'CC0' },
  { title: 'Playing Card Sounds',     by: 'BMacZero',    url: 'https://opengameart.org/users/bmaczero',    license: 'CC0' },
  { title: 'Sound Effects Pack',      by: 'OwlishMedia', url: 'https://opengameart.org/users/owlishmedia', license: 'CC0' },
];

// 3D models — public/models/ (CC0 unless noted; the CC BY entries are a licence obligation).
export const MODEL_CREDITS = [
  { title: 'Chess set',          by: 'rehcub',              url: 'https://opengameart.org/users/rehcub',            license: 'CC0' },
  { title: 'Human token',        by: 'Clint Bellanger',     url: 'https://opengameart.org/users/clint-bellanger',   license: 'CC0' },
  { title: 'Bowl (go bowl)',     by: 'DREAM_SEARCH_REPEAT', url: 'https://opengameart.org/users/dreamsearchrepeat', license: 'CC0' },
  { title: 'Poker chip',         by: 'mehrasaur',           url: 'https://opengameart.org/users/mehrasaur',         license: 'CC0' },
  { title: 'Gold coin',          by: 'plaggy',              url: 'https://opengameart.org/users/plaggy',            license: 'CC0' },
  { title: 'Chess / checker board', by: 'pennomi',          url: 'https://opengameart.org/users/pennomi',           license: 'CC BY 3.0', note: 'Board texture by Tiziana, submitted by bart (also LGPL 2.1 / LGPL 3.0).' },
  { title: 'Go board',           by: 'Jummit',              url: 'https://opengameart.org/users/jummit',            license: 'CC BY 4.0 / GPL 3.0', note: '© 2023 Jummit.' },
  { title: 'Bentwood box',       by: 'bobjh',               url: 'https://opengameart.org/users/bobjh',             license: 'CC BY 4.0' },
];

// 2D art — skyboxes (public/sky/) + tile faces (public/mahjong/).
export const ART_CREDITS = [
  { title: 'Cloudy skyboxes', by: 'Screaming Brain Studios', url: 'https://opengameart.org/users/screaming-brain-studios', license: 'CC0' },
  { title: 'Mahjong tileset', by: 'CodeInfernoGames',        url: 'https://codeinferno.com',                               license: 'CC BY 3.0', note: 'Author requests a link to codeinferno.com.' },
];

export const LIB_CREDITS = [
  { title: 'Three.js',  url: 'https://threejs.org',                    license: 'MIT' },
  { title: 'Colyseus',  url: 'https://colyseus.io',                    license: 'MIT' },
  { title: 'cannon-es', url: 'https://github.com/pmndrs/cannon-es',    license: 'MIT' },
];
