'use client';

import { History, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useDetailParam } from '@/components/DocumentParts';
import { PeriodFilter, periodParams, type PeriodValue } from '@/components/PeriodFilter';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card, DataTable, DetailGrid, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '@/components/ui/Display';
import { FilterBar, FilterCheck, FilterSelect, SearchBox, Textarea } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, humanize, label } from '@/lib/format';
import { usePaging, useQuery } from '@/lib/hooks';
import { resourceHref } from '@/lib/links';
import type { AuditLog } from '@/lib/types';

const ENTITY_TYPES = ['Product', 'Customer', 'Order', 'StockIn', 'StockOut', 'Return', 'Adjustment', 'DamagedStockAction', 'Receipt', 'CompanySettings', 'Backup', 'AuditLog', 'Admin'];

export default function AuditLogsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <AuditContent />
    </Suspense>
  );
}

function AuditContent() {
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const [period, setPeriod] = useState<PeriodValue>({ period: '' });
  const [entityType, setEntityType] = useState('');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [detailId, openDetail, closeDetail] = useDetailParam();

  const q = useQuery(
    (s) => api.auditLogs.list({ page, pageSize, entityType: entityType || undefined, includeDeleted: includeDeleted || undefined, search: search || undefined, ...periodParams(period) }, s),
    [page, pageSize, entityType, includeDeleted, search, period],
  );

  return (
    <>
      <PageHeader title="Audit Logs" description="Every important Admin action with date & time and old/new data. Edits and deletions keep a correction trail." />
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
            label="Record type"
            value={entityType}
            onChange={(v) => {
              setEntityType(v);
              setPage(1);
            }}
            options={[{ value: '', label: 'All records' }, ...ENTITY_TYPES.map((t) => ({ value: t, label: label(t) }))]}
          />
          <SearchBox value={term} onChange={setTerm} placeholder="Action, description, record id…" />
          <FilterCheck
            label="Include deleted"
            checked={includeDeleted}
            onChange={(v) => {
              setIncludeDeleted(v);
              setPage(1);
            }}
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </FilterBar>
        <DataTable<AuditLog>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(r) => String(r.id)}
          onRowClick={(r) => openDetail(String(r.id))}
          empty={<EmptyState title="No audit entries" icon={<History className="h-6 w-6" />} />}
          columns={[
            { key: 'at', header: 'Date & Time', cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</span> },
            {
              key: 'action',
              header: 'Action',
              cell: (r) => (
                <span className={cn('flex items-center gap-1.5 font-medium', r.isDeleted && 'text-slate-400 line-through')}>
                  {humanize(r.action.replace('.', ' '))}
                  {r.editedAt && <Badge tone="blue">Edited</Badge>}
                  {r.isDeleted && <Badge tone="red">Deleted</Badge>}
                </span>
              ),
            },
            { key: 'entity', header: 'Record', cell: (r) => label(r.entityType) },
            { key: 'desc', header: 'Description', cell: (r) => <span className="line-clamp-1 max-w-[22rem] whitespace-normal text-slate-600 dark:text-slate-300">{r.description ?? '—'}</span> },
            { key: 'admin', header: 'Admin', cell: (r) => r.actor ?? 'System' },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>
      <AuditDetailModal id={detailId ? Number(detailId) : null} onClose={closeDetail} onChanged={q.reload} />
    </>
  );
}

function DataDiff({ oldData, newData }: { oldData: Record<string, unknown> | null; newData: Record<string, unknown> | null }) {
  const pretty = (v: unknown) => (v === null || v === undefined ? '—' : JSON.stringify(v, null, 2));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {(
        [
          ['Old data', oldData, 'border-red-200 dark:border-red-900/60'],
          ['New data', newData, 'border-green-200 dark:border-green-900/60'],
        ] as const
      ).map(([t, d, c]) => (
        <div key={t} className={cn('rounded-xl border', c)}>
          <p className="border-b border-inherit px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t}</p>
          <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">{pretty(d)}</pre>
        </div>
      ))}
    </div>
  );
}

