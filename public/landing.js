// landing.js — quick-join (default) + login/account + lobby. Talks to the /auth
// and /rooms HTTP endpoints; stores the device token in localStorage for
// auto-login. No game engine here — entering a room hands off to table.html.
const TOKEN_KEY = 'tabletop.token';
const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem(TOKEN_KEY) || '';
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers['Authorization'] = 'Bearer ' + token();
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch { /* no/invalid body */ }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

const enterRoom = (code) => { location.href = 'table.html?room=' + encodeURIComponent(code); };

// ---- views: quick | auth | home ----
function setView(view) {
  $('quickJoinView').hidden = view !== 'quick';
  $('authView').hidden = view !== 'auth';
  $('homeView').hidden = view !== 'home';
  $('accountBtn').hidden = view !== 'quick'; // the top-right "Log in" only shows on the quick-join screen
}
const showQuickJoin = () => setView('quick');
function showAuth() { setView('auth'); $('loginForm').hidden = false; $('signupForm').hidden = true; }

let me = null;
async function showHome(user) {
  me = user;
  setView('home');
  $('who').textContent = user.username;
  const ok = typeof user.avatar === 'string' && /^(\/assets\/|data:image\/|https?:\/\/)/.test(user.avatar);
  $('avatar').style.backgroundImage = ok ? `url("${user.avatar}")` : 'none';

  // Hosting: approved (or admin) → the create form; pending → a waiting note; else
  // → a "request host access" button.
  const canHost = user.canOwnRooms;
  $('gmTools').hidden = !canHost;
  $('hostReq').hidden = canHost;
  if (!canHost) {
    const pending = user.hostStatus === 'pending';
    $('hostNote').textContent = pending
      ? 'Your host access is pending admin approval.'
      : 'Want to host your own games? Request access — an admin will review it.';
    $('requestHostBtn').hidden = pending;
  }

  $('adminLink').hidden = !user.isAdmin;
  if (user.isAdmin) updateAdminBadge();
  await refreshRooms();
}

async function updateAdminBadge() {
  try {
    const { pending } = await api('/admin/pending-count', { auth: true });
    $('adminLink').textContent = pending > 0 ? `Admin (${pending})` : 'Admin';
  } catch { /* leave as-is */ }
}

async function onRequestHost() {
  let password;
  if (!me.hasPassword) {
    password = prompt('Hosting needs a password. Set one (8+ characters):');
    if (!password) return;
  }
  try {
    const { user } = await api('/host/request', { method: 'POST', auth: true, body: password ? { password } : {} });
    await showHome(user);
  } catch (e) { $('hostNote').textContent = e.message; }
}

// ---- rooms + live approval ----
let lastStatus = {};   // code -> status from the previous fetch (to spot pending -> admitted)
let pollTimer = null;
const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

async function refreshRooms() {
  let rooms = [];
  try { ({ rooms } = await api('/rooms', { auth: true })); } catch { return; }

  for (const code in lastStatus) { // spot pending -> admitted (approved) or pending -> gone (declined/closed)
    if (lastStatus[code] !== 'pending') continue;
    const now = rooms.find((r) => r.code === code);
    if (now && now.status === 'admitted') { onApproved(now); return; }
    if (!now) onDeclined();
  }
  lastStatus = Object.fromEntries(rooms.map((r) => [r.code, r.status]));

  renderRoomList(rooms);

  const anyPending = rooms.some((r) => r.status === 'pending');
  if (anyPending && !pollTimer) pollTimer = setInterval(refreshRooms, 3000); // watch for approval
  if (!anyPending) stopPolling();
}

function onApproved(room) {
  stopPolling();
  const err = $('joinErr'); err.className = 'note';
  err.textContent = `\u2713 You have been approved for ${room.name} \u2014 entering\u2026`;
  setTimeout(() => enterRoom(room.code), 800);
}
function onDeclined() {
  const err = $('joinErr'); err.className = 'err';
  err.textContent = 'Your join request was declined, or the room was closed.';
}

function renderRoomList(rooms) {
  const list = $('roomList'); list.replaceChildren();
  if (!rooms.length) {
    const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No rooms yet.';
    list.appendChild(li); return;
  }
  const mkBtn = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
  for (const r of rooms) {
    const li = document.createElement('li'); li.className = 'roomRow';
    const info = document.createElement('div');
    const name = document.createElement('b'); name.textContent = r.name;
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = ` \u00b7 ${r.code} \u00b7 ${r.role}${r.status === 'pending' ? ' \u2014 awaiting approval' : ''}`;
    info.append(name, meta);
    const actions = document.createElement('div'); actions.className = 'roomActions';
    const enter = mkBtn('Enter', () => enterRoom(r.code)); enter.disabled = r.status === 'pending';
    actions.appendChild(enter);
    if (r.role === 'owner') { // owner room management
      actions.appendChild(mkBtn('Rename', () => renameRoom(r), 'mini'));
      actions.appendChild(mkBtn(r.requireApproval ? 'Approval: on' : 'Approval: off', () => togglePolicy(r), 'mini'));
      actions.appendChild(mkBtn('Close', () => closeRoom(r), 'mini'));
    }
    li.append(info, actions);
    list.appendChild(li);
  }
}

