import {
  NOTECARD_COLORS,
  NOTECARD_TEXT,
  normalizeNotecardTextBoxes,
} from '../../shared/notecards.js';
import { layoutNotecardText } from '../rendering/notecard-text.js';
import { applyIcons } from '../ui/icons.js';

const MOVE_STEP = 0.01;
const INK_NAMES = ['Charcoal', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White'];

// Text-specific selection and gestures; the parent owns content, permissions and combined history.
export function createNotecardTextEditor({
  byId,
  canvas,
  view,
  getBoxes,
  setBoxes,
  editable,
  active,
  remember,
  changed,
  status,
}) {
  const panel = byId('notecardTextPanel'),
    overlay = byId('notecardTextOverlay');
  const picker = byId('notecardTextPicker'),
    input = byId('notecardTextContent');
  const context = canvas.getContext('2d');
  let selected = null,
    typing = false,
    gesture = null,
    pickerKey = '';
  const nodes = new Map();
  const selection = () => getBoxes().find((box) => box.id === selected);
  const layout = (box) => layoutNotecardText(context, box);
  const error = () =>
    !normalizeNotecardTextBoxes(getBoxes())
      ? 'Text limit reached. Use up to 8 boxes and 500 characters per box.'
      : getBoxes().some((box) => layout(box).overflow)
        ? 'Text extends past the card. Move it up, widen the box, reduce its size, or shorten it before saving.'
        : '';
  function replace(box) {
    box = {
      ...box,
      ...Object.fromEntries(
        ['x', 'y', 'w'].map((key) => [key, Math.round(box[key] * 10000) / 10000]),
      ),
    };
    box.w = Math.min(box.w, Math.round((1 - box.x) * 10000) / 10000);
    setBoxes(getBoxes().map((entry) => (entry.id === box.id ? box : entry)));
  }
  function endEdit() {
    typing = false;
  }
  function select(id) {
    endEdit();
    selected = id;
    changed();
  }
  function sync() {
    const visible = active();
    panel.hidden = overlay.hidden = !visible;
    panel.inert = !editable();
    overlay.inert = !editable();
    byId('notecardDialog').classList.toggle('has-text-tool', visible);
    if (!selection()) selected = getBoxes()[0]?.id ?? null;
    const box = selection();
    const key = JSON.stringify(
      getBoxes().map((entry) => [entry.id, entry.text.split('\n')[0].slice(0, 40)]),
    );
    if (key !== pickerKey) {
      pickerKey = key;
      picker.replaceChildren(
        ...getBoxes().map(
          (entry) =>
            new Option(entry.text.split('\n')[0].slice(0, 40) || 'Empty text box', entry.id),
        ),
      );
      if (!getBoxes().length) picker.add(new Option('No text boxes', ''));
    }
    picker.value = box ? String(box.id) : '';
    picker.disabled = !box;
    for (const id of [
      'notecardTextContent',
      'notecardTextSize',
      'notecardTextAlign',
      'notecardTextColor',
      'notecardTextDelete',
    ])
      byId(id).disabled = !box;
    byId('notecardTextAdd').disabled = getBoxes().length >= NOTECARD_TEXT.maxBoxes;
    // Assign only changed values: physics patches must not move the caret or disrupt IME input.
    if (input.value !== (box?.text || '')) input.value = box?.text || '';
    if (box) {
      byId('notecardTextSize').value = String(box.size);
      byId('notecardTextAlign').value = box.align;
      byId('notecardTextColor').value = box.color;
    }
    byId('notecardTextError').textContent = error();
    byId('notecardTextError').hidden = !editable() || !byId('notecardTextError').textContent;
    updateOverlay();
  }
  function updateOverlay() {
    for (const [id, node] of nodes)
      if (!getBoxes().some((box) => box.id === id)) {
        node.button.remove();
        node.handle.remove();
        nodes.delete(id);
      }
    for (const box of getBoxes()) {
      let node = nodes.get(box.id);
      if (!node) {
        const button = document.createElement('button'),
          handle = document.createElement('button');
        button.type = handle.type = 'button';
        button.className = 'notecard-text-box';
        handle.className = 'notecard-text-resize';
        button.dataset.textId = handle.dataset.textId = String(box.id);
        button.setAttribute('aria-describedby', 'notecardTextHelp');
        handle.setAttribute('aria-label', 'Resize text box width');
        handle.setAttribute('aria-describedby', 'notecardTextHelp');
        handle.dataset.icon = 'arrow-autofit-width';
        overlay.append(button, handle);
        applyIcons(overlay);
        handle.title = 'Resize text box width. Drag or use left/right arrow keys.';
        for (const control of [button, handle])
          control.addEventListener('focus', () => {
            if (selected !== box.id) select(box.id);
            status(
              control === handle
                ? handle.title
                : 'Text box selected. Arrows move, Shift + left/right resize, Enter edits.',
            );
          });
        nodes.set(box.id, (node = { button, handle }));
      }
      const height = Math.min(1 - box.y, layout(box).height);
      const left = (view.x + box.x * view.scale) * 100;
      const top = (view.y + box.y * view.scale) * 100;
      Object.assign(node.button.style, {
        left: left + '%',
        top: top + '%',
        width: box.w * view.scale * 100 + '%',
        height: height * view.scale * 100 + '%',
      });
      node.button.setAttribute('aria-label', 'Text box: ' + (box.text || 'empty'));
      node.button.setAttribute('aria-pressed', String(selected === box.id));
      node.button.title = box.text || 'Empty text box';
      node.handle.hidden = selected !== box.id;
      Object.assign(node.handle.style, {
        left: left + box.w * view.scale * 100 + '%',
        top: top + '%',
      });
    }
  }
  function add() {
    if (!editable() || getBoxes().length >= NOTECARD_TEXT.maxBoxes) return;
    endEdit();
    remember();
    let id = 1;
    while (getBoxes().some((box) => box.id === id)) id++;
    setBoxes([
      ...getBoxes(),
      {
        id,
        text: 'New text box',
        x: 0.1,
        y: 0.1,
        w: 0.7,
        size: 0.04,
        color: NOTECARD_COLORS[0],
        align: 'left',
      },
    ]);
    selected = id;
    changed();
    input.focus();
    input.select();
    status('Text box added. Type to replace its text.');
  }
  function remove() {
    if (!editable() || !selection()) return;
    endEdit();
    remember();
    setBoxes(getBoxes().filter((box) => box.id !== selected));
    selected = null;
    changed();
    (getBoxes().length ? picker : byId('notecardTextAdd')).focus();
    status('Text box deleted. Undo restores it.');
  }
  picker.onchange = () => select(Number(picker.value));
  byId('notecardTextAdd').onclick = add;
  byId('notecardTextAdd').setAttribute('aria-label', 'Add text box');
  byId('notecardTextAdd').title = 'Add text box';
  byId('notecardTextDelete').onclick = remove;
  input.maxLength = NOTECARD_TEXT.maxLength;
  input.addEventListener('blur', endEdit);
  input.addEventListener('input', () => {
    if (!editable() || !selection()) return;
    if (!typing) {
      remember();
      typing = true;
    }
    replace({ ...selection(), text: input.value });
    changed();
  });
  NOTECARD_COLORS.forEach((color, i) =>
    byId('notecardTextColor').add(new Option(INK_NAMES[i], color)),
  );
  for (const [id, key] of [
    ['notecardTextSize', 'size'],
    ['notecardTextAlign', 'align'],
    ['notecardTextColor', 'color'],
  ])
    byId(id).onchange = () => {
      if (!editable() || !selection()) return;
      endEdit();
      remember();
      replace({ ...selection(), [key]: key === 'size' ? Number(byId(id).value) : byId(id).value });
      changed();
    };
  function press(position, event) {
    if (!editable()) return false;
    endEdit();
    // Handle hit targets use rendered pixels and match desktop/coarse-pointer CSS sizes.
    const box = selection(),
      handle = box && nodes.get(box.id)?.handle.getBoundingClientRect();
    const resize =
      handle &&
      !nodes.get(box.id).handle.hidden &&
      event.clientX >= handle.left &&
      event.clientX <= handle.right &&
      event.clientY >= handle.top &&
      event.clientY <= handle.bottom;
    const hit = resize
      ? box
      : [...getBoxes()]
          .reverse()
          .find(
            (b) =>
              position[0] >= b.x &&
              position[0] <= b.x + b.w &&
              position[1] >= b.y &&
              position[1] <= b.y + layout(b).height,
          );
    if (!hit) {
      status('Choose Add to create a text box, or select an existing box.');
      return true;
    }
    selected = hit.id;
    gesture = { before: getBoxes(), box: hit, start: position, resize: !!resize };
    changed();
    return true;
  }
  function move(position) {
    if (!gesture) return;
    const { box, start, resize } = gesture;
    const next = { ...box };
    if (resize)
      next.w = Math.max(
        NOTECARD_TEXT.minWidth,
        Math.min(1 - box.x, box.w + position[0] - start[0]),
      );
    else {
      next.x = Math.max(0, Math.min(1 - box.w, box.x + position[0] - start[0]));
      next.y = Math.max(
        0,
        Math.min(Math.max(0, 1 - layout(box).height), box.y + position[1] - start[1]),
      );
    }
    replace(next);
    changed();
  }
  function release() {
    if (!gesture) return;
    const after = getBoxes(),
      before = gesture.before;
    gesture = null;
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      setBoxes(before);
      remember();
      setBoxes(after);
    }
    changed();
  }
  function cancel() {
    if (gesture) {
      setBoxes(gesture.before);
      gesture = null;
      changed();
    }
  }
  function command(event, target) {
    if (!editable()) return false;
    if (event.key === 'Escape' && gesture) {
      cancel();
      return true;
    }
    const box = selection();
    if (event.key === 'Enter') {
      if (!event.repeat) {
        if (box) input.focus();
        else add();
      }
      return true;
    }
    if (!box) return false;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      remove();
      return true;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
    endEdit();
    remember();
    const next = { ...box },
      dx = event.key === 'ArrowLeft' ? -MOVE_STEP : event.key === 'ArrowRight' ? MOVE_STEP : 0;
    if (event.shiftKey || target === nodes.get(box.id)?.handle)
      next.w = Math.max(NOTECARD_TEXT.minWidth, Math.min(1 - box.x, box.w + dx));
    else {
      next.x = Math.max(0, Math.min(1 - box.w, box.x + dx));
      next.y = Math.max(
        0,
        Math.min(
          Math.max(0, 1 - layout(box).height),
          box.y +
            (event.key === 'ArrowUp' ? -MOVE_STEP : event.key === 'ArrowDown' ? MOVE_STEP : 0),
        ),
      );
    }
    replace(next);
    changed();
    status('Text box position or width updated.');
    return true;
  }
  function reset() {
    gesture = null;
    typing = false;
    selected = null;
    pickerKey = '';
    overlay.replaceChildren();
    nodes.clear();
    input.value = '';
    picker.replaceChildren();
    byId('notecardTextError').textContent = '';
  }
  return {
    sync,
    updateOverlay,
    endEdit,
    error,
    press,
    move,
    release,
    cancel,
    command,
    reset,
    owns: (target) => overlay.contains(target),
  };
}
