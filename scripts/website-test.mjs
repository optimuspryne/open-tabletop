// Static-site layout and navigation checks reuse the application's browser harness.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const server = await serveDir({ root: fileURLToPath(new URL('../website/', import.meta.url)) });
let browser;
try {
  browser = await launch();
  for (const [width, touch] of [
    [1440, false],
    [760, false],
    [1024, true],
    [390, true],
    [320, true],
  ]) {
    for (const path of [
      'index.html',
      'wiki/index.html',
      'wiki/docker.html',
      'wiki/portainer.html',
      'wiki/assets.html',
    ]) {
      const page = await newPage(browser, {
        url: `${server.origin}/${path}`,
        width,
        height: 900,
        touch,
        settle: 50,
      });
      try {
        const state = await page.evaluate(`(() => {
          const visible = (element) => !!element && element.getBoundingClientRect().width > 0;
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            images: [...document.images].every(image => image.complete && image.naturalWidth > 0),
            mobileContents: visible(document.querySelector('.wiki-mobile')),
            sidebar: visible(document.querySelector('.wiki-sidebar')),
            title: document.querySelector('h1').textContent,
          };
        })()`);
        assert.equal(state.overflow, false, `${path} at ${width}: page overflow`);
        assert.equal(state.images, true, `${path} at ${width}: image failed`);
        assert.ok(state.title.trim(), path);
        if (path.startsWith('wiki/')) {
          assert.equal(state.mobileContents, width <= 760, `${path}: mobile navigation`);
          assert.equal(state.sidebar, width > 760, `${path}: desktop navigation`);
          if (width <= 760) {
            await browser.send('Page.bringToFront', {}, page.sessionId);
            await page.evaluate("document.querySelector('.wiki-mobile summary').focus()");
            await browser.send(
              'Input.dispatchKeyEvent',
              {
                type: 'keyDown',
                key: 'Enter',
                code: 'Enter',
                text: '\r',
                unmodifiedText: '\r',
                windowsVirtualKeyCode: 13,
              },
              page.sessionId,
            );
            await browser.send(
              'Input.dispatchKeyEvent',
              { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
              page.sessionId,
            );
            assert.equal(
              await page.evaluate("document.querySelector('.wiki-mobile').open"),
              true,
              'Contents opens with Enter',
            );
            await page.evaluate("document.querySelector('.wiki-mobile').open = false");
          }
        }
        assert.deepEqual(page.errors, [], `${path} at ${width}: browser errors`);
        if (
          process.env.WEBSITE_SCREENSHOTS &&
          ['index.html', 'wiki/docker.html'].includes(path) &&
          [1440, 390].includes(width)
        ) {
          const directory = resolve(process.env.WEBSITE_SCREENSHOTS);
          await mkdir(directory, { recursive: true });
          const { data } = await browser.send(
            'Page.captureScreenshot',
            { format: 'png', captureBeyondViewport: true },
            page.sessionId,
          );
          await writeFile(
            resolve(directory, `${path.replaceAll('/', '-')}-${width}.png`),
            Buffer.from(data, 'base64'),
          );
        }
        console.log(`PASS ${path} ${width}px ${touch ? 'touch' : 'mouse'}`);
      } finally {
        await page.close();
      }
    }
  }
  assert.deepEqual(server.missing, [], 'No missing local assets');
} finally {
  await browser?.close();
  server.close();
}
