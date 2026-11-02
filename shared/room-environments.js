// Public room setting IDs; render assets stay browser-owned. Keep the database
// constraint in step when adding a bundled environment.
export const DEFAULT_ROOM_ENVIRONMENT = 'standard';
export const ROOM_ENVIRONMENTS = Object.freeze([
  Object.freeze({ id: 'standard', name: 'Standard (skybox only)' }),
  Object.freeze({ id: 'cozy', name: 'Cozy game room' }),
  Object.freeze({ id: 'poker-night', name: 'Poker Night' }),
  Object.freeze({ id: 'medieval-tavern', name: 'Medieval Tavern' }),
  Object.freeze({ id: 'modern-bar', name: 'Modern Bar' }),
  Object.freeze({ id: '1920s-speakeasy', name: '1920s Speakeasy' }),
  Object.freeze({ id: 'ancient-temple', name: 'Ancient Temple' }),
  Object.freeze({ id: 'starship-lounge', name: 'Starship Lounge' }),
  Object.freeze({ id: 'victorian-study', name: 'Victorian Study' }),
  Object.freeze({ id: 'mountain-cabin', name: 'Mountain Cabin' }),
  Object.freeze({ id: 'pirate-captains-cabin', name: "Pirate Captain's Cabin" }),
  Object.freeze({ id: 'wizards-workshop', name: "Wizard's Workshop" }),
  Object.freeze({ id: 'cyberpunk-back-room', name: 'Cyberpunk Back Room' }),
  Object.freeze({ id: 'japanese-game-cafe', name: 'Japanese Game Café' }),
  Object.freeze({ id: 'garden-conservatory', name: 'Garden Conservatory' }),
  Object.freeze({ id: 'orbital-observation-deck', name: 'Orbital Observation Deck' }),
]);
export const isRoomEnvironment = (value) =>
  typeof value === 'string' && ROOM_ENVIRONMENTS.some(({ id }) => id === value);
export const normalizeRoomEnvironment = (value) =>
  isRoomEnvironment(value) ? value : DEFAULT_ROOM_ENVIRONMENT;
