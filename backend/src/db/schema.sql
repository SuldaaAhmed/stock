PRAGMA foreign_keys = ON;

-- Identity & Preferences
CREATE TABLE IF NOT EXISTS AspNetUsers (
    Id TEXT PRIMARY KEY,
    UserName TEXT NOT NULL UNIQUE,
    NormalizedUserName TEXT NOT NULL UNIQUE,
    PasswordHash TEXT NOT NULL,
    Email TEXT,
    SecurityStamp TEXT NOT NULL,
    ConcurrencyStamp TEXT NOT NULL,
    CreatedAtUtc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AdminPreferences (
    AdminId TEXT PRIMARY KEY,
    Theme TEXT NOT NULL DEFAULT 'Light' CHECK (Theme IN ('Light', 'Dark')),
    UpdatedAtUtc TEXT NOT NULL,
    FOREIGN KEY (AdminId) REFERENCES AspNetUsers(Id)
);

-- Catalogue & Balances
CREATE TABLE IF NOT EXISTS Products (
    Id TEXT PRIMARY KEY,
    ProductName TEXT NOT NULL UNIQUE,
    MinimumStock REAL NOT NULL DEFAULT 0 CHECK (MinimumStock >= 0 AND MinimumStock = CAST(MinimumStock AS INTEGER)),
    SellingPrice REAL CHECK (SellingPrice IS NULL OR SellingPrice >= 0),
    Status TEXT NOT NULL DEFAULT 'Active' CHECK (Status IN ('Active', 'Inactive')),
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ProductOpeningStock (
    ProductId TEXT PRIMARY KEY,
    Quantity REAL NOT NULL DEFAULT 0 CHECK (Quantity >= 0 AND Quantity = CAST(Quantity AS INTEGER)),
    RecordedAtUtc TEXT NOT NULL,
    RecordedByAdminId TEXT NOT NULL,
    LastCorrectedAtUtc TEXT,
    LastCorrectedByAdminId TEXT,
    FOREIGN KEY (ProductId) REFERENCES Products(Id)
);

CREATE TABLE IF NOT EXISTS ProductBalances (
    ProductId TEXT PRIMARY KEY,
    AvailableQuantity REAL NOT NULL DEFAULT 0 CHECK (AvailableQuantity >= 0 AND AvailableQuantity = CAST(AvailableQuantity AS INTEGER)),
    DamagedQuantity REAL NOT NULL DEFAULT 0 CHECK (DamagedQuantity >= 0 AND DamagedQuantity = CAST(DamagedQuantity AS INTEGER)),
    LastReconciledAtUtc TEXT,
    UpdatedAtUtc TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (ProductId) REFERENCES Products(Id)
);

-- Sequences for Numbering
CREATE TABLE IF NOT EXISTS DocumentSequences (
    DocumentType TEXT PRIMARY KEY,
    Prefix TEXT NOT NULL,
    NextNumber INTEGER NOT NULL DEFAULT 1 CHECK (NextNumber >= 1),
    PadWidth INTEGER NOT NULL DEFAULT 4,
    UpdatedAtUtc TEXT NOT NULL
);

-- Customers
CREATE TABLE IF NOT EXISTS Customers (
    Id TEXT PRIMARY KEY,
    FullName TEXT NOT NULL,
    Phone TEXT,
    Email TEXT,
    Location TEXT,
    Notes TEXT,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1
);

-- Stock In
CREATE TABLE IF NOT EXISTS StockInTransactions (
    Id TEXT PRIMARY KEY,
    StockInNumber TEXT NOT NULL UNIQUE,
    TransactionDate TEXT NOT NULL,
    TransactionType TEXT NOT NULL CHECK (TransactionType IN ('NewStock', 'WarehouseTransferIn')),
    SourceWarehouseName TEXT,
    Version INTEGER NOT NULL DEFAULT 1,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS StockInItems (
    Id TEXT PRIMARY KEY,
    StockInTransactionId TEXT NOT NULL,
    ProductId TEXT NOT NULL,
    ProductNameSnapshot TEXT NOT NULL,
    Quantity REAL NOT NULL CHECK (Quantity > 0 AND Quantity = CAST(Quantity AS INTEGER)),
    FOREIGN KEY (StockInTransactionId) REFERENCES StockInTransactions(Id),
    FOREIGN KEY (ProductId) REFERENCES Products(Id),
    UNIQUE(StockInTransactionId, ProductId)
);

-- Orders
CREATE TABLE IF NOT EXISTS Orders (
    Id TEXT PRIMARY KEY,
    OrderNumber TEXT NOT NULL UNIQUE,
    CustomerId TEXT NOT NULL,
    CustomerNameSnapshot TEXT NOT NULL,
    OrderDate TEXT NOT NULL,
    Status TEXT NOT NULL DEFAULT 'Pending' CHECK (Status IN ('Pending', 'PartiallyCompleted', 'Completed')),
    CompletedAtUtc TEXT,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (CustomerId) REFERENCES Customers(Id)
);

CREATE TABLE IF NOT EXISTS OrderItems (
    Id TEXT PRIMARY KEY,
    OrderId TEXT NOT NULL,
    ProductId TEXT NOT NULL,
    ProductNameSnapshot TEXT NOT NULL,
    OrderedQuantity REAL NOT NULL CHECK (OrderedQuantity > 0 AND OrderedQuantity = CAST(OrderedQuantity AS INTEGER)),
    DeliveredQuantity REAL NOT NULL DEFAULT 0 CHECK (DeliveredQuantity >= 0 AND DeliveredQuantity <= OrderedQuantity AND DeliveredQuantity = CAST(DeliveredQuantity AS INTEGER)),
    FOREIGN KEY (OrderId) REFERENCES Orders(Id),
    FOREIGN KEY (ProductId) REFERENCES Products(Id),
    UNIQUE(OrderId, ProductId)
);

-- Stock Out
CREATE TABLE IF NOT EXISTS StockOutTransactions (
    Id TEXT PRIMARY KEY,
    StockOutNumber TEXT NOT NULL UNIQUE,
    TransactionDate TEXT NOT NULL,
    TransactionType TEXT NOT NULL CHECK (TransactionType IN ('CustomerOrderDelivery', 'Sample', 'Gift', 'WarehouseTransfer')),
    CustomerOrderId TEXT,
    RecipientFullName TEXT,
    DestinationWarehouseName TEXT,
    Version INTEGER NOT NULL DEFAULT 1,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (CustomerOrderId) REFERENCES Orders(Id)
);

CREATE TABLE IF NOT EXISTS StockOutItems (
    Id TEXT PRIMARY KEY,
    StockOutTransactionId TEXT NOT NULL,
    ProductId TEXT NOT NULL,
    ProductNameSnapshot TEXT NOT NULL,
    Quantity REAL NOT NULL CHECK (Quantity > 0 AND Quantity = CAST(Quantity AS INTEGER)),
    FOREIGN KEY (StockOutTransactionId) REFERENCES StockOutTransactions(Id),
    FOREIGN KEY (ProductId) REFERENCES Products(Id),
    UNIQUE(StockOutTransactionId, ProductId)
);

-- Warehouse Transfers Out
CREATE TABLE IF NOT EXISTS WarehouseTransfers (
    Id TEXT PRIMARY KEY,
    TransferNumber TEXT NOT NULL UNIQUE,
    StockOutTransactionId TEXT NOT NULL UNIQUE,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    FOREIGN KEY (StockOutTransactionId) REFERENCES StockOutTransactions(Id)
);

-- Order Deliveries
CREATE TABLE IF NOT EXISTS OrderDeliveries (
    Id TEXT PRIMARY KEY,
    OrderId TEXT NOT NULL,
    DeliveryDate TEXT NOT NULL,
    StockOutTransactionId TEXT NOT NULL UNIQUE,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    FOREIGN KEY (OrderId) REFERENCES Orders(Id),
    FOREIGN KEY (StockOutTransactionId) REFERENCES StockOutTransactions(Id)
);

CREATE TABLE IF NOT EXISTS OrderDeliveryItems (
    Id TEXT PRIMARY KEY,
    OrderDeliveryId TEXT NOT NULL,
    OrderItemId TEXT NOT NULL,
    ProductId TEXT NOT NULL,
    QuantityDelivered REAL NOT NULL CHECK (QuantityDelivered > 0 AND QuantityDelivered = CAST(QuantityDelivered AS INTEGER)),
    FOREIGN KEY (OrderDeliveryId) REFERENCES OrderDeliveries(Id),
    FOREIGN KEY (OrderItemId) REFERENCES OrderItems(Id),
    FOREIGN KEY (ProductId) REFERENCES Products(Id)
);

-- Returns
CREATE TABLE IF NOT EXISTS Returns (
    Id TEXT PRIMARY KEY,
    ReturnNumber TEXT NOT NULL UNIQUE,
    ReturnDate TEXT NOT NULL,
    ReturnMode TEXT NOT NULL CHECK (ReturnMode IN ('AgainstOriginalOrder', 'DirectReturn')),
    CustomerId TEXT NOT NULL,
    CustomerNameSnapshot TEXT NOT NULL,
    OriginalOrderId TEXT,
    Reason TEXT NOT NULL,
    Version INTEGER NOT NULL DEFAULT 1,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (CustomerId) REFERENCES Customers(Id),
    FOREIGN KEY (OriginalOrderId) REFERENCES Orders(Id)
);

CREATE TABLE IF NOT EXISTS ReturnItems (
    Id TEXT PRIMARY KEY,
    ReturnId TEXT NOT NULL,
    ProductId TEXT NOT NULL,
    ProductNameSnapshot TEXT NOT NULL,
    Quantity REAL NOT NULL CHECK (Quantity > 0 AND Quantity = CAST(Quantity AS INTEGER)),
    Condition TEXT NOT NULL CHECK (Condition IN ('Good', 'Damaged')),
    OriginalOrderItemId TEXT,
    FOREIGN KEY (ReturnId) REFERENCES Returns(Id),
    FOREIGN KEY (ProductId) REFERENCES Products(Id),
    FOREIGN KEY (OriginalOrderItemId) REFERENCES OrderItems(Id),
    UNIQUE(ReturnId, ProductId, Condition)
);

-- Adjustments
CREATE TABLE IF NOT EXISTS StockAdjustments (
    Id TEXT PRIMARY KEY,
    AdjustmentNumber TEXT NOT NULL UNIQUE,
    AdjustmentDate TEXT NOT NULL,
    Direction TEXT NOT NULL CHECK (Direction IN ('Increase', 'Decrease')),
    Reason TEXT NOT NULL,
    Version INTEGER NOT NULL DEFAULT 1,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS StockAdjustmentItems (
    Id TEXT PRIMARY KEY,
    StockAdjustmentId TEXT NOT NULL,
    ProductId TEXT NOT NULL,
    ProductNameSnapshot TEXT NOT NULL,
    Quantity REAL NOT NULL CHECK (Quantity > 0 AND Quantity = CAST(Quantity AS INTEGER)),
    AvailableBefore REAL NOT NULL,
    AvailableAfter REAL NOT NULL,
    FOREIGN KEY (StockAdjustmentId) REFERENCES StockAdjustments(Id),
    FOREIGN KEY (ProductId) REFERENCES Products(Id)
);

-- Damaged Stock Actions
CREATE TABLE IF NOT EXISTS DamagedStockActions (
    Id TEXT PRIMARY KEY,
    ProductId TEXT NOT NULL,
    ProductNameSnapshot TEXT NOT NULL,
    ActionType TEXT NOT NULL CHECK (ActionType IN ('MarkAsGood', 'RemoveFromDamaged')),
    Quantity REAL NOT NULL CHECK (Quantity > 0 AND Quantity = CAST(Quantity AS INTEGER)),
    Reason TEXT NOT NULL,
    ActionDate TEXT NOT NULL,
    DamagedBefore REAL NOT NULL,
    DamagedAfter REAL NOT NULL,
    AvailableBefore REAL NOT NULL,
    AvailableAfter REAL NOT NULL,
    Version INTEGER NOT NULL DEFAULT 1,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (ProductId) REFERENCES Products(Id)
);

-- Ledger: Stock Movements (Append-Only)
CREATE TABLE IF NOT EXISTS StockMovements (
    Id TEXT PRIMARY KEY,
    SequenceNo INTEGER UNIQUE,
    ProductId TEXT NOT NULL,
    MovementType TEXT NOT NULL,
    SourceEntityType TEXT NOT NULL CHECK (SourceEntityType IN ('Product', 'StockIn', 'StockOut', 'Return', 'Adjustment', 'DamagedAction')),
    SourceEntityId TEXT NOT NULL,
    SourceLineId TEXT NOT NULL,
    SourceVersion INTEGER NOT NULL,
    IsReversal INTEGER NOT NULL DEFAULT 0 CHECK (IsReversal IN (0, 1)),
    ReversesMovementId TEXT,
    QuantityDeltaAvailable REAL NOT NULL DEFAULT 0,
    QuantityDeltaDamaged REAL NOT NULL DEFAULT 0,
    AvailableBefore REAL NOT NULL,
    AvailableAfter REAL NOT NULL,
    DamagedBefore REAL NOT NULL,
    DamagedAfter REAL NOT NULL,
    BusinessDate TEXT NOT NULL,
    OccurredAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL,
    Reason TEXT,
    FOREIGN KEY (ProductId) REFERENCES Products(Id),
    UNIQUE(SourceEntityType, SourceEntityId, SourceLineId, SourceVersion, IsReversal)
);

-- Revisions for corrections (Append-Only)
CREATE TABLE IF NOT EXISTS TransactionRevisions (
    Id TEXT PRIMARY KEY,
    EntityType TEXT NOT NULL CHECK (EntityType IN ('StockIn', 'StockOut', 'Return', 'Adjustment', 'DamagedAction')),
    EntityId TEXT NOT NULL,
    Version INTEGER NOT NULL,
    Snapshot TEXT NOT NULL, -- JSON
    Reason TEXT NOT NULL,
    SupersededAtUtc TEXT NOT NULL,
    SupersededByAdminId TEXT NOT NULL,
    UNIQUE(EntityType, EntityId, Version)
);

-- Receipts
CREATE TABLE IF NOT EXISTS Receipts (
    Id TEXT PRIMARY KEY,
    ReceiptNumber TEXT NOT NULL UNIQUE,
    SourceType TEXT NOT NULL CHECK (SourceType IN ('StockIn', 'StockOut', 'Return', 'Adjustment', 'DamagedAction', 'Order')),
    SourceEntityId TEXT NOT NULL,
    SourceVersion INTEGER NOT NULL,
    Status TEXT NOT NULL DEFAULT 'Active' CHECK (Status IN ('Active', 'Superseded')),
    SupersedesReceiptId TEXT,
    IssuedAtUtc TEXT NOT NULL,
    CompanyNameSnapshot TEXT NOT NULL,
    CompanyPhoneSnapshot TEXT,
    CompanyEmailSnapshot TEXT,
    CompanyAddressSnapshot TEXT,
    CompanyLogoAssetId TEXT,
    CustomerNameSnapshot TEXT,
    ReceiptDataSnapshot TEXT NOT NULL, -- JSON
    CreatedByAdminId TEXT NOT NULL,
    UNIQUE(SourceType, SourceEntityId, SourceVersion)
);

-- Company Settings & Logo Assets
CREATE TABLE IF NOT EXISTS LogoAssets (
    Id TEXT PRIMARY KEY,
    ContentType TEXT NOT NULL,
    FileName TEXT NOT NULL,
    SizeBytes INTEGER NOT NULL,
    Sha256 TEXT NOT NULL,
    Content BLOB NOT NULL,
    CreatedAtUtc TEXT NOT NULL,
    CreatedByAdminId TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS CompanySettings (
    Singleton INTEGER PRIMARY KEY CHECK (Singleton = 1),
    CompanyName TEXT NOT NULL,
    Phone TEXT,
    Email TEXT,
    Address TEXT,
    LogoAssetId TEXT,
    UpdatedAtUtc TEXT NOT NULL,
    UpdatedByAdminId TEXT NOT NULL,
    RowVersion INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (LogoAssetId) REFERENCES LogoAssets(Id)
);

-- Edit History
CREATE TABLE IF NOT EXISTS EditHistory (
    Id TEXT PRIMARY KEY,
    EntityType TEXT NOT NULL,
    EntityId TEXT NOT NULL,
    ChangeGroupId TEXT NOT NULL,
    FieldName TEXT NOT NULL,
    OldValue TEXT,
    NewValue TEXT,
    Reason TEXT,
    ChangedAtUtc TEXT NOT NULL,
    ChangedByAdminId TEXT NOT NULL
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS AuditLogs (
    Id TEXT PRIMARY KEY,
    ActorType TEXT NOT NULL CHECK (ActorType IN ('Admin', 'System')),
    AdminId TEXT,
    Action TEXT NOT NULL,
    EntityType TEXT NOT NULL,
    EntityId TEXT,
    Description TEXT,
    OldData TEXT, -- JSON
    NewData TEXT, -- JSON
    RequestId TEXT,
    IpAddress TEXT,
    OccurredAtUtc TEXT NOT NULL,
    IsEdited INTEGER NOT NULL DEFAULT 0,
    IsDeleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS AuditLogCorrections (
    Id TEXT PRIMARY KEY,
    AuditLogId TEXT NOT NULL,
    CorrectionType TEXT NOT NULL CHECK (CorrectionType IN ('Edit', 'Delete')),
    OldData TEXT, -- JSON
    NewData TEXT, -- JSON
    Reason TEXT NOT NULL,
    CorrectedAtUtc TEXT NOT NULL,
    CorrectedByAdminId TEXT NOT NULL,
    FOREIGN KEY (AuditLogId) REFERENCES AuditLogs(Id)
);

-- Idempotency Records
CREATE TABLE IF NOT EXISTS IdempotencyRecords (
    Id TEXT PRIMARY KEY,
    AdminId TEXT NOT NULL,
    IdempotencyKey TEXT NOT NULL,
    Method TEXT NOT NULL,
    Path TEXT NOT NULL,
    RequestHash TEXT NOT NULL,
    State TEXT NOT NULL CHECK (State IN ('Processing', 'Completed')),
    ResponseStatus INTEGER,
    ResponseBody TEXT, -- JSON
    CreatedAtUtc TEXT NOT NULL,
    ExpiresAtUtc TEXT NOT NULL,
    UNIQUE(AdminId, IdempotencyKey)
);

-- Backup & Restore Logs
CREATE TABLE IF NOT EXISTS BackupLogs (
    Id TEXT PRIMARY KEY,
    BackupType TEXT NOT NULL CHECK (BackupType IN ('Manual', 'Automatic', 'PreRestore')),
    Status TEXT NOT NULL CHECK (Status IN ('Started', 'Succeeded', 'Failed')),
    StartedAtUtc TEXT NOT NULL,
    CompletedAtUtc TEXT,
    StorageReference TEXT,
    FileName TEXT,
    FileSizeBytes INTEGER,
    Sha256 TEXT,
    CreatedByAdminId TEXT,
    ErrorSummary TEXT
);

CREATE TABLE IF NOT EXISTS RestoreLogs (
    Id TEXT PRIMARY KEY,
    BackupLogId TEXT,
    PreRestoreBackupLogId TEXT,
    Status TEXT NOT NULL CHECK (Status IN ('Started', 'Succeeded', 'Failed')),
    StartedAtUtc TEXT NOT NULL,
    CompletedAtUtc TEXT,
    RestoredByAdminId TEXT,
    ErrorSummary TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON StockMovements(ProductId, SequenceNo);
CREATE INDEX IF NOT EXISTS idx_stockmovements_date ON StockMovements(ProductId, BusinessDate);
CREATE INDEX IF NOT EXISTS idx_stockmovements_source ON StockMovements(SourceEntityType, SourceEntityId);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON Orders(CustomerId, OrderDate, Status);
CREATE INDEX IF NOT EXISTS idx_returns_customer ON Returns(CustomerId, ReturnDate);
CREATE INDEX IF NOT EXISTS idx_auditlogs_date ON AuditLogs(OccurredAtUtc, EntityType);
CREATE INDEX IF NOT EXISTS idx_edithistory_entity ON EditHistory(EntityType, EntityId, ChangedAtUtc);
