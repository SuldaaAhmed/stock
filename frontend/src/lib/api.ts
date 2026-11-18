/**
 * Centralized, typed API client for the Stock Management Backend (/api/v1).
 *
 * - Relative URLs: the Next.js server proxies /api/* to the Backend (same-origin cookies).
 * - Cookie session (credentials: 'include'); nothing sensitive is stored in browser storage.
 * - CSRF: token from GET /auth/csrf, sent as X-CSRF-TOKEN on POST/PUT/PATCH/DELETE (refreshed once on CSRF_FAILED).
 * - Idempotency-Key on every POST (callers may pass a stable key so a network retry is de-duplicated).
 * - Optimistic concurrency: If-Match: "<rowVersion>" on PATCH of products, customers, orders, company settings.
 * - Errors are thrown as ApiError carrying the Backend ProblemDetails.
 * - 401 on an authenticated call emits a 'session-expired' event handled by the AuthProvider.
 */
import type {
  Adjustment,
  AdjustmentCorrection,
  AdjustmentCreate,
  ApiEnvelope,
  AuditLog,
  AuditLogCorrection,
  BackupLog,
  CompanySettings,
  CompanyUpdate,
  Customer,
  CustomerInput,
  CustomerReturn,
  DamagedAction,
  DamagedActionCreate,
  DamagedBalance,
  DashboardSummary,
  Delivery,
  DeliveryCreate,
  DeliveryResult,
  EditHistoryItem,
  ListParams,
  OpeningStockCorrection,
  Order,
  OrderCreate,
  OrderDetail,
  OrderUpdate,
  PageMeta,
  Paged,
  Preferences,
  PriceHistoryItem,
  ProblemDetails,
  Product,
  ProductCreate,
  ProductDetail,
  ProductUpdate,
  Receipt,
  ReportMeta,
  ReportType,
  ReturnCorrection,
  ReturnCreate,
  SearchResult,
  Session,
  StockIn,
  StockInCorrection,
  StockInCreate,
  StockMovement,
  StockOut,
  StockOutCorrection,
  StockOutCreate,
  Theme,
} from './types';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: ProblemDetails | null;
  readonly fieldErrors: Record<string, string>;
  constructor(status: number, problem: ProblemDetails | null, fallback: string) {
    super(problem?.title || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem?.type || (status === 0 ? 'NETWORK_ERROR' : 'HTTP_' + status);
    this.problem = problem;
    this.fieldErrors = {};
    for (const e of problem?.errors ?? []) {
      // Normalise `lines[0].quantity` → `lines.0.quantity` (both styles are used by the Backend).
      const field = e.field?.replace(/\[(\d+)\]/g, '.$1');
      if (field && !this.fieldErrors[field]) this.fieldErrors[field] = e.message;
    }
  }
  /** First field-level message, or the title. */
  get detail(): string {
    const first = this.problem?.errors?.[0]?.message;
    return first && first !== this.message ? `${this.message} ${first}` : this.message;
  }
}

/** Human-friendly message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Cannot reach the server. Check your internet connection and try again.';
    const errs = err.problem?.errors ?? [];
    if (errs.length === 1) return errs[0].message;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

// ---------------------------------------------------------------------------
// Low-level request
// ---------------------------------------------------------------------------
let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

async function getCsrfToken(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise || force) {
    csrfPromise = fetch(`${API_BASE}/auth/csrf`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!r.ok) throw new ApiError(r.status, null, 'Could not obtain anti-forgery token.');
        const j = (await r.json()) as ApiEnvelope<{ token: string }>;
        csrfToken = j.data.token;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const SESSION_EXPIRED_EVENT = 'stock:session-expired';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: ListParams | Record<string, string | number | boolean | undefined | null>;
  idempotencyKey?: string;
  ifMatch?: number | string;
  signal?: AbortSignal;
  /** Do not emit session-expired on 401 (used by auth calls). */
  skipAuthRedirect?: boolean;
}

