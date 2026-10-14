import * as CANNON from 'cannon-es';
import { PROPS } from '../../shared/pieces.js';
import { readProps } from './props-codec.js';

// Placement assistance only: bodies remain independent, with no joints or static stack pins.
export const STACKING = {
  releaseSpeed: 1.5,
  supportSpeed: 0.25,
  flatCos: Math.cos(Math.PI / 36),
  placementCos: Math.cos(Math.PI / 3), // gentle moving pieces can be leveled from a 60° tilt
  alignedReach: 1.25, // overlapping tiles can be recentered from up to 62.5% of full width
  offsetReach: 0.95, // preserve offsets while keeping the card's center inside its support
  mergeReach: 0.15, // centered card-to-deck drops still return to inventory
  dropHeight: 1.8,
  contactTolerance: 0.06,
  surfaceTolerance: 0.001, // compare heights independently of wider contact/wake tolerance
  gap: 0.003,
};

function stackMode(piece, props) {
  const defaults = piece.type === 'prop' ? PROPS[props.shape] : null;
  const stackable = props.stackable ?? defaults?.stackable;
  if (stackable === false) return null;
  if (props.compoundCollider) return null;
  if (piece.type !== 'card' && piece.type !== 'prop' && piece.type !== 'deck') return null;
  if (piece.type === 'prop' && stackable !== true) return null;
  if (piece.type === 'deck' && props.model) return null; // bags/boxes are inventory containers
  const mode = props.stackMode ?? defaults?.stackMode;
  if (mode === 'aligned' || mode === 'offset') return mode;
  return piece.type === 'card' && !props.tile ? 'offset' : 'aligned';
}

function flatGeometry(body, minCos = STACKING.flatCos) {
  if (!body || body.shapes?.length !== 1) return null;
  const shape = body.shapes[0];
  const box = shape instanceof CANNON.Box;
  const cylinder = shape instanceof CANNON.Cylinder;
  if (!box && !cylinder) return null;
  const orientation = body.quaternion.mult(body.shapeOrientations[0]);
  const up = orientation.vmult(new CANNON.Vec3(0, 1, 0));
  if (Math.abs(up.y) < minCos) return null;
  const position = body.quaternion.vmult(body.shapeOffsets[0]).vadd(body.position);
  const axis = orientation.vmult(new CANNON.Vec3(1, 0, 0));
  const yaw = Math.atan2(-axis.z, axis.x);
  const radius = cylinder ? Math.min(shape.radiusTop, shape.radiusBottom) : 0;
  // For polygonal cylinders, use the inscribed circle, not their larger corner radius.
  const reach = cylinder ? radius * Math.cos(Math.PI / shape.numSegments) : 0;
  return {
    position,
    yaw,
    halfX: box ? shape.halfExtents.x : reach,
    halfZ: box ? shape.halfExtents.z : reach,
    cylinder,
    faceDown: up.y < 0,
    halfY: box ? shape.halfExtents.y : shape.height / 2,
  };
}

function proximity(geometry, x, z) {
  const dx = x - geometry.position.x;
  const dz = z - geometry.position.z;
  const cos = Math.cos(geometry.yaw),
    sin = Math.sin(geometry.yaw);
  const localX = cos * dx - sin * dz;
  const localZ = sin * dx + cos * dz;
  return geometry.cylinder
    ? Math.hypot(localX, localZ) / geometry.halfX
    : Math.max(Math.abs(localX) / geometry.halfX, Math.abs(localZ) / geometry.halfZ);
}

// Query only public geometry and visibility; never consult card faces or inventory order.
function findSupport(room, id, point, reach, resting = false, fromInventory = false) {
  const piece = room.state.pieces.get(id);
  const body = room.bodies.get(id);
  const props = readProps(piece);
  if (!piece || piece.hidden || !stackMode(piece, props)) return null;
  const moving = flatGeometry(body, resting ? STACKING.flatCos : STACKING.placementCos);
  if (!moving) return null;
  body.updateAABB();
  const bottom = resting
    ? point.y - body.position.y + body.aabb.lowerBound.y
    : point.y + body.shapeOffsets[0].y * (moving.faceDown ? -1 : 1) - moving.halfY;
  let best = null;
  for (const [otherId, other] of room.state.pieces) {
    if (otherId === id || other.hidden || (!resting && other.owner)) continue;
    if (!resting && (room.flips?.has(otherId) || room.notecards?.isEditing(otherId))) continue;
    const supportBody = room.bodies.get(otherId);
    const supportProps = readProps(other);
    if (!stackMode(other, supportProps)) continue;
    if (piece.type === 'card' && other.type !== 'prop' && props.tile !== supportProps.tile)
      continue;
    if (
      !resting &&
      (supportBody?.velocity.length() > STACKING.supportSpeed ||
        supportBody?.angularVelocity.length() > STACKING.supportSpeed)
    )
      continue;
    const geometry = flatGeometry(supportBody);
    if (!geometry) continue;
    const distance = proximity(geometry, point.x, point.z);
    if (distance > reach) continue;
    supportBody.updateAABB();
    const top = supportBody.aabb.upperBound.y;
    const clearance = bottom - top;
    if (
      !fromInventory &&
      (clearance < -STACKING.contactTolerance ||
        clearance > (resting ? STACKING.contactTolerance : STACKING.dropHeight))
    )
      continue;
    // Widened edge capture must not steal a drop from a column containing its center.
    const outside = distance > 1;
    const sameTier = !best || outside === best.distance > 1;
    if (
      !best ||
      (best.distance > 1 && !outside) ||
      (sameTier &&
        (top > best.top + STACKING.surfaceTolerance ||
          (Math.abs(top - best.top) <= STACKING.surfaceTolerance && distance < best.distance)))
    ) {
      best = { id: otherId, piece: other, body: supportBody, geometry, top, distance };
    }
  }
  return best;
}

