import { Router, Request, Response } from 'express';
import { db } from '../db/database';

export const healthRouter = Router();

healthRouter.get('/health', (req: Request, res: Response) => {
  try {
    const dbTest = db.prepare(`SELECT 1 as alive`).get() as { alive: number } | undefined;
    const isDbAlive = dbTest?.alive === 1;

    return res.json({
      status: isDbAlive ? 'Healthy' : 'Degraded',
      service: 'Healthy',
      database: isDbAlive ? 'Healthy' : 'Unhealthy',
      reconciliation: 'Healthy',
    });
  } catch (e) {
    return res.status(503).json({
      status: 'Unhealthy',
      service: 'Healthy',
      database: 'Unhealthy',
      reconciliation: 'Unhealthy',
    });
  }
});
