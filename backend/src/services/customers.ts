import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { badRequest, conflict, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { orderBy, Sql } from '../utils/sql';
import { audit, diff } from './audit';

export interface CustomerInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  location?: string | null;
  notes?: string | null;
}

export function mapCustomer(r: any) {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    email: r.email,
    location: r.location,
    notes: r.notes,
    orderCount: r.order_count ?? undefined,
    rowVersion: r.row_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getCustomer(db: Db, id: string, lock = false) {
  const r = await db.query(
    `SELECT c.*, (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS order_count FROM customers c WHERE c.id = $1 ${lock ? 'FOR UPDATE OF c' : ''}`,
    [id],
  );
  if (!r.rowCount) throw notFound('Customer');
  return r.rows[0];
}

export async function listCustomers(db: Db, q: ListQuery) {
  const w = new Sql();
  w.search(q.search, ['c.full_name', 'c.phone', 'c.email', 'c.location']);
  const order = orderBy(q.sort, { fullName: 'c.full_name', createdAt: 'c.created_at', location: 'c.location' }, 'c.full_name ASC, c.id');
  const total = (await db.query(`SELECT count(*)::int n FROM customers c ${w.where()}`, w.params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT c.*, (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS order_count
         FROM customers c ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(mapCustomer), meta: pageMeta(q.page, q.pageSize, total) };
}

export async function createCustomer(tx: Db, actor: Actor, input: CustomerInput) {
  const r = (
    await tx.query(
      `INSERT INTO customers(full_name, phone, email, location, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
      [input.fullName, input.phone ?? null, input.email ?? null, input.location ?? null, input.notes ?? null, actor.adminId],
    )
  ).rows[0];
  const c = mapCustomer(r);
  await audit(tx, actor, { action: 'Customer.Create', entityType: 'Customer', entityId: c.id, newData: c });
  return c;
}

export async function updateCustomer(tx: Db, actor: Actor, id: string, expectedVersion: number, input: Partial<CustomerInput> & { reason?: string | null }) {
  const cur = await getCustomer(tx, id, true);
  if (cur.row_version !== expectedVersion) throw conflict('The customer was changed by another request. Reload and try again.', 'CONCURRENCY_CONFLICT');
  const before = { fullName: cur.full_name, phone: cur.phone, email: cur.email, location: cur.location, notes: cur.notes };
  const d = diff(before, { fullName: input.fullName, phone: input.phone, email: input.email, location: input.location, notes: input.notes });
  if (!d.changed) throw badRequest('No changes were supplied.', [{ field: 'body', message: 'Nothing to update.' }]);
  const next = { ...before, ...d.new } as typeof before;
  await tx.query(
    `UPDATE customers SET full_name=$2, phone=$3, email=$4, location=$5, notes=$6, row_version=row_version+1, updated_at=now(), updated_by=$7 WHERE id=$1`,
    [id, next.fullName, next.phone, next.email, next.location, next.notes, actor.adminId],
  );
  await tx.query('INSERT INTO customer_edit_history(customer_id, old_values, new_values, reason, admin_id) VALUES ($1,$2,$3,$4,$5)', [
    id,
    JSON.stringify(d.old),
    JSON.stringify(d.new),
    input.reason ?? null,
    actor.adminId,
  ]);
  await audit(tx, actor, { action: 'Customer.Edit', entityType: 'Customer', entityId: id, description: input.reason ?? undefined, oldData: d.old, newData: d.new });
  return mapCustomer(await getCustomer(tx, id));
}

export async function customerHistory(db: Db, id: string, q: ListQuery) {
  await getCustomer(db, id);
  const total = (await db.query('SELECT count(*)::int n FROM customer_edit_history WHERE customer_id=$1', [id])).rows[0].n;
  const rows = (
    await db.query(
      `SELECT h.*, a.username FROM customer_edit_history h LEFT JOIN admins a ON a.id = h.admin_id
        WHERE h.customer_id = $1 ORDER BY h.created_at DESC LIMIT $2 OFFSET $3`,
      [id, q.pageSize, (q.page - 1) * q.pageSize],
    )
  ).rows;
  return {
    items: rows.map((r) => ({ id: r.id, oldValues: r.old_values, newValues: r.new_values, reason: r.reason, admin: r.username, createdAt: r.created_at })),
    meta: pageMeta(q.page, q.pageSize, total),
  };
}
