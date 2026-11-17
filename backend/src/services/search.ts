import type { Db } from '../db/pool';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { ensureEnum, escapeLike, Sql } from '../utils/sql';

export const SEARCH_TYPES = ['Product', 'Customer', 'Order', 'Receipt', 'StockIn', 'StockOut', 'Return', 'Adjustment', 'Transfer'] as const;

const DETAIL: Record<string, string> = {
  Product: '/api/v1/products/',
  Customer: '/api/v1/customers/',
  Order: '/api/v1/orders/',
  Receipt: '/api/v1/receipts/',
  StockIn: '/api/v1/stock-ins/',
  StockOut: '/api/v1/stock-outs/',
  Return: '/api/v1/returns/',
  Adjustment: '/api/v1/adjustments/',
  Transfer: '/api/v1/transfers/',
};

/**
 * Global search across product names, customer names and every document number.
 * Returns typed results carrying what the Frontend needs to call the detail endpoint.
 * Date filters apply to dated documents (products/customers use their creation date in Nairobi).
 */
export async function globalSearch(db: Db, q: ListQuery) {
  const w = new Sql();
  const term = q.search ? w.p(`%${escapeLike(q.search)}%`) : null;
  const m = (col: string) => (term ? `${col} ILIKE ${term}` : 'true');
  const nairobi = (col: string) => `(${col} AT TIME ZONE 'Africa/Nairobi')::date`;

  const union = `
    SELECT 'Product' AS type, p.id::text AS id, p.name AS title, p.status AS subtitle, ${nairobi('p.created_at')} AS date, p.created_at AS ts
      FROM products p WHERE ${m('p.name')}
    UNION ALL
    SELECT 'Customer', c.id::text, c.full_name, c.phone, ${nairobi('c.created_at')}, c.created_at
      FROM customers c WHERE ${m('c.full_name')}
    UNION ALL
    SELECT 'Order', o.id::text, o.number, o.customer_name_snapshot || ' · ' || o.status, o.order_date, o.created_at
      FROM orders o WHERE ${m('o.number')} OR ${m('o.customer_name_snapshot')}
    UNION ALL
    SELECT 'Receipt', r.id::text, r.receipt_number, r.receipt_type || ' · ' || r.source_number || CASE WHEN r.status='Superseded' THEN ' (superseded)' ELSE '' END,
           r.business_date, r.created_at
      FROM receipts r WHERE ${m('r.receipt_number')}
    UNION ALL
    SELECT 'StockIn', s.id::text, s.number, s.stock_in_type, s.business_date, s.created_at
      FROM stock_ins s WHERE s.status = 'Posted' AND (${m('s.number')})
    UNION ALL
    SELECT 'StockOut', s.id::text, s.number, s.out_type, s.business_date, s.created_at
      FROM stock_outs s WHERE s.status = 'Posted' AND (${m('s.number')})
    UNION ALL
    SELECT 'Transfer', s.id::text, s.transfer_number, s.number || ' → ' || s.destination_warehouse, s.business_date, s.created_at
      FROM stock_outs s WHERE s.status = 'Posted' AND s.out_type = 'WarehouseTransfer' AND (${m('s.transfer_number')})
    UNION ALL
    SELECT 'Return', r.id::text, r.number, r.customer_name_snapshot, r.business_date, r.created_at
      FROM returns r WHERE r.status = 'Posted' AND (${m('r.number')})
    UNION ALL
    SELECT 'Adjustment', a.id::text, a.number, a.direction || ' · ' || a.product_name_snapshot, a.business_date, a.created_at
      FROM adjustments a WHERE a.status = 'Posted' AND (${m('a.number')})`;

  const outer = new Sql();
  outer.params = w.params;
  const type = ensureEnum('type', q.type, SEARCH_TYPES);
  if (type) outer.and(`x.type = ${outer.p(type)}`);
  outer.period('x.date', q);
  const total = (await db.query(`SELECT count(*)::int n FROM (${union}) x ${outer.where()}`, outer.params)).rows[0].n;
  const rows = (await db.query(`SELECT * FROM (${union}) x ${outer.where()} ORDER BY x.ts DESC ${outer.limit(q.page, q.pageSize)}`, outer.params)).rows;
  return {
    items: rows.map((r) => ({
      resourceType: r.type,
      id: r.id,
      display: r.title,
      subtitle: r.subtitle,
      date: r.date,
      detailPath: DETAIL[r.type] + r.id,
    })),
    meta: pageMeta(q.page, q.pageSize, total),
  };
}
