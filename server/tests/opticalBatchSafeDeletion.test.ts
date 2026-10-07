import { pool } from '../db/index.js';
import { generateAuthToken } from '../auth/jwt.js';

async function runTest() {
  console.log('=== Starting Optical Batch Safe Deletion Test ===');

  // 1. Get or create test business & user
  const bizRes = await pool.query(`
    SELECT id, name FROM businesses WHERE status = 'ACTIVE' LIMIT 1
  `);
  if (bizRes.rows.length === 0) {
    throw new Error('No active business found');
  }
  const testBiz = bizRes.rows[0];

  const userRes = await pool.query(`
    SELECT id, email, username FROM users WHERE status = 'ACTIVE' LIMIT 1
  `);
  const testUser = userRes.rows[0];
  await pool.query(`UPDATE users SET is_super_admin = true WHERE id = $1`, [testUser.id]);

  const authToken = generateAuthToken({
    userId: testUser.id,
    username: testUser.username || 'admin',
    email: testUser.email,
    businessId: testBiz.id,
    isSuperAdmin: true,
  });

  // 2. Create a test Stock Item (Unique Item)
  const itemCode = `TEST-ITEM-${Date.now()}`;
  const itemRes = await pool.query(`
    INSERT INTO unique_items (business_id, name, code, optical_category, maintain_batches, created_by)
    VALUES ($1, 'Test Progressive Lens Safe Delete', $2, 'PROG', true, $3)
    RETURNING id, name, code
  `, [testBiz.id, itemCode, testUser.id]);
  const testItem = itemRes.rows[0];

  // 2.5 Get or create Category
  const catRes = await pool.query(`SELECT id FROM categories LIMIT 1`);
  const catId = catRes.rows[0].id;

  // 3. Create a test Optical Batch with 100 pairs opening stock
  const batchBarcode = `TEST-BAR-${Date.now()}`;
  const identityKey = `${testItem.id}:3.00:0.00:0:2.00:BE`;
  const batchRes = await pool.query(`
    INSERT INTO optical_batches (business_id, unique_item_id, category_id, identity_key, barcode, sph, cyl, axis, "add", side, status, created_by)
    VALUES ($1, $2, $3, $4, $5, '3.00', '0.00', 0, '2.00', 'BE', 'ACTIVE', $6)
    RETURNING id, barcode, sph, cyl
  `, [testBiz.id, testItem.id, catId, identityKey, batchBarcode, testUser.id]);
  const testBatch = batchRes.rows[0];

  // Insert optical_stocks row with 100 physical stock
  await pool.query(`
    INSERT INTO optical_stocks (business_id, batch_id, physical_stock, available_stock, reserved_stock)
    VALUES ($1, $2, 100.00, 100.00, 0.00)
  `, [testBiz.id, testBatch.id]);

  // Insert stock_ledger row with 100 OPENING_STOCK
  await pool.query(`
    INSERT INTO stock_ledger (
      business_id, batch_id, transaction_type, reference_type, reference_id,
      quantity_in, quantity_out, reserved_in, reserved_out, balance, reason, created_by
    ) VALUES ($1, $2, 'OPENING_STOCK', 'MANUAL_ENTRY', NULL, 100.00, 0.00, 0.00, 0.00, 100.00, 'Initial opening stock 100 pairs', $3)
  `, [testBiz.id, testBatch.id, testUser.id]);

  console.log(`Created test batch ${testBatch.id} with 100 pairs opening stock under item ${testItem.name}`);

  // 4. Test dependency check API
  const { default: express } = await import('express');
  const { default: opticalMasterRouter } = await import('../routes/opticalMaster.js');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    // Inject auth
    req.user = {
      id: testUser.id,
      email: testUser.email,
      currentBusinessId: testBiz.id,
      role: 'SUPER_ADMIN',
      permissions: ['*'],
    } as any;
    next();
  });
  app.use('/api/optical-master', opticalMasterRouter);

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Step A: Check dependencies
    const depRes = await fetch(`${baseUrl}/api/optical-master/batches/${testBatch.id}/dependencies`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const depJson = await depRes.json();
    console.log('Dependencies response:', depJson);
    if (!depJson.success || !depJson.data.canDelete) {
      throw new Error(`Expected canDelete=true for opening-stock only batch, got: ${JSON.stringify(depJson)}`);
    }
    if (depJson.data.stockInfo.openingQuantity !== 100) {
      throw new Error(`Expected openingQuantity=100, got: ${depJson.data.stockInfo.openingQuantity}`);
    }
    console.log('✓ Rule A verified: Opening stock is NOT a deletion blocker!');

    // Step B: Delete the batch
    const delRes = await fetch(`${baseUrl}/api/optical-master/batches/${testBatch.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const delJson = await delRes.json();
    console.log('Delete response:', delJson);
    if (!delJson.success || !delJson.canDelete) {
      throw new Error(`Failed to delete batch: ${JSON.stringify(delJson)}`);
    }
    console.log('✓ Batch deletion succeeded!');

    // Step C: Verify database state after deletion
    const checkBatch = await pool.query(`SELECT id FROM optical_batches WHERE id = $1`, [testBatch.id]);
    if (checkBatch.rows.length !== 0) {
      throw new Error('Batch still exists in optical_batches!');
    }

    const checkStock = await pool.query(`SELECT id FROM optical_stocks WHERE batch_id = $1`, [testBatch.id]);
    if (checkStock.rows.length !== 0) {
      throw new Error('Stock still exists in optical_stocks!');
    }

    const checkLedger = await pool.query(`SELECT id FROM stock_ledger WHERE batch_id = $1`, [testBatch.id]);
    if (checkLedger.rows.length !== 0) {
      throw new Error('Ledger records still exist in stock_ledger!');
    }

    // Verify NO stock adjustments were created
    const checkAdj = await pool.query(`
      SELECT id FROM stock_ledger 
      WHERE business_id = $1 AND transaction_type = 'STOCK_ADJUSTMENT' AND created_at > NOW() - INTERVAL '1 minute'
    `, [testBiz.id]);
    if (checkAdj.rows.length !== 0) {
      throw new Error(`Unexpected stock adjustments created! Count: ${checkAdj.rows.length}`);
    }
    console.log('✓ Zero stock adjustments created during batch deletion!');

    // Step D: Test retry safety (idempotent / clear 404 response)
    const retryRes = await fetch(`${baseUrl}/api/optical-master/batches/${testBatch.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (retryRes.status !== 404) {
      throw new Error(`Expected 404 on already deleted batch retry, got: ${retryRes.status}`);
    }
    console.log('✓ Retry safety verified: returns 404 cleanly without creating adjustments!');

    // Step E: Test Rule B - Batch in Sales Invoice MUST block deletion
    const batchBRes = await pool.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, identity_key, barcode, sph, cyl, axis, "add", side, status, created_by)
      VALUES ($1, $2, $3, $4, $5, '2.00', '0.00', 0, '2.00', 'BE', 'ACTIVE', $6)
      RETURNING id, barcode
    `, [testBiz.id, testItem.id, catId, `${testItem.id}:2.00:0.00:0:2.00:BE`, `TEST-BAR-B-${Date.now()}`, testUser.id]);
    const testBatchB = batchBRes.rows[0];

    // Create party and sales invoice
    const partyRes = await pool.query(`
      INSERT INTO parties (business_id, party_type, name, party_code, mobile, created_by)
      VALUES ($1, 'CUSTOMER', 'Test Deletion Customer', $2, '9876543210', $3)
      RETURNING id
    `, [testBiz.id, `CUST-${Date.now()}`, testUser.id]);
    const testParty = partyRes.rows[0];

    const siRes = await pool.query(`
      INSERT INTO sales_invoices (business_id, invoice_number, party_id, status, created_by)
      VALUES ($1, $2, $3, 'POSTED', $4)
      RETURNING id
    `, [testBiz.id, `INV-${Date.now()}`, testParty.id, testUser.id]);
    const testSI = siRes.rows[0];

    const silRes = await pool.query(`
      INSERT INTO sales_invoice_lines (sales_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 5.00, 100.00, 500.00, 500.00)
      RETURNING id
    `, [testSI.id, testItem.id]);
    const testSIL = silRes.rows[0];

    await pool.query(`
      INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
      VALUES ($1, $2, 5.00)
    `, [testSIL.id, testBatchB.id]);

    const delBRes = await fetch(`${baseUrl}/api/optical-master/batches/${testBatchB.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const delBJson = await delBRes.json();
    console.log('Delete Rule B (Sales Invoice) response:', delBJson);
    if (delBRes.status !== 400 || delBJson.canDelete !== false || !delBJson.error.includes('Sales Invoice')) {
      throw new Error(`Expected Rule B blocking with Sales Invoice message, got: ${JSON.stringify(delBJson)}`);
    }
    console.log('✓ Rule B verified: Batch in Sales Invoice is blocked from deletion with clear explanation!');

    // Step F: Test Rule C - Batch in Purchase Invoice MUST block deletion
    const batchCRes = await pool.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, identity_key, barcode, sph, cyl, axis, "add", side, status, created_by)
      VALUES ($1, $2, $3, $4, $5, '1.50', '0.00', 0, '2.00', 'BE', 'ACTIVE', $6)
      RETURNING id, barcode
    `, [testBiz.id, testItem.id, catId, `${testItem.id}:1.50:0.00:0:2.00:BE`, `TEST-BAR-C-${Date.now()}`, testUser.id]);
    const testBatchC = batchCRes.rows[0];

    const suppRes = await pool.query(`
      INSERT INTO parties (business_id, party_type, name, party_code, mobile, created_by)
      VALUES ($1, 'SUPPLIER', 'Test Deletion Supplier', $2, '9876543211', $3)
      RETURNING id
    `, [testBiz.id, `SUPP-${Date.now()}`, testUser.id]);
    const testSupp = suppRes.rows[0];

    const piRes = await pool.query(`
      INSERT INTO purchase_invoices (
        business_id, invoice_number, supplier_party_id, status, invoice_date,
        subtotal, discount_total, taxable_amount, igst_rate, igst_amount,
        cgst_rate, cgst_amount, sgst_rate, sgst_amount, round_off, grand_total, payment_status, gst_mode, created_by
      ) VALUES (
        $1, $2, $3, 'POSTED', NOW(),
        800.00, 0.00, 800.00, 0.00, 0.00,
        0.00, 0.00, 0.00, 0.00, 0.00, 800.00, 'UNPAID', 'INTRA_STATE', $4
      ) RETURNING id
    `, [testBiz.id, `BILL-${Date.now()}`, testSupp.id, testUser.id]);
    const testPI = piRes.rows[0];

    const pilRes = await pool.query(`
      INSERT INTO purchase_invoice_lines (purchase_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 10.00, 80.00, 800.00, 800.00)
      RETURNING id
    `, [testPI.id, testItem.id]);
    const testPIL = pilRes.rows[0];

    await pool.query(`
      INSERT INTO purchase_invoice_line_batches (purchase_invoice_line_id, batch_id, quantity, rate, total_cost)
      VALUES ($1, $2, 10.00, 80.00, 800.00)
    `, [testPIL.id, testBatchC.id]);

    const delCRes = await fetch(`${baseUrl}/api/optical-master/batches/${testBatchC.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const delCJson = await delCRes.json();
    console.log('Delete Rule C (Purchase Invoice) response:', delCJson);
    if (delCRes.status !== 400 || delCJson.canDelete !== false || !delCJson.error.includes('Purchase Invoice')) {
      throw new Error(`Expected Rule C blocking with Purchase Invoice message, got: ${JSON.stringify(delCJson)}`);
    }
    console.log('✓ Rule C verified: Batch in Purchase Invoice is blocked from deletion with clear explanation!');

    // Clean up Rule C test records
    await pool.query(`DELETE FROM purchase_invoice_line_batches WHERE batch_id = $1`, [testBatchC.id]);
    await pool.query(`DELETE FROM purchase_invoice_lines WHERE id = $1`, [testPIL.id]);
    await pool.query(`DELETE FROM purchase_invoices WHERE id = $1`, [testPI.id]);
    await pool.query(`DELETE FROM parties WHERE id = $1`, [testSupp.id]);
    await pool.query(`DELETE FROM optical_batches WHERE id = $1`, [testBatchC.id]);

    // Clean up Rule B test records
    await pool.query(`DELETE FROM sales_invoice_line_batches WHERE batch_id = $1`, [testBatchB.id]);
    await pool.query(`DELETE FROM sales_invoice_lines WHERE id = $1`, [testSIL.id]);
    await pool.query(`DELETE FROM sales_invoices WHERE id = $1`, [testSI.id]);
    await pool.query(`DELETE FROM parties WHERE id = $1`, [testParty.id]);
    await pool.query(`DELETE FROM optical_batches WHERE id = $1`, [testBatchB.id]);

    console.log('=== All Optical Batch Deletion Tests PASSED ===');
  } finally {
    server.close();
    // Safe cascade cleanup for test item
    await pool.query(`DELETE FROM sales_invoice_line_batches WHERE batch_id IN (SELECT id FROM optical_batches WHERE unique_item_id = $1)`, [testItem.id]);
    await pool.query(`DELETE FROM sales_invoice_lines WHERE unique_item_id = $1`, [testItem.id]);
    await pool.query(`DELETE FROM purchase_invoice_line_batches WHERE batch_id IN (SELECT id FROM optical_batches WHERE unique_item_id = $1)`, [testItem.id]);
    await pool.query(`DELETE FROM purchase_invoice_lines WHERE unique_item_id = $1`, [testItem.id]);
    await pool.query(`DELETE FROM stock_ledger WHERE batch_id IN (SELECT id FROM optical_batches WHERE unique_item_id = $1)`, [testItem.id]);
    await pool.query(`DELETE FROM optical_stocks WHERE batch_id IN (SELECT id FROM optical_batches WHERE unique_item_id = $1)`, [testItem.id]);
    await pool.query(`DELETE FROM optical_batches WHERE unique_item_id = $1`, [testItem.id]);
    await pool.query(`DELETE FROM unique_items WHERE id = $1`, [testItem.id]);
  }

  process.exit(0);
}

runTest().catch(err => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
