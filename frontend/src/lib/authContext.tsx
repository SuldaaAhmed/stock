'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api } from './api';

interface AdminUser {
  id: string;
  username: string;
}

interface AuthContextType {
  user: AdminUser | null;
  theme: 'Light' | 'Dark';
  loading: boolean;
  login: (userData: AdminUser, userTheme: 'Light' | 'Dark') => void;
  logout: () => Promise<void>;
  toggleTheme: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [theme, setTheme] = useState<'Light' | 'Dark'>('Light');
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check current session
    api.auth
      .me()
      .then((res) => {
        if (res.data?.admin) {
          setUser(res.data.admin);
          setTheme(res.data.theme || 'Light');
          if (res.data.theme === 'Dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
      })
      .catch(() => {
        setUser(null);
        if (pathname !== '/login') {
          router.push('/login');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [pathname, router]);

  const login = (userData: AdminUser, userTheme: 'Light' | 'Dark') => {
    setUser(userData);
    setTheme(userTheme);
    if (userTheme === 'Dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    router.push('/');
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch (e) {
      // ignore
    }
    setUser(null);
    router.push('/login');
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'Light' ? 'Dark' : 'Light';
    setTheme(nextTheme);
    if (nextTheme === 'Dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <AuthContext.Provider value={{ user, theme, loading, login, logout, toggleTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
