import { getAuthToken } from './auth.js';

// JSON requests shared by the lobby and admin console. Authentication is opt-in;
// callers with always-authenticated endpoints pin auth: true in their local adapter.
export async function requestJSON(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = 'Bearer ' + getAuthToken();
  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* no/invalid body */
  }
  if (!response.ok) throw new Error(data.error || `request failed (${response.status})`);
  return data;
}
