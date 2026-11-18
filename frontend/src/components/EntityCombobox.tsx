'use client';

import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber, label as enumLabel } from '@/lib/format';
import type { Customer, Order, Product } from '@/lib/types';
import { inputClass, Label, FieldError } from './ui/Field';

export interface Option<T> {
  id: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
  raw: T;
}

/**
 * Searchable server-backed select (keyboard accessible).
 * Queries the Backend with `search` (debounced) so large lists never need to be loaded entirely.
 */
export function EntityCombobox<T>({
  value,
  onChange,
  load,
  placeholder = 'Search…',
  label,
  required,
  error,
  disabled,
  initialLabel,
  className,
  clearable,
  id,
  labelClassName,
}: {
  value: string | null;
  onChange: (opt: Option<T> | null) => void;
  load: (search: string, signal: AbortSignal) => Promise<Option<T>[]>;
  placeholder?: string;
  label?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  initialLabel?: string;
  className?: string;
  clearable?: boolean;
  id?: string;
  labelClassName?: string;
}) {
  const autoId = useId();
  const fid = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Option<T>[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? '');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!value) setSelectedLabel('');
    else if (initialLabel) setSelectedLabel(initialLabel);
  }, [value, initialLabel]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(false);
    const t = setTimeout(() => {
      loadRef
        .current(term.trim(), ctrl.signal)
        .then((opts) => {
          if (!ctrl.signal.aborted) {
            setOptions(opts);
            setActive(Math.max(0, opts.findIndex((o) => !o.disabled)));
          }
        })
        .catch((e) => {
          if (!ctrl.signal.aborted && (e as Error)?.name !== 'AbortError') setLoadError(true);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const choose = (o: Option<T>) => {
    if (o.disabled) return;
    setSelectedLabel(o.label);
    onChange(o);
    setOpen(false);
    setTerm('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active]) choose(options[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const listId = `${fid}-list`;
  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {label && (
        <Label htmlFor={fid} required={required} className={labelClassName}>
          {label}
        </Label>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          ref={inputRef}
          id={fid}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={!!error || undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? term : selectedLabel}
          placeholder={selectedLabel || placeholder}
          onChange={(e) => {
            setTerm(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(inputClass, 'pl-9 pr-14', error && 'border-red-500', open && selectedLabel && 'placeholder:text-slate-700 dark:placeholder:text-slate-200')}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {clearable && value && !disabled && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setSelectedLabel('');
              }}
              className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronsUpDown className="h-4 w-4 text-slate-400" aria-hidden />
        </div>
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[16rem] overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl dark:border-slate-600 dark:bg-slate-800"
        >
          {loading && (
            <li className="flex items-center gap-2 px-3 py-2.5 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </li>
          )}
          {!loading && loadError && <li className="px-3 py-2.5 text-red-600">Could not load options.</li>}
          {!loading && !loadError && options.length === 0 && <li className="px-3 py-2.5 text-slate-500">No matches</li>}
          {!loading &&
            options.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === value}
                aria-disabled={o.disabled || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-start justify-between gap-2 px-3 py-2',
                  i === active && 'bg-teal-50 dark:bg-slate-700',
                  o.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{o.label}</span>
                  {o.sublabel && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{o.sublabel}</span>}
                </span>
                {o.id === value && <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0D9488]" />}
              </li>
            ))}
        </ul>
      )}
      <FieldError message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset loaders
// ---------------------------------------------------------------------------
export function productLoader(opts: { activeOnly?: boolean; withDamaged?: boolean } = {}) {
  return async (search: string, signal: AbortSignal): Promise<Option<Product>[]> => {
    const r = await api.products.list({ search: search || undefined, pageSize: 25, status: opts.activeOnly ? 'Active' : undefined }, signal);
    return r.data.map((p) => ({
      id: p.id,
      label: p.name,
      sublabel:
        `Available: ${formatNumber(p.availableStock)} BOX` +
        (opts.withDamaged ? ` · Damaged: ${formatNumber(p.damagedStock)} BOX` : '') +
        (p.status === 'Inactive' ? ' · Inactive' : ''),
      raw: p,
    }));
  };
}

export async function loadCustomers(search: string, signal: AbortSignal): Promise<Option<Customer>[]> {
  const r = await api.customers.list({ search: search || undefined, pageSize: 25 }, signal);
  return r.data.map((c) => ({ id: c.id, label: c.fullName, sublabel: [c.phone, c.location].filter(Boolean).join(' · ') || undefined, raw: c }));
}

export function orderLoader(statuses: string[]) {
  return async (search: string, signal: AbortSignal): Promise<Option<Order>[]> => {
    const lists = await Promise.all(statuses.map((s) => api.orders.list({ search: search || undefined, status: s, pageSize: 25 }, signal)));
    return lists
      .flatMap((l) => l.data)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((o) => ({
        id: o.id,
        label: `${o.number} — ${o.customerName}`,
        sublabel: `${enumLabel(o.status)} · ${formatDate(o.orderDate)} · Ordered ${o.totalOrdered}, delivered ${o.totalDelivered}`,
        raw: o,
      }));
  };
}
