'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { api, SESSION_EXPIRED_EVENT } from './api';
import type { Session, Theme } from './types';

/**
 * Session + theme state.
 * - The session lives in an HttpOnly cookie; we only keep the Admin identity in memory.
 * - The theme preference is stored by the Backend (remembered on next login). A non-sensitive copy is kept in
 *   localStorage purely to avoid a light/dark flash before the session loads.
 */
interface AuthState {
  session: Session | null;
  loading: boolean;
  theme: Theme;
  resolvedTheme: 'Light' | 'Dark';
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setTheme: (t: Theme) => Promise<void>;
  /** Clears local session state (e.g. after restore invalidated all sessions). */
  endSession: (reason?: 'expired' | 'restored') => void;
}

const AuthContext = createContext<AuthState | null>(null);
const THEME_HINT_KEY = 'stock.theme';

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: Theme): 'Light' | 'Dark' {
  const resolved = theme === 'System' ? (systemPrefersDark() ? 'Dark' : 'Light') : theme;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolved === 'Dark');
    document.documentElement.style.colorScheme = resolved === 'Dark' ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_HINT_KEY, theme);
    } catch {
      /* ignore */
    }
  }
  return resolved;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<Theme>('System');
  const [resolvedTheme, setResolved] = useState<'Light' | 'Dark'>('Light');
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const applyThemeState = useCallback((t: Theme) => {
    setThemeState(t);
    setResolved(applyTheme(t));
  }, []);

  // Initial session load (once)
  useEffect(() => {
    let hint: Theme = 'System';
    try {
      hint = (localStorage.getItem(THEME_HINT_KEY) as Theme) || 'System';
    } catch {
      /* ignore */
    }
    applyThemeState(hint);
    const ctrl = new AbortController();
    api.auth
      .me(ctrl.signal)
      .then((s) => {
        setSession(s);
        applyThemeState(s.theme);
      })
      .catch(() => setSession(null))
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [applyThemeState]);

  // Follow OS changes when theme = System
  useEffect(() => {
    if (theme !== 'System' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(applyTheme('System'));
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  const endSession = useCallback(
    (reason?: 'expired' | 'restored') => {
      setSession(null);
      const next = pathRef.current && pathRef.current !== '/login' ? `&next=${encodeURIComponent(pathRef.current)}` : '';
      router.replace(`/login?reason=${reason ?? 'expired'}${reason === 'restored' ? '' : next}`);
    },
    [router],
  );

  // Session expiry / unauthorized responses from any API call
  useEffect(() => {
    const onExpired = () => {
      if (pathRef.current === '/login') return;
      toast.warning('Session expired', 'Please log in again to continue.');
      endSession('expired');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [endSession, toast]);

  const login = useCallback(
    async (username: string, password: string) => {
      const s = await api.auth.login(username, password);
      setSession(s);
      applyThemeState(s.theme);
    },
    [applyThemeState],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* session may already be gone */
    }
    setSession(null);
    router.replace('/login?reason=logout');
  }, [router]);

  const setTheme = useCallback(
    async (t: Theme) => {
      const prev = theme;
      applyThemeState(t);
      try {
        await api.settings.updatePreferences(t);
      } catch (e) {
        applyThemeState(prev);
        throw e;
      }
    },
    [theme, applyThemeState],
  );

  const value = useMemo<AuthState>(
    () => ({ session, loading, theme, resolvedTheme, login, logout, setTheme, endSession }),
    [session, loading, theme, resolvedTheme, login, logout, setTheme, endSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Inline script (runs before hydration) to apply the remembered theme without a flash. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem('${THEME_HINT_KEY}')||'System';var d=t==='Dark'||(t==='System'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;if(d)e.classList.add('dark');e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;
