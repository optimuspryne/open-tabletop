// Dice color defaults — the server-trusted sanitizer for a spawned die's props. A client sends
// its saved default color along with a spawn; the server must accept only a valid die type and
// real 24-bit colors, dropping anything else. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dieSpawnProps,
  clampColor,
  colorProps,
  recolorPalette,
  METALS,
  DIE_SIDES,
  DICE_SETS,
  PALETTE,
  readableInk,
  DIE_INK,
  DIE_INK_LIGHT,
} from '../shared/pieces.js';

test('dieSpawnProps: a valid die + colors passes through', () => {
  assert.deepEqual(dieSpawnProps({ sides: 20, color: 0x2ecc71, textColor: 0x141414 }), {
    sides: 20,
    color: 0x2ecc71,
    textColor: 0x141414,
  });
});

test('dieSpawnProps: no colors → just the sides (back-compat, no default set)', () => {
  assert.deepEqual(dieSpawnProps({ sides: 6 }), { sides: 6 });
});

test('dieSpawnProps: an unknown die type falls back to d6', () => {
  assert.equal(dieSpawnProps({ sides: 7 }).sides, 6);
  assert.equal(dieSpawnProps({ sides: 'x' }).sides, 6);
  assert.equal(dieSpawnProps({}).sides, 6);
});

test('dieSpawnProps: every real die type is accepted as itself', () => {
  for (const s of DIE_SIDES) assert.equal(dieSpawnProps({ sides: s }).sides, s);
});

test('dieSpawnProps: an out-of-range or garbage color is dropped, not clamped-in', () => {
  assert.equal('color' in dieSpawnProps({ sides: 6, color: -1 }), false);
  assert.equal('color' in dieSpawnProps({ sides: 6, color: 0x1000000 }), false); // > 0xffffff
  assert.equal('color' in dieSpawnProps({ sides: 6, color: 1.5 }), false);
  assert.equal('color' in dieSpawnProps({ sides: 6, color: 'red' }), false);
  assert.equal('textColor' in dieSpawnProps({ sides: 6, textColor: NaN }), false);
});

test('dieSpawnProps: body and number colors are independent', () => {
  assert.deepEqual(dieSpawnProps({ sides: 8, color: 0xffffff }), { sides: 8, color: 0xffffff });
  assert.deepEqual(dieSpawnProps({ sides: 8, textColor: 0 }), { sides: 8, textColor: 0 });
});

test('clampColor: endpoints valid, just outside invalid', () => {
  assert.equal(clampColor(0), 0);
  assert.equal(clampColor(0xffffff), 0xffffff);
  assert.equal(clampColor(0x1000000), null);
  assert.equal(clampColor(-1), null);
});

test('readableInk: dark ink on light bodies, light ink on dark bodies', () => {
  assert.equal(readableInk(0xffffff), DIE_INK); // white → dark numbers
  assert.equal(readableInk(0xf4f1ea), DIE_INK); // ivory → dark
  assert.equal(readableInk(0x000000), DIE_INK_LIGHT); // black → light numbers
  assert.equal(readableInk(0x1c1c1e), DIE_INK_LIGHT); // onyx → light
});

test('readableInk: always returns one of the two inks', () => {
  for (let c = 0; c <= 0xffffff; c += 0x0a0b0c) {
    // sweep the cube
    const ink = readableInk(c);
    assert.ok(ink === DIE_INK || ink === DIE_INK_LIGHT, `unexpected ink for ${c.toString(16)}`);
  }
});

test('DICE_SETS: non-empty, each has a name and a valid color', () => {
  assert.ok(DICE_SETS.length > 0);
  const names = new Set();
  for (const s of DICE_SETS) {
    assert.equal(typeof s.name, 'string');
    assert.ok(s.name.length > 0);
    assert.ok(!names.has(s.name), `duplicate set name: ${s.name}`);
    names.add(s.name);
    assert.equal(clampColor(s.color), s.color, `set ${s.name} has an out-of-range color`);
  }
});

test('a dice set round-trips through the spawn sanitizer with its auto ink', () => {
  for (const s of DICE_SETS) {
    const props = dieSpawnProps({ sides: 20, color: s.color, textColor: readableInk(s.color) });
    assert.equal(props.color, s.color);
    assert.equal(props.textColor, readableInk(s.color));
  }
});

// colorProps — the shared recolor validator used by single recolor AND the multi-select batch.
test('colorProps: a die takes body + number color', () => {
  assert.deepEqual(colorProps('die', { sides: 20 }, { color: 0x1f7a4d, textColor: 0xf4f1ea }), {
    sides: 20,
    color: 0x1f7a4d,
    textColor: 0xf4f1ea,
  });
});

test('colorProps: a prop takes body color; textColor is ignored for it', () => {
  assert.deepEqual(colorProps('prop', { shape: 'box' }, { color: 0xd14b4b, textColor: 0x111111 }), {
    shape: 'box',
    color: 0xd14b4b,
  });
});

