import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function verifyNotecardTemplates({ page, browser, device }) {
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await page.evaluate(expression)) return;
      await page.evaluate('new Promise(r=>setTimeout(r,20))');
    }
    throw new Error('Template UI did not settle: ' + expression);
  };
  await page.evaluate(`(async()=>{
    noteTest.editor.cancel();document.getElementById('pieceMenu').hidden=true;
    const {createNotecardTemplates}=await import('/table/notecard-templates.js');
    const content={orientation:'portrait',drawing:[],paper:{pattern:'ruled',tone:'ivory'},textBoxes:[{id:1,text:'Expedition log\\nName:\\nDestination:',x:.1,y:.1,w:.8,size:.04,color:'#202830',align:'left'}]};
    noteTest.templateRecords=[{id:'1',name:'Expedition log',content,isPublic:false,canEdit:true,ownerId:'me',ownerName:'Me',revision:1}];
    noteTest.requests=[];const realFetch=window.fetch;noteTest.restoreFetch=()=>window.fetch=realFetch;
    window.fetch=async(url,options={})=>{
      if(!String(url).startsWith('/notecard-templates'))return realFetch(url,options);
      const path=new URL(url,location.origin),method=options.method||'GET',body=options.body?JSON.parse(options.body):null,id=path.pathname.split('/')[2];
      noteTest.requests.push({url:String(url),method,body});
      if(noteTest.delayTemplate&&method==='POST')await new Promise(resolve=>{noteTest.resolveTemplate=resolve;});
      if(noteTest.conflict&&method==='PUT')return new Response(JSON.stringify({error:'This template changed. Reload it before trying again.'}),{status:409});
      let template=noteTest.templateRecords.find(t=>t.id===id);
      if(method==='GET'&&!id)return new Response(JSON.stringify({templates:noteTest.templateRecords,nextOffset:null}));
      if(method==='POST'){template={...body,id:String(noteTest.templateRecords.length+1),revision:1,canEdit:true,ownerId:'me',ownerName:'Me'};noteTest.templateRecords.push(template);}
      if(method==='PUT'||method==='PATCH'){Object.assign(template,body,{revision:template.revision+1});}
      if(method==='DELETE'){noteTest.templateRecords=noteTest.templateRecords.filter(t=>t.id!==id);return new Response(JSON.stringify({ok:true}));}
      return new Response(JSON.stringify({template}));
    };
    noteTest.templates=createNotecardTemplates({byId:id=>document.getElementById(id),editor:noteTest.editor,getRoom:()=>noteTest.room,canInteract:()=>noteTest.allowed});
    noteTest.templates.bindRoom(noteTest.room);
    noteTest.editor.open('one');noteTest.messages.get('notecardEdit')({id:'one',token:'template-save',...content});
    document.getElementById('notecardTemplateSave').click();
  })()`);
  await wait(`document.getElementById('notecardTemplateTarget').options.length===2`);
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTemplateShare').checked`),
    false,
  );
  assert.equal(await page.evaluate(`document.getElementById('notecardTemplateTarget').value`), '');
  await page.evaluate(
    `document.getElementById('notecardTemplateName').value='Mission sheet';document.getElementById('notecardTemplateConfirm').click()`,
  );
  await wait(`!noteTest.editor.templateContext().busy`);
  const saved = await page.evaluate(`noteTest.requests.find(r=>r.method==='POST').body`);
  assert.equal(saved.isPublic, false);
  assert.equal(saved.name, 'Mission sheet');
  assert.equal(saved.content.orientation, 'portrait');
  assert.equal(saved.content.textBoxes[0].text, 'Expedition log\nName:\nDestination:');
  assert.equal(
    await page.evaluate(`document.getElementById('notecardDialog').open`),
    true,
    'saving template retains private draft',
  );
  await page.evaluate(`document.getElementById('notecardTemplateSave').click()`);
  await wait(`document.getElementById('notecardTemplateTarget').value==='2'`);
  await page.evaluate(
    `document.getElementById('notecardTemplateShare').checked=true;document.getElementById('notecardTemplateConfirm').click()`,
  );
  await wait(`!noteTest.editor.templateContext().busy`);
  assert.equal(await page.evaluate(`noteTest.templateRecords[1].isPublic`), true);
  await page.evaluate(
    `noteTest.editor.cancel();document.getElementById('libraryModal').hidden=false;document.querySelector('#libraryModal [data-pane="notecard-templates"]').hidden=false;document.querySelector('#libraryModal [data-pane="dice"]').hidden=true;document.querySelectorAll('#libraryModal .libTab').forEach(t=>t.classList.toggle('on',t.dataset.tab==='notecard-templates'));`,
  );
  await wait(`document.querySelectorAll('.notecard-template-card').length===2`);
  await page.evaluate(
    `document.querySelector('.notecard-template-card button[aria-label="Create card"]').click()`,
  );
  await wait(`document.getElementById('notecardDialog').open`);
  assert.equal(
    await page.evaluate(`noteTest.editor.templateContext().template`),
    null,
    'copies default to a new private template when saved',
  );
  await page.evaluate(`document.getElementById('notecardKeep').click()`);
  const created = await page.evaluate(`noteTest.sent.at(-1)`);
  assert.equal(created.type, 'notecardCreate');
  assert.equal(created.payload.destination, 'hand');
  assert.deepEqual(created.payload.content, saved.content);
  await page.evaluate(
    `noteTest.messages.get('serverError')({operation:'notecardCreate',message:'Room is full'});`,
  );
  assert.equal(await page.evaluate(`document.getElementById('notecardDialog').open`), true);
  assert.equal(await page.evaluate(`noteTest.editor.templateContext().busy`), false);
  await page.evaluate(`document.getElementById('notecardKeep').click()`);
  assert.equal(
    await page.evaluate(`noteTest.sent.at(-1).payload.request`),
    created.payload.request,
    'retry keeps creation ID',
  );
  await page.evaluate(
    `noteTest.messages.get('notecardCreated')({request:${JSON.stringify(created.payload.request)}});document.getElementById('libraryModal').hidden=false;`,
  );
  await wait(`document.querySelectorAll('.notecard-template-card').length===2`);
  await page.evaluate(
    `document.querySelector('.notecard-template-card input[type="number"]').value='3';document.querySelector('.notecard-template-card button[aria-label="Create stack"]').click()`,
  );
  await wait(`noteTest.sent.at(-1).payload.destination==='stack'`);
  assert.equal(await page.evaluate(`noteTest.sent.at(-1).payload.count`), 3);
  await page.evaluate(
    `noteTest.messages.get('notecardCreated')({request:noteTest.sent.at(-1).payload.request});document.querySelector('.notecard-template-card button[aria-label="Manage"]').click()`,
  );
  await wait(
    `!!document.querySelector('.notecard-template-card button[aria-label="Save changes"]')`,
  );
  assert.equal(
    await page.evaluate(`(() => {
      const card=document.querySelector('.notecard-template-card');
      const form=card.querySelector('.notecard-template-form');
      const cardRect=card.getBoundingClientRect(), formRect=form.getBoundingClientRect();
      return card.scrollWidth<=card.clientWidth && formRect.left>=cardRect.left && formRect.right<=cardRect.right;
    })()`),
    true,
    'Manage form stays within its Library card',
  );
  await page.evaluate(
    `document.querySelector('.notecard-template-card .notecard-template-form input:not([type="checkbox"])').value='X'.repeat(60);document.querySelector('.notecard-template-card input[type="checkbox"]').checked=true;document.querySelector('.notecard-template-card button[aria-label="Save changes"]').click()`,
  );
  await wait(`noteTest.requests.some(r=>r.method==='PATCH')`);
  await wait(
    `!document.getElementById('notecardTemplateLibraryStatus').textContent.includes('Loading')`,
  );
  assert.equal(await page.evaluate(`noteTest.templateRecords[0].isPublic`), true);
  // Real rendered Library and save panel at full/compact desktop and touch widths.
  for (const full of [true, false]) {
    await page.evaluate(
      `document.body.classList.toggle('ui-full',${full});document.querySelector('#libraryModal .libraryBody').scrollTop=0`,
    );
    await page.evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    assert.equal(
      await page.evaluate(
        `document.getElementById('libraryModal').scrollWidth>document.getElementById('libraryModal').clientWidth`,
      ),
      false,
    );
    const layout = await page.evaluate(`(() => {
      const cards=[...document.querySelectorAll('.notecard-template-card')];
      return cards.map(card=>{
        const rect=card.getBoundingClientRect(), image=card.querySelector('img');
        return {x:rect.x,y:rect.y,overflow:card.scrollWidth>card.clientWidth,
          imageVisible:image.checkVisibility()&&image.getBoundingClientRect().width>0,
          imageWidth:image.getBoundingClientRect().width};
      });
    })()`);
    assert.ok(
      layout.every((card) => card.imageVisible && card.imageWidth <= 100 && !card.overflow),
      'small thumbnails stay visible and card contents fit in full/compact modes',
    );
    if (device.width > 600) {
      assert.equal(layout[0].y, layout[1].y, 'desktop templates occupy two columns');
      assert.ok(layout[1].x > layout[0].x);
    } else {
      assert.equal(layout[0].x, layout[1].x, 'phone templates occupy one column');
      assert.ok(layout[1].y > layout[0].y);
    }
    await writeFile(
      '/tmp/notecard-templates-library-' +
        device.width +
        '-' +
        (full ? 'full' : 'compact') +
        '.png',
      Buffer.from(
        (await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)).data,
        'base64',
      ),
    );
  }
  await page.evaluate(
    `document.querySelector('.notecard-template-card button[aria-label="Manage"]').click()`,
  );
  await wait(
    `!!document.querySelector('.notecard-template-card button[aria-label="Edit design"]')`,
  );
  await page.evaluate(
    `document.querySelector('.notecard-template-card button[aria-label="Edit design"]').click()`,
  );
  await wait(
    `document.getElementById('notecardDialog').open&&document.getElementById('notecardTemplateTarget').value==='1'`,
  );
  assert.equal(await page.evaluate(`noteTest.editor.templateContext().template.id`), '1');
  await page.evaluate(
    `noteTest.conflict=true;document.getElementById('notecardTemplateConfirm').click()`,
  );
  await wait(`!noteTest.editor.templateContext().busy`);
  assert.match(
    await page.evaluate(`document.getElementById('notecardTemplateStatus').textContent`),
    /changed/,
  );
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTemplatePanel').hidden`),
    false,
    'conflict retains draft and save fields',
  );
  for (const full of [true, false]) {
    await page.evaluate(
      `document.body.classList.toggle('ui-full',${full});document.getElementById('notecardDialog').scrollTop=0`,
    );
    await page.evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    assert.equal(
      await page.evaluate(
        `document.getElementById('notecardDialog').scrollWidth>document.getElementById('notecardDialog').clientWidth`,
      ),
      false,
    );
    await writeFile(
      '/tmp/notecard-templates-save-' + device.width + '-' + (full ? 'full' : 'compact') + '.png',
      Buffer.from(
        (await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)).data,
        'base64',
      ),
    );
  }
  // Closing/disconnecting while HTTP work is pending must not apply its result to another draft.
  await page.evaluate(
    `noteTest.conflict=false;noteTest.delayTemplate=true;document.getElementById('notecardTemplateTarget').value='';document.getElementById('notecardTemplateTarget').dispatchEvent(new Event('change'));document.getElementById('notecardTemplateName').value='Delayed';document.getElementById('notecardTemplateConfirm').click()`,
  );
  await wait(`!!noteTest.resolveTemplate`);
  await page.evaluate(
    `noteTest.editor.cancel();noteTest.editor.open('one');noteTest.messages.get('notecardEdit')({id:'one',token:'different',drawing:[]});noteTest.resolveTemplate();`,
  );
  await page.evaluate(`new Promise(r=>setTimeout(r,25))`);
  assert.equal(await page.evaluate(`noteTest.editor.templateContext().template`), null);
  assert.equal(
    await page.evaluate(`document.getElementById('notecardTemplatePanel').hidden`),
    true,
  );
  await page.evaluate(
    `noteTest.editor.cancel();noteTest.restoreFetch();document.getElementById('libraryModal').hidden=true`,
  );
}
