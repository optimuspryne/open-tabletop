import {
  NOTECARD,
  NOTECARD_COLORS,
  NOTECARD_WIDTHS,
  normalizeNotecardPaper,
  normalizeNotecardTextBoxes,
  normalizeNotecardContent,
} from '../../shared/notecards.js';
import { paintNotecard } from '../rendering/notecards.js';
import { createNotecardTextEditor } from './notecard-text.js';
import { notecardShapePoints } from './notecard-shapes.js';
import { createDrawingView } from './drawing-view.js';
import { applyIcons } from '../ui/icons.js';
import { attachDrawingControls } from './controls.js';

const CURSOR_STEP = 0.01; // fraction of visible canvas width per arrow-key step

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
  let paper = normalizeNotecardPaper(),
    tool = 'pen',
    constrain = false;
  let keyboard = false,
    cursor = [0.5, 0.5],
    strokeStart = null;
  const toolIds = {
    pen: 'notecardPen',
    eraser: 'notecardEraser',
    line: 'notecardLine',
    rectangle: 'notecardRectangle',
    ellipse: 'notecardEllipse',
    text: 'notecardText',
  };
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
    textBoxes = [],
    redo = [],
    undo = [],
    stroke = null;
  let busy = false,
    color = NOTECARD_COLORS[0],
    width = NOTECARD_WIDTHS[1];
  const hasDraft = () => !!(current?.token || current?.localDraft);
  let templateControls = null,
    generation = 0;
  let previousFocus = null,
    heartbeat = null;
  const status = (text) => {
    byId('notecardStatus').textContent = text;
  };
  const paint = () => {
    context.save();
    context.translate(view.x * canvas.width, view.y * canvas.height);
    context.scale(view.scale, view.scale);
    paintNotecard(context, stroke ? [...drawing, stroke] : drawing, {
      back: !!current?.back,
      paper,
      textBoxes,
    });
    context.restore();
    canvas.setAttribute(
      'aria-label',
      current?.back
        ? 'Face-down notecard'
        : 'Notecard drawing surface' +
            (textBoxes.length ? ': ' + textBoxes.map((box) => box.text).join(' · ') : ''),
    );
    textEditor.updateOverlay();
    if (keyboard && hasDraft() && !busy) {
      const x = cursor[0] * canvas.width,
        y = cursor[1] * canvas.height;
      context.save();
      context.strokeStyle = '#202830';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(x, y, 9, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }
    byId('notecardZoomLevel').textContent = Math.round(view.scale * 100) + '%';
    byId('notecardZoomOut').disabled = view.scale <= 1;
    byId('notecardZoomIn').disabled = view.scale >= 8;
  };
  function sync() {
    const editable = hasDraft() && !busy;
    textEditor.sync();
    const invalidText = !!textEditor.error();
    byId('notecardTools').hidden = !hasDraft();
    byId('notecardPlaceUp').hidden = byId('notecardPlaceDown').hidden = !hasDraft();
    byId('notecardPlaceUp').disabled = byId('notecardPlaceDown').disabled = busy || invalidText;
    byId('notecardTools').inert = !editable;
    byId('notecardInkTools').hidden = byId('notecardColors').hidden = tool === 'text';
    byId('notecardUndo').disabled = !undo.length;
    byId('notecardRedo').disabled = !redo.length;
    byId('notecardClear').disabled = !drawing.length;
    byId('notecardPan').setAttribute('aria-pressed', String(pan));
    canvas.style.cursor = pan ? 'grab' : 'crosshair';
    for (const [name, id] of Object.entries(toolIds))
      byId(id).setAttribute('aria-pressed', String(tool === name && !pan));
    byId('notecardConstrain').setAttribute('aria-pressed', String(constrain));
    byId('notecardConstrain').disabled = ['pen', 'eraser', 'text'].includes(tool) || pan;
    byId('notecardPattern').value = paper.pattern;
    byId('notecardTone').value = paper.tone;
    byId('notecardDrawingHelp').hidden = !hasDraft() || tool === 'text';
    canvas.setAttribute(
      'aria-describedby',
      tool === 'text' ? 'notecardTextHelp' : 'notecardDrawingHelp',
    );
    byId('notecardCancel').disabled = busy;
    const label = hasDraft() ? 'Cancel' : 'Close';
    byId('notecardCancel').querySelector('.lbl').textContent = label;
    byId('notecardCancel').setAttribute('aria-label', label);
    byId('notecardCancel').title = label;
    for (const id of ['notecardKeep', 'notecardPassControls']) byId(id).hidden = !hasDraft();
    byId('notecardKeep').disabled = busy || invalidText;
    byId('notecardReturn').hidden = !hasDraft() || !current?.fromStack;
    byId('notecardReturn').disabled = busy || invalidText;
    byId('notecardPass').disabled = busy || invalidText || !byId('notecardRecipient').value;
    byId('notecardRecipient').disabled = busy;
    byId('notecardTemplateSave').hidden = !hasDraft();
    byId('notecardTemplateSave').disabled = busy || invalidText || !canInteract();
    templateControls?.sync();
  }
  function close(send = true) {
    if (send && busy) return; // a placement in flight must be acknowledged, never silently discarded
    if (send && current?.token)
      getRoom()?.send('notecardCancel', { id: current.id, token: current.token });
    generation++;
    templateControls?.reset();
    drawingControls.reset();
    current = null;
    opening = null;
    stroke = null;
    drawing = [];
    textBoxes = [];
    textEditor.reset();
    canvas.setAttribute('aria-label', 'Notecard drawing surface');
    paper = normalizeNotecardPaper();
    keyboard = false;
    strokeStart = null;
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
    byId('notecardTitle').textContent = 'Notecard';
    paper = normalizeNotecardPaper(data.paper) || normalizeNotecardPaper();
    keyboard = false;
    cursor = [0.5, 0.5];
    view.reset();
    pan = false;
    refreshRecipients();
    drawing = structuredClone(data.drawing || []);
    textBoxes = normalizeNotecardTextBoxes(data.textBoxes) || [];
    textEditor.reset();
    redo = [];
    undo = [];
    stroke = null;
    busy = false;
    status(
      data.localDraft
        ? 'New private draft. Save a template, keep in hand, or place a copy.'
        : data.token
          ? data.fromStack
            ? 'Private top card. Return to top saves it inside the stack; Cancel keeps the original.'
            : 'Private drawing. Keep in hand, place on the table, or pass to a player.'
          : data.back
            ? 'This notecard is face-down.'
            : 'Viewing a notecard.',
    );
    sync();
    paint();
    dialog.showModal();
    byId(hasDraft() ? toolIds[tool] : 'notecardCancel').focus();
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
    if (!['notecard', 'notecardStack'].includes(piece?.type)) return;
    previousFocus = document.activeElement;
    beforeOpen();
    if (!canInteract()) {
      const props = JSON.parse(piece.props || '{}');
      show({
        id,
        drawing: props.drawing || [],
        paper: props.paper,
        textBoxes: props.textBoxes,
        back: piece.type === 'notecardStack' || props.faceDown || !!props.editing,
      });
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
      show({
        id: 'hand:' + card.hid,
        hid: card.hid,
        drawing: card.drawing,
        paper: card.paper,
        textBoxes: card.textBoxes,
      });
      return;
    }
    opening = 'hand:' + card.hid;
    getRoom().send('notecardEdit', { hid: card.hid });
  }
  function finishStroke() {
    if (!stroke) return;
    remember();
    drawing = [...drawing, stroke];
    stroke = null;
    redo = [];
    paint();
    sync();
  }
  const snapshot = () => ({ drawing, textBoxes });
  function remember() {
    undo.push(snapshot());
    if (undo.length > NOTECARD.maxStrokes) undo.shift();
    redo = [];
  }
  function history(action) {
    if (!hasDraft() || busy) return;
    finishStroke();
    textEditor.release();
    textEditor.endEdit();
    if (action === 'undo' && undo.length) {
      redo.push(snapshot());
      ({ drawing, textBoxes } = undo.pop());
    }
    if (action === 'redo' && redo.length) {
      undo.push(snapshot());
      ({ drawing, textBoxes } = redo.pop());
    }
    if (action === 'clear' && drawing.length) {
      remember();
      drawing = [];
    }
    sync();
    paint();
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
  const textEditor = createNotecardTextEditor({
    byId,
    canvas,
    view,
    getBoxes: () => textBoxes,
    setBoxes: (boxes) => {
      textBoxes = boxes;
    },
    editable: () => hasDraft() && !busy && canInteract(),
    active: () => hasDraft() && tool === 'text' && !pan,
    remember,
    changed: () => {
      sync();
      paint();
    },
    status,
  });
  function beginStroke(position, locked = false) {
    if (!hasDraft() || busy || !canInteract()) return false;
    used = drawing.reduce((sum, s) => sum + s.pts.length, 0);
    const pts = ['pen', 'eraser'].includes(tool)
      ? position
      : notecardShapePoints(tool, position, position, constrain || locked);
    if (drawing.length >= NOTECARD.maxStrokes || used + pts.length > NOTECARD.maxCoordinates) {
      status('Drawing limit reached. Undo or clear strokes to continue.');
      return false;
    }
    strokeStart = position;
    stroke = { pts, color, width, erase: tool === 'eraser' };
    paint();
    return true;
  }
  function extendStroke(next, locked = false) {
    if (!stroke) return;
    if (!['pen', 'eraser'].includes(tool)) {
      stroke.pts = notecardShapePoints(tool, strokeStart, next, constrain || locked);
    } else {
      const pts = stroke.pts;
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
    }
    paint();
  }
  const drawingControls = attachDrawingControls(
    byId('notecardStage'),
    {
      ownsKeyboardTarget: (target) => textEditor.owns(target),
      isPanning: () => pan,
      transform(from, to, factor) {
        view.transform(screenPoint(from), screenPoint(to), factor);
        paint();
      },
      press(event) {
        keyboard = false;
        stroke = null;
        return tool === 'text'
          ? textEditor.press(point(event), event)
          : beginStroke(point(event), event.additive);
      },
      move(event) {
        if (tool === 'text') textEditor.move(point(event));
        else extendStroke(point(event), event.additive);
      },
      release() {
        if (tool === 'text') textEditor.release();
        else finishStroke();
      },
      cancel() {
        textEditor.cancel();
        stroke = null;
        paint();
      },
      command(event, target) {
        if (!hasDraft() || busy || !canInteract() || pan) return false;
        if (tool === 'text') return textEditor.command(event, target);
        const deltas = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        if (event.key === 'Escape' && keyboard && stroke) {
          stroke = null;
          paint();
          status('Stroke canceled.');
          return true;
        }
        if (event.key !== 'Enter' && !deltas[event.key]) return false;
        keyboard = true;
        if (event.key === 'Enter') {
          if (!event.repeat) {
            if (stroke) finishStroke();
            else if (beginStroke(view.point(...cursor), event.shiftKey))
              status('Start set. Move with arrows; Enter to finish, Escape to cancel.');
          }
        } else {
          const [dx, dy] = deltas[event.key];
          cursor = [
            Math.max(0, Math.min(1, cursor[0] + dx * CURSOR_STEP)),
            Math.max(0, Math.min(1, cursor[1] + (dy * CURSOR_STEP * canvas.width) / canvas.height)),
          ];
          const position = view.point(...cursor);
          extendStroke(position, event.shiftKey);
          status(
            `Cursor ${Math.round(position[0] * 100)}%, ${Math.round(position[1] * 100)}%. ${stroke ? 'Enter to finish.' : 'Enter to start.'}`,
          );
        }
        paint();
        return true;
      },
      blur() {
        if (keyboard) {
          stroke = null;
          keyboard = false;
          paint();
        }
      },
    },
    canvas,
  );
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
      if (tool === 'eraser') tool = 'pen';
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
  for (const [name, id] of Object.entries(toolIds))
    byId(id).onclick = () => {
      finishStroke();
      textEditor.endEdit();
      keyboard = false;
      tool = name;
      pan = false;
      sync();
      paint();
      status(
        name === 'text'
          ? 'Text selected. Add a box or choose an existing one to edit.'
          : `${name[0].toUpperCase() + name.slice(1)} selected.`,
      );
    };
  byId('notecardConstrain').title =
    'Square, circle, or line in 45° steps. Also available with Shift.';
  const instructions = byId('notecardDrawingHelp').textContent;
  for (const id of [...Object.values(toolIds), 'notecardConstrain']) {
    const button = byId(id);
    button.setAttribute(
      'aria-describedby',
      id === 'notecardText' ? 'notecardTextHelp' : 'notecardDrawingHelp',
    );
    // Native hover titles also have a visible keyboard/touch-focus equivalent.
    button.addEventListener('focus', () => {
      byId('notecardDrawingHelp').textContent = `${button.title}. ${instructions}`;
    });
    button.addEventListener('blur', () => {
      byId('notecardDrawingHelp').textContent = instructions;
    });
  }
  byId('notecardConstrain').onclick = () => {
    finishStroke();
    constrain = !constrain;
    sync();
    status(
      constrain ? 'Constrain on: squares, circles, and lines in 45° steps.' : 'Constrain off.',
    );
  };
  for (const [id, key] of [
    ['notecardPattern', 'pattern'],
    ['notecardTone', 'tone'],
  ])
    byId(id).onchange = (event) => {
      finishStroke();
      paper = { ...paper, [key]: event.target.value };
      paint();
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
    if (!hasDraft() || busy) return;
    finishStroke();
    textEditor.release();
    textEditor.endEdit();
    if (textEditor.error()) {
      status(textEditor.error());
      return;
    }
    busy = true;
    sync();
    status('Saving drawing…');
    if (current.localDraft) {
      current.request ||= crypto.randomUUID();
      getRoom().send('notecardCreate', {
        request: current.request,
        content: { drawing, paper, textBoxes },
        faceDown,
        destination,
        recipient: byId('notecardRecipient').value,
      });
      return;
    }
    getRoom().send('notecardCommit', {
      id: current.id,
      token: current.token,
      drawing,
      paper,
      textBoxes,
      faceDown,
      destination,
      recipient: byId('notecardRecipient').value,
    });
  };
  byId('notecardReturn').onclick = () => place(true, 'stack');
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
    if (event.target.closest('#notecardTemplatePanel')) return;
    if (event.target === canvas && ['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') byId('notecardFit').click();
      else zoom(event.key === '-' ? 1 / 1.25 : 1.25);
    }
    if (
      !event.isComposing &&
      (event.ctrlKey || event.metaKey) &&
      ['z', 'y'].includes(event.key.toLowerCase())
    ) {
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
      paper = normalizeNotecardPaper(card.paper) || normalizeNotecardPaper();
      textBoxes = normalizeNotecardTextBoxes(card.textBoxes) || [];
      paint();
    }
  }
  function bindRoom(room) {
    room.onMessage('notecardCreated', (data) => {
      if (current?.localDraft && busy && data.request === current.request) close(false);
    });
    room.onMessage('notecardEdit', (data) => {
      if (opening !== data.id || !canInteract()) {
        room.send('notecardCancel', { id: data.id, token: data.token });
        return;
      }
      opening = null;
      show(data);
    });
    room.onMessage('notecardClosed', (data) => {
      if (!current?.token || data.token !== current.token) return;
      close(false);
      if (data.reason) toast(data.reason);
    });
    room.onMessage('serverError', ({ operation, message }) => {
      if (
        current &&
        (operation === 'notecardCommit' ||
          (operation === 'notecardCreate' && current.localDraft && busy))
      ) {
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
      if (current.localDraft && !canInteract()) {
        close(false);
        return;
      }
      if (current.token || current.hid || current.localDraft) return;
      const piece = room.state.pieces.get(current.id);
      if (!piece) {
        close(false);
        return;
      }
      const props = JSON.parse(piece.props || '{}');
      current.back = props.faceDown || !!props.editing;
      drawing = props.drawing || [];
      paper = normalizeNotecardPaper(props.paper) || normalizeNotecardPaper();
      textBoxes = normalizeNotecardTextBoxes(props.textBoxes) || [];
      status(current.back ? 'This notecard is face-down.' : 'Viewing a notecard.');
      paint();
    });
    room.onLeave(() => close(false));
  }
  return {
    templateContext: () => ({
      editable: hasDraft() && canInteract(),
      busy,
      generation,
      template: current?.template || null,
    }),
    attachTemplates: (controls) => {
      templateControls = controls;
    },
    templateBusy: (value) => {
      busy = value;
      sync();
    },
    templateSaved: (template) => {
      if (current) current.template = template;
    },
    capture: () => {
      if (!hasDraft() || busy || !canInteract())
        throw new Error('Open an editable notecard first.');
      finishStroke();
      textEditor.release();
      textEditor.endEdit();
      if (textEditor.error()) throw new Error(textEditor.error());
      return structuredClone({ drawing, paper, textBoxes });
    },
    openTemplate: (template, editing = false) => {
      if (busy || !canInteract()) return false;
      const content = normalizeNotecardContent(template.content);
      if (!content) return false;
      close();
      previousFocus = document.activeElement;
      beforeOpen();
      show({ ...content, localDraft: true, template: editing ? template : null });
      byId('notecardTitle').textContent = editing ? 'Edit template: ' + template.name : 'Notecard';
      return true;
    },
    open,
    openHand,
    syncHand,
    bindRoom,
    cancel: () => close(false),
    isActive: () => !!current,
  };
}
