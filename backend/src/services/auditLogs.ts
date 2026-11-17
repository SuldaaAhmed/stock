import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { badRequest, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { orderBy, Sql } from '../utils/sql';

/**
 * Decision 4 (applied default): the Admin may edit only the `description` and `note`
 * fields of an audit entry, and may soft-delete entries. Every edit/delete writes an
 * immutable audit_log_corrections record (old/new values, Admin, timestamp, reason).
 */
export const EDITABLE_AUDIT_FIELDS = ['description', 'note'] as const;

function map(r: any) {
  return {
    id: r.id,
    occurredAt: r.occurred_at,
    adminId: r.admin_id,
    actor: r.actor,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    requestId: r.request_id,
    ipAddress: r.ip_address,
    description: r.description,
    note: r.note,
    oldData: r.old_data,
    newData: r.new_data,
    isDeleted: r.is_deleted,
    deletedAt: r.deleted_at,
    editedAt: r.edited_at,
  };
}

export async function listAuditLogs(db: Db, q: ListQuery & { includeDeleted?: boolean; entityType?: string; action?: string }) {
  const w = new Sql();
  if (!q.includeDeleted) w.and('NOT a.is_deleted');
  if (q.entityType) w.and(`a.entity_type = ${w.p(q.entityType)}`);
  if (q.action || q.type) w.and(`a.action ILIKE ${w.p(`${q.action ?? q.type}%`)}`);
  if (q.period || q.from || q.to) w.period(`(a.occurred_at AT TIME ZONE 'Africa/Nairobi')::date`, q);
  w.search(q.search, ['a.action', 'a.entity_type', 'a.entity_id', 'a.description', 'a.actor', 'a.note']);
  const order = orderBy(q.sort, { occurredAt: 'a.occurred_at', action: 'a.action', entityType: 'a.entity_type' }, 'a.occurred_at DESC, a.id DESC');
  const total = (await db.query(`SELECT count(*)::int n FROM audit_logs a ${w.where()}`, w.params)).rows[0].n;
  const rows = (await db.query(`SELECT a.* FROM audit_logs a ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`, w.params)).rows;
  return { items: rows.map(map), meta: pageMeta(q.page, q.pageSize, total) };
}

async function load(db: Db, id: string, lock = false) {
  const r = (await db.query(`SELECT * FROM audit_logs WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!r) throw notFound('Audit log entry');
  return r;
}

export async function getAuditLog(db: Db, id: string) {
  const r = await load(db, id);
  const corrections = (await db.query('SELECT c.*, a.username FROM audit_log_corrections c LEFT JOIN admins a ON a.id = c.admin_id WHERE audit_log_id = $1 ORDER BY c.id', [id])).rows;
  return { ...map(r), corrections: corrections.map(mapCorrection) };
}

export async function editAuditLog(tx: Db, actor: Actor, id: string, input: { description?: string | null; note?: string | null; reason: string }) {
  const r = await load(tx, id, true);
  if (r.is_deleted) throw badRequest('Deleted audit entries cannot be edited.');
  const oldV: Record<string, unknown> = {};
  const newV: Record<string, unknown> = {};
  for (const f of EDITABLE_AUDIT_FIELDS) {
    if (input[f] !== undefined && input[f] !== r[f]) {
      oldV[f] = r[f];
      newV[f] = input[f];
    }
  }
  if (!Object.keys(newV).length) throw badRequest('No changes were supplied.', [{ field: 'body', message: `Editable fields: ${EDITABLE_AUDIT_FIELDS.join(', ')}` }]);
  await tx.query(
    `UPDATE audit_logs SET description = CASE WHEN $2 THEN $3 ELSE description END, note = CASE WHEN $4 THEN $5 ELSE note END, edited_at = now() WHERE id = $1`,
    [id, 'description' in newV, newV.description ?? null, 'note' in newV, newV.note ?? null],
  );
  await tx.query(`INSERT INTO audit_log_corrections(audit_log_id, operation, old_values, new_values, reason, admin_id) VALUES ($1,'Edit',$2,$3,$4,$5)`, [
    id,
    JSON.stringify(oldV),
    JSON.stringify(newV),
    input.reason,
    actor.adminId,
  ]);
  return getAuditLog(tx, id);
}

export async function deleteAuditLog(tx: Db, actor: Actor, id: string, reason: string) {
  const r = await load(tx, id, true);
  if (r.is_deleted) throw badRequest('This audit entry is already deleted.');
  await tx.query('UPDATE audit_logs SET is_deleted = true, deleted_at = now() WHERE id = $1', [id]);
  await tx.query(`INSERT INTO audit_log_corrections(audit_log_id, operation, old_values, new_values, reason, admin_id) VALUES ($1,'Delete',$2,$3,$4,$5)`, [
    id,
    JSON.stringify({ isDeleted: false, entry: map(r) }),
    JSON.stringify({ isDeleted: true }),
    reason,
    actor.adminId,
  ]);
}

function mapCorrection(r: any) {
  return {
    id: r.id,
    auditLogId: r.audit_log_id,
    operation: r.operation,
    oldValues: r.old_values,
    newValues: r.new_values,
    reason: r.reason,
    adminId: r.admin_id,
    admin: r.username,
    createdAt: r.created_at,
  };
}

export async function listAuditCorrections(db: Db, q: ListQuery & { auditLogId?: number }) {
  const w = new Sql();
  if (q.auditLogId) w.and(`c.audit_log_id = ${w.p(q.auditLogId)}`);
  if (q.type) w.and(`c.operation = ${w.p(q.type)}`);
  if (q.period || q.from || q.to) w.period(`(c.created_at AT TIME ZONE 'Africa/Nairobi')::date`, q);
  w.search(q.search, ['c.reason']);
  const total = (await db.query(`SELECT count(*)::int n FROM audit_log_corrections c ${w.where()}`, w.params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT c.*, a.username FROM audit_log_corrections c LEFT JOIN admins a ON a.id = c.admin_id ${w.where()} ORDER BY c.id DESC ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(mapCorrection), meta: pageMeta(q.page, q.pageSize, total) };
}
