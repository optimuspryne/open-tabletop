import { COZY_ROOM_THEME } from './cozy-theme.js';
import { POKER_NIGHT_THEME } from './poker-night-theme.js';
import { MEDIEVAL_TAVERN_THEME } from './medieval-tavern-theme.js';
import { MODERN_BAR_THEME } from './modern-bar-theme.js';

// Static bundled registry: shared room state chooses registered themes, never URLs
// or executable user definitions. Additional themes use the same six components.
export const ROOM_THEMES = Object.freeze({
  cozy: COZY_ROOM_THEME,
  'poker-night': POKER_NIGHT_THEME,
  'medieval-tavern': MEDIEVAL_TAVERN_THEME,
  'modern-bar': MODERN_BAR_THEME,
});
export function getRoomTheme(id) {
  return Object.hasOwn(ROOM_THEMES, id) ? ROOM_THEMES[id] : null;
}
