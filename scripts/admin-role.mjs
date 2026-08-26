import * as db from '../db.js';

const action = process.argv[2];
const login = String(process.argv[3] || '').trim();
if (!['grant', 'revoke'].includes(action) || !login) {
  console.error('Usage: npm run admin:grant -- <username-or-email>\n       npm run admin:revoke -- <username-or-email>');
  process.exitCode = 2;
} else {
  try {
    const user = await db.changeAdminByLogin(login, action === 'grant');
    console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} administrator: ${user.username} <${user.email}>`);
  } catch (error) {
    console.error(`Admin ${action} failed: ${error.message}`);
    process.exitCode = 1;
  }
}
await db.close();
