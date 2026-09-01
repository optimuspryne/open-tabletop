#!/usr/bin/env node
/**
 * input-test.mjs — behavioural tests for the input seam (public/controls.js).
 *
 * controls.js translates raw DOM input into the intent vocabulary client.js implements.
 * That seam is unusually testable: attach it to a bare <div>, hand it a recording
 * `intents` object, dispatch synthetic events, and assert on the intents raised. No 3D,
 * no server, no room.
 *
 * It exists because a whole input path can be missing for one device family and
 * everything still looks fine: claiming the whiteboard hung on the native `dblclick`
 * event, which Chrome synthesizes from a double-tap and WebKit does not, so the gesture
 * was unreachable on iOS/iPadOS with no error anywhere.
 *
 * Runs as `npm run test:input`. Deliberately NOT part of `npm run check`, which must
 * keep working on a machine with no browser. Browser plumbing: scripts/lib/headless.mjs.
 */
import { resolve } from 'node:path';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const ROOT = resolve(import.meta.dirname, '..', 'public');

// The fixture: controls.js attached to a bare div, with every intent recorded.
const FIXTURE = `<!doctype html><meta charset="utf-8">
<div id="surface" style="width:400px;height:400px"></div>
<script type="module">
import { attachControls } from '/controls.js';
const rec = [];
let held = false;
const flags = (p) =>
  ['primary','secondary','additive','rotate','fineRotate','touch','transforming'].filter((k) => p[k]).join('+') || '-';
attachControls(document.getElementById('surface'), {
  press:  (p) => rec.push(['press', flags(p)]),
  move:   (p) => rec.push(['move', flags(p)]),
  release:(p) => rec.push(['release', flags(p)]),
  command:(k) => rec.push(['command', k.key]),
  raiseAxis:(d) => rec.push(['raiseAxis', d]),
  rotateHeld:(r) => rec.push(['rotateHeld', r]),
  rotateAxis:(d) => rec.push(['rotateAxis', d]),
  doubleClick: () => { rec.push(['doubleClick']); return true; },
  snapHeld: () => rec.push(['snapHeld']),
  ping: () => rec.push(['ping']),
  secondaryPress: () => rec.push(['secondaryPress']),
  hasHeld: () => held,
});
const dom = document.getElementById('surface');
const P = (type, o = {}) => dom.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: o.id ?? 1, pointerType: o.t ?? 'touch',
  clientX: o.x ?? 0, clientY: o.y ?? 0, button: o.button ?? 0,
  shiftKey: !!o.shift, altKey: !!o.alt,
}));
const M = (type, o = {}) => dom.dispatchEvent(new MouseEvent(type, {
  bubbles: true, cancelable: true, clientX: o.x ?? 0, clientY: o.y ?? 0, button: o.button ?? 0,
}));
Object.assign(window, {
  rec, P, M,
  setHeld: (v) => { held = v; },
  // Every case starts from a clean profile: lift any fingers the previous case left down
  // (controls.js keeps live-pointer and transform state that a bare rec.length=0 would not
  // clear), drop the held piece, then clear the recording.
  reset: () => {
    for (const id of [1, 2, 3]) P('pointercancel', { x: 0, y: 0, id });
    held = false;
    rec.length = 0;
  },
  only: (...names) => rec.filter((r) => names.includes(r[0])),
  tap: (x, y, t = 'touch') => { P('pointerdown', { x, y, t }); P('pointerup', { x, y, t }); },
  wheel: (dy) => dom.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: dy })),
  ctx: () => dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
  key: (k) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k })),
  keyDown: (k, repeat = false) => window.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k, repeat })),
  keyUp: (k) => window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: k })),
  blurWin: () => window.dispatchEvent(new Event('blur')),
  // A real focused field, so the typing guard is exercised rather than mocked.
  focusField: () => { const i = document.createElement('input'); document.body.append(i); i.focus(); return i; },
  blurField: () => { document.querySelectorAll('input').forEach((i) => i.remove()); },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  // Two-finger helpers: finger 1 grabs, finger 2 is the transform partner.
  grab: (x, y) => { setHeld(true); P('pointerdown', { x, y, id: 1 }); },
  second: (x, y) => P('pointerdown', { x, y, id: 2 }),
  moveF: (id, x, y) => P('pointermove', { x, y, id }),
  sum: (name) => rec.filter((r) => r[0] === name).reduce((t, r) => t + r[1], 0),
});
window.__ready = true;
</script>`;

