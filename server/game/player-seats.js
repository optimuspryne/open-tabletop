import { ServerError } from '@colyseus/core';
import { Player } from './schema.js';
import { stopPlayerInteraction } from './interaction-cleanup.js';
import { SEAT_ANGLES } from '../../shared/pieces.js';

export const NO_SEAT = -1;
// Spectators consume connections, not playing seats. Keep total room fan-out bounded.
export const MAX_ROOM_CLIENTS = SEAT_ANGLES.length + 16;

export function freePlayerSeat(room, reserved = []) {
  const taken = new Set(reserved);
  room.state.players.forEach((player) => taken.add(player.seat));
  return SEAT_ANGLES.findIndex((_, seat) => !taken.has(seat));
}

export function turnPlayers(room) {
  return [...room.state.players]
    .filter(([, player]) => player.participation !== 'spectator' && player.seat >= 0)
    .sort((a, b) => a[1].order - b[1].order || a[1].seat - b[1].seat);
}

export function advancePlayerTurn(room) {
  room.pendingTurn = null;
  room.state.turnPending = '';
  const players = turnPlayers(room);
  const ids = players.map(([sid]) => sid);
  const current = room.state.players.get(room.state.turn);
  const index = ids.indexOf(room.state.turn);
  const afterSpectator =
    current &&
    players.find(
      ([, player]) =>
        player.order > current.order ||
        (player.order === current.order && player.seat > current.seat),
    );
  room.state.turn =
    index >= 0 ? ids[(index + 1) % ids.length] : afterSpectator?.[0] || ids[0] || '';
}

function nextPlayerOrder(room) {
  return Math.max(-1, ...[...room.state.players.values()].map((player) => player.order)) + 1;
}

// Shared by the actual join and transition paths; seats remain reserved while spectating.
export function createJoinedPlayer(room, client, { seatFor, palette }) {
  const auth = client.auth || {};
  const seat = auth.participation === 'spectator' ? NO_SEAT : seatFor(room, client.sessionId);
  if (seat < 0 && auth.participation !== 'spectator')
    throw new ServerError(
      403,
      'All playing seats are reserved. Choose Watch in the lobby to spectate.',
    );
  const player = new Player();
  Object.assign(player, {
    seat,
    order: seat >= 0 ? nextPlayerOrder(room) : -1,
    hand: 0,
    showing: 0,
    name: auth.username || (seat >= 0 ? 'Player ' + (seat + 1) : 'Spectator'),
    color: seat >= 0 ? palette[seat % palette.length] : '#9aa0a6',
    avatar: auth.avatar || '',
    role: auth.role || 'player',
    timedOut: auth.timedOut === true,
    participation: auth.participation || 'player',
  });
  room.state.players.set(client.sessionId, player);
  return player;
}

export function applyPlayerParticipation(room, client, { seatFor, palette }) {
  const player = room.state.players.get(client.sessionId);
  if (!player) return; // Watch authorization precedes player creation
  if (client.auth.participation === 'player' && player.seat < 0) {
    const seat = seatFor(room, client.sessionId);
    if (seat < 0) throw new Error('No playing seat available');
    player.seat = seat;
    player.order = nextPlayerOrder(room);
    player.color = palette[seat % palette.length];
  }
  if (client.auth.timedOut || client.auth.participation === 'spectator')
    stopPlayerInteraction(room, client.sessionId);
  if (client.auth.participation === 'spectator') {
    if (room.state.turn === client.sessionId || room.pendingTurn === String(client.auth.userId))
      advancePlayerTurn(room);
  } else if (!room.state.turn && !room.pendingTurn) advancePlayerTurn(room);
}
