'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, newIdempotencyKey } from './api';

/**
 * Minimal server-state hook.
 * - Aborts the in-flight request when inputs change or the component unmounts (stale-response protection).
 * - `reload()` refetches with the same inputs (used after successful stock-changing operations).
 * Server data is kept separate from transient UI state.
 */
export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean; keepPrevious?: boolean } = {},
) {
  const { enabled = true, keepPrevious = true } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    if (!keepPrevious) setData(undefined);
    fetcherRef
      .current(ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (ctrl.signal.aborted || (e as Error)?.name === 'AbortError') return;
        setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/**
 * Mutation hook for posting operations.
 * - `pending` prevents duplicate submissions while a request is in flight.
 * - Keeps the same Idempotency-Key across retries after a *network* failure (so a retried post is de-duplicated
 *   by the Backend); a new key is generated after any definitive server response.
 * - Field errors from ProblemDetails are exposed for display beside fields.
 */
export function useMutation<A extends unknown[], R>(fn: (key: string, ...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const keyRef = useRef<string>(newIdempotencyKey());
  const pendingRef = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (pendingRef.current) return undefined;
      pendingRef.current = true;
      setPending(true);
      setError(null);
      setFieldErrors({});
      try {
        const r = await fnRef.current(keyRef.current, ...args);
        keyRef.current = newIdempotencyKey();
        return r;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 0)) keyRef.current = newIdempotencyKey();
        setError(e);
        if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
        throw e;
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  return { run, pending, error, fieldErrors, reset, setFieldErrors };
}

/** Page/pageSize state with a reset helper for when filters change. */
export function usePaging(initialSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);
  return { page, setPage, pageSize, setPageSize: (n: number) => (setPageSize(n), setPage(1)) };
}
