'use client';

import { Pencil, Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { BeforeAfter } from '@/components/BeforeAfter';
import { SupersededNotice, useDetailParam, VersionsList } from '@/components/DocumentParts';
import { EntityCombobox, productLoader } from '@/components/EntityCombobox';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { ReceiptButtons, SavedDocumentModal, type SavedDocument } from '@/components/Receipt';
import { Button } from '@/components/ui/Button';
import { Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge } from '@/components/ui/Display';
import { FilterBar, FilterCheck, FilterSelect, Input, SearchBox, Segmented, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber, todayNairobi } from '@/lib/format';
import { useMutation, usePaging, useQuery } from '@/lib/hooks';
import type { Adjustment, AdjustmentDirection, Product } from '@/lib/types';

export default function AdjustmentsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <AdjustmentsContent />
    </Suspense>
  );
}

function AdjustmentsContent() {
  const sp = useSearchParams();
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [direction, setDirection] = useState('');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [creating, setCreating] = useState<AdjustmentDirection | null>(null);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const [detailId, openDetail, closeDetail] = useDetailParam();

  useEffect(() => {
    const n = sp.get('new');
    if (n === 'Increase' || n === 'Decrease') setCreating(n);
  }, [sp]);

  const q = useQuery(
    (s) => api.adjustments.list({ page, pageSize, type: direction || undefined, search: search || undefined, includeSuperseded: includeSuperseded || undefined, ...periodParams(period) }, s),
    [page, pageSize, direction, search, includeSuperseded, period],
  );

  return (
    <>
      <PageHeader
        title="Stock Adjustments"
        description="Correct physical-count differences for one product. A reason is always required."
        actions={
          <Button variant="accent" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('Increase')}>
            New adjustment
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
            label="Direction"
            value={direction}
            onChange={(v) => {
              setDirection(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Increase & Decrease' },
              { value: 'Increase', label: 'Increase' },
              { value: 'Decrease', label: 'Decrease' },
            ]}
          />
          <SearchBox value={term} onChange={setTerm} placeholder="ADJ number, product, reason…" />
          <FilterCheck label="Show superseded" checked={includeSuperseded} onChange={setIncludeSuperseded} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        <DataTable<Adjustment>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => openDetail(r.id)}
          empty={<EmptyState title="No adjustments found" icon={<SlidersHorizontal className="h-6 w-6" />} />}
          columns={[
            {
              key: 'n',
              header: 'Adjustment No.',
              cell: (r) => (
                <span className="font-mono font-medium text-[#0D9488]">
                  {r.number}
                  {r.version > 1 && <span className="ml-1 text-xs text-slate-400">v{r.version}</span>}
                </span>
              ),
            },
            { key: 'd', header: 'Date', cell: (r) => formatDate(r.businessDate) },
            { key: 'p', header: 'Product', cell: (r) => <span className="font-medium">{r.productName}</span> },
            { key: 'dir', header: 'Direction', cell: (r) => <StatusBadge value={r.direction} /> },
            {
              key: 'q',
              header: 'Quantity',
              align: 'right',
              cell: (r) => <span className={r.direction === 'Increase' ? 'font-semibold text-green-700 dark:text-green-400' : 'font-semibold text-red-600 dark:text-red-400'}>{r.direction === 'Increase' ? '+' : '−'}{formatNumber(r.quantity)}</span>,
            },
            { key: 'ba', header: 'Before → After', align: 'right', cell: (r) => <span className="tabular-nums">{formatNumber(r.availableBefore)} → <b>{formatNumber(r.availableAfter)}</b></span> },
            { key: 'r', header: 'Reason', cell: (r) => <span className="line-clamp-1 max-w-[16rem] whitespace-normal">{r.reason}</span> },
            { key: 's', header: 'Status', cell: (r) => <StatusBadge value={r.status} /> },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <AdjustmentFormModal
        initialDirection={creating}
        onClose={() => setCreating(null)}
        onSaved={(a) => {
          setCreating(null);
          q.reload();
          setSaved(savedDoc(a, false));
        }}
      />
      <AdjustmentDetailModal id={detailId} onClose={closeDetail} onSelect={openDetail} onChanged={q.reload} />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}

function savedDoc(a: Adjustment, correction: boolean): SavedDocument {
  return {
    title: correction ? 'Adjustment correction saved' : 'Adjustment saved',
    number: `${a.number}${a.version > 1 ? ` v${a.version}` : ''}`,
    receiptId: a.receiptId,
    receiptNumber: a.receiptNumber,
    details: <BeforeAfter label={`${a.productName} — available stock`} before={a.availableBefore} after={a.availableAfter} />,
  };
}

function AdjustmentFormModal({
  initialDirection,
  onClose,
  onSaved,
  correcting,
}: {
  initialDirection: AdjustmentDirection | null;
  onClose: () => void;
  onSaved: (a: Adjustment) => void;
  correcting?: Adjustment | null;
}) {
  const toast = useToast();
  const open = !!initialDirection;
  const [direction, setDirection] = useState<AdjustmentDirection>('Increase');
  const [product, setProduct] = useState<{ id: string; name: string; available: number | null } | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayNairobi());
  const [correctionReason, setCorrectionReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const loader = useMemo(() => productLoader({ activeOnly: false }), []);
  const m = useMutation(async (key, body: { direction: AdjustmentDirection; productId: string; quantity: number; reason: string; businessDate: string; correction: string }) =>
    correcting
      ? api.adjustments.correct(correcting.id, { direction: body.direction, productId: body.productId, quantity: body.quantity, adjustmentReason: body.reason, businessDate: body.businessDate, reason: body.correction }, { idempotencyKey: key })
      : api.adjustments.create({ direction: body.direction, productId: body.productId, quantity: body.quantity, reason: body.reason, businessDate: body.businessDate }, { idempotencyKey: key }),
  );

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setCorrectionReason('');
    if (correcting) {
      setDirection(correcting.direction);
      setProduct({ id: correcting.productId, name: correcting.productName, available: null });
      setQuantity(String(correcting.quantity));
      setReason(correcting.reason);
      setDate(correcting.businessDate);
      // Load current stock for the preview (the correction first reverses the original adjustment).
      api.products
        .get(correcting.productId)
        .then((p) => setProduct((s) => (s && s.id === p.id ? { ...s, available: p.availableStock - (correcting.direction === 'Increase' ? correcting.quantity : -correcting.quantity) } : s)))
        .catch(() => undefined);
    } else {
      setDirection(initialDirection ?? 'Increase');
      setProduct(null);
      setQuantity('');
      setReason('');
      setDate(todayNairobi());
    }
  }, [open, correcting, initialDirection]);

  const n = Number(quantity);
  const validQty = quantity !== '' && Number.isInteger(n) && n > 0;
  const after = product?.available !== null && product?.available !== undefined && validQty ? product.available + (direction === 'Increase' ? n : -n) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!product) v.productId = 'Select a product.';
    if (!validQty) v.quantity = 'Whole number greater than 0.';
    else if (after !== null && after < 0) v.quantity = `Cannot decrease by more than the available ${product?.available} BOX.`;
    if (!reason.trim()) v.reason = 'Reason is required.';
    if (!date) v.businessDate = 'Date is required.';
    if (correcting && !correctionReason.trim()) v.correctionReason = 'Reason for correction is required.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const a = await m.run({ direction, productId: product!.id, quantity: n, reason: reason.trim(), businessDate: date, correction: correctionReason.trim() });
      if (a) {
        toast.success(correcting ? 'Adjustment correction saved' : 'Adjustment saved', `${a.number}: ${a.availableBefore} → ${a.availableAfter} BOX`);
        onSaved(a);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = { ...err.fieldErrors };
        if (correcting && fe.reason) {
          fe.correctionReason = fe.reason;
          delete fe.reason;
        }
        if (fe.adjustmentReason) fe.reason = fe.adjustmentReason;
        setErrors(fe);
      }
      toast.error(err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' ? 'Insufficient stock' : 'Could not save adjustment', errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={m.pending}
      title={correcting ? `Correct ${correcting.number}` : 'New stock adjustment'}
      description={correcting ? 'A new version replaces the current one; the original is kept as Superseded.' : 'Adjust the available stock of one product.'}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={m.pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="adjustment-form" loading={m.pending}>
            {correcting ? 'Save correction' : 'Save adjustment'}
          </Button>
        </>
      }
    >
      <form id="adjustment-form" onSubmit={submit} noValidate className="space-y-4">
        <Segmented<AdjustmentDirection>
          label="Adjustment type"
          required
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'Increase', label: 'Increase', tone: 'green' },
            { value: 'Decrease', label: 'Decrease', tone: 'red' },
          ]}
        />
        <EntityCombobox<Product>
          label="Product"
          required
          value={product?.id ?? null}
          initialLabel={product?.name}
          onChange={(o) => setProduct(o ? { id: o.id, name: o.label, available: o.raw.availableStock } : null)}
          load={loader}
          error={errors.productId}
          placeholder="Search product…"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Quantity (BOX)" required type="number" min={1} step={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} error={errors.quantity} />
          <Input label="Date" required type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} error={errors.businessDate} />
        </div>
        {product && <BeforeAfter label="Available stock" before={product.available} after={after} preview />}
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} rows={2} maxLength={1000} placeholder="e.g. Physical count found 3 extra boxes" />
        {correcting && <Textarea label="Reason for correction" required value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} error={errors.correctionReason} rows={2} maxLength={1000} />}
      </form>
    </Modal>
  );
}

