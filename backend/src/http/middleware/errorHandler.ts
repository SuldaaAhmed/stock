import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../logger';
import { AppError } from '../errors';

/** Centralised error handling. Never leaks stack traces, SQL or internal messages. */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId;
  if (res.headersSent) return;

  if (err instanceof AppError) {
    for (const [h, v] of Object.entries(err.headers ?? {})) res.setHeader(h, v);
    return res.status(err.status).json({
      type: err.code,
      title: err.message,
      status: err.status,
      requestId,
      ...(err.errors ? { errors: err.errors } : {}),
    });
  }

  // Malformed JSON body / payload too large (body-parser)
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ type: 'MALFORMED_JSON', title: 'Request body is not valid JSON.', status: 400, requestId });
  }
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ type: 'PAYLOAD_TOO_LARGE', title: 'Request payload is too large.', status: 413, requestId });
  }

  // PostgreSQL constraint safety nets
  if (err?.code === '23505') {
    return res.status(409).json({ type: 'DUPLICATE', title: 'A record with the same unique value already exists.', status: 409, requestId });
  }
  if (err?.code === '23514') {
    logger.warn({ err: { message: err.message, constraint: err.constraint }, requestId }, 'Check constraint violation');
    return res.status(422).json({
      type: 'BUSINESS_RULE_VIOLATION',
      title: 'The operation would break a stock or data rule (for example a negative balance).',
      status: 422,
      requestId,
    });
  }
  if (err?.code === '40P01' || err?.code === '40001') {
    return res.status(409).json({ type: 'CONCURRENCY_CONFLICT', title: 'A concurrent update conflicted. Please retry.', status: 409, requestId });
  }

  logger.error({ err, requestId }, 'Unhandled error');
  return res.status(500).json({ type: 'SERVER_ERROR', title: 'An unexpected error occurred.', status: 500, requestId });
}
