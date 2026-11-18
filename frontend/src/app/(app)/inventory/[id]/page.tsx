'use client';

import { ArrowLeft, Pencil, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { OpeningStockModal, ProductEditModal } from '@/components/ProductForms';
import { ChangeList } from '@/components/ChangeList';
import { FilterSelect } from '@/components/ui/Field';
import { ReceiptButtons } from '@/components/Receipt';
import { Button } from '@/components/ui/Button';
import { Badge, Card, DataTable, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge, Tabs } from '@/components/ui/Display';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatMoney, formatNumber, label } from '@/lib/format';
import { usePaging, useQuery } from '@/lib/hooks';
import { resourceHref } from '@/lib/links';
import type { ProductDetail } from '@/lib/types';

type Tab = 'movements' | 'edits' | 'prices' | 'opening' | 'damaged';

const MOVEMENT_TYPES = [
  'OpeningStock',
  'OpeningStockCorrection',
  'StockInNew',
  'StockInTransfer',
  'GoodReturn',
  'DamagedReturn',
  'AdjustmentIn',
  'AdjustmentOut',
  'StockOutDelivery',
  'StockOutSample',
  'StockOutGift',
  'StockOutTransfer',
  'MarkAsGood',
  'RemoveFromDamaged',
];

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('movements');
  const [editing, setEditing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [version, setVersion] = useState(0);
  const q = useQuery((s) => api.products.get(id, s), [id, version]);
  const refresh = () => setVersion((v) => v + 1);
  const p = q.data;

  const back = (
    <Link href="/inventory" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#0D9488] dark:text-slate-400">
      <ArrowLeft className="h-4 w-4" /> Inventory
    </Link>
  );

  if (q.error && !p)
    return (
      <>
        <PageHeader title="Product" back={back} />
        <Card>
          <ErrorState error={q.error} onRetry={q.reload} />
        </Card>
      </>
    );
  if (!p) return <LoadingBlock />;

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} <StatusBadge value={p.status} /> {p.isLowStock && <Badge tone="amber">Low stock</Badge>}
          </span>
        }
        description={`Selling price: ${p.sellingPrice === null ? 'not set' : formatMoney(p.sellingPrice)} · Minimum stock: ${formatNumber(p.minimumStock)} BOX`}
        actions={
          <>
            <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setCorrecting(true)}>
              Correct opening stock
            </Button>
            <Button variant="edit" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Edit product
            </Button>
          </>
        }
      />
      <SummaryCards p={p} />

      <Card className="mt-6" padded={false}>
        <div className="px-4 pt-2">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'movements', label: 'Stock history' },
              { value: 'damaged', label: 'Damaged stock history' },
              { value: 'edits', label: 'Edit history' },
              { value: 'prices', label: 'Price history' },
              { value: 'opening', label: 'Opening stock corrections' },
            ]}
          />
        </div>
        {tab === 'movements' && <MovementsTab productId={id} version={version} />}
        {tab === 'damaged' && <DamagedTab p={p} />}
        {tab === 'edits' && <EditsTab productId={id} version={version} />}
        {tab === 'prices' && <PricesTab productId={id} version={version} />}
        {tab === 'opening' && <OpeningTab productId={id} version={version} />}
      </Card>

      <ProductEditModal
        product={editing ? p : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          refresh();
        }}
      />
      <OpeningStockModal
        product={correcting ? p : null}
        onClose={() => setCorrecting(false)}
        onSaved={() => {
          setCorrecting(false);
          refresh();
        }}
      />
    </>
  );
}

