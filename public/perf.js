// perf.js — a dev-only render-cost overlay for the client half of "plays well at
// real scale" (docs/ROADMAP.md §1). Off by default. Turn it on with ?perf=1 on the
// table URL (matching the ?workshop=1 convention in client.js) or window.ottPerf(true)
// from the console — the URL form is the one that works on a phone/tablet with no keyboard.
//
// FPS and frame time say WHETHER the frame is smooth; renderer.info says WHY — draw calls
// and triangles scale with the piece count, geometries/textures with the asset set. Those
// are exactly the numbers the graphics-quality tiers (backlog §12) would turn down, so this
// overlay is also the signal a future auto-quality-tier default would read.
//
// Deliberately NOT part of any automated suite: real numbers need a real GPU on the target
// device, not the headless SwiftShader the test harnesses run under.

const wantedByUrl = () => {
  try {
    return new URLSearchParams(location.search).get('perf') === '1';
  } catch {
    return false; // malformed query string — just stay off
  }
};

export function initPerf() {
  let el = null;
  let enabled = false;
  // A rolling window, flushed to the DOM ~2×/second so the text is readable rather than a blur.
  let last = 0,
    acc = 0,
    frames = 0,
    maxMs = 0;

  const ensureEl = () => {
    if (el) return;
    el = document.createElement('div');
    el.id = 'perfHud';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;top:8px;left:8px;z-index:99999;pointer-events:none;white-space:pre;' +
      'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;padding:6px 8px;border-radius:6px;' +
      'color:#9effa0;background:rgba(0,0,0,.72);text-shadow:0 1px 1px rgba(0,0,0,.6)';
    document.body.appendChild(el);
  };

  const setEnabled = (on) => {
    enabled = !!on;
    if (enabled) {
      ensureEl();
      el.style.display = 'block';
      last = acc = frames = maxMs = 0; // restart the window so the first flush isn't skewed
    } else if (el) {
      el.style.display = 'none';
    }
  };

  // Runtime toggle from the console or a device: window.ottPerf(true|false).
  if (typeof window !== 'undefined') window.ottPerf = setEnabled;
  if (wantedByUrl()) setEnabled(true);

  // Called once per rendered frame, straight after renderer.render(). That is when three.js's
  // per-frame counters are live — it resets renderer.info.render each frame (autoReset on).
  const frame = (renderer) => {
    if (!enabled) return;
    const now = performance.now();
    if (last) {
      const ms = now - last;
      acc += ms;
      frames++;
      if (ms > maxMs) maxMs = ms;
    }
    last = now;
    if (acc < 500) return;

    const fps = (frames * 1000) / acc;
    const avg = acc / frames;
    const info = renderer && renderer.info;
    const r = info && info.render;
    const m = info && info.memory;
    // performance.memory is Chrome-only; Safari (the iPad target) has no heap readout.
    const heap =
      performance.memory && performance.memory.usedJSHeapSize
        ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB'
        : '—';
    el.textContent =
      `${fps.toFixed(0)} fps   ${avg.toFixed(1)} ms (max ${maxMs.toFixed(0)})\n` +
      `draws ${r ? r.calls : '?'}   tris ${r ? r.triangles.toLocaleString() : '?'}\n` +
      `geom ${m ? m.geometries : '?'}   tex ${m ? m.textures : '?'}   ` +
      `prog ${info && info.programs ? info.programs.length : '?'}\n` +
      `heap ${heap}`;

    acc = frames = maxMs = 0;
  };

  return { frame, setEnabled };
}
