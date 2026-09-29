/* global document, window */
import { mountDemoEntry } from '/demo/entry.js';

const root = document.querySelector('#entry');
const scenario = document.querySelector('#scenario');
const result = document.querySelector('#preview-result');
let view;
// Exposed only by the test fixture; production modules have no preview globals.
window.demoPreview = { calls: [], view: null, now: Date.now() };
function show() {
  view?.destroy();
  result.textContent = '';
  window.demoPreview.calls = [];
  const state = scenario.value;
  view = mountDemoEntry(root, {
    mode: state.includes('invite')
      ? 'invite'
      : state.includes('table') || state === 'resume'
        ? 'resume'
        : 'start',
    hostName: 'Alex',
    expiresAt: state.startsWith('expired')
      ? window.demoPreview.now - 1
      : window.demoPreview.now + 102 * 60000,
    now: () => window.demoPreview.now,
    async onSubmit(request, { signal }) {
      window.demoPreview.calls.push(request);
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (signal.aborted) return;
      if (state === 'capacity') throw Object.assign(new Error(), { code: 'capacity' });
      if (state === 'network') throw new Error('private detail: should never be shown');
      result.textContent = `Preview complete: ${request.action === 'resume' ? 'resumed your table' : request.action === 'invite' ? `joined Alex’s table as ${request.displayName}` : `started an ${request.starter} table as ${request.displayName}`}. No table was created.`;
    },
  });
  window.demoPreview.view = view;
}
scenario.addEventListener('change', show);
document.querySelector('#ui-mode').addEventListener('change', (event) => {
  document.body.classList.toggle('ui-full', event.target.value === 'full');
});
show();
