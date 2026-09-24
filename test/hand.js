import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHand } from '../public/table/hand.js';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.listeners = new Map();
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, on) => (on ? this.classes.add(name) : this.classes.delete(name)),
    };
    this.clientWidth = 400;
    this.scrollWidth = 400;
    this.scrollLeft = 0;
  }
  set className(value) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this.classes].join(' ');
  }
  set innerHTML(value) {
    this.html = value;
    this.replaceChildren();
  }
  get innerHTML() {
    return this.html || '';
  }
  get lastElementChild() {
    return this.children.at(-1);
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode)
        node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
      this.children.push(node);
      node.parentNode = this;
    }
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children.forEach((node) => (node.parentNode = null));
    this.children = [];
    this.append(...nodes);
  }
  insertBefore(node, sibling) {
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    const index = this.children.indexOf(sibling);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
  }
  querySelectorAll(selector) {
    const matches = (node) =>
      selector === '.handcard'
        ? node.classes.has('handcard')
        : selector === '.handcard:not(.dragging)'
          ? node.classes.has('handcard') && !node.classes.has('dragging')
          : selector === '[data-sort]'
            ? !!node.dataset.sort
            : false;
    return this.children
      .flatMap((child) => [matches(child) ? child : [], ...child.querySelectorAll(selector)])
      .flat();
  }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  getAttribute(name) {
    return this.attributes.get(name);
  }
  getBoundingClientRect() {
    return { left: 0, right: 400, width: 80 };
  }
  scrollBy() {}
  setPointerCapture() {}
}

