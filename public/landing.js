import { applyIcons, setIcon, initTip } from './icons.js';
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
  try {
    data = await res.json();
  } catch {
    /* no/invalid body */
  }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

const enterRoom = (code) => {
  location.href = 'table.html?room=' + encodeURIComponent(code);
};

// ---- small shared UI helpers ----
// One status surface: set the message and whether it reads as an error or a note,
// without clobbering other classes. Empty msg clears it (min-height keeps the layout).
function setStatus(el, msg, kind = 'err') {
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('err', kind === 'err');
  el.classList.toggle('note', kind === 'note');
}
// One place to flip a toggle button: the .on class, its aria-pressed state, and
// (optionally) its icon. Used by the GM-approval and Full-labels toggles.
function setToggle(btn, on, iconOn, iconOff) {
  if (!btn) return;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (iconOn) setIcon(btn, on ? iconOn : iconOff || iconOn);
}
// Bind a link-style control (an <a role="button">) so it fires on click AND on
// Enter/Space — keeps keyboard users on par with the mouse.
function onActivate(el, fn) {
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    fn(e);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn(e);
    }
  });
}

// ---- views: quick | auth | home ----
// Show exactly one of the three top-level views (quick-join / auth / home).
function setView(view) {
  byId('quickJoinView').hidden = view !== 'quick';
  byId('authView').hidden = view !== 'auth';
  byId('homeView').hidden = view !== 'home';
  byId('accountBtn').hidden = view !== 'quick'; // the top-right "Log in" only shows on the quick-join screen
}
const showQuickJoin = () => setView('quick');
function showAuth() {
  setView('auth');
  byId('loginForm').hidden = false;
  byId('signupForm').hidden = true;
}

// The cached signed-in user — kept module-side so handlers like onRequestHost can
// re-check fields (e.g. hasPassword) without another round-trip.
let me = null;
async function showHome(user) {
  me = user;
  setView('home');
  byId('who').textContent = user.username;
  const validAvatar =
    typeof user.avatar === 'string' && /^(\/assets\/|data:image\/|https?:\/\/)/.test(user.avatar);
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
    {
      const a = byId('adminBtn');
      const t = pending > 0 ? `Admin (${pending})` : 'Admin';
      const l = a.querySelector('.lbl');
      if (l) l.textContent = t;
      a.setAttribute('aria-label', t);
    }
  } catch {
    /* leave as-is */
  }
}

async function onRequestHost() {
  let password;
  if (!me.hasPassword) {
    password = prompt('Hosting needs a password. Set one (8+ characters):');
    if (!password) return;
  }
  try {
    const { user } = await api('/host/request', {
      method: 'POST',
      auth: true,
      body: password ? { password } : {},
    });
    await showHome(user);
  } catch (e) {
    byId('hostNote').textContent = e.message;
  }
}

// ---- rooms + live approval ----
// While any of your rooms is pending, a per-code lobby socket pushes the admit/decline
// the instant it happens. A slow 15s poll stays as a fallback for what the socket can't
// cover (admitted while disconnected, tab reopened, etc). Both funnel through resolve*()
// which fires once per code, so poll and push can't double-forward.
let lastStatus = {}; // code -> status from the previous fetch
let pollTimer = null;
const resolved = new Set(); // codes already forwarded/declined
let coly = null; // lazily-created Colyseus client
const lobbies = new Map(); // code -> lobby connection

const closeLobby = (code) => {
  const conn = lobbies.get(code);
  if (conn) {
    try {
      conn.leave();
    } catch {}
  }
  lobbies.delete(code);
};
const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  for (const code of [...lobbies.keys()]) closeLobby(code);
};
function resolveApproved(room) {
  if (resolved.has(room.code)) return;
  resolved.add(room.code);
  onApproved(room);
}
function resolveDeclined(code) {
  if (resolved.has(code)) return;
  resolved.add(code);
  onDeclined();
}

