'use client';

import { AlertOctagon, AlertTriangle, ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Boxes, ClipboardList, Eye, FileDown, Gift, ImageDown, Printer, SlidersHorizontal, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { EntityCombobox, loadCustomers, productLoader } from '@/components/EntityCombobox';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { PdfPreviewModal } from '@/components/Receipt';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, DataTable, EmptyState, PageHeader, Pagination, type Column } from '@/components/ui/Display';
import { FilterBar, FilterSelect, SearchBox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage, urls } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize, label } from '@/lib/format';
import { usePaging, useQuery } from '@/lib/hooks';
import { resourceHref } from '@/lib/links';
import type { CompanySettings, Customer, ListParams, Product, ReportColumn, ReportMeta, ReportType } from '@/lib/types';

interface ReportDef {
  type: ReportType;
  title: string;
  icon: typeof Boxes;
  snapshot?: boolean;
  types?: { value: string; label: string }[];
  typeLabel?: string;
  customer?: boolean;
  condition?: boolean;
  status?: boolean;
}

const REPORTS: ReportDef[] = [
  { type: 'current-stock', title: 'Current Stock', icon: Boxes, snapshot: true, status: true },
  { type: 'stock-in', title: 'Stock In', icon: ArrowDownToLine, types: [{ value: 'NewStock', label: 'New Stock' }, { value: 'WarehouseTransferIn', label: 'Warehouse Transfer In' }] },
  {
    type: 'stock-out',
    title: 'Stock Out',
    icon: ArrowUpFromLine,
    customer: true,
    types: [
      { value: 'CustomerDelivery', label: 'Customer Delivery' },
      { value: 'Sample', label: 'Sample' },
      { value: 'Gift', label: 'Gift' },
      { value: 'WarehouseTransfer', label: 'Warehouse Transfer' },
    ],
  },
  {
    type: 'customer-orders',
    title: 'Customer Orders',
    icon: ClipboardList,
    customer: true,
    typeLabel: 'Status',
    types: [
      { value: 'Pending', label: 'Pending' },
      { value: 'PartiallyCompleted', label: 'Partially Completed' },
      { value: 'Completed', label: 'Completed' },
    ],
  },
  { type: 'returns', title: 'Customer Returns', icon: Undo2, customer: true, condition: true, types: [{ value: 'AgainstOrder', label: 'Against Order' }, { value: 'Direct', label: 'Direct' }] },
  { type: 'adjustments', title: 'Stock Adjustments', icon: SlidersHorizontal, types: [{ value: 'Increase', label: 'Increase' }, { value: 'Decrease', label: 'Decrease' }] },
  { type: 'sample-gift', title: 'Sample & Gift', icon: Gift, types: [{ value: 'Sample', label: 'Sample' }, { value: 'Gift', label: 'Gift' }] },
  { type: 'warehouse-transfer', title: 'Warehouse Transfer', icon: ArrowRightLeft, typeLabel: 'Direction', types: [{ value: 'In', label: 'Transfer In' }, { value: 'Out', label: 'Transfer Out' }] },
  { type: 'low-stock', title: 'Low Stock', icon: AlertTriangle, snapshot: true },
  {
    type: 'damaged-stock',
    title: 'Damaged Stock',
    icon: AlertOctagon,
    typeLabel: 'Event',
    types: [
      { value: 'DamagedReturn', label: 'Damaged Return' },
      { value: 'MarkAsGood', label: 'Marked as Good' },
      { value: 'RemoveFromDamaged', label: 'Removed from Damaged' },
    ],
  },
];

