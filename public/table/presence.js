import { createPlacardSettings } from './placard-settings.js';
import { AVATAR_IMAGE } from '../../shared/avatar.js';

// Public player presentation. Room access and cross-feature effects are injected;
// private hand state, member administration, and general permission gates stay with their owners.
// Seat-camera framing — the ONE place to tune the default view for every seat.
//   lookFwd / lookH : the point a seat looks at (from table centre, in its direction).
//   dist / rise     : how far the camera sits back / up from that point (their ratio = the angle).
//   zoom            : <1 dollies in, >1 pulls back — scales the offset, so the ANGLE is unchanged.
// Table sits lower in frame → raise lookH and rise together.
// Default player-seat framing: close enough for the near rail and hand to anchor the view while
// retaining the whole play surface, matching the natural seated composition players orbit toward.
const VIEW = { lookFwd: 2, lookH: 4, dist: 15.4, rise: 10, zoom: 0.65 };
export function seatLayoutFor(hx, hz) {
  const m = 0.8; // hand inset from the edge
  const cx = hx * 0.66,
    cz = hz * 0.69; // diagonal (corner) seat positions
  const sx = hx / 10,
    sz = hz / 7,
    sy = (sx + sz) / 2; // camera scale vs the default 20x14 table
  const cam = (p, t) => ({
    pos: [p[0] * sx, p[1] * sy, p[2] * sz],
    target: [t[0] * sx, t[1] * sy, t[2] * sz],
  });
  const norm = (v) => {
    const l = Math.hypot(v[0], v[2]) || 1;
    return [v[0] / l, 0, v[2] / l];
  };
  const seatCam = (d) => {
    const D = VIEW.dist * VIEW.zoom,
      R = VIEW.rise * VIEW.zoom; // build a seat's camera from VIEW + its facing dir
    return cam(
      [d[0] * (VIEW.lookFwd + D), VIEW.lookH + R, d[2] * (VIEW.lookFwd + D)],
      [d[0] * VIEW.lookFwd, VIEW.lookH, d[2] * VIEW.lookFwd],
    );
  };
  return [
    { hand: [0, 0.25, hz - m], out: [0, 0, 1], cam: seatCam([0, 0, 1]) }, // front  (+z)
    { hand: [0, 0.25, -(hz - m)], out: [0, 0, -1], cam: seatCam([0, 0, -1]) }, // back   (-z)
    { hand: [hx - m, 0.25, 0], out: [1, 0, 0], cam: seatCam([1, 0, 0]) }, // right  (+x)
    { hand: [-(hx - m), 0.25, 0], out: [-1, 0, 0], cam: seatCam([-1, 0, 0]) }, // left   (-x)
    { hand: [cx, 0.25, cz], out: [1, 0, 1], cam: seatCam(norm([1, 0, 1])) }, // front-right
    { hand: [-cx, 0.25, -cz], out: [-1, 0, -1], cam: seatCam(norm([-1, 0, -1])) }, // back-left
    { hand: [-cx, 0.25, cz], out: [-1, 0, 1], cam: seatCam(norm([-1, 0, 1])) }, // front-left
    { hand: [cx, 0.25, -cz], out: [1, 0, -1], cam: seatCam(norm([1, 0, -1])) }, // back-right
  ];
}
const SEAT_NAMES = [
  'Front',
  'Back',
  'Right',
  'Left',
  'Front-right',
  'Back-left',
  'Front-left',
  'Back-right',
];

