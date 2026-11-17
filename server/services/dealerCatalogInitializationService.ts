import type { PoolClient } from 'pg';
import { pool } from '../db/index.js';

export interface CatalogInitializationStats {
  categories: number;
  coatings: number;
  bases: number;
  baseCategories: number;
  primaryItems: number;
  uniqueItems: number;
  opticalBatches: number;
  opticalStocks: number;
  durationMs: number;
}

/**
 * Service to handle atomic optical catalog replication for newly created independent dealers.
 *
 * Each dealer receives its own tenant-scoped copies of Lumina Optics' active optical catalog
 * and batch definitions, with strictly ZERO opening stock.
 *
 * Enforces all Phase 1 invariants:
 * 1. Independent tenant IDs (business_id = dealerBusinessId) for every record.
 * 2. Lumina production records remain 100% read-only and unmodified.
 * 3. Commercial purchase costs & last purchase prices stripped to '0.00'.
 * 4. Opening stock quantities strictly initialized to '0.00' (physical, reserved, available).
 * 5. Zero stock ledger rows created (no opening balance movements).
 * 6. Optical batch coordinates (sph, cyl, axis, add, side) and identity_key preserved identically.
 * 7. Barcodes generated deterministically and globally unique (format: OPT-{catCode}-{dealerHex12}-{batchHex12}).
 * 8. Re-entrant and idempotent on retry via ON CONFLICT specifications.
 */
