import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { getUtcTimestamp } from '../utils/date';

export type MovementType =
  | 'OpeningStock'
  | 'OpeningStockCorrection'
  | 'StockIn'
  | 'CustomerDelivery'
  | 'Sample'
  | 'Gift'
  | 'WarehouseTransferOut'
  | 'GoodReturn'
  | 'DamagedReturn'
  | 'AdjustmentIncrease'
  | 'AdjustmentDecrease'
  | 'DamagedMarkedGood'
  | 'DamagedRemoved';

export type SourceEntityType =
  | 'Product'
  | 'StockIn'
  | 'StockOut'
  | 'Return'
  | 'Adjustment'
  | 'DamagedAction';

export interface MovementRequest {
  productId: string;
  movementType: MovementType;
  sourceEntityType: SourceEntityType;
  sourceEntityId: string;
  sourceLineId: string;
  sourceVersion: number;
  deltaAvailable: number;
  deltaDamaged: number;
  businessDate: string;
  adminId: string;
  reason?: string;
  isReversal?: boolean;
  reversesMovementId?: string;
}

export class InsufficientStockError extends Error {
  public field: string;
  public available: number;
  public requested: number;

  constructor(productName: string, available: number, requested: number, field: string = 'quantity') {
    super(`Insufficient available stock for ${productName}. Only ${available} BOX available, requested ${requested} BOX.`);
    this.name = 'InsufficientStockError';
    this.field = field;
    this.available = available;
    this.requested = requested;
  }
}

export class InsufficientDamagedStockError extends Error {
  public damaged: number;
  public requested: number;

  constructor(productName: string, damaged: number, requested: number) {
    super(`Insufficient damaged stock for ${productName}. Only ${damaged} BOX damaged, requested ${requested} BOX.`);
    this.name = 'InsufficientDamagedStockError';
    this.damaged = damaged;
    this.requested = requested;
  }
}

/**
 * Validates and records stock movements atomically.
 * Updates ProductBalances and inserts into StockMovements.
 * MUST be executed inside an active db.transaction().
 */
export function recordStockMovements(movements: MovementRequest[]) {
  const now = getUtcTimestamp();

  // Sort by productId to maintain consistent lock order
  const sortedMovements = [...movements].sort((a, b) => a.productId.localeCompare(b.productId));

  const getBalanceStmt = db.prepare(`
    SELECT pb.ProductId, pb.AvailableQuantity, pb.DamagedQuantity, p.ProductName, p.Status
    FROM ProductBalances pb
    JOIN Products p ON p.Id = pb.ProductId
    WHERE pb.ProductId = ?
  `);

  const updateBalanceStmt = db.prepare(`
    UPDATE ProductBalances
    SET AvailableQuantity = ?, DamagedQuantity = ?, UpdatedAtUtc = ?
    WHERE ProductId = ?
  `);

  const insertMovementStmt = db.prepare(`
    INSERT INTO StockMovements (
      Id, SequenceNo, ProductId, MovementType, SourceEntityType, SourceEntityId,
      SourceLineId, SourceVersion, IsReversal, ReversesMovementId,
      QuantityDeltaAvailable, QuantityDeltaDamaged, AvailableBefore, AvailableAfter,
      DamagedBefore, DamagedAfter, BusinessDate, OccurredAtUtc, CreatedByAdminId, Reason
    ) VALUES (
      ?, (SELECT COALESCE(MAX(SequenceNo), 0) + 1 FROM StockMovements),
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  // Track balance changes across multiple lines for the same product in a single transaction
  const runningBalances = new Map<string, { available: number; damaged: number; name: string }>();

  for (const m of sortedMovements) {
    if (!runningBalances.has(m.productId)) {
      const current = getBalanceStmt.get(m.productId) as {
        ProductId: string;
        AvailableQuantity: number;
        DamagedQuantity: number;
        ProductName: string;
        Status: string;
      } | undefined;

      if (!current) {
        throw new Error(`Product balance record not found for productId: ${m.productId}`);
      }

      runningBalances.set(m.productId, {
        available: current.AvailableQuantity,
        damaged: current.DamagedQuantity,
        name: current.ProductName,
      });
    }

    const currentBal = runningBalances.get(m.productId)!;
    const availableBefore = currentBal.available;
    const damagedBefore = currentBal.damaged;

    const availableAfter = availableBefore + m.deltaAvailable;
    const damagedAfter = damagedBefore + m.deltaDamaged;

    if (availableAfter < 0) {
      throw new InsufficientStockError(currentBal.name, availableBefore, Math.abs(m.deltaAvailable));
    }

    if (damagedAfter < 0) {
      throw new InsufficientDamagedStockError(currentBal.name, damagedBefore, Math.abs(m.deltaDamaged));
    }

    // Update running balance
    currentBal.available = availableAfter;
    currentBal.damaged = damagedAfter;

    // Insert Movement
    const movementId = uuidv4();
    insertMovementStmt.run(
      movementId,
      m.productId,
      m.movementType,
      m.sourceEntityType,
      m.sourceEntityId,
      m.sourceLineId,
      m.sourceVersion,
      m.isReversal ? 1 : 0,
      m.reversesMovementId || null,
      m.deltaAvailable,
      m.deltaDamaged,
      availableBefore,
      availableAfter,
      damagedBefore,
      damagedAfter,
      m.businessDate,
      now,
      m.adminId,
      m.reason || null
    );

    // Update ProductBalances table
    updateBalanceStmt.run(availableAfter, damagedAfter, now, m.productId);
  }
}
