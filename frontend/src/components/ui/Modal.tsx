'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { Button, type ButtonVariant } from './Button';
import { Textarea } from './Field';

/**
 * Modal per §5: white / #1E293B background, #E2E8F0 / #334155 border, black overlay, 16px radius.
 * - Escape / overlay click close unless `busy` (a save is in flight) — modals never close when saving fails.
 * - Focus is moved into the dialog and restored afterwards.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  busy?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button');
      el?.focus();
    }, 20);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !mounted) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 print:hidden" role="presentation">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] animate-fade-in" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative flex max-h-[94vh] w-full flex-col rounded-t-2xl border border-[#E2E8F0] bg-white shadow-2xl animate-modal-in dark:border-[#334155] dark:bg-[#1E293B] sm:rounded-2xl',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-5 py-4 dark:border-[#334155]">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-[#E2E8F0] px-5 py-3.5 dark:border-[#334155] sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation dialog for destructive / high-impact actions (§5 rule 6).
 * Optional required reason and typed confirmation text.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'confirm',
  requireReason,
  reasonLabel = 'Reason',
  confirmText,
  busy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  requireReason?: boolean;
  reasonLabel?: string;
  /** User must type this exact text to enable the confirm button (e.g. RESTORE). */
  confirmText?: string;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTyped('');
      setTouched(false);
    }
  }, [open]);
  const reasonMissing = requireReason && !reason.trim();
  const textMismatch = confirmText !== undefined && typed !== confirmText;
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className={cn('h-5 w-5', variant === 'delete' ? 'text-red-600' : 'text-amber-500')} aria-hidden />
          {title}
        </span>
      }
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={variant}
            loading={busy}
            disabled={!!textMismatch}
            onClick={() => {
              setTouched(true);
              if (reasonMissing || textMismatch) return;
              void onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
        <div>{message}</div>
        {children}
        {requireReason && (
          <Textarea
            label={reasonLabel}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={touched && reasonMissing ? 'Reason is required.' : undefined}
            maxLength={1000}
          />
        )}
        {confirmText !== undefined && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="confirm-text">
              Type <span className="font-mono font-bold">{confirmText}</span> to confirm
            </label>
            <input
              id="confirm-text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
