import express, { NextFunction, Request, Response, Router } from 'express';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z, ZodType } from 'zod';
import { config } from '../config';
import { one, pool, withTransaction } from '../db/pool';
import { actorFrom, Actor } from './context';
import { AppError, badRequest, conflict } from './errors';
import { canonicalJson } from './respond';
import { requireAuth } from './middleware/auth';

export type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface HandlerResult {
  data?: unknown;
  meta?: unknown;
  status?: number;
  location?: string;
  headers?: Record<string, string>;
}

export interface RouteContext<B = any, Q = any> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: Record<string, string>;
  /** Authenticated actor (only for authenticated routes). */
  actor: Actor;
  /**
   * Run a state-changing unit of work in one DB transaction. For idempotent routes the
   * stored idempotency result is written inside the SAME transaction, so a request is
   * either fully posted and recorded, or not at all.
   */
  mutate: (fn: (tx: PoolClient) => Promise<HandlerResult>) => Promise<HandlerResult>;
}

export interface RouteDef<B = any, Q = any> {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth?: boolean;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  idempotent?: boolean;
  ifMatch?: boolean;
  successStatus?: number;
  produces?: 'json' | 'pdf' | 'binary' | 'image';
  multipart?: boolean;
  handler: (ctx: RouteContext<B, Q>) => Promise<HandlerResult | void>;
}

export const registry: RouteDef[] = [];

export function route<B = any, Q = any>(def: RouteDef<B, Q>): RouteDef<B, Q> {
  registry.push(def as RouteDef);
  return def;
}

function zodToFieldErrors(err: z.ZodError, prefix?: string) {
  return err.issues.map((i) => ({
    field: [prefix, ...i.path.map(String)].filter(Boolean).join('.') || prefix || 'body',
    message: i.message,
  }));
}

function envelope(req: Request, result: HandlerResult) {
  const body: Record<string, unknown> = { data: result.data ?? null };
  if (result.meta !== undefined) body.meta = result.meta;
  body.requestId = req.requestId;
  return body;
}

interface IdemState {
  adminId: string;
  key: string;
  completed: boolean;
}

async function beginIdempotency(req: Request, res: Response): Promise<IdemState | 'replayed'> {
  const key = req.header('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 200) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (8-200 characters) is required.', [
      { field: 'Idempotency-Key', message: 'Header is required for this operation.' },
    ]);
  }
  const adminId = req.admin!.id;
  const hash = createHash('sha256')
    .update(`${req.method} ${req.baseUrl}${req.path}\n${canonicalJson(req.body ?? null)}`)
    .digest('hex');
  const expires = new Date(Date.now() + config.idempotencyRetentionHours * 3600_000);

  const inserted = await one(
    pool,
    `INSERT INTO idempotency_records(admin_id, idempotency_key, method, path, request_hash, state, expires_at)
     VALUES ($1,$2,$3,$4,$5,'Processing',$6)
     ON CONFLICT (admin_id, idempotency_key) DO NOTHING RETURNING idempotency_key`,
    [adminId, key, req.method, req.originalUrl.split('?')[0], hash, expires],
  );
  if (inserted) return { adminId, key, completed: false };

  const existing = await one(pool, 'SELECT * FROM idempotency_records WHERE admin_id=$1 AND idempotency_key=$2', [adminId, key]);
  if (!existing) return beginIdempotency(req, res); // expired & purged concurrently
  if (existing.request_hash !== hash) {
    throw conflict('This Idempotency-Key was already used with a different request payload.', 'IDEMPOTENCY_KEY_REUSED');
  }
  if (existing.state === 'Completed') {
    if (existing.location) res.setHeader('Location', existing.location);
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(existing.response_status).json(existing.response_body);
    return 'replayed';
  }
  // Processing: the completion is written in the posting transaction, so a stale
  // Processing row (> 2 minutes) proves the original attempt never committed.
  const ageMs = Date.now() - new Date(existing.created_at).getTime();
  if (ageMs > 120_000) {
    await pool.query(
      `UPDATE idempotency_records SET created_at = now(), expires_at=$3
       WHERE admin_id=$1 AND idempotency_key=$2 AND state='Processing'`,
      [adminId, key, expires],
    );
    return { adminId, key, completed: false };
  }
  throw conflict('An identical request is still being processed.', 'IDEMPOTENCY_IN_PROGRESS');
}

async function storeIdempotent(db: Pick<PoolClient, 'query'>, st: IdemState, status: number, body: unknown, location?: string) {
  await db.query(
    `UPDATE idempotency_records SET state='Completed', response_status=$3, response_body=$4, location=$5
     WHERE admin_id=$1 AND idempotency_key=$2`,
    [st.adminId, st.key, status, JSON.stringify(body), location ?? null],
  );
  st.completed = true;
}

function wrap(def: RouteDef) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let idem: IdemState | undefined;
    try {
      let body: any = req.body;
      if (def.body) {
        const parsed = def.body.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest('One or more validation errors occurred.', zodToFieldErrors(parsed.error));
        body = parsed.data;
      }
      let q: any = req.query;
      if (def.query) {
        const parsed = def.query.safeParse(req.query ?? {});
        if (!parsed.success) throw badRequest('One or more validation errors occurred.', zodToFieldErrors(parsed.error));
        q = parsed.data;
      }
      for (const [k, v] of Object.entries(req.params)) {
        if (k === 'id' && !/^[0-9a-f-]{36}$/i.test(String(v)) && !/^\d+$/.test(String(v))) {
          throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
        }
      }

      if (def.idempotent) {
        const st = await beginIdempotency(req, res);
        if (st === 'replayed') return;
        idem = st;
      }

      const defaultStatus = def.successStatus ?? (def.method === 'post' ? 201 : 200);
      const ctx: RouteContext = {
        req,
        res,
        body,
        query: q,
        params: req.params as Record<string, string>,
        actor: req.admin ? actorFrom(req) : (undefined as unknown as Actor),
        mutate: async (fn) =>
          withTransaction(async (tx) => {
            const result = await fn(tx);
            if (idem) {
              await storeIdempotent(tx, idem, result.status ?? defaultStatus, envelope(req, result), result.location);
            }
            return result;
          }),
      };

      const result = await def.handler(ctx);
      if (res.headersSent) return;
      if (!result) {
        res.status(204).end();
        return;
      }
      const status = result.status ?? defaultStatus;
      if (result.location) res.setHeader('Location', result.location);
      for (const [h, v] of Object.entries(result.headers ?? {})) res.setHeader(h, v);
      if (status === 204) {
        res.status(204).end();
      } else {
        const payload = envelope(req, result);
        if (idem && !idem.completed) await storeIdempotent(pool, idem, status, payload, result.location);
        res.status(status).json(payload);
      }
    } catch (err) {
      if (idem && !idem.completed) {
        await pool
          .query(`DELETE FROM idempotency_records WHERE admin_id=$1 AND idempotency_key=$2 AND state='Processing'`, [
            idem.adminId,
            idem.key,
          ])
          .catch(() => undefined);
      }
      next(err);
    }
  };
}

export function buildRouter(): Router {
  const router = express.Router();
  for (const def of registry) {
    const handlers: express.RequestHandler[] = [];
    if (def.auth !== false) handlers.push(requireAuth);
    handlers.push(wrap(def));
    router[def.method](def.path, ...handlers);
  }
  return router;
}
