const safeContext = (room, client, type) => ({
  type,
  roomId: room.roomId || room.roomId === 0 ? String(room.roomId) : room.roomName || 'unknown',
  roomCode: room.roomCode || undefined,
  userId: client?.auth?.userId == null ? undefined : String(client.auth.userId),
  sessionId: client?.sessionId || undefined,
});

const report = (room, type, client, error, { errorType, publicMessage, logger, notify }) => {
  const context = safeContext(room, client, type);
  logger.error('[colyseus]', context, error && error.message ? error.message : error);
  if (!notify || !client) return;
  try {
    client.send(errorType, { operation: type, message: publicMessage });
  } catch (sendError) {
    logger.error('[colyseus:error-send]', context, sendError.message);
  }
};

export function safeRoomTask(
  room,
  type,
  client,
  task,
  {
    errorType = 'serverError',
    publicMessage = 'Server error. Try again.',
    logger = console,
    notify = true,
  } = {},
) {
  const options = { errorType, publicMessage, logger, notify };
  try {
    return Promise.resolve(task()).catch((error) => report(room, type, client, error, options));
  } catch (error) {
    report(room, type, client, error, options);
    return Promise.resolve();
  }
}

export function safeMessage(
  room,
  type,
  handler,
  { errorType = 'serverError', publicMessage = 'Server error. Try again.', logger = console } = {},
) {
  room.onMessage(type, (client, message) =>
    safeRoomTask(room, type, client, () => handler(client, message), {
      errorType,
      publicMessage,
      logger,
    }),
  );
}
