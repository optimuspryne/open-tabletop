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

// Invalid coordinates must never enter the physics engine.
export function finitePosition(message) {
  if (!isPlainObject(message)) return null;
  const { x, y, z } = message;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}