// Hold a lobby socket for a pending room; forward/notify the moment the server pushes.
function watchLobby(room) {
  const code = room.code;
  if (lobbies.has(code) || resolved.has(code)) return;
  if (!coly) coly = new Colyseus.Client(location.origin.replace(/^http/, 'ws'));
  coly
    .joinOrCreate('lobby', { code, token: token() })
    .then((conn) => {
      lobbies.set(code, conn);
      conn.onMessage('admitted', () => {
        closeLobby(code);
        resolveApproved(room);
      });
      conn.onMessage('declined', () => {
        closeLobby(code);
        resolveDeclined(code);
      });
      conn.onLeave(() => lobbies.delete(code));
    })
    .catch(() => {
      /* onAuth rejected (already resolved) or offline — the poll covers it */
    });
}

async function refreshRooms() {
  let rooms = [];
  try {
    ({ rooms } = await api('/rooms', { auth: true }));
  } catch {
    return;
  }

  for (const code in lastStatus) {
    // fallback: spot pending -> admitted or pending -> gone
    if (lastStatus[code] !== 'pending') continue;
    const current = rooms.find((room) => room.code === code);
    if (current && current.status === 'admitted') {
      resolveApproved(current);
      return;
    }
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
  setStatus(
    byId('joinErr'),
    `\u2713 You have been approved for ${room.name} \u2014 entering\u2026`,
    'note',
  );
  setTimeout(() => enterRoom(room.code), 800);
}
function onDeclined() {
  setStatus(byId('joinErr'), 'Your join request was declined, or the room was closed.', 'err');
}

function renderRoomList(rooms) {
  const list = byId('roomList');
  list.replaceChildren();
  if (!rooms.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No rooms yet.';
    list.appendChild(li);
    return;
  }
  const ROOM_ICON = { Enter: 'door-enter', Rename: 'cursor-text', Close: 'trash' };
  const mkBtn = (label, fn, cls) => {
    const button = document.createElement('button');
    button.type = 'button';
    const ic = ROOM_ICON[label];
    if (ic) {
      button.dataset.icon = ic;
      button.innerHTML = '<span class="lbl">' + label + '</span>';
    } else button.textContent = label;
    if (cls) button.className = cls;
    button.onclick = fn;
    return button;
  };
  for (const room of rooms) {
    const li = document.createElement('li');
    li.className = 'roomRow';
    const info = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = room.name;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = ` \u00b7 ${room.code} \u00b7 ${room.role}${room.status === 'pending' ? ' \u2014 awaiting approval' : ''}`;
    info.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'actions end';
    const enter = mkBtn('Enter', () => enterRoom(room.code));
    enter.disabled = room.status === 'pending';
    actions.appendChild(enter);
    if (room.role === 'owner') {
      // owner room management
      actions.appendChild(mkBtn('Rename', () => renameRoom(room)));
      {
        const appr = document.createElement('button');
        appr.type = 'button';
        const gated = room.requireApproval;
        appr.dataset.icon = gated ? 'shield-check' : 'shield-x';
        appr.innerHTML = '<span class="lbl">' + (gated ? 'Gated' : 'Open') + '</span>';
        appr.setAttribute('aria-pressed', gated ? 'true' : 'false');
        appr.setAttribute(
          'aria-label',
          gated ? 'Gated \u2014 approval required' : 'Open \u2014 anyone can join',
        );
        appr.onclick = () => togglePolicy(room);
        actions.appendChild(appr);
      }
      actions.appendChild(mkBtn('Close', () => closeRoom(room)));
    }
    li.append(info, actions);
    list.appendChild(li);
  }
  applyIcons(list);
}

async function renameRoom(room) {
  const name = prompt('Rename room:', room.name);
  if (name == null || !name.trim()) return;
  try {
    await api('/rooms/' + room.id, { method: 'PATCH', auth: true, body: { name: name.trim() } });
    refreshRooms();
  } catch (e) {
    alert(e.message);
  }
}
async function togglePolicy(room) {
  try {
    await api('/rooms/' + room.id, {
      method: 'PATCH',
      auth: true,
      body: { requireApproval: !room.requireApproval },
    });
    refreshRooms();
  } catch (e) {
    alert(e.message);
  }
}
async function closeRoom(room) {
  if (
    !confirm(
      `Close "${room.name}"? Anyone at the table is sent back to the lobby, and no one can join.`,
    )
  )
    return;
  try {
    await api('/rooms/' + room.id, { method: 'DELETE', auth: true });
    refreshRooms();
  } catch (e) {
    alert(e.message);
  }
}

// ---- handlers ----
// Quick join: create a passwordless account, then join by code — the default path.
async function onQuickJoin() {
  const errEl = byId('qjErr');
  setStatus(errEl, '');
  const username = byId('qjName').value.trim(),
    email = byId('qjEmail').value.trim(),
    code = byId('qjCode').value.trim().toUpperCase();
  if (!username || !email || !code) {
    setStatus(errEl, 'Fill in all three fields.');
    return;
  }
  let user;
  try {
    const signup = await api('/auth/signup', { method: 'POST', body: { username, email } }); // passwordless
    user = signup.user;
    setToken(signup.token);
  } catch (e) {
    setStatus(
      errEl,
      /taken/i.test(e.message || '')
        ? `${e.message} Pick another, or log in (top right).`
        : e.message,
    );
    return;
  }
  try {
    // now signed in — join the room
    const { room, membership } = await api('/rooms/join', {
      method: 'POST',
      auth: true,
      body: { code },
    });
    if (membership && membership.status === 'admitted') {
      enterRoom(room.code);
      return;
    }
    await showHome(user); // pending: land on home, which polls and auto-forwards on approval
    setStatus(byId('joinErr'), 'Request sent \u2014 waiting for a GM to admit you\u2026', 'note');
  } catch (e) {
    await showHome(user); // account exists now; let them retry from the lobby
    setStatus(byId('joinErr'), e.message, 'err');
  }
}

async function onLogin() {
  const errEl = byId('loginErr');
  setStatus(errEl, '');
  try {
    // token: t — aliased so the destructured token doesn't shadow the token() getter
    const { user, token: t } = await api('/auth/login', {
      method: 'POST',
      body: { login: byId('loginId').value.trim(), password: byId('loginPw').value },
    });
    setToken(t);
    showHome(user);
  } catch (e) {
    setStatus(errEl, e.message);
  }
}

async function onSignup() {
  const errEl = byId('suErr');
  setStatus(errEl, '');
  const password = byId('suPw').value;
  if (password.length < 8) {
    setStatus(errEl, 'Password must be at least 8 characters.');
    return;
  }
  try {
    // token: t — aliased so the destructured token doesn't shadow the token() getter
    const { user, token: t } = await api('/auth/signup', {
      method: 'POST',
      body: {
        username: byId('suUser').value.trim(),
        email: byId('suEmail').value.trim(),
        password,
      },
    });
    setToken(t);
    showHome(user);
  } catch (e) {
    setStatus(errEl, e.message);
  }
}

async function onCreateRoom() {
  const errEl = byId('createErr');
  setStatus(errEl, '');
  try {
    const { room } = await api('/rooms', {
      method: 'POST',
      auth: true,
      body: {
        name: byId('roomName').value.trim(),
        requireApproval: byId('approval').classList.contains('on'),
      },
    });
    enterRoom(room.code);
  } catch (e) {
    setStatus(errEl, e.message);
  }
}

async function onJoin() {
  const errEl = byId('joinErr');
  setStatus(errEl, '');
  try {
    const { room, membership } = await api('/rooms/join', {
      method: 'POST',
      auth: true,
      body: { code: byId('joinCode').value.trim().toUpperCase() },
    });
    if (membership && membership.status === 'admitted') {
      setStatus(errEl, '\u2713 Entering\u2026', 'note');
      setTimeout(() => enterRoom(room.code), 400);
    } else {
      setStatus(
        errEl,
        'Request sent \u2014 waiting for a GM. You\u2019ll be forwarded once approved.',
        'note',
      );
      refreshRooms();
    }
  } catch (e) {
    setStatus(errEl, e.message);
  }
}

const onLogout = async () => {
  const raw = token();
  byId('adminBtn').hidden = true;
  stopPolling();
  clearToken();
  showQuickJoin();
  if (raw) {
    try {
      await api('/auth/logout', { method: 'POST', body: { token: raw } });
    } catch {
      /* local logout still succeeds */
    }
  }
};

// Center-crop + shrink a chosen image to a small square JPEG data-URL (kept tiny
// so it fits the same bounded rule the server enforces).
function fileToAvatarDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 96,
        canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale,
        h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload = () => {
      img.src = fr.result;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
async function onAvatarPick(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const data = await fileToAvatarDataURL(file);
    const { avatar } = await api('/me/avatar', { method: 'POST', auth: true, body: { data } });
    byId('avatar').style.backgroundImage = `url("${avatar}")`;
  } catch (e) {
    alert('Could not update your avatar.');
  }
}

// ---- wire + boot ----
// Forms: submit fires on the primary button AND on Enter in any field, so the four
// per-field keydown handlers are gone. Each view's fields live in one <form>.
const wireForm = (id, fn) => {
  const f = byId(id);
  if (f)
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      fn();
    });
};
wireForm('quickJoinForm', onQuickJoin);
wireForm('loginForm', onLogin);
wireForm('signupForm', onSignup);
wireForm('createRoomForm', onCreateRoom);
wireForm('joinRoomForm', onJoin);

