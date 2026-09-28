import { AsyncLocalStorage } from 'node:async_hooks';
import { StateView } from '@colyseus/schema';
import { Body, Quaternion, Ray, Vec3 } from 'cannon-es';
import { RANK, canUseRoomCapability } from '../permissions.js';
import { groupIds, isPlainObject, pieceIdPayload } from '../message-validation.js';
import { returnInspectedCard } from './inspection-recovery.js';

const SPAWNS = new Set([
  'spawn',
  'loadDeck',
  'loadBoard',
  'loadMat',
  'loadProp',
  'deckFinish',
  'saveMat',
  'saveProp',
]);
const SINGLE = new Set(
  'fogEdit setFogAura grab move release setPieceLabels recolor rollOne setStand setSnap snap remove flip takeCard dispense dispenseDrag highlightPiece notecardEdit notecardCommit notecardKeepAlive notecardFlip notecardDraw notecardShuffle notecardSplit notecardCancel'.split(
    ' ',
  ),
);
const GROUP = new Set(
  'grabGroup setStandGroup setSnapGroup rollGroup flipGroup setOpenGroup takeGroup rotateGroup recolorGroup removeGroup gatherDispensers absorbIntoDispenser dispenseFromPieces combineIntoDeck notecardCombine setPieceVisibility'.split(
    ' ',
  ),
);
const DECK = new Set(
  'dealToTable drawToHand dealDrag drawInspect shuffle splitDeck browseDeck setDeckBrowseAccess'.split(
    ' ',
  ),
);
const MERGE = new Set([
  'combineIntoDeck',
  'gatherDispensers',
  'absorbIntoDispenser',
  'dispenseFromPieces',
  'notecardCombine',
]);
const PLACEMENT_TOLERANCE = 0.03;

