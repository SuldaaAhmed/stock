/**
 * DTO types mirroring the Backend API contract (backend/src/services/*, /api/openapi.json).
 * Field names are exactly what the Backend returns/accepts.
 */

export type UUID = string;
/** Business date on the Africa/Nairobi calendar: YYYY-MM-DD */
export type BusinessDate = string;
/** UTC ISO-8601 timestamp */
export type Timestamp = string;

// ---------- Envelopes ----------
export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
export interface ApiEnvelope<T, M = undefined> {
  data: T;
  meta?: M;
  requestId?: string;
}
export interface Paged<T, M extends PageMeta = PageMeta> {
  data: T[];
  meta: M;
}
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  requestId?: string;
  errors?: { field: string; message: string }[];
}

export type Period = 'day' | 'week' | 'month' | 'custom';
export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  period?: Period;
  date?: string;
  from?: string;
  to?: string;
  productId?: string;
  customerId?: string;
  type?: string;
  status?: string;
  search?: string;
  [key: string]: string | number | boolean | undefined;
}

export type DocumentStatus = 'Posted' | 'Superseded';
export interface VersionRef {
  id: UUID;
  version: number;
  status: DocumentStatus;
  createdAt: Timestamp;
}

// ---------- Auth ----------
export type Theme = 'Light' | 'Dark' | 'System';
export interface Session {
  admin: { id: UUID; username: string };
  theme: Theme;
  expiresAt: Timestamp;
  absoluteExpiresAt: Timestamp;
}

