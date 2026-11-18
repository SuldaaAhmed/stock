'use client';

import { Eye, EyeOff, Lock, User, Warehouse } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, LoadingBlock } from '@/components/ui/Display';
import { inputClass, Label } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

const REASONS: Record<string, { tone: 'info' | 'warning'; text: string }> = {
  expired: { tone: 'warning', text: 'Your session has expired. Please log in again.' },
  logout: { tone: 'info', text: 'You have been logged out.' },
  restored: { tone: 'info', text: 'A backup was restored and all sessions were signed out. Please log in again.' },
};

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

function LoginForm() {
  const { login, session, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const reason = REASONS[params.get('reason') ?? ''];

  useEffect(() => {
    if (!loading && session) router.replace(safeNext(params.get('next')));
  }, [loading, session, router, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v: typeof errors = {};
    if (!username.trim()) v.username = 'Username is required.';
    if (!password) v.password = 'Password is required.';
    setErrors(v);
    setError(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await login(username.trim(), password);
      setPassword('');
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      setPassword('');
      if (err instanceof ApiError && err.status === 429) {
        setError(err.message || 'Too many failed attempts. Please wait before trying again.');
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setError('Invalid username or password.');
      } else if (err instanceof ApiError && err.status === 0) {
        setError('Cannot reach the server. Check your internet connection.');
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-teal-50 px-4 py-10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D9488] text-white shadow-lg shadow-teal-600/20">
            <Warehouse className="h-7 w-7" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Stock Manager</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sign in to the Admin workspace</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none sm:p-8">
          {reason && !error && (
            <Alert tone={reason.tone} className="mb-5">
              {reason.text}
            </Alert>
          )}
          {error && (
            <Alert tone="error" className="mb-5">
              {error}
            </Alert>
          )}
          <form onSubmit={submit} noValidate className="space-y-5">
            <div>
              <Label htmlFor="username" required>
                Username
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={!!errors.username || undefined}
                  className={cn(inputClass, 'h-11 pl-9', errors.username && 'border-red-500')}
                  disabled={busy}
                />
              </div>
              {errors.username && <p className="mt-1 text-xs font-medium text-red-600">{errors.username}</p>}
            </div>
            <div>
              <Label htmlFor="password" required>
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  name="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!errors.password || undefined}
                  className={cn(inputClass, 'h-11 pl-9 pr-10', errors.password && 'border-red-500')}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs font-medium text-red-600">{errors.password}</p>}
            </div>
            <Button type="submit" variant="accent" size="lg" loading={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Forgot your password? Password reset is done by the system administrator on the server.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <LoginForm />
    </Suspense>
  );
}
