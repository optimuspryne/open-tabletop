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

// A hand reorder: { order: [hid, ...] } — hids are 'h<n>'. Must be non-empty, unique, and within a
// generous cap. The handler additionally checks it is a permutation of the player's actual hand.
export function reorderHandPayload(message) {
  if (!exactObject(message, ['order']) || !Array.isArray(message.order)) return null;
  const { order } = message;
  if (order.length < 1 || order.length > 300) return null;
  const seen = new Set();
  for (const hid of order) {
    const h = boundedString(hid, { min: 2, max: 12, pattern: /^h\d+$/ });
    if (h === null || seen.has(h)) return null;
    seen.add(h);
  }
  return { order: [...order] };
}

const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const exactObject = (value, keys) => isPlainObject(value) && hasOnlyKeys(value, new Set(keys));

export function oneField(message, key, normalize) {
  if (!exactObject(message, [key])) return null;
  const value = normalize(message[key]);
  return value === null ? null : { [key]: value };
}

export const hexColor = (value) =>
  boundedString(value, { min: 7, max: 7, pattern: /^#[0-9a-f]{6}$/i });

export function timerPayload(message) {
  if (!isPlainObject(message)) return null;
  if (['start', 'pause', 'reset'].includes(message.action))
    return exactObject(message, ['action']) ? { action: message.action } : null;
  if (message.action !== 'set' || !exactObject(message, ['action', 'mode', 'duration']))
    return null;
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
    unitLabel: (v) =>
      typeof v === 'string' && !/[\x00-\x1f]/.test(v) && v.trim().length > 0 && v.trim().length <= 8
        ? v.trim()
        : null,
    roundStep: (v) => finiteNumber(v, { min: 1e-3, max: 1e2 }),
    cellWorld: (v) => finiteNumber(v, { min: 0, max: 1e3 }),
    cellZ: (v) => finiteNumber(v, { min: 0, max: 1e3 }),
    gridX: (v) => finiteNumber(v, { min: -1e3, max: 1e3 }),
    gridZ: (v) => finiteNumber(v, { min: -1e3, max: 1e3 }),
    gridStyle: (v) => (['square', 'hex', 'off'].includes(v) ? v : null),
    gridHidden: (v) => (typeof v === 'boolean' ? v : null),
    gridColor: hexColor,
    gridLift: (v) => finiteNumber(v, { min: 0, max: gridLiftMax }),
    snapAnchor: (v) => (['center', 'cross'].includes(v) ? v : null),
  };
  const keys = Object.keys(message);
  if (!keys.length || keys.some((key) => !rules[key])) return null;
  const out = {};
  for (const key of keys) {
    const value = rules[key](message[key]);
    if (value === null) return null;
    out[key] = value;
  }
  return out;
}

export function overlayGeometry(
  message,
  { kinds, maxLen, allowEmpty = false, requireKind = false } = {},
) {
  if (!isPlainObject(message)) return null;
  if (allowEmpty && Object.keys(message).length === 0) return { kind: null };
  const allowed = ['kind', 'x', 'z', 'x2', 'z2', 'w', 'ang'];
  if (!hasOnlyKeys(message, new Set(allowed))) return null;
  if (requireKind && !kinds.has(message.kind)) return null;
  const out = requireKind ? { kind: message.kind } : {};
  for (const key of ['x', 'z', 'x2', 'z2']) {
    if (message[key] === undefined) {
      if (requireKind) return null;
      continue;
    }
    const value = finiteNumber(message[key], { min: -maxLen, max: maxLen });
    if (value === null) return null;
    out[key] = value;
  }
  if (message.w !== undefined) {
    const w = finiteNumber(message.w, { min: 0, max: maxLen });
    if (w === null) return null;
    out.w = w;
  }
  if (message.ang !== undefined) {
    const ang = finiteNumber(message.ang, { min: -Math.PI * 2, max: Math.PI * 2 });
    if (ang === null) return null;
    out.ang = ang;
  }
  return out;
}

export function overlayIdPayload(message) {
  return oneField(message, 'id', (id) => boundedString(id, { min: 2, max: 20, pattern: /^o\d+$/ }));
}

export function overlayMovePayload(message, options) {
  if (!isPlainObject(message)) return null;
  const id = boundedString(message.id, { min: 2, max: 20, pattern: /^o\d+$/ });
  if (id === null) return null;
  const { id: _ignored, ...geometry } = message;
  const parsed = overlayGeometry(geometry, options);
  return parsed && Object.keys(parsed).length ? { id, ...parsed } : null;
}

export function whiteboardStroke(message) {
  const keys =
    message?.erase === undefined ? ['pts', 'color', 'width'] : ['pts', 'color', 'width', 'erase'];
  if (!exactObject(message, keys)) return null;
  if (
    !Array.isArray(message.pts) ||
    message.pts.length < 2 ||
    message.pts.length > 2000 ||
    message.pts.length % 2
  )
    return null;
  if (!message.pts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const color = boundedString(message.color, { min: 1, max: 24 });
  const width = finiteNumber(message.width, { min: Number.MIN_VALUE, max: 0.2 });
  if (
    color === null ||
    width === null ||
    (message.erase !== undefined && typeof message.erase !== 'boolean')
  )
    return null;
  return {
    pts: message.pts.slice(),
    color,
    width,
    ...(message.erase === undefined ? {} : { erase: message.erase }),
  };
}

export function pointPayload(message) {
  if (!exactObject(message, ['x', 'z'])) return null;
  return Number.isFinite(message.x) && Number.isFinite(message.z)
    ? { x: message.x, z: message.z }
    : null;
}

export function gridCalibrationPayload(message) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['cells', 'anchor']))) return null;
  if (!Object.keys(message).length) return {};
  const cells = finiteNumber(message.cells, { min: 1, max: 200 });
  if (cells === null || !Number.isInteger(cells)) return null;
  if (message.anchor !== undefined && message.anchor !== 'center' && message.anchor !== 'cross')
    return null;
  return message.anchor === undefined ? { cells } : { cells, anchor: message.anchor };
}

