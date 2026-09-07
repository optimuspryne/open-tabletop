import { ServerError } from '@colyseus/core';

const sameUser = (auth, userId) => String(auth.userId) === String(userId);

// Process-local, like the current Colyseus room registry. Entries survive network
// drops until the reconnect window ends; token hashes never enter synced state.
export function createRoomAccess({ db, hashToken }) {
  const rooms = new Map();
  const pendingChecks = new Set();
  let checking = false;

  function changed({ room, userId, tokenHash }) {
    for (const check of pendingChecks) {
      if (room && room !== check.room) continue;
      if (tokenHash !== undefined) {
        if (tokenHash === check.tokenHash) check.invalidated = true;
      } else if (userId !== undefined) {
        check.changedUsers.add(String(userId));
      } else {
        check.invalidated = true;
      }
    }
  }

  async function checkedAccess(room, kind, tokenHash, apply) {
    const check = { room, tokenHash, invalidated: false, changedUsers: new Set() };
    pendingChecks.add(check);
    try {
      const auth = await readAccess(room, kind, tokenHash);
      if (check.invalidated || check.changedUsers.has(String(auth.userId))) {
        const error = new ServerError(403, 'Access changed. Please join again.');
        error.accessChanged = true;
        throw error;
      }
      // Install the result before releasing the guard; an extra await here would
      // leave a gap where revocation could miss a newly authorized connection.
      return apply(auth);
    } finally {
      pendingChecks.delete(check);
    }
  }

  async function readAccess(room, kind, tokenHash) {
    const user = await db.findUserByToken(tokenHash);
    if (!user) throw new ServerError(401, 'Please sign in first.');
    let role = 'owner';
    if (kind === 'editor') {
      if (!user.isAdmin) throw new ServerError(403, 'The library editor is for site admins only.');
    } else {
      const record = await db.findRoomByCode(room.roomCode);
      if (!record) throw new ServerError(404, 'That room no longer exists.');
      const member = await db.getMembership(record.id, user.id);
      if (kind === 'lobby') {
        if (!member || member.status !== 'pending')
          throw new ServerError(403, 'Only pending members may wait in this lobby.');
        role = 'player';
      } else {
        role = user.isAdmin ? 'owner' : member?.status === 'admitted' ? member.role : null;
        if (!role) throw new ServerError(403, 'You are not an admitted member of this room.');
      }
    }
    return {
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      role,
      isAdmin: !!user.isAdmin,
    };
  }

  function entries(room) {
    return rooms.get(room)?.values() || [];
  }

  function disconnect(entry, notice) {
    entry.auth.revoked = true; // stop queued messages before the socket finishes closing
    entry.reconnection?.reject?.(new ServerError(403, 'Access revoked.'));
    try {
      if (notice && entry.kind !== 'lobby') entry.client.send(notice);
    } catch {
      // A disconnected socket still needs its reconnect reservation revoked.
    }
    try {
      entry.client.leave(4000);
    } catch {
      // Already closed; continue revoking the user's other connections.
    }
  }

  function revoke(scope, notice = 'accessRevoked') {
    changed(scope); // reject only affected authorization reads already in flight
    let affectedRooms = 0;
    for (const [room, clients] of rooms) {
      let affected = false;
      for (const entry of clients.values()) {
        if (entry.auth.revoked || (scope.room && scope.room !== room)) continue;
        if (scope.userId !== undefined && !sameUser(entry.auth, scope.userId)) continue;
        if (scope.tokenHash !== undefined && scope.tokenHash !== entry.tokenHash) continue;
        affected = true;
        disconnect(entry, notice);
      }
      if (affected) affectedRooms++;
    }
    return affectedRooms;
  }

  return {
    assertActive(room, client) {
      const entry = rooms.get(room)?.get(client.sessionId);
      if (!entry || entry.auth.revoked) throw new ServerError(403, 'Access revoked.');
    },

    async authorize(room, client, options, kind = 'table') {
      if (kind !== 'editor' && (!room.roomCode || options?.code !== room.roomCode))
        throw new ServerError(403, 'The room code does not match this room.');
      if (typeof options?.token !== 'string' || !options.token)
        throw new ServerError(401, 'Please sign in first.');
      const tokenHash = hashToken(options.token);
      return checkedAccess(room, kind, tokenHash, (auth) => {
        if (!rooms.has(room)) rooms.set(room, new Map());
        rooms.get(room).set(client.sessionId, { client, auth, tokenHash, kind });
        return auth;
      });
    },

    async reconnect(room, client) {
      const entry = rooms.get(room)?.get(client.sessionId);
      if (!entry || entry.auth.revoked) throw new ServerError(403, 'Access revoked.');
      entry.client = client;
      try {
        await checkedAccess(room, entry.kind, entry.tokenHash, (auth) => {
          if (entry.auth.revoked) throw new ServerError(403, 'Access changed. Please join again.');
          Object.assign(entry.auth, auth);
          client.auth = entry.auth;
          const player = room.state?.players?.get(client.sessionId);
          if (player) player.role = auth.role;
        });
      } catch (error) {
        entry.auth.revoked = true; // failed rechecks must not start another reconnect window
        throw error;
      }
    },

    async waitForReconnect(room, client, seconds) {
      const entry = rooms.get(room)?.get(client.sessionId);
      if (!entry || entry.auth.revoked) throw new ServerError(403, 'Access revoked.');
      const pending = room.allowReconnection(client, seconds);
      entry.reconnection = pending;
      try {
        const next = await pending;
        entry.client = next;
        if (entry.auth.revoked) throw new ServerError(403, 'Access revoked.');
      } finally {
        entry.reconnection = null;
      }
    },

    setRole(room, userId, role) {
      changed({ room, userId });
      for (const entry of entries(room)) {
        if (!sameUser(entry.auth, userId) || entry.auth.revoked) continue;
        entry.auth.role = role;
        const player = room.state?.players?.get(entry.client.sessionId);
        if (player) player.role = role;
      }
    },

    kickRoom: (room, userId) => revoke({ room, userId }, 'kicked'),
    kickUser: (userId) => revoke({ userId }, 'kicked'),
    revokeUser: (userId) => revoke({ userId }),
    revokeSession: (tokenHash) => revoke({ tokenHash }),

    // Also observe session expiry and administrative changes made by the CLI or
    // directly in Postgres, which do not pass through this process's HTTP hooks.
    async revalidate() {
      if (checking) return;
      checking = true;
      try {
        const pending = [...rooms].flatMap(([room, clients]) =>
          [...clients.values()].map((entry) => ({ room, entry })),
        );
        for (const { room, entry } of pending) {
          if (entry.auth.revoked || rooms.get(room)?.get(entry.client.sessionId) !== entry)
            continue;
          const invalidate = () => {
            if (entry.auth.revoked || rooms.get(room)?.get(entry.client.sessionId) !== entry)
              return;
            changed({ room, userId: entry.auth.userId });
            disconnect(entry, 'accessRevoked');
          };
          try {
            await checkedAccess(room, entry.kind, entry.tokenHash, (auth) => {
              if (auth.role !== entry.auth.role || auth.isAdmin !== entry.auth.isAdmin)
                invalidate();
            });
          } catch (error) {
            if (error.accessChanged) continue; // a newer local mutation owns this result
            // Fail closed on expired credentials, missing membership, or DB failure.
            invalidate();
          }
        }
      } finally {
        checking = false;
      }
    },

    forget(room, client) {
      const clients = rooms.get(room);
      clients?.delete(client.sessionId);
      if (clients?.size === 0) rooms.delete(room);
    },

    dispose(room) {
      changed({ room });
      for (const entry of entries(room)) {
        entry.auth.revoked = true;
        entry.reconnection?.reject?.(new ServerError(403, 'Room disposed.'));
      }
      rooms.delete(room);
    },
  };
}
