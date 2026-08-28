// Shared icon system for the lobby + admin pages. (client.js keeps its own copy for the table/editor.)
// The inline <symbol> sprite is injected into each page's HTML; these helpers reference it via <use>.
const NS = 'http://www.w3.org/2000/svg';

// One <svg class="ico"><use href="#i-name"> per icon, plus the two things that make a
// newly pasted Tabler symbol actually show up:
//   · .ico in styles.css declares fill:none / stroke:currentColor, and an INHERITED value
//     loses to nothing — so a fill-based symbol (Tabler's *filled* set, whose paths carry no
//     fill of their own) paints with fill:none and reads as a blank spot. If the symbol
//     declares its own paint, it is copied onto the wrapper so the symbol wins.
//   · a name with no matching <symbol id="i-name"> in the sprite renders nothing at all and
//     says nothing. It now warns and draws a dashed box, so a typo is visible.
function iconSvg(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ico ico-' + name);
  svg.setAttribute('aria-hidden', 'true');
  const sym = document.getElementById('i-' + name);
  if (!sym) {
    svg.classList.add('ico-missing');
    console.warn('[icons] no <symbol id="i-' + name + '"> in the sprite — icon left blank');
  } else {
    const fill = sym.getAttribute('fill'),
      stroke = sym.getAttribute('stroke'),
      sw = sym.getAttribute('stroke-width');
    if (fill && fill !== 'none') {
      svg.style.fill = fill;
      if (!stroke) svg.style.stroke = 'none'; // a filled symbol is not also stroked
    }
    if (stroke) svg.style.stroke = stroke;
    if (sw) svg.style.strokeWidth = sw;
  }
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

// Inject a Tabler icon (or several, space-separated in data-icon) into every button[data-icon],
// and copy its .lbl text into an aria-label so icon-only buttons stay screen-reader legible.
export function applyIcons(root = document) {
  root.querySelectorAll('button[data-icon], a.btn[data-icon]').forEach((btn) => {
    if (btn.querySelector('.ico')) return;
    btn.dataset.icon
      .trim()
      .split(/\s+/)
      .reverse()
      .forEach((name) => btn.prepend(iconSvg(name)));
    const lbl = btn.querySelector('.lbl');
    const txt = (
      btn.getAttribute('aria-label') ||
      (lbl ? lbl.textContent : '') ||
      btn.getAttribute('title') ||
      ''
    ).trim();
    if (txt) btn.setAttribute('aria-label', txt);
    if (btn.hasAttribute('title')) btn.removeAttribute('title');
  });
}

// Swap an element's state icon in place. Clears the old icon and any literal fallback
// text/glyph (a ✕, a 🔊, …) but preserves a text label (.lbl) if the button has one.
// Icons sit before the label, matching applyIcons. Idempotent via a cached name.
export function setIcon(el, name) {
  if (!el || el._icon === name) return;
  el._icon = name;
  [...el.childNodes].forEach((n) => {
    if (n.nodeType === 1 && n.classList.contains('lbl')) return; // keep the label element
    el.removeChild(n); // drop old icon, glyphs, stray text
  });
  el.prepend(iconSvg(name));
}

// ---- curation overflow: one trigger, a popover on desktop and a sheet on touch ----
// Shared by the lobby (landing.js) and the library cards. items:
//   { label, icon, fn, cls, note, confirm }  — confirm makes the row expand into its
// own inline confirm inside the sheet instead of firing window.confirm().
const coarsePointer = () => matchMedia('(pointer: coarse)').matches;
function overflowRow(item, done) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'sheetItem' + (item.cls ? ' ' + item.cls : '');
  if (item.icon) row.dataset.icon = item.icon;
  row.innerHTML =
    '<span class="lbl">' +
    item.label +
    '</span>' +
    (item.note ? '<span class="sheetNote">' + item.note + '</span>' : '');
  row.onclick = () => {
    item.fn();
    if (done) done();
  };
  return row;
}
export function openActionSheet(subject, items, host) {
  const mount = host || document.body;
  mount.querySelectorAll('.sheet-backdrop').forEach((s) => s.remove()); // one at a time
  const back = document.createElement('div');
  back.className = 'sheet-backdrop' + (mount === document.body ? ' fixed' : '');
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const close = () => back.remove();
  const grab = document.createElement('div');
  grab.className = 'sheetGrab';
  const head = document.createElement('div');
  head.className = 'sheetHead';
  head.innerHTML =
    '<b>' + subject.name + '</b>' + (subject.meta ? '<span>' + subject.meta + '</span>' : '');
  sheet.append(grab, head);
  for (const item of items) {
    if (!item.confirm) {
      sheet.append(overflowRow(item, close));
      continue;
    }
    const wrap = document.createElement('div');
    wrap.className = 'sheetDanger';
    const row = overflowRow({ ...item, fn: () => {} }, null);
    row.onclick = () => wrap.classList.add('confirming');
    const note = document.createElement('div');
    note.className = 'sheetConfirmNote';
    note.textContent = item.confirm;
    const acts = document.createElement('div');
    acts.className = 'sheetConfirmActions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => wrap.classList.remove('confirming');
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'danger';
    go.textContent = item.label;
    go.onclick = () => {
      item.fn();
      close();
    };
    acts.append(cancel, go);
    wrap.append(row, note, acts);
    sheet.append(wrap);
  }
  back.append(sheet);
  back.onclick = (e) => {
    if (e.target === back) close();
  };
  mount.append(back);
  applyIcons(sheet);
  return back;
}
export function overflowMenu(subject, items, opts = {}) {
  const group = document.createElement('span');
  group.className = 'pop-group overflowGroup';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'pop-trigger overflowTrigger icon-only';
  trigger.dataset.icon = 'dots';
  trigger.setAttribute('aria-label', 'More actions');
  trigger.innerHTML = '<span class="lbl">More actions</span>';
  const menu = document.createElement('div');
  menu.className = 'pop-menu overflowMenu';
  menu.hidden = true;
  menu.addEventListener('click', (e) => e.stopPropagation());
  // The menu lives inside .actions (spawnBar's click handler needs it to), and that sits inside a
  // scrolling pane inside an overflow:hidden window — so an absolute menu is clipped on the first
  // and last rows. A fixed one cannot escape either: .lib2Card carries backdrop-filter, which makes
  // it the containing block for fixed descendants (the same trap as #rightStack in 7e). So while it
  // is open the menu is PORTALED to <body> and placed from the trigger's rect, then put back on
  // close. The trigger never moves, so the 7c constraint still holds.
  const place = () => {
    const pad = 8;
    Object.assign(menu.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      right: 'auto',
      bottom: 'auto', // .pop-menu opens upward from bottom:100% — both edges set would stretch it
    });
    const r = trigger.getBoundingClientRect(),
      m = menu.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + m.height > innerHeight - pad)
      top = r.top - m.height - 6 >= pad ? r.top - m.height - 6 : innerHeight - m.height - pad;
    menu.style.left = Math.max(pad, Math.min(r.right - m.width, innerWidth - m.width - pad)) + 'px';
    menu.style.top = Math.max(pad, top) + 'px';
  };
  const onScroll = (e) => {
    if (!menu.contains(e.target)) close();
  };
  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', close);
    group.append(menu); // back where it belongs, so a re-render disposes of it with the card
  };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (coarsePointer()) return void openActionSheet(subject, items, opts.host);
    const wasClosed = menu.hidden;
    document.querySelectorAll('.overflowMenu:not([hidden])').forEach((m) => {
      if (m !== menu) m.dispatchEvent(new Event('overflow-close'));
    });
    if (!wasClosed) return void close();
    document.body.append(menu);
    menu.hidden = false;
    place();
    // Next frame: opening can itself scroll the pane (focus), which would close it instantly.
    requestAnimationFrame(() => {
      if (menu.hidden) return;
      addEventListener('scroll', onScroll, true);
      addEventListener('resize', close);
    });
  });
  menu.addEventListener('overflow-close', close);
  document.addEventListener('click', close);
  for (const item of items) menu.append(overflowRow(item, close));
  group.append(trigger, menu);
  applyIcons(group);
  return group;
}

