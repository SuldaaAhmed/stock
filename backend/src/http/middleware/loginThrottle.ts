import { config } from '../../config';

/**
 * Login rate limiting with progressive delay (no permanent lockout).
 * Keyed by client IP + username: after `loginMaxFreeAttempts` failures each further attempt
 * must wait 2^(n-free) seconds, capped at `loginMaxDelaySeconds`. A successful login
 * clears the key. Because keys include the IP, an attacker cannot lock the single Admin
 * out from the Admin's own network location, and delays always expire.
 */
interface Entry {
  failures: number;
  nextAllowedAt: number;
  lastFailureAt: number;
}
const entries = new Map<string, Entry>();

function keyOf(ip: string | undefined, username: string) {
  return `${ip ?? 'unknown'}|${username.trim().toUpperCase()}`;
}

/** Returns seconds to wait, or 0 if an attempt is allowed now. */
export function loginRetryAfter(ip: string | undefined, username: string): number {
  const e = entries.get(keyOf(ip, username));
  if (!e) return 0;
  const wait = e.nextAllowedAt - Date.now();
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

export function recordLoginFailure(ip: string | undefined, username: string) {
  const k = keyOf(ip, username);
  const e = entries.get(k) ?? { failures: 0, nextAllowedAt: 0, lastFailureAt: 0 };
  // forget stale failures after 1 hour of quiet
  if (Date.now() - e.lastFailureAt > 3600_000) e.failures = 0;
  e.failures += 1;
  e.lastFailureAt = Date.now();
  const over = e.failures - config.loginMaxFreeAttempts;
  if (over >= 0) {
    const delay = Math.min(2 ** over, config.loginMaxDelaySeconds);
    e.nextAllowedAt = Date.now() + delay * 1000;
  }
  entries.set(k, e);
  if (entries.size > 10_000) {
    for (const [key, val] of entries) if (Date.now() - val.lastFailureAt > 3600_000) entries.delete(key);
  }
}

export function recordLoginSuccess(ip: string | undefined, username: string) {
  entries.delete(keyOf(ip, username));
}

export function resetLoginThrottle() {
  entries.clear();
}
