import type { Db } from '../db/pool';
import { deriveOrderStatus } from '../domain/orderStatus';
import type { Actor } from '../http/context';
import { badRequest, businessRule, conflict, FieldError, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, orderBy, Sql } from '../utils/sql';
import { audit } from './audit';
import { assertUniqueProducts, loadCustomer, loadProducts, ProductRef } from './common';
import { postMovements } from './ledger';
import { nextNumber } from './numbering';
import { createReceipt, fmtQty } from './receipts';
import { insertStockOutVersion } from './stockOuts';

export const ORDER_STATUSES = ['Pending', 'PartiallyCompleted', 'Completed'] as const;

/** Per-line quantities incl. returned (posted returns against this order) and returnable. */
async function orderLines(db: Db, orderId: string) {
  const rows = (
    await db.query(
      `SELECT l.*, COALESCE(r.returned, 0)::int AS returned_quantity
         FROM order_lines l
         LEFT JOIN (
           SELECT rl.product_id, SUM(rl.quantity) AS returned
             FROM return_lines rl JOIN returns rt ON rt.id = rl.return_id
            WHERE rt.order_id = $1 AND rt.status = 'Posted'
            GROUP BY rl.product_id
         ) r ON r.product_id = l.product_id
        WHERE l.order_id = $1 ORDER BY l.created_at, l.id`,
      [orderId],
    )
  ).rows;
  return rows.map((l) => ({
    id: l.id,
    productId: l.product_id,
    productName: l.product_name_snapshot,
    orderedQuantity: l.ordered_quantity,
    deliveredQuantity: l.delivered_quantity,
    remainingQuantity: l.ordered_quantity - l.delivered_quantity,
    returnedQuantity: l.returned_quantity,
    returnableQuantity: l.delivered_quantity - l.returned_quantity,
  }));
}

