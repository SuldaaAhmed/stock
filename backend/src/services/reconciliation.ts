import { Db, pool } from '../db/pool';
import { logger } from '../logger';

/**
 * Compare cached balances with the sum of ledger deltas for every product.
 * Mismatches are logged and stored (surfaced by /health); they are never silently overwritten.
 */
export async function reconcile(trigger: string, db: Db = pool) {
  const rows = (
    await db.query(
      `SELECT p.id, p.name, b.available, b.damaged,
              COALESCE(m.a, 0)::int AS ledger_available, COALESCE(m.d, 0)::int AS ledger_damaged
         FROM products p
         JOIN product_balances b ON b.product_id = p.id
         LEFT JOIN (SELECT product_id, SUM(available_delta) AS a, SUM(damaged_delta) AS d FROM stock_movements GROUP BY product_id) m
           ON m.product_id = p.id`,
    )
  ).rows;
  const mismatches = rows
    .filter((r) => r.available !== r.ledger_available || r.damaged !== r.ledger_damaged)
    .map((r) => ({
      productId: r.id,
      productName: r.name,
      cachedAvailable: r.available,
      ledgerAvailable: r.ledger_available,
      cachedDamaged: r.damaged,
      ledgerDamaged: r.ledger_damaged,
    }));
  const run = (
    await db.query(
      `INSERT INTO reconciliation_runs(trigger_type, products_checked, mismatch_count, mismatches) VALUES ($1,$2,$3,$4) RETURNING id, run_at`,
      [trigger, rows.length, mismatches.length, JSON.stringify(mismatches)],
    )
  ).rows[0];
  if (mismatches.length) logger.error({ mismatches }, 'Ledger reconciliation found mismatches');
  return { id: run.id, runAt: run.run_at, productsChecked: rows.length, mismatchCount: mismatches.length, mismatches };
}

export async function lastReconciliation(db: Db = pool) {
  const r = (await db.query('SELECT * FROM reconciliation_runs ORDER BY run_at DESC LIMIT 1')).rows[0];
  return r ? { runAt: r.run_at, trigger: r.trigger_type, productsChecked: r.products_checked, mismatchCount: r.mismatch_count } : null;
}
