import { readDemoSession } from './demo/session.js';

// Browser session storage. Read at use time so account changes in another tab are visible.
const TOKEN_KEY = 'tabletop.token';

export const getAuthToken = () => {
  const demoTable =
    typeof location !== 'undefined' &&
    location.pathname.endsWith('/table.html') &&
    new URLSearchParams(location.search).get('demo') === '1';
  return demoTable ? readDemoSession().token || '' : localStorage.getItem(TOKEN_KEY) || '';
};
export const setAuthToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearAuthToken = () => localStorage.removeItem(TOKEN_KEY);
