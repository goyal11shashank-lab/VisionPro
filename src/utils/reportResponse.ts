// Keep original report fields and add display aliases without changing stored amounts.
function rowAliases(row: any, tab: string): any {
  if (!row || typeof row !== 'object') return row;
  const result: any = { ...row };
  for (const [key, value] of Object.entries(row)) {
    const snake = key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
    if (result[snake] === undefined) result[snake] = value;
  }
  if (tab === 'sales' && result.customer_name === undefined) result.customer_name = result.party_name;
  if (tab === 'purchases' && result.supplier_name === undefined) result.supplier_name = result.party_name;
  for (const tax of ['igst', 'cgst', 'sgst']) {
    if (result[tax + '_amount'] === undefined && result[tax] !== undefined) result[tax + '_amount'] = result[tax];
  }
  if (tab === 'analytics') {
    if (result.total_quantity === undefined) result.total_quantity = result.total_quantity_sold;
    if (result.total_amount === undefined) result.total_amount = result.total_sales_amount;
  }
  return result;
}
export function normalizeReportResponse(value: any, tab: string): any {
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  for (const key of ['data', 'rows', 'entries', 'parties']) {
    if (Array.isArray(value[key])) result[key] = value[key].map((row: any) => rowAliases(row, tab));
  }
  if (value.party) result.party = rowAliases(value.party, tab);
  if (value.pagination) result.pagination = { ...value.pagination, total: value.pagination.total ?? value.pagination.totalItems };
  return result;
}
export function isCurrencySummaryKey(key: string): boolean {
  if (['totalInvoices', 'totalPayments', 'totalParties', 'totalItems', 'totalBatches', 'totalRows', 'totalLines', 'totalRecords', 'totalReturns', 'totalPhysical', 'totalReserved', 'totalAvailable'].includes(key) || /^count|count$|quantity|qty/i.test(key)) return false;
  if (/stock/i.test(key) && !/value|cost|price|amount/i.test(key)) return false;
  return /amount|balance|total|subtotal|igst|cgst|sgst|value|cost|price|discount/i.test(key);
}
