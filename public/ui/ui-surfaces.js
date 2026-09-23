// Browser-only surface mechanics. The table supplies its own panes, actions, and role gates.
export function createUiSurfaces({ doc = document, win = window, onSheetStop = () => {} } = {}) {
  const SHEET_MQ = '(max-width: 900px), (pointer: coarse)'; // matches styles.css
  const PEEK_H = 196;
  const openSheets = new Set();
  const isSheet = () => win.matchMedia(SHEET_MQ).matches;

  const stopPx = (name) => {
    const full = Math.max(320, win.innerHeight - 56);
    if (name === 'peek') return Math.min(PEEK_H, full);
    if (name === 'full') return full;
    return Math.min(Math.round(win.innerHeight * 0.66), full);
  };
  const nearestStop = (height, velocity) => {
    const order = ['peek', 'two', 'full'];
    let best = order[0],
      bestDistance = Infinity;
    for (const stop of order) {
      const distance = Math.abs(stopPx(stop) - height);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = stop;
      }
    }
    if (Math.abs(velocity) > 0.6) {
      const index = order.indexOf(best);
      return order[velocity < 0 ? Math.min(index + 1, 2) : Math.max(index - 1, 0)];
    }
    return best;
  };
  const setStop = (region, name, animate = true) => {
    region._stop = name;
    region.classList.toggle('sheetAnim', !!animate);
    region.classList.remove('at-peek', 'at-two', 'at-full');
    region.classList.add('at-' + name);
    region.style.setProperty('--sheet-h', stopPx(name) + 'px');
    onSheetStop(region);
  };
  const clearSheet = (region) => {
    openSheets.delete(region);
    region.classList.remove('sheetAnim', 'sheetDrag', 'at-peek', 'at-two', 'at-full');
    region.style.removeProperty('--sheet-h');
  };
  const initSheet = (region) => {
    if (region._sheetReady) return;
    region._sheetReady = true;
    const grab = doc.createElement('div');
    grab.className = 'sheetGrab';
    grab.setAttribute('aria-hidden', 'true');
    region.insertBefore(grab, region.firstChild);
    let startY = 0,
      startH = 0,
      lastY = 0,
      lastT = 0,
      velocity = 0,
      dragging = false;
    grab.addEventListener('pointerdown', (event) => {
      if (!isSheet()) return;
      dragging = true;
      startY = lastY = event.clientY;
      lastT = win.performance.now();
      velocity = 0;
      startH = region.getBoundingClientRect().height;
      region.classList.add('sheetDrag');
      region.classList.remove('sheetAnim');
      grab.setPointerCapture(event.pointerId);
    });
    grab.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const now = win.performance.now();
      if (now > lastT) velocity = (lastY - event.clientY) / (now - lastT);
      lastY = event.clientY;
      lastT = now;
      const height = Math.max(80, Math.min(startH + (startY - event.clientY), stopPx('full')));
      region.style.setProperty('--sheet-h', height + 'px');
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      region.classList.remove('sheetDrag');
      const height = region.getBoundingClientRect().height;
      if (height < PEEK_H * 0.6 || (velocity < -0.8 && region._stop === 'peek')) {
        region._close?.();
        return;
      }
      setStop(region, nearestStop(height, velocity));
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  };
  const openAsSheet = (region) => {
    for (const other of openSheets) if (other !== region) other._close?.();
    initSheet(region);
    openSheets.add(region);
    setStop(region, 'two', false);
    win.requestAnimationFrame(() => region.classList.add('sheetAnim'));
  };
  win.addEventListener('resize', () => {
    for (const region of [...openSheets]) {
      if (!isSheet()) clearSheet(region);
      else setStop(region, region._stop || 'two', false);
    }
  });

  let lastFocusOutsideDialog = null;
  doc.addEventListener('focusin', (event) => {
    if (!event.target.closest?.('[role="dialog"]')) lastFocusOutsideDialog = event.target;
  });
  const openEscDialogs = [];
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !openEscDialogs.length) return;
      if (doc.activeElement?.closest?.('[role="dialog"]')) return;
      const top = openEscDialogs[openEscDialogs.length - 1];
      const close = top.close || top.panel.querySelector('.close-x');
      if (close) {
        event.preventDefault();
        event.stopPropagation();
        close.click();
      }
    },
    true,
  );
  const wireDialog = (panel, { modal = false, esc = true, close = null } = {}) => {
    if (!panel) return;
    panel.setAttribute('role', 'dialog');
    if (modal) panel.setAttribute('aria-modal', 'true');
    if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
    const title = panel.querySelector('.modal__title, .panel-head b, h3');
    if (title && !panel.hasAttribute('aria-label'))
      panel.setAttribute('aria-label', title.textContent.trim());
    const focusables = () =>
      [...panel.querySelectorAll('a[href], button, input, textarea, select, [tabindex]')].filter(
        (node) =>
          !node.disabled &&
          node.tabIndex !== -1 &&
          node.type !== 'hidden' &&
          node.getClientRects().length,
      );
    let returnTo = null;
    new win.MutationObserver(() => {
      const at = openEscDialogs.findIndex((entry) => entry.panel === panel);
      if (panel.hidden) {
        const target = returnTo;
        returnTo = null;
        if (
          target?.focus &&
          doc.contains(target) &&
          (doc.activeElement === doc.body || panel.contains(doc.activeElement))
        )
          target.focus();
        if (at >= 0) openEscDialogs.splice(at, 1);
      } else {
        returnTo =
          lastFocusOutsideDialog && doc.contains(lastFocusOutsideDialog)
            ? lastFocusOutsideDialog
            : doc.activeElement;
        if (!panel.contains(doc.activeElement)) {
          const candidates = focusables();
          const isText = (element) =>
            element &&
            (element.tagName === 'TEXTAREA' ||
              (element.tagName === 'INPUT' &&
                !/^(button|checkbox|radio|range|color|file|submit)$/i.test(element.type)));
          const target = isSheet()
            ? candidates.find((element) => !isText(element)) || panel
            : candidates[0] || panel;
          target.focus({ preventScroll: true });
        }
        if (esc) {
          if (at >= 0) openEscDialogs.splice(at, 1);
          openEscDialogs.push({ panel, close });
        }
      }
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    panel.addEventListener('keydown', (event) => {
      if (esc && event.key === 'Escape') {
        const trigger = close || panel.querySelector('.close-x');
        if (trigger) {
          event.preventDefault();
          event.stopPropagation();
          trigger.click();
        }
      } else if (event.key === 'Tab' && modal) {
        const candidates = focusables();
        if (!candidates.length) return;
        const first = candidates[0],
          last = candidates[candidates.length - 1];
        if (event.shiftKey && doc.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && doc.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  };

  const wireCluster = (region, hams, opts = {}) => {
    if (!region || !hams.length) return;
    const anchor = hams[0].btn;
    const place = (ham) => {
      if (isSheet()) {
        region.style.left = region.style.top = '';
        return;
      }
      const button = (opts.perHam && ham?.btn) || anchor;
      const rect = button.getBoundingClientRect();
      const clampX = (x) =>
        Math.round(Math.max(8, Math.min(x, win.innerWidth - region.offsetWidth - 8)));
      const clampY = (y) =>
        Math.round(Math.max(8, Math.min(y, win.innerHeight - region.offsetHeight - 8)));
      if (opts.open === 'right') {
        const openLeft = rect.right + 8 + region.offsetWidth > win.innerWidth - 8;
        region.style.left =
          clampX(openLeft ? rect.left - region.offsetWidth - 8 : rect.right + 8) + 'px';
        region.style.top = clampY(rect.bottom - region.offsetHeight) + 'px';
      } else if (opts.open === 'above') {
        region.style.left = clampX(rect.left) + 'px';
        region.style.top = clampY(rect.top - region.offsetHeight - 8) + 'px';
      } else {
        region.style.left = clampX(rect.left) + 'px';
        region.style.top = Math.round(rect.bottom + 8) + 'px';
      }
    };
    let current = null;
    const deactivate = () => {
      const previous = current;
      current = null;
      previous?.onClose?.();
    };
    const close = () => {
      deactivate();
      region.hidden = true;
      clearSheet(region);
      hams.forEach((ham) => ham.btn.classList.remove('on'));
    };
    const open = (ham) => {
      if (current && current !== ham) deactivate();
      hams.forEach((item) => item.btn.classList.remove('on'));
      region
        .querySelectorAll('.pane')
        .forEach((pane) => pane.classList.toggle('on', pane.dataset.pane === ham.pane));
      ham.btn.classList.add('on');
      region.hidden = false;
      if (isSheet()) openAsSheet(region);
      else clearSheet(region);
      place(ham);
      current = ham;
      const focus = isSheet()
        ? region.querySelector('.pane.on')
        : region.querySelector('.pane.on textarea, .pane.on input:not([type=hidden])') ||
          region.querySelector('.pane.on button:not(.regionClose), .pane.on [tabindex]');
      if (focus) {
        if (isSheet() && !focus.hasAttribute('tabindex')) focus.setAttribute('tabindex', '-1');
        focus.focus({ preventScroll: true });
      }
      ham.onOpen?.();
    };
    region._close = close;
    hams.forEach((ham) =>
      ham.btn.addEventListener('click', () => (current === ham ? close() : open(ham))),
    );
    region.querySelectorAll('.regionClose').forEach((button) =>
      button.addEventListener('click', () => {
        close();
        anchor.focus();
      }),
    );
    region.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        anchor.focus();
      }
    });
    win.addEventListener('resize', () => {
      if (!region.hidden) place(current);
    });
  };

  const holdRepeat = (button, fn, ms = 100) => {
    if (!button) return;
    let interval = null;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      fn();
      interval = win.setInterval(fn, ms);
    });
    const stop = () => {
      if (interval) {
        win.clearInterval(interval);
        interval = null;
      }
    };
    button.addEventListener('pointerup', stop);
    button.addEventListener('pointerleave', stop);
    button.addEventListener('pointercancel', stop);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  };

  const wireDrawer = (drawer, button, build) => {
    if (!drawer || !button) return () => {};
    const close = () => {
      drawer.hidden = true;
      clearSheet(drawer);
      button.classList.remove('on');
      button.setAttribute('aria-expanded', 'false');
      button.focus({ preventScroll: true });
    };
    const open = () => {
      build();
      drawer.hidden = false;
      openAsSheet(drawer);
      button.classList.add('on');
      button.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('tabindex', '-1');
      drawer.focus({ preventScroll: true });
    };
    drawer._close = close;
    button.addEventListener('click', () => (drawer.hidden ? open() : close()));
    drawer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    return close;
  };

  const createRadialMenu = (element, { icons = {}, onClose = () => {} } = {}) => {
    const close = () => {
      if (!element) return;
      element.classList.remove('on');
      element.hidden = true;
      element.replaceChildren();
      onClose();
    };
    const open = (x, y, items) => {
      if (!element || !items.length) return false;
      element.replaceChildren();
      const scrim = doc.createElement('div');
      scrim.className = 'radialScrim';
      scrim.addEventListener('pointerdown', close);
      element.appendChild(scrim);
      const step = 0.68;
      const initialRadius = Math.min(150, Math.max(104, 52 + 16 * items.length));
      const spread = Math.min(Math.PI * 1.35, (items.length - 1) * step);
      const direction = Math.atan2(win.innerHeight / 2 - y, win.innerWidth / 2 - x);
      const margin = 38;
      const fits = (px, py) =>
        px >= margin &&
        px <= win.innerWidth - margin &&
        py >= margin &&
        py <= win.innerHeight - margin;
      const layout = (angle, radius) =>
        items.map((_, index) => {
          const itemAngle =
            items.length === 1 ? angle : angle - spread / 2 + (spread * index) / (items.length - 1);
          return [x + Math.cos(itemAngle) * radius, y + Math.sin(itemAngle) * radius];
        });
      let best = null;
      for (const radius of [initialRadius, initialRadius * 0.86, initialRadius * 0.72]) {
        for (let k = 0; k <= 16 && !best; k++) {
          for (const sign of k ? [1, -1] : [0]) {
            const points = layout(direction + sign * k * 0.16, radius);
            if (points.every(([px, py]) => fits(px, py))) {
              best = points;
              break;
            }
          }
        }
        if (best) break;
      }
      if (!best)
        best = layout(direction, initialRadius * 0.72).map(([px, py]) => [
          Math.max(margin, Math.min(px, win.innerWidth - margin)),
          Math.max(margin, Math.min(py, win.innerHeight - margin)),
        ]);
      items.forEach((item, index) => {
        const [bx, by] = best[index];
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'radialItem' + (item.cls ? ' ' + item.cls : '');
        button.style.left = Math.round(bx) + 'px';
        button.style.top = Math.round(by) + 'px';
        button.style.transitionDelay = index * 18 + 'ms';
        const dot = doc.createElement('span');
        dot.className = 'radialDot';
        const icon = item.icon || icons[item.label] || 'circle';
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ico ico-' + icon);
        svg.setAttribute('aria-hidden', 'true');
        const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-' + icon);
        svg.appendChild(use);
        dot.appendChild(svg);
        button.setAttribute('aria-label', item.label);
        button.title = item.label;
        button.appendChild(dot);
        button.addEventListener('click', () => {
          close();
          item.fn();
        });
        if (item.press)
          button.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const dragging = item.press(event);
            close(); // transfer pointer capture before detaching the pressed button
            if (dragging) button.onclick = null;
          });
        element.appendChild(button);
      });
      element.hidden = false;
      win.requestAnimationFrame(() => element.classList.add('on'));
      return true;
    };
    win.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    return { open, close };
  };

  return {
    isSheet,
    clearSheet,
    openAsSheet,
    wireDialog,
    wireCluster,
    holdRepeat,
    wireDrawer,
    createRadialMenu,
  };
}
