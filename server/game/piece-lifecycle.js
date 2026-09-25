import { normalizeNotecardDrawing, normalizeNotecardStack } from '../../shared/notecards.js';
import * as CANNON from 'cannon-es';
import {
  DECK_MODELS,
  KINDS,
  PROPS,
  gridActive,
  gridFootprintCells,
  itemMatchesDispenser,
  dispenserDefinition,
  snapToCell,
} from '../../shared/pieces.js';
import { absorbedEntry, cardBackRef, cardCompatibilityKey } from '../deck-state.js';
import { buildCollider, attachCollider } from '../physics.js';
import { assertPieceCapacity } from './piece-capacity.js';
import { readProps, writeProps } from './props-codec.js';
import { Piece } from './schema.js';
import { normalizePieceLabels } from '../../shared/piece-labels.js';

// Own the synchronized-piece and physics-body lifecycle while retaining the room's existing
// collider, sound, and private-state contracts. Runtime tuning and deck construction stay injected.
export function createPieceLifecycle({
  deckBuilders,
  dropSfx,
  geoOf,
  now = Date.now,
  random = Math.random,
  sim,
}) {
  const spawn = (room, type, pos, props = {}, quat = null) => {
    assertPieceCapacity(room, sim.maxPieces);
    if (type === 'notecard' && !room.notecards.hasCapacity())
      throw new Error('The notecard limit was reached.');
    if (type === 'notecard') {
      const drawing = normalizeNotecardDrawing(props.drawing ?? []);
      if (!drawing) throw new Error('Invalid notecard drawing.');
      props = { ...props, drawing };
    }
    if (type === 'notecardStack') {
      const cards = normalizeNotecardStack(
        props.cards ?? Array.from({ length: props.count ?? 8 }, () => ({ drawing: [] })),
      );
      if (!cards) throw new Error('Invalid notecard stack.');
      if (!room.notecards.hasCapacity(cards.length))
        throw new Error('The notecard limit was reached.');
      props = { ...props, cards, count: cards.length };
    }
    const mass = type === 'prop' ? (PROPS[props.shape] || PROPS.box).mass : KINDS[type].mass;
    const body = new CANNON.Body({ mass, material: room.mat });
    const collider = buildCollider(type, props, {
      cardColliderThickness: sim.cards.colliderThick,
    });
    attachCollider(body, collider);
    body.position.set(pos[0], pos[1], pos[2]);

    if (quat && quat.length === 4) {
      body.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    } else if (
      KINDS[type].mass > 0 &&
      type !== 'deck' &&
      type !== 'dispenser' &&
      type !== 'mat' &&
      type !== 'notecard' &&
      type !== 'notecardStack'
    ) {
      body.quaternion.setFromEuler(random() * 6, random() * 6, random() * 6);
    }
    if (type === 'card' || type === 'notecard' || type === 'notecardStack') {
      body.angularDamping = sim.cards.angDamp;
      body.linearDamping = sim.cards.linDamp;
      body.sleepSpeedLimit = sim.cards.sleepSpeed;
      body.sleepTimeLimit = sim.cards.sleepTime;
    } else if (type === 'mat') {
      body.angularDamping = sim.damp.flat;
      body.linearDamping = 0.6;
    } else {
      body.angularDamping = type === 'deck' ? sim.damp.flat : sim.damp.solid;
    }
    if (props.traySeat != null) body.__traySeat = +props.traySeat;
    room.world.addBody(body);

    const id = String(room.nextId++);
    const piece = new Piece();
    piece.type = type;
    piece.owner = '';
    piece.count = 0;
    piece.props = '{}';

    if (type === 'deck') {
      const deckData =
        props.set === 'domino'
          ? deckBuilders.buildDominoSet()
          : props.set === 'letter'
            ? deckBuilders.buildScrabbleBag()
            : props.set === 'mahjong'
              ? deckBuilders.buildMahjongWall()
              : props.cards && props.cards.length
                ? {
                    back: props.back || 'back',
                    cards: props.cards,
                    ...geoOf(props),
                    deckModel: props.deckModel,
                  }
                : deckBuilders.buildSimpleDeck(!!props.jokers);
      room.deckCards.set(id, deckData.cards.slice());
      piece.count = deckData.cards.length;
      const deckProps = { back: deckData.back, ...geoOf(deckData) };
      if (props.browseAccess === 'players') deckProps.browseAccess = 'players';
      if (deckData.deckModel && DECK_MODELS[deckData.deckModel])
        deckProps.model = deckData.deckModel;
      if (props.color != null) deckProps.color = props.color;
      if (props.textColor != null) deckProps.textColor = props.textColor;
      const labels = normalizePieceLabels({
        label: props.label ?? '',
        lowStock: props.lowStock ?? null,
      });
      if (labels?.label) deckProps.label = labels.label;
      if (labels?.lowStock) deckProps.lowStock = labels.lowStock;
      if (props.open) {
        deckProps.open = true;
        const topBack = cardBackRef(deckData.cards[deckData.cards.length - 1]);
        if (topBack) deckProps.cover = topBack;
      }
      writeProps(piece, deckProps);
    } else if (type === 'dispenser') {
      const dispenser = dispenserDefinition(props) || {};
      piece.count =
        dispenser.infinite || (!dispenser.count && !dispenser.defaultCount)
          ? 0
          : Math.max(
              1,
              Math.min(
                dispenser.count ? dispenser.count.max : 1000,
                +props.count || (dispenser.count ? dispenser.count.def : dispenser.defaultCount),
              ),
            );
      writeProps(piece, props);
    } else {
      writeProps(
        piece,
        type === 'notecard' || type === 'notecardStack'
          ? { snap: !!props.snap, stand: props.stand, label: props.label, faceDown: true }
          : props,
      );
    }

    room.writeTransform(piece, body);
    room.state.pieces.set(id, piece);
    room.bodies.set(id, body);
    if (type === 'notecard') room.notecards.restore(id, props);
    if (type === 'notecardStack') room.notecards.restoreStack(id, props.cards);
    body.addEventListener('collide', (event) => {
      const releasedAt = room._released.get(id);
      if (releasedAt === undefined) return;
      if (now() - releasedAt > 3000) {
        room._released.delete(id);
        return;
      }
      if (Math.abs(event.contact.getImpactVelocityAlongNormal()) < sim.impact.minVel) return;
      room._released.delete(id);
      room.broadcast('sfx', { type: dropSfx(type, props) });
    });
    if (type === 'deck') room.updateDeckCollider(id);
    if (type === 'dispenser') room.updateStackCollider(id);
    return id;
  };

  const removePiece = (room, id) => {
    room.notecards?.remove(id);
    room.deckBrowsing?.cancelDeck(id, 'The deck was removed.');
    const body = room.bodies.get(id);
    if (body) room.world.removeBody(body);
    room.bodies.delete(id);
    room.targets.delete(id);
    room.flips.delete(id);
    room.deckCards.delete(id);
    room.cardData.delete(id);
    room.state.pieces.delete(id);
  };

  const releasePiece = (room, id, velocity) => {
    const piece = room.state.pieces.get(id);
    if (!piece) return;
    const releasingClient = room.clients?.find((client) => client.sessionId === piece.owner);
    piece.owner = '';
    room.targets.delete(id);
    room._released.set(id, now());

    const body = room.bodies.get(id);
    if (body) {
      const props = readProps(piece);
      if (piece.type !== 'deck' && gridActive(room.state.scale) && props.snap) {
        const point = snapToCell(
          body.position.x,
          body.position.z,
          room.state.scale,
          gridFootprintCells(props),
        );
        body.position.x = point.x;
        body.position.z = point.z;
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
      } else if (velocity) {
        const [vx, vy, vz] = velocity;
        const speed = Math.hypot(vx, vy, vz);
        const cap = piece.type === 'card' ? sim.cards.maxThrow : sim.throwCap;
        const scale = speed > cap ? cap / speed : 1;
        body.velocity.set(vx * scale, vy * scale, vz * scale);
      }
      body.wakeUp();
    }

    if (piece.type === 'card' && body) {
      for (const [deckId, cards] of room.deckCards) {
        const deckBody = room.bodies.get(deckId);
        if (!deckBody) continue;
        const onDeck =
          Math.abs(body.position.x - deckBody.position.x) < sim.absorb.x &&
          Math.abs(body.position.z - deckBody.position.z) < sim.absorb.z;
        if (!onDeck) continue;
        if (room.deckBrowsing?.blocked(releasingClient, [deckId])) continue;
        const cardProps = readProps(piece);
        const deckPiece = room.state.pieces.get(deckId);
        if (deckPiece?.type !== 'deck') continue;
        const deckProps = readProps(deckPiece);
        if (cardCompatibilityKey(cardProps) !== cardCompatibilityKey(deckProps)) continue;
        const front = (room.cardData.get(id) || {}).front || cardProps.front;
        if (!front) continue;
        cards.push(absorbedEntry(front, cardProps.back, deckProps.back));
        deckPiece.count = cards.length;
        if (deckProps.open) {
          const topBack = cardBackRef(cards[cards.length - 1]);
          const next = topBack ?? deckProps.back;
          if ((deckProps.cover ?? deckProps.back) !== next) {
            if (topBack) deckProps.cover = topBack;
            else delete deckProps.cover;
            writeProps(deckPiece, deckProps);
          }
        }
        room.updateDeckCollider(deckId);
        room.removePiece(id);
        break;
      }
    }

    if (piece.type === 'prop' && body) {
      const pieceProps = readProps(piece);
      for (const [dispenserId, dispenserPiece] of room.state.pieces) {
        if (dispenserPiece.type !== 'dispenser') continue;
        const wanted = room.dispenserItem(dispenserPiece);
        if (!itemMatchesDispenser(wanted, pieceProps)) continue;
        const dispenserBody = room.bodies.get(dispenserId);
        if (!dispenserBody) continue;
        const dispenserProps = readProps(dispenserPiece);
        const dispenser = dispenserDefinition(dispenserProps);
        const box =
          dispenserProps.asset && dispenser
            ? dispenser.appearance === 'custom'
              ? dispenser.box
              : dispenserProps.asset.item.box
            : dispenser &&
              (dispenser.body === 'stack'
                ? PROPS[dispenser.item].collider.box
                : dispenser.collider && dispenser.collider.box);
        const reach = (box ? Math.max(box[0], box[2]) : 0.5) + 0.5;
        const dx = body.position.x - dispenserBody.position.x;
        const dz = body.position.z - dispenserBody.position.z;
        if (dx * dx + dz * dz >= reach * reach) continue;
        if (dispenser && !dispenser.infinite) {
          dispenserPiece.count = (dispenserPiece.count | 0) + 1;
          room.updateStackCollider(dispenserId);
        }
        room.removePiece(id);
        room.broadcast('sfx', { type: 'object-drop' });
        break;
      }
    }
  };

  return { releasePiece, removePiece, spawn };
}
