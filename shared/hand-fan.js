import { TILES, cardGeom, tileAppearanceProps } from './pieces.js';

export const HAND_FAN_MAX = 12;
export const HAND_TILE_TILT = 12;

// This projection is deliberately narrower than cardPublicProps: no identity, artwork,
// model URL, private order, notecard content, or arbitrary nested geometry fields.
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
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, HAND_FAN_MAX)
    .map(([, group]) => group);
}

function shapeKey(card) {
  const props = handFanAppearance(card);
  delete props.fanCover; // Show payloads contain faces but deliberately omit the open flag.
  return JSON.stringify(props);
}

// A missing/malformed new field falls back to the established card fan. Re-project
// descriptors even though the server owns them, so this path cannot select a face.
export function handFanCards(player, revealed = []) {
  const count = Math.min(HAND_FAN_MAX, Math.max(0, Math.floor(player.hand) || 0));
  const shown = revealed.slice(0, count);
  let groups = [];
  try {
    const parsed =
      typeof player.handFan === 'string' && player.handFan.length <= 16384
        ? JSON.parse(player.handFan)
        : null;
    if (Array.isArray(parsed))
      groups = parsed
        .slice(0, HAND_FAN_MAX)
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
    const key = shapeKey(card);
    const group = groups.find(
      (candidate) => candidate.count > 0 && shapeKey(candidate.props) === key,
    );
    if (group) group.count--;
  }
  const cards = [...shown];
  for (const group of groups) {
    for (let i = 0; i < group.count && cards.length < count; i++)
      cards.push({
        ...group.props,
        ...(group.props.fanCover ? {} : { back: player.handBack || undefined }),
      });
  }
  while (cards.length < count) cards.push({ back: player.handBack || undefined });
  return cards;
}