// ---------- Products ----------
export type ProductStatus = 'Active' | 'Inactive';
export interface Product {
  id: UUID;
  name: string;
  minimumStock: number;
  sellingPrice: number | null;
  status: ProductStatus;
  openingStock: number;
  effectiveOpeningStock: number;
  currentStock: number;
  availableStock: number;
  damagedStock: number;
  isLowStock: boolean;
  unit: 'BOX';
  rowVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface ProductSummary {
  effectiveOpeningStock: number;
  stockIn: number;
  stockInNew: number;
  stockInTransfer: number;
  stockOut: number;
  stockOutDelivery: number;
  stockOutSample: number;
  stockOutGift: number;
  stockOutTransfer: number;
  goodReturns: number;
  damagedReturns: number;
  adjustmentIn: number;
  adjustmentOut: number;
  markedAsGood: number;
  removedFromDamaged: number;
  currentStock: number;
  damagedStock: number;
  totalPhysicalStock: number;
}
export interface DamagedHistoryItem {
  eventType: 'DamagedReturn' | DamagedActionType;
  sourceId: UUID;
  referenceNumber: string | null;
  businessDate: BusinessDate;
  quantity: number;
  reason: string | null;
  receiptId: UUID | null;
  createdAt: Timestamp;
}
export interface ProductDetail extends Product {
  summary: ProductSummary;
  damagedHistory: DamagedHistoryItem[];
}
export interface ProductCreate {
  name: string;
  minimumStock: number;
  sellingPrice?: number;
  status?: ProductStatus;
  openingStock?: number;
}
export interface ProductUpdate {
  name?: string;
  minimumStock?: number;
  sellingPrice?: number | null;
  status?: ProductStatus;
  reason: string;
}
export interface StockMovement {
  id: number;
  movementType: string;
  availableDelta: number;
  damagedDelta: number;
  availableAfter: number;
  damagedAfter: number;
  isReversal: boolean;
  sourceType: string;
  sourceId: UUID;
  sourceNumber: string;
  sourceVersion: number;
  businessDate: BusinessDate;
  createdAt: Timestamp;
  admin: string | null;
}
export interface EditHistoryItem {
  id: UUID;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  admin: string | null;
  createdAt: Timestamp;
}
export interface PriceHistoryItem {
  id: UUID;
  oldPrice: number | null;
  newPrice: number | null;
  reason: string | null;
  admin: string | null;
  createdAt: Timestamp;
}
export interface OpeningStockCorrection {
  id: UUID;
  previousEffectiveOpeningStock: number;
  newEffectiveOpeningStock: number;
  delta: number;
  reason: string;
  admin: string | null;
  createdAt: Timestamp;
}

// ---------- Lines ----------
export interface LineInput {
  productId: UUID;
  quantity: number;
}
export interface DocumentLine {
  id: UUID;
  productId: UUID;
  productName: string;
  quantity: number;
}

// ---------- Stock In ----------
export type StockInType = 'NewStock' | 'WarehouseTransferIn';
export interface StockIn {
  id: UUID;
  number: string;
  version: number;
  status: DocumentStatus;
  stockInType: StockInType;
  sourceWarehouse: string | null;
  businessDate: BusinessDate;
  correctionReason: string | null;
  supersedesId: UUID | null;
  supersededById: UUID | null;
  receiptId: UUID | null;
  receiptNumber: string | null;
  totalQuantity: number;
  lineCount?: number;
  createdAt: Timestamp;
  createdBy?: string;
  lines?: DocumentLine[];
  versions?: VersionRef[];
}
export interface StockInCreate {
  stockInType: StockInType;
  sourceWarehouse?: string;
  businessDate?: BusinessDate;
  lines: LineInput[];
}
export interface StockInCorrection extends Partial<StockInCreate> {
  lines: LineInput[];
  reason: string;
}

// ---------- Stock Out ----------
export type StockOutType = 'CustomerDelivery' | 'Sample' | 'Gift' | 'WarehouseTransfer';
export type DirectStockOutType = Exclude<StockOutType, 'CustomerDelivery'>;
export interface StockOut {
  id: UUID;
  number: string;
  version: number;
  status: DocumentStatus;
  outType: StockOutType;
  recipientName: string | null;
  destinationWarehouse: string | null;
  transferNumber: string | null;
  orderId: UUID | null;
  orderNumber: string | null;
  customerName: string | null;
  deliveryId: UUID | null;
  businessDate: BusinessDate;
  correctionReason: string | null;
  supersedesId: UUID | null;
  supersededById: UUID | null;
  receiptId: UUID | null;
  receiptNumber: string | null;
  totalQuantity: number;
  lineCount?: number;
  createdAt: Timestamp;
  createdBy?: string;
  lines?: DocumentLine[];
  versions?: VersionRef[];
}
export interface StockOutCreate {
  outType: DirectStockOutType;
  recipientName?: string;
  destinationWarehouse?: string;
  businessDate?: BusinessDate;
  lines: LineInput[];
}
export interface StockOutCorrection extends Partial<StockOutCreate> {
  lines: LineInput[];
  reason: string;
}

// ---------- Customers ----------
export interface Customer {
  id: UUID;
  fullName: string;
  phone: string | null;
  email: string | null;
  location: string | null;
  notes: string | null;
  orderCount?: number;
  rowVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface CustomerInput {
  fullName: string;
  phone?: string;
  email?: string | null;
  location?: string;
  notes?: string;
  reason?: string;
}

// ---------- Orders ----------
export type OrderStatus = 'Pending' | 'PartiallyCompleted' | 'Completed';
export interface OrderLine {
  id: UUID;
  productId: UUID;
  productName: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
  returnedQuantity: number;
  returnableQuantity: number;
}
export interface Delivery {
  id: UUID;
  orderId: UUID;
  deliveryDate: BusinessDate;
  stockOutId: UUID;
  stockOutNumber: string;
  lines: { orderLineId: UUID; productId: UUID; productName: string; quantity: number }[];
  totalQuantity: number;
  createdAt: Timestamp;
  createdBy: string;
}
export interface Order {
  id: UUID;
  number: string;
  customerId: UUID;
  customerName: string;
  orderDate: BusinessDate;
  status: OrderStatus;
  completedAt: Timestamp | null;
  receiptId: UUID | null;
  receiptNumber: string | null;
  totalOrdered: number;
  totalDelivered: number;
  totalRemaining: number;
  totalReturned?: number;
  rowVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export type OrderEditHistoryItem = EditHistoryItem;
export interface OrderDetail extends Order {
  lines: OrderLine[];
  deliveries: Delivery[];
  editHistory?: OrderEditHistoryItem[];
}
export interface OrderCreate {
  customerId: UUID;
  orderDate?: BusinessDate;
  lines: { productId: UUID; orderedQuantity: number }[];
}
export interface OrderUpdate {
  customerId?: UUID;
  orderDate?: BusinessDate;
  lines?: { id?: UUID; productId: UUID; orderedQuantity: number }[];
  reason?: string;
}
export interface DeliveryCreate {
  deliveryDate?: BusinessDate;
  lines: { orderLineId: UUID; quantity: number }[];
}
export interface DeliveryResult {
  delivery: Delivery;
  order: OrderDetail;
}

// ---------- Returns ----------
export type ReturnMode = 'AgainstOrder' | 'Direct';
export type Condition = 'Good' | 'Damaged';
export interface ReturnLineInput {
  productId: UUID;
  quantity: number;
  condition: Condition;
}
export interface CustomerReturn {
  id: UUID;
  number: string;
  version: number;
  status: DocumentStatus;
  returnMode: ReturnMode;
  customerId: UUID;
  customerName: string;
  orderId: UUID | null;
  orderNumber: string | null;
  reason: string;
  businessDate: BusinessDate;
  correctionReason: string | null;
  supersedesId: UUID | null;
  supersededById: UUID | null;
  receiptId: UUID | null;
  receiptNumber: string | null;
  goodQuantity: number;
  damagedQuantity: number;
  totalQuantity: number;
  createdAt: Timestamp;
  lines?: (DocumentLine & { condition: Condition })[];
  versions?: VersionRef[];
}
export interface ReturnCreate {
  returnMode: ReturnMode;
  orderId?: UUID;
  customerId?: UUID;
  reason: string;
  businessDate?: BusinessDate;
  lines: ReturnLineInput[];
}
export interface ReturnCorrection {
  customerId?: UUID;
  returnReason?: string;
  businessDate?: BusinessDate;
  lines: ReturnLineInput[];
  reason: string;
}

// ---------- Adjustments ----------
export type AdjustmentDirection = 'Increase' | 'Decrease';
export interface Adjustment {
  id: UUID;
  number: string;
  version: number;
  status: DocumentStatus;
  direction: AdjustmentDirection;
  productId: UUID;
  productName: string;
  quantity: number;
  reason: string;
  availableBefore: number;
  availableAfter: number;
  businessDate: BusinessDate;
  correctionReason: string | null;
  supersedesId: UUID | null;
  supersededById: UUID | null;
  receiptId: UUID | null;
  receiptNumber: string | null;
  createdAt: Timestamp;
  createdBy?: string;
  versions?: VersionRef[];
}
export interface AdjustmentCreate {
  direction: AdjustmentDirection;
  productId: UUID;
  quantity: number;
  reason: string;
  businessDate?: BusinessDate;
}
export interface AdjustmentCorrection {
  direction?: AdjustmentDirection;
  productId?: UUID;
  quantity: number;
  adjustmentReason?: string;
  businessDate?: BusinessDate;
  reason: string;
}

// ---------- Damaged stock ----------
export type DamagedActionType = 'MarkAsGood' | 'RemoveFromDamaged';
export interface DamagedAction {
  id: UUID;
  actionType: DamagedActionType;
  productId: UUID;
  productName: string;
  quantity: number;
  reason: string;
  damagedBefore: number;
  damagedAfter: number;
  availableBefore: number;
  availableAfter: number;
  businessDate: BusinessDate;
  receiptId: UUID | null;
  receiptNumber: string | null;
  createdAt: Timestamp;
  createdBy?: string;
}
export interface DamagedBalance {
  productId: UUID;
  productName: string;
  status: ProductStatus;
  damagedStock: number;
  availableStock: number;
}
export interface DamagedActionCreate {
  actionType: DamagedActionType;
  productId: UUID;
  quantity: number;
  reason: string;
  businessDate?: BusinessDate;
}

// ---------- Receipts ----------
export interface Receipt {
  id: UUID;
  receiptNumber: string;
  receiptType: string;
  sourceType: string;
  sourceId: UUID;
  sourceNumber: string;
  sourceVersion: number;
  status: 'Active' | 'Superseded';
  supersededById: UUID | null;
  businessDate: BusinessDate;
  company: { companyName: string; phone: string | null; email: string | null; address: string | null };
  hasLogo: boolean;
  content: {
    title: string;
    fields: { label: string; value: string }[];
    columns: { key: string; label: string }[];
    lines: Record<string, unknown>[];
    totals: { label: string; value: string }[];
    notes: string | null;
  };
  createdAt: Timestamp;
  pdfUrl: string;
}

// ---------- Dashboard ----------
export interface DashboardSummary {
  date: BusinessDate;
  totalProducts: number;
  activeProducts: number;
  lowStockProducts: number;
  totalAvailableStock: number;
  totalDamagedStock: number;
  unit: 'BOX';
  today: {
    stockInQuantity: number;
    stockInTransactions: number;
    stockOutQuantity: number;
    stockOutTransactions: number;
    returnsQuantity: number;
    returnsTransactions: number;
    returnsGoodQuantity: number;
    returnsDamagedQuantity: number;
  };
  lowStockItems: { productId: UUID; productName: string; currentStock: number; minimumStock: number }[];
  orders: { pending: number; partiallyCompleted: number };
  recentTransactions: {
    type: 'StockIn' | 'StockOut' | 'Return' | 'Adjustment' | 'Order';
    id: UUID;
    number: string;
    subtype: string;
    businessDate: BusinessDate;
    createdAt: Timestamp;
  }[];
  recentActivity: {
    id: number;
    occurredAt: Timestamp;
    actor: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    description: string | null;
  }[];
}

// ---------- Search ----------
export type SearchResourceType =
  | 'Product'
  | 'Customer'
  | 'Order'
  | 'Receipt'
  | 'StockIn'
  | 'StockOut'
  | 'Return'
  | 'Adjustment'
  | 'Transfer';
export interface SearchResult {
  resourceType: SearchResourceType;
  id: UUID;
  display: string;
  subtitle: string | null;
  date: BusinessDate | null;
  detailPath: string;
}

// ---------- Reports ----------
export type ReportType =
  | 'current-stock'
  | 'stock-in'
  | 'stock-out'
  | 'customer-orders'
  | 'returns'
  | 'adjustments'
  | 'sample-gift'
  | 'warehouse-transfer'
  | 'low-stock'
  | 'damaged-stock';
export interface ReportColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right';
  format?: 'money' | 'int';
}
export interface ReportMeta extends PageMeta {
  reportType: ReportType;
  title: string;
  snapshot: boolean;
  period: { from: string; to: string } | null;
  summary: Record<string, number>;
  columns: ReportColumn[];
  balances?: DamagedBalance[];
}

// ---------- Settings ----------
export interface CompanySettings {
  companyName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  hasLogo: boolean;
  logoFileId: UUID | null;
  logoUrl: string | null;
  rowVersion: number;
  updatedAt: Timestamp;
}
export interface CompanyUpdate {
  companyName?: string;
  phone?: string;
  email?: string | null;
  address?: string;
}
export interface Preferences {
  theme: Theme;
  rowVersion: number;
  updatedAt: Timestamp;
}

// ---------- Audit ----------
export interface AuditLog {
  id: number;
  occurredAt: Timestamp;
  adminId: UUID | null;
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  description: string | null;
  note: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  isDeleted: boolean;
  deletedAt: Timestamp | null;
  editedAt: Timestamp | null;
  corrections?: AuditLogCorrection[];
}
export interface AuditLogCorrection {
  id: number;
  auditLogId: number;
  operation: 'Edit' | 'Delete';
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string;
  adminId: UUID | null;
  admin: string | null;
  createdAt: Timestamp;
}

// ---------- Backups ----------
export interface BackupLog {
  id: UUID;
  operation: 'Backup' | 'Restore';
  trigger: 'Manual' | 'Automatic' | 'PreRestore' | string;
  status: 'Running' | 'Succeeded' | 'Failed' | string;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  error: string | null;
  actor: string | null;
  storageProvider: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  schemaVersion: string | null;
  sourceBackupId: UUID | null;
  details: Record<string, unknown> | null;
  downloadUrl: string | null;
}