const ENUM_KEYS = new Set(['status', 'outType', 'stockInType', 'returnMode', 'condition', 'direction', 'eventType', 'type', 'lowStock']);
const DATE_KEYS = new Set(['businessDate', 'orderDate', 'date', 'deliveryDate']);
const LINK_KEYS: Record<string, { idKey: string; type: string }> = {
  productName: { idKey: 'productId', type: 'Product' },
  customerName: { idKey: 'customerId', type: 'Customer' },
};
const NUMBER_LINKS: Record<ReportType, string | null> = {
  'current-stock': null,
  'low-stock': null,
  'stock-in': 'StockIn',
  'stock-out': 'StockOut',
  'customer-orders': 'Order',
  returns: 'Return',
  adjustments: 'Adjustment',
  'sample-gift': 'StockOut',
  'warehouse-transfer': null,
  'damaged-stock': null,
};
const ID_KEYS: Record<string, string> = { StockIn: 'stockInId', StockOut: 'stockOutId', Order: 'orderId', Return: 'returnId', Adjustment: 'adjustmentId' };

function formatCell(col: ReportColumn, row: Record<string, unknown>): string {
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return '—';
  if (col.format === 'money') return formatMoney(v as number);
  if (DATE_KEYS.has(col.key)) return formatDate(String(v));
  if (ENUM_KEYS.has(col.key)) return label(String(v));
  if (typeof v === 'number') return formatNumber(v);
  return String(v);
}

function summaryLabel(k: string) {
  const map: Record<string, string> = { recordCount: 'Records', transactionCount: 'Transactions', lineCount: 'Lines', totalQuantity: 'Total Quantity (BOX)' };
  return map[k] ?? humanize(k.replace(/^total/, 'Total '));
}

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsContent />
    </Suspense>
  );
}

function ReportsContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const initial = (REPORTS.find((r) => r.type === sp.get('type'))?.type ?? 'current-stock') as ReportType;
  const [type, setType] = useState<ReportType>(initial);
  const def = REPORTS.find((r) => r.type === type)!;
  const { page, setPage } = usePaging(10);
  const [period, setPeriod] = useState<PeriodValue>({ period: 'month' });
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [sub, setSub] = useState('');
  const [condition, setCondition] = useState('');
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(false);
  const [exporting, setExporting] = useState<null | 'print' | 'png'>(null);
  const [exportRows, setExportRows] = useState<Record<string, unknown>[] | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const productLoad = useMemo(() => productLoader(), []);
  const company = useQuery((s) => api.settings.company(s), []);

  useEffect(() => {
    const t = sp.get('type');
    if (t && t !== type && REPORTS.some((r) => r.type === t)) setType(t as ReportType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const selectReport = (t: ReportType) => {
    setType(t);
    setSub('');
    setCondition('');
    setStatus('');
    setCustomer(null);
    setPage(1);
    router.replace(`/reports?type=${t}`, { scroll: false });
  };

  const params: ListParams & { condition?: string } = useMemo(
    () => ({
      ...(def.snapshot ? {} : periodParams(period)),
      productId: product?.id,
      customerId: def.customer ? customer?.id : undefined,
      type: sub || undefined,
      condition: def.condition ? condition || undefined : undefined,
      status: def.status ? status || undefined : undefined,
      search: search || undefined,
    }),
    [def, period, product, customer, sub, condition, status, search],
  );

  const q = useQuery((s) => api.reports.get(type, { ...params, page, pageSize: 10 }, s), [type, params, page]);
  const meta = q.data?.meta as ReportMeta | undefined;
  const columns = meta?.columns ?? [];
  const pdfHref = urls.reportPdf(type, params);

  const tableColumns: Column<Record<string, unknown>>[] = columns.map((c) => ({
    key: c.key,
    header: c.label,
    align: c.align === 'right' ? 'right' : 'left',
    cell: (row) => {
      const text = formatCell(c, row);
      const lk = LINK_KEYS[c.key];
      if (lk && row[lk.idKey]) {
        const href = resourceHref(lk.type, String(row[lk.idKey]));
        if (href) return <Link href={href} className="hover:text-[#0D9488] hover:underline">{text}</Link>;
      }
      const nt = NUMBER_LINKS[type];
      if (c.key === 'number' && nt && row[ID_KEYS[nt]]) {
        const href = resourceHref(nt, String(row[ID_KEYS[nt]]));
        if (href) return <Link href={href} className="font-mono text-[#0D9488] hover:underline">{text}</Link>;
      }
      if (c.key === 'lowStock') return <span className={row[c.key] === 'Yes' ? 'font-semibold text-red-600' : ''}>{text}</span>;
      return <span className={cn(c.key === 'number' || c.key === 'referenceNumber' ? 'font-mono' : '', (c.width ?? 1) >= 3 ? 'whitespace-normal' : '')}>{text}</span>;
    },
  }));

  /** Load every row (in pages of 100) for Print / PNG export. */
  const loadAll = async () => {
    const all: Record<string, unknown>[] = [];
    for (let p = 1; p <= 50; p++) {
      const r = await api.reports.get(type, { ...params, page: p, pageSize: 100 });
      all.push(...r.data);
      if (!r.meta.hasNext) break;
    }
    return all;
  };

  const runExport = async (kind: 'print' | 'png') => {
    if (exporting) return;
    setExporting(kind);
    try {
      const rows = await loadAll();
      setExportRows(rows);
      await new Promise((r) => setTimeout(r, 120)); // let the export container render
      const node = exportRef.current;
      if (!node) throw new Error('Export area not ready');
      if (kind === 'print') {
        document.body.setAttribute('data-printing', 'report');
        const done = () => {
          document.body.removeAttribute('data-printing');
          window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 1000);
      } else {
        const { toPng } = await import('html-to-image');
        const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${type}-report-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        toast.success('Image exported', a.download);
      }
    } catch (err) {
      toast.error(kind === 'print' ? 'Could not print report' : 'Could not export image', errorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  const summary = meta?.summary ?? {};
  const periodText = def.snapshot ? `Snapshot as of ${formatDateTime(new Date().toISOString())}` : meta?.period ? `${formatDate(meta.period.from)} – ${formatDate(meta.period.to)}` : 'All dates';

  return (
    <>
      <PageHeader
        title="Reports"
        description="Quantities and transaction counts only. Export to PDF, print, or save as an image."
        actions={
          <>
            <Button variant="outline" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)} disabled={!q.data}>
              Preview PDF
            </Button>
            <ButtonLink href={pdfHref} download variant="save" icon={<FileDown className="h-4 w-4" />}>
              Export PDF
            </ButtonLink>
            <Button variant="print" icon={<Printer className="h-4 w-4" />} onClick={() => runExport('print')} loading={exporting === 'print'} disabled={!q.data}>
              Print
            </Button>
            <Button variant="outline" icon={<ImageDown className="h-4 w-4" />} onClick={() => runExport('png')} loading={exporting === 'png'} disabled={!q.data}>
              Export image
            </Button>
          </>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {REPORTS.map((r) => (
          <button
            key={r.type}
            type="button"
            onClick={() => selectReport(r.type)}
            aria-pressed={r.type === type}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]',
              r.type === type
                ? 'border-[#0D9488] bg-[#0D9488] text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
            )}
          >
            <r.icon className="h-4 w-4" />
            {r.title}
          </button>
        ))}
      </div>

      <Card padded={false}>
        <FilterBar
          onSubmit={() => {
            setSearch(term.trim());
            setPage(1);
          }}
        >
          {!def.snapshot && (
            <PeriodFilter
              value={period}
              onChange={(v) => {
                setPeriod(v);
                setPage(1);
              }}
            />
          )}
          <EntityCombobox<Product>
            label="Product"
            value={product?.id ?? null}
            initialLabel={product?.name}
            onChange={(o) => {
              setProduct(o ? { id: o.id, name: o.label } : null);
              setPage(1);
            }}
            load={productLoad}
            placeholder="All products"
            clearable
            labelClassName="text-xs text-slate-600 dark:text-slate-400"
            className="md:w-56"
          />
          {def.customer && (
            <EntityCombobox<Customer>
              label="Customer"
              value={customer?.id ?? null}
              initialLabel={customer?.name}
              onChange={(o) => {
                setCustomer(o ? { id: o.id, name: o.label } : null);
                setPage(1);
              }}
              load={loadCustomers}
              placeholder="All customers"
              clearable
              labelClassName="text-xs text-slate-600 dark:text-slate-400"
              className="md:w-56"
            />
          )}
          {def.types && (
            <FilterSelect
              label={def.typeLabel ?? 'Type'}
              value={sub}
              onChange={(v) => {
                setSub(v);
                setPage(1);
              }}
              options={[{ value: '', label: 'All' }, ...def.types]}
            />
          )}
          {def.condition && (
            <FilterSelect
              label="Condition"
              value={condition}
              onChange={(v) => {
                setCondition(v);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Any' },
                { value: 'Good', label: 'Good' },
                { value: 'Damaged', label: 'Damaged' },
              ]}
            />
          )}
          {def.status && (
            <FilterSelect
              label="Product status"
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All' },
                { value: 'Active', label: 'Active' },
                { value: 'Inactive', label: 'Inactive' },
              ]}
            />
          )}
          <SearchBox value={term} onChange={setTerm} label="Keyword" placeholder="Number, name, reason…" />
          <Button type="submit" variant="outline">
            Apply
          </Button>
        </FilterBar>

        <div className="border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{meta?.title ?? `${def.title} Report`}</h2>
            <span className="text-sm text-slate-500 dark:text-slate-400">{periodText}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Object.entries(summary).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900/50">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{summaryLabel(k)}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">{formatNumber(v)}</p>
              </div>
            ))}
            {!meta && q.loading && <div className="col-span-full h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />}
          </div>
        </div>

        <DataTable<Record<string, unknown>>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(_, i) => `${page}-${i}`}
          columns={tableColumns.length ? tableColumns : [{ key: 'x', header: '', cell: () => null }]}
          empty={<EmptyState title="No records for these filters" message="Change the period or clear filters." />}
        />
        <Pagination meta={meta} onPage={setPage} />
      </Card>

      <PdfPreviewModal open={preview} onClose={() => setPreview(false)} src={pdfHref} downloadHref={pdfHref} title={`${def.title} Report`} />

      {/* Off-screen export container used for Print and PNG export (all rows, light theme). */}
      {exportRows && (
        <div aria-hidden className="pointer-events-none fixed left-[-12000px] top-0">
          <div ref={exportRef} className="print-target w-[1100px] bg-white p-8 text-[12px] text-slate-900">
            <ExportHeader company={company.data} title={meta?.title ?? `${def.title} Report`} period={periodText} />
            <div className="my-4 flex flex-wrap gap-2">
              {Object.entries(summary).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-200 px-3 py-1.5">
                  <span className="text-[10px] uppercase text-slate-500">{summaryLabel(k)}</span> <b className="ml-1">{formatNumber(v)}</b>
                </div>
              ))}
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  {columns.map((c) => (
                    <th key={c.key} className={cn('border border-slate-200 px-2 py-1.5 text-[11px] font-semibold uppercase', c.align === 'right' ? 'text-right' : 'text-left')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exportRows.map((r, i) => (
                  <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                    {columns.map((c) => (
                      <td key={c.key} className={cn('border border-slate-200 px-2 py-1', c.align === 'right' ? 'text-right tabular-nums' : '')}>
                        {formatCell(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[10px] text-slate-500">
              {exportRows.length} row(s) · Generated {formatDateTime(new Date().toISOString())} (Africa/Nairobi) · All quantities in BOX
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function ExportHeader({ company, title, period }: { company?: CompanySettings; title: string; period: string }) {
  return (
    <div className="flex items-start justify-between border-b-2 border-[#0D9488] pb-3">
      <div className="flex items-center gap-3">
        {company?.hasLogo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={urls.logo(company.rowVersion)} alt="" className="h-12 w-12 object-contain" crossOrigin="use-credentials" />
        )}
        <div>
          <p className="text-base font-bold">{company?.companyName ?? 'Company'}</p>
          <p className="text-[11px] text-slate-500">{[company?.phone, company?.email, company?.address].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-lg font-bold">{title}</p>
        <p className="text-[11px] text-slate-500">{period}</p>
      </div>
    </div>
  );
}
