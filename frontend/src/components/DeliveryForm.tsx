'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatNumber, todayNairobi } from '@/lib/format';
import { useMutation } from '@/lib/hooks';
import type { DeliveryResult, OrderDetail } from '@/lib/types';
import { Button } from './ui/Button';
import { Alert, StatusBadge } from './ui/Display';
import { Input, inputClass } from './ui/Field';
import { useToast } from './ui/Toast';

/**
 * Customer Order Delivery (Stock Out §4.5.1): shows Ordered / Delivered / Remaining for each line and lets the
 * Admin deliver all or part of the remaining quantity. Over-delivery is blocked client-side and by the Backend.
 */
export function DeliveryForm({ order, onDelivered, onCancel, formId = 'delivery-form' }: { order: OrderDetail; onDelivered: (r: DeliveryResult) => void; onCancel?: () => void; formId?: string }) {
  const toast = useToast();
  const [date, setDate] = useState(todayNairobi());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<Record<string, number>>({});
  const m = useMutation((key, body: Parameters<typeof api.orders.deliver>[1]) => api.orders.deliver(order.id, body, { idempotencyKey: key }));
  const open = order.lines.filter((l) => l.remainingQuantity > 0);

  useEffect(() => {
    setQty({});
    setErrors({});
    // Fetch the current available stock (display only — the Backend remains authoritative).
    const ctrl = new AbortController();
    Promise.all(open.map((l) => api.products.get(l.productId, ctrl.signal).then((p) => [l.productId, p.availableStock] as const)))
      .then((pairs) => setStock(Object.fromEntries(pairs)))
      .catch(() => undefined);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.rowVersion]);

  const total = useMemo(() => Object.values(qty).reduce((s, v) => s + (Number(v) > 0 ? Number(v) : 0), 0), [qty]);

  const fillAll = () => setQty(Object.fromEntries(open.map((l) => [l.id, String(l.remainingQuantity)])));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    const lines: { orderLineId: string; quantity: number }[] = [];
    order.lines.forEach((l, i) => {
      const raw = qty[l.id];
      if (!raw) return;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) v[`lines.${i}.quantity`] = 'Whole number required.';
      else if (n > l.remainingQuantity) v[`lines.${i}.quantity`] = `Cannot exceed remaining ${l.remainingQuantity}.`;
      else if (n > 0) lines.push({ orderLineId: l.id, quantity: n });
    });
    if (!date) v.deliveryDate = 'Delivery date is required.';
    if (!Object.keys(v).length && !lines.length) v.form = 'Enter a delivery quantity for at least one product.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const r = await m.run({ deliveryDate: date, lines });
      if (r) {
        toast.success('Delivery saved', `${r.delivery.stockOutNumber} · ${formatNumber(r.delivery.totalQuantity)} BOX delivered`);
        onDelivered(r);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        // Map Backend `lines.N.*` (index into submitted lines) back to order-line rows.
        const mapped: Record<string, string> = {};
        for (const [k, msg] of Object.entries(err.fieldErrors)) {
          const mm = /^lines\.(\d+)\./.exec(k);
          if (mm) {
            const sent = lines[Number(mm[1])];
            const idx = order.lines.findIndex((l) => l.id === sent?.orderLineId);
            mapped[`lines.${idx}.quantity`] = msg;
          } else mapped[k] = msg;
        }
        setErrors(mapped);
      }
      toast.error(err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' ? 'Insufficient stock' : 'Could not save delivery', errorMessage(err));
    }
  };

  if (!open.length) return <Alert tone="success">All products on this order have been fully delivered.</Alert>;

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input label="Delivery Date" required type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} error={errors.deliveryDate} className="w-48" />
        <Button type="button" variant="outline" size="sm" onClick={fillAll} disabled={m.pending}>
          Deliver all remaining
        </Button>
      </div>
      {errors.form && <Alert tone="error">{errors.form}</Alert>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Product</th>
              <th className="px-3 py-2 text-right font-semibold">Ordered</th>
              <th className="px-3 py-2 text-right font-semibold">Delivered</th>
              <th className="px-3 py-2 text-right font-semibold">Remaining</th>
              <th className="px-3 py-2 text-right font-semibold">In stock</th>
              <th className="px-3 py-2 text-right font-semibold">Deliver now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {order.lines.map((l, i) => {
              const err = errors[`lines.${i}.quantity`];
              const done = l.remainingQuantity === 0;
              const avail = stock[l.productId];
              const n = Number(qty[l.id] || 0);
              return (
                <tr key={l.id} className={cn('align-top', done && 'opacity-50')}>
                  <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-100">{l.productName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(l.orderedQuantity)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(l.deliveredQuantity)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatNumber(l.remainingQuantity)}</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', avail !== undefined && n > avail ? 'font-semibold text-red-600' : 'text-slate-500')}>{avail === undefined ? '…' : formatNumber(avail)}</td>
                  <td className="px-3 py-2 text-right">
                    {done ? (
                      <span className="text-xs text-slate-400">Done</span>
                    ) : (
                      <>
                        <input
                          type="number"
                          min={0}
                          max={l.remainingQuantity}
                          step={1}
                          inputMode="numeric"
                          aria-label={`Deliver quantity for ${l.productName}`}
                          aria-invalid={!!err || undefined}
                          value={qty[l.id] ?? ''}
                          placeholder="0"
                          onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                          className={cn(inputClass, 'ml-auto h-9 w-24 text-right', err && 'border-red-500')}
                          disabled={m.pending}
                        />
                        {err && <p className="mt-1 text-xs font-medium text-red-600">{err}</p>}
                        {!err && avail !== undefined && n > avail && <p className="mt-1 text-xs text-red-600">Only {formatNumber(avail)} BOX available.</p>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/30">
            <tr>
              <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                Delivering now
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums">{formatNumber(total)} BOX</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Order status: <StatusBadge value={order.status} /> — the order is completed automatically when nothing remains, and a receipt is issued then.
      </p>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="cancel" onClick={onCancel} disabled={m.pending}>
            Cancel
          </Button>
        )}
        <Button variant="confirm" type="submit" loading={m.pending}>
          Save delivery
        </Button>
      </div>
    </form>
  );
}
