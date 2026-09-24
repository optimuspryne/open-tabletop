import { collectionPayload } from '../../../shared/asset-collections.js';
import { CollectionError } from '../../collection-queries.js';
import { canUseRoomCapability } from '../../permissions.js';
import { guardedMessage } from '../interaction-policy.js';

// Content-free invalidation spans rooms; each recipient refetches through live access checks.
const listeners = new Set();
export function invalidateCollections() {
  for (const listener of listeners) listener();
}
export function registerCollectionHandlers(room, { db, logger = console }) {
  const observe = (client) => canUseRoomCapability(client.auth ?? {}, 'observation');
  const notify = () => {
    for (const client of room.clients || [])
      if (observe(client)) {
        try {
          client.send('collectionsChanged', {});
        } catch {
          /* disconnected transport */
        }
      }
  };
  listeners.add(notify);
  const options = {
    logger,
    errorType: 'collectionError',
    publicMessage: 'Collections unavailable. Try again.',
  };
  guardedMessage(
    room,
    'listCollections',
    async (client, message) => {
      const value = collectionPayload(message, 'list');
      if (!value) return;
      const includePrivate = room.isAdmin(client);
      const result = await db.collections.list({ includePrivate, after: value.after });
      if (!observe(client) || (includePrivate && !room.isAdmin(client))) return;
      client.send('collectionList', { ...result, request: value.request });
    },
    options,
  );
  for (const operation of ['create', 'update', 'delete']) {
    guardedMessage(
      room,
      `${operation}Collection`,
      async (client, message) => {
        const authorize = () => observe(client) && room.isAdmin(client);
        if (!authorize()) {
          client.send('collectionError', { message: 'Only site admins can manage collections.' });
          return;
        }
        try {
          const result = await db.collections.mutate(operation, message, {
            ownerId: client.auth.userId,
            authorize,
          });
          if (authorize()) client.send('collectionSaved', { id: result.id, operation });
          invalidateCollections();
        } catch (error) {
          if (!(error instanceof CollectionError)) throw error;
          if (observe(client))
            client.send('collectionError', {
              operation: `${operation}Collection`,
              message: error.message,
            });
        }
      },
      options,
    );
  }
  return () => listeners.delete(notify);
}