function AdjustmentDetailModal({ id, onClose, onSelect, onChanged }: { id: string | null; onClose: () => void; onSelect: (id: string) => void; onChanged: () => void }) {
  const q = useQuery((s) => api.adjustments.get(id as string, s), [id], { enabled: !!id, keepPrevious: false });
  const [correcting, setCorrecting] = useState(false);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const d = q.data;
  return (
    <>
      <Modal
        open={!!id && !correcting}
        onClose={onClose}
        size="lg"
        title={d ? `${d.number}${d.version > 1 ? ` (v${d.version})` : ''}` : 'Adjustment'}
        description={d ? `${d.direction} · ${formatDate(d.businessDate)}` : undefined}
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
                { label: 'Adjustment No.', value: <span className="font-mono">{d.number}</span> },
                { label: 'Direction', value: <StatusBadge value={d.direction} /> },
                { label: 'Date', value: formatDate(d.businessDate) },
                { label: 'Product', value: <Link href={`/inventory/${d.productId}`} className="text-[#0D9488] hover:underline">{d.productName}</Link> },
                { label: 'Quantity', value: `${d.direction === 'Increase' ? '+' : '−'}${formatNumber(d.quantity)} BOX` },
                { label: 'Status', value: <StatusBadge value={d.status} /> },
                { label: 'Reason', value: <span className="whitespace-pre-wrap">{d.reason}</span> },
                { label: 'Recorded', value: `${formatDateTime(d.createdAt)}${d.createdBy ? ` by ${d.createdBy}` : ''}` },
              ]}
            />
            <BeforeAfter label="Available stock" before={d.availableBefore} after={d.availableAfter} />
            <VersionsList versions={d.versions} currentId={d.id} onSelect={onSelect} />
            <ReceiptButtons receiptId={d.receiptId} receiptNumber={d.receiptNumber} />
          </div>
        )}
      </Modal>
      <AdjustmentFormModal
        initialDirection={correcting && d ? d.direction : null}
        correcting={d}
        onClose={() => setCorrecting(false)}
        onSaved={(a) => {
          setCorrecting(false);
          onChanged();
          onSelect(a.id);
          setSaved(savedDoc(a, true));
        }}
      />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}
