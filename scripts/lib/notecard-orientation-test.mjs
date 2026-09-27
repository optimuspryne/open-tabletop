import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function verifyNotecardOrientation({ page, browser, device, key, pointer }) {
  await page.evaluate(`(() => {
    noteTest.editor.cancel();noteTest.editor.open('one');
    noteTest.messages.get('notecardEdit')({id:'one',token:'orientation',orientation:'landscape',
      drawing:[{pts:[.1,.2,.8,.8],color:'#2878ba',width:.007,erase:false}],
      textBoxes:[{id:1,text:'Meet at the old tower',x:.1,y:.1,w:.8,size:.04,color:'#202830',align:'left'}],paper:{pattern:'grid',tone:'ivory'}});
    noteTest.beforeOrientation=noteTest.editor.capture();
    document.getElementById('notecardPortrait').focus();
  })()`);
  await key(' ', 'Space', 32);
  const portrait = await page.evaluate(`noteTest.editor.capture()`);
  assert.equal(portrait.orientation, 'portrait', 'orientation button works with keyboard');
  assert.equal(portrait.drawing.length, 1);
  assert.equal(portrait.textBoxes[0].text, 'Meet at the old tower');
  assert.ok(
    Math.abs(
      ((portrait.drawing[0].pts[3] - portrait.drawing[0].pts[1]) * 1024) /
        ((portrait.drawing[0].pts[2] - portrait.drawing[0].pts[0]) * 682) -
        (0.6 * 682) / (0.7 * 1024),
    ) < 0.001,
  );
  await page.evaluate(`document.getElementById('notecardUndo').click()`);
  assert.deepEqual(
    await page.evaluate(`noteTest.editor.capture()`),
    await page.evaluate(`noteTest.beforeOrientation`),
  );
  await page.evaluate(`document.getElementById('notecardRedo').click()`);
  assert.deepEqual(await page.evaluate(`noteTest.editor.capture()`), portrait);
  await page.evaluate(`document.getElementById('notecardLandscape').click()`);
  assert.deepEqual(
    await page.evaluate(`noteTest.editor.capture()`),
    await page.evaluate(`noteTest.beforeOrientation`),
    'toggle back without edits keeps original artwork',
  );
  await page.evaluate(
    `document.getElementById('notecardPortrait').click();document.getElementById('notecardPen').click()`,
  );
  for (const full of [true, false]) {
    await page.evaluate(
      `document.body.classList.toggle('ui-full',${full});document.getElementById('notecardPortrait').focus()`,
    );
    const layout = await page.evaluate(`(() => {
      const c=document.getElementById('notecardCanvas'), d=document.getElementById('notecardDialog'),r=c.getBoundingClientRect();
      return {canvas:[c.width,c.height],ratio:r.width/r.height,overflow:d.scrollWidth>d.clientWidth,
        pressed:document.getElementById('notecardPortrait').getAttribute('aria-pressed'),
        accessible:['Landscape','Portrait'].every(n=>{const b=document.getElementById('notecard'+n);return b.getAttribute('aria-label')===n&&!!b.title&&!b.querySelector('.ico-missing');})};
    })()`);
    assert.deepEqual(layout.canvas, [682, 1024]);
    assert.ok(Math.abs(layout.ratio - 682 / 1024) < 0.002);
    assert.equal(layout.overflow, false);
    assert.equal(layout.pressed, 'true');
    assert.equal(layout.accessible, true);
    await writeFile(
      `/tmp/notecard-orientation-${device.width}-${full ? 'full' : 'compact'}.png`,
      Buffer.from(
        (await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)).data,
        'base64',
      ),
    );
  }
  // Settle the focus hint before measuring: blurring the orientation button can
  // change the help's line count and move the canvas within the centered dialog.
  await page.evaluate(
    `document.getElementById('notecardCanvas').focus();document.getElementById('notecardCanvas').scrollIntoView({block:'center'})`,
  );
  const bounds = await page.evaluate(
    `(() => {const r=document.getElementById('notecardCanvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`,
  );
  const start = [bounds.x + bounds.w * 0.2, bounds.y + bounds.h * 0.3];
  const end = [bounds.x + bounds.w * 0.6, bounds.y + bounds.h * 0.5];
  await pointer(device.touch ? 'touchStart' : 'mousePressed', ...start);
  for (let i = 1; i <= 4; i++)
    await pointer(
      device.touch ? 'touchMove' : 'mouseMoved',
      start[0] + ((end[0] - start[0]) * i) / 4,
      start[1] + ((end[1] - start[1]) * i) / 4,
    );
  await pointer(device.touch ? 'touchEnd' : 'mouseReleased', ...end);
  const ink = await page.evaluate(`noteTest.editor.capture().drawing`);
  assert.equal(ink.length, 2, 'portrait drawing commits through real pointer intents');
  assert.ok(Math.abs(ink[1].pts[0] - 0.2) < 0.01);
  assert.ok(
    Math.abs(ink[1].pts.at(-1) - 0.5) < 0.01,
    `portrait endpoint at ${device.width}px: ${JSON.stringify(ink[1].pts)}`,
  );
  // Text bounds/overlays use the same portrait geometry as the pixels and export.
  await page.evaluate(`document.getElementById('notecardText').click()`);
  assert.equal(await page.evaluate(`document.getElementById('notecardTextError').hidden`), true);
  const overlay = await page.evaluate(`(() => {
    const c=document.getElementById('notecardCanvas').getBoundingClientRect(), b=document.querySelector('.notecard-text-box').getBoundingClientRect();
    return {x:(b.x-c.x)/c.width,y:(b.y-c.y)/c.height,w:b.width/c.width};
  })()`);
  assert.ok(Math.abs(overlay.x - portrait.textBoxes[0].x) < 0.001);
  assert.ok(Math.abs(overlay.y - portrait.textBoxes[0].y) < 0.001);
  assert.ok(Math.abs(overlay.w - portrait.textBoxes[0].w) < 0.001);
  await page.evaluate(
    `document.getElementById('notecardTextAdd').click();document.getElementById('notecardTextContent').value='Portrait note';document.getElementById('notecardTextContent').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('notecardKeep').click()`,
  );
  assert.equal(await page.evaluate(`noteTest.sent.at(-1).payload.orientation`), 'portrait');
  assert.equal(await page.evaluate(`noteTest.sent.at(-1).payload.textBoxes.length`), 2);
  await page.evaluate(`noteTest.messages.get('notecardClosed')({token:'orientation'})`);
  const rendering = await page.evaluate(`(async () => {
    const {notecardMesh,notecardStackMesh}=await import('/rendering/notecards.js');
    const {notecardPreviewURL}=await import('/rendering/graphics.js');
    const {disposeHierarchy}=await import('/rendering/resources.js');
    const card=notecardMesh({orientation:'portrait',drawing:[],textBoxes:[]}),stack=notecardStackMesh({orientation:'portrait',count:3});
    const result={card:[card.geometry.parameters.width,card.geometry.parameters.depth],stack:[stack.geometry.parameters.width,stack.geometry.parameters.depth],texture:[card.material[2].map.image.width,card.material[2].map.image.height]};
    const image=new Image();image.src=notecardPreviewURL([],undefined,[],'portrait');await image.decode();result.preview=[image.naturalWidth,image.naturalHeight];
    disposeHierarchy(card);disposeHierarchy(stack);return result;
  })()`);
  assert.deepEqual(rendering.card, [3, 4.5]);
  assert.deepEqual(rendering.stack, [3, 4.5]);
  assert.deepEqual(rendering.texture, [682, 1024]);
  assert.ok(rendering.preview[0] < rendering.preview[1]);
}
