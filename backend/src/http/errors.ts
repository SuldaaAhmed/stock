export interface FieldError {
  field: string;
  message: string;
}

/** Application error mapped to the standard error response shape. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public errors?: FieldError[],
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, errors?: FieldError[]) =>
  new AppError(400, 'VALIDATION_ERROR', message, errors);

export const validationError = (field: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', 'One or more validation errors occurred.', [{ field, message }]);

export const unauthorized = (message = 'Authentication required.') => new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Forbidden.', code = 'FORBIDDEN') => new AppError(403, code, message);

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);

export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);

/** 422 – business rule violation (insufficient stock, over-delivery, inactive product, ...) */
export const businessRule = (code: string, message: string, errors?: FieldError[]) =>
  new AppError(422, code, message, errors);
