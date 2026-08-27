import { RANK } from '../../permissions.js';
import {
  finiteNumber,
  oneField,
  overlayGeometry,
  overlayIdPayload,
  overlayMovePayload,
  whiteboardStroke,
} from '../../message-validation.js';
import { safeMessage } from '../safe-message.js';

const TWO_PI = Math.PI * 2;

export function registerOverlayHandlers(room, {
  createOverlay,
  kinds,
  maxLength,
  maxOverlays,
  maxPerPlayer,
  maxStrokes,
  logger = console,
}) {
  const overlayMessage = (type, handler) => safeMessage(room, type, handler, { logger });

  overlayMessage('overlayAdd', (client, message) => {
    const msg = overlayGeometry(message, { kinds, maxLen: maxLength, requireKind: true });
    if (!msg || room.state.overlays.size >= maxOverlays) return;
    let owned = 0;
    room.state.overlays.forEach((overlay) => {
      if (overlay.owner === client.sessionId) owned++;
    });
    if (owned >= maxPerPlayer) return;
    const player = room.state.players.get(client.sessionId);
    const overlay = createOverlay();
    overlay.kind = msg.kind;
    overlay.owner = client.sessionId;
    overlay.color = player?.color || '#ffffff';
    overlay.x = msg.x;
    overlay.z = msg.z;
    overlay.x2 = msg.x2;
    overlay.z2 = msg.z2;
    overlay.w = msg.w || 0;
    overlay.ang = msg.ang || 0;
    room.state.overlays.set(`o${room.nextOverlayId++}`, overlay);
  });

  overlayMessage('overlayMove', (client, message) => {
    const msg = overlayMovePayload(message, { maxLen: maxLength });
    if (!msg) return;
    const overlay = room.state.overlays.get(msg.id);
    if (!overlay || (overlay.owner !== client.sessionId && room.rank(client) < RANK.gm)) return;
    for (const key of ['x', 'z', 'x2', 'z2', 'w', 'ang']) {
      if (msg[key] !== undefined) overlay[key] = msg[key];
    }
  });

  overlayMessage('overlayRemove', (client, message) => {
    const msg = overlayIdPayload(message);
    if (!msg) return;
    const overlay = room.state.overlays.get(msg.id);
    if (!overlay || (overlay.owner !== client.sessionId && room.rank(client) < RANK.gm)) return;
    room.state.overlays.delete(msg.id);
  });

  overlayMessage('overlayClear', (client, message) => {
    const msg = oneField(message, 'scope', (scope) => ['all', 'mine'].includes(scope) ? scope : null);
    if (!msg) return;
    const clearAll = msg.scope === 'all' && room.rank(client) >= RANK.gm;
    const ids = [];
    room.state.overlays.forEach((overlay, id) => {
      if (clearAll || overlay.owner === client.sessionId) ids.push(id);
    });
    for (const id of ids) room.state.overlays.delete(id);
  });

  overlayMessage('overlayDrag', (client, message) => {
    const msg = overlayGeometry(message, {
      kinds,
      maxLen: maxLength,
      allowEmpty: true,
      requireKind: Object.keys(message || {}).length > 0,
    });
    if (!msg) return;
    const player = room.state.players.get(client.sessionId);
    const color = player?.color || '#ffffff';
    const payload = msg.kind
      ? {
          from: client.sessionId,
          kind: msg.kind,
          color,
          x: msg.x,
          z: msg.z,
          x2: msg.x2,
          z2: msg.z2,
          w: msg.w || 0,
          ang: msg.ang || 0,
        }
      : { from: client.sessionId, kind: null };
    room.broadcast('overlayDrag', payload, { except: client });
  });

  overlayMessage('wbEnable', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const parsed = oneField(message, 'on', (on) => typeof on === 'boolean' ? on : null);
    if (!parsed) return;
    room.state.whiteboard.enabled = parsed.on;
    if (!parsed.on) {
      room.strokes = [];
      room.state.whiteboard.owner = '';
      room.broadcast('wbClear');
    }
  });

  overlayMessage('wbSet', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const angle = oneField(message, 'angle', (value) => finiteNumber(value, { min: -TWO_PI, max: TWO_PI }));
    const dark = oneField(message, 'dark', (value) => typeof value === 'boolean' ? value : null);
    const msg = angle || dark;
    if (!msg) return;
    if (msg.angle !== undefined) {
      room.state.whiteboard.angle = ((msg.angle % TWO_PI) + TWO_PI) % TWO_PI;
    }
    if (msg.dark !== undefined) room.state.whiteboard.dark = msg.dark;
  });

  overlayMessage('wbClaim', (client) => {
    const whiteboard = room.state.whiteboard;
    if (whiteboard.enabled && !whiteboard.owner) whiteboard.owner = client.sessionId;
  });
  overlayMessage('wbRelease', (client) => {
    if (room.state.whiteboard.owner === client.sessionId) room.state.whiteboard.owner = '';
  });
  overlayMessage('wbStroke', (client, message) => {
    if (room.state.whiteboard.owner !== client.sessionId) return;
    const parsed = whiteboardStroke(message);
    if (!parsed) return;
    const stroke = { ...parsed, sid: client.sessionId };
    room.strokes.push(stroke);
    if (room.strokes.length > maxStrokes) room.strokes.shift();
    room.broadcast('wbStroke', stroke);
  });
  overlayMessage('wbClear', (client) => {
    if (room.state.whiteboard.owner !== client.sessionId && room.rank(client) < RANK.gm) return;
    room.strokes = [];
    room.broadcast('wbClear');
  });
  overlayMessage('wbStrokes', (client) => {
    client.send('wbStrokes', { strokes: room.strokes });
  });
}
