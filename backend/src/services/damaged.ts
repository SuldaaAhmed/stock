import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, orderBy, Sql } from '../utils/sql';
import { audit } from './audit';
import { loadProducts } from './common';
import { lockBalances, postMovements } from './ledger';
import { nextNumber } from './numbering';
import { createReceipt, fmtQty } from './receipts';

export type DamagedActionType = 'MarkAsGood' | 'RemoveFromDamaged';
export const DAMAGED_ACTIONS = ['MarkAsGood', 'RemoveFromDamaged'] as const;

/**
 * Mark as Good: Damaged −q, Available +q.   Remove from Damaged: Damaged −q (Available unchanged).
 * Quantity cannot exceed current Damaged stock (checked under row lock).
 */
export async function createDamagedAction(
  tx: Db,
  actor: Actor,
  input: { actionType: DamagedActionType; productId: string; quantity: number; reason: string; businessDate: string },
) {
  const products = await loadProducts(tx, [{ productId: input.productId }], { requireActive: false, field: 'product' });
  const name = products.get(input.productId)!.name;
  await lockBalances(tx, [input.productId]);
  const id = (await tx.query('SELECT gen_random_uuid() AS id')).rows[0].id as string;
  const recNumber = await nextNumber(tx, 'REC'); // each action is identified by id + its REC- number
  const changes = await postMovements(tx, actor, [
    {
      productId: input.productId,
      type: input.actionType,
      availableDelta: input.actionType === 'MarkAsGood' ? input.quantity : 0,
      damagedDelta: -input.quantity,
      source: { type: 'DamagedStockAction', id, number: recNumber, version: 1, businessDate: input.businessDate },
    },
  ]);
  const c = changes.get(input.productId)!;
  await tx.query(
      `INSERT INTO damaged_stock_actions(id, action_type, product_id, product_name_snapshot, quantity, reason, damaged_before, damaged_after,
                                         available_before, available_after, business_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) `,
      [id, input.actionType, input.productId, name, input.quantity, input.reason, c.damagedBefore, c.damagedAfter, c.availableBefore, c.availableAfter, input.businessDate, actor.adminId],
  );
  const label = input.actionType === 'MarkAsGood' ? 'Mark as Good' : 'Remove from Damaged Stock';
  const rec = await createReceipt(tx, actor, {
    receiptType: 'DamagedStockAction',
    sourceType: 'DamagedStockAction',
    sourceId: id,
    sourceNumber: recNumber,
    sourceVersion: 1,
    businessDate: input.businessDate,
    receiptNumber: recNumber,
    payload: {
      title: `Damaged Stock Record – ${label}`,
      sourceNumber: recNumber,
      version: 1,
      businessDate: input.businessDate,
      fields: [
        { label: 'Action', value: label },
        { label: 'Date', value: input.businessDate },
        { label: 'Reason', value: input.reason },
      ],
      columns: [
        { key: 'product', label: 'Product' },
        { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
        { key: 'damaged', label: 'Damaged Before → After', align: 'right' },
        { key: 'available', label: 'Available Before → After', align: 'right' },
      ],
      lines: [{ product: name, quantity: input.quantity, damaged: `${c.damagedBefore} → ${c.damagedAfter}`, available: `${c.availableBefore} → ${c.availableAfter}` }],
      totals: [{ label: 'Quantity', value: fmtQty(input.quantity) }],
    },
  });
  await tx.query('UPDATE damaged_stock_actions SET receipt_id = $2 WHERE id = $1', [id, rec.id]);
  const detail = await getDamagedAction(tx, id);
  await audit(tx, actor, { action: `DamagedStock.${input.actionType}`, entityType: 'DamagedStockAction', entityId: id, description: input.reason, newData: detail });
  return detail;
}

function map(r: any) {
  return {
    id: r.id,
    actionType: r.action_type,
    productId: r.product_id,
    productName: r.product_name_snapshot,
    quantity: r.quantity,
    reason: r.reason,
    damagedBefore: r.damaged_before,
    damagedAfter: r.damaged_after,
    availableBefore: r.available_before,
    availableAfter: r.available_after,
    businessDate: r.business_date,
    receiptId: r.receipt_id,
    receiptNumber: r.receipt_number ?? null,
    createdAt: r.created_at,
    createdBy: r.username ?? undefined,
  };
}

export async function getDamagedAction(db: Db, id: string) {
  const r = (
    await db.query(
      `SELECT x.*, rc.receipt_number, a.username FROM damaged_stock_actions x LEFT JOIN receipts rc ON rc.id = x.receipt_id
         LEFT JOIN admins a ON a.id = x.created_by WHERE x.id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) throw notFound('Damaged stock action');
  return map(r);
}

export async function listDamagedActions(db: Db, q: ListQuery) {
  const w = new Sql();
  const t = ensureEnum('type', q.type, DAMAGED_ACTIONS);
  if (t) w.and(`x.action_type = ${w.p(t)}`);
  if (q.productId) w.and(`x.product_id = ${w.p(q.productId)}`);
  w.period('x.business_date', q);
  w.search(q.search, ['x.product_name_snapshot', 'x.reason', 'rc.receipt_number']);
  const order = orderBy(q.sort, { businessDate: 'x.business_date', createdAt: 'x.created_at', quantity: 'x.quantity' }, 'x.created_at DESC, x.id');
  const from = 'FROM damaged_stock_actions x LEFT JOIN receipts rc ON rc.id = x.receipt_id';
  const total = (await db.query(`SELECT count(*)::int n ${from} ${w.where()}`, w.params)).rows[0].n;
  const rows = (await db.query(`SELECT x.*, rc.receipt_number ${from} ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`, w.params)).rows;
  return { items: rows.map(map), meta: pageMeta(q.page, q.pageSize, total) };
}

/** Current damaged balances per product (products with damaged > 0). */
export async function damagedBalances(db: Db) {
  return (
    await db.query(
      `SELECT p.id, p.name, p.status, b.damaged, b.available FROM products p JOIN product_balances b ON b.product_id = p.id
        WHERE b.damaged > 0 ORDER BY p.name`,
    )
  ).rows.map((r) => ({ productId: r.id, productName: r.name, status: r.status, damagedStock: r.damaged, availableStock: r.available }));
}
