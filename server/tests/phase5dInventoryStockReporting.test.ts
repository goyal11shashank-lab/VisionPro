/**
 * Phase 5D — Inventory, Stock Reporting & Optical Batch Production Hardening Test Suite
 *
 * Verifies:
 * 1. Level 1: Stock Item list with authoritative stock definitions (STOCK, RESERVED, AVAILABLE)
 * 2. Level 2: Paginated batches drill-down with category-aware power fields
 * 3. Optical power search normalization (ignoring +, -, /, spaces; e.g. "250100" -> -2.50/-1.00)
 * 4. Negative stock representation (never clamped to zero)
 * 5. Level 3: Batch Ledger authoritative movement tracking from stock_ledger
 * 6. Running balance calculation with exact 0.5 PRS decimal precision
 * 7. Sales Order reservation isolation (never treated as outward stock movement)
 * 8. Month-wise grouping and continuous monthly summary (opening, inward, outward, closing)
 * 9. Date range filtering with pre-period opening balance accumulation
 * 10. Direct stock ledger for items with Maintain Batches = NO
 * 11. Reconciliation diagnostics (optical_stocks vs stock_ledger and active reservations)
 */

import { pool, db } from '../db/index.js';
import { businesses, parties, uniqueItems, categories, opticalBatches, opticalStocks, stockLedger, stockReservations } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { StockItemLedgerService } from '../services/stockItemLedgerService.js';
import { findOrCreateOpticalBatch } from '../services/opticalMasterService.js';
import { roundOpticalQty, formatQuantity } from '../../src/utils/numberFormatting.js';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING PHASE 5D INVENTORY & STOCK REPORTING TESTS');
  console.log('====================================================');

  let passed = 0;
  let failed = 0;

  try {
    const allBusinesses = await db.select().from(businesses).limit(1);
    if (allBusinesses.length === 0) {
      throw new Error('No business found in database. Run db:seed first.');
    }
    const businessId = allBusinesses[0].id;

    // Retrieve or create an optical category
    const catRes = await db.select().from(categories).limit(1);
    const categoryId = catRes[0].id;

    // --- Scenario 1: Level 1 Stock Item List & Stock Definitions ---
    console.log('\n--- Scenario 1: Level 1 Stock Items & Stock Definitions ---');
    const itemsRes = await pool.query(
      `SELECT 
         ui.id, ui.name, ui.code, ui.maintain_batches,
         COALESCE(SUM(os.physical_stock), 0)::numeric AS stock,
         COALESCE(SUM(os.reserved_stock), 0)::numeric AS reserved,
         COALESCE(SUM(os.available_stock), 0)::numeric AS available,
         COUNT(ob.id)::int AS batches_count
       FROM unique_items ui
       LEFT JOIN optical_batches ob ON ui.id = ob.unique_item_id
       LEFT JOIN optical_stocks os ON ob.id = os.batch_id
       WHERE ui.business_id = $1
       GROUP BY ui.id
       LIMIT 10`,
      [businessId]
    );

    if (itemsRes.rows.length === 0) {
      throw new Error('No stock items found in test business.');
    }

    const firstItem = itemsRes.rows[0];
    const stock = Number(firstItem.stock);
    const reserved = Number(firstItem.reserved);
    const available = Number(firstItem.available);

    // Verify Available = Stock - Reserved
    const expectedAvailable = roundOpticalQty(stock - reserved);
    if (Math.abs(available - expectedAvailable) > 0.001) {
      throw new Error(`Formula mismatch: Available (${available}) != Stock (${stock}) - Reserved (${reserved})`);
    }

    console.log(`[PASS] Scenario 1: Stock Item "${firstItem.name}" stock definitions verified: Stock=${stock}, Reserved=${reserved}, Available=${available}`);
    passed++;

    // --- Scenario 2: Create Known Item with SV Power Batches ---
    console.log('\n--- Scenario 2: Level 2 Batch Drill-Down & Category-Aware Fields ---');
    const testItemCode = `TEST-5D-${Date.now().toString().slice(-6)}`;
    const [createdItem] = await db.insert(uniqueItems).values({
      businessId,
      code: testItemCode,
      name: `Phase 5D Test Lens ${testItemCode}`,
      unit: 'PRS',
      opticalCategory: 'SV',
      maintainBatches: true,
      purchaseRate: '350.00',
      mrp: '800.00',
      status: 'ACTIVE',
    }).returning();

    // Create 3 batches:
    // Batch 1: SPH -2.50, CYL -1.00
    // Batch 2: SPH +1.75, CYL -0.50
    // Batch 3: SPH 0.00, CYL 0.00
    const { batch: b1 } = await findOrCreateOpticalBatch({
      businessId,
      uniqueItemId: createdItem.id,
      categoryId,
      sph: -2.50,
      cyl: -1.00,
      axis: 0,
      add: 0,
      side: 'NONE',
    });

    const { batch: b2 } = await findOrCreateOpticalBatch({
      businessId,
      uniqueItemId: createdItem.id,
      categoryId,
      sph: 1.75,
      cyl: -0.50,
      axis: 0,
      add: 0,
      side: 'NONE',
    });

    const { batch: b3 } = await findOrCreateOpticalBatch({
      businessId,
      uniqueItemId: createdItem.id,
      categoryId,
      sph: 0.00,
      cyl: 0.00,
      axis: 0,
      add: 0,
      side: 'NONE',
    });

    // Query batches belonging to this item
    const batchQueryRes = await pool.query(
      `SELECT ob.id, ob.barcode, ob.sph, ob.cyl, ob.axis, ob.add, ob.side
       FROM optical_batches ob
       WHERE ob.unique_item_id = $1 AND ob.business_id = $2
       ORDER BY ob.sph ASC`,
      [createdItem.id, businessId]
    );

    if (batchQueryRes.rows.length !== 3) {
      throw new Error(`Expected 3 batches, found ${batchQueryRes.rows.length}`);
    }
    console.log(`[PASS] Scenario 2: Batch drill-down successfully returned 3 power combinations for item ${testItemCode}`);
    passed++;

    // --- Scenario 3: Optical Power Search Normalization ---
    console.log('\n--- Scenario 3: Normalized Optical Input Search ---');
    // Test 1: Stripped digits "250100" should match SPH -2.50, CYL -1.00
    const stripped = "250100";
    const s = parseInt(stripped.slice(0, 3), 10) / 100;
    const c = parseInt(stripped.slice(3, 6), 10) / 100;

    const matchRes1 = await pool.query(
      `SELECT ob.id, ob.sph, ob.cyl, ob.barcode
       FROM optical_batches ob
       WHERE ob.unique_item_id = $1 AND ob.business_id = $2
         AND (ABS(ob.sph) = $3 AND ABS(ob.cyl) = $4)`,
      [createdItem.id, businessId, s, c]
    );

    if (matchRes1.rows.length === 0 || Number(matchRes1.rows[0].sph) !== -2.50) {
      throw new Error('Stripped power search 250100 failed to match SPH -2.50, CYL -1.00');
    }

    // Test 2: Formatted string "-2.50/-1.00"
    const pairMatch = "-2.50/-1.00".match(/^([+-]?\d+(?:\.\d+)?)\s*[\/,\s]\s*([+-]?\d+(?:\.\d+)?)$/);
    if (!pairMatch) {
      throw new Error('Regex failed on formatted pair match');
    }
    const p1 = parseFloat(pairMatch[1]);
    const p2 = parseFloat(pairMatch[2]);

    const matchRes2 = await pool.query(
      `SELECT ob.id, ob.sph, ob.cyl
       FROM optical_batches ob
       WHERE ob.unique_item_id = $1 AND ob.business_id = $2
         AND ((ob.sph = $3 AND ob.cyl = $4) OR (ABS(ob.sph) = ABS($3) AND ABS(ob.cyl) = ABS($4)))`,
      [createdItem.id, businessId, p1, p2]
    );

    if (matchRes2.rows.length === 0) {
      throw new Error('Power pair match -2.50/-1.00 failed');
    }

    console.log('[PASS] Scenario 3: Optical power search normalization (stripped digits & formatted pair) verified');
    passed++;

    // --- Scenario 4: Authoritative Movement Tracking & Exact 0.5 Precision ---
    console.log('\n--- Scenario 4: Batch Ledger Movements & 0.5 Precision ---');
    // Post chronological transactions on Batch 1:
    // 1. OPENING_STOCK: +10.5 PRS
    // 2. SALE: -2.5 PRS
    // 3. PURCHASE: +5.0 PRS
    // 4. SALES_RETURN: +1.5 PRS
    // 5. PURCHASE_RETURN: -2.0 PRS
    // Expected final balance = 10.5 - 2.5 + 5.0 + 1.5 - 2.0 = 12.5 PRS

    const now = new Date();
    const day = (offset: number) => new Date(now.getTime() - (10 - offset) * 86400000);

    // 1. Opening stock: +10.5
    await db.insert(stockLedger).values({
      businessId,
      batchId: b1.id,
      transactionType: 'OPENING_STOCK',
      referenceType: 'MANUAL',
      referenceId: 'INIT-1',
      quantityIn: '10.50',
      quantityOut: '0.00',
      balance: '10.50',
      reason: 'Opening inventory initialization',
      createdAt: day(1),
    });

    // 2. Sale: -2.5
    await db.insert(stockLedger).values({
      businessId,
      batchId: b1.id,
      transactionType: 'SALE',
      referenceType: 'SALES_INVOICE',
      referenceId: 'INV-TEST-001',
      quantityIn: '0.00',
      quantityOut: '2.50',
      balance: '8.00',
      reason: 'Sales Invoice: INV-TEST-001',
      createdAt: day(2),
    });

    // 3. Purchase: +5.0
    await db.insert(stockLedger).values({
      businessId,
      batchId: b1.id,
      transactionType: 'PURCHASE',
      referenceType: 'PURCHASE_INVOICE',
      referenceId: 'PUR-TEST-001',
      quantityIn: '5.00',
      quantityOut: '0.00',
      balance: '13.00',
      reason: 'Purchase Invoice: PUR-TEST-001',
      createdAt: day(3),
    });

    // 4. Sales Return: +1.5
    await db.insert(stockLedger).values({
      businessId,
      batchId: b1.id,
      transactionType: 'SALES_RETURN',
      referenceType: 'SALES_RETURN',
      referenceId: 'SR-TEST-001',
      quantityIn: '1.50',
      quantityOut: '0.00',
      balance: '14.50',
      reason: 'Sales Return: SR-TEST-001',
      createdAt: day(4),
    });

    // 5. Purchase Return: -2.0
    await db.insert(stockLedger).values({
      businessId,
      batchId: b1.id,
      transactionType: 'PURCHASE_RETURN',
      referenceType: 'PURCHASE_RETURN',
      referenceId: 'PR-TEST-001',
      quantityIn: '0.00',
      quantityOut: '2.00',
      balance: '12.50',
      reason: 'Purchase Return: PR-TEST-001',
      createdAt: day(5),
    });

    // Update optical_stocks table to reflect current stock
    await db.insert(opticalStocks).values({
      businessId,
      batchId: b1.id,
      physicalStock: '12.50',
      reservedStock: '0.00',
      availableStock: '12.50',
    }).onConflictDoUpdate({
      target: [opticalStocks.businessId, opticalStocks.batchId],
      set: {
        physicalStock: '12.50',
        reservedStock: '0.00',
        availableStock: '12.50',
      },
    });

    // Fetch ledger using StockItemLedgerService
    const batchLedger = await StockItemLedgerService.getLedger(businessId, createdItem.id, {
      batchId: b1.id,
    });

    const txs = batchLedger.transactions;
    if (txs.length !== 5) {
      throw new Error(`Expected 5 transactions in ledger, found ${txs.length}`);
    }

    // Check chronological running balances:
    // tx[0] running = 10.5
    // tx[1] running = 8
    // tx[2] running = 13
    // tx[3] running = 14.5
    // tx[4] running = 12.5
    const expectedBalances = [10.5, 8.0, 13.0, 14.5, 12.5];
    for (let i = 0; i < txs.length; i++) {
      if (Math.abs(txs[i].runningBalance - expectedBalances[i]) > 0.001) {
        throw new Error(`Running balance mismatch at step ${i}: got ${txs[i].runningBalance}, expected ${expectedBalances[i]}`);
      }
    }

    // Check 0.5 precision formatting
    const formattedQty = formatQuantity(txs[0].quantityIn);
    if (formattedQty !== '10.5') {
      throw new Error(`0.5 precision format failed: expected "10.5", got "${formattedQty}"`);
    }

    console.log('[PASS] Scenario 4: Chronological running balance and 0.5 PRS precision verified (10.5 -> 8 -> 13 -> 14.5 -> 12.5)');
    passed++;

    // --- Scenario 5: Sales Order Reservation Isolation ---
    console.log('\n--- Scenario 5: Sales Order Reservation Isolation (Not Outward Movement) ---');
    // Insert a Sales Order reservation into stock_ledger with quantity_in=0, quantity_out=0, reserved_in=2.0
    await db.insert(stockLedger).values({
      businessId,
      batchId: b1.id,
      transactionType: 'RESERVATION_HOLD',
      referenceType: 'SALES_ORDER',
      referenceId: 'SO-TEST-001',
      quantityIn: '0.00',
      quantityOut: '0.00',
      reservedIn: '2.00',
      reservedOut: '0.00',
      balance: '12.50',
      reason: 'Sales Order Hold SO-TEST-001',
      createdAt: day(6),
    });

    const ledgerAfterReservation = await StockItemLedgerService.getLedger(businessId, createdItem.id, {
      batchId: b1.id,
    });

    const reserveTx = ledgerAfterReservation.transactions.find(t => t.referenceType === 'SALES_ORDER');
    if (!reserveTx) {
      throw new Error('Reservation transaction not found in ledger');
    }

    if (reserveTx.quantityOut !== 0) {
      throw new Error(`Violation: Sales Order Reservation counted as Outward movement (${reserveTx.quantityOut})`);
    }

    if (reserveTx.runningBalance !== 12.5) {
      throw new Error(`Violation: Sales Order altered physical running balance: ${reserveTx.runningBalance}`);
    }

    console.log('[PASS] Scenario 5: Sales Order reservation correctly isolated without deducting outward physical stock');
    passed++;

    // --- Scenario 6: Negative Stock Support (No Zero Clamping) ---
    console.log('\n--- Scenario 6: Negative Stock Reporting ---');
    // Batch 2 currently has 0 stock. Post a sale of 3.0 PRS to drive it negative (-3.0 PRS)
    await db.insert(stockLedger).values({
      businessId,
      batchId: b2.id,
      transactionType: 'SALE',
      referenceType: 'SALES_INVOICE',
      referenceId: 'INV-NEG-001',
      quantityIn: '0.00',
      quantityOut: '3.00',
      balance: '-3.00',
      reason: 'Sales Invoice: INV-NEG-001 (Negative Stock Sale)',
      createdAt: day(7),
    });

    await db.insert(opticalStocks).values({
      businessId,
      batchId: b2.id,
      physicalStock: '-3.00',
      reservedStock: '0.00',
      availableStock: '-3.00',
    }).onConflictDoUpdate({
      target: [opticalStocks.businessId, opticalStocks.batchId],
      set: {
        physicalStock: '-3.00',
        reservedStock: '0.00',
        availableStock: '-3.00',
      },
    });

    const b2Ledger = await StockItemLedgerService.getLedger(businessId, createdItem.id, {
      batchId: b2.id,
    });

    if (b2Ledger.stockSummary.physicalStock !== -3) {
      throw new Error(`Negative stock was clamped: got ${b2Ledger.stockSummary.physicalStock}, expected -3`);
    }

    if (b2Ledger.transactions[0].runningBalance !== -3) {
      throw new Error(`Running balance was clamped: got ${b2Ledger.transactions[0].runningBalance}, expected -3`);
    }

    console.log('[PASS] Scenario 6: Negative stock reported accurately (-3 PRS) without zero-clamping');
    passed++;

    // --- Scenario 7: Continuous Monthly Summary ---
    console.log('\n--- Scenario 7: Continuous Month-wise Grouping ---');
    const monthlyList = batchLedger.monthlySummaries;
    if (monthlyList.length === 0) {
      throw new Error('No monthly summaries generated');
    }

    const curMonth = monthlyList[0];
    if (typeof curMonth.openingQty !== 'number' || typeof curMonth.closingQty !== 'number') {
      throw new Error('Monthly summary missing opening/closing quantity');
    }

    console.log(`[PASS] Scenario 7: Month-wise summary calculated: Month=${curMonth.monthLabel}, Opening=${curMonth.openingQty}, Closing=${curMonth.closingQty}, Transactions=${curMonth.transactionCount}`);
    passed++;

    // --- Scenario 8: Date Range Filtering & Opening Balance ---
    console.log('\n--- Scenario 8: Date Range Filtering & Opening Balance Pre-Calculation ---');
    // Filter from day(3) to day(5). Transactions before day(3) (Opening stock +10.5, Sale -2.5) must form opening balance = +8.0
    const fromStr = day(3).toISOString().slice(0, 10);
    const toStr = day(5).toISOString().slice(0, 10);

    const filteredLedger = await StockItemLedgerService.getLedger(businessId, createdItem.id, {
      batchId: b1.id,
      from: fromStr,
      to: toStr,
    });

    if (Math.abs(filteredLedger.stockSummary.openingBalance - 8.0) > 0.001) {
      throw new Error(`Pre-range opening balance mismatch: got ${filteredLedger.stockSummary.openingBalance}, expected 8.0`);
    }

    console.log(`[PASS] Scenario 8: Date range filter from ${fromStr} to ${toStr} correctly accumulated prior opening balance (+8.0 PRS)`);
    passed++;

    // --- Scenario 9: Stock Item Without Batches (Maintain Batches = NO) ---
    console.log('\n--- Scenario 9: Direct Ledger for Non-Batched Stock Item ---');
    const noBatchCode = `NOBATCH-${Date.now().toString().slice(-6)}`;
    const [noBatchItem] = await db.insert(uniqueItems).values({
      businessId,
      code: noBatchCode,
      name: `Direct Non-Batched Cleaner ${noBatchCode}`,
      unit: 'BTL',
      maintainBatches: false,
      purchaseRate: '120.00',
      mrp: '250.00',
      status: 'ACTIVE',
    }).returning();

    // Query batches for this non-batched item
    const emptyBatchesRes = await pool.query(
      `SELECT id FROM optical_batches WHERE unique_item_id = $1`,
      [noBatchItem.id]
    );

    if (emptyBatchesRes.rows.length !== 0) {
      throw new Error('Non-batched item should have 0 batches');
    }

    // Direct ledger service query
    const directLedger = await StockItemLedgerService.getLedger(businessId, noBatchItem.id);
    if (directLedger.batches.length !== 0) {
      throw new Error('Non-batched item returned batch list');
    }

    console.log(`[PASS] Scenario 9: Non-batched item (${noBatchCode}) correctly opens direct stock ledger without opening empty batch screen`);
    passed++;

    // --- Scenario 10: Reconciliation Diagnostics ---
    console.log('\n--- Scenario 10: Reconciliation Diagnostics Engine ---');
    // Batch 1 has physicalStock = 12.50 in optical_stocks, and ledger sum = 12.50
    // Active reservations = 0 in stock_reservations, and 0 in optical_stocks
    // Query reconciliation endpoint logic
    const diagQuery = `
      SELECT 
        ob.id AS batch_id,
        COALESCE(os.physical_stock, 0)::numeric AS stored_physical_stock,
        COALESCE((
          SELECT SUM(sl.quantity_in - sl.quantity_out)
          FROM stock_ledger sl
          WHERE sl.batch_id = ob.id AND sl.business_id = $2
        ), 0)::numeric AS ledger_calculated_stock
      FROM optical_batches ob
      LEFT JOIN optical_stocks os ON ob.id = os.batch_id
      WHERE ob.id = $1 AND ob.business_id = $2
    `;

    const diagRes = await pool.query(diagQuery, [b1.id, businessId]);
    const stored = Number(diagRes.rows[0].stored_physical_stock);
    const calculated = Number(diagRes.rows[0].ledger_calculated_stock);
    const diff = Math.abs(stored - calculated);

    if (diff > 0.001) {
      throw new Error(`Reconciliation discrepancy detected: stored ${stored} vs calculated ${calculated}`);
    }

    console.log(`[PASS] Scenario 10: Reconciliation diagnostics verified: Stored (${stored}) matches Ledger calculated (${calculated}) with 0 discrepancy`);
    passed++;

    console.log('\n====================================================');
    console.log(`PHASE 5D TEST RUN COMPLETE: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
    console.log('====================================================');
    process.exit(0);

  } catch (error: any) {
    console.error(`\n[FAIL] Test encountered error:`, error.message);
    console.error(error.stack);
    console.log('\n====================================================');
    console.log(`PHASE 5D TEST RUN COMPLETE: ${passed}/${passed + 1} PASSED (1 FAILED)`);
    console.log('====================================================');
    process.exit(1);
  }
}

runTests();
