'use client';

import { ArrowRightLeft, ClipboardList, Gift, Info, Pencil, Truck } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DeliveryForm } from '@/components/DeliveryForm';
import { LinesTable, SupersededNotice, useDetailParam, VersionsList } from '@/components/DocumentParts';
import { EntityCombobox, orderLoader } from '@/components/EntityCombobox';
import { LinesEditor, newLine, validateLines, type LineDraft } from '@/components/LinesEditor';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { ReceiptButtons, SavedDocumentModal, type SavedDocument } from '@/components/Receipt';
import { Button } from '@/components/ui/Button';
import { Alert, Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge, Tabs } from '@/components/ui/Display';
import { FilterBar, FilterCheck, Input, SearchBox, Segmented, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatNumber, label, todayNairobi } from '@/lib/format';
import { useMutation, usePaging, useQuery } from '@/lib/hooks';
import type { DirectStockOutType, Order, OrderDetail, StockOut } from '@/lib/types';

type Flow = 'delivery' | 'samplegift' | 'transfer';
type ListTab = '' | 'CustomerDelivery' | 'Sample' | 'Gift' | 'WarehouseTransfer';

export default function StockOutPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <StockOutContent />
    </Suspense>
  );
}

const FLOWS: { value: Flow; title: string; desc: string; icon: typeof Truck; tone: string }[] = [
  { value: 'delivery', title: 'Customer Order Delivery', desc: 'Deliver all or part of an existing order', icon: ClipboardList, tone: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'samplegift', title: 'Sample / Gift', desc: 'Free stock to a named recipient', icon: Gift, tone: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-300' },
  { value: 'transfer', title: 'Warehouse Transfer', desc: 'Send stock to another warehouse', icon: ArrowRightLeft, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300' },
];

function StockOutContent() {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [tab, setTab] = useState<ListTab>('');
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const [detailId, openDetail, closeDetail] = useDetailParam();

  const q = useQuery(
    (s) => api.stockOuts.list({ page, pageSize, type: tab || undefined, search: search || undefined, includeSuperseded: includeSuperseded || undefined, ...periodParams(period) }, s),
    [page, pageSize, tab, search, includeSuperseded, period],
  );

  const onSaved = (doc: SavedDocument) => {
    setFlow(null);
    q.reload();
    setSaved(doc);
  };

  return (
    <>
      <PageHeader title="Stock Out" description="Three separate outbound flows. Stock decreases only after you save; prices are never shown here." />
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {FLOWS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFlow(f.value)}
            className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] dark:border-slate-700/80 dark:bg-slate-800/60 dark:hover:border-teal-700"
          >
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', f.tone)}>
              <f.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-slate-900 dark:text-white">{f.title}</span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">{f.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs<ListTab>
            value={tab}
            onChange={(v) => {
              setTab(v);
              setPage(1);
            }}
            tabs={[
              { value: '', label: 'All' },
              { value: 'CustomerDelivery', label: 'Customer Deliveries' },
              { value: 'Sample', label: 'Samples' },
              { value: 'Gift', label: 'Gifts' },
              { value: 'WarehouseTransfer', label: 'Warehouse Transfers' },
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
          <SearchBox value={term} onChange={setTerm} placeholder="SOUT/TRF number, order, recipient, warehouse…" />
          <FilterCheck label="Show superseded versions" checked={includeSuperseded} onChange={setIncludeSuperseded} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        <DataTable<StockOut>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => openDetail(r.id)}
          empty={<EmptyState title="No Stock Out transactions" message="Use one of the three flows above to record outgoing stock." />}
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
            { key: 'type', header: 'Type', cell: (r) => <StatusBadge value={r.outType} /> },
            {
              key: 'to',
              header: 'Customer / Recipient / Destination',
              cell: (r) =>
                r.outType === 'CustomerDelivery' ? (
                  <span>
                    {r.customerName}{' '}
                    {r.orderNumber && (
                      <Link href={`/orders/${r.orderId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-[#0D9488] hover:underline">
                        {r.orderNumber}
                      </Link>
                    )}
                  </span>
                ) : r.outType === 'WarehouseTransfer' ? (
                  <span>
                    {r.destinationWarehouse} <span className="font-mono text-xs text-slate-400">{r.transferNumber}</span>
                  </span>
                ) : (
                  r.recipientName
                ),
            },
            { key: 'qty', header: 'Total (BOX)', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{formatNumber(r.totalQuantity)}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge value={r.status} /> },
            { key: 'receipt', header: 'Receipt', cell: (r) => <span className="font-mono text-xs text-slate-500">{r.receiptNumber ?? '—'}</span> },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <DeliveryFlowModal open={flow === 'delivery'} onClose={() => setFlow(null)} onSaved={onSaved} />
      <DirectStockOutModal mode={flow === 'samplegift' ? 'samplegift' : flow === 'transfer' ? 'transfer' : null} onClose={() => setFlow(null)} onSaved={onSaved} />
      <StockOutDetailModal id={detailId} onClose={closeDetail} onSelect={openDetail} onChanged={q.reload} />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}

/** Flow 1 — Customer Order Delivery (select order → ordered/delivered/remaining → deliver). */
function DeliveryFlowModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (d: SavedDocument) => void }) {
  const [orderId, setOrderId] = useState<string | null>(null);
  const loader = useMemo(() => orderLoader(['Pending', 'PartiallyCompleted']), []);
  const q = useQuery((s) => api.orders.get(orderId as string, s), [orderId], { enabled: !!orderId, keepPrevious: false });
  useEffect(() => {
    if (open) setOrderId(null);
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Customer Order Delivery" description="Select a Pending or Partially Completed order. You may deliver part of the remaining quantity.">
      <div className="space-y-5">
        <EntityCombobox<Order>
          label="Customer Order"
          required
          value={orderId}
          onChange={(o) => setOrderId(o?.id ?? null)}
          load={loader}
          placeholder="Search order number or customer…"
          clearable
        />
        {!orderId ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
            <Info className="h-4 w-4 shrink-0" /> No order yet? <Link href="/orders?new=1" className="font-medium text-[#0D9488] hover:underline">Create a customer order</Link> first — deliveries are always linked to an order.
          </p>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={q.reload} compact />
        ) : !q.data ? (
          <LoadingBlock />
        ) : (
          <>
            <DetailGrid
              cols={4}
              items={[
                { label: 'Order', value: <Link href={`/orders/${q.data.id}`} className="font-mono text-[#0D9488] hover:underline">{q.data.number}</Link> },
                { label: 'Customer', value: q.data.customerName },
                { label: 'Order Date', value: formatDate(q.data.orderDate) },
                { label: 'Status', value: <StatusBadge value={q.data.status} /> },
              ]}
            />
            <DeliveryForm
              order={q.data as OrderDetail}
              onCancel={onClose}
              onDelivered={(r) =>
                onSaved({
                  title: r.order.status === 'Completed' ? 'Delivery saved — order completed' : 'Delivery saved',
                  number: r.delivery.stockOutNumber,
                  receiptId: r.order.status === 'Completed' ? r.order.receiptId : null,
                  receiptNumber: r.order.status === 'Completed' ? r.order.receiptNumber : null,
                  details: (
                    <p className="text-center text-sm text-slate-600 dark:text-slate-300">
                      {formatNumber(r.delivery.totalQuantity)} BOX delivered for {r.order.number}. Remaining on order: {formatNumber(r.order.totalRemaining)} BOX.
                    </p>
                  ),
                  note: r.order.status === 'Completed' ? undefined : 'The order receipt will be issued when the order is completed.',
                })
              }
            />
          </>
        )}
      </div>
    </Modal>
  );
}

/** Flow 2 (Sample / Gift) and Flow 3 (Warehouse Transfer) — also used for corrections. */
function DirectStockOutModal({
  mode,
  onClose,
  onSaved,
  correcting,
}: {
  mode: 'samplegift' | 'transfer' | null;
  onClose: () => void;
  onSaved: (d: SavedDocument, doc: StockOut) => void;
  correcting?: StockOut | null;
}) {
  const toast = useToast();
  const [outType, setOutType] = useState<DirectStockOutType>('Sample');
  const [recipient, setRecipient] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState(todayNairobi());
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation(async (key, body: Parameters<typeof api.stockOuts.create>[0] & { reason?: string }) =>
    correcting ? api.stockOuts.correct(correcting.id, { ...body, reason: body.reason ?? '' }, { idempotencyKey: key }) : api.stockOuts.create(body, { idempotencyKey: key }),
  );

  useEffect(() => {
    if (!mode) return;
    setErrors({});
    setReason('');
    if (correcting) {
      setOutType(correcting.outType as DirectStockOutType);
      setRecipient(correcting.recipientName ?? '');
      setDestination(correcting.destinationWarehouse ?? '');
      setDate(correcting.businessDate);
      setLines((correcting.lines ?? []).map((l) => newLine({ productId: l.productId, productName: l.productName, quantity: String(l.quantity) })));
    } else {
      setOutType(mode === 'transfer' ? 'WarehouseTransfer' : 'Sample');
      setRecipient('');
      setDestination('');
      setDate(todayNairobi());
      setLines([newLine()]);
    }
  }, [mode, correcting]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = { ...validateLines(lines).errors };
    if ((outType === 'Sample' || outType === 'Gift') && !recipient.trim()) v.recipientName = 'Recipient full name is required.';
    if (outType === 'WarehouseTransfer' && !destination.trim()) v.destinationWarehouse = 'Destination warehouse is required.';
    if (!date) v.businessDate = 'Date is required.';
    if (correcting && !reason.trim()) v.reason = 'Reason for correction is required.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const d = await m.run({
        outType,
        recipientName: outType === 'WarehouseTransfer' ? undefined : recipient.trim(),
        destinationWarehouse: outType === 'WarehouseTransfer' ? destination.trim() : undefined,
        businessDate: date,
        lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        reason: correcting ? reason.trim() : undefined,
      });
      if (d) {
        toast.success(correcting ? 'Correction saved' : `${label(d.outType)} saved`, d.number);
        onSaved(
          {
            title: correcting ? 'Correction saved' : `${label(d.outType)} saved`,
            number: `${d.number}${d.version > 1 ? ` v${d.version}` : ''}${d.transferNumber ? ` · ${d.transferNumber}` : ''}`,
            receiptId: d.receiptId,
            receiptNumber: d.receiptNumber,
            details: <p className="text-center text-sm text-slate-600 dark:text-slate-300">{formatNumber(d.totalQuantity)} BOX removed from available stock.</p>,
          },
          d,
        );
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' ? 'Insufficient stock' : 'Could not save Stock Out', errorMessage(err));
    }
  };

  const isTransfer = outType === 'WarehouseTransfer';
  return (
    <Modal
      open={!!mode}
      onClose={onClose}
      busy={m.pending}
      size="lg"
      title={correcting ? `Correct ${correcting.number}` : isTransfer ? 'Warehouse Transfer' : 'Sample / Gift'}
      description={correcting ? 'A new version replaces the current one; the original is kept as Superseded.' : isTransfer ? 'Outbound transfer to another warehouse.' : 'Free stock given to a named recipient. No price is recorded.'}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={m.pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="stockout-form" loading={m.pending}>
            {correcting ? 'Save correction' : 'Save Stock Out'}
          </Button>
        </>
      }
    >
      <form id="stockout-form" onSubmit={submit} noValidate className="space-y-5">
        {!isTransfer && (
          <Segmented<DirectStockOutType>
            label="Type"
            value={outType}
            onChange={setOutType}
            disabled={!!correcting}
            options={[
              { value: 'Sample', label: 'Sample' },
              { value: 'Gift', label: 'Gift' },
            ]}
          />
        )}
        {isTransfer && (
          <Alert tone="info">
            This records only the <strong>outbound</strong> transfer from this warehouse. Receiving warehouses are not managed by the system — enter the destination name manually.
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isTransfer ? (
            <Input label="Destination Warehouse" required value={destination} onChange={(e) => setDestination(e.target.value)} error={errors.destinationWarehouse} maxLength={150} placeholder="e.g. Kisumu Branch" />
          ) : (
            <Input label="Recipient Full Name" required value={recipient} onChange={(e) => setRecipient(e.target.value)} error={errors.recipientName} maxLength={150} />
          )}
          <Input label="Date" required type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} error={errors.businessDate} />
        </div>
        <LinesEditor lines={lines} onChange={setLines} errors={errors} activeOnly disabled={m.pending} />
        {correcting && <Textarea label="Reason for correction" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} rows={2} maxLength={1000} />}
        {!correcting && <p className="text-xs text-slate-500 dark:text-slate-400">Quantities cannot exceed available stock. A {isTransfer ? 'SOUT and TRF' : 'SOUT'} number and receipt are assigned after saving.</p>}
      </form>
    </Modal>
  );
}

function StockOutDetailModal({ id, onClose, onSelect, onChanged }: { id: string | null; onClose: () => void; onSelect: (id: string) => void; onChanged: () => void }) {
  const q = useQuery((s) => api.stockOuts.get(id as string, s), [id], { enabled: !!id, keepPrevious: false });
  const [correcting, setCorrecting] = useState(false);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const d = q.data;
  const canCorrect = d && d.status === 'Posted' && d.outType !== 'CustomerDelivery';
  return (
    <>
      <Modal
        open={!!id && !correcting}
        onClose={onClose}
        size="lg"
        title={d ? `${d.number}${d.version > 1 ? ` (v${d.version})` : ''}` : 'Stock Out'}
        description={d ? `${label(d.outType)} · ${formatDate(d.businessDate)}` : undefined}
        footer={
          d && (
            <>
              <Button variant="cancel" onClick={onClose}>
                Close
              </Button>
              {canCorrect && (
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
                { label: 'Stock Out No.', value: <span className="font-mono">{d.number}</span> },
                { label: 'Type', value: <StatusBadge value={d.outType} /> },
                { label: 'Date', value: formatDate(d.businessDate) },
                { label: 'Order', value: d.orderId ? <Link href={`/orders/${d.orderId}`} className="font-mono text-[#0D9488] hover:underline">{d.orderNumber}</Link> : null, hidden: !d.orderId },
                { label: 'Customer', value: d.customerName, hidden: !d.customerName },
                { label: 'Recipient', value: d.recipientName, hidden: !d.recipientName },
                { label: 'Destination Warehouse', value: d.destinationWarehouse, hidden: !d.destinationWarehouse },
                { label: 'Transfer No.', value: <span className="font-mono">{d.transferNumber}</span>, hidden: !d.transferNumber },
                { label: 'Status', value: <StatusBadge value={d.status} /> },
                { label: 'Recorded', value: `${formatDateTime(d.createdAt)}${d.createdBy ? ` by ${d.createdBy}` : ''}` },
              ]}
            />
            <LinesTable lines={d.lines ?? []} />
            {d.outType === 'CustomerDelivery' && (
              <Alert tone="info">Deliveries cannot be corrected. Record a customer return against the order or a stock adjustment instead.</Alert>
            )}
            <VersionsList versions={d.versions} currentId={d.id} onSelect={onSelect} />
            {d.outType === 'CustomerDelivery' ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">The receipt for a customer delivery is the order receipt, issued when the order is completed.</p>
            ) : (
              <ReceiptButtons receiptId={d.receiptId} receiptNumber={d.receiptNumber} />
            )}
          </div>
        )}
      </Modal>
      <DirectStockOutModal
        mode={correcting && d ? (d.outType === 'WarehouseTransfer' ? 'transfer' : 'samplegift') : null}
        correcting={d}
        onClose={() => setCorrecting(false)}
        onSaved={(doc, nd) => {
          setCorrecting(false);
          onChanged();
          onSelect(nd.id);
          setSaved(doc);
        }}
      />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}
