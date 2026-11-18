'use client';

import { ArrowLeft, Pencil, Truck, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DeliveryForm } from '@/components/DeliveryForm';
import { OrderFormModal } from '@/components/OrderForm';
import { ReceiptButtons, SavedDocumentModal, type SavedDocument } from '@/components/Receipt';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Alert, Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusBadge } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatNumber, humanize } from '@/lib/format';
import { useQuery } from '@/lib/hooks';
import type { EditHistoryItem } from '@/lib/types';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery((s) => api.orders.get(id, s), [id]);
  const returns = useQuery((s) => api.returns.list({ orderId: id, pageSize: 50 }, s), [id]);
  const [editing, setEditing] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const o = q.data;

  const back = (
    <Link href="/orders" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#0D9488] dark:text-slate-400">
      <ArrowLeft className="h-4 w-4" /> Orders
    </Link>
  );
  if (q.error && !o)
    return (
      <>
        <PageHeader title="Order" back={back} />
        <Card>
          <ErrorState error={q.error} onRetry={q.reload} />
        </Card>
      </>
    );
  if (!o) return <LoadingBlock />;

  const completed = o.status === 'Completed';
  const pct = o.totalOrdered ? Math.round((o.totalDelivered / o.totalOrdered) * 100) : 0;

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{o.number}</span> <StatusBadge value={o.status} />
          </span>
        }
        description={
          <>
            <Link href={`/customers/${o.customerId}`} className="font-medium text-slate-700 hover:text-[#0D9488] dark:text-slate-200">
              {o.customerName}
            </Link>{' '}
            · Ordered {formatDate(o.orderDate)}
          </>
        }
        actions={
          <>
            {o.totalDelivered > 0 && (
              <ButtonLink href={`/returns?new=1&orderId=${o.id}`} variant="outline" icon={<Undo2 className="h-4 w-4" />}>
                Record return
              </ButtonLink>
            )}
            {!completed && (
              <Button variant="edit" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit order
              </Button>
            )}
            {!completed && (
              <Button variant="confirm" icon={<Truck className="h-4 w-4" />} onClick={() => setDelivering(true)}>
                Deliver
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Products" padded={false}>
            <DataTable
              rows={o.lines}
              rowKey={(l) => l.id}
              columns={[
                { key: 'product', header: 'Product', cell: (l) => <Link href={`/inventory/${l.productId}`} className="font-medium hover:text-[#0D9488]">{l.productName}</Link> },
                { key: 'ordered', header: 'Ordered', align: 'right', cell: (l) => formatNumber(l.orderedQuantity) },
                { key: 'delivered', header: 'Delivered', align: 'right', cell: (l) => formatNumber(l.deliveredQuantity) },
                { key: 'remaining', header: 'Remaining', align: 'right', cell: (l) => <span className={cn('font-semibold', l.remainingQuantity > 0 && 'text-amber-600 dark:text-amber-400')}>{formatNumber(l.remainingQuantity)}</span> },
                { key: 'returned', header: 'Returned', align: 'right', cell: (l) => formatNumber(l.returnedQuantity) },
              ]}
            />
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-700">
              <div className="flex items-center gap-2">
                <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-green-600' : 'bg-[#0D9488]')} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <span className="text-slate-500">{pct}% delivered</span>
              </div>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {formatNumber(o.totalDelivered)} / {formatNumber(o.totalOrdered)} BOX · Remaining <b>{formatNumber(o.totalRemaining)}</b>
              </span>
            </div>
          </Card>

          <Card title="Delivery history" padded={false}>
            <DataTable
              rows={o.deliveries}
              rowKey={(d) => d.id}
              empty={<EmptyState title="No deliveries yet" message={completed ? undefined : 'Use “Deliver” to post a full or partial delivery.'} />}
              columns={[
                { key: 'date', header: 'Delivery Date', cell: (d) => formatDate(d.deliveryDate) },
                { key: 'sout', header: 'Stock Out No.', cell: (d) => <Link href={`/stock-out?id=${d.stockOutId}`} className="font-mono text-[#0D9488] hover:underline">{d.stockOutNumber}</Link> },
                { key: 'products', header: 'Products', cell: (d) => <span className="whitespace-normal text-xs">{d.lines.map((l) => `${l.productName} × ${l.quantity}`).join(', ')}</span>, className: 'min-w-[14rem]' },
                { key: 'qty', header: 'Total (BOX)', align: 'right', cell: (d) => <span className="font-semibold">{formatNumber(d.totalQuantity)}</span> },
                { key: 'by', header: 'Admin', cell: (d) => d.createdBy },
              ]}
            />
          </Card>

          <Card title="Edit history" padded={false}>
            <DataTable
              rows={o.editHistory ?? []}
              rowKey={(h) => h.id}
              empty={<EmptyState title="No edits" message="Changes to this order will be listed here with the reason." />}
              columns={[
                { key: 'at', header: 'Date & Time', cell: (h) => formatDateTime(h.createdAt) },
                { key: 'changes', header: 'Changes', cell: (h) => <OrderChanges h={h} />, className: 'min-w-[18rem]' },
                { key: 'reason', header: 'Reason', cell: (h) => <span className="whitespace-normal">{h.reason ?? '—'}</span> },
                { key: 'admin', header: 'Admin', cell: (h) => h.admin ?? '—' },
              ]}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Summary">
            <DetailGrid
              cols={2}
              items={[
                { label: 'Order No.', value: <span className="font-mono">{o.number}</span> },
                { label: 'Status', value: <StatusBadge value={o.status} /> },
                { label: 'Customer', value: o.customerName },
                { label: 'Order Date', value: formatDate(o.orderDate) },
                { label: 'Total Ordered', value: `${formatNumber(o.totalOrdered)} BOX` },
                { label: 'Total Delivered', value: `${formatNumber(o.totalDelivered)} BOX` },
                { label: 'Completed', value: o.completedAt ? formatDateTime(o.completedAt) : '—' },
                { label: 'Created', value: formatDateTime(o.createdAt) },
              ]}
            />
          </Card>
          <Card title="Receipt">
            {completed && o.receiptId ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Receipt <span className="font-mono font-semibold">{o.receiptNumber}</span> was issued when the order was completed.
                </p>
                <ReceiptButtons receiptId={o.receiptId} receiptNumber={o.receiptNumber} size="md" />
              </div>
            ) : (
              <Alert tone="info">The receipt is issued only when the order is completed (all products delivered).</Alert>
            )}
          </Card>
          <Card title="Returns" padded={false}>
            <DataTable
              rows={returns.data?.data}
              loading={returns.loading}
              error={returns.error}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No returns" />}
              columns={[
                { key: 'n', header: 'Return No.', cell: (r) => <Link href={`/returns?id=${r.id}`} className="font-mono text-[#0D9488] hover:underline">{r.number}</Link> },
                { key: 'd', header: 'Date', cell: (r) => formatDate(r.businessDate) },
                { key: 'q', header: 'Good / Damaged', align: 'right', cell: (r) => `${r.goodQuantity} / ${r.damagedQuantity}` },
              ]}
            />
          </Card>
        </div>
      </div>

      <OrderFormModal
        open={editing}
        order={o}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          q.reload();
        }}
      />
      <Modal open={delivering} onClose={() => setDelivering(false)} size="xl" title={`Deliver ${o.number}`} description={`${o.customerName} · deliver all or part of the remaining quantities`}>
        <DeliveryForm
          order={o}
          onCancel={() => setDelivering(false)}
          onDelivered={(r) => {
            setDelivering(false);
            q.reload();
            returns.reload();
            setSaved({
              title: r.order.status === 'Completed' ? 'Delivery saved — order completed' : 'Delivery saved',
              number: r.delivery.stockOutNumber,
              receiptId: r.order.status === 'Completed' ? r.order.receiptId : null,
              receiptNumber: r.order.status === 'Completed' ? r.order.receiptNumber : null,
              details: <p className="text-center text-sm text-slate-600 dark:text-slate-300">{formatNumber(r.delivery.totalQuantity)} BOX delivered. Remaining: {formatNumber(r.order.totalRemaining)} BOX.</p>,
              note: r.order.status === 'Completed' ? undefined : 'The receipt will be issued when the order is completed.',
            });
          }}
        />
      </Modal>
      <SavedDocumentModal doc={saved} onClose={() => setSaved(null)} />
    </>
  );
}

