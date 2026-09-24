import { registerCollectionHandlers } from '../server/game/handlers/collections.js';
import { registerDeckBrowseHandlers } from '../server/game/handlers/deck-browsing.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { canUseRoomCapability } from '../server/permissions.js';
import {
  ROOM_MESSAGE_CAPABILITIES,
  allowRoomCapability,
  guardedMessage,
} from '../server/game/interaction-policy.js';
import { registerCardHandlers } from '../server/game/handlers/cards.js';
import { registerLibraryHandlers } from '../server/game/handlers/library.js';
import { registerMemberHandlers } from '../server/game/handlers/members.js';
import { registerMovementHandlers } from '../server/game/handlers/movement.js';
import { registerOverlayHandlers } from '../server/game/handlers/overlays.js';
import { registerPieceHandlers } from '../server/game/handlers/pieces.js';
import { registerPlacementHandlers } from '../server/game/handlers/placement.js';
import { registerRoomFeatureHandlers } from '../server/game/handlers/room-features.js';
import { registerRoomStateHandlers } from '../server/game/handlers/room-state.js';

const registrations = [
  registerDeckBrowseHandlers,
  registerCardHandlers,
  registerLibraryHandlers,
  registerMemberHandlers,
  registerMovementHandlers,
  registerOverlayHandlers,
  registerPieceHandlers,
  registerPlacementHandlers,
  registerRoomFeatureHandlers,
  registerRoomStateHandlers,
];
const user = (auth = {}) => ({
  sessionId: 'one',
  auth,
  sent: [],
  send(type, payload) {
    this.sent.push({ type, payload });
  },
});

function registeredHandlers() {
  const handlers = new Map();
  const room = {
    onMessage(type, handler) {
      assert.equal(handlers.has(type), false, `duplicate registration: ${type}`);
      handlers.set(type, handler);
    },
  };
  for (const register of registrations) register(room, {});
  registerCollectionHandlers(room, {})();
  return { room, handlers };
}

test('participation is independent of role and unknown capabilities fail closed', () => {
  for (const role of ['player', 'helper', 'gm', 'owner']) {
    assert.equal(canUseRoomCapability({ role }, 'gameplay'), true);
    for (const auth of [
      { role, timedOut: true },
      { role, participation: 'spectator' },
      { role, participation: 'player', timedOut: true },
      { role, participation: 'invalid' },
      { role, timedOut: 'false' },
    ]) {
      assert.equal(canUseRoomCapability(auth, 'gameplay'), false);
    }
  }
  for (const capability of new Set(Object.values(ROOM_MESSAGE_CAPABILITIES))) {
    assert.equal(canUseRoomCapability({ revoked: true }, capability), false);
    assert.equal(canUseRoomCapability({ participationReady: false }, capability), false);
    if (capability !== 'gameplay') {
      assert.equal(
        canUseRoomCapability({ timedOut: true, participation: 'spectator' }, capability),
        true,
      );
    }
  }
  assert.equal(canUseRoomCapability({}, 'unknown'), false);
});

test('unclassified requests cannot register, including prototype property names', () => {
  const room = {
    onMessage() {
      assert.fail('must not register');
    },
  };
  for (const type of ['newMutation', 'toString', '__proto__']) {
    assert.throws(() => guardedMessage(room, type, () => {}), /Unclassified table message/);
  }
});