onActivate(byId('avatar'), () => byId('avatarFile').click());
byId('avatarFile').onchange = onAvatarPick;
byId('accountBtn').onclick = showAuth;
onActivate(byId('qjToLogin'), showAuth);
document.querySelectorAll('.toQuick').forEach((a) => onActivate(a, showQuickJoin)); // both "← Back to quick join" links, once
byId('approval').onclick = () =>
  setToggle(
    byId('approval'),
    !byId('approval').classList.contains('on'),
    'shield-check',
    'shield-x',
  );
applyIcons();
initTip();
// Accent color — personal, saved on this device (the <head> script applies it on load; this syncs the picker + handles changes).
{
  const applyAccent = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const s = document.documentElement.style;
    s.setProperty('--accent', hex);
    s.setProperty(
      '--accent-soft',
      `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},.25)`,
    );
    localStorage.setItem('ott-accent', hex);
    document
      .querySelectorAll('#accentPicker .accDot')
      .forEach((d) =>
        d.classList.toggle('on', d.dataset.accent.toLowerCase() === hex.toLowerCase()),
      );
    const c = byId('accentCustom');
    if (c) c.value = hex;
  };
  document
    .querySelectorAll('#accentPicker .accDot')
    .forEach((d) => (d.onclick = () => applyAccent(d.dataset.accent)));
  const cust = byId('accentCustom');
  if (cust) cust.oninput = () => applyAccent(cust.value);
  applyAccent(localStorage.getItem('ott-accent') || '#c9a25a');
}
byId('logoutBtn').onclick = onLogout;
{
  // Full / Compact interface toggle — persists to localStorage; applied on every page at load
  const uiToggle = byId('uiModeToggle');
  const syncUi = () => {
    const full = document.body.classList.contains('ui-full');
    const mode = full ? 'Default UI' : 'Compact UI';
    setToggle(uiToggle, full, 'arrows-minimize', 'arrows-maximize');
    if (uiToggle) {
      const l = uiToggle.querySelector('.lbl');
      if (l) l.textContent = mode;
      uiToggle.setAttribute('aria-label', mode);
    }
  }; // class + aria-pressed + mode label/name + action icon (minimize=go compact / maximize=go full)
  syncUi();
  if (uiToggle)
    uiToggle.onclick = () => {
      const full = document.body.classList.toggle('ui-full');
      localStorage.setItem('ott-ui-full', full ? '1' : '0');
      syncUi();
    };
}
byId('requestHostBtn').onclick = onRequestHost;
onActivate(byId('toSignup'), () => {
  byId('loginForm').hidden = true;
  byId('signupForm').hidden = false;
});
onActivate(byId('toLogin'), () => {
  byId('signupForm').hidden = true;
  byId('loginForm').hidden = false;
});

// Boot: if a stored token still resolves to a user, land on home; otherwise (no
// token, a stale one that 401s, or a 2xx that somehow lacks a user) show quick-join.
(async function boot() {
  if (token()) {
    try {
      const { user } = await api('/auth/token', { method: 'POST', body: { token: token() } });
      if (user) return showHome(user); // a 2xx without a user → treat as signed-out rather than half-render home
      clearToken();
    } catch {
      clearToken();
    } // stale/lost token — fall through to quick join
  }
  showQuickJoin();
})();
