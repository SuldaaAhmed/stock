import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/database';
import { getCsrfToken } from '../middlewares/csrf';
import { AUTH_COOKIE_NAME } from '../middlewares/auth';
import { logAudit } from '../services/auditService';

export const authRouter = Router();

authRouter.get('/csrf', getCsrfToken);

authRouter.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'Invalid credentials payload.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'credentials', message: 'Username and password are required.' }],
    });
  }

  const normalized = String(username).trim().toUpperCase();
  const user = db.prepare(`
    SELECT u.Id, u.UserName, u.PasswordHash, u.SecurityStamp, COALESCE(p.Theme, 'Light') as Theme
    FROM AspNetUsers u
    LEFT JOIN AdminPreferences p ON p.AdminId = u.Id
    WHERE u.NormalizedUserName = ?
  `).get(normalized) as any;

  if (!user || !bcrypt.compareSync(password, user.PasswordHash)) {
    logAudit({
      actorType: 'Admin',
      action: 'Auth.FailedLogin',
      entityType: 'Admin',
      description: `Failed login attempt for username: ${username}`,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });

    return res.status(401).json({
      type: 'INVALID_CREDENTIALS',
      title: 'Invalid username or password.',
      status: 401,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'login', message: 'Invalid username or password' }],
    });
  }

  // Issue session cookie
  const sessionToken = `${user.Id}:${user.SecurityStamp}`;
  res.cookie(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });

  logAudit({
    actorType: 'Admin',
    adminId: user.Id,
    action: 'Auth.Login',
    entityType: 'Admin',
    entityId: user.Id,
    description: `Admin logged in successfully`,
    ipAddress: req.ip,
    requestId: req.headers['x-request-id'] as string,
  });

  return res.json({
    data: {
      admin: {
        id: user.Id,
        username: user.UserName,
      },
      theme: user.Theme,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

authRouter.post('/logout', (req: Request, res: Response) => {
  if (req.admin) {
    logAudit({
      actorType: 'Admin',
      adminId: req.admin.id,
      action: 'Auth.Logout',
      entityType: 'Admin',
      entityId: req.admin.id,
      description: 'Admin logged out',
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  }

  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  return res.status(204).send();
});

authRouter.get('/me', (req: Request, res: Response) => {
  if (!req.admin) {
    return res.status(401).json({
      type: 'UNAUTHORIZED',
      title: 'Not authenticated.',
      status: 401,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  return res.json({
    data: {
      admin: {
        id: req.admin.id,
        username: req.admin.username,
      },
      theme: req.admin.theme,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});
