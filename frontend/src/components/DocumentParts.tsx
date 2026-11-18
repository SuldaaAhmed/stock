'use client';

import { History } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { cn } from '@/lib/cn';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { VersionRef } from '@/lib/types';
import { Alert, Badge } from './ui/Display';

/** `?id=` deep-link for detail dialogs on list pages (used by Global Search and dashboard links). */
export function useDetailParam(param = 'id'): [string | null, (id: string) => void, () => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = sp.get(param);
  const set = useCallback(
    (value: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set(param, value);
      else next.delete(param);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname, param],
  );
  return [id, (v: string) => set(v), () => set(null)];
}

/** Version trail of a corrected document (same number, incremented version; old versions Superseded). */
export function VersionsList({ versions, currentId, onSelect }: { versions?: VersionRef[]; currentId: string; onSelect: (id: string) => void }) {
  if (!versions || versions.length <= 1) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <History className="h-3.5 w-3.5" /> Version history
      </p>
      <ol className="flex flex-wrap gap-2">
        {[...versions]
          .sort((a, b) => b.version - a.version)
          .map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                  v.id === currentId
                    ? 'border-[#0D9488] bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <span className="font-semibold">v{v.version}</span>
                <Badge tone={v.status === 'Posted' ? 'green' : 'gray'}>{v.status === 'Posted' ? 'Current' : 'Superseded'}</Badge>
                <span className="text-slate-400">{formatDateTime(v.createdAt)}</span>
              </button>
            </li>
          ))}
      </ol>
    </div>
  );
}

export function SupersededNotice({ status, correctionReason, version }: { status: string; correctionReason?: string | null; version: number }) {
  return (
    <>
      {status === 'Superseded' && (
        <Alert tone="warning" title="Superseded version">
          This version was replaced by a correction. It is kept for history and no longer affects stock.
        </Alert>
      )}
      {version > 1 && correctionReason && (
        <Alert tone="info" title={`Correction (version ${version})`}>
          Reason: {correctionReason}
        </Alert>
      )}
    </>
  );
}

/** Read-only product lines table for document details. */
export function LinesTable({ lines, extra }: { lines: { id?: string; productName: string; quantity: number; condition?: string }[]; extra?: 'condition' }) {
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">#</th>
            <th className="px-3 py-2 text-left font-semibold">Product</th>
            {extra === 'condition' && <th className="px-3 py-2 text-left font-semibold">Condition</th>}
            <th className="px-3 py-2 text-right font-semibold">Quantity (BOX)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="text-slate-700 dark:text-slate-200">
              <td className="px-3 py-2 text-slate-400">{i + 1}</td>
              <td className="px-3 py-2 font-medium">{l.productName}</td>
              {extra === 'condition' && (
                <td className="px-3 py-2">
                  <Badge tone={l.condition === 'Damaged' ? 'red' : 'green'}>{l.condition}</Badge>
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/30">
          <tr>
            <td colSpan={extra === 'condition' ? 3 : 2} className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
              Total
            </td>
            <td className="px-3 py-2 text-right font-bold tabular-nums">{formatNumber(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
