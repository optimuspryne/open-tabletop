import { mountDemoEntry } from './entry.js';
import { readDemoSession, writeDemoSession, clearDemoSession, demoRequest } from './session.js';

const params = new URLSearchParams(location.hash.slice(1));
let invite = params.get('invite');
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
const root = document.querySelector('#demo-entry-root');
let saved = readDemoSession();
let mode = 'start';
let expiresAt = null;
let hostName = '';
try {
  const config = await (await fetch('/demo-config')).json();
  if (!config.enabled) location.replace('/');
  else {
    if (saved.token) {
      mode = 'resume';
      expiresAt = saved.table?.expiresAt ?? null;
      try {
        const { table } = await demoRequest('resume');
        saved = { ...saved, table };
        writeDemoSession(saved);
        expiresAt = table.expiresAt;
      } catch (error) {
        if (error.code !== 'expired') throw error;
        clearDemoSession();
        saved = {};
        mode = invite ? 'invite' : 'resume';
        expiresAt = 0;
      }
    }
    if (invite && !saved.token) {
      mode = 'invite';
      try {
        const { table } = await demoRequest('invite', { invite });
        hostName = table.name.replace(/'s table$/, '');
        expiresAt = table.expiresAt;
      } catch (error) {
        if (error.code === 'expired') expiresAt = 0;
        else throw error;
      }
    }
    mount();
  }
} catch {
  // An outage never silently turns a saved session into a new allocation.
  mount();
}
function mount() {
  mountDemoEntry(root, {
    mode,
    hostName,
    expiresAt,
    displayName: saved.table?.displayName || 'Guest',
    async onSubmit(request, options) {
      const action =
        request.action === 'start' ? 'create' : request.action === 'invite' ? 'join' : 'resume';
      const result = await demoRequest(
        action,
        { ...request, ...(action === 'join' ? { invite } : {}) },
        options,
      );
      const next = { ...readDemoSession(), ...result };
      if (action === 'join' && result.token) next.invite = invite;
      writeDemoSession(next);
      invite = null;
      location.href = `/table.html?room=${encodeURIComponent(result.table.code)}&demo=1`;
    },
  });
}
