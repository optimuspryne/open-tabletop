import { createUiSurfaces } from '../ui/ui-surfaces.js';
import { applyIcons, setIcon, initTip, wirePopGroups } from '../ui/icons.js';
import { toastContent } from '../ui/rows.js';
// Table-specific DOM composition and local shell state, built on the shared UI surfaces.
export function createTableShell({ byId, clamp, getRoom }) {
  // Wrap every number input in a themed − / + stepper (universal number-field style).
  // The original input is kept in place, so existing byId() reads still work; the
  // buttons just step the value and fire input/change so any listeners react.
  function enhanceNumberInputs() {
    document.querySelectorAll('input[type="number"]').forEach((input) => {
      if (input.closest('.stepper')) return; // already wrapped
      const wrap = document.createElement('span');
      wrap.className = 'stepper';
      input.parentNode.insertBefore(wrap, input);
      const fire = () => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const btn = (label, step) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'stepBtn';
        b.textContent = label;
        b.tabIndex = -1;
        b.onclick = () => {
          step > 0 ? input.stepUp() : input.stepDown();
          fire();
        }; // stepUp/Down honour min/max/step
        return b;
      };
      wrap.append(btn('\u2212', -1), input, btn('+', 1));
    });
  }

  // ===== Movable / resizable pop-out panels ====================================
  // Desktop only (a precise pointer). Drag a panel by its .panel-head to pop it out
  // of the dock into a free-floating spot; a few content-heavy ones also resize.
  // Layout is remembered per-browser in localStorage — pure-UI state, never synced
  // (same instinct as audio settings). "Reset panel layout" (Tools menu) re-docks all.
  const PANEL_MOVABLE = []; // Customize Table + Scale & Grid are movable pop-outs (drag them aside while calibrating); the show/drop/tracks pop-outs became inline controls in 7i–7j
  // Every movable panel is resizable (size them to taste); chat/notes additionally
  // flex their inner scroll region (see styles.css) so resizing grows the content.
  const PANEL_RESIZABLE = new Set(PANEL_MOVABLE);
  const PANEL_LS = 'ott.panelLayout';
  let panelTopZ = 40;

  function readPanelLayout() {
    try {
      return JSON.parse(localStorage.getItem(PANEL_LS)) || {};
    } catch (e) {
      return {};
    }
  }
  function writePanelLayout(layout) {
    try {
      localStorage.setItem(PANEL_LS, JSON.stringify(layout));
    } catch (e) {
      /* private mode / quota */
    }
  }

  // Clamp a top-left so the WHOLE panel (incl. its bottom-right resize grip) stays
  // on-screen — not just the corner; otherwise a wide panel hangs off the edge.
  function clampPos(panel, left, top) {
    const w = panel.offsetWidth || 220,
      h = panel.offsetHeight || 140;
    return {
      left: clamp(left, 0, Math.max(0, innerWidth - w)),
      top: clamp(top, 0, Math.max(0, innerHeight - h)),
    };
  }
  // Detach a panel from the dock flow into a clamped fixed position (+ optional size).
  function floatPanel(panel, id, left, top, width, height) {
    panel.classList.add('floating');
    if (PANEL_RESIZABLE.has(id)) panel.classList.add('resizable');
    if (width) panel.style.width = width + 'px'; // set size first so clampPos measures the final box
    if (height) panel.style.height = height + 'px';
    const pos = clampPos(panel, left, top);
    panel.style.left = pos.left + 'px';
    panel.style.top = pos.top + 'px';
  }
  function persistPanel(panel, id) {
    const r = panel.getBoundingClientRect();
    const layout = readPanelLayout();
    // Width is always pinned (prevents the dock's width:100% from re-stretching a
    // restored panel). Height only once the user has actually resized (an inline
    // height exists) — so a drag-only panel keeps auto height and grows with content.
    layout[id] = {
      left: r.left,
      top: r.top,
      width: r.width,
      height: panel.style.height ? r.height : 0,
    };
    writePanelLayout(layout);
  }
  function initPanels() {
    if (!matchMedia('(pointer: fine)').matches) return; // desktop / precise pointer only — keep the docked layout on touch
    const layout = readPanelLayout();
    for (const id of PANEL_MOVABLE) {
      const panel = byId(id);
      if (!panel) continue;
      const head = panel.querySelector(':scope > .panel-head');
      if (!head) continue;
      panel.classList.add('movable');
      const saved = layout[id];
      if (saved) floatPanel(panel, id, saved.left, saved.top, saved.width, saved.height);

      head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.close-x')) return; // left-drag on the title bar, not the ✕
        const r = panel.getBoundingClientRect(); // measured WITH any centering transform still applied
        // Pin the current (docked) width — else the dock's `width:100%` rule, now
        // viewport-relative under position:fixed, stretches the panel full-screen.
        if (!panel.classList.contains('floating')) floatPanel(panel, id, r.left, r.top, r.width); // pop out of flow on first drag (no visual jump)
        panel.style.zIndex = ++panelTopZ; // bring to front
        const ox = e.clientX - r.left,
          oy = e.clientY - r.top;
        head.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const pos = clampPos(panel, ev.clientX - ox, ev.clientY - oy);
          panel.style.left = pos.left + 'px';
          panel.style.top = pos.top + 'px';
        };
        const up = (ev) => {
          try {
            head.releasePointerCapture(ev.pointerId);
          } catch (err) {
            /* already released */
          }
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', up);
          persistPanel(panel, id);
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
      });
      // Clicking anywhere in a floating panel raises it above the others.
      panel.addEventListener(
        'pointerdown',
        () => {
          if (panel.classList.contains('floating')) panel.style.zIndex = ++panelTopZ;
        },
        true,
      );
      // Remember size changes on the resizable ones (debounced to a frame).
      if (PANEL_RESIZABLE.has(id) && 'ResizeObserver' in window) {
        let raf = 0;
        new ResizeObserver(() => {
          if (!panel.classList.contains('floating')) return;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => persistPanel(panel, id));
        }).observe(panel);
      }
    }
  }

  // A brief confirmation for actions that have no visible dialog (drop hand, …).
  let toastTimer = null;
  function toast(text, icon = 'check', action = null) {
    const el = byId('toast');
    if (!el) return;
    el.replaceChildren();
    el.append(
      ...toastContent(text, icon, action, () => {
        action.fn();
        el.hidden = true;
      }),
    );
    el.hidden = false;
    el.setAttribute('role', 'status');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        el.hidden = true;
      },
      action ? 8000 : 2600,
    ); // an undoable action gets longer to be undone
  }

  let surfaces, openRadial, closeRadial;
  function prepare() {
    enhanceNumberInputs();
    initPanels();
  }
  function bindRoomControls() {
    // The game table and the editor have different toolbars but share this file, so
    // every page-specific control is wired defensively (no-op if it isn't on the page).
    const wire = (id, fn) => {
      const el = byId(id);
      if (el) el.onclick = fn;
    };
    const menu = (btnId, grpId) => {
      const b = byId(btnId),
        g = byId(grpId);
      if (!b || !g) return;
      b.onclick = (e) => {
        e.stopPropagation();
        const open = g.hidden;
        document.querySelectorAll('.grp').forEach((x) => {
          if (x !== g) x.hidden = true;
        });
        g.hidden = !open;
      };
      g.onclick = (e) => e.stopPropagation();
      document.addEventListener('click', () => (g.hidden = true));
    };
    // Room Controls menu — the old spawn/add menus are gone; creation + spawning
    // now live in View Library, Built-Ins, and (editor) Add to Library.
    menu('roomBtn', 'roomGrp');
    menu('moreBtn', 'moreGrp'); // Settings + How to Play overflow
    // Members management now lives in the Room Info dock (GM-only #memberSection), populated by the
    // memberList push; no popout to open.
    // roomScene opens the Library on its Scenes tab — wired in editor-panel.js (which owns the panel).
    wire('roomReset', () => {
      byId('roomGrp').hidden = true;
      if (confirm('Reset the table? This clears all pieces.')) getRoom().send('reset');
    });
    wire('roomSaveState', () => getRoom().send('stateSave'));
    {
      // Room Info dock: collapse to just the header (name + code). Starts collapsed on mobile/narrow.
      const rail = byId('roomInfo'),
        tog = byId('railToggle');
      if (rail && tog) {
        const apply = (c) => {
          rail.classList.toggle('collapsed', c);
          setIcon(tog, c ? 'chevron-right' : 'chevron-down');
          tog.setAttribute('aria-label', c ? 'Show room info' : 'Collapse');
        };
        tog.onclick = () => apply(!rail.classList.contains('collapsed'));
        apply(matchMedia('(pointer: coarse), (max-width: 720px)').matches); // set initial state + icon
      }
    }
    wire('reset', () => getRoom().send('reset'));
  }
  function bindInteractionControls({ handDropPosition, toggleLean }) {
    // Canvas input (context-menu, middle-click, wheel, dblclick) is wired via public/table/controls.js —
    // the composition root supplies the semantic input router.
    {
      const b = byId('controlsBtn');
      if (b)
        b.onclick = () => {
          byId('controlsModal').hidden = false;
        };
    } // open How to Play
    {
      const b = byId('controlsClose');
      if (b)
        b.onclick = () => {
          byId('controlsModal').hidden = true;
        };
    }
    {
      const b = byId('leanBtn');
      if (b)
        b.onclick = () => {
          const leanActive = toggleLean();
          b.classList.toggle('on', leanActive);
          const t = leanActive ? 'Lean Out' : 'Lean In';
          const l = b.querySelector('.lbl');
          if (l) l.textContent = t;
          b.setAttribute('aria-label', t);
        };
    } // toggle the closer-look camera (keep the icon; relabel only)
    {
      // Drop hand (UI_Redesign 7j / mockup 9e): the orientation IS the button — two
      // taps' worth of dialog for a two-outcome action was the whole problem.
      const dropAt = (faceDown) => {
        if (!getRoom()) return;
        const n = byId('hand')?.querySelectorAll('.handcard').length || 0;
        getRoom().send('handToTable', {
          faceDown,
          ...handDropPosition(),
        }); // just in front of the marker
        toast(
          (n ? n + ' card' + (n === 1 ? '' : 's') : 'Hand') +
            ' laid out ' +
            (faceDown ? 'face-down' : 'face-up'),
          'check',
          { label: 'Undo', fn: () => getRoom().send('handFromTable') },
        );
      };
      const dropBtn = byId('dropBtn');
      const dropChoices = byId('dropChoices');
      const setDropOpen = (open) => {
        if (!dropBtn || !dropChoices) return;
        dropChoices.hidden = !open;
        dropBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      dropBtn?.addEventListener('click', () => setDropOpen(dropChoices.hidden));
      byId('dropDown')?.addEventListener('click', () => {
        setDropOpen(false);
        dropAt(true);
      });
      byId('dropUp')?.addEventListener('click', () => {
        setDropOpen(false);
        dropAt(false);
      });
    }
  }
  function bindControls({ input: INPUT, selection, overlays, scoreboard, presence }) {
    // Universal icon buttons: any button labeled "EMOJI text" collapses to just the emoji on small
    // screens — its text is wrapped in <span class="lbl"> (hidden by CSS). Skips buttons that are
    // already structured (a child element) or have no leading emoji to fall back to (e.g. "+ d4").
    function autoIconLabels(root = document) {
      root.querySelectorAll('button').forEach((btn) => {
        if (btn.childElementCount) return; // already wrapped / structured
        const m = btn.textContent.match(/^(.*?)(\p{L}.*)$/u); // split at the first letter
        if (!m || !/\p{Extended_Pictographic}/u.test(m[1])) return; // needs a leading emoji
        btn.textContent = '';
        btn.appendChild(document.createTextNode(m[1]));
        const span = document.createElement('span');
        span.className = 'lbl';
        span.textContent = m[2];
        btn.appendChild(span);
      });
    }
    autoIconLabels();

    wirePopGroups(); // shared with editor-panel.js — see icons.js

    // applyIcons / setIcon / initTip are imported from icons.js (see top).
    applyIcons();
    document.querySelectorAll('.close-x').forEach((el) => setIcon(el, 'x')); // every modal's ✕ → an icon, universally
    document.querySelectorAll('label[data-icon]').forEach((el) => setIcon(el, el.dataset.icon)); // icon-only dimension labels (Width/Depth)

    // Reusable surface mechanics; table-specific panel/button wiring stays here.
    surfaces = createUiSurfaces({
      onSheetStop: (region) => {
        const log = region.querySelector('#chatLog');
        if (log) log.scrollTop = log.scrollHeight;
      },
    });
    const {
      isSheet,
      clearSheet,
      openAsSheet,
      wireDialog,
      wireCluster,
      holdRepeat,
      wireDrawer,
      createRadialMenu,
    } = surfaces;
    wireDialog(byId('settingsModal'), { modal: true });
    wireDialog(byId('roomSettingsModal'), { modal: true });
    wireDialog(byId('sceneSaveModal'), { modal: true });
    wireDialog(byId('pieceLabelsModal'), { modal: true });
    wireDialog(byId('controlsModal'), { modal: true, close: byId('controlsClose') });
    ['libraryModal'].forEach((id) => wireDialog(byId(id), { modal: true }));
    // Top-left cluster (UI_Redesign phase 2): Chat + Notes share one region (accordion).
    {
      const r = byId('regionTL'),
        cb = byId('chatBtn'),
        nb = byId('notesBtn');
      if (r && cb && nb)
        wireCluster(r, [
          {
            btn: cb,
            pane: 'chat',
            onOpen: () => {
              cb.classList.remove('hasUnread');
              const l = byId('chatLog');
              if (l) l.scrollTop = l.scrollHeight;
            },
          },
          { btn: nb, pane: 'notes' },
        ]);
    }
    // Top-right cluster (UI_Redesign phase 2b): Score + Music + Measure + Timer.
    {
      const r = byId('regionTR'),
        sb = byId('scoreBtn'),
        ab = byId('audioBtn'),
        mb = byId('measureBtn'),
        tb = byId('timerBtn');
      if (r && sb && tb)
        wireCluster(r, [
          {
            btn: sb,
            pane: 'score',
            onOpen: () => {
              scoreboard.render();
            },
          },
          { btn: ab, pane: 'music' },
          { btn: mb, pane: 'measure', onOpen: overlays.enter, onClose: overlays.exit },
          { btn: tb, pane: 'timer' },
        ]);
    }
    // Bottom-left corner cluster (UI_Redesign phase 2c): Interactions → My Seat / Lean In / Show / Drop.
    {
      const r = byId('regionBL'),
        ib = byId('interactHam'),
        ibR = byId('interactHamR');
      const hams = [{ btn: ib, pane: 'interactions' }];
      if (ibR) hams.push({ btn: ibR, pane: 'interactions' }); // mirrored right-corner ham
      if (r && ib) wireCluster(r, hams, { open: 'right', perHam: true });
    }
    // Library cards render dynamically (editor-panel.js) — icon their data-icon buttons as they appear.
    ['libraryModal'].forEach((id) => {
      const el = byId(id);
      if (el)
        new MutationObserver(() => applyIcons(el)).observe(el, { childList: true, subtree: true });
    });

    initTip(); // themed hover-hint (icons.js)

    // Touch height control: hold ▲ / ▼ to raise / lower the held piece — the touch analog of the wheel.
    // Also the selection rotation buttons: hold ⟲ / ⟳ to spin the selection continuously (server
    // rotateGroup with an angle delta), the continuous complement to the [ / ] 45° steps.
    {
      document
        .querySelectorAll('.heightUp')
        .forEach((b) => holdRepeat(b, () => INPUT.raiseAxis(1), 120));
      document
        .querySelectorAll('.heightDown')
        .forEach((b) => holdRepeat(b, () => INPUT.raiseAxis(-1), 120));
      document
        .querySelectorAll('.rotLeft')
        .forEach((b) => holdRepeat(b, () => INPUT.rotateAxis(-1), 60));
      document
        .querySelectorAll('.rotRight')
        .forEach((b) => holdRepeat(b, () => INPUT.rotateAxis(1), 60));
    }

    selection.bindActions();

    // Role gating here is by class, not by `hidden`: body.not-gm / body.not-admin hide
    // .gm-only / .admin-only in CSS. A collapsed container (.grp menu, closed #regionBL)
    // is NOT a gate, which is why we can't just ask whether the button is visible.
    function proxyGated(el) {
      if (!el || el.hidden) return true;
      const body = document.body.classList;
      if (body.contains('not-gm') && el.closest('.gm-only')) return true;
      if (body.contains('not-admin') && el.closest('.admin-only')) return true;
      return false;
    }

    // ---- radial menu primitive (7e slice 7; mockup 10j) ------------------------------------
    // One fan for two callers: the ⊕ FAB and long-press on a piece. Items arc away from the
    // nearest edges, so the menu never opens off-screen and never lands under your thumb.
    const RADIAL_ICONS = {
      Flip: 'eye-up',
      'Take to hand': 'hand-grab',
      Roll: 'dice-5',
      'Draw to hand': 'cards',
      Shuffle: 'refresh',
      Split: 'line',
      Dispense: 'package-off',
      Move: 'hand-move',
      Inspect: 'zoom-in',
      'Stand / lay flat': 'arrow-big-up-line',
      'Snap to grid': 'grid-3x3',
      Delete: 'trash',
    };
    ({ open: openRadial, close: closeRadial } = createRadialMenu(byId('radial'), {
      icons: RADIAL_ICONS,
      onClose: () => byId('fabBtn')?.classList.remove('on'),
    }));

    // ---- ⊕ table actions (mockup 10j left) -------------------------------------------------
    {
      const fab = byId('fabBtn');
      if (fab) {
        const proxy = (label, icon, sel) => {
          const src = typeof sel === 'string' ? document.querySelector(sel) : sel;
          return src && !proxyGated(src) ? { label, icon, fn: () => src.click() } : null;
        };
        fab.addEventListener('click', () => {
          if (byId('radial') && !byId('radial').hidden) return closeRadial();
          const items = [
            proxy('Dice Box', 'dice-5', '#roll'),
            proxy('Library', 'library-plus', '#lib2Btn'),
            proxy('Multi-Select', 'select-all', '#hamBar .selectTool'),
            proxy('Measure', 'ruler-measure', '#measureBtn'),
          ].filter(Boolean);
          const r = fab.getBoundingClientRect();
          if (openRadial(r.left + r.width / 2, r.top + r.height / 2, items))
            fab.classList.add('on');
        });
        fab.hidden = false; // every pointer type gets the fan now, not just touch
      }
    }

    // ---- ☰ drawer (7e slice 3; mockup 10b) -------------------------------------------------
    // Both top clusters fold into ONE sheet of grouped rows. The rows are proxies: each one
    // dispatches a click on the real button, so every behaviour, role gate and unread badge
    // keeps working with no duplicated logic. A hidden or missing source button = no row.
    {
      const DRAWER_GROUPS = [
        { label: 'Open', ids: ['lib2Btn', 'chatBtn', 'notesBtn', 'scoreBtn'] },
        {
          label: 'Room',
          ids: [
            'roomInfoBtn',
            'roomScene',
            'roomSaveState',
            'roomSettings',
            'addBtn',
            'sceneSaveBtn',
          ],
        },
        {
          label: 'Table',
          ids: ['measureBtn', 'audioBtn', 'timerBtn', 'settingsBtn', 'controlsBtn'],
        },
      ];
      const FOOT = ['roomReset', 'lobbyBtn'];
      const drawer = byId('drawer'),
        btn = byId('drawerBtn');
      if (drawer && btn) {
        const labelOf = (src) => {
          const l = src.querySelector('.lbl');
          return (l && l.textContent.trim()) || src.getAttribute('aria-label') || src.id;
        };
        const rowFor = (src) => {
          if (proxyGated(src)) return null;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'drawerRow' + (src.classList.contains('button--danger') ? ' danger' : '');
          const icon = src.dataset.icon;
          if (icon) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'ico ico-' + icon);
            svg.setAttribute('aria-hidden', 'true');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', '#i-' + icon);
            svg.appendChild(use);
            row.appendChild(svg);
          }
          const lbl = document.createElement('span');
          lbl.className = 'drawerLbl';
          lbl.textContent = labelOf(src);
          row.appendChild(lbl);
          if (src.classList.contains('hasUnread')) {
            const dot = document.createElement('span');
            dot.className = 'drawerDot';
            dot.textContent = '•';
            row.appendChild(dot);
          }
          row.addEventListener('click', () => {
            close();
            src.click(); // the real handler, including wireCluster's open/close accordion
          });
          return row;
        };
        const build = () => {
          drawer.replaceChildren();
          drawer._sheetReady = false; // rebuilt content: initSheet re-inserts its grabber
          const head = document.createElement('div');
          head.className = 'regionHead';
          const b = document.createElement('b');
          b.textContent = 'Table';
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'close-x';
          x.setAttribute('aria-label', 'Close');
          x.textContent = '✕';
          x.addEventListener('click', close);
          head.append(b, x);
          drawer.appendChild(head);
          const body = document.createElement('div');
          body.className = 'drawerBody';
          for (const g of DRAWER_GROUPS) {
            const rows = g.ids.map((id) => rowFor(byId(id))).filter(Boolean);
            if (!rows.length) continue;
            const wrap = document.createElement('div');
            wrap.className = 'drawerGroup';
            const lab = document.createElement('div');
            lab.className = 'miniLabel';
            lab.textContent = g.label;
            wrap.append(lab, ...rows);
            body.appendChild(wrap);
          }
          drawer.appendChild(body);
          const footRows = FOOT.map((id) => rowFor(byId(id))).filter(Boolean);
          if (footRows.length) {
            const foot = document.createElement('div');
            foot.className = 'drawerFoot';
            foot.append(...footRows);
            drawer.appendChild(foot);
          }
        };
        const close = wireDrawer(drawer, btn, build);
      }
    }

    // ---- seat button + popover (7e slice 4; mockup 10e) ------------------------------------
    // One button replaces #hamBar and #hamBarRight. Rows are proxies onto the real controls,
    // and the roster is the LIVE #players node, borrowed while open and returned on close so
    // its renderer keeps writing to the same element. Placement is computed from the button's
    // own rect — never from which cluster the tap came from, because there is only one now.
    {
      const btn = byId('seatBtn'),
        pop = byId('seatPop');
      if (btn && pop) {
        const SEAT_ROWS = ['mySeatBtn', 'birdsEyeBtn', 'leanBtn'];
        const proxyRow = (src, label) => {
          if (proxyGated(src)) return null;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'drawerRow';
          const icon = src.dataset.icon;
          if (icon) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'ico ico-' + icon);
            svg.setAttribute('aria-hidden', 'true');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', '#i-' + icon);
            svg.appendChild(use);
            row.appendChild(svg);
          }
          const lbl = document.createElement('span');
          lbl.className = 'drawerLbl';
          const own = src.querySelector('.lbl');
          lbl.textContent = label || (own && own.textContent.trim()) || src.id;
          row.appendChild(lbl);
          row.addEventListener('click', () => {
            close();
            src.click();
          });
          return row;
        };
        const label = (text) => {
          const el = document.createElement('div');
          el.className = 'miniLabel';
          el.textContent = text;
          return el;
        };
        const build = () => {
          pop.replaceChildren();
          const seatName = presence.seatName();
          pop.appendChild(label(seatName ? 'Your seat · ' + seatName : 'Your seat'));
          for (const id of SEAT_ROWS) {
            const r = proxyRow(byId(id));
            if (r) pop.appendChild(r);
          }
          const players = byId('players');
          if (players) {
            const rule = document.createElement('div');
            rule.className = 'seatRule';
            pop.append(rule, label('At the table'), players); // live node, moved not cloned
          }
        };
        // Anchored to the button, flipped by the space actually available around it.
        const place = () => {
          const r = btn.getBoundingClientRect();
          const w = pop.offsetWidth,
            h = pop.offsetHeight;
          const pad = 8;
          let left = r.right - w; // right-aligned to the button by default
          if (left < pad) left = Math.min(r.left, innerWidth - w - pad); // no room: flip to its left edge
          left = Math.max(pad, Math.min(left, innerWidth - w - pad));
          let top = r.top - h - pad; // above by default — the hand tab owns everything below
          if (top < pad) top = Math.min(r.bottom + pad, innerHeight - h - pad);
          pop.style.left = Math.round(left) + 'px';
          pop.style.top = Math.round(Math.max(pad, top)) + 'px';
        };
        function close() {
          if (pop.hidden) return;
          const players = pop.querySelector('#players');
          const home = byId('roomInfoBody') && byId('roomInfoBody').querySelector('.dockSection');
          if (players && home) home.appendChild(players); // give the roster back to the dock
          pop.hidden = true;
          btn.classList.remove('on');
          btn.setAttribute('aria-expanded', 'false');
        }
        const open = () => {
          build();
          pop.hidden = false;
          place();
          btn.classList.add('on');
          btn.setAttribute('aria-expanded', 'true');
          pop.setAttribute('tabindex', '-1');
          pop.focus({ preventScroll: true });
        };
        pop._close = close; // other surfaces close us before borrowing #players
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          pop.hidden ? open() : close();
        });
        addEventListener('pointerdown', (e) => {
          if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close();
        });
        addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && !pop.hidden) {
            close();
            btn.focus({ preventScroll: true });
          }
        });
        addEventListener('resize', () => {
          if (!pop.hidden) place();
        });
        btn.hidden = false; // the seat button is the default at every pointer type
      }
    }

    // ---- Room info sheet (7e slice 5; mockup 10f) ------------------------------------------
    // The top bar stopped carrying the room code and the dock in slice 2; this is where they
    // went. The dock's live #roomInfoBody is borrowed while open (same trick as the roster in
    // slice 4) so Players / Room notes / Members keep their existing renderers.
    {
      const sheet = byId('roomSheet'),
        src = byId('roomInfoBtn');
      if (sheet && src) {
        const row = (icon, text, fn, cls) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'drawerRow' + (cls ? ' ' + cls : '');
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'ico ico-' + icon);
          svg.setAttribute('aria-hidden', 'true');
          const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('href', '#i-' + icon);
          svg.appendChild(use);
          const lbl = document.createElement('span');
          lbl.className = 'drawerLbl';
          lbl.textContent = text;
          b.append(svg, lbl);
          b.addEventListener('click', fn);
          return b;
        };
        const roomCode = () => {
          const rc = byId('roomCode');
          if (!rc || rc.hidden) return ''; // GM+ only, same gate as the desktop dock
          return (rc.textContent || '').replace(/^Code:\s*/, '').trim();
        };
        const build = () => {
          sheet.replaceChildren();
          sheet._sheetReady = false;
          const head = document.createElement('div');
          head.className = 'regionHead';
          const b = document.createElement('b');
          b.textContent = 'Room info';
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'close-x';
          x.setAttribute('aria-label', 'Close');
          x.textContent = '✕';
          x.addEventListener('click', close);
          head.append(b, x);
          const body = document.createElement('div');
          body.className = 'drawerBody';

          const card = document.createElement('div');
          card.className = 'roomCard';
          const name = document.createElement('div');
          name.className = 'roomCardName';
          name.textContent = (byId('roomTitle') && byId('roomTitle').textContent) || 'Shared Table';
          const meta = document.createElement('div');
          meta.className = 'roomCardMeta';
          const seated = getRoom() && getRoom().state ? getRoom().state.players.size : 0;
          meta.textContent = seated + (seated === 1 ? ' player' : ' players') + ' at the table';
          card.append(name, meta);
          const code = roomCode();
          if (code) {
            const cr = document.createElement('div');
            cr.className = 'roomCodeRow';
            const val = document.createElement('span');
            val.className = 'roomCodeVal';
            val.textContent = code;
            cr.appendChild(val);
            cr.appendChild(
              row('copy', 'Copy', () => {
                navigator.clipboard?.writeText(code);
                toast('Room code copied');
              }),
            );
            const url = location.origin + '/?room=' + encodeURIComponent(code);
            if (navigator.share)
              cr.appendChild(
                row('share', 'Share', () => navigator.share({ title: 'Open Tabletop', url })),
              );
            card.appendChild(cr);
          }
          body.appendChild(card);

          const dock = byId('roomInfoBody');
          if (dock) body.appendChild(dock); // live node, returned on close
          sheet.append(head, body);
        };
        function close() {
          if (sheet.hidden) return;
          const dock = sheet.querySelector('#roomInfoBody');
          const home = byId('roomInfo');
          if (dock && home) home.appendChild(dock);
          sheet.hidden = true;
          clearSheet(sheet);
        }
        const open = () => {
          const sp = byId('seatPop'); // it may be holding the live #players node
          if (sp && !sp.hidden && sp._close) sp._close();
          build();
          sheet.hidden = false;
          openAsSheet(sheet);
          sheet.setAttribute('tabindex', '-1');
          sheet.focus({ preventScroll: true });
        };
        sheet._close = close;
        src.addEventListener('click', () => (sheet.hidden ? open() : close()));
        sheet.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        });
        // The room name in the touch top bar is the other way in.
        const title = byId('roomTitle');
        if (title)
          title.addEventListener('click', () => {
            if (isSheet()) sheet.hidden ? open() : close();
          });
      }
    }

    // ---- hand tray (7e slice 6; mockup 10g) ------------------------------------------------
    // The hand stops being a permanent 96px strip and becomes a tab you pull up. Open, it
    // stacks the same hand and disclosure actions used by the desktop row.
    {
      const row = byId('handRow'),
        tab = byId('handTab'),
        hand = byId('hand');
      if (row && tab && hand) {
        const count = () => hand.querySelectorAll('.handcard').length;
        const sync = () => {
          const n = count();
          tab.hidden = !isSheet();
          const lbl = tab.querySelector('.handCount');
          if (lbl) lbl.textContent = n;
          const fan = tab.querySelector('.handFan');
          if (fan) fan.style.visibility = n ? 'visible' : 'hidden';
          const text = tab.querySelector('.handTabLbl');
          if (text) text.textContent = n ? 'Your hand' : 'Your hand is empty';
          if (!isSheet()) setOpen(false); // leaving touch: the desktop row is always shown
        };
        const setOpen = (open) => {
          row.classList.toggle('trayOpen', open);
          document.body.classList.toggle('trayOpen', open);
          tab.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        tab.addEventListener('click', () => setOpen(!row.classList.contains('trayOpen')));
        new MutationObserver(sync).observe(hand, { childList: true });
        addEventListener('resize', sync);
        sync();
      }
    }
  }
  return {
    prepare,
    toast,
    bindRoomControls,
    bindInteractionControls,
    bindControls,
    isSheet: () => surfaces.isSheet(),
    openRadial: (...args) => openRadial(...args),
  };
}
