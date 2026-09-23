import { chatRow } from '../ui/rows.js';

export function createChat({ getRoom, byId }) {
  // Append one chat message to the log; auto-scroll if the reader's at the bottom,
  // and flag the Tools button as unread when the panel's closed.
  function addChatMsg(m) {
    const log = byId('chatLog');
    if (!log || !m) return;
    const mine = (m.from || '') === (byId('myName')?.textContent || '').trim();
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(chatRow(m, { mine }));
    if (atBottom) log.scrollTop = log.scrollHeight;
    const chatBtn = byId('chatBtn'),
      reg = byId('regionTL');
    const chatShowing = reg && !reg.hidden && reg.querySelector('.pane[data-pane="chat"].on');
    if (!chatShowing && chatBtn) chatBtn.classList.add('hasUnread');
  }
  function bindRoom(room) {
    room.onMessage('chatMsg', (m) => addChatMsg(m));
    room.onMessage('chatLog', ({ log } = {}) => {
      const el = byId('chatLog');
      if (el) el.replaceChildren();
      (log || []).forEach(addChatMsg);
    }); // late-join replay
    room.send('chatLog'); // refresh/reconnect: fetch room-memory history after the handler is ready
  }
  function bindControls() {
    const room = getRoom();
    {
      // Public chat panel (Tools)
      const input = byId('chatInput');
      if (input && byId('chatSend')) {
        const send = () => {
          const t = input.value.trim();
          if (t) {
            room.send('chat', { text: t });
            input.value = '';
          }
        };
        byId('chatSend').onclick = send;
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        };
      }
    }
  }
  return { bindRoom, bindControls };
}
