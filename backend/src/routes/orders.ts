import { z } from 'zod';
import { pool } from '../db/pool';
import { route } from '../http/router';
import { listQuery, zBusinessDate, zEmailOpt, zOptText, zQty, zText, zUuid } from '../http/validation';
import { etag, parseIfMatch } from '../services/common';
import * as cust from '../services/customers';
import * as ord from '../services/orders';
import { todayNairobi } from '../utils/dates';

// ------------------------------------------------------------------ Customers
route({
  method: 'get', path: '/customers', tag: 'Customers', summary: 'List customers', description: 'search (name, phone, email, location), sort.',
  query: listQuery(),
  handler: async ({ query }) => { const r = await cust.listCustomers(pool, query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'post', path: '/customers', tag: 'Customers', summary: 'Create customer (Full Name required)', idempotent: true,
  body: z.object({ fullName: zText(150), phone: zOptText(40), email: zEmailOpt, location: zOptText(200), notes: zOptText(2000) }),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => {
    const c = await cust.createCustomer(tx, actor, body);
    return { data: c, location: `/api/v1/customers/${c.id}`, headers: { ETag: etag(c.rowVersion) } };
  }),
});
route({
  method: 'get', path: '/customers/:id', tag: 'Customers', summary: 'Customer detail',
  handler: async ({ params }) => { const c = cust.mapCustomer(await cust.getCustomer(pool, params.id)); return { data: c, headers: { ETag: etag(c.rowVersion) } }; },
});
route({
  method: 'patch', path: '/customers/:id', tag: 'Customers', summary: 'Edit customer (If-Match required). Customers cannot be deleted.', ifMatch: true,
  body: z.object({
    fullName: zText(150).optional(), phone: zOptText(40), email: zEmailOpt, location: zOptText(200), notes: zOptText(2000),
    reason: zOptText(1000), rowVersion: z.number().int().optional(),
  }).strict(),
  handler: ({ body, actor, params, req, mutate }) => mutate(async (tx) => {
    const c = await cust.updateCustomer(tx, actor, params.id, parseIfMatch(req.header('If-Match'), body.rowVersion), body);
    return { data: c, headers: { ETag: etag(c.rowVersion) } };
  }),
});
route({
  method: 'get', path: '/customers/:id/history', tag: 'Customers', summary: 'Customer edit history',
  query: listQuery(),
  handler: async ({ params, query }) => { const r = await cust.customerHistory(pool, params.id, query); return { data: r.items, meta: r.meta }; },
});

// ------------------------------------------------------------------ Orders
route({
  method: 'get', path: '/orders', tag: 'Orders', summary: 'List orders',
  description: 'status=Pending|PartiallyCompleted|Completed, customerId, productId, period (order date), search (order number, customer).',
  query: listQuery(),
  handler: async ({ query }) => { const r = await ord.listOrders(pool, query); return { data: r.items, meta: r.meta }; },
});
route({
  method: 'post', path: '/orders', tag: 'Orders', summary: 'Create a customer order (no stock check or reservation)', idempotent: true,
  body: z.object({
    customerId: zUuid,
    orderDate: zBusinessDate.default(() => todayNairobi()),
    lines: z.array(z.object({ productId: zUuid, orderedQuantity: zQty })).min(1, 'At least one product line is required.').max(200),
  }),
  handler: ({ body, actor, mutate }) => mutate(async (tx) => {
    const o = await ord.createOrder(tx, actor, body);
    return { data: o, location: `/api/v1/orders/${o.id}`, headers: { ETag: etag(o.rowVersion) } };
  }),
});
route({
  method: 'get', path: '/orders/:id', tag: 'Orders', summary: 'Order detail (lines with ordered/delivered/returned/remaining/returnable, deliveries, edit history)',
  handler: async ({ params }) => {
    const o = await ord.getOrder(pool, params.id);
    return { data: { ...o, editHistory: await ord.orderEditHistory(pool, params.id) }, headers: { ETag: etag(o.rowVersion) } };
  },
});
route({
  method: 'patch', path: '/orders/:id', tag: 'Orders', summary: 'Edit an order (If-Match required)', ifMatch: true,
  description:
    'Pending (no deliveries): customer, orderDate and lines editable. PartiallyCompleted: delivered quantities locked; ordered quantity >= delivered; new lines allowed; delivered lines cannot be removed. Completed: not editable. `lines` is the full desired set (match existing lines by id or productId).',
  body: z.object({
    customerId: zUuid.optional(),
    orderDate: zBusinessDate.optional(),
    lines: z.array(z.object({ id: zUuid.optional(), productId: zUuid, orderedQuantity: zQty })).max(200).optional(),
    reason: zOptText(1000),
    rowVersion: z.number().int().optional(),
  }).strict(),
  handler: ({ body, actor, params, req, mutate }) => mutate(async (tx) => {
    const o = await ord.updateOrder(tx, actor, params.id, parseIfMatch(req.header('If-Match'), body.rowVersion), body);
    return { data: o, headers: { ETag: etag(o.rowVersion) } };
  }),
});
route({
  method: 'get', path: '/orders/:id/deliveries', tag: 'Orders', summary: 'List deliveries of an order',
  handler: async ({ params }) => { await ord.getOrder(pool, params.id); return { data: await ord.listDeliveries(pool, params.id) }; },
});
route({
  method: 'post', path: '/orders/:id/deliveries', tag: 'Orders', summary: 'Post a partial or full delivery (creates a CustomerDelivery Stock Out)', idempotent: true,
  description: 'Each line references an orderLineId (or productId). Rejects over-delivery (422) and insufficient stock (422). When the order first becomes Completed the order receipt is created (order.receiptId).',
  body: z.object({
    deliveryDate: zBusinessDate.default(() => todayNairobi()),
    lines: z
      .array(z.object({ orderLineId: zUuid.optional(), productId: zUuid.optional(), quantity: zQty }).refine((l) => l.orderLineId || l.productId, 'orderLineId or productId is required.'))
      .min(1, 'At least one line is required.')
      .max(200),
  }),
  handler: ({ body, actor, params, mutate }) => mutate(async (tx) => {
    const r = await ord.postDelivery(tx, actor, params.id, body);
    return { data: r, location: `/api/v1/stock-outs/${r.delivery.stockOutId}` };
  }),
});

