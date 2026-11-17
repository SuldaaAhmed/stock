import { z } from 'zod';
import { pool } from '../db/pool';
import { route } from '../http/router';
import { listQuery, zBoolParam, zMoney, zNonNegInt, zReason, zText } from '../http/validation';
import { etag, parseIfMatch } from '../services/common';
import * as svc from '../services/products';

const tag = 'Products';
const zStatus = z.enum(['Active', 'Inactive']);

route({
  method: 'get',
  path: '/products',
  tag,
  summary: 'List products (inventory list)',
  description: 'Filters: status (Active|Inactive), lowStock=true, search (name), sort (name, availableStock, damagedStock, minimumStock, sellingPrice, status, createdAt).',
  query: listQuery({ lowStock: zBoolParam }),
  handler: async ({ query }) => {
    const r = await svc.listProducts(pool, query);
    return { data: r.items, meta: r.meta };
  },
});

route({
  method: 'post',
  path: '/products',
  tag,
  summary: 'Create product with opening stock',
  idempotent: true,
  body: z.object({
    name: zText(150),
    minimumStock: zNonNegInt,
    sellingPrice: zMoney.nullish(),
    status: zStatus.default('Active'),
    openingStock: zNonNegInt.default(0),
  }),
  handler: ({ body, actor, mutate }) =>
    mutate(async (tx) => {
      const p = await svc.createProduct(tx, actor, body);
      return { data: p, status: 201, location: `/api/v1/products/${p.id}`, headers: { ETag: etag(p.rowVersion) } };
    }),
});

route({
  method: 'get',
  path: '/products/:id',
  tag,
  summary: 'Product detail with stock summary and damaged-stock history',
  handler: async ({ params }) => {
    const p = await svc.getProductDetail(pool, params.id);
    return { data: p, headers: { ETag: etag(p.rowVersion) } };
  },
});

route({
  method: 'patch',
  path: '/products/:id',
  tag,
  summary: 'Edit product (name, minimum stock, selling price, status) – reason and If-Match required',
  ifMatch: true,
  body: z
    .object({
      name: zText(150).optional(),
      minimumStock: zNonNegInt.optional(),
      sellingPrice: zMoney.nullable().optional(),
      status: zStatus.optional(),
      reason: zReason,
      rowVersion: z.number().int().optional(),
    })
    .strict(),
  handler: ({ body, actor, params, req, mutate }) =>
    mutate(async (tx) => {
      const version = parseIfMatch(req.header('If-Match'), body.rowVersion);
      const p = await svc.updateProduct(tx, actor, params.id, version, body);
      return { data: p, headers: { ETag: etag(p.rowVersion) } };
    }),
});

route({
  method: 'get',
  path: '/products/:id/history',
  tag,
  summary: 'Product stock and edit history',
  description: 'section=movements (default; ledger with running balances, filters type/period) | edits | prices | opening-stock-corrections.',
  query: listQuery({ section: z.enum(['movements', 'edits', 'prices', 'opening-stock-corrections']).default('movements') }),
  handler: async ({ params, query }) => {
    const r = await svc.productHistory(pool, params.id, query.section, query);
    return { data: r.items, meta: r.meta };
  },
});

// Convenience aliases (used by the frontend) for individual history sections.
for (const [suffix, section, summary] of [
  ['movements', 'movements', 'Product stock movements (ledger with running Available/Damaged balances)'],
  ['edit-history', 'edits', 'Product edit history (old/new values, reason)'],
  ['price-history', 'prices', 'Product selling-price history'],
] as const) {
  route({
    method: 'get',
    path: `/products/:id/${suffix}`,
    tag,
    summary,
    query: listQuery(),
    handler: async ({ params, query }) => {
      const r = await svc.productHistory(pool, params.id, section, query);
      return { data: r.items, meta: r.meta };
    },
  });
}

route({
  method: 'post',
  path: '/products/:id/opening-stock-corrections',
  tag,
  summary: 'Correct opening stock (history-preserving ledger entry, reason required)',
  idempotent: true,
  body: z.object({ newOpeningStock: zNonNegInt, reason: zReason }),
  handler: ({ body, actor, params, mutate }) =>
    mutate(async (tx) => ({ data: await svc.correctOpeningStock(tx, actor, params.id, body), status: 201 })),
});

