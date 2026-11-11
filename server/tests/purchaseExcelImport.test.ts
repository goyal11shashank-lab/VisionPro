import { pool } from '../db/index.js';
import { PurchaseExcelImportService, ExcelImportRowInput } from '../services/purchaseExcelImportService.js';

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

async function runPurchaseExcelImportTests() {
  console.log('========================================================================');
  console.log('RUNNING PURCHASE EXCEL IMPORT & BATCH GROUPING TEST SUITE');
  console.log('========================================================================');

  const suffix = Date.now().toString().slice(-6);
  const bizCode = `BIZ-IMPORT-${suffix}`;

  // 1. Create Test Business
  const bizRes = await pool.query(`
    INSERT INTO businesses (name, code, gstin, state, state_code, currency)
    VALUES ($1, $2, '08AAAAA0000A1Z5', 'Rajasthan', '08', 'INR')
    RETURNING id
  `, [`Import Test Business ${suffix}`, bizCode]);
  const businessId = bizRes.rows[0].id;

  // 2. Setup Category, Base, Primary Item, and 2 Unique Items
  const catRes = await pool.query(`
    INSERT INTO categories (business_id, name, code)
    VALUES ($1, 'Single Vision Lens', $2)
    RETURNING id
  `, [businessId, `SV-${suffix}`]);
  const catId = catRes.rows[0].id;

  const baseRes = await pool.query(`
    INSERT INTO bases (business_id, name, code)
    VALUES ($1, $2, $3)
    RETURNING id
  `, [businessId, `Base ${suffix}`, `BASE-${suffix}`]);
  const baseId = baseRes.rows[0].id;

  const primRes = await pool.query(`
    INSERT INTO primary_items (business_id, category_id, base_id, name, code)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [businessId, catId, baseId, `Primary ${suffix}`, `PRIM-${suffix}`]);
  const primId = primRes.rows[0].id;

  // Stock Item 1: SV 1.56 AR
  const item1Res = await pool.query(`
    INSERT INTO unique_items (business_id, primary_item_id, name, code, optical_category, unit, maintain_batches, purchase_rate, gst_rate)
    VALUES ($1, $2, $3, $4, 'SV', 'PRS', true, 200.00, 12.00)
    RETURNING id
  `, [businessId, primId, `SV 1.56 AR ${suffix}`, `SV156-${suffix}`]);
  const item1Id = item1Res.rows[0].id;
  const item1Name = `SV 1.56 AR ${suffix}`;

  // Stock Item 2: Blue Cut 1.60
  const item2Res = await pool.query(`
    INSERT INTO unique_items (business_id, primary_item_id, name, code, optical_category, unit, maintain_batches, purchase_rate, gst_rate)
    VALUES ($1, $2, $3, $4, 'SV', 'PRS', true, 350.00, 12.00)
    RETURNING id
  `, [businessId, primId, `Blue Cut 1.60 ${suffix}`, `BC160-${suffix}`]);
  const item2Id = item2Res.rows[0].id;
  const item2Name = `Blue Cut 1.60 ${suffix}`;

  // 3. Pre-create Optical Batches in Master for Item 1 and Item 2
  // Batch 1A: Item 1, SPH -1.00, CYL 0.00
  const b1aRes = await pool.query(`
    INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, add, side, identity_key)
    VALUES ($1, $2, $3, $4, -1.00, 0.00, 0.0, 0.00, 'NONE', $5)
    RETURNING id, barcode
  `, [businessId, item1Id, catId, `BAR-1A-${suffix}`, `SV:SPH=-1.00:CYL=0.00:${suffix}`]);
  const batch1A = b1aRes.rows[0];

  // Batch 1B: Item 1, SPH -2.50, CYL -0.50, AXIS 90
  const b1bRes = await pool.query(`
    INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, add, side, identity_key)
    VALUES ($1, $2, $3, $4, -2.50, -0.50, 90.0, 0.00, 'NONE', $5)
    RETURNING id, barcode
  `, [businessId, item1Id, catId, `BAR-1B-${suffix}`, `SV:SPH=-2.50:CYL=-0.50:${suffix}`]);
  const batch1B = b1bRes.rows[0];

  // Batch 2A: Item 2, SPH +1.50, CYL 0.00
  const b2aRes = await pool.query(`
    INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, add, side, identity_key)
    VALUES ($1, $2, $3, $4, 1.50, 0.00, 0.0, 0.00, 'NONE', $5)
    RETURNING id, barcode
  `, [businessId, item2Id, catId, `BAR-2A-${suffix}`, `SV:SPH=1.50:CYL=0.00:${suffix}`]);
  const batch2A = b2aRes.rows[0];

  // Record initial count of optical_batches
  const initialBatchesCountRes = await pool.query(`SELECT COUNT(*)::int as count FROM optical_batches`);
  const initialBatchCount = initialBatchesCountRes.rows[0].count;

  console.log(`\n--- Test Group 1: Grouping Discontinuous Rows Under Stock Items ---`);

  // Discontinuous rows:
  // Row 2: Item 1 (Batch 1A, qty 10)
  // Row 3: Item 2 (Batch 2A, qty 4)
  // Row 4: Item 1 (Batch 1A, qty 5) -> same power as Row 2, should aggregate!
  // Row 5: Item 1 (Batch 1B, qty 7) -> different power for Item 1
  const importRowsValid: ExcelImportRowInput[] = [
    { rowNumber: 2, stockItem: item1Name, sph: '-1.00', cyl: '0.00', axis: '0', addition: '0', side: 'NONE', quantity: 10 },
    { rowNumber: 3, stockItem: item2Name, sph: '+1.50', cyl: '0.00', axis: '0', addition: '0', side: 'NONE', quantity: 4 },
    { rowNumber: 4, stockItem: item1Name, sph: '-1.00', cyl: '0.00', axis: '0', addition: '0', side: 'NONE', quantity: 5 },
    { rowNumber: 5, stockItem: item1Name, sph: '-2.50', cyl: '-0.50', axis: '90', addition: '0', side: 'NONE', quantity: 7 },
  ];

  const result1 = await PurchaseExcelImportService.validateAndGroupImportRows(businessId, importRowsValid);

  assert(result1.success === true, 'Validation succeeds for valid pre-existing batches');
  assert(result1.errors.length === 0, 'No errors returned for valid rows');
  assert(result1.groupedLines.length === 2, 'Exactly 2 stock item lines created (Item 1 and Item 2 consolidated)');

  const lineItem1 = result1.groupedLines.find(l => l.uniqueItemId === item1Id);
  assert(!!lineItem1, 'Item 1 line is present in grouped lines');
  assert(lineItem1!.quantity === 22, `Item 1 total quantity is 22 (10 + 5 + 7), got ${lineItem1?.quantity}`);
  assert(lineItem1!.batches.length === 2, `Item 1 has exactly 2 distinct batches, got ${lineItem1?.batches.length}`);

  const batch1AAlloc = lineItem1!.batches.find(b => b.batchId === batch1A.id);
  assert(!!batch1AAlloc, 'Batch 1A is present in allocations');
  assert(batch1AAlloc!.quantity === 15, `Batch 1A quantity is aggregated to 15 (10 + 5), got ${batch1AAlloc?.quantity}`);
  assert(batch1AAlloc!.barcode === batch1A.barcode, 'Batch 1A barcode is correctly attached');

  const batch1BAlloc = lineItem1!.batches.find(b => b.batchId === batch1B.id);
  assert(!!batch1BAlloc, 'Batch 1B is present in allocations');
  assert(batch1BAlloc!.quantity === 7, `Batch 1B quantity is 7, got ${batch1BAlloc?.quantity}`);

  const lineItem2 = result1.groupedLines.find(l => l.uniqueItemId === item2Id);
  assert(!!lineItem2, 'Item 2 line is present in grouped lines');
  assert(lineItem2!.quantity === 4, `Item 2 quantity is 4, got ${lineItem2?.quantity}`);
  assert(lineItem2!.batches.length === 1, 'Item 2 has 1 batch allocation');
  assert(lineItem2!.batches[0].batchId === batch2A.id, 'Item 2 batchId matches batch2A');

  console.log(`\n--- Test Group 2: STRICT GUARANTEE - ZERO Batch Creation ---`);

  const afterCountRes = await pool.query(`SELECT COUNT(*)::int as count FROM optical_batches`);
  const afterBatchCount = afterCountRes.rows[0].count;
  assert(afterBatchCount === initialBatchCount, `Batch count is strictly unchanged (${initialBatchCount} === ${afterBatchCount}). ZERO batches created.`);

  console.log(`\n--- Test Group 3: Rejection of Missing Batch in Master ---`);

  // Provide a row with power that does NOT exist in master
  const importRowsWithMissing: ExcelImportRowInput[] = [
    { rowNumber: 2, stockItem: item1Name, sph: '-1.00', cyl: '0.00', axis: '0', addition: '0', side: 'NONE', quantity: 6 },
    { rowNumber: 3, stockItem: item1Name, sph: '-9.75', cyl: '-3.25', axis: '45', addition: '0', side: 'NONE', quantity: 12 }, // MISSING!
  ];

  const result2 = await PurchaseExcelImportService.validateAndGroupImportRows(businessId, importRowsWithMissing);

  assert(result2.success === false, 'Validation fails when a batch is missing from master');
  assert(result2.errors.length === 1, `Exactly 1 error returned, got ${result2.errors.length}`);
  assert(result2.errors[0].rowNumber === 3, `Error flags Row 3, got Row ${result2.errors[0].rowNumber}`);
  assert(result2.errors[0].isMissingBatch === true, 'Error flags isMissingBatch = true');
  assert(result2.errors[0].reason.includes('NOT present in master'), `Error reason clearly states batch not present in master: "${result2.errors[0].reason}"`);
  assert(result2.errors[0].reason.includes('cannot be created'), 'Error reason explains that new batches cannot be created during purchase voucher upload');

  // Verify batch count again after missing batch test
  const postMissingCountRes = await pool.query(`SELECT COUNT(*)::int as count FROM optical_batches`);
  assert(postMissingCountRes.rows[0].count === initialBatchCount, 'No batch was created during failed validation');

  console.log(`\n--- Test Group 4: Unknown Stock Item & Invalid Inputs ---`);

  const importRowsInvalid: ExcelImportRowInput[] = [
    { rowNumber: 2, stockItem: 'NON_EXISTENT_LENS_XYZ', sph: '-1.00', cyl: '0.00', axis: '0', addition: '0', side: 'NONE', quantity: 5 },
    { rowNumber: 3, stockItem: item1Name, sph: '-1.00', cyl: '0.00', axis: '0', addition: '0', side: 'NONE', quantity: 0 }, // invalid qty
    { rowNumber: 4, stockItem: item1Name, sph: '-1.00', cyl: '-1.00', axis: '250', addition: '0', side: 'NONE', quantity: 3 }, // invalid axis
  ];

  const result3 = await PurchaseExcelImportService.validateAndGroupImportRows(businessId, importRowsInvalid);

  assert(result3.success === false, 'Validation fails for invalid inputs');
  assert(result3.errors.length === 3, `3 errors returned, got ${result3.errors.length}`);
  assert(result3.errors[0].reason.includes('does not exist in master catalog'), 'Detects non-existent stock item');
  assert(result3.errors[1].reason.includes('greater than 0'), 'Detects invalid non-positive quantity');
  assert(result3.errors[2].reason.includes('between 0° and 180°'), 'Detects invalid axis > 180');

  console.log(`\n--- Test Group 5: Progressive Lens Side & Addition Matching ---`);

  // Setup Progressive Item and Batches
  const progItemRes = await pool.query(`
    INSERT INTO unique_items (business_id, primary_item_id, name, code, optical_category, unit, maintain_batches, purchase_rate, gst_rate)
    VALUES ($1, $2, $3, $4, 'PROG', 'PRS', true, 600.00, 12.00)
    RETURNING id
  `, [businessId, primId, `Prog Digital 1.59 ${suffix}`, `PROG-${suffix}`]);
  const progItemId = progItemRes.rows[0].id;
  const progItemName = `Prog Digital 1.59 ${suffix}`;

  // Batch for Right Eye (R)
  const bProgR = await pool.query(`
    INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, add, side, identity_key)
    VALUES ($1, $2, $3, $4, 1.00, -0.50, 180.0, 2.00, 'R', $5)
    RETURNING id, barcode
  `, [businessId, progItemId, catId, `BAR-PROG-R-${suffix}`, `PROG:SPH=1.00:CYL=-0.50:AXIS=180.0:ADD=2.00:SIDE=R:${suffix}`]);

  // Batch for Left Eye (L)
  const bProgL = await pool.query(`
    INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, add, side, identity_key)
    VALUES ($1, $2, $3, $4, 1.00, -0.50, 180.0, 2.00, 'L', $5)
    RETURNING id, barcode
  `, [businessId, progItemId, catId, `BAR-PROG-L-${suffix}`, `PROG:SPH=1.00:CYL=-0.50:AXIS=180.0:ADD=2.00:SIDE=L:${suffix}`]);

  const progRows: ExcelImportRowInput[] = [
    { rowNumber: 2, stockItem: progItemName, sph: '+1.00', cyl: '-0.50', axis: '180', addition: '+2.00', side: 'RIGHT', quantity: 2 },
    { rowNumber: 3, stockItem: progItemName, sph: '+1.00', cyl: '-0.50', axis: '180', addition: '+2.00', side: 'LEFT', quantity: 3 },
  ];

  const resultProg = await PurchaseExcelImportService.validateAndGroupImportRows(businessId, progRows);

  assert(resultProg.success === true, 'Progressive lens batches match successfully with normalized side names');
  assert(resultProg.groupedLines.length === 1, 'Both R and L are grouped under 1 Progressive stock item');
  assert(resultProg.groupedLines[0].quantity === 5, 'Total quantity is 5 (2 + 3)');
  assert(resultProg.groupedLines[0].batches.length === 2, '2 distinct batches allocated (R and L)');

  // Clean up
  await pool.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);

  console.log(`\n========================================================================`);
  console.log(`ALL TESTS PASSED: ${passed}/${total} assertions succeeded`);
  console.log(`========================================================================\n`);
}

runPurchaseExcelImportTests()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