test('every production registration has an explicit capability and uses the gate', async () => {
  const { handlers } = registeredHandlers();
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const table = source.slice(source.indexOf('class TableRoom'), source.indexOf('class EditorRoom'));
  assert.match(table, /const tableMessage = .*guardedMessage\(this, type, handler\)/);
  assert.doesNotMatch(table, /\b(?:safeMessage|onMessage)\(/);
  const inlineNames = [...table.matchAll(/tableMessage\('([^']+)'/g)].map((match) => match[1]);
  const names = [...handlers.keys(), ...inlineNames];
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.sort(), Object.keys(ROOM_MESSAGE_CAPABILITIES).sort());
  const dir = new URL('../server/game/handlers/', import.meta.url);
  for (const filename of await readdir(dir)) {
    if (!filename.endsWith('.js')) continue;
    const handlerSource = await readFile(new URL(filename, dir), 'utf8');
    assert.doesNotMatch(handlerSource, /\b(?:safeMessage|onMessage)\(/, filename);
  }
});

test('forged gameplay requests never enter real handler bodies while restricted', async () => {
  const { handlers } = registeredHandlers();
  // Bodies have no room state/dependencies here, so entering one throws and would
  // report the generic server failure instead of the participation denial.
  const message = new Proxy(
    {},
    {
      get() {
        assert.fail('payload read before authorization');
      },
    },
  );
  for (const auth of [
    { timedOut: true },
    { participation: 'spectator' },
    { participationReady: false },
  ]) {
    for (const [name, handler] of handlers) {
      if (ROOM_MESSAGE_CAPABILITIES[name] !== 'gameplay') continue;
      const client = user(auth);
      await handler(client, message);
      assert.equal(client.sent.length, 1, name);
      assert.equal(client.sent[0].payload.operation, name);
      assert.match(client.sent[0].payload.message, /spectating|loading/, name);
    }
  }
});

test('live policy is read on each dispatch and denied requests can recover', async () => {
  let invoke;
  let count = 0;
  const room = {
    onMessage(_type, handler) {
      invoke = handler;
    },
  };
  const client = user();
  guardedMessage(room, 'nextTurn', () => count++);
  await invoke(client);
  client.auth.timedOut = true;
  await invoke(client);
  client.auth.participation = 'player'; // does not lift a time-out
  await invoke(client);
  client.auth.timedOut = false;
  await invoke(client);
  assert.equal(count, 2);
  client.auth.revoked = true;
  await invoke(client);
  assert.equal(count, 2);
  assert.equal(allowRoomCapability(client, 'gameplay', 'nextTurn'), false);
  assert.equal(client.sent.length, 2); // revoked clients are not notified
});

test('restricted players can chat, read their hand and notebook, and stop revealing', async () => {
  const { room, handlers } = registeredHandlers();
  const client = user({ userId: 'account', timedOut: true, participation: 'spectator' });
  const events = [];
  room.state = { players: new Map([['one', { name: 'Player' }]]) };
  room.chatLog = [];
  room.notebooks = new Map();
  room.broadcast = (type) => events.push(type);
  room.sendHand = (target) => target.send('hand', ['private']);
  room.stopShow = (sid) => events.push(sid);
  await handlers.get('chat')(client, { text: 'Hello' });
  await handlers.get('handSync')(client);
  await handlers.get('notebook')(client, { text: 'My notes' });
  await handlers.get('notebookSync')(client);
  await handlers.get('showStop')(client);
  assert.equal(room.chatLog[0].text, 'Hello');
  assert.deepEqual(events, ['chatMsg', 'one']);
  assert.deepEqual(
    client.sent.map(({ type }) => type),
    ['hand', 'notebook'],
  );
  assert.equal(client.sent[1].payload, 'My notes');
});

for (const operation of ['kick', 'setRole']) {
  test(`${operation} rechecks loading policy after its target lookup`, async () => {
    const handlers = new Map();
    let resolveRead;
    const room = {
      roomId: 'room',
      onMessage(type, handler) {
        handlers.set(type, handler);
      },
      rank() {
        return 3;
      },
      canManage() {
        return true;
      },
      canSetRole() {
        return true;
      },
    };
    const db = {
      getMembership() {
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
      findUserById() {
        assert.fail('must stop before the next database operation');
      },
    };
    registerMemberHandlers(room, { db });
    const client = user({ userId: '1' });
    const pending = handlers.get(operation)(
      client,
      operation === 'kick' ? { userId: '2' } : { userId: '2', role: 'helper' },
    );
    assert.equal(typeof resolveRead, 'function');
    client.auth.participationReady = false;
    resolveRead({ role: 'player' });
    await pending;
    assert.match(client.sent[0].payload.message, /loading/);
  });
}
