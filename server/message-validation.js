// Normalizers for values arriving across the WebSocket trust boundary. A
// normalizer returns a fresh, trusted value or null; handlers must not continue
// using the original message after validation.
export const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function boundedString(value, { min = 0, max = 256, pattern = null } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) return null;
  if (pattern && !pattern.test(value)) return null;
  return value;
}

export function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

// Piece ids are server-generated decimal strings. Reject duplicate ids rather
// than performing the same batch operation repeatedly.
export function boundedUniqueIds(value, { min = 1, max = 80 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const ids = [];
  const seen = new Set();
  for (const valueId of value) {
    const id = boundedString(valueId, { min: 1, max: 20, pattern: /^\d+$/ });
    if (id === null || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const exactObject = (value, keys) => isPlainObject(value) && hasOnlyKeys(value, new Set(keys));

export function oneField(message, key, normalize) {
  if (!exactObject(message, [key])) return null;
  const value = normalize(message[key]);
  return value === null ? null : { [key]: value };
}

export const hexColor = (value) => boundedString(value, { min: 7, max: 7, pattern: /^#[0-9a-f]{6}$/i });

export function timerPayload(message) {
  if (!isPlainObject(message)) return null;
  if (['start', 'pause', 'reset'].includes(message.action))
    return exactObject(message, ['action']) ? { action: message.action } : null;
  if (message.action !== 'set' || !exactObject(message, ['action', 'mode', 'duration'])) return null;
  if (message.mode !== 'up' && message.mode !== 'down') return null;
  const duration = finiteNumber(message.duration, { min: 0, max: 86400000 });
  return duration === null ? null : { action: 'set', mode: message.mode, duration };
}

export function scorePayload(message) {
  if (!isPlainObject(message)) return null;
  const { action } = message;
  if (action === 'clear') return exactObject(message, ['action']) ? { action } : null;
  if (action === 'add') {
    if (!exactObject(message, ['action', 'label'])) return null;
    const label = boundedString(message.label, { min: 1, max: 40 });
    return label === null ? null : { action, label };
  }
  const id = boundedString(message.id, { min: 2, max: 20, pattern: /^s\d+$/ });
  if (id === null) return null;
  if (action === 'remove') return exactObject(message, ['action', 'id']) ? { action, id } : null;
  if (action === 'label') {
    if (!exactObject(message, ['action', 'id', 'label'])) return null;
    const label = boundedString(message.label, { max: 40 });
    return label === null ? null : { action, id, label };
  }
  const field = action === 'adjust' ? 'delta' : action === 'set' ? 'score' : null;
  if (!field || !exactObject(message, ['action', 'id', field])) return null;
  const value = finiteNumber(message[field], { min: -1e9, max: 1e9 });
  return value === null ? null : { action, id, [field]: Math.trunc(value) };
}

export function tablePayload(message, limits) {
  if (!exactObject(message, ['x', 'z'])) return null;
  const x = finiteNumber(message.x, { min: limits.minX, max: limits.maxX });
  const z = finiteNumber(message.z, { min: limits.minZ, max: limits.maxZ });
  return x === null || z === null ? null : { x, z };
}

export function scalePayload(message, { gridLiftMax = 3 } = {}) {
  if (!isPlainObject(message)) return null;
  const rules = {
    worldPerUnit: (v) => finiteNumber(v, { min: 1e-3, max: 1e3 }),
    unitLabel: (v) => typeof v === 'string' && !/[\x00-\x1f]/.test(v) && v.trim().length > 0 && v.trim().length <= 8 ? v.trim() : null,
    roundStep: (v) => finiteNumber(v, { min: 1e-3, max: 1e2 }),
    cellWorld: (v) => finiteNumber(v, { min: 0, max: 1e3 }),
    cellZ: (v) => finiteNumber(v, { min: 0, max: 1e3 }),
    gridX: (v) => finiteNumber(v, { min: -1e3, max: 1e3 }),
    gridZ: (v) => finiteNumber(v, { min: -1e3, max: 1e3 }),
    gridStyle: (v) => ['square', 'hex', 'off'].includes(v) ? v : null,
    gridHidden: (v) => typeof v === 'boolean' ? v : null,
    gridColor: hexColor,
    gridLift: (v) => finiteNumber(v, { min: 0, max: gridLiftMax }),
    snapAnchor: (v) => ['center', 'cross'].includes(v) ? v : null,
  };
  const keys = Object.keys(message);
  if (!keys.length || keys.some((key) => !rules[key])) return null;
  const out = {};
  for (const key of keys) { const value = rules[key](message[key]); if (value === null) return null; out[key] = value; }
  return out;
}

export function overlayGeometry(message, { kinds, maxLen, allowEmpty = false, requireKind = false } = {}) {
  if (!isPlainObject(message)) return null;
  if (allowEmpty && Object.keys(message).length === 0) return { kind: null };
  const allowed = ['kind', 'x', 'z', 'x2', 'z2', 'w', 'ang'];
  if (!hasOnlyKeys(message, new Set(allowed))) return null;
  if (requireKind && !kinds.has(message.kind)) return null;
  const out = requireKind ? { kind: message.kind } : {};
  for (const key of ['x', 'z', 'x2', 'z2']) {
    if (message[key] === undefined) { if (requireKind) return null; continue; }
    const value = finiteNumber(message[key], { min: -maxLen, max: maxLen }); if (value === null) return null; out[key] = value;
  }
  if (message.w !== undefined) { const w = finiteNumber(message.w, { min: 0, max: maxLen }); if (w === null) return null; out.w = w; }
  if (message.ang !== undefined) { const ang = finiteNumber(message.ang, { min: -Math.PI * 2, max: Math.PI * 2 }); if (ang === null) return null; out.ang = ang; }
  return out;
}

export function overlayIdPayload(message) {
  return oneField(message, 'id', (id) => boundedString(id, { min: 2, max: 20, pattern: /^o\d+$/ }));
}

export function overlayMovePayload(message, options) {
  if (!isPlainObject(message)) return null;
  const id = boundedString(message.id, { min: 2, max: 20, pattern: /^o\d+$/ });
  if (id === null) return null;
  const { id: ignored, ...geometry } = message;
  const parsed = overlayGeometry(geometry, options);
  return parsed && Object.keys(parsed).length ? { id, ...parsed } : null;
}

export function whiteboardStroke(message) {
  if (!exactObject(message, ['pts', 'color', 'width'])) return null;
  if (!Array.isArray(message.pts) || message.pts.length < 2 || message.pts.length > 2000 || message.pts.length % 2) return null;
  if (!message.pts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const color = boundedString(message.color, { min: 1, max: 24 });
  const width = finiteNumber(message.width, { min: Number.MIN_VALUE, max: 0.2 });
  return color === null || width === null ? null : { pts: message.pts.slice(), color, width };
}

export function pointPayload(message) {
  if (!exactObject(message, ['x', 'z'])) return null;
  return Number.isFinite(message.x) && Number.isFinite(message.z) ? { x: message.x, z: message.z } : null;
}

export function gridCalibrationPayload(message) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['cells', 'anchor']))) return null;
  if (!Object.keys(message).length) return {};
  const cells = finiteNumber(message.cells, { min: 1, max: 200 });
  if (cells === null || !Number.isInteger(cells)) return null;
  if (message.anchor !== undefined && message.anchor !== 'center' && message.anchor !== 'cross') return null;
  return message.anchor === undefined ? { cells } : { cells, anchor: message.anchor };
}

export function showPayload(message, { maxAudience = 20, maxCards = 1000 } = {}) {
  if (!exactObject(message, ['to', 'hids'])) return null;
  const normalizeList = (value, { max, pattern = null }) => {
    if (!Array.isArray(value) || !value.length || value.length > max) return null;
    const seen = new Set();
    for (const item of value) {
      if (boundedString(item, { min: 1, max: 128, pattern }) === null || seen.has(item)) return null;
      seen.add(item);
    }
    return [...value];
  };
  const to = message.to === 'all' ? 'all' : normalizeList(message.to, { max: maxAudience });
  const hids = message.hids === 'all' ? 'all' : normalizeList(message.hids, { max: maxCards, pattern: /^h\d+$/ });
  return to && hids ? { to, hids } : null;
}

export const databaseId = (value) => boundedString(value, { min: 1, max: 20, pattern: /^\d+$/ });
export const pieceIdPayload = (message) => oneField(message, 'id', (id) => boundedString(id, { min: 1, max: 20, pattern: /^\d+$/ }));
export const assetIdPayload = (message) => oneField(message, 'id', databaseId);

export function assetMutationPayload(message, { kinds, mode }) {
  const keys = mode === 'public' ? ['kind', 'id', 'isPublic']
    : mode === 'rename' ? ['kind', 'id', 'name'] : ['kind', 'id'];
  if (!exactObject(message, keys) || !kinds.includes(message.kind)) return null;
  const id = databaseId(message.id); if (id === null) return null;
  if (mode === 'public') return typeof message.isPublic === 'boolean' ? { kind: message.kind, id, isPublic: message.isPublic } : null;
  if (mode === 'rename') {
    const name = boundedString(message.name, { min: 1, max: 60 });
    return name === null || !name.trim() ? null : { kind: message.kind, id, name: name.trim() };
  }
  return { kind: message.kind, id };
}

export function namedIdPayload(message, { idKey = 'id', optionalId = false } = {}) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['name', idKey]))) return null;
  const name = boundedString(message.name, { min: 1, max: 60 });
  if (name === null || !name.trim()) return null;
  const rawId = message[idKey];
  if (rawId == null && optionalId) return { name: name.trim(), [idKey]: null };
  const id = databaseId(rawId);
  return id === null ? null : { name: name.trim(), [idKey]: id };
}