function SummaryCards({ p }: { p: ProductDetail }) {
  const s = p.summary;
  const tiles: { label: string; value: number; sub?: string; tone?: string }[] = [
    { label: 'Opening Stock', value: s.effectiveOpeningStock, sub: s.effectiveOpeningStock !== p.openingStock ? `Original ${formatNumber(p.openingStock)}` : undefined },
    { label: 'Stock In', value: s.stockIn, sub: `New ${formatNumber(s.stockInNew)} · Transfer ${formatNumber(s.stockInTransfer)}` },
    { label: 'Stock Out', value: s.stockOut, sub: `Delivery ${formatNumber(s.stockOutDelivery)} · Sample/Gift ${formatNumber(s.stockOutSample + s.stockOutGift)} · Transfer ${formatNumber(s.stockOutTransfer)}` },
    { label: 'Customer Returns', value: s.goodReturns + s.damagedReturns, sub: `Good ${formatNumber(s.goodReturns)} · Damaged ${formatNumber(s.damagedReturns)}` },
    { label: 'Adjustments', value: s.adjustmentIn - s.adjustmentOut, sub: `In +${formatNumber(s.adjustmentIn)} · Out −${formatNumber(s.adjustmentOut)}` },
    { label: 'Current Stock', value: s.currentStock, sub: 'Available BOX', tone: p.isLowStock ? 'text-red-600 dark:text-red-400' : 'text-[#0D9488] dark:text-teal-300' },
    { label: 'Damaged Stock', value: s.damagedStock, sub: `Marked good ${formatNumber(s.markedAsGood)} · Removed ${formatNumber(s.removedFromDamaged)}`, tone: s.damagedStock ? 'text-red-600 dark:text-red-400' : undefined },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/60">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.label}</p>
          <p className={cn('mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white', t.tone)}>{t.label === 'Adjustments' && t.value > 0 ? '+' : ''}{formatNumber(t.value)}</p>
          {t.sub && <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function Delta({ n }: { n: number }) {
  if (!n) return <span className="text-slate-400">0</span>;
  return <span className={n > 0 ? 'font-medium text-green-700 dark:text-green-400' : 'font-medium text-red-600 dark:text-red-400'}>{n > 0 ? `+${formatNumber(n)}` : `−${formatNumber(-n)}`}</span>;
}

function MovementsTab({ productId, version }: { productId: string; version: number }) {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [type, setType] = useState('');
  const q = useQuery((s) => api.products.movements(productId, { page, pageSize, type: type || undefined, ...periodParams(period) }, s), [productId, page, pageSize, type, period, version]);
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
        <PeriodFilter
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Movement type"
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          options={[{ value: '', label: 'All types' }, ...MOVEMENT_TYPES.map((t) => ({ value: t, label: label(t) }))]}
        />
      </div>
      <DataTable
        rows={q.data?.data}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        rowKey={(r) => r.id}
        columns={[
          { key: 'date', header: 'Date', cell: (r) => formatDate(r.businessDate) },
          {
            key: 'type',
            header: 'Movement',
            cell: (r) => (
              <span className="flex items-center gap-1.5">
                {label(r.movementType)}
                {r.isReversal && <Badge tone="gray">Reversal</Badge>}
              </span>
            ),
          },
          {
            key: 'ref',
            header: 'Reference',
            cell: (r) => {
              const href = resourceHref(r.sourceType, r.sourceId);
              const text = r.sourceNumber ? `${r.sourceNumber}${r.sourceVersion > 1 ? ` v${r.sourceVersion}` : ''}` : r.sourceType === 'Product' ? 'Product creation' : label(r.sourceType);
              if (r.sourceType === 'Product' || r.sourceType === 'OpeningStockCorrection') return <span className="text-slate-500">{text}</span>;
              return href ? (
                <Link href={href} className="font-mono text-[#0D9488] hover:underline">
                  {text}
                </Link>
              ) : (
                <span className="text-slate-500">{text}</span>
              );
            },
          },
          { key: 'avail', header: 'Available Δ', align: 'right', cell: (r) => <Delta n={r.availableDelta} /> },
          { key: 'availAfter', header: 'Available After', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{formatNumber(r.availableAfter)}</span> },
          { key: 'dmg', header: 'Damaged Δ', align: 'right', cell: (r) => <Delta n={r.damagedDelta} /> },
          { key: 'dmgAfter', header: 'Damaged After', align: 'right', cell: (r) => formatNumber(r.damagedAfter) },
          { key: 'admin', header: 'Admin', cell: (r) => r.admin ?? '—' },
          { key: 'at', header: 'Recorded', cell: (r) => <span className="text-slate-500 dark:text-slate-400">{formatDateTime(r.createdAt)}</span> },
        ]}
      />
      <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}

function DamagedTab({ p }: { p: ProductDetail }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4 text-sm dark:border-slate-700">
        <span className="text-slate-600 dark:text-slate-300">
          Current damaged stock: <span className="font-semibold">{formatNumber(p.damagedStock)} BOX</span>
        </span>
        <Link href={`/damaged-stock?productId=${p.id}`} className="font-medium text-[#0D9488] hover:underline">
          Manage damaged stock →
        </Link>
      </div>
      <DataTable
        rows={p.damagedHistory}
        rowKey={(r, i) => `${r.sourceId}-${i}`}
        columns={[
          { key: 'date', header: 'Date', cell: (r) => formatDate(r.businessDate) },
          { key: 'event', header: 'Event', cell: (r) => <StatusBadge value={r.eventType} /> },
          { key: 'qty', header: 'Quantity', align: 'right', cell: (r) => <Delta n={r.eventType === 'DamagedReturn' ? r.quantity : -r.quantity} /> },
          {
            key: 'ref',
            header: 'Reference',
            cell: (r) => {
              const href = resourceHref(r.eventType === 'DamagedReturn' ? 'Return' : 'DamagedStockAction', r.sourceId);
              return href ? (
                <Link href={href} className="font-mono text-[#0D9488] hover:underline">
                  {r.referenceNumber ?? 'View'}
                </Link>
              ) : (
                r.referenceNumber ?? '—'
              );
            },
          },
          { key: 'reason', header: 'Reason', cell: (r) => <span className="whitespace-normal">{r.reason ?? '—'}</span>, className: 'min-w-[12rem]' },
          { key: 'receipt', header: 'Receipt', cell: (r) => (r.receiptId ? <ReceiptButtons receiptId={r.receiptId} receiptNumber={null} /> : <span className="text-slate-400">—</span>) },
        ]}
      />
    </>
  );
}

function EditsTab({ productId, version }: { productId: string; version: number }) {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const q = useQuery((s) => api.products.editHistory(productId, { page, pageSize }, s), [productId, page, pageSize, version]);
  return (
    <>
      <DataTable
        rows={q.data?.data}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        rowKey={(r) => r.id}
        columns={[
          { key: 'at', header: 'Date & Time', cell: (r) => formatDateTime(r.createdAt) },
          { key: 'changes', header: 'Changes (old → new)', cell: (r) => <ChangeList item={r} />, className: 'min-w-[16rem]' },
          { key: 'reason', header: 'Reason', cell: (r) => <span className="whitespace-normal">{r.reason ?? '—'}</span>, className: 'min-w-[12rem]' },
          { key: 'admin', header: 'Admin', cell: (r) => r.admin ?? '—' },
        ]}
      />
      <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}

function PricesTab({ productId, version }: { productId: string; version: number }) {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const q = useQuery((s) => api.products.priceHistory(productId, { page, pageSize }, s), [productId, page, pageSize, version]);
  return (
    <>
      <DataTable
        rows={q.data?.data}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        rowKey={(r) => r.id}
        columns={[
          { key: 'at', header: 'Date & Time', cell: (r) => formatDateTime(r.createdAt) },
          { key: 'old', header: 'Old Price', align: 'right', cell: (r) => formatMoney(r.oldPrice) },
          { key: 'new', header: 'New Price', align: 'right', cell: (r) => <span className="font-semibold">{formatMoney(r.newPrice)}</span> },
          { key: 'reason', header: 'Reason', cell: (r) => <span className="whitespace-normal">{r.reason ?? '—'}</span> },
          { key: 'admin', header: 'Admin', cell: (r) => r.admin ?? '—' },
        ]}
      />
      <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}

function OpeningTab({ productId, version }: { productId: string; version: number }) {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const q = useQuery((s) => api.products.openingStockCorrections(productId, { page, pageSize }, s), [productId, page, pageSize, version]);
  return (
    <>
      <DataTable
        rows={q.data?.data}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        rowKey={(r) => r.id}
        columns={[
          { key: 'at', header: 'Date & Time', cell: (r) => formatDateTime(r.createdAt) },
          { key: 'prev', header: 'Previous', align: 'right', cell: (r) => formatNumber(r.previousEffectiveOpeningStock) },
          { key: 'new', header: 'New', align: 'right', cell: (r) => <span className="font-semibold">{formatNumber(r.newEffectiveOpeningStock)}</span> },
          { key: 'delta', header: 'Change', align: 'right', cell: (r) => <Delta n={r.delta} /> },
          { key: 'reason', header: 'Reason', cell: (r) => <span className="whitespace-normal">{r.reason}</span> },
          { key: 'admin', header: 'Admin', cell: (r) => r.admin ?? '—' },
        ]}
      />
      <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}

