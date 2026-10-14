import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendAccountHand, parkHand, claimHand, sendHand } from '../server/game/hand-state.js';
import { Player, State } from '../server/game/schema.js';
import { Encoder, Reflection } from '@colyseus/schema';

test('multiple tabs park every card once and one returning tab reclaims the account inventory', () => {
  const card = { hid: 'h1', front: 'same', back: 'back', open: true };
  const room = {
    hands: new Map([
      ['a', [card]],
      ['b', [{ ...card, hid: 'h2' }]],
    ]),
    handOwners: new Map([
      ['a', '7'],
      ['b', '7'],
    ]),
    pendingHands: new Map([['7', { name: 'Player', cards: [{ ...card, hid: 'h0' }] }]]),
    state: { players: new Map(), unclaimed: new Map() },
  };
  const client = (sessionId) => ({ sessionId, auth: { userId: 7 } });
  parkHand(room, client('b'));
  parkHand(room, client('a'));
  parkHand(room, client('a')); // duplicate cleanup cannot duplicate inventory
  assert.deepEqual(
    room.pendingHands.get('7').cards.map((c) => c.hid),
    ['h0', 'h2', 'h1'],
  );
  assert.equal(room.handOwners.size, 0);
  assert.equal(room.hands.size, 0);
  claimHand(room, 7, 'returning');
  claimHand(room, 7, 'other-tab');
  assert.equal(room.hands.get('returning').length, 3);
  assert.equal(room.hands.has('other-tab'), false);
  assert.equal(room.pendingHands.size, 0);
  assert.equal(room.state.unclaimed.size, 0);
});

test('account aggregation preserves duplicates, metadata, and room-local ownership', () => {
  const first = new Map(),
    second = new Map();
  const cards = [{ front: 'same', back: 'custom', geom: { w: 2 }, open: true }];
  appendAccountHand(first, 7, 'Name', cards);
  appendAccountHand(first, '7', 'Other tab', cards);
  appendAccountHand(second, 7, 'Name', [{ front: 'different' }]);
  assert.equal(first.get('7').cards.length, 2);
  assert.deepEqual(first.get('7').cards[1], cards[0]);
  assert.equal(cards.length, 1);
  assert.equal(second.get('7').cards.length, 1);
});

test('live and reclaimed hands publish safe fan metadata while sending content only to the owner', () => {
  const cards = [
    {
      hid: 'SECRET_ID',
      tile: 'domino',
      front: 'SECRET_FACE',
      back: 'domback',
      dominoAppearance: { base: 0x123456 },
    },
    {
      hid: 'SECRET_ID_2',
      open: true,
      front: 'SECRET_FRONT',
      back: 'SECRET_BACK',
      geom: { w: 0.5, h: 0.5, t: 0.06 },
    },
  ];
  const state = new State();
  const player = new Player();
  state.players.set('owner', player);
  const sent = [];
  const client = { sessionId: 'owner', send: (...args) => sent.push(args) };
  const room = { state, hands: new Map([['owner', cards]]), pendingHands: new Map() };
  sendHand(room, client);
  assert.deepEqual(sent, [['hand', cards]]);
  assert.equal(player.hand, 2);
  assert.equal(player.handBack, 'domback');
  assert.equal(
    JSON.parse(player.handFan).find((group) => group.props.tile === 'domino').props.dominoAppearance
      .base,
    0x123456,
  );
  assert.ok(!JSON.stringify(state.toJSON()).includes('SECRET'));
  const encoder = new Encoder(state);
  const decoder = Reflection.decode(Reflection.encode(encoder));
  decoder.decode(encoder.encodeAll());
  assert.equal(decoder.state.players.get('owner').handFan, player.handFan);
  room.hands.delete('owner');
  room.pendingHands.set('7', { name: 'Owner', cards });
  claimHand(room, 7, 'owner');
  sendHand(room, client);
  assert.deepEqual(sent.at(-1), ['hand', cards]);
  room.hands.set('owner', []);
  sendHand(room, client);
  assert.equal(player.hand, 0);
  assert.equal(player.handBack, '');
  assert.equal(player.handFan, '');
});

test('mixed back counts survive parked hand restoration without publishing faces or order', () => {
  const hand = Array.from({ length: 30 }, (_, i) => ({
    hid: `PRIVATE_${i}`,
    front: `SECRET_${i}`,
    back: i < 20 ? '/assets/decks/a.png' : '/assets/decks/b.png',
  }));
  const player = new Player(),
    state = new State();
  state.players.set('owner', player);
  const room = {
    state,
    hands: new Map([['owner', hand]]),
    handOwners: new Map([['owner', '7']]),
    pendingHands: new Map(),
  };
  const sent = [],
    client = { sessionId: 'owner', auth: { userId: 7 }, send: (...args) => sent.push(args) };
  sendHand(room, client);
  const publicFan = player.handFan;
  assert.deepEqual(
    JSON.parse(publicFan).map((group) => group.count),
    [20, 10],
  );
  room.hands.set('owner', [...hand].reverse());
  sendHand(room, client);
  assert.equal(player.handFan, publicFan);
  parkHand(room, client);
  claimHand(room, 7, 'owner');
  sendHand(room, client);
  assert.equal(player.handFan, publicFan);
  assert.equal(sent.at(-1)[1][0].front, 'SECRET_29');
  assert.ok(!JSON.stringify(state.toJSON()).includes('SECRET'));
  assert.ok(!JSON.stringify(state.toJSON()).includes('PRIVATE'));
});
