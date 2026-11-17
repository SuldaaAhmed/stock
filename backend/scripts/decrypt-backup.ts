/**
 * Decrypt a downloaded backup file (.stkbak) into readable JSON for inspection/off-site use.
 * Requires the same BACKUP_ENCRYPTION_KEY that the server used.
 *
 *   npm run backup:decrypt -- backup-file.stkbak output.json
 */
import fs from 'node:fs';
import { openBackup } from '../src/services/backups/crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: npm run backup:decrypt -- <backup.stkbak> <output.json>');
  process.exit(1);
}
fs.writeFileSync(output, openBackup(fs.readFileSync(input)), { mode: 0o600 });
console.log(`Decrypted to ${output}`);
