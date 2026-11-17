import { createHash } from 'node:crypto';
import { pool, withTransaction } from '../../db/pool';
import { latestSchemaVersion } from '../../db/migrate';
import { AppError, businessRule, conflict, notFound } from '../../http/errors';
import { maintenance } from '../../http/middleware/maintenance';
import { pageMeta } from '../../http/respond';
import { logger } from '../../logger';
import { audit } from '../audit';
import { readFileObject, writeFileObject } from '../files';
import { reconcile } from '../reconciliation';
import { revokeAllSessions } from '../sessions';
import { openBackup, sealBackup } from './crypto';
import { getBackupProvider } from './provider';

/**
 * Backup scope (decision 6 default): the full business database + stored logo files.
 * Tables are listed in FK-safe order. Operational tables are excluded on purpose:
 *  - backup_logs           (must survive a restore)
 *  - admin_sessions        (all sessions are invalidated by a restore)
 *  - idempotency_records   (transient)
 *  - schema_migrations     (schema version is checked instead)
 */
export const BACKUP_TABLES = [
  'admins',
  'admin_preferences',
  'stored_files',
  'company_settings',
  'document_counters',
  'products',
  'product_balances',
  'product_edit_history',
  'product_price_history',
  'opening_stock_corrections',
  'customers',
  'customer_edit_history',
  'receipts',
  'stock_ins',
  'stock_in_lines',
  'orders',
  'order_lines',
  'order_edit_history',
  'stock_outs',
  'stock_out_lines',
  'deliveries',
  'delivery_lines',
  'returns',
  'return_lines',
  'adjustments',
  'damaged_stock_actions',
  'stock_movements',
  'audit_logs',
  'audit_log_corrections',
  'reconciliation_runs',
] as const;
const IDENTITY_TABLES = ['stock_movements', 'audit_logs', 'audit_log_corrections'];
const LOCK_KEY = 727275;

interface BackupFile {
  format: 'stock-management-backup';
  formatVersion: 1;
  schemaVersion: string;
  createdAt: string;
  tables: Record<string, unknown[]>;
  files: { storageKey: string; base64: string }[];
}

let running = false;

export type BackupActor = { adminId: string | null; username: string; requestId?: string; ip?: string };

function mapLog(r: any) {
  return {
    id: r.id,
    operation: r.operation,
    trigger: r.trigger_type,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    error: r.error,
    actor: r.actor,
    storageProvider: r.storage_provider,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    schemaVersion: r.schema_version,
    sourceBackupId: r.source_backup_id,
    details: r.details,
    downloadUrl: r.operation === 'Backup' && r.status === 'Succeeded' ? `/api/v1/backups/${r.id}/download` : null,
  };
}

