import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../config';
import { Db, one, pool } from '../db/pool';

export const SESSION_COOKIE = 'stock.sid';

export function hashToken(token: string): string {
  return createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

export async function createSession(db: Db, adminId: string, securityStamp: string, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const absolute = new Date(now + config.sessionAbsoluteHours * 3600_000);
  const sliding = new Date(Math.min(now + config.sessionSlidingMinutes * 60_000, absolute.getTime()));
  const row = await one(
    db,
    `INSERT INTO admin_sessions(token_hash, admin_id, security_stamp, expires_at, absolute_expires_at, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, expires_at, absolute_expires_at`,
    [hashToken(token), adminId, securityStamp, sliding, absolute, ip ?? null, userAgent?.slice(0, 300) ?? null],
  );
  return { token, sessionId: row.id as string, expiresAt: row.expires_at as Date, absoluteExpiresAt: absolute };
}

export interface ValidSession {
  sessionId: string;
  adminId: string;
  username: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

/** Validates a session token, applying sliding expiration (capped by the absolute maximum). */
export async function validateSession(token: string): Promise<ValidSession | null> {
  const row = await one(
    pool,
    `SELECT s.id, s.admin_id, s.expires_at, s.absolute_expires_at, s.last_seen_at, a.username
       FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL
        AND s.security_stamp = a.security_stamp
        AND s.expires_at > now() AND s.absolute_expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) return null;
  let expiresAt: Date = row.expires_at;
  // Slide at most once per minute to limit writes.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    const next = new Date(Math.min(Date.now() + config.sessionSlidingMinutes * 60_000, new Date(row.absolute_expires_at).getTime()));
    await pool.query('UPDATE admin_sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1', [row.id, next]);
    expiresAt = next;
  }
  return {
    sessionId: row.id,
    adminId: row.admin_id,
    username: row.username,
    expiresAt,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.query('UPDATE admin_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

/** Invalidate every session (used after restore and admin password reset). */
export async function revokeAllSessions(db: Db) {
  await db.query('UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL');
  await db.query('UPDATE admins SET security_stamp = gen_random_uuid(), updated_at = now()');
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
    maxAge: config.sessionAbsoluteHours * 3600_000,
  } as const;
}