export function showPayload(message, { maxAudience = 20, maxCards = 1000 } = {}) {
  if (!exactObject(message, ['to', 'hids'])) return null;
  const normalizeList = (value, { max, pattern = null }) => {
    if (!Array.isArray(value) || !value.length || value.length > max) return null;
    const seen = new Set();
    for (const item of value) {
      if (boundedString(item, { min: 1, max: 128, pattern }) === null || seen.has(item))
        return null;
      seen.add(item);
    }
    return [...value];
  };
  const to = message.to === 'all' ? 'all' : normalizeList(message.to, { max: maxAudience });
  const hids =
    message.hids === 'all'
      ? 'all'
      : normalizeList(message.hids, { max: maxCards, pattern: /^h\d+$/ });
  return to && hids ? { to, hids } : null;
}

export const databaseId = (value) => boundedString(value, { min: 1, max: 20, pattern: /^\d+$/ });
export const pieceIdPayload = (message) =>
  oneField(message, 'id', (id) => boundedString(id, { min: 1, max: 20, pattern: /^\d+$/ }));
export const assetIdPayload = (message) => oneField(message, 'id', databaseId);

export function assetMutationPayload(message, { kinds, mode }) {
  const keys =
    mode === 'public'
      ? ['kind', 'id', 'isPublic']
      : mode === 'rename'
        ? ['kind', 'id', 'name']
        : ['kind', 'id'];
  if (!exactObject(message, keys) || !kinds.includes(message.kind)) return null;
  const id = databaseId(message.id);
  if (id === null) return null;
  if (mode === 'public')
    return typeof message.isPublic === 'boolean'
      ? { kind: message.kind, id, isPublic: message.isPublic }
      : null;
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
  if (
    !isPlainObject(message) ||
    !hasOnlyKeys(message, new Set(keys)) ||
    typeof message.faceDown !== 'boolean'
  )
    return null;
  const out = { faceDown: message.faceDown };
  if (!wholeHand) {
    const hid = boundedString(message.hid, { min: 2, max: 20, pattern: /^h\d+$/ });
    if (hid === null) return null;
    out.hid = hid;
  }
  const hasX = message.x !== undefined,
    hasZ = message.z !== undefined;
  if (hasX !== hasZ || (hasX && (!Number.isFinite(message.x) || !Number.isFinite(message.z))))
    return null;
  if (hasX) {
    out.x = message.x;
    out.z = message.z;
  }
  return out;
}

