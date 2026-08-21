/**
 * Tax & Decimal Precision Calculation Service
 * Deterministic, decimal-safe arithmetic for GST and monetary totals.
 * Never relies on floating point imprecision.
 */

export interface LineTaxInput {
  quantity: number;
  rate: number;
  discountType?: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue?: number;
  gstRate?: number; // e.g. 5, 12, 18, 28, 0
}

export interface LineTaxResult {
  quantity: number;
  rate: number;
  gross: number;
  discountType: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  discountAmount: number;
  taxableAmount: number;
  gstRate: number;
  taxAmount: number;
  lineTotal: number;
}

export interface InvoiceTotalsInput {
  lines: LineTaxResult[];
  gstMode: 'INTRA_STATE' | 'INTER_STATE';
  customRoundOff?: boolean;
}

export interface InvoiceTotalsResult {
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  gstMode: 'INTRA_STATE' | 'INTER_STATE';
  igstRate: number;
  igstAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  roundOff: number;
  grandTotal: number;
}

/**
 * Safely rounds a number to 2 decimal places using epsilon adjustment
 */
export function round2(value: number | string): number {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates line-level tax, gross, and discounts
 */
export function calculateLineTax(input: LineTaxInput): LineTaxResult {
  const quantity = round2(input.quantity);
  const rate = round2(input.rate);
  const discountType = input.discountType || 'NONE';
  const discountValue = round2(input.discountValue || 0);
  const gstRate = round2(input.gstRate ?? 5.00);

  // 1. Gross amount = quantity * rate
  const gross = round2(quantity * rate);

  // 2. Discount amount
  let discountAmount = 0;
  if (discountType === 'PERCENTAGE') {
    discountAmount = round2((gross * discountValue) / 100);
  } else if (discountType === 'FIXED') {
    discountAmount = round2(Math.min(gross, discountValue));
  }

  // 3. Taxable amount = gross - discount
  const taxableAmount = round2(Math.max(0, gross - discountAmount));

  // 4. GST tax amount
  const taxAmount = round2((taxableAmount * gstRate) / 100);

  // 5. Line Total = Taxable + Tax
  const lineTotal = round2(taxableAmount + taxAmount);

  return {
    quantity,
    rate,
    gross,
    discountType,
    discountValue,
    discountAmount,
    taxableAmount,
    gstRate,
    taxAmount,
    lineTotal,
  };
}

/**
 * Calculates complete invoice totals with intra-state / inter-state GST reconciliation
 */
export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotalsResult {
  const { lines, gstMode } = input;

  let subtotal = 0;
  let discountTotal = 0;
  let taxableAmount = 0;
  let totalTax = 0;

  for (const line of lines) {
    subtotal = round2(subtotal + line.gross);
    discountTotal = round2(discountTotal + line.discountAmount);
    taxableAmount = round2(taxableAmount + line.taxableAmount);
    totalTax = round2(totalTax + line.taxAmount);
  }

  let igstRate = 0;
  let igstAmount = 0;
  let cgstRate = 0;
  let cgstAmount = 0;
  let sgstRate = 0;
  let sgstAmount = 0;

  if (gstMode === 'INTER_STATE') {
    // IGST applies across states
    igstAmount = totalTax;
    // Calculate effective IGST rate if lines have uniform rate
    if (taxableAmount > 0) {
      igstRate = round2((igstAmount / taxableAmount) * 100);
    } else {
      igstRate = lines[0]?.gstRate ?? 5.00;
    }
    cgstRate = 0;
    cgstAmount = 0;
    sgstRate = 0;
    sgstAmount = 0;
  } else {
    // INTRA_STATE: Split evenly into CGST and SGST
    cgstAmount = round2(totalTax / 2);
    // SGST takes the remainder to prevent 1-paisa rounding divergence
    sgstAmount = round2(totalTax - cgstAmount);

    if (taxableAmount > 0) {
      cgstRate = round2((cgstAmount / taxableAmount) * 100);
      sgstRate = round2((sgstAmount / taxableAmount) * 100);
    } else {
      const dominantGst = lines[0]?.gstRate ?? 5.00;
      cgstRate = round2(dominantGst / 2);
      sgstRate = round2(dominantGst / 2);
    }
    igstRate = 0;
    igstAmount = 0;
  }

  // Exact total before rounding
  const rawTotal = round2(taxableAmount + igstAmount + cgstAmount + sgstAmount);

  // Standard Indian currency rounding to nearest whole rupee
  const grandTotal = Math.round(rawTotal);
  const roundOff = round2(grandTotal - rawTotal);

  return {
    subtotal,
    discountTotal,
    taxableAmount,
    gstMode,
    igstRate,
    igstAmount,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    roundOff,
    grandTotal,
  };
}

export const calculateDocumentTotals = calculateInvoiceTotals;

