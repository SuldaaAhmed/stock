'use client';

import { ChevronRight, FileText, Search as SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { PdfPreviewModal } from '@/components/Receipt';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '@/components/ui/Display';
import { FilterSelect, inputClass } from '@/components/ui/Field';
import { urls } from '@/lib/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, label } from '@/lib/format';
import { useQuery } from '@/lib/hooks';
import { resourceHref } from '@/lib/links';
import type { SearchResult } from '@/lib/types';

const TYPES = ['Product', 'Customer', 'Order', 'Receipt', 'StockIn', 'StockOut', 'Return', 'Adjustment', 'Transfer'];
const TONES: Record<string, 'teal' | 'blue' | 'purple' | 'amber' | 'green' | 'red' | 'gray'> = {
  Product: 'teal',
  Customer: 'blue',
  Order: 'purple',
  Receipt: 'gray',
  StockIn: 'green',
  StockOut: 'amber',
  Return: 'red',
  Adjustment: 'blue',
  Transfer: 'amber',
};

export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SearchContent />
    </Suspense>
  );
}

interface Submitted {
  q: string;
  type: string;
  period: PeriodValue;
  page: number;
}

function SearchContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const urlQ = sp.get('q') ?? '';
  const [term, setTerm] = useState(urlQ);
  const [type, setType] = useState(sp.get('type') ?? '');
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [submitted, setSubmitted] = useState<Submitted | null>(urlQ ? { q: urlQ, type: sp.get('type') ?? '', period: { period: '' }, page: 1 } : null);
  const receiptId = sp.get('receipt');

  // Header search navigates here with ?q= — run that search (submission already happened on Enter).
  useEffect(() => {
    if (urlQ) {
      setTerm(urlQ);
      setSubmitted((s) => (s && s.q === urlQ ? s : { q: urlQ, type, period, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  const q = useQuery(
    (s) => api.search({ search: submitted!.q, type: submitted!.type || undefined, page: submitted!.page, pageSize: 10, ...periodParams(submitted!.period) }, s),
    [submitted],
    { enabled: !!submitted && submitted.q.length > 0, keepPrevious: false },
  );

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = term.trim();
    if (!t) return;
    setSubmitted({ q: t, type, period, page: 1 });
    const qs = new URLSearchParams({ q: t });
    if (type) qs.set('type', type);
    router.replace(`/search?${qs.toString()}`, { scroll: false });
  };

  return (
    <>
      <PageHeader title="Global Search" description="Search products, customers, orders, receipts and transaction numbers. Press Enter or click Search." />
      <Card className="mb-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                autoFocus
                aria-label="Search term"
                className={cn(inputClass, 'h-12 pl-11 text-base')}
                placeholder="e.g. ORD-0001, Mango, Amina, REC-0003…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                maxLength={200}
              />
            </div>
            <Button type="submit" variant="accent" size="lg" icon={<SearchIcon className="h-4 w-4" />} disabled={!term.trim()}>
              Search
            </Button>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <PeriodFilter value={period} onChange={setPeriod} label="Date" />
            <FilterSelect label="Record type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...TYPES.map((t) => ({ value: t, label: label(t) }))]} />
            <p className="text-xs text-slate-500 dark:text-slate-400 md:pb-3">Filters apply when you search.</p>
          </div>
        </form>
      </Card>

      {!submitted ? (
        <Card>
          <EmptyState title="Start searching" message="Type a product, customer, order, receipt or transaction number, then press Enter." icon={<SearchIcon className="h-6 w-6" />} />
        </Card>
      ) : (
        <Card padded={false} title={q.data ? `${q.data.meta.totalItems} result${q.data.meta.totalItems === 1 ? '' : 's'} for “${submitted.q}”` : `Searching “${submitted.q}”…`}>
          {q.error ? (
            <ErrorState error={q.error} onRetry={q.reload} />
          ) : !q.data ? (
            <LoadingBlock />
          ) : q.data.data.length === 0 ? (
            <EmptyState title="No results found" message="Try a different term, record type or date range." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {q.data.data.map((r) => (
                <ResultRow key={`${r.resourceType}-${r.id}`} r={r} />
              ))}
            </ul>
          )}
          <Pagination meta={q.data?.meta} onPage={(p) => setSubmitted((s) => (s ? { ...s, page: p } : s))} />
        </Card>
      )}

      <PdfPreviewModal
        open={!!receiptId}
        onClose={() => {
          const qs = new URLSearchParams(sp.toString());
          qs.delete('receipt');
          router.replace(`/search${qs.toString() ? `?${qs}` : ''}`, { scroll: false });
        }}
        src={receiptId ? urls.receiptPdf(receiptId, 'inline') : ''}
        downloadHref={receiptId ? urls.receiptPdf(receiptId, 'attachment') : undefined}
        title="Receipt"
      />
    </>
  );
}

function ResultRow({ r }: { r: SearchResult }) {
  const href = resourceHref(r.resourceType, r.id) ?? '#';
  return (
    <li>
      <Link href={href} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <Badge tone={TONES[r.resourceType] ?? 'gray'} className="w-24 justify-center">
          {label(r.resourceType)}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900 dark:text-white">
            {r.resourceType === 'Receipt' && <FileText className="mr-1 inline h-4 w-4 text-slate-400" />}
            {r.display}
          </p>
          {r.subtitle && <p className="truncate text-sm text-slate-500 dark:text-slate-400">{r.subtitle.split(' · ').map((p) => label(p)).join(' · ')}</p>}
        </div>
        {r.date && <span className="hidden text-sm text-slate-500 sm:block">{formatDate(r.date)}</span>}
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </Link>
    </li>
  );
}
