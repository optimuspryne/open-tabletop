// landing.js — quick-join (default) + login/account + lobby. Talks to the /auth
// and /rooms HTTP endpoints; stores the device token in localStorage for
// auto-login. No game engine here — entering a room hands off to table.html.
const TOKEN_KEY = 'tabletop.token';
const byId = (id) => document.getElementById(id);
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
  byId('quickJoinView').hidden = view !== 'quick';
  byId('authView').hidden = view !== 'auth';
  byId('homeView').hidden = view !== 'home';
  byId('accountBtn').hidden = view !== 'quick'; // the top-right "Log in" only shows on the quick-join screen
}
const showQuickJoin = () => setView('quick');
function showAuth() { setView('auth'); byId('loginForm').hidden = false; byId('signupForm').hidden = true; }

// The cached signed-in user — kept module-side so handlers like onRequestHost can
// re-check fields (e.g. hasPassword) without another round-trip.
let me = null;
async function showHome(user) {
  me = user;
  setView('home');
  byId('who').textContent = user.username;
  const validAvatar = typeof user.avatar === 'string' && /^(\/assets\/|data:image\/|https?:\/\/)/.test(user.avatar);
  byId('avatar').style.backgroundImage = validAvatar ? `url("${user.avatar}")` : 'none';

  // Hosting: approved (or admin) → the create form; pending → a waiting note; else
  // → a "request host access" button.
  const canHost = user.canOwnRooms;
  byId('gmTools').hidden = !canHost;
  byId('hostReq').hidden = canHost;
  if (!canHost) {
    const pending = user.hostStatus === 'pending';
    byId('hostNote').textContent = pending
      ? 'Your host access is pending admin approval.'
      : 'Want to host your own games? Request access — an admin will review it.';
    byId('requestHostBtn').hidden = pending;
  }

  byId('adminBtn').hidden = !user.isAdmin;
  if (user.isAdmin) updateAdminBadge();
  await refreshRooms();
}

async function updateAdminBadge() {
  try {
    const { pending } = await api('/admin/pending-count', { auth: true });
    byId('adminBtn').textContent = pending > 0 ? `⚙️ Admin (${pending})` : '⚙️ Admin';
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
  } catch (e) { byId('hostNote').textContent = e.message; }
}

// ---- rooms + live approval ----
// While any of your rooms is pending, a per-code lobby socket pushes the admit/decline
// the instant it happens. A slow 15s poll stays as a fallback for what the socket can't
// cover (admitted while disconnected, tab reopened, etc). Both funnel through resolve*()
// which fires once per code, so poll and push can't double-forward.
let lastStatus = {};   // code -> status from the previous fetch
let pollTimer = null;
const resolved = new Set();   // codes already forwarded/declined
let coly = null;              // lazily-created Colyseus client
const lobbies = new Map();    // code -> lobby connection

const closeLobby = (code) => { const conn = lobbies.get(code); if (conn) { try { conn.leave(); } catch {} } lobbies.delete(code); };
const stopPolling = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  for (const code of [...lobbies.keys()]) closeLobby(code);
};
function resolveApproved(room) { if (resolved.has(room.code)) return; resolved.add(room.code); onApproved(room); }
function resolveDeclined(code) { if (resolved.has(code)) return; resolved.add(code); onDeclined(); }

// Hold a lobby socket for a pending room; forward/notify the moment the server pushes.
function watchLobby(room) {
  const code = room.code;
  if (lobbies.has(code) || resolved.has(code)) return;
  if (!coly) coly = new Colyseus.Client(location.origin.replace(/^http/, 'ws'));
  coly.joinOrCreate('lobby', { code, token: token() }).then((conn) => {
    lobbies.set(code, conn);
    conn.onMessage('admitted', () => { closeLobby(code); resolveApproved(room); });
    conn.onMessage('declined', () => { closeLobby(code); resolveDeclined(code); });
    conn.onLeave(() => lobbies.delete(code));
  }).catch(() => { /* onAuth rejected (already resolved) or offline — the poll covers it */ });
}

async function refreshRooms() {
  let rooms = [];
  try { ({ rooms } = await api('/rooms', { auth: true })); } catch { return; }

  for (const code in lastStatus) { // fallback: spot pending -> admitted or pending -> gone
    if (lastStatus[code] !== 'pending') continue;
    const current = rooms.find((room) => room.code === code);
    if (current && current.status === 'admitted') { resolveApproved(current); return; }
    if (!current) resolveDeclined(code);
  }
  lastStatus = Object.fromEntries(rooms.map((room) => [room.code, room.status]));

  renderRoomList(rooms);

  for (const room of rooms) if (room.status === 'pending') watchLobby(room); // push-based admit/decline

  const anyPending = rooms.some((room) => room.status === 'pending');
  if (anyPending && !pollTimer) pollTimer = setInterval(refreshRooms, 15000); // slow fallback
  if (!anyPending) stopPolling();
}

function onApproved(room) {
  stopPolling();
  const errEl = byId('joinErr'); errEl.className = 'note';
  errEl.textContent = `\u2713 You have been approved for ${room.name} \u2014 entering\u2026`;
  setTimeout(() => enterRoom(room.code), 800);
}
function onDeclined() {
  const errEl = byId('joinErr'); errEl.className = 'err';
  errEl.textContent = 'Your join request was declined, or the room was closed.';
}