export function createPresence({
  THREE,
  scene,
  camera,
  controls,
  cardMesh,
  notecardMesh,
  disposeNotecard,
  makePlayerTexture,
  makeYouChipTexture,
  nameTag,
  disposeSprite,
  resizeToCanvas,
  seatAngle,
  setSeatCameraReady,
  label,
  getRoom,
  getSessionId,
  getRank,
  getPieceVisual,
  getRevealed,
  setRevealed,
  clearRevealed,
  onLocalRole,
  onPlayersChanged,
  onPlayerRemoved,
  onHydration,
  byId,
  doc = document,
}) {
  const document = doc;
  const placards = createPlacardSettings({ byId, getRoom, getSessionId, doc });
  // ===== seats, other players' fanned hands, and turn order ===================
  // Seats scale with the current table half-extents (state.tableX/tableZ): hands sit
  // just inside each edge and cameras pull back proportionally, so markers/hands stay
  // at the table's edge on any size. Each client parks its camera at its own seat and
  // renders public hand fans at every occupied seat.
  let mySeat = -1;
  let seatLayout = seatLayoutFor(10, 7);

  // Recompute seats when the table resizes, then reposition everyone's markers, fans,
  // and the "YOU" chip. The camera stays put (use the My Seat button to reframe).
  function rebuildSeats() {
    const room = getRoom();
    if (!room || !room.state) return;
    seatLayout = seatLayoutFor(room.state.tableX || 10, room.state.tableZ || 7);
    room.state.players.forEach((p, sid) => {
      refreshMarker(sid);
      refreshFan(sid);
    });
    refreshMyChip();
  }
  const handGroups = new Map(); // sid -> THREE.Group of face-down backs

  function applySeat(seat) {
    const layout = seatLayout[seat];
    if (!layout) {
      applyBirdsEye();
      return;
    }
    camera.position.set(...layout.cam.pos);
    controls.target.set(...layout.cam.target);
    controls.update();
    setSeatCameraReady();
  }

  // Fit the current table into a true overhead view. Derive the height from both axes and the
  // viewport aspect so resized tables stay fully visible on portrait phones as well as desktops.
  function applyBirdsEye() {
    const room = getRoom();
    const hx = (room && room.state && room.state.tableX) || 10;
    const hz = (room && room.state && room.state.tableZ) || 7;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const fitZ = hz / Math.tan(halfFov);
    const fitX = hx / (Math.tan(halfFov) * camera.aspect);
    const height = Math.max(fitX, fitZ) * 1.15;
    controls.target.set(0, 0, 0);
    // A tiny Z offset avoids an undefined camera roll when its view and up vectors are parallel.
    camera.position.set(0, height, 0.001);
    controls.update();
    setSeatCameraReady();
  }

  // Rebuild the fanned face-down backs shown at a player's seat. This includes our own public
  // fan: private card faces stay in the bottom bar, while the table fan keeps the hand zone visible.
  function refreshFan(sid) {
    const room = getRoom();
    const player = room.state.players.get(sid);
    if (!player) return;
    const seat = seatLayout[player.seat];
    if (!seat) return;

    let group = handGroups.get(sid);
    if (!group) {
      group = new THREE.Group();
      scene.add(group);
      handGroups.set(sid, group);
    }
    while (group.children.length) {
      const child = group.children[0];
      if (child.userData?.notecard) disposeNotecard(child);
      group.remove(child);
    }

    const out = new THREE.Vector3(...seat.out).normalize();
    const tangent = new THREE.Vector3(out.z, 0, -out.x); // along the table edge
    const yaw = Math.atan2(out.x, out.z);
    const count = Math.min(player.hand, 12);
    const shown = getRevealed(sid); // cards this player is showing us (face-up)
    for (let i = 0; i < count; i++) {
      // Shown cards fill the leading fan slots face-up; the rest stay face-down,
      // showing the hand's own back image (public) rather than a generic default.
      const card =
        i < shown.length
          ? shown[i].kind === 'notecard'
            ? notecardMesh({ drawing: shown[i].drawing })
            : cardMesh({ front: shown[i].front, back: shown[i].back })
          : cardMesh({ back: player.handBack || undefined });
      card.castShadow = card.receiveShadow = false;
      const offset = i - (count - 1) / 2;
      // Lift each card a hair above the last so overlapping cards layer cleanly
      // instead of z-fighting (coplanar backs share the stripe texture and tear).
      card.position.set(
        seat.hand[0] + tangent.x * offset * 0.55,
        seat.hand[1] + i * 0.012,
        seat.hand[2] + tangent.z * offset * 0.55,
      );
      card.rotation.y = yaw + offset * 0.06; // slight fan
      card.scale.setScalar(card.userData?.notecard ? 0.4 : 0.8);
      group.add(card);
    }
  }

  function removeFan(sid) {
    const group = handGroups.get(sid);
    if (group) {
      for (const child of group.children) if (child.userData?.notecard) disposeNotecard(child);
      scene.remove(group);
      handGroups.delete(sid);
    }
  }

  // A simple standing marker at each seat: a colored base + a billboard showing
  // the player's avatar (or a default silhouette) and their name, facing the table.
  const markers = new Map(); // sid -> THREE.Group
  // makePlayerTexture / nameTag / makeYouChipTexture (the seat marker, held-piece
  // name tag, and "YOU" chip textures) live in graphics.js with the other canvas
  // texture builders; this controller places what they return in the scene.

  // Floating name tags over held pieces — everyone sees who's moving what. Created
  // and torn down as ownership changes; the render loop keeps each one over its
  // piece. Own pieces get no tag (you know it's you), matching the seat markers.
  const heldLabels = new Map(); // pieceId -> THREE.Sprite
  function updateHeldLabel(id, owner) {
    const room = getRoom();
    const existing = heldLabels.get(id);
    if (existing) {
      disposeSprite(existing);
      heldLabels.delete(id);
    }
    if (!owner || owner === getSessionId()) return;
    const player = room.state.players.get(owner);
    if (!player) return;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nameTag(player.name, player.color),
        transparent: true,
        depthTest: false,
      }),
    );
    sprite.scale.set(label.w, label.h, 1);
    sprite.renderOrder = 4; // above pieces and the drop marker
    scene.add(sprite);
    heldLabels.set(id, sprite);
  }

  const markerStyle = { width: 2.7, height: 3.8, centerY: 1.95, baseRadius: 0.65 };
  function disposeMarker(sid) {
    const marker = markers.get(sid);
    if (!marker) return;
    scene.remove(marker);
    marker.traverse((node) => {
      node.geometry?.dispose();
      node.material?.map?.dispose();
      node.material?.dispose();
    });
    markers.delete(sid);
  }
  function refreshMarker(sid) {
    const room = getRoom();
    if (sid === getSessionId()) return; // don't render my own marker in my face
    const player = room.state.players.get(sid);
    if (!player) return;
    const seat = seatLayout[player.seat];
    if (!seat) return;

    disposeMarker(sid);

    const out = new THREE.Vector3(...seat.out).normalize();
    const px = seat.hand[0] + out.x * 1.6,
      pz = seat.hand[2] + out.z * 1.6; // just outside the hand zone
    const group = new THREE.Group();

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(markerStyle.baseRadius, markerStyle.baseRadius, 0.08, 20),
      new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.5 }),
    );
    disc.position.set(px, 0.04, pz);
    group.add(disc);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(markerStyle.width, markerStyle.height),
      new THREE.MeshBasicMaterial({ map: makePlayerTexture(player), transparent: true }),
    );
    plane.position.set(px, markerStyle.centerY, pz);
    plane.lookAt(0, 1.05, 0); // face the table centre
    group.add(plane);

    scene.add(group);
    markers.set(sid, group);
  }

  function removePlayerVis(sid) {
    removeFan(sid);
    clearRevealed(sid); // drop anything they were showing us
    disposeMarker(sid);
  }

  // A flat "YOU" chip laid on the felt at your own seat, so you know which edge is
  // yours (your standing billboard is skipped — no need to see yourself).
  let myChip = null;
  function refreshMyChip() {
    const room = getRoom();
    if (myChip) {
      scene.remove(myChip);
      myChip = null;
    }
    if (!room || !room.state) return;
    const me = room.state.players.get(getSessionId());
    if (!me) return; // wait until we know our own seat
    const seat = seatLayout[mySeat];
    if (!seat) return;
    const color = me.color || '#c9a25a';
    const out = new THREE.Vector3(...seat.out).normalize();
    const px = seat.hand[0] - out.x * 1.3,
      pz = seat.hand[2] - out.z * 1.3; // just above the fan, toward the table centre
    const chip = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: makeYouChipTexture(color),
        transparent: true,
        depthWrite: false,
      }),
    );
    chip.rotation.x = -Math.PI / 2; // lie flat on the felt
    chip.rotation.z = seatAngle(mySeat); // spin it to face MY seat, so "YOU" reads upright from any seat (not just the front)
    chip.position.set(px, 0.03, pz);
    scene.add(chip);
    myChip = chip;
  }

  function updateMyPreview(avatar) {
    const el = byId('myAv');
    if (el) el.style.backgroundImage = avatar ? `url(${avatar})` : 'none';
  }

  function renderPlayers() {
    const room = getRoom();
    // built with DOM + textContent so a player's name can never inject HTML
    {
      const tm = byId('turnMini');
      if (tm) {
        // the Your Turn pill: state + click-to-advance
        let t = '';
        if (room.state.turnPending) t = '\u23F3 ' + room.state.turnPending;
        else if (room.state.turn) {
          const p = room.state.players.get(room.state.turn);
          t =
            room.state.turn === getSessionId()
              ? 'Your Turn'
              : p && p.name
                ? p.name + "'s turn"
                : 'In play';
        }
        tm.textContent = t;
        const tb = byId('turnBtn');
        if (tb) {
          tb.hidden = !t;
          tb.classList.toggle('myturn', room.state.turn === getSessionId());
          tb.setAttribute('aria-label', t ? t + ' — advance the turn' : 'Advance the turn');
          tb.title = t || 'Advance the turn'; // the label is hidden on touch; the state must still be readable
        } // emphasize + light the chevron when it's yours
      }
    }
    {
      const rt = byId('roomTitle');
      if (rt) {
        if (!rt.textContent.trim()) rt.textContent = 'Shared Table'; // never let the touch bar read empty
        // dock title: real room name if set, else owner-derived (empty in the ?workshop=1 room)
        const nm = (room.state.roomName || '').trim();
        if (nm) rt.textContent = nm;
        else {
          let owner = '';
          room.state.players.forEach((p) => {
            if (p.role === 'owner') owner = p.name;
          });
          rt.textContent = owner ? owner + '\u2019s Table' : 'Shared Table';
        }
      }
    }
    const el = byId('players');
    if (!el) return;
    const list = [];
    room.state.players.forEach((player, sid) => list.push([sid, player]));
    list.sort(
      (a, b) =>
        Number(a[1].participation === 'spectator') - Number(b[1].participation === 'spectator') ||
        a[1].order - b[1].order ||
        a[1].seat - b[1].seat,
    );
    const playing = list.filter(
      ([, player]) => player.participation !== 'spectator' && player.seat >= 0,
    );
    const canOrder =
      getRank() >= 2 &&
      room.state.players.get(getSessionId())?.timedOut !== true &&
      room.state.players.get(getSessionId())?.participation !== 'spectator';
    el.replaceChildren();
    if (room.state.turnPending) {
      // the turn is held by someone who hasn't rejoined the saved game
      const w = document.createElement('div');
      w.className = 'prow turn-waiting';
      w.textContent = '\u23F3 Waiting on ' + room.state.turnPending + ' (not present)';
      el.appendChild(w);
    }
    if (!list.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'prow';
      placeholder.textContent = 'waiting…';
      el.appendChild(placeholder);
      return;
    }
    for (const [sid, player] of list) {
      const row = document.createElement('div');
      row.className = 'prow' + (room.state.turn === sid ? ' turn' : '');
      row.dataset.sid = sid;
      if (canOrder && player.participation !== 'spectator' && player.seat >= 0) {
        row.draggable = true;
        row.title = 'Drag to change turn order';
        row.addEventListener('dragstart', (event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', sid);
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        });
        row.addEventListener('drop', (event) => {
          event.preventDefault();
          const moved = event.dataTransfer.getData('text/plain');
          const order = playing.map(([id]) => id);
          const from = order.indexOf(moved);
          const to = order.indexOf(sid);
          if (from < 0 || to < 0 || from === to) return;
          order.splice(to, 0, order.splice(from, 1)[0]);
          room.send('turnOrder', { order });
        });
      }
      if (player.avatar) {
        // server enforces a data:image URL
        const img = document.createElement('img');
        img.className = 'pav';
        img.src = player.avatar;
        row.appendChild(img);
      } else {
        // color is a server palette value
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = player.color;
        row.appendChild(dot);
      }
      const label = document.createElement('span');
      label.textContent = `${player.name}${sid === getSessionId() ? ' (you)' : ''} \u00b7 ${player.hand}`; // textContent = inert
      row.appendChild(label);
      if (player.participation === 'spectator') {
        const badge = document.createElement('span');
        badge.className = 'rolebadge';
        badge.textContent = 'spectator';
        row.appendChild(badge);
      }
      if (player.timedOut) {
        const badge = document.createElement('span');
        badge.className = 'rolebadge';
        badge.textContent = 'time-out';
        row.appendChild(badge);
      }
      if (player.role && player.role !== 'player') {
        // badge for helper/gm/owner
        const badge = document.createElement('span');
        badge.className = 'rolebadge';
        badge.textContent = player.role;
        row.appendChild(badge);
      }
      if (getRank() >= 2 && player.participation !== 'spectator' && player.seat >= 0) {
        const controls = document.createElement('span');
        controls.className = 'turnOrderControls';
        const move = (delta, symbol, label) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.roomMutation = '';
          button.textContent = symbol;
          button.setAttribute('aria-label', `${label} ${player.name} in turn order`);
          button.disabled =
            !canOrder ||
            (delta < 0 && playing[0][0] === sid) ||
            (delta > 0 && playing[playing.length - 1][0] === sid);
          button.onclick = () => {
            const order = playing.map(([id]) => id);
            const at = order.indexOf(sid);
            [order[at], order[at + delta]] = [order[at + delta], order[at]];
            room.send('turnOrder', { order });
          };
          controls.appendChild(button);
        };
        move(-1, '↑', 'Move up');
        move(1, '↓', 'Move down');
        row.appendChild(controls);
      }
      el.appendChild(row);
    }
  }

  function bindRoom(room, cb) {
    cb(room.state).players.onAdd((player, sid) => {
      onHydration();
      if (sid === getSessionId()) {
        mySeat = player.seat;
        applySeat(mySeat);
        onLocalRole(player.role);
        {
          const mn = byId('myName');
          if (mn) mn.textContent = player.name;
        }
        updateMyPreview(player.avatar);
        placards.hydrate();
        refreshMyChip();
      }
      refreshFan(sid);
      refreshMarker(sid);
      renderPlayers();
      onPlayersChanged();
      cb(player).listen(
        'hand',
        () => {
          refreshFan(sid);
          renderPlayers();
        },
        false,
      );
      cb(player).listen(
        'seat',
        () => {
          if (sid === getSessionId()) {
            mySeat = player.seat;
            applySeat(mySeat);
            refreshMyChip();
          }
          refreshFan(sid);
          refreshMarker(sid);
        },
        false,
      );
      cb(player).listen(
        'name',
        () => {
          if (sid === getSessionId()) {
            const mn = byId('myName');
            if (mn) mn.textContent = player.name;
          }
          refreshMarker(sid);
          if (sid === getSessionId()) placards.hydrate();
          renderPlayers();
        },
        false,
      );
      cb(player).listen(
        'role',
        () => {
          if (sid === getSessionId()) onLocalRole(player.role);
          renderPlayers();
        },
        false,
      );
      cb(player).listen('order', renderPlayers, false);
      cb(player).listen('timedOut', renderPlayers, false);
      cb(player).listen('participation', renderPlayers, false);
      cb(player).listen(
        'avatar',
        () => {
          if (sid === getSessionId()) updateMyPreview(player.avatar);
          else refreshMarker(sid);
          if (sid === getSessionId()) placards.hydrate();
          renderPlayers();
        },
        false,
      );
      cb(player).listen(
        'color',
        () => {
          if (sid === getSessionId()) refreshMyChip();
          refreshMarker(sid);
          if (sid === getSessionId()) placards.hydrate();
          renderPlayers();
        },
        false,
      );
      cb(player).listen(
        'placard',
        () => {
          refreshMarker(sid);
          if (sid === getSessionId()) placards.hydrate();
        },
        false,
      );
      cb(player).listen('showing', () => refreshMarker(sid), false); // redraw the seat badge on show/stop
      cb(player).listen('handBack', () => refreshFan(sid), false); // re-skin the fan backs when the deck's back changes
    });
    cb(room.state).players.onRemove((player, sid) => {
      onHydration();
      removePlayerVis(sid);
      onPlayerRemoved(sid);
      renderPlayers();
      onPlayersChanged();
    });
    cb(room.state).listen('turn', renderPlayers, false);

    try {
      cb(room.state).listen('roomName', renderPlayers, false);
      cb(room.state).listen('turnPending', renderPlayers, false);
    } catch {
      /* older server without these fields */
    }
  }

  function bindMessages(room) {
    placards.bindMessages(room);
    room.onMessage('showFan', ({ sid, cards }) => {
      setRevealed(sid, cards);
      refreshFan(sid);
    });
  }
  function bindControls() {
    placards.bindControls();
    const wire = (id, fn) => {
      const el = byId(id);
      if (el) el.onclick = fn;
    };
    wire('mySeatBtn', () => applySeat(mySeat));
    wire('birdsEyeBtn', applyBirdsEye);
    wire('turnBtn', () => getRoom().send('nextTurn'));
    byId('avatarInput')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const canvas = await resizeToCanvas(file, AVATAR_IMAGE.size, AVATAR_IMAGE.size);
      getRoom().send('setAvatar', { data: canvas.toDataURL('image/jpeg', AVATAR_IMAGE.quality) });
    });
    wire('myAv', () => byId('avatarInput').click());
  }
  function updateHeldLabels() {
    for (const [id, sprite] of heldLabels) {
      const entry = getPieceVisual(id);
      if (entry)
        sprite.position.set(
          entry.mesh.position.x,
          entry.mesh.position.y + label.lift,
          entry.mesh.position.z,
        );
    }
  }
  function handDropPosition() {
    const seat = seatLayout[mySeat];
    if (!seat) return { x: 0, z: 0 };
    return { x: seat.hand[0] - seat.out[0] * 2, z: seat.hand[2] - seat.out[2] * 2 };
  }
  return {
    bindRoom,
    bindMessages,
    bindControls,
    rebuildSeats,
    getSeat: () => mySeat,
    seatName: () => SEAT_NAMES[mySeat] || 'Observer',
    handDropPosition,
    updateHeldLabel,
    update: updateHeldLabels,
  };
}
