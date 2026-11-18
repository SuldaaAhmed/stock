'use client';

import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ChangeList } from '@/components/ChangeList';
import { CustomerFormModal } from '@/components/CustomerForm';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, StatusBadge, Tabs } from '@/components/ui/Display';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { usePaging, useQuery } from '@/lib/hooks';

type Tab = 'orders' | 'returns' | 'history';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [version, setVersion] = useState(0);
  const q = useQuery((s) => api.customers.get(id, s), [id, version]);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('orders');
  const c = q.data;
  const back = (
    <Link href="/customers" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#0D9488] dark:text-slate-400">
      <ArrowLeft className="h-4 w-4" /> Customers
    </Link>
  );
  if (q.error && !c)
    return (
      <>
        <PageHeader title="Customer" back={back} />
        <Card>
          <ErrorState error={q.error} onRetry={q.reload} />
        </Card>
      </>
    );
  if (!c) return <LoadingBlock />;

  return (
    <>
      <PageHeader
        back={back}
        title={c.fullName}
        description={`Customer since ${formatDate(c.createdAt)}`}
        actions={
          <>
            <ButtonLink href={`/orders?new=1`} variant="outline" icon={<Plus className="h-4 w-4" />}>
              New order
            </ButtonLink>
            <Button variant="edit" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Edit customer
            </Button>
          </>
        }
      />
      <Card className="mb-6">
        <DetailGrid
          cols={4}
          items={[
            { label: 'Full Name', value: c.fullName },
            { label: 'Phone', value: c.phone || '—' },
            { label: 'Email', value: c.email || '—' },
            { label: 'Location', value: c.location || '—' },
            { label: 'Notes', value: <span className="whitespace-pre-wrap">{c.notes || '—'}</span> },
            { label: 'Last updated', value: formatDateTime(c.updatedAt) },
          ]}
        />
      </Card>
      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'orders', label: 'Orders' },
              { value: 'returns', label: 'Returns' },
              { value: 'history', label: 'Edit history' },
            ]}
          />
        </div>
        {tab === 'orders' && <OrdersTab customerId={id} />}
        {tab === 'returns' && <ReturnsTab customerId={id} />}
        {tab === 'history' && <HistoryTab customerId={id} version={version} />}
      </Card>
      <CustomerFormModal
        open={editing}
        customer={c}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          setVersion((v) => v + 1);
        }}
      />
    </>
  );
}

function OrdersTab({ customerId }: { customerId: string }) {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const q = useQuery((s) => api.orders.list({ customerId, page, pageSize }, s), [customerId, page, pageSize]);
  return (
    <>
      <DataTable
        rows={q.data?.data}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        rowKey={(o) => o.id}
        empty={<EmptyState title="No orders for this customer" />}
        columns={[
          { key: 'n', header: 'Order No.', cell: (o) => <Link href={`/orders/${o.id}`} className="font-mono font-medium text-[#0D9488] hover:underline">{o.number}</Link> },
          { key: 'd', header: 'Order Date', cell: (o) => formatDate(o.orderDate) },
          { key: 'o', header: 'Ordered', align: 'right', cell: (o) => formatNumber(o.totalOrdered) },
          { key: 'dl', header: 'Delivered', align: 'right', cell: (o) => formatNumber(o.totalDelivered) },
          { key: 'r', header: 'Remaining', align: 'right', cell: (o) => formatNumber(o.totalRemaining) },
          { key: 's', header: 'Status', cell: (o) => <StatusBadge value={o.status} /> },
          { key: 'rc', header: 'Receipt', cell: (o) => <span className="font-mono text-xs text-slate-500">{o.receiptNumber ?? '—'}</span> },
        ]}
      />
      <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}

function ReturnsTab({ customerId }: { customerId: string }) {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const q = useQuery((s) => api.returns.list({ customerId, page, pageSize }, s), [customerId, page, pageSize]);
  return (
    <>
      <DataTable
        rows={q.data?.data}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No returns for this customer" />}
        columns={[
          { key: 'n', header: 'Return No.', cell: (r) => <Link href={`/returns?id=${r.id}`} className="font-mono font-medium text-[#0D9488] hover:underline">{r.number}</Link> },
          { key: 'd', header: 'Date', cell: (r) => formatDate(r.businessDate) },
          { key: 'm', header: 'Mode', cell: (r) => <StatusBadge value={r.returnMode} /> },
          { key: 'o', header: 'Order', cell: (r) => r.orderNumber ?? '—' },
          { key: 'g', header: 'Good', align: 'right', cell: (r) => formatNumber(r.goodQuantity) },
          { key: 'dm', header: 'Damaged', align: 'right', cell: (r) => formatNumber(r.damagedQuantity) },
        ]}
      />
      <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}

function HistoryTab({ customerId, version }: { customerId: string; version: number }) {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const q = useQuery((s) => api.customers.history(customerId, { page, pageSize }, s), [customerId, page, pageSize, version]);
  return (
    <>
      <DataTable
        rows={q.data?.data}
        loading={q.loading}
        error={q.error}
        onRetry={q.reload}
        rowKey={(h) => h.id}
        empty={<EmptyState title="No edits yet" />}
        columns={[
          { key: 'at', header: 'Date & Time', cell: (h) => formatDateTime(h.createdAt) },
          { key: 'c', header: 'Changes (old → new)', cell: (h) => <ChangeList item={h} />, className: 'min-w-[16rem]' },
          { key: 'r', header: 'Reason', cell: (h) => <span className="whitespace-normal">{h.reason ?? '—'}</span> },
          { key: 'a', header: 'Admin', cell: (h) => h.admin ?? '—' },
        ]}
      />
      <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
    </>
  );
}
