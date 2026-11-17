import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, validateSession } from '../../services/sessions';
import { unauthorized } from '../errors';

/** Rejects unauthenticated requests; attaches req.admin for authenticated ones. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next(unauthorized());
    const session = await validateSession(token);
    if (!session) return next(unauthorized('Your session has expired. Please log in again.'));
    req.admin = { id: session.adminId, username: session.username, sessionId: session.sessionId };
    next();
  } catch (err) {
    next(err);
  }
}

/** Best-effort session lookup without rejecting (used by Swagger gating). */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const session = await validateSession(token);
      if (session) req.admin = { id: session.adminId, username: session.username, sessionId: session.sessionId };
    }
    next();
  } catch (err) {
    next(err);
  }
}
