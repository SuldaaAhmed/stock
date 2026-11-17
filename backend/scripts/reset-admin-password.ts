/**
 * Server-side administrative password reset (there is no public reset endpoint and no
 * forgot-password email flow). Run on the server with database access:
 *
 *   npm run admin:reset-password -- --username admin --password 'N3w-Strong-Passw0rd'
 *
 * Optionally pass --rename <newUsername>. All sessions are invalidated and the reset is audited.
 */
import { pool, withTransaction } from '../src/db/pool';
import { audit, SYSTEM } from '../src/services/audit';
import { hashPassword } from '../src/services/passwordHasher';
import { revokeAllSessions } from '../src/services/sessions';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const username = arg('username');
  const password = arg('password');
  const rename = arg('rename');
  if (!username || !password) throw new Error('Usage: --username <name> --password <newPassword> [--rename <newUsername>]');
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
  await withTransaction(async (tx) => {
    const admin = (await tx.query('SELECT id FROM admins WHERE normalized_username = $1', [username.toUpperCase()])).rows[0];
    if (!admin) throw new Error(`Admin "${username}" not found`);
    await tx.query(
      `UPDATE admins SET password_hash = $2, username = COALESCE($3, username), normalized_username = COALESCE(upper($3), normalized_username), updated_at = now() WHERE id = $1`,
      [admin.id, hashPassword(password), rename ?? null],
    );
    await revokeAllSessions(tx);
    await audit(tx, SYSTEM, { action: 'Admin.PasswordReset', entityType: 'Admin', entityId: admin.id, description: 'Administrative password reset (server-side)' });
  });
  console.log('Password reset. All sessions were invalidated.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
