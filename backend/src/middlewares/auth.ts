import { Request, Response, NextFunction } from 'express';
import { db } from '../db/database';

export const AUTH_COOKIE_NAME = 'ps_auth_session';

export interface AuthenticatedUser {
  id: string;
  username: string;
  theme: 'Light' | 'Dark';
}

declare global {
  namespace Express {
    interface Request {
      admin?: AuthenticatedUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Allow anonymous endpoints
  if (
    req.path.startsWith('/api/v1/auth/login') ||
    req.path.startsWith('/api/v1/auth/csrf') ||
    req.path === '/health'
  ) {
    return next();
  }

  const sessionToken = req.cookies?.[AUTH_COOKIE_NAME] || req.headers['authorization']?.replace('Bearer ', '');

  if (!sessionToken) {
    return res.status(401).json({
      type: 'UNAUTHORIZED',
      title: 'Authentication required.',
      status: 401,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'auth', message: 'You must be logged in to access this resource.' }],
    });
  }

  // Session token format: adminId:securityStamp
  const parts = sessionToken.split(':');
  if (parts.length !== 2) {
    return res.status(401).json({
      type: 'UNAUTHORIZED',
      title: 'Invalid session.',
      status: 401,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'auth', message: 'Session token format is invalid.' }],
    });
  }

  const [adminId, stamp] = parts;
  const user = db.prepare(`
    SELECT u.Id, u.UserName, u.SecurityStamp, COALESCE(p.Theme, 'Light') as Theme
    FROM AspNetUsers u
    LEFT JOIN AdminPreferences p ON p.AdminId = u.Id
    WHERE u.Id = ? AND u.SecurityStamp = ?
  `).get(adminId, stamp) as { Id: string; UserName: string; SecurityStamp: string; Theme: 'Light' | 'Dark' } | undefined;

  if (!user) {
    return res.status(401).json({
      type: 'UNAUTHORIZED',
      title: 'Session expired or invalidated.',
      status: 401,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'auth', message: 'Please log in again.' }],
    });
  }

  req.admin = {
    id: user.Id,
    username: user.UserName,
    theme: user.Theme,
  };

  next();
}
