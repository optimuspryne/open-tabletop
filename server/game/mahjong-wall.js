import { cardPublicProps, tileModel } from '../../shared/pieces.js';
import { mahjongWallFits, mahjongWallLayout } from '../../shared/mahjong-wall.js';
import { cardBackRef, cardFrontRef } from '../deck-state.js';
import { spawnTableCard } from './card-transfer.js';

// This operation creates a fresh set; it does not consume a pouch or clear the
// table. Preflight is synchronous, and unexpected spawn failures roll back every
// newly created body/private face before the existing message error boundary runs.
export function createMahjongWall({ buildInventory, maxPieces }) {
  return function spawnMahjongWall(room, bonusTiles = false) {
    const hidden = room.visibility?.spawnHidden() ?? false;
    const count = bonusTiles === true ? 144 : 136;
    const layout = mahjongWallLayout(count);
    if (room.state.pieces.size + count > maxPieces)
      return {
        ok: false,
        message: `The wall needs ${count} free piece slots. Remove pieces first.`,
      };
    if (!mahjongWallFits(layout, room.state))
      return {
        ok: false,
        message: 'The Mahjong wall does not fit this table. Enlarge the play surface first.',
      };
    for (const [id, body] of room.bodies) {
      // Parked GM-only bodies do not participate in public physics. An ordinary
      // placement error must not reveal their presence. Hidden GM layouts can
      // consider the whole authoritative scene, including other hidden pieces.
      if (!hidden && room.state.pieces.get(id)?.hidden) continue;
      body.updateAABB();
      const { lowerBound: lower, upperBound: upper } = body.aabb;
      if (
        layout.tiles.some(
          ({ position: [x, y, z], halfX, halfY, halfZ }) =>
            lower.x < x + halfX &&
            upper.x > x - halfX &&
            lower.y < y + halfY &&
            upper.y > y - halfY &&
            lower.z < z + halfZ &&
            upper.z > z - halfZ,
        )
      )
        return {
          ok: false,
          message: 'The wall area is occupied. Move those pieces before building the wall.',
        };
    }
    const built = buildInventory(bonusTiles === true);
    if (
      built.tile !== 'mahjong' ||
      built.cards.length !== count ||
      built.cards.some((entry) => !tileModel({ tile: 'mahjong', front: cardFrontRef(entry) }))
    )
      throw new Error('Invalid Mahjong wall inventory.');
    const before = new Set(room.state.pieces.keys());
    const beforeBodies = new Set(room.world.bodies);
    const ids = [];
    try {
      for (const [index, slot] of layout.tiles.entries()) {
        const entry = built.cards[index];
        const id = spawnTableCard(room, slot.position, {
          front: cardFrontRef(entry),
          back: cardBackRef(entry) || built.back,
          geo: { ...cardPublicProps(built, entry), snap: false },
          hidden,
        });
        const body = room.bodies.get(id);
        body.quaternion.set(...slot.quaternion);
        body.aabbNeedsUpdate = true;
        body.sleep();
        room.writeTransform(room.state.pieces.get(id), body);
        ids.push(id);
      }
      room.scheduleSave();
      return { ok: true, ids };
    } catch (error) {
      // Also recover a body inserted by a spawn that threw before returning its ID.
      for (const id of [...room.state.pieces.keys()]) if (!before.has(id)) room.removePiece(id);
      for (const [id, body] of [...room.bodies]) if (!beforeBodies.has(body)) room.removePiece(id);
      for (const body of [...room.world.bodies])
        if (!beforeBodies.has(body)) room.world.removeBody(body);
      throw error;
    }
  };
}
