import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { badRequest, conflict, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, orderBy, Sql } from '../utils/sql';
import { audit } from './audit';
import { assertUniqueProducts, loadCorrectionProducts, loadProducts, ProductRef } from './common';
import { Movement, postMovements, reversalsFor } from './ledger';
import { nextNumber } from './numbering';
import { createReceipt, fmtQty, ReceiptPayload, supersedeReceipt } from './receipts';

export type StockInType = 'NewStock' | 'WarehouseTransferIn';
export const STOCK_IN_TYPES = ['NewStock', 'WarehouseTransferIn'] as const;
const TYPE_LABEL: Record<StockInType, string> = { NewStock: 'New Stock', WarehouseTransferIn: 'Warehouse Transfer In' };

export interface StockInInput {
  stockInType: StockInType;
  sourceWarehouse?: string | null;
  businessDate: string;
  lines: { productId: string; quantity: number }[];
}

function validateTypeFields(input: { stockInType: StockInType; sourceWarehouse?: string | null }) {
  if (input.stockInType === 'WarehouseTransferIn' && !input.sourceWarehouse?.trim()) {
    throw badRequest('One or more validation errors occurred.', [
      { field: 'sourceWarehouse', message: 'Source warehouse name is required for Warehouse Transfer In.' },
    ]);
  }
}

function payload(h: any, lines: { name: string; quantity: number }[]): ReceiptPayload {
  return {
    title: 'Stock In Receipt',
    sourceNumber: h.number,
    version: h.version,
    businessDate: h.business_date,
    fields: [
      { label: 'Stock In No.', value: h.number + (h.version > 1 ? ` (v${h.version})` : '') },
      { label: 'Type', value: TYPE_LABEL[h.stock_in_type as StockInType] },
      ...(h.source_warehouse ? [{ label: 'Source Warehouse', value: h.source_warehouse }] : []),
      { label: 'Date', value: h.business_date },
    ],
    columns: [
      { key: 'no', label: '#' },
      { key: 'product', label: 'Product' },
      { key: 'quantity', label: 'Quantity (BOX)', align: 'right' },
    ],
    lines: lines.map((l, i) => ({ no: i + 1, product: l.name, quantity: l.quantity })),
    totals: [{ label: 'Total Quantity', value: fmtQty(lines.reduce((s, l) => s + l.quantity, 0)) }],
    notes: h.correction_reason ? `Correction: ${h.correction_reason}` : null,
  };
}

