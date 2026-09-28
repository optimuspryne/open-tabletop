// Shared UX/server contract; password confirmation prevents accidental typos.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export function passwordError(password, confirmation) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (password !== confirmation) return 'Passwords do not match.';
  return '';
}
