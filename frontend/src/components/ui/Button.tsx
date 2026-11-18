'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Button variants follow Frontend Requirements §5 (Button colors):
 *  save/edit = blue #2563EB · cancel/reset = neutral slate · delete = red #DC2626
 *  confirm = green #16A34A · print = slate #475569 · primary/accent = teal #0D9488
 */
export type ButtonVariant = 'save' | 'edit' | 'cancel' | 'reset' | 'delete' | 'confirm' | 'print' | 'accent' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  save: 'bg-[#2563EB] text-white hover:bg-blue-700 focus-visible:ring-blue-500',
  edit: 'bg-[#2563EB] text-white hover:bg-blue-700 focus-visible:ring-blue-500',
  cancel:
    'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 focus-visible:ring-slate-400',
  reset:
    'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 focus-visible:ring-slate-400',
  delete: 'bg-[#DC2626] text-white hover:bg-red-700 focus-visible:ring-red-500',
  confirm: 'bg-[#16A34A] text-white hover:bg-green-700 focus-visible:ring-green-500',
  print: 'bg-[#475569] text-white hover:bg-slate-700 focus-visible:ring-slate-500',
  accent: 'bg-[#0D9488] text-white hover:bg-teal-700 focus-visible:ring-teal-500',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:ring-slate-400',
  outline:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 focus-visible:ring-slate-400',
};
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-10 w-10 justify-center',
};
const BASE =
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors select-none whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'save', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = 'outline',
  size = 'md',
  icon,
  className,
  children,
  external,
  download,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  external?: boolean;
  download?: boolean;
}) {
  const cls = cn(BASE, VARIANTS[variant], SIZES[size], className);
  if (external || download)
    return (
      <a href={href} className={cls} target={external ? '_blank' : undefined} rel="noopener noreferrer" download={download || undefined}>
        {icon}
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls}>
      {icon}
      {children}
    </Link>
  );
}
