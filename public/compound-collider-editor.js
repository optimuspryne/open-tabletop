import { createOutlineDrawing } from './collider-outline-drawing.js';
import { normalizeColliderOutline } from '/shared/collider-outline.js';
import { captureGroup, insertGroup, transformGroup } from './collider-groups.js';
import { wireColliderPresets } from './collider-presets.js';
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
    outlineExpanded = true,
    finished = false,
    ready = false;
  let selection = new Set([0]);
  const selectOnly = (index) => {
    selected = index;
    selection = new Set(index < 0 ? [] : [index]);
  };
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal compoundEditor';
  dialog.setAttribute('aria-label', 'Custom collider editor');
  dialog.innerHTML = `<header class="modal__header"><h2 class="modal__title">Custom collider</h2><button type="button" class="modal__close close-x" data-action="cancel" aria-label="Close collider editor">✕</button></header>
  <div class="modal__body compoundEditorBody">
  <p class="help-text">Build a solid collision shape around your model. Leave gaps between shapes for holes and recesses.</p>
  <div class="compoundLayout"><div><div class="compoundViewport" aria-label="3D collider preview"></div>
  <div class="compoundToolbar"><div class="field-group"><span class="field-label">Drag mode</span><div class="button-row compoundIconButtons" role="group" aria-label="Drag mode">
  ${Object.entries({
    orbit: 'view-360-number',
    move: 'chart-scatter-3d',
    rotate: 'rotate-3d',
    resize: 'scan-cube',
  })
    .map(
      ([mode, icon]) =>
        `<button type="button" class="button button--icon" data-drag-mode="${mode}" data-icon="${icon}" aria-label="${mode === 'orbit' ? 'Orbit view' : mode[0].toUpperCase() + mode.slice(1) + ' shape'}" aria-pressed="${mode === 'orbit'}"></button>`,
    )
    .join('')}</div></div>
  <div class="field-group"><span class="field-label">Camera</span><div class="button-row compoundIconButtons" role="group" aria-label="Camera controls">
  <button type="button" class="button button--icon" data-view="perspective" data-icon="hexagon-3d" aria-label="Perspective view"></button><button type="button" class="button button--icon" data-view="top" data-icon="mood-look-down" aria-label="Top view"></button><button type="button" class="button button--icon" data-view="front" data-icon="mood-neutral" aria-label="Front view"></button><button type="button" class="button button--icon" data-view="side" data-icon="mood-look-left" aria-label="Side view"></button></div></div></div>
  <button type="button" class="button" data-action="draw">Draw outline in 3D</button><p class="help-text">Click a shape to select it. Ctrl/⌘-click to select multiple shapes. Drag in the chosen mode, or enter exact values. Use Orbit view to rotate the camera and scroll to zoom.</p></div>
  <aside tabindex="0" aria-label="Collider controls"><div data-field="drawing" class="compoundDrawing" hidden></div><label class="field-group"><span class="field-label">Shapes</span><select class="control control--select control--multiselect" data-field="list" multiple size="5" aria-label="Collider shapes"></select></label>
  <div class="button-row compoundToolbar compoundIconButtons" role="group" aria-label="Add shape">${COMPOUND_TYPES.map((type) => `<button type="button" class="button button--icon" data-add-shape="${type}" data-icon="${{ box: 'cube-plus', sphere: 'sphere-plus', cylinder: 'cylinder-plus', cone: 'cone-plus', flat: 'square-plus-2', outline: 'hexagon-3d' }[type]}" aria-label="Add ${type === 'flat' ? 'flat slab' : type}"></button>`).join('')}</div>
  <div class="button-row compoundToolbar compoundIconButtons" role="group" aria-label="Shape actions"><button type="button" class="button button--icon" data-action="duplicate" data-icon="copy" aria-label="Duplicate shape"></button><button type="button" class="button button--icon" data-action="delete" data-icon="library-minus" aria-label="Delete shape"></button><button type="button" class="button button--icon" data-action="undo" data-icon="arrow-back-up" aria-label="Undo"></button><button type="button" data-action="clear" data-icon="trash" class="button button--icon button--danger" aria-label="Clear all shapes"></button></div>
  <button type="button" class="button" data-action="select-all">Select all shapes</button>
  <details class="compoundPresets" data-field="presets"></details>
  <div data-field="properties"></div>
  <p class="help-text">Scroll over a value to adjust it. Shift: finer steps. Ctrl/⌘: larger steps.</p>
  <p class="status-text" data-field="count"></p></aside></div>
  <p class="status-text" data-field="status" role="status">Loading model…</p>
  </div>
  <footer class="modal__footer button-row button-row--end"><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" data-action="apply" class="button button--primary" disabled>Apply collider</button></footer>`;
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
  let drawingIndex = null;
  let hiddenControls = [];
  const withDrawing = (shape) => {
    const next = structuredClone(draft);
    if (drawingIndex === null) next.shapes.push(shape);
    else next.shapes[drawingIndex] = shape;
    return normalizeCompoundCollider(next);
  };
  const drawing = createOutlineDrawing({
    scene,
    camera,
    controls,
    canvas: renderer.domElement,
    host: find('drawing'),
    unit,
    validate: withDrawing,
    onCommit: (shape) => {
      const next = withDrawing(shape);
      if (!next) return;
      remember();
      draft = next;
      selectOnly(drawingIndex ?? draft.shapes.length - 1);
      rebuild();
    },
    onState: (active) => {
      controls.enabled = !active && dragMode === 'orbit';
      shapes.visible = grid.visible = axes.visible = !active;
      action('apply').disabled =
        active || !ready || !outlineValid || !normalizeCompoundCollider(draft);
      for (const button of dialog.querySelectorAll(
        '[data-drag-mode], [data-view], [data-action="draw"]',
      ))
        button.disabled = active;
      if (active) {
        hiddenControls = [...dialog.querySelector('aside').children]
          .filter((el) => el !== find('drawing'))
          .map((el) => [el, el.hidden]);
        for (const [el] of hiddenControls) el.hidden = true;
        dialog.querySelector('aside').scrollTop = 0;
      } else {
        for (const [el, hidden] of hiddenControls) el.hidden = hidden;
      }
    },
  });
  action('draw').onclick = () => {
    drawingIndex = null;
    drawing.start({ position: draft.shapes[selected]?.position || [0, 0, 0] });
  };
  function rebuild(keepInputs = false) {
    disposeTree(shapes);
    scene.remove(shapes);
    shapes = new THREE.Group();
    scene.add(shapes);
    shapes.visible = !drawing.active;
    const spec = compoundColliderSpec(draft, [0.5, 0.5, 0.5]);
    for (const part of spec?.shapes || []) {
      const i = part.sourceIndex;
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
      const color = selection.has(i) ? 0xffcd70 : 0x56d3ff;
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: selection.has(i) ? 0.32 : 0.16,
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
    const list = find('list');
    // Keep existing options so native Shift-selection keeps its range anchor.
    while (list.options.length > draft.shapes.length) list.remove(list.options.length - 1);
    draft.shapes.forEach((shape, i) => {
      if (!list.options[i]) list.add(new Option('', String(i)));
      const option = list.options[i];
      option.textContent = `${i + 1}. ${shape.type === 'flat' ? 'Thin slab' : shape.type}`;
      option.selected = selection.has(i);
    });
    find('count').textContent =
      `${draft.shapes.length} editable shapes · ${spec?.shapes.length || 0} / ${COMPOUND_SHAPE_LIMIT} physics parts · ${selection.size} selected`;
    for (const button of dialog.querySelectorAll('[data-add-shape]'))
      button.disabled = (spec?.shapes.length || 0) >= COMPOUND_SHAPE_LIMIT;
    action('duplicate').disabled =
      !selection.size ||
      (spec?.shapes.length || 0) +
        (spec?.shapes.filter((part) => selection.has(part.sourceIndex)).length || 0) >
        COMPOUND_SHAPE_LIMIT;
    action('delete').disabled = selected < 0;
    action('clear').disabled = !draft.shapes.length;
    action('undo').disabled = !history.length;
    action('apply').disabled =
      drawing.active || !ready || !outlineValid || !normalizeCompoundCollider(draft);
    if (!keepInputs && !drawing.active) properties();
    action('apply').disabled =
      drawing.active || !ready || !outlineValid || !normalizeCompoundCollider(draft);
  }
  function properties() {
    outlineEditor = null;
    outlineValid = true;
    const host = find('properties');
    host.replaceChildren();
    const shape = draft.shapes[selected];
    if (!shape) return;
    if (selection.size > 1) {
      groupProperties(host);
      return;
    }
    if (['box', 'flat'].includes(shape.type)) {
      const convert = document.createElement('button');
      convert.type = 'button';
      convert.className = 'button';
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
      const draw = document.createElement('button');
      draw.type = 'button';
      draw.className = 'button';
      draw.dataset.action = 'draw-edit';
      draw.textContent = 'Edit outline in 3D';
      draw.onclick = () => {
        drawingIndex = selected;
        drawing.start({ shape: draft.shapes[selected] });
      };
      host.append(draw);
      const panel = document.createElement('details');
      panel.className = 'compoundOutline';
      panel.open = outlineExpanded;
      panel.addEventListener('toggle', () => {
        if (panel.isConnected) outlineExpanded = panel.open;
      });
      panel.innerHTML = `<summary>Edit outline</summary><label class="field-group"><span class="field-label">Outline</span><select id="compoundShapeOutline" class="control control--select">
        <option value="rectangle">Rectangle</option><option value="clipped">Clipped corners</option>
        <option value="triangle">Triangle</option><option value="hexagon">Hexagon</option>
        <option value="circle">Circle / oval</option><option value="custom">Custom outline (concave allowed)</option>
        </select></label>
        <label class="field-group"><span class="field-label">Corner cut (%)</span><input id="compoundShapeCut" class="control control--compact" type="number" min="1" max="49" value="15"></label>
        <canvas id="compoundShapeCanvas" width="320" height="240" style="max-width:100%;cursor:crosshair" aria-label="Outline corners"></canvas>
        <div id="compoundShapeTools" class="button-row"><button type="button" class="button" id="compoundShapeUndo">Undo corner</button>
        <button type="button" class="button" id="compoundShapeClear">Clear outline</button></div>
        <p id="compoundShapeStatus" class="status-text" role="status"></p>`;
      host.append(panel);
      let active = false;
      const editor = wireBoardOutline(
        'compoundShape',
        (outline) => {
          if (!active) return;
          outlineValid = !!outline;
          if (!outline) {
            action('apply').disabled = true;
            return;
          }
          if (JSON.stringify(outline) !== JSON.stringify(draft.shapes[selected].outline)) {
            const next = structuredClone(draft);
            next.shapes[selected].outline = outline;
            if (!normalizeCompoundCollider(next)) {
              outlineValid = false;
              action('apply').disabled = true;
              find('status').textContent = 'This outline exceeds the remaining 16-part budget.';
              return;
            }
            remember();
            draft = next;
            rebuild(true);
          }
          action('apply').disabled =
            drawing.active || !ready || !outlineValid || !normalizeCompoundCollider(draft);
        },
        { normalizeOutline: normalizeColliderOutline, allowConcave: true },
      );
      editor.fill(shape.outline);
      editor.aspect(shape.size[0] / shape.size[2]);
      outlineEditor = editor;
      active = true;
    }
    for (const key of ['position', 'rotation', 'size']) {
      const label = document.createElement('p');
      label.className = 'field-label';
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
        wrap.className = 'field-group';
        const caption = document.createElement('span');
        caption.className = 'field-label';
        caption.textContent = ['X', 'Y', 'Z'][axis];
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'control control--compact';
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
          action('apply').disabled =
            drawing.active || !ready || !outlineValid || !normalizeCompoundCollider(draft);
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
        wrap.append(caption, input);
        row.append(wrap);
      }
    }
  }
  function groupProperties(host) {
    const hint = document.createElement('p');
    hint.className = 'help-text';
    hint.textContent = `${selection.size} shapes selected. Transform the group around its shared center, or select one shape to edit it individually.`;
    host.append(hint);
    const base = structuredClone(draft),
      indices = [...selection];
    const transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    let editing = false;
    for (const key of ['position', 'rotation', 'scale']) {
      const label = document.createElement('p');
      label.className = 'field-label';
      label.textContent = {
        position: 'Move group (table units)',
        rotation: 'Rotate group (degrees)',
        scale: 'Uniform group scale',
      }[key];
      host.append(label);
      const row = document.createElement('div');
      row.className = 'compoundNumbers';
      host.append(row);
      for (let axis = 0; axis < (key === 'scale' ? 1 : 3); axis++) {
        const wrap = document.createElement('label');
        wrap.className = 'field-group';
        const caption = document.createElement('span');
        caption.className = 'field-label';
        caption.textContent = key === 'scale' ? 'Factor' : ['X', 'Y', 'Z'][axis];
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'control control--compact';
        input.step = key === 'rotation' ? '1' : '0.01';
        input.value = key === 'scale' ? '1' : '0';
        input.setAttribute('aria-label', `group ${key} ${axis}`);
        const update = () => {
          const value = Number(input.value);
          if (!input.value || !Number.isFinite(value)) return;
          const candidate = structuredClone(transform);
          if (key === 'scale') candidate.scale = value;
          else candidate[key][axis] = value / (key === 'rotation' ? 180 / Math.PI : unit);
          const next = transformGroup(base, indices, candidate);
          if (!next) {
            find('status').textContent = 'Group transformation exceeds the supported range.';
            return;
          }
          if (!editing) remember();
          editing = true;
          Object.assign(transform, candidate);
          draft = next;
          rebuild(true);
          find('status').textContent = 'Group updated in this draft.';
        };
        input.oninput = update;
        input.onblur = () => {
          editing = false;
          input.value =
            key === 'scale'
              ? transform.scale
              : +(transform[key][axis] * (key === 'rotation' ? 180 / Math.PI : unit)).toFixed(6);
        };
        input.addEventListener(
          'wheel',
          (event) => {
            if (!event.deltaY) return;
            event.preventDefault();
            input.focus({ preventScroll: true });
            input.value = +(
              Number(input.value) -
              Math.sign(event.deltaY) *
                Number(input.step) *
                (event.shiftKey ? 0.1 : event.ctrlKey || event.metaKey ? 10 : 1)
            ).toFixed(6);
            update();
          },
          { passive: false },
        );
        wrap.append(caption, input);
        row.append(wrap);
      }
    }
  }
  function constrainRound(shape) {
    if (shape.type === 'sphere') shape.size[1] = shape.size[0];
    if (['sphere', 'cylinder', 'cone'].includes(shape.type)) shape.size[2] = shape.size[0];
  }
  wireColliderPresets(find('presets'), {
    capture: () =>
      captureGroup(
        [...selection].map((i) => draft.shapes[i]),
        unit,
      ),
    insert: (preset, size) => {
      if (finished) return;
      const next = insertGroup(draft, preset, size, unit);
      remember();
      selection = new Set(next.shapes.map((_, i) => i).slice(draft.shapes.length));
      selected = [...selection][0];
      draft = next;
      rebuild();
    },
  });
  find('list').onchange = () => {
    selection = new Set([...find('list').selectedOptions].map((option) => +option.value));
    selected = [...selection][0] ?? -1;
    rebuild();
  };
  action('select-all').onclick = () => {
    selection = new Set(draft.shapes.map((_, i) => i));
    selected = selection.size ? 0 : -1;
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
      if (
        (compoundColliderSpec(draft, [0.5, 0.5, 0.5])?.shapes.length || 0) >= COMPOUND_SHAPE_LIMIT
      )
        return;
      remember();
      const type = button.dataset.addShape;
      draft.shapes.push({
        type,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        ...(type === 'outline' ? { outline: { type: 'clipped', cut: 0.15 } } : {}),
        size: ['flat', 'outline'].includes(type) ? [0.5, 0.02, 0.5] : [0.3, 0.3, 0.3],
      });
      selectOnly(draft.shapes.length - 1);
      rebuild();
    };
  }
  action('duplicate').onclick = () => {
    if (!selection.size || draft.shapes.length + selection.size > COMPOUND_SHAPE_LIMIT) return;
    const copies = [...selection].map((i) => structuredClone(draft.shapes[i]));
    if (!normalizeCompoundCollider({ version: 1, shapes: [...draft.shapes, ...copies] })) {
      find('status').textContent = 'Duplicate exceeds the 16-part budget.';
      return;
    }
    remember();
    selection = new Set(copies.map((_, i) => draft.shapes.length + i));
    draft.shapes.push(...copies);
    selected = [...selection][0];
    rebuild();
  };
  action('delete').onclick = () => {
    if (!selection.size) return;
    remember();
    draft.shapes = draft.shapes.filter((_, i) => !selection.has(i));
    selectOnly(Math.min(selected, draft.shapes.length - 1));
    rebuild();
  };
  action('clear').onclick = () => {
    if (!draft.shapes.length) return;
    remember();
    draft.shapes = [];
    selectOnly(-1);
    rebuild();
  };
  action('undo').onclick = () => {
    if (!history.length) return;
    draft = JSON.parse(history.pop());
    selectOnly(Math.min(Math.max(0, selected), draft.shapes.length - 1));
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
    const index = hit.object.userData.index;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      if (selection.has(index)) selection.delete(index);
      else selection.add(index);
      selected = [...selection][0] ?? -1;
      rebuild();
      return;
    }
    if (!selection.has(index)) selectOnly(index);
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
      layout: structuredClone(draft),
      indices: [...selection],
      mode: dragMode,
    };
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    const transform = {};
    if (drag.mode === 'move') {
      updateRay(event);
      const point = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!point) return;
      transform.position = point.sub(drag.start).toArray();
    } else if (drag.mode === 'rotate') {
      transform.rotation = [dy * 0.01, dx * 0.01, 0];
    } else {
      transform.scale = Math.exp((dx - dy) * 0.005);
    }
    const next = transformGroup(drag.layout, drag.indices, transform);
    if (!next) return;
    draft = next;
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
    drawing.dispose();
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
    if (!drawing.active && ready && outlineValid && value) finish(value);
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
