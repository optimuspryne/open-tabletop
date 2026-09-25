import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Uses the production editor/renderer within the parent notecard browser fixture.
export async function verifyNotecardText({ page, browser, device, pointer, key }) {
  await page.evaluate(`noteTest.editor.cancel();noteTest.editor.open('one');
    noteTest.messages.get('notecardEdit')({id:'one',token:'text-test',drawing:[{pts:[.1,.8,.8,.8],color:'#2878ba',width:.007,erase:false}]});
    document.getElementById('notecardText').click();document.getElementById('notecardTextAdd').click();`);
  assert.equal(await page.evaluate(`document.activeElement.id`), 'notecardTextContent');
  await browser.send('Input.insertText', { text: 'A clue\nFind the compass.' }, page.sessionId);
  await page.evaluate(`for(const [id,value]of [['notecardTextSize','0.03'],['notecardTextAlign','center'],['notecardTextColor','#2878ba']]){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change'));}
    document.querySelector('.notecard-text-box').focus();`);
  await key('ArrowRight', 'ArrowRight', 39);
  await key('ArrowRight', 'ArrowRight', 39, 8);
  const label = await page.evaluate(
    `document.querySelector('.notecard-text-box').getAttribute('aria-label')`,
  );
  assert.match(label, /A clue/);
  // Scroll the small-screen dialog so the actual pointer gesture reaches the paper.
  await page.evaluate(`document.getElementById('notecardCanvas').scrollIntoView({block:'center'})`);
  const r = await page.evaluate(
    `(()=>{const r=document.getElementById('notecardCanvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`,
  );
  await pointer(device.touch ? 'touchStart' : 'mousePressed', r.x + r.w * 0.3, r.y + r.h * 0.16);
  await pointer(device.touch ? 'touchMove' : 'mouseMoved', r.x + r.w * 0.4, r.y + r.h * 0.26);
  await pointer(device.touch ? 'touchEnd' : 'mouseReleased', r.x + r.w * 0.4, r.y + r.h * 0.26);
  await page.evaluate(`document.getElementById('notecardKeep').click()`);
  const saved = await page.evaluate(`noteTest.sent.at(-1).payload`);
  assert.equal(saved.destination, 'hand');
  assert.equal(saved.textBoxes[0].text, 'A clue\nFind the compass.');
  assert.equal(saved.textBoxes[0].align, 'center');
  assert.equal(saved.textBoxes[0].color, '#2878ba');
  assert.ok(
    Math.abs(saved.textBoxes[0].x - 0.21) < 0.01,
    'pointer drag moves text in paper coordinates',
  );
  assert.ok(Math.abs(saved.textBoxes[0].w - 0.71) < 0.002, 'Shift arrow resizes width');
  assert.equal(saved.drawing.length, 1, 'text gestures do not create ink');
  await page.evaluate(
    `noteTest.messages.get('serverError')({operation:'notecardCommit',message:'Retry'});document.getElementById('notecardUndo').click();document.getElementById('notecardKeep').click()`,
  );
  assert.ok(
    Math.abs((await page.evaluate(`noteTest.sent.at(-1).payload.textBoxes[0].x`)) - 0.11) < 0.002,
    'one Undo reverts the entire move',
  );
  await page.evaluate(
    `noteTest.messages.get('serverError')({operation:'notecardCommit',message:'Retry'});document.getElementById('notecardRedo').click();document.getElementById('notecardClear').click();document.getElementById('notecardKeep').click()`,
  );
  let result = await page.evaluate(`noteTest.sent.at(-1).payload`);
  assert.deepEqual(result.textBoxes, saved.textBoxes);
  assert.deepEqual(result.drawing, []);
  await page.evaluate(
    `noteTest.messages.get('serverError')({operation:'notecardCommit',message:'Retry'});document.getElementById('notecardUndo').click();document.getElementById('notecardTextDelete').click();document.getElementById('notecardUndo').click();document.getElementById('notecardKeep').click()`,
  );
  result = await page.evaluate(`noteTest.sent.at(-1).payload`);
  assert.deepEqual(result.textBoxes, saved.textBoxes);
  assert.deepEqual(result.drawing, saved.drawing, 'shared history restores ink and text');
  // Resume the committed document, edit a second time, and undo one typing session.
  await page.evaluate(`noteTest.messages.get('notecardClosed')({token:'text-test'});noteTest.editor.open('one');noteTest.messages.get('notecardEdit')({...${JSON.stringify(saved)},token:'reopened'});
    document.getElementById('notecardTextContent').focus();document.getElementById('notecardTextContent').select();`);
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTextContent').value`),
    'A clue\nFind the compass.',
  );
  // Resize the actual handle while zoomed; Undo must restore the saved paper-space width.
  await page.evaluate(
    `document.getElementById('notecardZoomIn').click();document.querySelector('.notecard-text-resize').scrollIntoView({block:'center'})`,
  );
  const handle = await page.evaluate(
    `(()=>{const r=document.querySelector('.notecard-text-resize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await pointer(device.touch ? 'touchStart' : 'mousePressed', handle.x, handle.y);
  await pointer(device.touch ? 'touchMove' : 'mouseMoved', handle.x - 20, handle.y);
  await pointer(device.touch ? 'touchEnd' : 'mouseReleased', handle.x - 20, handle.y);
  await page.evaluate(`document.getElementById('notecardKeep').click()`);
  assert.ok(
    await page.evaluate(`noteTest.sent.at(-1).payload.textBoxes[0].w < ${saved.textBoxes[0].w}`),
    'drag handle resizes text at non-default zoom',
  );
  await page.evaluate(
    `noteTest.messages.get('serverError')({operation:'notecardCommit',message:'Retry'});document.getElementById('notecardUndo').click();document.getElementById('notecardFit').click();document.getElementById('notecardTextContent').focus();document.getElementById('notecardTextContent').select();`,
  );
  await browser.send('Input.insertText', { text: 'Replacement' }, page.sessionId);
  await page.evaluate(`document.getElementById('notecardUndo').click()`);
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTextContent').value`),
    'A clue\nFind the compass.',
  );
  // Overflow stays editable and blocks saving rather than silently dropping lines.
  await page.evaluate(
    `const text=document.getElementById('notecardTextContent');text.focus();text.value='line\\n'.repeat(80);text.dispatchEvent(new Event('input'));`,
  );
  assert.equal(await page.evaluate(`document.getElementById('notecardKeep').disabled`), true);
  assert.match(
    await page.evaluate(`document.getElementById('notecardTextError').textContent`),
    /past the card/,
  );
  await page.evaluate(`document.getElementById('notecardPen').click()`);
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTextError').hidden`),
    false,
    'overflow warning remains visible outside Text tool',
  );
  await page.evaluate(
    `document.getElementById('notecardUndo').click();document.getElementById('notecardText').click();`,
  );
  assert.equal(await page.evaluate(`document.getElementById('notecardKeep').disabled`), false);
  // A two-finger view gesture cancels a text move, just as it cancels pending ink.
  if (device.touch) {
    await page.evaluate(
      `document.getElementById('notecardCanvas').scrollIntoView({block:'center'})`,
    );
    const rect = await page.evaluate(
      `(()=>{const r=document.getElementById('notecardCanvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`,
    );
    const one = { x: rect.x + rect.w * 0.35, y: rect.y + rect.h * 0.24, id: 1 },
      two = { x: rect.x + rect.w * 0.65, y: rect.y + rect.h * 0.3, id: 2 };
    for (const [type, touchPoints] of [
      ['touchStart', [one]],
      ['touchMove', [{ ...one, x: one.x + 10 }]],
      ['touchStart', [{ ...one, x: one.x + 10 }, two]],
      ['touchMove', [one, { ...two, x: two.x + 20 }]],
      ['touchEnd', []],
    ])
      await browser.send('Input.dispatchTouchEvent', { type, touchPoints }, page.sessionId);
    await page.evaluate(`document.getElementById('notecardKeep').click()`);
    assert.deepEqual(
      await page.evaluate(`noteTest.sent.at(-1).payload.textBoxes`),
      saved.textBoxes,
      'pinch rolls back tentative text movement',
    );
    await page.evaluate(
      `noteTest.messages.get('serverError')({operation:'notecardCommit',message:'Retry'});document.getElementById('notecardFit').click()`,
    );
  }
  // Literal markup stays text. Back rendering never reveals it, and erasing cannot affect it.
  const pixels = await page.evaluate(`(async()=>{
    const {paintNotecard}=await import('/rendering/notecards.js');const {notecardPreviewURL}=await import('/rendering/graphics.js');
    const c=document.createElement('canvas');c.width=320;c.height=213;const ctx=c.getContext('2d');
    const textBoxes=[{id:1,text:'<b>Plain text 🧭</b>',x:.1,y:.1,w:.8,size:.06,color:'#202830',align:'left'}];
    const paint=(drawing,options)=>{paintNotecard(ctx,drawing,options);return c.toDataURL();};
    const blank=paint([],{}), text=paint([],{textBoxes});
    const erased=paint([{pts:[0,.15,1,.15],color:'#202830',width:.015,erase:true}],{textBoxes});
    return {visible:text!==blank,eraseKeepsText:erased===text,concealed:paint([],{back:true,textBoxes})===paint([],{back:true}),thumbnail:notecardPreviewURL([],undefined,textBoxes)!==notecardPreviewURL([])};
  })()`);
  assert.deepEqual(pixels, {
    visible: true,
    eraseKeepsText: true,
    concealed: true,
    thumbnail: true,
  });
  for (const full of [true, false]) {
    await page.evaluate(
      `document.body.classList.toggle('ui-full',${full});document.getElementById('notecardDialog').scrollTop=0`,
    );
    await page.evaluate(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    assert.equal(
      await page.evaluate(
        `document.getElementById('notecardDialog').scrollWidth>document.getElementById('notecardDialog').clientWidth`,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(`document.querySelectorAll('#notecardDialog .ico-missing').length`),
      0,
    );
    assert.equal(
      await page.evaluate(
        `getComputedStyle(document.querySelector('.notecard-text-box')).backdropFilter`,
      ),
      'none',
      'selection overlay must not blur the text beneath it',
    );
    await writeFile(
      `/tmp/notecard-text-${device.width}-${full ? 'full' : 'compact'}.png`,
      Buffer.from(
        (await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)).data,
        'base64',
      ),
    );
  }
  await page.evaluate(`for(let i=0;i<8;i++)document.getElementById('notecardTextAdd').click()`);
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTextPicker').options.length`),
    8,
  );
  assert.equal(await page.evaluate(`document.getElementById('notecardTextAdd').disabled`), true);
  await page.evaluate(`noteTest.editor.cancel();document.getElementById('notecardPen').click()`);
  assert.equal(await page.evaluate(`document.getElementById('notecardTextContent').value`), '');
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTextOverlay').children.length`),
    0,
    'closing clears private text controls',
  );
}
