import type { Db } from '../db/pool';
import { badRequest, businessRule, FieldError, notFound } from '../http/errors';

export interface ProductRef {
  id: string;
  name: string;
  status: 'Active' | 'Inactive';
}

/**
 * Load referenced products. Unknown ids -> 400 field errors. When `requireActive` is set,
 * inactive products -> 422 PRODUCT_INACTIVE (new Stock In, direct Stock Out, new orders).
 */
export async function loadProducts(
  db: Db,
  lines: { productId: string }[],
  opts: { requireActive: boolean; field?: string },
): Promise<Map<string, ProductRef>> {
  const field = opts.field ?? 'lines';
  const ids = [...new Set(lines.map((l) => l.productId))];
  const res = await db.query('SELECT id, name, status FROM products WHERE id = ANY($1::uuid[])', [ids]);
  const map = new Map<string, ProductRef>(res.rows.map((r) => [r.id, r]));
  const missing: FieldError[] = [];
  const inactive: FieldError[] = [];
  lines.forEach((l, i) => {
    const p = map.get(l.productId);
    if (!p) missing.push({ field: `${field}[${i}].productId`, message: 'Product not found.' });
    else if (opts.requireActive && p.status !== 'Active')
      inactive.push({ field: `${field}[${i}].productId`, message: `Product "${p.name}" is inactive and cannot be used here.` });
  });
  if (missing.length) throw badRequest('One or more validation errors occurred.', missing);
  if (inactive.length) throw businessRule('PRODUCT_INACTIVE', 'Inactive products cannot be used in this operation.', inactive);
  return map;
}

export function assertUniqueProducts(lines: { productId: string }[], field = 'lines', extraKey?: (l: any) => string) {
  const seen = new Set<string>();
  const errors: FieldError[] = [];
  lines.forEach((l, i) => {
    const k = l.productId + (extraKey ? `|${extraKey(l)}` : '');
    if (seen.has(k)) errors.push({ field: `${field}[${i}].productId`, message: 'Each product may appear only once.' });
    seen.add(k);
  });
  if (errors.length) throw badRequest('One or more validation errors occurred.', errors);
}

export async function loadCustomer(db: Db, id: string, field = 'customerId') {
  const r = await db.query('SELECT id, full_name FROM customers WHERE id = $1', [id]);
  if (!r.rowCount) throw badRequest('One or more validation errors occurred.', [{ field, message: 'Customer not found.' }]);
  return r.rows[0] as { id: string; full_name: string };
}

export async function mustFind<T>(db: Db, sql: string, params: unknown[], what: string): Promise<T> {
  const r = await db.query(sql, params);
  if (!r.rowCount) throw notFound(what);
  return r.rows[0] as T;
}

/** Parses an ETag / If-Match header (e.g. "3" or W/"3") into a row version number. */
export function parseIfMatch(header: string | undefined, bodyVersion?: number): number {
  if (header) {
    const m = header.match(/^(?:W\/)?"?(\d+)"?$/);
    if (m) return Number(m[1]);
  }
  if (bodyVersion !== undefined) return bodyVersion;
  throw badRequest('An If-Match header with the current ETag (row version) is required.', [
    { field: 'If-Match', message: 'Send the ETag returned by the GET endpoint.' },
  ]);
}

export const etag = (rowVersion: number) => `"${rowVersion}"`;

/**
 * Products for a correction: products already on the original version may be inactive
 * (history stays correctable); newly introduced products must be active.
 */
export async function loadCorrectionProducts(db: Db, lines: { productId: string }[], originalProductIds: Set<string>) {
  const products = await loadProducts(db, lines, { requireActive: false });
  const inactive: FieldError[] = [];
  lines.forEach((l, i) => {
    const p = products.get(l.productId)!;
    if (!originalProductIds.has(l.productId) && p.status !== 'Active') {
      inactive.push({ field: `lines[${i}].productId`, message: `Product "${p.name}" is inactive and cannot be added.` });
    }
  });
  if (inactive.length) throw businessRule('PRODUCT_INACTIVE', 'Inactive products cannot be added in a correction.', inactive);
  return products;
}
