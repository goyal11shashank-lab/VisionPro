// Payment endpoints preserve database names for compatibility. Normalize at the UI boundary.
export function normalizePaymentVoucher(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizePaymentVoucher);
  const result: any = { ...value };
  for (const [key, field] of Object.entries(value)) {
    const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (result[camel] === undefined) result[camel] = field;
  }
  for (const key of ['amount', 'unallocatedAmount', 'allocatedAmount', 'documentGrandTotal', 'grandTotal', 'paidAmount', 'outstandingAmount']) {
    if (result[key] !== undefined && result[key] !== null) result[key] = Number(result[key]);
  }
  if (result.documentNumber !== undefined && result.invoiceNumber === undefined) result.invoiceNumber = result.documentNumber;
  if (result.documentDate !== undefined && result.invoiceDate === undefined) result.invoiceDate = result.documentDate;
  if (result.documentGrandTotal !== undefined && result.grandTotal === undefined) result.grandTotal = result.documentGrandTotal;
  if (Array.isArray(result.allocations)) result.allocations = result.allocations.map(normalizePaymentVoucher);
  return result;
}

export function normalizeUnpaidInvoices(value: any): any[] {
  const rows = Array.isArray(value) ? value : value?.unpaidInvoices;
  if (!Array.isArray(rows)) throw new Error('Invalid unpaid invoice response. Reload before allocating a payment.');
  return rows.map(normalizePaymentVoucher);
}