function mapOrder(r: any) {
  return {
    id: r.id,
    number: r.number,
    customerId: r.customer_id,
    customerName: r.customer_name_snapshot,
    orderDate: r.order_date,
    status: r.status,
    completedAt: r.completed_at,
    receiptId: r.receipt_id,
    receiptNumber: r.receipt_number ?? null,
    totalOrdered: r.total_ordered ?? undefined,
    totalDelivered: r.total_delivered ?? undefined,
    totalRemaining: r.total_ordered !== undefined ? r.total_ordered - r.total_delivered : undefined,
    rowVersion: r.row_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getOrder(db: Db, id: string) {
  const o = (await db.query('SELECT o.*, rc.receipt_number FROM orders o LEFT JOIN receipts rc ON rc.id = o.receipt_id WHERE o.id = $1', [id])).rows[0];
  if (!o) throw notFound('Order');
  const lines = await orderLines(db, id);
  const deliveries = await listDeliveries(db, id);
  return {
    ...mapOrder(o),
    totalOrdered: lines.reduce((s, l) => s + l.orderedQuantity, 0),
    totalDelivered: lines.reduce((s, l) => s + l.deliveredQuantity, 0),
    totalRemaining: lines.reduce((s, l) => s + l.remainingQuantity, 0),
    totalReturned: lines.reduce((s, l) => s + l.returnedQuantity, 0),
    lines,
    deliveries,
  };
}

export async function listOrders(db: Db, q: ListQuery) {
  const w = new Sql();
  const status = ensureEnum('status', q.status, ORDER_STATUSES);
  if (status) w.and(`o.status = ${w.p(status)}`);
  if (q.customerId) w.and(`o.customer_id = ${w.p(q.customerId)}`);
  if (q.productId) w.and(`EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id AND l.product_id = ${w.p(q.productId)})`);
  w.period('o.order_date', q);
  w.search(q.search, ['o.number', 'o.customer_name_snapshot']);
  const order = orderBy(q.sort, { number: 'o.number', orderDate: 'o.order_date', status: 'o.status', customerName: 'o.customer_name_snapshot', createdAt: 'o.created_at' }, 'o.created_at DESC, o.id');
  const total = (await db.query(`SELECT count(*)::int n FROM orders o ${w.where()}`, w.params)).rows[0].n;
  const rows = (
    await db.query(
      `SELECT o.*, rc.receipt_number,
              (SELECT SUM(ordered_quantity)::int FROM order_lines l WHERE l.order_id = o.id) AS total_ordered,
              (SELECT SUM(delivered_quantity)::int FROM order_lines l WHERE l.order_id = o.id) AS total_delivered
         FROM orders o LEFT JOIN receipts rc ON rc.id = o.receipt_id ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(mapOrder), meta: pageMeta(q.page, q.pageSize, total) };
}

export async function createOrder(tx: Db, actor: Actor, input: { customerId: string; orderDate: string; lines: { productId: string; orderedQuantity: number }[] }) {
  assertUniqueProducts(input.lines);
  const customer = await loadCustomer(tx, input.customerId);
  const products = await loadProducts(tx, input.lines, { requireActive: true });
  const number = await nextNumber(tx, 'ORD');
  const o = (
    await tx.query(
      `INSERT INTO orders(number, customer_id, customer_name_snapshot, order_date, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
      [number, customer.id, customer.full_name, input.orderDate, actor.adminId],
    )
  ).rows[0];
  await insertLines(tx, o.id, input.lines, products);
  const detail = await getOrder(tx, o.id);
  await audit(tx, actor, { action: 'Order.Create', entityType: 'Order', entityId: o.id, newData: detail });
  return detail;
}

async function insertLines(tx: Db, orderId: string, lines: { productId: string; orderedQuantity: number }[], products: Map<string, ProductRef>) {
  for (const l of lines) {
    await tx.query(`INSERT INTO order_lines(order_id, product_id, product_name_snapshot, ordered_quantity) VALUES ($1,$2,$3,$4)`, [
      orderId,
      l.productId,
      products.get(l.productId)!.name,
      l.orderedQuantity,
    ]);
  }
}

/** Recalculate the derived status; creates the order receipt the first time it becomes Completed. */
async function refreshStatus(tx: Db, actor: Actor, orderId: string) {
  const o = (await tx.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  const lines = (await tx.query('SELECT ordered_quantity, delivered_quantity FROM order_lines WHERE order_id = $1', [orderId])).rows;
  const status = deriveOrderStatus(lines.map((l) => ({ ordered: l.ordered_quantity, delivered: l.delivered_quantity })));
  let receiptId: string | null = o.receipt_id;
  if (status === 'Completed' && !o.receipt_id) {
    const detail = await getOrder(tx, orderId);
    const rec = await createReceipt(tx, actor, {
      receiptType: 'CustomerOrder',
      sourceType: 'Order',
      sourceId: orderId,
      sourceNumber: o.number,
      sourceVersion: 1,
      businessDate: detail.deliveries[0]?.deliveryDate ?? o.order_date,
      payload: {
        title: 'Customer Order Receipt',
        sourceNumber: o.number,
        version: 1,
        businessDate: detail.deliveries[0]?.deliveryDate ?? o.order_date,
        fields: [
          { label: 'Order No.', value: o.number },
          { label: 'Customer', value: o.customer_name_snapshot },
          { label: 'Order Date', value: o.order_date },
          { label: 'Status', value: 'Completed' },
          { label: 'Deliveries', value: detail.deliveries.map((d) => `${d.deliveryDate} (${d.stockOutNumber})`).join(', ') || '-' },
        ],
        columns: [
          { key: 'no', label: '#' },
          { key: 'product', label: 'Product' },
          { key: 'ordered', label: 'Ordered (BOX)', align: 'right' },
          { key: 'delivered', label: 'Delivered (BOX)', align: 'right' },
        ],
        lines: detail.lines.map((l, i) => ({ no: i + 1, product: l.productName, ordered: l.orderedQuantity, delivered: l.deliveredQuantity })),
        totals: [{ label: 'Total Delivered', value: fmtQty(detail.totalDelivered) }],
      },
    });
    receiptId = rec.id;
    await audit(tx, actor, { action: 'Order.Completed', entityType: 'Order', entityId: orderId, newData: { receiptId: rec.id, receiptNumber: rec.receiptNumber } });
  }
  await tx.query(
    `UPDATE orders SET status = $2, receipt_id = $3, completed_at = CASE WHEN $2 = 'Completed' THEN COALESCE(completed_at, now()) ELSE completed_at END
      WHERE id = $1`,
    [orderId, status, receiptId],
  );
  return status;
}

export async function updateOrder(
  tx: Db,
  actor: Actor,
  id: string,
  expectedVersion: number,
  input: { customerId?: string; orderDate?: string; lines?: { id?: string; productId: string; orderedQuantity: number }[]; reason?: string | null },
) {
  const o = (await tx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!o) throw notFound('Order');
  if (o.row_version !== expectedVersion) throw conflict('The order was changed by another request. Reload and try again.', 'CONCURRENCY_CONFLICT');
  if (o.status === 'Completed') throw businessRule('ORDER_NOT_EDITABLE', 'Completed orders cannot be edited.');
  const before = await getOrder(tx, id);
  const hasDeliveries = before.deliveries.length > 0;

  if (input.customerId && input.customerId !== o.customer_id) {
    if (hasDeliveries) throw businessRule('ORDER_CUSTOMER_LOCKED', 'The customer can only be changed while the order is Pending with no deliveries.');
    const c = await loadCustomer(tx, input.customerId);
    await tx.query('UPDATE orders SET customer_id=$2, customer_name_snapshot=$3 WHERE id=$1', [id, c.id, c.full_name]);
  }
  if (input.orderDate && input.orderDate !== o.order_date) {
    if (hasDeliveries) throw businessRule('ORDER_DATE_LOCKED', 'The order date can only be changed while the order has no deliveries.');
    await tx.query('UPDATE orders SET order_date=$2 WHERE id=$1', [id, input.orderDate]);
  }

  if (input.lines) {
    if (input.lines.length === 0) throw badRequest('One or more validation errors occurred.', [{ field: 'lines', message: 'At least one line must remain.' }]);
    assertUniqueProducts(input.lines);
    const existing = new Map(before.lines.map((l) => [l.id, l]));
    const byProduct = new Map(before.lines.map((l) => [l.productId, l]));
    const errors: FieldError[] = [];
    const keep = new Set<string>();
    const updates: { lineId: string; productId: string; qty: number; productChanged: boolean }[] = [];
    const additions: { productId: string; orderedQuantity: number }[] = [];
    input.lines.forEach((nl, i) => {
      const match = nl.id ? existing.get(nl.id) : byProduct.get(nl.productId);
      if (nl.id && !match) {
        errors.push({ field: `lines[${i}].id`, message: 'Order line not found on this order.' });
        return;
      }
      if (!match) {
        additions.push({ productId: nl.productId, orderedQuantity: nl.orderedQuantity });
        return;
      }
      keep.add(match.id);
      if (match.productId !== nl.productId && match.deliveredQuantity > 0) {
        errors.push({ field: `lines[${i}].productId`, message: 'The product of a line with delivered quantity cannot be changed.' });
      }
      if (nl.orderedQuantity < match.deliveredQuantity) {
        errors.push({ field: `lines[${i}].orderedQuantity`, message: `Ordered quantity cannot be below the delivered quantity (${match.deliveredQuantity}).` });
      }
      updates.push({ lineId: match.id, productId: nl.productId, qty: nl.orderedQuantity, productChanged: match.productId !== nl.productId });
    });
    for (const l of before.lines) {
      if (!keep.has(l.id) && l.deliveredQuantity > 0) {
        errors.push({ field: 'lines', message: `Line "${l.productName}" has delivered quantity and cannot be removed.` });
      }
    }
    if (errors.length) throw businessRule('ORDER_EDIT_NOT_ALLOWED', 'The requested order edit is not allowed.', errors);

    const changedProducts = [...additions.map((a) => ({ productId: a.productId })), ...updates.filter((u) => u.productChanged).map((u) => ({ productId: u.productId }))];
    const products = changedProducts.length ? await loadProducts(tx, changedProducts, { requireActive: true }) : new Map<string, ProductRef>();

    for (const l of before.lines) if (!keep.has(l.id)) await tx.query('DELETE FROM order_lines WHERE id = $1', [l.id]);
    for (const u of updates) {
      if (u.productChanged) {
        await tx.query('UPDATE order_lines SET product_id=$2, product_name_snapshot=$3, ordered_quantity=$4 WHERE id=$1', [u.lineId, u.productId, products.get(u.productId)!.name, u.qty]);
      } else {
        await tx.query('UPDATE order_lines SET ordered_quantity=$2 WHERE id=$1', [u.lineId, u.qty]);
      }
    }
    await insertLines(tx, id, additions, products);
  }

  await tx.query('UPDATE orders SET row_version=row_version+1, updated_at=now(), updated_by=$2 WHERE id=$1', [id, actor.adminId]);
  await refreshStatus(tx, actor, id);
  const after = await getOrder(tx, id);
  const oldValues = { customerId: before.customerId, customerName: before.customerName, orderDate: before.orderDate, status: before.status, lines: before.lines.map(({ productId, productName, orderedQuantity, deliveredQuantity }) => ({ productId, productName, orderedQuantity, deliveredQuantity })) };
  const newValues = { customerId: after.customerId, customerName: after.customerName, orderDate: after.orderDate, status: after.status, lines: after.lines.map(({ productId, productName, orderedQuantity, deliveredQuantity }) => ({ productId, productName, orderedQuantity, deliveredQuantity })) };
  if (JSON.stringify(oldValues) === JSON.stringify(newValues)) throw badRequest('No changes were supplied.', [{ field: 'body', message: 'Nothing to update.' }]);
  await tx.query('INSERT INTO order_edit_history(order_id, old_values, new_values, reason, admin_id) VALUES ($1,$2,$3,$4,$5)', [
    id,
    JSON.stringify(oldValues),
    JSON.stringify(newValues),
    input.reason ?? null,
    actor.adminId,
  ]);
  await audit(tx, actor, { action: 'Order.Edit', entityType: 'Order', entityId: id, description: input.reason ?? undefined, oldData: oldValues, newData: newValues });
  return after;
}

export async function orderEditHistory(db: Db, id: string) {
  const rows = (
    await db.query(
      `SELECT h.*, a.username FROM order_edit_history h LEFT JOIN admins a ON a.id = h.admin_id WHERE h.order_id = $1 ORDER BY h.created_at DESC`,
      [id],
    )
  ).rows;
  return rows.map((r) => ({ id: r.id, oldValues: r.old_values, newValues: r.new_values, reason: r.reason, admin: r.username, createdAt: r.created_at }));
}

export async function listDeliveries(db: Db, orderId: string) {
  const rows = (
    await db.query(
      `SELECT d.*, s.number AS stock_out_number, a.username,
              COALESCE(json_agg(json_build_object('orderLineId', dl.order_line_id, 'productId', dl.product_id,
                       'productName', ol.product_name_snapshot, 'quantity', dl.quantity) ORDER BY ol.created_at) FILTER (WHERE dl.id IS NOT NULL), '[]') AS lines
         FROM deliveries d
         JOIN stock_outs s ON s.id = d.stock_out_id
         LEFT JOIN admins a ON a.id = d.created_by
         LEFT JOIN delivery_lines dl ON dl.delivery_id = d.id
         LEFT JOIN order_lines ol ON ol.id = dl.order_line_id
        WHERE d.order_id = $1
        GROUP BY d.id, s.number, a.username
        ORDER BY d.created_at`,
      [orderId],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    deliveryDate: r.delivery_date,
    stockOutId: r.stock_out_id,
    stockOutNumber: r.stock_out_number,
    lines: r.lines as { orderLineId: string; productId: string; productName: string; quantity: number }[],
    totalQuantity: (r.lines as any[]).reduce((s, l) => s + l.quantity, 0),
    createdAt: r.created_at,
    createdBy: r.username,
  }));
}

/**
 * Post a (partial or full) delivery: creates a CustomerDelivery Stock Out (SOUT-), deducts
 * Available stock, updates delivered quantities and the derived status, and creates the
 * order receipt when the order first becomes Completed. The order row is locked so two
 * concurrent deliveries cannot over-deliver.
 */
export async function postDelivery(
  tx: Db,
  actor: Actor,
  orderId: string,
  input: { deliveryDate: string; lines: { orderLineId?: string; productId?: string; quantity: number }[] },
) {
  const o = (await tx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
  if (!o) throw notFound('Order');
  if (o.status === 'Completed') throw businessRule('ORDER_ALREADY_COMPLETED', 'This order is already fully delivered.');
  if (input.deliveryDate < o.order_date) {
    throw badRequest('One or more validation errors occurred.', [{ field: 'deliveryDate', message: 'Delivery date cannot be before the order date.' }]);
  }
  const lines = (await tx.query('SELECT * FROM order_lines WHERE order_id = $1', [orderId])).rows;
  const byId = new Map(lines.map((l) => [l.id, l]));
  const byProduct = new Map(lines.map((l) => [l.product_id, l]));
  const errors: FieldError[] = [];
  const resolved: { line: any; quantity: number }[] = [];
  const seen = new Set<string>();
  input.lines.forEach((dl, i) => {
    const line = dl.orderLineId ? byId.get(dl.orderLineId) : dl.productId ? byProduct.get(dl.productId) : undefined;
    if (!line) {
      errors.push({ field: `lines[${i}]`, message: 'Order line not found on this order (send orderLineId or productId).' });
      return;
    }
    if (seen.has(line.id)) {
      errors.push({ field: `lines[${i}]`, message: 'Each order line may appear only once per delivery.' });
      return;
    }
    seen.add(line.id);
    resolved.push({ line, quantity: dl.quantity });
  });
  if (errors.length) throw badRequest('One or more validation errors occurred.', errors);
  const over = resolved
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.quantity > r.line.ordered_quantity - r.line.delivered_quantity)
    .map(({ r, i }) => ({
      field: `lines[${i}].quantity`,
      message: `Over-delivery for "${r.line.product_name_snapshot}": remaining ${r.line.ordered_quantity - r.line.delivered_quantity} BOX, requested ${r.quantity} BOX.`,
    }));
  if (over.length) throw businessRule('OVER_DELIVERY', 'Delivered quantity cannot exceed ordered quantity.', over);

  const products = await loadProducts(tx, resolved.map((r) => ({ productId: r.line.product_id })), { requireActive: false });
  const number = await nextNumber(tx, 'SOUT');
  const so = await insertStockOutVersion(
    tx,
    actor,
    { number, version: 1, supersedesId: null, correctionReason: null, transferNumber: null, orderId },
    { outType: 'CustomerDelivery', businessDate: input.deliveryDate, lines: resolved.map((r) => ({ productId: r.line.product_id, quantity: r.quantity })) },
    products,
  );
  const d = (
    await tx.query('INSERT INTO deliveries(order_id, stock_out_id, delivery_date, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [
      orderId,
      so.header.id,
      input.deliveryDate,
      actor.adminId,
    ])
  ).rows[0];
  for (const r of resolved) {
    await tx.query('INSERT INTO delivery_lines(delivery_id, order_line_id, product_id, quantity) VALUES ($1,$2,$3,$4)', [d.id, r.line.id, r.line.product_id, r.quantity]);
    await tx.query('UPDATE order_lines SET delivered_quantity = delivered_quantity + $2 WHERE id = $1', [r.line.id, r.quantity]);
  }
  await postMovements(tx, actor, so.movements);
  await tx.query('UPDATE orders SET row_version=row_version+1, updated_at=now(), updated_by=$2 WHERE id=$1', [orderId, actor.adminId]);
  const status = await refreshStatus(tx, actor, orderId);
  const order = await getOrder(tx, orderId);
  const delivery = order.deliveries.find((x) => x.id === d.id)!;
  await audit(tx, actor, {
    action: 'Order.Delivery',
    entityType: 'Delivery',
    entityId: d.id,
    newData: { orderId, orderNumber: o.number, stockOutNumber: number, lines: delivery.lines, orderStatus: status },
  });
  return { delivery, order };
}
