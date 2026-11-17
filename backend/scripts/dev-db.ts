/**
 * Development helper: starts a local PostgreSQL server using the `embedded-postgres`
 * npm package (no system install needed). Data lives in ./.pgdata (git-ignored).
 *
 *   npm run dev:db      -> postgres://stock:stock@127.0.0.1:5433/stock
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const port = Number(process.env.DEV_DB_PORT ?? 5433);
  const databaseDir = path.resolve(process.env.DEV_DB_DIR ?? '.pgdata');
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'stock',
    password: 'stock',
    port,
    persistent: true,
    onLog: () => undefined,
  });
  if (!fs.existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase('stock');
  } catch {
    /* already exists */
  }
  console.log(`PostgreSQL ready: postgres://stock:stock@127.0.0.1:${port}/stock`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
