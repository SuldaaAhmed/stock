'use client';

import { ArrowRight, Info, PackagePlus, Pencil, Plus, Truck, Undo2, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { LinesTable, SupersededNotice, useDetailParam, VersionsList } from '@/components/DocumentParts';
import { LinesEditor, newLine, validateLines, type LineDraft } from '@/components/LinesEditor';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { ReceiptButtons, SavedDocumentModal, type SavedDocument } from '@/components/Receipt';
import { Button } from '@/components/ui/Button';
import { Alert, Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge } from '@/components/ui/Display';
import { FilterBar, FilterCheck, FilterSelect, Input, SearchBox, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatNumber, label, todayNairobi } from '@/lib/format';
import { useMutation, usePaging, useQuery } from '@/lib/hooks';
import type { StockIn, StockInType } from '@/lib/types';

export default function StockInPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <StockInContent />
    </Suspense>
  );
}

function StockInContent() {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [type, setType] = useState('');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const [detailId, openDetail, closeDetail] = useDetailParam();

  const q = useQuery(
    (s) => api.stockIns.list({ page, pageSize, type: type || undefined, search: search || undefined, includeSuperseded: includeSuperseded || undefined, ...periodParams(period) }, s),
    [page, pageSize, type, search, includeSuperseded, period],
  );

  return (
    <>
      <PageHeader
        title="Stock In"
        description="Record goods received after physical checking. Stock increases only after you save."
        actions={
          <Button variant="accent" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New Stock In
          </Button>
        }
      />
      <Card padded={false}>
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
          <FilterSelect
            label="Type"
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All types' },
              { value: 'NewStock', label: 'New Stock' },
              { value: 'WarehouseTransferIn', label: 'Warehouse Transfer In' },
            ]}
          />
          <SearchBox value={term} onChange={setTerm} placeholder="SIN number, product, warehouse…" />
          <FilterCheck label="Show superseded versions" checked={includeSuperseded} onChange={setIncludeSuperseded} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        <DataTable<StockIn>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => openDetail(r.id)}
          empty={<EmptyState title="No Stock In transactions" message="Record received goods with “New Stock In”." icon={<PackagePlus className="h-6 w-6" />} />}
          columns={[
            {
              key: 'number',
              header: 'Number',
              cell: (r) => (
                <span className="font-mono font-medium text-[#0D9488]">
                  {r.number}
                  {r.version > 1 && <span className="ml-1 text-xs text-slate-400">v{r.version}</span>}
                </span>
              ),
            },
            { key: 'date', header: 'Date', cell: (r) => formatDate(r.businessDate) },
            { key: 'type', header: 'Type', cell: (r) => <StatusBadge value={r.stockInType} /> },
            { key: 'source', header: 'Source Warehouse', cell: (r) => r.sourceWarehouse ?? <span className="text-slate-400">—</span> },
            { key: 'lines', header: 'Products', align: 'right', cell: (r) => r.lineCount ?? '—' },
            { key: 'qty', header: 'Total (BOX)', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{formatNumber(r.totalQuantity)}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge value={r.status} /> },
            { key: 'receipt', header: 'Receipt', cell: (r) => <span className="font-mono text-xs text-slate-500">{r.receiptNumber ?? '—'}</span> },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <StockInFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(d) => {
          setCreating(false);
          q.reload();
          setSaved({
            title: 'Stock In saved',
            number: d.number,
            receiptId: d.receiptId,
            receiptNumber: d.receiptNumber,
            details: <p className="text-center text-sm text-slate-600 dark:text-slate-300">{formatNumber(d.totalQuantity)} BOX added to available stock.</p>,
          });
        }}
      />
      <StockInDetailModal id={detailId} onClose={closeDetail} onSelect={openDetail} onChanged={q.reload} />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}

