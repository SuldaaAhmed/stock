import { z } from 'zod';
import { isValidDate, todayNairobi } from '../utils/dates';

/** Positive whole number (BOX). Zero and negatives are rejected. */
export const zQty = z
  .number({ error: 'Quantity must be a number.' })
  .int('Quantity must be a whole number.')
  .positive('Quantity must be greater than zero.')
  .max(1_000_000_000, 'Quantity is too large.');

export const zNonNegInt = z
  .number({ error: 'Must be a number.' })
  .int('Must be a whole number.')
  .min(0, 'Must not be negative.')
  .max(1_000_000_000, 'Value is too large.');

export const zMoney = z
  .number({ error: 'Must be a number.' })
  .min(0, 'Must not be negative.')
  .max(999_999_999_999, 'Value is too large.')
  .refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(6)), 'At most two decimal places are allowed.');

export const zText = (max = 200) => z.string().trim().min(1, 'This field is required.').max(max, `At most ${max} characters.`);
export const zOptText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

export const zReason = z.string().trim().min(1, 'A reason is required.').max(1000, 'At most 1000 characters.');

export const zUuid = z.uuid('Must be a valid id.');

/** Business date (YYYY-MM-DD, Nairobi calendar). Future dates are rejected (decision 12). */
export const zBusinessDate = z
  .string()
  .refine(isValidDate, 'Must be a valid date in YYYY-MM-DD format.')
  .refine((d) => d <= todayNairobi(), 'Future dates are not allowed.');

export const zDateParam = z.string().refine(isValidDate, 'Must be a valid date in YYYY-MM-DD format.');

const zInt = (min: number, max: number, def: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : Number(v)), z.number().int().min(min).max(max));

/** Standard list query parameters (Section 6). */
export const zListBase = z.object({
  page: zInt(1, 1_000_000, 1),
  pageSize: zInt(1, 100, 10),
  sort: z.string().max(50).optional(),
  period: z.enum(['day', 'week', 'month', 'custom']).optional(),
  date: zDateParam.optional(),
  from: zDateParam.optional(),
  to: zDateParam.optional(),
  productId: zUuid.optional(),
  customerId: zUuid.optional(),
  type: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
  search: z.string().trim().max(200).optional(),
});

function periodCheck(q: { period?: string; from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (q.period === 'custom') {
    if (!q.from) ctx.addIssue({ code: 'custom', path: ['from'], message: 'from is required for a custom period.' });
    if (!q.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to is required for a custom period.' });
  }
  if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be on or after from.' });
}

/** Build a list-query schema, optionally with endpoint-specific extra parameters. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function listQuery<T extends z.ZodRawShape = {}>(extra?: T) {
  return zListBase.extend(extra ?? ({} as T)).superRefine(periodCheck);
}
export const zListQuery = listQuery();
export type ListQuery = z.infer<typeof zListBase>;

export const zBoolParam = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
  z.boolean().optional(),
);

export const zEmailOpt = z
  .union([z.email('Must be a valid email address.').max(200), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' || v === null ? null : v));
