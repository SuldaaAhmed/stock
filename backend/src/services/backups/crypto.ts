import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { config } from '../../config';

const MAGIC = Buffer.from('STKBK1');

/** gzip + AES-256-GCM. Layout: MAGIC(6) | IV(12) | TAG(16) | ciphertext */
export function sealBackup(json: string, keyHex = config.backupEncryptionKey): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const ct = Buffer.concat([cipher.update(gzipSync(Buffer.from(json, 'utf8'))), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function openBackup(buf: Buffer, keyHex = config.backupEncryptionKey): string {
  if (buf.length < 34 || !buf.subarray(0, 6).equals(MAGIC)) throw new Error('Not a stock backup file');
  const key = Buffer.from(keyHex, 'hex');
  const iv = buf.subarray(6, 18);
  const tag = buf.subarray(18, 34);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(buf.subarray(34)), decipher.final()]);
  return gunzipSync(plain).toString('utf8');
}
