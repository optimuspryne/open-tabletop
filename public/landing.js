// landing.js — quick-join (default) + login/account + lobby. Talks to the /auth
// and /rooms HTTP endpoints; stores the device token in localStorage for
// auto-login. No game engine here — entering a room hands off to table.html.
const TOKEN_KEY = 'tabletop.token';
const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem(TOKEN_KEY) || '';
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Fetch wrapper: JSON-encodes a body, attaches the Bearer token when
// { auth: true } (opt-in per call, unlike admin.js's always-on), and THROWS on
// any non-2xx — so callers just try/catch and show the message.
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
// Show exactly one of the three top-level views (quick-join / auth / home).
function setView(view) {
  $('quickJoinView').hidden = view !== 'quick';
  $('authView').hidden = view !== 'auth';
  $('homeView').hidden = view !== 'home';
  $('accountBtn').hidden = view !== 'quick'; // the top-right "Log in" only shows on the quick-join screen
}
const showQuickJoin = () => setView('quick');
function showAuth() { setView('auth'); $('loginForm').hidden = false; $('signupForm').hidden = true; }

// The cached signed-in user — kept module-side so handlers like onRequestHost can
// re-check fields (e.g. hasPassword) without another round-trip.
let me = null;
async function showHome(user) {
  me = user;
  setView('home');
  $('who').textContent = user.username;
  const validAvatar = typeof user.avatar === 'string' && /^(\/assets\/|data:image\/|https?:\/\/)/.test(user.avatar);
  $('avatar').style.backgroundImage = validAvatar ? `url("${user.avatar}")` : 'none';

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

  $('adminBtn').hidden = !user.isAdmin;
  if (user.isAdmin) updateAdminBadge();
  await refreshRooms();
}

