import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center dark:bg-slate-950">
      <p className="text-5xl font-bold text-[#0D9488]">404</p>
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Page not found</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">The page you are looking for does not exist.</p>
      <Link href="/" className="mt-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Back to Dashboard
      </Link>
    </div>
  );
}
