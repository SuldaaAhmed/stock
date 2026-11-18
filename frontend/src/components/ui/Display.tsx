'use client';

import Link from 'next/link';
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { label as enumLabel } from '@/lib/format';
import type { PageMeta } from '@/lib/types';
import { Button } from './Button';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions, padded = true }: { children: React.ReactNode; className?: string; title?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-800/60', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700/80">
          {title && <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(padded && 'p-5')}>{children}</div>
    </section>
  );
}

/** Key/value list used in detail views. */
export function DetailGrid({ items, cols = 3 }: { items: { label: string; value: React.ReactNode; hidden?: boolean }[]; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4', c)}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{i.label}</dt>
            <dd className="mt-1 break-words text-sm text-slate-900 dark:text-slate-100">{i.value ?? '—'}</dd>
          </div>
        ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'teal' | 'purple';
const TONES: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700/60 dark:text-slate-200 dark:ring-slate-600',
  green: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-800',
  red: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800',
};
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  Active: 'green',
  Inactive: 'gray',
  Pending: 'amber',
  PartiallyCompleted: 'blue',
  Completed: 'green',
  Posted: 'green',
  Superseded: 'gray',
  Succeeded: 'green',
  Failed: 'red',
  Running: 'blue',
  Good: 'green',
  Damaged: 'red',
  Increase: 'green',
  Decrease: 'red',
  MarkAsGood: 'green',
  RemoveFromDamaged: 'red',
  DamagedReturn: 'amber',
  NewStock: 'teal',
  WarehouseTransferIn: 'purple',
  CustomerDelivery: 'blue',
  Sample: 'amber',
  Gift: 'purple',
  WarehouseTransfer: 'teal',
  AgainstOrder: 'blue',
  Direct: 'purple',
  Manual: 'blue',
  Automatic: 'teal',
  PreRestore: 'amber',
  Backup: 'teal',
  Restore: 'purple',
};
export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return null;
  return (
    <Badge tone={STATUS_TONES[value] ?? 'gray'} className={className}>
      {enumLabel(value)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-[#0D9488]', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400', className)} role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({ title = 'No records found', message, action, icon }: { title?: string; message?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-slate-700/50">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 text-center', compact ? 'py-6' : 'py-12')} role="alert">
      <div className="mb-3 rounded-full bg-red-50 p-3 text-red-600 dark:bg-red-900/30">
        <AlertCircle className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Could not load data</p>
      <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; children?: React.ReactNode; className?: string }) {
  const s = {
    info: 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF] dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-200',
    warning: 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E] dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200',
    error: 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B] dark:bg-red-950/40 dark:border-red-900 dark:text-red-200',
    success: 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534] dark:bg-green-950/40 dark:border-green-900 dark:text-green-200',
  }[tone];
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm', s, className)} role={tone === 'error' ? 'alert' : undefined}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5', 'opacity-95')}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
}

/**
 * Responsive data table: horizontal scroll on narrow screens (no essential data hidden),
 * built-in loading / error / empty states.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  dense,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  dense?: boolean;
  caption?: string;
}) {
  if (error && !rows?.length) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <LoadingBlock />;
  if (!rows?.length) return <>{empty ?? <EmptyState />}</>;
  const pad = dense ? 'px-3 py-2' : 'px-4 py-3';
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  return (
    <div className={cn('relative overflow-x-auto', loading && 'opacity-60 transition-opacity')}>
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-slate-50 dark:bg-slate-900/40">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(pad, 'whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400', align(c.align), c.headerClassName)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter') onRowClick(r);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                'text-slate-700 dark:text-slate-200',
                onRowClick && 'cursor-pointer hover:bg-teal-50/60 focus:bg-teal-50/60 focus:outline-none dark:hover:bg-slate-700/40 dark:focus:bg-slate-700/40',
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn(pad, 'whitespace-nowrap', align(c.align), c.className)}>
                  {c.cell(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination (Next / Previous, page size)
// ---------------------------------------------------------------------------
export function Pagination({
  meta,
  onPage,
  onPageSize,
  pageSizes = [10, 25, 50, 100],
}: {
  meta: PageMeta | undefined;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
  pageSizes?: number[];
}) {
  if (!meta) return null;
  const from = meta.totalItems === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.totalItems);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400 sm:flex-row print:hidden">
      <p>
        Showing <span className="font-medium text-slate-900 dark:text-slate-200">{from}</span>–<span className="font-medium text-slate-900 dark:text-slate-200">{to}</span> of{' '}
        <span className="font-medium text-slate-900 dark:text-slate-200">{meta.totalItems}</span>
      </p>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only sm:not-sr-only">Rows</span>
            <select
              value={meta.pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              aria-label="Rows per page"
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button variant="outline" size="sm" disabled={!meta.hasPrevious} onClick={() => onPage(meta.page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
          Previous
        </Button>
        <span className="px-1 tabular-nums">
          {meta.page} / {Math.max(1, meta.totalPages)}
        </span>
        <Button variant="outline" size="sm" disabled={!meta.hasNext} onClick={() => onPage(meta.page + 1)}>
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mb-px flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            'whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800',
            t.value === value
              ? 'border-[#0D9488] text-[#0D9488] dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Stat card used on the Dashboard and detail summaries. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'teal',
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'teal' | 'blue' | 'amber' | 'red' | 'green' | 'purple' | 'slate';
  href?: string;
}) {
  const tones = {
    teal: 'bg-teal-50 text-[#0D9488] dark:bg-teal-900/30 dark:text-teal-300',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
    green: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  }[tone];
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
      {icon && <div className={cn('shrink-0 rounded-xl p-2.5', tones)}>{icon}</div>}
    </div>
  );
  const cls = 'block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/60';
  if (href)
    return (
      <Link href={href} className={cn(cls, 'transition hover:border-teal-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] dark:hover:border-teal-700')}>
        {inner}
      </Link>
    );
  return <div className={cls}>{inner}</div>;
}
