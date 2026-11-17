import { z } from 'zod';
import { pool } from '../db/pool';
import { notFound } from '../http/errors';
import { route } from '../http/router';
import { listQuery, zBoolParam, zBusinessDate, zQty, zReason, zText, zUuid } from '../http/validation';
import { todayNairobi } from '../utils/dates';
import * as adj from '../services/adjustments';
import * as dmg from '../services/damaged';
import * as ret from '../services/returns';
import * as sin from '../services/stockIns';
import * as sout from '../services/stockOuts';

const zLine = z.object({ productId: zUuid, quantity: zQty });
const zLines = z.array(zLine).min(1, 'At least one product line is required.').max(200);
const zDate = zBusinessDate.default(() => todayNairobi());
const listWithSuperseded = listQuery({ includeSuperseded: zBoolParam });
const correctionNote = 'Atomically reverses the original ledger effects and posts the restated ones. The original version is kept and marked Superseded; the new version keeps the same number with version+1. Transaction type cannot change.';

// ------------------------------------------------------------------ Stock In
route({
  method: 'get', path: '/stock-ins', tag: 'Stock In', summary: 'List Stock In transactions',
  description: 'type=NewStock|WarehouseTransferIn, period/date/from/to, productId, search, includeSuperseded=true.',
  query: listWithSuperseded,
  handler: async ({ query }) => { const r = await sin.listStockIns(pool, query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'post', path: '/stock-ins', tag: 'Stock In', summary: 'Post a Stock In (New Stock or Warehouse Transfer In)', idempotent: true,
  body: z.object({
    stockInType: z.enum(sin.STOCK_IN_TYPES),
    sourceWarehouse: zText(150).nullish(),
    businessDate: zDate,
    lines: zLines,
  }),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => {
    const d = await sin.createStockIn(tx, actor, body);
    return { data: d, location: `/api/v1/stock-ins/${d.id}` };
  }),
});
route({
  method: 'get', path: '/stock-ins/:id', tag: 'Stock In', summary: 'Stock In detail (lines, versions, receiptId)',
  handler: async ({ params }) => ({ data: await sin.getStockIn(pool, params.id) }),
});
route({
  method: 'post', path: '/stock-ins/:id/corrections', tag: 'Stock In', summary: 'Correct a posted Stock In', description: correctionNote, idempotent: true,
  body: z.object({
    stockInType: z.enum(sin.STOCK_IN_TYPES).optional(),
    sourceWarehouse: zText(150).nullish(),
    businessDate: zBusinessDate.optional(),
    lines: zLines,
    reason: zReason,
  }),
  handler: ({ body, actor, params, mutate }) => mutate(async (tx) => {
    const d = await sin.correctStockIn(tx, actor, params.id, body);
    return { data: d, location: `/api/v1/stock-ins/${d.id}` };
  }),
});

// ------------------------------------------------------------------ Stock Out
route({
  method: 'get', path: '/stock-outs', tag: 'Stock Out', summary: 'List all Stock Out transactions (deliveries, samples, gifts, transfers)',
  description: 'type=CustomerDelivery|Sample|Gift|WarehouseTransfer, period, productId, customerId, search, includeSuperseded.',
  query: listWithSuperseded,
  handler: async ({ query }) => { const r = await sout.listStockOuts(pool, query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'post', path: '/stock-outs', tag: 'Stock Out', summary: 'Post a direct Stock Out (Sample, Gift or Warehouse Transfer)', idempotent: true,
  description: 'Customer deliveries are posted only via POST /orders/{id}/deliveries. Sample/Gift require recipientName; WarehouseTransfer requires destinationWarehouse and also receives a TRF- number.',
  body: z.object({
    outType: z.enum(sout.DIRECT_OUT_TYPES),
    recipientName: zText(150).nullish(),
    destinationWarehouse: zText(150).nullish(),
    businessDate: zDate,
    lines: zLines,
  }),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => {
    const d = await sout.createStockOut(tx, actor, body);
    return { data: d, location: `/api/v1/stock-outs/${d.id}` };
  }),
});
route({
  method: 'get', path: '/stock-outs/:id', tag: 'Stock Out', summary: 'Stock Out detail',
  handler: async ({ params }) => ({ data: await sout.getStockOut(pool, params.id) }),
});
route({
  method: 'post', path: '/stock-outs/:id/corrections', tag: 'Stock Out', summary: 'Correct a posted direct Stock Out', idempotent: true,
  description: `${correctionNote} CustomerDelivery records cannot be corrected (use a return or adjustment).`,
  body: z.object({
    outType: z.enum(sout.OUT_TYPES).optional(),
    recipientName: zText(150).nullish(),
    destinationWarehouse: zText(150).nullish(),
    businessDate: zBusinessDate.optional(),
    lines: zLines,
    reason: zReason,
  }),
  handler: ({ body, actor, params, mutate }) => mutate(async (tx) => {
    const d = await sout.correctStockOut(tx, actor, params.id, body);
    return { data: d, location: `/api/v1/stock-outs/${d.id}` };
  }),
});

// ------------------------------------------------------------------ Transfers (Warehouse Transfer Out records)
route({
  method: 'get', path: '/transfers', tag: 'Transfers', summary: 'List Warehouse Transfer Out records (SOUT- + TRF-)',
  query: listWithSuperseded,
  handler: async ({ query }) => { const r = await sout.listStockOuts(pool, query, 'WarehouseTransfer'); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'get', path: '/transfers/:id', tag: 'Transfers', summary: 'Warehouse Transfer detail (id = Stock Out id)',
  handler: async ({ params }) => {
    const d = await sout.getStockOut(pool, params.id);
    if (d.outType !== 'WarehouseTransfer') throw notFound('Transfer');
    return { data: d };
  },
});

// ------------------------------------------------------------------ Returns
const zReturnLine = z.object({ productId: zUuid, quantity: zQty, condition: z.enum(['Good', 'Damaged']) });
route({
  method: 'get', path: '/returns', tag: 'Returns', summary: 'List returns',
  description: 'type=AgainstOrder|Direct, condition=Good|Damaged, customerId, orderId, productId, period, search, includeSuperseded.',
  query: listQuery({ includeSuperseded: zBoolParam, condition: z.enum(['Good', 'Damaged']).optional(), orderId: zUuid.optional() }),
  handler: async ({ query }) => { const r = await ret.listReturns(pool, query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'post', path: '/returns', tag: 'Returns', summary: 'Record a customer return (against order or direct)', idempotent: true,
  description: 'Good lines increase Available stock; Damaged lines increase Damaged stock only. Against-order returns are limited to delivered − previously returned per product.',
  body: z.object({
    returnMode: z.enum(ret.RETURN_MODES),
    orderId: zUuid.nullish(),
    customerId: zUuid.nullish(),
    reason: zReason,
    businessDate: zDate,
    lines: z.array(zReturnLine).min(1, 'At least one product line is required.').max(200),
  }),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => {
    const d = await ret.createReturn(tx, actor, body);
    return { data: d, location: `/api/v1/returns/${d.id}` };
  }),
});
route({
  method: 'get', path: '/returns/:id', tag: 'Returns', summary: 'Return detail',
  handler: async ({ params }) => ({ data: await ret.getReturn(pool, params.id) }),
});
route({
  method: 'post', path: '/returns/:id/corrections', tag: 'Returns', summary: 'Correct a posted return', description: correctionNote, idempotent: true,
  body: z.object({
    returnMode: z.enum(ret.RETURN_MODES).optional(),
    customerId: zUuid.nullish(),
    returnReason: zReason.optional(),
    businessDate: zBusinessDate.optional(),
    lines: z.array(zReturnLine).min(1).max(200),
    reason: zReason,
  }),
  handler: ({ body, actor, params, mutate }) => mutate(async (tx) => {
    const d = await ret.correctReturn(tx, actor, params.id, body);
    return { data: d, location: `/api/v1/returns/${d.id}` };
  }),
});

// ------------------------------------------------------------------ Adjustments
route({
  method: 'get', path: '/adjustments', tag: 'Adjustments', summary: 'List stock adjustments',
  description: 'type=Increase|Decrease, productId, period, search, includeSuperseded.',
  query: listWithSuperseded,
  handler: async ({ query }) => { const r = await adj.listAdjustments(pool, query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'post', path: '/adjustments', tag: 'Adjustments', summary: 'Post a stock adjustment (one product, Available stock only)', idempotent: true,
  body: z.object({ direction: z.enum(adj.DIRECTIONS), productId: zUuid, quantity: zQty, reason: zReason, businessDate: zDate }),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => {
    const d = await adj.createAdjustment(tx, actor, body);
    return { data: d, location: `/api/v1/adjustments/${d.id}` };
  }),
});
route({
  method: 'get', path: '/adjustments/:id', tag: 'Adjustments', summary: 'Adjustment detail',
  handler: async ({ params }) => ({ data: await adj.getAdjustment(pool, params.id) }),
});
route({
  method: 'post', path: '/adjustments/:id/corrections', tag: 'Adjustments', summary: 'Correct a posted adjustment', description: correctionNote, idempotent: true,
  body: z.object({
    direction: z.enum(adj.DIRECTIONS).optional(),
    productId: zUuid.optional(),
    quantity: zQty,
    adjustmentReason: zReason.optional(),
    businessDate: zBusinessDate.optional(),
    reason: zReason,
  }),
  handler: ({ body, actor, params, mutate }) => mutate(async (tx) => {
    const d = await adj.correctAdjustment(tx, actor, params.id, body);
    return { data: d, location: `/api/v1/adjustments/${d.id}` };
  }),
});

// ------------------------------------------------------------------ Damaged stock
route({
  method: 'get', path: '/damaged-stock/actions', tag: 'Damaged Stock', summary: 'List damaged-stock actions',
  description: 'type=MarkAsGood|RemoveFromDamaged, productId, period, search. meta.balances lists current damaged balances.',
  query: listQuery(),
  handler: async ({ query }) => {
    const r = await dmg.listDamagedActions(pool, query);
    return { data: r.items, meta: { ...r.meta, balances: await dmg.damagedBalances(pool) } };
  },
});
route({
  method: 'post', path: '/damaged-stock/actions', tag: 'Damaged Stock', summary: 'Mark damaged stock as Good, or Remove it from Damaged stock', idempotent: true,
  body: z.object({ actionType: z.enum(dmg.DAMAGED_ACTIONS), productId: zUuid, quantity: zQty, reason: zReason, businessDate: zDate }),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => {
    const d = await dmg.createDamagedAction(tx, actor, body);
    return { data: d, location: `/api/v1/damaged-stock/actions/${d.id}` };
  }),
});
route({
  method: 'get', path: '/damaged-stock/actions/:id', tag: 'Damaged Stock', summary: 'Damaged-stock action detail',
  handler: async ({ params }) => ({ data: await dmg.getDamagedAction(pool, params.id) }),
});