async function renameRoom(r) {
  const name = prompt('Rename room:', r.name);
  if (name == null || !name.trim()) return;
  try { await api('/rooms/' + r.id, { method: 'PATCH', auth: true, body: { name: name.trim() } }); refreshRooms(); }
  catch (e) { alert(e.message); }
}
async function togglePolicy(r) {
  try { await api('/rooms/' + r.id, { method: 'PATCH', auth: true, body: { requireApproval: !r.requireApproval } }); refreshRooms(); }
  catch (e) { alert(e.message); }
}
async function closeRoom(r) {
  if (!confirm(`Close "${r.name}"? Anyone at the table is sent back to the lobby, and no one can join.`)) return;
  try { await api('/rooms/' + r.id, { method: 'DELETE', auth: true }); refreshRooms(); }
  catch (e) { alert(e.message); }
}

// ---- handlers ----
// Quick join: create a passwordless account, then join by code — the default path.
async function onQuickJoin() {
  const err = $('qjErr'); err.textContent = ''; err.className = 'err';
  const username = $('qjName').value.trim(), email = $('qjEmail').value.trim(), code = $('qjCode').value.trim();
  if (!username || !email || !code) { err.textContent = 'Fill in all three fields.'; return; }
  let user;
  try {
    const r = await api('/auth/signup', { method: 'POST', body: { username, email } }); // passwordless
    user = r.user; setToken(r.token);
  } catch (e) {
    err.textContent = /taken/i.test(e.message || '') ? `${e.message} Pick another, or log in (top right).` : e.message;
    return;
  }
  try { // now signed in — join the room
    const { room, membership } = await api('/rooms/join', { method: 'POST', auth: true, body: { code } });
    if (membership && membership.status === 'admitted') { enterRoom(room.code); return; }
    await showHome(user); // pending: land on home, which polls and auto-forwards on approval
    const je = $('joinErr'); je.className = 'note'; je.textContent = 'Request sent \u2014 waiting for a GM to admit you\u2026';
  } catch (e) {
    await showHome(user); // account exists now; let them retry from the lobby
    const je = $('joinErr'); je.className = 'err'; je.textContent = e.message;
  }
}

async function onLogin() {
  const err = $('loginErr'); err.textContent = '';
  try {
    const { user, token: t } = await api('/auth/login', { method: 'POST',
      body: { login: $('loginId').value.trim(), password: $('loginPw').value } });
    setToken(t); showHome(user);
  } catch (e) { err.textContent = e.message; }
}

async function onSignup() {
  const err = $('suErr'); err.textContent = '';
  const password = $('suPw').value;
  if (password.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
  try {
    const { user, token: t } = await api('/auth/signup', { method: 'POST',
      body: { username: $('suUser').value.trim(), email: $('suEmail').value.trim(), password } });
    setToken(t); showHome(user);
  } catch (e) { err.textContent = e.message; }
}

async function onCreateRoom() {
  const err = $('createErr'); err.textContent = '';
  try {
    const { room } = await api('/rooms', { method: 'POST', auth: true,
      body: { name: $('roomName').value.trim(), requireApproval: $('approval').checked } });
    enterRoom(room.code);
  } catch (e) { err.textContent = e.message; }
}

async function onJoin() {
  const err = $('joinErr'); err.textContent = ''; err.className = 'err';
  try {
    const { room, membership } = await api('/rooms/join', { method: 'POST', auth: true,
      body: { code: $('joinCode').value.trim() } });
    if (membership && membership.status === 'admitted') {
      err.className = 'note'; err.textContent = '\u2713 Entering\u2026';
      setTimeout(() => enterRoom(room.code), 400);
    } else {
      err.className = 'note';
      err.textContent = 'Request sent \u2014 waiting for a GM. You\u2019ll be forwarded once approved.';
      refreshRooms();
    }
  } catch (e) { err.textContent = e.message; }
}

const onLogout = () => { stopPolling(); clearToken(); showQuickJoin(); };

// ---- wire + boot ----
$('accountBtn').onclick = showAuth;
$('qjBtn').onclick = onQuickJoin;
$('qjToLogin').onclick = (e) => { e.preventDefault(); showAuth(); };
$('qjBack').onclick = (e) => { e.preventDefault(); showQuickJoin(); };
$('qjBack2').onclick = (e) => { e.preventDefault(); showQuickJoin(); };
$('loginBtn').onclick = onLogin;
$('suBtn').onclick = onSignup;
$('createBtn').onclick = onCreateRoom;
$('joinBtn').onclick = onJoin;
$('logoutBtn').onclick = onLogout;
$('requestHostBtn').onclick = onRequestHost;
$('toSignup').onclick = (e) => { e.preventDefault(); $('loginForm').hidden = true; $('signupForm').hidden = false; };
$('toLogin').onclick = (e) => { e.preventDefault(); $('signupForm').hidden = true; $('loginForm').hidden = false; };
$('qjCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') onQuickJoin(); });
$('loginPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });
$('suPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSignup(); });
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') onJoin(); });

(async function boot() {
  if (token()) {
    try { const { user } = await api('/auth/token', { method: 'POST', body: { token: token() } }); return showHome(user); }
    catch { clearToken(); } // stale/lost token — fall through to quick join
  }
  showQuickJoin();
})();
