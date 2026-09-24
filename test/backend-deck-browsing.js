import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeckBrowsing, BROWSE_IDLE_MS } from '../server/game/deck-browsing.js';
import { registerDeckBrowseHandlers } from '../server/game/handlers/deck-browsing.js';
import { registerCardHandlers } from '../server/game/handlers/cards.js';
import { registerPieceHandlers } from '../server/game/handlers/pieces.js';
import { stopPlayerInteraction } from '../server/game/interaction-cleanup.js';
import { deckBrowsePayload } from '../server/message-validation.js';
import { RANK } from '../server/permissions.js';

function harness(entries = ['bottom', 'same', 'same'], props = {}) {
  let time = 0,
    nonce = 0;
  const handlers = new Map(),
    broadcasts = [];
  const room = {
    roomId: 'room',
    nextId: 2,
    nextHid: 1,
    state: {
      pieces: new Map([
        [
          '1',
          {
            type: 'deck',
            props: JSON.stringify({ back: 'back', ...props }),
            count: entries.length,
          },
        ],
      ]),
      players: new Map(),
      whiteboard: { owner: '' },
    },
    deckCards: new Map([['1', entries.slice()]]),
    bodies: new Map([['1', { position: { x: 0, y: 1, z: 0 } }]]),
    hands: new Map(),
    cardData: new Map(),
    pendingInspect: new Map(),
    targets: new Map(),
    groups: new Map(),
    lastDrop: new Map(),
    rank: (client) => RANK[client.auth.role] ?? 0,
    onMessage: (type, handler) => handlers.set(type, handler),
    broadcast: (...args) => broadcasts.push(args),
    stopShow() {},
    notifyFull() {},
    updateDeckCollider() {},
    besideDeck: () => [2, 3, 0],
    removePiece(id) {
      this.deckBrowsing.cancelDeck(id);
      this.state.pieces.delete(id);
      this.deckCards.delete(id);
      this.cardData.delete(id);
      this.bodies.delete(id);
    },
    spawnCardFlat(position, data) {
      const id = String(this.nextId++);
      this.state.pieces.set(id, { type: 'card', props: JSON.stringify(data) });
      return id;
    },
    addToHand(client, front, back, geo, open) {
      const hand = this.hands.get(client.sessionId) || [];
      hand.push({ hid: `h${this.nextHid++}`, front, back, ...geo, open });
      this.hands.set(client.sessionId, hand);
    },
    sendHand(client) {
      client.send('hand', this.hands.get(client.sessionId));
    },
  };
  const options = {
    geoOf: (props) => ({
      ...(props.geom ? { geom: props.geom } : {}),
      ...(props.tile ? { tile: props.tile } : {}),
    }),
    maxPieces: 3,
    now: () => time,
    token: () => `token-${++nonce}`,
    logger: { error() {} },
    shuffle: (cards) => cards.reverse(),
  };
  room.deckBrowsing = createDeckBrowsing(room, options);
  registerDeckBrowseHandlers(room, options);
  registerCardHandlers(room, options);
  registerPieceHandlers(room, options);
  const client = (sid, role = 'gm') => ({
    sessionId: sid,
    auth: { role, participation: 'player', timedOut: false },
    sent: [],
    send(type, data) {
      this.sent.push([type, structuredClone(data)]);
    },
  });
  const gm = client('gm'),
    player = client('player', 'player');
  const send = (who, type, data) => handlers.get(type)(who, data);
  const preview = (who = gm) => who.sent.findLast(([type]) => type === 'deckBrowseCard')?.[1];
  const start = async (who = gm) => {
    await send(who, 'browseDeck', { deckId: '1' });
    return preview(who);
  };
  const action = (where, card = preview(), who = gm, requestId = `request-${++nonce}`) =>
    send(who, 'browseAction', {
      token: card.token,
      revision: card.revision,
      entryToken: card.entryToken,
      action: where,
      requestId,
    });
  return {
    room,
    gm,
    player,
    client,
    send,
    start,
    action,
    preview,
    broadcasts,
    advance: (ms) => {
      time += ms;
    },
  };
}

