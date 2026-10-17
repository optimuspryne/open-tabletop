// Public room setting IDs; render assets stay browser-owned. Keep the database
// constraint in step when adding a bundled environment.
export const DEFAULT_ROOM_ENVIRONMENT = 'standard';
export const ROOM_ENVIRONMENTS = Object.freeze([
  Object.freeze({ id: 'standard', name: 'Standard (skybox only)' }),
  Object.freeze({ id: 'cozy', name: 'Cozy game room' }),
  Object.freeze({ id: 'poker-night', name: 'Poker Night' }),
  Object.freeze({ id: 'medieval-tavern', name: 'Medieval Tavern' }),
  Object.freeze({ id: 'modern-bar', name: 'Modern Bar' }),
]);
export const isRoomEnvironment = (value) =>
  typeof value === 'string' && ROOM_ENVIRONMENTS.some(({ id }) => id === value);
export const normalizeRoomEnvironment = (value) =>
  isRoomEnvironment(value) ? value : DEFAULT_ROOM_ENVIRONMENT;
