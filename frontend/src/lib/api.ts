let csrfToken: string | null = null;

export async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  try {
    const res = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
    if (res.ok) {
      const json = await res.json();
      csrfToken = json.data?.token || null;
      return csrfToken || '';
    }
  } catch (err) {
    console.error('Failed to fetch CSRF token:', err);
  }
  return '';
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T; meta?: any }> {
  const method = options.method?.toUpperCase() || 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  // Attach CSRF and Idempotency key on state mutations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = await fetchCsrfToken();
    if (token) {
      headers['X-CSRF-TOKEN'] = token;
    }
    if (!headers['Idempotency-Key']) {
      headers['Idempotency-Key'] = crypto.randomUUID();
    }
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 204) {
    return { data: {} as T };
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg =
      json.errors?.[0]?.message || json.title || json.message || `Request failed with status ${res.status}`;
    const err = new Error(errorMsg) as any;
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}

export const api = {
  auth: {
    csrf: () => apiRequest('/api/v1/auth/csrf'),
    login: (body: any) => apiRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => apiRequest('/api/v1/auth/logout', { method: 'POST' }),
    me: () => apiRequest('/api/v1/auth/me'),
  },
  dashboard: {
    getSummary: () => apiRequest('/api/v1/dashboard/summary'),
  },
  products: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return apiRequest(`/api/v1/products${qs}`);
    },
    get: (id: string) => apiRequest(`/api/v1/products/${id}`),
    create: (body: any) => apiRequest('/api/v1/products', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: any, etag?: string) =>
      apiRequest(`/api/v1/products/${id}`, {
        method: 'PATCH',
        headers: etag ? { 'If-Match': etag } : {},
        body: JSON.stringify(body),
      }),
    getMovements: (id: string, params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return apiRequest(`/api/v1/products/${id}/movements${qs}`);
    },
    getEditHistory: (id: string) => apiRequest(`/api/v1/products/${id}/edit-history`),
    correctOpeningStock: (id: string, body: any) =>
      apiRequest(`/api/v1/products/${id}/opening-stock-corrections`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  stockIn: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return apiRequest(`/api/v1/stock-ins${qs}`);
    },
    get: (id: string) => apiRequest(`/api/v1/stock-ins/${id}`),
    create: (body: any) => apiRequest('/api/v1/stock-ins', { method: 'POST', body: JSON.stringify(body) }),
    correct: (id: string, body: any) =>
      apiRequest(`/api/v1/stock-ins/${id}/corrections`, { method: 'POST', body: JSON.stringify(body) }),
  },
  stockOut: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return apiRequest(`/api/v1/stock-outs${qs}`);
    },
    get: (id: string) => apiRequest(`/api/v1/stock-outs/${id}`),
    create: (body: any) => apiRequest('/api/v1/stock-outs', { method: 'POST', body: JSON.stringify(body) }),
    correct: (id: string, body: any) =>
      apiRequest(`/api/v1/stock-outs/${id}/corrections`, { method: 'POST', body: JSON.stringify(body) }),
  },
  receipts: {
    get: (id: string) => apiRequest(`/api/v1/receipts/${id}`),
    getPdfUrl: (id: string, disposition: 'inline' | 'attachment' = 'inline') =>
      `/api/v1/receipts/${id}/pdf?disposition=${disposition}`,
  },
};
