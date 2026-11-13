/**
 * Invoicing Number Sequence & Draft Discard Verification Test Suite
 *
 * Verifies:
 * 1. Read-only preview: GET /invoices/number-preview does NOT increment sequence counter
 * 2. Unsaved draft: opening/previewing and never saving leaves sequence intact with zero gaps
 * 3. Saved draft discarded/deleted: deleting a draft invoice releases its number and resyncs
 *    sequence so the invoice number is NOT skipped
 * 4. Gapless sequential ordering: creating sequential invoices generates unbroken sequential numbers
 * 5. Strict multi-tenant isolation: Business A's invoice numbers and draft deletions have ZERO effect
 *    on Business B's sequence
 * 6. Cancelled invoice retention: Cancelling a posted invoice marks it CANCELLED but retains its
 *    number in sales_invoices so that it cannot be reused (statutory GST requirement)
 */

import { pool } from '../db/index.js';
import { SalesService } from '../services/salesService.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: any) {
  if (cond) {
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name}`, detail || '');
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('STARTING INVOICING NUMBER SEQUENCE AUDIT TESTS');
  console.log('======================================================\n');

  const testSuffix = Date.now().toString().slice(-6);

  const bizARes = await pool.query(
    `INSERT INTO businesses (name, code, status, state, created_at, updated_at)
     VALUES ($1, $2, 'ACTIVE', 'Maharashtra', NOW(), NOW())
     RETURNING id`,
    [`Seq Audit Biz A ${testSuffix}`, `SA-A-${testSuffix}`]
  );
  const bizAId = bizARes.rows[0].id;

  const bizBRes = await pool.query(
    `INSERT INTO businesses (name, code, status, state, created_at, updated_at)
     VALUES ($1, $2, 'ACTIVE', 'Maharashtra', NOW(), NOW())
     RETURNING id`,
    [`Seq Audit Biz B ${testSuffix}`, `SA-B-${testSuffix}`]
  );
  const bizBId = bizBRes.rows[0].id;

  // Create test user
  const userRes = await pool.query(
    `INSERT INTO users (username, email, password_hash, full_name, status, is_super_admin)
     VALUES ($1, $2, 'hash', 'Test Auditor', 'ACTIVE', true)
     RETURNING id`,
    [`auditor_${testSuffix}`, `auditor_${testSuffix}@example.com`]
  );
  const testUserId = userRes.rows[0].id;

  // Create test customer parties for both businesses
  const partyARes = await pool.query(
    `INSERT INTO parties (business_id, party_code, name, party_type, state, status, created_at, updated_at)
     VALUES ($1, $2, 'Customer Alpha', 'CUSTOMER', 'Maharashtra', 'ACTIVE', NOW(), NOW())
     RETURNING id`,
    [bizAId, `CUST-A-${testSuffix}`]
  );
  const partyAId = partyARes.rows[0].id;

  const partyBRes = await pool.query(
    `INSERT INTO parties (business_id, party_code, name, party_type, state, status, created_at, updated_at)
     VALUES ($1, $2, 'Customer Beta', 'CUSTOMER', 'Maharashtra', 'ACTIVE', NOW(), NOW())
     RETURNING id`,
    [bizBId, `CUST-B-${testSuffix}`]
  );
  const partyBId = partyBRes.rows[0].id;

  // Setup master catalog for Biz A
  const catARes = await pool.query(
    `INSERT INTO categories (business_id, name, code, status)
     VALUES ($1, 'Lenses A', $2, 'ACTIVE') RETURNING id`,
    [bizAId, `CAT_A_${testSuffix}`]
  );
  const catAId = catARes.rows[0].id;

  const baseARes = await pool.query(
    `INSERT INTO bases (business_id, name, code, status)
     VALUES ($1, 'Base A', $2, 'ACTIVE') RETURNING id`,
    [bizAId, `BASE_A_${testSuffix}`]
  );
  const baseAId = baseARes.rows[0].id;

  const piARes = await pool.query(
    `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status)
     VALUES ($1, $2, $3, 'PI A', $4, 'ACTIVE') RETURNING id`,
    [bizAId, catAId, baseAId, `PI_A_${testSuffix}`]
  );
  const piAId = piARes.rows[0].id;

  const uiARes = await pool.query(
    `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, unit, status, maintain_batches)
     VALUES ($1, $2, 'Item A', $3, 100.00, 200.00, 'PRS', 'ACTIVE', true) RETURNING id`,
    [bizAId, piAId, `UI_A_${testSuffix}`]
  );
  const uiAId = uiARes.rows[0].id;

  const bARes = await pool.query(
    `INSERT INTO optical_batches (business_id, unique_item_id, category_id, sph, cyl, axis, "add", side, barcode, identity_key)
     VALUES ($1, $2, $3, 0.00, 0.00, 0, 0, 'NONE', $4, $5) RETURNING id`,
    [bizAId, uiAId, catAId, `BC_A_${testSuffix}`, `IDK_A_${testSuffix}`]
  );
  const batchAId = bARes.rows[0].id;

  await pool.query(
    `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock, updated_at)
     VALUES ($1, $2, 1000.00, 0.00, 1000.00, NOW())`,
    [bizAId, batchAId]
  );

  // Setup master catalog for Biz B
  const catBRes = await pool.query(
    `INSERT INTO categories (business_id, name, code, status)
     VALUES ($1, 'Lenses B', $2, 'ACTIVE') RETURNING id`,
    [bizBId, `CAT_B_${testSuffix}`]
  );
  const catBId = catBRes.rows[0].id;

  const baseBRes = await pool.query(
    `INSERT INTO bases (business_id, name, code, status)
     VALUES ($1, 'Base B', $2, 'ACTIVE') RETURNING id`,
    [bizBId, `BASE_B_${testSuffix}`]
  );
  const baseBId = baseBRes.rows[0].id;

  const piBRes = await pool.query(
    `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status)
     VALUES ($1, $2, $3, 'PI B', $4, 'ACTIVE') RETURNING id`,
    [bizBId, catBId, baseBId, `PI_B_${testSuffix}`]
  );
  const piBId = piBRes.rows[0].id;

  const uiBRes = await pool.query(
    `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, unit, status, maintain_batches)
     VALUES ($1, $2, 'Item B', $3, 100.00, 200.00, 'PRS', 'ACTIVE', true) RETURNING id`,
    [bizBId, piBId, `UI_B_${testSuffix}`]
  );
  const uiBId = uiBRes.rows[0].id;

  const bBRes = await pool.query(
    `INSERT INTO optical_batches (business_id, unique_item_id, category_id, sph, cyl, axis, "add", side, barcode, identity_key)
     VALUES ($1, $2, $3, 0.00, 0.00, 0, 0, 'NONE', $4, $5) RETURNING id`,
    [bizBId, uiBId, catBId, `BC_B_${testSuffix}`, `IDK_B_${testSuffix}`]
  );
  const batchBId = bBRes.rows[0].id;

  await pool.query(
    `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock, updated_at)
     VALUES ($1, $2, 1000.00, 0.00, 1000.00, NOW())`,
    [bizBId, batchBId]
  );

  const testLineA = {
    uniqueItemId: uiAId,
    quantity: 1,
    rate: 150.0,
    batches: [{ batchId: batchAId, quantity: 1 }],
  };

  const testLineB = {
    uniqueItemId: uiBId,
    quantity: 1,
    rate: 150.0,
    batches: [{ batchId: batchBId, quantity: 1 }],
  };

  try {
    // -------------------------------------------------------------
    // TEST 1: Read-only preview does NOT increment sequence
    // -------------------------------------------------------------
    console.log('--- TEST 1: Read-only Preview Stability ---');
    const prev1 = await SalesService.previewInvoiceNumber(bizAId);
    const prev2 = await SalesService.previewInvoiceNumber(bizAId);
    const prev3 = await SalesService.previewInvoiceNumber(bizAId);

    assert(prev1 === prev2 && prev2 === prev3, 'Multiple preview calls return the exact same number', {
      prev1,
      prev2,
      prev3,
    });
    assert(prev1 === 'INV-000001', 'Initial preview is INV-000001', { prev1 });

    const seqCheck1 = await pool.query(
      `SELECT current_number FROM document_sequences WHERE business_id = $1 AND document_type = 'SALES_INVOICE'`,
      [bizAId]
    );
    assert(
      seqCheck1.rows.length === 0 || parseInt(seqCheck1.rows[0].current_number, 10) === 0,
      'Preview did not advance or allocate a sequence counter in the database'
    );

    // -------------------------------------------------------------
    // TEST 2: Discarding unsaved draft leaves sequence intact
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Unsaved Draft Discard Behavior ---');
    // Simulate user opening the voucher form, seeing preview, navigating away (discarding unsaved draft)
    const discardedPreview = await SalesService.previewInvoiceNumber(bizAId);
    assert(discardedPreview === 'INV-000001', 'Preview remains INV-000001 after unsaved discard');

    // Now user actually creates and saves the first invoice
    const inv1 = await SalesService.createSalesInvoice(
      bizAId,
      {
        partyId: partyAId,
        invoiceDate: new Date(),
        invoiceNumber: discardedPreview,
        status: 'POSTED',
        lines: [testLineA],
      },
      testUserId
    );

    assert(
      inv1.invoiceNumber === 'INV-000001',
      'First saved invoice receives INV-000001',
      { actual: inv1.invoiceNumber }
    );

    const nextPrevAfterInv1 = await SalesService.previewInvoiceNumber(bizAId);
    assert(
      nextPrevAfterInv1 === 'INV-000002',
      'After creating INV-000001, preview correctly shows INV-000002',
      { nextPrevAfterInv1 }
    );

    // -------------------------------------------------------------
    // TEST 3: Saved Draft Discard/Delete releases number (no skip)
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Saved Draft Discard / Delete Reclaims Number ---');
    // User saves a draft invoice
    const draftInv = await SalesService.createSalesInvoice(
      bizAId,
      {
        partyId: partyAId,
        invoiceDate: new Date(),
        status: 'DRAFT',
        lines: [testLineA],
      },
      testUserId
    );

    assert(
      draftInv.invoiceNumber === 'INV-000002',
      'Saved draft receives INV-000002',
      { actual: draftInv.invoiceNumber }
    );

    // Check preview while draft exists
    const prevWhileDraftExists = await SalesService.previewInvoiceNumber(bizAId);
    assert(
      prevWhileDraftExists === 'INV-000003',
      'Preview while draft exists shows INV-000003',
      { prevWhileDraftExists }
    );

    // User decides to discard / delete the saved draft
    const deleteRes = await SalesService.deleteSalesInvoice(bizAId, draftInv.id, testUserId);
    assert(deleteRes.success === true, 'Draft invoice deleted successfully');

    // Verify invoice was removed from database
    const checkDeleted = await pool.query(`SELECT id FROM sales_invoices WHERE id = $1`, [draftInv.id]);
    assert(checkDeleted.rows.length === 0, 'Draft invoice row removed from sales_invoices');

    // CRITICAL ASSERTION: The sequence must have resynchronized down!
    // The next preview and the next invoice created MUST be INV-000002, NOT INV-000003!
    const previewAfterDraftDelete = await SalesService.previewInvoiceNumber(bizAId);
    assert(
      previewAfterDraftDelete === 'INV-000002',
      'Preview after draft delete reclaims INV-000002 without skipping',
      { previewAfterDraftDelete }
    );

    // Now create a real invoice after the draft was discarded
    const inv2 = await SalesService.createSalesInvoice(
      bizAId,
      {
        partyId: partyAId,
        invoiceDate: new Date(),
        status: 'POSTED',
        lines: [testLineA],
      },
      testUserId
    );

    assert(
      inv2.invoiceNumber === 'INV-000002',
      'New invoice after discarded draft gets INV-000002 (zero gap!)',
      { actual: inv2.invoiceNumber }
    );

    // -------------------------------------------------------------
    // TEST 4: Consecutive sequential invoices without gaps
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Gapless Sequential Numbering ---');
    const inv3 = await SalesService.createSalesInvoice(
      bizAId,
      { partyId: partyAId, invoiceDate: new Date(), status: 'POSTED', lines: [testLineA] },
      testUserId
    );
    const inv4 = await SalesService.createSalesInvoice(
      bizAId,
      { partyId: partyAId, invoiceDate: new Date(), status: 'POSTED', lines: [testLineA] },
      testUserId
    );
    const inv5 = await SalesService.createSalesInvoice(
      bizAId,
      { partyId: partyAId, invoiceDate: new Date(), status: 'POSTED', lines: [testLineA] },
      testUserId
    );

    assert(inv3.invoiceNumber === 'INV-000003', 'Sequential invoice 3 is INV-000003');
    assert(inv4.invoiceNumber === 'INV-000004', 'Sequential invoice 4 is INV-000004');
    assert(inv5.invoiceNumber === 'INV-000005', 'Sequential invoice 5 is INV-000005');

    // -------------------------------------------------------------
    // TEST 5: Multi-Tenant Sequence Independence
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Multi-Tenant Sequence Independence ---');
    // Business B should start at INV-000001, completely unaffected by Business A's 5 invoices
    const bizBPreview = await SalesService.previewInvoiceNumber(bizBId);
    assert(
      bizBPreview === 'INV-000001',
      'Business B preview starts independently at INV-000001',
      { bizBPreview }
    );

    const bizBInv1 = await SalesService.createSalesInvoice(
      bizBId,
      { partyId: partyBId, invoiceDate: new Date(), status: 'POSTED', lines: [testLineB] },
      testUserId
    );
    assert(
      bizBInv1.invoiceNumber === 'INV-000001',
      'Business B gets INV-000001',
      { actual: bizBInv1.invoiceNumber }
    );

    // Create and delete draft in Business B
    const bizBDraft = await SalesService.createSalesInvoice(
      bizBId,
      { partyId: partyBId, invoiceDate: new Date(), status: 'DRAFT', lines: [testLineB] },
      testUserId
    );
    assert(
      bizBDraft.invoiceNumber === 'INV-000002',
      'Business B draft gets INV-000002'
    );

    // Delete draft in Business B
    await SalesService.deleteSalesInvoice(bizBId, bizBDraft.id, testUserId);

    // Check Business A's sequence was NOT touched by Business B
    const bizAPrevNow = await SalesService.previewInvoiceNumber(bizAId);
    assert(
      bizAPrevNow === 'INV-000006',
      'Business A preview is unaffected by Business B draft operations (still INV-000006)',
      { bizAPrevNow }
    );

    // Check Business B reclaimed INV-000002
    const bizBPrevNow = await SalesService.previewInvoiceNumber(bizBId);
    assert(
      bizBPrevNow === 'INV-000002',
      'Business B preview reclaimed INV-000002 after draft discard',
      { bizBPrevNow }
    );

    // Cross-tenant access protection: Business A cannot delete Business B's invoice
    let crossTenantBlocked = false;
    try {
      await SalesService.deleteSalesInvoice(bizAId, bizBInv1.id, testUserId);
    } catch {
      crossTenantBlocked = true;
    }
    assert(crossTenantBlocked, 'Cross-tenant deletion attempt is strictly rejected');

    // -------------------------------------------------------------
    // TEST 6: Cancelled posted invoice retains number (GST rule)
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Cancelled Invoices Retain Number for GST Audit Trail ---');
    // When a POSTED invoice is cancelled, its number MUST NOT be reused (statutory requirement)
    await SalesService.cancelSalesInvoice(bizAId, inv5.id, 'Customer requested cancellation', testUserId);

    const inv5AfterCancel = await SalesService.getSalesInvoiceById(bizAId, inv5.id);
    assert(inv5AfterCancel.status === 'CANCELLED', 'Invoice 5 status is CANCELLED');

    // The next invoice preview must still be INV-000006 (INV-000005 must NOT be reused)
    const prevAfterCancel = await SalesService.previewInvoiceNumber(bizAId);
    assert(
      prevAfterCancel === 'INV-000006',
      'Cancelled posted invoice retains its number: next preview is INV-000006',
      { prevAfterCancel }
    );

    const inv6 = await SalesService.createSalesInvoice(
      bizAId,
      { partyId: partyAId, invoiceDate: new Date(), status: 'POSTED', lines: [testLineA] },
      testUserId
    );
    assert(
      inv6.invoiceNumber === 'INV-000006',
      'Next invoice is INV-000006 (cancelled INV-000005 was preserved)',
      { actual: inv6.invoiceNumber }
    );

    console.log('\n======================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');
  } finally {
    // Clean up test data
    try {
      await pool.query(`DELETE FROM customer_ledgers WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM stock_ledger WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM sales_invoice_line_batches WHERE sales_invoice_line_id IN (
        SELECT sil.id FROM sales_invoice_lines sil JOIN sales_invoices si ON sil.sales_invoice_id = si.id WHERE si.business_id IN ($1, $2)
      )`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM sales_invoice_lines WHERE sales_invoice_id IN (SELECT id FROM sales_invoices WHERE business_id IN ($1, $2))`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM sales_invoices WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM document_sequences WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM optical_stocks WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM optical_batches WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM unique_items WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM primary_items WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM bases WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM categories WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM parties WHERE business_id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM businesses WHERE id IN ($1, $2)`, [bizAId, bizBId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    } catch (cleanErr) {
      console.warn('Cleanup error:', cleanErr);
    }
  }

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
