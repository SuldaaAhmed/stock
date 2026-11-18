/**
 * Display formatting (Frontend §2, §8):
 *  - Dates DD/MM/YYYY, times 12-hour, always in Kenya time (Africa/Nairobi, EAT).
 *  - Currency KES (only for the optional Selling Price). Quantities in BOX.
 */
export const TIME_ZONE = 'Africa/Nairobi';

const dtParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function parts(d: Date) {
  const p: Record<string, string> = {};
  for (const x of dtParts.formatToParts(d)) p[x.type] = x.value;
  return p;
}

/** YYYY-MM-DD (business date) or ISO timestamp -> DD/MM/YYYY */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const p = parts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

/** ISO timestamp -> 12-hour time in EAT, e.g. "3:45 PM" */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const p = parts(d);
  return `${p.hour}:${p.minute} ${(p.dayPeriod || '').toUpperCase()}`.trim();
}

/** ISO timestamp -> "DD/MM/YYYY, h:mm AM" (EAT) */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** Today's business date in Nairobi: YYYY-MM-DD (for date inputs). */
export function todayNairobi(): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(),
  ))
    p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

const kes = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `KES ${kes.format(n)}` : String(value);
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? int.format(n) : String(value);
}

export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value)} BOX`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "PartiallyCompleted" -> "Partially Completed", "stockInQuantity" -> "Stock In Quantity" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/[-_.]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Enum display labels (Backend values -> UI labels)
// ---------------------------------------------------------------------------
export const LABELS: Record<string, string> = {
  NewStock: 'New Stock',
  WarehouseTransferIn: 'Warehouse Transfer In',
  CustomerDelivery: 'Customer Order Delivery',
  Sample: 'Sample',
  Gift: 'Gift',
  WarehouseTransfer: 'Warehouse Transfer',
  Pending: 'Pending',
  PartiallyCompleted: 'Partially Completed',
  Completed: 'Completed',
  AgainstOrder: 'Against Order',
  Direct: 'Direct Return',
  Increase: 'Increase',
  Decrease: 'Decrease',
  MarkAsGood: 'Mark as Good',
  RemoveFromDamaged: 'Remove from Damaged',
  DamagedReturn: 'Damaged Return',
  StockIn: 'Stock In',
  StockOut: 'Stock Out',
  Return: 'Return',
  Adjustment: 'Adjustment',
  Order: 'Order',
  Transfer: 'Transfer',
  Receipt: 'Receipt',
  Product: 'Product',
  Customer: 'Customer',
  OpeningStock: 'Opening Stock',
  OpeningStockCorrection: 'Opening Stock Correction',
  StockInNew: 'Stock In (New Stock)',
  StockInTransfer: 'Stock In (Transfer In)',
  StockOutDelivery: 'Customer Delivery',
  StockOutSample: 'Sample',
  StockOutGift: 'Gift',
  StockOutTransfer: 'Warehouse Transfer',
  ReturnGood: 'Return (Good)',
  ReturnDamaged: 'Return (Damaged)',
  AdjustmentIn: 'Adjustment In',
  AdjustmentOut: 'Adjustment Out',
  Posted: 'Posted',
  Superseded: 'Superseded',
};

export function label(value: string | null | undefined): string {
  if (!value) return '—';
  return LABELS[value] ?? humanize(value);
}
