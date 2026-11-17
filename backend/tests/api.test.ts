import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, startTestEnvironment, stopTestEnvironment } from './helpers';

let app: any;
let pool: any;
let c: Client;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const ids: Record<string, string> = {};

async function balance(productId: string) {
  const r = await c.get(`/api/v1/products/${productId}`);
  assert.equal(r.status, 200);
  return { available: r.body.data.availableStock as number, damaged: r.body.data.damagedStock as number };
}

async function createProduct(name: string, openingStock: number, minimumStock = 5) {
  const r = await c.post('/api/v1/products', { name, minimumStock, openingStock, sellingPrice: 100 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.id as string;
}

async function assertLedgerMatchesBalances() {
  const r = await pool.query(`
    SELECT count(*)::int AS n FROM product_balances b
      LEFT JOIN (SELECT product_id, SUM(available_delta) a, SUM(damaged_delta) d FROM stock_movements GROUP BY product_id) m ON m.product_id = b.product_id
     WHERE b.available <> COALESCE(m.a,0) OR b.damaged <> COALESCE(m.d,0)`);
  assert.equal(r.rows[0].n, 0, 'ledger sums must equal cached balances');
}

before(async () => {
  ({ app, pool } = await startTestEnvironment());
  c = new Client(app);
  await c.init();
});
after(async () => {
  await stopTestEnvironment();
});

describe('Authentication & security', () => {
  test('rejects unauthenticated business requests', async () => {
    const r = await c.get('/api/v1/products');
    assert.equal(r.status, 401);
    assert.equal(r.body.type, 'UNAUTHORIZED');
    assert.ok(r.body.requestId);
  });

  test('rejects state-changing requests without CSRF token', async () => {
    const r = await c.agent.post('/api/v1/auth/login').send({ username: 'admin', password: 'Secret#2026' });
    assert.equal(r.status, 403);
    assert.equal(r.body.type, 'CSRF_FAILED');
  });

  test('wrong password is rejected, audited, and throttled progressively', async () => {
    const other = new Client(app);
    await other.init();
    for (let i = 0; i < 3; i++) {
      const r = await other.login('throttle-user', 'wrong-password');
      assert.equal(r.status, 401);
    }
    const r = await other.login('throttle-user', 'wrong-password');
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) >= 1);
    const audit = await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'Auth.LoginFailed'`);
    assert.ok(audit.rows[0].n >= 3);
    const leaked = await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE description ILIKE '%wrong-password%'`);
    assert.equal(leaked.rows[0].n, 0, 'attempted password must never be logged');
  });

  test('login sets HttpOnly cookie and /auth/me works', async () => {
    const r = await c.login();
    assert.equal(r.status, 200);
    const cookie = String(r.headers['set-cookie']);
    assert.match(cookie, /stock\.sid=.*HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const me = await c.get('/api/v1/auth/me');
    assert.equal(me.body.data.admin.username, 'admin');
  });

  test('password hash is ASP.NET Core Identity V3 format', async () => {
    const r = await pool.query('SELECT password_hash FROM admins LIMIT 1');
    const buf = Buffer.from(r.rows[0].password_hash, 'base64');
    assert.equal(buf[0], 0x01);
    assert.equal(buf.readUInt32BE(1), 2); // HMACSHA512
  });

  test('posting operations require an Idempotency-Key', async () => {
    const r = await c.post('/api/v1/customers', { fullName: 'X' }, { idem: false });
    assert.equal(r.status, 400);
    assert.equal(r.body.type, 'IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('Products', () => {
  test('create with opening stock, unique name (case-insensitive, trimmed)', async () => {
    ids.p1 = await createProduct('Mango Juice 1L', 100, 10);
    ids.p2 = await createProduct('Orange Juice 500ml', 20, 5);
    const dup = await c.post('/api/v1/products', { name: '  mango JUICE 1l ', minimumStock: 1 });
    assert.equal(dup.status, 409);
    assert.deepEqual(await balance(ids.p1), { available: 100, damaged: 0 });
  });

  test('validates whole numbers, non-negative values, 2-decimal price', async () => {
    const r = await c.post('/api/v1/products', { name: 'Bad', minimumStock: -1, openingStock: 1.5, sellingPrice: 1.234 });
    assert.equal(r.status, 400);
    const fields = r.body.errors.map((e: any) => e.field).sort();
    assert.deepEqual(fields, ['minimumStock', 'openingStock', 'sellingPrice']);
  });

  test('PATCH requires If-Match and reason; stale version -> 409; history kept', async () => {
    const noMatch = await c.patch(`/api/v1/products/${ids.p2}`, { minimumStock: 8, reason: 'restock policy' });
    assert.equal(noMatch.status, 400);
    const noReason = await c.patch(`/api/v1/products/${ids.p2}`, { minimumStock: 8 }, '"1"');
    assert.equal(noReason.status, 400);
    const ok = await c.patch(`/api/v1/products/${ids.p2}`, { minimumStock: 8, sellingPrice: 150.25, reason: 'restock policy' }, '"1"');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.headers.etag, '"2"');
    const stale = await c.patch(`/api/v1/products/${ids.p2}`, { minimumStock: 9, reason: 'x' }, '"1"');
    assert.equal(stale.status, 409);
    const hist = await c.get(`/api/v1/products/${ids.p2}/history?section=edits`);
    assert.equal(hist.body.data.length, 1);
    assert.deepEqual(hist.body.data[0].newValues, { minimumStock: 8, sellingPrice: 150.25 });
    const prices = await c.get(`/api/v1/products/${ids.p2}/history?section=prices`);
    assert.equal(prices.body.data[0].newPrice, 150.25);
    // Frontend aliases return the same sections
    const editsAlias = await c.get(`/api/v1/products/${ids.p2}/edit-history`);
    assert.deepEqual(editsAlias.body.data, hist.body.data);
    const priceAlias = await c.get(`/api/v1/products/${ids.p2}/price-history`);
    assert.deepEqual(priceAlias.body.data, prices.body.data);
    const mv = await c.get(`/api/v1/products/${ids.p2}/movements`);
    assert.equal(mv.status, 200);
    assert.ok(mv.body.data.length >= 1 && 'availableAfter' in mv.body.data[0]);
  });

  test('opening stock correction is a ledger entry and cannot make stock negative', async () => {
    const r = await c.post(`/api/v1/products/${ids.p2}/opening-stock-corrections`, { newOpeningStock: 25, reason: 'miscount' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.delta, 5);
    const d = await c.get(`/api/v1/products/${ids.p2}`);
    assert.equal(d.body.data.effectiveOpeningStock, 25);
    assert.equal(d.body.data.openingStock, 20);
    assert.equal(d.body.data.availableStock, 25);
  });
});

describe('Stock In', () => {
  test('multi-line New Stock with SIN number, receipt record and PDF', async () => {
    const r = await c.post('/api/v1/stock-ins', {
      stockInType: 'NewStock',
      businessDate: today,
      lines: [
        { productId: ids.p1, quantity: 50 },
        { productId: ids.p2, quantity: 5 },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.number, 'SIN-0001');
    assert.ok(r.body.data.receiptId);
    ids.sin1 = r.body.data.id;
    assert.equal((await balance(ids.p1)).available, 150);
    const pdf = await c.get(`/api/v1/receipts/${r.body.data.receiptId}/pdf?disposition=attachment`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal((pdf.body as Buffer).subarray(0, 4).toString(), '%PDF');
    const rec = await c.get(`/api/v1/receipts/${r.body.data.receiptId}`);
    assert.equal(rec.body.data.receiptNumber, 'REC-0001');
    assert.equal(rec.body.data.company.companyName, 'My Company');
  });

  test('Warehouse Transfer In requires source warehouse; zero quantity rejected; future date rejected', async () => {
    const a = await c.post('/api/v1/stock-ins', { stockInType: 'WarehouseTransferIn', lines: [{ productId: ids.p1, quantity: 1 }] });
    assert.equal(a.status, 400);
    const b = await c.post('/api/v1/stock-ins', { stockInType: 'NewStock', lines: [{ productId: ids.p1, quantity: 0 }] });
    assert.equal(b.status, 400);
    const f = await c.post('/api/v1/stock-ins', { stockInType: 'NewStock', businessDate: '2999-01-01', lines: [{ productId: ids.p1, quantity: 1 }] });
    assert.equal(f.status, 400);
    const ok = await c.post('/api/v1/stock-ins', { stockInType: 'WarehouseTransferIn', sourceWarehouse: 'Mombasa WH', lines: [{ productId: ids.p2, quantity: 10 }] });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.number, 'SIN-0002');
  });

  test('inactive products are rejected for new Stock In (422)', async () => {
    ids.inactive = await createProduct('Discontinued Soda', 10);
    const p = await c.patch(`/api/v1/products/${ids.inactive}`, { status: 'Inactive', reason: 'discontinued' }, '"1"');
    assert.equal(p.status, 200);
    const r = await c.post('/api/v1/stock-ins', { stockInType: 'NewStock', lines: [{ productId: ids.inactive, quantity: 1 }] });
    assert.equal(r.status, 422);
    assert.equal(r.body.type, 'PRODUCT_INACTIVE');
  });
});

describe('Stock Out (direct)', () => {
  test('Sample requires recipient; insufficient stock rejected without consuming a number', async () => {
    const a = await c.post('/api/v1/stock-outs', { outType: 'Sample', lines: [{ productId: ids.p1, quantity: 1 }] });
    assert.equal(a.status, 400);
    const big = await c.post('/api/v1/stock-outs', { outType: 'Gift', recipientName: 'Jane Doe', lines: [{ productId: ids.p1, quantity: 100000 }] });
    assert.equal(big.status, 422);
    assert.equal(big.body.type, 'INSUFFICIENT_STOCK');
    const ok = await c.post('/api/v1/stock-outs', { outType: 'Gift', recipientName: 'Jane Doe', lines: [{ productId: ids.p1, quantity: 2 }] });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.number, 'SOUT-0001', 'rolled-back operations never consume numbers');
    assert.ok(ok.body.data.receiptId);
  });

  test('Warehouse Transfer gets SOUT and TRF numbers; CustomerDelivery not allowed directly', async () => {
    const t = await c.post('/api/v1/stock-outs', { outType: 'WarehouseTransfer', destinationWarehouse: 'Kisumu WH', lines: [{ productId: ids.p1, quantity: 8 }] });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal(t.body.data.number, 'SOUT-0002');
    assert.equal(t.body.data.transferNumber, 'TRF-0001');
    ids.trf = t.body.data.id;
    const list = await c.get('/api/v1/transfers');
    assert.equal(list.body.data.length, 1);
    const d = await c.post('/api/v1/stock-outs', { outType: 'CustomerDelivery', lines: [{ productId: ids.p1, quantity: 1 }] });
    assert.equal(d.status, 400);
    assert.equal((await balance(ids.p1)).available, 140);
  });
});

describe('Customers, orders and deliveries', () => {
  test('customers: full name only required, duplicates allowed, edit with history', async () => {
    const a = await c.post('/api/v1/customers', { fullName: 'Acme Traders' });
    const b = await c.post('/api/v1/customers', { fullName: 'Acme Traders', phone: '+254700000000', email: '' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    ids.cust = a.body.data.id;
    ids.cust2 = b.body.data.id;
    const e = await c.patch(`/api/v1/customers/${ids.cust}`, { location: 'Nairobi' }, '"1"');
    assert.equal(e.status, 200);
    const h = await c.get(`/api/v1/customers/${ids.cust}/history`);
    assert.equal(h.body.data.length, 1);
  });

  test('order lifecycle: Pending -> PartiallyCompleted -> Completed with receipt only at completion', async () => {
    const o = await c.post('/api/v1/orders', { customerId: ids.cust, lines: [{ productId: ids.p1, orderedQuantity: 30 }, { productId: ids.p2, orderedQuantity: 5 }] });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    assert.equal(o.body.data.number, 'ORD-0001');
    assert.equal(o.body.data.status, 'Pending');
    ids.order = o.body.data.id;
    const l1 = o.body.data.lines.find((l: any) => l.productId === ids.p1).id;

    const over = await c.post(`/api/v1/orders/${ids.order}/deliveries`, { lines: [{ orderLineId: l1, quantity: 31 }] });
    assert.equal(over.status, 422);
    assert.equal(over.body.type, 'OVER_DELIVERY');

    const d1 = await c.post(`/api/v1/orders/${ids.order}/deliveries`, { lines: [{ orderLineId: l1, quantity: 10 }] });
    assert.equal(d1.status, 201, JSON.stringify(d1.body));
    assert.equal(d1.body.data.order.status, 'PartiallyCompleted');
    assert.equal(d1.body.data.order.receiptId, null);
    assert.match(d1.body.data.delivery.stockOutNumber, /^SOUT-/);

    // Edit while PartiallyCompleted: cannot go below delivered; cannot remove delivered line; customer locked
    let etag = (await c.get(`/api/v1/orders/${ids.order}`)).headers.etag;
    const below = await c.patch(`/api/v1/orders/${ids.order}`, { lines: [{ id: l1, productId: ids.p1, orderedQuantity: 5 }, { productId: ids.p2, orderedQuantity: 5 }] }, etag);
    assert.equal(below.status, 422);
    const remove = await c.patch(`/api/v1/orders/${ids.order}`, { lines: [{ productId: ids.p2, orderedQuantity: 5 }] }, etag);
    assert.equal(remove.status, 422);
    const cust = await c.patch(`/api/v1/orders/${ids.order}`, { customerId: ids.cust2 }, etag);
    assert.equal(cust.status, 422);
    const edit = await c.patch(`/api/v1/orders/${ids.order}`, { lines: [{ id: l1, productId: ids.p1, orderedQuantity: 20 }, { productId: ids.p2, orderedQuantity: 5 }], reason: 'customer reduced' }, etag);
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.lines.find((l: any) => l.id === l1).orderedQuantity, 20);

    const d2 = await c.post(`/api/v1/orders/${ids.order}/deliveries`, { lines: [{ productId: ids.p1, quantity: 10 }, { productId: ids.p2, quantity: 5 }] });
    assert.equal(d2.status, 201, JSON.stringify(d2.body));
    assert.equal(d2.body.data.order.status, 'Completed');
    assert.ok(d2.body.data.order.receiptId, 'receipt created when order first becomes Completed');

    etag = (await c.get(`/api/v1/orders/${ids.order}`)).headers.etag;
    const locked = await c.patch(`/api/v1/orders/${ids.order}`, { reason: 'x', lines: [{ productId: ids.p1, orderedQuantity: 21 }] }, etag);
    assert.equal(locked.status, 422);

    // deliveries appear in the Stock Out list, and cannot be corrected
    const outs = await c.get('/api/v1/stock-outs?type=CustomerDelivery');
    assert.equal(outs.body.data.length, 2);
    const corr = await c.post(`/api/v1/stock-outs/${d1.body.data.delivery.stockOutId}/corrections`, { lines: [{ productId: ids.p1, quantity: 1 }], reason: 'x' });
    assert.equal(corr.status, 422);
    assert.equal(corr.body.type, 'DELIVERY_CORRECTION_NOT_ALLOWED');
    assert.equal((await balance(ids.p1)).available, 120);
  });
});

describe('Returns, adjustments and damaged stock', () => {
  test('returns against order: validated against delivered minus previous returns; Good vs Damaged', async () => {
    const over = await c.post('/api/v1/returns', { returnMode: 'AgainstOrder', orderId: ids.order, reason: 'leaking', lines: [{ productId: ids.p1, quantity: 21, condition: 'Good' }] });
    assert.equal(over.status, 422);
    assert.equal(over.body.type, 'OVER_RETURN');
    const r = await c.post('/api/v1/returns', {
      returnMode: 'AgainstOrder',
      orderId: ids.order,
      reason: 'customer returned',
      lines: [
        { productId: ids.p1, quantity: 5, condition: 'Good' },
        { productId: ids.p1, quantity: 10, condition: 'Damaged' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.number, 'RET-0001');
    ids.ret = r.body.data.id;
    assert.deepEqual(await balance(ids.p1), { available: 125, damaged: 10 });
    const again = await c.post('/api/v1/returns', { returnMode: 'AgainstOrder', orderId: ids.order, reason: 'x', lines: [{ productId: ids.p1, quantity: 6, condition: 'Good' }] });
    assert.equal(again.status, 422, 'only 5 left returnable');
    const order = await c.get(`/api/v1/orders/${ids.order}`);
    assert.equal(order.body.data.status, 'Completed', 'returns never change order status');
    const line = order.body.data.lines.find((l: any) => l.productId === ids.p1);
    assert.equal(line.returnedQuantity, 15);
    assert.equal(line.returnableQuantity, 5);
  });

  test('direct return requires a registered customer; inactive products allowed', async () => {
    const a = await c.post('/api/v1/returns', { returnMode: 'Direct', reason: 'x', lines: [{ productId: ids.p2, quantity: 1, condition: 'Good' }] });
    assert.equal(a.status, 400);
    const b = await c.post('/api/v1/returns', { returnMode: 'Direct', customerId: ids.cust2, reason: 'wrong item', lines: [{ productId: ids.inactive, quantity: 2, condition: 'Good' }] });
    assert.equal(b.status, 201, JSON.stringify(b.body));
  });

  test('adjustments: before/after recorded; decrease cannot go negative', async () => {
    const neg = await c.post('/api/v1/adjustments', { direction: 'Decrease', productId: ids.p2, quantity: 100000, reason: 'count' });
    assert.equal(neg.status, 422);
    const before = await balance(ids.p2);
    const ok = await c.post('/api/v1/adjustments', { direction: 'Decrease', productId: ids.p2, quantity: 3, reason: 'breakage in store' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.number, 'ADJ-0001');
    assert.equal(ok.body.data.availableBefore, before.available);
    assert.equal(ok.body.data.availableAfter, before.available - 3);
    ids.adj = ok.body.data.id;
  });

  test('damaged actions: Mark as Good / Remove change balances exactly; cannot exceed damaged', async () => {
    const tooMany = await c.post('/api/v1/damaged-stock/actions', { actionType: 'MarkAsGood', productId: ids.p1, quantity: 11, reason: 'x' });
    assert.equal(tooMany.status, 422);
    assert.equal(tooMany.body.type, 'INSUFFICIENT_DAMAGED_STOCK');
    const m = await c.post('/api/v1/damaged-stock/actions', { actionType: 'MarkAsGood', productId: ids.p1, quantity: 3, reason: 'repaired' });
    assert.equal(m.status, 201);
    assert.deepEqual(await balance(ids.p1), { available: 128, damaged: 7 });
    const rm = await c.post('/api/v1/damaged-stock/actions', { actionType: 'RemoveFromDamaged', productId: ids.p1, quantity: 2, reason: 'disposed' });
    assert.equal(rm.status, 201);
    assert.match(rm.body.data.receiptNumber, /^REC-/);
    assert.deepEqual(await balance(ids.p1), { available: 128, damaged: 5 });
    assert.equal(rm.body.data.damagedBefore, 7);
    assert.equal(rm.body.data.damagedAfter, 5);
  });

  test('Section 5 formula holds (Available & Damaged) for the product summary', async () => {
    const d = (await c.get(`/api/v1/products/${ids.p1}`)).body.data;
    const s = d.summary;
    const available = s.effectiveOpeningStock + s.stockIn + s.goodReturns + s.adjustmentIn + s.markedAsGood - s.stockOut - s.adjustmentOut;
    const damaged = s.damagedReturns - s.markedAsGood - s.removedFromDamaged;
    assert.equal(available, d.availableStock);
    assert.equal(damaged, d.damagedStock);
    assert.ok(d.damagedHistory.some((h: any) => h.eventType === 'MarkAsGood'));
    await assertLedgerMatchesBalances();
  });
});

describe('Corrections (append-only ledger, superseded versions)', () => {
  test('Stock In correction restates lines, keeps number, increments version, supersedes receipt', async () => {
    const orig = (await c.get(`/api/v1/stock-ins/${ids.sin1}`)).body.data;
    const before = await balance(ids.p1);
    const r = await c.post(`/api/v1/stock-ins/${ids.sin1}/corrections`, { lines: [{ productId: ids.p1, quantity: 40 }, { productId: ids.p2, quantity: 5 }], reason: 'typo: 40 not 50' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.number, orig.number);
    assert.equal(r.body.data.version, 2);
    assert.equal(r.body.data.supersedesId, ids.sin1);
    assert.equal((await balance(ids.p1)).available, before.available - 10);
    const old = (await c.get(`/api/v1/stock-ins/${ids.sin1}`)).body.data;
    assert.equal(old.status, 'Superseded');
    const oldRec = (await c.get(`/api/v1/receipts/${orig.receiptId}`)).body.data;
    assert.equal(oldRec.status, 'Superseded');
    const again = await c.post(`/api/v1/stock-ins/${ids.sin1}/corrections`, { lines: [{ productId: ids.p1, quantity: 1 }], reason: 'x' });
    assert.equal(again.status, 409);
    const typeChange = await c.post(`/api/v1/stock-ins/${r.body.data.id}/corrections`, { stockInType: 'WarehouseTransferIn', lines: [{ productId: ids.p1, quantity: 40 }], reason: 'x' });
    assert.equal(typeChange.status, 400);
    const reversal = await pool.query(`SELECT count(*)::int n FROM stock_movements WHERE source_id = $1 AND is_reversal`, [ids.sin1]);
    assert.equal(reversal.rows[0].n, 2);
  });

  test('correction that would make stock negative is rejected', async () => {
    // Stock In of p2 is small; remove it entirely after stock has been consumed
    const p = await createProduct('Correction Probe', 0);
    const si = await c.post('/api/v1/stock-ins', { stockInType: 'NewStock', lines: [{ productId: p, quantity: 10 }] });
    await c.post('/api/v1/stock-outs', { outType: 'Sample', recipientName: 'Tester', lines: [{ productId: p, quantity: 8 }] });
    const r = await c.post(`/api/v1/stock-ins/${si.body.data.id}/corrections`, { lines: [{ productId: p, quantity: 5 }], reason: 'x' });
    assert.equal(r.status, 422);
    assert.equal((await balance(p)).available, 2);
  });

  test('ledger is append-only at database level', async () => {
    await assert.rejects(pool.query('UPDATE stock_movements SET available_delta = 0'), /append-only/);
    await assert.rejects(pool.query('DELETE FROM stock_movements'), /append-only/);
  });

  test('return and adjustment corrections', async () => {
    const r = await c.post(`/api/v1/returns/${ids.ret}/corrections`, { lines: [{ productId: ids.p1, quantity: 5, condition: 'Good' }, { productId: ids.p1, quantity: 5, condition: 'Damaged' }], reason: 'miscounted damaged' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.version, 2);
    assert.equal((await balance(ids.p1)).damaged, 0);
    const a = await c.post(`/api/v1/adjustments/${ids.adj}/corrections`, { quantity: 1, reason: 'only one broken' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.data.version, 2);
    await assertLedgerMatchesBalances();
  });
});

describe('Concurrency and idempotency', () => {
  test('concurrent stock-outs of the same stock never oversell', async () => {
    const p = await createProduct('Race Product', 10);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => c.post('/api/v1/stock-outs', { outType: 'Sample', recipientName: 'Racer', lines: [{ productId: p, quantity: 3 }] })),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    assert.equal(ok, 3);
    assert.equal(rejected, 3);
    assert.equal((await balance(p)).available, 1);
  });

  test('two concurrent deliveries of the same stock never produce negative Available', async () => {
    const p = await createProduct('Delivery Race', 5);
    const o1 = await c.post('/api/v1/orders', { customerId: ids.cust, lines: [{ productId: p, orderedQuantity: 5 }] });
    const o2 = await c.post('/api/v1/orders', { customerId: ids.cust2, lines: [{ productId: p, orderedQuantity: 5 }] });
    const [a, b] = await Promise.all([
      c.post(`/api/v1/orders/${o1.body.data.id}/deliveries`, { lines: [{ productId: p, quantity: 4 }] }),
      c.post(`/api/v1/orders/${o2.body.data.id}/deliveries`, { lines: [{ productId: p, quantity: 4 }] }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 422]);
    assert.equal((await balance(p)).available, 1);
  });

  test('same Idempotency-Key never posts twice (sequential and concurrent)', async () => {
    const p = await createProduct('Idem Product', 50);
    const body = { outType: 'Gift', recipientName: 'Idem', lines: [{ productId: p, quantity: 1 }] };
    const all = await Promise.all(Array.from({ length: 5 }, () => c.post('/api/v1/stock-outs', body, { key: 'same-key-12345' })));
    const created = all.filter((r) => r.status === 201);
    assert.ok(created.length >= 1);
    assert.ok(all.every((r) => r.status === 201 || r.status === 409));
    const replay = await c.post('/api/v1/stock-outs', body, { key: 'same-key-12345' });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers['idempotent-replayed'], 'true');
    assert.equal(replay.body.data.id, created[0].body.data.id);
    assert.equal((await balance(p)).available, 49, 'posted exactly once');
  });
});

describe('Reports, search, dashboard', () => {
  const types = ['current-stock', 'stock-in', 'stock-out', 'customer-orders', 'returns', 'adjustments', 'sample-gift', 'warehouse-transfer', 'low-stock', 'damaged-stock'];
  test('all ten reports return data with summary and pagination', async () => {
    for (const t of types) {
      const r = await c.get(`/api/v1/reports/${t}?period=month`);
      assert.equal(r.status, 200, `${t}: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body.data));
      assert.equal(r.body.meta.pageSize, 10);
      assert.ok(r.body.meta.summary);
      assert.ok('totalQuantity' in r.body.meta.summary, t);
    }
    const so = await c.get('/api/v1/reports/stock-out?type=CustomerDelivery');
    assert.ok(so.body.data.every((row: any) => row.outType === 'CustomerDelivery'));
    const wt = await c.get('/api/v1/reports/warehouse-transfer');
    assert.deepEqual([...new Set(wt.body.data.map((r: any) => r.direction))].sort(), ['In', 'Out']);
    const bad = await c.get('/api/v1/reports/nope');
    assert.equal(bad.status, 400);
  });

  test('report totals are consistent with the ledger', async () => {
    const r = await c.get(`/api/v1/reports/current-stock?pageSize=100`);
    const ledger = await pool.query('SELECT COALESCE(SUM(available_delta),0)::int a FROM stock_movements');
    assert.equal(r.body.meta.summary.totalAvailable, ledger.rows[0].a);
  });

  test('report PDF export covers the whole filtered result', async () => {
    const r = await c.get('/api/v1/reports/stock-out/export/pdf?period=week').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(r.status, 200);
    assert.equal((r.body as Buffer).subarray(0, 4).toString(), '%PDF');
  });

  test('global search finds numbers and names', async () => {
    const a = await c.get('/api/v1/search?search=TRF-0001');
    assert.equal(a.body.data[0].resourceType, 'Transfer');
    assert.equal(a.body.data[0].detailPath, `/api/v1/transfers/${ids.trf}`);
    const b = await c.get('/api/v1/search?search=acme&type=Customer');
    assert.equal(b.body.data.length, 2);
    const none = await c.get('/api/v1/search');
    assert.equal(none.status, 400);
  });

  test('dashboard summary', async () => {
    const r = await c.get('/api/v1/dashboard/summary');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.activeProducts >= 2);
    assert.ok(r.body.data.today.stockInTransactions >= 1);
    assert.ok(Array.isArray(r.body.data.recentActivity));
  });
});

describe('Settings and audit', () => {
  test('company settings, logo upload (PNG only), receipts keep their snapshot', async () => {
    const etag = (await c.get('/api/v1/settings/company')).headers.etag;
    const u = await c.patch('/api/v1/settings/company', { companyName: 'Prime Distributors Ltd', phone: '+254 700 111 222' }, etag);
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const svg = await c.put('/api/v1/settings/company/logo').attach('file', Buffer.from('<svg></svg>'), 'logo.svg');
    assert.equal(svg.status, 400);
    const up = await c.put('/api/v1/settings/company/logo').attach('file', PNG, 'logo.png');
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.data.hasLogo, true);
    const s = await c.post('/api/v1/stock-ins', { stockInType: 'NewStock', lines: [{ productId: ids.p2, quantity: 1 }] });
    const rec = (await c.get(`/api/v1/receipts/${s.body.data.receiptId}`)).body.data;
    assert.equal(rec.company.companyName, 'Prime Distributors Ltd');
    assert.equal(rec.hasLogo, true);
    const oldRec = (await c.get(`/api/v1/stock-ins/${ids.sin1}`)).body.data;
    const oldSnap = (await c.get(`/api/v1/receipts/${oldRec.receiptId}`)).body.data;
    assert.equal(oldSnap.company.companyName, 'My Company', 'historical receipts preserve their snapshot');
    const del = await c.delete('/api/v1/settings/company/logo');
    assert.equal(del.status, 200);
    const stillThere = await pool.query('SELECT count(*)::int n FROM stored_files');
    assert.equal(stillThere.rows[0].n, 1, 'logo referenced by a receipt is never deleted');
    const pref = await c.patch('/api/v1/settings/preferences', { theme: 'Dark' });
    assert.equal(pref.body.data.theme, 'Dark');
  });

  test('audit log edit/delete create an immutable correction trail', async () => {
    const list = await c.get('/api/v1/audit-logs?action=Product.Create');
    const id = list.body.data[0].id;
    const noReason = await c.patch(`/api/v1/audit-logs/${id}`, { description: 'edited' });
    assert.equal(noReason.status, 400);
    const e = await c.patch(`/api/v1/audit-logs/${id}`, { description: 'edited', reason: 'clarify' });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    const d = await c.delete(`/api/v1/audit-logs/${id}`, { reason: 'duplicate entry' });
    assert.equal(d.status, 204);
    const hidden = await c.get('/api/v1/audit-logs?action=Product.Create&pageSize=100');
    assert.ok(!hidden.body.data.some((x: any) => x.id === id));
    const trail = await c.get(`/api/v1/audit-log-corrections?auditLogId=${id}`);
    assert.deepEqual(trail.body.data.map((t: any) => t.operation).sort(), ['Delete', 'Edit']);
    await assert.rejects(pool.query('DELETE FROM audit_log_corrections'), /append-only/);
    await assert.rejects(pool.query('DELETE FROM audit_logs'), /append-only/);
  });
});

describe('Backup and restore', () => {
  test('backup, change data, restore: data back, sessions invalidated, ledger reconciled, logs survive', async () => {
    const b = await c.post('/api/v1/backups', {});
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.equal(b.body.data.status, 'Succeeded');
    const backupId = b.body.data.id;
    const dl = await c.get(`/api/v1/backups/${backupId}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(dl.status, 200);
    assert.equal((dl.body as Buffer).subarray(0, 6).toString(), 'STKBK1', 'backup is encrypted at rest');

    const productsBefore = (await c.get('/api/v1/products?pageSize=100')).body.meta.totalItems;
    await createProduct('Created After Backup', 3);
    assert.equal((await c.get('/api/v1/products?pageSize=100')).body.meta.totalItems, productsBefore + 1);

    const noConfirm = await c.post(`/api/v1/backups/${backupId}/restore`, { confirm: true });
    assert.equal(noConfirm.status, 400);
    const r = await c.post(`/api/v1/backups/${backupId}/restore`, { confirm: true, confirmationText: 'RESTORE' }, { idem: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'Succeeded');
    assert.equal(r.body.data.reconciliation.mismatchCount, 0);

    const after401 = await c.get('/api/v1/products');
    assert.equal(after401.status, 401, 'all sessions invalidated after restore');
    await c.init();
    assert.equal((await c.login()).status, 200);
    assert.equal((await c.get('/api/v1/products?pageSize=100')).body.meta.totalItems, productsBefore);

    const logs = await c.get('/api/v1/backups?pageSize=50');
    const kinds = logs.body.data.map((l: any) => `${l.operation}:${l.trigger}`);
    assert.ok(kinds.includes('Restore:Restore'));
    assert.ok(kinds.includes('Backup:PreRestore'));
    assert.ok(kinds.includes('Backup:Manual'));
    const audit = await c.get('/api/v1/audit-logs?action=Backup.Restore');
    assert.equal(audit.body.data.length, 1, 'restore event recorded in restored audit log');
    await assertLedgerMatchesBalances();
    const health = await c.get('/health');
    assert.equal(health.body.status, 'healthy');
  });

  test('restored counters continue numbering without gaps or duplicates', async () => {
    const r = await c.post('/api/v1/stock-ins', { stockInType: 'NewStock', lines: [{ productId: ids.p1, quantity: 1 }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const dupes = await pool.query(`SELECT number, count(*) FROM stock_ins WHERE status='Posted' GROUP BY number HAVING count(*) > 1`);
    assert.equal(dupes.rowCount, 0);
  });
});