export function deckAppendPayload(message, { max = 50, maxBytes = 1024 * 1024, refOk }) {
  if (
    !exactObject(message, ['fronts']) ||
    !Array.isArray(message.fronts) ||
    !message.fronts.length ||
    message.fronts.length > max
  )
    return null;
  return message.fronts.every(refOk) &&
    message.fronts.reduce((total, ref) => total + ref.length, 0) <= maxBytes
    ? { fronts: message.fronts.slice() }
    : null;
}

const finiteTuple = (value, { length = 3, min = -Infinity, max = Infinity } = {}) => {
  if (!Array.isArray(value) || value.length !== length) return null;
  const out = value.map((item) => finiteNumber(item, { min, max }));
  return out.includes(null) ? null : out;
};

const localAssetRef = (value, { extension = null } = {}) => {
  if (
    boundedString(value, { min: 1, max: 300 }) === null ||
    value.includes('..') ||
    !value.startsWith('/assets/')
  )
    return null;
  return extension && !value.toLowerCase().endsWith(extension) ? null : value;
};

export function boardRecordPayload(value, { boardKeys = [] } = {}) {
  if (!isPlainObject(value)) return null;
  if (value.board !== undefined) {
    return exactObject(value, ['board']) && boardKeys.includes(value.board)
      ? { board: value.board }
      : null;
  }
  if (value.model !== undefined) {
    if (!exactObject(value, ['model', 'modelScale', 'box'])) return null;
    const model = localAssetRef(value.model, { extension: '.glb' });
    const modelScale = finiteNumber(value.modelScale, { min: 1e-3, max: 1e3 });
    const box = finiteTuple(value.box, { min: 1e-3, max: 100 });
    return model && modelScale !== null && box ? { model, modelScale, box } : null;
  }
  if (
    !hasOnlyKeys(value, new Set(['w', 'd', 'tex'])) ||
    !Object.hasOwn(value, 'w') ||
    !Object.hasOwn(value, 'd')
  )
    return null;
  const w = finiteNumber(value.w, { min: 0.1, max: 100 });
  const d = finiteNumber(value.d, { min: 0.1, max: 100 });
  if (w === null || d === null) return null;
  const out = { w, d };
  if (value.tex !== undefined && value.tex !== null) {
    const tex = localAssetRef(value.tex);
    if (!tex) return null;
    out.tex = tex;
  }
  return out;
}

export function propRecordPayload(value, { colliders = [], allowSpawnOptions = false } = {}) {
  if (!isPlainObject(value)) return null;
  const allowed = ['model', 'box', 'stand', 'scale', 'modelRot', 'collider', 'color'];
  if (allowSpawnOptions) allowed.push('snap');
  if (!hasOnlyKeys(value, new Set(allowed))) return null;
  const model = localAssetRef(value.model, { extension: '.glb' });
  const box = finiteTuple(value.box, { min: 1e-3, max: 100 });
  const scale = finiteNumber(value.scale, { min: 1e-3, max: 100 });
  if (!model || !box || scale === null || typeof value.stand !== 'boolean') return null;
  const out = { model, box, stand: value.stand, scale };
  if (value.modelRot !== undefined) {
    const rot = finiteTuple(value.modelRot, { min: -Math.PI * 2, max: Math.PI * 2 });
    if (!rot) return null;
    out.modelRot = rot;
  }
  if (value.collider !== undefined) {
    if (!colliders.includes(value.collider)) return null;
    out.collider = value.collider;
  }
  if (value.color !== undefined) {
    const color = finiteNumber(value.color, { min: 0, max: 0xffffff });
    if (color === null || !Number.isInteger(color)) return null;
    out.color = color;
  }
  if (allowSpawnOptions && value.snap !== undefined) {
    if (typeof value.snap !== 'boolean') return null;
    out.snap = value.snap;
  }
  return out;
}

