/**
 * ASP.NET Core Identity compatible password hasher (PasswordHasher<TUser>, V3 format).
 *
 * Format (base64 of):  0x01 | PRF (uint32 BE) | iterations (uint32 BE) | saltLen (uint32 BE) | salt | subkey
 *   PRF 2 = HMACSHA512 (Identity default since .NET 7: 100,000 iterations, 128-bit salt, 256-bit subkey)
 *   PRF 1 = HMACSHA256 (Identity .NET Core 2-6: 10,000 iterations) – accepted for verification.
 *
 * Hashes produced here verify in ASP.NET Core Identity and vice versa, so the Admin
 * credential remains portable to the ASP.NET Core stack named in the requirements.
 */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const PRF: Record<number, string> = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const SUBKEY_BYTES = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const subkey = pbkdf2Sync(password, salt, ITERATIONS, SUBKEY_BYTES, 'sha512');
  const out = Buffer.alloc(13 + salt.length + subkey.length);
  out[0] = 0x01;
  out.writeUInt32BE(2, 1);
  out.writeUInt32BE(ITERATIONS, 5);
  out.writeUInt32BE(salt.length, 9);
  salt.copy(out, 13);
  subkey.copy(out, 13 + salt.length);
  return out.toString('base64');
}

export function verifyPassword(hash: string, password: string): boolean {
  let buf: Buffer;
  try {
    buf = Buffer.from(hash, 'base64');
  } catch {
    return false;
  }
  if (buf.length < 13 || buf[0] !== 0x01) return false;
  const prf = PRF[buf.readUInt32BE(1)];
  const iterations = buf.readUInt32BE(5);
  const saltLen = buf.readUInt32BE(9);
  if (!prf || saltLen < 16 || 13 + saltLen >= buf.length) return false;
  const salt = buf.subarray(13, 13 + saltLen);
  const expected = buf.subarray(13 + saltLen);
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, prf);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Dummy verification to equalise timing when the username does not exist. */
export const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));