test('colorProps: cards and boards are not recolorable → null', () => {
  assert.equal(colorProps('card', {}, { color: 0xffffff }), null);
  assert.equal(colorProps('board', {}, { color: 0xffffff }), null);
  assert.equal(colorProps('deck', {}, { color: 0xffffff }), null);
});

test('colorProps: an out-of-range color is rejected → null (no partial write)', () => {
  assert.equal(colorProps('die', { sides: 6 }, { color: 0x1000000 }), null);
  assert.equal(colorProps('prop', {}, { color: -1 }), null);
});

test('colorProps: a poker/coin dispenser takes a tint; a team bowl needs a team flag', () => {
  assert.deepEqual(
    colorProps('dispenser', { disp: 'poker' }, { color: 0xd9c24b }, { item: 'chip' }),
    { disp: 'poker', color: 0xd9c24b },
  );
  assert.equal(colorProps('dispenser', { disp: 'poker' }, { color: 0xd9c24b }, null), null); // unknown dispenser
  assert.equal(
    colorProps('dispenser', { disp: 'gobowl' }, { color: 0xd9c24b }, { team: true }),
    null,
  ); // team bowl ignores color
  assert.deepEqual(colorProps('dispenser', { disp: 'gobowl' }, { team: 1 }, { team: true }), {
    disp: 'gobowl',
    team: 1,
  });
});

test('colorProps: does not mutate the input props', () => {
  const props = { sides: 8 };
  const out = colorProps('die', props, { color: 0x123456 });
  assert.equal('color' in props, false); // original untouched
  assert.equal(out.color, 0x123456);
});

test('every palette color (except Neutral) survives the recolor validator', () => {
  for (const p of PALETTE) {
    if (p.hex == null) continue;
    assert.equal(colorProps('prop', {}, { color: p.hex }).color, p.hex);
  }
});

// colorProps — team pieces switch SET, not a freeform color (props.color is ignored on render).
test('colorProps: a team prop takes a team index, not a freeform color', () => {
  assert.equal(colorProps('prop', { shape: 'checker' }, { color: 0xff0000 }), null); // color alone → rejected
  assert.deepEqual(colorProps('prop', { shape: 'checker' }, { team: 1 }), {
    shape: 'checker',
    team: 1,
  });
  assert.deepEqual(colorProps('prop', { shape: 'chess-queen' }, { team: 0 }), {
    shape: 'chess-queen',
    team: 0,
  });
});

test('colorProps: a non-team prop (coin/general) still takes a color', () => {
  assert.equal(colorProps('prop', { shape: 'coin' }, { color: 0xd4af37 }).color, 0xd4af37);
  assert.equal(colorProps('prop', { shape: 'token' }, { color: 0x5fae5f }).color, 0x5fae5f);
});

test('colorProps: a limited-palette object rejects an off-palette color (group-recolor safety)', () => {
  assert.equal(colorProps('prop', { shape: 'coin' }, { color: 0xd14b4b }), null); // red isn't a metal
  assert.equal(colorProps('prop', { shape: 'coin' }, { color: 0xc0c0c0 }).color, 0xc0c0c0); // silver is
  assert.equal(
    colorProps('dispenser', { disp: 'coinStack' }, { color: 0x5fae5f }, { swatches: 'metals' }),
    null,
  ); // green isn't a metal
});

// recolorPalette — the allowed-colors descriptor the recolor UI reads.
test('recolorPalette: team pieces expose their two set colors and no freeform', () => {
  for (const shape of ['checker', 'crowned_checker', 'go', 'chess-pawn', 'chess-king']) {
    const o = recolorPalette('prop', { shape });
    assert.equal(o.team, true);
    assert.equal(o.free, false);
    assert.equal(o.swatches.length, 2);
  }
});

test('recolorPalette: coins expose the metals palette only (no freeform, no Neutral)', () => {
  const o = recolorPalette('prop', { shape: 'coin' });
  assert.equal(o.free, false);
  assert.equal(o.team, false);
  assert.deepEqual(o.swatches, METALS);
  assert.equal(
    o.swatches.some((s) => s.hex == null),
    false,
  ); // no Neutral entry
});

test('recolorPalette: a general prop gets the full palette + freeform', () => {
  const o = recolorPalette('prop', { shape: 'poker_chip' });
  assert.equal(o.free, true);
  assert.equal(o.swatches, PALETTE);
});

test('recolorPalette: a coin dispenser is metals-only; a go bowl is a team set', () => {
  assert.deepEqual(
    recolorPalette('dispenser', { disp: 'coinStack' }, { swatches: 'metals' }).swatches,
    METALS,
  );
  const bowl = recolorPalette('dispenser', { disp: 'goBowl' }, { team: 'go' });
  assert.equal(bowl.team, true);
  assert.equal(bowl.swatches.length, 2);
});

test('recolorPalette: non-colorable pieces and unknown dispensers → null', () => {
  assert.equal(recolorPalette('card', {}), null);
  assert.equal(recolorPalette('board', {}), null);
  assert.equal(recolorPalette('dispenser', { disp: 'nope' }, null), null);
});
