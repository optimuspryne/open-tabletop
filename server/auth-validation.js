export const validUsername = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{3,20}$/.test(value.trim());
export const validEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
