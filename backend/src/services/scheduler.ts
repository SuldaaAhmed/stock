import { config } from '../config';
import { pool } from '../db/pool';
import { logger } from '../logger';
import { addDays, todayNairobi } from '../utils/dates';
import { SYSTEM } from './audit';
import { runBackup } from './backups/backupService';
import { reconcile } from './reconciliation';

const timers: NodeJS.Timeout[] = [];

/** Milliseconds until the next 00:00 in Africa/Nairobi (EAT, UTC+3, no DST). */
export function msUntilNextNairobiMidnight(now = new Date()): number {
  const tomorrow = addDays(todayNairobi(now), 1);
  return new Date(`${tomorrow}T00:00:00+03:00`).getTime() - now.getTime();
}

function scheduleDailyBackup() {
  const wait = msUntilNextNairobiMidnight();
  const t = setTimeout(async () => {
    try {
      await runBackup('Automatic', SYSTEM);
      logger.info('Automatic daily backup completed');
    } catch (err) {
      logger.error({ err }, 'Automatic daily backup failed');
    }
    scheduleDailyBackup();
  }, wait);
  t.unref();
  timers.push(t);
}

export function startSchedulers() {
  if (config.backupScheduleEnabled) scheduleDailyBackup();
  if (config.reconciliationIntervalMinutes > 0) {
    const t = setInterval(() => {
      reconcile('Scheduled').catch((err) => logger.error({ err }, 'Scheduled reconciliation failed'));
    }, config.reconciliationIntervalMinutes * 60_000);
    t.unref();
    timers.push(t);
  }
  const purge = setInterval(() => {
    pool
      .query(`DELETE FROM idempotency_records WHERE expires_at < now()`)
      .then(() => pool.query(`DELETE FROM admin_sessions WHERE absolute_expires_at < now() - interval '7 days'`))
      .catch((err) => logger.error({ err }, 'Purge job failed'));
  }, 3600_000);
  purge.unref();
  timers.push(purge);
}

export function stopSchedulers() {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
}
