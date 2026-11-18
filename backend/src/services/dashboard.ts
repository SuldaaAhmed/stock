import type { Db } from '../db/pool';
import { todayNairobi } from '../utils/dates';

export async function dashboardSummary(db: Db) {
  const today = todayNairobi();
  const stock = (
    await db.query(
      `SELECT count(*)::int AS total_products,
              count(*) FILTER (WHERE p.status='Active')::int AS active_products,
              count(*) FILTER (WHERE p.status='Active' AND b.available <= p.minimum_stock)::int AS low_stock_products,
              COALESCE(SUM(b.available),0)::int AS total_available, COALESCE(SUM(b.damaged),0)::int AS total_damaged
         FROM products p JOIN product_balances b ON b.product_id = p.id`,
    )
  ).rows[0];
  const sin = (
    await db.query(
      `SELECT count(DISTINCT s.id)::int AS n, COALESCE(SUM(l.quantity),0)::int AS q
         FROM stock_ins s JOIN stock_in_lines l ON l.stock_in_id = s.id WHERE s.status='Posted' AND s.business_date = $1`,
      [today],
    )
  ).rows[0];
  const sout = (
    await db.query(
      `SELECT count(DISTINCT s.id)::int AS n, COALESCE(SUM(l.quantity),0)::int AS q
         FROM stock_outs s JOIN stock_out_lines l ON l.stock_out_id = s.id WHERE s.status='Posted' AND s.business_date = $1`,
      [today],
    )
  ).rows[0];
  const ret = (
    await db.query(
      `SELECT count(DISTINCT r.id)::int AS n, COALESCE(SUM(l.quantity),0)::int AS q,
              COALESCE(SUM(l.quantity) FILTER (WHERE l.condition='Good'),0)::int AS good,
              COALESCE(SUM(l.quantity) FILTER (WHERE l.condition='Damaged'),0)::int AS damaged
         FROM returns r JOIN return_lines l ON l.return_id = r.id WHERE r.status='Posted' AND r.business_date = $1`,
      [today],
    )
  ).rows[0];
  // Low-stock alert list (§4.2 Frontend): active products at or below their minimum; clears automatically once restocked.
  const lowStockItems = (
    await db.query(
      `SELECT p.id, p.name, b.available, p.minimum_stock FROM products p JOIN product_balances b ON b.product_id = p.id
        WHERE p.status='Active' AND b.available <= p.minimum_stock
        ORDER BY (p.minimum_stock - b.available) DESC, p.name LIMIT 20`,
    )
  ).rows.map((r) => ({ productId: r.id, productName: r.name, currentStock: r.available, minimumStock: r.minimum_stock }));
  const orders = (
    await db.query(
      `SELECT count(*) FILTER (WHERE status='Pending')::int AS pending, count(*) FILTER (WHERE status='PartiallyCompleted')::int AS partial FROM orders`,
    )
  ).rows[0];
  const recentTransactions = (
    await db.query(
      `SELECT * FROM (
         SELECT 'StockIn' AS type, id, number, stock_in_type AS subtype, business_date, created_at FROM stock_ins WHERE status='Posted'
         UNION ALL SELECT 'StockOut', id, number, out_type, business_date, created_at FROM stock_outs WHERE status='Posted'
         UNION ALL SELECT 'Return', id, number, return_mode, business_date, created_at FROM returns WHERE status='Posted'
         UNION ALL SELECT 'Adjustment', id, number, direction, business_date, created_at FROM adjustments WHERE status='Posted'
         UNION ALL SELECT 'Order', id, number, status, order_date, created_at FROM orders
       ) x ORDER BY created_at DESC LIMIT 10`,
    )
  ).rows.map((r) => ({ type: r.type, id: r.id, number: r.number, subtype: r.subtype, businessDate: r.business_date, createdAt: r.created_at }));
  const recentAudit = (
    await db.query(
      `SELECT id, occurred_at, actor, action, entity_type, entity_id, description FROM audit_logs
        WHERE NOT is_deleted ORDER BY occurred_at DESC, id DESC LIMIT 10`,
    )
  ).rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    actor: r.actor,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    description: r.description,
  }));
  return {
    date: today,
    totalProducts: stock.total_products,
    activeProducts: stock.active_products,
    lowStockProducts: stock.low_stock_products,
    totalAvailableStock: stock.total_available,
    totalDamagedStock: stock.total_damaged,
    unit: 'BOX',
    today: {
      stockInQuantity: sin.q,
      stockInTransactions: sin.n,
      stockOutQuantity: sout.q,
      stockOutTransactions: sout.n,
      returnsQuantity: ret.q,
      returnsTransactions: ret.n,
      returnsGoodQuantity: ret.good,
      returnsDamagedQuantity: ret.damaged,
    },
    lowStockItems,
    orders: { pending: orders.pending, partiallyCompleted: orders.partial },
    recentTransactions,
    recentActivity: recentAudit,
  };
}