test('GM-only defaults include open decks; only a live GM may enable players', async () => {
  for (const open of [false, true]) {
    const h = harness(undefined, { open });
    await h.start(h.player);
    assert.equal(h.preview(h.player), undefined);
    await h.send(h.player, 'setDeckBrowseAccess', { deckId: '1', access: 'players' });
    assert.equal(JSON.parse(h.room.state.pieces.get('1').props).browseAccess, undefined);
    await h.send(h.gm, 'setDeckBrowseAccess', { deckId: '1', access: 'players' });
    const view = await h.start(h.player);
    assert.equal(view.front, 'same');
    assert.deepEqual(h.broadcasts, []);
    for (const auth of [{ participation: 'spectator' }, { timedOut: true }, { revoked: true }]) {
      h.room.deckBrowsing.cancelClient('player');
      Object.assign(
        h.player.auth,
        { participation: 'player', timedOut: false, revoked: false },
        auth,
      );
      const n = h.player.sent.filter(([type]) => type === 'deckBrowseCard').length;
      await h.start(h.player);
      assert.equal(h.player.sent.filter(([type]) => type === 'deckBrowseCard').length, n);
    }
  }
});

test('opening and stepping keep deck order private and distinguish duplicate entries', async () => {
  const h = harness();
  const first = await h.start();
  assert.deepEqual(h.room.deckCards.get('1'), ['bottom', 'same', 'same']);
  assert.equal(first.position, 1);
  assert.equal(first.count, 3);
  assert.equal('cards' in first, false);
  assert.equal('front' in h.room.state.pieces.get('1'), false);
  await h.send(h.gm, 'browseStep', { token: first.token, revision: first.revision, direction: 1 });
  const second = h.preview();
  assert.equal(second.position, 2);
  assert.notEqual(second.entryToken, first.entryToken);
  await h.action('hand', first);
  assert.equal(h.room.hands.size, 0);
  await h.action('hand', second);
  assert.equal(h.room.deckCards.get('1').length, 2);
  assert.equal(h.room.hands.get('gm').length, 1);
});

test('exclusive sessions reject foreign tokens, conflicting messages and pending inspections', async () => {
  const h = harness(undefined, { browseAccess: 'players' });
  const view = await h.start();
  await h.start(h.player);
  assert.equal(h.preview(h.player), undefined);
  await h.send(h.player, 'browseStep', {
    token: view.token,
    revision: view.revision,
    direction: 1,
  });
  assert.equal(h.preview(h.player), undefined);
  for (const type of ['drawToHand', 'drawInspect', 'shuffle', 'splitDeck', 'dealToTable']) {
    await h.send(h.player, type, { deckId: '1' });
    assert.deepEqual(h.room.deckCards.get('1'), ['bottom', 'same', 'same'], type);
  }
  await h.send(h.player, 'dealDrag', { deckId: '1', x: 0, y: 3, z: 0 });
  await h.send(h.player, 'setOpenGroup', { ids: ['1'] });
  assert.equal(JSON.parse(h.room.state.pieces.get('1').props).open, undefined);
  h.room.state.pieces.set('2', { type: 'card', props: '{"front":"loose","back":"back"}' });
  h.room.bodies.set('2', { position: { x: 0, y: 2, z: 0 } });
  await h.send(h.player, 'combineIntoDeck', { ids: ['1', '2'] });
  assert.equal(h.room.state.pieces.size, 2);
  h.player.auth.role = 'helper';
  await h.send(h.player, 'remove', { id: '1' });
  assert.ok(h.room.state.pieces.has('1'));
  await h.send(h.player, 'removeGroup', { ids: ['1', '2'] });
  assert.equal(h.room.state.pieces.size, 2);
  h.room.deckBrowsing.cancelClient('gm');
  h.room.pendingInspect.set('someone', { deckId: '1' });
  const count = h.gm.sent.length;
  await h.start();
  assert.equal(
    h.gm.sent.slice(count).some(([t]) => t === 'deckBrowseCard'),
    false,
  );
});

for (const where of ['hand', 'field-up', 'field-down', 'top', 'bottom'])
  test(`browse ${where} preserves metadata, order and retry conservation`, async () => {
    const entry = { front: 'front', back: 'tile-back' },
      geom = { w: 2, h: 1, t: 0.1 };
    const h = harness(['bottom', entry, 'top'], { open: true, geom });
    const first = await h.start();
    await h.send(h.gm, 'browseStep', { token: first.token, revision: 0, direction: 1 });
    const card = h.preview();
    await h.action(where, card, h.gm, 'same-request');
    const result = structuredClone(h.room.deckCards.get('1'));
    await h.action(where, card, h.gm, 'same-request');
    assert.deepEqual(h.room.deckCards.get('1'), result);
    if (where === 'top') assert.deepEqual(result, ['bottom', 'top', entry]);
    else if (where === 'bottom') assert.deepEqual(result, [entry, 'bottom', 'top']);
    else {
      assert.deepEqual(result, ['bottom', 'top']);
      const dest =
        where === 'hand'
          ? h.room.hands.get('gm')[0]
          : JSON.parse(h.room.state.pieces.get('2').props);
      assert.equal(dest.front, 'front');
      assert.equal(dest.back, 'tile-back');
      assert.deepEqual(dest.geom, geom);
      assert.equal(dest.open, true);
      if (where === 'field-down') assert.equal(dest.down, true);
    }
  });

