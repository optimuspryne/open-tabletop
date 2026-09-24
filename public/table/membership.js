import { rankOf, memberRow, emptyRow, unclaimedHead, unclaimedRow } from '../ui/rows.js';

export function createMembership({ getRoom, getSessionId, byId, applyIcons, toast = () => {} }) {
  // Pulse the Members button in the accent color while any join is pending, so a
  // GM sees new requests without opening the panel.
  function updateMembersPulse(list) {
    const pending = list.some((m) => m.status === 'pending');
    const dot = byId('memberPending');
    if (dot) dot.hidden = !pending; // pending indicator in the dock
    const sec = byId('memberSection');
    if (sec) sec.classList.toggle('pulse', pending);
  }

  // Unclaimed hands from a loaded save whose owner hasn't returned. GM picks a
  // present player to hand each one to (server re-checks the GM rank).
  function renderUnclaimed() {
    const room = getRoom();
    const box = byId('unclaimedHands');
    if (!box) return;
    box.replaceChildren();
    const unclaimed = room.state.unclaimed;
    if (!unclaimed || unclaimed.size === 0) return;
    const present = [];
    room.state.players.forEach((p, sid) => present.push([sid, p.name]));
    present.sort((a, b) => (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0));
    const on = {
      assign: (userId, toSessionId) => room.send('reassignHand', { userId, toSessionId }),
    };
    box.appendChild(unclaimedHead());
    unclaimed.forEach((name, userId) =>
      box.appendChild(unclaimedRow(userId, name, { present, on })),
    );
  }

  // The GM-only Members panel: the full membership (incl. offline/pending, from the
  // server's DB list) with admit/kick/promote controls. Buttons just send messages;
  // the server authorizes and pushes a fresh list back.
  function renderMembers(list) {
    const room = getRoom();
    const mySession = getSessionId();
    const ul = byId('memberList');
    if (!ul) return;
    ul.replaceChildren();
    const me = room.state.players.get(mySession);
    const myName = me ? me.name : '';
    const myRank = rankOf(me ? me.role : 'player');
    if (!list.length) {
      ul.appendChild(emptyRow('No members.'));
      return;
    }
    const on = {
      admit: (m) => room.send('admit', { userId: m.userId }),
      reject: (m) => room.send('kick', { userId: m.userId }),
      setRole: (m, role) => room.send('setRole', { userId: m.userId, role }),
      kick: (m) => room.send('kick', { userId: m.userId }),
      timeout: (m) => room.send('setPlayerTimeout', { userId: m.userId, timedOut: !m.timedOut }),
    };
    for (const m of list)
      ul.appendChild(memberRow(m, { isSelf: m.isSelf ?? m.username === myName, myRank, on }));
    applyIcons(ul);
  }
  function bindMessages(room) {
    room.onMessage('playerTimeoutSet', ({ timedOut }) =>
      toast(timedOut ? 'Time-out applied' : 'Time-out ended'),
    );
    room.onMessage('memberList', (list) => {
      renderMembers(list);
      updateMembersPulse(list);
    }); // panel data + pending-pulse
  }
  function bindRoom(room, cb) {
    cb(room.state).unclaimed.onAdd(() => renderUnclaimed());
    cb(room.state).unclaimed.onRemove(() => renderUnclaimed());
  }
  return { bindMessages, bindRoom, renderUnclaimed };
}
