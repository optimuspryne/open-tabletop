// Browser session storage. Read at use time so account changes in another tab are visible.
const TOKEN_KEY = 'tabletop.token';

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setAuthToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearAuthToken = () => localStorage.removeItem(TOKEN_KEY);
