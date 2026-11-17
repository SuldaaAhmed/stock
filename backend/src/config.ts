import 'dotenv/config';
import path from 'node:path';

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing required environment variable ${name}`);
    return fallback;
  }
  return v;
}
function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number`);
  return n;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const env = process.env.NODE_ENV ?? 'development';
const isProduction = env === 'production';
const isTest = env === 'test';

const devSecret = 'dev-only-insecure-secret-change-me-0123456789';

export const config = {
  env,
  isProduction,
  isTest,
  isDevelopment: !isProduction && !isTest,
  port: num('PORT', 5000),
  host: str('HOST', '0.0.0.0'),
  databaseUrl: str('DATABASE_URL', 'postgres://stock:stock@127.0.0.1:5433/stock'),
  timeZone: 'Africa/Nairobi',
  currency: 'KES',
  unit: 'BOX',

  sessionSecret: isProduction ? str('SESSION_SECRET') : str('SESSION_SECRET', devSecret),
  csrfSecret: isProduction ? str('CSRF_SECRET') : str('CSRF_SECRET', devSecret + '-csrf'),
  csrfEnabled: bool('CSRF_ENABLED', true),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cookieSameSite: (str('COOKIE_SAMESITE', 'Lax').toLowerCase() as 'lax' | 'strict' | 'none'),
  cookieSecure: bool('COOKIE_SECURE', isProduction),
  sessionSlidingMinutes: num('SESSION_SLIDING_MINUTES', 60),
  sessionAbsoluteHours: num('SESSION_ABSOLUTE_HOURS', 12),
  swaggerEnabled: bool('SWAGGER_ENABLED', true),

  adminUsername: str('ADMIN_USERNAME', 'admin'),
  adminPassword: process.env.ADMIN_PASSWORD ?? (isProduction ? '' : 'ChangeMe!2026'),

  storageDir: path.resolve(str('STORAGE_DIR', './storage')),
  logoMaxBytes: num('LOGO_MAX_BYTES', 2 * 1024 * 1024),
  backupEncryptionKey: str(
    'BACKUP_ENCRYPTION_KEY',
    isProduction ? undefined : '0000000000000000000000000000000000000000000000000000000000000000',
  ),
  backupScheduleEnabled: bool('BACKUP_SCHEDULE_ENABLED', !isTest),
  reconciliationIntervalMinutes: num('RECONCILIATION_INTERVAL_MINUTES', 60),
  idempotencyRetentionHours: num('IDEMPOTENCY_RETENTION_HOURS', 24),
  loginMaxFreeAttempts: num('LOGIN_MAX_FREE_ATTEMPTS', 5),
  loginMaxDelaySeconds: num('LOGIN_MAX_DELAY_SECONDS', 300),
  logLevel: str('LOG_LEVEL', isTest ? 'silent' : 'info'),
};

if (config.isProduction) {
  if (!config.cookieSecure) throw new Error('COOKIE_SECURE must be true in production');
  if (/^0+$/.test(config.backupEncryptionKey)) throw new Error('Set a real BACKUP_ENCRYPTION_KEY in production');
}
if (config.cookieSameSite === 'none' && !config.cookieSecure) {
  throw new Error('COOKIE_SAMESITE=None requires COOKIE_SECURE=true');
}
if (!/^[0-9a-fA-F]{64}$/.test(config.backupEncryptionKey)) {
  throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
}
