// Demo identity is deliberately separate from the ordinary administrator login.
const KEY = 'tabletop.demo.session';
export function readDemoSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
export function writeDemoSession(value) {
  localStorage.setItem(KEY, JSON.stringify(value));
}
export function clearDemoSession() {
  localStorage.removeItem(KEY);
}
export async function demoRequest(action, body = {}, { signal } = {}) {
  const token = readDemoSession().token;
  const response = await fetch(`/demo-api/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error('Demo request failed.'), {
      code: result.code || (response.status === 429 ? 'rate_limited' : 'unavailable'),
    });
  return result;
}
