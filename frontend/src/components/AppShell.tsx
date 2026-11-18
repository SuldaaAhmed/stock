'use client';

import {
  AlertOctagon,
  BarChart3,
  Boxes,
  ChevronDown,
  ClipboardList,
  DatabaseBackup,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PackageMinus,
  PackagePlus,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  Undo2,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/types';
import { LoadingBlock } from './ui/Display';
import { useToast } from './ui/Toast';

/** Confirmed navigation modules (Frontend §3). No Supplier, Purchase or Categories navigation. */
export const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/inventory', label: 'Inventory / Products', icon: Boxes },
  { href: '/stock-in', label: 'Stock In', icon: PackagePlus },
  { href: '/stock-out', label: 'Stock Out', icon: PackageMinus },
  { href: '/orders', label: 'Orders', icon: ClipboardList },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/returns', label: 'Returns', icon: Undo2 },
  { href: '/adjustments', label: 'Stock Adjustments', icon: SlidersHorizontal },
  { href: '/damaged-stock', label: 'Damaged Stock', icon: AlertOctagon },
  { href: '/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { href: '/search', label: 'Global Search', icon: Search },
  { href: '/audit-logs', label: 'Audit Logs', icon: ScrollText },
  { href: '/backups', label: 'Backup Management', icon: DatabaseBackup },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 print:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 dark:border-slate-800">
          <Link href="/" className="flex items-center gap-2.5" onClick={onClose}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D9488] text-white shadow-sm">
              <Warehouse className="h-5 w-5" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold text-slate-900 dark:text-white">Stock Manager</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">Warehouse · KES · BOX</span>
            </span>
          </Link>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]',
                  active
                    ? 'bg-teal-50 text-[#0D9488] dark:bg-teal-900/30 dark:text-teal-300'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                )}
              >
                <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-[#0D9488] dark:text-teal-300' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200')} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-4 text-[11px] text-slate-400 dark:border-slate-800">Kenya time (EAT, UTC+3) · Online only</div>
      </aside>
    </>
  );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'Light', label: 'Light', icon: Sun },
  { value: 'Dark', label: 'Dark', icon: Moon },
  { value: 'System', label: 'System', icon: Monitor },
];

function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useAuth();
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        const next: Theme = resolvedTheme === 'Dark' ? 'Light' : 'Dark';
        setTheme(next).catch(() => toast.error('Could not save theme preference'));
      }}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      aria-label={`Switch to ${resolvedTheme === 'Dark' ? 'light' : 'dark'} theme (current: ${theme})`}
      title="Toggle light / dark theme"
    >
      {resolvedTheme === 'Dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

function AccountMenu() {
  const { session, logout, theme, setTheme } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  const name = session?.admin.username ?? 'Admin';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] dark:hover:bg-slate-800"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0D9488] text-sm font-semibold uppercase text-white">{name.slice(0, 1)}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{name}</span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">Administrator</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Theme</p>
          {THEMES.map((t) => (
            <button
              key={t.value}
              role="menuitemradio"
              aria-checked={theme === t.value}
              onClick={() => setTheme(t.value).catch(() => toast.error('Could not save theme preference'))}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700',
                theme === t.value ? 'font-semibold text-[#0D9488] dark:text-teal-300' : 'text-slate-700 dark:text-slate-200',
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
            <Settings className="h-4 w-4" /> Settings
          </Link>
          <button role="menuitem" onClick={() => void logout()} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState('');
  const current = NAV.find((n) => isActive(pathname, n.href));
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6 print:hidden">
      <button onClick={onMenu} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <p className="hidden min-w-0 truncate text-base font-semibold text-slate-800 dark:text-slate-100 md:block">{current?.label ?? 'Stock Manager'}</p>
      {/* Global search: submitted only on Enter / button (no live search per keystroke) */}
      <form
        role="search"
        className="ml-auto flex w-full max-w-md items-center"
        onSubmit={(e) => {
          e.preventDefault();
          const term = q.trim();
          router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/search');
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search products, customers and document numbers
        </label>
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="global-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, customers, ORD-, SIN-, REC-…"
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0D9488] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
          />
        </div>
      </form>
      <ThemeToggle />
      <AccountMenu />
    </header>
  );
}

/** Authenticated layout with session guard. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.replace(`/login${pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : ''}`);
  }, [loading, session, router, pathname]);

  useEffect(() => setMenu(false), [pathname]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <LoadingBlock label={loading ? 'Loading your session…' : 'Redirecting to login…'} />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setMenu(true)} />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