export function dispenserDragPayload(message) {
  if (!exactObject(message, ['id', 'x', 'y', 'z'])) return null;
  const id = boundedString(message.id, { min: 1, max: 20, pattern: /^\d+$/ });
  if (id === null || ![message.x, message.y, message.z].every(Number.isFinite)) return null;
  return { id, x: message.x, y: message.y, z: message.z };
}

export function cardPlacementPayload(message, { wholeHand = false } = {}) {
  const keys = wholeHand ? ['faceDown', 'x', 'z'] : ['hid', 'faceDown', 'x', 'z'];
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(keys)) || typeof message.faceDown !== 'boolean') return null;
  const out = { faceDown: message.faceDown };
  if (!wholeHand) { const hid = boundedString(message.hid, { min: 2, max: 20, pattern: /^h\d+$/ }); if (hid === null) return null; out.hid = hid; }
  const hasX = message.x !== undefined, hasZ = message.z !== undefined;
  if (hasX !== hasZ || (hasX && (!Number.isFinite(message.x) || !Number.isFinite(message.z)))) return null;
  if (hasX) { out.x = message.x; out.z = message.z; }
  return out;
}

export function deckAppendPayload(message, { max = 50, refOk }) {
  if (!exactObject(message, ['fronts']) || !Array.isArray(message.fronts) || !message.fronts.length || message.fronts.length > max) return null;
  return message.fronts.every(refOk) ? { fronts: message.fronts.slice() } : null;
}

