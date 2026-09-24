import { ROOM_MESSAGE_CAPABILITIES } from '../../shared/room-capabilities.js';

export function canInteractWithTable(room) {
  const player = room?.state?.players?.get(room.sessionId);
  return !!room?.state?.pieces && player?.timedOut === false;
}

export function canSendTableRequest(room, type, message) {
  const capability = Object.hasOwn(ROOM_MESSAGE_CAPABILITIES, type)
    ? ROOM_MESSAGE_CAPABILITIES[type]
    : null;
  if (!capability) return false;
  const spawns =
    ((type === 'deckFinish' || type === 'saveMat') && message?.spawn !== false) ||
    (type === 'saveProp' && message?.spawn === true);
  return (capability !== 'gameplay' && !spawns) || canInteractWithTable(room);
}

// One per joined room. This mirrors the server policy for every existing caller,
// including the library panel, while input controllers cancel their local state.
export function createParticipation({
  getRoom,
  onBlocked,
  doc = document,
  observe = (fn) => new MutationObserver(fn),
}) {
  let wasAllowed = null;
  const syncControls = () => {
    const room = getRoom();
    const allowed = canInteractWithTable(room);
    const notice = doc.getElementById('participationNotice');
    const timedOut = room?.state?.players?.get(room.sessionId)?.timedOut === true;
    if (notice) {
      notice.hidden = allowed;
      const text = timedOut
        ? 'You are in time-out. You can chat, move the camera and inspect public objects or your hand. A GM can restore interaction.'
        : 'Loading your table access…';
      if (notice.textContent !== text) notice.textContent = text;
    }
    doc
      .querySelectorAll(
        '[data-room-mutation], #scoreRows button, #scoreRows input, #trayTools > .pop-group, #selBars, .selectTool, #unclaimedHands, .turnOrderControls',
      )
      .forEach((element) => {
        element.inert = !allowed;
        element.classList.toggle('participation-disabled', !allowed);
        if (allowed) element.removeAttribute('aria-disabled');
        else element.setAttribute('aria-disabled', 'true');
      });
    const becameBlocked = !allowed && wasAllowed !== false;
    wasAllowed = allowed;
    if (becameBlocked) onBlocked();
  };
  function bindRoom(room, cb) {
    const send = room.send.bind(room);
    room.send = (type, message) => {
      if (!canSendTableRequest(room, type, message)) return false;
      send(type, message);
      return true;
    };
    cb(room.state).players.onAdd((player) => {
      cb(player).listen('timedOut', syncControls);
      syncControls();
    });
    cb(room.state).players.onRemove(syncControls);
    room.onStateChange(syncControls);
    const observer = observe(syncControls);
    observer.observe(doc.body, { childList: true, subtree: true });
    room.onLeave(() => {
      observer.disconnect();
    });
    syncControls();
  }
  return { bindRoom, canInteract: () => canInteractWithTable(getRoom()), syncControls };
}
