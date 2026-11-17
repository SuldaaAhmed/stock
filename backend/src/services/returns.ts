import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { badRequest, businessRule, conflict, FieldError, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, orderBy, Sql } from '../utils/sql';
import { audit } from './audit';
import { assertUniqueProducts, loadCustomer, loadProducts, ProductRef } from './common';
import { Movement, postMovements, reversalsFor } from './ledger';
import { nextNumber } from './numbering';
import { createReceipt, fmtQty, ReceiptPayload, supersedeReceipt } from './receipts';

export type ReturnMode = 'AgainstOrder' | 'Direct';
export const RETURN_MODES = ['AgainstOrder', 'Direct'] as const;
export type Condition = 'Good' | 'Damaged';

export interface ReturnLineInput {
  productId: string;
  quantity: number;
  condition: Condition;
}

export interface ReturnInput {
  returnMode: ReturnMode;
  orderId?: string | null;
  customerId?: string | null;
  reason: string;
  businessDate: string;
  lines: ReturnLineInput[];
}

/**
 * Validate order-linked return quantities: per product, returned (Good + Damaged) cannot
 * exceed delivered quantity minus all previous posted returns on that order, excluding
 * the version being corrected.
 */
async function validateAgainstOrder(tx: Db, order: any, lines: ReturnLineInput[], excludeReturnId: string | null) {
  const delivered = new Map<string, { qty: number; name: string }>(
    (await tx.query('SELECT product_id, delivered_quantity, product_name_snapshot FROM order_lines WHERE order_id = $1', [order.id])).rows.map((r) => [
      r.product_id,
      { qty: r.delivered_quantity, name: r.product_name_snapshot },
    ]),
  );
  const returned = new Map<string, number>(
    (
      await tx.query(
        `SELECT rl.product_id, SUM(rl.quantity)::int AS q FROM return_lines rl JOIN returns r ON r.id = rl.return_id
          WHERE r.order_id = $1 AND r.status = 'Posted' AND ($2::uuid IS NULL OR r.id <> $2) GROUP BY rl.product_id`,
        [order.id, excludeReturnId],
      )
    ).rows.map((r) => [r.product_id, r.q]),
  );
  const requested = new Map<string, number>();
  for (const l of lines) requested.set(l.productId, (requested.get(l.productId) ?? 0) + l.quantity);
  const errors: FieldError[] = [];
  for (const [productId, qty] of requested) {
    const d = delivered.get(productId);
    const idx = lines.findIndex((l) => l.productId === productId);
    if (!d || d.qty === 0) {
      errors.push({ field: `lines[${idx}].productId`, message: 'This product has no delivered quantity on the selected order.' });
      continue;
    }
    const returnable = d.qty - (returned.get(productId) ?? 0);
    if (qty > returnable) {
      errors.push({ field: `lines[${idx}].quantity`, message: `Over-return for "${d.name}": returnable ${returnable} BOX, requested ${qty} BOX.` });
    }
  }
  if (errors.length) throw businessRule('OVER_RETURN', 'Returned quantity exceeds the returnable quantity for this order.', errors);
}

function payload(h: any, lines: { name: string; quantity: number; condition: string }[]): ReceiptPayload {
  return {
    title: 'Customer Return Receipt',
    sourceNumber: h.number,
    version: h.version,
    businessDate: h.business_date,
    fields: [
      { label: 'Return No.', value: h.number + (h.version > 1 ? ` (v${h.version})` : '') },
      { label: 'Return Type', value: h.return_mode === 'AgainstOrder' ? 'Against Original Order' : 'Direct Return' },
      ...(h.order_number_snapshot ? [{ label: 'Order No.', value: h.order_number_snapshot }] : []),
      { label: 'Customer', value: h.customer_name_snapshot },
      { label: 'Date', value: h.business_date },
      { label: 'Reason', value: h.reason },
    ],
    columns: [
      { key: 'no', label: '#' },
      { key: 'product', label: 'Product' },
      { key: 'condition', label: 'Condition' },
      { key: 'quantity', label: 'Quantity (BOX)', align: 'right' },
    ],
    lines: lines.map((l, i) => ({ no: i + 1, product: l.name, condition: l.condition, quantity: l.quantity })),
    totals: [
      { label: 'Good', value: fmtQty(lines.filter((l) => l.condition === 'Good').reduce((s, l) => s + l.quantity, 0)) },
      { label: 'Damaged', value: fmtQty(lines.filter((l) => l.condition === 'Damaged').reduce((s, l) => s + l.quantity, 0)) },
      { label: 'Total Quantity', value: fmtQty(lines.reduce((s, l) => s + l.quantity, 0)) },
    ],
    notes: h.correction_reason ? `Correction: ${h.correction_reason}` : null,
  };
}

