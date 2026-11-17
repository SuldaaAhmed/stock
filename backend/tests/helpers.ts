/**
 * Test harness: uses TEST_DATABASE_URL when given (the database is wiped!), otherwise
 * starts a throw-away PostgreSQL via `embedded-postgres`. Env is set BEFORE importing
 * application modules because config is read at import time.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

let embedded: any = null;
let tmpDir = '';

export async function startTestEnvironment() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-test-'));
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = 15000 + Math.floor(Math.random() * 2000);
    embedded = new EmbeddedPostgres({
      databaseDir: path.join(tmpDir, 'pg'),
      user: 'stock',
      password: 'stock',
      port,
      persistent: false,
      onLog: () => undefined,
    });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase('stock_test');
    url = `postgres://stock:stock@127.0.0.1:${port}/stock_test`;
  }
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url,
    STORAGE_DIR: path.join(tmpDir, 'storage'),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'Secret#2026',
    LOG_LEVEL: 'silent',
    BACKUP_SCHEDULE_ENABLED: 'false',
    LOGIN_MAX_FREE_ATTEMPTS: '3',
  });
  const { pool } = await import('../src/db/pool');
  if (process.env.TEST_DATABASE_URL) {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  const { migrate } = await import('../src/db/migrate');
  const { seed } = await import('../src/db/seed');
  await migrate();
  await seed();
  const { createApp } = await import('../src/app');
  return { app: createApp(), pool };
}

export async function stopTestEnvironment() {
  const { pool } = await import('../src/db/pool');
  await pool.end().catch(() => undefined);
  if (embedded) await embedded.stop().catch(() => undefined);
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

/** Cookie-keeping client that adds CSRF + Idempotency-Key headers automatically. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  constructor(app: any) {
    this.agent = request.agent(app);
  }
  async init() {
    const r = await this.agent.get('/api/v1/auth/csrf');
    this.csrf = r.body.data.token;
    return this;
  }
  async login(username = 'admin', password = 'Secret#2026') {
    if (!this.csrf) await this.init();
    return this.agent.post('/api/v1/auth/login').set('X-CSRF-TOKEN', this.csrf).send({ username, password });
  }
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body: unknown = {}, opts: { key?: string; idem?: boolean } = {}) {
    const req = this.agent.post(url).set('X-CSRF-TOKEN', this.csrf);
    if (opts.idem !== false) req.set('Idempotency-Key', opts.key ?? randomUUID());
    return req.send(body as object);
  }
  patch(url: string, body: unknown, ifMatch?: string) {
    const req = this.agent.patch(url).set('X-CSRF-TOKEN', this.csrf);
    if (ifMatch) req.set('If-Match', ifMatch);
    return req.send(body as object);
  }
  put(url: string) {
    return this.agent.put(url).set('X-CSRF-TOKEN', this.csrf);
  }
  delete(url: string, body?: unknown) {
    return this.agent.delete(url).set('X-CSRF-TOKEN', this.csrf).send((body ?? {}) as object);
  }
}
