// Pure room-role rules. Keeping these independent from Colyseus makes the
// authorization matrix testable without starting a room or connecting to Postgres.
export const RANK = Object.freeze({ player: 0, helper: 1, gm: 2, owner: 3 });

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
