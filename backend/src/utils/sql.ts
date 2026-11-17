import { badRequest } from '../http/errors';
import type { ListQuery } from '../http/validation';
import { resolvePeriod } from './dates';

/** Small helper to build parameterised WHERE clauses safely. */
export class Sql {
  params: unknown[] = [];
  private conds: string[] = [];

  /** Register a parameter and return its placeholder ($n). */
  p(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  and(condition: string): this {
    this.conds.push(condition);
    return this;
  }

  where(): string {
    return this.conds.length ? `WHERE ${this.conds.join(' AND ')}` : '';
  }

  /** Apply the standard period filter (Nairobi calendar business dates) to a date column. */
  period(column: string, q: Pick<ListQuery, 'period' | 'date' | 'from' | 'to'>): { from: string; to: string } | null {
    let range: { from: string; to: string } | null = null;
    if (q.period) range = resolvePeriod(q.period, q.date, q.from, q.to);
    else if (q.from || q.to) range = { from: q.from ?? '0001-01-01', to: q.to ?? '9999-12-31' };
    if (range) {
      this.and(`${column} >= ${this.p(range.from)}::date`);
      this.and(`${column} <= ${this.p(range.to)}::date`);
    }
    return range;
  }

  /** Case-insensitive contains-search over several columns. */
  search(term: string | undefined, columns: string[]) {
    if (!term) return;
    const ph = this.p(`%${escapeLike(term)}%`);
    this.and(`(${columns.map((c) => `${c} ILIKE ${ph}`).join(' OR ')})`);
  }

  limit(page: number, pageSize: number): string {
    return `LIMIT ${this.p(pageSize)} OFFSET ${this.p((page - 1) * pageSize)}`;
  }
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** `sort=name` or `sort=-date`; only allow-listed fields map to SQL columns. */
export function orderBy(sort: string | undefined, allowed: Record<string, string>, fallback: string): string {
  if (!sort) return `ORDER BY ${fallback}`;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const col = allowed[field];
  if (!col) {
    throw badRequest('One or more validation errors occurred.', [
      { field: 'sort', message: `Unsupported sort field. Allowed: ${Object.keys(allowed).join(', ')}` },
    ]);
  }
  return `ORDER BY ${col} ${desc ? 'DESC' : 'ASC'} NULLS LAST, ${fallback}`;
}

export function ensureEnum<T extends string>(field: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw badRequest('One or more validation errors occurred.', [{ field, message: `Must be one of: ${allowed.join(', ')}` }]);
  }
  return value as T;
}
