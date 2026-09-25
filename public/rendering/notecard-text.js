import { NOTECARD, NOTECARD_TEXT } from '../../shared/notecards.js';

// Measure in canonical paper pixels so thumbnails, the editor and meshes wrap identically.
export function layoutNotecardText(context, box) {
  const width = (box.w - 2 * NOTECARD_TEXT.padding) * NOTECARD.canvasWidth;
  context.save();
  context.font = `${box.size * NOTECARD.canvasWidth}px ${NOTECARD_TEXT.font}`;
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
  const lineHeight = box.size * NOTECARD_TEXT.lineHeight * NOTECARD.canvasWidth;
  const padding = NOTECARD_TEXT.padding * NOTECARD.canvasWidth;
  const height = (lines.length * lineHeight + padding * 2) / NOTECARD.canvasHeight;
  return { lines, lineHeight, padding, height, overflow: box.y + height > 1 + 1e-6 };
}

export function paintNotecardText(context, boxes = []) {
  context.save();
  context.scale(
    context.canvas.width / NOTECARD.canvasWidth,
    context.canvas.height / NOTECARD.canvasHeight,
  );
  for (const box of boxes) {
    const { lines, lineHeight, padding } = layoutNotecardText(context, box);
    const x = box.x * NOTECARD.canvasWidth,
      y = box.y * NOTECARD.canvasHeight;
    const width = box.w * NOTECARD.canvasWidth;
    context.save();
    context.beginPath();
    context.rect(x, y, width, Math.max(0, NOTECARD.canvasHeight - y));
    context.clip();
    context.font = `${box.size * NOTECARD.canvasWidth}px ${NOTECARD_TEXT.font}`;
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
