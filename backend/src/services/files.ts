import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import type { Db } from '../db/pool';

/**
 * File/logo storage adapter (local filesystem under STORAGE_DIR/files).
 * Swap this module for an object-storage adapter when the hosting provider is chosen.
 */
const root = () => path.join(config.storageDir, 'files');

function safePath(key: string) {
  if (!/^[a-z]+\/[0-9a-f-]{36}\.(png|jpg)$/.test(key)) throw new Error('Invalid storage key');
  return path.join(root(), key);
}

export async function writeFileObject(key: string, data: Buffer) {
  const p = safePath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data, { mode: 0o600 });
}

export async function readFileObject(key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(safePath(key));
  } catch {
    return null;
  }
}

export async function deleteFileObject(key: string) {
  await fs.rm(safePath(key), { force: true });
}

/** Detect image type from magic bytes; only PNG and JPEG are accepted (no SVG). */
export function sniffImage(buf: Buffer): { contentType: string; ext: 'png' | 'jpg' } | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', ext: 'png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
  return null;
}

export async function storeLogo(db: Db, adminId: string, buf: Buffer, originalName: string | undefined, type: { contentType: string; ext: string }) {
  const id = randomUUID();
  const key = `logos/${id}.${type.ext}`;
  await writeFileObject(key, buf);
  await db.query(
    `INSERT INTO stored_files(id, kind, original_name, content_type, size_bytes, sha256, storage_key, created_by)
     VALUES ($1,'Logo',$2,$3,$4,$5,$6,$7)`,
    [id, originalName?.slice(0, 200) ?? null, type.contentType, buf.length, createHash('sha256').update(buf).digest('hex'), key, adminId],
  );
  return { id, key };
}

export async function loadStoredFile(db: Db, id: string | null | undefined) {
  if (!id) return null;
  const r = (await db.query('SELECT * FROM stored_files WHERE id = $1', [id])).rows[0];
  if (!r) return null;
  const data = await readFileObject(r.storage_key);
  return data ? { data, contentType: r.content_type as string, row: r } : null;
}
