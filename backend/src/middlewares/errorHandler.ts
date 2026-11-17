import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { InsufficientStockError, InsufficientDamagedStockError } from '../services/stockEngine';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) || 'req-' + Date.now();

  if (err instanceof InsufficientStockError) {
    return res.status(422).json({
      type: 'INSUFFICIENT_STOCK',
      title: 'Not enough available stock.',
      status: 422,
      requestId,
      errors: [
        {
          field: err.field,
          message: err.message,
        },
      ],
    });
  }

  if (err instanceof InsufficientDamagedStockError) {
    return res.status(422).json({
      type: 'INSUFFICIENT_DAMAGED_STOCK',
      title: 'Not enough damaged stock.',
      status: 422,
      requestId,
      errors: [
        {
          field: 'quantity',
          message: err.message,
        },
      ],
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'One or more validation errors occurred.',
      status: 400,
      requestId,
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err.status && err.status < 500) {
    return res.status(err.status).json({
      type: err.type || 'CLIENT_ERROR',
      title: err.message || 'Client error occurred.',
      status: err.status,
      requestId,
      errors: err.errors || [{ field: 'general', message: err.message }],
    });
  }

  console.error('Unhandled server error:', err);
  return res.status(500).json({
    type: 'SERVER_ERROR',
    title: 'An unexpected internal error occurred.',
    status: 500,
    requestId,
    errors: [{ field: 'server', message: 'Please try again later.' }],
  });
}
