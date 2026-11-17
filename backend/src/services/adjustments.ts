import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { badRequest, conflict, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, orderBy, Sql } from '../utils/sql';
import { audit } from './audit';
import { loadCorrectionProducts, loadProducts } from './common';
import { lockBalances, postMovements, reversalsFor } from './ledger';
import { nextNumber } from './numbering';
import { createReceipt, fmtQty, ReceiptPayload, supersedeReceipt } from './receipts';

export type Direction = 'Increase' | 'Decrease';
export const DIRECTIONS = ['Increase', 'Decrease'] as const;

export interface AdjustmentInput {
  direction: Direction;
  productId: string;
  quantity: number;
  reason: string;
  businessDate: string;
}

function payload(h: any): ReceiptPayload {
  return {
    title: 'Stock Adjustment Record',
    sourceNumber: h.number,
    version: h.version,
    businessDate: h.business_date,
    fields: [
      { label: 'Adjustment No.', value: h.number + (h.version > 1 ? ` (v${h.version})` : '') },
      { label: 'Direction', value: h.direction },
      { label: 'Date', value: h.business_date },
      { label: 'Reason', value: h.reason },
    ],
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'quantity', label: 'Quantity (BOX)', align: 'right' },
      { key: 'before', label: 'Available Before', align: 'right' },
      { key: 'after', label: 'Available After', align: 'right' },
    ],
    lines: [{ product: h.product_name_snapshot, quantity: h.quantity, before: h.available_before, after: h.available_after }],
    totals: [{ label: h.direction === 'Increase' ? 'Total Increase' : 'Total Decrease', value: fmtQty(h.quantity) }],
    notes: h.correction_reason ? `Correction: ${h.correction_reason}` : null,
  };
}

