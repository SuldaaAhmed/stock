import type { Db } from '../db/pool';
import type { Actor } from '../http/context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  description?: string;
  oldData?: unknown;
  newData?: unknown;
}

export interface SystemActor {
  adminId: null;
  username: 'system';
  requestId?: string;
  ip?: string;
}
export const SYSTEM: SystemActor = { adminId: null, username: 'system' };

/** Writes an audit event. Callers pass the transaction so audit is atomic with the change. */
export async function audit(db: Db, actor: Actor | SystemActor | { adminId: string | null; username: string; requestId?: string; ip?: string }, entry: AuditEntry) {
  await db.query(
    `INSERT INTO audit_logs(admin_id, actor, action, entity_type, entity_id, request_id, ip_address, description, old_data, new_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      actor.adminId,
      actor.username,
      entry.action,
      entry.entityType,
      entry.entityId == null ? null : String(entry.entityId),
      actor.requestId ?? null,
      actor.ip ?? null,
      entry.description ?? null,
      entry.oldData === undefined ? null : JSON.stringify(entry.oldData),
      entry.newData === undefined ? null : JSON.stringify(entry.newData),
    ],
  );
}

/** Returns only the keys whose values changed: { old: {...}, new: {...} }. */
export function diff(oldObj: Record<string, unknown>, newObj: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  const n: Record<string, unknown> = {};
  for (const k of Object.keys(newObj)) {
    if (newObj[k] === undefined) continue;
    if (JSON.stringify(oldObj[k] ?? null) !== JSON.stringify(newObj[k] ?? null)) {
      o[k] = oldObj[k] ?? null;
      n[k] = newObj[k] ?? null;
    }
  }
  return { old: o, new: n, changed: Object.keys(n).length > 0 };
}
