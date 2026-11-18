'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastApi {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

// Exact palette from Frontend Requirements §5 (Toasts)
const STYLES: Record<ToastKind, { box: string; icon: string; text: string; Icon: typeof Info }> = {
  success: { box: 'bg-[#F0FDF4] border-[#BBF7D0]', icon: 'text-[#16A34A]', text: 'text-[#166534]', Icon: CheckCircle2 },
  error: { box: 'bg-[#FEF2F2] border-[#FECACA]', icon: 'text-[#DC2626]', text: 'text-[#991B1B]', Icon: XCircle },
  warning: { box: 'bg-[#FFFBEB] border-[#FDE68A]', icon: 'text-[#D97706]', text: 'text-[#92400E]', Icon: AlertTriangle },
  info: { box: 'bg-[#EFF6FF] border-[#BFDBFE]', icon: 'text-[#2563EB]', text: 'text-[#1E40AF]', Icon: Info },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = ++idRef.current;
      setItems((xs) => [...xs.slice(-3), { id, kind, title, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, m) => push('success', t, m),
      error: (t, m) => push('error', t, m),
      warning: (t, m) => push('warning', t, m),
      info: (t, m) => push('info', t, m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end print:hidden"
      >
        {items.map((t) => {
          const s = STYLES[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-lg animate-toast-in', s.box)}
            >
              <s.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', s.icon)} aria-hidden />
              <div className={cn('min-w-0 flex-1 text-sm', s.text)}>
                <p className="font-semibold">{t.title}</p>
                {t.message && <p className="mt-0.5 break-words opacity-90">{t.message}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className={cn('rounded p-0.5 opacity-60 hover:opacity-100', s.text)}
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
