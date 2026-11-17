import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/database';
import { recordStockMovements, InsufficientStockError } from '../services/stockEngine';
import { logAudit, logEditHistory } from '../services/auditService';
import { getUtcTimestamp, getNairobiDate } from '../utils/date';

export const productRouter = Router();

const createProductSchema = z.object({
  productName: z.string().min(1, 'Product name is required').trim(),
  minimumStock: z.number().int().min(0, 'Minimum stock must be whole number >= 0'),
  sellingPrice: z.number().min(0, 'Selling price must be >= 0').optional().nullable(),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  openingStock: z.number().int().min(0, 'Opening stock must be whole number >= 0').default(0),
});

const patchProductSchema = z.object({
  productName: z.string().min(1).trim().optional(),
  minimumStock: z.number().int().min(0).optional(),
  sellingPrice: z.number().min(0).optional().nullable(),
  status: z.enum(['Active', 'Inactive']).optional(),
  reason: z.string().min(1, 'Reason is mandatory for editing product details'),
});

const correctOpeningStockSchema = z.object({
  newQuantity: z.number().int().min(0, 'New opening stock must be whole number >= 0'),
  reason: z.string().min(1, 'Reason is mandatory for opening stock correction'),
});

// GET /products
productRouter.get('/', (req: Request, res: Response) => {
  const { search, status, lowStock, hasDamaged, page = '1', pageSize = '50' } = req.query;

  let query = `
    SELECT p.Id as id, p.ProductName as productName, pb.AvailableQuantity as currentStock,
           p.MinimumStock as minimumStock, p.SellingPrice as sellingPrice,
           pb.DamagedQuantity as damagedStock, p.Status as status,
           p.RowVersion as rowVersion,
           (CASE WHEN pb.AvailableQuantity <= p.MinimumStock AND p.Status = 'Active' THEN 1 ELSE 0 END) as isLowStock
    FROM Products p
    JOIN ProductBalances pb ON pb.ProductId = p.Id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search && typeof search === 'string' && search.trim()) {
    query += ` AND lower(p.ProductName) LIKE ?`;
    params.push(`%${search.trim().toLowerCase()}%`);
  }

  if (status && (status === 'Active' || status === 'Inactive')) {
    query += ` AND p.Status = ?`;
    params.push(status);
  }

  if (lowStock === 'true' || lowStock === '1') {
    query += ` AND pb.AvailableQuantity <= p.MinimumStock AND p.Status = 'Active'`;
  }

  if (hasDamaged === 'true' || hasDamaged === '1') {
    query += ` AND pb.DamagedQuantity > 0`;
  }

  query += ` ORDER BY p.ProductName ASC`;

  const rows = db.prepare(query).all(...params) as any[];

  return res.json({
    data: rows.map((r) => ({
      ...r,
      currentStock: Math.round(r.currentStock),
      minimumStock: Math.round(r.minimumStock),
      damagedStock: Math.round(r.damagedStock),
      isLowStock: Boolean(r.isLowStock),
    })),
    meta: {
      totalItems: rows.length,
      page: parseInt(page as string, 10),
      pageSize: parseInt(pageSize as string, 10),
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// POST /products
productRouter.post('/', (req: Request, res: Response) => {
  const body = createProductSchema.parse(req.body);
  const adminId = req.admin!.id;
  const now = getUtcTimestamp();
  const today = getNairobiDate();

  // Check unique product name
  const existing = db.prepare(`SELECT Id FROM Products WHERE lower(btrim(ProductName)) = lower(?)`).get(body.productName);
  if (existing) {
    return res.status(409).json({
      type: 'DUPLICATE_PRODUCT_NAME',
      title: 'A product with this name already exists.',
      status: 409,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
      errors: [{ field: 'productName', message: 'Product name must be unique.' }],
    });
  }

  const productId = uuidv4();

  const postTx = db.transaction(() => {
    // 1. Insert Product
    db.prepare(`
      INSERT INTO Products (
        Id, ProductName, MinimumStock, SellingPrice, Status,
        CreatedAtUtc, CreatedByAdminId, UpdatedAtUtc, UpdatedByAdminId, RowVersion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      productId,
      body.productName,
      body.minimumStock,
      body.sellingPrice !== undefined ? body.sellingPrice : null,
      body.status,
      now,
      adminId,
      now,
      adminId
    );

    // 2. Insert Opening Stock
    db.prepare(`
      INSERT INTO ProductOpeningStock (ProductId, Quantity, RecordedAtUtc, RecordedByAdminId)
      VALUES (?, ?, ?, ?)
    `).run(productId, body.openingStock, now, adminId);

    // 3. Insert Product Balances
    db.prepare(`
      INSERT INTO ProductBalances (ProductId, AvailableQuantity, DamagedQuantity, LastReconciledAtUtc, UpdatedAtUtc)
      VALUES (?, ?, 0, ?, ?)
    `).run(productId, body.openingStock, now, now);

    // 4. Record Initial Stock Movement if opening > 0
    if (body.openingStock > 0) {
      db.prepare(`
        INSERT INTO StockMovements (
          Id, SequenceNo, ProductId, MovementType, SourceEntityType, SourceEntityId,
          SourceLineId, SourceVersion, IsReversal, QuantityDeltaAvailable, QuantityDeltaDamaged,
          AvailableBefore, AvailableAfter, DamagedBefore, DamagedAfter,
          BusinessDate, OccurredAtUtc, CreatedByAdminId, Reason
        ) VALUES (
          ?, (SELECT COALESCE(MAX(SequenceNo), 0) + 1 FROM StockMovements),
          ?, 'OpeningStock', 'Product', ?, ?,
          1, 0, ?, 0,
          0, ?, 0, 0,
          ?, ?, ?, 'Initial opening stock'
        )
      `).run(
        uuidv4(),
        productId,
        productId,
        productId,
        body.openingStock,
        body.openingStock,
        today,
        now,
        adminId
      );
    }

    // 5. Audit Log
    logAudit({
      actorType: 'Admin',
      adminId,
      action: 'Product.Created',
      entityType: 'Product',
      entityId: productId,
      description: `Product created: ${body.productName} with opening stock ${body.openingStock} BOX`,
      newData: body,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  });

  postTx();

  return res.status(201).json({
    data: {
      id: productId,
      productName: body.productName,
      minimumStock: body.minimumStock,
      sellingPrice: body.sellingPrice || null,
      status: body.status,
      openingStock: body.openingStock,
      currentStock: body.openingStock,
      damagedStock: 0,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// GET /products/:id
productRouter.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const product = db.prepare(`
    SELECT p.Id as id, p.ProductName as productName, p.MinimumStock as minimumStock,
           p.SellingPrice as sellingPrice, p.Status as status, p.RowVersion as rowVersion,
           p.CreatedAtUtc as createdAtUtc, p.UpdatedAtUtc as updatedAtUtc,
           pos.Quantity as openingStock,
           pb.AvailableQuantity as currentStock, pb.DamagedQuantity as damagedStock
    FROM Products p
    JOIN ProductBalances pb ON pb.ProductId = p.Id
    JOIN ProductOpeningStock pos ON pos.ProductId = p.Id
    WHERE p.Id = ?
  `).get(id) as any;

  if (!product) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Product not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  // Calculate detailed totals from ledger movements
  const totalsRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN MovementType = 'StockIn' THEN QuantityDeltaAvailable ELSE 0 END), 0) as stockIn,
      COALESCE(SUM(CASE WHEN MovementType IN ('CustomerDelivery', 'Sample', 'Gift', 'WarehouseTransferOut') THEN -QuantityDeltaAvailable ELSE 0 END), 0) as stockOut,
      COALESCE(SUM(CASE WHEN MovementType = 'GoodReturn' THEN QuantityDeltaAvailable ELSE 0 END), 0) as returnsGood,
      COALESCE(SUM(CASE WHEN MovementType = 'DamagedReturn' THEN QuantityDeltaDamaged ELSE 0 END), 0) as returnsDamaged,
      COALESCE(SUM(CASE WHEN MovementType = 'AdjustmentIncrease' THEN QuantityDeltaAvailable ELSE 0 END), 0) as adjustmentsIn,
      COALESCE(SUM(CASE WHEN MovementType = 'AdjustmentDecrease' THEN -QuantityDeltaAvailable ELSE 0 END), 0) as adjustmentsOut,
      COALESCE(SUM(CASE WHEN MovementType = 'DamagedMarkedGood' THEN QuantityDeltaAvailable ELSE 0 END), 0) as markedAsGood,
      COALESCE(SUM(CASE WHEN MovementType = 'DamagedRemoved' THEN -QuantityDeltaDamaged ELSE 0 END), 0) as removedFromDamaged
    FROM StockMovements
    WHERE ProductId = ?
  `).get(id) as any;

  res.setHeader('ETag', `"${product.rowVersion}"`);

  return res.json({
    data: {
      ...product,
      currentStock: Math.round(product.currentStock),
      damagedStock: Math.round(product.damagedStock),
      openingStock: Math.round(product.openingStock),
      totals: {
        stockIn: Math.round(totalsRow.stockIn),
        stockOut: Math.round(totalsRow.stockOut),
        returnsGood: Math.round(totalsRow.returnsGood),
        returnsDamaged: Math.round(totalsRow.returnsDamaged),
        adjustmentsIn: Math.round(totalsRow.adjustmentsIn),
        adjustmentsOut: Math.round(totalsRow.adjustmentsOut),
        markedAsGood: Math.round(totalsRow.markedAsGood),
        removedFromDamaged: Math.round(totalsRow.removedFromDamaged),
      },
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// PATCH /products/:id
productRouter.patch('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const body = patchProductSchema.parse(req.body);
  const adminId = req.admin!.id;
  const now = getUtcTimestamp();

  const current = db.prepare(`SELECT * FROM Products WHERE Id = ?`).get(id) as any;
  if (!current) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Product not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  // Concurrency check with If-Match
  const ifMatch = req.headers['if-match'];
  if (ifMatch && ifMatch !== `"${current.RowVersion}"` && ifMatch !== String(current.RowVersion)) {
    return res.status(409).json({
      type: 'CONCURRENCY_CONFLICT',
      title: 'The product was modified by another request.',
      status: 409,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  // Check unique name if changing name
  if (body.productName && body.productName !== current.ProductName) {
    const existing = db.prepare(`SELECT Id FROM Products WHERE lower(btrim(ProductName)) = lower(?) AND Id != ?`).get(body.productName, id);
    if (existing) {
      return res.status(409).json({
        type: 'DUPLICATE_PRODUCT_NAME',
        title: 'A product with this name already exists.',
        status: 409,
        requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
        errors: [{ field: 'productName', message: 'Product name must be unique.' }],
      });
    }
  }

  const changes: { fieldName: string; oldValue: any; newValue: any }[] = [];
  if (body.productName !== undefined && body.productName !== current.ProductName) {
    changes.push({ fieldName: 'ProductName', oldValue: current.ProductName, newValue: body.productName });
  }
  if (body.minimumStock !== undefined && body.minimumStock !== current.MinimumStock) {
    changes.push({ fieldName: 'MinimumStock', oldValue: current.MinimumStock, newValue: body.minimumStock });
  }
  if (body.sellingPrice !== undefined && body.sellingPrice !== current.SellingPrice) {
    changes.push({ fieldName: 'SellingPrice', oldValue: current.SellingPrice, newValue: body.sellingPrice });
  }
  if (body.status !== undefined && body.status !== current.Status) {
    changes.push({ fieldName: 'Status', oldValue: current.Status, newValue: body.status });
  }

  if (changes.length === 0) {
    return res.json({
      data: current,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  const patchTx = db.transaction(() => {
    db.prepare(`
      UPDATE Products
      SET ProductName = COALESCE(?, ProductName),
          MinimumStock = COALESCE(?, MinimumStock),
          SellingPrice = ?,
          Status = COALESCE(?, Status),
          UpdatedAtUtc = ?,
          UpdatedByAdminId = ?,
          RowVersion = RowVersion + 1
      WHERE Id = ?
    `).run(
      body.productName || null,
      body.minimumStock !== undefined ? body.minimumStock : null,
      body.sellingPrice !== undefined ? body.sellingPrice : current.SellingPrice,
      body.status || null,
      now,
      adminId,
      id
    );

    logEditHistory('Product', id, changes, adminId, body.reason);

    logAudit({
      actorType: 'Admin',
      adminId,
      action: 'Product.Updated',
      entityType: 'Product',
      entityId: id,
      description: `Product updated: ${changes.map(c => c.fieldName).join(', ')}. Reason: ${body.reason}`,
      oldData: current,
      newData: { ...current, ...body },
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  });

  patchTx();

  const updated = db.prepare(`SELECT * FROM Products WHERE Id = ?`).get(id) as any;
  res.setHeader('ETag', `"${updated.RowVersion}"`);

  return res.json({
    data: updated,
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// GET /products/:id/movements
productRouter.get('/:id/movements', (req: Request, res: Response) => {
  const { id } = req.params;
  const { page = '1', pageSize = '50' } = req.query;

  const movements = db.prepare(`
    SELECT Id as id, SequenceNo as sequenceNo, BusinessDate as date,
           MovementType as movementType, SourceEntityType as sourceType,
           SourceEntityId as sourceId, QuantityDeltaAvailable as deltaAvailable,
           QuantityDeltaDamaged as deltaDamaged, AvailableAfter as availableAfter,
           DamagedAfter as damagedAfter, IsReversal as isReversal, Reason as reason,
           OccurredAtUtc as occurredAtUtc
    FROM StockMovements
    WHERE ProductId = ?
    ORDER BY SequenceNo DESC
    LIMIT ? OFFSET ?
  `).all(id, parseInt(pageSize as string, 10), (parseInt(page as string, 10) - 1) * parseInt(pageSize as string, 10)) as any[];

  return res.json({
    data: movements.map((m) => ({
      ...m,
      isReversal: Boolean(m.isReversal),
    })),
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// GET /products/:id/edit-history
productRouter.get('/:id/edit-history', (req: Request, res: Response) => {
  const { id } = req.params;

  const history = db.prepare(`
    SELECT eh.Id as id, eh.FieldName as fieldName, eh.OldValue as oldValue,
           eh.NewValue as newValue, eh.Reason as reason, eh.ChangedAtUtc as changedAtUtc,
           u.UserName as admin
    FROM EditHistory eh
    LEFT JOIN AspNetUsers u ON u.Id = eh.ChangedByAdminId
    WHERE eh.EntityType = 'Product' AND eh.EntityId = ?
    ORDER BY eh.ChangedAtUtc DESC
  `).all(id) as any[];

  return res.json({
    data: history,
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});

// POST /products/:id/opening-stock-corrections
productRouter.post('/:id/opening-stock-corrections', (req: Request, res: Response) => {
  const { id } = req.params;
  const body = correctOpeningStockSchema.parse(req.body);
  const adminId = req.admin!.id;
  const now = getUtcTimestamp();
  const today = getNairobiDate();

  const openingRow = db.prepare(`SELECT * FROM ProductOpeningStock WHERE ProductId = ?`).get(id) as any;
  const balanceRow = db.prepare(`SELECT * FROM ProductBalances WHERE ProductId = ?`).get(id) as any;
  const productRow = db.prepare(`SELECT * FROM Products WHERE Id = ?`).get(id) as any;

  if (!openingRow || !balanceRow || !productRow) {
    return res.status(404).json({
      type: 'NOT_FOUND',
      title: 'Product or opening stock record not found.',
      status: 404,
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  const oldQuantity = openingRow.Quantity;
  const newQuantity = body.newQuantity;
  const delta = newQuantity - oldQuantity;

  if (delta === 0) {
    return res.json({
      data: { message: 'No change in opening stock quantity.' },
      requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
    });
  }

  if (balanceRow.AvailableQuantity + delta < 0) {
    throw new InsufficientStockError(productRow.ProductName, balanceRow.AvailableQuantity, Math.abs(delta));
  }

  const correctTx = db.transaction(() => {
    // 1. Update ProductOpeningStock
    db.prepare(`
      UPDATE ProductOpeningStock
      SET Quantity = ?, LastCorrectedAtUtc = ?, LastCorrectedByAdminId = ?
      WHERE ProductId = ?
    `).run(newQuantity, now, adminId, id);

    // 2. Post Movement via Stock Engine
    recordStockMovements([
      {
        productId: id,
        movementType: 'OpeningStockCorrection',
        sourceEntityType: 'Product',
        sourceEntityId: id,
        sourceLineId: id,
        sourceVersion: 2,
        deltaAvailable: delta,
        deltaDamaged: 0,
        businessDate: today,
        adminId,
        reason: body.reason,
      },
    ]);

    // 3. Record Edit History
    logEditHistory(
      'Product',
      id,
      [{ fieldName: 'OpeningStock', oldValue: oldQuantity, newValue: newQuantity }],
      adminId,
      body.reason
    );

    // 4. Audit Log
    logAudit({
      actorType: 'Admin',
      adminId,
      action: 'Product.OpeningStockCorrected',
      entityType: 'Product',
      entityId: id,
      description: `Opening stock corrected for ${productRow.ProductName}: ${oldQuantity} -> ${newQuantity} BOX. Reason: ${body.reason}`,
      oldData: { openingStock: oldQuantity },
      newData: { openingStock: newQuantity, reason: body.reason },
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string,
    });
  });

  correctTx();

  const updatedBalance = db.prepare(`SELECT * FROM ProductBalances WHERE ProductId = ?`).get(id) as any;

  return res.json({
    data: {
      productId: id,
      newOpeningStock: newQuantity,
      availableQuantity: updatedBalance.AvailableQuantity,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});
