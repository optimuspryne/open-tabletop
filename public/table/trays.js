// Personal tray visuals, controls, and camera travel. Physics and tray dice
// ownership remain authoritative in the room; this controller only presents them.
export function createTrays({
  THREE,
  scene,
  camera,
  controls,
  trayMesh,
  trayCenter,
  seatAngle,
  getRoom,
  getSeat,
  getDieProps,
  byId,
  doc = document,
  now = () => performance.now(),
}) {
  const groups = new Map(); // seat -> THREE.Group
  const cam = { height: 12, back: 5, dur: 550 };
  let view = false;
  let savedCamera = null;
  let tween = null;
  let pendingOpen = false;

  const place = (seat, group) => {
    const room = getRoom();
    const angle = seatAngle(seat);
    const center = trayCenter(angle, room.state.tableX, room.state.tableZ);
    group.position.set(center.x, 0, center.z);
    group.rotation.y = angle; // matches the server's tray placement
  };
  const groupFor = (seat) => {
    const group = trayMesh(getRoom().state.feltColor);
    place(seat, group);
    scene.add(group);
    return group;
  };
  const position = () => {
    if (!getRoom()) return;
    for (const [seat, group] of groups) place(seat, group);
  };
  const dieIds = () => {
    const ids = [];
    const room = getRoom();
    if (!room) return ids;
    room.state.pieces.forEach((piece, id) => {
      if (piece.type !== 'die') return;
      try {
        if (JSON.parse(piece.props || '{}').traySeat === getSeat()) ids.push(id);
      } catch {}
    });
    return ids;
  };
  const cameraPose = () => {
    const angle = seatAngle(getSeat());
    const room = getRoom();
    const center = trayCenter(angle, room.state.tableX, room.state.tableZ);
    const outwardX = Math.sin(angle),
      outwardZ = Math.cos(angle);
    return {
      pos: new THREE.Vector3(
        center.x + outwardX * cam.back,
        cam.height,
        center.z + outwardZ * cam.back,
      ),
      target: new THREE.Vector3(center.x, 0, center.z),
    };
  };
  const startTween = (pose, onDone) => {
    tween = {
      fromPos: camera.position.clone(),
      toPos: pose.pos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: pose.target.clone(),
      start: now(),
      dur: cam.dur,
      onDone,
    };
    controls.enabled = false;
  };
  const aim = (instant) => {
    const pose = cameraPose();
    if (instant) {
      camera.position.copy(pose.pos);
      controls.target.copy(pose.target);
      controls.update();
    } else
      startTween(pose, () => {
        controls.enabled = true;
        controls.target.copy(pose.target);
        controls.update();
      });
  };
  const open = () => {
    const room = getRoom();
    if (!room || !room.state.trays) return;
    if (!room.state.trays.get(String(getSeat()))) {
      pendingOpen = true;
      room.send('trayShow', { on: true });
      return;
    }
    if (!view) savedCamera = { pos: camera.position.clone(), target: controls.target.clone() };
    view = true;
    const tools = byId('trayTools');
    if (tools) tools.hidden = false;
    aim(false);
  };
  const putAway = () => {
    getRoom()?.send('trayShow', { on: false });
  };
  const close = () => {
    if (!view) return;
    view = false;
    const tools = byId('trayTools');
    if (tools) tools.hidden = true;
    const save = savedCamera;
    if (save)
      startTween({ pos: save.pos, target: save.target }, () => {
        controls.enabled = true;
        controls.target.copy(save.target);
        controls.update();
        savedCamera = null;
      });
    else controls.enabled = true;
  };
  const sync = (trays) => {
    if (!getRoom()) return;
    const want = new Set();
    if (trays)
      trays.forEach((on, seat) => {
        if (on) want.add(+seat);
      });
    for (const seat of want) if (!groups.has(seat)) groups.set(seat, groupFor(seat));
    for (const [seat, group] of [...groups])
      if (!want.has(seat)) {
        scene.remove(group);
        groups.delete(seat);
      }
    const mineOut = want.has(getSeat());
    if (mineOut && pendingOpen) {
      pendingOpen = false;
      open();
    }
    if (!mineOut && view) close();
  };
  const updateCamera = () => {
    if (!tween) return false;
    const progress = Math.min(1, (now() - tween.start) / tween.dur);
    const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    camera.position.lerpVectors(tween.fromPos, tween.toPos, ease);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, ease);
    camera.lookAt(controls.target);
    if (progress >= 1) {
      const done = tween.onDone;
      tween = null;
      if (done) done();
    }
    return true; // a finishing frame still belongs to the tween, not orbit controls
  };
  const bindControls = () => {
    doc.querySelectorAll('.rollBtn').forEach((button) => (button.onclick = open));
    const back = byId('trayBack');
    if (back) back.onclick = close;
    const away = byId('trayAway');
    if (away) away.onclick = putAway;
    doc.querySelectorAll('#trayTools .trayDie').forEach((button) => {
      button.onclick = () =>
        getRoom().send('spawn', {
          type: 'die',
          props: {
            ...getDieProps(+button.dataset.sides),
            ...(button.dataset.model ? { model: button.dataset.model } : {}),
            tray: true,
          },
        });
    });
    const roll = byId('trayRoll');
    if (roll) roll.onclick = () => getRoom().send('roll');
    const scoop = byId('trayScoop');
    if (scoop) scoop.onclick = () => getRoom().send('trayScoop');
    const clear = byId('trayClearBtn');
    if (clear) clear.onclick = () => getRoom().send('trayClear');
  };

  return {
    isViewing: () => view,
    isCameraMoving: () => !!tween,
    dieIds,
    position,
    sync,
    open,
    close,
    putAway,
    updateCamera,
    bindControls,
  };
}
