'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useMutation } from '@/lib/hooks';
import type { Product, ProductStatus } from '@/lib/types';
import { Button } from './ui/Button';
import { Alert } from './ui/Display';
import { Input, Segmented, Textarea } from './ui/Field';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';

const isWhole = (v: string) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0;
const isPrice = (v: string) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) >= 0);

/** Create product: Name (required), Minimum Stock (required), Selling Price (optional), Status, Opening Stock. */
export function ProductCreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Product) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [minimumStock, setMin] = useState('');
  const [sellingPrice, setPrice] = useState('');
  const [openingStock, setOpening] = useState('0');
  const [status, setStatus] = useState<ProductStatus>('Active');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation((key, body: Parameters<typeof api.products.create>[0]) => api.products.create(body, { idempotencyKey: key }));

  useEffect(() => {
    if (open) {
      setName('');
      setMin('');
      setPrice('');
      setOpening('0');
      setStatus('Active');
      setErrors({});
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!name.trim()) v.name = 'Product name is required.';
    if (!isWhole(minimumStock)) v.minimumStock = 'Enter a whole number (0 or more).';
    if (!isPrice(sellingPrice)) v.sellingPrice = 'Enter a valid amount with up to 2 decimals.';
    if (!isWhole(openingStock)) v.openingStock = 'Enter a whole number (0 or more).';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const p = await m.run({
        name: name.trim(),
        minimumStock: Number(minimumStock),
        sellingPrice: sellingPrice === '' ? undefined : Number(sellingPrice),
        openingStock: Number(openingStock),
        status,
      });
      if (p) {
        toast.success('Product created', `${p.name} added with ${formatNumber(p.openingStock)} BOX opening stock.`);
        onCreated(p);
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error('Could not create product', errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={m.pending}
      title="Add product"
      description="Products are measured in BOX. Opening stock is entered once, at creation."
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={m.pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="product-create" loading={m.pending}>
            Save product
          </Button>
        </>
      }
    >
      <form id="product-create" onSubmit={submit} noValidate className="space-y-4">
        <Input label="Product Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={150} autoComplete="off" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Minimum Stock (BOX)" required type="number" min={0} step={1} inputMode="numeric" value={minimumStock} onChange={(e) => setMin(e.target.value)} error={errors.minimumStock} hint="Low-stock alert threshold" />
          <Input label="Opening Stock (BOX)" required type="number" min={0} step={1} inputMode="numeric" value={openingStock} onChange={(e) => setOpening(e.target.value)} error={errors.openingStock} />
        </div>
        <Input label="Selling Price (KES)" type="number" min={0} step="0.01" inputMode="decimal" value={sellingPrice} onChange={(e) => setPrice(e.target.value)} error={errors.sellingPrice} hint="Optional" />
        <Segmented<ProductStatus>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'Active', label: 'Active', tone: 'green' },
            { value: 'Inactive', label: 'Inactive', tone: 'amber' },
          ]}
        />
      </form>
    </Modal>
  );
}

