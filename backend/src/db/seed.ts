import { config } from '../config';
import { pool } from './pool';
import { logger } from '../logger';
import { hashPassword } from '../services/passwordHasher';

/** Idempotent bootstrap: the single Admin (from env) and the company settings row. */
export async function seed() {
  await pool.query(`INSERT INTO company_settings(id, company_name) VALUES (1, 'My Company') ON CONFLICT (id) DO NOTHING`);
  const existing = await pool.query('SELECT count(*)::int AS n FROM admins');
  if (existing.rows[0].n === 0) {
    if (!config.adminPassword || config.adminPassword.length < 8) {
      throw new Error('No Admin exists. Set ADMIN_USERNAME and ADMIN_PASSWORD (min 8 chars) for the first start.');
    }
    const r = await pool.query(
      `INSERT INTO admins(username, normalized_username, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [config.adminUsername, config.adminUsername.toUpperCase(), hashPassword(config.adminPassword)],
    );
    await pool.query('INSERT INTO admin_preferences(admin_id) VALUES ($1) ON CONFLICT DO NOTHING', [r.rows[0].id]);
    await pool.query(`INSERT INTO audit_logs(actor, action, entity_type, entity_id, description) VALUES ('system','Admin.Bootstrap','Admin',$1,'Initial Admin account created')`, [
      r.rows[0].id,
    ]);
    logger.info({ username: config.adminUsername }, 'Initial Admin account created');
  }
}
