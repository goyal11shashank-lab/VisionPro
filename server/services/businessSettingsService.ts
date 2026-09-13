import { pool, db } from '../db/index.js';
import { businessSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { recordAuditLog } from './auditService.js';

export interface AppSettings {
  general: {
    financialYearStart: string; // e.g. "04-01"
    dateFormat: 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
    currency: string;
    currencySymbol: string;
  };
  party: {
    defaultPaymentTerms: string; // e.g. "Immediate", "15 Days", "30 Days"
    defaultCreditLimit: number;
    creditLimitBehavior: 'OFF' | 'WARNING' | 'BLOCK';
    showCurrentBalance: boolean;
    partySearchDetails: 'MINIMAL' | 'DETAILED';
    enforceUniqueGstin?: boolean;
    enforceUniquePhone?: boolean;
    allowPartyCreationFromVoucher?: boolean;
  };
  stockItem: {
    defaultUnit: 'PRS' | 'PCS';
    defaultGstRate: number;
    maintainBatchesDefault: boolean;
    defaultCategory: 'SV' | 'KT' | 'PROG' | 'OTHER' | 'NONE';
    defaultStatus: 'ACTIVE' | 'INACTIVE';
    defaultPurchaseRate: number;
    defaultMrp: number;
    defaultBarcodePrefix?: string;
    barcodeSymbology?: string;
    defaultLensCoating?: string;
    defaultBaseMaterial?: string;
    autoGenerateItemBarcode?: boolean;
    opticalPrescriptionMandatory?: boolean;
    allowStockItemCreationFromVoucher?: boolean;
  };
  inventory: {
    allowNegativeStock: boolean;
    negativeStockWarning: boolean;
    showAvailableStockInSearch: boolean;
    showBatchAvailableQty: boolean;
    batchSearchResultLimit: number;
    showReservedStock: boolean;
    lowStockThreshold: number;
    reservationExpiryDays?: number;
    reserveStockOnSalesOrder?: boolean;
    allowOrderBeyondAvailable?: boolean;
    autoReleaseExpiredReservations?: boolean;
  };
  sales: {
    defaultPaymentMode: 'Credit' | 'Cash';
    usePartyLastSaleRate: boolean;
    defaultSalesRateSource: 'PARTY_LAST_RATE' | 'STOCK_ITEM_PRICE';
    enableRowDiscount: boolean;
    enableInvoiceDiscount: boolean;
    showMrpInSales: boolean;
    autoAddNextRow: boolean;
    autoOpenBatchAllocation: boolean;
    enableSalesOrders: boolean;
    allowNewBatchCreation?: boolean;
    defaultGstMode?: string;
    defaultDiscountType?: 'NONE' | 'PERCENTAGE' | 'FIXED';
    maxDiscountPercentage?: number;
    roundOffMode?: string;
    allowDiscount?: boolean;
    enableRoundOff?: boolean;
    requireSalesperson?: boolean;
    autoPrintOnSave?: boolean;
  };
  purchase: {
    defaultPaymentMode: 'Credit' | 'Cash';
    defaultPurchaseRateSource: 'LAST_PURCHASE_PRICE' | 'STOCK_ITEM_PURCHASE_RATE' | 'MANUAL';
    allowNewBatchCreation: boolean;
    autoAddNextRow: boolean;
    enablePurchaseOrders: boolean;
    defaultGstMode?: string;
    defaultCreditPeriodDays?: number;
    updateCostPriceFromPurchase?: boolean;
    warnOnHigherPurchaseRate?: boolean;
  };
  orders: {
    defaultOrderValidityDays: number;
    enableSalesOrders: boolean;
    enablePurchaseOrders: boolean;
    notifyCustomerOnStatusChange: boolean;
  };
  gst: {
    defaultGstRate: number;
    defaultOpticalHsn: string;
    isGstRegistered: boolean;
    compositionScheme: boolean;
    enableRcm: boolean;
    printHsnSummary: boolean;
  };
  voucher: {
    numbering: {
      salesInvoice: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' | 'AUTO_OVERRIDE' };
      salesOrder: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
      salesReturn: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
      purchaseInvoice: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
      purchaseOrder: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
      purchaseReturn: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
      customerReceipt: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
      supplierPayment: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
    };
    enableNarration: boolean;
    requireNarration: boolean;
  };
  print: {
    invoiceTitle?: string;
    signatoryLabel?: string;
    defaultInvoiceCopies?: number;
    termsAndConditionsText?: string;
    showBusinessLogo?: boolean;
    showTermsAndConditions?: boolean;
    showAuthorizedSignatory?: boolean;
    showBatchDetails?: boolean;
    showHsnSac?: boolean;
    showDiscountColumn?: boolean;
    previewBeforePrint?: boolean;
    defaultPaperSize?: 'A4' | 'LETTER';
    defaultOrientation?: 'PORTRAIT' | 'LANDSCAPE';
    showLogo?: boolean;
    showGstin?: boolean;
    showBusinessAddress?: boolean;
    showPartyAddress?: boolean;
    showBarcode?: boolean;
    showNarration?: boolean;
    showTerms?: boolean;
    termsAndConditions?: string;
    invoiceDeclaration?: string;
    showPreparedBy?: boolean;
    showCheckedBy?: boolean;
    numberOfCopies?: number;
    copyLabels?: string;
    defaultExportFormat?: 'PDF' | 'EXCEL' | 'CSV';
  };
  display: {
    dateFormat: string;
    density: 'COMPACT' | 'COMFORTABLE';
    showStockBadges: boolean;
    enableShortcuts: boolean;
    autoOpenBatchModal: boolean;
  };
  advanced: {
    showCancelledVouchers: boolean;
    allowInactiveStockItemsInSearch: boolean;
    allowInactiveBatchesInVouchers: boolean;
    auditLoggingEnabled: boolean;
    backdateLimitDays?: number;
    allowBackdatedVouchers?: boolean;
    requireCancellationReason?: boolean;
    enableAuditExport?: boolean;
    restrictNegativeCash?: boolean;
  };
  salesOrder?: {
    reserveStockOnSalesOrder: boolean;
    allowOrderBeyondAvailable: boolean;
    allowEditingOpenOrders: boolean;
    openInvoiceBeforeConversion: boolean;
  };
  purchaseOrder?: {
    autoFillFromReorderLevel: boolean;
    allowDirectConversion: boolean;
  };
  tax?: {
    gstEnabled: boolean;
    defaultGstRate: number;
    intraStateTaxSplit: boolean;
    showGstBreakdown: boolean;
    allowManualGstOverride: boolean;
  };
  voucherNumbering?: {
    salesInvoice: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' | 'AUTO_OVERRIDE' };
    purchaseInvoice: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
    salesOrder: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
    purchaseOrder: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
    customerReceipt: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
    supplierPayment: { prefix: string; startNumber: number; method: 'AUTOMATIC' | 'MANUAL' };
    resetNumbering: 'NEVER' | 'FINANCIAL_YEAR';
    preventDuplicates: boolean;
    allowZeroValuedTransactions: boolean;
    showNarration: boolean;
    narrationRequired: boolean;
    askBeforeSave: boolean;
    confirmVoucherCancellation: boolean;
    allowHardDeleteOrders: boolean;
  };
  entryDisplay?: {
    compactVoucherLayout: boolean;
    showAvailableStock: boolean;
    showInternalSku: boolean;
    showBarcodeInInventory: boolean;
    showCanonicalKey: boolean;
    searchResultLimit: number;
    enableKeyboardNavigation: boolean;
    autoFocusNextField: boolean;
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  general: {
    financialYearStart: '04-01',
    dateFormat: 'DD-MM-YYYY',
    currency: 'INR',
    currencySymbol: '₹',
  },
  party: {
    defaultPaymentTerms: '30 Days',
    defaultCreditLimit: 0,
    creditLimitBehavior: 'WARNING',
    showCurrentBalance: true,
    partySearchDetails: 'DETAILED',
    enforceUniqueGstin: false,
    enforceUniquePhone: false,
    allowPartyCreationFromVoucher: true,
  },
  stockItem: {
    defaultUnit: 'PRS',
    defaultGstRate: 5,
    maintainBatchesDefault: true,
    defaultCategory: 'NONE',
    defaultStatus: 'ACTIVE',
    defaultPurchaseRate: 0,
    defaultMrp: 0,
    defaultBarcodePrefix: 'OPT',
    barcodeSymbology: 'CODE128',
    defaultLensCoating: 'NONE',
    defaultBaseMaterial: 'CR39',
    autoGenerateItemBarcode: true,
    opticalPrescriptionMandatory: false,
    allowStockItemCreationFromVoucher: true,
  },
  inventory: {
    allowNegativeStock: true,
    negativeStockWarning: true,
    showAvailableStockInSearch: true,
    showBatchAvailableQty: true,
    batchSearchResultLimit: 25,
    showReservedStock: true,
    lowStockThreshold: 1.00,
    reservationExpiryDays: 7,
    reserveStockOnSalesOrder: true,
    allowOrderBeyondAvailable: true,
    autoReleaseExpiredReservations: false,
  },
  sales: {
    defaultPaymentMode: 'Credit',
    usePartyLastSaleRate: true,
    defaultSalesRateSource: 'PARTY_LAST_RATE',
    enableRowDiscount: true,
    enableInvoiceDiscount: true,
    showMrpInSales: false,
    autoAddNextRow: true,
    autoOpenBatchAllocation: true,
    enableSalesOrders: true,
    allowNewBatchCreation: false,
    defaultGstMode: 'INTRA_STATE',
    defaultDiscountType: 'PERCENTAGE',
    maxDiscountPercentage: 20,
    roundOffMode: 'NORMAL',
    allowDiscount: true,
    enableRoundOff: true,
    requireSalesperson: false,
    autoPrintOnSave: false,
  },
  purchase: {
    defaultPaymentMode: 'Credit',
    defaultPurchaseRateSource: 'LAST_PURCHASE_PRICE',
    allowNewBatchCreation: true,
    autoAddNextRow: true,
    enablePurchaseOrders: true,
    defaultGstMode: 'INTRA_STATE',
    defaultCreditPeriodDays: 30,
    updateCostPriceFromPurchase: true,
    warnOnHigherPurchaseRate: true,
  },
  orders: {
    defaultOrderValidityDays: 15,
    enableSalesOrders: true,
    enablePurchaseOrders: true,
    notifyCustomerOnStatusChange: true,
  },
  gst: {
    defaultGstRate: 5,
    defaultOpticalHsn: '9003',
    isGstRegistered: true,
    compositionScheme: false,
    enableRcm: false,
    printHsnSummary: true,
  },
  voucher: {
    numbering: {
      salesInvoice: { prefix: 'INV-', startNumber: 1, method: 'AUTOMATIC' },
      salesOrder: { prefix: 'SO-', startNumber: 1, method: 'AUTOMATIC' },
      salesReturn: { prefix: 'CN-', startNumber: 1, method: 'AUTOMATIC' },
      purchaseInvoice: { prefix: 'PUR-', startNumber: 1, method: 'AUTOMATIC' },
      purchaseOrder: { prefix: 'PO-', startNumber: 1, method: 'AUTOMATIC' },
      purchaseReturn: { prefix: 'DN-', startNumber: 1, method: 'AUTOMATIC' },
      customerReceipt: { prefix: 'REC-', startNumber: 1, method: 'AUTOMATIC' },
      supplierPayment: { prefix: 'PAY-', startNumber: 1, method: 'AUTOMATIC' },
    },
    enableNarration: true,
    requireNarration: false,
  },
  print: {
    invoiceTitle: 'TAX INVOICE',
    signatoryLabel: 'Authorized Signatory',
    defaultInvoiceCopies: 1,
    termsAndConditionsText: '1. Goods once sold will not be taken back or exchanged unless approved under warranty terms.\n2. Subject to local jurisdiction only. Interest @ 18% p.a. will be charged on overdue invoices.',
    showBusinessLogo: true,
    showTermsAndConditions: true,
    showAuthorizedSignatory: true,
    showBatchDetails: true,
    showHsnSac: true,
    showDiscountColumn: true,
    previewBeforePrint: true,
    defaultPaperSize: 'A4',
    defaultOrientation: 'PORTRAIT',
    showLogo: true,
    showGstin: true,
    showBusinessAddress: true,
    showPartyAddress: true,
    showBarcode: false,
    showNarration: true,
    showTerms: true,
    termsAndConditions: '1. Goods once sold will not be taken back or exchanged unless approved under warranty terms.\n2. Subject to local jurisdiction only. Interest @ 18% p.a. will be charged on overdue invoices.',
    invoiceDeclaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    showPreparedBy: true,
    showCheckedBy: true,
    numberOfCopies: 1,
    copyLabels: 'Original for Recipient, Duplicate for Transporter, Office Copy',
    defaultExportFormat: 'PDF',
  },
  display: {
    dateFormat: 'DD/MM/YYYY',
    density: 'COMPACT',
    showStockBadges: true,
    enableShortcuts: true,
    autoOpenBatchModal: true,
  },
  advanced: {
    showCancelledVouchers: true,
    allowInactiveStockItemsInSearch: false,
    allowInactiveBatchesInVouchers: false,
    auditLoggingEnabled: true,
    backdateLimitDays: 0,
    allowBackdatedVouchers: true,
    requireCancellationReason: true,
    enableAuditExport: true,
    restrictNegativeCash: false,
  },
  salesOrder: {
    reserveStockOnSalesOrder: true,
    allowOrderBeyondAvailable: true,
    allowEditingOpenOrders: true,
    openInvoiceBeforeConversion: true,
  },
  purchaseOrder: {
    autoFillFromReorderLevel: false,
    allowDirectConversion: true,
  },
  tax: {
    gstEnabled: true,
    defaultGstRate: 5,
    intraStateTaxSplit: true,
    showGstBreakdown: true,
    allowManualGstOverride: false,
  },
  voucherNumbering: {
    salesInvoice: { prefix: 'INV-', startNumber: 1, method: 'AUTOMATIC' },
    purchaseInvoice: { prefix: 'PUR-', startNumber: 1, method: 'AUTOMATIC' },
    salesOrder: { prefix: 'SO-', startNumber: 1, method: 'AUTOMATIC' },
    purchaseOrder: { prefix: 'PO-', startNumber: 1, method: 'AUTOMATIC' },
    customerReceipt: { prefix: 'REC-', startNumber: 1, method: 'AUTOMATIC' },
    supplierPayment: { prefix: 'PAY-', startNumber: 1, method: 'AUTOMATIC' },
    resetNumbering: 'FINANCIAL_YEAR',
    preventDuplicates: true,
    allowZeroValuedTransactions: false,
    showNarration: true,
    narrationRequired: false,
    askBeforeSave: false,
    confirmVoucherCancellation: true,
    allowHardDeleteOrders: false,
  },
  entryDisplay: {
    compactVoucherLayout: true,
    showAvailableStock: true,
    showInternalSku: true,
    showBarcodeInInventory: true,
    showCanonicalKey: false,
    searchResultLimit: 25,
    enableKeyboardNavigation: true,
    autoFocusNextField: true,
  },
};

/**
 * Deeply merge source object into target object without mutating defaults
 */
function deepMerge<T extends Record<string, any>>(target: T, source?: any): T {
  if (!source || typeof source !== 'object') {
    return JSON.parse(JSON.stringify(target));
  }
  const result: any = Array.isArray(target) ? [...target] : { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (srcVal !== undefined && srcVal !== null) {
      if (
        typeof srcVal === 'object' &&
        !Array.isArray(srcVal) &&
        typeof tgtVal === 'object' &&
        !Array.isArray(tgtVal)
      ) {
        result[key] = deepMerge(tgtVal, srcVal);
      } else {
        result[key] = srcVal;
      }
    }
  }
  return result;
}

export interface BusinessSettingsResponse {
  lowStockThreshold: number;
  config: Record<string, any>;
  settings: AppSettings;
}

export class BusinessSettingsService {
  /**
   * Fetch settings for a business, guaranteed merged with DEFAULT_APP_SETTINGS
   */
  static async getSettings(businessId: string): Promise<BusinessSettingsResponse> {
    try {
      const [existing] = await db
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, businessId))
        .limit(1);

      if (existing) {
        const rawConfig = (existing.config as Record<string, any>) || {};
        const mergedSettings = deepMerge(DEFAULT_APP_SETTINGS, rawConfig.settings || rawConfig);
        const threshold = parseFloat(existing.lowStockThreshold || '1.00');
        mergedSettings.inventory.lowStockThreshold = threshold;

        return {
          lowStockThreshold: threshold,
          config: rawConfig,
          settings: mergedSettings,
        };
      }

      return {
        lowStockThreshold: 1.00,
        config: { settings: DEFAULT_APP_SETTINGS },
        settings: JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)),
      };
    } catch {
      return {
        lowStockThreshold: 1.00,
        config: { settings: DEFAULT_APP_SETTINGS },
        settings: JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)),
      };
    }
  }

  /**
   * Update settings with deep merge, audit trail and validation
   */
  static async updateSettings(
    businessId: string,
    data: {
      lowStockThreshold?: number;
      config?: Record<string, any>;
      settings?: Partial<AppSettings>;
    },
    userId: string = 'system',
    req?: any
  ): Promise<BusinessSettingsResponse> {
    const previous = await this.getSettings(businessId);
    const newThreshold =
      data.lowStockThreshold !== undefined
        ? Math.max(0, data.lowStockThreshold)
        : data.settings?.inventory?.lowStockThreshold !== undefined
        ? Math.max(0, data.settings.inventory.lowStockThreshold)
        : previous.lowStockThreshold;

    const mergedSettings = deepMerge(
      previous.settings,
      data.settings || (data.config?.settings ? data.config.settings : data.config)
    );
    mergedSettings.inventory.lowStockThreshold = newThreshold;

    const storedConfig = {
      ...(previous.config || {}),
      ...(data.config || {}),
      settings: mergedSettings,
    };

    await pool.query(
      `INSERT INTO business_settings (business_id, low_stock_threshold, config, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (business_id)
       DO UPDATE SET 
         low_stock_threshold = EXCLUDED.low_stock_threshold,
         config = EXCLUDED.config,
         updated_at = NOW()`,
      [businessId, newThreshold.toFixed(2), JSON.stringify(storedConfig)]
    );

    // Record audit log for settings change
    await recordAuditLog({
      businessId,
      userId,
      action: 'UPDATE_SETTINGS',
      module: 'SETTINGS',
      entityType: 'BusinessSettings',
      entityId: businessId,
      previousValue: previous.settings,
      newValue: mergedSettings,
      req,
    }).catch(err => {
      console.warn('Failed to record settings audit log:', err);
    });

    return {
      lowStockThreshold: newThreshold,
      config: storedConfig,
      settings: mergedSettings,
    };
  }

  /**
   * Restore recommended defaults
   */
  static async restoreDefaults(
    businessId: string,
    userId: string = 'system',
    req?: any
  ): Promise<BusinessSettingsResponse> {
    const previous = await this.getSettings(businessId);
    const defaultSettingsCopy = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));

    const storedConfig = {
      ...(previous.config || {}),
      settings: defaultSettingsCopy,
    };

    await pool.query(
      `INSERT INTO business_settings (business_id, low_stock_threshold, config, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (business_id)
       DO UPDATE SET 
         low_stock_threshold = EXCLUDED.low_stock_threshold,
         config = EXCLUDED.config,
         updated_at = NOW()`,
      [businessId, '1.00', JSON.stringify(storedConfig)]
    );

    await recordAuditLog({
      businessId,
      userId,
      action: 'RESTORE_DEFAULT_SETTINGS',
      module: 'SETTINGS',
      entityType: 'BusinessSettings',
      entityId: businessId,
      previousValue: previous.settings,
      newValue: defaultSettingsCopy,
      req,
    }).catch(err => {
      console.warn('Failed to record settings restore audit log:', err);
    });

    return {
      lowStockThreshold: 1.00,
      config: storedConfig,
      settings: defaultSettingsCopy,
    };
  }

  /**
   * Check if negative stock is allowed for the business
   */
  static async isNegativeStockAllowed(businessId: string): Promise<boolean> {
    const res = await this.getSettings(businessId);
    return res.settings.inventory.allowNegativeStock;
  }

  /**
   * Check if order reservation is enabled
   */
  static async isOrderReservationEnabled(businessId: string): Promise<boolean> {
    const res = await this.getSettings(businessId);
    return res.settings.orders?.enableSalesOrders ?? res.settings.salesOrder?.reserveStockOnSalesOrder ?? true;
  }

  /**
   * Check if sales order can reserve beyond available stock
   */
  static async isAllowOrderBeyondAvailable(businessId: string): Promise<boolean> {
    const res = await this.getSettings(businessId);
    return res.settings.salesOrder?.allowOrderBeyondAvailable ?? true;
  }

  /**
   * Get credit limit behavior ('OFF' | 'WARNING' | 'BLOCK')
   */
  static async getCreditLimitBehavior(businessId: string): Promise<'OFF' | 'WARNING' | 'BLOCK'> {
    const res = await this.getSettings(businessId);
    return res.settings.party.creditLimitBehavior || 'WARNING';
  }

  /**
   * Get prefix and start number for a voucher type
   */
  static async getVoucherPrefix(
    businessId: string,
    voucherType: 'salesInvoice' | 'purchaseInvoice' | 'salesOrder' | 'purchaseOrder' | 'customerReceipt' | 'supplierPayment'
  ): Promise<{ prefix: string; startNumber: number; method: string }> {
    const res = await this.getSettings(businessId);
    const vConfig =
      res.settings.voucher?.numbering?.[voucherType] ||
      res.settings.voucherNumbering?.[voucherType];
    if (vConfig) {
      return vConfig;
    }
    const fallbacks: Record<string, { prefix: string; startNumber: number; method: string }> = {
      salesInvoice: { prefix: 'INV-', startNumber: 1, method: 'AUTOMATIC' },
      purchaseInvoice: { prefix: 'PUR-', startNumber: 1, method: 'AUTOMATIC' },
      salesOrder: { prefix: 'SO-', startNumber: 1, method: 'AUTOMATIC' },
      purchaseOrder: { prefix: 'PO-', startNumber: 1, method: 'AUTOMATIC' },
      customerReceipt: { prefix: 'REC-', startNumber: 1, method: 'AUTOMATIC' },
      supplierPayment: { prefix: 'PAY-', startNumber: 1, method: 'AUTOMATIC' },
    };
    return fallbacks[voucherType] || { prefix: 'VCH-', startNumber: 1, method: 'AUTOMATIC' };
  }
}
