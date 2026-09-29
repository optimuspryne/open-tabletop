// Opt-in process-local budgets. Zero/unset retains the existing unrestricted
// deployment behavior; these do not replace transport/IP or persistent quotas.
export function readRoomResourceLimits(env = process.env) {
  const settings = {
    maxLiveRooms: 'ROOM_MAX_LIVE',
    maxConnections: 'ROOM_MAX_CONNECTIONS',
    maxConnectionsPerUser: 'ROOM_MAX_CONNECTIONS_PER_USER',
    maxPendingAuth: 'ROOM_MAX_PENDING_AUTH',
    maxMessagesPerSecond: 'ROOM_MAX_MESSAGES_PER_SECOND',
  };
  return Object.freeze(
    Object.fromEntries(
      Object.entries(settings).map(([key, name]) => {
        const raw = String(env[name] ?? '0').trim();
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
          throw new Error(`${name} must be a nonnegative safe integer (0 disables the limit).`);
        return [key, Number(raw) || Infinity];
      }),
    ),
  );
}
