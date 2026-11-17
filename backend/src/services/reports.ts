import type { Db } from '../db/pool';
import { badRequest } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, escapeLike, Sql } from '../utils/sql';
import { damagedBalances } from './damaged';
import type { Column } from './pdf';

export const REPORT_TYPES = [
  'current-stock',
  'stock-in',
  'stock-out',
  'customer-orders',
  'returns',
  'adjustments',
  'sample-gift',
  'warehouse-transfer',
  'low-stock',
  'damaged-stock',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export type ReportQuery = ListQuery & { condition?: 'Good' | 'Damaged' };

interface ReportDef {
  title: string;
  /** Snapshot reports ignore date filters. */
  snapshot?: boolean;
  columns: Column[];
  /** FROM ... (joins); may reference w for params. */
  from: (w: Sql, q: ReportQuery) => string;
  /** Adds WHERE conditions. */
  filter: (w: Sql, q: ReportQuery) => void;
  select: string;
  order: string;
  /** Aggregates, each aliased in camelCase. */
  summary: string;
}

const like = (w: Sql, q: ReportQuery) => (q.search ? w.p(`%${escapeLike(q.search)}%`) : null);

const DEFS: Record<ReportType, ReportDef> = {
  'current-stock': {
    title: 'Current Stock Report',
    snapshot: true,
    columns: [
      { key: 'productName', label: 'Product', width: 3 },
      { key: 'status', label: 'Status' },
      { key: 'availableStock', label: 'Available (BOX)', align: 'right' },
      { key: 'damagedStock', label: 'Damaged (BOX)', align: 'right' },
      { key: 'minimumStock', label: 'Minimum', align: 'right' },
      { key: 'sellingPrice', label: 'Selling Price (KES)', align: 'right', format: 'money' },
      { key: 'lowStock', label: 'Low Stock' },
    ],
    from: () => 'FROM products p JOIN product_balances b ON b.product_id = p.id',
    filter: (w, q) => {
      if (q.status) w.and(`p.status = ${w.p(ensureEnum('status', q.status, ['Active', 'Inactive'] as const))}`);
      if (q.productId) w.and(`p.id = ${w.p(q.productId)}`);
      const s = like(w, q);
      if (s) w.and(`p.name ILIKE ${s}`);
    },
    select: `p.id AS "productId", p.name AS "productName", p.status, b.available AS "availableStock", b.damaged AS "damagedStock",
             p.minimum_stock AS "minimumStock", p.selling_price AS "sellingPrice",
             CASE WHEN p.status = 'Active' AND b.available <= p.minimum_stock THEN 'Yes' ELSE 'No' END AS "lowStock"`,
    order: 'p.name, p.id',
    summary: `count(*)::int AS "recordCount", COALESCE(SUM(b.available),0)::int AS "totalQuantity",
              COALESCE(SUM(b.available),0)::int AS "totalAvailable", COALESCE(SUM(b.damaged),0)::int AS "totalDamaged"`,
  },

  'stock-in': {
    title: 'Stock In Report',
    columns: [
      { key: 'businessDate', label: 'Date' },
      { key: 'number', label: 'Stock In No.' },
      { key: 'stockInType', label: 'Type' },
      { key: 'sourceWarehouse', label: 'Source Warehouse' },
      { key: 'productName', label: 'Product', width: 3 },
      { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
    ],
    from: () => 'FROM stock_in_lines l JOIN stock_ins s ON s.id = l.stock_in_id',
    filter: (w, q) => {
      w.and(`s.status = 'Posted'`);
      const t = ensureEnum('type', q.type, ['NewStock', 'WarehouseTransferIn'] as const);
      if (t) w.and(`s.stock_in_type = ${w.p(t)}`);
      if (q.productId) w.and(`l.product_id = ${w.p(q.productId)}`);
      w.period('s.business_date', q);
      const s = like(w, q);
      if (s) w.and(`(s.number ILIKE ${s} OR l.product_name_snapshot ILIKE ${s} OR s.source_warehouse ILIKE ${s})`);
    },
    select: `s.id AS "stockInId", s.business_date AS "businessDate", s.number, s.version, s.stock_in_type AS "stockInType",
             s.source_warehouse AS "sourceWarehouse", l.product_id AS "productId", l.product_name_snapshot AS "productName", l.quantity`,
    order: 's.business_date DESC, s.number DESC, l.line_no',
    summary: `count(DISTINCT s.id)::int AS "transactionCount", count(*)::int AS "lineCount", COALESCE(SUM(l.quantity),0)::int AS "totalQuantity",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.stock_in_type='NewStock'),0)::int AS "totalNewStock",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.stock_in_type='WarehouseTransferIn'),0)::int AS "totalTransferIn"`,
  },

  'stock-out': {
    title: 'Stock Out Report',
    columns: [
      { key: 'businessDate', label: 'Date' },
      { key: 'number', label: 'Stock Out No.' },
      { key: 'outType', label: 'Type' },
      { key: 'party', label: 'Customer / Recipient / Destination', width: 2.5 },
      { key: 'reference', label: 'Order / Transfer No.' },
      { key: 'productName', label: 'Product', width: 3 },
      { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
    ],
    from: () => 'FROM stock_out_lines l JOIN stock_outs s ON s.id = l.stock_out_id LEFT JOIN orders o ON o.id = s.order_id',
    filter: (w, q) => {
      w.and(`s.status = 'Posted'`);
      const t = ensureEnum('type', q.type, ['CustomerDelivery', 'Sample', 'Gift', 'WarehouseTransfer'] as const);
      if (t) w.and(`s.out_type = ${w.p(t)}`);
      if (q.productId) w.and(`l.product_id = ${w.p(q.productId)}`);
      if (q.customerId) w.and(`o.customer_id = ${w.p(q.customerId)}`);
      w.period('s.business_date', q);
      const s = like(w, q);
      if (s)
        w.and(`(s.number ILIKE ${s} OR s.transfer_number ILIKE ${s} OR l.product_name_snapshot ILIKE ${s} OR s.recipient_name ILIKE ${s}
                OR s.destination_warehouse ILIKE ${s} OR o.number ILIKE ${s} OR o.customer_name_snapshot ILIKE ${s})`);
    },
    select: `s.id AS "stockOutId", s.business_date AS "businessDate", s.number, s.version, s.out_type AS "outType",
             COALESCE(o.customer_name_snapshot, s.recipient_name, s.destination_warehouse) AS party,
             COALESCE(o.number, s.transfer_number) AS reference, l.product_id AS "productId",
             l.product_name_snapshot AS "productName", l.quantity`,
    order: 's.business_date DESC, s.number DESC, l.line_no',
    summary: `count(DISTINCT s.id)::int AS "transactionCount", count(*)::int AS "lineCount", COALESCE(SUM(l.quantity),0)::int AS "totalQuantity",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.out_type='CustomerDelivery'),0)::int AS "totalDelivery",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.out_type='Sample'),0)::int AS "totalSample",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.out_type='Gift'),0)::int AS "totalGift",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.out_type='WarehouseTransfer'),0)::int AS "totalTransfer"`,
  },

  'customer-orders': {
    title: 'Customer Orders Report',
    columns: [
      { key: 'orderDate', label: 'Order Date' },
      { key: 'number', label: 'Order No.' },
      { key: 'customerName', label: 'Customer', width: 2.5 },
      { key: 'status', label: 'Status' },
      { key: 'productName', label: 'Product', width: 3 },
      { key: 'orderedQuantity', label: 'Ordered', align: 'right' },
      { key: 'deliveredQuantity', label: 'Delivered', align: 'right' },
      { key: 'returnedQuantity', label: 'Returned', align: 'right' },
      { key: 'remainingQuantity', label: 'Remaining', align: 'right' },
    ],
    from: () => `FROM order_lines l JOIN orders o ON o.id = l.order_id
                 LEFT JOIN LATERAL (SELECT COALESCE(SUM(rl.quantity),0)::int AS returned FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                                     WHERE r.order_id = o.id AND r.status = 'Posted' AND rl.product_id = l.product_id) rt ON true`,
    filter: (w, q) => {
      const st = ensureEnum('status', q.status ?? q.type, ['Pending', 'PartiallyCompleted', 'Completed'] as const);
      if (st) w.and(`o.status = ${w.p(st)}`);
      if (q.customerId) w.and(`o.customer_id = ${w.p(q.customerId)}`);
      if (q.productId) w.and(`l.product_id = ${w.p(q.productId)}`);
      w.period('o.order_date', q);
      const s = like(w, q);
      if (s) w.and(`(o.number ILIKE ${s} OR o.customer_name_snapshot ILIKE ${s} OR l.product_name_snapshot ILIKE ${s})`);
    },
    select: `o.id AS "orderId", o.order_date AS "orderDate", o.number, o.customer_id AS "customerId", o.customer_name_snapshot AS "customerName",
             o.status, l.product_id AS "productId", l.product_name_snapshot AS "productName", l.ordered_quantity AS "orderedQuantity",
             l.delivered_quantity AS "deliveredQuantity", rt.returned AS "returnedQuantity",
             (l.ordered_quantity - l.delivered_quantity) AS "remainingQuantity"`,
    order: 'o.order_date DESC, o.number DESC, l.created_at',
    summary: `count(DISTINCT o.id)::int AS "transactionCount", count(*)::int AS "lineCount",
              COALESCE(SUM(l.ordered_quantity),0)::int AS "totalQuantity", COALESCE(SUM(l.ordered_quantity),0)::int AS "totalOrdered",
              COALESCE(SUM(l.delivered_quantity),0)::int AS "totalDelivered",
              COALESCE(SUM(l.ordered_quantity - l.delivered_quantity),0)::int AS "totalRemaining",
              COALESCE(SUM(rt.returned),0)::int AS "totalReturned"`,
  },

  returns: {
    title: 'Returns Report',
    columns: [
      { key: 'businessDate', label: 'Date' },
      { key: 'number', label: 'Return No.' },
      { key: 'returnMode', label: 'Type' },
      { key: 'customerName', label: 'Customer', width: 2 },
      { key: 'orderNumber', label: 'Order No.' },
      { key: 'productName', label: 'Product', width: 2.5 },
      { key: 'condition', label: 'Condition' },
      { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
      { key: 'reason', label: 'Reason', width: 2.5 },
    ],
    from: () => 'FROM return_lines l JOIN returns r ON r.id = l.return_id',
    filter: (w, q) => {
      w.and(`r.status = 'Posted'`);
      const t = ensureEnum('type', q.type, ['AgainstOrder', 'Direct'] as const);
      if (t) w.and(`r.return_mode = ${w.p(t)}`);
      if (q.condition) w.and(`l.condition = ${w.p(q.condition)}`);
      if (q.customerId) w.and(`r.customer_id = ${w.p(q.customerId)}`);
      if (q.productId) w.and(`l.product_id = ${w.p(q.productId)}`);
      w.period('r.business_date', q);
      const s = like(w, q);
      if (s) w.and(`(r.number ILIKE ${s} OR r.customer_name_snapshot ILIKE ${s} OR r.order_number_snapshot ILIKE ${s} OR l.product_name_snapshot ILIKE ${s} OR r.reason ILIKE ${s})`);
    },
    select: `r.id AS "returnId", r.business_date AS "businessDate", r.number, r.version, r.return_mode AS "returnMode",
             r.customer_id AS "customerId", r.customer_name_snapshot AS "customerName", r.order_number_snapshot AS "orderNumber",
             l.product_id AS "productId", l.product_name_snapshot AS "productName", l.condition, l.quantity, r.reason`,
    order: 'r.business_date DESC, r.number DESC, l.line_no',
    summary: `count(DISTINCT r.id)::int AS "transactionCount", count(*)::int AS "lineCount", COALESCE(SUM(l.quantity),0)::int AS "totalQuantity",
              COALESCE(SUM(l.quantity) FILTER (WHERE l.condition='Good'),0)::int AS "totalGood",
              COALESCE(SUM(l.quantity) FILTER (WHERE l.condition='Damaged'),0)::int AS "totalDamaged"`,
  },

  adjustments: {
    title: 'Stock Adjustments Report',
    columns: [
      { key: 'businessDate', label: 'Date' },
      { key: 'number', label: 'Adjustment No.' },
      { key: 'direction', label: 'Direction' },
      { key: 'productName', label: 'Product', width: 2.5 },
      { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
      { key: 'availableBefore', label: 'Before', align: 'right' },
      { key: 'availableAfter', label: 'After', align: 'right' },
      { key: 'reason', label: 'Reason', width: 3 },
    ],
    from: () => 'FROM adjustments x',
    filter: (w, q) => {
      w.and(`x.status = 'Posted'`);
      const t = ensureEnum('type', q.type, ['Increase', 'Decrease'] as const);
      if (t) w.and(`x.direction = ${w.p(t)}`);
      if (q.productId) w.and(`x.product_id = ${w.p(q.productId)}`);
      w.period('x.business_date', q);
      const s = like(w, q);
      if (s) w.and(`(x.number ILIKE ${s} OR x.product_name_snapshot ILIKE ${s} OR x.reason ILIKE ${s})`);
    },
    select: `x.id AS "adjustmentId", x.business_date AS "businessDate", x.number, x.version, x.direction, x.product_id AS "productId",
             x.product_name_snapshot AS "productName", x.quantity, x.available_before AS "availableBefore", x.available_after AS "availableAfter", x.reason`,
    order: 'x.business_date DESC, x.number DESC',
    summary: `count(*)::int AS "transactionCount", COALESCE(SUM(x.quantity),0)::int AS "totalQuantity",
              COALESCE(SUM(x.quantity) FILTER (WHERE x.direction='Increase'),0)::int AS "totalIncrease",
              COALESCE(SUM(x.quantity) FILTER (WHERE x.direction='Decrease'),0)::int AS "totalDecrease"`,
  },

  'sample-gift': {
    title: 'Sample & Gift Report',
    columns: [
      { key: 'businessDate', label: 'Date' },
      { key: 'number', label: 'Stock Out No.' },
      { key: 'outType', label: 'Type' },
      { key: 'recipientName', label: 'Recipient', width: 2.5 },
      { key: 'productName', label: 'Product', width: 3 },
      { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
    ],
    from: () => 'FROM stock_out_lines l JOIN stock_outs s ON s.id = l.stock_out_id',
    filter: (w, q) => {
      w.and(`s.status = 'Posted' AND s.out_type IN ('Sample','Gift')`);
      const t = ensureEnum('type', q.type, ['Sample', 'Gift'] as const);
      if (t) w.and(`s.out_type = ${w.p(t)}`);
      if (q.productId) w.and(`l.product_id = ${w.p(q.productId)}`);
      w.period('s.business_date', q);
      const s = like(w, q);
      if (s) w.and(`(s.number ILIKE ${s} OR s.recipient_name ILIKE ${s} OR l.product_name_snapshot ILIKE ${s})`);
    },
    select: `s.id AS "stockOutId", s.business_date AS "businessDate", s.number, s.version, s.out_type AS "outType",
             s.recipient_name AS "recipientName", l.product_id AS "productId", l.product_name_snapshot AS "productName", l.quantity`,
    order: 's.business_date DESC, s.number DESC, l.line_no',
    summary: `count(DISTINCT s.id)::int AS "transactionCount", count(*)::int AS "lineCount", COALESCE(SUM(l.quantity),0)::int AS "totalQuantity",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.out_type='Sample'),0)::int AS "totalSample",
              COALESCE(SUM(l.quantity) FILTER (WHERE s.out_type='Gift'),0)::int AS "totalGift"`,
  },

  'warehouse-transfer': {
    title: 'Warehouse Transfer Report',
    columns: [
      { key: 'businessDate', label: 'Date' },
      { key: 'direction', label: 'Direction' },
      { key: 'number', label: 'Document No.' },
      { key: 'transferNumber', label: 'Transfer No.' },
      { key: 'warehouse', label: 'From / To Warehouse', width: 2.5 },
      { key: 'productName', label: 'Product', width: 3 },
      { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
    ],
    from: () => `FROM (
        SELECT 'Out'::text AS direction, s.id AS source_id, s.number, s.version, s.transfer_number, s.business_date,
               s.destination_warehouse AS warehouse, l.product_id, l.product_name_snapshot, l.quantity, l.line_no
          FROM stock_outs s JOIN stock_out_lines l ON l.stock_out_id = s.id
         WHERE s.out_type = 'WarehouseTransfer' AND s.status = 'Posted'
        UNION ALL
        SELECT 'In', s.id, s.number, s.version, NULL, s.business_date, s.source_warehouse, l.product_id, l.product_name_snapshot, l.quantity, l.line_no
          FROM stock_ins s JOIN stock_in_lines l ON l.stock_in_id = s.id
         WHERE s.stock_in_type = 'WarehouseTransferIn' AND s.status = 'Posted'
      ) x`,
    filter: (w, q) => {
      const t = ensureEnum('type', q.type, ['In', 'Out'] as const);
      if (t) w.and(`x.direction = ${w.p(t)}`);
      if (q.productId) w.and(`x.product_id = ${w.p(q.productId)}`);
      w.period('x.business_date', q);
      const s = like(w, q);
      if (s) w.and(`(x.number ILIKE ${s} OR x.transfer_number ILIKE ${s} OR x.warehouse ILIKE ${s} OR x.product_name_snapshot ILIKE ${s})`);
    },
    select: `x.source_id AS "sourceId", x.business_date AS "businessDate", x.direction, x.number, x.version, x.transfer_number AS "transferNumber",
             x.warehouse, x.product_id AS "productId", x.product_name_snapshot AS "productName", x.quantity`,
    order: 'x.business_date DESC, x.number DESC, x.line_no',
    summary: `count(DISTINCT (x.direction, x.source_id))::int AS "transactionCount", count(*)::int AS "lineCount",
              COALESCE(SUM(x.quantity),0)::int AS "totalQuantity",
              COALESCE(SUM(x.quantity) FILTER (WHERE x.direction='In'),0)::int AS "totalIn",
              COALESCE(SUM(x.quantity) FILTER (WHERE x.direction='Out'),0)::int AS "totalOut"`,
  },

  'low-stock': {
    title: 'Low Stock Report',
    snapshot: true,
    columns: [
      { key: 'productName', label: 'Product', width: 3 },
      { key: 'availableStock', label: 'Available (BOX)', align: 'right' },
      { key: 'minimumStock', label: 'Minimum', align: 'right' },
      { key: 'shortfall', label: 'Shortfall', align: 'right' },
      { key: 'damagedStock', label: 'Damaged', align: 'right' },
    ],
    from: () => 'FROM products p JOIN product_balances b ON b.product_id = p.id',
    filter: (w, q) => {
      w.and(`p.status = 'Active' AND b.available <= p.minimum_stock`);
      if (q.productId) w.and(`p.id = ${w.p(q.productId)}`);
      const s = like(w, q);
      if (s) w.and(`p.name ILIKE ${s}`);
    },
    select: `p.id AS "productId", p.name AS "productName", b.available AS "availableStock", p.minimum_stock AS "minimumStock",
             (p.minimum_stock - b.available) AS shortfall, b.damaged AS "damagedStock"`,
    order: '(p.minimum_stock - b.available) DESC, p.name',
    summary: `count(*)::int AS "recordCount", COALESCE(SUM(b.available),0)::int AS "totalQuantity",
              COALESCE(SUM(p.minimum_stock - b.available),0)::int AS "totalShortfall"`,
  },

  'damaged-stock': {
    title: 'Damaged Stock Report',
    columns: [
      { key: 'businessDate', label: 'Date' },
      { key: 'eventType', label: 'Event' },
      { key: 'referenceNumber', label: 'Reference' },
      { key: 'productName', label: 'Product', width: 2.5 },
      { key: 'quantity', label: 'Qty (BOX)', align: 'right' },
      { key: 'party', label: 'Customer', width: 2 },
      { key: 'reason', label: 'Reason', width: 3 },
    ],
    from: () => `FROM (
        SELECT 'DamagedReturn'::text AS event_type, r.id AS source_id, r.number AS reference_number, r.business_date, l.product_id,
               l.product_name_snapshot, l.quantity, r.customer_name_snapshot AS party, r.reason, r.created_at
          FROM return_lines l JOIN returns r ON r.id = l.return_id
         WHERE l.condition = 'Damaged' AND r.status = 'Posted'
        UNION ALL
        SELECT a.action_type, a.id, rc.receipt_number, a.business_date, a.product_id, a.product_name_snapshot, a.quantity, NULL, a.reason, a.created_at
          FROM damaged_stock_actions a LEFT JOIN receipts rc ON rc.id = a.receipt_id
      ) x`,
    filter: (w, q) => {
      const t = ensureEnum('type', q.type, ['DamagedReturn', 'MarkAsGood', 'RemoveFromDamaged'] as const);
      if (t) w.and(`x.event_type = ${w.p(t)}`);
      if (q.productId) w.and(`x.product_id = ${w.p(q.productId)}`);
      w.period('x.business_date', q);
      const s = like(w, q);
      if (s) w.and(`(x.reference_number ILIKE ${s} OR x.product_name_snapshot ILIKE ${s} OR x.reason ILIKE ${s} OR x.party ILIKE ${s})`);
    },
    select: `x.source_id AS "sourceId", x.business_date AS "businessDate", x.event_type AS "eventType", x.reference_number AS "referenceNumber",
             x.product_id AS "productId", x.product_name_snapshot AS "productName", x.quantity, x.party, x.reason`,
    order: 'x.business_date DESC, x.created_at DESC',
    summary: `count(*)::int AS "transactionCount", COALESCE(SUM(x.quantity),0)::int AS "totalQuantity",
              COALESCE(SUM(x.quantity) FILTER (WHERE x.event_type='DamagedReturn'),0)::int AS "totalDamagedReturns",
              COALESCE(SUM(x.quantity) FILTER (WHERE x.event_type='MarkAsGood'),0)::int AS "totalMarkedAsGood",
              COALESCE(SUM(x.quantity) FILTER (WHERE x.event_type='RemoveFromDamaged'),0)::int AS "totalRemoved"`,
  },
};

export function reportDef(type: string): ReportDef & { type: ReportType } {
  if (!(REPORT_TYPES as readonly string[]).includes(type)) {
    throw badRequest('Unknown report type.', [{ field: 'reportType', message: `Must be one of: ${REPORT_TYPES.join(', ')}` }]);
  }
  return { ...DEFS[type as ReportType], type: type as ReportType };
}

/**
 * Run a report from persisted transaction data (current versions only).
 * `paginate=false` returns the whole filtered result (used for PDF export).
 */
export async function runReport(db: Db, type: string, q: ReportQuery, paginate = true) {
  const def = reportDef(type);
  const w = new Sql();
  const effective: ReportQuery = def.snapshot ? { ...q, period: undefined, from: undefined, to: undefined, date: undefined } : q;
  const from = def.from(w, effective);
  def.filter(w, effective);
  const where = w.where();
  const baseParams = [...w.params];
  const summary = (await db.query(`SELECT ${def.summary} ${from} ${where}`, baseParams)).rows[0];
  const totalRows = (await db.query(`SELECT count(*)::int AS n ${from} ${where}`, baseParams)).rows[0].n as number;
  const limit = paginate ? w.limit(q.page, q.pageSize) : `LIMIT ${w.p(50_000)}`;
  const rows = (await db.query(`SELECT ${def.select} ${from} ${where} ORDER BY ${def.order} ${limit}`, w.params)).rows;

  let period: { from: string; to: string } | null = null;
  if (!def.snapshot) {
    const probe = new Sql();
    period = probe.period('x', effective);
  }
  let balances: unknown;
  if (def.type === 'damaged-stock') {
    const all = await damagedBalances(db);
    balances = q.productId ? all.filter((b) => b.productId === q.productId) : all;
    (summary as any).currentDamagedTotal = (balances as { damagedStock: number }[]).reduce((s, b) => s + b.damagedStock, 0);
  }
  return {
    def,
    rows,
    meta: {
      ...(paginate ? pageMeta(q.page, q.pageSize, totalRows) : { totalItems: totalRows }),
      reportType: def.type,
      title: def.title,
      snapshot: !!def.snapshot,
      period,
      summary,
      columns: def.columns,
      ...(balances !== undefined ? { balances } : {}),
    },
  };
}
