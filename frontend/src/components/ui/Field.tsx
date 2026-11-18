'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export const inputClass =
  'block h-10 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition-colors ' +
  'border-slate-300 focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800';

const invalidClass = 'border-red-500 focus:border-red-500 focus:ring-red-500/30 dark:border-red-500';

export function Label({ htmlFor, children, required, className }: { htmlFor?: string; children: React.ReactNode; required?: boolean; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300', className)}>
      {children}
      {required && (
        <span className="ml-0.5 text-red-600" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

export function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{children}</p>;
}

interface FieldWrapProps {
  label?: React.ReactNode;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & FieldWrapProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, required, error, hint, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={fid} required={required}>
          {label}
        </Label>
      )}
      <input
        ref={ref}
        id={fid}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fid}-err` : undefined}
        className={cn(inputClass, error && invalidClass)}
        {...rest}
      />
      {hint && !error && <Hint>{hint}</Hint>}
      <FieldError id={`${fid}-err`} message={error} />
    </div>
  );
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & FieldWrapProps;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, required, error, hint, className, id, children, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={fid} required={required}>
          {label}
        </Label>
      )}
      <select
        ref={ref}
        id={fid}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fid}-err` : undefined}
        className={cn(inputClass, 'pr-8', error && invalidClass)}
        {...rest}
      >
        {children}
      </select>
      {hint && !error && <Hint>{hint}</Hint>}
      <FieldError id={`${fid}-err`} message={error} />
    </div>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & FieldWrapProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, required, error, hint, className, id, rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={fid} required={required}>
          {label}
        </Label>
      )}
      <textarea
        ref={ref}
        id={fid}
        rows={rows}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fid}-err` : undefined}
        className={cn(inputClass, "h-auto", error && invalidClass)}
        {...rest}
      />
      {hint && !error && <Hint>{hint}</Hint>}
      <FieldError id={`${fid}-err`} message={error} />
    </div>
  );
});

/** Segmented control (radio group) for small enums, e.g. Increase/Decrease, Good/Damaged. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  required,
  name,
  size = 'md',
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; tone?: 'teal' | 'green' | 'red' | 'amber' | 'blue' }[];
  label?: string;
  required?: boolean;
  name?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const gid = useId();
  const tones: Record<string, string> = {
    teal: 'bg-[#0D9488] text-white',
    green: 'bg-[#16A34A] text-white',
    red: 'bg-[#DC2626] text-white',
    amber: 'bg-amber-500 text-white',
    blue: 'bg-[#2563EB] text-white',
  };
  return (
    <div>
      {label && (
        <Label required={required} htmlFor={`${gid}-0`}>
          {label}
        </Label>
      )}
      <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-lg border border-slate-300 bg-slate-50 p-0.5 dark:border-slate-600 dark:bg-slate-900 sm:w-auto">
        {options.map((o, i) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              id={`${gid}-${i}`}
              type="button"
              role="radio"
              name={name}
              aria-checked={active}
              disabled={disabled && !active}
              onClick={() => !disabled && onChange(o.value)}
              className={cn(
                'flex-1 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none',
                size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-1.5 text-sm',
                active ? tones[o.tone ?? 'teal'] + ' shadow-sm' : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Labelled filter-bar search input. */
export function SearchBox({ value, onChange, placeholder, label = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cn('min-w-[14rem] flex-1', className)}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
      </label>
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input id={id} type="search" className={cn(inputClass, 'pl-9')} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

/** Labelled filter-bar select. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
      </label>
      <select id={id} className={cn(inputClass, 'min-w-[10rem]')} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Labelled checkbox aligned with filter-bar controls. */
export function FilterCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex h-10 items-center gap-2 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#0D9488] focus:ring-[#0D9488]" />
      {label}
    </label>
  );
}

/** Filter bar container (form so Enter submits search). */
export function FilterBar({ children, onSubmit }: { children: React.ReactNode; onSubmit: () => void }) {
  return (
    <form
      className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-700 md:flex-row md:flex-wrap md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}
