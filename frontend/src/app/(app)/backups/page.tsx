'use client';

import { CalendarClock, DatabaseBackup, Download, HardDrive, Infinity as InfinityIcon, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Alert, Card, DataTable, EmptyState, PageHeader, Pagination, StatusBadge } from '@/components/ui/Display';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { api, errorMessage, urls } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBytes, formatDateTime, label } from '@/lib/format';
import { useMutation, usePaging, useQuery } from '@/lib/hooks';
import type { BackupLog } from '@/lib/types';

export default function BackupsPage() {
  const toast = useToast();
  const { endSession } = useAuth();
  const { page, setPage, pageSize, setPageSize } = usePaging(10);
  const q = useQuery((s) => api.backups.list({ page, pageSize }, s), [page, pageSize]);
  const [restoring, setRestoring] = useState<BackupLog | null>(null);
  const create = useMutation((key) => api.backups.create({ idempotencyKey: key }));
  const restore = useMutation((key, id: string) => api.backups.restore(id, { idempotencyKey: key }));

  const runBackup = async () => {
    try {
      const b = await create.run();
      if (b) toast.success('Backup completed', `${formatBytes(b.sizeBytes)} saved · ${formatDateTime(b.completedAt)}`);
      q.reload();
    } catch (err) {
      toast.error('Backup failed', errorMessage(err));
      q.reload();
    }
  };

  const doRestore = async () => {
    if (!restoring) return;
    try {
      await restore.run(restoring.id);
      toast.success('Backup restored', 'All sessions were signed out. Please log in again.');
      setRestoring(null);
      endSession('restored');
    } catch (err) {
      toast.error('Restore failed', errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Backups"
        description="Full database backups including logo files, encrypted at rest."
        actions={
          <Button variant="save" icon={<DatabaseBackup className="h-4 w-4" />} onClick={runBackup} loading={create.pending}>
            {create.pending ? 'Backing up…' : 'Run backup now'}
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoTile icon={<CalendarClock className="h-5 w-5" />} title="Automatic daily backup" text="Every day at 12:00 AM (midnight) Kenya time (Africa/Nairobi)." />
        <InfoTile icon={<InfinityIcon className="h-5 w-5" />} title="Retention" text="Backups are kept forever. They are never deleted automatically." />
        <InfoTile icon={<HardDrive className="h-5 w-5" />} title="Restore safety" text="A safety backup is taken automatically before any restore." />
      </div>
      <Card padded={false} title="Backup & restore history">
        <DataTable<BackupLog>
          rows={q.data?.data}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          rowKey={(b) => b.id}
          empty={<EmptyState title="No backups yet" message="Run a manual backup or wait for the nightly automatic backup." icon={<DatabaseBackup className="h-6 w-6" />} />}
          columns={[
            { key: 'start', header: 'Started', cell: (b) => <span className="whitespace-nowrap">{formatDateTime(b.startedAt)}</span> },
            { key: 'op', header: 'Operation', cell: (b) => <span className="font-medium">{label(b.operation)}</span> },
            { key: 'trigger', header: 'Trigger', cell: (b) => label(b.trigger) },
            { key: 'status', header: 'Status', cell: (b) => <StatusBadge value={b.status} /> },
            { key: 'size', header: 'Size', align: 'right', cell: (b) => (b.sizeBytes ? formatBytes(b.sizeBytes) : '—') },
            { key: 'by', header: 'Admin', cell: (b) => b.actor ?? 'System' },
            {
              key: 'err',
              header: 'Details',
              cell: (b) =>
                b.error ? <span className="line-clamp-1 max-w-[14rem] whitespace-normal text-xs text-red-600">{b.error}</span> : b.completedAt ? <span className="text-xs text-slate-500">Done {formatDateTime(b.completedAt)}</span> : '—',
            },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (b) =>
                b.operation === 'Backup' && b.status === 'Succeeded' ? (
                  <div className="flex justify-end gap-1.5">
                    <ButtonLink href={b.downloadUrl ?? urls.backupDownload(b.id)} download size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />}>
                      Download
                    </ButtonLink>
                    <Button size="sm" variant="outline" className="text-red-600" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setRestoring(b)}>
                      Restore
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
        <Pagination meta={q.data?.meta} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <ConfirmDialog
        open={!!restoring}
        onClose={() => setRestoring(null)}
        onConfirm={doRestore}
        busy={restore.pending}
        variant="delete"
        title="Restore this backup?"
        confirmLabel="Restore backup"
        confirmText="RESTORE"
        message={
          <div className="space-y-3">
            <p>
              All current data will be replaced with the backup from <b>{restoring ? formatDateTime(restoring.startedAt) : ''}</b>.
            </p>
            <Alert tone="warning">A safety backup of the current data is taken first. After restoring, every session is signed out and you must log in again.</Alert>
            <p className="text-sm">
              Type <span className="font-mono font-bold">RESTORE</span> to confirm.
            </p>
          </div>
        }
      />
    </>
  );
}

function InfoTile({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/60">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-[#0D9488] dark:bg-teal-900/30 dark:text-teal-300">{icon}</span>
      <div>
        <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
      </div>
    </div>
  );
}
