'use client';

import { Pencil, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ProductCreateModal, ProductEditModal } from '@/components/ProductForms';
import { Button } from '@/components/ui/Button';
import { Badge, Card, DataTable, EmptyState, PageHeader, Pagination, StatusBadge } from '@/components/ui/Display';
import { inputClass } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/format';
import { usePaging, useQuery } from '@/lib/hooks';
import type { Product } from '@/lib/types';

export default function InventoryPage() {
  const router = useRouter();
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const q = useQuery(
    (s) => api.products.list({ page, pageSize, search: search || undefined, status: status || undefined, lowStock: lowStock || undefined }, s),
    [page, pageSize, search, status, lowStock],
  );

  return (
    <>
      <PageHeader
        title="Inventory / Products"
        description="Current, minimum and damaged stock per product (BOX). Products are deactivated, never deleted."
        actions={
          <Button variant="accent" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Add product
          </Button>
        }
      />
      <Card padded={false}>
        <form
          className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-700 md:flex-row md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(term.trim());
            setPage(1);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className={inputClass + ' pl-9'} placeholder="Search product name…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search products" />
          </div>
          <select
            className={inputClass + ' md:w-40'}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Status filter"
          >
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <label className="flex h-10 items-center gap-2 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={lowStock}
              onChange={(e) => {
                setLowStock(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-[#0D9488] focus:ring-[#0D9488]"
            />
            Low stock only
          </label>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <DataTable<Product>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(p) => p.id}
          onRowClick={(p) => router.push(`/inventory/${p.id}`)}
          empty={
            <EmptyState
              title={search || status || lowStock ? 'No products match your filters' : 'No products yet'}
              message={search || status || lowStock ? 'Try a different search or clear the filters.' : 'Add your first product to start tracking stock.'}
              action={
                !search && !status && !lowStock ? (
                  <Button variant="accent" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                    Add product
                  </Button>
                ) : undefined
              }
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Product Name',
              cell: (p) => (
                <span className="flex items-center gap-2">
                  <Link href={`/inventory/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-900 hover:text-[#0D9488] dark:text-white">
                    {p.name}
                  </Link>
                  {p.isLowStock && <Badge tone="amber">Low stock</Badge>}
                </span>
              ),
            },
            {
              key: 'current',
              header: 'Current Stock',
              align: 'right',
              cell: (p) => <span className={p.isLowStock ? 'font-semibold text-red-600 dark:text-red-400' : 'font-semibold'}>{formatNumber(p.currentStock)}</span>,
            },
            { key: 'min', header: 'Minimum Stock', align: 'right', cell: (p) => formatNumber(p.minimumStock) },
            { key: 'price', header: 'Selling Price', align: 'right', cell: (p) => (p.sellingPrice === null ? <span className="text-slate-400">—</span> : formatMoney(p.sellingPrice)) },
            { key: 'damaged', header: 'Damaged Stock', align: 'right', cell: (p) => (p.damagedStock ? <span className="text-red-600 dark:text-red-400">{formatNumber(p.damagedStock)}</span> : '0') },
            { key: 'status', header: 'Status', cell: (p) => <StatusBadge value={p.status} /> },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (p) => (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(p);
                  }}
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  aria-label={`Edit ${p.name}`}
                >
                  Edit
                </Button>
              ),
            },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">All quantities are in BOX. Selling price in KES.</p>

      <ProductCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          q.reload();
        }}
      />
      <ProductEditModal
        product={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          q.reload();
        }}
      />
    </>
  );
}
