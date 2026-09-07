import { timerLive } from '../../../shared/pieces.js';
import { RANK } from '../../permissions.js';
import {
  boundedString,
  gridCalibrationPayload,
  hexColor,
  oneField,
  scalePayload,
  scorePayload,
  tablePayload,
  timerPayload,
} from '../../message-validation.js';
import { safeMessage, safeRoomTask } from '../safe-message.js';

export function registerRoomStateHandlers(
  room,
  { createScoreRow, tableLimits, gridLiftMax, sceneMaxBytes, now = Date.now, logger = console },
) {
  const roomMessage = (type, handler) => safeMessage(room, type, handler, { logger });
  // Accounts are stable across reconnects and fresh browser joins. The session fallback still
  // supports unauthenticated/editor clients for the lifetime of their connection.
  const notebookKey = (client) =>
    client.auth?.userId != null ? `user:${client.auth.userId}` : `session:${client.sessionId}`;

  safeMessage(
    room,
    'stateSave',
    async (client) => {
      if (room.rank(client) < RANK.gm) return;
      if (!room.roomId) {
        client.send('sceneError', { message: 'This table has no persistent room to save.' });
        return;
      }
      const payload = room.serializeGame();
      if (JSON.stringify(payload).length > sceneMaxBytes) {
        client.send('sceneError', {
          message:
            'Table state is too large to save. Save any table-built decks to the library first so their art is stored as files.',
        });
        return;
      }
      room.savedScene = payload;
      await room.saveStateNow();
      client.send('stateSaved', {});
    },
    { logger, errorType: 'sceneError', publicMessage: 'Could not save table state. Try again.' },
  );

  roomMessage('notebook', (client, message) => {
    const parsed = oneField(message, 'text', (text) => boundedString(text, { max: 4000 }));
    if (parsed) room.notebooks.set(notebookKey(client), parsed.text);
  });
  roomMessage('notebookSync', (client) =>
    client.send('notebook', room.notebooks.get(notebookKey(client)) || ''),
  );

  roomMessage('timer', (client, message) => {
    const msg = timerPayload(message);
    if (!msg) return;
    const timer = room.state.timer;
    const timestamp = now();
    if (timer.running) {
      timer.base = timerLive(timer, timestamp);
      timer.running = false;
      timer.since = 0;
    }
    if (msg.action === 'start') {
      timer.since = timestamp;
      timer.running = true;
    } else if (msg.action === 'reset') {
      timer.base = timer.mode === 'down' ? timer.duration : 0;
    } else if (msg.action === 'set') {
      if (msg.mode === 'up' || msg.mode === 'down') timer.mode = msg.mode;
      if (Number.isFinite(msg.duration))
        timer.duration = Math.max(0, Math.min(86400000, msg.duration));
      timer.base = timer.mode === 'down' ? timer.duration : 0;
    }
  });

  roomMessage('score', (client, message) => {
    if (room.rank(client) < RANK.helper) return;
    const msg = scorePayload(message);
    if (!msg) return;
    const scores = room.state.scores;
    if (msg.action === 'add') {
      if (scores.size >= 50) return;
      scores.set(`s${room.nextScoreId++}`, createScoreRow(msg.label, 0));
    } else if (msg.action === 'remove') {
      scores.delete(msg.id);
    } else if (msg.action === 'label') {
      const row = scores.get(msg.id);
      if (row) row.label = msg.label;
    } else if (msg.action === 'adjust') {
      const row = scores.get(msg.id);
      if (row) row.score = Math.max(-1e9, Math.min(1e9, row.score + msg.delta));
    } else if (msg.action === 'set') {
      const row = scores.get(msg.id);
      if (row) row.score = msg.score;
    } else if (msg.action === 'clear') {
      scores.clear();
    } else {
      return;
    }
    room.scheduleSave();
  });

  roomMessage('roomNotes', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const parsed = oneField(message, 'text', (text) => boundedString(text, { max: 8000 }));
    if (!parsed) return;
    room.state.notes = parsed.text;
    room.scheduleSave();
  });

  roomMessage('table', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const parsed = tablePayload(message, tableLimits);
    if (!parsed) return;
    if (parsed.x !== undefined) room.state.tableX = parsed.x;
    if (parsed.z !== undefined) room.state.tableZ = parsed.z;
    if (parsed.shape !== undefined) room.state.tableShape = parsed.shape;
    if (parsed.rimWood !== undefined) room.state.rimWood = parsed.rimWood;
    room.buildBounds(room.state.tableX, room.state.tableZ, room.state.tableShape);
    room.scheduleSave();
  });

  roomMessage('tableColor', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const parsed = oneField(message, 'color', hexColor);
    if (!parsed) return;
    room.state.feltColor = parsed.color;
    room.scheduleSave();
  });

  roomMessage('scaleSet', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const msg = scalePayload(message, { gridLiftMax });
    if (!msg) return;
    Object.assign(room.state.scale, msg);
    room.scheduleSave();
  });

  roomMessage('calibrateGrid', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const msg = gridCalibrationPayload(message);
    if (msg) room.calibrateGrid(msg);
  });
}

export function scheduleRoomSave(
  room,
  { delay = 800, setTimer = setTimeout, logger = console } = {},
) {
  if (!room.roomId || room._saveTimer) return;
  room._saveTimer = setTimer(() => {
    room._saveTimer = null;
    void safeRoomTask(room, 'saveState', null, () => room.saveStateNow(), {
      notify: false,
      logger,
    });
  }, delay);
}

// Empty and hands-only games are real snapshots, not a reason to keep an old save.
export async function saveFinalRoomState(room, { sceneMaxBytes, clearTimer = clearTimeout }) {
  if (room._saveTimer) clearTimer(room._saveTimer);
  room._saveTimer = null;
  const snapshot = room.serializeGame();
  if (JSON.stringify(snapshot).length <= sceneMaxBytes) room.savedScene = snapshot;
  await room.saveStateNow();
}

export async function saveRoomStateNow(room, { db }) {
  if (!room.roomId) return;
  const scoreboard = [];
  room.state.scores.forEach((row, id) =>
    scoreboard.push({
      id,
      label: row.label,
      score: row.score,
    }),
  );
  const roomId = room.roomId;
  const payload = structuredClone({
    scoreboard,
    notes: room.state.notes,
    tableX: room.state.tableX,
    tableZ: room.state.tableZ,
    tableShape: room.state.tableShape,
    rimWood: room.state.rimWood,
    skybox: room.state.skybox,
    feltColor: room.state.feltColor,
    scene: room.savedScene,
    scale: room.scaleSnapshot(),
  });
  // Capture at request time and serialize writes, including background/final saves.
  const pending = (room._savePromise || Promise.resolve()).then(async () => {
    const result = await db.saveRoomState(roomId, payload);
    if (result?.rowCount === 0) throw new Error('Room no longer exists');
  });
  room._savePromise = pending.catch(() => {}); // a failed write must not poison later saves
  await pending;
}
