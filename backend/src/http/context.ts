import type { Request } from 'express';

export interface Actor {
  adminId: string;
  username: string;
  requestId: string;
  ip?: string;
}

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      admin?: AuthenticatedAdmin;
    }
  }
}

export function actorFrom(req: Request): Actor {
  return {
    adminId: req.admin!.id,
    username: req.admin!.username,
    requestId: req.requestId,
    ip: req.ip,
  };
}
