import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../db/database';
import { getUtcTimestamp } from '../utils/date';

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['idempotency-key'] as string | undefined;

  // Only apply on state-changing methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !key) {
    return next();
  }

  const adminId = req.admin?.id || 'system';
  const rawBody = JSON.stringify(req.body || {});
  const requestHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const now = getUtcTimestamp();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const existing = db.prepare(`
    SELECT * FROM IdempotencyRecords WHERE AdminId = ? AND IdempotencyKey = ?
  `).get(adminId, key) as any;

  if (existing) {
    if (existing.State === 'Processing') {
      return res.status(409).json({
        type: 'IDEMPOTENCY_IN_PROGRESS',
        title: 'An identical request is currently processing.',
        status: 409,
        requestId: req.headers['x-request-id'] || crypto.randomUUID(),
      });
    }

    if (existing.RequestHash !== requestHash) {
      return res.status(409).json({
        type: 'IDEMPOTENCY_KEY_REUSED',
        title: 'Idempotency key was previously used with a different request payload.',
        status: 409,
        requestId: req.headers['x-request-id'] || crypto.randomUUID(),
      });
    }

    // Return stored completed response
    const storedBody = existing.ResponseBody ? JSON.parse(existing.ResponseBody) : {};
    return res.status(existing.ResponseStatus || 200).json(storedBody);
  }

  // Insert processing record
  const recordId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO IdempotencyRecords (
      Id, AdminId, IdempotencyKey, Method, Path, RequestHash, State, CreatedAtUtc, ExpiresAtUtc
    ) VALUES (?, ?, ?, ?, ?, ?, 'Processing', ?, ?)
  `).run(recordId, adminId, key, req.method, req.path, requestHash, now, expiresAt);

  // Hook into response send to store completed result
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    try {
      db.prepare(`
        UPDATE IdempotencyRecords
        SET State = 'Completed', ResponseStatus = ?, ResponseBody = ?
        WHERE Id = ?
      `).run(res.statusCode, JSON.stringify(body), recordId);
    } catch (e) {
      console.error('Failed to update idempotency record:', e);
    }
    return originalJson(body);
  };

  next();
}
