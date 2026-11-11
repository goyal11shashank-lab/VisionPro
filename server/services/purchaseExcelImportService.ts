import { pool } from '../db/index.js';

export interface ExcelImportRowInput {
  rowNumber: number;
  stockItem: string;
  sph: number | string;
  cyl: number | string;
  axis?: number | string | null;
  addition?: number | string | null;
  side?: string | null;
  quantity: number | string;
}

export interface ExcelImportRowError {
  rowNumber: number;
  stockItem: string;
  sph?: number;
  cyl?: number;
  axis?: number;
  addition?: number;
  side?: string;
  quantity?: number;
  reason: string;
  isMissingBatch?: boolean;
}

export interface GroupedImportBatchAllocation {
  batchId: string;
  sph: number;
  cyl: number;
  axis: number;
  add: number;
  side: string;
  quantity: number;
  rate: number;
  barcode: string;
  availableStock?: number;
}

export interface GroupedImportLine {
  id: string;
  uniqueItemId: string;
  uniqueItemName: string;
  uniqueItemCode: string;
  categoryCode: string;
  unit: string;
  maintainBatches: boolean;
  quantity: number;
  rate: number;
  discountType: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  gstRate: number;
  batches: GroupedImportBatchAllocation[];
}

export interface ExcelImportValidationResult {
  success: boolean;
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    stockItemsCount: number;
    batchesCount: number;
  };
  errors: ExcelImportRowError[];
  groupedLines: GroupedImportLine[];
}

/**
 * Normalizes any optical number (supports plano, pl, strings, negative numbers).
 */
export function parseOpticalNumber(val: number | string | null | undefined, defaultValue: number = 0): number {
  if (val === null || val === undefined) return defaultValue;
  const str = String(val).trim().toUpperCase();
  if (str === '' || str === 'PL' || str === 'PLANO' || str === '0.0' || str === '0.00' || str === '0') {
    return 0;
  }
  const clean = str.replace(/[^\d.-]/g, '');
  const parsed = parseFloat(clean);
  if (isNaN(parsed)) return defaultValue;
  return Math.round(parsed * 100) / 100;
}

/**
 * Normalizes side into standard lens sides (NONE, R, L, BE)
 */
export function normalizeLensSide(sideRaw?: string | null): 'NONE' | 'R' | 'L' | 'BE' {
  if (!sideRaw) return 'NONE';
  const clean = String(sideRaw).trim().toUpperCase();
  if (clean === 'R' || clean === 'RIGHT' || clean === 'OD' || clean === 'RIGHT EYE') return 'R';
  if (clean === 'L' || clean === 'LEFT' || clean === 'OS' || clean === 'LEFT EYE') return 'L';
  if (clean === 'BE' || clean === 'BOTH' || clean === 'OU' || clean === 'BOTH EYES') return 'BE';
  return 'NONE';
}