type HistLine = { productId: string; productName: string; orderedQuantity: number; deliveredQuantity: number };

/** Readable diff of an order edit (customer/date/status and per-product ordered quantity). */
function OrderChanges({ h }: { h: EditHistoryItem }) {
  const o = (h.oldValues ?? {}) as Record<string, unknown>;
  const n = (h.newValues ?? {}) as Record<string, unknown>;
  const rows: { k: string; a: string; b: string }[] = [];
  for (const k of ['customerName', 'orderDate', 'status']) {
    if (JSON.stringify(o[k]) !== JSON.stringify(n[k]) && (o[k] !== undefined || n[k] !== undefined)) rows.push({ k: humanize(k), a: String(o[k] ?? '—'), b: String(n[k] ?? '—') });
  }
  const ol = (Array.isArray(o.lines) ? o.lines : []) as HistLine[];
  const nl = (Array.isArray(n.lines) ? n.lines : []) as HistLine[];
  const ids = Array.from(new Set([...ol.map((l) => l.productId), ...nl.map((l) => l.productId)]));
  for (const pid of ids) {
    const a = ol.find((l) => l.productId === pid);
    const b = nl.find((l) => l.productId === pid);
    if (a?.orderedQuantity !== b?.orderedQuantity) rows.push({ k: (b ?? a)!.productName, a: a ? `${a.orderedQuantity}` : 'not on order', b: b ? `${b.orderedQuantity}` : 'removed' });
  }
  if (!rows.length) return <span className="text-slate-400">—</span>;
  return (
    <ul className="space-y-0.5 whitespace-normal">
      {rows.map((r) => (
        <li key={r.k} className="text-xs">
          <span className="font-medium text-slate-600 dark:text-slate-300">{r.k}:</span> <span className="text-red-600 line-through decoration-red-300 dark:text-red-400">{r.a}</span>
          <span className="mx-1 text-slate-400">→</span>
          <span className="text-green-700 dark:text-green-400">{r.b}</span>
        </li>
      ))}
    </ul>
  );
}
