// Synced piece props are stored as JSON strings by Colyseus. Treat them as an
// untrusted persistence/network boundary: malformed or non-object JSON becomes an
// empty object instead of taking down a handler or the simulation tick.
export function readProps(piece) {
  if (!piece || typeof piece.props !== 'string' || !piece.props) return {};
  try {
    const value = JSON.parse(piece.props);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function writeProps(piece, props) {
  if (!piece) return;
  piece.props = JSON.stringify(
    props && typeof props === 'object' && !Array.isArray(props) ? props : {},
  );
}
