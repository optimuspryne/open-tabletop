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
            images: [...document.images].filter(image => image.hasAttribute('src')).every(image => image.complete && image.naturalWidth > 0),
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
        if (path === 'index.html') {
          assert.equal(
            await page.evaluate(`
            [...document.querySelectorAll('[data-showcase] button')].every(button => {
              const rect = button.getBoundingClientRect();
              return rect.width >= 24 && rect.height >= 44;
            })`),
            true,
            'Slideshow controls retain usable targets',
          );
          if (touch) {
            await browser.send('Page.bringToFront', {}, page.sessionId);
            const point = await page.evaluate(`(() => {
              const button = document.querySelectorAll('[data-showcase-slide]')[3];
              button.scrollIntoView({block: 'center'});
              const rect = button.getBoundingClientRect();
              // CDP touch coordinates use the visual viewport on narrow mobile pages.
              return {x: rect.x + rect.width / 2 - visualViewport.offsetLeft,
                y: rect.y + rect.height / 2 - visualViewport.offsetTop};
            })()`);
            await browser.send(
              'Input.dispatchTouchEvent',
              { type: 'touchStart', touchPoints: [point] },
              page.sessionId,
            );
            await browser.send(
              'Input.dispatchTouchEvent',
              { type: 'touchEnd', touchPoints: [] },
              page.sessionId,
            );
            assert.equal(
              await page.evaluate(`(async () => {
              for (let i = 0; i < 100; i++) {
                if (document.querySelector('[data-showcase-title]').textContent === 'Go') return true;
                await new Promise(resolve => setTimeout(resolve, 30));
              }
              return false;
            })()`),
              true,
              'Touch selects the Go screenshot',
            );
          }
        }
        console.log(`PASS ${path} ${width}px ${touch ? 'touch' : 'mouse'}`);
      } finally {
        await page.close();
      }
    }
  }
  await checkShowcase(browser, server.origin);
  assert.deepEqual(server.missing, [], 'No missing local assets');
} finally {
  await browser?.close();
  server.close();
}

