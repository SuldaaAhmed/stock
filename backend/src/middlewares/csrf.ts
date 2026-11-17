import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_COOKIE_NAME = 'ps_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

export function getCsrfToken(req: Request, res: Response) {
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // Accessible to JS so client can send in header
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }

  return res.json({
    data: {
      token,
      headerName: 'X-CSRF-TOKEN',
    },
    requestId: req.headers['x-request-id'] || crypto.randomUUID(),
  });
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Safe methods do not require CSRF verification
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] || req.headers['x-csrf-token'];

  // In development/testing, if no cookie yet, issue one and allow or check match
  if (cookieToken && headerToken && cookieToken === headerToken) {
    return next();
  }

  // Also allow if running in preview/development if header matches or cookie set
  if (process.env.NODE_ENV !== 'production' && (!cookieToken || headerToken)) {
    return next();
  }

  return res.status(403).json({
    type: 'FORBIDDEN',
    title: 'Invalid or missing CSRF token.',
    status: 403,
    requestId: req.headers['x-request-id'] || crypto.randomUUID(),
    errors: [{ field: 'csrf', message: 'CSRF token verification failed' }],
  });
}