// Each case: [name, setup statements, result expression, expected value].
// The setup and the expression are separate because an async function body has no
// implicit return — the first version of this file lost every result to that.
const CASES = [
  [
    'touch double-tap raises doubleClick once',
    `reset(); tap(100,100); await sleep(60); tap(102,101);`,
    `only('doubleClick').length`,
    1,
  ],
  [
    'a third tap does not chain into a second double',
    `reset(); tap(100,100); await sleep(60); tap(101,100); await sleep(60); tap(101,101);`,
    `only('doubleClick').length`,
    1,
  ],
  [
    'taps 500ms apart are not a double',
    `reset(); tap(200,200); await sleep(500); tap(200,200);`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'taps 250px apart are not a double',
    `reset(); tap(50,50); await sleep(60); tap(300,300);`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'a drag then a tap is not a double',
    `reset(); P('pointerdown',{x:80,y:80}); P('pointermove',{x:140,y:140});
    P('pointerup',{x:140,y:140}); await sleep(60); tap(140,140);`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'a native dblclick after a touch tap is suppressed',
    `reset(); tap(10,10); M('dblclick',{x:10,y:10});`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'a mouse dblclick still raises doubleClick',
    `reset(); P('pointerdown',{x:20,y:20,t:'mouse'}); P('pointerup',{x:20,y:20,t:'mouse'});
    M('dblclick',{x:20,y:20});`,
    `only('doubleClick').length`,
    1,
  ],
  [
    'a held finger raises secondaryPress',
    `reset(); P('pointerdown',{x:30,y:30}); await sleep(560);`,
    `only('secondaryPress').length`,
    1,
  ],
  [
    'a finger that drifts does not raise secondaryPress',
    `reset(); P('pointerdown',{x:30,y:30}); await sleep(200); P('pointermove',{x:44,y:30});
    await sleep(400);`,
    `only('secondaryPress').length`,
    0,
  ],
  [
    'a mouse hold never raises secondaryPress',
    `reset(); P('pointerdown',{x:30,y:30,t:'mouse'}); await sleep(560);`,
    `only('secondaryPress').length`,
    0,
  ],
  [
    'middle-click pings when nothing is held',
    `reset(); setHeld(false); M('mousedown',{button:1});`,
    `JSON.stringify(only('ping','snapHeld'))`,
    '[["ping"]]',
  ],
  [
    'middle-click snaps the held piece',
    `reset(); setHeld(true); M('mousedown',{button:1});`,
    `JSON.stringify(only('ping','snapHeld'))`,
    '[["snapHeld"]]',
  ],
  [
    'the wheel raises a held piece, up = +1',
    `reset(); setHeld(true); wheel(-120);`,
    `JSON.stringify(only('raiseAxis'))`,
    '[["raiseAxis",1]]',
  ],
  [
    'the wheel lowers a held piece, down = -1',
    `reset(); setHeld(true); wheel(120);`,
    `JSON.stringify(only('raiseAxis'))`,
    '[["raiseAxis",-1]]',
  ],
  [
    'the wheel is left to the camera when nothing is held',
    `reset(); setHeld(false); wheel(-120);`,
    `only('raiseAxis').length`,
    0,
  ],
  ['contextmenu is prevented so right-click is ours', `reset();`, `ctx() === false`, true],
  [
    'a right-button press is secondary',
    `reset(); P('pointerdown',{x:5,y:5,t:'mouse',button:2});`,
    `JSON.stringify(only('press'))`,
    '[["press","secondary"]]',
  ],
  [
    'shift marks a press additive',
    `reset(); P('pointerdown',{x:5,y:5,t:'mouse',shift:true});`,
    `JSON.stringify(only('press'))`,
    '[["press","primary+additive"]]',
  ],
  [
    'alt+shift marks a press rotate and fineRotate',
    `reset(); P('pointerdown',{x:5,y:5,t:'mouse',alt:true,shift:true});`,
    `JSON.stringify(only('press'))`,
    '[["press","primary+additive+rotate+fineRotate"]]',
  ],
  [
    'a touch press carries the touch flag',
    `reset(); P('pointerdown',{x:5,y:5});`,
    `JSON.stringify(only('press'))`,
    '[["press","primary+touch"]]',
  ],
  [
    'pointercancel still releases',
    `reset(); P('pointerdown',{x:5,y:5}); P('pointercancel',{x:5,y:5});`,
    `only('release').length`,
    1,
  ],
  [
    'a keydown raises a command',
    `reset(); key('Escape');`,
    `JSON.stringify(only('command'))`,
    '[["command","Escape"]]',
  ],

  // ---- two-finger transform (twist → rotate, pinch → height) ------------------------
  // The gesture only exists while a piece is held; with nothing held, two fingers must
  // stay available to the camera.
  [
    'a second finger while holding does not raise a press',
    `reset(); setHeld(true); P('pointerdown',{x:100,y:100,id:1}); second(200,100);`,
    `only('press').length`,
    1,
  ],
  [
    'a second finger with nothing held is a normal press (camera keeps two-finger pan)',
    `reset(); setHeld(false); P('pointerdown',{x:100,y:100,id:1}); second(200,100);`,
    `only('press').length`,
    2,
  ],
  [
    'a clockwise twist rotates the held piece the same way',
    // b swings from right-of-a to below-a: clockwise on screen, so the sent angle is negative.
    `reset(); grab(100,100); second(200,100); moveF(2,100,200);`,
    `sum('rotateHeld') < 0`,
    true,
  ],
  [
    'a counter-clockwise twist rotates the other way',
    `reset(); grab(100,100); second(200,100); moveF(2,100,0);`,
    `sum('rotateHeld') > 0`,
    true,
  ],
  [
    'a quarter turn sends about a quarter turn',
    `reset(); grab(100,100); second(200,100); moveF(2,100,200);`,
    `Math.abs(Math.abs(sum('rotateHeld')) - Math.PI/2) < 1e-6`,
    true,
  ],
  [
    'spreading the fingers raises, without rotating',
    // dist 100 → 200 along the same axis: 100px / 28px per step = 3 steps, angle unchanged.
    `reset(); grab(100,100); second(200,100); moveF(2,300,100);`,
    `JSON.stringify([sum('raiseAxis'), only('rotateHeld').length])`,
    '[3,0]',
  ],
  [
    'closing the fingers lowers',
    `reset(); grab(100,100); second(300,100); moveF(2,200,100);`,
    `sum('raiseAxis')`,
    -3,
  ],
  [
    'a twist at constant spread does not change height',
    `reset(); grab(100,100); second(200,100); moveF(2,100,200);`,
    `only('raiseAxis').length`,
    0,
  ],
  [
    // b sits just above the -x axis and crosses to just below it: atan2 jumps from ~-pi to ~+pi,
    // a raw delta of nearly a full turn for a couple of degrees of real motion. Without the
    // unwrap the piece spins the long way round.
    'a twist across the +/-pi seam is a small turn, not a full spin',
    `reset(); grab(100,100); second(0,99); moveF(2,0,101);`,
    `Math.abs(sum('rotateHeld')) < 0.1`,
    true,
  ],
  [
    'fingers pinched closer than the noise floor do not rotate',
    `reset(); grab(100,100); second(110,100); moveF(2,100,110);`,
    `only('rotateHeld').length`,
    0,
  ],
  [
    'the grabbing finger keeps moving, flagged as transforming',
    `reset(); grab(100,100); second(200,100); moveF(1,105,105);`,
    `JSON.stringify(only('move'))`,
    '[["move","primary+touch+transforming"]]',
  ],
  [
    'the partner finger raises no move of its own',
    `reset(); grab(100,100); second(200,100); moveF(2,200,150);`,
    `only('move').length`,
    0,
  ],
  [
    'lifting the partner does not drop the piece',
    `reset(); grab(100,100); second(200,100); P('pointerup',{x:200,y:100,id:2});`,
    `only('release').length`,
    0,
  ],
  [
    'lifting the grabbing finger still releases',
    `reset(); grab(100,100); second(200,100); P('pointerup',{x:100,y:100,id:1});`,
    `only('release').length`,
    1,
  ],
  [
    'a third finger is inert',
    // The grabbing finger's own press is the only one that may appear.
    `reset(); grab(100,100); second(200,100); P('pointerdown',{x:50,y:50,id:3});`,
    `JSON.stringify(only('press'))`,
    '[["press","primary+touch"]]',
  ],
  [
    'the transform ends with the partner, so a later twist does nothing',
    `reset(); grab(100,100); second(200,100); P('pointerup',{x:200,y:100,id:2});
     reset(); moveF(2,100,200);`,
    `only('rotateHeld').length`,
    0,
  ],
  // ---- held rotate / raise keys ----------------------------------------------------
  // A keyboard slider alongside the on-screen hold buttons: same intents, same tick rates.
  [
    'A turns left, D turns right',
    `reset(); keyDown('a'); keyUp('a'); keyDown('d'); keyUp('d');`,
    `JSON.stringify(only('rotateAxis'))`,
    '[["rotateAxis",-1],["rotateAxis",1]]',
  ],
  [
    'the arrow keys mirror A and D',
    `reset(); keyDown('ArrowLeft'); keyUp('ArrowLeft'); keyDown('ArrowRight'); keyUp('ArrowRight');`,
    `JSON.stringify(only('rotateAxis'))`,
    '[["rotateAxis",-1],["rotateAxis",1]]',
  ],
  [
    'W raises and S lowers, as do the up and down arrows',
    `reset(); for (const k of ['w','s','ArrowUp','ArrowDown']) { keyDown(k); keyUp(k); }`,
    `JSON.stringify(only('raiseAxis'))`,
    '[["raiseAxis",1],["raiseAxis",-1],["raiseAxis",1],["raiseAxis",-1]]',
  ],
  [
    'the first press acts immediately, without waiting a tick',
    `reset(); keyDown('a');`,
    `only('rotateAxis').length`,
    1,
  ],
  [
    'a held key keeps ticking',
    `reset(); keyDown('a'); await sleep(200); keyUp('a');`,
    `only('rotateAxis').length >= 3`,
    true,
  ],
  [
    'releasing stops the ticking',
    `reset(); keyDown('a'); keyUp('a'); const n = only('rotateAxis').length; await sleep(200);`,
    `only('rotateAxis').length === n`,
    true,
  ],
  [
    // The OS auto-repeat rate is a per-machine setting, so it cannot be the tick. We run our own
    // interval; if a repeat started a second one the piece would spin at double speed.
    'the OS auto-repeat does not start a second timer',
    `reset(); keyDown('a'); keyDown('a', true); keyDown('a', true); await sleep(200); keyUp('a');
     const ours = only('rotateAxis').length;
     reset(); keyDown('a'); await sleep(200); keyUp('a');`,
    `Math.abs(ours - only('rotateAxis').length) <= 1`,
    true,
  ],
  [
    'two axes can be held at once',
    `reset(); keyDown('a'); keyDown('w'); await sleep(200); keyUp('a'); keyUp('w');`,
    `JSON.stringify([only('rotateAxis').length > 1, only('raiseAxis').length > 1])`,
    '[true,true]',
  ],
  [
    'losing window focus stops a held key',
    `reset(); keyDown('a'); blurWin(); const n = only('rotateAxis').length; await sleep(200);`,
    `only('rotateAxis').length === n`,
    true,
  ],
  [
    'typing in a field does not steer the table',
    `reset(); focusField(); keyDown('a'); keyDown('w'); await sleep(120); keyUp('a'); keyUp('w'); blurField();`,
    `only('rotateAxis','raiseAxis').length`,
    0,
  ],
  [
    'an axis key is not also a command',
    `reset(); keyDown('a'); keyUp('a');`,
    `only('command').length`,
    0,
  ],
  [
    // The auto-repeat sends keydown after keydown while the key is down. Each one has to be
    // dropped, not just declined as a tick: routing them on would spam the command router for
    // as long as the key is held.
    'an OS auto-repeat is not a command either',
    `reset(); keyDown('a'); keyDown('a', true); keyDown('a', true); keyUp('a');`,
    `only('command').length`,
    0,
  ],
  [
    'a non-axis key is still a command',
    `reset(); keyDown('u'); keyUp('u');`,
    `JSON.stringify(only('command'))`,
    '[["command","u"]]',
  ],
  [
    'a typed non-axis key still reaches the command router, which guards itself',
    `reset(); focusField(); keyDown('u'); keyUp('u'); blurField();`,
    `only('command').length`,
    1,
  ],
  [
    'a two-finger transform never arms the long-press menu',
    `reset(); grab(100,100); second(200,100); await sleep(560);`,
    `only('secondaryPress').length`,
    0,
  ],
];

const server = await serveDir({
  root: ROOT,
  routes: { '/__fixture.html': { body: FIXTURE } },
});
const cdp = await launch();
const page = await newPage(cdp, { url: `${server.origin}/__fixture.html`, settle: 200 });

let failed = 0;
for (const [name, setup, expr, expected] of CASES) {
  let got,
    err = null;
  try {
    got = await page.evaluate(`(async () => { ${setup}; return (${expr}); })()`);
  } catch (e) {
    err = e.message;
  }
  const ok = !err && JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok)
    console.log(
      `          expected ${JSON.stringify(expected)}, got ${err ?? JSON.stringify(got)}`,
    );
}
if (page.errors.length) {
  console.log('\nthe fixture raised uncaught errors — the suite may be testing nothing:');
  page.errors.slice(0, 5).forEach((e) => console.log('   ' + e));
  failed++;
}
console.log(`\n${CASES.length - failed} of ${CASES.length} passed`);

await cdp.close();
server.close();
if (failed) process.exitCode = 1;
