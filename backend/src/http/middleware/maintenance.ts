import type { NextFunction, Request, Response } from 'express';

/** Global maintenance flag: set while a restore runs; all other requests are rejected. */
export const maintenance = { active: false, reason: '' };

export function maintenanceGuard(req: Request, res: Response, next: NextFunction) {
  if (!maintenance.active) return next();
  res.setHeader('Retry-After', '30');
  res.status(503).json({
    type: 'MAINTENANCE_MODE',
    title: maintenance.reason || 'The system is under maintenance. Please try again shortly.',
    status: 503,
    requestId: req.requestId,
  });
}