function renderRoomList(rooms) {
  const list = byId('roomList'); list.replaceChildren();
  if (!rooms.length) {
    const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No rooms yet.';
    list.appendChild(li); return;
  }
  const mkBtn = (label, fn, cls) => { const button = document.createElement('button'); button.textContent = label; if (cls) button.className = cls; button.onclick = fn; return button; };
  for (const room of rooms) {
    const li = document.createElement('li'); li.className = 'roomRow';
    const info = document.createElement('div');
    const name = document.createElement('b'); name.textContent = room.name;
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = ` \u00b7 ${room.code} \u00b7 ${room.role}${room.status === 'pending' ? ' \u2014 awaiting approval' : ''}`;
    info.append(name, meta);
    const actions = document.createElement('div'); actions.className = 'actions end';
    const enter = mkBtn('Enter', () => enterRoom(room.code)); enter.disabled = room.status === 'pending';
    actions.appendChild(enter);
    if (room.role === 'owner') { // owner room management
      actions.appendChild(mkBtn('Rename', () => renameRoom(room)));
      actions.appendChild(mkBtn(room.requireApproval ? 'Approval ✓' : 'Approval ✗', () => togglePolicy(room)));
      actions.appendChild(mkBtn('Close', () => closeRoom(room)));
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
  const errEl = byId('qjErr'); errEl.textContent = ''; errEl.className = 'err';
  const username = byId('qjName').value.trim(), email = byId('qjEmail').value.trim(), code = byId('qjCode').value.trim();
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
    const joinErrEl = byId('joinErr'); joinErrEl.className = 'note'; joinErrEl.textContent = 'Request sent \u2014 waiting for a GM to admit you\u2026';
  } catch (e) {
    await showHome(user); // account exists now; let them retry from the lobby
    const joinErrEl = byId('joinErr'); joinErrEl.className = 'err'; joinErrEl.textContent = e.message;
  }
}

async function onLogin() {
  const errEl = byId('loginErr'); errEl.textContent = '';
  try {
    // token: t — aliased so the destructured token doesn't shadow the token() getter
    const { user, token: t } = await api('/auth/login', { method: 'POST',
      body: { login: byId('loginId').value.trim(), password: byId('loginPw').value } });
    setToken(t); showHome(user);
  } catch (e) { errEl.textContent = e.message; }
}

async function onSignup() {
  const errEl = byId('suErr'); errEl.textContent = '';
  const password = byId('suPw').value;
  if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  try {
    // token: t — aliased so the destructured token doesn't shadow the token() getter
    const { user, token: t } = await api('/auth/signup', { method: 'POST',
      body: { username: byId('suUser').value.trim(), email: byId('suEmail').value.trim(), password } });
    setToken(t); showHome(user);
  } catch (e) { errEl.textContent = e.message; }
}

async function onCreateRoom() {
  const errEl = byId('createErr'); errEl.textContent = '';
  try {
    const { room } = await api('/rooms', { method: 'POST', auth: true,
      body: { name: byId('roomName').value.trim(), requireApproval: byId('approval').classList.contains('on') } });
    enterRoom(room.code);
  } catch (e) { errEl.textContent = e.message; }
}

async function onJoin() {
  const errEl = byId('joinErr'); errEl.textContent = ''; errEl.className = 'err';
  try {
    const { room, membership } = await api('/rooms/join', { method: 'POST', auth: true,
      body: { code: byId('joinCode').value.trim() } });
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

const onLogout = () => { byId('adminBtn').hidden=true; stopPolling(); clearToken(); showQuickJoin(); };

// Center-crop + shrink a chosen image to a small square JPEG data-URL (kept tiny
// so it fits the same bounded rule the server enforces).
function fileToAvatarDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 96, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
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
    byId('avatar').style.backgroundImage = `url("${avatar}")`;
  } catch (e) { alert('Could not update your avatar.'); }
}

// ---- wire + boot ----
byId('avatar').onclick = () => byId('avatarFile').click();
byId('avatarFile').onchange = onAvatarPick;
byId('accountBtn').onclick = showAuth;
byId('qjBtn').onclick = onQuickJoin;
byId('qjToLogin').onclick = (e) => { e.preventDefault(); showAuth(); };
byId('qjBack').onclick = (e) => { e.preventDefault(); showQuickJoin(); };
byId('qjBack2').onclick = (e) => { e.preventDefault(); showQuickJoin(); };
byId('loginBtn').onclick = onLogin;
byId('suBtn').onclick = onSignup;
byId('createBtn').onclick = onCreateRoom;
byId('approval').onclick = () => byId('approval').classList.toggle('on');
// Accent color — personal, saved on this device (the <head> script applies it on load; this syncs the picker + handles changes).
{
  const applyAccent = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const s = document.documentElement.style;
    s.setProperty('--accent', hex);
    s.setProperty('--accent-soft', `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},.25)`);
    localStorage.setItem('ott-accent', hex);
    document.querySelectorAll('#accentPicker .accDot').forEach((d) => d.classList.toggle('on', d.dataset.accent.toLowerCase() === hex.toLowerCase()));
    const c = byId('accentCustom'); if (c) c.value = hex;
  };
  document.querySelectorAll('#accentPicker .accDot').forEach((d) => d.onclick = () => applyAccent(d.dataset.accent));
  const cust = byId('accentCustom'); if (cust) cust.oninput = () => applyAccent(cust.value);
  applyAccent(localStorage.getItem('ott-accent') || '#c9a25a');
}
byId('joinBtn').onclick = onJoin;
byId('logoutBtn').onclick = onLogout;
byId('requestHostBtn').onclick = onRequestHost;
byId('toSignup').onclick = (e) => { e.preventDefault(); byId('loginForm').hidden = true; byId('signupForm').hidden = false; };
byId('toLogin').onclick = (e) => { e.preventDefault(); byId('signupForm').hidden = true; byId('loginForm').hidden = false; };
byId('qjCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') onQuickJoin(); });
byId('loginPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });
byId('suPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSignup(); });
byId('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') onJoin(); });

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
