// admin.js — site-wide room & user management. Admin-gated: the page only renders
// if /auth/token resolves to a user with isAdmin. Every action hits an admin-only
// endpoint, so the gate here is courtesy — the server enforces it.
const TOKEN_KEY = 'tabletop.token';
const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem(TOKEN_KEY) || '';

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: 'Bearer ' + token() };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

const btn = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
const cell = (content) => { const c = document.createElement('td'); if (typeof content === 'string') c.textContent = content; else c.appendChild(content); return c; };

let myId = null;

async function loadRooms() {
  const body = $('roomsBody'); body.replaceChildren();
  let rooms = [];
  try { ({ rooms } = await api('/admin/rooms')); } catch (e) { alert(e.message); return; }
  for (const r of rooms) {
    const tr = document.createElement('tr'); if (r.deletedAt) tr.className = 'deleted';
    tr.append(cell(r.name), cell(r.code), cell(r.ownerName || '\u2014'), cell(r.deletedAt ? 'deleted' : 'active'));
    const acts = document.createElement('div'); acts.className = 'acts';
    if (!r.deletedAt) {
      acts.append(
        btn('Rename', () => renameRoom(r)),
        btn(r.requireApproval ? 'Approval: on' : 'Approval: off', () => togglePolicy(r)),
        btn('Close', () => closeRoom(r)),
      );
    } else {
      acts.append(btn('Restore', () => restoreRoom(r)));
    }
    acts.append(btn('Purge', () => purgeRoom(r), 'danger'));
    tr.append(cell(acts));
    body.appendChild(tr);
  }
  if (!rooms.length) { const tr = document.createElement('tr'); tr.appendChild(cell('No rooms.')); body.appendChild(tr); }
}

async function loadUsers() {
  const body = $('usersBody'); body.replaceChildren();
  let users = [];
  try { ({ users } = await api('/admin/users')); } catch (e) { alert(e.message); return; }
  const pending = users.filter((u) => u.hostStatus === 'pending' && !u.isAdmin).length;
  $('pendingBadge').textContent = pending ? `\u2014 ${pending} host request${pending > 1 ? 's' : ''} pending` : '';
  for (const u of users) {
    const tr = document.createElement('tr');
    const tags = [];
    if (u.isAdmin) tags.push('admin');
    // admins host implicitly; only show host state for non-admins
    if (u.isAdmin) tags.push('host');
    else tags.push(u.hostStatus === 'approved' ? 'host' : u.hostStatus === 'pending' ? 'host pending' : 'player');
    tr.append(cell(u.username), cell(u.email), cell(tags.join(', ')));
    const acts = document.createElement('div'); acts.className = 'acts';
    if (String(u.id) === String(myId)) {
      const you = document.createElement('span'); you.className = 'muted'; you.textContent = '(you)'; acts.appendChild(you);
    } else {
      if (!u.isAdmin) { // host queue only applies to non-admins
        if (u.hostStatus === 'pending') {
          acts.append(btn('Approve', () => setHost(u, 'approved')), btn('Reject', () => setHost(u, 'none'), 'danger'));
        } else if (u.hostStatus === 'approved') {
          acts.append(btn('Revoke host', () => setHost(u, 'none'), 'danger'));
        }
      }
      if (u.isAdmin) acts.append(btn('Revoke admin', () => setAdmin(u, false), 'danger'));
      else acts.append(btn('Make admin', () => setAdmin(u, true)));
      acts.append(btn('Delete', () => deleteUser(u), 'danger'));
    }
    tr.append(cell(acts));
    body.appendChild(tr);
  }
}

async function setHost(u, status) {
  if (status === 'none' && !confirm(`${u.hostStatus === 'pending' ? 'Reject' : 'Revoke host access for'} ${u.username}?`)) return;
  try { await api('/admin/users/' + u.id + '/host', { method: 'POST', body: { status } }); loadUsers(); }
  catch (e) { alert(e.message); }
}

async function renameRoom(r) {
  const name = prompt('Rename room:', r.name);
  if (name == null || !name.trim()) return;
  try { await api('/rooms/' + r.id, { method: 'PATCH', body: { name: name.trim() } }); loadRooms(); } catch (e) { alert(e.message); }
}
async function togglePolicy(r) {
  try { await api('/rooms/' + r.id, { method: 'PATCH', body: { requireApproval: !r.requireApproval } }); loadRooms(); } catch (e) { alert(e.message); }
}
async function closeRoom(r) {
  if (!confirm(`Close "${r.name}"? Anyone at the table is sent to the lobby; it becomes unjoinable.`)) return;
  try { await api('/rooms/' + r.id, { method: 'DELETE' }); loadRooms(); } catch (e) { alert(e.message); }
}
async function restoreRoom(r) {
  try { await api('/admin/rooms/' + r.id + '/restore', { method: 'POST' }); loadRooms(); } catch (e) { alert(e.message); }
}
async function purgeRoom(r) {
  if (!confirm(`Permanently delete "${r.name}" and all its memberships? This cannot be undone.`)) return;
  try { await api('/admin/rooms/' + r.id, { method: 'DELETE' }); loadRooms(); } catch (e) { alert(e.message); }
}
async function setAdmin(u, makeAdmin) {
  if (!makeAdmin && !confirm(`Revoke admin from ${u.username}?`)) return;
  try { await api('/admin/users/' + u.id + '/admin', { method: 'POST', body: { isAdmin: makeAdmin } }); loadUsers(); } catch (e) { alert(e.message); }
}
async function deleteUser(u) {
  if (!confirm(`Permanently delete ${u.username}? This purges any rooms they own and removes them from all rooms. This cannot be undone.`)) return;
  try { await api('/admin/users/' + u.id, { method: 'DELETE' }); await loadUsers(); await loadRooms(); } catch (e) { alert(e.message); }
}

async function scanOrphans() {
  const out = $('cleanupResult'); out.textContent = 'Scanning…';
  try {
    const { count, totalBytes } = await api('/admin/orphans');
    if (!count) { out.textContent = 'No orphaned files found.'; return; }
    out.replaceChildren();
    const s = document.createElement('span');
    s.textContent = `${count} orphaned file(s), ${(totalBytes / 1048576).toFixed(1)} MB.  `;
    out.append(s, btn(`Move ${count} to trash`, () => purgeOrphans(count), 'danger'));
  } catch (e) { out.textContent = e.message; }
}
async function purgeOrphans(count) {
  if (!confirm(`Move ${count} orphaned file(s) to saved-assets/.trash/? They stay recoverable there until you delete the folder.`)) return;
  const out = $('cleanupResult'); out.textContent = 'Moving…';
  try {
    const { moved, totalBytes } = await api('/admin/orphans/purge', { method: 'POST' });
    out.textContent = `Moved ${moved} file(s) (${(totalBytes / 1048576).toFixed(1)} MB) to .trash.`;
  } catch (e) { out.textContent = e.message; }
}

(async function boot() {
  if (!token()) { $('denied').hidden = false; return; }
  let me;
  try { ({ user: me } = await api('/auth/token', { method: 'POST', body: { token: token() } })); }
  catch { $('denied').hidden = false; return; }
  if (!me.isAdmin) { $('denied').hidden = false; return; }
  myId = me.id;
  $('admin').hidden = false;
  $('scanOrphans').onclick = scanOrphans;
  await loadRooms();
  await loadUsers();
})();
