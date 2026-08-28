import { seatAngle, trayPlace } from '../../../shared/pieces.js';
import { RANK } from '../../permissions.js';
import { boundedString, oneField, pointPayload, showPayload } from '../../message-validation.js';
import { safeMessage } from '../safe-message.js';

export function registerRoomFeatureHandlers(
  room,
  { trayRoll, validSky, now = Date.now, random = Math.random, logger = console },
) {
  const featureMessage = (type, handler) => safeMessage(room, type, handler, { logger });

  featureMessage('roll', (client) => {
    const seat = room.seatOf(client);
    if (seat == null) return;
    let count = 0;
    room.state.pieces.forEach((piece, id) => {
      const body = room.bodies.get(id);
      if (piece.type !== 'die' || !body || body.__traySeat !== seat) return;
      rollBody(body, trayRoll, random);
      count++;
    });
    if (count) room.broadcast('sfx', { type: count > 1 ? 'dice-roll' : 'die-roll' });
  });

  featureMessage('trayScoop', (client) => {
    const seat = room.seatOf(client);
    if (seat == null || !room.state.trays.get(String(seat))) return;
    const center = room.trayCenterFor(seat);
    const angle = seatAngle(seat);
    let count = 0;
    room.state.pieces.forEach((piece, id) => {
      const body = room.bodies.get(id);
      if (piece.type !== 'die' || !body || body.__traySeat !== seat) return;
      const position = trayPlace(
        {
          x: (random() - 0.5) * 1.4,
          y: 0.6,
          z: (random() - 0.5) * 1,
        },
        center,
        angle,
      );
      body.position.set(position.x, position.y, position.z);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
      count++;
    });
    if (count) room.broadcast('sfx', { type: 'die-roll' });
  });

  featureMessage('trayClear', (client) => {
    const seat = room.seatOf(client);
    if (seat != null) room.clearTraySeat(seat);
  });

  featureMessage('trayShow', (client, message) => {
    const parsed = oneField(message, 'on', (on) => (typeof on === 'boolean' ? on : null));
    if (!parsed) return;
    const seat = room.seatOf(client);
    if (seat == null) return;
    if (parsed.on) {
      room.state.trays.set(String(seat), true);
    } else {
      room.state.trays.delete(String(seat));
      room.clearTraySeat(seat);
    }
    room.buildTrays();
  });

  featureMessage('chat', (client, message) => {
    const parsed = oneField(message, 'text', (text) => boundedString(text, { min: 1, max: 2000 }));
    if (!parsed) return;
    const text = parsed.text.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text) return;
    const player = room.state.players.get(client.sessionId);
    const entry = { from: player?.name || 'Player', text, ts: now() };
    room.chatLog.push(entry);
    if (room.chatLog.length > 80) room.chatLog.shift();
    room.broadcast('chatMsg', entry);
  });
  featureMessage('chatLog', (client) => client.send('chatLog', { log: room.chatLog }));

  featureMessage('skybox', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const parsed = oneField(message, 'url', (url) =>
      typeof url === 'string' && validSky(url) ? url : null,
    );
    if (!parsed) return;
    room.state.skybox = parsed.url;
    room.scheduleSave();
  });

  featureMessage('handSync', (client) => room.sendHand(client));

  featureMessage('whoami', (client) => client.send('whoami', { isAdmin: room.isAdmin(client) })); // re-requestable: allowReconnection skips onJoin, so a refresh never gets the push

  featureMessage('showStart', (client, message) => {
    const parsed = showPayload(message);
    if (!parsed) return;
    const sid = client.sessionId;
    const hand = room.hands.get(sid) || [];
    if (!hand.length) return;
    const cards =
      parsed.hids === 'all'
        ? hand.slice()
        : Array.isArray(parsed.hids)
          ? hand.filter((card) => parsed.hids.includes(card.hid))
          : null;
    if (!cards?.length) return;
    const audience = new Set();
    if (parsed.to === 'all') {
      room.state.players.forEach((player, sessionId) => {
        if (sessionId !== sid) audience.add(sessionId);
      });
    } else if (Array.isArray(parsed.to)) {
      for (const sessionId of parsed.to) {
        if (sessionId !== sid && room.state.players.has(sessionId)) audience.add(sessionId);
      }
    }
    if (!audience.size) return;
    room.stopShow(sid);
    room.shows.set(sid, { to: audience, cards });
    const player = room.state.players.get(sid);
    if (player) player.showing = cards.length;
    const payload = cards.map((card) => ({ front: card.front, back: card.back }));
    for (const viewer of audience) {
      room.clientBy(viewer)?.send('showFan', { sid, cards: payload });
    }
  });
  featureMessage('showStop', (client) => room.stopShow(client.sessionId));

  featureMessage('ping', (client, message) => {
    const point = pointPayload(message);
    if (!point) return;
    room.broadcast('ping', {
      sid: client.sessionId,
      x: Math.max(-room.state.tableX, Math.min(room.state.tableX, point.x)),
      z: Math.max(-room.state.tableZ, Math.min(room.state.tableZ, point.z)),
    });
  });
}

function rollBody(body, config, random) {
  body.wakeUp();
  body.velocity.set((random() - 0.5) * config.spread, config.up, (random() - 0.5) * config.spread);
  body.angularVelocity.set(
    (random() - 0.5) * config.spin,
    (random() - 0.5) * config.spin,
    (random() - 0.5) * config.spin,
  );
}
