import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const mockHttp = `
const user = {id:'1',username:'test-player',email:'test@example.test',hasPassword:false,hostStatus:'none',canOwnRooms:false};
window.accountRequests = [];
window.prompt = () => { throw new Error('Native password prompt must not be used'); };
export async function requestJSON(path, options = {}) {
 window.accountRequests.push({path,body:options.body});
 if(path === '/rooms') return {rooms:[]};
 if(path === '/auth/security/config') return {emailRecoveryAvailable:true};
 if(path === '/auth/security') return {user:{...user},emailRecoveryAvailable:true,emailVerified:false,codesRemaining:0};
 if(path === '/auth/password') { user.hasPassword=true; return {user:{...user},token:'new-session'}; }
 if(path === '/host/request') {user.hostStatus='pending';return {user:{...user}};}
 if(path === '/auth/signup') {user.hasPassword=true;return {user:{...user},token:'new-session'};}
 if(path === '/auth/recovery/codes') return {codes:Array.from({length:10},(_,i)=>'abcd-1234-5678-90ef-abcd-1234-5678-90e'+i)};
 if(path === '/auth/recovery/request') return {message:'If this email is verified for an account, a recovery link will arrive shortly.'};
 if(path === '/auth/recovery/exchange') return {grant:'x'.repeat(43),hasPassword:window.recoverHasPassword ?? true};
 if(path === '/auth/recovery/complete') return {user:{...user},token:'recovered-session'};
 if(path === '/auth/recovery/verify') return {message:'Recovery email verified.'};
 if(path === '/auth/recovery/verify/request') return {message:'Verification requested.'};
 if(path === '/auth/token') return {user:{...user}};
 throw new Error('Unexpected fixture request: '+path);
}`;
const server = await serveDir({
  root: resolve('public'),
  mounts: { '/shared/': resolve('shared') },
  routes: { '/http.js': { body: mockHttp, type: 'text/javascript' } },
});
const browser = await launch();
try {
  for (const { width, touch } of [
    { width: 1280, touch: false },
    { width: 390, touch: true },
    { width: 360, touch: true },
  ]) {
    for (const full of [false, true]) {
      const page = await newPage(browser, {
        url: server.origin + '/index.html',
        width,
        height: 900,
        touch,
      });
      const run = (body) =>
        page.evaluate(`(async()=>{const $=id=>document.getElementById(id);${body}})()`);
      await run(
        `document.body.classList.toggle('ui-full',${full});$('accountBtn').click();$('toSignup').click();$('suUser').value='test-player';$('suEmail').value='test@example.test';$('suPw').value='new password';$('suConfirm').value='different';$('signupForm').requestSubmit();`,
      );
      assert.equal(await run(`return $('suConfirm').getAttribute('aria-invalid')`), 'true');
      assert.equal(
        await run(`return window.accountRequests.some(r=>r.path==='/auth/signup')`),
        false,
      );
      assert.equal(
        await run(`return $('suPw').type==='password' && $('suConfirm').type==='password'`),
        true,
      );
      // Boot with a passwordless session to test the native-prompt replacement.
      await run(`localStorage.setItem('tabletop.token','fixture-session');location.reload();`);
      await new Promise((r) => setTimeout(r, 200));
      await run(`document.body.classList.toggle('ui-full',${full});$('requestHostBtn').click();`);
      assert.equal(
        await run(
          `return !$('passwordForm').hidden && $('newPassword').type==='password' && $('confirmPassword').type==='password'`,
        ),
        true,
      );
      await run(
        `$('newPassword').value='new password';$('confirmPassword').value='new password';$('passwordForm').requestSubmit();`,
      );
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(
        await run(`return window.accountRequests.filter(r=>r.path==='/host/request').length`),
        1,
      );
      for (const admin of [false, true]) {
        await run(
          `$('adminBtn').hidden=${!admin};$('who').textContent='A-player-with-a-long-display-name';`,
        );
        assert.equal(
          await run(`const identity=document.querySelector('.account-row .who').getBoundingClientRect();
            const controls=$('uiModeToggle').getBoundingClientRect();
            const security=$('securityBtn').getBoundingClientRect();
            const header=$('topbar').getBoundingClientRect();
            return !$('securityBtn').hidden && security.top>=header.top && security.bottom<=header.bottom
              && (controls.left>=identity.right || controls.top>=identity.bottom)
              && document.documentElement.scrollWidth<=innerWidth;`),
          true,
          `account header overlap/overflow ${width} ${full} admin=${admin}`,
        );
      }
      if (full) {
        const shot = await browser.send(
          'Page.captureScreenshot',
          { format: 'png' },
          page.sessionId,
        );
        await writeFile(`/tmp/ott-account-header-${width}.png`, Buffer.from(shot.data, 'base64'));
      }
      await run(`$('securityBtn').click();`);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(await run(`return $('securityBtn').hidden`), true);
      assert.equal(
        await run(`return !$('securityOverview').hidden && !$('securityPasswordBtn').disabled`),
        true,
      );
      assert.equal(
        await run(`return getComputedStyle($('securityPasswordLabel')).display!=='none'`),
        true,
      );
      assert.equal(
        await run(`return document.documentElement.scrollWidth<=innerWidth`),
        true,
        `overflow ${width} ${full}`,
      );
      if (full) {
        const shot = await browser.send(
          'Page.captureScreenshot',
          { format: 'png' },
          page.sessionId,
        );
        await writeFile(`/tmp/ott-account-security-${width}.png`, Buffer.from(shot.data, 'base64'));
      }
      await run(`$('generateCodesBtn').click();`);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        await run(`return $('recoveryCodeList').textContent.split(String.fromCharCode(10)).length`),
        10,
      );
      await run(`$('codesDoneBtn').click();`);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(await run(`return $('recoveryCodeList').textContent`), '');
      await run(`$('securityPasswordBtn').click();$('passwordResetLink').click();`);
      await new Promise((r) => setTimeout(r, 30));
      await run(
        `$('recoveryLogin').value='test-player';$('recoveryCode').value='fixture-code';$('recoveryCodeForm').requestSubmit();`,
      );
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        await run(`return !$('resetPasswordForm').hidden && $('recoverWithoutPassword').hidden`),
        true,
      );
      await run(
        `$('resetPassword').value='reset password';$('resetConfirmation').value='different';$('resetPasswordForm').requestSubmit();`,
      );
      assert.equal(await run(`return $('resetConfirmation').getAttribute('aria-invalid')`), 'true');
      await run(
        `$('resetConfirmation').value='reset password';$('resetPasswordForm').requestSubmit();`,
      );
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(await run(`return localStorage.getItem('tabletop.token')`), 'recovered-session');
      assert.equal(await run(`return $('resetPassword').value`), '');
      assert.deepEqual(page.errors, []);
      await page.close();
      console.log(
        `account-security: ${width}px ${touch ? 'touch' : 'mouse'} ${full ? 'full' : 'compact'} passed`,
      );
    }
  }
  const page = await newPage(browser, {
    url: server.origin + '/index.html#recover=fragment-secret',
  });
  assert.equal(await page.evaluate('location.hash'), '');
  assert.equal(
    await page.evaluate("window.accountRequests.some(r=>r.path==='/auth/recovery/exchange')"),
    false,
  );
  await page.evaluate('window.recoverHasPassword = false');
  await page.evaluate("document.getElementById('linkContinue').click()");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(
    await page.evaluate(
      "window.accountRequests.find(r=>r.path==='/auth/recovery/exchange').body.token",
    ),
    'fragment-secret',
  );
  assert.equal(
    await page.evaluate("document.getElementById('recoverWithoutPassword').hidden"),
    false,
  );
  await page.evaluate("document.getElementById('recoverWithoutPassword').click()");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(
    await page.evaluate("window.accountRequests.find(r=>r.path==='/auth/recovery/complete').body"),
    { grant: 'x'.repeat(43) },
  );
  assert.deepEqual(page.errors, []);
  await page.close();
} finally {
  await browser.close();
  server.close();
}