const TYPE_CARDS: { value: StockInType | 'CustomerReturn' | 'AdjustmentIn'; title: string; desc: string; icon: typeof Truck }[] = [
  { value: 'NewStock', title: 'New Stock', desc: 'Goods delivered to the warehouse', icon: PackagePlus },
  { value: 'WarehouseTransferIn', title: 'Warehouse Transfer In', desc: 'Goods received from another warehouse', icon: Truck },
  { value: 'CustomerReturn', title: 'Customer Return', desc: 'Recorded in the Returns module', icon: Undo2 },
  { value: 'AdjustmentIn', title: 'Stock Adjustment In', desc: 'Recorded in Stock Adjustments', icon: SlidersHorizontal },
];

function StockInFormModal({
  open,
  onClose,
  onSaved,
  correcting,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (d: StockIn) => void;
  correcting?: StockIn | null;
}) {
  const toast = useToast();
  const [type, setType] = useState<StockInType | 'CustomerReturn' | 'AdjustmentIn'>('NewStock');
  const [source, setSource] = useState('');
  const [date, setDate] = useState(todayNairobi());
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation(async (key, body: Parameters<typeof api.stockIns.create>[0] & { reason?: string }) =>
    correcting ? api.stockIns.correct(correcting.id, { ...body, reason: body.reason ?? '' }, { idempotencyKey: key }) : api.stockIns.create(body, { idempotencyKey: key }),
  );

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setReason('');
    if (correcting) {
      setType(correcting.stockInType);
      setSource(correcting.sourceWarehouse ?? '');
      setDate(correcting.businessDate);
      setLines((correcting.lines ?? []).map((l) => newLine({ productId: l.productId, productName: l.productName, quantity: String(l.quantity) })));
    } else {
      setType('NewStock');
      setSource('');
      setDate(todayNairobi());
      setLines([newLine()]);
    }
  }, [open, correcting]);

  const redirect = type === 'CustomerReturn' ? '/returns?new=1' : type === 'AdjustmentIn' ? '/adjustments?new=Increase' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (redirect) return;
    const { errors: lineErrors } = validateLines(lines);
    const v: Record<string, string> = { ...lineErrors };
    if (type === 'WarehouseTransferIn' && !source.trim()) v.sourceWarehouse = 'Source warehouse name is required.';
    if (!date) v.businessDate = 'Date is required.';
    if (correcting && !reason.trim()) v.reason = 'Reason for correction is required.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const d = await m.run({
        stockInType: type as StockInType,
        sourceWarehouse: type === 'WarehouseTransferIn' ? source.trim() : undefined,
        businessDate: date,
        lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        reason: correcting ? reason.trim() : undefined,
      });
      if (d) {
        toast.success(correcting ? 'Correction saved' : 'Stock In saved', `${d.number}${d.version > 1 ? ` v${d.version}` : ''}`);
        onSaved(d);
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(correcting ? 'Could not save correction' : 'Could not save Stock In', errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={m.pending}
      size="lg"
      title={correcting ? `Correct ${correcting.number}` : 'New Stock In'}
      description={correcting ? 'A new version replaces the current one. The original is kept as Superseded.' : 'Physically check delivered goods before saving.'}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={m.pending}>
            Cancel
          </Button>
          {!redirect && (
            <Button variant="save" type="submit" form="stockin-form" loading={m.pending}>
              {correcting ? 'Save correction' : 'Save Stock In'}
            </Button>
          )}
        </>
      }
    >
      <form id="stockin-form" onSubmit={submit} noValidate className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Transaction Type<span className="ml-0.5 text-red-600">*</span>
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TYPE_CARDS.filter((c) => !correcting || c.value === 'NewStock' || c.value === 'WarehouseTransferIn').map((c) => {
              const active = type === c.value;
              const disabled = !!correcting && c.value !== correcting.stockInType;
              return (
                <button
                  type="button"
                  key={c.value}
                  disabled={disabled}
                  onClick={() => setType(c.value)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] disabled:cursor-not-allowed disabled:opacity-40',
                    active ? 'border-[#0D9488] bg-teal-50 dark:bg-teal-900/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                  )}
                >
                  <c.icon className={cn('mt-0.5 h-5 w-5 shrink-0', active ? 'text-[#0D9488]' : 'text-slate-400')} />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{c.title}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{c.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {correcting && <p className="mt-1.5 text-xs text-slate-500">The transaction type cannot be changed by a correction.</p>}
        </fieldset>

        {redirect ? (
          <Alert tone="info" title={type === 'CustomerReturn' ? 'Customer returns have their own workflow' : 'Stock adjustments have their own workflow'}>
            <p className="mb-3">
              {type === 'CustomerReturn'
                ? 'Returns record the customer, order, condition (Good / Damaged) and reason, so Good items increase available stock and Damaged items go to damaged stock.'
                : 'Adjustment In requires a reason and records before/after quantities for one product.'}
            </p>
            <Link href={redirect} className="inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline">
              Continue in {type === 'CustomerReturn' ? 'Returns' : 'Stock Adjustments'} <ArrowRight className="h-4 w-4" />
            </Link>
          </Alert>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Date" required type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} error={errors.businessDate} />
              {type === 'WarehouseTransferIn' && (
                <Input label="Source Warehouse" required value={source} onChange={(e) => setSource(e.target.value)} error={errors.sourceWarehouse} maxLength={150} placeholder="e.g. Mombasa Depot" />
              )}
            </div>
            <LinesEditor lines={lines} onChange={setLines} errors={errors} activeOnly disabled={m.pending} />
            {correcting && <Textarea label="Reason for correction" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} rows={2} maxLength={1000} />}
            {!correcting && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Info className="h-3.5 w-3.5" /> Only active products can be selected. A SIN number and receipt are assigned after saving.
              </p>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

function StockInDetailModal({ id, onClose, onSelect, onChanged }: { id: string | null; onClose: () => void; onSelect: (id: string) => void; onChanged: () => void }) {
  const q = useQuery((s) => api.stockIns.get(id as string, s), [id], { enabled: !!id, keepPrevious: false });
  const [correcting, setCorrecting] = useState(false);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const d = q.data;
  return (
    <>
      <Modal
        open={!!id && !correcting}
        onClose={onClose}
        size="lg"
        title={d ? `${d.number}${d.version > 1 ? ` (v${d.version})` : ''}` : 'Stock In'}
        description={d ? `${label(d.stockInType)} · ${formatDate(d.businessDate)}` : undefined}
        footer={
          d && (
            <>
              <Button variant="cancel" onClick={onClose}>
                Close
              </Button>
              {d.status === 'Posted' && (
                <Button variant="edit" icon={<Pencil className="h-4 w-4" />} onClick={() => setCorrecting(true)}>
                  Correct
                </Button>
              )}
            </>
          )
        }
      >
        {q.error ? (
          <ErrorState error={q.error} onRetry={q.reload} compact />
        ) : !d ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-5">
            <SupersededNotice status={d.status} correctionReason={d.correctionReason} version={d.version} />
            <DetailGrid
              items={[
                { label: 'Stock In No.', value: <span className="font-mono">{d.number}</span> },
                { label: 'Type', value: <StatusBadge value={d.stockInType} /> },
                { label: 'Date', value: formatDate(d.businessDate) },
                { label: 'Source Warehouse', value: d.sourceWarehouse, hidden: !d.sourceWarehouse },
                { label: 'Status', value: <StatusBadge value={d.status} /> },
                { label: 'Recorded', value: `${formatDateTime(d.createdAt)}${d.createdBy ? ` by ${d.createdBy}` : ''}` },
              ]}
            />
            <LinesTable lines={d.lines ?? []} />
            <VersionsList versions={d.versions} currentId={d.id} onSelect={onSelect} />
            <ReceiptButtons receiptId={d.receiptId} receiptNumber={d.receiptNumber} />
          </div>
        )}
      </Modal>
      <StockInFormModal
        open={correcting}
        correcting={d}
        onClose={() => setCorrecting(false)}
        onSaved={(nd) => {
          setCorrecting(false);
          onChanged();
          onSelect(nd.id);
          setSaved({ title: 'Correction saved', number: `${nd.number} v${nd.version}`, receiptId: nd.receiptId, receiptNumber: nd.receiptNumber });
        }}
      />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}
