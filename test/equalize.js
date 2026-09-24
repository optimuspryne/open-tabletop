import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('compact button rows batch all width resets, measurements and final writes', () => {
  const events = [],
    frames = [],
    listeners = {};
  let mutation;
  const button = (width) => ({
    style: {
      set width(value) {
        events.push(['write', value]);
      },
    },
    getBoundingClientRect() {
      events.push(['read']);
      return { width };
    },
  });
  const groups = [
    [button(40), button(80)],
    [button(23.2), button(50.5)],
    [button(0), button(0)],
  ];
  const document = {
    body: { classList: { toggle() {} } },
    documentElement: {},
    querySelectorAll: () => groups.map((buttons) => ({ querySelectorAll: () => buttons })),
  };
  vm.runInNewContext(readFileSync(new URL('../public/ui/equalize.js', import.meta.url), 'utf8'), {
    document,
    localStorage: { getItem: () => null },
    MutationObserver: class {
      constructor(callback) {
        mutation = callback;
      }
      observe() {}
    },
    requestAnimationFrame: (fn) => frames.push(fn),
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
  });
  mutation();
  listeners.resize();
  listeners.load();
  assert.equal(frames.length, 1, 'updates coalesce into one frame');
  frames.shift()();
  assert.deepEqual(events, [
    ...Array.from({ length: 6 }, () => ['write', '']),
    ...Array.from({ length: 6 }, () => ['read']),
    ['write', '80px'],
    ['write', '80px'],
    ['write', '51px'],
    ['write', '51px'],
  ]);
});
