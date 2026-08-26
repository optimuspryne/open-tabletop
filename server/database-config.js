import fs from 'fs';

// Resolve either a complete URL (literal or Docker-secret file) or construct one
// from non-secret connection metadata plus a password file. Prefix is '' for the
// app role and 'MIGRATE_' for the owner/DDL role.
export function databaseConnectionString({ env = process.env, prefix = '', required = true, readFile = fs.readFileSync } = {}) {
  const key = (name) => `${prefix}${name}`;
  const urlFile = env[key('DATABASE_URL_FILE')];
  if (urlFile) return String(readFile(urlFile, 'utf8')).trim();
  if (env[key('DATABASE_URL')]) return env[key('DATABASE_URL')];

  const componentKeys = ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD_FILE'];
  const configured = componentKeys.some((name) => env[key(name)]);
  if (configured) {
    const host = String(env[key('DATABASE_HOST')] || '').trim();
    const port = String(env[key('DATABASE_PORT')] || '5432').trim();
    const database = String(env[key('DATABASE_NAME')] || '').trim();
    const user = String(env[key('DATABASE_USER')] || '').trim();
    const passwordFile = String(env[key('DATABASE_PASSWORD_FILE')] || '').trim();
    if (!host || !database || !user || !passwordFile || !/^\d+$/.test(port)) {
      throw new Error(`${prefix || 'APP_'} database component configuration is incomplete.`);
    }
    const password = String(readFile(passwordFile, 'utf8')).replace(/[\r\n]+$/, '');
    if (!password) throw new Error(`${key('DATABASE_PASSWORD_FILE')} is empty.`);
    const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${urlHost}:${port}/${encodeURIComponent(database)}`;
  }

  if (!required) return null;
  throw new Error(`Database not configured: set ${key('DATABASE_URL')}, ${key('DATABASE_URL_FILE')}, or password-file connection components.`);
}