// One authoritative collection, per-client projections. The async request scope belongs to this
// room: it carries immutable visibility provenance across library reads and derived spawns.
export function createPieceVisibility(room) {
  const requests = new AsyncLocalStorage();
  const views = new WeakMap();
  const parked = new WeakMap();
  const isGM = (client) =>
    !!client && canUseRoomCapability(client.auth, 'observation') && room.rank(client) >= RANK.gm;
  const canSee = (client, piece) =>
    !!piece && !client.auth?.revoked && (!piece.hidden || isGM(client));
  const error = (client, operation, message) => client.send('serverError', { operation, message });
  const validId = (id) => pieceIdPayload({ id })?.id;

  function sourceIds(client, type, message) {
    let ids = [];
    if (SINGLE.has(type)) ids = [message?.id];
    if (GROUP.has(type)) ids = Array.isArray(message?.ids) ? message.ids.slice(0, 1000) : [];
    if (type === 'grabGroup') ids.push(message?.anchor);
    if (DECK.has(type)) ids = [message?.deckId];
    if (type === 'moveGroup' || type === 'releaseGroup')
      ids = [...(room.groups.get(client.sessionId)?.keys() || [])];
    if (type === 'inspectPlace') ids = [room.pendingInspect.get(client.sessionId)?.deckId];
    if (type.startsWith('browse')) ids.push(room.deckBrowsing?.sourceFor(client));
    if (type === 'handFromTable') ids = room.lastDrop.get(client.sessionId)?.ids || [];
    if (type === 'calibrateGrid')
      ids = [...room.state.pieces].filter(([, p]) => p.type === 'board').map(([id]) => id);
    return [...new Set(ids.map(validId).filter(Boolean))];
  }

  function runRequest(client, type, message, handler) {
    syncClient(client);
    let spawnHidden;
    if (SPAWNS.has(type) && isPlainObject(message) && Object.hasOwn(message, 'spawnHidden')) {
      if (typeof message.spawnHidden !== 'boolean' || (message.spawnHidden && !isGM(client)))
        return;
      ({ spawnHidden, ...message } = message);
    }
    const ids = sourceIds(client, type, message);
    const sources = ids.map((id) => room.state.pieces.get(id)).filter(Boolean);
    if (sources.some((piece) => !canSee(client, piece))) return;
    const hidden =
      sources.some((piece) => piece.hidden) ||
      (type === 'inspectPlace' && room.pendingInspect.get(client.sessionId)?.hidden === true);
    if (hidden && !isGM(client)) return;
    if (MERGE.has(type) && hidden && sources.some((piece) => !piece.hidden))
      return error(client, type, 'Hide or reveal the whole selection before combining it.');
    if (hidden && (type === 'rollOne' || type === 'rollGroup'))
      return error(client, type, 'Reveal hidden dice before rolling them.');
    return requests.run({ client, sources, hidden: spawnHidden ?? hidden, type }, () =>
      handler(client, message),
    );
  }

  function spawnHidden(explicit) {
    const request = requests.getStore();
    const hidden = explicit ?? request?.hidden ?? false;
    if (
      request &&
      (!canUseRoomCapability(request.client.auth, 'gameplay') ||
        (hidden && !isGM(request.client)) ||
        request.sources.some((p) => !canSee(request.client, p)))
    )
      throw new Error('Piece placement access changed.');
    return hidden === true;
  }

  function prepareBody(id) {
    const piece = room.state.pieces.get(id),
      body = room.bodies.get(id);
    if (!body) return;
    if (piece?.hidden) {
      if (!parked.has(body)) parked.set(body, { mask: body.collisionFilterMask });
      body.collisionFilterMask = 0;
      body.type = Body.KINEMATIC;
      body.force.setZero();
      body.torque.setZero();
      if (!piece.owner) {
        body.velocity.setZero();
        body.angularVelocity.setZero();
      }
      body.updateMassProperties();
    } else if (parked.has(body)) {
      body.collisionFilterMask = parked.get(body).mask;
      body.type = body.mass > 0 && !body.__pinned ? Body.DYNAMIC : Body.STATIC;
      body.updateMassProperties();
      body.wakeUp();
      parked.delete(body);
    }
  }

  // Hidden bodies cannot fall under gravity. Resolve the same board/table drop surface
  // explicitly, using real collider parts without changing their collision filters.
  function settleReleasedPiece(id) {
    const piece = room.state.pieces.get(id),
      body = room.bodies.get(id);
    if (!piece?.hidden || !body || body.mass <= 0) return;
    body.updateAABB();
    const bottomOffset = body.position.y - body.aabb.lowerBound.y;
    const ray = new Ray(
      new Vec3(body.position.x, Math.max(0, body.aabb.upperBound.y), body.position.z),
      new Vec3(body.position.x, 0, body.position.z),
    );
    ray.mode = Ray.CLOSEST;
    ray.skipBackfaces = true;
    ray.updateDirection();
    const position = new Vec3(),
      orientation = new Quaternion();
    for (const [otherId, other] of room.state.pieces) {
      if (otherId === id || other.owner || !['board', 'mat'].includes(other.type)) continue;
      const support = room.bodies.get(otherId);
      if (!support) continue;
      for (let i = 0; i < support.shapes.length; i++) {
        support.quaternion.mult(support.shapeOrientations[i], orientation);
        support.quaternion.vmult(support.shapeOffsets[i], position);
        position.vadd(support.position, position);
        ray.intersectShape(support.shapes[i], orientation, position, support);
      }
    }
    body.position.y = (ray.hasHit ? ray.result.hitPointWorld.y : 0) + bottomOffset;
    body.aabbNeedsUpdate = true;
    prepareBody(id);
    room.writeTransform(piece, body);
  }

  function syncClient(client) {
    let previous = views.get(client);
    if (!previous) {
      client.view = new StateView();
      previous = new Map();
      // Seed the collection itself so reflected browser schemas receive an empty MapSchema
      // even when the table is entirely hidden. add() is recursive: prune every unauthorized
      // child synchronously, before this view can reach any serializer or async boundary.
      client.view.add(room.state.pieces);
      for (const [id, piece] of room.state.pieces) {
        if (canSee(client, piece)) previous.set(id, piece);
        else client.view.remove(piece);
      }
      views.set(client, previous);
    }
    for (const [id, piece] of previous) {
      if (room.state.pieces.get(id) !== piece || !canSee(client, piece)) {
        client.view.remove(piece);
        previous.delete(id);
        if (piece.owner === client.sessionId) {
          piece.owner = '';
          room.targets.delete(id);
          const body = room.bodies.get(id);
          body?.velocity.setZero();
          body?.angularVelocity.setZero();
        }
        room.groups.get(client.sessionId)?.delete(id);
        if (!canSee(client, piece)) {
          room.notecards?.cancelClient(client.sessionId);
          room.deckBrowsing?.cancelClient(client.sessionId, 'Object visibility changed.');
        }
      }
    }
    const pending = room.pendingInspect.get(client.sessionId);
    if (
      pending &&
      (pending.hidden || room.state.pieces.get(pending.deckId)?.hidden) &&
      !isGM(client)
    ) {
      pending.hidden = true;
      pending.recover = true;
      returnInspectedCard(room, client.sessionId);
      if (!pending.accessClosed) client.send('inspectionClosed', {});
      pending.accessClosed = true;
    }
    for (const [id, piece] of room.state.pieces) {
      if (canSee(client, piece) && !previous.has(id)) {
        client.view.add(piece);
        previous.set(id, piece);
      }
    }
  }

  function setVisibility(client, message) {
    if (
      !isGM(client) ||
      !isPlainObject(message) ||
      typeof message.hidden !== 'boolean' ||
      Object.keys(message).some((key) => !['ids', 'hidden'].includes(key))
    )
      return;
    const ids = groupIds({ ids: message.ids }, { max: 1000 });
    if (!ids) return;
    const targets = new Set(ids.filter((id) => room.state.pieces.has(id)));
    const changed = [...targets].filter(
      (id) => !!room.state.pieces.get(id).hidden !== message.hidden,
    );
    // Validate the whole batch before changing anything. AABBs are deliberately conservative:
    // false positives ask the GM to reposition; false negatives could launch visible objects.
    for (const id of changed) {
      const piece = room.state.pieces.get(id),
        body = room.bodies.get(id);
      if (piece.owner || room.flips.has(id) || room.notecards?.isEditing(id))
        return error(
          client,
          'setPieceVisibility',
          'Release the pieces and finish edits before changing visibility.',
        );
      if (!body) continue;
      if (message.hidden && body.__traySeat != null)
        return error(
          client,
          'setPieceVisibility',
          'Personal tray dice stay visible. Spawn dice on the main table to hide them.',
        );
      body.updateAABB();
      const a = body.aabb;
      if (!message.hidden && a.lowerBound.y < -PLACEMENT_TOLERANCE)
        return error(
          client,
          'setPieceVisibility',
          'Move hidden pieces above the tabletop before revealing them.',
        );
      for (const [otherId, other] of room.state.pieces) {
        if (
          id === otherId ||
          (message.hidden && targets.has(otherId)) ||
          (other.hidden && (message.hidden || !targets.has(otherId)))
        )
          continue;
        const otherBody = room.bodies.get(otherId);
        if (!otherBody) continue;
        otherBody.updateAABB();
        const b = otherBody.aabb,
          t = PLACEMENT_TOLERANCE;
        const horizontal =
          a.lowerBound.x < b.upperBound.x - t &&
          a.upperBound.x > b.lowerBound.x + t &&
          a.lowerBound.z < b.upperBound.z - t &&
          a.upperBound.z > b.lowerBound.z + t;
        if (!horizontal) continue;
        if (
          message.hidden &&
          b.lowerBound.y >= a.upperBound.y - t &&
          b.lowerBound.y <= a.upperBound.y + t
        )
          return error(
            client,
            'setPieceVisibility',
            'Move or include the pieces resting on this object before hiding it.',
          );
        if (
          !message.hidden &&
          a.lowerBound.y < b.upperBound.y - t &&
          a.upperBound.y > b.lowerBound.y + t
        )
          return error(
            client,
            'setPieceVisibility',
            'Move hidden pieces into free space before revealing them.',
          );
      }
    }
    for (const id of changed) {
      const piece = room.state.pieces.get(id);
      piece.hidden = message.hidden;
      for (const pending of room.pendingInspect.values())
        if (pending.deckId === id) pending.hidden = message.hidden;
      room.deckBrowsing?.cancelDeck(id, 'Object visibility changed.');
      room._released.delete(id);
      prepareBody(id);
    }
    sync();
  }

  function sync() {
    for (const client of room.clients) syncClient(client);
  }
  function broadcast(type, payload, ids = []) {
    const restricted =
      requests.getStore()?.hidden || ids.some((id) => room.state.pieces.get(id)?.hidden);
    if (!restricted) return room.broadcast(type, payload);
    for (const client of room.clients) if (isGM(client)) client.send(type, payload);
  }
  return {
    canSee,
    isGM,
    runRequest,
    spawnHidden,
    prepareBody,
    settleReleasedPiece,
    sync,
    syncClient,
    setVisibility,
    broadcast,
    preparePhysics() {
      for (const id of room.state.pieces.keys()) prepareBody(id);
    },
  };
}

// Retain simple room doubles for handler tests; production always installs the service.
export function broadcastPieceEvent(room, type, payload, ids) {
  if (room.visibility) room.visibility.broadcast(type, payload, ids);
  else room.broadcast(type, payload);
}
