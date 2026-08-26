const safeContext = (room, client, type) => ({
  type,
  roomId: room.roomId || room.roomId === 0 ? String(room.roomId) : (room.roomName || 'unknown'),
  roomCode: room.roomCode || undefined,
  userId: client?.auth?.userId == null ? undefined : String(client.auth.userId),
  sessionId: client?.sessionId || undefined,
});

export function safeMessage(room, type, handler, {
  errorType = 'serverError',
  publicMessage = 'Server error. Try again.',
  logger = console,
} = {}) {
  const report = (client, error) => {
    const context = safeContext(room, client, type);
    logger.error('[colyseus]', context, error && error.message ? error.message : error);
    try { client.send(errorType, { operation: type, message: publicMessage }); }
    catch (sendError) { logger.error('[colyseus:error-send]', context, sendError.message); }
  };

  room.onMessage(type, (client, message) => {
    try {
      return Promise.resolve(handler(client, message)).catch((error) => report(client, error));
    } catch (error) {
      report(client, error);
      return Promise.resolve();
    }
  });
}
