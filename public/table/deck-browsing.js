// A private card preview reuses inspection rendering; this controller owns only browsing UI/protocol.
export function createDeckBrowser({
  getRoom,
  inspection,
  byId,
  canInteract,
  toast,
  repeat = setInterval,
  stopRepeat = clearInterval,
}) {
  const panel = byId('deckBrowseActions');
  let nextRequest = 0;
  let current = null,
    opening = false,
    pending = false,
    heartbeat = null,
    previousFocus = null;
  function sync() {
    panel.hidden = !current;
    if (!current) return;
    byId('deckBrowsePosition').textContent = `${current.position} / ${current.count}`;
    panel.querySelectorAll('button').forEach((button) => {
      button.disabled = pending && button.id !== 'deckBrowseClose';
    });
    byId('deckBrowsePrevious').disabled = pending || current.position <= 1;
    byId('deckBrowseNext').disabled = pending || current.position >= current.count;
  }
  function close(send = true) {
    const old = current;
    current = null;
    opening = false;
    pending = false;
    panel.hidden = true;
    inspection.closeBrowseCard();
    if (send && old) getRoom()?.send('closeDeckBrowse', { token: old.token });
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }
  function step(direction) {
    if (!current || pending) return;
    pending = true;
    sync();
    getRoom().send('browseStep', { token: current.token, revision: current.revision, direction });
  }
  byId('deckBrowsePrevious').onclick = () => step(-1);
  byId('deckBrowseNext').onclick = () => step(1);
  byId('deckBrowseClose').onclick = () => close();
  panel.querySelectorAll('[data-browse-action]').forEach((button) => {
    button.onclick = () => {
      if (!current || pending) return;
      pending = true;
      sync();
      getRoom().send('browseAction', {
        token: current.token,
        revision: current.revision,
        entryToken: current.entryToken,
        action: button.dataset.browseAction,
        requestId: String(++nextRequest),
      });
    };
  });
  panel.addEventListener('keydown', (event) => {
    event.stopPropagation(); // browsing keys never become table manipulation intents
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  function open(deckId) {
    if (!canInteract()) return;
    close();
    inspection.cancel();
    previousFocus = document.activeElement;
    opening = deckId;
    getRoom().send('browseDeck', { deckId });
  }
  function bindRoom(room) {
    room.onMessage('deckBrowseCard', (card) => {
      if (!canInteract() || (opening ? opening !== card.deckId : current?.token !== card.token)) {
        room.send('closeDeckBrowse', { token: card.token });
        return;
      }
      const first = !current;
      current = card;
      opening = false;
      pending = false;
      inspection.showBrowseCard(
        { front: card.front, back: card.back, tile: card.tile, geom: card.geom },
        () => close(),
      );
      sync();
      if (first) panel.focus();
    });
    room.onMessage('deckBrowseClosed', (message) => {
      if (current?.token !== message.token) return;
      close(false);
      toast(message.reason);
    });
    room.onMessage('serverError', ({ operation }) => {
      if (
        ['deckBrowse', 'browseDeck', 'browseStep', 'browseAction', 'browseKeepAlive'].includes(
          operation,
        )
      ) {
        opening = false;
        pending = false;
        sync();
      }
    });
    // Read the authoritative next preview before enabling another action.
    room.onMessage('deckBrowseActionDone', () => {});
    heartbeat = repeat(() => {
      if (current && !pending && canInteract())
        room.send('browseKeepAlive', { token: current.token, revision: current.revision });
    }, 20_000);
    room.onLeave(() => {
      stopRepeat(heartbeat);
      close(false);
    });
  }
  return { open, bindRoom, cancel: () => close() };
}
