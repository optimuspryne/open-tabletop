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

// Demo creation offers the four furnished rooms; ordinary rooms retain Standard.
export const DEFAULT_DEMO_ROOM_ENVIRONMENT = 'cozy';
export const DEMO_ROOM_ENVIRONMENTS = Object.freeze(
  ROOM_ENVIRONMENTS.filter(({ id }) => id !== DEFAULT_ROOM_ENVIRONMENT).map(({ id, name }) =>
    Object.freeze({ id, name: id === 'cozy' ? 'Cozy' : name }),
  ),
);
export const isDemoRoomEnvironment = (value) =>
  typeof value === 'string' && DEMO_ROOM_ENVIRONMENTS.some(({ id }) => id === value);
