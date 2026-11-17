import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/database';
import { allocateDocumentNumber } from '../services/sequenceService';
import { recordStockMovements } from '../services/stockEngine';
import { createReceipt } from '../services/receiptService';
import { logAudit } from '../services/auditService';
import { getUtcTimestamp, isFutureDate, isValidDateString } from '../utils/date';

export const stockInRouter = Router();

const stockInItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1 BOX'),
});

const createStockInSchema = z.object({
  transactionDate: z.string().refine(isValidDateString, 'Invalid date format (YYYY-MM-DD)'),
  transactionType: z.enum(['NewStock', 'WarehouseTransferIn']),
  sourceWarehouseName: z.string().trim().optional(),
  items: z.array(stockInItemSchema).min(1, 'At least one item is required'),
});

const correctStockInSchema = createStockInSchema.extend({
  reason: z.string().min(1, 'Reason is mandatory for transaction correction'),
});

// GET /stock-ins
stockInRouter.get('/', (req: Request, res: Response) => {
  const { page = '1', pageSize = '50', search, type, from, to } = req.query;

  let query = `
    SELECT si.Id as id, si.StockInNumber as number, si.TransactionDate as date,
           si.TransactionType as type, si.SourceWarehouseName as sourceWarehouseName,
           si.Version as version, si.CreatedAtUtc as createdAtUtc,
           COALESCE(SUM(sii.Quantity), 0) as totalQuantity,
           COUNT(sii.Id) as lineCount,
           r.Id as receiptId, r.ReceiptNumber as receiptNumber
    FROM StockInTransactions si
    LEFT JOIN StockInItems sii ON sii.StockInTransactionId = si.Id
    LEFT JOIN Receipts r ON r.SourceType = 'StockIn' AND r.SourceEntityId = si.Id AND r.SourceVersion = si.Version
    WHERE 1=1
  `;
  const params: any[] = [];

  if (type && typeof type === 'string') {
    query += ` AND si.TransactionType = ?`;
    params.push(type);
  }

  if (from && typeof from === 'string') {
    query += ` AND si.TransactionDate >= ?`;
    params.push(from);
  }

  if (to && typeof to === 'string') {
    query += ` AND si.TransactionDate <= ?`;
    params.push(to);
  }

  if (search && typeof search === 'string' && search.trim()) {
    query += ` AND (lower(si.StockInNumber) LIKE ? OR lower(COALESCE(si.SourceWarehouseName, '')) LIKE ?)`;
    params.push(`%${search.trim().toLowerCase()}%`, `%${search.trim().toLowerCase()}%`);
  }

  query += ` GROUP BY si.Id ORDER BY si.CreatedAtUtc DESC`;

  const rows = db.prepare(query).all(...params) as any[];

  return res.json({
    data: rows.map((r) => ({
      ...r,
      totalQuantity: Math.round(r.totalQuantity),
    })),
    meta: {
      totalItems: rows.length,
      page: parseInt(page as string, 10),
      pageSize: parseInt(pageSize as string, 10),
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// POST /stock-ins
stockInRouter.post('/', (req: Request, res: Response) => {
  const body = createStockInSchema.parse(req.body);
  const adminId = req.admin!.id;
  const now = getUtcTimestamp();

  if (isFutureDate(body.transactionDate)) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'Business date cannot be in the future.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'transactionDate', message: 'Date cannot be in the future' }],
    });
  }

  if (body.transactionType === 'WarehouseTransferIn' && (!body.sourceWarehouseName || !body.sourceWarehouseName.trim())) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'Source warehouse name is required for Warehouse Transfer In.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'sourceWarehouseName', message: 'Source warehouse name is required' }],
    });
  }

  // Check unique products in line items
  const productIds = body.items.map((i) => i.productId);
  if (new Set(productIds).size !== productIds.length) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'A product can only appear once per transaction.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'items', message: 'Duplicate product found in transaction lines' }],
    });
  }

  // Validate products exist and are Active
  const products = db.prepare(`
    SELECT Id, ProductName, Status FROM Products WHERE Id IN (${productIds.map(() => '?').join(',')})
  `).all(...productIds) as any[];

  if (products.length !== productIds.length) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'One or more products do not exist.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  const inactive = products.filter((p) => p.Status === 'Inactive');
  if (inactive.length > 0) {
    return res.status(422).json({
      type: 'INACTIVE_PRODUCT',
      title: 'Cannot add stock to an inactive product.',
      status: 422,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: inactive.map((p) => ({ field: 'items', message: `Product ${p.ProductName} is Inactive.` })),
    });
  }

  const productMap = new Map<string, string>();
  products.forEach((p) => productMap.set(p.Id, p.ProductName));

  const stockInId = uuidv4();
  let stockInNumber: string = '';
  let receiptId: string = '';
  let receiptNumber: string = '';

  const postTx = db.transaction(() => {
    stockInNumber = allocateDocumentNumber('StockIn');

    // 1. Insert header
    db.prepare(`
      INSERT INTO StockInTransactions (
        Id, StockInNumber, TransactionDate, TransactionType, SourceWarehouseName,
        Version, CreatedAtUtc, CreatedByAdminId, UpdatedAtUtc, UpdatedByAdminId, RowVersion
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1)
    `).run(
      stockInId,
      stockInNumber,
      body.transactionDate,
      body.transactionType,
      body.transactionType === 'WarehouseTransferIn' ? body.sourceWarehouseName!.trim() : null,
      now,
      adminId,
      now,
      adminId
    );

    // 2. Insert items
    const insertItem = db.prepare(`
      INSERT INTO StockInItems (Id, StockInTransactionId, ProductId, ProductNameSnapshot, Quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    const movements = body.items.map((item) => {
      const lineId = uuidv4();
      const prodName = productMap.get(item.productId)!;
      insertItem.run(lineId, stockInId, item.productId, prodName, item.quantity);

      return {
        productId: item.productId,
        movementType: 'StockIn' as const,
        sourceEntityType: 'StockIn' as const,
        sourceEntityId: stockInId,
        sourceLineId: lineId,
        sourceVersion: 1,
        deltaAvailable: item.quantity,
        deltaDamaged: 0,
        businessDate: body.transactionDate,
        adminId,
        reason: `${body.transactionType === 'WarehouseTransferIn' ? 'Transfer in from ' + body.sourceWarehouseName : 'New Stock'} (${stockInNumber})`,
      };
    });

    // 3. Post movements via Stock Engine
    recordStockMovements(movements);

    // 4. Create Receipt
    const receiptResult = createReceipt({
      sourceType: 'StockIn',
      sourceEntityId: stockInId,
      sourceVersion: 1,
      adminId,
      receiptData: {
        sourceNumber: stockInNumber,
        transactionDate: body.transactionDate,
        transactionType: body.transactionType,
        sourceWarehouseName: body.sourceWarehouseName || null,
        items: body.items.map((i) => ({
          productId: i.productId,
          productName: productMap.get(i.productId),
          quantity: i.quantity,
        })),
      },
    });

    receiptId = receiptResult.id;
    receiptNumber = receiptResult.receiptNumber;

    // 5. Audit Log
    logAudit({
      actorType: 'Admin',
      adminId,
      action: 'StockIn.Created',
      entityType: 'StockIn',
      entityId: stockInId,
      description: `Stock In recorded: ${stockInNumber} (${body.transactionType}) with ${body.items.length} items`,
      newData: body,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  });

  postTx();

  return res.status(201).json({
    data: {
      id: stockInId,
      stockInNumber,
      transactionDate: body.transactionDate,
      transactionType: body.transactionType,
      sourceWarehouseName: body.sourceWarehouseName || null,
      version: 1,
      receiptId,
      receiptNumber,
      items: body.items.map((i) => ({
        productId: i.productId,
        productName: productMap.get(i.productId),
        quantity: i.quantity,
      })),
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// GET /stock-ins/:id
stockInRouter.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const header = db.prepare(`SELECT * FROM StockInTransactions WHERE Id = ?`).get(id) as any;
  if (!header) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Stock In transaction not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  const items = db.prepare(`SELECT * FROM StockInItems WHERE StockInTransactionId = ?`).all(id) as any[];
  const receipt = db.prepare(`
    SELECT Id, ReceiptNumber, Status FROM Receipts
    WHERE SourceType = 'StockIn' AND SourceEntityId = ? AND SourceVersion = ?
  `).get(id, header.Version) as any;

  const revisions = db.prepare(`
    SELECT Version as version, Reason as reason, SupersededAtUtc as supersededAtUtc
    FROM TransactionRevisions
    WHERE EntityType = 'StockIn' AND EntityId = ?
    ORDER BY Version DESC
  `).all(id) as any[];

  return res.json({
    data: {
      id: header.Id,
      stockInNumber: header.StockInNumber,
      transactionDate: header.TransactionDate,
      transactionType: header.TransactionType,
      sourceWarehouseName: header.SourceWarehouseName,
      version: header.Version,
      receiptId: receipt?.Id || null,
      receiptNumber: receipt?.ReceiptNumber || null,
      items: items.map((i) => ({
        id: i.Id,
        productId: i.ProductId,
        productName: i.ProductNameSnapshot,
        quantity: Math.round(i.Quantity),
      })),
      revisions,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// POST /stock-ins/:id/corrections
stockInRouter.post('/:id/corrections', (req: Request, res: Response) => {
  const { id } = req.params;
  const body = correctStockInSchema.parse(req.body);
  const adminId = req.admin!.id;
  const now = getUtcTimestamp();

  const current = db.prepare(`SELECT * FROM StockInTransactions WHERE Id = ?`).get(id) as any;
  if (!current) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Stock In transaction not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  const currentItems = db.prepare(`SELECT * FROM StockInItems WHERE StockInTransactionId = ?`).all(id) as any[];
  const currentReceipt = db.prepare(`
    SELECT Id FROM Receipts
    WHERE SourceType = 'StockIn' AND SourceEntityId = ? AND SourceVersion = ?
  `).get(id, current.Version) as any;

  const newVersion = current.Version + 1;
  const productIds = body.items.map((i) => i.productId);
  const products = db.prepare(`SELECT Id, ProductName FROM Products WHERE Id IN (${productIds.map(() => '?').join(',')})`).all(...productIds) as any[];
  const productMap = new Map<string, string>();
  products.forEach((p) => productMap.set(p.Id, p.ProductName));

  let receiptId: string = '';
  let receiptNumber: string = '';

  const correctTx = db.transaction(() => {
    // 1. Save revision snapshot of current version
    db.prepare(`
      INSERT INTO TransactionRevisions (
        Id, EntityType, EntityId, Version, Snapshot, Reason, SupersededAtUtc, SupersededByAdminId
      ) VALUES (?, 'StockIn', ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      id,
      current.Version,
      JSON.stringify({ header: current, items: currentItems }),
      body.reason,
      now,
      adminId
    );

    // 2. Reverse previous version movements
    const reversalMovements = currentItems.map((item) => ({
      productId: item.ProductId,
      movementType: 'StockIn' as const,
      sourceEntityType: 'StockIn' as const,
      sourceEntityId: id,
      sourceLineId: item.Id,
      sourceVersion: current.Version,
      isReversal: true,
      deltaAvailable: -item.Quantity,
      deltaDamaged: 0,
      businessDate: current.TransactionDate,
      adminId,
      reason: `Correction reversal: ${current.StockInNumber} v${current.Version} (${body.reason})`,
    }));

    recordStockMovements(reversalMovements);

    // 3. Update header
    db.prepare(`
      UPDATE StockInTransactions
      SET TransactionDate = ?,
          SourceWarehouseName = ?,
          Version = ?,
          UpdatedAtUtc = ?,
          UpdatedByAdminId = ?,
          RowVersion = RowVersion + 1
      WHERE Id = ?
    `).run(
      body.transactionDate,
      body.transactionType === 'WarehouseTransferIn' ? body.sourceWarehouseName!.trim() : null,
      newVersion,
      now,
      adminId,
      id
    );

    // 4. Delete old lines and insert new lines
    db.prepare(`DELETE FROM StockInItems WHERE StockInTransactionId = ?`).run(id);

    const insertItem = db.prepare(`
      INSERT INTO StockInItems (Id, StockInTransactionId, ProductId, ProductNameSnapshot, Quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    const newMovements = body.items.map((item) => {
      const lineId = uuidv4();
      const prodName = productMap.get(item.productId)!;
      insertItem.run(lineId, id, item.productId, prodName, item.quantity);

      return {
        productId: item.productId,
        movementType: 'StockIn' as const,
        sourceEntityType: 'StockIn' as const,
        sourceEntityId: id,
        sourceLineId: lineId,
        sourceVersion: newVersion,
        deltaAvailable: item.quantity,
        deltaDamaged: 0,
        businessDate: body.transactionDate,
        adminId,
        reason: `Restated: ${current.StockInNumber} v${newVersion} (${body.reason})`,
      };
    });

    recordStockMovements(newMovements);

    // 5. Create new receipt superseding the old one
    const receiptResult = createReceipt({
      sourceType: 'StockIn',
      sourceEntityId: id,
      sourceVersion: newVersion,
      supersedesReceiptId: currentReceipt?.Id,
      adminId,
      receiptData: {
        sourceNumber: current.StockInNumber,
        version: newVersion,
        reason: body.reason,
        transactionDate: body.transactionDate,
        transactionType: body.transactionType,
        sourceWarehouseName: body.sourceWarehouseName || null,
        items: body.items.map((i) => ({
          productId: i.productId,
          productName: productMap.get(i.productId),
          quantity: i.quantity,
        })),
      },
    });

    receiptId = receiptResult.id;
    receiptNumber = receiptResult.receiptNumber;

    // 6. Audit log
    logAudit({
      actorType: 'Admin',
      adminId,
      action: 'StockIn.Corrected',
      entityType: 'StockIn',
      entityId: id,
      description: `Stock In corrected: ${current.StockInNumber} to v${newVersion}. Reason: ${body.reason}`,
      newData: body,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  });

  correctTx();

  return res.json({
    data: {
      id,
      stockInNumber: current.StockInNumber,
      version: newVersion,
      receiptId,
      receiptNumber,
      transactionDate: body.transactionDate,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});
