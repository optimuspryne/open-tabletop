import { scoreRow, scoreEmptyRow } from '../ui/rows.js';

export function createScoreboard({
  getRoom,
  getRank,
  byId,
  doc = document,
  confirmAction = confirm,
  delay = setTimeout,
  cancelDelay = clearTimeout,
}) {
  const document = doc;
  const confirm = confirmAction;
  // Scoreboard is helper+ editable, room notes GM+; everyone else sees them read-only.
  function applyRole() {
    const myRank = getRank();
    const edit = byId('scoreEdit');
    if (edit) edit.hidden = myRank < 1;
    const notes = byId('roomNotes');
    if (notes) notes.readOnly = myRank < 2;
    renderScores();
  }

  function renderScores() {
    const room = getRoom();
    const myRank = getRank();
    const tbody = byId('scoreRows');
    if (!tbody || !room || !room.state || !room.state.scores) return;
    const canEdit = myRank >= 1;
    const on = {
      label: (id, label) => room.send('score', { action: 'label', id, label }),
      adjust: (id, delta) => room.send('score', { action: 'adjust', id, delta }),
      remove: (id) => room.send('score', { action: 'remove', id }),
    };
    tbody.replaceChildren();
    room.state.scores.forEach((row, id) => tbody.appendChild(scoreRow(row, id, { canEdit, on })));
    if (!room.state.scores.size) tbody.appendChild(scoreEmptyRow());
  }

  function updateRoomNotes() {
    const room = getRoom();
    const el = byId('roomNotes');
    if (!el || !room || !room.state) return;
    if (document.activeElement === el) return; // don't stomp a GM mid-type
    const notes = room.state.notes || '';
    if (el.value !== notes) el.value = notes;
  }
  function bindRoom(room, cb) {
    cb(room.state).scores.onAdd((row) => {
      renderScores();
      cb(row).listen('score', renderScores, false);
      cb(row).listen('label', renderScores, false);
    });
    cb(room.state).scores.onRemove(() => renderScores());
    cb(room.state).listen('notes', updateRoomNotes, false);
  }
  function hydrate() {
    renderScores();
    updateRoomNotes();
  }
  function bindControls() {
    const room = getRoom();
    // Scoreboard + room notes content (now in the top-right region; opened via wireCluster)
    if (byId('scoreRows')) {
      byId('scoreAdd').onclick = () => {
        const n = byId('scoreAddName');
        room.send('score', { action: 'add', label: n.value.trim() || 'Player' });
        n.value = '';
      };
      byId('scoreAddName').onkeydown = (e) => {
        if (e.key === 'Enter') byId('scoreAdd').click();
      };
      byId('scoreClear').onclick = () => {
        if (confirm('Clear the whole scoreboard?')) room.send('score', { action: 'clear' });
      };
      const roomNotesEl = byId('roomNotes');
      let roomNotesTimer;
      roomNotesEl.oninput = () => {
        cancelDelay(roomNotesTimer);
        roomNotesTimer = delay(() => room.send('roomNotes', { text: roomNotesEl.value }), 400);
      };
      roomNotesEl.onblur = () => {
        cancelDelay(roomNotesTimer);
        room.send('roomNotes', { text: roomNotesEl.value });
      };
    }
  }
  return { bindRoom, hydrate, bindControls, applyRole, render: renderScores };
}
