import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

/** Before → After quantity display (preview uses Backend-reported current stock; the saved result comes from the Backend). */
export function BeforeAfter({ label, before, after, preview }: { label: string; before: number | null | undefined; after: number | null | undefined; preview?: boolean }) {
  const invalid = after !== null && after !== undefined && after < 0;
  return (
    <div className={cn('rounded-xl border p-3', invalid ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40')}>
      <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
        {preview && <span className="ml-1 font-normal">(preview)</span>}
      </p>
      <div className="flex items-center gap-3 text-lg font-bold tabular-nums">
        <span className="text-slate-700 dark:text-slate-200">{before === null || before === undefined ? '—' : formatNumber(before)}</span>
        <ArrowRight className="h-4 w-4 text-slate-400" />
        <span className={invalid ? 'text-red-600' : 'text-[#0D9488] dark:text-teal-300'}>{after === null || after === undefined ? '—' : formatNumber(after)}</span>
        <span className="text-xs font-medium text-slate-400">BOX</span>
      </div>
      {invalid && <p className="mt-1 text-xs font-medium text-red-600">Quantity exceeds the current stock.</p>}
    </div>
  );
}
