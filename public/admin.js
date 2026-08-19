// admin.js — site-wide room & user management. Admin-gated: the page only renders
// if /auth/token resolves to a user with isAdmin. Every action hits an admin-only
// endpoint, so the gate here is courtesy — the server enforces it.
const TOKEN_KEY = 'tabletop.token';
const MB = 1024 * 1024;                 // bytes → MB divisor for the cleanup readout
const byId = (id) => document.getElementById(id);
const token = () => localStorage.getItem(TOKEN_KEY) || '';

// Authenticated fetch wrapper: attaches the Bearer token, JSON-encodes a body,
// and THROWS on any non-2xx — so callers just try/catch and alert the message.
async function api(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: 'Bearer ' + token() };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// Small DOM factories: a <button> from label + click handler (+ optional class),
// and a <td> wrapping either a string or an existing node.
const btn = (label, fn, cls) => { const button = document.createElement('button'); button.textContent = label; if (cls) button.className = cls; button.onclick = fn; return button; };
const cell = (content) => { const td = document.createElement('td'); if (typeof content === 'string') td.textContent = content; else td.appendChild(content); return td; };

// The signed-in admin's own id — used to mark their "(you)" row and to withhold
// action buttons on their own account (no self-delete / self-demote).
let myId = null;

async function loadRooms() {
  const tbody = byId('roomsBody'); tbody.replaceChildren();
  let rooms = [];
  try { ({ rooms } = await api('/admin/rooms')); } catch (e) { alert(e.message); return; }
  for (const room of rooms) {
    const tr = document.createElement('tr'); if (room.deletedAt) tr.className = 'deleted';
    tr.append(cell(room.name), cell(room.code), cell(room.ownerName || '\u2014'), cell(room.deletedAt ? 'deleted' : 'active'));
    const acts = document.createElement('div'); acts.className = 'actions';
    if (!room.deletedAt) {
      acts.append(
        btn('Rename', () => renameRoom(room)),
        btn(room.requireApproval ? 'Approval: on' : 'Approval: off', () => togglePolicy(room)),
        btn('Close', () => closeRoom(room)),
      );
    } else {
      acts.append(btn('Restore', () => restoreRoom(room)));
    }
    acts.append(btn('Purge', () => purgeRoom(room), 'danger'));
    tr.append(cell(acts));
    tbody.appendChild(tr);
  }
  if (!rooms.length) { const tr = document.createElement('tr'); tr.appendChild(cell('No rooms.')); tbody.appendChild(tr); }
}

async function loadUsers() {
  const tbody = byId('usersBody'); tbody.replaceChildren();
  let users = [];
  try { ({ users } = await api('/admin/users')); } catch (e) { alert(e.message); return; }
  const pending = users.filter((user) => user.hostStatus === 'pending' && !user.isAdmin).length;
  byId('pendingBadge').textContent = pending ? `\u2014 ${pending} host request${pending > 1 ? 's' : ''} pending` : '';
  for (const user of users) {
    const tr = document.createElement('tr');
    // Per-user tag set: admin / host / host pending / player. Admins host
    // implicitly, so they always get both 'admin' and 'host' and skip the queue.
    const tags = [];
    if (user.isAdmin) tags.push('admin', 'host');
    else tags.push(user.hostStatus === 'approved' ? 'host' : user.hostStatus === 'pending' ? 'host pending' : 'player');
    tr.append(cell(user.username), cell(user.email), cell(tags.join(', ')));
    const acts = document.createElement('div'); acts.className = 'actions';
    if (String(user.id) === String(myId)) {
      // Your own row: no action buttons — you can't demote or delete yourself.
      const you = document.createElement('span'); you.className = 'muted'; you.textContent = '(you)'; acts.appendChild(you);
    } else {
      if (!user.isAdmin) { // host queue only applies to non-admins
        if (user.hostStatus === 'pending') {
          acts.append(btn('Approve', () => setHost(user, 'approved')), btn('Reject', () => setHost(user, 'none'), 'danger'));
        } else if (user.hostStatus === 'approved') {
          acts.append(btn('Revoke host', () => setHost(user, 'none'), 'danger'));
        }
      }
      if (user.isAdmin) acts.append(btn('Revoke admin', () => setAdmin(user, false), 'danger'));
      else acts.append(btn('Make admin', () => setAdmin(user, true)));
      acts.append(btn('Kick', () => kickUser(user)), btn('Delete', () => deleteUser(user), 'danger'));
    }
    tr.append(cell(acts));
    tbody.appendChild(tr);
  }
}

