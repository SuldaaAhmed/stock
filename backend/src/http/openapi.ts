import { z } from 'zod';
import { registry } from './router';

function toSchema(schema: z.ZodType | undefined) {
  if (!schema) return undefined;
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'openapi-3.0' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

/** OpenAPI 3.0 document generated from the route registry and its zod schemas. */
export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of registry) {
    const p = `/api/v1${r.path.replace(/:(\w+)/g, '{$1}')}`;
    const params: unknown[] = [];
    for (const m of r.path.matchAll(/:(\w+)/g)) params.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
    const qs = toSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    for (const [name, schema] of Object.entries(qs?.properties ?? {})) {
      params.push({ name, in: 'query', required: qs?.required?.includes(name) && !(schema as any).default ? true : false, schema });
    }
    if (r.idempotent) params.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8 } });
    if (r.ifMatch) params.push({ name: 'If-Match', in: 'header', required: true, schema: { type: 'string' }, description: 'ETag (row version) from the GET response' });
    if (r.method !== 'get') params.push({ name: 'X-CSRF-TOKEN', in: 'header', required: true, schema: { type: 'string' }, description: 'Token from GET /api/v1/auth/csrf' });

    const success = String(r.successStatus ?? (r.method === 'post' ? 201 : 200));
    const content =
      r.produces === 'pdf'
        ? { 'application/pdf': { schema: { type: 'string', format: 'binary' } } }
        : r.produces === 'binary'
          ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
          : r.produces === 'image'
            ? { 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } } }
            : { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } };
    const responses: Record<string, unknown> = {
      [success]: success === '204' ? { description: 'No content' } : { description: 'Success', content },
      '400': { $ref: '#/components/responses/Error' },
      ...(r.auth === false ? {} : { '401': { $ref: '#/components/responses/Error' } }),
      ...(r.method !== 'get' ? { '403': { $ref: '#/components/responses/Error' } } : {}),
      ...(r.path.includes(':id') ? { '404': { $ref: '#/components/responses/Error' } } : {}),
      ...(r.idempotent || r.ifMatch ? { '409': { $ref: '#/components/responses/Error' } } : {}),
      ...(r.method !== 'get' ? { '422': { $ref: '#/components/responses/Error' } } : {}),
      '500': { $ref: '#/components/responses/Error' },
    };
    const op: Record<string, unknown> = {
      tags: [r.tag],
      summary: r.summary,
      description: r.description,
      parameters: params,
      responses,
      security: r.auth === false ? [] : [{ cookieAuth: [] }],
    };
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(r.body) } } };
    if (r.multipart) {
      op.requestBody = {
        required: true,
        content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } } },
      };
    }
    paths[p] = { ...(paths[p] ?? {}), [r.method]: op };
  }
  paths['/health'] = {
    get: { tags: ['Health'], summary: 'Anonymous minimal service/database/reconciliation status', security: [], responses: { '200': { description: 'Healthy' }, '503': { description: 'Unhealthy' } } },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Complete Stock Management System – Backend API',
      version: '1.1.0',
      description:
        'REST/JSON API. Currency KES, unit BOX (whole numbers), time zone Africa/Nairobi. Timestamps are UTC (…Z); business dates are YYYY-MM-DD (Nairobi calendar). ' +
        'Authenticate with POST /api/v1/auth/login (cookie). State-changing requests need X-CSRF-TOKEN; posting operations need Idempotency-Key; PATCH needs If-Match.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'stock.sid' } },
      schemas: {
        SuccessEnvelope: {
          type: 'object',
          properties: {
            data: { description: 'Resource or result' },
            meta: { $ref: '#/components/schemas/PageMeta' },
            requestId: { type: 'string' },
          },
          required: ['data', 'requestId'],
        },
        PageMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            totalItems: { type: 'integer' },
            totalPages: { type: 'integer' },
            hasNext: { type: 'boolean' },
            hasPrevious: { type: 'boolean' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            type: { type: 'string', example: 'INSUFFICIENT_STOCK' },
            title: { type: 'string' },
            status: { type: 'integer' },
            requestId: { type: 'string' },
            errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
          },
          required: ['type', 'title', 'status', 'requestId'],
        },
      },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
    },
    paths,
  };
}
