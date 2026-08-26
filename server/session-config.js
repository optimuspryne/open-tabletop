const DEFAULT_SESSION_TTL_DAYS = 30;
const MAX_SESSION_TTL_DAYS = 365;

export function sessionTtlDays(value = process.env.SESSION_TTL_DAYS) {
  if (value == null || value === '') return DEFAULT_SESSION_TTL_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_SESSION_TTL_DAYS) {
    throw new Error(`SESSION_TTL_DAYS must be an integer from 1 to ${MAX_SESSION_TTL_DAYS}`);
  }
  return days;
}

export function sessionExpiresAt(now = new Date(), days = sessionTtlDays()) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
