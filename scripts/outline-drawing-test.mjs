#!/usr/bin/env node
// CHROME_BIN=/path/to/chromium node scripts/outline-drawing-test.mjs
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { launch, newPage, serveDir } from './lib/headless.mjs';
const root = resolve(import.meta.dirname, '..');
const server = await serveDir({
  root: resolve(root, 'public'),
  stubOnly: ['/client.js'],
  mounts: { '/shared/': resolve(root, 'shared') },
});
let cdp;
try {
  cdp = await launch({ webgl: true });
  for (const width of [1440, 390]) {
    const page = await newPage(cdp, {
      url: server.origin + '/table.html',
      width,
      height: 900,
      settle: 500,
    });
    await page.evaluate(`(async()=>{
      document.getElementById('tableLoading').remove();
      const {openColliderEditor}=await import('/compound-collider-editor.js');
      window.result=openColliderEditor({source:'/models/pieces/chess/rook.glb',box:[.5,.5,.5]});
      for(let i=0;i<200;i++){if(!document.querySelector('[data-action="apply"]').disabled)break;await new Promise(r=>setTimeout(r,25));}
      document.querySelector('[data-action="draw"]').click();
    })()`);
    const rect = await page.evaluate(
      `(()=>{const r=document.querySelector('.compoundViewport canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`,
    );
    const scale = rect.height / (5 * Math.tan(Math.PI / 9));
    const screen = ([x, z]) => ({
      x: rect.x + rect.width / 2 + x * scale,
      y: rect.y + rect.height / 2 + z * scale,
    });
    const click = async (point) => {
      for (const type of ['mousePressed', 'mouseReleased'])
        await cdp.send(
          'Input.dispatchMouseEvent',
          { type, ...screen(point), button: 'left', clickCount: 1 },
          page.sessionId,
        );
    };
    const points = [
      [-0.5, 0.5],
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [0.25, 0.5],
      [0.25, -0.25],
      [-0.25, -0.25],
      [-0.25, 0.5],
    ];
    for (const p of points) await click(p);
    await click(points[0]);
    const status = await page.evaluate(
      `document.querySelector('[data-draw="status"]').textContent`,
    );
    assert.match(status, /8 points · 3 convex parts/);
    assert.equal(
      await page.evaluate(`document.querySelector('[data-action="apply"]').disabled`),
      true,
    );
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
    await writeFile(`/tmp/outline-drawing-${width}.png`, Buffer.from(shot.data, 'base64'));
    await page.evaluate(`document.querySelector('[data-draw="finish"]').click()`);
    assert.match(
      await page.evaluate(`document.querySelector('[data-field="count"]').textContent`),
      /4 \/ 16 physics parts/,
    );
    await page.evaluate(`document.querySelector('[data-action="draw-edit"]').click()`);
    // Drag a corner, undo that point edit, then cancel: no draft change.
    const start = screen(points[1]);
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', ...start, button: 'left', clickCount: 1 },
      page.sessionId,
    );
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: start.x + 8, y: start.y + 8, buttons: 1 },
      page.sessionId,
    );
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: start.x + 8, y: start.y + 8, button: 'left', clickCount: 1 },
      page.sessionId,
    );
    await page.evaluate(
      `document.querySelector('[data-draw="undo"]').click();document.querySelector('[data-draw="cancel"]').click();`,
    );
    // Front/side plane drawing, snapping, and cancellation leave the committed arch intact.
    for (const plane of ['front', 'side']) {
      await page.evaluate(
        `(()=>{document.querySelector('[data-action="draw"]').click();const p=document.querySelector('[data-draw="plane"]');p.value='${plane}';p.dispatchEvent(new Event('change'));document.querySelector('[data-draw="snap"]').checked=true;})()`,
      );
      for (const point of [
        [-0.2, -0.2],
        [0.2, -0.2],
        [0.2, 0.2],
        [-0.2, 0.2],
      ])
        await click(point);
      assert.equal(
        await page.evaluate(`document.querySelector('[data-draw="finish"]').disabled`),
        false,
      );
      await page.evaluate(`document.querySelector('[data-draw="finish"]').click()`);
      await page.evaluate(`document.querySelector('[data-action="undo"]').click()`);
    }
    await page.evaluate(`document.querySelector('[data-action="apply"]').click()`);
    const result = await page.evaluate('window.result');
    assert.equal(result.shapes.length, 2);
    assert.equal(result.shapes[1].outline.points.length, 8);
    for (let i = 0; i < points.length; i++)
      for (let j = 0; j < 2; j++)
        assert.ok(Math.abs(result.shapes[1].outline.points[i][j] - points[i][j]) < 0.015);
    assert.deepEqual(page.errors, []);
    console.log(
      `PASS viewport outline at ${width}px: concavity, point editing, planes, snapping, undo/cancel`,
    );
    await page.close();
  }
} finally {
  if (cdp) await cdp.close();
  await server.close();
}
