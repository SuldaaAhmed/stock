'use client';

import './globals.css';
import { AuthProvider, useAuth } from '../lib/authContext';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { usePathname } from 'next/navigation';

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  if (isLoginPage) {
    return <main className="min-h-screen bg-gray-50 dark:bg-gray-900">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Prime Stock - Stock Management System</title>
        <meta name="description" content="Single warehouse stock management system" />
      </head>
      <body>
        <AuthProvider>
          <AppLayoutContent>{children}</AppLayoutContent>
        </AuthProvider>
      </body>
    </html>
  );
}
