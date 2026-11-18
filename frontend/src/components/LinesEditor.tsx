'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { Condition, Product } from '@/lib/types';
import { EntityCombobox, productLoader } from './EntityCombobox';
import { Button } from './ui/Button';
import { FieldError, inputClass, Segmented } from './ui/Field';

export interface LineDraft {
  key: string;
  productId: string;
  productName: string;
  quantity: string;
  condition?: Condition;
  available?: number;
  damaged?: number;
}

let seq = 0;
export function newLine(partial: Partial<LineDraft> = {}): LineDraft {
  seq += 1;
  return { key: `l${seq}-${Date.now()}`, productId: '', productName: '', quantity: '', ...partial };
}

/** Client-side usability validation only; the Backend remains authoritative. */
export function validateLines(lines: LineDraft[], opts: { withCondition?: boolean } = {}): { errors: Record<string, string>; valid: boolean } {
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (!l.productId) errors[`lines.${i}.productId`] = 'Select a product.';
    const q = Number(l.quantity);
    if (!l.quantity) errors[`lines.${i}.quantity`] = 'Enter a quantity.';
    else if (!Number.isInteger(q) || q <= 0) errors[`lines.${i}.quantity`] = 'Whole number greater than 0.';
    const k = l.productId + (opts.withCondition ? `:${l.condition}` : '');
    if (l.productId && seen.has(k)) errors[`lines.${i}.productId`] = opts.withCondition ? 'Duplicate product and condition.' : 'Product already added.';
    seen.add(k);
  });
  if (!lines.length) errors.lines = 'Add at least one product.';
  return { errors, valid: Object.keys(errors).length === 0 };
}

/**
 * Multi-product line editor (product + whole-number BOX quantity, optional Good/Damaged condition).
 * Shows the Backend-reported available quantity as guidance; stock validation is done by the Backend.
 */
export function LinesEditor({
  lines,
  onChange,
  errors = {},
  activeOnly = true,
  withCondition = false,
  showAvailable = true,
  disabled,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  errors?: Record<string, string>;
  activeOnly?: boolean;
  withCondition?: boolean;
  showAvailable?: boolean;
  disabled?: boolean;
}) {
  const loader = useMemo(() => productLoader({ activeOnly }), [activeOnly]);
  const update = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0 ? Number(l.quantity) : 0), 0);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Products<span className="ml-0.5 text-red-600">*</span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">Quantities in BOX (whole numbers)</span>
      </div>
      <div className="space-y-2.5">
        {lines.map((l, i) => {
          const qErr = errors[`lines.${i}.quantity`];
          const pErr = errors[`lines.${i}.productId`] || errors[`lines.${i}`];
          return (
            <div key={l.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/30">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
                <EntityCombobox<Product>
                  className="flex-1"
                  value={l.productId || null}
                  initialLabel={l.productName}
                  load={loader}
                  placeholder="Search product…"
                  disabled={disabled}
                  error={pErr}
                  onChange={(o) =>
                    update(i, {
                      productId: o?.id ?? '',
                      productName: o?.label ?? '',
                      available: o?.raw.availableStock,
                      damaged: o?.raw.damagedStock,
                    })
                  }
                />
                <div className="flex items-start gap-2">
                  <div className="w-28">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      placeholder="Qty"
                      aria-label={`Quantity for line ${i + 1}`}
                      value={l.quantity}
                      disabled={disabled}
                      onChange={(e) => update(i, { quantity: e.target.value })}
                      className={cn(inputClass, 'text-right tabular-nums', qErr && 'border-red-500')}
                    />
                    <FieldError message={qErr} />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={disabled || lines.length === 1}
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {(withCondition || (showAvailable && l.productId && l.available !== undefined)) && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  {withCondition ? (
                    <Segmented<Condition>
                      size="sm"
                      value={l.condition ?? 'Good'}
                      onChange={(v) => update(i, { condition: v })}
                      options={[
                        { value: 'Good', label: 'Good → Available stock', tone: 'green' },
                        { value: 'Damaged', label: 'Damaged → Damaged stock', tone: 'red' },
                      ]}
                    />
                  ) : (
                    <span />
                  )}
                  {showAvailable && l.productId && l.available !== undefined && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Currently available: <span className="font-semibold tabular-nums">{formatNumber(l.available)} BOX</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <FieldError message={errors.lines} />
      <div className="mt-3 flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...lines, newLine({ condition: withCondition ? 'Good' : undefined })])} icon={<Plus className="h-4 w-4" />}>
          Add product
        </Button>
        <span className="text-sm text-slate-600 dark:text-slate-300">
          Total: <span className="font-semibold tabular-nums">{formatNumber(total)} BOX</span>
        </span>
      </div>
    </div>
  );
}
