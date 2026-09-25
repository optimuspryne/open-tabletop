import { drawCanvasStroke } from '../rendering/strokes.js';
import { WHITEBOARD_LIMITS } from '../../shared/overlays.js';

const RESOLUTION = 1024;
const BOARD = { w: 8, h: 4.5, margin: 5, gap: 0.5 };

// Owns the whiteboard's visual, drawing, and room-protocol state. The table shell supplies
// its shared camera/raycast services and forwards pointer intent, not mutable board fields.
export function createWhiteboard({
  THREE,
  scene,
  camera,
  controls,
  ray,
  pointer,
  createTexture,
  getRoom,
  getSessionId,
  getStrokeColor,
  setPointer,
  setIcon,
  toast,
  doc = document,
}) {
  const byId = (id) => doc.getElementById(id);
  const send = (type, data) => getRoom()?.send(type, data);
  let group = null;
  let canvas = null;
  let context = null;
  let texture = null;
  const last = { enabled: null, angle: null, dark: null, owner: null };
  const strokes = [];
  let owning = false;
  let drawing = false;
  let current = null;
  let tool = 'pen';
  let cameraSave = null;

  const background = () => (getRoom().state.whiteboard.dark ? '#1b1b1b' : '#f4f1ea');
  const ensureCanvas = () => {
    if (canvas) return;
    canvas = doc.createElement('canvas');
    canvas.width = RESOLUTION;
    canvas.height = Math.round((RESOLUTION * BOARD.h) / BOARD.w);
    context = canvas.getContext('2d');
    texture = createTexture(canvas);
  };
  const clearCanvas = () => {
    ensureCanvas();
    context.fillStyle = background();
    context.fillRect(0, 0, canvas.width, canvas.height);
    texture.needsUpdate = true;
  };
  const position = () => {
    const room = getRoom();
    if (!group || !room) return;
    const state = room.state.whiteboard;
    const radius = Math.max(room.state.tableX, room.state.tableZ) + BOARD.margin;
    const centerY = BOARD.h / 2 + BOARD.gap;
    group.position.set(Math.sin(state.angle) * radius, centerY, Math.cos(state.angle) * radius);
    group.lookAt(0, centerY, 0);
  };
  const build = () => {
    if (group) {
      scene.remove(group);
      group = null;
    }
    const room = getRoom();
    if (!room?.state.whiteboard?.enabled) return;
    ensureCanvas();
    clearCanvas();
    const next = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD.w + 0.4, BOARD.h + 0.4),
      new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.85 }),
    );
    frame.position.z = -0.03;
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD.w, BOARD.h),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    surface.name = 'wbSurface';
    surface.frustumCulled = false;
    next.add(frame, surface);
    scene.add(next);
    group = next;
    position();
    send('wbStrokes'); // late-join replay
  };
  const drawSegment = (x0, y0, x1, y1, color, width) => {
    ensureCanvas();
    const widthPx = canvas.width,
      heightPx = canvas.height;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.5, width * widthPx);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(x0 * widthPx, y0 * heightPx);
    context.lineTo(x1 * widthPx, y1 * heightPx);
    context.stroke();
    texture.needsUpdate = true;
  };
  const drawStroke = (stroke) => {
    ensureCanvas();
    drawCanvasStroke(context, stroke, canvas.width, canvas.height, background());
    texture.needsUpdate = true;
  };
  const redrawStrokes = () => {
    clearCanvas();
    for (const stroke of strokes) drawStroke(stroke);
  };
  const rememberStroke = (stroke) => {
    strokes.push(stroke);
    if (strokes.length > WHITEBOARD_LIMITS.maxStrokes) strokes.shift();
  };
  const pushStroke = (stroke) => {
    rememberStroke(stroke);
    drawStroke(stroke);
  };
  const hitUV = () => {
    const surface = group?.getObjectByName('wbSurface');
    if (!surface) return null;
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(surface)[0];
    return hit?.uv ? [hit.uv.x, 1 - hit.uv.y] : null;
  };
  const endStroke = () => {
    drawing = false;
    if (current?.pts.length >= 4) {
      send('wbStroke', current);
      rememberStroke(current); // already inked live
    }
    current = null;
  };
  const beginStroke = () => {
    const uv = hitUV();
    if (!uv) return false;
    const erase = tool === 'eraser';
    current = {
      pts: [uv[0], uv[1]],
      color: erase ? background() : getStrokeColor(),
      width: erase ? 0.03 : 0.005,
      erase,
    };
    drawing = true;
    return true;
  };
  const extendStroke = () => {
    if (!drawing || !current) return;
    const uv = hitUV();
    if (!uv || current.pts.length >= 1998) return;
    const n = current.pts.length;
    const lastX = current.pts[n - 2],
      lastY = current.pts[n - 1];
    if (Math.hypot(uv[0] - lastX, uv[1] - lastY) <= 0.003) return;
    current.pts.push(uv[0], uv[1]);
    drawSegment(lastX, lastY, uv[0], uv[1], current.color, current.width);
  };
  const syncToolButtons = () => {
    byId('wbPen')?.classList.toggle('on', tool === 'pen');
    byId('wbEraser')?.classList.toggle('on', tool === 'eraser');
  };
  const setTool = (next) => {
    tool = next;
    syncToolButtons();
  };
  const enterDraw = () => {
    if (owning || !group) return;
    owning = true;
    setTool('pen');
    cameraSave = { pos: camera.position.clone(), target: controls.target.clone() };
    const room = getRoom(),
      state = room.state.whiteboard;
    const radius = Math.max(room.state.tableX, room.state.tableZ) + BOARD.margin;
    const centerY = BOARD.h / 2 + BOARD.gap;
    const direction = new THREE.Vector3(Math.sin(state.angle), 0, Math.cos(state.angle));
    const boardPos = direction.clone().multiplyScalar(radius);
    boardPos.y = centerY;
    camera.position.copy(boardPos.clone().sub(direction.clone().multiplyScalar(6.5)));
    camera.position.y = centerY + 0.4;
    controls.target.copy(boardPos);
    controls.update();
    controls.enabled = false;
    const toolbar = byId('wbTools');
    if (toolbar) toolbar.hidden = false;
    syncToolButtons();
  };
  const exitDraw = () => {
    if (!owning) return;
    owning = false;
    drawing = false;
    current = null;
    if (cameraSave) {
      camera.position.copy(cameraSave.pos);
      controls.target.copy(cameraSave.target);
      controls.update();
      cameraSave = null;
    }
    controls.enabled = true;
    const toolbar = byId('wbTools');
    if (toolbar) toolbar.hidden = true;
  };
  const holderName = (sessionId) => getRoom()?.state.players?.get(sessionId)?.name || 'Someone';
  const syncStatus = () => {
    const status = byId('wbStatus');
    if (!status) return;
    const state = getRoom()?.state.whiteboard;
    const owner = state?.enabled ? state.owner : '';
    const show = !!owner && owner !== getSessionId();
    status.hidden = !show;
    if (show) byId('wbStatusWho').textContent = `${holderName(owner)} is drawing`;
  };
  const sync = (state) => {
    if (!state) return;
    if (state.enabled !== last.enabled) {
      last.enabled = state.enabled;
      build();
    }
    if (group && state.angle !== last.angle) position();
    if (state.dark !== last.dark) {
      last.dark = state.dark;
      if (group) redrawStrokes();
    }
    if (state.owner !== last.owner) {
      last.owner = state.owner;
      if (state.owner === getSessionId()) enterDraw();
      else exitDraw();
    }
    last.angle = state.angle;
    syncStatus();
  };
  const syncSettings = (state) => {
    if (!state) return;
    const enabled = byId('wbEnabled');
    if (enabled) {
      enabled.classList.toggle('on', state.enabled);
      setIcon(enabled, state.enabled ? 'eye' : 'eye-off');
    }
    doc
      .querySelectorAll('#roomSettingsModal [data-wbstyle]')
      .forEach((button) =>
        button.classList.toggle('on', button.dataset.wbstyle === (state.dark ? 'dark' : 'light')),
      );
    const angle = byId('wbAngle');
    if (angle) angle.value = Math.round((state.angle * 180) / Math.PI);
  };
  const bindControls = () => {
    const enabled = byId('wbEnabled');
    if (enabled)
      enabled.onclick = () => {
        const on = !enabled.classList.contains('on');
        enabled.classList.toggle('on', on);
        setIcon(enabled, on ? 'eye' : 'eye-off');
        send('wbEnable', { on });
      };
    const angle = byId('wbAngle');
    if (angle) angle.oninput = () => send('wbSet', { angle: (+angle.value * Math.PI) / 180 });
    doc.querySelectorAll('#roomSettingsModal [data-wbstyle]').forEach((button) => {
      button.onclick = () => {
        doc
          .querySelectorAll('#roomSettingsModal [data-wbstyle]')
          .forEach((other) => other.classList.remove('on'));
        button.classList.add('on');
        send('wbSet', { dark: button.dataset.wbstyle === 'dark' });
      };
    });
    const pen = byId('wbPen');
    if (pen) pen.onclick = () => setTool('pen');
    const eraser = byId('wbEraser');
    if (eraser) eraser.onclick = () => setTool('eraser');
    const clear = byId('wbClearBtn');
    if (clear) clear.onclick = () => send('wbClear');
    const done = byId('wbDone');
    if (done) done.onclick = () => send('wbRelease');
  };
  const bindRoom = (room) => {
    room.onMessage('wbStroke', (stroke) => {
      if (!stroke || stroke.sid === getSessionId()) return;
      pushStroke(stroke);
    });
    room.onMessage('wbStrokes', ({ strokes: replay } = {}) => {
      strokes.length = 0;
      for (const stroke of replay || []) strokes.push(stroke);
      redrawStrokes();
    });
    room.onMessage('wbClear', () => {
      strokes.length = 0;
      if (texture) clearCanvas();
    });
  };
  const claimAt = (point, pieceMeshes) => {
    const room = getRoom(),
      state = room?.state.whiteboard;
    if (!state?.enabled || owning) return false;
    const surface = group?.getObjectByName('wbSurface');
    if (!surface) return false;
    setPointer({ clientX: point.x, clientY: point.y });
    ray.setFromCamera(pointer, camera);
    const boardHit = ray.intersectObject(surface)[0];
    if (!boardHit) return false;
    const pieceHit = ray.intersectObjects(pieceMeshes)[0];
    if (pieceHit && pieceHit.distance < boardHit.distance) return false;
    if (state.owner) {
      if (state.owner !== getSessionId())
        toast(`${holderName(state.owner)} is using the whiteboard`, 'writing');
      return true;
    }
    send('wbClaim');
    return true;
  };
  return {
    cancel: () => {
      exitDraw();
      if (texture) redrawStrokes();
    },
    isOwning: () => owning,
    isDrawing: () => drawing,
    position,
    sync,
    syncSettings,
    bindControls,
    bindRoom,
    beginStroke,
    extendStroke,
    endStroke,
    claimAt,
    release: () => send('wbRelease'),
  };
}