async function insertVersion(
  tx: Db,
  actor: Actor,
  args: { number: string; version: number; supersedesId: string | null; correctionReason: string | null },
  input: StockInInput,
  products: Map<string, ProductRef>,
) {
  const h = (
    await tx.query(
      `INSERT INTO stock_ins(number, version, supersedes_id, stock_in_type, source_warehouse, business_date, correction_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        args.number,
        args.version,
        args.supersedesId,
        input.stockInType,
        input.stockInType === 'WarehouseTransferIn' ? input.sourceWarehouse!.trim() : null,
        input.businessDate,
        args.correctionReason,
        actor.adminId,
      ],
    )
  ).rows[0];
  const lines = input.lines.map((l) => ({ ...l, name: products.get(l.productId)!.name }));
  await tx.query(
    `INSERT INTO stock_in_lines(stock_in_id, line_no, product_id, product_name_snapshot, quantity)
     SELECT $1, * FROM unnest($2::int[], $3::uuid[], $4::text[], $5::int[])`,
    [h.id, lines.map((_, i) => i + 1), lines.map((l) => l.productId), lines.map((l) => l.name), lines.map((l) => l.quantity)],
  );
  const movements: Movement[] = lines.map((l) => ({
    productId: l.productId,
    type: input.stockInType === 'NewStock' ? 'StockInNew' : 'StockInTransfer',
    availableDelta: l.quantity,
    damagedDelta: 0,
    source: { type: 'StockIn', id: h.id, number: h.number, version: h.version, businessDate: h.business_date },
  }));
  return { header: h, lines, movements };
}

async function attachReceipt(tx: Db, actor: Actor, h: any, lines: { name: string; quantity: number }[]) {
  const rec = await createReceipt(tx, actor, {
    receiptType: 'StockIn',
    sourceType: 'StockIn',
    sourceId: h.id,
    sourceNumber: h.number,
    sourceVersion: h.version,
    businessDate: h.business_date,
    payload: payload(h, lines),
  });
  await tx.query('UPDATE stock_ins SET receipt_id = $2 WHERE id = $1', [h.id, rec.id]);
  return rec;
}

export async function createStockIn(tx: Db, actor: Actor, input: StockInInput) {
  validateTypeFields(input);
  assertUniqueProducts(input.lines);
  const products = await loadProducts(tx, input.lines, { requireActive: true });
  const number = await nextNumber(tx, 'SIN');
  const v = await insertVersion(tx, actor, { number, version: 1, supersedesId: null, correctionReason: null }, input, products);
  await postMovements(tx, actor, v.movements);
  await attachReceipt(tx, actor, v.header, v.lines);
  const detail = await getStockIn(tx, v.header.id);
  await audit(tx, actor, { action: 'StockIn.Create', entityType: 'StockIn', entityId: v.header.id, newData: detail });
  return detail;
}

export async function correctStockIn(
  tx: Db,
  actor: Actor,
  id: string,
  input: Omit<StockInInput, 'stockInType' | 'businessDate'> & { businessDate?: string; stockInType?: StockInType; reason: string },
) {
  const orig = (await tx.query('SELECT * FROM stock_ins WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!orig) throw notFound('Stock In');
  if (orig.status !== 'Posted') throw conflict('Only the current version of a transaction can be corrected.', 'ALREADY_SUPERSEDED');
  if (input.stockInType && input.stockInType !== orig.stock_in_type) {
    throw badRequest('One or more validation errors occurred.', [{ field: 'stockInType', message: 'Transaction type cannot be changed by a correction.' }]);
  }
  const full: StockInInput = {
    stockInType: orig.stock_in_type,
    sourceWarehouse: input.sourceWarehouse === undefined ? orig.source_warehouse : input.sourceWarehouse,
    businessDate: input.businessDate ?? orig.business_date,
    lines: input.lines,
  };
  validateTypeFields(full);
  assertUniqueProducts(full.lines);
  const before = await getStockIn(tx, id);
  const originalProducts = new Set<string>(before.lines.map((l) => l.productId));
  const products = await loadCorrectionProducts(tx, full.lines, originalProducts);
  // Free the 'current version' slot first (unique index on number WHERE status='Posted').
  await tx.query(`UPDATE stock_ins SET status='Superseded' WHERE id=$1`, [orig.id]);
  const v = await insertVersion(
    tx,
    actor,
    { number: orig.number, version: orig.version + 1, supersedesId: orig.id, correctionReason: input.reason },
    full,
    products,
  );
  await tx.query(`UPDATE stock_ins SET superseded_by_id=$2 WHERE id=$1`, [orig.id, v.header.id]);
  await postMovements(tx, actor, [...(await reversalsFor(tx, 'StockIn', orig.id)), ...v.movements]);
  const rec = await attachReceipt(tx, actor, v.header, v.lines);
  await supersedeReceipt(tx, orig.receipt_id, rec.id);
  const after = await getStockIn(tx, v.header.id);
  await audit(tx, actor, {
    action: 'StockIn.Correction',
    entityType: 'StockIn',
    entityId: v.header.id,
    description: input.reason,
    oldData: before,
    newData: after,
  });
  return after;
}

function mapHeader(r: any) {
  return {
    id: r.id,
    number: r.number,
    version: r.version,
    status: r.status,
    stockInType: r.stock_in_type,
    sourceWarehouse: r.source_warehouse,
    businessDate: r.business_date,
    correctionReason: r.correction_reason,
    supersedesId: r.supersedes_id,
    supersededById: r.superseded_by_id,
    receiptId: r.receipt_id,
    receiptNumber: r.receipt_number ?? null,
    totalQuantity: r.total_quantity ?? undefined,
    lineCount: r.line_count ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by_username ?? undefined,
  };
}

export async function getStockIn(db: Db, id: string) {
  const h = (
    await db.query(
      `SELECT s.*, rc.receipt_number, a.username AS created_by_username FROM stock_ins s
         LEFT JOIN receipts rc ON rc.id = s.receipt_id LEFT JOIN admins a ON a.id = s.created_by WHERE s.id = $1`,
      [id],
    )
  ).rows[0];
  if (!h) throw notFound('Stock In');
  const lines = (await db.query('SELECT * FROM stock_in_lines WHERE stock_in_id = $1 ORDER BY line_no', [id])).rows;
  const versions = (await db.query('SELECT id, version, status, created_at FROM stock_ins WHERE number = $1 ORDER BY version', [h.number])).rows;
  return {
    ...mapHeader(h),
    lines: lines.map((l) => ({ id: l.id, productId: l.product_id, productName: l.product_name_snapshot, quantity: l.quantity })),
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.created_at })),
  };
}

export async function listStockIns(db: Db, q: ListQuery & { includeSuperseded?: boolean }) {
  const w = new Sql();
  if (!q.includeSuperseded) w.and(`s.status = 'Posted'`);
  const type = ensureEnum('type', q.type, STOCK_IN_TYPES);
  if (type) w.and(`s.stock_in_type = ${w.p(type)}`);
  w.period('s.business_date', q);
  if (q.productId) w.and(`EXISTS (SELECT 1 FROM stock_in_lines l WHERE l.stock_in_id = s.id AND l.product_id = ${w.p(q.productId)})`);
  if (q.search) {
    const ph = w.p(`%${q.search}%`);
    w.and(`(s.number ILIKE ${ph} OR s.source_warehouse ILIKE ${ph} OR EXISTS (SELECT 1 FROM stock_in_lines l WHERE l.stock_in_id = s.id AND l.product_name_snapshot ILIKE ${ph}))`);
  }
  const order = orderBy(q.sort, { number: 's.number', businessDate: 's.business_date', createdAt: 's.created_at', type: 's.stock_in_type' }, 's.created_at DESC, s.id');
  const total = (await db.query(`SELECT count(*)::int n FROM stock_ins s ${w.where()}`, w.params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT s.*, rc.receipt_number,
              (SELECT SUM(quantity)::int FROM stock_in_lines l WHERE l.stock_in_id = s.id) AS total_quantity,
              (SELECT count(*)::int FROM stock_in_lines l WHERE l.stock_in_id = s.id) AS line_count
         FROM stock_ins s LEFT JOIN receipts rc ON rc.id = s.receipt_id
        ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(mapHeader), meta: pageMeta(q.page, q.pageSize, total) };
}
