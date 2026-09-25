import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutNotecardText } from '../public/rendering/notecard-text.js';
import { NOTECARD_TEXT } from '../shared/notecards.js';

const box = { id: 1, text: '', x: 0, y: 0, w: 0.15, size: 0.04, color: '#202830', align: 'left' };
const context = {
  save() {},
  restore() {},
  measureText(value) {
    return { width: Array.from(value).length * 12 };
  },
};

test('text layout preserves newlines, wraps words and splits long Unicode words without losing characters', () => {
  const paragraph = 'One two three four abcdefghijklmnopqrstuvwxyz 🧭🧭🧭🧭🧭🧭🧭🧭🧭🧭🧭🧭🧭';
  const result = layoutNotecardText(context, { ...box, text: paragraph + '\n\nFinal' });
  assert.ok(result.lines.length > 4);
  assert.equal(
    result.lines.join('').replaceAll(' ', ''),
    (paragraph + 'Final').replaceAll(' ', ''),
  );
  assert.ok(result.lines.includes(''));
  assert.equal(result.lines.at(-1), 'Final');
  assert.ok(
    result.lines.every(
      (line) => context.measureText(line).width <= (box.w - 2 * NOTECARD_TEXT.padding) * 1024,
    ),
  );
});

test('text layout measures fit using width, font size, newlines and paper position', () => {
  const text = 'Words '.repeat(25);
  const narrow = layoutNotecardText(context, { ...box, text });
  const wide = layoutNotecardText(context, { ...box, w: 0.8, text });
  assert.ok(narrow.height > wide.height);
  assert.equal(layoutNotecardText(context, { ...box, w: 0.8, y: 0.95, text }).overflow, true);
  assert.equal(layoutNotecardText(context, { ...box, w: 0.8, text: 'Short' }).overflow, false);
  assert.equal(layoutNotecardText(context, { ...box, text: '\n'.repeat(50) }).overflow, true);
  assert.deepEqual(layoutNotecardText(context, box).lines, ['']);
});