// Snappy themed hint for icon-only buttons — reads the button's aria-label.
// Mouse: hover after 90ms. Touch/pen: long-press after 400ms (UI_Redesign 7d) — compact UI is
// forced on (pointer: coarse), so without this a touch user gets icon-only chrome with no labels.
export function initTip() {
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipBtn = null,
    tipTimer = null;
  const place = (btn) => {
    tip.textContent = btn.getAttribute('aria-label') || '';
    tip.hidden = false;
    const r = btn.getBoundingClientRect(),
      t = tip.getBoundingClientRect();
    let top = r.top - t.height - 8;
    if (top < 4) top = r.bottom + 8;
    const left = Math.max(
      4,
      Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 4),
    );
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  };
  const hide = () => {
    tip.hidden = true;
    tipBtn = null;
    if (tipTimer) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }
  };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const btn = e.target.closest('button[aria-label]');
    if (!btn || !btn.querySelector('.ico') || btn === tipBtn) return;
    tipBtn = btn;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (tipBtn === btn) place(btn);
    }, 90);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const btn = e.target.closest('button[aria-label]');
    if (btn && btn === tipBtn && !btn.contains(e.relatedTarget)) hide();
  });
  // Mouse-only: any press dismisses the hover hint. Touch presses are the long-press
  // gesture itself, so they must not self-cancel — the touch path below owns them.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') hide();
    },
    true,
  );

  // ---- touch / pen: long-press ----
  // Held 400ms on an icon button → place the same #tip. Cancelled by a drag past
  // SLOP, by lifting early, by pointercancel, or by any scroll. When it does fire we
  // swallow the click that follows, so learning a control never triggers it.
  const LONG_PRESS = 400,
    SLOP = 8;
  let downAt = null, // { x, y } of the press that started the timer
    fired = false, // a tip was shown for this press
    swallowClick = false;
  const cancelPress = () => {
    downAt = null;
    if (tipTimer) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    fired = false;
    swallowClick = false;
    const btn = e.target.closest('button[aria-label], a.btn[aria-label]');
    if (!btn || !btn.querySelector('.ico')) return cancelPress();
    downAt = { x: e.clientX, y: e.clientY };
    tipBtn = btn;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (tipBtn !== btn || !downAt) return;
      place(btn);
      fired = true;
      swallowClick = true;
    }, LONG_PRESS);
  });
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'mouse' || !downAt) return;
      if (Math.abs(e.clientX - downAt.x) > SLOP || Math.abs(e.clientY - downAt.y) > SLOP) {
        cancelPress();
        if (fired) hide();
      }
    },
    { passive: true },
  );
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    cancelPress();
    if (fired) setTimeout(hide, 1200); // leave it up long enough to read after the finger lifts
  });
  document.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'mouse') return;
    cancelPress();
    hide();
  });
  // A long-press that fired is a "what is this?", never an activation.
  document.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // Any scroll invalidates a placed tip (it is position: fixed against a moved element).
  window.addEventListener('scroll', () => tip.hidden || hide(), true);
}
