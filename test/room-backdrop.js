import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomBackdrop } from '../public/rendering/rooms/room-backdrop.js';
import {
  ROOM_ENVIRONMENTS,
  normalizeRoomEnvironment,
  isRoomEnvironment,
} from '../shared/room-environments.js';

function viewer() {
  const instances = [];
  const backdrop = createRoomBackdrop({
    scene: 'injected-scene',
    createEnvironment(options) {
      const instance = {
        options,
        states: [],
        frames: [],
        disposed: 0,
        sync(state) {
          this.states.push(state);
        },
        update(...args) {
          this.frames.push(args);
        },
        dispose() {
          this.disposed++;
        },
      };
      instances.push(instance);
      return instance;
    },
  });
  return { backdrop, instances };
}

test('all viewers follow shared room styles with bounded, disposable runtimes', () => {
  const viewers = [viewer(), viewer()];
  const state = {
    environment: 'standard',
    tableX: 10,
    tableZ: 7,
    rimWood: 'walnut',
    feltColor: '#123456',
    lighting: { preset: 'night' },
  };
  const original = structuredClone(state);
  for (const { backdrop, instances } of viewers) {
    backdrop.sync(state);
    backdrop.update('camera', 'target');
    assert.equal(instances.length, 0);
  }
  state.environment = 'cozy';
  for (const { backdrop, instances } of viewers) {
    backdrop.sync(state);
    backdrop.sync(state);
    backdrop.update('camera', 'target');
    assert.equal(instances.length, 1);
    assert.equal(instances[0].options.theme.id, 'cozy');
    assert.equal(instances[0].options.scene, 'injected-scene');
    assert.equal(instances[0].states.length, 2);
    assert.deepEqual(instances[0].frames, [['camera', 'target']]);
  }
  state.environment = 'standard';
  for (const { backdrop, instances } of viewers) {
    backdrop.sync(state);
    backdrop.sync(state);
    assert.equal(instances[0].disposed, 1);
    state.environment = 'cozy';
    backdrop.sync(state);
    state.environment = 'standard';
    assert.equal(instances.length, 2);
    backdrop.dispose();
    backdrop.dispose();
    backdrop.sync({ environment: 'cozy' });
    assert.equal(instances[1].disposed, 1);
    assert.equal(instances.length, 2);
  }
  assert.deepEqual(state, original);
});

test('invalid or absent legacy styles normalize to Standard and cannot name arbitrary assets', () => {
  assert.deepEqual(
    ROOM_ENVIRONMENTS.map(({ id }) => id),
    ['standard', 'cozy'],
  );
  for (const value of [undefined, null, '', 'constructor', 'Cozy', '/custom.glb', {}, []]) {
    assert.equal(normalizeRoomEnvironment(value), 'standard');
    assert.equal(isRoomEnvironment(value), false);
    const { backdrop, instances } = viewer();
    backdrop.sync({ environment: value });
    assert.equal(instances.length, 0);
    backdrop.dispose();
  }
});

test('a failed room constructor can retry without retaining the prior owner', () => {
  let attempts = 0;
  const backdrop = createRoomBackdrop({
    createEnvironment() {
      if (++attempts === 1) throw new Error('fixture construction failure');
      return { sync() {}, dispose() {} };
    },
  });
  assert.throws(() => backdrop.sync({ environment: 'cozy' }), /construction failure/);
  backdrop.sync({ environment: 'cozy' });
  assert.equal(attempts, 2);
  backdrop.dispose();
});
