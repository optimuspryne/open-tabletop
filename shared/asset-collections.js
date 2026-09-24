// Canonical stored kinds: tile sets are decks; dispensers share their prop's membership.
export const COLLECTION_KINDS = Object.freeze([
  'deck',
  'board',
  'mat',
  'prop',
  'scene',
  'sky',
  'dice',
]);
export const COLLECTION_LIMITS = Object.freeze({ collections: 64, items: 500, name: 80, page: 16 });
const id = (value) =>
  typeof value === 'string' &&
  /^[1-9]\d{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
export const collectionItemKey = (item) => `${item.kind}:${item.id}`;
export function collectionPayload(value, operation) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys =
    operation === 'list'
      ? ['request', 'after']
      : operation === 'delete'
        ? ['id', 'revision']
        : operation === 'create'
          ? ['name', 'isPublic']
          : ['id', 'revision', 'name', 'isPublic', 'items'];
  if (Object.keys(value).some((key) => !keys.includes(key))) return null;
  if (operation === 'list')
    return Number.isSafeInteger(value.request) &&
      value.request >= 0 &&
      (value.after === undefined || id(value.after))
      ? { request: value.request, after: value.after || '0' }
      : null;
  if (
    operation !== 'create' &&
    (!id(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 1)
  )
    return null;
  if (operation === 'delete') return { id: value.id, revision: value.revision };
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.trim().length > COLLECTION_LIMITS.name ||
    typeof value.isPublic !== 'boolean'
  )
    return null;
  const result = { ...value, name: value.name.trim() };
  if (operation === 'update') {
    if (!Array.isArray(value.items) || value.items.length > COLLECTION_LIMITS.items) return null;
    const seen = new Set();
    result.items = [];
    for (const item of value.items) {
      if (
        !item ||
        typeof item !== 'object' ||
        Object.keys(item).some((key) => !['kind', 'id'].includes(key)) ||
        !COLLECTION_KINDS.includes(item.kind) ||
        !id(item.id)
      )
        return null;
      const key = collectionItemKey(item);
      if (!seen.has(key)) result.items.push({ kind: item.kind, id: item.id });
      seen.add(key);
    }
  }
  return result;
}

export function collectionAllows(collections, hidden, kind, assetId) {
  const memberships = collections.filter((collection) =>
    collection.items.some((item) => item.kind === kind && item.id === assetId),
  );
  return memberships.length
    ? memberships.some((collection) => !hidden.has(collection.id))
    : !hidden.has('uncollected');
}
