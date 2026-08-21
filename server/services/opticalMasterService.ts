/**
 * Optical Master & Inventory Domain Service
 * Handles optical power normalization, category-specific validations,
 * permanent batch identity hashing, barcode generation, and transactional find-or-create logic.
 */
import { pool, db } from '../db/index.js';
import { opticalBatches, opticalStocks, stockLedger, categories, uniqueItems, primaryItems, bases, coatings } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export interface OpticalPowerInput {
  businessId: string;
  uniqueItemId: string;
  categoryId?: string; // Optional: will be auto-resolved from uniqueItem -> primaryItem -> category if omitted
  sph: number | string;
  cyl: number | string;
  axis?: number | string | null;
  add?: number | string | null;
  side?: string | null;
  userId?: string | null;
}

export interface ValidatedOpticalIdentity {
  sphNum: number;
  cylNum: number;
  axisNum: number;
  addNum: number;
  sideNormalized: 'NONE' | 'R' | 'L' | 'BE';
  identityKey: string;
  categoryCode: 'SV' | 'KT' | 'PROG';
}

/**
 * Normalizes any optical number to a standard float with 2 decimal places.
 * -2, -2.0, -2.00, "-2.00" -> -2.00
 */
export function normalizeOpticalNumber(val: number | string | null | undefined, defaultValue: number = 0): number {
  if (val === null || val === undefined || val === '') return defaultValue;
  const num = typeof val === 'number' ? val : parseFloat(String(val).trim());
  if (isNaN(num)) return defaultValue;
  // Round to nearest 0.01 to prevent floating-point precision noise
  return Math.round(num * 100) / 100;
}

/**
 * Validates category-specific power rules and produces canonical identity key
 */
export function validateOpticalPower(
  categoryCode: string,
  sphRaw: number | string,
  cylRaw: number | string,
  axisRaw?: number | string | null,
  addRaw?: number | string | null,
  sideRaw?: string | null
): ValidatedOpticalIdentity {
  const cat = categoryCode.toUpperCase().trim();
  if (cat !== 'SV' && cat !== 'KT' && cat !== 'PROG') {
    throw new Error(`Unsupported optical category: "${categoryCode}". Must be SV, KT, or PROG.`);
  }

  const sphNum = normalizeOpticalNumber(sphRaw);
  const cylNum = normalizeOpticalNumber(cylRaw);
  let axisNum = normalizeOpticalNumber(axisRaw, 0);
  let addNum = normalizeOpticalNumber(addRaw, 0);
  let sideNormalized: 'NONE' | 'R' | 'L' | 'BE' = 'NONE';

  // Rule 1: SPH and CYL are always required
  if (sphRaw === undefined || sphRaw === null || sphRaw === '') {
    throw new Error('SPH power is required for optical batch');
  }
  if (cylRaw === undefined || cylRaw === null || cylRaw === '') {
    throw new Error('CYL power is required for optical batch');
  }

  // Category Specific Rule: Single Vision (SV)
  if (cat === 'SV') {
    // SV does NOT have axis or add or side
    if (axisRaw !== undefined && axisRaw !== null && axisRaw !== '' && Number(axisRaw) !== 0) {
      throw new Error('Single Vision (SV) lenses do not have AXIS. AXIS must not be provided.');
    }
    if (addRaw !== undefined && addRaw !== null && addRaw !== '' && Number(addRaw) !== 0) {
      throw new Error('Single Vision (SV) lenses do not have ADD power.');
    }
    axisNum = 0;
    addNum = 0;
    sideNormalized = 'NONE';
  }

  // Category Specific Rule: Kryptok Bifocal (KT)
  if (cat === 'KT') {
    // KT has SPH, CYL, AXIS, ADD. No side.
    if (cylNum !== 0) {
      if (axisRaw === undefined || axisRaw === null || axisRaw === '' || isNaN(Number(axisRaw))) {
        throw new Error('AXIS is required for Kryptok (KT) lenses when CYL != 0.');
      }
      if (axisNum < 0 || axisNum > 180) {
        throw new Error('AXIS must be between 0 and 180 degrees.');
      }
    } else {
      axisNum = 0;
    }
    sideNormalized = 'NONE';
  }

  // Category Specific Rule: Progressive Lens (PROG)
  if (cat === 'PROG') {
    // PROG has SPH, CYL, AXIS, ADD, SIDE (R, L, BE)
    if (cylNum !== 0) {
      if (axisRaw === undefined || axisRaw === null || axisRaw === '' || isNaN(Number(axisRaw))) {
        throw new Error('AXIS is required for Progressive (PROG) lenses when CYL != 0.');
      }
      if (axisNum < 0 || axisNum > 180) {
        throw new Error('AXIS must be between 0 and 180 degrees.');
      }
    } else {
      axisNum = 0;
    }

    const sideUpper = (sideRaw || '').trim().toUpperCase();
    if (sideUpper !== 'R' && sideUpper !== 'L' && sideUpper !== 'BE') {
      throw new Error('Progressive (PROG) lens requires SIDE to be specified as "R", "L", or "BE".');
    }
    sideNormalized = sideUpper as 'R' | 'L' | 'BE';
  }

  // Generate canonical, immutable identity key
  const sphStr = sphNum.toFixed(2);
  const cylStr = cylNum.toFixed(2);
  const axisStr = axisNum.toFixed(1);
  const addStr = addNum.toFixed(2);

  let identityKey = '';
  if (cat === 'SV') {
    identityKey = `SV:SPH=${sphStr}:CYL=${cylStr}`;
  } else if (cat === 'KT') {
    identityKey = `KT:SPH=${sphStr}:CYL=${cylStr}:AXIS=${axisStr}:ADD=${addStr}`;
  } else if (cat === 'PROG') {
    identityKey = `PROG:SPH=${sphStr}:CYL=${cylStr}:AXIS=${axisStr}:ADD=${addStr}:SIDE=${sideNormalized}`;
  }

  return {
    sphNum,
    cylNum,
    axisNum,
    addNum,
    sideNormalized,
    identityKey,
    categoryCode: cat as 'SV' | 'KT' | 'PROG',
  };
}

