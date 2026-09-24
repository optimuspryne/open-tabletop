// Pure room-role rules. Keeping these independent from Colyseus makes the
// authorization matrix testable without starting a room or connecting to Postgres.
export const RANK = Object.freeze({ player: 0, helper: 1, gm: 2, owner: 3 });

// Participation is independent of rank. Missing fields preserve current admitted
// player/editor sessions; the durable policy loader must set participationReady
// false while loading (including failures), then install authoritative values.
export function canUseRoomCapability(auth = {}, capability) {
  if (auth.revoked || auth.participationReady === false) return false;
  switch (capability) {
    case 'gameplay':
      return (
        (auth.participation === undefined || auth.participation === 'player') &&
        (auth.timedOut === undefined || auth.timedOut === false)
      );
    case 'observation':
    case 'communication':
    case 'administration':
    case 'personal':
    case 'cleanup':
      return true;
    default:
      return false;
  }
}

export function rankOf(role) {
  return RANK[role] ?? RANK.player;
}

// GMs manage helpers/players; only an owner manages GMs; nobody manages an owner.
export function canManageMember(actorRank, targetRole) {
  if (targetRole === 'owner') return false;
  if (targetRole === 'gm') return actorRank >= RANK.owner;
  return actorRank >= RANK.gm;
}

// Co-GM promotion/demotion is owner-only; ownership is never assigned here.
export function canSetMemberRole(actorRank, currentRole, newRole) {
  if (newRole === 'owner' || currentRole === 'owner') return false;
  if (newRole === 'gm' || currentRole === 'gm') return actorRank >= RANK.owner;
  return actorRank >= RANK.gm;
}
