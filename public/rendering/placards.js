import { readPlacard } from '../../shared/placards.js';

// Authored paths in a fixed 320 × 448 frame. One clipped fill keeps every preset cheap:
// the same single canvas texture and plane used by the original player marker.
const SHAPES = {
  masculine:
    'M118 165 C75 174 37 186 30 229 L17 348 Q15 377 42 377 L278 377 Q305 377 303 348 L290 229 C283 186 245 174 202 165 C224 151 236 133 236 109 C236 67 202 33 160 33 C118 33 84 67 84 109 C84 133 96 151 118 165 Z',
  feminine:
    'M118 165 C79 175 53 194 51 226 L66 277 L33 370 Q160 400 287 370 L254 277 L269 226 C267 194 241 175 202 165 C252 145 249 54 215 26 C191 3 130 3 105 26 C69 57 67 145 118 165 Z',
  shepherd:
    'M88 130 L65 18 Q112 20 132 54 Q160 45 188 54 Q208 20 255 18 L232 130 Q241 163 211 190 L241 228 L257 324 Q282 297 296 260 Q318 319 280 362 L265 377 L55 377 Q27 357 40 328 L77 223 L110 190 Q79 165 88 130 Z',
  retriever:
    'M105 51 Q160 17 215 51 Q263 34 279 83 L293 167 Q289 204 256 191 L228 132 Q223 169 204 190 L245 243 L265 335 Q284 328 296 306 Q313 353 275 377 L45 377 Q15 354 34 333 L76 239 L116 191 Q95 169 92 132 L64 191 Q31 204 27 167 L41 83 Q57 34 105 51 Z',
  shorthair:
    'M91 126 L85 24 L136 56 Q160 51 184 56 L235 24 L229 126 Q233 168 204 190 L232 250 L235 336 Q284 339 282 294 C276 260 285 230 304 224 Q291 260 303 286 Q328 359 258 377 L61 377 Q41 359 56 339 L80 250 L116 190 Q87 167 91 126 Z',
  fluffy:
    'M78 126 L75 25 L128 53 Q160 45 192 53 L245 25 L242 126 L266 160 L243 160 L256 190 L223 189 L240 225 L224 222 L251 260 L236 270 L253 336 Q283 299 270 269 Q261 239 279 215 C302 227 300 251 310 278 Q336 344 275 379 L46 379 L54 352 L33 344 L54 305 L43 296 L69 257 L54 251 L83 219 L70 213 L97 189 L64 190 L77 160 L54 160 Z',
  frog: 'M73 96 C39 42 74 8 109 26 Q133 33 139 57 L181 57 Q187 33 211 26 C246 8 281 42 247 96 Q271 133 240 178 L216 199 Q250 214 262 252 C314 240 320 288 291 315 L252 338 L281 350 L298 341 L307 355 L288 368 L306 378 L295 390 L238 377 L82 377 L25 390 L14 378 L32 368 L13 355 L22 341 L39 350 L68 338 L29 315 C0 288 6 240 58 252 Q70 214 104 199 L80 178 Q49 133 73 96 Z',
  gecko:
    'M109 49 Q160 17 211 49 L237 103 Q247 138 210 176 L200 204 L245 191 L261 144 L252 122 L265 117 L277 138 L287 120 L299 127 L288 153 L278 209 L215 244 L211 277 L264 293 L284 272 L296 281 L283 299 L306 300 L306 313 L277 320 L215 306 L200 330 C250 347 277 374 244 390 Q190 420 145 364 L122 327 L102 304 L43 320 L14 313 L14 300 L37 299 L24 281 L36 272 L56 293 L109 277 L105 244 L42 209 L32 153 L21 127 L33 120 L43 138 L55 117 L68 122 L59 144 L75 191 L120 204 L110 176 Q73 138 83 103 Z',
};
function star(ctx, x, y, radius) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 ? radius * 0.43 : radius;
    if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
export function drawPlacard(ctx, player, image = null) {
  const style = readPlacard(player.placard);
  const outline = new Path2D(SHAPES[style.shape]);
  ctx.clearRect(0, 0, 320, 448);
  ctx.save();
  ctx.clip(outline);
  ctx.fillStyle = style.color;
  ctx.fillRect(0, 0, 320, 448);
  ctx.fillStyle = style.accent;
  if (style.pattern === 'gradient') {
    const gradient = ctx.createLinearGradient(40, 30, 270, 380);
    gradient.addColorStop(0, style.color);
    gradient.addColorStop(1, style.accent);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 320, 448);
  } else if (style.pattern === 'stripes') {
    ctx.rotate(-Math.PI / 5);
    for (let y = -320; y < 650; y += 38) ctx.fillRect(-400, y, 1000, 15);
  } else if (style.pattern === 'checker') {
    for (let y = 0; y < 448; y += 28)
      for (let x = 0; x < 320; x += 28) if ((x / 28 + y / 28) % 2) ctx.fillRect(x, y, 28, 28);
  } else if (style.pattern !== 'solid') {
    for (let y = 18; y < 448; y += 42)
      for (let x = 16 + (Math.floor(y / 42) % 2) * 21; x < 320; x += 42) {
        if (style.pattern === 'stars') star(ctx, x, y, 12);
        else {
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
  }
  ctx.restore();
  ctx.strokeStyle = player.color || '#c9a25a';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.stroke(outline);
  // Identical face/name bounds preserve readable identity across all silhouettes.
  ctx.save();
  ctx.beginPath();
  ctx.arc(160, 109, 60, 0, Math.PI * 2);
  ctx.clip();
  if (image) ctx.drawImage(image, 100, 49, 120, 120);
  else {
    ctx.fillStyle = '#b9c8d4';
    ctx.fillRect(100, 49, 120, 120);
    ctx.fillStyle = '#607789';
    ctx.beginPath();
    ctx.arc(160, 96, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(160, 158, 44, 36, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(160, 109, 60, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(10, 351, 300, 84, 18);
  ctx.fillStyle = '#141c25';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#f4f1ea';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 32px system-ui, sans-serif';
  ctx.fillText(player.name || 'Player', 160, 393, 274);
  if (player.showing > 0) {
    ctx.beginPath();
    ctx.roundRect(65, 286, 190, 38, 19);
    ctx.fillStyle = player.color || '#c9a25a';
    ctx.fill();
    ctx.fillStyle = '#14181d';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('SHOWING ' + player.showing, 160, 306);
  }
}
