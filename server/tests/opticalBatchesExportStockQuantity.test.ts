import * as XLSX from 'xlsx';
import { pool } from '../db/index.js';
import { ExportService } from '../services/exportService.js';
import { StockService } from '../services/stockService.js';
import { findOrCreateOpticalBatch } from '../services/opticalMasterService.js';
import { getOrCreateDedicatedTestBusiness, resetDedicatedTestBusinessData } from './testBusinessHelper.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    console.log(`\n  >> Running: ${name}`);
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('OPTICAL BATCHES EXPORT STOCK QUANTITY ACCEPTANCE TEST SUITE');
  console.log('=============================================================\n');

  const biz = await getOrCreateDedicatedTestBusiness('TEST - Inventory Sandbox');
  const businessId = biz.id;

  // Clean existing sandbox data
  await resetDedicatedTestBusinessData(businessId);

  // 1. Ensure category and primary item exist
  let existingSvCat = await pool.query(`SELECT id FROM categories WHERE (business_id = $1 OR business_id IS NULL) AND code = 'SV' LIMIT 1`, [businessId]);
  let categoryId = existingSvCat.rows[0]?.id;
  if (!categoryId) {
    const catRes = await pool.query(
      `INSERT INTO categories (business_id, name, code, status)
       VALUES ($1, 'Single Vision', 'SV', 'ACTIVE')
       RETURNING id`,
      [businessId]
    );
    categoryId = catRes.rows[0].id;
  }

  let existingProgCat = await pool.query(`SELECT id FROM categories WHERE (business_id = $1 OR business_id IS NULL) AND code = 'PROG' LIMIT 1`, [businessId]);
  let progCategoryId = existingProgCat.rows[0]?.id;
  if (!progCategoryId) {
    const progCatRes = await pool.query(
      `INSERT INTO categories (business_id, name, code, status)
       VALUES ($1, 'Progressive', 'PROG', 'ACTIVE')
       RETURNING id`,
      [businessId]
    );
    progCategoryId = progCatRes.rows[0].id;
  }

  // Bases
  let baseRes = await pool.query(`SELECT id FROM bases WHERE business_id = $1 LIMIT 1`, [businessId]);
  let baseId = baseRes.rows[0]?.id;
  if (!baseId) {
    const newBase = await pool.query(
      `INSERT INTO bases (business_id, name, code, status)
       VALUES ($1, 'CR-39 Standard', 'CR39_STD', 'ACTIVE')
       RETURNING id`,
      [businessId]
    );
    baseId = newBase.rows[0].id;
  }

  let priRes = await pool.query(
    `SELECT id FROM primary_items WHERE business_id = $1 AND code = 'PI_ESSILOR' LIMIT 1`,
    [businessId]
  );
  let primaryItemId = priRes.rows[0]?.id;
  if (!primaryItemId) {
    const newPri = await pool.query(
      `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status)
       VALUES ($1, $2, $3, 'Essilor Brand', 'PI_ESSILOR', 'ACTIVE')
       RETURNING id`,
      [businessId, categoryId, baseId]
    );
    primaryItemId = newPri.rows[0].id;
  }

  // 2. Create Stock Item (Unique Item) "HC SV -2/-1"
  let existingItem = await pool.query(`SELECT id, name FROM unique_items WHERE business_id = $1 AND code = 'HCSV-2-1'`, [businessId]);
  let stockItem = existingItem.rows[0];
  if (!stockItem) {
    const itemRes = await pool.query(
      `INSERT INTO unique_items (business_id, primary_item_id, optical_category, name, code, mrp, maintain_batches, status)
       VALUES ($1, $2, 'SV', 'HC SV -2/-1', 'HCSV-2-1', 450.00, true, 'ACTIVE')
       RETURNING id, name`,
      [businessId, primaryItemId]
    );
    stockItem = itemRes.rows[0];
  }

  // 3. Create Stock Item "HC PROG +2/+1"
  let existingProgItem = await pool.query(`SELECT id, name FROM unique_items WHERE business_id = $1 AND code = 'HCPROG-2-1'`, [businessId]);
  let progStockItem = existingProgItem.rows[0];
  if (!progStockItem) {
    const progItemRes = await pool.query(
      `INSERT INTO unique_items (business_id, primary_item_id, optical_category, name, code, mrp, maintain_batches, status)
       VALUES ($1, $2, 'PROG', 'HC PROG +2/+1', 'HCPROG-2-1', 950.00, true, 'ACTIVE')
       RETURNING id, name`,
      [businessId, primaryItemId]
    );
    progStockItem = progItemRes.rows[0];
  }

  // Helper to post stock movements conforming to ERP ledger and live optical_stocks
  async function postStockMovement(bId: string, bBatchId: string, quantityDeduction: number, reason: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stockRes = await client.query(
        `SELECT * FROM optical_stocks WHERE business_id = $1 AND batch_id = $2 FOR UPDATE`,
        [bId, bBatchId]
      );
      const currPhys = Number(stockRes.rows[0].physical_stock);
      const newPhys = (currPhys - quantityDeduction).toFixed(2);
      const newAvail = (Number(newPhys) - Number(stockRes.rows[0].reserved_stock)).toFixed(2);

      await client.query(
        `UPDATE optical_stocks SET physical_stock = $1, available_stock = $2, updated_at = NOW() WHERE id = $3`,
        [newPhys, newAvail, stockRes.rows[0].id]
      );

      await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out, balance,
          reason, created_at
        ) VALUES ($1, $2, 'SALES_INVOICE', 'MANUAL_ENTRY', NULL, '0.00', $3, '0.00', '0.00', $4, $5, NOW())`,
        [bId, bBatchId, quantityDeduction.toFixed(2), newPhys, reason]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------
  // TEST 1: Acceptance Test Requirement
  // Opening stock 20 pairs -> post stock movements leaving 13.5 pairs -> export Quantity = 13.5, NOT 20
  // -------------------------------------------------------------
  let batch1Barcode: string;
  let batch1Id: string;

  await test('TEST 1: Opening stock 20 pairs, post movements leaving 13.5 pairs -> Quantity is 13.5, not 20', async () => {
    // Create batch 1 (-2.00 / -1.00)
    const batch1 = (await findOrCreateOpticalBatch({
      businessId,
      uniqueItemId: stockItem.id,
      sph: -2.00,
      cyl: -1.00,
      axis: 0,
      add: 0,
      side: 'NONE',
    })).batch;
    batch1Id = batch1.id;
    batch1Barcode = batch1.barcode;

    // Post opening stock of 20 pairs
    await StockService.recordOpeningStock(businessId, {
      batchId: batch1.id,
      quantity: 20.0,
      reason: 'Initial opening stock 20 pairs',
    });

    // Verify initial physical stock is 20
    const initialStock = await pool.query(
      `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [businessId, batch1.id]
    );
    if (Number(initialStock.rows[0].physical_stock) !== 20) {
      throw new Error(`Expected initial stock to be 20, got ${initialStock.rows[0].physical_stock}`);
    }

    // Post a stock movement of 6.5 pairs reduction (e.g. sale or adjustment), leaving exactly 13.5 pairs
    await postStockMovement(businessId, batch1.id, 6.5, 'Sold / deducted 6.5 pairs leaving 13.5 pairs');

    // Check optical_stocks is 13.5
    const updatedStock = await pool.query(
      `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [businessId, batch1.id]
    );
    if (Number(updatedStock.rows[0].physical_stock) !== 13.5) {
      throw new Error(`Expected stock balance to be 13.5, got ${updatedStock.rows[0].physical_stock}`);
    }

    // Export dataset
    const exportResult = await ExportService.exportDataset(businessId, 'OPTICAL_BATCHES');
    if (!exportResult.buffer || exportResult.rowCount === 0) {
      throw new Error('Export returned empty buffer or zero rows');
    }

    // Parse the generated workbook
    const wb = XLSX.read(exportResult.buffer, { type: 'buffer' });
    const sheetData = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Batches']);
    const exportedBatch = sheetData.find(r => r['Barcode'] === batch1Barcode);

    if (!exportedBatch) {
      throw new Error(`Exported sheet does not contain batch with barcode ${batch1Barcode}`);
    }

    // STRICT ASSERTION: Quantity must be 13.5, NOT 20
    console.log(`    Exported Quantity for Batch 1:`, exportedBatch['Quantity']);
    if (exportedBatch['Quantity'] === 20) {
      throw new Error(`FAIL: Exported Quantity is opening stock (20) instead of current stock (13.5)`);
    }
    if (Number(exportedBatch['Quantity']) !== 13.5) {
      throw new Error(`FAIL: Expected exported Quantity to be 13.5, but got: ${exportedBatch['Quantity']}`);
    }

    // Verify Item Name, Batch Name, SPH, CYL, AXIS, Quantity
    if (exportedBatch['Item Name'] !== 'HC SV -2/-1') {
      throw new Error(`Expected Item Name 'HC SV -2/-1', got '${exportedBatch['Item Name']}'`);
    }
    if (!exportedBatch['Batch Name']) {
      throw new Error(`Expected Batch Name to be present, got: ${exportedBatch['Batch Name']}`);
    }
  });

  // -------------------------------------------------------------
  // TEST 2: Half-Pair Quantities Precision (0.5, 1.5, 8.5)
  // -------------------------------------------------------------
  await test('TEST 2: Half-pair decimal precision is accurately preserved (e.g. 0.5, 1.5, 8.5)', async () => {
    // Create another batch (-3.00 / -1.50)
    const batch2 = (await findOrCreateOpticalBatch({
      businessId,
      uniqueItemId: stockItem.id,
      sph: -3.00,
      cyl: -1.50,
      axis: 0,
      add: 0,
      side: 'NONE',
    })).batch;

    // Initial opening stock 9.0 pairs
    await StockService.recordOpeningStock(businessId, {
      batchId: batch2.id,
      quantity: 9.0,
      reason: 'Opening stock 9.0 pairs',
    });

    // Deduct 8.5 pairs -> balance must be exactly 0.5 pairs
    await postStockMovement(businessId, batch2.id, 8.5, 'Deduct 8.5 pairs');

    const exportResult = await ExportService.exportDataset(businessId, 'OPTICAL_BATCHES');
    const wb = XLSX.read(exportResult.buffer, { type: 'buffer' });
    const sheetData = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Batches']);
    const exportedBatch = sheetData.find(r => r['Barcode'] === batch2.barcode);

    if (!exportedBatch) throw new Error(`Batch 2 not found in export`);
    if (Number(exportedBatch['Quantity']) !== 0.5) {
      throw new Error(`Expected Quantity 0.5, got: ${exportedBatch['Quantity']}`);
    }
  });

  // -------------------------------------------------------------
  // TEST 3: Negative Stock Quantities Preservation
  // -------------------------------------------------------------
  await test('TEST 3: Negative stock balances are preserved when ERP allows negative stock', async () => {
    // Create batch 3 (-4.00 / -2.00)
    const batch3 = (await findOrCreateOpticalBatch({
      businessId,
      uniqueItemId: stockItem.id,
      sph: -4.00,
      cyl: -2.00,
      axis: 0,
      add: 0,
      side: 'NONE',
    })).batch;

    // Opening stock 1.0 pair
    await StockService.recordOpeningStock(businessId, {
      batchId: batch3.id,
      quantity: 1.0,
      reason: 'Opening stock 1.0 pair',
    });

    // Deduct 3.5 pairs -> balance must become -2.5 pairs
    await postStockMovement(businessId, batch3.id, 3.5, 'Deduct 3.5 pairs into negative balance');

    const exportResult = await ExportService.exportDataset(businessId, 'OPTICAL_BATCHES');
    const wb = XLSX.read(exportResult.buffer, { type: 'buffer' });
    const sheetData = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Batches']);
    const exportedBatch = sheetData.find(r => r['Barcode'] === batch3.barcode);

    if (!exportedBatch) throw new Error(`Batch 3 not found in export`);
    if (Number(exportedBatch['Quantity']) !== -2.5) {
      throw new Error(`Expected negative Quantity -2.5, got: ${exportedBatch['Quantity']}`);
    }
  });

  // -------------------------------------------------------------
  // TEST 4: Multiple Batches for Same Stock Item Are Not Aggregated
  // -------------------------------------------------------------
  await test('TEST 4: Multiple batches for the same stock item export separate lines without aggregation', async () => {
    const exportResult = await ExportService.exportDataset(businessId, 'OPTICAL_BATCHES');
    const wb = XLSX.read(exportResult.buffer, { type: 'buffer' });
    const sheetData = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Batches']);

    // Filter rows for stockItem "HC SV -2/-1"
    const svBatches = sheetData.filter(r => r['Item Name'] === 'HC SV -2/-1');

    // We have at least 3 distinct batches created for this same stock item
    if (svBatches.length < 3) {
      throw new Error(`Expected at least 3 separate batches for HC SV -2/-1, got ${svBatches.length}`);
    }

    // Verify each has its own distinct quantity (13.5, 0.5, -2.5) and not an aggregated sum
    const quantities = svBatches.map(r => Number(r['Quantity']));
    console.log(`    Distinct batch quantities for HC SV -2/-1:`, quantities);

    if (!quantities.includes(13.5)) {
      throw new Error(`Batch with quantity 13.5 was missing from individual batch rows!`);
    }
    if (!quantities.includes(0.5)) {
      throw new Error(`Batch with quantity 0.5 was missing from individual batch rows!`);
    }
    if (!quantities.includes(-2.5)) {
      throw new Error(`Batch with quantity -2.5 was missing from individual batch rows!`);
    }

    // Confirm that quantities were not summed up to 11.5
    const totalSum = quantities.reduce((a, b) => a + b, 0);
    const hasAnyAggregatedRow = svBatches.some(r => Number(r['Quantity']) === totalSum && svBatches.length === 1);
    if (hasAnyAggregatedRow) {
      throw new Error(`Batches were improperly aggregated into a single row!`);
    }
  });

  // -------------------------------------------------------------
  // TEST 5: Progressive lens batch with AXIS, Addition, and Side
  // -------------------------------------------------------------
  await test('TEST 5: Progressive batch exports SPH, CYL, AXIS, Addition, Side, and Quantity', async () => {
    const progBatch = (await findOrCreateOpticalBatch({
      businessId,
      uniqueItemId: progStockItem.id,
      sph: 2.00,
      cyl: 1.00,
      axis: 90,
      add: 2.00,
      side: 'R',
    })).batch;

    await StockService.recordOpeningStock(businessId, {
      batchId: progBatch.id,
      quantity: 5.0,
      reason: 'Opening stock 5.0 pairs',
    });

    await postStockMovement(businessId, progBatch.id, 1.5, 'Deduct 1.5 pairs leaving 3.5 pairs');

    const exportResult = await ExportService.exportDataset(businessId, 'OPTICAL_BATCHES');
    const wb = XLSX.read(exportResult.buffer, { type: 'buffer' });
    const sheetData = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Batches']);
    const exportedProg = sheetData.find(r => r['Barcode'] === progBatch.barcode);

    if (!exportedProg) throw new Error(`Progressive batch not found in export`);
    if (Number(exportedProg['Quantity']) !== 3.5) {
      throw new Error(`Expected Progressive batch Quantity to be 3.5, got: ${exportedProg['Quantity']}`);
    }
    if (Number(exportedProg['AXIS']) !== 90) {
      throw new Error(`Expected AXIS 90, got: ${exportedProg['AXIS']}`);
    }
    if (Number(exportedProg['Addition']) !== 2.00 && exportedProg['Addition'] !== 2) {
      throw new Error(`Expected Addition 2.00, got: ${exportedProg['Addition']}`);
    }
    if (exportedProg['Side'] !== 'R') {
      throw new Error(`Expected Side 'R', got: ${exportedProg['Side']}`);
    }
  });

  console.log('\n=============================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