async function updateAdminBadge() {
  try {
    const { pending } = await api('/admin/pending-count', { auth: true });
    $('adminBtn').textContent = pending > 0 ? `⚙️ Admin (${pending})` : '⚙️ Admin';
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
// While any of your rooms is pending admission, poll /rooms every 3s and watch for
// the transition: pending -> admitted auto-forwards you into the table; pending ->
// gone (declined or closed) shows a notice. Polling stops once nothing is pending.
let lastStatus = {};   // code -> status from the previous fetch (to spot pending -> admitted)
let pollTimer = null;
const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

async function refreshRooms() {
  let rooms = [];
  try { ({ rooms } = await api('/rooms', { auth: true })); } catch { return; }

  for (const code in lastStatus) { // spot pending -> admitted (approved) or pending -> gone (declined/closed)
    if (lastStatus[code] !== 'pending') continue;
    const current = rooms.find((room) => room.code === code);
    if (current && current.status === 'admitted') { onApproved(current); return; }
    if (!current) onDeclined();
  }
  lastStatus = Object.fromEntries(rooms.map((room) => [room.code, room.status]));

  renderRoomList(rooms);

  const anyPending = rooms.some((room) => room.status === 'pending');
  if (anyPending && !pollTimer) pollTimer = setInterval(refreshRooms, 3000); // watch for approval
  if (!anyPending) stopPolling();
}

function onApproved(room) {
  stopPolling();
  const errEl = $('joinErr'); errEl.className = 'note';
  errEl.textContent = `\u2713 You have been approved for ${room.name} \u2014 entering\u2026`;
  setTimeout(() => enterRoom(room.code), 800);
}
function onDeclined() {
  const errEl = $('joinErr'); errEl.className = 'err';
  errEl.textContent = 'Your join request was declined, or the room was closed.';
}

function renderRoomList(rooms) {
  const list = $('roomList'); list.replaceChildren();
  if (!rooms.length) {
    const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No rooms yet.';
    list.appendChild(li); return;
  }
  const mkBtn = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
  for (const room of rooms) {
    const li = document.createElement('li'); li.className = 'roomRow';
    const info = document.createElement('div');
    const name = document.createElement('b'); name.textContent = room.name;
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = ` \u00b7 ${room.code} \u00b7 ${room.role}${room.status === 'pending' ? ' \u2014 awaiting approval' : ''}`;
    info.append(name, meta);
    const actions = document.createElement('div'); actions.className = 'roomActions';
    const enter = mkBtn('Enter', () => enterRoom(room.code)); enter.disabled = room.status === 'pending';
    actions.appendChild(enter);
    if (room.role === 'owner') { // owner room management
      actions.appendChild(mkBtn('Rename', () => renameRoom(room), 'mini'));
      actions.appendChild(mkBtn(room.requireApproval ? 'Approval: on' : 'Approval: off', () => togglePolicy(room), 'mini'));
      actions.appendChild(mkBtn('Close', () => closeRoom(room), 'mini'));
    }
    li.append(info, actions);
    list.appendChild(li);
  }
}

async function renameRoom(room) {
  const name = prompt('Rename room:', room.name);
  if (name == null || !name.trim()) return;
  try { await api('/rooms/' + room.id, { method: 'PATCH', auth: true, body: { name: name.trim() } }); refreshRooms(); }
  catch (e) { alert(e.message); }
}
async function togglePolicy(room) {
  try { await api('/rooms/' + room.id, { method: 'PATCH', auth: true, body: { requireApproval: !room.requireApproval } }); refreshRooms(); }
  catch (e) { alert(e.message); }
}
async function closeRoom(room) {
  if (!confirm(`Close "${room.name}"? Anyone at the table is sent back to the lobby, and no one can join.`)) return;
  try { await api('/rooms/' + room.id, { method: 'DELETE', auth: true }); refreshRooms(); }
  catch (e) { alert(e.message); }
}

// ---- handlers ----
// Quick join: create a passwordless account, then join by code — the default path.
async function onQuickJoin() {
  const errEl = $('qjErr'); errEl.textContent = ''; errEl.className = 'err';
  const username = $('qjName').value.trim(), email = $('qjEmail').value.trim(), code = $('qjCode').value.trim();
  if (!username || !email || !code) { errEl.textContent = 'Fill in all three fields.'; return; }
  let user;
  try {
    const signup = await api('/auth/signup', { method: 'POST', body: { username, email } }); // passwordless
    user = signup.user; setToken(signup.token);
  } catch (e) {
    errEl.textContent = /taken/i.test(e.message || '') ? `${e.message} Pick another, or log in (top right).` : e.message;
    return;
  }
  try { // now signed in — join the room
    const { room, membership } = await api('/rooms/join', { method: 'POST', auth: true, body: { code } });
    if (membership && membership.status === 'admitted') { enterRoom(room.code); return; }
    await showHome(user); // pending: land on home, which polls and auto-forwards on approval
    const joinErrEl = $('joinErr'); joinErrEl.className = 'note'; joinErrEl.textContent = 'Request sent \u2014 waiting for a GM to admit you\u2026';
  } catch (e) {
    await showHome(user); // account exists now; let them retry from the lobby
    const joinErrEl = $('joinErr'); joinErrEl.className = 'err'; joinErrEl.textContent = e.message;
  }
}

async function onLogin() {
  const errEl = $('loginErr'); errEl.textContent = '';
  try {
    // token: t — aliased so the destructured token doesn't shadow the token() getter
    const { user, token: t } = await api('/auth/login', { method: 'POST',
      body: { login: $('loginId').value.trim(), password: $('loginPw').value } });
    setToken(t); showHome(user);
  } catch (e) { errEl.textContent = e.message; }
}

async function onSignup() {
  const errEl = $('suErr'); errEl.textContent = '';
  const password = $('suPw').value;
  if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  try {
    // token: t — aliased so the destructured token doesn't shadow the token() getter
    const { user, token: t } = await api('/auth/signup', { method: 'POST',
      body: { username: $('suUser').value.trim(), email: $('suEmail').value.trim(), password } });
    setToken(t); showHome(user);
  } catch (e) { errEl.textContent = e.message; }
}

async function onCreateRoom() {
  const errEl = $('createErr'); errEl.textContent = '';
  try {
    const { room } = await api('/rooms', { method: 'POST', auth: true,
      body: { name: $('roomName').value.trim(), requireApproval: $('approval').classList.contains('on') } });
    enterRoom(room.code);
  } catch (e) { errEl.textContent = e.message; }
}

async function onJoin() {
  const errEl = $('joinErr'); errEl.textContent = ''; errEl.className = 'err';
  try {
    const { room, membership } = await api('/rooms/join', { method: 'POST', auth: true,
      body: { code: $('joinCode').value.trim() } });
    if (membership && membership.status === 'admitted') {
      errEl.className = 'note'; errEl.textContent = '\u2713 Entering\u2026';
      setTimeout(() => enterRoom(room.code), 400);
    } else {
      errEl.className = 'note';
      errEl.textContent = 'Request sent \u2014 waiting for a GM. You\u2019ll be forwarded once approved.';
      refreshRooms();
    }
  } catch (e) { errEl.textContent = e.message; }
}

const onLogout = () => { $('adminBtn').hidden=true; stopPolling(); clearToken(); showQuickJoin(); };

// Center-crop + shrink a chosen image to a small square JPEG data-URL (kept tiny
// so it fits the same bounded rule the server enforces).
function fileToAvatarDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 96, c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
async function onAvatarPick(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    const data = await fileToAvatarDataURL(file);
    const { avatar } = await api('/me/avatar', { method: 'POST', auth: true, body: { data } });
    $('avatar').style.backgroundImage = `url("${avatar}")`;
  } catch (e) { alert('Could not update your avatar.'); }
}

// ---- wire + boot ----
$('avatar').onclick = () => $('avatarFile').click();
$('avatarFile').onchange = onAvatarPick;
$('accountBtn').onclick = showAuth;
$('qjBtn').onclick = onQuickJoin;
$('qjToLogin').onclick = (e) => { e.preventDefault(); showAuth(); };
$('qjBack').onclick = (e) => { e.preventDefault(); showQuickJoin(); };
$('qjBack2').onclick = (e) => { e.preventDefault(); showQuickJoin(); };
$('loginBtn').onclick = onLogin;
$('suBtn').onclick = onSignup;
$('createBtn').onclick = onCreateRoom;
$('approval').onclick = () => $('approval').classList.toggle('on');
$('joinBtn').onclick = onJoin;
$('logoutBtn').onclick = onLogout;
$('requestHostBtn').onclick = onRequestHost;
$('toSignup').onclick = (e) => { e.preventDefault(); $('loginForm').hidden = true; $('signupForm').hidden = false; };
$('toLogin').onclick = (e) => { e.preventDefault(); $('signupForm').hidden = true; $('loginForm').hidden = false; };
$('qjCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') onQuickJoin(); });
$('loginPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });
$('suPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSignup(); });
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') onJoin(); });

// Boot: if a stored token still resolves to a user, land on home; otherwise (no
// token, a stale one that 401s, or a 2xx that somehow lacks a user) show quick-join.
(async function boot() {
  if (token()) {
    try {
      const { user } = await api('/auth/token', { method: 'POST', body: { token: token() } });
      if (user) return showHome(user); // a 2xx without a user → treat as signed-out rather than half-render home
      clearToken();
    } catch { clearToken(); } // stale/lost token — fall through to quick join
  }
  showQuickJoin();
})();
