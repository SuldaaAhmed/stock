'use client';

import { ClipboardList, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { OrderFormModal } from '@/components/OrderForm';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { Button } from '@/components/ui/Button';
import { Card, DataTable, EmptyState, LoadingBlock, PageHeader, Pagination, StatusBadge, Tabs } from '@/components/ui/Display';
import { FilterBar, SearchBox } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber } from '@/lib/format';
import { usePaging, useQuery } from '@/lib/hooks';
import type { Order, OrderStatus } from '@/lib/types';

export default function OrdersPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <OrdersContent />
    </Suspense>
  );
}

function OrdersContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [status, setStatus] = useState<'' | OrderStatus>((sp.get('status') as OrderStatus) ?? '');
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const customerId = sp.get('customerId') ?? undefined;

  useEffect(() => {
    if (sp.get('new') === '1') setCreating(true);
  }, [sp]);

  const q = useQuery((s) => api.orders.list({ page, pageSize, status: status || undefined, customerId, search: search || undefined, ...periodParams(period) }, s), [page, pageSize, status, search, period, customerId]);

  return (
    <>
      <PageHeader
        title="Customer Orders"
        description="Status is set automatically from deliveries: Pending → Partially Completed → Completed. Orders cannot be cancelled."
        actions={
          <Button variant="accent" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New order
          </Button>
        }
      />
      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs<'' | OrderStatus>
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            tabs={[
              { value: '', label: 'All' },
              { value: 'Pending', label: 'Pending' },
              { value: 'PartiallyCompleted', label: 'Partially Completed' },
              { value: 'Completed', label: 'Completed' },
            ]}
          />
        </div>
        <FilterBar
          onSubmit={() => {
            setSearch(term.trim());
            setPage(1);
          }}
        >
          <PeriodFilter
            value={period}
            onChange={(v) => {
              setPeriod(v);
              setPage(1);
            }}
          />
          <SearchBox value={term} onChange={setTerm} placeholder="Order number or customer…" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        <DataTable<Order>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/orders/${r.id}`)}
          empty={<EmptyState title="No orders found" message="Create an order, then deliver it from Stock Out or the order page." icon={<ClipboardList className="h-6 w-6" />} />}
          columns={[
            { key: 'number', header: 'Order No.', cell: (r) => <span className="font-mono font-medium text-[#0D9488]">{r.number}</span> },
            { key: 'customer', header: 'Customer', cell: (r) => <span className="font-medium">{r.customerName}</span> },
            { key: 'date', header: 'Order Date', cell: (r) => formatDate(r.orderDate) },
            { key: 'ordered', header: 'Ordered', align: 'right', cell: (r) => formatNumber(r.totalOrdered) },
            { key: 'delivered', header: 'Delivered', align: 'right', cell: (r) => formatNumber(r.totalDelivered) },
            {
              key: 'remaining',
              header: 'Remaining',
              align: 'right',
              cell: (r) => <span className={cn('font-semibold tabular-nums', r.totalRemaining > 0 && 'text-amber-600 dark:text-amber-400')}>{formatNumber(r.totalRemaining)}</span>,
            },
            {
              key: 'progress',
              header: 'Progress',
              cell: (r) => {
                const pct = r.totalOrdered ? Math.round((r.totalDelivered / r.totalOrdered) * 100) : 0;
                return (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-green-600' : 'bg-[#0D9488]')} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="text-xs text-slate-500">{pct}%</span>
                  </div>
                );
              },
            },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge value={r.status} /> },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>
      <OrderFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(o) => {
          setCreating(false);
          router.push(`/orders/${o.id}`);
        }}
      />
    </>
  );
}
