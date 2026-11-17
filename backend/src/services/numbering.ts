import type { Db } from '../db/pool';

export type Prefix = 'SIN' | 'SOUT' | 'ORD' | 'RET' | 'ADJ' | 'TRF' | 'REC';

/**
 * Allocates the next document number from a per-prefix counter. Must be called inside the
 * posting transaction: the counter row stays locked until commit, and a rollback restores
 * it, so failed operations never consume a number. Padded to at least four digits.
 */
export async function nextNumber(tx: Db, prefix: Prefix): Promise<string> {
  const res = await tx.query('UPDATE document_counters SET last_value = last_value + 1 WHERE prefix = $1 RETURNING last_value', [prefix]);
  if (!res.rowCount) throw new Error(`Unknown document prefix ${prefix}`);
  return `${prefix}-${String(res.rows[0].last_value).padStart(4, '0')}`;
}
