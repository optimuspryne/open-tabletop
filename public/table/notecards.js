import { NOTECARD, NOTECARD_COLORS, NOTECARD_WIDTHS } from '../../shared/notecards.js';
import { paintNotecard } from '../rendering/notecards.js';
import { createDrawingView } from './drawing-view.js';
import { applyIcons } from '../ui/icons.js';
import { attachDrawingControls } from './controls.js';

// This panel owns a private draft; only an acknowledged placement closes it.
export function createNotecardEditor({
  getRoom,
  byId,
  canInteract,
  beforeOpen,
  toast,
  repeat = setInterval,
  stopRepeat = clearInterval,
}) {
  const dialog = byId('notecardDialog');
  const canvas = byId('notecardCanvas');
  const context = canvas.getContext('2d');
  const view = createDrawingView();
  let pan = false,
    recipientKey = '';
  byId('notecardRecipient').add(new Option('Choose player…', ''));
  applyIcons(dialog);
  // Native titles remain visible above the dialog's top layer in compact mode.
  dialog.querySelectorAll('button[data-icon]').forEach((button) => {
    button.title = button.getAttribute('aria-label');
  });
  let current = null,
    opening = null,
    drawing = [],
    redo = [],
    undo = [],
    stroke = null;
  let busy = false,
    erase = false,
    color = NOTECARD_COLORS[0],
    width = NOTECARD_WIDTHS[1];
  let previousFocus = null,
    heartbeat = null;
  const status = (text) => {
    byId('notecardStatus').textContent = text;
  };
  const paint = () => {
    context.save();
    context.translate(view.x * canvas.width, view.y * canvas.height);
    context.scale(view.scale, view.scale);
    paintNotecard(context, stroke ? [...drawing, stroke] : drawing, { back: !!current?.back });
    context.restore();
    byId('notecardZoomLevel').textContent = Math.round(view.scale * 100) + '%';
    byId('notecardZoomOut').disabled = view.scale <= 1;
    byId('notecardZoomIn').disabled = view.scale >= 8;
  };
  function sync() {
    const editable = current?.token && !busy;
    byId('notecardTools').hidden = !current?.token;
    byId('notecardPlaceUp').hidden = byId('notecardPlaceDown').hidden = !current?.token;
    byId('notecardPlaceUp').disabled = byId('notecardPlaceDown').disabled = busy;
    byId('notecardTools').inert = !editable;
    byId('notecardUndo').disabled = !undo.length;
    byId('notecardRedo').disabled = !redo.length;
    byId('notecardClear').disabled = !drawing.length;
    byId('notecardPan').setAttribute('aria-pressed', String(pan));
    canvas.style.cursor = pan ? 'grab' : 'crosshair';
    byId('notecardPen').setAttribute('aria-pressed', String(!erase && !pan));
    byId('notecardEraser').setAttribute('aria-pressed', String(erase && !pan));
    byId('notecardCancel').disabled = busy;
    const label = current?.token ? 'Cancel' : 'Close';
    byId('notecardCancel').querySelector('.lbl').textContent = label;
    byId('notecardCancel').setAttribute('aria-label', label);
    byId('notecardCancel').title = label;
    for (const id of ['notecardKeep', 'notecardPassControls']) byId(id).hidden = !current?.token;
    byId('notecardKeep').disabled = busy;
    byId('notecardPass').disabled = busy || !byId('notecardRecipient').value;
    byId('notecardRecipient').disabled = busy;
  }
  function close(send = true) {
    if (send && busy) return; // a placement in flight must be acknowledged, never silently discarded
    if (send && current?.token)
      getRoom()?.send('notecardCancel', { id: current.id, token: current.token });
    drawingControls.reset();
    current = null;
    opening = null;
    stroke = null;
    drawing = [];
    redo = [];
    undo = [];
    busy = false;
    if (heartbeat) stopRepeat(heartbeat);
    heartbeat = null;
    dialog.close();
    paintNotecard(context, []); // release private pixels as well as draft data
    previousFocus?.focus?.();
    previousFocus = null;
  }
  function show(data) {
    current = data;
    view.reset();
    pan = false;
    refreshRecipients();
    drawing = structuredClone(data.drawing || []);
    redo = [];
    undo = [];
    stroke = null;
    busy = false;
    status(
      data.token
        ? 'Private drawing. Keep in hand, place on the table, or pass to a player.'
        : data.back
          ? 'This notecard is face-down.'
          : 'Viewing a notecard.',
    );
    sync();
    paint();
    dialog.showModal();
    byId(data.token ? 'notecardPen' : 'notecardCancel').focus();
    if (data.token)
      heartbeat = repeat(() => {
        if (current?.token)
          getRoom()?.send('notecardKeepAlive', { id: current.id, token: current.token });
      }, 20_000);
  }
  function open(id) {
    if (busy) return;
    close();
    const piece = getRoom()?.state.pieces.get(id);
    if (piece?.type !== 'notecard') return;
    previousFocus = document.activeElement;
    beforeOpen();
    if (!canInteract()) {
      const props = JSON.parse(piece.props || '{}');
      show({ id, drawing: props.drawing || [], back: props.faceDown || !!props.editing });
      return;
    }
    opening = id;
    getRoom().send('notecardEdit', { id });
  }
  function refreshRecipients() {
    const select = byId('notecardRecipient'),
      selected = select.value;
    const choices = [];
    getRoom()?.state.players?.forEach((player, sid) => {
      if (sid !== getRoom().sessionId && player.participation !== 'spectator' && !player.timedOut)
        choices.push([player.name || 'Player', sid]);
    });
    const key = JSON.stringify(choices);
    if (key === recipientKey) return; // Physics patches must not rebuild an open native select.
    recipientKey = key;
    select.replaceChildren(new Option('Choose player…', ''));
    for (const [name, sid] of choices) select.add(new Option(name, sid));
    select.value = choices.some(([, sid]) => sid === selected) ? selected : '';
  }
  function openHand(card) {
    if (busy || card.kind !== 'notecard') return;
    close();
    previousFocus = document.activeElement;
    beforeOpen();
    if (!canInteract()) {
      show({ id: 'hand:' + card.hid, hid: card.hid, drawing: card.drawing });
      return;
    }
    opening = 'hand:' + card.hid;
    getRoom().send('notecardEdit', { hid: card.hid });
  }
  function finishStroke() {
    if (!stroke) return;
    undo.push(drawing);
    if (undo.length > NOTECARD.maxStrokes) undo.shift();
    drawing = [...drawing, stroke];
    stroke = null;
    redo = [];
    paint();
    sync();
  }
  function history(action) {
    if (!current?.token || busy) return;
    finishStroke();
    if (action === 'undo' && undo.length) {
      redo.push(drawing);
      drawing = undo.pop();
    }
    if (action === 'redo' && redo.length) {
      undo.push(drawing);
      drawing = redo.pop();
    }
    if (action === 'clear' && drawing.length) {
      undo.push(drawing);
      drawing = [];
      redo = [];
    }
    paint();
    sync();
  }
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return view
      .point(
        Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      )
      .map((n) => Math.round(n * 10000) / 10000);
  };
  let used = 0;
  const screenPoint = ([x, y]) => {
    const rect = canvas.getBoundingClientRect();
    return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
  };
  const drawingControls = attachDrawingControls(canvas, {
    isPanning: () => pan,
    transform(from, to, factor) {
      view.transform(screenPoint(from), screenPoint(to), factor);
      paint();
    },
    press(event) {
      if (!current?.token || busy || !canInteract()) return false;
      used = drawing.reduce((sum, s) => sum + s.pts.length, 0);
      if (drawing.length >= NOTECARD.maxStrokes || used + 2 > NOTECARD.maxCoordinates) {
        status('Drawing limit reached. Undo or clear strokes to continue.');
        return false;
      }
      stroke = { pts: point(event), color, width, erase };
      paint();
      return true;
    },
    move(event) {
      if (!stroke) return;
      const next = point(event),
        pts = stroke.pts;
      if (Math.hypot(next[0] - pts.at(-2), next[1] - pts.at(-1)) < 0.0015) return;
      if (used + pts.length + 2 > NOTECARD.maxCoordinates) {
        status('Drawing limit reached. Undo or clear strokes to continue.');
        return;
      }
      if (pts.length + 2 > NOTECARD.maxStrokeCoordinates) {
        status('Lift the pen to start another stroke.');
        return;
      }
      pts.push(...next);
      paint();
    },
    release: finishStroke,
    cancel() {
      stroke = null;
      paint();
    },
  });
  for (const ink of NOTECARD_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notecard-ink';
    button.style.setProperty('--ink', ink);
    button.setAttribute('aria-label', `Ink ${ink}`);
    button.setAttribute('aria-pressed', String(ink === color));
    button.onclick = () => {
      finishStroke();
      color = ink;
      erase = false;
      pan = false;
      byId('notecardColors')
        .querySelectorAll('button')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      sync();
    };
    byId('notecardColors').append(button);
  }
  byId('notecardWidth').onchange = (event) => {
    finishStroke();
    width = NOTECARD_WIDTHS[Number(event.target.value)];
  };
  byId('notecardPen').onclick = () => {
    finishStroke();
    erase = false;
    pan = false;
    sync();
  };
  byId('notecardEraser').onclick = () => {
    finishStroke();
    erase = true;
    pan = false;
    sync();
  };
  for (const action of ['undo', 'redo', 'clear'])
    byId(`notecard${action[0].toUpperCase()}${action.slice(1)}`).onclick = () => history(action);
  byId('notecardPan').onclick = () => {
    finishStroke();
    pan = !pan;
    sync();
  };
  const zoom = (factor) => {
    finishStroke();
    view.transform([0.5, 0.5], [0.5, 0.5], factor);
    paint();
  };
  byId('notecardZoomIn').onclick = () => zoom(1.25);
  byId('notecardZoomOut').onclick = () => zoom(1 / 1.25);
  byId('notecardFit').onclick = () => {
    finishStroke();
    view.reset();
    paint();
  };
  byId('notecardRecipient').onchange = sync;
  byId('notecardCancel').onclick = () => close();
  const place = (faceDown, destination = 'table') => {
    if (!current?.token || busy) return;
    finishStroke();
    busy = true;
    sync();
    status('Saving drawing…');
    getRoom().send('notecardCommit', {
      id: current.id,
      token: current.token,
      drawing,
      faceDown,
      destination,
      recipient: byId('notecardRecipient').value,
    });
  };
  byId('notecardKeep').onclick = () => place(true, 'hand');
  byId('notecardPass').onclick = () => place(true, 'pass');
  byId('notecardPlaceUp').onclick = () => place(false);
  byId('notecardPlaceDown').onclick = () => place(true);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.target === canvas && ['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') byId('notecardFit').click();
      else zoom(event.key === '-' ? 1 / 1.25 : 1.25);
    }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
    }
  });
  function syncHand(cards) {
    if (!current?.hid || current.token) return;
    const card = cards.find((entry) => entry.hid === current.hid);
    if (!card) close(false);
    else {
      drawing = card.drawing || [];
      paint();
    }
  }
  function bindRoom(room) {
    room.onMessage('notecardEdit', (data) => {
      if (opening !== data.id || !canInteract()) {
        room.send('notecardCancel', { id: data.id, token: data.token });
        return;
      }
      opening = null;
      show(data);
    });
    room.onMessage('notecardClosed', (data) => {
      if (data.token !== current?.token) return;
      close(false);
      if (data.reason) toast(data.reason);
    });
    room.onMessage('serverError', ({ operation, message }) => {
      if (operation === 'notecardCommit' && current) {
        busy = false;
        sync();
        status(message);
      }
      if (operation === 'notecardEdit') opening = null;
    });
    room.onStateChange?.(() => {
      if (!current) return;
      refreshRecipients();
      sync();
      if (current.token || current.hid) return;
      const piece = room.state.pieces.get(current.id);
      if (!piece) {
        close(false);
        return;
      }
      const props = JSON.parse(piece.props || '{}');
      current.back = props.faceDown || !!props.editing;
      drawing = props.drawing || [];
      status(current.back ? 'This notecard is face-down.' : 'Viewing a notecard.');
      paint();
    });
    room.onLeave(() => close(false));
  }
  return {
    open,
    openHand,
    syncHand,
    bindRoom,
    cancel: () => close(false),
    isActive: () => !!current,
  };
}
