import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { getUtcTimestamp } from '../utils/date';

export interface LogAuditParams {
  actorType?: 'Admin' | 'System';
  adminId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  description?: string;
  oldData?: any;
  newData?: any;
  requestId?: string;
  ipAddress?: string;
}

export function logAudit(params: LogAuditParams) {
  const id = uuidv4();
  const now = getUtcTimestamp();
  db.prepare(`
    INSERT INTO AuditLogs (
      Id, ActorType, AdminId, Action, EntityType, EntityId, Description,
      OldData, NewData, RequestId, IpAddress, OccurredAtUtc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.actorType || 'Admin',
    params.adminId || null,
    params.action,
    params.entityType,
    params.entityId || null,
    params.description || null,
    params.oldData ? JSON.stringify(params.oldData) : null,
    params.newData ? JSON.stringify(params.newData) : null,
    params.requestId || null,
    params.ipAddress || null,
    now
  );
  return id;
}

export interface LogEditHistoryItem {
  fieldName: string;
  oldValue: any;
  newValue: any;
}

export function logEditHistory(
  entityType: string,
  entityId: string,
  changes: LogEditHistoryItem[],
  adminId: string,
  reason?: string
) {
  const changeGroupId = uuidv4();
  const now = getUtcTimestamp();

  const insertStmt = db.prepare(`
    INSERT INTO EditHistory (
      Id, EntityType, EntityId, ChangeGroupId, FieldName, OldValue, NewValue, Reason, ChangedAtUtc, ChangedByAdminId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of changes) {
    insertStmt.run(
      uuidv4(),
      entityType,
      entityId,
      changeGroupId,
      c.fieldName,
      c.oldValue !== undefined && c.oldValue !== null ? String(c.oldValue) : null,
      c.newValue !== undefined && c.newValue !== null ? String(c.newValue) : null,
      reason || null,
      now,
      adminId
    );
  }
}
