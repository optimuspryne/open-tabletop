// Shared impulse operation for single, grouped and personal-tray rolls.
export function rollDie(room, id, config, random = Math.random, client) {
  const piece = room.state.pieces.get(id);
  const body = room.bodies.get(id);
  if (piece?.type !== 'die' || !body) return false;
  if (room.dicePolicy && !room.dicePolicy.acceptRoll(id)) {
    room.dicePolicy.notify(client, 'cooldown');
    return false;
  }
  body.wakeUp();
  body.velocity.set((random() - 0.5) * config.spread, config.up, (random() - 0.5) * config.spread);
  body.angularVelocity.set(
    (random() - 0.5) * config.spin,
    (random() - 0.5) * config.spin,
    (random() - 0.5) * config.spin,
  );
  return true;
}
