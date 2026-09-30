// Server-selected policy; nothing here is accepted from a client payload or snapshot.
export const DEMO_DICE_LIMITS = Object.freeze({ maxDice: 15, cooldownMs: 1000 });
const NOTICE_INTERVAL_MS = 2000;
const messages = Object.freeze({
  capacity: 'Demo tables can have up to 15 dice. Remove a die to add another.',
  cooldown: 'These dice can roll again in a moment.',
  restore:
    'This demo table exceeds the 15-dice limit. Ask the administrator to close it and start a new table.',
});

export class DemoDiceLimitError extends Error {
  constructor(kind = 'capacity') {
    super(messages[kind]);
    this.kind = kind;
  }
}

export function createDemoDicePolicy({ now = () => performance.now() } = {}) {
  const deadlines = new Map();
  let notices = new WeakMap();
  return Object.freeze({
    limits: DEMO_DICE_LIMITS,
    assertCapacity(pieces, type) {
      if (type !== 'die') return;
      let count = 0;
      for (const piece of pieces.values()) if (piece.type === 'die') count++;
      if (count >= DEMO_DICE_LIMITS.maxDice) throw new DemoDiceLimitError();
    },
    assertScene(scene) {
      const pieces = Array.isArray(scene?.pieces) ? scene.pieces : [];
      if (pieces.filter((piece) => piece?.type === 'die').length > DEMO_DICE_LIMITS.maxDice)
        throw new DemoDiceLimitError('restore');
    },
    acceptRoll(id) {
      const time = now();
      if (time < (deadlines.get(id) ?? -Infinity)) return false;
      deadlines.set(id, time + DEMO_DICE_LIMITS.cooldownMs);
      return true;
    },
    seed(id) {
      // Creation/restoration drops dice into physics; it cannot reset a die to ready.
      deadlines.set(id, now() + DEMO_DICE_LIMITS.cooldownMs);
    },
    remove(id) {
      deadlines.delete(id);
    },
    clear() {
      deadlines.clear();
      notices = new WeakMap();
    },
    notify(client, kind) {
      if (!client || client.auth?.revoked) return;
      const time = now();
      const previous = notices.get(client) ?? {};
      if (time < (previous[kind] ?? -Infinity)) return;
      previous[kind] = time + NOTICE_INTERVAL_MS;
      notices.set(client, previous);
      client.send('notice', { text: messages[kind], icon: 'x' });
    },
  });
}
