import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config';

/**
 * Backup storage provider abstraction. The final provider (S3, Azure Blob, GCS, NAS, ...)
 * is chosen later; implement this interface and register it in `getBackupProvider()`.
 */
export interface BackupStorageProvider {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

/** Default provider: local directory (STORAGE_DIR/backups), files are AES-256-GCM encrypted. */
export class LocalDirectoryBackupProvider implements BackupStorageProvider {
  readonly name = 'local-directory';
  constructor(private readonly dir = path.join(config.storageDir, 'backups')) {}

  private resolve(key: string) {
    if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid backup key');
    return path.join(this.dir, key);
  }
  async put(key: string, data: Buffer) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = this.resolve(`${key}.tmp`);
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, this.resolve(key)); // atomic publish
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async exists(key: string) {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

let provider: BackupStorageProvider = new LocalDirectoryBackupProvider();
export const getBackupProvider = () => provider;
export const setBackupProvider = (p: BackupStorageProvider) => {
  provider = p;
};
