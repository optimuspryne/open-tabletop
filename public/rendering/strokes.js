// Normalized freehand stroke replay shared by the whiteboard and private notecards.
export function drawCanvasStroke(context, stroke, width, height, background, minWidth = 1.5) {
  const points = stroke?.pts;
  if (!points || points.length < 2) return;
  context.strokeStyle = stroke.erase ? background : stroke.color || '#e8e6e0';
  context.fillStyle = context.strokeStyle;
  context.lineWidth = Math.max(minWidth, (stroke.width || 0.005) * width);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (points.length === 2) {
    context.arc(points[0] * width, points[1] * height, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  for (let i = 0; i < points.length; i += 2)
    (i === 0 ? context.moveTo : context.lineTo).call(
      context,
      points[i] * width,
      points[i + 1] * height,
    );
  context.stroke();
}
