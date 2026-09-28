import {
  MAP_FOG,
  fogBoardSize,
  parseFog,
  decodeFogMask,
  encodeFogMask,
  normalizeFogStroke,
  paintFog,
} from '../../shared/map-fog.js';
import { RANK, canUseRoomCapability } from '../permissions.js';
import { pieceIdPayload, isPlainObject } from '../message-validation.js';
import { readProps } from './props-codec.js';
import { guardedMessage } from './interaction-policy.js';
import {
  FOG_AURA,
  canHaveFogAura,
  normalizeFogAura,
  parseFogAura,
  fogAuraPoint,
} from '../../shared/fog-auras.js';

export function registerMapFog(room, { now = Date.now } = {}) {
  const histories = new WeakMap(),
    lastEdit = new WeakMap();
  const auraBoards = new WeakMap(),
    lastAuraEdit = new WeakMap();

  // Sample every published simulation step, but rasterize/publish at a bounded rate. Each board
  // holds only live sources and short pending paths, never an unbounded exploration history.
  function updateAuras() {
    const time = now();
    const sources = [];
    for (const [id, piece] of room.state.pieces) {
      if (!piece.fogAura || piece.hidden || room.bodies?.get(id)?.__traySeat != null) continue;
      const aura = parseFogAura(piece.fogAura);
      if (aura?.enabled && canHaveFogAura(piece.type, readProps(piece)))
        sources.push({ id, piece, aura });
    }
    for (const board of room.state.pieces.values()) {
      if (board.type !== 'board') continue;
      if (board.hidden || !board.fog) {
        auraBoards.delete(board);
        continue;
      }
      let entry = auraBoards.get(board);
      const transform = [
        board.x,
        board.y,
        board.z,
        board.qx,
        board.qy,
        board.qz,
        board.qw,
        board.props,
      ].join('|');
      if (!entry || entry.source !== board.fog || entry.transform !== transform) {
        const fog = parseFog(board.fog),
          size = fogBoardSize(board.type, readProps(board));
        if (!fog?.enabled || !size) {
          auraBoards.delete(board);
          continue;
        }
        // Manual Cover/Undo wins over already sampled movement. Do not immediately repaint a
        // stationary aura after a manual edit; its next movement starts a new path.
        const positions = entry?.transform === transform ? entry.positions : new Map();
        for (const position of positions.values()) position.points = [];
        entry = { source: board.fog, transform, fog, size, positions, lastFlush: -Infinity };
        auraBoards.set(board, entry);
      }
      const live = new Set();
      for (const { id, piece, aura } of sources) {
        const point = fogAuraPoint(piece, board);
        if (!point) continue;
        live.add(id);
        let position = entry.positions.get(id);
        if (!position || position.piece !== piece || position.radius !== aura.radius) {
          position = { piece, radius: aura.radius, last: point, points: [point] };
          entry.positions.set(id, position);
        } else if (
          Math.hypot(point[0] - position.last[0], point[1] - position.last[1]) >= FOG_AURA.movement
        ) {
          if (!position.points.length) position.points.push(position.last);
          position.points.push(point);
          position.last = point;
        }
      }
      for (const id of entry.positions.keys()) if (!live.has(id)) entry.positions.delete(id);
      const paths = [...entry.positions.values()].filter((position) => position.points.length);
      if (
        !paths.length ||
        (time - entry.lastFlush < FOG_AURA.interval &&
          paths.every((position) => position.points.length < FOG_AURA.maxSamples))
      )
        continue;
      const mask = decodeFogMask(entry.fog.mask);
      let changed = false;
      for (const position of paths) {
        changed =
          paintFog(
            mask,
            { mode: 'reveal', radius: position.radius, points: position.points },
            entry.size,
          ) || changed;
        position.points = [];
      }
      entry.lastFlush = time;
      if (!changed) continue;
      entry.fog = { ...entry.fog, mask: encodeFogMask(mask), revision: entry.fog.revision + 1 };
      entry.source = board.fog = JSON.stringify(entry.fog);
      room.scheduleSave();
    }
  }

  guardedMessage(room, 'setFogAura', (client, message) => {
    const fail = (text) => client.send('serverError', { operation: 'setFogAura', message: text });
    if (room.rank(client) < RANK.gm || !canUseRoomCapability(client.auth, 'gameplay'))
      return fail('Only active GMs can configure fog auras.');
    const id = pieceIdPayload({ id: message?.id })?.id;
    const aura = isPlainObject(message) && normalizeFogAura(message.aura);
    if (!id || !aura) return fail('Invalid fog aura.');
    const piece = room.state.pieces.get(id);
    if (
      !piece ||
      !canHaveFogAura(piece.type, readProps(piece)) ||
      room.bodies?.get(id)?.__traySeat != null
    )
      return fail('Choose a tabletop piece for this aura.');
    if (message.previous !== (piece.fogAura || ''))
      return fail('This aura changed. Reopen its settings and try again.');
    const time = now();
    if (time - (lastAuraEdit.get(client) ?? -Infinity) < MAP_FOG.editInterval)
      return fail('Please wait a moment before editing an aura again.');
    lastAuraEdit.set(client, time);
    const value = JSON.stringify(aura);
    if (piece.fogAura !== value) {
      piece.fogAura = value;
      room.scheduleSave();
    }
    client.send('fogAuraEdited', { id, fogAura: value });
  });
  guardedMessage(room, 'fogEdit', (client, message) => {
    const fail = (text) => client.send('serverError', { operation: 'fogEdit', message: text });
    if (room.rank(client) < RANK.gm || !canUseRoomCapability(client.auth, 'gameplay'))
      return fail('Only active GMs can edit map fog.');
    const id = pieceIdPayload({ id: message?.id })?.id;
    if (!id || !isPlainObject(message)) return fail('Invalid fog edit.');
    const piece = room.state.pieces.get(id),
      size = piece && fogBoardSize(piece.type, readProps(piece));
    if (!size) return fail('Fog needs a board with valid dimensions.');
    const fog = parseFog(piece.fog);
    if (!fog || !Number.isSafeInteger(message.revision) || message.revision !== fog.revision)
      return fail('The map fog changed. Try the edit again.');
    const time = now();
    if (time - (lastEdit.get(client) ?? -Infinity) < MAP_FOG.editInterval)
      return fail('Please wait a moment before editing fog again.');
    lastEdit.set(client, time);
    const history = histories.get(piece) || [];
    let next = { ...fog };
    if (message.action === 'enable' && typeof message.enabled === 'boolean')
      next.enabled = message.enabled;
    else if (
      message.action === 'thickness' &&
      Number.isFinite(message.thickness) &&
      message.thickness >= 0 &&
      message.thickness <= MAP_FOG.maxThickness
    )
      next.thickness = message.thickness;
    else if (message.action === 'undo') {
      if (!history.length) return fail('No fog edit to undo in this room session.');
      next = { ...history.at(-1) };
    } else if (message.action === 'all' && ['cover', 'reveal'].includes(message.mode)) {
      if (!fog.enabled) return fail('Enable fog before painting.');
      const mask = decodeFogMask(fog.mask);
      mask.fill(message.mode === 'cover' ? 255 : 0);
      next.mask = encodeFogMask(mask);
    } else if (message.action === 'stroke') {
      const stroke = normalizeFogStroke(message, size);
      if (!stroke || !fog.enabled) return fail('Invalid fog brush stroke.');
      const mask = decodeFogMask(fog.mask);
      paintFog(mask, stroke, size);
      next.mask = encodeFogMask(mask);
    } else return fail('Invalid fog edit.');
    if (
      next.mask !== fog.mask ||
      next.enabled !== fog.enabled ||
      next.thickness !== fog.thickness ||
      message.action === 'undo'
    ) {
      if (message.action === 'undo') history.pop();
      else {
        history.push(fog);
        if (history.length > MAP_FOG.undoDepth) history.shift();
      }
      histories.set(piece, history);
      next.revision = fog.revision + 1;
      piece.fog = JSON.stringify(next);
      room.scheduleSave();
    }
    client.send('fogEdited', { id, revision: next.revision });
  });
  return { updateAuras };
}
