import { ROOM_MESSAGE_CAPABILITIES } from '../../shared/room-capabilities.js';

export function canInteractWithTable(room) {
  const player = room?.state?.players?.get(room.sessionId);
  return !!room?.state?.pieces && player?.timedOut === false && player?.participation === 'player';
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
  setIcon,
  setBtnLabel,
  canChoose = () => true,
  toast = () => {},
  doc = document,
  observe = (fn) => new MutationObserver(fn),
}) {
  let wasAllowed = null;
  let pending = false;
  const syncControls = () => {
    const room = getRoom();
    const allowed = canInteractWithTable(room);
    const notice = doc.getElementById('participationNotice');
    const player = room?.state?.players?.get(room.sessionId);
    const timedOut = player?.timedOut === true;
    const spectating = player?.participation === 'spectator';
    const button = doc.getElementById('participationBtn');
    if (button) {
      button.hidden = !canChoose();
      button.disabled =
        pending || !room?.state?.pieces || !['player', 'spectator'].includes(player?.participation);
      const label = spectating ? 'Return to play' : 'Spectate';
      if (button.textContent !== label) setBtnLabel(button, label);
      setIcon(button, spectating ? 'device-gamepad' : 'eye');
      button.setAttribute('aria-pressed', String(spectating));
    }
    if (notice) {
      notice.hidden = allowed;
      const text = timedOut
        ? 'You are in time-out. You can chat, move the camera and inspect public objects or your hand. A GM can restore interaction.'
        : spectating
          ? 'You are spectating. You can chat, move the camera and inspect public objects or your hand. Choose Return to play in More when ready.'
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
      cb(player).listen('participation', syncControls);
      syncControls();
    });
    cb(room.state).players.onRemove(syncControls);
    room.onStateChange(syncControls);
    const button = doc.getElementById('participationBtn');
    if (button)
      button.onclick = () => {
        if (button.disabled || !canChoose()) return;
        const player = room.state.players.get(room.sessionId);
        pending = true;
        room.send('setParticipation', {
          participation: player.participation === 'spectator' ? 'player' : 'spectator',
        });
        syncControls();
      };
    room.onMessage('participationSet', ({ participation }) => {
      pending = false;
      syncControls();
      toast(participation === 'spectator' ? 'Spectator mode enabled' : 'Returned to play');
    });
    room.onMessage('serverError', ({ operation }) => {
      if (operation === 'setParticipation') {
        pending = false;
        syncControls();
      }
    });
    const observer = observe(syncControls);
    observer.observe(doc.body, { childList: true, subtree: true });
    room.onLeave(() => {
      observer.disconnect();
    });
    syncControls();
  }
  return { bindRoom, canInteract: () => canInteractWithTable(getRoom()), syncControls };
}
