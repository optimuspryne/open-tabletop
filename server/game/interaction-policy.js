import { canUseRoomCapability } from '../permissions.js';
import { safeMessage } from './safe-message.js';

// Explicit inventory of client requests, not a replacement for handler-specific
// role/access checks. Mixed administration + spawn requests also check gameplay
// after validation and again after asynchronous work, immediately before spawning.
import { ROOM_MESSAGE_CAPABILITIES } from '../../shared/room-capabilities.js';
export { ROOM_MESSAGE_CAPABILITIES } from '../../shared/room-capabilities.js';

// Also used at async continuation boundaries. No client payload participates in
// authorization; auth is server-owned. Lifecycle recovery never calls this gate.
export function allowRoomCapability(client, capability, operation) {
  if (client && canUseRoomCapability(client.auth ?? {}, capability)) return true;
  if (client && !client.auth?.revoked) {
    client.send('serverError', {
      operation,
      message:
        client.auth?.participationReady === false
          ? 'Your table access is still loading. Try again shortly.'
          : 'Table interaction is unavailable while spectating or in time-out.',
    });
  }
  return false;
}

export function guardedMessage(room, type, handler, options) {
  if (!Object.hasOwn(ROOM_MESSAGE_CAPABILITIES, type)) {
    throw new Error(`Unclassified table message: ${type}`);
  }
  const capability = ROOM_MESSAGE_CAPABILITIES[type];
  safeMessage(
    room,
    type,
    (client, message) => {
      if (!allowRoomCapability(client, capability, type)) return;
      return handler(client, message);
    },
    options,
  );
}
