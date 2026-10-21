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
  invoiceDiscount?: number;
  invoiceGstRate?: number;
  courierCharges?: number;
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
  courierCharges: number;
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
  const gstRate = round2(input.gstRate ?? 0.00);

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
 * Supports invoice-level discount, invoice-level GST rate, and invoice-level courier charges.
 */
export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotalsResult {
  const { lines, gstMode } = input;

  let subtotal = 0;
  let lineDiscountSum = 0;
  let lineTaxableSum = 0;
  let lineTaxSum = 0;

  for (const line of lines) {
    subtotal = round2(subtotal + line.gross);
    lineDiscountSum = round2(lineDiscountSum + line.discountAmount);
    lineTaxableSum = round2(lineTaxableSum + line.taxableAmount);
    lineTaxSum = round2(lineTaxSum + line.taxAmount);
  }

  // 1. Invoice-level discount (₹)
  let discountTotal = 0;
  if (input.invoiceDiscount !== undefined && input.invoiceDiscount !== null) {
    discountTotal = round2(Math.min(subtotal, Math.max(0, input.invoiceDiscount)));
  } else {
    discountTotal = lineDiscountSum;
  }

  // 2. Taxable amount = max(0, subtotal - discount)
  let taxableAmount = 0;
  if (input.invoiceDiscount !== undefined && input.invoiceDiscount !== null) {
    taxableAmount = round2(Math.max(0, subtotal - discountTotal));
  } else {
    taxableAmount = lineTaxableSum;
  }

  // 3. GST Tax Calculation
  let totalTax = 0;
  let effectiveGstRate = 0;

  if (input.invoiceGstRate !== undefined && input.invoiceGstRate !== null) {
    effectiveGstRate = round2(Math.max(0, input.invoiceGstRate));
    totalTax = round2((taxableAmount * effectiveGstRate) / 100);
  } else {
    totalTax = lineTaxSum;
    if (taxableAmount > 0) {
      effectiveGstRate = round2((totalTax / taxableAmount) * 100);
    } else {
      effectiveGstRate = lines[0]?.gstRate ?? 0.00;
    }
  }

  let igstRate = 0;
  let igstAmount = 0;
  let cgstRate = 0;
  let cgstAmount = 0;
  let sgstRate = 0;
  let sgstAmount = 0;

  if (effectiveGstRate === 0 || totalTax === 0) {
    igstRate = 0;
    igstAmount = 0;
    cgstRate = 0;
    cgstAmount = 0;
    sgstRate = 0;
    sgstAmount = 0;
  } else if (gstMode === 'INTER_STATE') {
    // IGST applies across states
    igstAmount = totalTax;
    igstRate = effectiveGstRate;
    cgstRate = 0;
    cgstAmount = 0;
    sgstRate = 0;
    sgstAmount = 0;
  } else {
    // INTRA_STATE: Split evenly into CGST and SGST
    cgstRate = round2(effectiveGstRate / 2);
    sgstRate = round2(effectiveGstRate / 2);
    cgstAmount = round2(totalTax / 2);
    sgstAmount = round2(totalTax - cgstAmount); // Remainder prevents 1-paisa rounding divergence
    igstRate = 0;
    igstAmount = 0;
  }

  // 4. Courier Charges (₹)
  const courierCharges = round2(Math.max(0, input.courierCharges || 0));

  // 5. Exact total before whole-rupee rounding
  const rawTotal = round2(taxableAmount + igstAmount + cgstAmount + sgstAmount + courierCharges);

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
    courierCharges,
    roundOff,
    grandTotal,
  };
}

export const calculateDocumentTotals = calculateInvoiceTotals;