/**
 * Barcode Generation Service Abstraction
 * Generates permanent, unique, Code 128-compatible barcode strings.
 * Numbering algorithm is isolated so it can be customized or configured without altering the data model.
 */
export class BarcodeService {
  /**
   * Generates a permanent Code 128 compatible optical barcode.
   * Format: OPT-{bizPrefix}-{timestamp/sequence}-{random}
   */
  static generatePermanentBarcode(businessId: string, categoryCode: string): string {
    const bizShort = businessId.replace(/-/g, '').slice(0, 4).toUpperCase();
    const timeComponent = Date.now().toString(36).toUpperCase();
    const randomComponent = Math.floor(1000 + Math.random() * 9000).toString();
    return `OPT-${categoryCode}-${bizShort}-${timeComponent}-${randomComponent}`;
  }
}

/**
 * Transactional Find or Create Optical Batch
 * Guarantees:
 * 1. Exactly one permanent batch for one exact power combination under a unique item.
 * 2. Exactly one permanent barcode.
 * 3. Initial optical_stock record initialized with 0.00.
 * 4. Concurrency safe using database upsert/transactional locking.
 */
export async function findOrCreateOpticalBatch(input: OpticalPowerInput) {
  const { businessId, uniqueItemId, userId } = input;
  if (!businessId || !uniqueItemId) {
    throw new Error('businessId and uniqueItemId are required.');
  }

  // 1. Resolve Unique Item & Category
  const [uItem] = await db
    .select({
      id: uniqueItems.id,
      name: uniqueItems.name,
      code: uniqueItems.code,
      primaryItemId: uniqueItems.primaryItemId,
      categoryCode: categories.code,
      categoryId: categories.id,
    })
    .from(uniqueItems)
    .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
    .innerJoin(categories, eq(primaryItems.categoryId, categories.id))
    .where(and(eq(uniqueItems.id, uniqueItemId), eq(uniqueItems.businessId, businessId)))
    .limit(1);

  if (!uItem) {
    throw new Error(`Unique Item ${uniqueItemId} not found for business ${businessId}`);
  }

  const categoryId = input.categoryId || uItem.categoryId;
  const categoryCode = uItem.categoryCode;

  // 2. Validate and produce canonical identity
  const validated = validateOpticalPower(
    categoryCode,
    input.sph,
    input.cyl,
    input.axis,
    input.add,
    input.side
  );

  const fullIdentityKey = `${uniqueItemId}:${validated.identityKey}`;

  // 3. Check for existing batch
  const existingRows = await db
    .select()
    .from(opticalBatches)
    .where(
      and(
        eq(opticalBatches.businessId, businessId),
        eq(opticalBatches.identityKey, fullIdentityKey)
      )
    )
    .limit(1);

  if (existingRows.length > 0) {
    const batch = existingRows[0];
    // Fetch current stock
    const [stock] = await db
      .select()
      .from(opticalStocks)
      .where(and(eq(opticalStocks.businessId, businessId), eq(opticalStocks.batchId, batch.id)))
      .limit(1);

    return {
      batch,
      stock: stock || {
        physicalStock: '0.00',
        reservedStock: '0.00',
        availableStock: '0.00',
      },
      isNew: false,
    };
  }

  // 4. Create new Optical Batch + Barcode in transaction
  const permanentBarcode = BarcodeService.generatePermanentBarcode(businessId, categoryCode);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Double check under lock inside transaction
    const lockCheck = await client.query(
      `SELECT * FROM optical_batches WHERE business_id = $1 AND identity_key = $2 LIMIT 1 FOR UPDATE`,
      [businessId, fullIdentityKey]
    );

    if (lockCheck.rows.length > 0) {
      await client.query('COMMIT');
      const rawExisting = lockCheck.rows[0];
      const existing = {
        id: rawExisting.id,
        businessId: rawExisting.business_id,
        uniqueItemId: rawExisting.unique_item_id,
        categoryId: rawExisting.category_id,
        barcode: rawExisting.barcode,
        sph: rawExisting.sph,
        cyl: rawExisting.cyl,
        axis: rawExisting.axis,
        add: rawExisting.add,
        side: rawExisting.side,
        identityKey: rawExisting.identity_key,
        status: rawExisting.status,
        createdAt: rawExisting.created_at,
        updatedAt: rawExisting.updated_at,
      };
      const stockRes = await client.query(
        `SELECT * FROM optical_stocks WHERE business_id = $1 AND batch_id = $2 LIMIT 1`,
        [businessId, existing.id]
      );
      const rawStock = stockRes.rows[0];
      return {
        batch: existing,
        stock: rawStock ? {
          id: rawStock.id,
          businessId: rawStock.business_id,
          batchId: rawStock.batch_id,
          physicalStock: rawStock.physical_stock,
          reservedStock: rawStock.reserved_stock,
          availableStock: rawStock.available_stock,
        } : { physicalStock: '0.00', reservedStock: '0.00', availableStock: '0.00' },
        isNew: false,
      };
    }

    // Insert new batch
    const insertRes = await client.query(
      `INSERT INTO optical_batches (
        business_id, unique_item_id, category_id, barcode,
        sph, cyl, axis, "add", side, identity_key, status, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', $11, $11)
      RETURNING *`,
      [
        businessId,
        uniqueItemId,
        categoryId,
        permanentBarcode,
        validated.sphNum.toFixed(2),
        validated.cylNum.toFixed(2),
        validated.axisNum.toFixed(1),
        validated.addNum.toFixed(2),
        validated.sideNormalized,
        fullIdentityKey,
        userId || null,
      ]
    );

    const rawBatch = insertRes.rows[0];
    const newBatch = {
      id: rawBatch.id,
      businessId: rawBatch.business_id,
      uniqueItemId: rawBatch.unique_item_id,
      categoryId: rawBatch.category_id,
      barcode: rawBatch.barcode,
      sph: rawBatch.sph,
      cyl: rawBatch.cyl,
      axis: rawBatch.axis,
      add: rawBatch.add,
      side: rawBatch.side,
      identityKey: rawBatch.identity_key,
      status: rawBatch.status,
      createdAt: rawBatch.created_at,
      updatedAt: rawBatch.updated_at,
    };

    // Initialize optical stock
    const stockRes = await client.query(
      `INSERT INTO optical_stocks (
        business_id, batch_id, physical_stock, reserved_stock, available_stock
      ) VALUES ($1, $2, '0.00', '0.00', '0.00')
      RETURNING *`,
      [businessId, newBatch.id]
    );

    await client.query('COMMIT');

    const rawStock = stockRes.rows[0];
    const newStock = {
      id: rawStock.id,
      businessId: rawStock.business_id,
      batchId: rawStock.batch_id,
      physicalStock: rawStock.physical_stock,
      reservedStock: rawStock.reserved_stock,
      availableStock: rawStock.available_stock,
    };

    return {
      batch: newBatch,
      stock: newStock,
      isNew: true,
    };
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }
}
