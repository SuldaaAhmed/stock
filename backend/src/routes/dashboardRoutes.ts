import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { getNairobiDate } from '../utils/date';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', (req: Request, res: Response) => {
  const today = getNairobiDate();

  // 1. Total Products (Active)
  const totalProductsRow = db.prepare(`
    SELECT COUNT(*) as count FROM Products WHERE Status = 'Active'
  `).get() as { count: number };

  // 2. Total Stock (Available only)
  const totalStockRow = db.prepare(`
    SELECT COALESCE(SUM(pb.AvailableQuantity), 0) as total
    FROM ProductBalances pb
    JOIN Products p ON p.Id = pb.ProductId
    WHERE p.Status = 'Active'
  `).get() as { total: number };

  // 3. Low Stock Products
  const lowStockRows = db.prepare(`
    SELECT p.Id as productId, p.ProductName as productName,
           pb.AvailableQuantity as currentQuantity, p.MinimumStock as minimumQuantity
    FROM Products p
    JOIN ProductBalances pb ON pb.ProductId = p.Id
    WHERE p.Status = 'Active' AND pb.AvailableQuantity <= p.MinimumStock
    ORDER BY (p.MinimumStock - pb.AvailableQuantity) DESC, p.ProductName ASC
    LIMIT 20
  `).all() as any[];

  // 4. Damaged Stock
  const damagedStockRow = db.prepare(`
    SELECT COALESCE(SUM(pb.DamagedQuantity), 0) as total
    FROM ProductBalances pb
  `).get() as { total: number };

  // 5. Today's Stock In
  const todayStockInRow = db.prepare(`
    SELECT
      COALESCE(COUNT(DISTINCT si.Id), 0) as transactions,
      COALESCE(SUM(sii.Quantity), 0) as quantity
    FROM StockInTransactions si
    LEFT JOIN StockInItems sii ON sii.StockInTransactionId = si.Id
    WHERE si.TransactionDate = ?
  `).get(today) as { transactions: number; quantity: number };

  // 6. Today's Stock Out
  const todayStockOutRow = db.prepare(`
    SELECT
      COALESCE(COUNT(DISTINCT so.Id), 0) as transactions,
      COALESCE(SUM(soi.Quantity), 0) as quantity
    FROM StockOutTransactions so
    LEFT JOIN StockOutItems soi ON soi.StockOutTransactionId = so.Id
    WHERE so.TransactionDate = ?
  `).get(today) as { transactions: number; quantity: number };

  // 7. Today's Returns
  const todayReturnsRow = db.prepare(`
    SELECT
      COALESCE(COUNT(DISTINCT r.Id), 0) as transactions,
      COALESCE(SUM(ri.Quantity), 0) as quantity
    FROM Returns r
    LEFT JOIN ReturnItems ri ON ri.ReturnId = r.Id
    WHERE r.ReturnDate = ?
  `).get(today) as { transactions: number; quantity: number };

  // 8. Recent 10 Transactions
  const recentStockIn = db.prepare(`
    SELECT 'StockIn' as type, Id as id, StockInNumber as number, TransactionDate as date,
           ('Stock In (' || TransactionType || ')') as summary, CreatedAtUtc as createdAtUtc
    FROM StockInTransactions
    ORDER BY CreatedAtUtc DESC LIMIT 10
  `).all() as any[];

  const recentStockOut = db.prepare(`
    SELECT 'StockOut' as type, Id as id, StockOutNumber as number, TransactionDate as date,
           ('Stock Out (' || TransactionType || ')') as summary, CreatedAtUtc as createdAtUtc
    FROM StockOutTransactions
    ORDER BY CreatedAtUtc DESC LIMIT 10
  `).all() as any[];

  const recentOrders = db.prepare(`
    SELECT 'Order' as type, Id as id, OrderNumber as number, OrderDate as date,
           ('Order for ' || CustomerNameSnapshot) as summary, CreatedAtUtc as createdAtUtc
    FROM Orders
    ORDER BY CreatedAtUtc DESC LIMIT 10
  `).all() as any[];

  const recentReturns = db.prepare(`
    SELECT 'Return' as type, Id as id, ReturnNumber as number, ReturnDate as date,
           ('Return from ' || CustomerNameSnapshot) as summary, CreatedAtUtc as createdAtUtc
    FROM Returns
    ORDER BY CreatedAtUtc DESC LIMIT 10
  `).all() as any[];

  const recentAdjustments = db.prepare(`
    SELECT 'Adjustment' as type, Id as id, AdjustmentNumber as number, AdjustmentDate as date,
           ('Stock Adjustment (' || Direction || ')') as summary, CreatedAtUtc as createdAtUtc
    FROM StockAdjustments
    ORDER BY CreatedAtUtc DESC LIMIT 10
  `).all() as any[];

  const allRecent = [
    ...recentStockIn,
    ...recentStockOut,
    ...recentOrders,
    ...recentReturns,
    ...recentAdjustments,
  ]
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))
    .slice(0, 10);

  return res.json({
    data: {
      totalProducts: totalProductsRow.count,
      totalStock: Math.round(totalStockRow.total),
      lowStock: {
        count: lowStockRows.length,
        items: lowStockRows,
      },
      damagedStock: Math.round(damagedStockRow.total),
      todayStockIn: {
        quantity: Math.round(todayStockInRow.quantity),
        transactions: todayStockInRow.transactions,
      },
      todayStockOut: {
        quantity: Math.round(todayStockOutRow.quantity),
        transactions: todayStockOutRow.transactions,
      },
      todayReturns: {
        quantity: Math.round(todayReturnsRow.quantity),
        transactions: todayReturnsRow.transactions,
      },
      recentTransactions: allRecent,
    },
    requestId: req.headers['x-request-id'] || 'req-' + Date.now(),
  });
});
