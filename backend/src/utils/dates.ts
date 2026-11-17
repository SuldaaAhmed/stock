import { config } from '../config';

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's business date on the Africa/Nairobi calendar, as YYYY-MM-DD. */
export function todayNairobi(now: Date = new Date()): string {
  return ymdFormatter.format(now);
}

/** Validates a strict YYYY-MM-DD calendar date. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toUtcDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(s: string, days: number): string {
  const d = toUtcDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

export type Period = 'day' | 'week' | 'month' | 'custom';

/**
 * Resolve a reporting period to an inclusive [from, to] business-date range on the
 * Nairobi calendar. Weeks start on Monday. Custom ranges include both end dates.
 */
export function resolvePeriod(period: Period, anchor?: string, from?: string, to?: string): { from: string; to: string } {
  const a = anchor ?? todayNairobi();
  switch (period) {
    case 'day':
      return { from: a, to: a };
    case 'week': {
      const dow = toUtcDate(a).getUTCDay(); // 0=Sun..6=Sat
      const offset = (dow + 6) % 7; // days since Monday
      const start = addDays(a, -offset);
      return { from: start, to: addDays(start, 6) };
    }
    case 'month': {
      const d = toUtcDate(a);
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      return { from: fmt(start), to: fmt(end) };
    }
    case 'custom':
      return { from: from!, to: to! };
  }
}

/** Format a UTC timestamp in Kenya time for documents (PDFs). */
export function formatNairobiDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(typeof d === 'string' ? new Date(d) : d) + ' EAT';
}