async function postVersion(
  tx: Db,
  actor: Actor,
  args: { number: string; version: number; supersedesId: string | null; correctionReason: string | null; reverseId: string | null },
  input: AdjustmentInput,
  productName: string,
) {
  // Lock first so before/after quantities are exact; reversal (if any) is applied in the same posting.
  const reversals = args.reverseId ? await reversalsFor(tx, 'Adjustment', args.reverseId) : [];
  const balances = await lockBalances(tx, [input.productId, ...reversals.map((r) => r.productId)]);
  const reversalNet = reversals.filter((r) => r.productId === input.productId).reduce((s, r) => s + r.availableDelta, 0);
  const before = balances.get(input.productId)!.available + reversalNet;
  const delta = input.direction === 'Increase' ? input.quantity : -input.quantity;
  if (args.supersedesId) await tx.query(`UPDATE adjustments SET status='Superseded' WHERE id=$1`, [args.supersedesId]);
  const h = (
    await tx.query(
      `INSERT INTO adjustments(number, version, supersedes_id, direction, product_id, product_name_snapshot, quantity, reason,
                               available_before, available_after, business_date, correction_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        args.number,
        args.version,
        args.supersedesId,
        input.direction,
        input.productId,
        productName,
        input.quantity,
        input.reason,
        before,
        Math.max(before + delta, 0), // real check happens in postMovements (422 when negative)
        input.businessDate,
        args.correctionReason,
        actor.adminId,
      ],
    )
  ).rows[0];
  if (args.supersedesId) await tx.query(`UPDATE adjustments SET superseded_by_id=$2 WHERE id=$1`, [args.supersedesId, h.id]);
  await postMovements(tx, actor, [
    ...reversals,
    {
      productId: input.productId,
      type: input.direction === 'Increase' ? 'AdjustmentIn' : 'AdjustmentOut',
      availableDelta: delta,
      damagedDelta: 0,
      source: { type: 'Adjustment', id: h.id, number: h.number, version: h.version, businessDate: h.business_date },
    },
  ]);
  const rec = await createReceipt(tx, actor, {
    receiptType: 'Adjustment',
    sourceType: 'Adjustment',
    sourceId: h.id,
    sourceNumber: h.number,
    sourceVersion: h.version,
    businessDate: h.business_date,
    payload: payload(h),
  });
  await tx.query('UPDATE adjustments SET receipt_id = $2 WHERE id = $1', [h.id, rec.id]);
  return { header: h, receiptId: rec.id };
}

export async function createAdjustment(tx: Db, actor: Actor, input: AdjustmentInput) {
  // Adjustments are allowed for inactive products (Section 4.2 exception).
  const products = await loadProducts(tx, [{ productId: input.productId }], { requireActive: false, field: 'product' });
  const number = await nextNumber(tx, 'ADJ');
  const v = await postVersion(tx, actor, { number, version: 1, supersedesId: null, correctionReason: null, reverseId: null }, input, products.get(input.productId)!.name);
  const detail = await getAdjustment(tx, v.header.id);
  await audit(tx, actor, { action: 'Adjustment.Create', entityType: 'Adjustment', entityId: v.header.id, description: input.reason, newData: detail });
  return detail;
}

export async function correctAdjustment(
  tx: Db,
  actor: Actor,
  id: string,
  input: { direction?: Direction; productId?: string; quantity: number; adjustmentReason?: string; businessDate?: string; reason: string },
) {
  const orig = (await tx.query('SELECT * FROM adjustments WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!orig) throw notFound('Adjustment');
  if (orig.status !== 'Posted') throw conflict('Only the current version of a transaction can be corrected.', 'ALREADY_SUPERSEDED');
  if (input.direction && input.direction !== orig.direction) {
    throw badRequest('One or more validation errors occurred.', [{ field: 'direction', message: 'Adjustment direction (type) cannot be changed by a correction.' }]);
  }
  const productId = input.productId ?? orig.product_id;
  const products = await loadCorrectionProducts(tx, [{ productId }], new Set([orig.product_id]));
  const before = await getAdjustment(tx, id);
  const v = await postVersion(
    tx,
    actor,
    { number: orig.number, version: orig.version + 1, supersedesId: orig.id, correctionReason: input.reason, reverseId: orig.id },
    { direction: orig.direction, productId, quantity: input.quantity, reason: input.adjustmentReason ?? orig.reason, businessDate: input.businessDate ?? orig.business_date },
    products.get(productId)!.name,
  );
  await supersedeReceipt(tx, orig.receipt_id, v.receiptId);
  const after = await getAdjustment(tx, v.header.id);
  await audit(tx, actor, { action: 'Adjustment.Correction', entityType: 'Adjustment', entityId: v.header.id, description: input.reason, oldData: before, newData: after });
  return after;
}

function map(r: any) {
  return {
    id: r.id,
    number: r.number,
    version: r.version,
    status: r.status,
    direction: r.direction,
    productId: r.product_id,
    productName: r.product_name_snapshot,
    quantity: r.quantity,
    reason: r.reason,
    availableBefore: r.available_before,
    availableAfter: r.available_after,
    businessDate: r.business_date,
    correctionReason: r.correction_reason,
    supersedesId: r.supersedes_id,
    supersededById: r.superseded_by_id,
    receiptId: r.receipt_id,
    receiptNumber: r.receipt_number ?? null,
    createdAt: r.created_at,
    createdBy: r.username ?? undefined,
  };
}

export async function getAdjustment(db: Db, id: string) {
  const r = (
    await db.query(
      `SELECT x.*, rc.receipt_number, a.username FROM adjustments x LEFT JOIN receipts rc ON rc.id = x.receipt_id
         LEFT JOIN admins a ON a.id = x.created_by WHERE x.id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) throw notFound('Adjustment');
  const versions = (await db.query('SELECT id, version, status, created_at FROM adjustments WHERE number = $1 ORDER BY version', [r.number])).rows;
  return { ...map(r), versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.created_at })) };
}

export async function listAdjustments(db: Db, q: ListQuery & { includeSuperseded?: boolean }) {
  const w = new Sql();
  if (!q.includeSuperseded) w.and(`x.status = 'Posted'`);
  const dir = ensureEnum('type', q.type, DIRECTIONS);
  if (dir) w.and(`x.direction = ${w.p(dir)}`);
  if (q.productId) w.and(`x.product_id = ${w.p(q.productId)}`);
  w.period('x.business_date', q);
  w.search(q.search, ['x.number', 'x.product_name_snapshot', 'x.reason']);
  const order = orderBy(q.sort, { number: 'x.number', businessDate: 'x.business_date', createdAt: 'x.created_at', quantity: 'x.quantity' }, 'x.created_at DESC, x.id');
  const total = (await db.query(`SELECT count(*)::int n FROM adjustments x ${w.where()}`, w.params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT x.*, rc.receipt_number FROM adjustments x LEFT JOIN receipts rc ON rc.id = x.receipt_id ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(map), meta: pageMeta(q.page, q.pageSize, total) };
}
