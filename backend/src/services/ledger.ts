import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { businessRule, FieldError } from '../http/errors';

export type MovementType =
  | 'OpeningStock'
  | 'OpeningStockCorrection'
  | 'StockInNew'
  | 'StockInTransfer'
  | 'GoodReturn'
  | 'DamagedReturn'
  | 'AdjustmentIn'
  | 'AdjustmentOut'
  | 'StockOutDelivery'
  | 'StockOutSample'
  | 'StockOutGift'
  | 'StockOutTransfer'
  | 'MarkAsGood'
  | 'RemoveFromDamaged';

export interface SourceRef {
  type: string; // Product | StockIn | StockOut | Return | Adjustment | DamagedStockAction
  id: string;
  number: string | null;
  version: number;
  businessDate: string;
}

export interface Movement {
  productId: string;
  type: MovementType;
  availableDelta: number;
  damagedDelta: number;
  isReversal?: boolean;
  source: SourceRef;
}

export interface BalanceChange {
  availableBefore: number;
  availableAfter: number;
  damagedBefore: number;
  damagedAfter: number;
}

export type Balances = Map<string, { available: number; damaged: number }>;

/**
 * Lock product balance rows (SELECT ... FOR UPDATE) in ascending product id order so that
 * concurrent postings serialise per product without deadlocks.
 */
export async function lockBalances(tx: Db, productIds: string[]): Promise<Balances> {
  const ids = [...new Set(productIds)].sort();
  const res = await tx.query(
    `SELECT product_id, available, damaged FROM product_balances
      WHERE product_id = ANY($1::uuid[]) ORDER BY product_id FOR UPDATE`,
    [ids],
  );
  const map: Balances = new Map();
  for (const r of res.rows) map.set(r.product_id, { available: r.available, damaged: r.damaged });
  return map;
}

/**
 * Append movements to the ledger and update cached balances atomically.
 * Verifies that every affected product keeps Available >= 0 and Damaged >= 0 after the
 * net effect of all movements (reversal + restatement of a correction are checked together).
 */
export async function postMovements(tx: Db, actor: Actor, movements: Movement[]): Promise<Map<string, BalanceChange>> {
  const productIds = movements.map((m) => m.productId);
  const balances = await lockBalances(tx, productIds);

  const net = new Map<string, { a: number; d: number }>();
  for (const m of movements) {
    const n = net.get(m.productId) ?? { a: 0, d: 0 };
    n.a += m.availableDelta;
    n.d += m.damagedDelta;
    net.set(m.productId, n);
  }

  const changes = new Map<string, BalanceChange>();
  const shortAvailable: { productId: string; have: number; need: number }[] = [];
  const shortDamaged: { productId: string; have: number; need: number }[] = [];
  for (const [productId, n] of net) {
    const b = balances.get(productId);
    if (!b) throw businessRule('PRODUCT_NOT_FOUND', 'Product balance not found.', [{ field: 'productId', message: `Unknown product ${productId}` }]);
    const change = {
      availableBefore: b.available,
      availableAfter: b.available + n.a,
      damagedBefore: b.damaged,
      damagedAfter: b.damaged + n.d,
    };
    if (change.availableAfter < 0) shortAvailable.push({ productId, have: b.available, need: -n.a });
    if (change.damagedAfter < 0) shortDamaged.push({ productId, have: b.damaged, need: -n.d });
    changes.set(productId, change);
  }

  if (shortAvailable.length || shortDamaged.length) {
    const ids = [...shortAvailable, ...shortDamaged].map((s) => s.productId);
    const names = new Map(
      (await tx.query('SELECT id, name FROM products WHERE id = ANY($1::uuid[])', [ids])).rows.map((r) => [r.id, r.name]),
    );
    const errors: FieldError[] = [
      ...shortAvailable.map((s) => ({
        field: `products.${s.productId}`,
        message: `Insufficient available stock for "${names.get(s.productId)}": available ${s.have} BOX, requested ${s.need} BOX.`,
      })),
      ...shortDamaged.map((s) => ({
        field: `products.${s.productId}`,
        message: `Insufficient damaged stock for "${names.get(s.productId)}": damaged ${s.have} BOX, requested ${s.need} BOX.`,
      })),
    ];
    throw businessRule(
      shortAvailable.length ? 'INSUFFICIENT_STOCK' : 'INSUFFICIENT_DAMAGED_STOCK',
      shortAvailable.length ? 'Not enough available stock.' : 'Not enough damaged stock.',
      errors,
    );
  }

  const rows = movements.filter((m) => m.availableDelta !== 0 || m.damagedDelta !== 0);
  if (rows.length) {
    await tx.query(
      `INSERT INTO stock_movements(product_id, movement_type, available_delta, damaged_delta, is_reversal,
                                   source_type, source_id, source_number, source_version, business_date, admin_id)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::int[], $4::int[], $5::bool[], $6::text[], $7::uuid[],
                            $8::text[], $9::int[], $10::date[], $11::uuid[])`,
      [
        rows.map((m) => m.productId),
        rows.map((m) => m.type),
        rows.map((m) => m.availableDelta),
        rows.map((m) => m.damagedDelta),
        rows.map((m) => !!m.isReversal),
        rows.map((m) => m.source.type),
        rows.map((m) => m.source.id),
        rows.map((m) => m.source.number),
        rows.map((m) => m.source.version),
        rows.map((m) => m.source.businessDate),
        rows.map(() => actor.adminId),
      ],
    );
  }
  for (const [productId, c] of changes) {
    if (c.availableAfter === c.availableBefore && c.damagedAfter === c.damagedBefore) continue;
    await tx.query('UPDATE product_balances SET available=$2, damaged=$3, updated_at=now() WHERE product_id=$1', [
      productId,
      c.availableAfter,
      c.damagedAfter,
    ]);
  }
  return changes;
}

/** Build reversal movements (negated deltas) for every ledger entry of a source version. */
export async function reversalsFor(tx: Db, sourceType: string, sourceId: string): Promise<Movement[]> {
  const res = await tx.query(
    `SELECT product_id, movement_type, available_delta, damaged_delta, source_number, source_version, business_date
       FROM stock_movements WHERE source_type=$1 AND source_id=$2 AND NOT is_reversal ORDER BY id`,
    [sourceType, sourceId],
  );
  return res.rows.map((r) => ({
    productId: r.product_id,
    type: r.movement_type,
    availableDelta: -r.available_delta,
    damagedDelta: -r.damaged_delta,
    isReversal: true,
    source: { type: sourceType, id: sourceId, number: r.source_number, version: r.source_version, businessDate: r.business_date },
  }));
}
