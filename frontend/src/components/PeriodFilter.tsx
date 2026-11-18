'use client';

import { todayNairobi } from '@/lib/format';
import type { Period } from '@/lib/types';
import { inputClass } from './ui/Field';

export interface PeriodValue {
  period: Period | '';
  date?: string;
  from?: string;
  to?: string;
}

/** Converts a PeriodValue into Backend query params (period/date/from/to). */
export function periodParams(v: PeriodValue): { period?: Period; date?: string; from?: string; to?: string } {
  if (!v.period) return {};
  if (v.period === 'custom') return v.from && v.to ? { period: 'custom', from: v.from, to: v.to } : {};
  return { period: v.period, date: v.date || undefined };
}

/** Day / Week (Mon–Sun) / Month / Custom range filter on the Nairobi calendar. */
export function PeriodFilter({ value, onChange, allowAll = true, label = 'Period' }: { value: PeriodValue; onChange: (v: PeriodValue) => void; allowAll?: boolean; label?: string }) {
  const today = todayNairobi();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
        <select
          className={inputClass + ' w-40'}
          value={value.period}
          onChange={(e) => {
            const p = e.target.value as Period | '';
            onChange(p === 'custom' ? { period: p, from: value.from ?? today, to: value.to ?? today } : { period: p, date: p ? value.date ?? today : undefined });
          }}
        >
          {allowAll && <option value="">All dates</option>}
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="custom">Custom range</option>
        </select>
      </label>
      {(value.period === 'day' || value.period === 'week' || value.period === 'month') && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">{value.period === 'day' ? 'Date' : value.period === 'week' ? 'Week of' : 'Month of'}</span>
          <input type="date" className={inputClass + ' w-44'} value={value.date ?? today} max={today} onChange={(e) => onChange({ ...value, date: e.target.value })} />
        </label>
      )}
      {value.period === 'custom' && (
        <>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">From</span>
            <input type="date" className={inputClass + ' w-44'} value={value.from ?? ''} max={value.to || today} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">To</span>
            <input type="date" className={inputClass + ' w-44'} value={value.to ?? ''} min={value.from} max={today} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </label>
        </>
      )}
    </div>
  );
}