export function hasStackSupport(room, id) {
  const body = room.bodies.get(id);
  return !!body && !!findSupport(room, id, body.position, 1, true);
}

function levelBody(body, geometry, yaw = geometry.yaw) {
  const rotation = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
  if (geometry.faceDown)
    rotation.mult(
      new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI),
      rotation,
    );
  body.quaternion.copy(rotation);
  body.aabbNeedsUpdate = true;
}

// Keep a carried corner from hitting the pile before the release assist gets a chance to run.
// Facing and face-up/down choice remain the player's; center/height placement waits for release.
export function prepareStackDrag(room, id, target) {
  const piece = room.state.pieces.get(id),
    body = room.bodies.get(id);
  const mode = piece && stackMode(piece, readProps(piece));
  if (
    !mode ||
    piece.hidden ||
    piece.type === 'deck' ||
    room.flips?.has(id) ||
    (room.groups?.get(piece.owner)?.size ?? 0) > 1
  )
    return false;
  const moving = flatGeometry(body, STACKING.placementCos);
  if (
    !moving ||
    !findSupport(room, id, target, mode === 'offset' ? STACKING.offsetReach : STACKING.alignedReach)
  )
    return false;
  levelBody(body, moving);
  body.angularVelocity.setZero();
  return true;
}

export function assistStackPlacement(room, id, target, velocity, { fromInventory = false } = {}) {
  const piece = room.state?.pieces.get(id);
  const body = room.bodies?.get(id);
  const mode = piece && stackMode(piece, readProps(piece));
  if (!mode || piece.hidden || piece.type === 'deck' || room.flips?.has(id)) return false;
  if (velocity && !(Math.hypot(...velocity) <= STACKING.releaseSpeed)) return false;
  const moving = flatGeometry(body, STACKING.placementCos);
  if (!moving) return false;
  const point = target ?? body.position;
  if (![point.x, point.y, point.z].every(Number.isFinite)) return false;
  const support = findSupport(
    room,
    id,
    point,
    mode === 'offset' ? STACKING.offsetReach : STACKING.alignedReach,
    false,
    fromInventory,
  );
  if (!support) return false;
  // A centered drop is the familiar "put it back" gesture; offset drops stay separate.
  if (
    support.piece.type === 'deck' &&
    (mode !== 'offset' || support.distance <= STACKING.mergeReach)
  )
    return false;
  const yaw = mode === 'aligned' ? support.geometry.yaw : moving.yaw;
  const previousPosition = body.position.clone();
  const previousOrientation = body.quaternion.clone();
  levelBody(body, moving, yaw);
  const x = mode === 'aligned' ? support.geometry.position.x : point.x;
  const z = mode === 'aligned' ? support.geometry.position.z : point.z;
  body.position.set(x, point.y, z);
  body.updateAABB();
  body.position.y += support.top + STACKING.gap - body.aabb.lowerBound.y;
  body.updateAABB();
  for (const [otherId, otherBody] of room.bodies) {
    if (
      otherId === id ||
      otherId === support.id ||
      room.state.pieces.get(otherId)?.hidden ||
      !otherBody.collisionFilterMask
    )
      continue;
    otherBody.updateAABB();
    const a = body.aabb,
      b = otherBody.aabb;
    if (
      Math.min(a.upperBound.x, b.upperBound.x) - Math.max(a.lowerBound.x, b.lowerBound.x) >
        STACKING.gap &&
      Math.min(a.upperBound.y, b.upperBound.y) - Math.max(a.lowerBound.y, b.lowerBound.y) >
        STACKING.gap &&
      Math.min(a.upperBound.z, b.upperBound.z) - Math.max(a.lowerBound.z, b.lowerBound.z) >
        STACKING.gap
    ) {
      body.position.copy(previousPosition);
      body.quaternion.copy(previousOrientation);
      body.aabbNeedsUpdate = true;
      return false;
    }
  }
  body.aabbNeedsUpdate = true;
  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.wakeUp();
  room.writeTransform(piece, body);
  return true;
}

// Cannon sleeping bodies must wake when their support disappears. Discover contacts from
// geometry so this also works after save/reload, without persisting attachment relationships.
export function wakeStackAbove(room, id) {
  if (room.state.pieces.get(id)?.hidden) return;
  const pending = [id],
    visited = new Set(pending);
  for (let index = 0; index < pending.length; index++) {
    const support = room.bodies.get(pending[index]);
    if (!support?.aabb || !support.updateAABB) continue;
    support.updateAABB();
    const bounds = support.aabb;
    for (const [otherId, body] of room.bodies) {
      if (
        visited.has(otherId) ||
        room.state.pieces.get(otherId)?.hidden ||
        !body.aabb ||
        !body.updateAABB
      )
        continue;
      body.updateAABB();
      const other = body.aabb;
      if (
        Math.abs(other.lowerBound.y - bounds.upperBound.y) > STACKING.contactTolerance ||
        other.upperBound.y <= bounds.upperBound.y ||
        other.lowerBound.x >= bounds.upperBound.x ||
        other.upperBound.x <= bounds.lowerBound.x ||
        other.lowerBound.z >= bounds.upperBound.z ||
        other.upperBound.z <= bounds.lowerBound.z
      )
        continue;
      visited.add(otherId);
      pending.push(otherId);
      if (body.__pinned) room.unpinPiece(otherId);
      body.wakeUp();
    }
  }
}