async function setHost(user, status) {
  if (status === 'none' && !confirm(`${user.hostStatus === 'pending' ? 'Reject' : 'Revoke host access for'} ${user.username}?`)) return;
  try { await api('/admin/users/' + user.id + '/host', { method: 'POST', body: { status } }); loadUsers(); }
  catch (e) { alert(e.message); }
}

async function renameRoom(room) {
  const name = prompt('Rename room:', room.name);
  if (name == null || !name.trim()) return;
  try { await api('/rooms/' + room.id, { method: 'PATCH', body: { name: name.trim() } }); loadRooms(); } catch (e) { alert(e.message); }
}
async function togglePolicy(room) {
  try { await api('/rooms/' + room.id, { method: 'PATCH', body: { requireApproval: !room.requireApproval } }); loadRooms(); } catch (e) { alert(e.message); }
}
async function closeRoom(room) {
  if (!confirm(`Close "${room.name}"? Anyone at the table is sent to the lobby; it becomes unjoinable.`)) return;
  try { await api('/rooms/' + room.id, { method: 'DELETE' }); loadRooms(); } catch (e) { alert(e.message); }
}
async function restoreRoom(room) {
  try { await api('/admin/rooms/' + room.id + '/restore', { method: 'POST' }); loadRooms(); } catch (e) { alert(e.message); }
}
async function purgeRoom(room) {
  if (!confirm(`Permanently delete "${room.name}" and all its memberships? This cannot be undone.`)) return;
  try { await api('/admin/rooms/' + room.id, { method: 'DELETE' }); loadRooms(); } catch (e) { alert(e.message); }
}
async function setAdmin(user, makeAdmin) {
  if (!makeAdmin && !confirm(`Revoke admin from ${user.username}?`)) return;
  try { await api('/admin/users/' + user.id + '/admin', { method: 'POST', body: { isAdmin: makeAdmin } }); loadUsers(); } catch (e) { alert(e.message); }
}
async function kickUser(user) {
  try {
    const { rooms } = await api('/admin/users/' + user.id + '/kick', { method: 'POST' });
    alert(rooms ? `Dropped ${user.username} from ${rooms} live table${rooms > 1 ? 's' : ''}.` : `${user.username} isn't in any live table.`);
  } catch (e) { alert(e.message); }
}
async function deleteUser(user) {
  if (!confirm(`Permanently delete ${user.username}? This purges any rooms they own and removes them from all rooms. This cannot be undone.`)) return;
  try { await api('/admin/users/' + user.id, { method: 'DELETE' }); await loadUsers(); await loadRooms(); } catch (e) { alert(e.message); }
}

async function scanOrphans() {
  const resultEl = byId('cleanupResult'); resultEl.textContent = 'Scanning…';
  try {
    const { count, totalBytes } = await api('/admin/orphans');
    if (!count) { resultEl.textContent = 'No orphaned files found.'; return; }
    resultEl.replaceChildren();
    const label = document.createElement('span');
    label.textContent = `${count} orphaned file(s), ${(totalBytes / MB).toFixed(1)} MB.  `;
    resultEl.append(label, btn(`Move ${count} to trash`, () => purgeOrphans(count), 'danger'));
  } catch (e) { resultEl.textContent = e.message; }
}
async function purgeOrphans(count) {
  if (!confirm(`Move ${count} orphaned file(s) to saved-assets/.trash/? They stay recoverable there until you delete the folder.`)) return;
  const resultEl = byId('cleanupResult'); resultEl.textContent = 'Moving…';
  try {
    const { moved, totalBytes } = await api('/admin/orphans/purge', { method: 'POST' });
    resultEl.textContent = `Moved ${moved} file(s) (${(totalBytes / MB).toFixed(1)} MB) to .trash.`;
  } catch (e) { resultEl.textContent = e.message; }
}

// Gate the page: require a token → resolve it → require isAdmin, else show the
// "denied" panel. On success, wire the cleanup button and load the two tables.
(async function boot() {
  if (!token()) { byId('denied').hidden = false; return; }
  let me;
  try { ({ user: me } = await api('/auth/token', { method: 'POST', body: { token: token() } })); }
  catch { byId('denied').hidden = false; return; }
  if (!me.isAdmin) { byId('denied').hidden = false; return; }
  myId = me.id;
  byId('admin').hidden = false;
  byId('scanOrphans').onclick = scanOrphans;
  await loadRooms();
  await loadUsers();
})();
