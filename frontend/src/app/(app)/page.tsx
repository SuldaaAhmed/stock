'use client';

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Package, RefreshCw, Undo2, AlertOctagon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, DataTable, EmptyState, ErrorState, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/ui/Display';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber, label } from '@/lib/format';
import { useQuery } from '@/lib/hooks';
import type { DashboardSummary } from '@/lib/types';

const TX_LINKS: Record<string, (id: string) => string> = {
  StockIn: (id) => `/stock-in?id=${id}`,
  StockOut: (id) => `/stock-out?id=${id}`,
  Return: (id) => `/returns?id=${id}`,
  Adjustment: (id) => `/adjustments?id=${id}`,
  Order: (id) => `/orders/${id}`,
};

/** Dashboard — exactly the eight selected indicators (Frontend §4.2). Values come from the Backend summary API. */
export default function DashboardPage() {
  const { data, error, loading, reload } = useQuery((s) => api.dashboard.summary(s), []);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={data ? `Overview for ${formatDate(data.date)} (Kenya time)` : 'Overview'}
        actions={
          <Button variant="outline" size="sm" onClick={reload} loading={loading && !!data} icon={<RefreshCw className="h-4 w-4" />}>
            Refresh
          </Button>
        }
      />
      {error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <LoadingBlock />
      ) : (
        <DashboardBody d={data} />
      )}
    </>
  );
}

function DashboardBody({ d }: { d: DashboardSummary }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Products" value={formatNumber(d.totalProducts)} sub={`${formatNumber(d.activeProducts)} active`} icon={<Package className="h-5 w-5" />} tone="teal" href="/inventory" />
        <StatCard label="Total Stock" value={`${formatNumber(d.totalAvailableStock)}`} sub="BOX available" icon={<Boxes className="h-5 w-5" />} tone="blue" href="/reports?type=current-stock" />
        <StatCard
          label="Low Stock Products"
          value={formatNumber(d.lowStockProducts)}
          sub={d.lowStockProducts ? 'At or below minimum' : 'All above minimum'}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={d.lowStockProducts ? 'amber' : 'green'}
          href="/reports?type=low-stock"
        />
        <StatCard label="Damaged Stock" value={formatNumber(d.totalDamagedStock)} sub="BOX in damaged stock" icon={<AlertOctagon className="h-5 w-5" />} tone="red" href="/damaged-stock" />
        <StatCard
          label="Today's Stock In"
          value={`${formatNumber(d.today.stockInQuantity)}`}
          sub={`BOX · ${d.today.stockInTransactions} transaction${d.today.stockInTransactions === 1 ? '' : 's'}`}
          icon={<ArrowDownToLine className="h-5 w-5" />}
          tone="green"
          href="/stock-in"
        />
        <StatCard
          label="Today's Stock Out"
          value={`${formatNumber(d.today.stockOutQuantity)}`}
          sub={`BOX · ${d.today.stockOutTransactions} transaction${d.today.stockOutTransactions === 1 ? '' : 's'}`}
          icon={<ArrowUpFromLine className="h-5 w-5" />}
          tone="purple"
          href="/stock-out"
        />
        <StatCard
          label="Today's Returns"
          value={`${formatNumber(d.today.returnsQuantity)}`}
          sub={`BOX · ${d.today.returnsGoodQuantity} good, ${d.today.returnsDamagedQuantity} damaged`}
          icon={<Undo2 className="h-5 w-5" />}
          tone="slate"
          href="/returns"
        />
        <LowStockAlert items={d.lowStockItems} total={d.lowStockProducts} />
      </div>

      <Card title="Recent Transactions" padded={false} actions={<Link href="/search" className="text-sm font-medium text-[#0D9488] hover:underline">Search all</Link>}>
        <DataTable
          rows={d.recentTransactions}
          rowKey={(r) => `${r.type}-${r.id}`}
          empty={<EmptyState title="No transactions yet" message="Posted stock movements will appear here." />}
          columns={[
            {
              key: 'number',
              header: 'Number',
              cell: (r) => (
                <Link href={TX_LINKS[r.type]?.(r.id) ?? '#'} className="font-mono font-medium text-[#0D9488] hover:underline">
                  {r.number}
                </Link>
              ),
            },
            { key: 'type', header: 'Transaction', cell: (r) => label(r.type) },
            { key: 'subtype', header: 'Type / Status', cell: (r) => <StatusBadge value={r.subtype} /> },
            { key: 'date', header: 'Date', cell: (r) => formatDate(r.businessDate) },
            { key: 'created', header: 'Recorded', cell: (r) => <span className="text-slate-500 dark:text-slate-400">{formatDateTime(r.createdAt)}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

/** Low-stock alert: Product Name, Current Quantity, Minimum Quantity; clears automatically when restocked. */
function LowStockAlert({ items, total }: { items: DashboardSummary['lowStockItems']; total: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/60">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Low-Stock Alerts</p>
        {total > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{total}</span>}
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-sm text-green-700 dark:text-green-400">No low-stock products. All items are above their minimum.</p>
      ) : (
        <ul className="max-h-40 space-y-2 overflow-y-auto pr-1">
          {items.map((i) => (
            <li key={i.productId} className="flex items-center justify-between gap-2 text-sm">
              <Link href={`/inventory/${i.productId}`} className="min-w-0 truncate font-medium text-slate-800 hover:text-[#0D9488] dark:text-slate-100">
                {i.productName}
              </Link>
              <span className="shrink-0 tabular-nums text-xs">
                <span className="font-semibold text-red-600 dark:text-red-400">{formatNumber(i.currentStock)}</span>
                <span className="text-slate-400"> / min {formatNumber(i.minimumStock)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
