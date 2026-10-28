/**
 * Utility to export optical batches current stock with complete batchwise details
 * in the format:
 * item name, batch name, sph, cyl, axis, addition, side, current stock
 */

export interface OpticalBatchExportItem {
  itemName?: string;
  uniqueItemName?: string;
  stockItemName?: string;
  formattedName?: string;
  name?: string;
  sph?: number | string | null;
  cyl?: number | string | null;
  axis?: number | string | null;
  add?: number | string | null;
  side?: string | null;
  physicalStock?: number | string | null;
  stock?: number | string | null;
  barcode?: string;
}

export function formatPowerVal(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || isNaN(Number(val))) return '0.00';
  const num = Number(val);
  return num > 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
}

export function generateBatchwiseStockCSV(batches: OpticalBatchExportItem[]): string {
  const headers = ['item name', 'batch name', 'sph', 'cyl', 'axis', 'addition', 'side', 'current stock'];

  const rows = batches.map(b => {
    const itemName = b.uniqueItemName || b.stockItemName || b.itemName || '';
    const batchName = b.formattedName || b.name || '';
    const sphStr = formatPowerVal(b.sph);
    const cylStr = formatPowerVal(b.cyl);
    const axisNum = b.axis !== null && b.axis !== undefined && Number(b.axis) !== 0 ? Math.round(Number(b.axis)) : 0;
    const addNum = b.add !== null && b.add !== undefined && Number(b.add) > 0 ? Number(b.add) : null;
    const additionStr = addNum !== null ? (addNum > 0 ? `+${addNum.toFixed(2)}` : addNum.toFixed(2)) : '';
    const sideStr = b.side && b.side !== 'NONE' ? String(b.side).trim().toUpperCase() : '';
    
    // Live physical stock preserving half-pairs (e.g. 13.5, 0.5) and negative values (-2.5)
    let currentStock = 0;
    if (b.physicalStock !== null && b.physicalStock !== undefined && b.physicalStock !== '') {
      currentStock = Number(b.physicalStock);
    } else if (b.stock !== null && b.stock !== undefined && b.stock !== '') {
      currentStock = Number(b.stock);
    }

    return [
      `"${String(itemName).replace(/"/g, '""')}"`,
      `"${String(batchName).replace(/"/g, '""')}"`,
      `"${sphStr}"`,
      `"${cylStr}"`,
      axisNum,
      `"${additionStr}"`,
      `"${sideStr}"`,
      currentStock,
    ];
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

export function downloadBatchwiseStockCSV(batches: OpticalBatchExportItem[], filenamePrefix = 'Optical_Batches_Current_Stock'): void {
  const csvContent = '\uFEFF' + generateBatchwiseStockCSV(batches);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
