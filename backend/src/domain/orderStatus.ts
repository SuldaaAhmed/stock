export type OrderStatus = 'Pending' | 'PartiallyCompleted' | 'Completed';

/**
 * Order status is derived from line quantities (never stored independently of them):
 *  - Completed: every line delivered == ordered
 *  - PartiallyCompleted: some quantity delivered, some remaining
 *  - Pending: nothing delivered
 * Returns never change delivered quantities, so they never change the status.
 */
export function deriveOrderStatus(lines: { ordered: number; delivered: number }[]): OrderStatus {
  if (lines.length > 0 && lines.every((l) => l.delivered >= l.ordered)) return 'Completed';
  if (lines.some((l) => l.delivered > 0)) return 'PartiallyCompleted';
  return 'Pending';
}
