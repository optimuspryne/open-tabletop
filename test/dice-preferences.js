import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDicePreferences } from '../public/table/dice-preferences.js';

function fixture(initial = '{}') {
  let saved = initial;
  const textures = [];
  const prefs = createDicePreferences({
    byId: () => null,
    deviceClass: () => 'desktop',
    getRoom: () => null,
    getDieIds: () => [],
    onTextures: (list) => textures.push(list),
    storage: { getItem: () => saved, setItem: (_key, value) => (saved = value) },
  });
  return { prefs, textures, saved: () => JSON.parse(saved) };
}

test('dice defaults merge color and finish without discarding other die preferences', () => {
  const { prefs, saved } = fixture('{"20":{"color":99}}');
  prefs.saveDiceDefault(6, 0x123456, 0xffffff);
  prefs.saveDiceDefault(6, undefined, undefined, 'custom', '/finish.png');
  assert.deepEqual(prefs.myDieProps(6), {
    sides: 6,
    color: 0x123456,
    textColor: 0xffffff,
    finish: 'custom',
    finishImg: '/finish.png',
  });
  prefs.saveDiceDefault(6, 0xabcdef);
  assert.equal(prefs.myDieProps(6).finishImg, '/finish.png');
  assert.deepEqual(saved()['20'], { color: 99 });
  assert.deepEqual(prefs.myDieProps(4), { sides: 4 });
});

test('switching finish drops custom texture and clearing one default leaves other dice intact', () => {
  const { prefs } = fixture();
  prefs.saveDiceDefault(6, 7, 8, 'custom', '/finish.png');
  prefs.saveDiceDefault(20, 9);
  prefs.saveDiceDefault(6, undefined, undefined, 'metal');
  assert.deepEqual(prefs.myDieProps(6), { sides: 6, color: 7, textColor: 8, finish: 'metal' });
  prefs.saveDiceDefault(6, undefined, undefined, 'matte');
  assert.deepEqual(prefs.myDieProps(6), { sides: 6, color: 7, textColor: 8 });
  prefs.clearDiceDefault(6);
  assert.deepEqual(prefs.myDieProps(6), { sides: 6 });
  assert.deepEqual(prefs.myDieProps(20), { sides: 20, color: 9 });
});

test('dice preference reads tolerate malformed or unavailable storage and writes tolerate quota errors', () => {
  assert.deepEqual(fixture('{broken').prefs.myDieProps(6), { sides: 6 });
  const prefs = createDicePreferences({
    storage: {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('quota');
      },
    },
  });
  assert.deepEqual(prefs.myDieProps(6), { sides: 6 });
  assert.doesNotThrow(() => prefs.saveDiceDefault(6, 10));
  assert.doesNotThrow(() => prefs.clearDiceDefault(6));
});

test('uploaded finish replacement and empty replay reach the inspection callback', () => {
  const { prefs, textures } = fixture();
  const list = [{ id: 'finish', url: '/finish.png' }];
  prefs.setTextures(list);
  prefs.syncTextures();
  prefs.setTextures([]);
  assert.deepEqual(textures, [list, list, []]);
});