// Drive the production entry point with a controlled six-second clock, so pause and
// wraparound checks do not depend on rendering speed or background-tab throttling.
async function checkShowcase(browser, origin) {
  const page = await newPage(browser, { url: 'about:blank' });
  const waitFor = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await page.evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.fail(message);
  };
  const select = async (index, title) => {
    await page.evaluate(`document.querySelectorAll('[data-showcase-slide]')[${index}].click()`);
    await waitFor(
      `document.querySelector('[data-showcase-title]').textContent === ${JSON.stringify(title)}`,
      `${title} loads`,
    );
    const state = await page.evaluate(`(() => {
      const image = document.querySelector('.showcase-image.is-current');
      return { loaded: image.complete && image.naturalWidth > 0, alt: image.alt,
        count: document.querySelector('[data-showcase-count]').textContent,
        selected: document.querySelectorAll('[data-showcase-slide][aria-current="true"]').length };
    })()`);
    assert.equal(state.loaded, true);
    assert.ok(state.alt);
    assert.equal(state.count, `${index + 1} / 7`);
    assert.equal(state.selected, 1);
  };
  try {
    await browser.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `
      const scheduled = new Map();
      const nativeTimeout = window.setTimeout;
      const nativeClear = window.clearTimeout;
      let sequence = -1;
      window.setTimeout = (fn, delay, ...args) => {
        if (delay !== 6000) return nativeTimeout(fn, delay, ...args);
        const id = sequence--;
        scheduled.set(id, fn);
        return id;
      };
      window.clearTimeout = id => { scheduled.delete(id); nativeClear(id); };
      window.showcaseClock = {
        count: () => scheduled.size,
        tick: () => { const work = [...scheduled.values()]; scheduled.clear(); work.forEach(fn => fn()); }
      };
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', e => cspViolations.push(e.violatedDirective));
    `,
      },
      page.sessionId,
    );
    await browser.send('Page.navigate', { url: `${origin}/index.html` }, page.sessionId);
    await waitFor(
      `document.querySelector('[data-showcase-controls]')?.hidden === false`,
      'Slideshow enhances the static figure',
    );
    assert.equal(await page.evaluate('showcaseClock.count()'), 1);
    await page.evaluate('showcaseClock.tick()');
    await waitFor(
      `document.querySelector('[data-showcase-title]').textContent === 'Card games'`,
      'Autoplay advances',
    );
    assert.equal(
      await page.evaluate(`document.querySelector('[data-showcase-status]').textContent`),
      '',
      'Automatic changes do not interrupt screen readers',
    );
    await page.evaluate(`document.querySelector('[data-showcase-next]').click()`);
    await waitFor(
      `document.querySelector('[data-showcase-title]').textContent === 'Dice'`,
      'Next advances',
    );
    assert.equal(
      await page.evaluate('showcaseClock.count()'),
      0,
      'Manual navigation stops autoplay',
    );
    assert.equal(
      await page.evaluate(
        `document.querySelector('[data-showcase-play]').getAttribute('aria-label')`,
      ),
      'Play slideshow',
    );
    for (const [index, title] of [
      'Chess',
      'Card games',
      'Dice',
      'Go',
      'Dominoes',
      'Mahjong',
      'Wordy',
    ].entries())
      await select(index, title);
    await page.evaluate(`document.querySelector('[data-showcase-next]').click()`);
    await waitFor(
      `document.querySelector('[data-showcase-title]').textContent === 'Chess'`,
      'Next wraps to first',
    );
    await page.evaluate(`document.querySelector('[data-showcase-prev]').click()`);
    await waitFor(
      `document.querySelector('[data-showcase-title]').textContent === 'Wordy'`,
      'Previous wraps to last',
    );
    // Rapid navigation must retain the latest request while image decoding is pending.
    await page.evaluate(
      `document.querySelector('[data-showcase-next]').click(); document.querySelector('[data-showcase-next]').click()`,
    );
    await waitFor(
      `document.querySelector('[data-showcase-title]').textContent === 'Card games'`,
      'Rapid navigation selects latest requested slide',
    );
    await page.evaluate(`document.querySelector('[data-showcase-play]').click()`);
    assert.equal(await page.evaluate('showcaseClock.count()'), 1, 'Play resumes');
    await page.evaluate(
      `document.querySelector('[data-showcase]').dispatchEvent(new PointerEvent('pointerenter', {pointerType:'mouse'}))`,
    );
    assert.equal(await page.evaluate('showcaseClock.count()'), 0, 'Hover suspends autoplay');
    await page.evaluate(
      `document.querySelector('[data-showcase]').dispatchEvent(new PointerEvent('pointerleave', {pointerType:'mouse'}))`,
    );
    assert.equal(await page.evaluate('showcaseClock.count()'), 1, 'Leaving resumes autoplay');
    await page.evaluate(`document.querySelector('[data-showcase-next]').focus()`);
    assert.equal(
      await page.evaluate('showcaseClock.count()'),
      0,
      'Keyboard focus suspends autoplay',
    );
    await browser.send('Page.bringToFront', {}, page.sessionId);
    for (const type of ['keyDown', 'keyUp'])
      await browser.send(
        'Input.dispatchKeyEvent',
        {
          type,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}),
        },
        page.sessionId,
      );
    await waitFor(
      `document.querySelector('[data-showcase-title]').textContent === 'Dice'`,
      'Native keyboard activation advances',
    );
    await page.evaluate(`document.querySelector('[data-showcase-play]').click()`);
    assert.equal(
      await page.evaluate('showcaseClock.count()'),
      1,
      'Explicit Play resumes while focused',
    );
    await page.evaluate(
      `Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'))`,
    );
    assert.equal(await page.evaluate('showcaseClock.count()'), 0, 'Hidden tabs suspend autoplay');
    await page.evaluate(
      `Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange'))`,
    );
    assert.equal(await page.evaluate('showcaseClock.count()'), 1, 'Visible tabs resume autoplay');
    assert.deepEqual(
      await page.evaluate('cspViolations'),
      [],
      'Ordinary slideshow assets respect CSP',
    );
    // Use an invalid embedded URL instead of a missing HTTP file to test decode failure.
    await page.evaluate(
      `document.querySelectorAll('[data-showcase-slide]')[3].dataset.src = 'data:image/png,invalid'; document.querySelectorAll('[data-showcase-slide]')[3].click()`,
    );
    await waitFor(
      `document.querySelector('[data-showcase-status]').textContent.includes('could not load')`,
      'Failed image announces a recoverable error',
    );
    assert.equal(
      await page.evaluate(`document.querySelector('[data-showcase-title]').textContent`),
      'Dice',
      'Failed image retains current screenshot',
    );
    await select(4, 'Dominoes');
    // The failed data URL is intentionally rejected by the site CSP; all ordinary
    // page assets and scripts above must have loaded without a policy violation.
    const violations = await page.evaluate('cspViolations');
    assert.ok(
      violations.every((d) => d === 'img-src'),
      `Unexpected CSP violations: ${violations}`,
    );
    await browser.send(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
      page.sessionId,
    );
    await browser.send('Page.reload', {}, page.sessionId);
    await waitFor(
      `document.querySelector('[data-showcase-controls]')?.hidden === false`,
      'Reduced-motion page loads',
    );
    assert.equal(await page.evaluate('showcaseClock.count()'), 0, 'Reduced motion starts paused');
    assert.equal(
      await page.evaluate(
        `getComputedStyle(document.querySelector('.showcase-image')).transitionDuration`,
      ),
      '0s',
    );
    await select(3, 'Go');
    assert.deepEqual(
      await page.evaluate('cspViolations'),
      [],
      'Reduced-motion reload respects CSP',
    );
    assert.deepEqual(page.errors, [], 'Slideshow has no runtime exceptions');
    await browser.send('Emulation.setScriptExecutionDisabled', { value: true }, page.sessionId);
    await browser.send('Page.reload', {}, page.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await browser.send('Emulation.setScriptExecutionDisabled', { value: false }, page.sessionId);
    await waitFor(
      `document.querySelector('[data-showcase-controls]')?.hidden === true`,
      'No-JavaScript fallback hides inactive controls',
    );
    assert.equal(
      await page.evaluate(`document.querySelector('.showcase-image.is-current').naturalWidth`),
      1086,
      'No-JavaScript fallback shows chess',
    );
    console.log(
      'PASS slideshow: all seven images, autoplay, wraparound, rapid navigation, keyboard, pause, hover/focus, visibility, decode failure, reduced motion, no-JavaScript fallback',
    );
  } finally {
    await page.close();
  }
}
