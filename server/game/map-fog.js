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

export function registerMapFog(room, { now = Date.now } = {}) {
  const histories = new WeakMap(),
    lastEdit = new WeakMap();
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
}