export function saveBoardPayload(message, options) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['name', 'board', 'editId'])))
    return null;
  const name = boundedString(message.name, { min: 1, max: 60 });
  const board = boardRecordPayload(message.board, options);
  if (name === null || !name.trim() || !board) return null;
  const out = { name: name.trim(), board, editId: null };
  if (message.editId != null) {
    const id = databaseId(message.editId);
    if (id === null) return null;
    out.editId = id;
  }
  return out;
}

export function savePropPayload(message, options) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['name', 'props', 'editId'])))
    return null;
  const name = boundedString(message.name, { min: 1, max: 60 });
  const props = propRecordPayload(message.props, options);
  if (name === null || !name.trim() || !props) return null;
  const out = { name: name.trim(), props, editId: null };
  if (message.editId != null) {
    const id = databaseId(message.editId);
    if (id === null) return null;
    out.editId = id;
  }
  return out;
}

export function deckBeginPayload(message, { refOk, sanitizeGeom }) {
  if (
    !isPlainObject(message) ||
    !hasOnlyKeys(message, new Set(['back', 'geom'])) ||
    !refOk(message.back)
  )
    return null;
  const out = { back: message.back, geom: null };
  if (message.geom !== undefined && message.geom !== null) {
    const geom = sanitizeGeom(message.geom);
    if (!geom) return null;
    out.geom = geom;
  }
  return out;
}

export function deckFinishPayload(message) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['name', 'spawn', 'editId'])))
    return null;
  const out = { name: null, spawn: true, editId: null };
  if (message.name !== undefined && message.name !== null && message.name !== '') {
    const name = boundedString(message.name, { min: 1, max: 60 });
    if (name === null || !name.trim()) return null;
    out.name = name.trim();
  }
  if (message.spawn !== undefined) {
    if (typeof message.spawn !== 'boolean') return null;
    out.spawn = message.spawn;
  }
  if (message.editId != null) {
    const id = databaseId(message.editId);
    if (id === null || !out.name) return null;
    out.editId = id;
  }
  return out;
}

export function spawnPayload(
  message,
  { boardKeys = [], propKeys = [], dispenserKeys = [], colliders = [] } = {},
) {
  if (!exactObject(message, ['type', 'props']) || !isPlainObject(message.props)) return null;
  const { type, props } = message;
  if (type === 'die') {
    if (!hasOnlyKeys(props, new Set(['sides', 'color', 'textColor', 'tray', 'snap', 'finish'])))
      return null;
    const sides = finiteNumber(props.sides, { min: 4, max: 20 });
    if (sides === null || ![4, 6, 8, 10, 12, 20].includes(sides)) return null;
    const out = { sides };
    for (const key of ['color', 'textColor'])
      if (props[key] !== undefined) {
        const color = finiteNumber(props[key], { min: 0, max: 0xffffff });
        if (color === null || !Number.isInteger(color)) return null;
        out[key] = color;
      }
    for (const key of ['tray', 'snap'])
      if (props[key] !== undefined) {
        if (typeof props[key] !== 'boolean') return null;
        out[key] = props[key];
      }
    if (props.finish !== undefined) {
      // shape only; the renderer maps unknown keys to matte and colorProps is the enum gate
      const finish = boundedString(props.finish, { min: 1, max: 16, pattern: /^[a-z]+$/ });
      if (finish === null) return null;
      out.finish = finish;
    }
    return { type, props: out };
  }
  if (type === 'deck') {
    if (!hasOnlyKeys(props, new Set(['jokers', 'set', 'snap']))) return null;
    const out = {};
    if (props.jokers !== undefined) {
      if (typeof props.jokers !== 'boolean') return null;
      out.jokers = props.jokers;
    }
    if (props.set !== undefined) {
      if (!['domino', 'letter', 'mahjong'].includes(props.set)) return null;
      out.set = props.set;
    }
    if (props.snap !== undefined) {
      if (typeof props.snap !== 'boolean') return null;
      out.snap = props.snap;
    }
    return { type, props: out };
  }
  if (type === 'board') {
    const board = boardRecordPayload(props, { boardKeys });
    return board ? { type, props: board } : null;
  }
  if (type === 'prop') {
    if (props.model !== undefined) {
      const prop = propRecordPayload(props, { colliders, allowSpawnOptions: true });
      return prop ? { type, props: prop } : null;
    }
    if (
      !hasOnlyKeys(props, new Set(['shape', 'color', 'team', 'snap', 'stand'])) ||
      !propKeys.includes(props.shape)
    )
      return null;
    const out = { shape: props.shape };
    if (props.color !== undefined) {
      const color = finiteNumber(props.color, { min: 0, max: 0xffffff });
      if (color === null || !Number.isInteger(color)) return null;
      out.color = color;
    }
    if (props.team !== undefined) {
      if (props.team !== 0 && props.team !== 1) return null;
      out.team = props.team;
    }
    if (props.snap !== undefined) {
      if (typeof props.snap !== 'boolean') return null;
      out.snap = props.snap;
    }
    if (props.stand !== undefined) {
      if (props.stand !== false && props.stand !== true && props.stand !== 'flat') return null;
      out.stand = props.stand;
    }
    return { type, props: out };
  }
  if (type === 'dispenser') {
    if (
      !hasOnlyKeys(props, new Set(['disp', 'color', 'team', 'count', 'snap'])) ||
      !dispenserKeys.includes(props.disp)
    )
      return null;
    const out = { disp: props.disp };
    if (props.color !== undefined) {
      const color = finiteNumber(props.color, { min: 0, max: 0xffffff });
      if (color === null || !Number.isInteger(color)) return null;
      out.color = color;
    }
    if (props.team !== undefined) {
      if (props.team !== 0 && props.team !== 1) return null;
      out.team = props.team;
    }
    if (props.count !== undefined) {
      const count = finiteNumber(props.count, { min: 1, max: 1000 });
      if (count === null || !Number.isInteger(count)) return null;
      out.count = count;
    }
    if (props.snap !== undefined) {
      if (typeof props.snap !== 'boolean') return null;
      out.snap = props.snap;
    }
    return { type, props: out };
  }
  return null;
}