function AuditDetailModal({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const q = useQuery((s) => api.auditLogs.get(id as number, s), [id, version], { enabled: id !== null, keepPrevious: false });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [desc, setDesc] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const d = q.data;

  useEffect(() => {
    if (editing && d) {
      setDesc(d.description ?? '');
      setNote(d.note ?? '');
      setReason('');
      setErrors({});
    }
  }, [editing, d]);

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d || busy) return;
    const v: Record<string, string> = {};
    if (!reason.trim()) v.reason = 'Reason is required.';
    if (desc === (d.description ?? '') && note === (d.note ?? '')) v.description = 'Change the description or note.';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await api.auditLogs.update(d.id, { description: desc, note, reason: reason.trim() });
      toast.success('Audit entry updated', 'The change was added to the correction trail.');
      setEditing(false);
      setVersion((x) => x + 1);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error('Could not update audit entry', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (r: string) => {
    if (!d) return;
    setBusy(true);
    try {
      await api.auditLogs.remove(d.id, r);
      toast.success('Audit entry deleted', 'It is hidden from the default view and kept in the correction trail.');
      setDeleting(false);
      setVersion((x) => x + 1);
      onChanged();
    } catch (err) {
      toast.error('Could not delete audit entry', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const href = d?.entityId ? resourceHref(d.entityType, d.entityId) : null;
  return (
    <>
      <Modal
        open={id !== null && !deleting}
        onClose={() => (editing ? setEditing(false) : onClose())}
        busy={busy}
        size="xl"
        title={d ? humanize(d.action.replace('.', ' ')) : 'Audit entry'}
        description={d ? `${formatDateTime(d.occurredAt)} · ${d.actor ?? 'System'}` : undefined}
        footer={
          d &&
          (editing ? (
            <>
              <Button variant="cancel" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="save" type="submit" form="audit-edit" loading={busy}>
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="cancel" onClick={onClose}>
                Close
              </Button>
              {!d.isDeleted && (
                <>
                  <Button variant="delete" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>
                    Delete
                  </Button>
                  <Button variant="edit" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                </>
              )}
            </>
          ))
        }
      >
        {q.error ? (
          <ErrorState error={q.error} onRetry={q.reload} compact />
        ) : !d ? (
          <LoadingBlock />
        ) : editing ? (
          <form id="audit-edit" onSubmit={saveEdit} noValidate className="space-y-4">
            <Alert tone="info">Only the description and note can be edited. The original values are kept in the correction trail.</Alert>
            <Textarea label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} error={errors.description} rows={3} maxLength={2000} />
            <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} rows={2} maxLength={2000} />
            <Textarea label="Reason for change" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} rows={2} maxLength={1000} />
          </form>
        ) : (
          <div className="space-y-5">
            {d.isDeleted && <Alert tone="warning" title="Deleted entry">This entry was deleted on {formatDateTime(d.deletedAt)}. It is kept for the correction trail.</Alert>}
            <DetailGrid
              items={[
                { label: 'Action', value: d.action },
                { label: 'Record', value: href ? <Link href={href} className="text-[#0D9488] hover:underline">{label(d.entityType)}</Link> : label(d.entityType) },
                { label: 'Date & Time', value: formatDateTime(d.occurredAt) },
                { label: 'Admin', value: d.actor ?? 'System' },
                { label: 'Description', value: <span className="whitespace-pre-wrap">{d.description ?? '—'}</span> },
                { label: 'Note', value: <span className="whitespace-pre-wrap">{d.note ?? '—'}</span> },
                { label: 'IP address', value: d.ipAddress ?? '—' },
                { label: 'Request ID', value: <span className="break-all font-mono text-xs">{d.requestId ?? '—'}</span> },
                { label: 'Last edited', value: d.editedAt ? formatDateTime(d.editedAt) : '—' },
              ]}
            />
            <DataDiff oldData={d.oldData} newData={d.newData} />
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <History className="h-3.5 w-3.5" /> Correction trail
              </p>
              {!d.corrections?.length ? (
                <p className="text-sm text-slate-500">No edits or deletions.</p>
              ) : (
                <ol className="space-y-2">
                  {d.corrections.map((c) => (
                    <li key={c.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={c.operation === 'Delete' ? 'red' : 'blue'}>{c.operation}</Badge>
                        <span className="text-slate-500">{formatDateTime(c.createdAt)} · {c.admin ?? '—'}</span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-200">
                        <span className="font-medium">Reason:</span> {c.reason}
                      </p>
                      {c.operation === 'Edit' && (
                        <div className="mt-1 text-xs text-slate-500">
                          {Object.keys({ ...(c.oldValues ?? {}), ...(c.newValues ?? {}) }).map((k) => (
                            <p key={k}>
                              {humanize(k)}: <span className="text-red-600 line-through">{String(c.oldValues?.[k] ?? '—')}</span> → <span className="text-green-700 dark:text-green-400">{String(c.newValues?.[k] ?? '—')}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={doDelete}
        busy={busy}
        variant="delete"
        title="Delete audit entry?"
        message="The entry will be hidden from the default view. The deletion and your reason are recorded in the correction trail and cannot be undone."
        confirmLabel="Delete entry"
        requireReason
      />
    </>
  );
}
