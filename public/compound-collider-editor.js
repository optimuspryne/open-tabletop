import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { wireBoardOutline } from './board-outline-editor.js';
import * as THREE from 'three';
import { applyIcons } from './icons.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  COMPOUND_SHAPE_LIMIT,
  COMPOUND_TYPES,
  normalizeCompoundCollider,
  compoundColliderSpec,
} from '/shared/compound-collider.js';

function disposeTree(root) {
  root.traverse((node) => {
    node.geometry?.dispose();
    for (const material of Array.isArray(node.material)
      ? node.material
      : node.material
        ? [node.material]
        : []) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

// A private draft: only Apply returns data to the upload form. Closing/canceling is lossless.
export async function openColliderEditor({ source, rotation = [0, 0, 0], box, value }) {
  const unit = Math.max(...box) * 2;
  const initial = normalizeCompoundCollider(value) || {
    version: 1,
    shapes: [
      {
        type: 'box',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: box.map((v) => Math.max(0.001, (2 * v) / unit)),
      },
    ],
  };
  let draft = structuredClone(initial),
    selected = 0,
    dragMode = 'orbit',
    outlineEditor = null,
    outlineValid = true,
    finished = false,
    ready = false;
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'compoundEditor';
  dialog.setAttribute('aria-label', 'Custom collider editor');
  dialog.innerHTML = `<header><h2>Custom collider</h2><button type="button" data-action="cancel" aria-label="Close collider editor">Close</button></header>
  <p>Build a solid collision shape around your model. Leave gaps between shapes for holes and recesses.</p>
  <div class="compoundLayout"><div><div class="compoundViewport" aria-label="3D collider preview"></div>
  <div class="compoundToolbar"><div class="compoundControlGroup"><span>Drag mode</span><div class="compoundIconButtons" role="group" aria-label="Drag mode">
  ${Object.entries({
    orbit: 'view-360-number',
    move: 'chart-scatter-3d',
    rotate: 'rotate-3d',
    resize: 'scan-cube',
  })
    .map(
      ([mode, icon]) =>
        `<button type="button" data-drag-mode="${mode}" data-icon="${icon}" aria-label="${mode === 'orbit' ? 'Orbit view' : mode[0].toUpperCase() + mode.slice(1) + ' shape'}" aria-pressed="${mode === 'orbit'}"></button>`,
    )
    .join('')}</div></div>
  <div class="compoundControlGroup"><span>Camera</span><div class="compoundIconButtons" role="group" aria-label="Camera controls">
  <button type="button" data-view="perspective" data-icon="hexagon-3d" aria-label="Perspective view"></button><button type="button" data-view="top" data-icon="mood-look-down" aria-label="Top view"></button><button type="button" data-view="front" data-icon="mood-neutral" aria-label="Front view"></button><button type="button" data-view="side" data-icon="mood-look-left" aria-label="Side view"></button></div></div></div>
  <p>Click a shape to select it. Drag in the chosen mode, or enter exact values. Use Orbit view to rotate the camera and scroll to zoom.</p></div>
  <aside><label>Shapes <select data-field="list" size="5" aria-label="Collider shapes"></select></label>
  <div class="compoundToolbar compoundIconButtons" role="group" aria-label="Add shape">${COMPOUND_TYPES.map((type) => `<button type="button" data-add-shape="${type}" data-icon="${{ box: 'cube-plus', sphere: 'sphere-plus', cylinder: 'cylinder-plus', cone: 'cone-plus', flat: 'square-plus-2', outline: 'hexagon-3d' }[type]}" aria-label="Add ${type === 'flat' ? 'flat slab' : type}"></button>`).join('')}</div>
  <div class="compoundToolbar compoundIconButtons" role="group" aria-label="Shape actions"><button type="button" data-action="duplicate" data-icon="copy" aria-label="Duplicate shape"></button><button type="button" data-action="delete" data-icon="library-minus" aria-label="Delete shape"></button><button type="button" data-action="undo" data-icon="arrow-back-up" aria-label="Undo"></button><button type="button" data-action="clear" data-icon="trash" class="danger" aria-label="Clear all shapes"></button></div>
  <div data-field="properties"></div>
  <p>Scroll over a value to adjust it. Shift: finer steps. Ctrl/⌘: larger steps.</p>
  <p data-field="count"></p></aside></div>
  <p data-field="status" role="status">Loading model…</p>
  <footer><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="apply" class="primary" disabled>Apply collider</button></footer>`;
  document.body.append(dialog);
  applyIcons(dialog);
  for (const button of dialog.querySelectorAll('[data-icon]'))
    button.title = button.getAttribute('aria-label');
  const find = (field) => dialog.querySelector(`[data-field="${field}"]`);
  const action = (name) => dialog.querySelector(`[data-action="${name}"]`);
  const viewport = dialog.querySelector('.compoundViewport');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171c23);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x526070, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(2, 4, 3);
  scene.add(light);
  const grid = new THREE.GridHelper(3, 30, 0x526070, 0x2c3744);
  grid.position.y = -box[1] / unit;
  scene.add(grid);
  const axes = new THREE.AxesHelper(0.7);
  scene.add(axes);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 100);
  camera.position.set(1.7, 1.2, 1.7);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (error) {
    dialog.remove();
    throw error;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  viewport.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Drag collider or orbit model');
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();
  let shapes = new THREE.Group();
  scene.add(shapes);
  const history = [];
  const remember = () => {
    history.push(JSON.stringify(draft));
    if (history.length > 40) history.shift();
  };
  function rebuild(keepInputs = false) {
    disposeTree(shapes);
    scene.remove(shapes);
    shapes = new THREE.Group();
    scene.add(shapes);
    const spec = compoundColliderSpec(draft, [0.5, 0.5, 0.5]);
    for (const [i, part] of (spec?.shapes || []).entries()) {
      const geometry =
        part.type === 'convex'
          ? new ConvexGeometry(part.vertices.map((v) => new THREE.Vector3(...v)))
          : part.type === 'sphere'
            ? new THREE.SphereGeometry(part.radius, 20, 12)
            : part.type === 'cylinder'
              ? new THREE.CylinderGeometry(
                  part.radiusTop,
                  part.radiusBottom,
                  part.height,
                  part.sides,
                )
              : new THREE.BoxGeometry(...part.halfExtents.map((v) => v * 2));
      const color = i === selected ? 0xffcd70 : 0x56d3ff;
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: i === selected ? 0.32 : 0.16,
          depthWrite: false,
          depthTest: false,
        }),
      );
      mesh.position.fromArray(part.offset);
      mesh.rotation.set(...part.rotation);
      mesh.userData.index = i;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color, depthTest: false }),
      );
      edges.raycast = () => {};
      mesh.add(edges);
      shapes.add(mesh);
    }
    find('list').replaceChildren(
      ...draft.shapes.map((shape, i) => {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${i + 1}. ${shape.type === 'flat' ? 'Thin slab' : shape.type}`;
        return option;
      }),
    );
    find('list').value = selected;
    find('count').textContent = `${draft.shapes.length} / ${COMPOUND_SHAPE_LIMIT} shapes`;
    for (const button of dialog.querySelectorAll('[data-add-shape]'))
      button.disabled = draft.shapes.length >= COMPOUND_SHAPE_LIMIT;
    action('duplicate').disabled = selected < 0 || draft.shapes.length >= COMPOUND_SHAPE_LIMIT;
    action('delete').disabled = selected < 0;
    action('clear').disabled = !draft.shapes.length;
    action('undo').disabled = !history.length;
    action('apply').disabled = !ready || !outlineValid || !normalizeCompoundCollider(draft);
    if (!keepInputs) properties();
    action('apply').disabled = !ready || !outlineValid || !normalizeCompoundCollider(draft);
  }
  function properties() {
    outlineEditor = null;
    outlineValid = true;
    const host = find('properties');
    host.replaceChildren();
    const shape = draft.shapes[selected];
    if (!shape) return;
    if (['box', 'flat'].includes(shape.type)) {
      const convert = document.createElement('button');
      convert.type = 'button';
      convert.dataset.action = 'outline';
      convert.textContent = 'Edit outline / clip corners';
      convert.onclick = () => {
        remember();
        draft.shapes[selected].type = 'outline';
        draft.shapes[selected].outline = { type: 'rectangle' };
        rebuild();
      };
      host.append(convert);
    }
    if (shape.type === 'outline') {
      const panel = document.createElement('div');
      panel.innerHTML = `<label>Outline <select id="compoundShapeOutline">
        <option value="rectangle">Rectangle</option><option value="clipped">Clipped corners</option>
        <option value="triangle">Triangle</option><option value="hexagon">Hexagon</option>
        <option value="circle">Circle / oval</option><option value="custom">Custom convex outline</option>
        </select></label>
        <label>Corner cut (%) <input id="compoundShapeCut" type="number" min="1" max="49" value="15"></label>
        <canvas id="compoundShapeCanvas" width="320" height="240" style="max-width:100%;cursor:crosshair" aria-label="Outline corners"></canvas>
        <div id="compoundShapeTools"><button type="button" id="compoundShapeUndo">Undo corner</button>
        <button type="button" id="compoundShapeClear">Clear outline</button></div>
        <p id="compoundShapeStatus" role="status"></p>`;
      host.append(panel);
      let active = false;
      const editor = wireBoardOutline('compoundShape', (outline) => {
        if (!active) return;
        outlineValid = !!outline;
        if (!outline) {
          action('apply').disabled = true;
          return;
        }
        if (JSON.stringify(outline) !== JSON.stringify(draft.shapes[selected].outline)) {
          remember();
          draft.shapes[selected].outline = outline;
          rebuild(true);
        }
        action('apply').disabled = !ready || !outlineValid || !normalizeCompoundCollider(draft);
      });
      editor.fill(shape.outline);
      editor.aspect(shape.size[0] / shape.size[2]);
      outlineEditor = editor;
      active = true;
    }
    for (const key of ['position', 'rotation', 'size']) {
      const label = document.createElement('p');
      label.textContent =
        key === 'size'
          ? 'Full dimensions (table units)'
          : key === 'rotation'
            ? 'Rotation (degrees)'
            : 'Position (table units)';
      host.append(label);
      const row = document.createElement('div');
      row.className = 'compoundNumbers';
      host.append(row);
      for (let axis = 0; axis < 3; axis++) {
        const wrap = document.createElement('label');
        wrap.textContent = ['X', 'Y', 'Z'][axis];
        const input = document.createElement('input');
        input.type = 'number';
        input.step = key === 'rotation' ? '1' : '0.01';
        input.setAttribute('aria-label', `${key} ${['X', 'Y', 'Z'][axis]}`);
        const factor = key === 'rotation' ? 180 / Math.PI : unit;
        input.value = +(shape[key][axis] * factor).toFixed(4);
        input.min = key === 'size' ? 0.001 * unit : key === 'rotation' ? -360 : -2 * unit;
        input.max = key === 'rotation' ? 360 : 2 * unit;
        input.disabled =
          key === 'size' &&
          ((shape.type === 'sphere' && axis > 0) ||
            (['cylinder', 'cone'].includes(shape.type) && axis === 2));
        input.dataset.property = key;
        input.dataset.axis = axis;
        let editing = false;
        const update = () => {
          const number = +input.value / factor;
          const next = structuredClone(draft);
          next.shapes[selected][key][axis] = number;
          if (key === 'size') constrainRound(next.shapes[selected]);
          if (!input.value || !normalizeCompoundCollider(next)) {
            find('status').textContent = 'Value is outside the supported range.';
            action('apply').disabled = true;
            return;
          }
          if (JSON.stringify(next) !== JSON.stringify(draft)) {
            if (!editing) remember();
            editing = true;
            draft = next;
          }
          find('status').textContent = 'Changes are kept in this draft until you apply.';
          rebuild(true);
          outlineEditor?.aspect(draft.shapes[selected].size[0] / draft.shapes[selected].size[2]);
          for (const linked of host.querySelectorAll('input:disabled')) {
            linked.value = +(
              draft.shapes[selected][linked.dataset.property][+linked.dataset.axis] * unit
            ).toFixed(4);
          }
        };
        input.oninput = update;
        input.onchange = update;
        input.onblur = () => {
          editing = false;
          input.value = +(draft.shapes[selected][key][axis] * factor).toFixed(4);
          action('apply').disabled = !ready || !outlineValid || !normalizeCompoundCollider(draft);
        };
        input.addEventListener(
          'wheel',
          (event) => {
            if (input.disabled || !event.deltaY) return;
            event.preventDefault();
            input.focus({ preventScroll: true });
            const step =
              +input.step * (event.shiftKey ? 0.1 : event.ctrlKey || event.metaKey ? 10 : 1);
            const current =
              input.value === '' ? draft.shapes[selected][key][axis] * factor : +input.value;
            input.value = +Math.max(
              +input.min,
              Math.min(+input.max, current - Math.sign(event.deltaY) * step),
            ).toFixed(6);
            update();
          },
          { passive: false },
        );
        wrap.append(input);
        row.append(wrap);
      }
    }
  }
  function constrainRound(shape) {
    if (shape.type === 'sphere') shape.size[1] = shape.size[0];
    if (['sphere', 'cylinder', 'cone'].includes(shape.type)) shape.size[2] = shape.size[0];
  }
  find('list').onchange = () => {
    selected = +find('list').value;
    rebuild();
  };
  for (const button of dialog.querySelectorAll('[data-drag-mode]')) {
    button.onclick = () => {
      dragMode = button.dataset.dragMode;
      controls.enabled = dragMode === 'orbit';
      for (const toggle of dialog.querySelectorAll('[data-drag-mode]'))
        toggle.setAttribute('aria-pressed', String(toggle === button));
    };
  }
  for (const button of dialog.querySelectorAll('[data-add-shape]')) {
    button.onclick = () => {
      if (draft.shapes.length >= COMPOUND_SHAPE_LIMIT) return;
      remember();
      const type = button.dataset.addShape;
      draft.shapes.push({
        type,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        ...(type === 'outline' ? { outline: { type: 'clipped', cut: 0.15 } } : {}),
        size: ['flat', 'outline'].includes(type) ? [0.5, 0.02, 0.5] : [0.3, 0.3, 0.3],
      });
      selected = draft.shapes.length - 1;
      rebuild();
    };
  }
  action('duplicate').onclick = () => {
    if (selected < 0 || draft.shapes.length >= COMPOUND_SHAPE_LIMIT) return;
    remember();
    const copy = structuredClone(draft.shapes[selected]);
    copy.position[0] = Math.min(2, copy.position[0] + 0.05);
    draft.shapes.push(copy);
    selected = draft.shapes.length - 1;
    rebuild();
  };
  action('delete').onclick = () => {
    if (selected < 0) return;
    remember();
    draft.shapes.splice(selected, 1);
    selected = Math.min(selected, draft.shapes.length - 1);
    rebuild();
  };
  action('clear').onclick = () => {
    if (!draft.shapes.length) return;
    remember();
    draft.shapes = [];
    selected = -1;
    rebuild();
  };
  action('undo').onclick = () => {
    if (!history.length) return;
    draft = JSON.parse(history.pop());
    selected = Math.min(Math.max(0, selected), draft.shapes.length - 1);
    rebuild();
  };
  for (const button of dialog.querySelectorAll('[data-view]'))
    button.onclick = () => {
      const view = button.dataset.view;
      camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
      camera.position.set(
        ...{
          top: [0, 2.5, 0],
          front: [0, 0, 2.5],
          side: [2.5, 0, 0],
          perspective: [1.7, 1.2, 1.7],
        }[view],
      );
      controls.target.set(0, 0, 0);
      controls.update();
    };
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let drag = null;
  function updateRay(event) {
    camera.updateMatrixWorld();
    shapes.updateMatrixWorld(true);
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
  }
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    updateRay(event);
    const hit = ray.intersectObjects(shapes.children, false)[0];
    if (!hit) return;
    selected = hit.object.userData.index;
    rebuild();
    if (dragMode === 'orbit') return;
    const normal = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(...draft.shapes[selected].position),
    );
    const start = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!start) return;
    remember();
    drag = {
      plane,
      start,
      x: event.clientX,
      y: event.clientY,
      shape: structuredClone(draft.shapes[selected]),
      mode: dragMode,
    };
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const shape = structuredClone(drag.shape);
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    if (drag.mode === 'move') {
      updateRay(event);
      const point = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!point) return;
      shape.position = new THREE.Vector3(...drag.shape.position)
        .add(point.sub(drag.start))
        .toArray()
        .map((v) => Math.max(-2, Math.min(2, v)));
    } else if (drag.mode === 'rotate') {
      shape.rotation[0] = Math.max(
        -Math.PI * 2,
        Math.min(Math.PI * 2, shape.rotation[0] + dy * 0.01),
      );
      shape.rotation[1] = Math.max(
        -Math.PI * 2,
        Math.min(Math.PI * 2, shape.rotation[1] + dx * 0.01),
      );
    } else {
      const factor = Math.exp((dx - dy) * 0.005);
      shape.size = shape.size.map((v) => Math.max(0.001, Math.min(2, v * factor)));
      constrainRound(shape);
    }
    draft.shapes[selected] = shape;
    rebuild();
  });
  const endDrag = () => {
    drag = null;
  };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);
  let frame;
  const resize = new ResizeObserver(() => {
    const w = viewport.clientWidth,
      h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resize.observe(viewport);
  let resolveResult;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });
  function finish(value) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    controls.dispose();
    disposeTree(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    dialog.close();
    dialog.remove();
    previousFocus?.focus();
    resolveResult(value);
  }
  for (const button of dialog.querySelectorAll('[data-action="cancel"]'))
    button.onclick = () => finish(null);
  action('apply').onclick = () => {
    const value = normalizeCompoundCollider(draft);
    if (ready && outlineValid && value) finish(value);
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(null);
  });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.showModal();
  rebuild();
  const render = () => {
    if (finished) return;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  new GLTFLoader()
    .loadAsync(objectUrl || source)
    .then((gltf) => {
      if (finished) {
        disposeTree(gltf.scene);
        return;
      }
      const model = gltf.scene;
      model.rotation.set(...rotation);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model),
        size = bounds.getSize(new THREE.Vector3()),
        center = bounds.getCenter(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(longest) || longest <= 0) {
        disposeTree(model);
        throw new Error('The model has no usable geometry.');
      }
      model.scale.multiplyScalar(1 / longest);
      model.position.sub(center).multiplyScalar(1 / longest);
      scene.add(model);
      ready = true;
      find('status').textContent =
        'Model loaded. Add and position shapes, then apply the collider.';
      rebuild();
    })
    .catch((error) => {
      if (!finished) find('status').textContent = `Model preview failed: ${error.message}`;
    })
    .finally(() => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  return result;
}
