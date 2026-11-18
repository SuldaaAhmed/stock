'use client';

import { humanize } from '@/lib/format';

/** Renders old → new values of an edit-history entry. */
export function ChangeList({ item }: { item: { oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null } }) {
  const keys = Array.from(new Set([...Object.keys(item.oldValues ?? {}), ...Object.keys(item.newValues ?? {})]));
  const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (!keys.length) return <span className="text-slate-400">—</span>;
  return (
    <ul className="space-y-0.5 whitespace-normal">
      {keys.map((k) => (
        <li key={k} className="text-xs">
          <span className="font-medium text-slate-600 dark:text-slate-300">{humanize(k)}:</span>{' '}
          <span className="text-red-600 line-through decoration-red-300 dark:text-red-400">{fmt(item.oldValues?.[k])}</span>
          <span className="mx-1 text-slate-400">→</span>
          <span className="text-green-700 dark:text-green-400">{fmt(item.newValues?.[k])}</span>
        </li>
      ))}
    </ul>
  );
}
