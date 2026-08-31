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

/**
 * One scoreboard row. `canEdit` decides whether the label is an input and whether the
 * adjust/remove buttons appear — presentation that follows from the viewer's rank.
 * `on` = { label, adjust, remove }.
 */
export function scoreRow(row, id, { canEdit = false, on = {} } = {}) {
  const noop = () => {};
  const { label = noop, adjust = noop, remove = noop } = on;
  const tr = document.createElement('tr');
  const name = document.createElement('td');
  name.className = 'scoreName';
  if (canEdit) {
    const inp = document.createElement('input');
    inp.value = row.label;
    inp.maxLength = 40;
    inp.onchange = () => label(id, inp.value);
    name.appendChild(inp);
  } else {
    name.textContent = row.label;
  }
  const val = document.createElement('td');
  val.className = 'scoreVal';
  val.textContent = row.score;
  const acts = document.createElement('td');
  acts.className = 'scoreActs';
  if (canEdit)
    acts.append(
      makeButton('−', () => adjust(id, -1)),
      makeButton('+', () => adjust(id, 1)),
      makeButton('×', () => remove(id), 'danger'),
    );
  tr.append(name, val, acts);
  return tr;
}

/** The scoreboard's empty state — a full-width row, so it lives with the table. */
export function scoreEmptyRow(text = 'No scores yet.') {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 3;
  td.className = 'scoreEmpty';
  td.textContent = text;
  tr.appendChild(td);
  return tr;
}

/** The heading above the unclaimed-hands list. */
export function unclaimedHead(text = 'Unclaimed hands') {
  const head = document.createElement('div');
  head.className = 'unclaimed-head';
  head.textContent = text;
  return head;
}

/**
 * One unclaimed hand, with its "give to…" picker. `present` is [[sessionId, name], …],
 * already sorted by the caller; `on.assign(userId, toSessionId)` does the handing over.
 */
export function unclaimedRow(userId, name, { present = [], on = {} } = {}) {
  const assign = on.assign ?? (() => {});
  const row = document.createElement('div');
  row.className = 'unclaimed-row';
  const label = document.createElement('span');
  label.className = 'unclaimed-name';
  label.textContent = name || 'A player';
  row.appendChild(label);
  const sel = document.createElement('select');
  sel.className = 'unclaimed-assign';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Give to…';
  sel.appendChild(def);
  for (const [sid, pname] of present) {
    const o = document.createElement('option');
    o.value = sid;
    o.textContent = pname;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    if (sel.value) {
      assign(userId, sel.value);
      sel.value = '';
    }
  };
  row.appendChild(sel);
  return row;
}

/**
 * The contents of a toast: icon, text, and optionally an undo button. Returns the nodes;
 * showing, hiding and the dismiss timer stay with the caller, since they are about the
 * toast's lifetime rather than its markup.
 */
export function toastContent(text, icon = 'check', action = null, onAction = () => {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico ico-' + icon);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + icon);
  svg.appendChild(use);
  const span = document.createElement('span');
  span.textContent = text;
  const nodes = [svg, span];
  if (action) {
    // An undoable action carries its own way out, rather than a separate history stack.
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toastAction';
    b.textContent = action.label;
    b.onclick = onAction;
    nodes.push(b);
  }
  return nodes;
}
