import { createRoomEnvironment } from './rooms/room-environment.js';
import { COZY_ROOM_THEME } from './rooms/cozy-theme.js';

// Compatibility entry point for previews and callers predating the theme registry.
export { COZY_ROOM, COZY_ROOM_THEME } from './rooms/cozy-theme.js';
export function createCozyRoom(dependencies) {
  return createRoomEnvironment({ ...dependencies, theme: COZY_ROOM_THEME });
}
