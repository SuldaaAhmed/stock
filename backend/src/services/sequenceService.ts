import { db } from '../db/database';
import { getUtcTimestamp } from '../utils/date';

export type DocumentType = 'StockIn' | 'StockOut' | 'Order' | 'Return' | 'Adjustment' | 'Transfer' | 'Receipt';

export function allocateDocumentNumber(type: DocumentType): string {
  const updateStmt = db.prepare(`
    UPDATE DocumentSequences
    SET NextNumber = NextNumber + 1, UpdatedAtUtc = ?
    WHERE DocumentType = ?
    RETURNING Prefix, NextNumber - 1 AS AllocatedNumber, PadWidth
  `);

  const result = updateStmt.get(getUtcTimestamp(), type) as {
    Prefix: string;
    AllocatedNumber: number;
    PadWidth: number;
  } | undefined;

  if (!result) {
    throw new Error(`DocumentSequence not found for DocumentType: ${type}`);
  }

  const numStr = String(result.AllocatedNumber).padStart(result.PadWidth, '0');
  return `${result.Prefix}-${numStr}`;
}
