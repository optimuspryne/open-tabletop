import { deckBrowsePayload } from '../../message-validation.js';
import { guardedMessage } from '../interaction-policy.js';

export function registerDeckBrowseHandlers(room, { logger = console } = {}) {
  const bind = (type, kind, method) =>
    guardedMessage(
      room,
      type,
      (client, message) => {
        const parsed = deckBrowsePayload(message, kind);
        if (parsed) room.deckBrowsing[method](client, parsed);
      },
      { logger },
    );
  bind('browseDeck', 'start', 'start');
  bind('browseStep', 'step', 'step');
  bind('browseAction', 'action', 'action');
  bind('browseKeepAlive', 'keepAlive', 'keepAlive');
  bind('closeDeckBrowse', 'close', 'close');
  bind('setDeckBrowseAccess', 'access', 'setAccess');
}
