import { config } from './config';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { seed } from './db/seed';
import { logger } from './logger';
import { reconcile } from './services/reconciliation';
import { startSchedulers, stopSchedulers } from './services/scheduler';

async function main() {
  await migrate();
  await seed();
  await reconcile('Startup').catch((err) => logger.error({ err }, 'Startup reconciliation failed'));
  startSchedulers();
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info(`Stock Management API listening on http://${config.host}:${config.port} (env=${config.env})`);
    if (config.swaggerEnabled) logger.info(`Swagger UI: http://${config.host}:${config.port}/api/docs`);
  });
  const shutdown = () => {
    logger.info('Shutting down');
    stopSchedulers();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
