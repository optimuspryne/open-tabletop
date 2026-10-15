import { COZY_ROOM_THEME } from './cozy-theme.js';

// Static bundled registry: query parameters choose registered themes, never URLs
// or executable user definitions. Additional themes use the same six components.
export const ROOM_THEMES = Object.freeze({ cozy: COZY_ROOM_THEME });
export function getRoomTheme(id) {
  return Object.hasOwn(ROOM_THEMES, id) ? ROOM_THEMES[id] : null;
}
