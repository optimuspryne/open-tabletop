import { applyIcons } from '../ui/icons.js';
import { makeButton } from '../ui/rows.js';
import { dispenserDefinition } from '../../shared/pieces.js';
// Piece menus and contextual feedback. Gesture state and server actions remain injected.
export function createPieceUi({
  byId,
  canvas,
  meshes,
  kinds: KIND,
  getRoom,
  canInteract = () => true,
  pieceDrag,
  hand,
  inspection,
  selection,
  overlays,
  whiteboard,
  setPointer,
  pickId,
  isSheet,
  openRadial,
  highlightPiece,
  getRank,
  editLabels,
  browseDeck,
}) {
  const RADIAL_MAX = 7;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Tabletop. Shift+F10 opens or cycles notecard stack actions.');
  // Hover readout: a small tooltip over the deck or dispenser under the cursor showing
  // how many are left inside (∞ for the infinite go bowl). Pure client-side, shown only
  // when idle (not mid-drag / inspect / draw / measure), and kept live by the render loop
  // so it updates as a piece is dealt or dispensed without moving the cursor.
  const hoverTip = document.createElement('div');
  hoverTip.id = 'hoverCount';
  hoverTip.hidden = true;
  document.body.appendChild(hoverTip);
  const controlGuide = document.createElement('aside');
  controlGuide.id = 'controlGuide';
  controlGuide.setAttribute('aria-label', 'Available controls');
  controlGuide.hidden = true;
  document.body.appendChild(controlGuide);
  const controlGuidePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let hoverId = null,
    lastHover = 0,
    controlGuideSig = '';
  const hoverIdle = () =>
    !pieceDrag.isActive() &&
    !inspection.isActive() &&
    !overlays.isMeasuring() &&
    !whiteboard.isOwning() &&
    !overlays.isMoving() &&
    !hand.isDragging() &&
    !overlays.isDraggingMeasure();
  function countLabel(piece) {
    if (piece.type === 'notecardStack') return `${piece.count} notecards`;
    if (piece.type === 'deck') return `${piece.count} card${piece.count === 1 ? '' : 's'}`;
    const d = dispenserDefinition(JSON.parse(piece.props || '{}'));
    if (!d) return null;
    return d.infinite ? '∞' : String(piece.count); // bowl = unlimited
  }
  function hideHoverTip() {
    if (!hoverTip.hidden) hoverTip.hidden = true;
    hoverId = null;
    syncControlGuide();
  }

  const PIECE_CONTROL_NAMES = {
    notecard: 'Notecard',
    notecardStack: 'Notecard stack',
    card: 'Card',
    deck: 'Deck',
    die: 'Die',
    prop: 'Object',
    dispenser: 'Dispenser',
    mat: 'Mat',
  };
  function pieceControlRows(type, held) {
    if (!canInteract())
      return [
        ['Right-click / long-press', 'Inspect / highlight'],
        ['WASD / arrows', 'Pan camera'],
      ];
    if (held) {
      const kind = KIND[type];
      return [
        ['Mouse', 'Move'],
        ['Release', kind.grab === 2 || kind.heavy ? 'Drop' : 'Drop / throw'],
        ['W S / ↑ ↓ / wheel', 'Raise / lower'],
        ['A D / ← → / Alt-drag', 'Rotate'],
        ['Shift + Alt-drag', 'Rotate freely'],
        ['Middle-click', 'Turn 45°'],
        ['G', 'Snap to grid'],
        ...(type === 'mat' ? [] : [['U', 'Stand / lay flat']]),
        ['Delete', 'Remove'],
      ];
    }
    const rows = [];
    rows.push(['Middle-click', 'Highlight for everyone']);
    if (getRank() >= 2) rows.push(['L', 'Edit label / low stock']);
    if (type === 'notecardStack')
      rows.push(
        ['Left-drag', 'Move stack'],
        ['Double-click', 'Draw & edit'],
        ['Right-click / long-press', 'Stack actions'],
        ['Shift + F10', 'Cycle stack menus'],
      );
    else if (type === 'deck')
      rows.push(
        ['Left-drag', 'Deal a card'],
        ['Left-click', 'Draw to hand'],
        ['Right-drag', 'Move deck'],
        ['Double-click', 'Peek at top card'],
        ['Right-click', 'Deck actions'],
      );
    else if (type === 'dispenser')
      rows.push(
        ['Left-drag / click', 'Dispense'],
        ['Right-drag', 'Move dispenser'],
        ['Double-click', 'Inspect'],
        ['Right-click', 'Dispenser actions'],
      );
    else if (type === 'card')
      rows.push(
        ['Left-drag', 'Move'],
        ['Left-click', 'Take to hand'],
        ['Right-click', 'Flip'],
        ['Double-click', 'Inspect'],
      );
    else {
      rows.push(['Left-drag', 'Move']);
      if (inspection.isInspectable(type)) rows.push(['Double-click', 'Inspect']);
      rows.push(['Right-click', 'Piece actions']);
    }
    if (selection.size)
      rows.push(
        ['W S / ↑ ↓', 'Pan camera'],
        ['A D / ← →', `Rotate ${selection.size} selected`],
        ['U / G', 'Stand / snap selection'],
        ['F / R / H', 'Flip / roll / take selection'],
        ['Delete', 'Remove selection'],
      );
    else
      rows.push(
        ['WASD / arrows', 'Pan camera'],
        ['G', 'Snap to grid'],
        ...(type === 'mat' ? [] : [['U', 'Stand / lay flat']]),
        ['Delete', 'Remove'],
      );
    return rows;
  }
  function showControlGuide(title, subtitle, rows) {
    const sig = JSON.stringify([title, subtitle, rows]);
    const ham = byId('hamBar');
    if (ham && !ham.hidden) {
      const r = ham.getBoundingClientRect();
      if (r.height) controlGuide.style.bottom = innerHeight - r.top + 10 + 'px';
    }
    if (sig === controlGuideSig && !controlGuide.hidden) return;
    controlGuideSig = sig;
    const head = document.createElement('strong');
    head.textContent = title;
    controlGuide.replaceChildren(head);
    if (subtitle) {
      const meta = document.createElement('span');
      meta.className = 'controlGuideMeta';
      meta.textContent = subtitle;
      controlGuide.appendChild(meta);
    }
    const list = document.createElement('div');
    list.className = 'controlGuideList';
    for (const [keys, action] of rows) {
      const row = document.createElement('div'),
        key = document.createElement('kbd'),
        label = document.createElement('span');
      key.textContent = keys;
      label.textContent = action;
      row.append(key, label);
      list.appendChild(row);
    }
    controlGuide.appendChild(list);
    controlGuide.hidden = false;
  }
  function syncControlGuide() {
    const down = pieceDrag.current();
    const region = byId('regionBL');
    if (!controlGuidePointer.matches || (region && !region.hidden)) {
      controlGuideSig = '';
      controlGuide.hidden = true;
      return;
    }
    if (hand.drag()) {
      showControlGuide('Hand card — dragging', null, hand.controlRows(hand.drag()));
      return;
    }
    if (down && down.grabbed) {
      const piece = getRoom() && getRoom().state.pieces.get(down.id),
        count =
          piece && (piece.type === 'deck' || piece.type === 'dispenser') ? countLabel(piece) : null;
      showControlGuide(
        `${PIECE_CONTROL_NAMES[down.type] || 'Piece'} — held`,
        count,
        pieceControlRows(down.type, true),
      );
      return;
    }
    if (hand.hoverCard()) {
      showControlGuide('Hand card', null, hand.controlRows(null));
      return;
    }
    const entry = hoverId && meshes.get(hoverId),
      piece = hoverId && getRoom() && getRoom().state.pieces.get(hoverId);
    if (entry) {
      const count =
        piece && (piece.type === 'deck' || piece.type === 'dispenser') ? countLabel(piece) : null;
      showControlGuide(
        PIECE_CONTROL_NAMES[entry.type] || 'Piece',
        count,
        pieceControlRows(entry.type, false),
      );
      return;
    }
    controlGuideSig = '';
    controlGuide.hidden = true;
  }
  canvas.addEventListener('pointermove', (e) => {
    if (!getRoom() || !hoverIdle() || e.pointerType === 'touch') {
      hideHoverTip();
      return;
    }
    hoverTip.style.left = e.clientX + 'px';
    hoverTip.style.top = e.clientY + 'px'; // follow the cursor every move
    const now = performance.now();
    if (now - lastHover < 40) return; // throttle the raycast/pick
    lastHover = now;
    setPointer(e);
    const id = pickId();
    if (!id) {
      hideHoverTip();
      return;
    }
    hoverId = id;
    syncControlGuide();
    const piece = getRoom().state.pieces.get(id);
    if (!piece || (piece.type !== 'deck' && piece.type !== 'dispenser')) {
      hoverTip.hidden = true;
      return;
    }
    const text = countLabel(piece);
    if (text == null) {
      hoverTip.hidden = true;
      return;
    }
    hoverTip.textContent = text;
    hoverTip.hidden = false;
  });
  canvas.addEventListener('pointerleave', hideHoverTip);
  canvas.addEventListener('pointerdown', hideHoverTip); // a gesture begins → drop the readout

  // ===== Touch context menu (long-press a piece) ==============================
  // A small floating menu of a piece's verbs; each item runs the same action a key or click
  // would. Long-press raises secondaryPress (see public/table/controls.js): on a piece we open this,
  // on empty felt we ping. Verbs are filtered by kind.
  function pieceMenuItems(id, type) {
    const items = [];
    if (!canInteract()) {
      if (inspection.isInspectable(type))
        items.push(['Inspect', () => inspection.enterInspect(id)]);
      items.push(['Highlight', () => highlightPiece(id)]);
      return items;
    }
    if (type === 'notecardStack') {
      items.push(
        [
          'Draw to hand',
          () => getRoom().send('notecardDraw', { id, destination: 'hand' }),
          null,
          null,
          'cards',
        ],
        ['Draw & edit', () => inspection.enterInspect(id), null, null, 'writing'],
        [
          'Play top face-down',
          () => getRoom().send('notecardDraw', { id, destination: 'table' }),
          null,
          null,
          'arrow-bar-down',
        ],
        ['Shuffle', () => getRoom().send('notecardShuffle', { id }), null, null, 'arrows-shuffle'],
        ['Split', () => getRoom().send('notecardSplit', { id }), null, null, 'arrows-maximize'],
        [
          'Move stack',
          () => pieceDrag.armMove(id),
          null,
          (e) => pieceDrag.beginMoveFromMenu(id, e),
          'hand-move',
        ],
      );
    }
    if (type === 'notecard') {
      items.push(['Flip', () => getRoom().send('notecardFlip', { id })]);
      items.push(['Take to hand', () => pieceDrag.sendAction('takeCard', id)]);
    }
    if (type === 'card') {
      items.push(['Flip', () => getRoom().send('flip', { id })]);
      items.push(['Take to hand', () => pieceDrag.sendAction('takeCard', id)]);
    }
    if (type === 'die') {
      items.push(['Roll', () => getRoom().send('rollOne', { id })]);
    }
    if (type === 'deck') {
      const deckProps = JSON.parse(getRoom().state.pieces.get(id)?.props || '{}');
      if (getRank() >= 2 || deckProps.browseAccess === 'players')
        items.push(['Browse deck…', () => browseDeck(id)]);
      if (getRank() >= 2)
        items.push([
          deckProps.browseAccess === 'players'
            ? 'Restrict browsing to GMs'
            : 'Allow player browsing',
          () =>
            getRoom().send('setDeckBrowseAccess', {
              deckId: id,
              access: deckProps.browseAccess === 'players' ? 'gm' : 'players',
            }),
        ]);
      items.push(['Peek at top card', () => getRoom().send('drawInspect', { deckId: id })]);
      items.push(['Draw to hand', () => pieceDrag.sendAction('drawToHand', id)]);
      items.push(['Shuffle', () => getRoom().send('shuffle', { deckId: id })]);
      items.push(['Split', () => getRoom().send('splitDeck', { deckId: id })]);
      const deckOpen = (() => {
        try {
          return !!JSON.parse(getRoom().state.pieces.get(id)?.props || '{}').open;
        } catch {
          return false;
        }
      })();
      items.push([
        deckOpen ? 'Make secret' : 'Make 2-sided',
        () => getRoom().send('setOpenGroup', { ids: [id] }),
      ]);
    }
    if (type === 'dispenser') {
      items.push(['Dispense', () => pieceDrag.sendAction('dispense', id)]);
    }
    if (KIND[type] && KIND[type].grab === 2)
      items.push([
        'Move',
        () => {
          pieceDrag.armMove(id);
        }, // fallback: a plain click arms the next drag, as it always did
        null,
        (e) => pieceDrag.beginMoveFromMenu(id, e), // press and keep dragging — the piece comes with you
      ]); // deck/dispenser: reposition instead of deal
    if (type !== 'notecardStack' && inspection.isInspectable(type)) {
      items.push(['Inspect', () => inspection.enterInspect(id)]);
    }
    items.push(['Highlight', () => highlightPiece(id)]);
    if (getRank() >= 2) items.push(['Labels…', () => editLabels(id)]);
    if (type !== 'mat') items.push(['Stand / lay flat', () => getRoom().send('setStand', { id })]); // a mat is always flat
    items.push(['Snap to grid', () => getRoom().send('setSnap', { id })]);
    items.push(['Delete', () => getRoom().send('remove', { id }), 'danger']);
    return items;
  }
  let pieceMenuAway = null; // outside-tap dismiss handler installed while the menu is open
  function closePieceMenu() {
    const menu = byId('pieceMenu');
    if (menu) menu.hidden = true;
    if (pieceMenuAway) {
      document.removeEventListener('pointerdown', pieceMenuAway, true);
      pieceMenuAway = null;
    }
  }
  function openPieceMenu(id, p) {
    const menu = byId('pieceMenu');
    if (!menu) return;
    const entry = meshes.get(id);
    if (!entry) return;
    // Touch gets the radial (7e slice 7) — same items, arced around the press point.
    const arc = pieceMenuItems(id, entry.type);
    if (isSheet() && arc.length <= RADIAL_MAX) {
      closePieceMenu();
      if (
        openRadial(
          p.x,
          p.y,
          arc.map(([label, fn, cls, press]) => ({ label, fn, cls, press })),
        )
      )
        return;
    }
    menu.replaceChildren();
    for (const [label, fn, cls, press, icon] of pieceMenuItems(id, entry.type)) {
      const b = makeButton(
        label,
        () => {
          closePieceMenu();
          canvas.focus();
          fn();
        },
        cls,
        icon,
      );
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      if (press)
        b.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // Transfer capture while the pressed button is still connected. Removing it first makes
          // Safari lose the active touch after the initial lift, leaving the piece stuck in place.
          const dragging = press(ev);
          closePieceMenu();
          if (dragging) b.onclick = null; // the drag owns the gesture; don't also arm on click
        });
      menu.appendChild(b);
    }
    applyIcons(menu);
    menu.querySelectorAll('button').forEach((b) => {
      b.title = b.getAttribute('aria-label');
    });
    menu.hidden = false; // show first so it can be measured
    const w = menu.offsetWidth || 180,
      h = menu.offsetHeight || 0;
    menu.style.left = Math.max(8, Math.min(p.x, innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(p.y, innerHeight - h - 8)) + 'px';
    menu.querySelector('button')?.focus({ preventScroll: true });
    menu.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closePieceMenu();
        canvas.focus();
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) {
        ev.preventDefault();
        const buttons = [...menu.querySelectorAll('button')],
          i = buttons.indexOf(document.activeElement);
        buttons[
          ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? buttons.length - 1
              : (i + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        ]?.focus();
      }
    };
    pieceMenuAway = (ev) => {
      if (!menu.contains(ev.target)) closePieceMenu();
    };
    setTimeout(() => document.addEventListener('pointerdown', pieceMenuAway, true), 0); // dismiss on the next outside tap
  }

  function update() {
    syncControlGuide(); // held/hovered context can change from state without another pointer move
    if (hoverId != null && !hoverTip.hidden) {
      // keep the hover count live while it's shown (deal/dispense without moving)
      const p = getRoom() && getRoom().state.pieces.get(hoverId);
      const t = p && countLabel(p);
      if (t == null) hoverTip.hidden = true;
      else hoverTip.textContent = t;
    }
  }
  let holdSig = -1;
  function updateHoldControls() {
    const down = pieceDrag.current();
    {
      // clustered height + rotate controls (both edges): rotate while holding a piece or with a selection; height while holding
      const holding = !!(down && down.grabbed && down.touch),
        hasSel = selection.size > 0,
        sig = (holding ? 1 : 0) | (hasSel ? 2 : 0);
      if (sig !== holdSig) {
        holdSig = sig;
        const show = holding || hasSel;
        document.querySelectorAll('.holdControls').forEach((el) => (el.hidden = !show));
        document.querySelectorAll('.rotLeft, .rotRight').forEach((b) => (b.hidden = !show));
        document.querySelectorAll('.heightUp, .heightDown').forEach((b) => (b.hidden = !holding));
      }
    }
  }

  return { openPieceMenu, closePieceMenu, syncControlGuide, update, updateHoldControls };
}
