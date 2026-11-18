'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useMutation } from '@/lib/hooks';
import type { Customer, CustomerInput } from '@/lib/types';
import { Button } from './ui/Button';
import { Alert } from './ui/Display';
import { Input, Textarea } from './ui/Field';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create / edit customer. Only Full Name is required; customers are never deleted. */
export function CustomerFormModal({ open, onClose, onSaved, customer }: { open: boolean; onClose: () => void; onSaved: (c: Customer) => void; customer?: Customer | null }) {
  const toast = useToast();
  const [f, setF] = useState({ fullName: '', phone: '', email: '', location: '', notes: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const create = useMutation((key, body: CustomerInput) => api.customers.create(body, { idempotencyKey: key }));
  const pending = create.pending || editPending;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setConflict(false);
    setF({
      fullName: customer?.fullName ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      location: customer?.location ?? '',
      notes: customer?.notes ?? '',
      reason: '',
    });
  }, [open, customer]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const v: Record<string, string> = {};
    if (!f.fullName.trim()) v.fullName = 'Full name is required.';
    if (f.email.trim() && !EMAIL.test(f.email.trim())) v.email = 'Enter a valid email address.';
    setErrors(v);
    if (Object.keys(v).length) return;
    try {
      let c: Customer | undefined;
      if (customer) {
        const body: Partial<CustomerInput> = {};
        const norm = (x: string) => x.trim();
        if (norm(f.fullName) !== customer.fullName) body.fullName = norm(f.fullName);
        if (norm(f.phone) !== (customer.phone ?? '')) body.phone = norm(f.phone);
        if (norm(f.email) !== (customer.email ?? '')) body.email = norm(f.email) || null;
        if (norm(f.location) !== (customer.location ?? '')) body.location = norm(f.location);
        if (norm(f.notes) !== (customer.notes ?? '')) body.notes = norm(f.notes);
        if (!Object.keys(body).length) {
          toast.info('No changes to save');
          return;
        }
        if (f.reason.trim()) body.reason = f.reason.trim();
        setEditPending(true);
        c = await api.customers.update(customer.id, body, customer.rowVersion);
      } else {
        c = await create.run({
          fullName: f.fullName.trim(),
          phone: f.phone.trim() || undefined,
          email: f.email.trim() || undefined,
          location: f.location.trim() || undefined,
          notes: f.notes.trim() || undefined,
        });
      }
      if (c) {
        toast.success(customer ? 'Customer updated' : 'Customer created', c.fullName);
        onSaved(c);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        if (err.status === 409 || err.status === 412) setConflict(true);
      }
      toast.error(customer ? 'Could not update customer' : 'Could not create customer', errorMessage(err));
    } finally {
      setEditPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={pending}
      title={customer ? `Edit ${customer.fullName}` : 'New customer'}
      description={customer ? 'Changes are kept in the customer history. Existing orders keep the original customer name.' : 'Only the full name is required.'}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="save" type="submit" form="customer-form" loading={pending}>
            {customer ? 'Save changes' : 'Save customer'}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} noValidate className="space-y-4">
        {conflict && <Alert tone="warning">This customer was changed elsewhere. Close and reopen to load the latest version.</Alert>}
        <Input label="Full Name" required value={f.fullName} onChange={set('fullName')} error={errors.fullName} maxLength={150} autoComplete="off" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Phone" type="tel" value={f.phone} onChange={set('phone')} error={errors.phone} maxLength={30} placeholder="+254…" />
          <Input label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} maxLength={254} />
        </div>
        <Input label="Location" value={f.location} onChange={set('location')} error={errors.location} maxLength={200} />
        <Textarea label="Notes" value={f.notes} onChange={set('notes')} error={errors.notes} rows={2} maxLength={2000} />
        {customer && <Textarea label="Reason for change" value={f.reason} onChange={set('reason')} error={errors.reason} rows={2} maxLength={1000} hint="Optional — recorded in the customer history" />}
      </form>
    </Modal>
  );
}
