import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../config';
import { logger } from '../logger';

// --- Type parsing -------------------------------------------------------
// int8 (bigint) -> number (identity columns / counts stay well below 2^53)
types.setTypeParser(20, (v) => Number(v));
// numeric -> number (money, 2 decimals)
types.setTypeParser(1700, (v) => Number(v));
// date -> keep 'YYYY-MM-DD' business-date string (no timezone shifting)
types.setTypeParser(1082, (v) => v);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});
pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(db, text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a READ COMMITTED transaction. Commits only when fn resolves;
 * any thrown error rolls back the whole unit of work.
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'Rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}