async function resolveParties(tx: Db, input: ReturnInput) {
  if (input.returnMode === 'AgainstOrder') {
    if (!input.orderId) throw badRequest('One or more validation errors occurred.', [{ field: 'orderId', message: 'Original order is required.' }]);
    const order = (await tx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [input.orderId])).rows[0];
    if (!order) throw badRequest('One or more validation errors occurred.', [{ field: 'orderId', message: 'Order not found.' }]);
    return { order, customer: { id: order.customer_id, full_name: order.customer_name_snapshot } };
  }
  if (!input.customerId) {
    throw badRequest('One or more validation errors occurred.', [{ field: 'customerId', message: 'A registered customer is required for a direct return.' }]);
  }
  return { order: null, customer: await loadCustomer(tx, input.customerId) };
}

async function insertVersion(
  tx: Db,
  actor: Actor,
  args: { number: string; version: number; supersedesId: string | null; correctionReason: string | null },
  input: ReturnInput,
  parties: { order: any; customer: { id: string; full_name: string } },
  products: Map<string, ProductRef>,
) {
  const h = (
    await tx.query(
      `INSERT INTO returns(number, version, supersedes_id, return_mode, customer_id, customer_name_snapshot, order_id, order_number_snapshot,
                           reason, business_date, correction_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        args.number,
        args.version,
        args.supersedesId,
        input.returnMode,
        parties.customer.id,
        parties.customer.full_name,
        parties.order?.id ?? null,
        parties.order?.number ?? null,
        input.reason,
        input.businessDate,
        args.correctionReason,
        actor.adminId,
      ],
    )
  ).rows[0];
  const lines = input.lines.map((l) => ({ ...l, name: products.get(l.productId)!.name }));
  await tx.query(
    `INSERT INTO return_lines(return_id, line_no, product_id, product_name_snapshot, quantity, condition)
     SELECT $1, * FROM unnest($2::int[], $3::uuid[], $4::text[], $5::int[], $6::text[])`,
    [h.id, lines.map((_, i) => i + 1), lines.map((l) => l.productId), lines.map((l) => l.name), lines.map((l) => l.quantity), lines.map((l) => l.condition)],
  );
  const movements: Movement[] = lines.map((l) => ({
    productId: l.productId,
    type: l.condition === 'Good' ? 'GoodReturn' : 'DamagedReturn',
    availableDelta: l.condition === 'Good' ? l.quantity : 0,
    damagedDelta: l.condition === 'Damaged' ? l.quantity : 0,
    source: { type: 'Return', id: h.id, number: h.number, version: h.version, businessDate: h.business_date },
  }));
  return { header: h, lines, movements };
}

async function attachReceipt(tx: Db, actor: Actor, h: any, lines: { name: string; quantity: number; condition: string }[]) {
  const rec = await createReceipt(tx, actor, {
    receiptType: 'Return',
    sourceType: 'Return',
    sourceId: h.id,
    sourceNumber: h.number,
    sourceVersion: h.version,
    businessDate: h.business_date,
    payload: payload(h, lines),
  });
  await tx.query('UPDATE returns SET receipt_id = $2 WHERE id = $1', [h.id, rec.id]);
  return rec;
}

export async function createReturn(tx: Db, actor: Actor, input: ReturnInput) {
  assertUniqueProducts(input.lines, 'lines', (l) => l.condition);
  const parties = await resolveParties(tx, input);
  const products = await loadProducts(tx, input.lines, { requireActive: false }); // returns of inactive products allowed
  if (parties.order) await validateAgainstOrder(tx, parties.order, input.lines, null);
  const number = await nextNumber(tx, 'RET');
  const v = await insertVersion(tx, actor, { number, version: 1, supersedesId: null, correctionReason: null }, input, parties, products);
  await postMovements(tx, actor, v.movements);
  await attachReceipt(tx, actor, v.header, v.lines);
  const detail = await getReturn(tx, v.header.id);
  await audit(tx, actor, { action: 'Return.Create', entityType: 'Return', entityId: v.header.id, newData: detail });
  return detail;
}

export async function correctReturn(
  tx: Db,
  actor: Actor,
  id: string,
  input: { returnMode?: ReturnMode; customerId?: string | null; returnReason?: string; businessDate?: string; lines: ReturnLineInput[]; reason: string },
) {
  const orig = (await tx.query('SELECT * FROM returns WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!orig) throw notFound('Return');
  if (orig.status !== 'Posted') throw conflict('Only the current version of a transaction can be corrected.', 'ALREADY_SUPERSEDED');
  if (input.returnMode && input.returnMode !== orig.return_mode) {
    throw badRequest('One or more validation errors occurred.', [{ field: 'returnMode', message: 'Return type cannot be changed by a correction.' }]);
  }
  const full: ReturnInput = {
    returnMode: orig.return_mode,
    orderId: orig.order_id,
    customerId: orig.return_mode === 'Direct' ? input.customerId ?? orig.customer_id : null,
    reason: input.returnReason ?? orig.reason,
    businessDate: input.businessDate ?? orig.business_date,
    lines: input.lines,
  };
  assertUniqueProducts(full.lines, 'lines', (l) => l.condition);
  const before = await getReturn(tx, id);
  const parties = await resolveParties(tx, full);
  const products = await loadProducts(tx, full.lines, { requireActive: false });
  if (parties.order) await validateAgainstOrder(tx, parties.order, full.lines, orig.id);
  // Free the 'current version' slot first (unique index on number WHERE status='Posted').
  await tx.query(`UPDATE returns SET status='Superseded' WHERE id=$1`, [orig.id]);
  const v = await insertVersion(
    tx,
    actor,
    { number: orig.number, version: orig.version + 1, supersedesId: orig.id, correctionReason: input.reason },
    full,
    parties,
    products,
  );
  await tx.query(`UPDATE returns SET superseded_by_id=$2 WHERE id=$1`, [orig.id, v.header.id]);
  await postMovements(tx, actor, [...(await reversalsFor(tx, 'Return', orig.id)), ...v.movements]);
  const rec = await attachReceipt(tx, actor, v.header, v.lines);
  await supersedeReceipt(tx, orig.receipt_id, rec.id);
  const after = await getReturn(tx, v.header.id);
  await audit(tx, actor, { action: 'Return.Correction', entityType: 'Return', entityId: v.header.id, description: input.reason, oldData: before, newData: after });
  return after;
}

function mapHeader(r: any) {
  return {
    id: r.id,
    number: r.number,
    version: r.version,
    status: r.status,
    returnMode: r.return_mode,
    customerId: r.customer_id,
    customerName: r.customer_name_snapshot,
    orderId: r.order_id,
    orderNumber: r.order_number_snapshot,
    reason: r.reason,
    businessDate: r.business_date,
    correctionReason: r.correction_reason,
    supersedesId: r.supersedes_id,
    supersededById: r.superseded_by_id,
    receiptId: r.receipt_id,
    receiptNumber: r.receipt_number ?? null,
    goodQuantity: r.good_quantity ?? undefined,
    damagedQuantity: r.damaged_quantity ?? undefined,
    totalQuantity: r.total_quantity ?? undefined,
    createdAt: r.created_at,
  };
}

export async function getReturn(db: Db, id: string) {
  const h = (await db.query('SELECT r.*, rc.receipt_number FROM returns r LEFT JOIN receipts rc ON rc.id = r.receipt_id WHERE r.id = $1', [id])).rows[0];
  if (!h) throw notFound('Return');
  const lines = (await db.query('SELECT * FROM return_lines WHERE return_id = $1 ORDER BY line_no', [id])).rows;
  const versions = (await db.query('SELECT id, version, status, created_at FROM returns WHERE number = $1 ORDER BY version', [h.number])).rows;
  return {
    ...mapHeader(h),
    lines: lines.map((l) => ({ id: l.id, productId: l.product_id, productName: l.product_name_snapshot, quantity: l.quantity, condition: l.condition })),
    goodQuantity: lines.filter((l) => l.condition === 'Good').reduce((s, l) => s + l.quantity, 0),
    damagedQuantity: lines.filter((l) => l.condition === 'Damaged').reduce((s, l) => s + l.quantity, 0),
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.created_at })),
  };
}

export async function listReturns(db: Db, q: ListQuery & { includeSuperseded?: boolean; condition?: Condition; orderId?: string }) {
  const w = new Sql();
  if (!q.includeSuperseded) w.and(`r.status = 'Posted'`);
  const mode = ensureEnum('type', q.type, RETURN_MODES);
  if (mode) w.and(`r.return_mode = ${w.p(mode)}`);
  if (q.customerId) w.and(`r.customer_id = ${w.p(q.customerId)}`);
  if (q.orderId) w.and(`r.order_id = ${w.p(q.orderId)}`);
  if (q.productId) w.and(`EXISTS (SELECT 1 FROM return_lines l WHERE l.return_id = r.id AND l.product_id = ${w.p(q.productId)})`);
  if (q.condition) w.and(`EXISTS (SELECT 1 FROM return_lines l WHERE l.return_id = r.id AND l.condition = ${w.p(q.condition)})`);
  w.period('r.business_date', q);
  w.search(q.search, ['r.number', 'r.customer_name_snapshot', 'r.order_number_snapshot', 'r.reason']);
  const order = orderBy(q.sort, { number: 'r.number', businessDate: 'r.business_date', createdAt: 'r.created_at', customerName: 'r.customer_name_snapshot' }, 'r.created_at DESC, r.id');
  const total = (await db.query(`SELECT count(*)::int n FROM returns r ${w.where()}`, w.params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT r.*, rc.receipt_number,
              (SELECT COALESCE(SUM(quantity),0)::int FROM return_lines l WHERE l.return_id = r.id AND l.condition='Good') AS good_quantity,
              (SELECT COALESCE(SUM(quantity),0)::int FROM return_lines l WHERE l.return_id = r.id AND l.condition='Damaged') AS damaged_quantity,
              (SELECT SUM(quantity)::int FROM return_lines l WHERE l.return_id = r.id) AS total_quantity
         FROM returns r LEFT JOIN receipts rc ON rc.id = r.receipt_id ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(mapHeader), meta: pageMeta(q.page, q.pageSize, total) };
}