export async function listBackupLogs(q: { page: number; pageSize: number; type?: string; status?: string }) {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (q.type) {
    params.push(q.type);
    conds.push(`(operation = $${params.length} OR trigger_type = $${params.length})`);
  }
  if (q.status) {
    params.push(q.status);
    conds.push(`status = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = (await pool.query(`SELECT count(*)::int n FROM backup_logs ${where}`, params)).rows[0].n;
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const rows = (await pool.query(`SELECT * FROM backup_logs ${where} ORDER BY started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  return { items: rows.map(mapLog), meta: pageMeta(q.page, q.pageSize, total) };
}

export async function getBackupLog(id: string) {
  const r = (await pool.query('SELECT * FROM backup_logs WHERE id = $1', [id])).rows[0];
  if (!r) throw notFound('Backup');
  return mapLog(r);
}

async function acquire(): Promise<() => Promise<void>> {
  if (running) throw conflict('Another backup or restore is already running.', 'BACKUP_IN_PROGRESS');
  const client = await pool.connect();
  const got = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0].ok;
  if (!got) {
    client.release();
    throw conflict('Another backup or restore is already running.', 'BACKUP_IN_PROGRESS');
  }
  running = true;
  return async () => {
    running = false;
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  };
}

async function dumpDatabase(): Promise<BackupFile> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); // consistent snapshot
    const tables: Record<string, unknown[]> = {};
    for (const t of BACKUP_TABLES) {
      tables[t] = (await client.query(`SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) AS rows FROM ${t} x`)).rows[0].rows;
    }
    const fileRows = (await client.query('SELECT storage_key FROM stored_files')).rows;
    await client.query('COMMIT');
    const files: BackupFile['files'] = [];
    for (const f of fileRows) {
      const data = await readFileObject(f.storage_key);
      if (data) files.push({ storageKey: f.storage_key, base64: data.toString('base64') });
    }
    return { format: 'stock-management-backup', formatVersion: 1, schemaVersion: latestSchemaVersion(), createdAt: new Date().toISOString(), tables, files };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function runBackupLocked(trigger: 'Manual' | 'Automatic' | 'PreRestore', actor: BackupActor) {
  const provider = getBackupProvider();
  const log = (
    await pool.query(
      `INSERT INTO backup_logs(operation, trigger_type, status, actor_admin_id, actor, storage_provider, schema_version)
       VALUES ('Backup',$1,'Running',$2,$3,$4,$5) RETURNING *`,
      [trigger, actor.adminId, actor.username, provider.name, latestSchemaVersion()],
    )
  ).rows[0];
  try {
    const dump = await dumpDatabase();
    const sealed = sealBackup(JSON.stringify(dump));
    const key = `backup-${dump.createdAt.replace(/[:.]/g, '-')}-${log.id}.stkbak`;
    await provider.put(key, sealed);
    const details = Object.fromEntries(Object.entries(dump.tables).map(([t, rows]) => [t, rows.length]));
    const done = (
      await pool.query(
        `UPDATE backup_logs SET status='Succeeded', completed_at=now(), storage_key=$2, size_bytes=$3, sha256=$4,
                details=$5 WHERE id=$1 RETURNING *`,
        [log.id, key, sealed.length, createHash('sha256').update(sealed).digest('hex'), JSON.stringify({ rowCounts: details, files: dump.files.length })],
      )
    ).rows[0];
    await audit(pool, actor, { action: `Backup.${trigger}`, entityType: 'Backup', entityId: log.id, newData: { status: 'Succeeded', sizeBytes: sealed.length } });
    return mapLog(done);
  } catch (err: any) {
    logger.error({ err }, 'Backup failed');
    await pool.query(`UPDATE backup_logs SET status='Failed', completed_at=now(), error=$2 WHERE id=$1`, [log.id, String(err?.message ?? err).slice(0, 1000)]);
    await audit(pool, actor, { action: `Backup.${trigger}`, entityType: 'Backup', entityId: log.id, newData: { status: 'Failed' } }).catch(() => undefined);
    throw new AppError(500, 'BACKUP_FAILED', 'The backup failed. See the backup log for details.');
  }
}

/** Manual or automatic backup. Overlapping runs are prevented (in-process flag + advisory lock). */
export async function runBackup(trigger: 'Manual' | 'Automatic', actor: BackupActor) {
  const release = await acquire();
  try {
    return await runBackupLocked(trigger, actor);
  } finally {
    await release();
  }
}

export async function downloadBackup(id: string) {
  const log = (await pool.query('SELECT * FROM backup_logs WHERE id = $1', [id])).rows[0];
  if (!log || log.operation !== 'Backup') throw notFound('Backup');
  if (log.status !== 'Succeeded') throw businessRule('BACKUP_NOT_AVAILABLE', 'Only successful backups can be downloaded.');
  const data = await getBackupProvider().get(log.storage_key);
  return { data, fileName: log.storage_key as string };
}

/**
 * Restore a backup. Steps: validate file → pre-restore backup → maintenance mode →
 * single transaction (truncate + reload + restore audit entry) → restore logo files →
 * invalidate sessions → reconcile balances against the ledger → leave maintenance mode.
 * Any failure rolls the database transaction back, leaving the current data intact.
 */
