import fs from 'fs';

// Setup database environment before importing db pool
if (!process.env.DEV_DATABASE_URL && !process.env.DATABASE_URL) {
  try {
    const pids = ['145', '134'];
    for (const pid of pids) {
      if (fs.existsSync(`/proc/${pid}/environ`)) {
        const envStr = fs.readFileSync(`/proc/${pid}/environ`, 'utf-8');
        for (const entry of envStr.split('\0')) {
          const eq = entry.indexOf('=');
          if (eq > 0) {
            const k = entry.slice(0, eq);
            const v = entry.slice(eq + 1);
            if (['DEV_DATABASE_URL', 'DATABASE_URL_UNPOOLED'].includes(k)) {
              process.env[k] = v;
            }
          }
        }
        break;
      }
    }
  } catch (e) {
    // Ignore error
  }
}

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
  passed++;
}

async function runDealerCatalogInitializationTests() {
  console.log('========================================================================');
  console.log('PHASE 1: ATOMIC DEALER CATALOG INITIALIZATION TEST SUITE');
  console.log('========================================================================');

  const { pool } = await import('../db/index.js');
  const { DealerCreationService } = await import('../services/dealerCreationService.js');
  const { DealerCatalogInitializationService } = await import('../services/dealerCatalogInitializationService.js');
  const { PurchaseService } = await import('../services/purchaseService.js');

  const luminaId = 'c43b93ef-8569-4857-80ff-faca53b4ed7c';
  const testDealerIdsToClean: string[] = [];

  // Helper for spotless cleanup
  async function cleanupBusiness(bizId: string) {
    try {
      await pool.query('DELETE FROM supplier_ledgers WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM purchase_invoices WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM purchase_orders WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM stock_ledger WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM optical_stocks WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM optical_batches WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM unique_items WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM primary_items WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM base_categories WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM bases WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM coatings WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM categories WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM parties WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM godowns WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM business_settings WHERE business_id = $1', [bizId]);
      await pool.query('DELETE FROM audit_logs WHERE business_id = $1', [bizId]);
      // Also clean any customer party created in Lumina for this dealer
      await pool.query(`DELETE FROM parties WHERE business_id = $1 AND notes LIKE '%' || $2 || '%'`, [luminaId, bizId]);
      await pool.query('DELETE FROM businesses WHERE id = $1', [bizId]);
    } catch (e) {
      console.warn(`Cleanup error for business ${bizId}:`, (e as any)?.message || e);
    }
  }

  try {
    // 0. Record baseline Lumina counts
    const baselineCountsRes = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM categories WHERE business_id = $1) as categories,
        (SELECT COUNT(*) FROM coatings WHERE business_id = $1) as coatings,
        (SELECT COUNT(*) FROM bases WHERE business_id = $1) as bases,
        (SELECT COUNT(*) FROM base_categories WHERE business_id = $1) as base_categories,
        (SELECT COUNT(*) FROM primary_items WHERE business_id = $1) as primary_items,
        (SELECT COUNT(*) FROM unique_items WHERE business_id = $1) as unique_items,
        (SELECT COUNT(*) FROM optical_batches WHERE business_id = $1) as optical_batches,
        (SELECT COUNT(*) FROM optical_stocks WHERE business_id = $1) as optical_stocks
    `, [luminaId]);
    const baselineLumina = baselineCountsRes.rows[0];
    console.log('\n--- BASELINE LUMINA PRODUCTION COUNTS ---');
    console.log(baselineLumina);

    // -------------------------------------------------------------------------
    // TEST 1: End-to-End Dealer Creation with Atomic Catalog Replication
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Creation of New Dealer Business with Automatic Replication ---');
    const userRes = await pool.query(`
      SELECT id FROM users WHERE username = 'admin' LIMIT 1
    `);
    const adminUserId = userRes.rows[0].id;

    const suffix1 = Date.now().toString().slice(-6);
    const createRes = await DealerCreationService.createDealer(
      luminaId,
      adminUserId,
      {
        name: `Test Dealer ${suffix1}`,
        tradeName: `Test Optics ${suffix1}`,
        gstin: `08AAAAA${suffix1.slice(0, 4)}1Z5`,
        city: 'Jaipur',
        state: 'Rajasthan',
        stateCode: '08',
        creditLimit: 50000,
        creditDays: 30,
        customerLinkMode: 'CREATE_NEW',
      }
    );

    assert(createRes.success === true, 'Dealer creation returned success = true');
    const dealerId1 = createRes.dealer.id;
    testDealerIdsToClean.push(dealerId1);
    assert(Boolean(dealerId1), `Dealer business ID generated: ${dealerId1}`);

    const stats = createRes.catalogStats;
    assert(Boolean(stats), 'catalogStats returned in dealer creation response');
    console.log(`Replication execution time: ${stats.durationMs}ms`);

    // Verify replicated counts match expected Lumina active catalog counts
    assert(stats.categories === parseInt(baselineLumina.categories, 10), `Categories replicated (${stats.categories}) matches Lumina (${baselineLumina.categories})`);
    assert(stats.coatings === parseInt(baselineLumina.coatings, 10), `Coatings replicated (${stats.coatings}) matches Lumina (${baselineLumina.coatings})`);
    assert(stats.bases === parseInt(baselineLumina.bases, 10), `Bases replicated (${stats.bases}) matches Lumina (${baselineLumina.bases})`);
    assert(stats.baseCategories === parseInt(baselineLumina.base_categories, 10), `Base Categories replicated (${stats.baseCategories}) matches Lumina (${baselineLumina.base_categories})`);
    assert(stats.primaryItems === parseInt(baselineLumina.primary_items, 10), `Primary Items replicated (${stats.primaryItems}) matches Lumina (${baselineLumina.primary_items})`);
    assert(stats.uniqueItems === parseInt(baselineLumina.unique_items, 10), `Unique Items replicated (${stats.uniqueItems}) matches Lumina (${baselineLumina.unique_items})`);
    assert(stats.opticalBatches === parseInt(baselineLumina.optical_batches, 10), `Optical Batches replicated (${stats.opticalBatches}) matches Lumina (${baselineLumina.optical_batches})`);
    assert(stats.opticalStocks === parseInt(baselineLumina.optical_stocks, 10), `Optical Stocks replicated (${stats.opticalStocks}) matches Lumina (${baselineLumina.optical_stocks})`);

    // -------------------------------------------------------------------------
    // TEST 2: Parent-Child Relationship Integrity in Replicated Tables
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Relational Foreign Key Integrity within Dealer Scope ---');

    // 2a. Check bases.coating_id references dealer's own coatings (not Lumina's)
    const baseCoatingCheck = await pool.query(`
      SELECT b.id, b.code, b.coating_id, c.business_id as coating_biz
      FROM bases b
      JOIN coatings c ON b.coating_id = c.id
      WHERE b.business_id = $1
    `, [dealerId1]);
    assert(baseCoatingCheck.rows.length === 12, 'All 12 replicated bases have valid coating references');
    assert(baseCoatingCheck.rows.every(r => r.coating_biz === dealerId1), 'All bases.coating_id point to dealer-scoped coatings (never Lumina)');

    // 2b. Check base_categories link dealer-scoped bases and categories
    const baseCatCheck = await pool.query(`
      SELECT bc.id, b.business_id as base_biz, cat.business_id as cat_biz
      FROM base_categories bc
      JOIN bases b ON bc.base_id = b.id
      JOIN categories cat ON bc.category_id = cat.id
      WHERE bc.business_id = $1
    `, [dealerId1]);
    assert(baseCatCheck.rows.length === 36, 'All 36 base_categories entries link valid records');
    assert(baseCatCheck.rows.every(r => r.base_biz === dealerId1 && r.cat_biz === dealerId1), 'All base_categories reference dealer-scoped bases and categories');

    // 2c. Check primary_items link dealer-scoped category, base, and coating
    const piCheck = await pool.query(`
      SELECT pi.id, cat.business_id as cat_biz, b.business_id as base_biz, c.business_id as coat_biz
      FROM primary_items pi
      JOIN categories cat ON pi.category_id = cat.id
      JOIN bases b ON pi.base_id = b.id
      LEFT JOIN coatings c ON pi.coating_id = c.id
      WHERE pi.business_id = $1
    `, [dealerId1]);
    assert(piCheck.rows.length === 6, 'All 6 primary_items have valid references');
    assert(piCheck.rows.every(r => r.cat_biz === dealerId1 && r.base_biz === dealerId1 && (!r.coat_biz || r.coat_biz === dealerId1)), 'All primary_items point strictly to dealer-scoped parent records');

    // 2d. Check unique_items link dealer-scoped primary_items (or NULL)
    const uiCheck = await pool.query(`
      SELECT ui.id, pi.business_id as pi_biz
      FROM unique_items ui
      LEFT JOIN primary_items pi ON ui.primary_item_id = pi.id
      WHERE ui.business_id = $1 AND ui.primary_item_id IS NOT NULL
    `, [dealerId1]);
    assert(uiCheck.rows.every(r => r.pi_biz === dealerId1), 'All unique_items with primary_item_id point strictly to dealer-scoped primary items');

    // 2e. Check optical_batches link dealer-scoped unique_items and categories
    const batchFkCheck = await pool.query(`
      SELECT COUNT(*) as invalid_count
      FROM optical_batches ob
      LEFT JOIN unique_items ui ON ob.unique_item_id = ui.id AND ui.business_id = $1
      LEFT JOIN categories cat ON ob.category_id = cat.id AND cat.business_id = $1
      WHERE ob.business_id = $1 AND (ui.id IS NULL OR cat.id IS NULL)
    `, [dealerId1]);
    assert(parseInt(batchFkCheck.rows[0].invalid_count, 10) === 0, 'All 8,380 optical batches link exclusively to dealer-scoped unique_items and categories');

    // 2f. Check optical_stocks link dealer-scoped batches
    const stockFkCheck = await pool.query(`
      SELECT COUNT(*) as invalid_count
      FROM optical_stocks os
      LEFT JOIN optical_batches ob ON os.batch_id = ob.id AND ob.business_id = $1
      WHERE os.business_id = $1 AND ob.id IS NULL
    `, [dealerId1]);
    assert(parseInt(stockFkCheck.rows[0].invalid_count, 10) === 0, 'All 8,380 optical stocks link exclusively to dealer-scoped optical batches');

    // -------------------------------------------------------------------------
    // TEST 3: Optical Coordinates & Identity Key Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Optical Power Coordinates and Identity Key Preservation ---');
    const sampleCoordCheck = await pool.query(`
      SELECT 
        src.identity_key as src_key,
        dst.identity_key as dst_key,
        src.sph as src_sph, dst.sph as dst_sph,
        src.cyl as src_cyl, dst.cyl as dst_cyl,
        src.axis as src_axis, dst.axis as dst_axis,
        src.add as src_add, dst.add as dst_add,
        src.side as src_side, dst.side as dst_side
      FROM optical_batches src
      JOIN optical_batches dst ON dst.business_id = $1 AND dst.identity_key = src.identity_key
      WHERE src.business_id = $2
      ORDER BY src.id
      LIMIT 100
    `, [dealerId1, luminaId]);
    assert(sampleCoordCheck.rows.length === 100, 'Matched 100 sample batches by identity_key');
    const coordsMatch = sampleCoordCheck.rows.every(r =>
      r.src_key === r.dst_key &&
      Number(r.src_sph) === Number(r.dst_sph) &&
      Number(r.src_cyl) === Number(r.dst_cyl) &&
      Number(r.src_axis) === Number(r.dst_axis) &&
      Number(r.src_add) === Number(r.dst_add) &&
      r.src_side === r.dst_side
    );
    assert(coordsMatch, 'All optical power coordinates (SPH, CYL, AXIS, ADD, SIDE) match source exactly');

    // -------------------------------------------------------------------------
    // TEST 4: Global Barcode Uniqueness & Format Verification
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Global Barcode Uniqueness and Deterministic Format ---');
    const sampleBarcodes = await pool.query(`
      SELECT barcode FROM optical_batches WHERE business_id = $1 LIMIT 5
    `, [dealerId1]);
    console.log('Sample dealer barcodes:', sampleBarcodes.rows.map(r => r.barcode));
    const dealerPrefix = dealerId1.replace(/-/g, '').slice(0, 12).toUpperCase();
    assert(
      sampleBarcodes.rows.every(r => r.barcode.startsWith('OPT-') && r.barcode.includes(dealerPrefix)),
      `All barcodes follow deterministic pattern OPT-{catCode}-${dealerPrefix}-{batchHex12}`
    );

    // Verify zero collisions with Lumina barcodes
    const barcodeCollisionCheck = await pool.query(`
      SELECT COUNT(*) as collision_count
      FROM optical_batches b1
      JOIN optical_batches b2 ON b1.barcode = b2.barcode AND b1.business_id != b2.business_id
      WHERE b1.business_id = $1 AND b2.business_id = $2
    `, [dealerId1, luminaId]);
    assert(parseInt(barcodeCollisionCheck.rows[0].collision_count, 10) === 0, 'Zero barcode collisions between Dealer and Lumina');

    // -------------------------------------------------------------------------
    // TEST 5: Strictly Zero Opening Stock & Zero Stock Ledger Movements
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Zero Opening Stock Quantities and Zero Stock Ledger Rows ---');
    const stockQuantityCheck = await pool.query(`
      SELECT 
        COUNT(*) as total_stocks,
        COUNT(CASE WHEN physical_stock != 0.00 THEN 1 END) as non_zero_physical,
        COUNT(CASE WHEN reserved_stock != 0.00 THEN 1 END) as non_zero_reserved,
        COUNT(CASE WHEN available_stock != 0.00 THEN 1 END) as non_zero_available,
        COUNT(CASE WHEN godown_id IS NOT NULL THEN 1 END) as assigned_godowns
      FROM optical_stocks
      WHERE business_id = $1
    `, [dealerId1]);
    const stockStats = stockQuantityCheck.rows[0];
    assert(parseInt(stockStats.total_stocks, 10) === 8380, 'All 8,380 optical stocks present');
    assert(parseInt(stockStats.non_zero_physical, 10) === 0, 'physical_stock = 0.00 for 100% of rows');
    assert(parseInt(stockStats.non_zero_reserved, 10) === 0, 'reserved_stock = 0.00 for 100% of rows');
    assert(parseInt(stockStats.non_zero_available, 10) === 0, 'available_stock = 0.00 for 100% of rows');
    assert(parseInt(stockStats.assigned_godowns, 10) === 0, 'godown_id = NULL for 100% of rows');

    const ledgerMovementCheck = await pool.query(`
      SELECT COUNT(*) as ledger_count FROM stock_ledger WHERE business_id = $1
    `, [dealerId1]);
    assert(parseInt(ledgerMovementCheck.rows[0].ledger_count, 10) === 0, 'Strictly 0 rows in stock_ledger for the dealer (no opening movements created)');

    // -------------------------------------------------------------------------
    // TEST 6: Stripping Lumina Commercial Purchase Costs & Prices
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Commercial Purchase Cost Stripping ---');
    const commercialCostCheck = await pool.query(`
      SELECT 
        COUNT(*) as total_items,
        COUNT(CASE WHEN purchase_rate != 0.00 THEN 1 END) as non_zero_rate,
        COUNT(CASE WHEN last_purchase_price != 0.00 THEN 1 END) as non_zero_last_price
      FROM unique_items
      WHERE business_id = $1
    `, [dealerId1]);
    const costStats = commercialCostCheck.rows[0];
    assert(parseInt(costStats.total_items, 10) === 120, 'All 120 unique items verified');
    assert(parseInt(costStats.non_zero_rate, 10) === 0, 'purchase_rate is strictly 0.00 for all dealer unique_items');
    assert(parseInt(costStats.non_zero_last_price, 10) === 0, 'last_purchase_price is strictly 0.00 for all dealer unique_items');

    // -------------------------------------------------------------------------
    // TEST 7: Idempotent Re-execution (No Duplicate Key Failures)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Idempotent Re-execution on Existing Dealer ---');
    const rerunStats = await DealerCatalogInitializationService.initializeDealerCatalogStandalone(
      luminaId,
      dealerId1,
      null
    );
    assert(rerunStats.categories === 3, 'Idempotent rerun: Categories count preserved (3)');
    assert(rerunStats.uniqueItems === 120, 'Idempotent rerun: Unique items count preserved (120)');
    assert(rerunStats.opticalBatches === 8380, 'Idempotent rerun: Optical batches count preserved (8,380)');
    assert(rerunStats.opticalStocks === 8380, 'Idempotent rerun: Optical stocks count preserved (8,380)');

    // -------------------------------------------------------------------------
    // TEST 8: Dealer Purchase Invoice Entry & Isolation Verification
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Dealer Historical Purchase Invoice Entry & Stock Ledger Isolation ---');
    // Pick 1 dealer unique item and batch
    const sampleBatchRes = await pool.query(`
      SELECT ob.id as batch_id, ob.unique_item_id, ui.code as item_code
      FROM optical_batches ob
      JOIN unique_items ui ON ob.unique_item_id = ui.id
      WHERE ob.business_id = $1
      LIMIT 1
    `, [dealerId1]);
    const sampleBatch = sampleBatchRes.rows[0];

    // Pick dealer's supplier party
    const supPartyRes = await pool.query(`
      SELECT id FROM parties WHERE business_id = $1 AND party_type IN ('SUPPLIER', 'BOTH') LIMIT 1
    `, [dealerId1]);
    const supplierPartyId = supPartyRes.rows[0].id;

    // Check Lumina stock for the corresponding Lumina batch before dealer purchase
    const luminaBatchRes = await pool.query(`
      SELECT ob_src.id as lumina_batch_id, os_src.physical_stock as lumina_stock
      FROM optical_batches ob_dst
      JOIN optical_batches ob_src ON ob_dst.identity_key = ob_src.identity_key AND ob_src.business_id = $2
      JOIN optical_stocks os_src ON os_src.batch_id = ob_src.id AND os_src.business_id = $2
      WHERE ob_dst.id = $1
    `, [sampleBatch.batch_id, luminaId]);
    const beforeLuminaStock = parseFloat(luminaBatchRes.rows[0].lumina_stock);

    // Create a Purchase Invoice in Dealer Business
    const purchaseResult = await PurchaseService.createPurchaseInvoice(
      dealerId1,
      {
        supplierPartyId,
        invoiceDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
        lines: [
          {
            uniqueItemId: sampleBatch.unique_item_id,
            quantity: 10,
            rate: 150.00,
            batches: [
              {
                batchId: sampleBatch.batch_id,
                quantity: 10,
              }
            ]
          }
        ]
      },
      adminUserId
    );

    assert(Boolean(purchaseResult && purchaseResult.id), `Dealer Purchase Invoice created: ${purchaseResult.id}`);

    // Verify Dealer stock increased to 10.00
    const dealerStockAfter = await pool.query(`
      SELECT physical_stock, available_stock FROM optical_stocks 
      WHERE business_id = $1 AND batch_id = $2
    `, [dealerId1, sampleBatch.batch_id]);
    const dStock = dealerStockAfter.rows[0];
    assert(parseFloat(dStock.physical_stock) === 10.00, `Dealer physical stock increased to 10.00 (was 0.00)`);
    assert(parseFloat(dStock.available_stock) === 10.00, `Dealer available stock increased to 10.00`);

    // Verify Lumina stock remained 100% untouched
    const luminaStockAfter = await pool.query(`
      SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2
    `, [luminaId, luminaBatchRes.rows[0].lumina_batch_id]);
    assert(parseFloat(luminaStockAfter.rows[0].physical_stock) === beforeLuminaStock, `Lumina physical stock remained strictly untouched at ${beforeLuminaStock}`);

    // Verify Stock Ledger isolation
    const dealerStockLedger = await pool.query(`
      SELECT * FROM stock_ledger WHERE business_id = $1 AND batch_id = $2
    `, [dealerId1, sampleBatch.batch_id]);
    assert(dealerStockLedger.rows.length === 1, 'Dealer stock_ledger recorded 1 PURCHASE entry');
    assert(parseFloat(dealerStockLedger.rows[0].quantity_in) === 10.00, 'Dealer stock_ledger quantity_in = 10.00');

    // Verify Supplier Ledger isolation (financial ledger)
    const dealerSupLedger = await pool.query(`
      SELECT * FROM supplier_ledgers WHERE business_id = $1
    `, [dealerId1]);
    assert(dealerSupLedger.rows.length >= 1, 'Dealer supplier_ledger recorded credit entry for purchase');

    const luminaSupLedger = await pool.query(`
      SELECT COUNT(*) as count FROM supplier_ledgers WHERE business_id = $1 AND reference_id = $2
    `, [luminaId, purchaseResult.id]);
    assert(parseInt(luminaSupLedger.rows[0].count, 10) === 0, 'Zero supplier ledger entries created in Lumina');

    // -------------------------------------------------------------------------
    // TEST 9: Atomic Rollback on Failure
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Transaction Rollback Integrity on Simulated Failure ---');
    const suffixFail = Date.now().toString().slice(-6);
    let rollbackThrew = false;
    const client = await pool.connect();
    let tempFailedDealerId: string | null = null;
    try {
      await client.query('BEGIN');
      const insBiz = await client.query(`
        INSERT INTO businesses (code, name, status, business_type, parent_business_id)
        VALUES ($1, $2, 'ACTIVE', 'DEALER', $3)
        RETURNING id
      `, [`DLR-FAIL-${suffixFail}`, `Failed Dealer ${suffixFail}`, luminaId]);
      tempFailedDealerId = insBiz.rows[0].id;

      // Replicate catalog
      await DealerCatalogInitializationService.initializeDealerCatalog(
        client,
        luminaId,
        tempFailedDealerId,
        null
      );

      // Force failure before commit!
      throw new Error('SIMULATED_FAILURE_BEFORE_COMMIT');
    } catch (err: any) {
      if (err.message === 'SIMULATED_FAILURE_BEFORE_COMMIT') {
        rollbackThrew = true;
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    assert(rollbackThrew, 'Simulated failure caught and handled');
    const checkRolledBackBiz = await pool.query('SELECT COUNT(*) FROM businesses WHERE id = $1', [tempFailedDealerId]);
    assert(parseInt(checkRolledBackBiz.rows[0].count, 10) === 0, 'Dealer business rolled back cleanly (0 rows in businesses)');
    const checkRolledBackBatches = await pool.query('SELECT COUNT(*) FROM optical_batches WHERE business_id = $1', [tempFailedDealerId]);
    assert(parseInt(checkRolledBackBatches.rows[0].count, 10) === 0, 'Dealer optical_batches rolled back cleanly (0 rows in optical_batches)');
    const checkRolledBackStocks = await pool.query('SELECT COUNT(*) FROM optical_stocks WHERE business_id = $1', [tempFailedDealerId]);
    assert(parseInt(checkRolledBackStocks.rows[0].count, 10) === 0, 'Dealer optical_stocks rolled back cleanly (0 rows in optical_stocks)');

    // -------------------------------------------------------------------------
    // TEST 10: Lumina Production Baseline Untouched Final Check
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Lumina Production Records Final Untouched Check ---');
    const finalLuminaCountsRes = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM categories WHERE business_id = $1) as categories,
        (SELECT COUNT(*) FROM coatings WHERE business_id = $1) as coatings,
        (SELECT COUNT(*) FROM bases WHERE business_id = $1) as bases,
        (SELECT COUNT(*) FROM base_categories WHERE business_id = $1) as base_categories,
        (SELECT COUNT(*) FROM primary_items WHERE business_id = $1) as primary_items,
        (SELECT COUNT(*) FROM unique_items WHERE business_id = $1) as unique_items,
        (SELECT COUNT(*) FROM optical_batches WHERE business_id = $1) as optical_batches,
        (SELECT COUNT(*) FROM optical_stocks WHERE business_id = $1) as optical_stocks
    `, [luminaId]);
    const finalLumina = finalLuminaCountsRes.rows[0];

    assert(finalLumina.categories === baselineLumina.categories, 'Lumina categories unchanged');
    assert(finalLumina.coatings === baselineLumina.coatings, 'Lumina coatings unchanged');
    assert(finalLumina.bases === baselineLumina.bases, 'Lumina bases unchanged');
    assert(finalLumina.base_categories === baselineLumina.base_categories, 'Lumina base_categories unchanged');
    assert(finalLumina.primary_items === baselineLumina.primary_items, 'Lumina primary_items unchanged');
    assert(finalLumina.unique_items === baselineLumina.unique_items, 'Lumina unique_items unchanged');
    assert(finalLumina.optical_batches === baselineLumina.optical_batches, 'Lumina optical_batches unchanged');
    assert(finalLumina.optical_stocks === baselineLumina.optical_stocks, 'Lumina optical_stocks unchanged');

    console.log('\n========================================================================');
    console.log(`ALL TESTS PASSED: ${passed}/${total} assertions succeeded!`);
    console.log('========================================================================');
  } finally {
    // Spotless cleanup of all test businesses
    console.log('\nCleaning up test businesses...');
    for (const bizId of testDealerIdsToClean) {
      await cleanupBusiness(bizId);
    }
    console.log('Test cleanup complete.');
    await pool.end();
  }
}

runDealerCatalogInitializationTests().catch((err) => {
  console.error('\nFATAL TEST FAILURE:', err);
  process.exit(1);
});