export function memberUserPayload(message) {
  return oneField(message, 'userId', databaseId);
}

export function memberRolePayload(message) {
  if (!exactObject(message, ['userId', 'role'])) return null;
  const userId = databaseId(message.userId);
  return userId && ['helper', 'player', 'gm'].includes(message.role)
    ? { userId, role: message.role }
    : null;
}

export function handReassignmentPayload(message) {
  if (!exactObject(message, ['userId', 'toSessionId'])) return null;
  const userId = databaseId(message.userId);
  const toSessionId = boundedString(message.toSessionId, { min: 1, max: 128 });
  return userId && toSessionId ? { userId, toSessionId } : null;
}

export function deckIdPayload(message) {
  return oneField(message, 'deckId', (id) =>
    boundedString(id, { min: 1, max: 20, pattern: /^\d+$/ }),
  );
}

export function deckDragPayload(message) {
  if (!exactObject(message, ['deckId', 'x', 'y', 'z'])) return null;
  const deckId = boundedString(message.deckId, { min: 1, max: 20, pattern: /^\d+$/ });
  if (!deckId || ![message.x, message.y, message.z].every(Number.isFinite)) return null;
  return { deckId, x: message.x, y: message.y, z: message.z };
}

export function inspectPlacementPayload(message) {
  return oneField(message, 'where', (where) =>
    ['deck', 'hand', 'field-up', 'field-down'].includes(where) ? where : null,
  );
}

export function saveSkyboxPayload(message, { urlOk }) {
  if (!isPlainObject(message)) return null;
  const name = boundedString(message.name, { min: 1, max: 60 });
  if (name === null || !name.trim() || typeof message.isPublic !== 'boolean') return null;
  if (message.type === 'cube') {
    if (
      !exactObject(message, ['name', 'type', 'faces', 'isPublic']) ||
      !Array.isArray(message.faces) ||
      message.faces.length !== 6
    )
      return null;
    if (
      !message.faces.every(
        (url) => typeof url === 'string' && url.startsWith('/assets/sky/') && urlOk(url),
      )
    )
      return null;
    return {
      name: name.trim(),
      type: 'cube',
      faces: message.faces.slice(),
      isPublic: message.isPublic,
    };
  }
  if (
    !exactObject(message, ['name', 'url', 'isPublic']) ||
    typeof message.url !== 'string' ||
    !message.url.startsWith('/assets/sky/') ||
    !urlOk(message.url)
  )
    return null;
  return { name: name.trim(), type: 'equirect', url: message.url, isPublic: message.isPublic };
}

