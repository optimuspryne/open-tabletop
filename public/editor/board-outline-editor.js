import { boardOutlinePoints, normalizeBoardOutline } from '/shared/board-geometry.js';

// A small top-down editor shared by image and model boards. Points use asset-local
// coordinates so changing board dimensions also scales its authored collider.
export function wireBoardOutline(
  prefix,
  onChange = () => {},
  { normalizeOutline = normalizeBoardOutline, allowConcave = false } = {},
) {
  const el = (suffix) => document.getElementById(prefix + suffix);
  const select = el('Outline'),
    cut = el('Cut'),
    canvas = el('Canvas');
  const fitWidth = el('FitWidth'),
    fitDepth = el('FitDepth'),
    fitRotation = el('FitRotation');
  const fit = () =>
    fitWidth
      ? {
          scale: [+fitWidth.value / 100, +fitDepth.value / 100],
          rotation: (+fitRotation.value * Math.PI) / 180,
        }
      : null;
  const ctx = canvas.getContext('2d');
  let imageGeneration = 0;
  let aspect = 1;
  const bounds = () => {
    const w = Math.min(280, 200 * aspect),
      h = w / aspect;
    return { x: (320 - w) / 2, y: (240 - h) / 2, w, h };
  };
  let points = [],
    background = null;
  function value() {
    const raw =
      select.value === 'custom'
        ? { type: 'custom', points }
        : select.value === 'clipped'
          ? { type: 'clipped', cut: +cut.value / 100 }
          : { type: select.value };
    const transform = fit();
    if (transform && (transform.scale.some((v) => v !== 1) || transform.rotation !== 0))
      raw.fit = transform;
    return normalizeOutline(raw);
  }
  function draw() {
    cut.closest('label').hidden = select.value !== 'clipped';
    el('Tools').hidden = select.value !== 'custom';
    const rect = bounds();
    ctx.clearRect(0, 0, 320, 240);
    ctx.fillStyle = '#202630';
    ctx.fillRect(0, 0, 320, 240);
    if (background) {
      ctx.globalAlpha = 0.6;
      ctx.drawImage(background, rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
    }
    const outline =
      select.value === 'custom' && (!value() || allowConcave)
        ? points
        : boardOutlinePoints(value(), aspect);
    ctx.beginPath();
    outline.forEach(([x, z], i) => {
      const px = rect.x + (x + 0.5) * rect.w,
        py = rect.y + (z + 0.5) * rect.h;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(70,190,240,.2)';
    ctx.fill();
    ctx.strokeStyle = '#65d5ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const [x, z] of outline) {
      ctx.beginPath();
      ctx.arc(rect.x + (x + 0.5) * rect.w, rect.y + (z + 0.5) * rect.h, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    onChange(value());
    el('Status').textContent =
      select.value === 'custom' && !value()
        ? allowConcave
          ? 'Add 3–32 corners without crossing lines. Inward bends are allowed.'
          : 'Add 3–32 corners around the edge, without inward bends or crossing lines.'
        : fitWidth
          ? 'Adjust the outline to match the model. These controls change collision only.'
          : 'Outline viewed from above. Size follows the board dimensions.';
  }
  canvas.onclick = (event) => {
    if (select.value !== 'custom' || points.length >= 32) return;
    const rect = canvas.getBoundingClientRect();
    const content = bounds();
    const x = Math.max(
      -0.5,
      Math.min(
        0.5,
        (((event.clientX - rect.left) / rect.width) * 320 - content.x) / content.w - 0.5,
      ),
    );
    const z = Math.max(
      -0.5,
      Math.min(
        0.5,
        (((event.clientY - rect.top) / rect.height) * 240 - content.y) / content.h - 0.5,
      ),
    );
    const transform = fit();
    if (transform) {
      const c = Math.cos(transform.rotation),
        s = Math.sin(transform.rotation);
      points.push([
        Math.max(-0.5, Math.min(0.5, (x * c - (z * s) / aspect) / transform.scale[0])),
        Math.max(-0.5, Math.min(0.5, (x * s * aspect + z * c) / transform.scale[1])),
      ]);
    } else points.push([x, z]);
    draw();
  };
  select.onchange = draw;
  cut.oninput = draw;
  for (const input of [fitWidth, fitDepth, fitRotation]) if (input) input.oninput = draw;
  if (el('FitReset'))
    el('FitReset').onclick = () => {
      fitWidth.value = fitDepth.value = '100';
      fitRotation.value = '0';
      draw();
    };
  el('Undo').onclick = () => {
    points.pop();
    draw();
  };
  el('Clear').onclick = () => {
    points = [];
    draw();
  };
  draw();
  return {
    aspect(value) {
      if (Number.isFinite(value) && value > 0) {
        aspect = value;
        draw();
      }
    },
    read() {
      const result = value();
      if (!result)
        throw new Error(
          allowConcave
            ? 'Draw 3–32 corners without crossing lines for a custom outline.'
            : 'Check outline size/rotation and draw 3–32 convex corners for a custom outline.',
        );
      return result;
    },
    fill(outline) {
      const spec = normalizeOutline(outline) || { type: 'rectangle' };
      if (fitWidth) {
        fitWidth.value = (spec.fit?.scale[0] ?? 1) * 100;
        fitDepth.value = (spec.fit?.scale[1] ?? 1) * 100;
        fitRotation.value = ((spec.fit?.rotation ?? 0) * 180) / Math.PI;
      }
      select.value = spec.type;
      cut.value = (spec.cut || 0.15) * 100;
      points = spec.points || [];
      draw();
    },
    image(url) {
      const generation = ++imageGeneration;
      background = null;
      draw();
      if (!url) return;
      if (typeof url !== 'string') {
        background = url;
        draw();
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (generation !== imageGeneration) return;
        background = img;
        draw();
      };
      img.src = url;
    },
  };
}
