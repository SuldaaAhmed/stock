'use client';

import { Building2, ImagePlus, LogOut, Monitor, Moon, Sun, Trash2, UserCircle2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, Card, DetailGrid, ErrorState, LoadingBlock, PageHeader } from '@/components/ui/Display';
import { Input, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, api, errorMessage, urls } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useQuery } from '@/lib/hooks';
import type { CompanySettings, CompanyUpdate, Theme } from '@/lib/types';

const MAX_LOGO = 2 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SettingsPage() {
  const q = useQuery((s) => api.settings.company(s), []);
  return (
    <>
      <PageHeader title="Settings" description="Company details used on receipts and reports, appearance and account." />
      {q.error && !q.data ? (
        <Card>
          <ErrorState error={q.error} onRetry={q.reload} />
        </Card>
      ) : !q.data ? (
        <LoadingBlock />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <CompanyForm company={q.data} onSaved={q.setData} />
            <LogoCard company={q.data} onChanged={q.setData} />
          </div>
          <div className="space-y-6">
            <AppearanceCard />
            <AccountCard />
          </div>
        </div>
      )}
    </>
  );
}

function CompanyForm({ company, onSaved }: { company: CompanySettings; onSaved: (c: CompanySettings) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ companyName: '', phone: '', email: '', address: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    setF({ companyName: company.companyName, phone: company.phone ?? '', email: company.email ?? '', address: company.address ?? '' });
  }, [company]);
  const dirty = f.companyName !== company.companyName || f.phone !== (company.phone ?? '') || f.email !== (company.email ?? '') || f.address !== (company.address ?? '');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v: Record<string, string> = {};
    if (!f.companyName.trim()) v.companyName = 'Company name is required.';
    if (f.email.trim() && !EMAIL.test(f.email.trim())) v.email = 'Enter a valid email address.';
    setErrors(v);
    if (Object.keys(v).length) return;
    const body: CompanyUpdate = {};
    if (f.companyName.trim() !== company.companyName) body.companyName = f.companyName.trim();
    if (f.phone.trim() !== (company.phone ?? '')) body.phone = f.phone.trim();
    if (f.email.trim() !== (company.email ?? '')) body.email = f.email.trim() || null;
    if (f.address.trim() !== (company.address ?? '')) body.address = f.address.trim();
    setBusy(true);
    try {
      const c = await api.settings.updateCompany(body, company.rowVersion);
      toast.success('Company settings saved', 'New receipts and reports will use these details.');
      setConflict(false);
      onSaved(c);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        if (err.status === 409 || err.status === 412) setConflict(true);
      }
      toast.error('Could not save company settings', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[#0D9488]" /> Company details
        </span>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {conflict && <Alert tone="warning">Settings were changed elsewhere. Reload the page to get the latest version.</Alert>}
        <Input label="Company Name" required value={f.companyName} onChange={set('companyName')} error={errors.companyName} maxLength={150} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Phone Number" type="tel" value={f.phone} onChange={set('phone')} error={errors.phone} maxLength={40} />
          <Input label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} maxLength={254} />
        </div>
        <Textarea label="Address" value={f.address} onChange={set('address')} error={errors.address} rows={2} maxLength={500} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">Last updated {formatDateTime(company.updatedAt)}. Existing receipts keep the details they were issued with.</p>
          <div className="flex gap-2">
            <Button
              variant="reset"
              onClick={() => {
                setF({ companyName: company.companyName, phone: company.phone ?? '', email: company.email ?? '', address: company.address ?? '' });
                setErrors({});
              }}
              disabled={!dirty || busy}
            >
              Reset
            </Button>
            <Button variant="save" type="submit" loading={busy} disabled={!dirty}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function LogoCard({ company, onChanged }: { company: CompanySettings; onChanged: (c: CompanySettings) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'upload' | 'remove'>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('Only PNG or JPEG images are accepted.');
    if (file.size > MAX_LOGO) return setError('The logo must be 2 MB or smaller.');
    setBusy('upload');
    try {
      const c = await api.settings.uploadLogo(file);
      toast.success('Logo uploaded');
      onChanged(c);
    } catch (err) {
      setError(errorMessage(err));
      toast.error('Could not upload logo', errorMessage(err));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      const r = await api.settings.removeLogo();
      const c = (r as { data?: CompanySettings } | undefined)?.data ?? (await api.settings.company());
      toast.success('Logo removed');
      setConfirmRemove(false);
      onChanged(c);
    } catch (err) {
      toast.error('Could not remove logo', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ImagePlus className="h-4 w-4 text-[#0D9488]" /> Company logo
        </span>
      }
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900">
          {company.hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls.logo(company.rowVersion)} alt="Company logo" className="h-full w-full object-contain p-2" />
          ) : (
            <Building2 className="h-10 w-10 text-slate-300 dark:text-slate-600" />
          )}
        </div>
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">Shown on receipts and report exports. PNG or JPEG, up to 2 MB.</p>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="save" icon={<ImagePlus className="h-4 w-4" />} onClick={() => input.current?.click()} loading={busy === 'upload'}>
              {company.hasLogo ? 'Replace logo' : 'Upload logo'}
            </Button>
            {company.hasLogo && (
              <Button variant="delete" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmRemove(true)} disabled={!!busy}>
                Remove
              </Button>
            )}
          </div>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={remove}
        busy={busy === 'remove'}
        variant="delete"
        title="Remove logo?"
        message="New receipts and reports will be generated without a logo. Receipts already issued keep their logo."
        confirmLabel="Remove logo"
      />
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<Theme | null>(null);
  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'Light', label: 'Light', icon: Sun },
    { value: 'Dark', label: 'Dark', icon: Moon },
    { value: 'System', label: 'System', icon: Monitor },
  ];
  return (
    <Card title="Appearance">
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Your theme choice is remembered for your account.</p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={theme === o.value}
            disabled={!!busy}
            onClick={async () => {
              setBusy(o.value);
              try {
                await setTheme(o.value);
              } catch (err) {
                toast.error('Could not save theme', errorMessage(err));
              } finally {
                setBusy(null);
              }
            }}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]',
              theme === o.value ? 'border-[#0D9488] bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200' : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300',
            )}
          >
            <o.icon className="h-5 w-5" />
            {o.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function AccountCard() {
  const { session, logout } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <UserCircle2 className="h-4 w-4 text-[#0D9488]" /> Account
        </span>
      }
    >
      <DetailGrid
        cols={2}
        items={[
          { label: 'Username', value: session?.admin.username ?? '—' },
          { label: 'Role', value: 'Admin' },
          { label: 'Session expires', value: session ? formatDateTime(session.expiresAt) : '—' },
          { label: 'Latest sign-out', value: session ? formatDateTime(session.absoluteExpiresAt) : '—' },
        ]}
      />
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Password changes are done by the system administrator on the server.</p>
      <Button variant="delete" className="mt-4 w-full" icon={<LogOut className="h-4 w-4" />} onClick={() => setConfirm(true)}>
        Log out
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await logout();
          } finally {
            setBusy(false);
          }
        }}
        title="Log out?"
        message="You will need to sign in again to continue."
        confirmLabel="Log out"
        variant="delete"
      />
    </Card>
  );
}
