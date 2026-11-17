import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { badRequest, conflict } from '../http/errors';
import { audit, diff } from './audit';
import { deleteFileObject } from './files';

function mapCompany(r: any) {
  return {
    companyName: r.company_name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    hasLogo: !!r.logo_file_id,
    logoFileId: r.logo_file_id,
    logoUrl: r.logo_file_id ? '/api/v1/settings/company/logo' : null,
    rowVersion: r.row_version,
    updatedAt: r.updated_at,
  };
}

export async function getCompany(db: Db) {
  return mapCompany((await db.query('SELECT * FROM company_settings WHERE id = 1')).rows[0]);
}

export async function updateCompany(
  tx: Db,
  actor: Actor,
  expectedVersion: number,
  input: { companyName?: string; phone?: string | null; email?: string | null; address?: string | null },
) {
  const cur = (await tx.query('SELECT * FROM company_settings WHERE id = 1 FOR UPDATE')).rows[0];
  if (cur.row_version !== expectedVersion) throw conflict('Company settings were changed by another request. Reload and try again.', 'CONCURRENCY_CONFLICT');
  const before = { companyName: cur.company_name, phone: cur.phone, email: cur.email, address: cur.address };
  const d = diff(before, input);
  if (!d.changed) throw badRequest('No changes were supplied.', [{ field: 'body', message: 'Nothing to update.' }]);
  const n = { ...before, ...d.new } as typeof before;
  await tx.query(
    'UPDATE company_settings SET company_name=$1, phone=$2, email=$3, address=$4, row_version=row_version+1, updated_at=now(), updated_by=$5 WHERE id=1',
    [n.companyName, n.phone, n.email, n.address, actor.adminId],
  );
  await audit(tx, actor, { action: 'Settings.CompanyEdit', entityType: 'CompanySettings', entityId: 1, oldData: d.old, newData: d.new });
  return getCompany(tx);
}

/** Point company settings at a newly stored logo; the previous logo is detached (and deleted only if no receipt references it). */
export async function setLogo(tx: Db, actor: Actor, fileId: string | null) {
  const cur = (await tx.query('SELECT * FROM company_settings WHERE id = 1 FOR UPDATE')).rows[0];
  const previous: string | null = cur.logo_file_id;
  await tx.query('UPDATE company_settings SET logo_file_id=$1, row_version=row_version+1, updated_at=now(), updated_by=$2 WHERE id=1', [fileId, actor.adminId]);
  let deleteKey: string | null = null;
  if (previous && previous !== fileId) {
    await tx.query('UPDATE stored_files SET detached_at = now() WHERE id = $1', [previous]);
    const referenced = (await tx.query('SELECT 1 FROM receipts WHERE logo_file_id = $1 LIMIT 1', [previous])).rowCount;
    if (!referenced) {
      const f = (await tx.query('DELETE FROM stored_files WHERE id = $1 RETURNING storage_key', [previous])).rows[0];
      deleteKey = f?.storage_key ?? null;
    }
  }
  await audit(tx, actor, {
    action: fileId ? (previous ? 'Settings.LogoReplace' : 'Settings.LogoUpload') : 'Settings.LogoRemove',
    entityType: 'CompanySettings',
    entityId: 1,
    oldData: { logoFileId: previous },
    newData: { logoFileId: fileId },
  });
  return { company: await getCompany(tx), deleteKey };
}

export async function deleteDetachedFile(key: string | null) {
  if (key) await deleteFileObject(key).catch(() => undefined);
}

export async function getPreferences(db: Db, adminId: string) {
  await db.query('INSERT INTO admin_preferences(admin_id) VALUES ($1) ON CONFLICT DO NOTHING', [adminId]);
  const r = (await db.query('SELECT * FROM admin_preferences WHERE admin_id = $1', [adminId])).rows[0];
  return { theme: r.theme, rowVersion: r.row_version, updatedAt: r.updated_at };
}

export async function updatePreferences(tx: Db, actor: Actor, input: { theme: 'Light' | 'Dark' | 'System' }) {
  const before = await getPreferences(tx, actor.adminId);
  await tx.query('UPDATE admin_preferences SET theme=$2, row_version=row_version+1, updated_at=now() WHERE admin_id=$1', [actor.adminId, input.theme]);
  await audit(tx, actor, { action: 'Settings.PreferencesEdit', entityType: 'AdminPreferences', entityId: actor.adminId, oldData: { theme: before.theme }, newData: input });
  return getPreferences(tx, actor.adminId);
}
