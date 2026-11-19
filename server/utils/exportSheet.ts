import * as XLSX from 'xlsx';

// Explicit headers only: invoice IDs, barcodes, phone numbers and postal codes stay text.
const numericHeaders = new Set([
  'SPH', 'CYL', 'AXIS', 'ADD', 'Quantity', 'Physical Stock', 'Reserved Stock', 'Available Stock',
  'MRP', 'Qty In', 'Qty Out', 'Balance After', 'Gross (Subtotal)', 'Discount Total',
  'Taxable Amount', 'IGST', 'CGST', 'SGST', 'Total GST', 'Grand Total', 'Paid Amount',
  'Outstanding Balance', 'Unit Cost', 'Discount %', 'Tax Rate %', 'Tax Amount', 'Line Total',
  'Subtotal', 'Unit Price', 'Credit Limit', 'Credit Days', 'Overdue Balance', 'Debit', 'Credit',
  'Running Balance', 'Amount', 'Allocated Amount', 'Unallocated Amount', 'Total Invoices',
  'Total Qty Sold', 'Total Sales Amount',
]);
export function createExportSheet(rows: Record<string, any>[]): XLSX.WorkSheet {
  const typedRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (numericHeaders.has(key) && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
      const number = Number(value);
      if (Number.isFinite(number)) return [key, number];
    }
    return [key, value];
  })));
  const sheet = XLSX.utils.json_to_sheet(typedRows.length ? typedRows : [{ Status: 'No records found matching criteria' }]);
  if (typedRows.length) {
    const headers = Object.keys(typedRows[0]);
    sheet['!cols'] = headers.map(key => ({ wch: Math.min(48, typedRows.reduce((width, row) => Math.max(width, Math.min(48, String(row[key] ?? '').length + 2)), Math.max(14, key.length + 2))) }));
    sheet['!autofilter'] = { ref: sheet['!ref']! };
    for (let r = 1; r <= typedRows.length; r++) {
      headers.forEach((key, c) => {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.t === 'n' && numericHeaders.has(key)) {
          cell.z = ['Credit Days', 'Total Invoices'].includes(key) ? '#,##0' : '#,##0.00';
        }
      });
    }
  }
  return sheet;
}
