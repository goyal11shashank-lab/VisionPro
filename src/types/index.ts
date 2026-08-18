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
