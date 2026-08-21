export interface User {
  id: string;
  username: string;
  email?: string | null;
  mobile?: string | null;
  fullName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  isSuperAdmin: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  roles?: Array<{ id: string; name: string; code: string }>;
}

export interface Business {
  id: string;
  name: string;
  tradeName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  currency: string;
  financialYearStart: string;
  status: string;
  isDefault?: boolean;
}

export interface Role {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  isSystem: boolean;
  businessId?: string | null;
  permissions?: Permission[];
  permissionsCount?: number;
}

export interface Permission {
  id: string;
  module: string;
  action: string;
  code: string;
  description?: string | null;
}

export interface AuditLogItem {
  id: string;
  businessId?: string | null;
  userId?: string | null;
  userName?: string | null;
  username?: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: any;
  newValue?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface DashboardMetrics {
  todaysSales: {
    amount: number;
    count: number;
    currency: string;
  };
  todaysPurchases: {
    amount: number;
    count: number;
    currency: string;
  };
  receivables: {
    amount: number;
    partyCount: number;
    currency: string;
  };
  payables: {
    amount: number;
    partyCount: number;
    currency: string;
  };
  totalStock: {
    quantity: number;
    unit: string;
    skuCount: number;
    valuation: number;
  };
  reservedStock: {
    quantity: number;
    unit: string;
    orderCount: number;
  };
  lowStock: {
    itemsCount: number;
  };
  negativeStock: {
    itemsCount: number;
  };
}

export interface DatabaseHealth {
  status: 'healthy' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  database: {
    provider: string;
    connected: boolean;
    version?: string;
    error?: string;
    tablesCount: number;
    tables: string[];
  };
  deployment: {
    platform: string;
    nodeEnv: string;
  };
}

// Optical Master Hierarchy Types
export interface Category {
  id: string;
  businessId?: string | null;
  name: string;
  code: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export interface Coating {
  id: string;
  businessId?: string | null;
  name: string;
  code: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export interface Base {
  id: string;
  businessId?: string | null;
  name: string;
  code: string;
  family?: string | null;
  coatingId?: string | null;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
  compatibleCategories?: Array<{ id: string; code: string; name: string }>;
}

export interface PrimaryItem {
  id: string;
  businessId: string;
  categoryId: string;
  categoryName?: string;
  categoryCode?: string;
  baseId: string;
  baseName?: string;
  baseCode?: string;
  baseFamily?: string;
  coatingId?: string | null;
  coatingName?: string | null;
  coatingCode?: string | null;
  name: string;
  code: string;
  description?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export interface UniqueItem {
  id: string;
  businessId: string;
  primaryItemId: string;
  primaryItemName?: string;
  primaryItemCode?: string;
  categoryId?: string;
  categoryName?: string;
  categoryCode?: string;
  baseName?: string;
  baseCode?: string;
  name: string;
  code: string;
  description?: string | null;
  purchaseRate: string | number;
  lastPurchasePrice: string | number;
  mrp: string | number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export interface OpticalBatch {
  id: string;
  businessId: string;
  uniqueItemId: string;
  uniqueItemName?: string;
  uniqueItemCode?: string;
  primaryItemName?: string;
  categoryId: string;
  categoryName?: string;
  categoryCode?: string;
  barcode: string;
  sph: string | number;
  cyl: string | number;
  axis: string | number;
  add: string | number;
  side: 'NONE' | 'R' | 'L' | 'BE';
  identityKey: string;
  status: 'ACTIVE' | 'INACTIVE';
  physicalStock?: string | number;
  reservedStock?: string | number;
  availableStock?: string | number;
  createdAt?: string;
  updatedAt?: string;
}

// Phase 2: Party & Procurement Types
export interface Party {
  id: string;
  businessId: string;
  partyCode: string;
  name: string;
  displayName?: string | null;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  mobile?: string | null;
  alternateMobile?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  gstin?: string | null;
  pan?: string | null;
  creditLimit: string | number;
  creditDays: string | number;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string | null;
  currentBalance?: string | number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseInvoiceLineBatch {
  id?: string;
  purchaseInvoiceLineId?: string;
  batchId?: string;
  batch?: OpticalBatch;
  sph?: number | string;
  cyl?: number | string;
  axis?: number | string;
  add?: number | string;
  side?: 'NONE' | 'R' | 'L' | 'BE';
  quantity: number | string;
  rate: number | string;
  totalCost?: number | string;
}

export interface PurchaseInvoiceLine {
  id?: string;
  purchaseInvoiceId?: string;
  uniqueItemId: string;
  uniqueItem?: UniqueItem;
  quantity: number;
  rate: number;
  discountType?: 'PERCENTAGE' | 'FIXED' | 'NONE';
  discountValue?: number;
  discountAmount?: number | string;
  taxableAmount?: number | string;
  gstRate?: number;
  cgstRate?: number | string;
  cgstAmount?: number | string;
  sgstRate?: number | string;
  sgstAmount?: number | string;
  igstRate?: number | string;
  igstAmount?: number | string;
  lineTotal?: number | string;
  batches?: PurchaseInvoiceLineBatch[];
}

export interface PurchaseInvoice {
  id: string;
  businessId: string;
  invoiceNumber: string;
  supplierPartyId: string;
  supplier?: Party;
  invoiceDate: string;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  subtotal: string | number;
  discountTotal: string | number;
  taxableAmount: string | number;
  gstMode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT';
  cgstRate: string | number;
  cgstAmount: string | number;
  sgstRate: string | number;
  sgstAmount: string | number;
  igstRate: string | number;
  igstAmount: string | number;
  roundOff: string | number;
  grandTotal: string | number;
  notes?: string | null;
  lines?: PurchaseInvoiceLine[];
  createdAt: string;
  updatedAt?: string;
  postedAt?: string | null;
  cancelledAt?: string | null;
}

export interface PurchaseLot {
  id: string;
  businessId: string;
  purchaseInvoiceId: string;
  purchaseInvoiceLineId: string;
  batchId: string;
  uniqueItemId: string;
  quantityReceived: string | number;
  rate: string | number;
  taxRate: string | number;
  receivedAt: string;
  remainingQuantity: string | number;
  uniqueItem?: UniqueItem;
  batch?: OpticalBatch;
  invoice?: {
    id: string;
    invoiceNumber: string;
    supplierInvoiceNumber?: string;
    invoiceDate: string;
    supplier?: {
      id: string;
      name: string;
      partyCode: string;
    };
  };
  createdAt: string;
}

export interface SupplierLedgerEntry {
  id: string;
  businessId: string;
  partyId: string;
  partyName?: string;
  partyCode?: string;
  transactionType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  debit: string | number;
  credit: string | number;
  balance: string | number;
  transactionDate: string;
  notes?: string | null;
  createdAt: string;
}