export function groupIds(message, { max = 80 } = {}) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['ids']))) return null;
  return boundedUniqueIds(message.ids, { max });
}

export function groupRotation(message, { max = 80 } = {}) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['ids', 'dir', 'angle']))) return null;
  const ids = boundedUniqueIds(message.ids, { max });
  if (!ids) return null;
  if (message.angle !== undefined) {
    if (message.dir !== undefined) return null;
    const angle = finiteNumber(message.angle, { min: -Math.PI, max: Math.PI });
    return angle === null ? null : { ids, angle };
  }
  if (message.dir !== -1 && message.dir !== 1) return null;
  return { ids, dir: message.dir };
}

export function groupRecolor(message, { max = 80 } = {}) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['ids', 'color', 'textColor', 'team']))) return null;
  const ids = boundedUniqueIds(message.ids, { max });
  if (!ids) return null;
  if (message.team !== undefined) {
    if ((message.team !== 0 && message.team !== 1) || message.color !== undefined || message.textColor !== undefined) return null;
    return { ids, team: message.team };
  }
  const color = finiteNumber(message.color, { min: 0, max: 0xffffff });
  if (color === null || !Number.isInteger(color)) return null;
  const out = { ids, color };
  if (message.textColor !== undefined) {
    const textColor = finiteNumber(message.textColor, { min: 0, max: 0xffffff });
    if (textColor === null || !Number.isInteger(textColor)) return null;
    out.textColor = textColor;
  }
  return out;
}

export function recolorPayload(message) {
  if (!isPlainObject(message)) return null;
  const { id, ...colors } = message;
  const pieceId = boundedString(id, { min: 1, max: 20, pattern: /^\d+$/ });
  if (pieceId === null) return null;
  const parsed = groupRecolor({ ids: [pieceId], ...colors }, { max: 1 });
  if (!parsed) return null;
  const { ids: ignored, ...out } = parsed;
  return { id: pieceId, ...out };
}

// Invalid coordinates must never enter the physics engine.
export function finitePosition(message) {
  if (!isPlainObject(message)) return null;
  const { x, y, z } = message;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}
