import { TILES, cardGeom, tileAppearanceProps } from './pieces.js';

export const HAND_FAN_MAX = 12;
export const HAND_TILE_TILT = 12;
export const HAND_FAN_GROUP_MAX = 128;
const BACK_REF_MAX = 512;
const FAN_METADATA_MAX = 256 * 1024;

// Only ordinary backs are public artwork. Double-sided reverse faces and notecard
// content remain concealed; no identity, model URL, order or arbitrary nested fields.
export function handFanAppearance(card = {}) {
  const props = {};
  if (!card || typeof card !== 'object') return props;
  if (typeof card.tile === 'string' && Object.hasOwn(TILES, card.tile)) props.tile = card.tile;
  if (
    card.geom &&
    ['w', 'h'].every((key) => Number.isFinite(+card.geom[key]) && +card.geom[key] > 0)
  ) {
    const { hw, hh, th, round, shape } = cardGeom(card);
    props.geom = {
      w: hw,
      h: hh,
      t: Number.isFinite(th) ? th : TILES.card.t,
      round: Number.isFinite(+round) ? +round : TILES.card.round,
      ...(shape === 'hex' ? { shape } : {}),
    };
  }
  Object.assign(props, tileAppearanceProps(props, card, { includeDefaults: true }));
  if (card.open === true || card.fanCover === true) props.fanCover = true;
  else if (
    card.kind !== 'notecard' &&
    typeof card.back === 'string' &&
    card.back.length > 0 &&
    card.back.length <= BACK_REF_MAX
  )
    props.back = card.back;
  return props;
}

export function isHandTile(props = {}) {
  return (
    !!props &&
    props.kind !== 'notecard' &&
    (!!(props.tile && props.tile !== 'card') ||
      !!(props.geom && (props.open || props.fanCover || cardGeom(props).th > TILES.card.t)))
  );
}

// Sort groups by public appearance instead of exposing the owner's hand order. The
// synchronized count still describes the entire hand; the visible fan stays bounded.
export function handFanGroups(hand) {
  const groups = new Map();
  for (const card of hand) {
    const props = handFanAppearance(card);
    const key = JSON.stringify(props);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { props, count: 1 });
  }
  return [...groups]
    .sort(([a, ga], [b, gb]) => gb.count - ga.count || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, HAND_FAN_GROUP_MAX)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => group);
}

function shapeKey(card, ignoreBack = false) {
  const props = handFanAppearance(card);
  delete props.fanCover;
  if (ignoreBack) delete props.back; // covered tiles and legacy shape-only descriptions
  return JSON.stringify(props);
}

// Largest-remainder rounding produces exactly the available number of slots. Ties
// follow stable public group order, never private hand order, without inventing cards.
function proportionalSlots(groups, slots) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  if (!total || !slots) return groups.map(() => 0);
  const quotas = groups.map((group, index) => {
    const target = (group.count * slots) / total;
    return { index, count: Math.floor(target), remainder: target - Math.floor(target) };
  });
  const extra = slots - quotas.reduce((sum, quota) => sum + quota.count, 0);
  const ranked = [...quotas].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < extra; i++) ranked[i].count++;
  return quotas.map((quota) => quota.count);
}

// A missing/malformed new field falls back to the established card fan. Re-project
// descriptors even though the server owns them, so this path cannot select a face.
export function handFanCards(player, revealed = []) {
  const count = Math.min(HAND_FAN_MAX, Math.max(0, Math.floor(player.hand) || 0));
  const shown = revealed.slice(0, count);
  let groups = [];
  try {
    const parsed =
      typeof player.handFan === 'string' && player.handFan.length <= FAN_METADATA_MAX
        ? JSON.parse(player.handFan)
        : null;
    if (Array.isArray(parsed))
      groups = parsed
        .slice(0, HAND_FAN_GROUP_MAX)
        .flatMap((group) =>
          group?.props &&
          typeof group.props === 'object' &&
          Number.isSafeInteger(group.count) &&
          group.count > 0
            ? [{ props: handFanAppearance(group.props), count: Math.min(group.count, player.hand) }]
            : [],
        );
  } catch {
    // Older servers and invalid descriptions retain their ordinary concealed-card fan.
  }
  for (const card of shown) {
    const group = groups.find((candidate) => {
      if (candidate.count <= 0) return false;
      if (typeof card.open === 'boolean' && !!candidate.props.fanCover !== card.open) return false;
      const ignoreBack = candidate.props.fanCover || !candidate.props.back;
      return shapeKey(candidate.props, ignoreBack) === shapeKey(card, ignoreBack);
    });
    if (group) group.count--;
  }
  const missing = player.hand - shown.length - groups.reduce((sum, group) => sum + group.count, 0);
  if (missing > 0) groups.push({ props: {}, count: missing }); // legacy/overflow descriptions
  const cards = [...shown];
  const allocations = proportionalSlots(groups, count - shown.length);
  for (const [index, group] of groups.entries()) {
    for (let i = 0; i < allocations[index]; i++)
      cards.push({
        ...group.props,
        ...(group.props.fanCover ? {} : { back: group.props.back || player.handBack || undefined }),
      });
  }
  while (cards.length < count) cards.push({ back: player.handBack || undefined });
  return cards;
}