/** Edit product (history-preserving, reason required, optimistic concurrency via If-Match). */
export function ProductEditModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: (p: Product) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [minimumStock, setMin] = useState('');
  const [sellingPrice, setPrice] = useState('');
  const [status, setStatus] = useState<ProductStatus>('Active');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (product) {
      setName(product.name);
      setMin(String(product.minimumStock));
      setPrice(product.sellingPrice === null ? '' : String(product.sellingPrice));
      setStatus(product.status);
      setReason('');
      setErrors({});
      setConflict(false);
    }
  }, [product]);

  if (!product) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const v: Record<string, string> = {};
    if (!name.trim()) v.name = 'Product name is required.';
    if (!isWhole(minimumStock)) v.minimumStock = 'Enter a whole number (0 or more).';
    if (!isPrice(sellingPrice)) v.sellingPrice = 'Enter a valid amount with up to 2 decimals.';
    if (!reason.trim()) v.reason = 'Reason is required.';
    setErrors(v);
    if (Object.keys(v).length) return;
    const body: Parameters<typeof api.products.update>[1] = { reason: reason.trim() };
    if (name.trim() !== product.name) body.name = name.trim();
    if (Number(minimumStock) !== product.minimumStock) body.minimumStock = Number(minimumStock);
    const newPrice = sellingPrice === '' ? null : Number(sellingPrice);
    if (newPrice !== product.sellingPrice) body.sellingPrice = newPrice;
    if (status !== product.status) body.status = status;
    if (Object.keys(body).length === 1) {
      toast.info('No changes to save');
      return;
    }
    setPending(true);
    try {
      const p = await api.products.update(product.id, body, product.rowVersion);
      toast.success('Product updated', p.name);
      onSaved(p);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        if (err.status === 409 || err.status === 412) setConflict(true);
      }
      toast.error('Could not update product', errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      busy={pending}
      title={`Edit ${product.name}`}
      description="Changes are kept in the product's edit history with your reason."
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="product-edit" loading={pending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="product-edit" onSubmit={submit} noValidate className="space-y-4">
        {conflict && (
          <Alert tone="warning" title="This product was changed elsewhere">
            Close this dialog and reopen it to load the latest version before editing.
          </Alert>
        )}
        <Input label="Product Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={150} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Minimum Stock (BOX)" required type="number" min={0} step={1} value={minimumStock} onChange={(e) => setMin(e.target.value)} error={errors.minimumStock} />
          <Input label="Selling Price (KES)" type="number" min={0} step="0.01" value={sellingPrice} onChange={(e) => setPrice(e.target.value)} error={errors.sellingPrice} hint="Optional — leave empty to clear" />
        </div>
        <Segmented<ProductStatus>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'Active', label: 'Active', tone: 'green' },
            { value: 'Inactive', label: 'Inactive', tone: 'amber' },
          ]}
        />
        {status === 'Inactive' && product.status === 'Active' && (
          <Alert tone="info">Inactive products are kept (never deleted), keep their name reserved, and cannot be selected for new Stock In/Out.</Alert>
        )}
        <Textarea label="Reason for change" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} maxLength={1000} rows={2} />
      </form>
    </Modal>
  );
}

/** Opening stock correction (history-preserving ledger entry, reason required). */
export function OpeningStockModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation((key, id: string, body: { newOpeningStock: number; reason: string }) => api.products.correctOpeningStock(id, body, { idempotencyKey: key }));
  useEffect(() => {
    if (product) {
      setValue(String(product.effectiveOpeningStock));
      setReason('');
      setErrors({});
    }
  }, [product]);
  if (!product) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!isWhole(value)) v.newOpeningStock = 'Enter a whole number (0 or more).';
    else if (Number(value) === product.effectiveOpeningStock) v.newOpeningStock = 'Enter a different value from the current opening stock.';
    if (!reason.trim()) v.reason = 'Reason is required.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      const r = await m.run(product.id, { newOpeningStock: Number(value), reason: reason.trim() });
      if (r) {
        toast.success('Opening stock corrected', `${product.name}: ${formatNumber(r.previousEffectiveOpeningStock)} → ${formatNumber(r.newEffectiveOpeningStock)} BOX`);
        onSaved();
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error('Could not correct opening stock', errorMessage(err));
    }
  };
  return (
    <Modal
      open={!!product}
      onClose={onClose}
      busy={m.pending}
      title="Correct opening stock"
      description={product.name}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={m.pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="opening-form" loading={m.pending}>
            Save correction
          </Button>
        </>
      }
    >
      <form id="opening-form" onSubmit={submit} noValidate className="space-y-4">
        <Alert tone="info">
          The original opening stock ({formatNumber(product.openingStock)} BOX) is preserved. The correction is recorded as a separate ledger entry and cannot make available stock negative.
        </Alert>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Current effective opening stock" value={`${formatNumber(product.effectiveOpeningStock)} BOX`} disabled readOnly />
          <Input label="New opening stock (BOX)" required type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} error={errors.newOpeningStock} />
        </div>
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} rows={2} maxLength={1000} />
      </form>
    </Modal>
  );
}
