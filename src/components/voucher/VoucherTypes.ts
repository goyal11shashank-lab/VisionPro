import { SearchCandidate } from '../../utils/searchNormalization';

export type OpticalCategoryCode = 'SV' | 'KT' | 'PROG' | 'OTHER';

export interface BatchAllocation {
  batchId?: string;
  sph?: number | string;
  cyl?: number | string;
  axis?: number | string;
  add?: number | string;
  side?: string;
  quantity: number;
  rate?: number;
  barcode?: string;
  availableStock?: number;
}

export interface VoucherLineItem {
  id: string; // internal unique client key for React row
  uniqueItemId: string;
  uniqueItemName: string;
  uniqueItemCode: string;
  categoryCode?: OpticalCategoryCode | string;
  maintainBatches: boolean;
  quantity: number;
  rate: number;
  discountType: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  gstRate: number;
  batches: BatchAllocation[];
  availableBatches?: any[];
}

export interface ComputedVoucherLine extends VoucherLineItem {
  gross: number;
  disc: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface VoucherTotals {
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
  totalQuantity: number;
  totalItems: number;
}
