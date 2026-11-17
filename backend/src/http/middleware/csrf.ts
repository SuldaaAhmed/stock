import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config';
import { forbidden } from '../errors';

/**
 * Anti-forgery protection (HMAC double-submit):
 *  - GET /api/v1/auth/csrf sets an HttpOnly secret cookie and returns token = HMAC(secret).
 *  - Every state-changing request must send that token in the X-CSRF-TOKEN header.
 * A cross-site attacker can neither read the token nor derive it from the cookie.
 */
export const CSRF_COOKIE = 'stock.csrf';
export const CSRF_HEADER = 'X-CSRF-TOKEN';

function sign(secret: string) {
  return createHmac('sha256', config.csrfSecret).update(secret).digest('base64url');
}

export function issueCsrfToken(req: Request, res: Response): string {
  let secret: string | undefined = req.cookies?.[CSRF_COOKIE];
  if (!secret || !/^[A-Za-z0-9_-]{32,}$/.test(secret)) {
    secret = randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, secret, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: config.cookieSameSite,
      path: '/',
    });
  }
  return sign(secret);
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (!config.csrfEnabled || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const secret = req.cookies?.[CSRF_COOKIE];
  const token = req.header(CSRF_HEADER);
  if (secret && token) {
    const expected = Buffer.from(sign(secret));
    const actual = Buffer.from(token);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return next();
  }
  next(forbidden('Invalid or missing anti-forgery token. Call GET /api/v1/auth/csrf first.', 'CSRF_FAILED'));
}
