'use client';

import { Pencil, Plus, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { LinesTable, SupersededNotice, useDetailParam, VersionsList } from '@/components/DocumentParts';
import { EntityCombobox, loadCustomers, orderLoader } from '@/components/EntityCombobox';
import { LinesEditor, newLine, validateLines, type LineDraft } from '@/components/LinesEditor';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { ReceiptButtons, SavedDocumentModal, type SavedDocument } from '@/components/Receipt';
import { Button } from '@/components/ui/Button';
import { Alert, Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge } from '@/components/ui/Display';
import { FilterBar, FilterCheck, FilterSelect, Input, inputClass, SearchBox, Segmented, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatNumber, label, todayNairobi } from '@/lib/format';
import { useMutation, usePaging, useQuery } from '@/lib/hooks';
import type { Condition, Customer, CustomerReturn, Order, OrderDetail, ReturnLineInput, ReturnMode } from '@/lib/types';

export default function ReturnsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <ReturnsContent />
    </Suspense>
  );
}

function ReturnsContent() {
  const sp = useSearchParams();
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [mode, setMode] = useState('');
  const [condition, setCondition] = useState('');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [presetOrder, setPresetOrder] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const [detailId, openDetail, closeDetail] = useDetailParam();

  useEffect(() => {
    if (sp.get('new') === '1') {
      setPresetOrder(sp.get('orderId'));
      setCreating(true);
    }
  }, [sp]);

  const q = useQuery(
    (s) =>
      api.returns.list(
        { page, pageSize, type: mode || undefined, condition: condition || undefined, search: search || undefined, includeSuperseded: includeSuperseded || undefined, ...periodParams(period) },
        s,
      ),
    [page, pageSize, mode, condition, search, includeSuperseded, period],
  );

  return (
    <>
      <PageHeader
        title="Customer Returns"
        description="Good items go back to available stock; damaged items go to damaged stock (not sellable)."
        actions={
          <Button
            variant="accent"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setPresetOrder(null);
              setCreating(true);
            }}
          >
            New return
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
            label="Return type"
            value={mode}
            onChange={(v) => {
              setMode(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All types' },
              { value: 'AgainstOrder', label: 'Against Order' },
              { value: 'Direct', label: 'Direct' },
            ]}
          />
          <FilterSelect
            label="Condition"
            value={condition}
            onChange={(v) => {
              setCondition(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'Any condition' },
              { value: 'Good', label: 'Good' },
              { value: 'Damaged', label: 'Damaged' },
            ]}
          />
          <SearchBox value={term} onChange={setTerm} placeholder="RET number, customer, order…" />
          <FilterCheck label="Show superseded" checked={includeSuperseded} onChange={setIncludeSuperseded} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        <DataTable<CustomerReturn>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => openDetail(r.id)}
          empty={<EmptyState title="No returns found" icon={<Undo2 className="h-6 w-6" />} />}
          columns={[
            {
              key: 'number',
              header: 'Return No.',
              cell: (r) => (
                <span className="font-mono font-medium text-[#0D9488]">
                  {r.number}
                  {r.version > 1 && <span className="ml-1 text-xs text-slate-400">v{r.version}</span>}
                </span>
              ),
            },
            { key: 'date', header: 'Date', cell: (r) => formatDate(r.businessDate) },
            { key: 'mode', header: 'Type', cell: (r) => <StatusBadge value={r.returnMode} /> },
            { key: 'customer', header: 'Customer', cell: (r) => r.customerName },
            { key: 'order', header: 'Order', cell: (r) => (r.orderNumber ? <span className="font-mono text-xs">{r.orderNumber}</span> : <span className="text-slate-400">—</span>) },
            { key: 'good', header: 'Good', align: 'right', cell: (r) => <span className="text-green-700 dark:text-green-400">{formatNumber(r.goodQuantity)}</span> },
            { key: 'dmg', header: 'Damaged', align: 'right', cell: (r) => <span className={r.damagedQuantity ? 'text-red-600 dark:text-red-400' : ''}>{formatNumber(r.damagedQuantity)}</span> },
            { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-1 max-w-[16rem] whitespace-normal">{r.reason}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge value={r.status} /> },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <ReturnFormModal
        open={creating}
        presetOrderId={presetOrder}
        onClose={() => setCreating(false)}
        onSaved={(r) => {
          setCreating(false);
          q.reload();
          setSaved(savedDoc(r, false));
        }}
      />
      <ReturnDetailModal id={detailId} onClose={closeDetail} onSelect={openDetail} onChanged={q.reload} />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}

function savedDoc(r: CustomerReturn, correction: boolean): SavedDocument {
  return {
    title: correction ? 'Return correction saved' : 'Return saved',
    number: `${r.number}${r.version > 1 ? ` v${r.version}` : ''}`,
    receiptId: r.receiptId,
    receiptNumber: r.receiptNumber,
    details: (
      <p className="text-center text-sm text-slate-600 dark:text-slate-300">
        {formatNumber(r.goodQuantity)} BOX back to available stock · {formatNumber(r.damagedQuantity)} BOX to damaged stock.
      </p>
    ),
  };
}

type QtyMap = Record<string, { good: string; damaged: string }>;

function ReturnFormModal({
  open,
  onClose,
  onSaved,
  presetOrderId,
  correcting,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (r: CustomerReturn) => void;
  presetOrderId?: string | null;
  correcting?: CustomerReturn | null;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<ReturnMode>('AgainstOrder');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [qty, setQty] = useState<QtyMap>({});
  const [lines, setLines] = useState<LineDraft[]>([newLine({ condition: 'Good' })]);
  const [returnReason, setReturnReason] = useState('');
  const [date, setDate] = useState(todayNairobi());
  const [correctionReason, setCorrectionReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const loader = useMemo(() => orderLoader(['PartiallyCompleted', 'Completed']), []);
  const orderQ = useQuery((s) => api.orders.get(orderId as string, s), [orderId], { enabled: open && mode === 'AgainstOrder' && !!orderId, keepPrevious: false });
  const m = useMutation(async (key, body: { lines: ReturnLineInput[]; reason: string; businessDate: string; correction?: string }) => {
    if (correcting) {
      return api.returns.correct(
        correcting.id,
        { customerId: correcting.returnMode === 'Direct' ? customer?.id : undefined, returnReason: body.reason, businessDate: body.businessDate, lines: body.lines, reason: body.correction ?? '' },
        { idempotencyKey: key },
      );
    }
    return api.returns.create(
      { returnMode: mode, orderId: mode === 'AgainstOrder' ? orderId ?? undefined : undefined, customerId: mode === 'Direct' ? customer?.id : undefined, reason: body.reason, businessDate: body.businessDate, lines: body.lines },
      { idempotencyKey: key },
    );
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setCorrectionReason('');
    if (correcting) {
      setMode(correcting.returnMode);
      setOrderId(correcting.orderId);
      setCustomer({ id: correcting.customerId, name: correcting.customerName });
      setReturnReason(correcting.reason);
      setDate(correcting.businessDate);
      const map: QtyMap = {};
      for (const l of correcting.lines ?? []) {
        map[l.productId] ??= { good: '', damaged: '' };
        if (l.condition === 'Good') map[l.productId].good = String(l.quantity);
        else map[l.productId].damaged = String(l.quantity);
      }
      setQty(map);
      setLines((correcting.lines ?? []).map((l) => newLine({ productId: l.productId, productName: l.productName, quantity: String(l.quantity), condition: l.condition })));
    } else {
      setMode('AgainstOrder');
      setOrderId(presetOrderId ?? null);
      setCustomer(null);
      setQty({});
      setLines([newLine({ condition: 'Good' })]);
      setReturnReason('');
      setDate(todayNairobi());
    }
  }, [open, correcting, presetOrderId]);

  // For a correction, this return's own quantities are returnable again.
  const ownQty = (productId: string) => (correcting?.lines ?? []).filter((l) => l.productId === productId).reduce((s, l) => s + l.quantity, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    let body: ReturnLineInput[] = [];
    if (mode === 'AgainstOrder') {
      if (!orderId) v.orderId = 'Select the order being returned.';
      const order = orderQ.data;
      if (order) {
        order.lines.forEach((l, i) => {
          const g = qty[l.productId]?.good ?? '';
          const d = qty[l.productId]?.damaged ?? '';
          const gn = g === '' ? 0 : Number(g);
          const dn = d === '' ? 0 : Number(d);
          if (!Number.isInteger(gn) || gn < 0 || !Number.isInteger(dn) || dn < 0) v[`row.${i}`] = 'Whole numbers only.';
          else if (gn + dn > l.returnableQuantity + ownQty(l.productId)) v[`row.${i}`] = `Cannot exceed returnable ${l.returnableQuantity + ownQty(l.productId)}.`;
          if (gn > 0) body.push({ productId: l.productId, quantity: gn, condition: 'Good' });
          if (dn > 0) body.push({ productId: l.productId, quantity: dn, condition: 'Damaged' });
        });
        if (!Object.keys(v).length && !body.length) v.lines = 'Enter a Good or Damaged quantity for at least one product.';
      }
    } else {
      if (!customer) v.customerId = 'Select the registered customer.';
      Object.assign(v, validateLines(lines, { withCondition: true }).errors);
      body = lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), condition: (l.condition ?? 'Good') as Condition }));
    }
    if (!returnReason.trim()) v.reason = 'Return reason is required.';
    if (!date) v.businessDate = 'Date is required.';
    if (correcting && !correctionReason.trim()) v.correctionReason = 'Reason for correction is required.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const r = await m.run({ lines: body, reason: returnReason.trim(), businessDate: date, correction: correctionReason.trim() });
      if (r) {
        toast.success(correcting ? 'Return correction saved' : 'Return saved', r.number);
        onSaved(r);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = { ...err.fieldErrors };
        if (correcting && fe.reason && !fe.returnReason) {
          fe.correctionReason = fe.reason;
          delete fe.reason;
        }
        if (fe.returnReason) fe.reason = fe.returnReason;
        setErrors(fe);
      }
      toast.error('Could not save return', errorMessage(err));
    }
  };

  const order = orderQ.data as OrderDetail | undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={m.pending}
      size="xl"
      title={correcting ? `Correct ${correcting.number}` : 'New customer return'}
      description={correcting ? 'A new version replaces the current one; the original is kept as Superseded.' : 'Physically check returned items and select the condition for each.'}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={m.pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="return-form" loading={m.pending}>
            {correcting ? 'Save correction' : 'Save return'}
          </Button>
        </>
      }
    >
      <form id="return-form" onSubmit={submit} noValidate className="space-y-5">
        <Segmented<ReturnMode>
          label="Return type"
          required
          value={mode}
          onChange={(v) => {
            setMode(v);
            setErrors({});
          }}
          disabled={!!correcting}
          options={[
            { value: 'AgainstOrder', label: 'Against a customer order' },
            { value: 'Direct', label: 'Direct return (no order)' },
          ]}
        />
        {mode === 'AgainstOrder' ? (
          <>
            {correcting ? (
              <DetailGrid cols={2} items={[{ label: 'Order', value: correcting.orderNumber }, { label: 'Customer', value: correcting.customerName }]} />
            ) : (
              <EntityCombobox<Order>
                label="Customer Order"
                required
                value={orderId}
                onChange={(o) => {
                  setOrderId(o?.id ?? null);
                  setQty({});
                }}
                load={loader}
                error={errors.orderId}
                placeholder="Search order number or customer…"
                initialLabel={presetOrderId && order ? `${order.number} — ${order.customerName}` : undefined}
                clearable
              />
            )}
            {orderId &&
              (orderQ.error ? (
                <ErrorState error={orderQ.error} onRetry={orderQ.reload} compact />
              ) : !order ? (
                <LoadingBlock />
              ) : (
                <div>
                  {!correcting && <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">Customer: <span className="font-semibold">{order.customerName}</span></p>}
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Product</th>
                          <th className="px-3 py-2 text-right font-semibold">Delivered</th>
                          <th className="px-3 py-2 text-right font-semibold">Already returned</th>
                          <th className="px-3 py-2 text-right font-semibold">Returnable</th>
                          <th className="px-3 py-2 text-right font-semibold text-green-700 dark:text-green-400">Good</th>
                          <th className="px-3 py-2 text-right font-semibold text-red-600 dark:text-red-400">Damaged</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {order.lines.map((l, i) => {
                          const own = ownQty(l.productId);
                          const max = l.returnableQuantity + own;
                          const err = errors[`row.${i}`];
                          const set = (k: 'good' | 'damaged', val: string) => setQty((s) => ({ ...s, [l.productId]: { good: s[l.productId]?.good ?? '', damaged: s[l.productId]?.damaged ?? '', [k]: val } }));
                          return (
                            <tr key={l.id} className={cn('align-top', max === 0 && 'opacity-50')}>
                              <td className="px-3 py-2.5 font-medium">{l.productName}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(l.deliveredQuantity)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(l.returnedQuantity - own)}</td>
                              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatNumber(max)}</td>
                              {(['good', 'damaged'] as const).map((k) => (
                                <td key={k} className="px-2 py-2 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    max={max}
                                    step={1}
                                    placeholder="0"
                                    aria-label={`${k === 'good' ? 'Good' : 'Damaged'} quantity for ${l.productName}`}
                                    disabled={max === 0 || m.pending}
                                    value={qty[l.productId]?.[k] ?? ''}
                                    onChange={(e) => set(k, e.target.value)}
                                    className={cn(inputClass, 'ml-auto h-9 w-20 text-right', err && 'border-red-500')}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {Object.entries(errors)
                    .filter(([k]) => k.startsWith('row.') || k === 'lines' || k.startsWith('lines.'))
                    .map(([k, msg]) => (
                      <p key={k} className="mt-1 text-xs font-medium text-red-600">
                        {k.startsWith('row.') ? `${order.lines[Number(k.split('.')[1])]?.productName}: ` : ''}
                        {msg}
                      </p>
                    ))}
                </div>
              ))}
          </>
        ) : (
          <>
            <EntityCombobox<Customer>
              label="Customer"
              required
              value={customer?.id ?? null}
              initialLabel={customer?.name}
              onChange={(o) => setCustomer(o ? { id: o.id, name: o.label } : null)}
              load={loadCustomers}
              error={errors.customerId}
              placeholder="Search registered customer…"
            />
            <LinesEditor lines={lines} onChange={setLines} errors={errors} activeOnly={false} withCondition disabled={m.pending} />
          </>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Textarea label="Return reason" required value={returnReason} onChange={(e) => setReturnReason(e.target.value)} error={errors.reason} rows={2} maxLength={1000} className="sm:col-span-2" />
          <Input label="Date" required type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} error={errors.businessDate} />
        </div>
        {correcting && <Textarea label="Reason for correction" required value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} error={errors.correctionReason} rows={2} maxLength={1000} />}
        <Alert tone="info">
          <b>Good</b> quantities increase available stock. <b>Damaged</b> quantities increase damaged stock and do not increase available stock.
        </Alert>
      </form>
    </Modal>
  );
}

function ReturnDetailModal({ id, onClose, onSelect, onChanged }: { id: string | null; onClose: () => void; onSelect: (id: string) => void; onChanged: () => void }) {
  const q = useQuery((s) => api.returns.get(id as string, s), [id], { enabled: !!id, keepPrevious: false });
  const [correcting, setCorrecting] = useState(false);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const d = q.data;
  return (
    <>
      <Modal
        open={!!id && !correcting}
        onClose={onClose}
        size="lg"
        title={d ? `${d.number}${d.version > 1 ? ` (v${d.version})` : ''}` : 'Return'}
        description={d ? `${label(d.returnMode)} · ${formatDate(d.businessDate)}` : undefined}
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
                { label: 'Return No.', value: <span className="font-mono">{d.number}</span> },
                { label: 'Type', value: <StatusBadge value={d.returnMode} /> },
                { label: 'Date', value: formatDate(d.businessDate) },
                { label: 'Customer', value: <Link href={`/customers/${d.customerId}`} className="text-[#0D9488] hover:underline">{d.customerName}</Link> },
                { label: 'Order', value: d.orderId ? <Link href={`/orders/${d.orderId}`} className="font-mono text-[#0D9488] hover:underline">{d.orderNumber}</Link> : null, hidden: !d.orderId },
                { label: 'Status', value: <StatusBadge value={d.status} /> },
                { label: 'Reason', value: <span className="whitespace-pre-wrap">{d.reason}</span> },
                { label: 'Recorded', value: formatDateTime(d.createdAt) },
              ]}
            />
            <LinesTable lines={d.lines ?? []} extra="condition" />
            <VersionsList versions={d.versions} currentId={d.id} onSelect={onSelect} />
            <ReceiptButtons receiptId={d.receiptId} receiptNumber={d.receiptNumber} />
          </div>
        )}
      </Modal>
      <ReturnFormModal
        open={correcting}
        correcting={d}
        onClose={() => setCorrecting(false)}
        onSaved={(r) => {
          setCorrecting(false);
          onChanged();
          onSelect(r.id);
          setSaved(savedDoc(r, true));
        }}
      />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}
