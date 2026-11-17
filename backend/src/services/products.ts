import type { Db } from '../db/pool';
import type { Actor } from '../http/context';
import { AppError, badRequest, conflict, notFound } from '../http/errors';
import { pageMeta } from '../http/respond';
import type { ListQuery } from '../http/validation';
import { todayNairobi } from '../utils/dates';
import { orderBy, Sql } from '../utils/sql';
import { audit, diff } from './audit';
import { postMovements } from './ledger';

const EFFECTIVE_OPENING = `(p.opening_stock + COALESCE((SELECT SUM(c.delta) FROM opening_stock_corrections c WHERE c.product_id = p.id), 0))::int`;

const SELECT_PRODUCT = `
  SELECT p.*, b.available, b.damaged, ${EFFECTIVE_OPENING} AS effective_opening_stock
    FROM products p JOIN product_balances b ON b.product_id = p.id`;

export function mapProduct(r: any) {
  return {
    id: r.id,
    name: r.name,
    minimumStock: r.minimum_stock,
    sellingPrice: r.selling_price,
    status: r.status,
    openingStock: r.opening_stock,
    effectiveOpeningStock: r.effective_opening_stock,
    currentStock: r.available,
    availableStock: r.available,
    damagedStock: r.damaged,
    isLowStock: r.status === 'Active' && r.available <= r.minimum_stock,
    unit: 'BOX',
    rowVersion: r.row_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

async function assertNameFree(db: Db, name: string, exceptId?: string) {
  const r = await db.query('SELECT id FROM products WHERE name_normalized = $1 AND ($2::uuid IS NULL OR id <> $2)', [
    normalizeName(name),
    exceptId ?? null,
  ]);
  if (r.rowCount) {
    throw new AppError(409, 'DUPLICATE_PRODUCT_NAME', 'A product with this name already exists (names are unique, including inactive products).', [
      { field: 'name', message: 'Product name already exists.' },
    ]);
  }
}

export async function listProducts(db: Db, q: ListQuery & { lowStock?: boolean }) {
  const w = new Sql();
  if (q.status) w.and(`p.status = ${w.p(q.status)}`);
  if (q.lowStock) w.and(`p.status = 'Active' AND b.available <= p.minimum_stock`);
  if (q.productId) w.and(`p.id = ${w.p(q.productId)}`);
  w.search(q.search, ['p.name']);
  const order = orderBy(
    q.sort,
    { name: 'p.name', availableStock: 'b.available', currentStock: 'b.available', damagedStock: 'b.damaged', minimumStock: 'p.minimum_stock', sellingPrice: 'p.selling_price', status: 'p.status', createdAt: 'p.created_at' },
    'p.name ASC, p.id',
  );
  const total = (await db.query(`SELECT count(*)::int AS n FROM products p JOIN product_balances b ON b.product_id = p.id ${w.where()}`, w.params)).rows[0].n;
  const rows = (await db.query(`${SELECT_PRODUCT} ${w.where()} ${order} ${w.limit(q.page, q.pageSize)}`, w.params)).rows;
  return { items: rows.map(mapProduct), meta: pageMeta(q.page, q.pageSize, total) };
}

export async function getProductRow(db: Db, id: string, lock = false) {
  const r = await db.query(`${SELECT_PRODUCT} WHERE p.id = $1 ${lock ? 'FOR UPDATE OF p' : ''}`, [id]);
  if (!r.rowCount) throw notFound('Product');
  return r.rows[0];
}

export async function getProductDetail(db: Db, id: string) {
  const p = await getProductRow(db, id);
  const totals = (
    await db.query(
      `SELECT movement_type, SUM(available_delta)::int AS a, SUM(damaged_delta)::int AS d
         FROM stock_movements WHERE product_id = $1 GROUP BY movement_type`,
      [id],
    )
  ).rows;
  const t = (type: string, key: 'a' | 'd' = 'a') => Math.abs(totals.find((r) => r.movement_type === type)?.[key] ?? 0);
  const damagedHistory = (
    await db.query(
      `SELECT * FROM (
         SELECT 'DamagedReturn' AS event_type, r.id AS source_id, r.number AS reference_number, r.business_date,
                rl.quantity, r.reason, r.created_at, NULL::uuid AS receipt_id
           FROM return_lines rl JOIN returns r ON r.id = rl.return_id
          WHERE rl.product_id = $1 AND rl.condition = 'Damaged' AND r.status = 'Posted'
         UNION ALL
         SELECT a.action_type, a.id, rc.receipt_number, a.business_date, a.quantity, a.reason, a.created_at, a.receipt_id
           FROM damaged_stock_actions a LEFT JOIN receipts rc ON rc.id = a.receipt_id
          WHERE a.product_id = $1
       ) x ORDER BY created_at DESC LIMIT 50`,
      [id],
    )
  ).rows.map((r) => ({
    eventType: r.event_type,
    sourceId: r.source_id,
    referenceNumber: r.reference_number,
    businessDate: r.business_date,
    quantity: r.quantity,
    reason: r.reason,
    receiptId: r.receipt_id,
    createdAt: r.created_at,
  }));

  return {
    ...mapProduct(p),
    summary: {
      effectiveOpeningStock: p.effective_opening_stock,
      stockIn: t('StockInNew') + t('StockInTransfer'),
      stockInNew: t('StockInNew'),
      stockInTransfer: t('StockInTransfer'),
      stockOut: t('StockOutDelivery') + t('StockOutSample') + t('StockOutGift') + t('StockOutTransfer'),
      stockOutDelivery: t('StockOutDelivery'),
      stockOutSample: t('StockOutSample'),
      stockOutGift: t('StockOutGift'),
      stockOutTransfer: t('StockOutTransfer'),
      goodReturns: t('GoodReturn'),
      damagedReturns: t('DamagedReturn', 'd'),
      adjustmentIn: t('AdjustmentIn'),
      adjustmentOut: t('AdjustmentOut'),
      markedAsGood: t('MarkAsGood'),
      removedFromDamaged: t('RemoveFromDamaged', 'd'),
      currentStock: p.available,
      damagedStock: p.damaged,
      totalPhysicalStock: p.available + p.damaged,
    },
    damagedHistory,
  };
}

export async function createProduct(
  tx: Db,
  actor: Actor,
  input: { name: string; minimumStock: number; sellingPrice?: number | null; status: 'Active' | 'Inactive'; openingStock: number },
) {
  const name = input.name.trim().replace(/\s+/g, ' ');
  await assertNameFree(tx, name);
  const p = (
    await tx.query(
      `INSERT INTO products(name, name_normalized, minimum_stock, selling_price, status, opening_stock, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [name, normalizeName(name), input.minimumStock, input.sellingPrice ?? null, input.status, input.openingStock, actor.adminId],
    )
  ).rows[0];
  await tx.query('INSERT INTO product_balances(product_id) VALUES ($1)', [p.id]);
  if (input.openingStock > 0) {
    await postMovements(tx, actor, [
      {
        productId: p.id,
        type: 'OpeningStock',
        availableDelta: input.openingStock,
        damagedDelta: 0,
        source: { type: 'Product', id: p.id, number: null, version: 1, businessDate: todayNairobi() },
      },
    ]);
  }
  if (input.sellingPrice != null) {
    await tx.query(`INSERT INTO product_price_history(product_id, old_price, new_price, reason, admin_id) VALUES ($1,NULL,$2,'Initial price',$3)`, [
      p.id,
      input.sellingPrice,
      actor.adminId,
    ]);
  }
  const created = mapProduct(await getProductRow(tx, p.id));
  await audit(tx, actor, { action: 'Product.Create', entityType: 'Product', entityId: p.id, newData: created });
  return created;
}

export async function updateProduct(
  tx: Db,
  actor: Actor,
  id: string,
  expectedVersion: number,
  input: { name?: string; minimumStock?: number; sellingPrice?: number | null; status?: 'Active' | 'Inactive'; reason: string },
) {
  const cur = await getProductRow(tx, id, true);
  if (cur.row_version !== expectedVersion) {
    throw conflict('The product was changed by another request. Reload and try again.', 'CONCURRENCY_CONFLICT');
  }
  const next = {
    name: input.name === undefined ? undefined : input.name.trim().replace(/\s+/g, ' '),
    minimumStock: input.minimumStock,
    sellingPrice: input.sellingPrice,
    status: input.status,
  };
  const before = { name: cur.name, minimumStock: cur.minimum_stock, sellingPrice: cur.selling_price, status: cur.status };
  const d = diff(before, next);
  if (!d.changed) throw badRequest('No changes were supplied.', [{ field: 'body', message: 'Nothing to update.' }]);
  if (d.new.name !== undefined) await assertNameFree(tx, d.new.name as string, id);

  await tx.query(
    `UPDATE products SET name = COALESCE($2, name), name_normalized = COALESCE($3, name_normalized),
            minimum_stock = COALESCE($4, minimum_stock),
            selling_price = CASE WHEN $5::bool THEN $6::numeric ELSE selling_price END,
            status = COALESCE($7, status), row_version = row_version + 1, updated_at = now(), updated_by = $8
      WHERE id = $1`,
    [
      id,
      next.name ?? null,
      next.name ? normalizeName(next.name) : null,
      next.minimumStock ?? null,
      'sellingPrice' in d.new,
      next.sellingPrice ?? null,
      next.status ?? null,
      actor.adminId,
    ],
  );
  await tx.query('INSERT INTO product_edit_history(product_id, old_values, new_values, reason, admin_id) VALUES ($1,$2,$3,$4,$5)', [
    id,
    JSON.stringify(d.old),
    JSON.stringify(d.new),
    input.reason,
    actor.adminId,
  ]);
  if ('sellingPrice' in d.new) {
    await tx.query('INSERT INTO product_price_history(product_id, old_price, new_price, reason, admin_id) VALUES ($1,$2,$3,$4,$5)', [
      id,
      d.old.sellingPrice,
      d.new.sellingPrice,
      input.reason,
      actor.adminId,
    ]);
  }
  await audit(tx, actor, {
    action: 'status' in d.new ? 'Product.StatusChange' : 'Product.Edit',
    entityType: 'Product',
    entityId: id,
    description: input.reason,
    oldData: d.old,
    newData: d.new,
  });
  return mapProduct(await getProductRow(tx, id));
}

export async function correctOpeningStock(tx: Db, actor: Actor, id: string, input: { newOpeningStock: number; reason: string }) {
  const cur = await getProductRow(tx, id, true);
  const delta = input.newOpeningStock - cur.effective_opening_stock;
  if (delta === 0) {
    throw badRequest('One or more validation errors occurred.', [
      { field: 'newOpeningStock', message: 'The new opening stock equals the current effective opening stock.' },
    ]);
  }
  const corr = (
    await tx.query(
      `INSERT INTO opening_stock_corrections(product_id, previous_effective, new_effective, delta, reason, admin_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, cur.effective_opening_stock, input.newOpeningStock, delta, input.reason, actor.adminId],
    )
  ).rows[0];
  const changes = await postMovements(tx, actor, [
    {
      productId: id,
      type: 'OpeningStockCorrection',
      availableDelta: delta,
      damagedDelta: 0,
      source: { type: 'OpeningStockCorrection', id: corr.id, number: null, version: 1, businessDate: todayNairobi() },
    },
  ]);
  const c = changes.get(id)!;
  const result = {
    id: corr.id,
    productId: id,
    previousEffectiveOpeningStock: corr.previous_effective,
    newEffectiveOpeningStock: corr.new_effective,
    delta,
    reason: corr.reason,
    availableBefore: c.availableBefore,
    availableAfter: c.availableAfter,
    createdAt: corr.created_at,
  };
  await audit(tx, actor, {
    action: 'Product.OpeningStockCorrection',
    entityType: 'Product',
    entityId: id,
    description: input.reason,
    oldData: { effectiveOpeningStock: corr.previous_effective },
    newData: { effectiveOpeningStock: corr.new_effective },
  });
  return result;
}

export async function productHistory(db: Db, id: string, section: string, q: ListQuery) {
  await getProductRow(db, id);
  const w = new Sql();
  const pid = w.p(id);
  if (section === 'movements') {
    const inner = `SELECT m.*, a.username,
                          SUM(m.available_delta) OVER (ORDER BY m.id) AS available_after,
                          SUM(m.damaged_delta) OVER (ORDER BY m.id) AS damaged_after
                     FROM stock_movements m LEFT JOIN admins a ON a.id = m.admin_id WHERE m.product_id = ${pid}`;
    const outer = new Sql();
    outer.params = w.params;
    if (q.type) outer.and(`x.movement_type = ${outer.p(q.type)}`);
    outer.period('x.business_date', q);
    const total = (await db.query(`SELECT count(*)::int n FROM (${inner}) x ${outer.where()}`, outer.params)).rows[0].n;
    const rows = (await db.query(`SELECT * FROM (${inner}) x ${outer.where()} ORDER BY x.id DESC ${outer.limit(q.page, q.pageSize)}`, outer.params)).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        movementType: r.movement_type,
        availableDelta: r.available_delta,
        damagedDelta: r.damaged_delta,
        availableAfter: Number(r.available_after),
        damagedAfter: Number(r.damaged_after),
        isReversal: r.is_reversal,
        sourceType: r.source_type,
        sourceId: r.source_id,
        sourceNumber: r.source_number,
        sourceVersion: r.source_version,
        businessDate: r.business_date,
        createdAt: r.created_at,
        admin: r.username,
      })),
      meta: pageMeta(q.page, q.pageSize, total),
    };
  }
  const tables: Record<string, { table: string; map: (r: any) => unknown }> = {
    edits: {
      table: 'product_edit_history',
      map: (r) => ({ id: r.id, oldValues: r.old_values, newValues: r.new_values, reason: r.reason, admin: r.username, createdAt: r.created_at }),
    },
    prices: {
      table: 'product_price_history',
      map: (r) => ({ id: r.id, oldPrice: r.old_price, newPrice: r.new_price, reason: r.reason, admin: r.username, createdAt: r.created_at }),
    },
    'opening-stock-corrections': {
      table: 'opening_stock_corrections',
      map: (r) => ({
        id: r.id,
        previousEffectiveOpeningStock: r.previous_effective,
        newEffectiveOpeningStock: r.new_effective,
        delta: r.delta,
        reason: r.reason,
        admin: r.username,
        createdAt: r.created_at,
      }),
    },
  };
  const t = tables[section];
  const total = (await db.query(`SELECT count(*)::int n FROM ${t.table} WHERE product_id = $1`, [id])).rows[0].n;
  const rows = (
    await db.query(
      `SELECT h.*, a.username FROM ${t.table} h LEFT JOIN admins a ON a.id = h.admin_id WHERE h.product_id = ${pid}
        ORDER BY h.created_at DESC ${w.limit(q.page, q.pageSize)}`,
      w.params,
    )
  ).rows;
  return { items: rows.map(t.map), meta: pageMeta(q.page, q.pageSize, total) };
}
