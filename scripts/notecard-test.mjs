import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { serveDir, launch, newPage } from './lib/headless.mjs';

const server = await serveDir({
  root: resolve('public'),
  mounts: { '/shared/': resolve('shared') },
  stubOnly: ['/client.js', '/editor/editor-panel.js'],
});
const browser = await launch();
try {
  for (const device of [
    { width: 1280, height: 900 },
    { width: 390, height: 844, touch: true },
    { width: 360, height: 780, touch: true },
  ]) {
    const page = await newPage(browser, { url: server.origin + '/table.html', ...device });
    await page.evaluate(`(async () => {
      const { createNotecardEditor } = await import('/table/notecards.js');
      const messages = new Map();
      window.noteTest = { sent: [], messages, allowed: true, leave: null };
      const room = {
        sessionId: 'me',
        state: { players: new Map([['me',{name:'Me',participation:'player'}],['bob',{name:'Bob',participation:'player'}]]), pieces: new Map([['one', { type:'notecard', props:JSON.stringify({faceDown:true}) }]]) },
        send(type, payload) { noteTest.sent.push({type, payload:structuredClone(payload)}); },
        onMessage(type, fn) { messages.set(type, fn); },
        onLeave(fn) { noteTest.leave = fn; },
        onStateChange(fn) { noteTest.stateChanged = fn; },
      };
      noteTest.room = room;
      noteTest.editor = createNotecardEditor({ getRoom:()=>room, byId:(id)=>document.getElementById(id),
        canInteract:()=>noteTest.allowed, beforeOpen(){}, toast(){}, repeat:()=>1, stopRepeat(){} });
      noteTest.editor.bindRoom(room);
      noteTest.editor.open('one');
      messages.get('notecardEdit')({id:'one',token:'first',drawing:[]});
    })()`);
    const rect = await page.evaluate(`(() => {
      const dialog = document.getElementById('notecardDialog'), canvas = document.getElementById('notecardCanvas');
      const r = canvas.getBoundingClientRect(), d=dialog.getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height,dialogWidth:d.width,open:dialog.open,overflow:dialog.scrollWidth>dialog.clientWidth};
    })()`);
    assert.equal(rect.open, true);
    assert.equal(rect.overflow, false);
    assert.ok(rect.dialogWidth <= device.width);
    const x = rect.x + rect.w * 0.15,
      y = rect.y + rect.h * 0.4;
    const x2 = rect.x + rect.w * 0.75,
      y2 = rect.y + rect.h * 0.6;
    const pointer = async (type, px, py) => {
      if (device.touch) {
        await browser.send(
          'Input.dispatchTouchEvent',
          { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py, id: 1 }] },
          page.sessionId,
        );
      } else
        await browser.send(
          'Input.dispatchMouseEvent',
          {
            type,
            x: px,
            y: py,
            // Keep the held button consistent throughout a CDP drag. A move with
            // button:'none' can drop capture and cancel the stroke in Chromium.
            button: 'left',
            buttons: type === 'mouseReleased' ? 0 : 1,
            clickCount: type === 'mouseMoved' ? 0 : 1,
          },
          page.sessionId,
        );
    };
    await pointer(device.touch ? 'touchStart' : 'mousePressed', x, y);
    for (let i = 1; i <= 6; i++)
      await pointer(
        device.touch ? 'touchMove' : 'mouseMoved',
        x + ((x2 - x) * i) / 6,
        y + ((y2 - y) * i) / 6,
      );
    await pointer(device.touch ? 'touchEnd' : 'mouseReleased', x2, y2);
    assert.equal(
      await page.evaluate(`document.querySelectorAll('#notecardDialog .ico-missing').length`),
      0,
    );
    assert.equal(
      await page.evaluate(
        `[...document.querySelectorAll('#notecardDialog button[data-icon]')].every(b=>b.getAttribute('aria-label') && b.title)`,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(`document.getElementById('notecardUndo').disabled`),
      false,
      `initial ${device.touch ? 'touch' : 'mouse'} stroke committed at ${device.width}px`,
    );
    // Pinching or panning must never add an accidental stroke.
    if (device.touch) {
      const fingers = (left, right) => [
        { x: rect.x + rect.w * left, y: rect.y + rect.h * 0.5, id: 1 },
        { x: rect.x + rect.w * right, y: rect.y + rect.h * 0.5, id: 2 },
      ];
      await browser.send(
        'Input.dispatchTouchEvent',
        { type: 'touchStart', touchPoints: fingers(0.35, 0.65) },
        page.sessionId,
      );
      await browser.send(
        'Input.dispatchTouchEvent',
        { type: 'touchMove', touchPoints: fingers(0.2, 0.8) },
        page.sessionId,
      );
      await browser.send(
        'Input.dispatchTouchEvent',
        { type: 'touchEnd', touchPoints: [] },
        page.sessionId,
      );
    } else {
      await browser.send(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseWheel',
          x: rect.x + rect.w * 0.5,
          y: rect.y + rect.h * 0.5,
          deltaX: 0,
          deltaY: -150,
        },
        page.sessionId,
      );
      await page.evaluate(`document.getElementById('notecardPan').click()`);
      await pointer('mousePressed', x, y);
      await pointer('mouseMoved', x + rect.w * 0.1, y);
      await pointer('mouseReleased', x + rect.w * 0.1, y);
      await page.evaluate(`document.getElementById('notecardPen').click()`);
    }
    assert.ok(
      parseInt(await page.evaluate(`document.getElementById('notecardZoomLevel').textContent`)) >
        100,
    );
    await page.evaluate(
      `document.getElementById('notecardFit').click(); document.getElementById('notecardZoomIn').click()`,
    );
    await pointer(
      device.touch ? 'touchStart' : 'mousePressed',
      rect.x + rect.w * 0.25,
      rect.y + rect.h * 0.5,
    );
    await pointer(
      device.touch ? 'touchMove' : 'mouseMoved',
      rect.x + rect.w * 0.75,
      rect.y + rect.h * 0.5,
    );
    await pointer(
      device.touch ? 'touchEnd' : 'mouseReleased',
      rect.x + rect.w * 0.75,
      rect.y + rect.h * 0.5,
    );
    assert.equal(await page.evaluate(`document.getElementById('notecardUndo').disabled`), false);
    await page.evaluate(`document.getElementById('notecardUndo').click()`);
    assert.equal(await page.evaluate(`document.getElementById('notecardRedo').disabled`), false);
    await page.evaluate(
      `document.getElementById('notecardRedo').click(); document.getElementById('notecardClear').click(); document.getElementById('notecardUndo').click(); document.getElementById('notecardPlaceDown').click()`,
    );
    let sent = await page.evaluate(`noteTest.sent.at(-1)`);
    assert.equal(sent.type, 'notecardCommit');
    assert.equal(sent.payload.faceDown, true);
    assert.equal(
      sent.payload.drawing.length,
      2,
      'exactly two authored strokes remain after view gestures',
    );
    assert.ok(
      Math.abs(sent.payload.drawing[1].pts[0] - 0.3) < 0.015,
      'zoomed ink uses paper coordinates',
    );
    assert.ok(sent.payload.drawing[0].pts.length >= 4);
    assert.equal(await page.evaluate(`document.getElementById('notecardDialog').open`), true);
    await page.evaluate(
      `noteTest.messages.get('serverError')({operation:'notecardCommit',message:'Try again'});`,
    );
    assert.equal(await page.evaluate(`document.getElementById('notecardPlaceUp').disabled`), false);
    await page.evaluate(`document.getElementById('notecardPlaceUp').click()`);
    sent = await page.evaluate(`noteTest.sent.at(-1)`);
    assert.equal(sent.payload.faceDown, false);
    assert.ok(sent.payload.drawing[0].pts.length >= 4, 'rejected save preserves draft');
    await page.evaluate(
      `noteTest.messages.get('notecardClosed')({id:'one',token:'first',reason:''});`,
    );
    assert.equal(await page.evaluate(`document.getElementById('notecardDialog').open`), false);
    // Delayed replies after closing cannot silently claim/reopen the card.
    await page.evaluate(
      `noteTest.messages.get('notecardEdit')({id:'one',token:'stale',drawing:[]});`,
    );
    assert.equal((await page.evaluate(`noteTest.sent.at(-1)`)).type, 'notecardCancel');
    await page.evaluate(`noteTest.allowed=false; noteTest.editor.open('one');`);
    assert.equal(await page.evaluate(`document.getElementById('notecardTools').hidden`), true);
    assert.equal(
      await page.evaluate(`document.getElementById('notecardStatus').textContent`),
      'This notecard is face-down.',
    );
    await page.evaluate(
      `noteTest.room.state.pieces.get('one').props = JSON.stringify({faceDown:false,drawing:[]}); noteTest.stateChanged()`,
    );
    assert.equal(
      await page.evaluate(`document.getElementById('notecardStatus').textContent`),
      'Viewing a notecard.',
    );
    await page.evaluate(`noteTest.editor.cancel(); noteTest.allowed=true; noteTest.editor.open('one');
      noteTest.messages.get('notecardEdit')({id:'one',token:'second',drawing:[{pts:[.1,.2,.2,.6,.4,.25,.6,.7,.8,.3],color:'#2878ba',width:.007,erase:false}]});`);
    await page.evaluate(
      `noteTest.editor.cancel(); noteTest.editor.openHand({hid:'h1',kind:'notecard',drawing:[]});`,
    );
    assert.deepEqual(await page.evaluate(`noteTest.sent.at(-1)`), {
      type: 'notecardEdit',
      payload: { hid: 'h1' },
    });
    await page.evaluate(`noteTest.messages.get('notecardEdit')({id:'hand:h1',hid:'h1',token:'hand-token',drawing:[]});
      document.getElementById('notecardKeep').click();`);
    assert.equal((await page.evaluate(`noteTest.sent.at(-1)`)).payload.destination, 'hand');
    await page.evaluate(`noteTest.messages.get('serverError')({operation:'notecardCommit',message:'Retry'});
      document.getElementById('notecardRecipient').value='bob'; document.getElementById('notecardRecipient').dispatchEvent(new Event('change'));
      document.getElementById('notecardPass').click();`);
    const pass = await page.evaluate(`noteTest.sent.at(-1)`);
    assert.equal(pass.payload.destination, 'pass');
    assert.equal(pass.payload.recipient, 'bob');
    await page.evaluate(`noteTest.messages.get('notecardClosed')({token:'hand-token'});
      noteTest.editor.open('one'); noteTest.messages.get('notecardEdit')({id:'one',token:'screenshot',drawing:[{pts:[.1,.2,.2,.6,.4,.25,.6,.7,.8,.3],color:'#2878ba',width:.007,erase:false}]});`);
    for (const full of [true, false]) {
      await page.evaluate(`document.body.classList.toggle('ui-full', ${full})`);
      assert.equal(
        await page.evaluate(
          `document.getElementById('notecardDialog').scrollWidth > document.getElementById('notecardDialog').clientWidth`,
        ),
        false,
      );
    }
    const screenshot = await browser.send(
      'Page.captureScreenshot',
      { format: 'png' },
      page.sessionId,
    );
    await writeFile(
      `/tmp/ott-notecard-${device.touch ? 'touch' : 'desktop'}.png`,
      Buffer.from(screenshot.data, 'base64'),
    );
    await page.evaluate(`noteTest.leave()`);
    assert.equal(await page.evaluate(`document.getElementById('notecardDialog').open`), false);
    // Use the production editor, stack mesh, live type-change binding and context menu.
    await page.evaluate(`(async () => {
      const stack = { type:'notecardStack', count:8, props:JSON.stringify({faceDown:true}) };
      noteTest.room.state.pieces.set('stack', stack);
      noteTest.editor.open('stack');
      noteTest.messages.get('notecardEdit')({id:'stack',token:'stack-edit',drawing:[],fromStack:true});
    })()`);
    assert.equal(await page.evaluate(`document.getElementById('notecardReturn').hidden`), false);
    assert.equal(
      await page.evaluate(`document.getElementById('notecardReturn').getAttribute('aria-label')`),
      'Return to top',
    );
    const stackLayout = await page.evaluate(`(() => {
      const d=document.getElementById('notecardDialog');
      return { overflow:d.scrollWidth>d.clientWidth, missing:d.querySelectorAll('.ico-missing').length };
    })()`);
    assert.deepEqual(stackLayout, { overflow: false, missing: 0 });
    await writeFile(
      `/tmp/notecard-stack-editor-${device.width}.png`,
      Buffer.from(
        (await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)).data,
        'base64',
      ),
    );
    await page.evaluate(`document.getElementById('notecardReturn').click()`);
    assert.equal(await page.evaluate(`noteTest.sent.at(-1).payload.destination`), 'stack');
    await page.evaluate(`noteTest.messages.get('notecardClosed')({id:'stack',token:'stack-edit'})`);
    await page.evaluate(`(async () => {
      const THREE = await import('three');
      const { notecardStackMesh, notecardMesh } = await import('/rendering/notecards.js');
      const { disposeHierarchy } = await import('/rendering/resources.js');
      const { createPieceView } = await import('/table/piece-view.js');
      const { createPieceUi } = await import('/table/piece-ui.js');
      const scene = new THREE.Scene(), meshes = new Map(), listeners = new Map();
      const piece = { type:'notecard',count:0,props:'{}', x:0,y:0,z:0,qx:0,qy:0,qz:0,qw:1 };
      const kind = { notecard:{mesh:notecardMesh,dispose:disposeHierarchy,grab:0}, notecardStack:{mesh:notecardStackMesh,dispose:disposeHierarchy,grab:0} };
      const view = createPieceView({ scene,meshes,buffers:new Map(),kinds:kind,physics:{notecard:{mass:0.18},notecardStack:{mass:0.18}},deckHeight:()=>1,createQuaternion:()=>new THREE.Quaternion(),refreshCollider(){},isInspected:()=>false });
      view.bindRoom(noteTest.room, (target)=>target===noteTest.room.state ? { pieces:{onAdd(fn){fn(piece,'converted');},onRemove(){}} } : {listen(key,fn){listeners.set(key,fn);}}, {onHydration(){},onOwner(){},onBoardTop(){},onRemove(){},disposeSurface(){}});
      piece.type='notecardStack'; piece.count=4; piece.props=JSON.stringify({faceDown:true});
      listeners.get('type')();
      noteTest.convertedType=meshes.get('converted').type;
      noteTest.meshHeight=meshes.get('converted').mesh.geometry.parameters.height;
      piece.count=2; listeners.get('count')();
      noteTest.resizedHeight=meshes.get('converted').mesh.geometry.parameters.height;
      disposeHierarchy(meshes.get('converted').mesh);
      meshes.set('stack',{type:'notecardStack'});
      const canvas=document.getElementById('notecardCanvas');
      noteTest.ui=createPieceUi({byId:id=>document.getElementById(id),canvas,meshes,kinds:kind,getRoom:()=>noteTest.room,
        pieceDrag:{current:()=>null,isActive:()=>false,armMove(id){noteTest.move=id;},beginMoveFromMenu(){return false;}},
        hand:{isDragging:()=>false},inspection:{isActive:()=>false,isInspectable:()=>true,enterInspect:id=>noteTest.editor.open(id)},selection:{size:0},overlays:{isMeasuring:()=>false,isMoving:()=>false,isDraggingMeasure:()=>false},whiteboard:{isOwning:()=>false},
        setPointer(){},pickId(){},isSheet:()=>false,openRadial(){},highlightPiece(){},getRank:()=>0,editLabels(){},browseDeck(){} });
      document.getElementById('tableLoading')?.remove(); noteTest.ui.openPieceMenu('stack',{x:20,y:20});
    })()`);
    assert.equal(await page.evaluate(`noteTest.convertedType`), 'notecardStack');
    assert.equal(await page.evaluate(`noteTest.meshHeight`), 0.4);
    assert.equal(await page.evaluate(`noteTest.resizedHeight`), 0.2);
    const menu = await page.evaluate(`(() => {
      const el=document.getElementById('pieceMenu'), buttons=[...el.querySelectorAll('button')];
      return {labels:buttons.slice(0,6).map(b=>b.getAttribute('aria-label')),icons:buttons.slice(0,6).map(b=>b.dataset.icon),missing:el.querySelectorAll('.ico-missing').length,
        focused:document.activeElement===buttons[0],overflow:el.scrollWidth>el.clientWidth};
    })()`);
    assert.deepEqual(menu.labels, [
      'Draw to hand',
      'Draw & edit',
      'Play top face-down',
      'Shuffle',
      'Split',
      'Move stack',
    ]);
    assert.deepEqual(menu.icons, [
      'cards',
      'writing',
      'arrow-bar-down',
      'arrows-shuffle',
      'arrows-maximize',
      'hand-move',
    ]);
    assert.equal(menu.missing, 0);
    assert.equal(menu.focused, true);
    assert.equal(menu.overflow, false);
    await writeFile(
      `/tmp/notecard-stack-menu-${device.width}.png`,
      Buffer.from(
        (await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)).data,
        'base64',
      ),
    );
    await browser.send(
      'Input.dispatchKeyEvent',
      { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      page.sessionId,
    );
    await browser.send(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      page.sessionId,
    );
    assert.equal(
      await page.evaluate(`document.activeElement.getAttribute('aria-label')`),
      'Draw & edit',
    );
    await page.evaluate(`document.querySelectorAll('#pieceMenu button')[2].click()`);
    assert.deepEqual(await page.evaluate(`noteTest.sent.at(-1)`), {
      type: 'notecardDraw',
      payload: { id: 'stack', destination: 'table' },
    });
    await page.evaluate(
      `noteTest.ui.openPieceMenu('stack',{x:20,y:20});document.querySelectorAll('#pieceMenu button')[0].click()`,
    );
    assert.equal(await page.evaluate(`noteTest.sent.at(-1).payload.destination`), 'hand');
    assert.deepEqual(page.errors, []);
    await page.close();
    console.log(`Notecard editor: ${device.width}px ${device.touch ? 'touch' : 'mouse'} passed`);
  }
} finally {
  await browser.close();
  await server.close();
}
