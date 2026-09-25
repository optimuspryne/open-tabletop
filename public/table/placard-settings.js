import {
  PLACARD_SHAPES,
  PLACARD_PATTERNS,
  readPlacard,
  DEFAULT_PLACARD,
} from '../../shared/placards.js';
import { drawPlacard } from '../rendering/placards.js';

// Account appearance controls; reuse the Settings tabs and the marker's actual painter.
export function createPlacardSettings({ byId, getRoom, getSessionId, doc = document }) {
  let bound = false,
    dirty = false,
    pending = false,
    timer = null,
    submitted = null;
  let avatar = '',
    image = null,
    imageGeneration = 0;
  const me = () => getRoom()?.state?.players?.get(getSessionId());
  const fields = ['shape', 'pattern', 'color', 'accent'];
  const input = (key) => byId('placard-' + key);
  const status = (text) => {
    byId('placardStatus').textContent = text;
  };
  const draft = () => Object.fromEntries(fields.map((key) => [key, input(key).value]));
  function draw() {
    const player = me();
    if (!player || !bound) return;
    const canvas = byId('placardPreview');
    const ctx = canvas.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    drawPlacard(
      ctx,
      { name: player.name, color: player.color, showing: player.showing, placard: draft() },
      image,
    );
    if (avatar !== (player.avatar || '')) {
      avatar = player.avatar || '';
      image = null;
      const generation = ++imageGeneration;
      if (avatar) {
        const next = new Image();
        next.onload = () => {
          if (generation === imageGeneration) {
            image = next;
            draw();
          }
        };
        next.src = avatar;
      }
      draw();
    }
  }
  function hydrate() {
    if (!bound || !me()) return;
    if (!dirty && !pending) {
      const settings = readPlacard(me().placard);
      for (const key of fields) input(key).value = settings[key];
    }
    draw();
  }
  function finish(text) {
    clearTimeout(timer);
    timer = null;
    pending = false;
    byId('placardFields').disabled = false;
    status(text);
  }
  function bindMessages(room) {
    room.onMessage('placardSaved', (settings) => {
      if (!bound) return;
      const saved = JSON.stringify(readPlacard(settings));
      if (pending && saved !== submitted) return; // an earlier timed-out save arrived late
      const matchesDraft = saved === JSON.stringify(readPlacard(draft()));
      finish(
        matchesDraft
          ? 'Saved to your account.'
          : 'Earlier appearance saved. This preview has unsaved changes.',
      );
      dirty = !matchesDraft;
      draw();
    });
    room.onMessage('serverError', ({ operation, message } = {}) => {
      if (bound && pending && operation === 'setPlacard')
        finish(message || 'Could not save. Try again.');
    });
  }
  function bindControls() {
    if (bound || !byId('placardFields')) return;
    bound = true;
    for (const [key, choices] of [
      ['shape', PLACARD_SHAPES],
      ['pattern', PLACARD_PATTERNS],
    ]) {
      for (const [value, label] of Object.entries(choices)) {
        const option = doc.createElement('option');
        option.value = value;
        option.textContent = label;
        input(key).append(option);
      }
    }
    for (const key of fields)
      input(key).addEventListener('input', () => {
        dirty = true;
        status('Preview · save to share with the table.');
        draw();
      });
    byId('placardReset').onclick = () => {
      for (const key of fields) input(key).value = DEFAULT_PLACARD[key];
      dirty = true;
      status('Default preview · save to apply.');
      draw();
    };
    byId('placardSave').onclick = () => {
      if (!me() || pending) return;
      submitted = JSON.stringify(readPlacard(draft()));
      pending = true;
      byId('placardFields').disabled = true;
      status('Saving…');
      timer = setTimeout(() => finish('Save not confirmed. Reconnect or try again.'), 10000);
      try {
        getRoom().send('setPlacard', draft());
      } catch {
        finish('Connection unavailable. Try again.');
      }
    };
    hydrate();
  }
  return { hydrate, bindMessages, bindControls };
}
