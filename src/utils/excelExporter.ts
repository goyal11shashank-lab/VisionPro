/**
 * Real Excel (.xlsx) Exporter using SheetJS (xlsx)
 * Formats report header, applied filters, numeric types, distinct unit columns, and column widths.
 */
import * as XLSX from 'xlsx';

export interface ExcelColumn {
  header: string;
  key: string;
  type?: 'text' | 'number' | 'currency' | 'date';
  width?: number;
}

export interface ExportExcelOptions {
  filename: string;
  sheetName?: string;
  businessName?: string;
  reportTitle: string;
  dateRange?: string;
  filtersSummary?: string;
  columns: ExcelColumn[];
  data: Record<string, any>[];
}

export function exportToExcel(options: ExportExcelOptions): void {
  const {
    filename,
    sheetName = 'Report Data',
    businessName,
    reportTitle,
    dateRange,
    filtersSummary,
    columns,
    data,
  } = options;

  // Build rows array of arrays (AOA) for the worksheet
  const rows: any[][] = [];

  // 1. Title and Metadata Header
  if (businessName) {
    rows.push([businessName]);
  }
  rows.push([reportTitle]);
  if (dateRange) {
    rows.push([`Period: ${dateRange}`]);
  }
  if (filtersSummary) {
    rows.push([`Filters: ${filtersSummary}`]);
  }
  rows.push([`Generated On: ${new Date().toLocaleString('en-IN')}`]);
  rows.push([]); // blank separator row

  // 2. Column Header Row
  const headerRow = columns.map(c => c.header);
  rows.push(headerRow);

  // 3. Data Rows with typed numeric values
  for (const item of data) {
    const rowValues = columns.map(col => {
      const val = item[col.key];
      if (val === null || val === undefined || val === '') {
        return '';
      }

      if (col.type === 'number' || col.type === 'currency') {
        const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? '' : num;
      }

      return String(val);
    });
    rows.push(rowValues);
  }

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Compute column widths based on headers and sample contents
  const colWidths = columns.map((col, idx) => {
    let maxLen = col.header.length;
    for (const item of data.slice(0, 100)) {
      const val = item[col.key];
      if (val !== null && val !== undefined) {
        maxLen = Math.max(maxLen, String(val).length);
      }
    }
    return { wch: Math.min(Math.max(maxLen + 4, col.width || 12), 40) };
  });
  ws['!cols'] = colWidths;

  // Create workbook and append sheet
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));

  // Sanitize filename
  const cleanFilename = (filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`).replace(/[^a-zA-Z0-9_.-]/g, '_');

  // Trigger browser download
  XLSX.writeFile(wb, cleanFilename);
}
