import { NOTECARD, notecardStackHeight } from './notecards.js';
import { compoundColliderSpec } from './compound-collider.js';
import { boardGeometry, boardHalfExtents } from './board-geometry.js';
import {
  DECK_MODELS,
  KINDS,
  PROPS,
  cardGeom,
  deckHeight,
  dieR,
  dieVerts,
  dispenserDefinition,
  stackVisible,
} from './pieces.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const COLLIDER_TYPES = Object.freeze(['sphere', 'cylinder', 'cone', 'flat']);

// A renderer-neutral description of the collider the server builds. The browser uses this for
// the GM debug overlay; keeping Cannon/Three objects out of this module also makes the mapping
// cheap to test. Dimensions are world half-extents unless a field says otherwise.
export function primitiveColliderSpec(type, hx, hy, hz, options = {}) {
  if (type === 'sphere') return { type: 'sphere', radius: Math.max(hx, hy, hz) };
  if (type === 'cylinder' || type === 'cone') {
    const radius = Math.max(hx, hz);
    return {
      type: 'cylinder',
      radiusBottom: radius,
      radiusTop:
        type === 'cone' ? radius * 0.05 : options.top != null ? radius * options.top : radius,
      height: hy * 2,
      sides: Math.max(3, options.sides | 0 || 16),
    };
  }
  if (type === 'flat') {
    const thickness = 0.06;
    return {
      type: 'box',
      halfExtents: [hx, thickness, hz],
      offset: [0, -(hy - thickness), 0],
    };
  }
  return { type: 'box', halfExtents: [hx, hy, hz] };
}

// Authoritative renderer-neutral collider definition for both Cannon physics and browser debug
// geometry. `count` is separate because it is a synchronized Piece field rather than part of props.
export function colliderSpec(type, props = {}, { cardColliderThickness = 0.04, count } = {}) {
  if (type === 'notecardStack')
    return {
      type: 'box',
      halfExtents: [
        NOTECARD.width / 2,
        notecardStackHeight(count ?? props.count) / 2,
        NOTECARD.height / 2,
      ],
    };
  const shape = KINDS[type]?.shape;
  if (!shape) return null;
  if ((type === 'prop' || type === 'board') && props.model && props.compoundCollider) {
    const compound = compoundColliderSpec(props.compoundCollider, props.box);
    if (compound) return compound;
  }

  if (shape === 'die') {
    const sides = props.sides || 6;
    const vertices = sides === 6 ? null : dieVerts(sides);
    return vertices
      ? { type: 'convex', vertices }
      : primitiveColliderSpec(undefined, dieR(6), dieR(6), dieR(6));
  }

  if (shape === 'prop') {
    if (props.model && Array.isArray(props.box)) {
      const [hx, hy, hz] = props.box.map((value) => clamp(+value || 0.5, 0.05, 4));
      return primitiveColliderSpec(props.collider, hx, hy, hz);
    }
    const spec = (PROPS[props.shape] || PROPS.box).collider;
    const scale = clamp(+props.scale || 1, 0.3, 3);
    const [hx, hy, hz] = spec.box.map((value) => value * scale);
    return primitiveColliderSpec(spec.type, hx, hy, hz, {
      sides: spec.sides,
      top: spec.top,
    });
  }

  if (type === 'board') {
    if (props.outline && (props.outline.type !== 'rectangle' || props.outline.fit) && !props.board)
      return { type: 'convex', ...boardGeometry(props) };
    return { type: 'box', halfExtents: boardHalfExtents(props) };
  }

  if (shape === 'dispenser') {
    const dispenser = dispenserDefinition(props);
    if (!dispenser) return { type: 'box', halfExtents: [0.4, 0.2, 0.4] };
    const liveCount = count ?? props.count;
    if (props.asset) {
      if (dispenser.appearance === 'automatic') {
        const [hx, hy, hz] = props.asset.item.box || [0.4, 0.2, 0.4];
        const visible = stackVisible(
          dispenser.infinite ? 8 : (liveCount ?? dispenser.defaultCount ?? 1),
        );
        return { type: 'box', halfExtents: [hx, Math.max(hy, visible * hy), hz] };
      }
      if (dispenser.appearance === 'custom' && Array.isArray(dispenser.box)) {
        const [hx, hy, hz] = dispenser.box;
        return primitiveColliderSpec(dispenser.collider, hx, hy, hz);
      }
      const [hx, , hz] = props.asset.item.box || [0.6, 0.4, 0.6];
      const radius = Math.max(hx, hz, 0.55);
      return {
        type: 'cylinder',
        radiusTop: radius,
        radiusBottom: radius,
        height: 0.7,
        sides: 20,
      };
    }
    if (dispenser.body === 'stack') {
      const box = PROPS[dispenser.item].collider.box;
      const radius = box[0];
      const itemHeight = box[1] * 2;
      const visible = stackVisible(liveCount ?? dispenser.count.def);
      return {
        type: 'cylinder',
        radiusTop: radius,
        radiusBottom: radius,
        height: Math.max(itemHeight, visible * itemHeight),
        sides: 16,
      };
    }
    const [hx, hy, hz] = dispenser.collider.box;
    return primitiveColliderSpec(dispenser.collider.type, hx, hy, hz, {
      sides: dispenser.collider.sides,
      top: dispenser.collider.top,
    });
  }

  if (type === 'card' || type === 'mat') {
    const geometry = cardGeom(props);
    const halfThickness = Math.max(geometry.th, cardColliderThickness);
    return geometry.shape === 'hex'
      ? {
          type: 'cylinder',
          radiusTop: geometry.hh,
          radiusBottom: geometry.hh,
          height: halfThickness * 2,
          sides: 6,
        }
      : { type: 'box', halfExtents: [geometry.hw, halfThickness, geometry.hh] };
  }

  if (type === 'deck') {
    const skin = props.model && DECK_MODELS[props.model];
    if (skin) return { type: 'box', halfExtents: [...skin.box] };
    const geometry = cardGeom(props);
    const height = deckHeight(count ?? props.count ?? 0);
    return geometry.shape === 'hex'
      ? {
          type: 'cylinder',
          radiusTop: geometry.hh,
          radiusBottom: geometry.hh,
          height,
          sides: 6,
        }
      : { type: 'box', halfExtents: [geometry.hw, height / 2, geometry.hh] };
  }

  return shape.box ? { type: 'box', halfExtents: [...shape.box] } : null;
}
