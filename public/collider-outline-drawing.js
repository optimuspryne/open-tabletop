import * as THREE from 'three';
import { boardOutlinePoints } from '/shared/board-geometry.js';
import { normalizeCompoundCollider, compoundColliderSpec } from '/shared/compound-collider.js';
import { createColliderSurface, disposeColliderSurface } from './collider-surface.js';

// Drawing coordinates live in a plane through the selected component, independent of camera orbit.
export function createOutlineDrawing({
  scene,
  camera,
  controls,
  canvas,
  host,
  unit,
  onCommit,
  onState,
  validate,
}) {
  host.innerHTML = `<label class="field-group"><span class="field-label">Drawing plane</span><select class="control control--select" data-draw="plane"><option value="top">Top</option><option value="front">Front</option><option value="side">Side</option><option value="local" hidden disabled>Selected shape plane</option></select></label>
    <label class="field-group"><span class="field-label">Thickness</span><input class="control control--compact" data-draw="thickness" aria-label="Outline thickness" type="number" step="0.01" min="${unit * 0.001}" max="${unit * 2}" value="${+(unit * 0.02).toFixed(4)}"></label>
    <label class="checkbox"><input class="checkbox__input" type="checkbox" data-draw="snap"> Snap to grid</label>
    <div class="button-row"><button type="button" class="button" data-draw="undo">Undo point edit</button><button type="button" class="button" data-draw="clear">Clear points</button>
    <button type="button" class="button button--primary" data-draw="finish">Finish outline</button><button type="button" class="button" data-draw="cancel">Cancel drawing</button>
    </div><p class="status-text" data-draw="status" role="status"></p>`;
  const field = (key) => host.querySelector(`[data-draw="${key}"]`);
  let active = false,
    points = [],
    closed = false,
    anchor,
    rotation,
    overlay = null,
    preview = null,
    dragging = null,
    pending = null,
    history = [];
  let previousCamera,
    candidate = null;
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  const orientation = () => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  const world = (point) =>
    new THREE.Vector3(point[0], 0, point[1]).applyQuaternion(orientation()).add(anchor);
  const remember = () => history.push({ points: structuredClone(points), closed });
  function discardGeometry() {
    if (overlay) {
      scene.remove(overlay);
      disposeColliderSurface(overlay);
      overlay = null;
    }
    if (preview) {
      scene.remove(preview);
      disposeColliderSurface(preview);
      preview = null;
    }
  }
  function shape() {
    if (points.length < 3) return null;
    const xs = points.map((p) => p[0]),
      zs = points.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs),
      d = Math.max(...zs) - Math.min(...zs);
    if (w < 0.001 || d < 0.001) return null;
    const center = [
      (Math.max(...xs) + Math.min(...xs)) / 2,
      (Math.max(...zs) + Math.min(...zs)) / 2,
    ];
    const value = {
      type: 'outline',
      position: world(center).toArray(),
      rotation: [...rotation],
      size: [w, Number(field('thickness').value) / unit, d],
      outline: {
        type: 'custom',
        points: points.map(([x, z]) => [
          Math.max(-0.5, Math.min(0.5, (x - center[0]) / w)),
          Math.max(-0.5, Math.min(0.5, (z - center[1]) / d)),
        ]),
      },
    };
    return normalizeCompoundCollider({ version: 1, shapes: [value] })?.shapes[0] || null;
  }
  function redraw() {
    discardGeometry();
    overlay = new THREE.Group();
    scene.add(overlay);
    const grid = new THREE.GridHelper(4, 40, 0x526070, 0x2c3744);
    grid.position.copy(anchor);
    grid.quaternion.copy(orientation());
    overlay.add(grid);
    const vertices = points.map(world);
    if (vertices.length > 1) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(closed ? [...vertices, vertices[0]] : vertices),
        new THREE.LineBasicMaterial({ color: 0xffcd70, depthTest: false }),
      );
      line.renderOrder = 20;
      overlay.add(line);
    }
    for (let i = 0; i < vertices.length; i++) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 10, 8),
        new THREE.MeshBasicMaterial({ color: i === 0 ? 0x82efb3 : 0xffffff, depthTest: false }),
      );
      marker.position.copy(vertices[i]);
      marker.renderOrder = 21;
      overlay.add(marker);
    }
    candidate = closed ? shape() : null;
    const result = candidate ? validate(candidate) : null;
    field('finish').disabled = !candidate || !result;
    field('undo').disabled = !history.length;
    if (candidate && result) {
      const spec = compoundColliderSpec({ version: 1, shapes: [candidate] }, [0.5, 0.5, 0.5]);
      preview = createColliderSurface(spec);
      preview.traverse((node) => {
        if (node.isMesh) {
          node.material.color.setHex(0x56d3ff);
          node.material.transparent = true;
          node.material.opacity = 0.24;
          node.material.depthWrite = false;
          node.material.depthTest = false;
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(node.geometry),
            new THREE.LineBasicMaterial({ color: 0x56d3ff, depthTest: false }),
          );
          node.add(edges);
        }
      });
      scene.add(preview);
      field('status').textContent =
        `${points.length} points · ${spec.shapes.length} convex parts. Drag points to adjust, scroll to zoom, then Finish outline.`;
    } else
      field('status').textContent = closed
        ? candidate
          ? 'This outline exceeds the remaining 16-part budget.'
          : 'Invalid outline: avoid crossing lines, repeated points, or dimensions outside the supported range.'
        : `${points.length} / 32 points. Click to draw; click the green first point to close. Finish outline also closes the loop. Drag points to adjust.`;
    // Finish can close a valid open loop as a keyboard/touch alternative to hitting the first point.
    if (!closed) {
      const value = shape();
      field('finish').disabled = !value || !validate(value);
    }
  }
  function alignCamera() {
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation());
    camera.position.copy(anchor).addScaledVector(normal, 2.5);
    camera.up.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(orientation()));
    controls.target.copy(anchor);
    controls.update();
    camera.updateMatrixWorld(true);
  }
  function stop() {
    if (!active) return;
    active = false;
    dragging = null;
    pending = null;
    host.hidden = true;
    discardGeometry();
    camera.position.copy(previousCamera.position);
    camera.up.copy(previousCamera.up);
    controls.target.copy(previousCamera.target);
    controls.update();
    onState(false);
  }
  const down = (event) => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    const distance = (p) => {
      const v = world(p).project(camera);
      return Math.hypot(
        ((v.x + 1) * rect.width) / 2 + rect.left - event.clientX,
        ((1 - v.y) * rect.height) / 2 + rect.top - event.clientY,
      );
    };
    let nearest = -1,
      best = 14;
    points.forEach((p, i) => {
      const d = distance(p);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    if (nearest === 0 && !closed && points.length >= 3) {
      remember();
      closed = true;
      redraw();
      return;
    }
    if (nearest >= 0) {
      remember();
      dragging = nearest;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (closed || points.length >= 32) return;
    const point = hit(event);
    if (!point) return;
    pending = { x: event.clientX, y: event.clientY, point };
    canvas.setPointerCapture(event.pointerId);
  };
  function hit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    camera.updateMatrixWorld(true);
    ray.setFromCamera(pointer, camera);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation());
    const point = ray.ray.intersectPlane(
      new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor),
      new THREE.Vector3(),
    );
    if (!point) return null;
    point.sub(anchor).applyQuaternion(orientation().invert());
    const snap = (v) => (field('snap').checked ? Math.round(v / 0.1) * 0.1 : v);
    return [snap(point.x), snap(point.z)];
  }
  const move = (event) => {
    if (!active) return;
    event.stopImmediatePropagation();
    if (dragging !== null) {
      const point = hit(event);
      if (point) {
        points[dragging] = point;
        redraw();
      }
    }
  };
  const up = (event) => {
    if (!active) return;
    event.stopImmediatePropagation();
    if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 8) {
      remember();
      points.push(pending.point);
      redraw();
    }
    pending = null;
    dragging = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const cancel = () => {
    dragging = null;
    pending = null;
  };
  const zoom = (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const offset = camera.position.clone().sub(anchor);
    offset.setLength(
      Math.max(
        0.1,
        Math.min(
          10,
          offset.length() * Math.exp(Math.max(-500, Math.min(500, event.deltaY)) * 0.001),
        ),
      ),
    );
    camera.position.copy(anchor).add(offset);
    camera.updateMatrixWorld(true);
  };
  canvas.addEventListener('wheel', zoom, { capture: true, passive: false });
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('pointermove', move, true);
  canvas.addEventListener('pointerup', up, true);
  canvas.addEventListener('pointercancel', cancel, true);
  field('plane').onchange = () => {
    rotation = { top: [0, 0, 0], front: [Math.PI / 2, 0, 0], side: [Math.PI / 2, 0, -Math.PI / 2] }[
      field('plane').value
    ];
    alignCamera();
    redraw();
  };
  field('thickness').oninput = redraw;
  field('undo').onclick = () => {
    const last = history.pop();
    if (last) {
      points = last.points;
      closed = last.closed;
      redraw();
    }
  };
  field('clear').onclick = () => {
    remember();
    points = [];
    closed = false;
    redraw();
  };
  field('cancel').onclick = stop;
  field('finish').onclick = () => {
    const value = shape();
    if (!value || !validate(value)) return;
    stop();
    onCommit(value);
  };
  host.hidden = true;
  return {
    get active() {
      return active;
    },
    start({ shape: original = null, position = [0, 0, 0] } = {}) {
      if (active) return;
      previousCamera = {
        position: camera.position.clone(),
        up: camera.up.clone(),
        target: controls.target.clone(),
      };
      active = true;
      history = [];
      points = [];
      closed = false;
      anchor = new THREE.Vector3(...position);
      rotation = [0, 0, 0];
      field('plane').value = original ? 'local' : 'top';
      field('plane').disabled = !!original;
      if (original) {
        anchor.fromArray(original.position);
        rotation = [...original.rotation];
        const outline = original.outline;
        const raw =
          outline.type === 'custom'
            ? outline.points
            : boardOutlinePoints({ ...outline, fit: undefined });
        const c = Math.cos(outline.fit?.rotation || 0),
          s = Math.sin(outline.fit?.rotation || 0);
        points = raw.map(([x, z]) => {
          const a = x * original.size[0] * (outline.fit?.scale[0] || 1),
            b = z * original.size[2] * (outline.fit?.scale[1] || 1);
          return [a * c + b * s, -a * s + b * c];
        });
        closed = true;
        field('thickness').value = original.size[1] * unit;
      }
      host.hidden = false;
      onState(true);
      alignCamera();
      redraw();
    },
    dispose() {
      stop();
      canvas.removeEventListener('wheel', zoom, true);
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', up, true);
      canvas.removeEventListener('pointercancel', cancel, true);
    },
  };
}
