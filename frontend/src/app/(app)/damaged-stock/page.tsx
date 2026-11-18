'use client';

import { AlertOctagon, CheckCircle2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { BeforeAfter } from '@/components/BeforeAfter';
import { useDetailParam } from '@/components/DocumentParts';
import { EntityCombobox, productLoader } from '@/components/EntityCombobox';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { ReceiptButtons, SavedDocumentModal, type SavedDocument } from '@/components/Receipt';
import { Button } from '@/components/ui/Button';
import { Alert, Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge } from '@/components/ui/Display';
import { FilterBar, FilterSelect, Input, SearchBox, Segmented, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber, label, todayNairobi } from '@/lib/format';
import { useMutation, usePaging, useQuery } from '@/lib/hooks';
import type { DamagedAction, DamagedActionType, DamagedBalance, Product } from '@/lib/types';

export default function DamagedStockPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <DamagedContent />
    </Suspense>
  );
}

interface Preset {
  action: DamagedActionType;
  product?: { id: string; name: string; damaged: number; available: number };
}

function DamagedContent() {
  const sp = useSearchParams();
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [type, setType] = useState('');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<Preset | null>(null);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const [detailId, openDetail, closeDetail] = useDetailParam();
  const productFilter = sp.get('productId') ?? undefined;

  const q = useQuery(
    (s) => api.damaged.list({ page, pageSize, type: type || undefined, productId: productFilter, search: search || undefined, ...periodParams(period) }, s),
    [page, pageSize, type, search, period, productFilter],
  );
  const balances = (q.data?.meta as { balances?: DamagedBalance[] } | undefined)?.balances ?? [];
  const withDamaged = balances.filter((b) => b.damagedStock > 0);
  const totalDamaged = withDamaged.reduce((s, b) => s + b.damagedStock, 0);

  const open = (action: DamagedActionType, b?: DamagedBalance) => setPreset({ action, product: b ? { id: b.productId, name: b.productName, damaged: b.damagedStock, available: b.availableStock } : undefined });

  return (
    <>
      <PageHeader
        title="Damaged Stock"
        description="Damaged returns are kept separately and are not sellable. Mark repaired items as Good or remove written-off items."
        actions={
          <>
            <Button variant="confirm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => open('MarkAsGood')}>
              Mark as Good
            </Button>
            <Button variant="delete" icon={<Trash2 className="h-4 w-4" />} onClick={() => open('RemoveFromDamaged')}>
              Remove from damaged
            </Button>
          </>
        }
      />

      <Card title={`Current damaged stock · ${formatNumber(totalDamaged)} BOX`} padded={false} className="mb-6">
        <DataTable<DamagedBalance>
          rows={q.data ? withDamaged : undefined}
          loading={q.loading && !q.data}
          rowKey={(b) => b.productId}
          empty={<EmptyState title="No damaged stock" message="Damaged items from customer returns will appear here." icon={<AlertOctagon className="h-6 w-6" />} />}
          columns={[
            { key: 'p', header: 'Product', cell: (b) => <Link href={`/inventory/${b.productId}`} className="font-medium hover:text-[#0D9488]">{b.productName}</Link> },
            { key: 'st', header: 'Status', cell: (b) => <StatusBadge value={b.status} /> },
            { key: 'd', header: 'Damaged', align: 'right', cell: (b) => <span className="font-semibold text-red-600 dark:text-red-400">{formatNumber(b.damagedStock)}</span> },
            { key: 'a', header: 'Available', align: 'right', cell: (b) => formatNumber(b.availableStock) },
            {
              key: 'act',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (b) => (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => open('MarkAsGood', b)}>
                    Mark as Good
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => open('RemoveFromDamaged', b)}>
                    Remove
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Card title="Damaged stock actions" padded={false}>
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
            label="Action"
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All actions' },
              { value: 'MarkAsGood', label: 'Mark as Good' },
              { value: 'RemoveFromDamaged', label: 'Remove from Damaged' },
            ]}
          />
          <SearchBox value={term} onChange={setTerm} placeholder="Product or reason…" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        {productFilter && (
          <div className="border-b border-slate-200 px-4 py-2 text-sm dark:border-slate-700">
            Filtered by product · <Link href="/damaged-stock" className="text-[#0D9488] hover:underline">Clear</Link>
          </div>
        )}
        <DataTable<DamagedAction>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => openDetail(r.id)}
          empty={<EmptyState title="No actions recorded" />}
          columns={[
            { key: 'd', header: 'Date', cell: (r) => formatDate(r.businessDate) },
            { key: 'a', header: 'Action', cell: (r) => <StatusBadge value={r.actionType} /> },
            { key: 'p', header: 'Product', cell: (r) => <span className="font-medium">{r.productName}</span> },
            { key: 'q', header: 'Quantity', align: 'right', cell: (r) => <span className="font-semibold">{formatNumber(r.quantity)}</span> },
            { key: 'dm', header: 'Damaged before → after', align: 'right', cell: (r) => `${formatNumber(r.damagedBefore)} → ${formatNumber(r.damagedAfter)}` },
            { key: 'av', header: 'Available before → after', align: 'right', cell: (r) => `${formatNumber(r.availableBefore)} → ${formatNumber(r.availableAfter)}` },
            { key: 'r', header: 'Reason', cell: (r) => <span className="line-clamp-1 max-w-[14rem] whitespace-normal">{r.reason}</span> },
            { key: 'rc', header: 'Receipt', cell: (r) => <span className="font-mono text-xs text-slate-500">{r.receiptNumber ?? '—'}</span> },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <DamagedActionModal
        preset={preset}
        onClose={() => setPreset(null)}
        onSaved={(a) => {
          setPreset(null);
          q.reload();
          setSaved({
            title: a.actionType === 'MarkAsGood' ? 'Marked as Good' : 'Removed from damaged stock',
            number: a.receiptNumber ?? label(a.actionType),
            receiptId: a.receiptId,
            receiptNumber: a.receiptNumber,
            details: (
              <div className="space-y-2">
                <BeforeAfter label={`${a.productName} — damaged stock`} before={a.damagedBefore} after={a.damagedAfter} />
                <BeforeAfter label="Available stock" before={a.availableBefore} after={a.availableAfter} />
              </div>
            ),
          });
        }}
      />
      <DamagedDetailModal id={detailId} onClose={closeDetail} />
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}

function DamagedActionModal({ preset, onClose, onSaved }: { preset: Preset | null; onClose: () => void; onSaved: (a: DamagedAction) => void }) {
  const toast = useToast();
  const [action, setAction] = useState<DamagedActionType>('MarkAsGood');
  const [product, setProduct] = useState<Preset['product'] | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayNairobi());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const loader = useMemo(() => {
    const base = productLoader({ withDamaged: true });
    return async (s: string, signal: AbortSignal) => (await base(s, signal)).map((o) => ({ ...o, disabled: o.raw.damagedStock <= 0 }));
  }, []);
  const m = useMutation((key, body: Parameters<typeof api.damaged.create>[0]) => api.damaged.create(body, { idempotencyKey: key }));

  useEffect(() => {
    if (!preset) return;
    setAction(preset.action);
    setProduct(preset.product ?? null);
    setQuantity('');
    setReason('');
    setDate(todayNairobi());
    setErrors({});
  }, [preset]);

  const n = Number(quantity);
  const validQty = quantity !== '' && Number.isInteger(n) && n > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!product) v.productId = 'Select a product with damaged stock.';
    if (!validQty) v.quantity = 'Whole number greater than 0.';
    else if (product && n > product.damaged) v.quantity = `Cannot exceed damaged stock (${product.damaged} BOX).`;
    if (!reason.trim()) v.reason = 'Reason is required.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const a = await m.run({ actionType: action, productId: product!.id, quantity: n, reason: reason.trim(), businessDate: date });
      if (a) {
        toast.success(action === 'MarkAsGood' ? 'Marked as Good' : 'Removed from damaged stock', `${a.productName}: damaged ${a.damagedBefore} → ${a.damagedAfter}`);
        onSaved(a);
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error('Could not save action', errorMessage(err));
    }
  };

  return (
    <Modal
      open={!!preset}
      onClose={onClose}
      busy={m.pending}
      title={action === 'MarkAsGood' ? 'Mark damaged stock as Good' : 'Remove from damaged stock'}
      description={action === 'MarkAsGood' ? 'Moves the quantity from damaged stock back to available stock.' : 'Writes off the quantity permanently. Available stock is not changed.'}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={m.pending}>
            Cancel
          </Button>
          <Button variant={action === 'MarkAsGood' ? 'confirm' : 'delete'} type="submit" form="damaged-form" loading={m.pending}>
            {action === 'MarkAsGood' ? 'Confirm — Mark as Good' : 'Confirm removal'}
          </Button>
        </>
      }
    >
      <form id="damaged-form" onSubmit={submit} noValidate className="space-y-4">
        <Segmented<DamagedActionType>
          label="Action"
          required
          value={action}
          onChange={setAction}
          options={[
            { value: 'MarkAsGood', label: 'Mark as Good', tone: 'green' },
            { value: 'RemoveFromDamaged', label: 'Remove from Damaged', tone: 'red' },
          ]}
        />
        <EntityCombobox<Product>
          label="Product"
          required
          value={product?.id ?? null}
          initialLabel={product?.name}
          onChange={(o) => setProduct(o ? { id: o.id, name: o.label, damaged: o.raw.damagedStock, available: o.raw.availableStock } : null)}
          load={loader}
          error={errors.productId}
          placeholder="Search product with damaged stock…"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Quantity (BOX)" required type="number" min={1} max={product?.damaged} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} error={errors.quantity} hint={product ? `Damaged stock: ${product.damaged} BOX` : undefined} />
          <Input label="Date" required type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} error={errors.businessDate} />
        </div>
        {product && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BeforeAfter label="Damaged stock" before={product.damaged} after={validQty ? product.damaged - n : null} preview />
            <BeforeAfter label="Available stock" before={product.available} after={validQty ? product.available + (action === 'MarkAsGood' ? n : 0) : null} preview />
          </div>
        )}
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} rows={2} maxLength={1000} placeholder={action === 'MarkAsGood' ? 'e.g. Repacked after inspection' : 'e.g. Broken seals, disposed'} />
        {action === 'RemoveFromDamaged' && <Alert tone="warning">This permanently removes the quantity from damaged stock.</Alert>}
      </form>
    </Modal>
  );
}

function DamagedDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery((s) => api.damaged.get(id as string, s), [id], { enabled: !!id, keepPrevious: false });
  const d = q.data;
  return (
    <Modal open={!!id} onClose={onClose} title={d ? label(d.actionType) : 'Damaged stock action'} description={d ? `${d.productName} · ${formatDate(d.businessDate)}` : undefined} footer={<Button variant="cancel" onClick={onClose}>Close</Button>}>
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.reload} compact />
      ) : !d ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          <DetailGrid
            cols={2}
            items={[
              { label: 'Action', value: <StatusBadge value={d.actionType} /> },
              { label: 'Product', value: <Link href={`/inventory/${d.productId}`} className="text-[#0D9488] hover:underline">{d.productName}</Link> },
              { label: 'Quantity', value: `${formatNumber(d.quantity)} BOX` },
              { label: 'Date', value: formatDate(d.businessDate) },
              { label: 'Reason', value: <span className="whitespace-pre-wrap">{d.reason}</span> },
              { label: 'Recorded', value: `${formatDateTime(d.createdAt)}${d.createdBy ? ` by ${d.createdBy}` : ''}` },
            ]}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BeforeAfter label="Damaged stock" before={d.damagedBefore} after={d.damagedAfter} />
            <BeforeAfter label="Available stock" before={d.availableBefore} after={d.availableAfter} />
          </div>
          <ReceiptButtons receiptId={d.receiptId} receiptNumber={d.receiptNumber} />
        </div>
      )}
    </Modal>
  );
}
