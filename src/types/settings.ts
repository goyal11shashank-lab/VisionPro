export interface AppSettings {
  general: {
    financialYearStart: string; // e.g. "04-01"
    dateFormat: 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
    currency: string;
    currencySymbol: string;
    decimalPlaces?: number;
    financialYearBeginning?: string;
  };
  party: {
    defaultPaymentTerms: string; // e.g. "Immediate", "15 Days", "30 Days"
    defaultCreditLimit: number;
    creditLimitBehavior: 'OFF' | 'WARNING' | 'BLOCK';
    showCurrentBalance: boolean;
    partySearchDetails: 'MINIMAL' | 'DETAILED';
    enforceUniqueGstin?: boolean;
    enforceUniquePhone?: boolean;
    creditLimitAction?: 'OFF' | 'WARNING' | 'BLOCK' | string;
    defaultCustomerCreditLimit?: number;
    defaultState?: string;
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
