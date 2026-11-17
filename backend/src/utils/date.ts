/**
 * Date and time utilities for Africa/Nairobi time zone and UTC storage
 */

export function getUtcTimestamp(): string {
  return new Date().toISOString();
}

export function getNairobiDate(date: Date = new Date()): string {
  // Returns YYYY-MM-DD in Africa/Nairobi
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

export function isFutureDate(dateStr: string): boolean {
  const today = getNairobiDate();
  return dateStr > today;
}
