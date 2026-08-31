// public/rows.js — list-row builders.
//
// Data in, element out. These read no room, no scene, no module state: everything they
// need arrives as arguments, and every side effect is a callback the caller supplies.
// client.js keeps the state→data mapping and the room.send() wiring; this file owns what
// a row LOOKS like.
//
// The split exists so the rows can be rendered from fixtures in a headless browser
// (scripts/component-parity.mjs). While they lived inside client.js — 6,000 lines that
// join a Colyseus room at import — nothing could render one without a server, so the
// whole family of list rows sat in the tooling's blind spot.
//
// Adding a row builder here means it is testable the moment it exists.

export const rankOf = (role) => ({ owner: 3, gm: 2, helper: 1, player: 0 })[role] ?? 0;

const MEMBER_ICON = { Helper: 'user-up', Player: 'user-down', GM: 'user-cog', Kick: 'user-minus' };

/** A <button> from label + click handler (+ optional class / icon) — the shared factory. */
export function makeButton(label, fn, cls, icon) {
  const button = document.createElement('button');
  const ic = icon || MEMBER_ICON[label];
  if (ic) {
    button.dataset.icon = ic;
    button.innerHTML = '<span class="lbl">' + label + '</span>';
  } else button.textContent = label;
  if (cls) button.className = cls;
  button.onclick = fn;
  return button;
}

/**
 * One chat message. `mine` is the caller's decision (it knows who you are), so the row
 * itself stays a pure function of its inputs.
 */
export function chatRow(m, { mine = false } = {}) {
  const row = document.createElement('div');
  row.className = 'chatMsg' + (mine ? ' me' : '');
  const head = document.createElement('div');
  head.className = 'chatHead';
  const who = document.createElement('span');
  who.className = 'chatFrom';
  who.textContent = mine ? 'you' : m.from || 'Player';
  head.append(who);
  if (m.ts) {
    const t = document.createElement('span');
    t.className = 'chatTime';
    t.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    head.append(t);
  }
  const text = document.createElement('div');
  text.className = 'chatText';
  text.textContent = m.text || '';
  row.append(head, text);
  return row;
}

/**
 * One member row. Which buttons appear is presentation — it follows from the member's
 * role and the viewer's rank — so it lives here and can be tested. What each button
 * DOES is the caller's: pass `on` = { admit, reject, setRole, kick }, each taking the
 * member (and, for setRole, the target role).
 */
export function memberRow(m, { isSelf = false, myRank = 0, on = {} } = {}) {
  const noop = () => {};
  const { admit = noop, reject = noop, setRole = noop, kick = noop } = on;
  const li = document.createElement('li');
  li.className = 'memberRow';

  const info = document.createElement('span');
  info.textContent = m.username;
  const tag = document.createElement('span');
  tag.className = 'muted';
  tag.textContent = ` · ${m.role}${m.status === 'pending' ? ' · pending' : ''}`;
  info.appendChild(tag);
  li.appendChild(info);

  const acts = document.createElement('span');
  acts.className = 'actions';
  if (m.status === 'pending') {
    acts.append(
      makeButton('Admit', () => admit(m)),
      makeButton('Reject', () => reject(m)),
    );
  } else if (!isSelf && m.role !== 'owner') {
    if (m.role === 'player') acts.appendChild(makeButton('Helper', () => setRole(m, 'helper')));
    if (m.role === 'helper') acts.appendChild(makeButton('Player', () => setRole(m, 'player')));
    if (myRank >= 3) {
      // owner manages co-GMs
      if (m.role !== 'gm') acts.appendChild(makeButton('GM', () => setRole(m, 'gm')));
      else {
        // demote GM → Helper (down) → Player
        acts.appendChild(makeButton('Helper', () => setRole(m, 'helper'), null, 'user-down'));
        acts.appendChild(makeButton('Player', () => setRole(m, 'player')));
      }
    }
    if (m.role !== 'gm' || myRank >= 3) acts.appendChild(makeButton('Kick', () => kick(m)));
  }
  li.appendChild(acts);
  return li;
}

/** The empty state for a member list. */
export function emptyRow(text = 'No members.') {
  const li = document.createElement('li');
  li.className = 'muted';
  li.textContent = text;
  return li;
}
