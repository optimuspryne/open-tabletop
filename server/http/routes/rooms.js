import crypto from 'crypto';
import express from 'express';
import { asyncRoute } from '../async-route.js';
import { clientUser } from '../auth-context.js';

const roomCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

export function createRoomsRouter({ db, requireUser, hashPassword, isBoundedImageDataURL, matchMaker, disposeLive }) {
  const router = express.Router();

  router.get('/rooms', asyncRoute(async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const rooms = user.isAdmin ? await db.listRoomsForAdmin(user.id) : await db.listRoomsForUser(user.id);
    res.json({ rooms });
  }));

  router.post('/rooms', express.json({ limit: '1kb' }), asyncRoute(async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    if (!user.canOwnRooms) {
      return res.status(403).json({ error: user.hostStatus === 'pending'
        ? 'Your host access is pending admin approval.'
        : 'You need approved host access to create rooms.' });
    }
    const name = String((req.body && req.body.name) || '').trim().slice(0, 60) || 'Untitled Table';
    const requireApproval = !(req.body && req.body.requireApproval === false);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const room = await db.createRoom({ ownerId: user.id, code: roomCode(), name, requireApproval });
        return res.json({ room });
      } catch (error) {
        if (error.conflict === 'code') continue;
        throw error;
      }
    }
    res.status(500).json({ error: 'could not allocate a room code' });
  }));

  router.post('/rooms/join', express.json({ limit: '1kb' }), asyncRoute(async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const code = String((req.body && req.body.code) || '').trim().toUpperCase();
    const room = await db.findRoomByCode(code);
    if (!room) return res.status(404).json({ error: 'no active room with that code' });
    const membership = await db.joinRoom({ roomId: room.id, userId: user.id, requireApproval: room.requireApproval });
    if (membership && membership.status === 'pending') {
      try {
        const live = await matchMaker.query({ name: 'table', code });
        for (const record of live) await matchMaker.remoteRoomCall(record.roomId, 'broadcastMembers');
      } catch { /* no live table; GMs see the member on their next refresh */ }
    }
    res.json({ room, membership });
  }));

  async function ownedRoom(req, res) {
    const user = await requireUser(req, res); if (!user) return null;
    const room = await db.getRoom(req.params.id);
    if (!room || room.deletedAt) { res.status(404).json({ error: 'room not found' }); return null; }
    if (String(room.ownerId) !== String(user.id) && !user.isAdmin) { res.status(403).json({ error: 'not your room' }); return null; }
    return room;
  }

  router.patch('/rooms/:id', express.json({ limit: '1kb' }), asyncRoute(async (req, res) => {
    const room = await ownedRoom(req, res); if (!room) return;
    const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 60) : null;
    if (name) await db.renameRoom(room.id, name);
    if (req.body && typeof req.body.requireApproval === 'boolean') await db.setRoomPolicy(room.id, req.body.requireApproval);
    res.json({ room: await db.getRoom(room.id) });
  }));

  router.delete('/rooms/:id', asyncRoute(async (req, res) => {
    const room = await ownedRoom(req, res); if (!room) return;
    await db.softDeleteRoom(room.id);
    await disposeLive(room.code);
    res.json({ ok: true });
  }));

  // Routes outside /rooms live here because they share the same bearer-user context.
  router.post('/me/avatar', express.json({ limit: '128kb' }), asyncRoute(async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const data = req.body && req.body.data;
    if (!isBoundedImageDataURL(data)) return res.status(400).json({ error: 'invalid image' });
    await db.setUserAvatar(user.id, data);
    res.json({ ok: true, avatar: data });
  }));

  router.post('/host/request', express.json({ limit: '1kb' }), asyncRoute(async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    if (user.canOwnRooms) return res.json({ user: clientUser(user) });
    if (!user.hasPassword) {
      const password = req.body && req.body.password;
      if (!password || String(password).length < 8) return res.status(400).json({ error: 'set a password (8+ characters) to request host access' });
      await db.setPassword(user.id, await hashPassword(String(password)));
    }
    await db.setHostStatus(user.id, 'pending');
    res.json({ user: clientUser(await db.findUserById(user.id)) });
  }));

  return router;
}
