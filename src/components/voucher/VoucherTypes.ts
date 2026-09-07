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

/**
 * Creates a new blank voucher line item with pristine empty values
 */
export function createEmptyVoucherLine(idPrefix: string = 'row'): VoucherLineItem {
  return {
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    uniqueItemId: '',
    uniqueItemName: '',
    uniqueItemCode: '',
    categoryCode: 'SV',
    maintainBatches: true,
    quantity: 0,
    rate: 0,
    discountType: 'NONE',
    discountValue: 0,
    gstRate: 5,
    batches: [],
    availableBatches: [],
  };
}

/**
 * Returns true if a voucher line is completely empty (no stock item selected)
 */
export function isVoucherLineEmpty(line?: VoucherLineItem | null): boolean {
  if (!line) return true;
  return !line.uniqueItemId || line.uniqueItemId.trim() === '';
}

/**
 * Returns true if a voucher line has an item and satisfies minimum line requirements
 */
export function isVoucherLineComplete(line?: VoucherLineItem | null): boolean {
  if (!line || isVoucherLineEmpty(line)) return false;
  const hasQty = Number(line.quantity) > 0;
  const hasRate = Number(line.rate) >= 0;
  if (line.maintainBatches !== false) {
    const hasBatches = Array.isArray(line.batches) && line.batches.length > 0;
    return hasBatches && hasQty && hasRate;
  }
  return hasQty && hasRate;
}

/**
 * Guarantees that lines ends with exactly one blank row if the last row is non-empty.
 * If the last row is already blank, does nothing (prevents infinite empty rows).
 */
export function ensureTrailingBlankRow(
  lines: VoucherLineItem[],
  idPrefix: string = 'row'
): VoucherLineItem[] {
  if (lines.length === 0) {
    return [createEmptyVoucherLine(idPrefix)];
  }
  const lastLine = lines[lines.length - 1];
  if (!isVoucherLineEmpty(lastLine)) {
    return [...lines, createEmptyVoucherLine(idPrefix)];
  }
  return lines;
}