export function buildQuery(q?: RequestOptions['query']): string {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (isForm) body = opts.body as FormData;
    else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
  }
  if (method !== 'GET') {
    headers['X-CSRF-TOKEN'] = await getCsrfToken();
    if (method === 'POST') headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();
  }
  if (opts.ifMatch !== undefined) headers['If-Match'] = `"${opts.ifMatch}"`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      body,
      credentials: 'include',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, null, 'Network error');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const problem = (json && typeof json === 'object' && 'status' in json ? json : null) as ProblemDetails | null;
    if (res.status === 403 && problem?.type === 'CSRF_FAILED' && !retried) {
      await getCsrfToken(true);
      return request<T>(path, opts, true);
    }
    if (res.status === 401 && !opts.skipAuthRedirect && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, problem, `Request failed (${res.status})`);
  }
  return json as T;
}

const get = <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
  request<T>(path, { query, signal });
const one = async <T>(p: Promise<ApiEnvelope<T>>) => (await p).data;
const page = async <T, M extends PageMeta = PageMeta>(p: Promise<ApiEnvelope<T[], M>>): Promise<Paged<T, M>> => {
  const r = await p;
  return { data: r.data, meta: r.meta as M };
};

type Opt = { idempotencyKey?: string };

// ---------------------------------------------------------------------------
// URL helpers (for <a href>, <iframe src>, <img src>)
// ---------------------------------------------------------------------------
export const urls = {
  receiptPdf: (id: string, disposition: 'inline' | 'attachment' = 'inline') =>
    `${API_BASE}/receipts/${id}/pdf?disposition=${disposition}`,
  reportPdf: (type: ReportType, q: ListParams) => `${API_BASE}/reports/${type}/export/pdf${buildQuery(q)}`,
  logo: (version?: string | number) => `${API_BASE}/settings/company/logo${version ? `?v=${encodeURIComponent(String(version))}` : ''}`,
  backupDownload: (id: string) => `${API_BASE}/backups/${id}/download`,
  swagger: '/api/docs',
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
export const api = {
  auth: {
    csrf: () => getCsrfToken(true),
    login: (username: string, password: string) =>
      one(request<ApiEnvelope<Session>>('/auth/login', { method: 'POST', body: { username, password }, skipAuthRedirect: true })),
    logout: () => request<void>('/auth/logout', { method: 'POST', skipAuthRedirect: true }),
    me: (signal?: AbortSignal) => one(request<ApiEnvelope<Session>>('/auth/me', { signal, skipAuthRedirect: true })),
  },

  dashboard: {
    summary: (signal?: AbortSignal) => one(get<ApiEnvelope<DashboardSummary>>('/dashboard/summary', undefined, signal)),
  },

  search: (q: ListParams, signal?: AbortSignal) => page(get<ApiEnvelope<SearchResult[], PageMeta>>('/search', q, signal)),

  products: {
    list: (q: ListParams & { lowStock?: boolean }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<Product[], PageMeta>>('/products', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<ProductDetail>>(`/products/${id}`, undefined, signal)),
    create: (body: ProductCreate, o?: Opt) =>
      one(request<ApiEnvelope<Product>>('/products', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
    update: (id: string, body: ProductUpdate, rowVersion: number) =>
      one(request<ApiEnvelope<Product>>(`/products/${id}`, { method: 'PATCH', body, ifMatch: rowVersion })),
    movements: (id: string, q: ListParams, signal?: AbortSignal) =>
      page(get<ApiEnvelope<StockMovement[], PageMeta>>(`/products/${id}/movements`, q, signal)),
    editHistory: (id: string, q: ListParams, signal?: AbortSignal) =>
      page(get<ApiEnvelope<EditHistoryItem[], PageMeta>>(`/products/${id}/edit-history`, q, signal)),
    priceHistory: (id: string, q: ListParams, signal?: AbortSignal) =>
      page(get<ApiEnvelope<PriceHistoryItem[], PageMeta>>(`/products/${id}/price-history`, q, signal)),
    openingStockCorrections: (id: string, q: ListParams, signal?: AbortSignal) =>
      page(
        get<ApiEnvelope<OpeningStockCorrection[], PageMeta>>(`/products/${id}/history`, { ...q, section: 'opening-stock-corrections' }, signal),
      ),
    correctOpeningStock: (id: string, body: { newOpeningStock: number; reason: string }, o?: Opt) =>
      one(
        request<ApiEnvelope<OpeningStockCorrection>>(`/products/${id}/opening-stock-corrections`, {
          method: 'POST',
          body,
          idempotencyKey: o?.idempotencyKey,
        }),
      ),
  },

  stockIns: {
    list: (q: ListParams & { includeSuperseded?: boolean }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<StockIn[], PageMeta>>('/stock-ins', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<StockIn>>(`/stock-ins/${id}`, undefined, signal)),
    create: (body: StockInCreate, o?: Opt) =>
      one(request<ApiEnvelope<StockIn>>('/stock-ins', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
    correct: (id: string, body: StockInCorrection, o?: Opt) =>
      one(request<ApiEnvelope<StockIn>>(`/stock-ins/${id}/corrections`, { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
  },

  stockOuts: {
    list: (q: ListParams & { includeSuperseded?: boolean }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<StockOut[], PageMeta>>('/stock-outs', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<StockOut>>(`/stock-outs/${id}`, undefined, signal)),
    create: (body: StockOutCreate, o?: Opt) =>
      one(request<ApiEnvelope<StockOut>>('/stock-outs', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
    correct: (id: string, body: StockOutCorrection, o?: Opt) =>
      one(request<ApiEnvelope<StockOut>>(`/stock-outs/${id}/corrections`, { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
  },

  transfers: {
    list: (q: ListParams, signal?: AbortSignal) => page(get<ApiEnvelope<StockOut[], PageMeta>>('/transfers', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<StockOut>>(`/transfers/${id}`, undefined, signal)),
  },

  customers: {
    list: (q: ListParams, signal?: AbortSignal) => page(get<ApiEnvelope<Customer[], PageMeta>>('/customers', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<Customer>>(`/customers/${id}`, undefined, signal)),
    create: (body: CustomerInput, o?: Opt) =>
      one(request<ApiEnvelope<Customer>>('/customers', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
    update: (id: string, body: Partial<CustomerInput>, rowVersion: number) =>
      one(request<ApiEnvelope<Customer>>(`/customers/${id}`, { method: 'PATCH', body, ifMatch: rowVersion })),
    history: (id: string, q: ListParams, signal?: AbortSignal) =>
      page(get<ApiEnvelope<EditHistoryItem[], PageMeta>>(`/customers/${id}/history`, q, signal)),
  },

  orders: {
    list: (q: ListParams, signal?: AbortSignal) => page(get<ApiEnvelope<Order[], PageMeta>>('/orders', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<OrderDetail>>(`/orders/${id}`, undefined, signal)),
    create: (body: OrderCreate, o?: Opt) =>
      one(request<ApiEnvelope<OrderDetail>>('/orders', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
    update: (id: string, body: OrderUpdate, rowVersion: number) =>
      one(request<ApiEnvelope<OrderDetail>>(`/orders/${id}`, { method: 'PATCH', body, ifMatch: rowVersion })),
    deliveries: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<Delivery[]>>(`/orders/${id}/deliveries`, undefined, signal)),
    deliver: (id: string, body: DeliveryCreate, o?: Opt) =>
      one(request<ApiEnvelope<DeliveryResult>>(`/orders/${id}/deliveries`, { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
  },

  returns: {
    list: (q: ListParams & { includeSuperseded?: boolean; condition?: string; orderId?: string }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<CustomerReturn[], PageMeta>>('/returns', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<CustomerReturn>>(`/returns/${id}`, undefined, signal)),
    create: (body: ReturnCreate, o?: Opt) =>
      one(request<ApiEnvelope<CustomerReturn>>('/returns', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
    correct: (id: string, body: ReturnCorrection, o?: Opt) =>
      one(request<ApiEnvelope<CustomerReturn>>(`/returns/${id}/corrections`, { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
  },

  adjustments: {
    list: (q: ListParams & { includeSuperseded?: boolean }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<Adjustment[], PageMeta>>('/adjustments', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<Adjustment>>(`/adjustments/${id}`, undefined, signal)),
    create: (body: AdjustmentCreate, o?: Opt) =>
      one(request<ApiEnvelope<Adjustment>>('/adjustments', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
    correct: (id: string, body: AdjustmentCorrection, o?: Opt) =>
      one(request<ApiEnvelope<Adjustment>>(`/adjustments/${id}/corrections`, { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
  },

  damaged: {
    list: (q: ListParams, signal?: AbortSignal) =>
      page(get<ApiEnvelope<DamagedAction[], PageMeta & { balances: DamagedBalance[] }>>('/damaged-stock/actions', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<DamagedAction>>(`/damaged-stock/actions/${id}`, undefined, signal)),
    create: (body: DamagedActionCreate, o?: Opt) =>
      one(request<ApiEnvelope<DamagedAction>>('/damaged-stock/actions', { method: 'POST', body, idempotencyKey: o?.idempotencyKey })),
  },

  receipts: {
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<Receipt>>(`/receipts/${id}`, undefined, signal)),
  },

  reports: {
    get: (type: ReportType, q: ListParams & { condition?: string }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<Record<string, unknown>[], ReportMeta>>(`/reports/${type}`, q, signal)),
  },

  settings: {
    company: (signal?: AbortSignal) => one(get<ApiEnvelope<CompanySettings>>('/settings/company', undefined, signal)),
    updateCompany: (body: CompanyUpdate, rowVersion: number) =>
      one(request<ApiEnvelope<CompanySettings>>('/settings/company', { method: 'PATCH', body, ifMatch: rowVersion })),
    uploadLogo: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return one(request<ApiEnvelope<CompanySettings>>('/settings/company/logo', { method: 'PUT', body: fd }));
    },
    removeLogo: () => request<ApiEnvelope<CompanySettings> | undefined>('/settings/company/logo', { method: 'DELETE' }),
    preferences: (signal?: AbortSignal) => one(get<ApiEnvelope<Preferences>>('/settings/preferences', undefined, signal)),
    updatePreferences: (theme: Theme) =>
      one(request<ApiEnvelope<Preferences>>('/settings/preferences', { method: 'PATCH', body: { theme } })),
  },

  auditLogs: {
    list: (q: ListParams & { includeDeleted?: boolean; entityType?: string; action?: string }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<AuditLog[], PageMeta>>('/audit-logs', q, signal)),
    get: (id: number, signal?: AbortSignal) => one(get<ApiEnvelope<AuditLog>>(`/audit-logs/${id}`, undefined, signal)),
    update: (id: number, body: { description?: string; note?: string; reason: string }) =>
      one(request<ApiEnvelope<AuditLog>>(`/audit-logs/${id}`, { method: 'PATCH', body })),
    remove: (id: number, reason: string) => request<unknown>(`/audit-logs/${id}`, { method: 'DELETE', body: { reason } }),
    corrections: (q: ListParams & { auditLogId?: number }, signal?: AbortSignal) =>
      page(get<ApiEnvelope<AuditLogCorrection[], PageMeta>>('/audit-log-corrections', q, signal)),
  },

  backups: {
    list: (q: ListParams, signal?: AbortSignal) => page(get<ApiEnvelope<BackupLog[], PageMeta>>('/backups', q, signal)),
    get: (id: string, signal?: AbortSignal) => one(get<ApiEnvelope<BackupLog>>(`/backups/${id}`, undefined, signal)),
    create: (o?: Opt) => one(request<ApiEnvelope<BackupLog>>('/backups', { method: 'POST', idempotencyKey: o?.idempotencyKey })),
    restore: (id: string, o?: Opt) =>
      one(
        request<ApiEnvelope<Record<string, unknown>>>(`/backups/${id}/restore`, {
          method: 'POST',
          body: { confirm: true, confirmationText: 'RESTORE' },
          idempotencyKey: o?.idempotencyKey,
          skipAuthRedirect: true,
        }),
      ),
  },
};
