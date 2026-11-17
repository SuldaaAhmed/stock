import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { badRequest, businessRule, conflict, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, orderBy, Sql } from '../utils/sql';
import { audit } from './audit';
import { assertUniqueProducts, loadCorrectionProducts, loadProducts, ProductRef } from './common';
import { Movement, MovementType, postMovements, reversalsFor } from './ledger';
import { nextNumber } from './numbering';
import { createReceipt, fmtQty, ReceiptPayload, supersedeReceipt } from './receipts';

export type OutType = 'CustomerDelivery' | 'Sample' | 'Gift' | 'WarehouseTransfer';
export const OUT_TYPES = ['CustomerDelivery', 'Sample', 'Gift', 'WarehouseTransfer'] as const;
export const DIRECT_OUT_TYPES = ['Sample', 'Gift', 'WarehouseTransfer'] as const;
const MOVEMENT: Record<OutType, MovementType> = {
  CustomerDelivery: 'StockOutDelivery',
  Sample: 'StockOutSample',
  Gift: 'StockOutGift',
  WarehouseTransfer: 'StockOutTransfer',
};
const LABEL: Record<OutType, string> = {
  CustomerDelivery: 'Customer Delivery',
  Sample: 'Sample',
  Gift: 'Gift',
  WarehouseTransfer: 'Warehouse Transfer',
};

export interface StockOutInput {
  outType: OutType;
  recipientName?: string | null;
  destinationWarehouse?: string | null;
  businessDate: string;
  lines: { productId: string; quantity: number }[];
}

function validateTypeFields(input: StockOutInput) {
  if ((input.outType === 'Sample' || input.outType === 'Gift') && !input.recipientName?.trim()) {
    throw badRequest('One or more validation errors occurred.', [{ field: 'recipientName', message: 'Recipient full name is required for Sample/Gift.' }]);
  }
  if (input.outType === 'WarehouseTransfer' && !input.destinationWarehouse?.trim()) {
    throw badRequest('One or more validation errors occurred.', [
      { field: 'destinationWarehouse', message: 'Destination warehouse name is required for a Warehouse Transfer.' },
    ]);
  }
}

