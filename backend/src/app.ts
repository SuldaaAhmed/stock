import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { pool } from './db/pool';
import { AppError } from './http/errors';
import { csrfProtection } from './http/middleware/csrf';
import { errorHandler } from './http/middleware/errorHandler';
import { maintenance, maintenanceGuard } from './http/middleware/maintenance';
import { optionalAuth } from './http/middleware/auth';
import { requestId } from './http/middleware/requestId';
import { buildOpenApi } from './http/openapi';
import { buildRouter } from './http/router';
import { logger } from './logger';
import { lastReconciliation } from './services/reconciliation';

// Route modules register themselves in the route registry on import.
import './routes/products';
import './routes/transactions';
import './routes/orders';
import './routes/system';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      serializers: { req: (req) => ({ method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-TOKEN', 'Idempotency-Key', 'If-Match', 'X-Request-Id'],
      exposedHeaders: ['ETag', 'Location', 'X-Request-Id', 'Retry-After', 'Content-Disposition', 'Idempotent-Replayed'],
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  // Anonymous, minimal health check (not a business endpoint).
  app.get('/health', async (_req, res) => {
    let database = 'up';
    try {
      await pool.query('SELECT 1');
    } catch {
      database = 'down';
    }
    const rec = database === 'up' ? await lastReconciliation().catch(() => null) : null;
    const status = database === 'down' ? 'unhealthy' : maintenance.active || (rec?.mismatchCount ?? 0) > 0 ? 'degraded' : 'healthy';
    res.status(database === 'down' ? 503 : 200).json({
      status,
      database,
      maintenance: maintenance.active,
      ledgerReconciliation: rec ? { lastRunAt: rec.runAt, mismatchCount: rec.mismatchCount } : null,
    });
  });

  app.use(maintenanceGuard);

  // Swagger/OpenAPI: open in development; elsewhere only for an authenticated Admin.
  if (config.swaggerEnabled) {
    const gate: express.RequestHandler = (req, _res, next) =>
      config.isDevelopment || req.admin ? next() : next(new AppError(401, 'UNAUTHORIZED', 'Authentication required.'));
    app.get('/api/openapi.json', optionalAuth, gate, (_req, res) => res.json(buildOpenApi()));
    app.use('/api/docs', optionalAuth, gate, swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/openapi.json', withCredentials: true } }));
  }

  app.use('/api/v1', csrfProtection, buildRouter());

  app.use((req, res) => {
    res.status(404).json({ type: 'NOT_FOUND', title: 'Endpoint not found.', status: 404, requestId: req.requestId });
  });
  app.use(errorHandler);
  return app;
}
