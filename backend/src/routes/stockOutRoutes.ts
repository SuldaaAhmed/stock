import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/database';
import { allocateDocumentNumber } from '../services/sequenceService';
import { recordStockMovements } from '../services/stockEngine';
import { createReceipt } from '../services/receiptService';
import { logAudit } from '../services/auditService';
import { getUtcTimestamp, isFutureDate, isValidDateString } from '../utils/date';

export const stockOutRouter = Router();

const stockOutItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1 BOX'),
});

const createStockOutSchema = z.object({
  transactionDate: z.string().refine(isValidDateString, 'Invalid date format (YYYY-MM-DD)'),
  transactionType: z.enum(['Sample', 'Gift', 'WarehouseTransfer']),
  recipientFullName: z.string().trim().optional(),
  destinationWarehouseName: z.string().trim().optional(),
  items: z.array(stockOutItemSchema).min(1, 'At least one item is required'),
});

const correctStockOutSchema = createStockOutSchema.extend({
  reason: z.string().min(1, 'Reason is mandatory for transaction correction'),
});

// GET /stock-outs
stockOutRouter.get('/', (req: Request, res: Response) => {
  const { page = '1', pageSize = '50', search, type, from, to } = req.query;

  let query = `
    SELECT so.Id as id, so.StockOutNumber as number, so.TransactionDate as date,
           so.TransactionType as type,
           COALESCE(so.RecipientFullName, so.DestinationWarehouseName, c.FullName, 'N/A') as party,
           so.Version as version, so.CreatedAtUtc as createdAtUtc,
           COALESCE(SUM(soi.Quantity), 0) as totalQuantity,
           COUNT(soi.Id) as lineCount,
           wt.TransferNumber as transferNumber,
           r.Id as receiptId, r.ReceiptNumber as receiptNumber
    FROM StockOutTransactions so
    LEFT JOIN StockOutItems soi ON soi.StockOutTransactionId = so.Id
    LEFT JOIN WarehouseTransfers wt ON wt.StockOutTransactionId = so.Id
    LEFT JOIN Orders o ON o.Id = so.CustomerOrderId
    LEFT JOIN Customers c ON c.Id = o.CustomerId
    LEFT JOIN Receipts r ON r.SourceType = 'StockOut' AND r.SourceEntityId = so.Id AND r.SourceVersion = so.Version
    WHERE 1=1
  `;
  const params: any[] = [];

  if (type && typeof type === 'string') {
    query += ` AND so.TransactionType = ?`;
    params.push(type);
  }

  if (from && typeof from === 'string') {
    query += ` AND so.TransactionDate >= ?`;
    params.push(from);
  }

  if (to && typeof to === 'string') {
    query += ` AND so.TransactionDate <= ?`;
    params.push(to);
  }

  if (search && typeof search === 'string' && search.trim()) {
    query += ` AND (
      lower(so.StockOutNumber) LIKE ? OR
      lower(COALESCE(so.RecipientFullName, '')) LIKE ? OR
      lower(COALESCE(so.DestinationWarehouseName, '')) LIKE ? OR
      lower(COALESCE(wt.TransferNumber, '')) LIKE ?
    )`;
    const s = `%${search.trim().toLowerCase()}%`;
    params.push(s, s, s, s);
  }

  query += ` GROUP BY so.Id ORDER BY so.CreatedAtUtc DESC`;

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

// POST /stock-outs
stockOutRouter.post('/', (req: Request, res: Response) => {
  // Reject CustomerOrderDelivery if attempted here
  if (req.body?.transactionType === 'CustomerOrderDelivery') {
    return res.status(400).json({
      type: 'INVALID_TRANSACTION_TYPE',
      title: 'Customer order deliveries must be posted through /orders/:id/deliveries.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'transactionType', message: 'Use the order delivery endpoint for customer deliveries' }],
    });
  }

  const body = createStockOutSchema.parse(req.body);
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

  if (['Sample', 'Gift'].includes(body.transactionType) && (!body.recipientFullName || !body.recipientFullName.trim())) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'Recipient full name is required for Sample and Gift.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'recipientFullName', message: 'Recipient name is required' }],
    });
  }

  if (body.transactionType === 'WarehouseTransfer' && (!body.destinationWarehouseName || !body.destinationWarehouseName.trim())) {
    return res.status(400).json({
      type: 'VALIDATION_ERROR',
      title: 'Destination warehouse name is required for Warehouse Transfer.',
      status: 400,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'destinationWarehouseName', message: 'Destination warehouse name is required' }],
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
      title: 'Cannot deduct stock from an inactive product.',
      status: 422,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: inactive.map((p) => ({ field: 'items', message: `Product ${p.ProductName} is Inactive.` })),
    });
  }

  const productMap = new Map<string, string>();
  products.forEach((p) => productMap.set(p.Id, p.ProductName));

  const stockOutId = uuidv4();
  let stockOutNumber: string = '';
  let transferNumber: string | undefined;
  let receiptId: string = '';
  let receiptNumber: string = '';

  const postTx = db.transaction(() => {
    stockOutNumber = allocateDocumentNumber('StockOut');

    // 1. Insert header
    db.prepare(`
      INSERT INTO StockOutTransactions (
        Id, StockOutNumber, TransactionDate, TransactionType, CustomerOrderId,
        RecipientFullName, DestinationWarehouseName, Version,
        CreatedAtUtc, CreatedByAdminId, UpdatedAtUtc, UpdatedByAdminId, RowVersion
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?, ?, 1)
    `).run(
      stockOutId,
      stockOutNumber,
      body.transactionDate,
      body.transactionType,
      body.recipientFullName ? body.recipientFullName.trim() : null,
      body.destinationWarehouseName ? body.destinationWarehouseName.trim() : null,
      now,
      adminId,
      now,
      adminId
    );

    // 2. If Warehouse Transfer, allocate TRF- number
    if (body.transactionType === 'WarehouseTransfer') {
      transferNumber = allocateDocumentNumber('Transfer');
      db.prepare(`
        INSERT INTO WarehouseTransfers (Id, TransferNumber, StockOutTransactionId, CreatedAtUtc, CreatedByAdminId)
        VALUES (?, ?, ?, ?, ?)
      `).run(uuidv4(), transferNumber, stockOutId, now, adminId);
    }

    // 3. Insert items
    const insertItem = db.prepare(`
      INSERT INTO StockOutItems (Id, StockOutTransactionId, ProductId, ProductNameSnapshot, Quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    const movementType =
      body.transactionType === 'Sample'
        ? ('Sample' as const)
        : body.transactionType === 'Gift'
        ? ('Gift' as const)
        : ('WarehouseTransferOut' as const);

    const movements = body.items.map((item) => {
      const lineId = uuidv4();
      const prodName = productMap.get(item.productId)!;
      insertItem.run(lineId, stockOutId, item.productId, prodName, item.quantity);

      return {
        productId: item.productId,
        movementType,
        sourceEntityType: 'StockOut' as const,
        sourceEntityId: stockOutId,
        sourceLineId: lineId,
        sourceVersion: 1,
        deltaAvailable: -item.quantity,
        deltaDamaged: 0,
        businessDate: body.transactionDate,
        adminId,
        reason: `${body.transactionType} (${stockOutNumber})`,
      };
    });

    // 4. Post movements via Stock Engine (validates sufficient available stock)
    recordStockMovements(movements);

    // 5. Create Receipt
    const receiptResult = createReceipt({
      sourceType: 'StockOut',
      sourceEntityId: stockOutId,
      sourceVersion: 1,
      adminId,
      receiptData: {
        sourceNumber: stockOutNumber,
        transferNumber: transferNumber || null,
        transactionDate: body.transactionDate,
        transactionType: body.transactionType,
        recipientFullName: body.recipientFullName || null,
        destinationWarehouseName: body.destinationWarehouseName || null,
        items: body.items.map((i) => ({
          productId: i.productId,
          productName: productMap.get(i.productId),
          quantity: i.quantity,
        })),
      },
    });

    receiptId = receiptResult.id;
    receiptNumber = receiptResult.receiptNumber;

    // 6. Audit Log
    logAudit({
      actorType: 'Admin',
      adminId,
      action: 'StockOut.Created',
      entityType: 'StockOut',
      entityId: stockOutId,
      description: `Stock Out recorded: ${stockOutNumber} (${body.transactionType}) with ${body.items.length} items`,
      newData: body,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  });

  postTx();

  return res.status(201).json({
    data: {
      id: stockOutId,
      stockOutNumber,
      transferNumber: transferNumber || null,
      transactionDate: body.transactionDate,
      transactionType: body.transactionType,
      recipientFullName: body.recipientFullName || null,
      destinationWarehouseName: body.destinationWarehouseName || null,
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

// GET /stock-outs/:id
stockOutRouter.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const header = db.prepare(`
    SELECT so.*, wt.TransferNumber as transferNumber, o.OrderNumber as linkedOrderNumber
    FROM StockOutTransactions so
    LEFT JOIN WarehouseTransfers wt ON wt.StockOutTransactionId = so.Id
    LEFT JOIN Orders o ON o.Id = so.CustomerOrderId
    WHERE so.Id = ?
  `).get(id) as any;

  if (!header) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Stock Out transaction not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  const items = db.prepare(`SELECT * FROM StockOutItems WHERE StockOutTransactionId = ?`).all(id) as any[];
  const receipt = db.prepare(`
    SELECT Id, ReceiptNumber, Status FROM Receipts
    WHERE SourceType = 'StockOut' AND SourceEntityId = ? AND SourceVersion = ?
  `).get(id, header.Version) as any;

  const revisions = db.prepare(`
    SELECT Version as version, Reason as reason, SupersededAtUtc as supersededAtUtc
    FROM TransactionRevisions
    WHERE EntityType = 'StockOut' AND EntityId = ?
    ORDER BY Version DESC
  `).all(id) as any[];

  return res.json({
    data: {
      id: header.Id,
      stockOutNumber: header.StockOutNumber,
      transferNumber: header.transferNumber || null,
      linkedOrderNumber: header.linkedOrderNumber || null,
      transactionDate: header.TransactionDate,
      transactionType: header.TransactionType,
      recipientFullName: header.RecipientFullName,
      destinationWarehouseName: header.DestinationWarehouseName,
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

// POST /stock-outs/:id/corrections
stockOutRouter.post('/:id/corrections', (req: Request, res: Response) => {
  const { id } = req.params;
  const body = correctStockOutSchema.parse(req.body);
  const adminId = req.admin!.id;
  const now = getUtcTimestamp();

  const current = db.prepare(`SELECT * FROM StockOutTransactions WHERE Id = ?`).get(id) as any;
  if (!current) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Stock Out transaction not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  if (current.TransactionType === 'CustomerOrderDelivery') {
    return res.status(422).json({
      type: 'CORRECTION_NOT_ALLOWED',
      title: 'Customer order deliveries cannot be corrected directly. Use an Order Return or Stock Adjustment instead.',
      status: 422,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  const currentItems = db.prepare(`SELECT * FROM StockOutItems WHERE StockOutTransactionId = ?`).all(id) as any[];
  const currentReceipt = db.prepare(`
    SELECT Id FROM Receipts
    WHERE SourceType = 'StockOut' AND SourceEntityId = ? AND SourceVersion = ?
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
      ) VALUES (?, 'StockOut', ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      id,
      current.Version,
      JSON.stringify({ header: current, items: currentItems }),
      body.reason,
      now,
      adminId
    );

    const movementType =
      body.transactionType === 'Sample'
        ? ('Sample' as const)
        : body.transactionType === 'Gift'
        ? ('Gift' as const)
        : ('WarehouseTransferOut' as const);

    // 2. Reverse previous version movements (add back stock)
    const reversalMovements = currentItems.map((item) => ({
      productId: item.ProductId,
      movementType,
      sourceEntityType: 'StockOut' as const,
      sourceEntityId: id,
      sourceLineId: item.Id,
      sourceVersion: current.Version,
      isReversal: true,
      deltaAvailable: item.Quantity,
      deltaDamaged: 0,
      businessDate: current.TransactionDate,
      adminId,
      reason: `Correction reversal: ${current.StockOutNumber} v${current.Version} (${body.reason})`,
    }));

    recordStockMovements(reversalMovements);

    // 3. Update header
    db.prepare(`
      UPDATE StockOutTransactions
      SET TransactionDate = ?,
          RecipientFullName = ?,
          DestinationWarehouseName = ?,
          Version = ?,
          UpdatedAtUtc = ?,
          UpdatedByAdminId = ?,
          RowVersion = RowVersion + 1
      WHERE Id = ?
    `).run(
      body.transactionDate,
      body.recipientFullName ? body.recipientFullName.trim() : null,
      body.destinationWarehouseName ? body.destinationWarehouseName.trim() : null,
      newVersion,
      now,
      adminId,
      id
    );

    // 4. Delete old lines and insert new lines
    db.prepare(`DELETE FROM StockOutItems WHERE StockOutTransactionId = ?`).run(id);

    const insertItem = db.prepare(`
      INSERT INTO StockOutItems (Id, StockOutTransactionId, ProductId, ProductNameSnapshot, Quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    const newMovements = body.items.map((item) => {
      const lineId = uuidv4();
      const prodName = productMap.get(item.productId)!;
      insertItem.run(lineId, id, item.productId, prodName, item.quantity);

      return {
        productId: item.productId,
        movementType,
        sourceEntityType: 'StockOut' as const,
        sourceEntityId: id,
        sourceLineId: lineId,
        sourceVersion: newVersion,
        deltaAvailable: -item.quantity,
        deltaDamaged: 0,
        businessDate: body.transactionDate,
        adminId,
        reason: `Restated: ${current.StockOutNumber} v${newVersion} (${body.reason})`,
      };
    });

    recordStockMovements(newMovements);

    // 5. Create new receipt superseding the old one
    const receiptResult = createReceipt({
      sourceType: 'StockOut',
      sourceEntityId: id,
      sourceVersion: newVersion,
      supersedesReceiptId: currentReceipt?.Id,
      adminId,
      receiptData: {
        sourceNumber: current.StockOutNumber,
        version: newVersion,
        reason: body.reason,
        transactionDate: body.transactionDate,
        transactionType: body.transactionType,
        recipientFullName: body.recipientFullName || null,
        destinationWarehouseName: body.destinationWarehouseName || null,
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
      action: 'StockOut.Corrected',
      entityType: 'StockOut',
      entityId: id,
      description: `Stock Out corrected: ${current.StockOutNumber} to v${newVersion}. Reason: ${body.reason}`,
      newData: body,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  });

  correctTx();

  return res.json({
    data: {
      id,
      stockOutNumber: current.StockOutNumber,
      version: newVersion,
      receiptId,
      receiptNumber,
      transactionDate: body.transactionDate,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});