function payload(h: any, lines: { name: string; quantity: number }[]): ReceiptPayload {
  const isTransfer = h.out_type === 'WarehouseTransfer';
  return {
    title: isTransfer ? 'Warehouse Transfer Note' : `${LABEL[h.out_type as OutType]} Receipt`,
    sourceNumber: h.number,
    secondaryNumber: h.transfer_number,
    version: h.version,
    businessDate: h.business_date,
    fields: [
      { label: 'Stock Out No.', value: h.number + (h.version > 1 ? ` (v${h.version})` : '') },
      ...(isTransfer ? [{ label: 'Transfer No.', value: h.transfer_number }] : []),
      { label: 'Type', value: LABEL[h.out_type as OutType] },
      ...(h.recipient_name ? [{ label: 'Recipient', value: h.recipient_name }] : []),
      ...(h.destination_warehouse ? [{ label: 'Destination Warehouse', value: h.destination_warehouse }] : []),
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

/** Insert one Stock Out version (header + lines) and build its ledger movements. */
export async function insertStockOutVersion(
  tx: Db,
  actor: Actor,
  args: { number: string; version: number; supersedesId: string | null; correctionReason: string | null; transferNumber: string | null; orderId: string | null },
  input: StockOutInput,
  products: Map<string, ProductRef>,
) {
  const h = (
    await tx.query(
      `INSERT INTO stock_outs(number, version, supersedes_id, out_type, recipient_name, destination_warehouse, transfer_number,
                              order_id, business_date, correction_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        args.number,
        args.version,
        args.supersedesId,
        input.outType,
        input.outType === 'Sample' || input.outType === 'Gift' ? input.recipientName!.trim() : null,
        input.outType === 'WarehouseTransfer' ? input.destinationWarehouse!.trim() : null,
        args.transferNumber,
        args.orderId,
        input.businessDate,
        args.correctionReason,
        actor.adminId,
      ],
    )
  ).rows[0];
  const lines = input.lines.map((l) => ({ ...l, name: products.get(l.productId)!.name }));
  await tx.query(
    `INSERT INTO stock_out_lines(stock_out_id, line_no, product_id, product_name_snapshot, quantity)
     SELECT $1, * FROM unnest($2::int[], $3::uuid[], $4::text[], $5::int[])`,
    [h.id, lines.map((_, i) => i + 1), lines.map((l) => l.productId), lines.map((l) => l.name), lines.map((l) => l.quantity)],
  );
  const movements: Movement[] = lines.map((l) => ({
    productId: l.productId,
    type: MOVEMENT[input.outType],
    availableDelta: -l.quantity,
    damagedDelta: 0,
    source: { type: 'StockOut', id: h.id, number: h.number, version: h.version, businessDate: h.business_date },
  }));
  return { header: h, lines, movements };
}

async function attachReceipt(tx: Db, actor: Actor, h: any, lines: { name: string; quantity: number }[]) {
  const rec = await createReceipt(tx, actor, {
    receiptType: h.out_type === 'WarehouseTransfer' ? 'WarehouseTransfer' : 'SampleGift',
    sourceType: 'StockOut',
    sourceId: h.id,
    sourceNumber: h.number,
    sourceVersion: h.version,
    businessDate: h.business_date,
    payload: payload(h, lines),
  });
  await tx.query('UPDATE stock_outs SET receipt_id = $2 WHERE id = $1', [h.id, rec.id]);
  return rec;
}

/** Direct Stock Out: Sample, Gift or Warehouse Transfer (send-only). */
export async function createStockOut(tx: Db, actor: Actor, input: StockOutInput) {
  if (!(DIRECT_OUT_TYPES as readonly string[]).includes(input.outType)) {
    throw businessRule('USE_ORDER_DELIVERY', 'Customer deliveries are posted through POST /api/v1/orders/{id}/deliveries.');
  }
  validateTypeFields(input);
  assertUniqueProducts(input.lines);
  const products = await loadProducts(tx, input.lines, { requireActive: true });
  const number = await nextNumber(tx, 'SOUT');
  const transferNumber = input.outType === 'WarehouseTransfer' ? await nextNumber(tx, 'TRF') : null;
  const v = await insertStockOutVersion(tx, actor, { number, version: 1, supersedesId: null, correctionReason: null, transferNumber, orderId: null }, input, products);
  await postMovements(tx, actor, v.movements);
  await attachReceipt(tx, actor, v.header, v.lines);
  const detail = await getStockOut(tx, v.header.id);
  await audit(tx, actor, { action: 'StockOut.Create', entityType: 'StockOut', entityId: v.header.id, newData: detail });
  return detail;
}

export async function correctStockOut(
  tx: Db,
  actor: Actor,
  id: string,
  input: { outType?: OutType; recipientName?: string | null; destinationWarehouse?: string | null; businessDate?: string; lines: { productId: string; quantity: number }[]; reason: string },
) {
  const orig = (await tx.query('SELECT * FROM stock_outs WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!orig) throw notFound('Stock Out');
  if (orig.out_type === 'CustomerDelivery') {
    throw businessRule(
      'DELIVERY_CORRECTION_NOT_ALLOWED',
      'Posted deliveries cannot be corrected. Record a return against the order or a stock adjustment instead.',
    );
  }
  if (orig.status !== 'Posted') throw conflict('Only the current version of a transaction can be corrected.', 'ALREADY_SUPERSEDED');
  if (input.outType && input.outType !== orig.out_type) {
    throw badRequest('One or more validation errors occurred.', [{ field: 'outType', message: 'Transaction type cannot be changed by a correction.' }]);
  }
  const full: StockOutInput = {
    outType: orig.out_type,
    recipientName: input.recipientName === undefined ? orig.recipient_name : input.recipientName,
    destinationWarehouse: input.destinationWarehouse === undefined ? orig.destination_warehouse : input.destinationWarehouse,
    businessDate: input.businessDate ?? orig.business_date,
    lines: input.lines,
  };
  validateTypeFields(full);
  assertUniqueProducts(full.lines);
  const before = await getStockOut(tx, id);
  const products = await loadCorrectionProducts(tx, full.lines, new Set(before.lines.map((l) => l.productId)));
  // Free the 'current version' slot first (unique index on number WHERE status='Posted').
  await tx.query(`UPDATE stock_outs SET status='Superseded' WHERE id=$1`, [orig.id]);
  const v = await insertStockOutVersion(
    tx,
    actor,
    { number: orig.number, version: orig.version + 1, supersedesId: orig.id, correctionReason: input.reason, transferNumber: orig.transfer_number, orderId: null },
    full,
    products,
  );
  await tx.query(`UPDATE stock_outs SET superseded_by_id=$2 WHERE id=$1`, [orig.id, v.header.id]);
  await postMovements(tx, actor, [...(await reversalsFor(tx, 'StockOut', orig.id)), ...v.movements]);
  const rec = await attachReceipt(tx, actor, v.header, v.lines);
  await supersedeReceipt(tx, orig.receipt_id, rec.id);
  const after = await getStockOut(tx, v.header.id);
  await audit(tx, actor, { action: 'StockOut.Correction', entityType: 'StockOut', entityId: v.header.id, description: input.reason, oldData: before, newData: after });
  return after;
}

function mapHeader(r: any) {
  return {
    id: r.id,
    number: r.number,
    version: r.version,
    status: r.status,
    outType: r.out_type,
    recipientName: r.recipient_name,
    destinationWarehouse: r.destination_warehouse,
    transferNumber: r.transfer_number,
    orderId: r.order_id,
    orderNumber: r.order_number ?? null,
    customerName: r.customer_name ?? null,
    deliveryId: r.delivery_id ?? null,
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

const BASE_SELECT = `
  SELECT s.*, rc.receipt_number, o.number AS order_number, o.customer_name_snapshot AS customer_name, d.id AS delivery_id
    FROM stock_outs s
    LEFT JOIN receipts rc ON rc.id = s.receipt_id
    LEFT JOIN orders o ON o.id = s.order_id
    LEFT JOIN deliveries d ON d.stock_out_id = s.id`;

export async function getStockOut(db: Db, id: string) {
  const h = (
    await db.query(
      `SELECT x.*, a.username AS created_by_username FROM (${BASE_SELECT}) x LEFT JOIN admins a ON a.id = x.created_by WHERE x.id = $1`,
      [id],
    )
  ).rows[0];
  if (!h) throw notFound('Stock Out');
  const lines = (await db.query('SELECT * FROM stock_out_lines WHERE stock_out_id = $1 ORDER BY line_no', [id])).rows;
  const versions = (await db.query('SELECT id, version, status, created_at FROM stock_outs WHERE number = $1 ORDER BY version', [h.number])).rows;
  return {
    ...mapHeader(h),
    lines: lines.map((l) => ({ id: l.id, productId: l.product_id, productName: l.product_name_snapshot, quantity: l.quantity })),
    totalQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.created_at })),
  };
}

export async function listStockOuts(db: Db, q: ListQuery & { includeSuperseded?: boolean }, forceType?: OutType) {
  const w = new Sql();
  if (!q.includeSuperseded) w.and(`s.status = 'Posted'`);
  const type = forceType ?? ensureEnum('type', q.type, OUT_TYPES);
  if (type) w.and(`s.out_type = ${w.p(type)}`);
  w.period('s.business_date', q);
  if (q.productId) w.and(`EXISTS (SELECT 1 FROM stock_out_lines l WHERE l.stock_out_id = s.id AND l.product_id = ${w.p(q.productId)})`);
  if (q.customerId) w.and(`o.customer_id = ${w.p(q.customerId)}`);
  if (q.search) {
    const ph = w.p(`%${q.search}%`);
    w.and(
      `(s.number ILIKE ${ph} OR s.transfer_number ILIKE ${ph} OR s.recipient_name ILIKE ${ph} OR s.destination_warehouse ILIKE ${ph}
        OR o.number ILIKE ${ph} OR o.customer_name_snapshot ILIKE ${ph}
        OR EXISTS (SELECT 1 FROM stock_out_lines l WHERE l.stock_out_id = s.id AND l.product_name_snapshot ILIKE ${ph}))`,
    );
  }
  const order = orderBy(q.sort, { number: 's.number', businessDate: 's.business_date', createdAt: 's.created_at', type: 's.out_type' }, 's.created_at DESC, s.id');
  const from = `FROM stock_outs s LEFT JOIN orders o ON o.id = s.order_id`;
  const total = (await db.query(`SELECT count(*)::int n ${from} ${w.where()}`, w.params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT s.*, rc.receipt_number, o.number AS order_number, o.customer_name_snapshot AS customer_name, d.id AS delivery_id,
              (SELECT SUM(quantity)::int FROM stock_out_lines l WHERE l.stock_out_id = s.id) AS total_quantity,
              (SELECT count(*)::int FROM stock_out_lines l WHERE l.stock_out_id = s.id) AS line_count
         ${from} LEFT JOIN receipts rc ON rc.id = s.receipt_id LEFT JOIN deliveries d ON d.stock_out_id = s.id
        ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(mapHeader), meta: pageMeta(q.page, q.pageSize, total) };
}