test('secret face-down placement never puts the front in synchronized properties', async () => {
  const h = harness(['secret']);
  await h.start();
  await h.action('field-down');
  assert.equal(h.room.state.pieces.has('1'), false);
  assert.equal(JSON.parse(h.room.state.pieces.get('2').props).front, undefined);
  assert.equal(h.room.cardData.get('2').front, 'secret');
});

test('full table and destination exceptions retain original inventory with no success receipt', async () => {
  const h = harness(['secret']);
  const card = await h.start();
  h.room.state.pieces.set('2', {});
  h.room.state.pieces.set('3', {});
  await h.action('field-up');
  assert.deepEqual(h.room.deckCards.get('1'), ['secret']);
  h.room.state.pieces.delete('2');
  h.room.state.pieces.delete('3');
  const spawn = h.room.spawnCardFlat.bind(h.room);
  h.room.spawnCardFlat = (...args) => {
    spawn(...args);
    throw Error('injected destination failure');
  };
  await h.action('field-up', card);
  assert.equal(h.room.state.pieces.size, 1);
  assert.deepEqual(h.room.deckCards.get('1'), ['secret']);
  const add = h.room.addToHand.bind(h.room);
  h.room.addToHand = (...args) => {
    add(...args);
    throw Error('injected hand failure');
  };
  await h.action('hand', card);
  assert.equal(h.room.hands.size, 0);
  assert.equal(h.room.nextHid, 1);
  assert.equal(
    h.gm.sent.some(([type]) => type === 'deckBrowseActionDone'),
    false,
  );
});

test('the final card is not consumed twice after an acknowledgment failure', async () => {
  const h = harness(['last']);
  const card = await h.start();
  const send = h.gm.send.bind(h.gm);
  h.gm.send = (type, value) => {
    if (type === 'deckBrowseActionDone') throw Error('socket closed');
    send(type, value);
  };
  await h.action('hand', card, h.gm, 'retry');
  h.gm.send = send;
  await h.action('hand', card, h.gm, 'retry');
  assert.equal(h.room.hands.get('gm').length, 1);
  assert.equal(h.room.state.pieces.has('1'), false);
  assert.equal(h.gm.sent.at(-1)[0], 'deckBrowseActionDone');
});

test('expiry, heartbeat, access changes and disconnect/restriction cleanup release leases', async () => {
  const h = harness();
  const view = await h.start();
  h.advance(BROWSE_IDLE_MS - 1);
  await h.send(h.gm, 'browseKeepAlive', { token: view.token, revision: view.revision });
  h.advance(2);
  assert.equal(h.room.deckBrowsing.blocked(null, ['1']), true);
  h.advance(BROWSE_IDLE_MS);
  h.room.deckBrowsing.sweep();
  assert.equal(h.room.deckBrowsing.blocked(null, ['1']), false);
  await h.start();
  stopPlayerInteraction(h.room, 'gm');
  assert.equal(h.room.deckBrowsing.blocked(null, ['1']), false);
  await h.start();
  h.gm.auth.timedOut = true;
  h.room.deckBrowsing.sweep();
  assert.equal(h.room.deckBrowsing.blocked(null, ['1']), false);
  h.gm.auth.timedOut = false;
  await h.start();
  await h.send(h.gm, 'setDeckBrowseAccess', { deckId: '1', access: 'players' });
  assert.equal(h.room.deckBrowsing.blocked(null, ['1']), false);
  await h.start();
  await h.send(h.gm, 'remove', { id: '1' });
  assert.equal(h.room.deckBrowsing.blocked(null, ['1']), false);
});

test('browse payloads reject unbounded, stale-shaped and additional private data', () => {
  assert.deepEqual(deckBrowsePayload({ deckId: '1', access: 'gm' }, 'access'), {
    deckId: '1',
    access: 'gm',
  });
  for (const value of [
    { token: 'x', revision: -1, direction: 1 },
    { token: 'x', revision: 0, direction: 0 },
    { token: 'x', revision: 0, direction: 1, front: 'secret' },
  ])
    assert.equal(deckBrowsePayload(value, 'step'), null);
  assert.equal(deckBrowsePayload({ deckId: '1', access: 'everyone' }, 'access'), null);
});