export async function restoreBackup(id: string, actor: BackupActor) {
  const release = await acquire();
  let restoreLogId: string | null = null;
  try {
    const src = (await pool.query('SELECT * FROM backup_logs WHERE id = $1', [id])).rows[0];
    if (!src || src.operation !== 'Backup') throw notFound('Backup');
    if (src.status !== 'Succeeded') throw businessRule('BACKUP_NOT_AVAILABLE', 'Only successful backups can be restored.');

    // 1. Load and validate before touching anything.
    let dump: BackupFile;
    try {
      const raw = await getBackupProvider().get(src.storage_key);
      if (src.sha256 && createHash('sha256').update(raw).digest('hex') !== src.sha256) throw new Error('Checksum mismatch');
      dump = JSON.parse(openBackup(raw));
    } catch (err: any) {
      throw businessRule('BACKUP_UNREADABLE', `The backup file could not be read or verified (${err?.message ?? 'unknown error'}).`);
    }
    if (dump.format !== 'stock-management-backup' || dump.schemaVersion !== latestSchemaVersion()) {
      throw businessRule('BACKUP_INCOMPATIBLE', `Backup schema ${dump.schemaVersion} does not match the current schema ${latestSchemaVersion()}.`);
    }

    // 2. Pre-restore safety backup.
    const pre = await runBackupLocked('PreRestore', actor);

    restoreLogId = (
      await pool.query(
        `INSERT INTO backup_logs(operation, trigger_type, status, actor_admin_id, actor, storage_provider, schema_version, source_backup_id, details)
         VALUES ('Restore','Restore','Running',$1,$2,$3,$4,$5,$6) RETURNING id`,
        [actor.adminId, actor.username, getBackupProvider().name, dump.schemaVersion, id, JSON.stringify({ preRestoreBackupId: pre.id })],
      )
    ).rows[0].id as string;

    // 3. Maintenance mode: other requests are rejected with 503.
    maintenance.active = true;
    maintenance.reason = 'A backup restore is in progress. Please try again shortly.';

    await withTransaction(async (tx) => {
      await tx.query('SET CONSTRAINTS ALL DEFERRED');
      await tx.query(`TRUNCATE ${[...BACKUP_TABLES, 'admin_sessions', 'idempotency_records'].join(', ')}`);
      for (const t of BACKUP_TABLES) {
        const rows = dump.tables[t] ?? [];
        if (!rows.length) continue;
        await tx.query(`INSERT INTO ${t} SELECT * FROM json_populate_recordset(NULL::${t}, $1::json)`, [JSON.stringify(rows)]);
      }
      for (const t of IDENTITY_TABLES) {
        await tx.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
      }
      // Restore event recorded in the RESTORED database's audit log.
      await audit(tx, { ...actor, adminId: actor.adminId && dump.tables.admins.some((a: any) => a.id === actor.adminId) ? actor.adminId : null }, {
        action: 'Backup.Restore',
        entityType: 'Backup',
        entityId: id,
        description: `Database restored from backup ${id} (pre-restore backup ${pre.id}) by ${actor.username}`,
        newData: { sourceBackupId: id, preRestoreBackupId: pre.id, backupCreatedAt: dump.createdAt },
      });
      await revokeAllSessions(tx);
    });

    // 4. Restore logo files (existing files are kept; nothing is deleted).
    for (const f of dump.files) await writeFileObject(f.storageKey, Buffer.from(f.base64, 'base64'));

    // 5. Reconcile balances against the ledger.
    const rec = await reconcile('PostRestore');
    await pool.query(`UPDATE backup_logs SET status='Succeeded', completed_at=now(), details = details || $2::jsonb WHERE id=$1`, [
      restoreLogId,
      JSON.stringify({ reconciliationMismatches: rec.mismatchCount }),
    ]);
    return { ...(await getBackupLog(restoreLogId)), reconciliation: { mismatchCount: rec.mismatchCount, productsChecked: rec.productsChecked } };
  } catch (err: any) {
    if (restoreLogId) {
      await pool
        .query(`UPDATE backup_logs SET status='Failed', completed_at=now(), error=$2 WHERE id=$1`, [restoreLogId, String(err?.message ?? err).slice(0, 1000)])
        .catch(() => undefined);
      logger.error({ err }, 'Restore failed; database transaction rolled back');
    }
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'RESTORE_FAILED', 'The restore failed and was rolled back. See the backup log for details.');
  } finally {
    maintenance.active = false;
    maintenance.reason = '';
    await release();
  }
}
