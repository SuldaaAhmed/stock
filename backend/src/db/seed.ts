import { db, initDatabase } from './database';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getUtcTimestamp, getNairobiDate } from '../utils/date';

export function seedDatabase() {
  initDatabase();

  const now = getUtcTimestamp();
  const today = getNairobiDate();

  // 1. Sequences
  const sequences: [string, string, number, number][] = [
    ['StockIn', 'SIN', 1, 4],
    ['StockOut', 'SOUT', 1, 4],
    ['Order', 'ORD', 1, 4],
    ['Return', 'RET', 1, 4],
    ['Adjustment', 'ADJ', 1, 4],
    ['Transfer', 'TRF', 1, 4],
    ['Receipt', 'REC', 1, 4],
  ];

  const insertSeq = db.prepare(`
    INSERT OR IGNORE INTO DocumentSequences (DocumentType, Prefix, NextNumber, PadWidth, UpdatedAtUtc)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const [type, prefix, next, pad] of sequences) {
    insertSeq.run(type, prefix, next, pad, now);
  }

  // 2. Default Admin
  const adminRow = db.prepare(`SELECT Id FROM AspNetUsers WHERE NormalizedUserName = 'ADMIN'`).get() as { Id: string } | undefined;
  let adminId: string;

  if (!adminRow) {
    adminId = uuidv4();
    const passwordHash = bcrypt.hashSync('Admin123!', 10);
    db.prepare(`
      INSERT INTO AspNetUsers (Id, UserName, NormalizedUserName, PasswordHash, Email, SecurityStamp, ConcurrencyStamp, CreatedAtUtc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(adminId, 'admin', 'ADMIN', passwordHash, 'admin@primestock.co.ke', uuidv4(), uuidv4(), now);

    db.prepare(`
      INSERT OR IGNORE INTO AdminPreferences (AdminId, Theme, UpdatedAtUtc)
      VALUES (?, 'Light', ?)
    `).run(adminId, now);

    // Initial audit log
    db.prepare(`
      INSERT INTO AuditLogs (Id, ActorType, AdminId, Action, EntityType, EntityId, Description, OccurredAtUtc)
      VALUES (?, 'System', ?, 'Admin.Seeded', 'Admin', ?, 'Default admin account created', ?)
    `).run(uuidv4(), adminId, adminId, now);
  } else {
    adminId = adminRow.Id;
  }

  // 3. Company Settings
  db.prepare(`
    INSERT OR IGNORE INTO CompanySettings (Singleton, CompanyName, Phone, Email, Address, UpdatedAtUtc, UpdatedByAdminId)
    VALUES (1, 'Prime Stock Logistics Ltd', '+254 700 123 456', 'info@primestock.co.ke', 'Enterprise Road, Industrial Area, Nairobi, Kenya', ?, ?)
  `).run(now, adminId);

  // 4. Sample Products & Opening Stock (if empty)
  const productCount = db.prepare(`SELECT COUNT(*) as count FROM Products`).get() as { count: number };
  if (productCount.count === 0) {
    const initialProducts = [
      { name: 'Standard Cardboard Carton (Medium)', min: 50, price: 120.0, opening: 250 },
      { name: 'Heavy Duty Plastic Container 60L', min: 30, price: 850.0, opening: 80 },
      { name: 'Corrugated Shipping Box (Large)', min: 40, price: 200.0, opening: 35 }, // Low stock
      { name: 'Thermal Insulated Storage Box', min: 20, price: 1500.0, opening: 15 }, // Low stock
      { name: 'Biodegradable Packaging Box', min: 25, price: 95.0, opening: 120 },
    ];

    const insertProd = db.prepare(`
      INSERT INTO Products (Id, ProductName, MinimumStock, SellingPrice, Status, CreatedAtUtc, CreatedByAdminId, UpdatedAtUtc, UpdatedByAdminId)
      VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?)
    `);

    const insertOpening = db.prepare(`
      INSERT INTO ProductOpeningStock (ProductId, Quantity, RecordedAtUtc, RecordedByAdminId)
      VALUES (?, ?, ?, ?)
    `);

    const insertBalance = db.prepare(`
      INSERT INTO ProductBalances (ProductId, AvailableQuantity, DamagedQuantity, LastReconciledAtUtc, UpdatedAtUtc)
      VALUES (?, ?, 0, ?, ?)
    `);

    const insertMovement = db.prepare(`
      INSERT INTO StockMovements (
        Id, SequenceNo, ProductId, MovementType, SourceEntityType, SourceEntityId, SourceLineId,
        SourceVersion, IsReversal, QuantityDeltaAvailable, QuantityDeltaDamaged,
        AvailableBefore, AvailableAfter, DamagedBefore, DamagedAfter,
        BusinessDate, OccurredAtUtc, CreatedByAdminId, Reason
      ) VALUES (
        ?, (SELECT COALESCE(MAX(SequenceNo), 0) + 1 FROM StockMovements),
        ?, 'OpeningStock', 'Product', ?, ?,
        1, 0, ?, 0,
        0, ?, 0, 0,
        ?, ?, ?, 'Initial opening stock'
      )
    `);

    for (const p of initialProducts) {
      const prodId = uuidv4();
      insertProd.run(prodId, p.name, p.min, p.price, now, adminId, now, adminId);
      insertOpening.run(prodId, p.opening, now, adminId);
      insertBalance.run(prodId, p.opening, now, now);

      if (p.opening > 0) {
        insertMovement.run(
          uuidv4(),
          prodId,
          prodId,
          prodId,
          p.opening,
          p.opening,
          today,
          now,
          adminId
        );
      }
    }

    // 5. Sample Customers
    const initialCustomers = [
      { name: 'Apex Wholesalers Ltd', phone: '+254 711 223 344', email: 'orders@apexwholesalers.com', location: 'Mombasa Road, Nairobi', notes: 'Key distributor' },
      { name: 'Kilimanjaro Traders', phone: '+254 722 334 455', email: 'info@kilimanjarotraders.ke', location: 'CBD, Nairobi', notes: 'Retail partner' },
      { name: 'Safari Supermarkets', phone: '+254 733 445 566', email: 'procurement@safarisupers.com', location: 'Westlands, Nairobi', notes: 'Supermarket chain' },
    ];

    const insertCust = db.prepare(`
      INSERT INTO Customers (Id, FullName, Phone, Email, Location, Notes, CreatedAtUtc, CreatedByAdminId, UpdatedAtUtc, UpdatedByAdminId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const c of initialCustomers) {
      insertCust.run(uuidv4(), c.name, c.phone, c.email, c.location, c.notes, now, adminId, now, adminId);
    }
  }
}
