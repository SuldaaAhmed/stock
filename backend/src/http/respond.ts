export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function pageMeta(page: number, pageSize: number, totalItems: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrevious: page > 1 };
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

/** Canonical JSON (sorted keys) used for idempotency request hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(',')}}`;
}
