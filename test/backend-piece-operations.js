import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naturalStand, recolorPiece, standOf } from '../server/game/piece-operations.js';

const piece = (type, props = {}) => ({ type, props: JSON.stringify(props) });

test('effective stand mode honors instance overrides and fixed flat piece types', () => {
  assert.equal(standOf(piece('prop', { shape: 'token', stand: false })), false);
  assert.equal(standOf(piece('prop', { shape: 'checker', stand: true })), true);
  assert.equal(standOf(piece('prop', { shape: 'token' })), true);
  assert.equal(standOf(piece('deck')), 'flat');
  assert.equal(standOf(piece('dispenser')), 'flat');
  assert.equal(standOf(piece('mat')), 'flat');
});

test('natural stand mode retains declared and collider-derived behavior', () => {
  assert.equal(naturalStand(piece('prop', { shape: 'token' })), true);
  assert.equal(naturalStand(piece('prop', { shape: 'checker' })), 'flat');
  assert.equal(naturalStand(piece('prop', { shape: 'coin' })), 'flat');
  assert.equal(naturalStand(piece('prop', { shape: 'missing' })), true);
  assert.equal(naturalStand(piece('deck')), 'flat');
});

test('recolor writes validated props through the synchronized JSON boundary', () => {
  const die = piece('die', { sides: 6 });
  const room = { state: { pieces: new Map([['die', die]]) } };
  assert.equal(recolorPiece(room, 'die', { color: 0x123456, textColor: 0xfefefe }), true);
  assert.deepEqual(JSON.parse(die.props), {
    sides: 6,
    color: 0x123456,
    textColor: 0xfefefe,
  });
});

test('recolor preserves pieces when the id or requested change is invalid', () => {
  const card = piece('card', { front: 'ace' });
  const room = { state: { pieces: new Map([['card', card]]) } };
  assert.equal(recolorPiece(room, 'missing', { color: 0 }), false);
  assert.equal(recolorPiece(room, 'card', { color: 0 }), false);
  assert.deepEqual(JSON.parse(card.props), { front: 'ace' });
});

test('team dispensers recolor by team while color dispensers retain tint rules', () => {
  const bowl = piece('dispenser', { disp: 'goBowl', team: 0 });
  const chips = piece('dispenser', { disp: 'pokerStack', color: 0x111111 });
  const room = {
    state: {
      pieces: new Map([
        ['bowl', bowl],
        ['chips', chips],
      ]),
    },
  };
  assert.equal(recolorPiece(room, 'bowl', { team: 1 }), true);
  assert.equal(recolorPiece(room, 'chips', { color: 0xabcdef }), true);
  assert.equal(JSON.parse(bowl.props).team, 1);
  assert.equal(JSON.parse(chips.props).color, 0xabcdef);
});

test('recolor persists a material override for a bundled object', () => {
  const king = piece('prop', { shape: 'chess-king', team: 0 });
  const room = { state: { pieces: new Map([['king', king]]) } };
  assert.equal(recolorPiece(room, 'king', { finish: 'translucent' }), true);
  assert.equal(JSON.parse(king.props).finish, 'translucent');
  assert.equal(recolorPiece(room, 'king', { finish: 'custom' }), false);
});