export class DealerCatalogInitializationService {
  /**
   * Replicates active catalog records from source business to target dealer inside an existing transaction.
   *
   * @param client The active PoolClient with an open transaction (BEGIN ... COMMIT/ROLLBACK).
   * @param mainBusinessId The source business ID (Lumina Optics).
   * @param dealerBusinessId The newly created dealer business ID.
   * @param userId The ID of the user triggering the dealer creation (optional).
   */
  static async initializeDealerCatalog(
    client: PoolClient,
    mainBusinessId: string,
    dealerBusinessId: string,
    userId?: string | null
  ): Promise<CatalogInitializationStats> {
    if (!mainBusinessId || !dealerBusinessId) {
      throw new Error('mainBusinessId and dealerBusinessId are required for catalog initialization.');
    }

    if (mainBusinessId === dealerBusinessId) {
      throw new Error('Cannot replicate catalog to the same business.');
    }

    const startTime = Date.now();

    // 0. Concurrency / transaction advisory lock to prevent race conditions during initialization
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1 || '-' || $2))`,
      [mainBusinessId, dealerBusinessId]
    );

    // 1. Validate source business exists and is active
    const sourceBizRes = await client.query(
      `SELECT id, name, status FROM businesses WHERE id = $1`,
      [mainBusinessId]
    );

    if (sourceBizRes.rows.length === 0) {
      throw new Error(`Source business '${mainBusinessId}' does not exist.`);
    }

    if (sourceBizRes.rows[0].status !== 'ACTIVE') {
      throw new Error(`Source business '${sourceBizRes.rows[0].name}' (${mainBusinessId}) is not ACTIVE.`);
    }

    // 2. Validate dealer business exists
    const dealerBizRes = await client.query(
      `SELECT id, name FROM businesses WHERE id = $1`,
      [dealerBusinessId]
    );

    if (dealerBizRes.rows.length === 0) {
      throw new Error(`Target dealer business '${dealerBusinessId}' does not exist.`);
    }

    const auditUserId = userId || null;

    // 3. Step 1: Replicate Active Categories
    const catRes = await client.query(
      `INSERT INTO categories (
        id, business_id, name, code, description, status, created_at, updated_at, created_by, updated_by
      )
      SELECT 
        gen_random_uuid(), $1, name, code, description, status, NOW(), NOW(), $2, $2
      FROM categories 
      WHERE business_id = $3 AND status = 'ACTIVE'
      ON CONFLICT (business_id, code) DO UPDATE SET 
        name = COALESCE(categories.name, EXCLUDED.name), 
        description = COALESCE(categories.description, EXCLUDED.description),
        status = COALESCE(categories.status, EXCLUDED.status), 
        updated_at = NOW()
      RETURNING id`,
      [dealerBusinessId, auditUserId, mainBusinessId]
    );

    // 4. Step 2: Replicate Active Coatings
    const coatRes = await client.query(
      `INSERT INTO coatings (
        id, business_id, name, code, description, status, created_at, updated_at, created_by, updated_by
      )
      SELECT 
        gen_random_uuid(), $1, name, code, description, status, NOW(), NOW(), $2, $2
      FROM coatings 
      WHERE business_id = $3 AND status = 'ACTIVE'
      ON CONFLICT (business_id, code) DO UPDATE SET 
        name = COALESCE(coatings.name, EXCLUDED.name), 
        description = COALESCE(coatings.description, EXCLUDED.description),
        status = COALESCE(coatings.status, EXCLUDED.status), 
        updated_at = NOW()
      RETURNING id`,
      [dealerBusinessId, auditUserId, mainBusinessId]
    );

    // 5. Step 3: Replicate Active Bases (mapping coating_id to dealer's coating)
    const baseRes = await client.query(
      `INSERT INTO bases (
        id, business_id, name, code, family, coating_id, description, status, created_at, updated_at, created_by, updated_by
      )
      SELECT 
        gen_random_uuid(), $1, b.name, b.code, b.family, c_new.id, b.description, b.status, NOW(), NOW(), $2, $2
      FROM bases b
      LEFT JOIN coatings c_old ON b.coating_id = c_old.id
      LEFT JOIN coatings c_new ON c_new.business_id = $1 AND c_new.code = c_old.code
      WHERE b.business_id = $3 AND b.status = 'ACTIVE'
      ON CONFLICT (business_id, code) DO UPDATE SET 
        name = COALESCE(bases.name, EXCLUDED.name), 
        family = COALESCE(bases.family, EXCLUDED.family),
        coating_id = COALESCE(bases.coating_id, EXCLUDED.coating_id),
        description = COALESCE(bases.description, EXCLUDED.description),
        status = COALESCE(bases.status, EXCLUDED.status), 
        updated_at = NOW()
      RETURNING id`,
      [dealerBusinessId, auditUserId, mainBusinessId]
    );

    // 6. Step 4: Replicate Base Category Compatibility Links
    const baseCatRes = await client.query(
      `INSERT INTO base_categories (
        business_id, base_id, category_id, created_at
      )
      SELECT 
        $1, b_new.id, cat_new.id, NOW()
      FROM base_categories bc
      JOIN bases b_old ON bc.base_id = b_old.id
      JOIN bases b_new ON b_new.business_id = $1 AND b_new.code = b_old.code
      JOIN categories cat_old ON bc.category_id = cat_old.id
      JOIN categories cat_new ON cat_new.business_id = $1 AND cat_new.code = cat_old.code
      WHERE bc.business_id = $2
      ON CONFLICT (business_id, base_id, category_id) DO NOTHING
      RETURNING id`,
      [dealerBusinessId, mainBusinessId]
    );

    // 7. Step 5: Replicate Active Primary Items (mapping category_id, base_id, coating_id)
    const piRes = await client.query(
      `INSERT INTO primary_items (
        id, business_id, category_id, base_id, coating_id, name, code, description, status, created_at, updated_at, created_by, updated_by
      )
      SELECT 
        gen_random_uuid(), $1, cat_new.id, b_new.id, c_new.id, pi.name, pi.code, pi.description, pi.status, NOW(), NOW(), $2, $2
      FROM primary_items pi
      JOIN categories cat_old ON pi.category_id = cat_old.id
      JOIN categories cat_new ON cat_new.business_id = $1 AND cat_new.code = cat_old.code
      JOIN bases b_old ON pi.base_id = b_old.id
      JOIN bases b_new ON b_new.business_id = $1 AND b_new.code = b_old.code
      LEFT JOIN coatings c_old ON pi.coating_id = c_old.id
      LEFT JOIN coatings c_new ON c_new.business_id = $1 AND c_new.code = c_old.code
      WHERE pi.business_id = $3 AND pi.status = 'ACTIVE'
      ON CONFLICT (business_id, code) DO UPDATE SET 
        category_id = COALESCE(primary_items.category_id, EXCLUDED.category_id),
        base_id = COALESCE(primary_items.base_id, EXCLUDED.base_id),
        coating_id = COALESCE(primary_items.coating_id, EXCLUDED.coating_id),
        name = COALESCE(primary_items.name, EXCLUDED.name),
        description = COALESCE(primary_items.description, EXCLUDED.description),
        status = COALESCE(primary_items.status, EXCLUDED.status), 
        updated_at = NOW()
      RETURNING id`,
      [dealerBusinessId, auditUserId, mainBusinessId]
    );

    // 8. Step 6: Replicate Active Unique Items
    // Preserves dealer-owned commercial metadata (purchase_rate, last_purchase_price, mrp, gst_rate, name, status) if already populated or modified by dealer.
    const uiRes = await client.query(
      `INSERT INTO unique_items (
        id, business_id, primary_item_id, name, code, description, maintain_batches,
        optical_category, unit, purchase_rate, last_purchase_price, mrp, gst_rate,
        status, created_at, updated_at, created_by, updated_by
      )
      SELECT 
        gen_random_uuid(), $1, pi_new.id, ui.name, ui.code, ui.description, ui.maintain_batches,
        ui.optical_category, ui.unit, '0.00', '0.00', ui.mrp, ui.gst_rate,
        ui.status, NOW(), NOW(), $2, $2
      FROM unique_items ui
      LEFT JOIN primary_items pi_old ON ui.primary_item_id = pi_old.id
      LEFT JOIN primary_items pi_new ON pi_new.business_id = $1 AND pi_new.code = pi_old.code
      WHERE ui.business_id = $3 AND ui.status = 'ACTIVE'
      ON CONFLICT (business_id, code) DO UPDATE SET 
        primary_item_id = COALESCE(unique_items.primary_item_id, EXCLUDED.primary_item_id),
        name = COALESCE(unique_items.name, EXCLUDED.name),
        description = COALESCE(unique_items.description, EXCLUDED.description),
        maintain_batches = COALESCE(unique_items.maintain_batches, EXCLUDED.maintain_batches),
        optical_category = COALESCE(unique_items.optical_category, EXCLUDED.optical_category),
        unit = COALESCE(unique_items.unit, EXCLUDED.unit),
        purchase_rate = COALESCE(NULLIF(unique_items.purchase_rate, 0), '0.00'),
        last_purchase_price = COALESCE(NULLIF(unique_items.last_purchase_price, 0), '0.00'),
        mrp = COALESCE(NULLIF(unique_items.mrp, 0), EXCLUDED.mrp),
        gst_rate = COALESCE(NULLIF(unique_items.gst_rate, 0), EXCLUDED.gst_rate),
        status = COALESCE(unique_items.status, EXCLUDED.status), 
        updated_at = NOW()
      RETURNING id`,
      [dealerBusinessId, auditUserId, mainBusinessId]
    );

    // 9. Step 7: Replicate Active Optical Batches
    // Generates deterministic, globally unique Code 128 barcodes per dealer and source batch.
    // Preserves optical power coordinates (sph, cyl, axis, add, side) and identity_key while protecting dealer custom status.
    const batchRes = await client.query(
      `INSERT INTO optical_batches (
        id, business_id, unique_item_id, category_id, barcode,
        sph, cyl, axis, "add", side, identity_key, status,
        created_at, updated_at, created_by, updated_by
      )
      SELECT
        gen_random_uuid(),
        $1,
        ui_new.id,
        cat_new.id,
        'OPT-' || cat_new.code || '-' || UPPER(SUBSTRING(REPLACE($1::text, '-', ''), 1, 12)) || '-' || UPPER(SUBSTRING(REPLACE(ob.id::text, '-', ''), 1, 12)),
        ob.sph,
        ob.cyl,
        ob.axis,
        ob."add",
        ob.side,
        ob.identity_key,
        ob.status,
        NOW(),
        NOW(),
        $2,
        $2
      FROM optical_batches ob
      JOIN unique_items ui_old ON ob.unique_item_id = ui_old.id
      JOIN unique_items ui_new ON ui_new.business_id = $1 AND ui_new.code = ui_old.code
      JOIN categories cat_old ON ob.category_id = cat_old.id
      JOIN categories cat_new ON cat_new.business_id = $1 AND cat_new.code = cat_old.code
      WHERE ob.business_id = $3 AND ob.status = 'ACTIVE'
      ON CONFLICT (business_id, identity_key) DO UPDATE SET 
        status = COALESCE(optical_batches.status, EXCLUDED.status),
        updated_at = NOW()
      RETURNING id`,
      [dealerBusinessId, auditUserId, mainBusinessId]
    );

    // 10. Step 8: Initialize Optical Stocks with Strictly Zero Opening Stock
    // Formula: physicalStock = '0.00', reservedStock = '0.00', availableStock = '0.00', godownId = NULL.
    // Note: Absolutely ZERO entries are inserted into stock_ledger.
    const stockRes = await client.query(
      `INSERT INTO optical_stocks (
        id, business_id, batch_id, godown_id, physical_stock, reserved_stock, available_stock, updated_at
      )
      SELECT
        gen_random_uuid(),
        $1,
        ob_new.id,
        NULL,
        '0.00',
        '0.00',
        '0.00',
        NOW()
      FROM optical_batches ob_new
      WHERE ob_new.business_id = $1
      ON CONFLICT (business_id, batch_id, COALESCE(godown_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING
      RETURNING id`,
      [dealerBusinessId]
    );

    // 11. Fetch final counts for verification
    const countRes = await client.query(
      `SELECT 
        (SELECT COUNT(*) FROM categories WHERE business_id = $1) as categories,
        (SELECT COUNT(*) FROM coatings WHERE business_id = $1) as coatings,
        (SELECT COUNT(*) FROM bases WHERE business_id = $1) as bases,
        (SELECT COUNT(*) FROM base_categories WHERE business_id = $1) as base_categories,
        (SELECT COUNT(*) FROM primary_items WHERE business_id = $1) as primary_items,
        (SELECT COUNT(*) FROM unique_items WHERE business_id = $1) as unique_items,
        (SELECT COUNT(*) FROM optical_batches WHERE business_id = $1) as optical_batches,
        (SELECT COUNT(*) FROM optical_stocks WHERE business_id = $1) as optical_stocks`,
      [dealerBusinessId]
    );

    const counts = countRes.rows[0];
    const durationMs = Date.now() - startTime;

    const stats: CatalogInitializationStats = {
      categories: parseInt(counts.categories, 10),
      coatings: parseInt(counts.coatings, 10),
      bases: parseInt(counts.bases, 10),
      baseCategories: parseInt(counts.base_categories, 10),
      primaryItems: parseInt(counts.primary_items, 10),
      uniqueItems: parseInt(counts.unique_items, 10),
      opticalBatches: parseInt(counts.optical_batches, 10),
      opticalStocks: parseInt(counts.optical_stocks, 10),
      durationMs,
    };

    return stats;
  }

  /**
   * Standalone execution of catalog initialization with its own transaction.
   * Useful for administrative seeding, tests, or backfilling existing dealers.
   */
  static async initializeDealerCatalogStandalone(
    mainBusinessId: string,
    dealerBusinessId: string,
    userId?: string | null
  ): Promise<CatalogInitializationStats> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stats = await this.initializeDealerCatalog(client, mainBusinessId, dealerBusinessId, userId);
      await client.query('COMMIT');
      return stats;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
