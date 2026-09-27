import { notecardDimensions, NOTECARD_TEXT } from '../../shared/notecards.js';

// Measure in canonical paper pixels so thumbnails, the editor and meshes wrap identically.
export function layoutNotecardText(context, box, orientation) {
  const { canvasWidth, canvasHeight } = notecardDimensions(orientation);
  const scale = box.scale ?? 1;
  const width = (box.w - 2 * NOTECARD_TEXT.padding * scale) * canvasWidth;
  context.save();
  context.font = `${box.size * scale * canvasWidth}px ${NOTECARD_TEXT.font}`;
  const lines = [];
  for (const paragraph of box.text.replace(/\t/g, '    ').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/( +)/u)) {
      if (line && context.measureText(line + word).width > width) {
        lines.push(line.trimEnd());
        line = '';
      }
      for (const character of Array.from(word)) {
        if (line && context.measureText(line + character).width > width) {
          lines.push(line.trimEnd());
          line = '';
        }
        if (line || character !== ' ') line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  context.restore();
  const lineHeight = box.size * scale * NOTECARD_TEXT.lineHeight * canvasWidth;
  const padding = NOTECARD_TEXT.padding * scale * canvasWidth;
  const height = (lines.length * lineHeight + padding * 2) / canvasHeight;
  return { lines, lineHeight, padding, height, overflow: box.y + height > 1 + 1e-6 };
}

export function paintNotecardText(context, boxes = [], orientation) {
  const { canvasWidth, canvasHeight } = notecardDimensions(orientation);
  context.save();
  context.scale(context.canvas.width / canvasWidth, context.canvas.height / canvasHeight);
  for (const box of boxes) {
    const scale = box.scale ?? 1;
    const { lines, lineHeight, padding } = layoutNotecardText(context, box, orientation);
    const x = box.x * canvasWidth,
      y = box.y * canvasHeight;
    const width = box.w * canvasWidth;
    context.save();
    context.beginPath();
    context.rect(x, y, width, Math.max(0, canvasHeight - y));
    context.clip();
    context.font = `${box.size * scale * canvasWidth}px ${NOTECARD_TEXT.font}`;
    context.fillStyle = box.color;
    context.textAlign = box.align;
    context.textBaseline = 'top';
    const offset =
      box.align === 'center' ? width / 2 : box.align === 'right' ? width - padding : padding;
    lines.forEach((line, i) => context.fillText(line, x + offset, y + padding + i * lineHeight));
    context.restore();
  }
  context.restore();
}