function formatPower(val: number): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}`;
}

export class PurchaseExcelImportService {
  /**
   * Validates Excel import rows against existing catalog items and optical batches.
   * STRICT GUARANTEE: Never inserts or creates new optical batches or stock items.
   * If a batch is missing from master, an error/warning is returned.
   * Rows are grouped by stock item even if scattered across the spreadsheet.
   */
  static async validateAndGroupImportRows(
    businessId: string,
    rows: ExcelImportRowInput[]
  ): Promise<ExcelImportValidationResult> {
    if (!businessId) {
      throw new Error('Business ID is required for import validation.');
    }

    const errors: ExcelImportRowError[] = [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        success: false,
        summary: {
          totalRows: 0,
          validRows: 0,
          errorRows: 0,
          stockItemsCount: 0,
          batchesCount: 0,
        },
        errors: [{ rowNumber: 1, stockItem: '', reason: 'Excel file contains no data rows.' }],
        groupedLines: [],
      };
    }

    // Step 1: Pre-parse and sanitize rows
    interface ParsedRow {
      rowNumber: number;
      stockItemRaw: string;
      stockItemKey: string;
      sph: number;
      cyl: number;
      axis: number;
      addition: number;
      side: 'NONE' | 'R' | 'L' | 'BE';
      quantity: number;
    }

    const parsedRows: ParsedRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = r.rowNumber || i + 2; // Default 1-based data row (row 1 is header)
      const stockItemStr = String(r.stockItem || '').trim();

      if (!stockItemStr) {
        errors.push({
          rowNumber: rowNum,
          stockItem: '',
          reason: 'Stock Item column is blank or missing.',
        });
        continue;
      }

      const qtyNum = typeof r.quantity === 'number' ? r.quantity : parseFloat(String(r.quantity || '0').trim());
      if (isNaN(qtyNum) || qtyNum <= 0) {
        errors.push({
          rowNumber: rowNum,
          stockItem: stockItemStr,
          quantity: qtyNum,
          reason: `Invalid quantity "${r.quantity}". Quantity must be a positive number greater than 0.`,
        });
        continue;
      }

      const sph = parseOpticalNumber(r.sph, 0);
      const cyl = parseOpticalNumber(r.cyl, 0);
      const axis = Math.round(parseOpticalNumber(r.axis, 0));
      const addition = parseOpticalNumber(r.addition, 0);
      const side = normalizeLensSide(r.side);

      // Validate axis range if cyl is non-zero
      if (cyl !== 0 && (axis < 0 || axis > 180)) {
        errors.push({
          rowNumber: rowNum,
          stockItem: stockItemStr,
          sph,
          cyl,
          axis,
          addition,
          side,
          quantity: qtyNum,
          reason: `Invalid AXIS value "${r.axis}". AXIS must be between 0° and 180°.`,
        });
        continue;
      }

      parsedRows.push({
        rowNumber: rowNum,
        stockItemRaw: stockItemStr,
        stockItemKey: stockItemStr.toLowerCase(),
        sph,
        cyl,
        axis: cyl === 0 ? 0 : axis,
        addition,
        side,
        quantity: qtyNum,
      });
    }

    if (parsedRows.length === 0) {
      return {
        success: false,
        summary: {
          totalRows: rows.length,
          validRows: 0,
          errorRows: errors.length,
          stockItemsCount: 0,
          batchesCount: 0,
        },
        errors,
        groupedLines: [],
      };
    }

    // Step 2: Fetch active stock items in this business
    const itemsRes = await pool.query(
      `SELECT id, name, code, maintain_batches, optical_category, unit,
              purchase_rate, last_purchase_price, gst_rate
       FROM unique_items
       WHERE business_id = $1 AND status = 'ACTIVE'`,
      [businessId]
    );

    const items = itemsRes.rows;
    const itemByNameOrCode = new Map<string, any>();

    for (const it of items) {
      if (it.name) {
        itemByNameOrCode.set(it.name.trim().toLowerCase(), it);
      }
      if (it.code) {
        itemByNameOrCode.set(it.code.trim().toLowerCase(), it);
      }
    }

    // Step 3: Match rows with stock items
    const rowsWithItems: { row: ParsedRow; item: any }[] = [];
    const matchedItemIds = new Set<string>();

    for (const prow of parsedRows) {
      const matched = itemByNameOrCode.get(prow.stockItemKey);
      if (!matched) {
        errors.push({
          rowNumber: prow.rowNumber,
          stockItem: prow.stockItemRaw,
          sph: prow.sph,
          cyl: prow.cyl,
          axis: prow.axis,
          addition: prow.addition,
          side: prow.side,
          quantity: prow.quantity,
          reason: `Stock Item "${prow.stockItemRaw}" does not exist in master catalog for this business.`,
        });
      } else {
        rowsWithItems.push({ row: prow, item: matched });
        matchedItemIds.add(matched.id);
      }
    }

    errors.sort((a, b) => a.rowNumber - b.rowNumber);

    if (matchedItemIds.size === 0) {
      return {
        success: false,
        summary: {
          totalRows: rows.length,
          validRows: 0,
          errorRows: errors.length,
          stockItemsCount: 0,
          batchesCount: 0,
        },
        errors,
        groupedLines: [],
      };
    }

    // Step 4: Fetch existing batches for the matched items
    // (READ ONLY - NO BATCHES ARE CREATED)
    const itemIdsArray = Array.from(matchedItemIds);
    const batchesRes = await pool.query(
      `SELECT ob.id, ob.unique_item_id, ob.barcode, ob.sph, ob.cyl, ob.axis, ob.add, ob.side,
              COALESCE(os.available_stock, 0)::numeric as available_stock
       FROM optical_batches ob
       LEFT JOIN optical_stocks os ON ob.id = os.batch_id
       WHERE ob.business_id = $1
         AND ob.unique_item_id = ANY($2::uuid[])
         AND ob.status = 'ACTIVE'`,
      [businessId, itemIdsArray]
    );

    // Group batches by unique_item_id
    const batchesByItemId = new Map<string, any[]>();
    for (const b of batchesRes.rows) {
      const list = batchesByItemId.get(b.unique_item_id) || [];
      list.push(b);
      batchesByItemId.set(b.unique_item_id, list);
    }

    // Step 5: Verify Batch existence for each row
    interface ValidatedAllocatedRow {
      rowNumber: number;
      item: any;
      batch: any;
      sph: number;
      cyl: number;
      axis: number;
      addition: number;
      side: string;
      quantity: number;
    }

    const validatedAllocations: ValidatedAllocatedRow[] = [];

    for (const { row: prow, item } of rowsWithItems) {
      const itemBatches = batchesByItemId.get(item.id) || [];
      const itemCategory = (item.optical_category || 'SV').toUpperCase();

      // Find matching batch
      const foundBatch = itemBatches.find(b => {
        const bSph = Math.round(parseFloat(b.sph) * 100) / 100;
        const bCyl = Math.round(parseFloat(b.cyl) * 100) / 100;
        const bAxis = Math.round(parseFloat(b.axis || 0));
        const bAdd = Math.round(parseFloat(b.add || 0) * 100) / 100;
        const bSide = normalizeLensSide(b.side);

        if (Math.abs(bSph - prow.sph) > 0.001) return false;
        if (Math.abs(bCyl - prow.cyl) > 0.001) return false;

        // Axis check: if cyl is not 0, axis must match
        if (prow.cyl !== 0 && Math.abs(bAxis - prow.axis) > 0.001) return false;

        // Addition check: for KT / PROG
        if (itemCategory === 'KT' || itemCategory === 'PROG') {
          if (Math.abs(bAdd - prow.addition) > 0.001) return false;
        }

        // Side check: for PROG
        if (itemCategory === 'PROG') {
          if (bSide !== prow.side && prow.side !== 'NONE') return false;
        }

        return true;
      });

      if (!foundBatch) {
        const catSuffix =
          itemCategory === 'PROG'
            ? `, ADD +${prow.addition.toFixed(2)}, SIDE ${prow.side}`
            : itemCategory === 'KT'
            ? `, ADD +${prow.addition.toFixed(2)}`
            : prow.cyl !== 0 && prow.axis > 0
            ? `, AXIS ${prow.axis}°`
            : '';

        errors.push({
          rowNumber: prow.rowNumber,
          stockItem: prow.stockItemRaw,
          sph: prow.sph,
          cyl: prow.cyl,
          axis: prow.axis,
          addition: prow.addition,
          side: prow.side,
          quantity: prow.quantity,
          isMissingBatch: true,
          reason: `Batch [SPH ${formatPower(prow.sph)}, CYL ${formatPower(prow.cyl)}${catSuffix}] is NOT present in master for "${item.name}". New batches cannot be created during purchase voucher upload.`,
        });
      } else {
        validatedAllocations.push({
          rowNumber: prow.rowNumber,
          item,
          batch: foundBatch,
          sph: Number(foundBatch.sph),
          cyl: Number(foundBatch.cyl),
          axis: Number(foundBatch.axis || 0),
          addition: Number(foundBatch.add || 0),
          side: foundBatch.side || 'NONE',
          quantity: prow.quantity,
        });
      }
    }

    // Step 6: Group batches under Stock Items
    // Even if rows for the same stock item are dispersed/scattered, group them into a single line item.
    // Also combine duplicate powers under the same stock item.
    const groupedItemsMap = new Map<string, GroupedImportLine>();

    for (const alloc of validatedAllocations) {
      const { item, batch, quantity } = alloc;
      let line = groupedItemsMap.get(item.id);

      if (!line) {
        const defaultRate =
          parseFloat(item.last_purchase_price) ||
          parseFloat(item.purchase_rate) ||
          250;
        const gstRate = parseFloat(item.gst_rate) || 0;

        line = {
          id: `p-import-${item.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          uniqueItemId: item.id,
          uniqueItemName: item.name,
          uniqueItemCode: item.code || '',
          categoryCode: item.optical_category || 'SV',
          unit: item.unit || 'PRS',
          maintainBatches: item.maintain_batches !== false,
          quantity: 0,
          rate: defaultRate,
          discountType: 'NONE',
          discountValue: 0,
          gstRate,
          batches: [],
        };
        groupedItemsMap.set(item.id, line);
      }

      // Look for existing batch allocation for this batchId
      const existingBatch = line.batches.find(b => b.batchId === batch.id);
      if (existingBatch) {
        existingBatch.quantity = Math.round((existingBatch.quantity + quantity) * 100) / 100;
      } else {
        line.batches.push({
          batchId: batch.id,
          sph: alloc.sph,
          cyl: alloc.cyl,
          axis: alloc.axis,
          add: alloc.addition,
          side: alloc.side,
          quantity,
          rate: line.rate,
          barcode: batch.barcode,
          availableStock: parseFloat(batch.available_stock || 0),
        });
      }

      line.quantity = Math.round((line.quantity + quantity) * 100) / 100;
    }

    const groupedLines = Array.from(groupedItemsMap.values());
    const validRowsCount = validatedAllocations.length;
    const totalBatchesCount = groupedLines.reduce((acc, l) => acc + l.batches.length, 0);

    errors.sort((a, b) => a.rowNumber - b.rowNumber);

    return {
      success: errors.length === 0,
      summary: {
        totalRows: rows.length,
        validRows: validRowsCount,
        errorRows: errors.length,
        stockItemsCount: groupedLines.length,
        batchesCount: totalBatchesCount,
      },
      errors,
      groupedLines,
    };
  }
}
