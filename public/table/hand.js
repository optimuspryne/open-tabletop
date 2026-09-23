// Private hand state, rendering, Show controls, and hand-only pointer gestures.
export function createHand({
  scene,
  camera,
  renderer,
  ray,
  pointer,
  dragPlane,
  hit,
  setPointer,
  cardMesh,
  parseCardFront,
  cardPreviewURL,
  applyIcons,
  setIcon,
  getRoom,
  getSessionId,
  inspectMesh,
  syncControlGuide,
  toast,
  byId,
  dragThreshold,
  doc = document,
  win = window,
  storage = localStorage,
  delay = setTimeout,
  cancelDelay = clearTimeout,
}) {
  const document = doc;
  const window = win;
  const localStorage = storage;
  const addEventListener = (...args) => win.addEventListener(...args);
  const requestAnimationFrame = (fn) => win.requestAnimationFrame(fn);
  const cancelAnimationFrame = (id) => win.cancelAnimationFrame(id);

  // hidden hand: a private bottom bar only this client ever sees
  let handDrag = null, // dragging a card out of the hand onto the table
    handHoverCard = null; // desktop contextual-control guide target
  const dropPreview = (m) => {
    if (!m) return;
    scene.remove(m);
    // Placed cards and drag previews share immutable geometry; keep the cached GPU buffer alive.
    if (m.geometry && !m.geometry.userData.sharedCardGeometry) m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x && x.dispose());
  };
  let handClickTimer = null; // a pending single-click play, cancelled if a double-click (inspect) follows
  const HAND_HOVER = 0.6; // the drag preview floats this high above the felt so it clears boards/tiles (e.g. Wordy)
  function inspectHandCard(card) {
    cancelDelay(handClickTimer);
    handClickTimer = null;
    inspectMesh(
      cardMesh({ front: card.front, back: card.back, geom: card.geom, tile: card.tile }),
      {
        drawn: true,
        type: 'card',
        hid: card.hid,
      },
    );
    byId('hand').style.display = 'none';
  } // hide the hand behind the inspect view
  const touchIds = new Set(); // active touch pointers → a hand drag reads this: 1 finger = face-down, 2 = face-up
  addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      touchIds.add(e.pointerId);
      if (handDrag && handDrag.touch) handDrag.faceDown = touchIds.size < 2;
    },
    true,
  ); // a 2nd finger (even a still tap) → face-up
  addEventListener('pointerup', (e) => touchIds.delete(e.pointerId), true);
  addEventListener('pointercancel', (e) => touchIds.delete(e.pointerId), true);

  // Show-cards feature state. revealed: cards another player is showing us, drawn
  // face-up in their fan. selectMode/selected: while the Show panel is picking
  // specific cards, the hand bar toggles selection instead of playing. myHand: the
  // last hand we received, so we can re-render on a select-mode toggle.
  const revealed = new Map(); // sid -> [{front,back}]
  const selected = new Set(); // hids picked to show
  let selectMode = false,
    reorderMode = false,
    myHand = [];
  let handReorder = null; // an in-progress drag-to-rearrange (reorder mode)
  let handCollapsed = false;
  try {
    handCollapsed = localStorage.getItem('ott.handHidden') === '1';
  } catch {} // personal view preference, remembered across refreshes
  function setHandCollapsed(v) {
    handCollapsed = v;
    try {
      localStorage.setItem('ott.handHidden', v ? '1' : '0');
    } catch {}
    renderHand(myHand);
  }
  addEventListener('pointermove', (e) => {
    if (!handDrag) return;
    if (e.pointerId !== handDrag.pointerId) return; // only the finger that armed the drag drives it
    if (!handDrag.dragging) {
      if (Math.hypot(e.clientX - handDrag.sx, e.clientY - handDrag.sy) < dragThreshold) return;
      handDrag.dragging = true;
      byId('hand').classList.add('hand-dragging'); // hide the hand while dragging so it doesn't obscure the table
      document.body.style.userSelect = document.body.style.webkitUserSelect = 'none'; // stop the text-selection sweep
      const selection = window.getSelection && window.getSelection();
      if (selection) selection.removeAllRanges();
      // A real (local, unsynced) card mesh that rides the table under the pointer — same look as a played card.
      const d = handDrag;
      const mesh = cardMesh({ front: d.front, back: d.back, geom: d.geom, tile: d.tile });
      mesh.renderOrder = 6;
      scene.add(mesh);
      handDrag.mesh = mesh;
    }
    if (handDrag.touch) handDrag.faceDown = touchIds.size < 2; // live-flip the face as fingers change during the drag
    if (handDrag.mesh) handDrag.mesh.rotation.x = handDrag.faceDown ? Math.PI : 0; // face-down shows the back
    setPointer(e);
    ray.setFromCamera(pointer, camera);
    if (ray.ray.intersectPlane(dragPlane, hit))
      handDrag.mesh.position.set(hit.x, HAND_HOVER, hit.z); // hover above the felt so the card clears boards/tiles
  });
  addEventListener('pointerup', (e) => {
    if (!handDrag) return;
    if (e.pointerId !== handDrag.pointerId) return; // only the arming finger ends the drag/tap
    const drag = handDrag;
    handDrag = null;
    // Hit-test before revealing the hand, which may cover the drop point.
    const droppedOnTable = document.elementFromPoint(e.clientX, e.clientY) === renderer.domElement;
    byId('hand').classList.remove('hand-dragging'); // a rejected play may not change the hand
    document.body.style.userSelect = document.body.style.webkitUserSelect = ''; // re-enable selection
    dropPreview(drag.mesh); // discard the local preview
    if (!drag.dragging) {
      const d = drag;
      cancelDelay(handClickTimer);
      handClickTimer = delay(
        () => getRoom().send('playCard', { hid: d.hid, faceDown: d.faceDown }),
        240,
      );
      return;
    } // click = quick play (delayed so a double-click inspects instead)
    if (!droppedOnTable) {
      return;
    } // dropped on UI → cancel, reveal the hand
    setPointer(e);
    ray.setFromCamera(pointer, camera);
    ray.ray.intersectPlane(dragPlane, hit); // where on the table
    getRoom().send('playCard', { hid: drag.hid, faceDown: drag.faceDown, x: hit.x, z: hit.z });
  });
  addEventListener('pointercancel', (e) => {
    // a cancelled drag must still discard its preview
    if (!handDrag || e.pointerId !== handDrag.pointerId) return;
    dropPreview(handDrag.mesh);
    handDrag = null;
    byId('hand').classList.remove('hand-dragging');
    document.body.style.userSelect = document.body.style.webkitUserSelect = '';
  });

  // ===== Hand re-organization (ROADMAP §8) ====================================
  // A per-viewer "Rearrange" mode: while on, dragging a hand card slots it to a new
  // position instead of playing it, and Sort tidies the whole hand. The order is a
  // permutation sent to the server (reorderHand) so it survives a reconnect. Kept
  // entirely separate from the play-to-table gesture to avoid regressing it.
  function exitReorderMode() {
    if (!reorderMode) return;
    reorderMode = false;
    const bar = byId('rearrangeBar');
    if (bar) bar.hidden = true;
    const btn = byId('rearrangeBtn');
    if (btn) btn.setAttribute('aria-pressed', 'false');
    renderHand(myHand);
  }
  function setReorderMode(on) {
    if (on) {
      if (handCollapsed) setHandCollapsed(false); // reorder needs the hand open
      if (selectMode) {
        // reorder and show-picking are mutually exclusive hand modes
        selectMode = false;
        selected.clear();
        byId('hand').classList.remove('selecting');
      }
    }
    reorderMode = !!on;
    const bar = byId('rearrangeBar');
    if (bar) bar.hidden = !reorderMode;
    const btn = byId('rearrangeBtn');
    if (btn) btn.setAttribute('aria-pressed', reorderMode ? 'true' : 'false');
    renderHand(myHand);
  }

  // Commit the current DOM order (or a computed order) to the server and local state.
  function commitHandOrder(order) {
    const byHid = new Map(myHand.map((c) => [c.hid, c]));
    const next = order.map((h) => byHid.get(h)).filter(Boolean);
    if (next.length === myHand.length) myHand = next; // optimistic; server confirms via 'hand'
    if (getRoom()) getRoom().send('reorderHand', { order });
  }

  // Which sibling card should the dragged one land before, for a pointer at clientX?
  function reorderAfter(scroll, x) {
    const cards = scroll.querySelectorAll('.handcard:not(.dragging)');
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (x < r.left + r.width / 2) return c;
    }
    return null; // past the last card → append
  }
  function startHandReorder(ev, card, div, scroll) {
    if (ev.button !== undefined && ev.button !== 0) return; // left button / touch only
    ev.preventDefault();
    handReorder = { el: div, scroll, pointerId: ev.pointerId };
    div.classList.add('dragging');
    try {
      div.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }
  // Slot the dragged card into the position matching pointer x (DOM insertion, no free-follow).
  function placeDragged(scroll, el, x) {
    const after = reorderAfter(scroll, x);
    if (after == null) {
      if (el !== scroll.lastElementChild) scroll.appendChild(el);
    } else if (after !== el && after !== el.nextSibling) {
      scroll.insertBefore(el, after);
    }
  }
  let handAutoScroll = 0; // rAF id while auto-scrolling the strip during a reorder drag
  function stopHandAutoScroll() {
    if (handAutoScroll) cancelAnimationFrame(handAutoScroll);
    handAutoScroll = 0;
  }
  // While the finger holds near an end of the strip, keep scrolling (and re-slotting) even though
  // no pointermove fires — so you can reorder into cards that start off-screen.
  function autoScrollTick() {
    handAutoScroll = 0;
    if (!handReorder || !handReorder.edgeDir) return;
    const { scroll, el, edgeDir, lastX } = handReorder;
    scroll.scrollLeft += edgeDir * 12; // px/frame toward the held edge (clamps at the ends)
    if (lastX != null) placeDragged(scroll, el, lastX);
    handAutoScroll = requestAnimationFrame(autoScrollTick);
  }
  addEventListener('pointermove', (e) => {
    if (!handReorder || e.pointerId !== handReorder.pointerId) return;
    e.preventDefault();
    const { scroll, el } = handReorder;
    handReorder.lastX = e.clientX;
    placeDragged(scroll, el, e.clientX);
    const r = scroll.getBoundingClientRect();
    const EDGE = 44; // px hot-zone at each end
    handReorder.edgeDir = e.clientX < r.left + EDGE ? -1 : e.clientX > r.right - EDGE ? 1 : 0;
    if (handReorder.edgeDir && !handAutoScroll)
      handAutoScroll = requestAnimationFrame(autoScrollTick);
  });
  function endHandReorder(e) {
    if (!handReorder || e.pointerId !== handReorder.pointerId) return;
    const { el, scroll } = handReorder;
    handReorder = null;
    stopHandAutoScroll();
    el.classList.remove('dragging');
    const order = [...scroll.querySelectorAll('.handcard')]
      .map((c) => c.dataset.hid)
      .filter(Boolean);
    commitHandOrder(order);
  }
  addEventListener('pointerup', endHandReorder);
  addEventListener('pointercancel', (e) => {
    if (!handReorder || e.pointerId !== handReorder.pointerId) return;
    handReorder = null;
    stopHandAutoScroll();
    renderHand(myHand); // revert to the confirmed order
  });

  // --- Sort ---
  const SUIT_ORDER = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 }; // ♠ ♥ ♦ ♣
  const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const KIND_ORDER = { rank: 0, joker: 1, domino: 2, letter: 3, text: 4, image: 5, back: 6 };
  // A comparable key: group by card kind, then by suit/rank (mode picks which leads) for playing
  // cards, or a natural order for tiles/letters/images so mixed hands still tidy up sensibly.
  function cardSortKey(card, mode) {
    const cf = parseCardFront(card.front);
    const kg = String(KIND_ORDER[cf.kind] ?? 9);
    if (cf.kind === 'rank') {
      const suit = String(SUIT_ORDER[cf.suit] ?? 9);
      const rank = String(Math.max(0, RANK_ORDER.indexOf(cf.rank))).padStart(2, '0');
      return mode === 'suit' ? kg + suit + rank : kg + rank + suit;
    }
    if (cf.kind === 'letter') return kg + (cf.letter || '');
    if (cf.kind === 'domino') return kg + Math.max(cf.a, cf.b) + '' + Math.min(cf.a, cf.b);
    return kg + (card.front || '');
  }
  function sortHand(mode) {
    if (myHand.length < 2) return;
    const order = [...myHand]
      .sort((a, b) => cardSortKey(a, mode).localeCompare(cardSortKey(b, mode)))
      .map((c) => c.hid);
    commitHandOrder(order);
    renderHand(myHand);
  }

  // Wire the Rearrange toggle + Sort buttons (present in table.html's hand flank).
  {
    const rb = byId('rearrangeBtn');
    if (rb) rb.onclick = () => setReorderMode(!reorderMode);
    const bar = byId('rearrangeBar');
    if (bar)
      bar
        .querySelectorAll('[data-sort]')
        .forEach((b) => (b.onclick = () => sortHand(b.dataset.sort)));
  }

  function renderHand(cards) {
    const el = byId('hand');
    handHoverCard = null;
    el.innerHTML = '';
    el.classList.remove('collapsed');
    el.classList.remove('hand-dragging'); // a fresh render (after a play/cancel) reveals the hand
    el.classList.toggle('reordering', reorderMode); // grab-cursor + touch-action while rearranging
    {
      const has = cards.length > 0;
      const sb = byId('showBtn'),
        db = byId('dropFlank');
      if (sb) sb.hidden = !has;
      if (db) db.hidden = !has;
      const rb = byId('rearrangeBtn');
      if (rb) rb.hidden = !has;
      if (!has && reorderMode) {
        reorderMode = false; // no cards left to rearrange (inline; we're mid-render)
        const bar = byId('rearrangeBar');
        if (bar) bar.hidden = true;
        if (rb) rb.setAttribute('aria-pressed', 'false');
      }
      if (!has) {
        const strip = byId('showStrip');
        if (strip) strip.hidden = true;
        if (sb) sb.setAttribute('aria-expanded', 'false');
        const choices = byId('dropChoices');
        if (choices) choices.hidden = true;
        const dropBtn = byId('dropBtn');
        if (dropBtn) dropBtn.setAttribute('aria-expanded', 'false');
      }
    } // Show/Drop flank the hand, only when you hold cards
    if (handCollapsed && cards.length && !selectMode && !reorderMode) {
      // hidden: show only a peek tab (never while picking cards to show)
      el.classList.add('collapsed');
      const tab = document.createElement('button');
      tab.className = 'handToggle';
      tab.dataset.icon = 'cards eye';
      tab.setAttribute('aria-label', `Show hand (${cards.length})`);
      tab.onclick = () => setHandCollapsed(false);
      el.appendChild(tab);
      applyIcons(el);
      el.style.display = 'flex';
      return;
    }
    const scroll = document.createElement('div');
    scroll.className = 'handScroll'; // horizontally scrollable card strip
    for (const card of cards) {
      const div = document.createElement('div');
      div.className = 'handcard';
      div.dataset.hid = card.hid;
      const cf = parseCardFront(card.front);
      if (cf.kind === 'rank') {
        div.textContent = cf.rank + cf.suit;
        div.style.color = cf.color || '#111';
      } else if (
        cf.kind === 'text' ||
        cf.kind === 'joker' ||
        cf.kind === 'domino' ||
        cf.kind === 'letter'
      ) {
        div.classList.add('img'); // render the same texture the table uses (wrapped text / joker / domino / letter face)
        if (cf.kind === 'domino') div.classList.add('tile'); // a domino slot is 1:2, so the tile fills it without clipping
        if (cf.kind === 'letter') div.classList.add('tileSq'); // a letter tile is square
        const u = cardPreviewURL(card.front);
        if (u) div.style.backgroundImage = `url("${u}")`;
      } else if (cf.kind === 'image') {
        div.classList.add('img');
        if (card.geom && card.geom.shape === 'hex')
          div.classList.add('shape-hex'); // match the tabletop silhouette
        else if (card.geom && card.geom.round === 0) div.classList.add('shape-square');
        div.style.backgroundImage = `url("${cf.ref}")`; // uploaded/file card art
      }
      div.title = 'Left drag/click: face-down · Right drag/click: face-up';
      div.oncontextmenu = (ev) => ev.preventDefault(); // right-click is handled by the pointer events
      div.addEventListener('pointerenter', (ev) => {
        if (ev.pointerType && ev.pointerType !== 'mouse') return;
        handHoverCard = card;
        syncControlGuide();
      });
      div.addEventListener('pointerleave', () => {
        if (handHoverCard === card) handHoverCard = null;
        syncControlGuide();
      });
      if (selectMode && selected.has(card.hid)) div.classList.add('sel');
      div.addEventListener('pointerdown', (ev) => {
        if (handDrag) return; // a drag is already in progress (e.g. a second finger) — don't re-arm
        if (reorderMode) return startHandReorder(ev, card, div, scroll); // rearrange, don't play
        if (selectMode) {
          // picking cards to show — toggle instead of playing
          if (ev.button !== 0) return;
          ev.preventDefault();
          if (selected.has(card.hid)) {
            selected.delete(card.hid);
            div.classList.remove('sel');
          } else {
            selected.add(card.hid);
            div.classList.add('sel');
          }
          return;
        }
        if (ev.button === 0 || ev.button === 2) {
          ev.preventDefault();
          handDrag = {
            hid: card.hid,
            faceDown: ev.button !== 2,
            touch: ev.pointerType === 'touch',
            pointerId: ev.pointerId,
            front: card.front,
            back: card.back,
            geom: card.geom,
            tile: card.tile,
            sx: ev.clientX,
            sy: ev.clientY,
            dragging: false,
            mesh: null,
          }; // mouse: left=down, right=up. touch: 1 finger=down, 2=up (set live from touchIds)
        }
      });
      div.ondblclick = () => {
        if (reorderMode) return;
        cancelDelay(handClickTimer);
        inspectHandCard(card);
      }; // desktop: double-click to inspect
      const eye = document.createElement('button');
      eye.className = 'cardEye';
      eye.setAttribute('aria-label', 'Inspect card');
      setIcon(eye, 'eye');
      eye.addEventListener('pointerdown', (ev) => ev.stopPropagation()); // tapping the eye must not arm a drag
      eye.onclick = (ev) => {
        ev.stopPropagation();
        inspectHandCard(card);
      };
      div.appendChild(eye);
      scroll.appendChild(div);
    }
    const mkChev = (dir, icon, label) => {
      const b = document.createElement('button');
      b.className = 'handScrollBtn';
      b.setAttribute('aria-label', label);
      setIcon(b, icon);
      b.onclick = () =>
        scroll.scrollBy({ left: dir * scroll.clientWidth * 0.7, behavior: 'smooth' });
      return b;
    };
    const leftChev = mkChev(-1, 'square-chevron-left', 'Scroll left');
    const rightChev = mkChev(1, 'square-chevron-right', 'Scroll right');
    el.append(leftChev, scroll, rightChev);
    const syncChevrons = () => {
      const sc = scroll.scrollWidth > scroll.clientWidth + 2;
      leftChev.hidden = rightChev.hidden = !sc;
      if (sc) {
        leftChev.disabled = scroll.scrollLeft <= 0;
        rightChev.disabled = scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth - 2;
      }
    };
    scroll.addEventListener('scroll', syncChevrons);
    requestAnimationFrame(syncChevrons);
    if (cards.length && !selectMode) {
      // a small handle to hide the hand from your view
      const hide = document.createElement('button');
      hide.className = 'handToggle hide';
      setIcon(hide, 'eye-off');
      hide.setAttribute('aria-label', 'Hide your hand');
      hide.onclick = () => setHandCollapsed(true);
      el.appendChild(hide);
    }
    el.style.display = cards.length ? 'flex' : 'none';
  }

  const bindShowControls = () => {
    const room = getRoom();
    // ---- Show cards (UI_Redesign 7j / mockup 9b): the audience IS the control ----
    // Latched, matching the server's model: showStart replaces the audience set,
    // showStop clears it. Tap a face to start showing, tap again to stop.
    const showStrip = byId('showStrip'),
      showStripChips = byId('showStripChips'),
      showStatus = byId('showStatus');
    const showTo = new Set(); // sids, or the single sentinel 'all'
    let selOnly = false; // show only the cards selected in hand

    // Same two helpers as before, minus the scope-chip resets (those chips are gone).
    const enterSelectMode = () => {
      exitReorderMode();
      selectMode = true;
      selected.clear();
      byId('hand').classList.add('selecting');
      renderHand(myHand);
    };
    const exitSelectMode = () => {
      if (selectMode) {
        selectMode = false;
        selected.clear();
        byId('hand').classList.remove('selecting');
        renderHand(myHand);
      }
    };

    const showHids = () => (selOnly && selected.size ? [...selected] : 'all');
    const pushShow = () => {
      if (!room) return;
      if (!showTo.size) {
        room.send('showStop');
      } else {
        const hids = showHids();
        if (Array.isArray(hids) && !hids.length) return;
        room.send('showStart', { to: showTo.has('all') ? 'all' : [...showTo], hids });
      }
      renderShowStrip();
    };
    const toggleShow = (key) => {
      if (key === 'all') {
        showTo.has('all') ? showTo.clear() : (showTo.clear(), showTo.add('all'));
      } else {
        showTo.delete('all');
        showTo.has(key) ? showTo.delete(key) : showTo.add(key);
      }
      pushShow();
    };

    function renderShowStrip() {
      if (!showStripChips) return;
      showStripChips.replaceChildren();
      const mk = (key, label, icon, color) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.sid = key;
        if (icon) b.dataset.icon = icon;
        else {
          const av = document.createElement('span');
          av.className = 'stripAv';
          if (color) av.style.background = color;
          b.append(av);
        }
        const l = document.createElement('span');
        l.className = 'lbl';
        l.textContent = label; // textContent — names are user input
        b.append(l);
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-pressed', showTo.has(key) ? 'true' : 'false');
        if (showTo.has(key)) b.classList.add('on');
        b.onclick = () => toggleShow(key);
        showStripChips.append(b);
        return b;
      };
      const others = [];
      room.state.players.forEach((p, sid) => {
        if (sid !== getSessionId()) others.push([sid, p]);
      });
      others.sort((a, b) => a[1].seat - b[1].seat);
      for (const [sid, p] of others) mk(sid, p.name, null, p.color);
      if (others.length > 1) mk('all', 'Everyone', 'users-group');
      // Optional scope: only the cards picked in hand (replaces the old scope chips).
      {
        const sep = document.createElement('div');
        sep.className = 'stripSep';
        showStripChips.append(sep);
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.icon = 'select-all';
        b.innerHTML =
          '<span class="lbl">Picked' + (selected.size ? ' · ' + selected.size : '') + '</span>';
        b.setAttribute('aria-label', 'Show only the cards I pick');
        if (selOnly) b.classList.add('on');
        b.onclick = () => {
          selOnly = !selOnly;
          selOnly ? enterSelectMode() : exitSelectMode();
          if (showTo.size) pushShow();
          else renderShowStrip();
        };
        showStripChips.append(b);
      }
      applyIcons(showStripChips);
      // Status line: who is seeing what, in words.
      const names = [...showTo].map((k) =>
        k === 'all' ? 'everyone' : room.state.players.get(k)?.name || 'player',
      );
      const hids = showHids();
      const count = Array.isArray(hids) ? hids.length : myHand.length;
      showStatus.textContent = names.length
        ? 'showing ' +
          (Array.isArray(hids) ? count + ' card(s)' : 'your hand') +
          ' to ' +
          names.join(', ') +
          ' · tap to stop'
        : '';
    }

    byId('showBtn').onclick = () => {
      if (!showStrip) return;
      showStrip.hidden = !showStrip.hidden;
      byId('showBtn').setAttribute('aria-expanded', showStrip.hidden ? 'false' : 'true');
      if (showStrip.hidden) {
        if (showTo.size) {
          showTo.clear();
          pushShow();
        }
        if (selOnly) {
          selOnly = false;
          exitSelectMode();
        }
      } else renderShowStrip();
    };
    window.onShowRosterChange = () => {
      if (showStrip && !showStrip.hidden) renderShowStrip();
    };
  };

  function handControlRows(drag) {
    if (!drag)
      return [
        ['Left-drag / click', 'Play face-down'],
        ['Right-drag / click', 'Play face-up'],
        ['Double-click / eye', 'Inspect'],
        ['Rearrange', 'Change hand order'],
      ];
    return [
      ['Mouse', 'Position card'],
      ['Release over table', `Play face-${drag.faceDown ? 'down' : 'up'}`],
      ['Release over UI', 'Cancel'],
    ];
  }

  const cancelGesture = () => {
    cancelDelay(handClickTimer);
    handClickTimer = null;
    if (handDrag) {
      dropPreview(handDrag.mesh);
      handDrag = null;
      byId('hand').classList.remove('hand-dragging');
      document.body.style.userSelect = document.body.style.webkitUserSelect = '';
    }
    if (handReorder) {
      handReorder = null;
      stopHandAutoScroll();
      renderHand(myHand);
    }
  };

  function setCards(cards) {
    myHand = Array.isArray(cards) ? cards : [];
    renderHand(myHand);
  }
  function bindRoom(room) {
    room.onMessage('hand', setCards); // private delivery only
    room.send('handSync'); // reconnect may miss onJoin's first delivery
    // The undo may be partial (another player picked some up) or stale (30s window gone).
    room.onMessage('dropUndone', ({ restored } = {}) => {
      if (restored)
        toast('Returned ' + restored + ' card' + (restored === 1 ? '' : 's') + ' to your hand');
      else toast('Those cards are no longer on the table', 'x');
    });
  }

  return {
    setCards,
    bindRoom,
    setRevealed(sid, cards) {
      if (cards?.length) revealed.set(sid, cards);
      else revealed.delete(sid);
    },
    clearRevealed: (sid) => revealed.delete(sid),
    revealedFor: (sid) => revealed.get(sid) || [],
    render: () => renderHand(myHand),
    cancelGesture,
    bindShowControls,
    isDragging: () => !!handDrag,
    drag: () => handDrag,
    hoverCard: () => handHoverCard,
    controlRows: handControlRows,
  };
}
