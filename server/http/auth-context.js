export function createRequireUser({ db, hashToken }) {
  return async function requireUser(req, res) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = token ? await db.findUserByToken(hashToken(token)) : null;
    if (!user) {
      res.status(401).json({ error: 'not signed in' });
      return null;
    }
    return user;
  };
}

export function createRequireAdmin(requireUser) {
  return async function requireAdmin(req, res) {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (!user.isAdmin) {
      res.status(403).json({ error: 'admin only' });
      return null;
    }
    return user;
  };
}

export const clientUser = (user) => user && ({
  id: user.id,
  username: user.username,
  email: user.email,
  avatar: user.avatar,
  isAdmin: user.isAdmin,
  canOwnRooms: user.canOwnRooms,
  hostStatus: user.hostStatus,
  hasPassword: user.hasPassword,
});
