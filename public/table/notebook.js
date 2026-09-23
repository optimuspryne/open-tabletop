export function createNotebook({ getRoom, byId, delay = setTimeout, cancelDelay = clearTimeout }) {
  function bindRoom(room) {
    room.onMessage('notebook', (text) => {
      byId('notesText').value = text || '';
    }); // private room-memory notes for this account
    room.send('notebookSync');
  }
  function bindControls() {
    const room = getRoom();
    const notesText = byId('notesText');
    let notesTimer = null;
    notesText.addEventListener('input', () => {
      // debounce so we persist without flooding the socket
      cancelDelay(notesTimer);
      notesTimer = delay(() => room.send('notebook', { text: notesText.value }), 400);
    });
  }
  return { bindRoom, bindControls };
}