function fixture() {
  const ids = new Map(
    [
      'hand',
      'showBtn',
      'dropFlank',
      'rearrangeBtn',
      'rearrangeBar',
      'showStrip',
      'showStripChips',
      'showStatus',
      'dropChoices',
      'dropBtn',
    ].map((id) => [id, new Element()]),
  );
  ids.get('showStrip').hidden = true;
  const sortButton = new Element('button');
  sortButton.dataset.sort = 'rank';
  ids.get('rearrangeBar').append(sortButton);
  const canvas = new Element('canvas');
  const doc = {
    body: new Element('body'),
    createElement: (tag) => new Element(tag),
    elementFromPoint: () => canvas,
  };
  const listeners = new Map();
  const frames = new Map(),
    observers = [];
  let nextFrame = 1;
  const win = {
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
        observers.push(this);
      }
      observe(target) {
        this.targets.add(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
    addEventListener(type, callback) {
      const list = listeners.get(type) || [];
      list.push(callback);
      listeners.set(type, list);
    },
    dispatch(type, event) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    getSelection: () => ({ removeAllRanges() {} }),
  };
  const storage = new Map();
  const timers = new Map();
  let nextTimer = 1;
  const sent = [],
    inspected = [],
    meshes = [];
  const feedback = [];
  const room = {
    state: {
      players: new Map([
        ['me', { name: 'Me', seat: 0 }],
        ['other', { name: 'Ada', seat: 1 }],
      ]),
    },
    send: (type, data) => sent.push({ type, data }),
  };
  const scene = {
    add: (mesh) => meshes.push(mesh),
    remove: (mesh) => meshes.splice(meshes.indexOf(mesh), 1),
  };
  const hit = { x: 0, z: 0 };
  const hand = createHand({
    scene,
    camera: {},
    renderer: { domElement: canvas },
    ray: {
      setFromCamera() {},
      ray: {
        intersectPlane(_plane, point) {
          point.x = 3;
          point.z = 4;
          return true;
        },
      },
    },
    pointer: {},
    dragPlane: {},
    hit,
    setPointer() {},
    cardMesh: () => ({
      geometry: { userData: { sharedCardGeometry: true } },
      material: { dispose() {} },
      rotation: { x: 0 },
      position: { set() {} },
    }),
    parseCardFront: (front) => ({ kind: 'rank', rank: front.slice(0, -1), suit: front.at(-1) }),
    cardPreviewURL: () => null,
    applyIcons() {},
    setIcon() {},
    getRoom: () => room,
    getSessionId: () => 'me',
    inspectMesh: (_mesh, data) => inspected.push(data),
    syncControlGuide() {},
    toast: (...args) => feedback.push(args),
    byId: (id) => ids.get(id),
    dragThreshold: 5,
    doc,
    win,
    storage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    delay(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    cancelDelay: (id) => timers.delete(id),
  });
  const cards = () => ids.get('hand').querySelectorAll('.handcard');
  return {
    hand,
    ids,
    sortButton,
    cards,
    win,
    storage,
    timers,
    sent,
    inspected,
    meshes,
    room,
    feedback,
    frames,
    observers,
    flushFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

const sample = [
  { hid: 'king', front: 'K♠', back: 'red' },
  { hid: 'ace', front: 'A♠', back: 'red' },
];

test('hand arrows remeasure after hidden layout opens and stop watching replaced strips', () => {
  const f = fixture();
  f.hand.setCards(sample);
  const [left, scroll, right] = f.ids.get('hand').children;
  scroll.clientWidth = scroll.scrollWidth = 0;
  f.flushFrames();
  assert.equal(left.hidden, true);
  scroll.clientWidth = 300;
  scroll.scrollWidth = 900;
  f.observers[0].callback();
  f.observers[0].callback();
  assert.equal(f.frames.size, 1, 'resize notifications coalesce');
  f.flushFrames();
  assert.equal(left.hidden, false);
  assert.equal(right.hidden, false);
  assert.equal(left.disabled, true);
  assert.equal(right.disabled, false);
  scroll.scrollLeft = 600;
  scroll.emit('scroll');
  assert.equal(left.disabled, false);
  assert.equal(right.disabled, true);
  scroll.scrollLeft = 0;
  scroll.clientWidth = 1000;
  f.win.dispatch('resize');
  f.flushFrames();
  assert.equal(left.hidden, true);
  assert.equal(right.hidden, true);
  f.observers[0].callback();
  f.hand.setCards([]);
  assert.equal(f.observers[0].targets.has(scroll), false, 'detached strip is still observed');
  assert.equal(f.frames.size, 1, 'stale measurement frame was not cancelled');
});

test('private hand renders, remembers collapse, and keeps revealed fans private to their sender', () => {
  const f = fixture();
  f.hand.setCards(sample);
  assert.equal(f.cards().length, 2);
  const hide = f.ids.get('hand').children.find((node) => node.classes.has('hide'));
  hide.onclick();
  assert.equal(f.storage.get('ott.handHidden'), '1');
  assert.equal(f.cards().length, 0);
  f.ids.get('hand').children[0].onclick();
  assert.equal(f.storage.get('ott.handHidden'), '0');
  assert.equal(f.cards().length, 2);

  f.hand.setRevealed('other', [{ front: 'A♠' }]);
  assert.deepEqual(f.hand.revealedFor('other'), [{ front: 'A♠' }]);
  f.hand.clearRevealed('other');
  assert.deepEqual(f.hand.revealedFor('other'), []);
});

test('Show selection and Rearrange sorting retain their room messages', () => {
  const f = fixture();
  f.hand.setCards(sample);
  f.hand.bindShowControls();
  f.ids.get('showBtn').onclick();
  const chips = f.ids.get('showStripChips');
  chips.children.find((node) => node.dataset.sid === 'other').onclick();
  assert.deepEqual(f.sent.at(-1), { type: 'showStart', data: { to: ['other'], hids: 'all' } });
  chips.children.find((node) => node.dataset.icon === 'select-all').onclick();
  f.cards()[1].emit('pointerdown', { button: 0, preventDefault() {} });
  chips.children.find((node) => node.dataset.sid === 'other').onclick();
  chips.children.find((node) => node.dataset.sid === 'other').onclick();
  assert.deepEqual(f.sent.at(-1), { type: 'showStart', data: { to: ['other'], hids: ['ace'] } });

  f.ids.get('rearrangeBtn').onclick();
  assert.equal(f.ids.get('hand').classes.has('reordering'), true);
  f.sortButton.onclick();
  assert.deepEqual(f.sent.at(-1), { type: 'reorderHand', data: { order: ['ace', 'king'] } });
  assert.deepEqual(
    f.cards().map((card) => card.dataset.hid),
    ['ace', 'king'],
  );
});

test('hand clicks play, double-click inspects, and touch drags preview and drop face-up', () => {
  const f = fixture();
  f.hand.setCards(sample);
  const first = f.cards()[0];
  first.emit('pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
  });
  f.win.dispatch('pointerup', { pointerId: 1, clientX: 10, clientY: 10 });
  [...f.timers.values()][0]();
  assert.deepEqual(f.sent.at(-1), { type: 'playCard', data: { hid: 'king', faceDown: true } });

  first.emit('pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 2,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
  });
  f.win.dispatch('pointerup', { pointerId: 2, clientX: 10, clientY: 10 });
  first.ondblclick();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.inspected.at(-1), { drawn: true, type: 'card', hid: 'king' });
  assert.equal(f.ids.get('hand').style.display, 'none');
  f.hand.render();

  f.win.dispatch('pointerdown', { pointerType: 'touch', pointerId: 3 });
  f.cards()[0].emit('pointerdown', {
    button: 0,
    pointerType: 'touch',
    pointerId: 3,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
  });
  f.win.dispatch('pointerdown', { pointerType: 'touch', pointerId: 4 });
  f.win.dispatch('pointermove', { pointerId: 3, clientX: 30, clientY: 30 });
  assert.equal(f.hand.drag().faceDown, false);
  assert.equal(f.meshes.length, 1);
  f.win.dispatch('pointerup', { pointerId: 3, clientX: 30, clientY: 30 });
  assert.deepEqual(f.sent.at(-1), {
    type: 'playCard',
    data: { hid: 'king', faceDown: false, x: 3, z: 4 },
  });
  assert.equal(f.meshes.length, 0);
  assert.equal(f.hand.isDragging(), false);
});

test('reorder drag commits DOM order and a cancelled play drag removes its preview', () => {
  const f = fixture();
  f.hand.setCards(sample);
  f.ids.get('rearrangeBtn').onclick();
  f.cards()[0].emit('pointerdown', {
    button: 0,
    pointerId: 5,
    preventDefault() {},
  });
  f.win.dispatch('pointermove', { pointerId: 5, clientX: 100, preventDefault() {} });
  f.win.dispatch('pointerup', { pointerId: 5 });
  assert.deepEqual(f.sent.at(-1), { type: 'reorderHand', data: { order: ['ace', 'king'] } });

  f.ids.get('rearrangeBtn').onclick();
  f.cards()[0].emit('pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 6,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
  });
  f.win.dispatch('pointermove', { pointerId: 6, clientX: 20, clientY: 20 });
  assert.equal(f.meshes.length, 1);
  f.hand.cancelGesture();
  assert.equal(f.hand.isDragging(), false);
  assert.equal(f.meshes.length, 0);
  assert.equal(f.ids.get('hand').classes.has('hand-dragging'), false);
});

test('hand binding restores private cards after reconnect and reports partial/stale drop undo', () => {
  const f = fixture(),
    messages = new Map();
  f.room.onMessage = (type, fn) => messages.set(type, fn);
  const send = f.room.send;
  f.room.send = (type, data) => {
    send(type, data);
    if (type === 'handSync') messages.get('hand')(sample);
  };
  f.hand.bindRoom(f.room);
  assert.equal(f.cards().length, 2);
  assert.equal(f.sent.at(-1).type, 'handSync');
  messages.get('dropUndone')({ restored: 1 });
  assert.deepEqual(f.feedback.at(-1), ['Returned 1 card to your hand']);
  messages.get('dropUndone')({ restored: 3 });
  assert.deepEqual(f.feedback.at(-1), ['Returned 3 cards to your hand']);
  messages.get('dropUndone')({ restored: 0 });
  assert.deepEqual(f.feedback.at(-1), ['Those cards are no longer on the table', 'x']);
  messages.get('hand')(null);
  assert.equal(f.cards().length, 0);
});