export function pieceMovePayload(message) {
  if (!exactObject(message, ['id', 'x', 'y', 'z'])) return null;
  const id = boundedString(message.id, { min: 1, max: 20, pattern: /^\d+$/ });
  return id && [message.x, message.y, message.z].every(Number.isFinite)
    ? { id, x: message.x, y: message.y, z: message.z }
    : null;
}

const velocity = (value) => finiteTuple(value, { min: -1e4, max: 1e4 });

export function pieceReleasePayload(message) {
  if (!exactObject(message, ['id', 'v'])) return null;
  const id = boundedString(message.id, { min: 1, max: 20, pattern: /^\d+$/ });
  const v = velocity(message.v);
  return id && v ? { id, v } : null;
}

export function groupGrabPayload(message, { max = 80 } = {}) {
  if (!exactObject(message, ['ids', 'anchor'])) return null;
  const ids = boundedUniqueIds(message.ids, { max });
  const anchor = boundedString(message.anchor, { min: 1, max: 20, pattern: /^\d+$/ });
  return ids && anchor && ids.includes(anchor) ? { ids, anchor } : null;
}

export function groupReleasePayload(message) {
  const parsed = oneField(message, 'v', velocity);
  return parsed && parsed.v ? parsed : null;
}

export function groupMovePayload(message) {
  if (
    !exactObject(message, ['x', 'y', 'z']) ||
    ![message.x, message.y, message.z].every(Number.isFinite)
  )
    return null;
  return { x: message.x, y: message.y, z: message.z };
}

export function groupIds(message, { max = 80 } = {}) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['ids']))) return null;
  return boundedUniqueIds(message.ids, { max });
}

export function groupRotation(message, { max = 80 } = {}) {
  if (!isPlainObject(message) || !hasOnlyKeys(message, new Set(['ids', 'dir', 'angle'])))
    return null;
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
  if (
    !isPlainObject(message) ||
    !hasOnlyKeys(message, new Set(['ids', 'color', 'textColor', 'team', 'finish']))
  )
    return null;
  const ids = boundedUniqueIds(message.ids, { max });
  if (!ids) return null;
  if (message.team !== undefined) {
    if (
      (message.team !== 0 && message.team !== 1) ||
      message.color !== undefined ||
      message.textColor !== undefined ||
      message.finish !== undefined
    )
      return null;
    return { ids, team: message.team };
  }
  const out = { ids };
  if (message.color !== undefined) {
    const color = finiteNumber(message.color, { min: 0, max: 0xffffff });
    if (color === null || !Number.isInteger(color)) return null;
    out.color = color;
  }
  if (message.textColor !== undefined) {
    const textColor = finiteNumber(message.textColor, { min: 0, max: 0xffffff });
    if (textColor === null || !Number.isInteger(textColor)) return null;
    out.textColor = textColor;
  }
  if (message.finish !== undefined) {
    // A die finish key. colorProps() is the real gate (rejects unknown keys, dice-only); here we
    // only bound the shape: a short lowercase token.
    const finish = boundedString(message.finish, { min: 1, max: 16, pattern: /^[a-z]+$/ });
    if (finish === null) return null;
    out.finish = finish;
  }
  if (out.color === undefined && out.textColor === undefined && out.finish === undefined)
    return null;
  return out;
}

export function recolorPayload(message) {
  if (!isPlainObject(message)) return null;
  const { id, ...colors } = message;
  const pieceId = boundedString(id, { min: 1, max: 20, pattern: /^\d+$/ });
  if (pieceId === null) return null;
  const parsed = groupRecolor({ ids: [pieceId], ...colors }, { max: 1 });
  if (!parsed) return null;
  const { ids: _ignored, ...out } = parsed;
  return { id: pieceId, ...out };
}

// Invalid coordinates must never enter the physics engine.
export function finitePosition(message) {
  if (!isPlainObject(message)) return null;
  const { x, y, z } = message;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}
