'use client';

import { Pencil, Plus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CustomerFormModal } from '@/components/CustomerForm';
import { Button } from '@/components/ui/Button';
import { Card, DataTable, EmptyState, PageHeader, Pagination } from '@/components/ui/Display';
import { FilterBar, SearchBox } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { usePaging, useQuery } from '@/lib/hooks';
import type { Customer } from '@/lib/types';

export default function CustomersPage() {
  const router = useRouter();
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const q = useQuery((s) => api.customers.list({ page, pageSize, search: search || undefined }, s), [page, pageSize, search]);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Customers can be edited but not deleted, so order and receipt history stays intact."
        actions={
          <Button variant="accent" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New customer
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
          <SearchBox value={term} onChange={setTerm} placeholder="Name, phone, email or location…" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        <DataTable<Customer>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/customers/${c.id}`)}
          empty={<EmptyState title={search ? 'No customers match your search' : 'No customers yet'} icon={<Users className="h-6 w-6" />} />}
          columns={[
            { key: 'name', header: 'Full Name', cell: (c) => <span className="font-medium text-slate-900 dark:text-white">{c.fullName}</span> },
            { key: 'phone', header: 'Phone', cell: (c) => c.phone || <span className="text-slate-400">—</span> },
            { key: 'email', header: 'Email', cell: (c) => c.email || <span className="text-slate-400">—</span> },
            { key: 'location', header: 'Location', cell: (c) => c.location || <span className="text-slate-400">—</span> },
            { key: 'orders', header: 'Orders', align: 'right', cell: (c) => c.orderCount ?? '—' },
            { key: 'created', header: 'Added', cell: (c) => formatDate(c.createdAt) },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (c) => (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(c);
                  }}
                  aria-label={`Edit ${c.fullName}`}
                >
                  Edit
                </Button>
              ),
            },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>
      <CustomerFormModal
        open={creating || !!editing}
        customer={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          q.reload();
        }}
      />
    </>
  );
}
