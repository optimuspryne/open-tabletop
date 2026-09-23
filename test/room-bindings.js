import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebook } from '../public/table/notebook.js';
import { bindLibraryMessages } from '../public/table/library-bindings.js';

function clock() {
  let id = 0;
  const pending = new Map();
  return {
    pending,
    delay: (fn, ms) => {
      pending.set(++id, { fn, ms });
      return id;
    },
    cancelDelay: (id) => pending.delete(id),
    flush() {
      const tasks = [...pending.values()];
      pending.clear();
      tasks.forEach(({ fn }) => fn());
    },
  };
}

test('notebook installs replay before requesting sync and debounces private edits', () => {
  const messages = new Map(),
    sent = [],
    time = clock();
  const input = {
    value: '',
    addEventListener(type, fn) {
      this[type] = fn;
    },
  };
  const room = {
    onMessage: (type, fn) => messages.set(type, fn),
    send(type, payload) {
      sent.push([type, payload]);
      if (type === 'notebookSync') messages.get('notebook')('restored private text');
    },
  };
  const notebook = createNotebook({ getRoom: () => room, byId: () => input, ...time });
  notebook.bindRoom(room);
  notebook.bindControls();
  assert.equal(input.value, 'restored private text');
  input.value = 'first';
  input.input();
  input.value = 'latest';
  input.input();
  assert.equal(time.pending.size, 1);
  assert.equal([...time.pending.values()][0].ms, 400);
  time.flush();
  assert.deepEqual(sent.at(-1), ['notebook', { text: 'latest' }]);
  messages.get('notebook')(null);
  assert.equal(input.value, '');
});

test('library binding routes live lists, normalizes dice and registers before requesting them', () => {
  const messages = new Map(),
    lists = [],
    dice = [],
    sent = [];
  const win = {}; // editor hook can arrive after registration
  const room = {
    onMessage: (key, fn) => messages.set(key, fn),
    send(key) {
      sent.push(key);
      messages.get('diceList')([{ id: 'die' }]);
    },
  };
  bindLibraryMessages(room, {
    onDiceTextures: (list) => dice.push(list),
    byId: () => null,
    setIcon() {},
    setBtnLabel() {},
    win,
    alertUser() {},
  });
  assert.deepEqual(sent, ['listDice']);
  assert.deepEqual(dice[0], [{ id: 'die' }]);
  win.onLibraryList = (...args) => lists.push(args);
  for (const kind of ['deck', 'board', 'prop', 'scene', 'mat', 'sky', 'dice']) {
    const value = [{ id: kind }];
    messages.get(kind + 'List')(value);
    assert.deepEqual(lists.at(-1), [kind, value]);
  }
  messages.get('diceList')({ invalid: true });
  assert.deepEqual(dice.at(-1), []);
  assert.deepEqual(lists.at(-1), ['dice', []]);
  messages.get('skyList')(null);
  assert.deepEqual(lists.at(-1), ['sky', []]);
});

test('asset outages are throttled and repeated save feedback restores the original button', () => {
  const messages = new Map(),
    alerts = [],
    time = clock();
  let now = 10000;
  const button = { querySelector: () => ({ textContent: 'Save Table' }) },
    error = {};
  bindLibraryMessages(
    { onMessage: (key, fn) => messages.set(key, fn), send() {} },
    {
      onDiceTextures() {},
      byId: (id) => (id === 'skyErr' ? error : button),
      setIcon: (node, value) => {
        node.icon = value;
      },
      setBtnLabel: (node, value) => {
        node.label = value;
      },
      win: {},
      alertUser: (message) => alerts.push(message),
      now: () => now,
      ...time,
    },
  );
  messages.get('assetError')();
  messages.get('assetError')({ message: 'duplicate' });
  assert.equal(alerts.length, 1);
  now += 5000;
  messages.get('assetError')({ message: 'still unavailable' });
  assert.equal(alerts.at(-1), 'still unavailable');
  messages.get('skyError')();
  assert.equal(error.textContent, 'Could not add that skybox.');
  messages.get('sceneError')();
  assert.equal(alerts.at(-1), 'Could not save the scene.');
  messages.get('stateSaved')();
  messages.get('stateSaved')();
  assert.equal(button.label, 'Saved ✓');
  assert.equal(button.icon, 'square-check');
  assert.equal(time.pending.size, 1);
  assert.equal([...time.pending.values()][0].ms, 1500);
  time.flush();
  assert.equal(button.label, 'Save Table');
  assert.equal(button.icon, 'device-floppy');
});
