/**
 * CSV Exporter with UTF-8 BOM encoding for seamless compatibility with Excel & Apple Numbers on macOS.
 */
import { ExcelColumn } from './excelExporter.js';

export interface ExportCsvOptions {
  filename: string;
  businessName?: string;
  reportTitle: string;
  dateRange?: string;
  filtersSummary?: string;
  columns: ExcelColumn[];
  data: Record<string, any>[];
}

function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function exportToCsv(options: ExportCsvOptions): void {
  const {
    filename,
    businessName,
    reportTitle,
    dateRange,
    filtersSummary,
    columns,
    data,
  } = options;

  const lines: string[] = [];

  // Metadata rows
  if (businessName) lines.push(escapeCsvCell(businessName));
  lines.push(escapeCsvCell(reportTitle));
  if (dateRange) lines.push(escapeCsvCell(`Period: ${dateRange}`));
  if (filtersSummary) lines.push(escapeCsvCell(`Filters: ${filtersSummary}`));
  lines.push(escapeCsvCell(`Generated On: ${new Date().toLocaleString('en-IN')}`));
  lines.push(''); // blank row

  // Header row
  lines.push(columns.map(c => escapeCsvCell(c.header)).join(','));

  // Data rows
  for (const item of data) {
    const row = columns.map(col => {
      const val = item[col.key];
      if (val === null || val === undefined) return '""';
      if (col.type === 'number' || col.type === 'currency') {
        const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
        return isNaN(num) ? '""' : String(num);
      }
      return escapeCsvCell(val);
    });
    lines.push(row.join(','));
  }

  // Prepend UTF-8 BOM (\uFEFF)
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const cleanFilename = (filename.endsWith('.csv') ? filename : `${filename}.csv`).replace(/[^a-zA-Z0-9_.-]/g, '_');

  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', cleanFilename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
