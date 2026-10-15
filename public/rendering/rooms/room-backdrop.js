import { normalizeRoomEnvironment } from '../../../shared/room-environments.js';
import { getRoomTheme } from './room-themes.js';
import { createRoomEnvironment } from './room-environment.js';

// One viewer's renderer for a server-owned room choice. Switching styles tears
// down the old owner first; stale GLB callbacks are handled by that owner's guard.
export function createRoomBackdrop({ createEnvironment = createRoomEnvironment, ...dependencies }) {
  let active = null;
  let id = null;
  let disposed = false;
  return {
    sync(state) {
      if (disposed) return;
      const next = normalizeRoomEnvironment(state.environment);
      if (next !== id) {
        active?.dispose();
        active = null;
        id = null;
        const theme = getRoomTheme(next);
        if (theme) active = createEnvironment({ ...dependencies, theme });
        id = next;
      }
      active?.sync(state);
    },
    update(position, target) {
      active?.update(position, target);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active?.dispose();
      active = null;
    },
  };
}
