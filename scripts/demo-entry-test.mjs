#!/usr/bin/env node
// Local preview and real-browser checks share the exact entry component and fixture.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const repo = resolve(import.meta.dirname, '..');
const index = await readFile(resolve(repo, 'public/index.html'), 'utf8');
const sprite = index.match(/<svg[^>]*class="icon-sprite"[^>]*>[\s\S]*?<\/svg>/)?.[0];
assert.ok(sprite?.includes('id="i-player-play"'), 'approved existing sprite icon');
const html = (await readFile(resolve(repo, 'test/fixtures/demo-entry.html'), 'utf8')).replace(
  '<!-- SPRITE -->',
  sprite,
);
const fixture = await readFile(resolve(repo, 'test/fixtures/demo-entry.js'), 'utf8');
const server = await serveDir({
  root: resolve(repo, 'public'),
  routes: {
    '/': { body: html },
    '/preview-fixture.js': { body: fixture, type: 'application/javascript' },
  },
});
if (process.argv.includes('--serve')) {
  console.log(`Demo entry preview: ${server.origin}/`);
  console.log('Simulated UI only. No database, authentication, or table connections.');
  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
} else {
  let browser;
  try {
    browser = await launch();
    const page = await newPage(browser, { url: server.origin });
    const evaluate = page.evaluate;
    const scenario = (value) =>
      evaluate(
        `document.querySelector('#scenario').value=${JSON.stringify(value)}; document.querySelector('#scenario').dispatchEvent(new Event('change'))`,
      );
    const submit = () => evaluate(`document.querySelector('form').requestSubmit()`);
    const settle = () => evaluate(`new Promise(resolve => setTimeout(resolve, 450))`);
    await evaluate(
      `document.querySelector('#demo-name').value='   '; document.querySelector('form').requestSubmit()`,
    );
    assert.equal(await evaluate(`document.activeElement.id`), 'demo-name');
    assert.equal(await evaluate(`window.demoPreview.calls.length`), 0);
    await evaluate(
      `document.querySelector('#demo-name').value='  Ada  '; document.querySelector('[value="chess"]').checked=true`,
    );
    await submit();
    await submit();
    assert.equal(
      await evaluate(`window.demoPreview.calls.length`),
      1,
      'duplicate submission blocked',
    );
    assert.equal(
      await evaluate(`document.querySelector('form').getAttribute('aria-busy')`),
      'true',
    );
    await settle();
    assert.deepEqual(await evaluate(`window.demoPreview.calls[0]`), {
      action: 'start',
      displayName: 'Ada',
      starter: 'chess',
    });
    await submit();
    assert.equal(
      await evaluate(`window.demoPreview.calls.length`),
      1,
      'successful submission stays disabled until navigation',
    );
    await scenario('capacity');
    await evaluate(
      `document.querySelector('#demo-name').value='Ada'; document.querySelector('[value="cards"]').checked=true`,
    );
    await submit();
    await settle();
    assert.equal(await evaluate(`document.activeElement.id`), 'demo-error');
    assert.equal(await evaluate(`document.querySelector('#demo-name').value`), 'Ada');
    assert.equal(await evaluate(`document.querySelector('form').elements.starter.value`), 'cards');
    assert.match(
      await evaluate(`document.querySelector('#demo-error').textContent`),
      /demo is full/,
    );
    assert.equal(
      await evaluate(`document.querySelector('[type="submit"]').getAttribute('aria-label')`),
      'Try again',
    );
    await submit();
    await settle();
    assert.equal(await evaluate(`window.demoPreview.calls.length`), 2);
    await scenario('network');
    await submit();
    await settle();
    assert.doesNotMatch(await evaluate(`document.body.textContent`), /private detail/);
    await scenario('resume');
    assert.equal(await evaluate(`document.querySelector('[data-demo="starters"]').hidden`), true);
    await submit();
    await settle();
    assert.deepEqual(await evaluate(`window.demoPreview.calls[0]`), { action: 'resume' });
    await scenario('invite');
    await submit();
    await settle();
    assert.deepEqual(await evaluate(`window.demoPreview.calls[0]`), {
      action: 'invite',
      displayName: 'Guest',
    });
    await scenario('expired-invite');
    assert.match(
      await evaluate(`document.querySelector('#demo-error').textContent`),
      /invite has expired/,
    );
    await submit();
    assert.equal(await evaluate(`window.demoPreview.calls.length`), 0);
    await evaluate(`document.querySelector('[data-demo="start-own"]').click()`);
    assert.equal(await evaluate(`document.activeElement.id`), 'demo-heading');
    assert.equal(
      await evaluate(`document.querySelector('[type="submit"]').getAttribute('aria-label')`),
      'Start my table',
    );
    await scenario('expired-table');
    assert.match(
      await evaluate(`document.querySelector('#demo-error').textContent`),
      /table has expired/,
    );
    await scenario('start');
    await evaluate(`document.querySelector('[value="empty"]').focus()`);
    await browser.send(
      'Input.dispatchKeyEvent',
      { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      page.sessionId,
    );
    await browser.send(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      page.sessionId,
    );
    assert.equal(
      await evaluate(`document.querySelector('form').elements.starter.value`),
      'dice',
      'native keyboard radio navigation',
    );
    await scenario('resume');
    await evaluate(`window.demoPreview.now += 103 * 60000`);
    await submit();
    assert.equal(
      await evaluate(`window.demoPreview.calls.length`),
      0,
      'deadline rechecked before submission',
    );
    assert.match(
      await evaluate(`document.querySelector('#demo-error').textContent`),
      /table has expired/,
    );
    await evaluate(`(async () => {
      window.demoPreview.view.destroy();
      const { mountDemoEntry } = await import('/demo/entry.js');
      window.demoPreview.view = mountDemoEntry(document.querySelector('#entry'), {
        mode: 'invite', hostName: '<img src=x onerror=alert(1)>',
        onSubmit: async () => { throw Object.assign(new Error(), {code: 'expired'}); },
      });
    })()`);
    assert.equal(
      await evaluate(`document.querySelector('h1 img')`),
      null,
      'host names render as text',
    );
    await submit();
    await settle();
    assert.equal(await evaluate(`document.activeElement.id`), 'demo-error');
    assert.match(
      await evaluate(`document.querySelector('#demo-error').textContent`),
      /invite has expired/,
    );
    // Teardown cancels ownership of pending completion and removes listeners/timers.
    await scenario('start');
    await submit();
    await evaluate(`window.demoPreview.view.destroy()`);
    await settle();
    assert.equal(await evaluate(`document.querySelector('#entry').children.length`), 0);
    assert.equal(await evaluate(`document.querySelector('#preview-result').textContent`), '');
    assert.deepEqual(page.errors, []);
    await page.close();

    for (const width of [320, 390, 720, 1440]) {
      for (const touch of [false, true]) {
        const p = await newPage(browser, { url: server.origin, width, height: 900, touch });
        for (const full of [true, false]) {
          await p.evaluate(`document.body.classList.toggle('ui-full', ${full})`);
          const checks = await p.evaluate(`(() => {
            const root = document.querySelector('#entry');
            const button = root.querySelector('[type="submit"]');
            const labels = [...root.querySelectorAll('.demo-entry__choices label')];
            return {
              overflow: root.scrollWidth > root.clientWidth,
              label: getComputedStyle(button.querySelector('.lbl')).display,
              targets: [...labels, button, root.querySelector('#demo-name')].every(el => el.getBoundingClientRect().height >= 44),
              icon: !!button.querySelector('use[href="#i-player-play"]'),
            };
          })()`);
          assert.equal(checks.overflow, false, `no overflow: ${width}/${touch}/${full}`);
          assert.notEqual(checks.label, 'none', 'compact entry retains label');
          assert.equal(checks.targets, true, '44px targets');
          assert.equal(checks.icon, true);
        }
        assert.deepEqual(p.errors, []);
        if (process.env.DEMO_SCREENSHOT_DIR && [390, 1440].includes(width) && !touch) {
          const { data } = await browser.send(
            'Page.captureScreenshot',
            { format: 'png' },
            p.sessionId,
          );
          await writeFile(
            resolve(process.env.DEMO_SCREENSHOT_DIR, `demo-entry-${width}.png`),
            Buffer.from(data, 'base64'),
          );
        }
        await p.close();
      }
    }
    assert.deepEqual(server.missing, []);
    console.log(
      'Demo entry passed: validation, duplicate requests, retries, resume/invite/expiry, teardown, and 16 layout/input combinations.',
    );
  } finally {
    await browser?.close();
    server.close();
  }
}
