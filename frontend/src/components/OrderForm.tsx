'use client';

import { Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatNumber, todayNairobi } from '@/lib/format';
import { useMutation } from '@/lib/hooks';
import type { Customer, OrderDetail, Product } from '@/lib/types';
import { EntityCombobox, loadCustomers, productLoader } from './EntityCombobox';
import { Button } from './ui/Button';
import { Alert } from './ui/Display';
import { FieldError, Input, inputClass, Textarea } from './ui/Field';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';

interface OrderLineDraft {
  key: string;
  id?: string;
  productId: string;
  productName: string;
  orderedQuantity: string;
  delivered: number;
}

let seq = 0;
const blank = (): OrderLineDraft => ({ key: `ol${++seq}`, productId: '', productName: '', orderedQuantity: '', delivered: 0 });

/**
 * Create / edit a customer order. Orders do not check or reserve stock.
 * When editing a Partially Completed order only remaining quantities can change: ordered ≥ delivered,
 * delivered lines cannot be removed and their product is locked (Backend enforces the same rules).
 */
export function OrderFormModal({ open, onClose, onSaved, order }: { open: boolean; onClose: () => void; onSaved: (o: OrderDetail) => void; order?: OrderDetail | null }) {
  const toast = useToast();
  const editing = !!order;
  const hasDeliveries = !!order && order.deliveries.length > 0;
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [date, setDate] = useState(todayNairobi());
  const [lines, setLines] = useState<OrderLineDraft[]>([blank()]);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingEdit, setPendingEdit] = useState(false);
  const create = useMutation((key, body: Parameters<typeof api.orders.create>[0]) => api.orders.create(body, { idempotencyKey: key }));
  const pending = create.pending || pendingEdit;
  const loader = useMemo(() => productLoader({ activeOnly: true }), []);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setReason('');
    if (order) {
      setCustomer({ id: order.customerId, name: order.customerName });
      setDate(order.orderDate);
      setLines(order.lines.map((l) => ({ key: l.id, id: l.id, productId: l.productId, productName: l.productName, orderedQuantity: String(l.orderedQuantity), delivered: l.deliveredQuantity })));
    } else {
      setCustomer(null);
      setDate(todayNairobi());
      setLines([blank()]);
    }
  }, [open, order]);

  const update = (i: number, patch: Partial<OrderLineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.orderedQuantity) > 0 ? Number(l.orderedQuantity) : 0), 0);

  const validate = () => {
    const v: Record<string, string> = {};
    if (!customer) v.customerId = 'Select a customer.';
    if (!date) v.orderDate = 'Order date is required.';
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      if (!l.productId) v[`lines.${i}.productId`] = 'Select a product.';
      else if (seen.has(l.productId)) v[`lines.${i}.productId`] = 'Product already on this order.';
      seen.add(l.productId);
      const n = Number(l.orderedQuantity);
      if (!l.orderedQuantity) v[`lines.${i}.orderedQuantity`] = 'Enter a quantity.';
      else if (!Number.isInteger(n) || n <= 0) v[`lines.${i}.orderedQuantity`] = 'Whole number greater than 0.';
      else if (n < l.delivered) v[`lines.${i}.orderedQuantity`] = `Cannot be below delivered (${l.delivered}).`;
    });
    if (!lines.length) v.lines = 'Add at least one product.';
    return v;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      let o: OrderDetail | undefined;
      if (order) {
        setPendingEdit(true);
        o = await api.orders.update(
          order.id,
          {
            customerId: !hasDeliveries && customer!.id !== order.customerId ? customer!.id : undefined,
            orderDate: !hasDeliveries && date !== order.orderDate ? date : undefined,
            lines: lines.map((l) => ({ id: l.id, productId: l.productId, orderedQuantity: Number(l.orderedQuantity) })),
            reason: reason.trim() || undefined,
          },
          order.rowVersion,
        );
      } else {
        o = await create.run({ customerId: customer!.id, orderDate: date, lines: lines.map((l) => ({ productId: l.productId, orderedQuantity: Number(l.orderedQuantity) })) });
      }
      if (o) {
        toast.success(editing ? 'Order updated' : 'Order created', `${o.number} · ${formatNumber(o.totalOrdered)} BOX ordered`);
        onSaved(o);
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(editing ? 'Could not update order' : 'Could not create order', errorMessage(err));
    } finally {
      setPendingEdit(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={pending}
      size="xl"
      title={order ? `Edit ${order.number}` : 'New customer order'}
      description={order ? (hasDeliveries ? 'Delivered quantities are locked; only remaining quantities can change.' : 'Pending order — customer, date and products can be changed.') : 'Orders do not reduce or reserve stock. Stock decreases only when a delivery is saved.'}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="order-form" loading={pending}>
            {order ? 'Save changes' : 'Create order'}
          </Button>
        </>
      }
    >
      <form id="order-form" onSubmit={submit} noValidate className="space-y-5">
        {errors.body && <Alert tone="warning">{errors.body}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EntityCombobox<Customer>
            label="Customer"
            required
            value={customer?.id ?? null}
            initialLabel={customer?.name}
            onChange={(o) => setCustomer(o ? { id: o.id, name: o.label } : null)}
            load={loadCustomers}
            error={errors.customerId}
            disabled={hasDeliveries}
            placeholder="Search customer name or phone…"
          />
          <Input label="Order Date" required type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} error={errors.orderDate} disabled={hasDeliveries} />
        </div>
        {hasDeliveries && (
          <p className="-mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Lock className="h-3.5 w-3.5" /> Customer and order date are locked because deliveries exist.
          </p>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Products<span className="ml-0.5 text-red-600">*</span>
            </span>
            <span className="text-xs text-slate-500">All quantities in BOX</span>
          </div>
          <div className="space-y-3">
            {lines.map((l, i) => {
              const locked = l.delivered > 0;
              return (
                <div key={l.key} className="grid grid-cols-12 items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="col-span-12 sm:col-span-6">
                    <EntityCombobox<Product>
                      value={l.productId || null}
                      initialLabel={l.productName}
                      onChange={(o) => update(i, { productId: o?.id ?? '', productName: o?.label ?? '' })}
                      load={loader}
                      error={errors[`lines.${i}.productId`]}
                      disabled={locked || pending}
                      placeholder="Search product…"
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <input
                      type="number"
                      min={Math.max(1, l.delivered)}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Ordered quantity line ${i + 1}`}
                      placeholder="Ordered qty"
                      value={l.orderedQuantity}
                      onChange={(e) => update(i, { orderedQuantity: e.target.value })}
                      className={cn(inputClass, errors[`lines.${i}.orderedQuantity`] && 'border-red-500')}
                      disabled={pending}
                    />
                    <FieldError message={errors[`lines.${i}.orderedQuantity`]} />
                  </div>
                  <div className="col-span-4 flex h-10 items-center text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
                    {editing && (
                      <span>
                        Delivered <span className="font-semibold text-slate-700 dark:text-slate-200">{l.delivered}</span>
                        {Number(l.orderedQuantity) >= l.delivered && (
                          <>
                            <br />
                            Remaining <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.max(0, Number(l.orderedQuantity) - l.delivered)}</span>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 flex h-10 items-center justify-end sm:col-span-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      disabled={locked || lines.length === 1 || pending}
                      aria-label={`Remove line ${i + 1}`}
                      title={locked ? 'Lines with delivered quantity cannot be removed' : 'Remove line'}
                    >
                      {locked ? <Lock className="h-4 w-4" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <FieldError message={errors.lines} />
          <div className="mt-3 flex items-center justify-between">
            <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((ls) => [...ls, blank()])} disabled={pending}>
              Add product
            </Button>
            <span className="text-sm text-slate-600 dark:text-slate-300">
              Total ordered: <span className="font-bold tabular-nums">{formatNumber(total)} BOX</span>
            </span>
          </div>
        </div>
        {editing && <Textarea label="Reason for edit" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} hint="Recorded in the order edit history" error={errors.reason} />}
      </form>
    </Modal>
  );
}
