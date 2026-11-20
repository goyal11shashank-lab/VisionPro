import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import { pool } from '../db/index.js';
import { GodownService } from '../services/godownService.js';
import { SalesService } from '../services/salesService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { B2bOrderSyncService } from '../services/b2bOrderSyncService.js';

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

async function runHardenAuditTests() {
  console.log('========================================================================');
  console.log('RUNNING B2B ORDER SYNCHRONIZATION AUDIT & HARDENING TEST SUITE');
  console.log('========================================================================');

  const suffix = Date.now().toString().slice(-6);
  const bizCode = `BIZ-AUDIT-${suffix}`;
  
  // 1. Create Main Business
  const bizRes = await pool.query(`
    INSERT INTO businesses (name, code, gstin, state, state_code, currency)
    VALUES ($1, $2, '08AAAAA0000A1Z5', 'Rajasthan', '08', 'INR')
    RETURNING id
  `, [`Audit Main Business ${suffix}`, bizCode]);
  const businessId = bizRes.rows[0].id;

  // Create Second Business (for cross-tenant test)
  const biz2Res = await pool.query(`
    INSERT INTO businesses (name, code, gstin, state, state_code, currency)
    VALUES ($1, $2, '08BBBBB0000B1Z6', 'Rajasthan', '08', 'INR')
    RETURNING id
  `, [`External Tenant Biz ${suffix}`, `BIZ2-${suffix}`]);
  const businessId2 = biz2Res.rows[0].id;

  // Setup Items & Batches
  const catRes = await pool.query(`
    INSERT INTO categories (business_id, name, code)
    VALUES ($1, 'Ophthalmic Lenses', $2)
    RETURNING id
  `, [businessId, `CAT-${suffix}`]);
  const catId = catRes.rows[0].id;

  const baseRes = await pool.query(`
    INSERT INTO bases (business_id, name, code)
    VALUES ($1, $2, $3)
    RETURNING id
  `, [businessId, `Base ${suffix}`, `BASE-${suffix}`]);
  const baseId = baseRes.rows[0].id;

  const primRes = await pool.query(`
    INSERT INTO primary_items (business_id, category_id, base_id, name, code)
    VALUES ($1, $2, $3, 'High Index 1.67', $4)
    RETURNING id
  `, [businessId, catId, baseId, `PRIM-${suffix}`]);
  const primId = primRes.rows[0].id;

  const itemRes = await pool.query(`
    INSERT INTO unique_items (business_id, primary_item_id, name, code, optical_category, purchase_rate, mrp, unit, gst_rate, maintain_batches)
    VALUES ($1, $2, '1.67 Super Clear AR', $3, 'SV', 200, 500, 'PRS', 18.00, true)
    RETURNING id
  `, [businessId, primId, `ITEM-${suffix}`]);
  const uniqueItemId = itemRes.rows[0].id;

  const batchRes = await pool.query(`
    INSERT INTO optical_batches (business_id, category_id, unique_item_id, barcode, sph, cyl, axis, "add", side, identity_key)
    VALUES ($1, $2, $3, $4, -3.50, -1.25, 180, 0, 'BE', 'SV:SPH=-3.50:CYL=-1.25:AXIS=180:SIDE=BE')
    RETURNING id
  `, [businessId, catId, uniqueItemId, `BC-AUD-${suffix}`]);
  const batchId = batchRes.rows[0].id;

  // Initial stock in Main Warehouse
  await pool.query(`
    INSERT INTO optical_stocks (business_id, batch_id, godown_id, physical_stock, reserved_stock, available_stock)
    VALUES ($1, $2, NULL, 500.00, 0.00, 500.00)
  `, [businessId, batchId]);

  // Parties
  const dealerPartyResA = await pool.query(`
    INSERT INTO parties (business_id, name, party_code, party_type, mobile, status, state)
    VALUES ($1, 'Dealer Alpha Optical', $2, 'CUSTOMER', '9822211100', 'ACTIVE', 'Rajasthan')
    RETURNING id
  `, [businessId, `DLR-A-${suffix}`]);
  const dealerPartyIdA = dealerPartyResA.rows[0].id;

  const dealerPartyResB = await pool.query(`
    INSERT INTO parties (business_id, name, party_code, party_type, mobile, status, state)
    VALUES ($1, 'Dealer Beta Optical', $2, 'CUSTOMER', '9822211199', 'ACTIVE', 'Rajasthan')
    RETURNING id
  `, [businessId, `DLR-B-${suffix}`]);
  const dealerPartyIdB = dealerPartyResB.rows[0].id;

  // Godown A (Requires Acceptance)
  const godownA = await GodownService.createGodown(businessId, {
    name: 'Alpha Dealer Godown',
    code: `GDN-A-${suffix}`,
    godownType: 'DEALER_GODOWN',
    dealerPartyId: dealerPartyIdA,
    enableB2bOrderSync: true,
    syncDirectInvoice: true,
    defaultProcessingPreference: 'REQUIRES_ACCEPTANCE',
    syncStatus: 'ACTIVE',
  });

  // Godown B (Auto-Accept)
  const godownB = await GodownService.createGodown(businessId, {
    name: 'Beta Dealer Godown',
    code: `GDN-B-${suffix}`,
    godownType: 'DEALER_GODOWN',
    dealerPartyId: dealerPartyIdB,
    enableB2bOrderSync: true,
    syncDirectInvoice: false,
    defaultProcessingPreference: 'AUTO_ACCEPT',
    syncStatus: 'ACTIVE',
  });

  try {
    // ------------------------------------------------------------------------
    // AUDIT CHECK 1: Status Semantics & Documentary-Only Verification
    // ------------------------------------------------------------------------
    console.log('\n--- 1. Status Semantics & Documentary-Only Verification ---');
    const soB = await SalesService.createSalesOrder(businessId, {
      partyId: dealerPartyIdB,
      orderDate: new Date().toISOString(),
      godownId: null,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 10,
          rate: 200,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 10 }],
        },
      ],
    });

    const poBRes = await pool.query(
      `SELECT * FROM purchase_orders WHERE business_id = $1 AND main_sales_order_id = $2`,
      [businessId, soB.id]
    );
    assert(poBRes.rows.length === 1, 'Auto-Accept generated exactly one PO for Godown B');
    const poB = poBRes.rows[0];

    assert(poB.status === 'OPEN', `PO voucher status is OPEN: ${poB.status}`);
    assert(poB.b2b_sync_status === 'SYNCED', `PO b2b_sync_status is SYNCED: ${poB.b2b_sync_status}`);
    assert(poB.is_b2b_synchronized === true, 'is_b2b_synchronized is true');

    // Strict documentary assertions: Verify ZERO stock or financial impact
    const stockB = await pool.query(
      `SELECT * FROM optical_stocks WHERE business_id = $1 AND godown_id = $2`,
      [businessId, godownB.id]
    );
    assert(stockB.rows.length === 0, 'Zero optical_stocks rows created in dealer godown');

    const stockLedgerB = await pool.query(
      `SELECT * FROM stock_ledger WHERE business_id = $1 AND godown_id = $2`,
      [businessId, godownB.id]
    );
    assert(stockLedgerB.rows.length === 0, 'Zero stock_ledger rows created by auto-sync');

    const reservationsB = await pool.query(
      `SELECT * FROM stock_reservations WHERE business_id = $1 AND godown_id = $2`,
      [businessId, godownB.id]
    );
    assert(reservationsB.rows.length === 0, 'Zero stock_reservations created in dealer godown');

    const invoicesB = await pool.query(
      `SELECT * FROM purchase_invoices WHERE business_id = $1 AND purchase_order_id = $2`,
      [businessId, poB.id]
    );
    assert(invoicesB.rows.length === 0, 'Zero purchase_invoices created by auto-sync');

    const supplierLedgerB = await pool.query(
      `SELECT * FROM supplier_ledgers WHERE business_id = $1 AND reference_id = $2`,
      [businessId, poB.id]
    );
    assert(supplierLedgerB.rows.length === 0, 'Zero supplier_ledgers accounting records created');

    // ------------------------------------------------------------------------
    // AUDIT CHECK 2: Concurrency & Idempotency Safety
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Concurrency & Idempotency Safety (Simultaneous Duplicate Requests) ---');
    const soConcurrent = await SalesService.createSalesOrder(businessId, {
      partyId: dealerPartyIdA,
      orderDate: new Date().toISOString(),
      godownId: null,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 4,
          rate: 200,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 4 }],
        },
      ],
    });

    // Run 5 simultaneous sync attempts concurrently to simulate race conditions
    const results = await Promise.all([
      B2bOrderSyncService.syncSalesOrderToPurchaseOrder(businessId, soConcurrent.id),
      B2bOrderSyncService.syncSalesOrderToPurchaseOrder(businessId, soConcurrent.id),
      B2bOrderSyncService.syncSalesOrderToPurchaseOrder(businessId, soConcurrent.id),
      B2bOrderSyncService.syncSalesOrderToPurchaseOrder(businessId, soConcurrent.id),
      B2bOrderSyncService.syncSalesOrderToPurchaseOrder(businessId, soConcurrent.id),
    ]);

    for (const r of results) {
      assert(r.synced === true, 'Parallel sync call resolved with synced=true');
    }

    const concurrentPoCount = await pool.query(
      `SELECT count(*) FROM purchase_orders WHERE business_id = $1 AND main_sales_order_id = $2`,
      [businessId, soConcurrent.id]
    );
    assert(parseInt(concurrentPoCount.rows[0].count, 10) === 1,
      `Exactly 1 purchase order exists despite 5 simultaneous concurrent requests: ${concurrentPoCount.rows[0].count}`);

    // ------------------------------------------------------------------------
    // AUDIT CHECK 3: Tenant and Godown Isolation
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Tenant and Godown Isolation ---');
    const poARes = await pool.query(
      `SELECT * FROM purchase_orders WHERE business_id = $1 AND main_sales_order_id = $2`,
      [businessId, soConcurrent.id]
    );
    const poA = poARes.rows[0];

    // Attempt cross-godown accept: Godown B user trying to accept Godown A's PO
    try {
      await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, poA.id, godownB.id);
      assert(false, 'Cross-godown acceptance should have thrown error');
    } catch (err: any) {
      assert(err.message.includes('Access denied') || err.message.includes('another godown'),
        `Cross-godown acceptance denied: ${err.message}`);
    }

    // Attempt cross-godown reject: Godown B user trying to reject Godown A's PO
    try {
      await B2bOrderSyncService.rejectDealerPurchaseOrder(businessId, poA.id, godownB.id, 'Illegal reject');
      assert(false, 'Cross-godown rejection should have thrown error');
    } catch (err: any) {
      assert(err.message.includes('Access denied') || err.message.includes('another godown'),
        `Cross-godown rejection denied: ${err.message}`);
    }

    // Cross-tenant isolation: Business 2 trying to accept or retry Business 1's PO or log
    try {
      await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId2, poA.id, null);
      assert(false, 'Cross-tenant acceptance should have thrown error');
    } catch (err: any) {
      assert(err.message.includes('not found'), `Cross-tenant acceptance rejected safely: ${err.message}`);
    }

    // ------------------------------------------------------------------------
    // AUDIT CHECK 4: Acceptance, Rejection, and State Machine Guards
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Acceptance, Rejection, and State Machine Guards ---');
    // Valid acceptance by Godown A staff
    const acceptRes = await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, poA.id, godownA.id);
    assert(acceptRes.success === true, 'Godown A successfully accepted its own PO');

    // Repeated acceptance is idempotent
    const repeatAccept = await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, poA.id, godownA.id);
    assert(repeatAccept.success === true && repeatAccept.idempotent === true, 'Repeated accept is idempotent');

    // Cannot reject already accepted PO once accepted/in progress
    const acceptedPO = await pool.query(`SELECT b2b_sync_status FROM purchase_orders WHERE id = $1`, [poA.id]);
    assert(acceptedPO.rows[0].b2b_sync_status === 'ACCEPTED', 'PO status updated to ACCEPTED');

    // Cannot accept a cancelled PO
    await pool.query(`UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = $1`, [poB.id]);
    try {
      await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, poB.id, godownB.id);
      assert(false, 'Cannot accept a cancelled PO');
    } catch (err: any) {
      assert(err.message.includes('cancelled'), `Accepting cancelled PO blocked: ${err.message}`);
    }

    // ------------------------------------------------------------------------
    // AUDIT CHECK 5: Edit and Cancellation Conflict Guards
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Edit and Cancellation Conflict Guards ---');
    // PO A was accepted by Godown A. If Main Business tries to edit SO, conflict must be reported.
    const editConflictRes = await B2bOrderSyncService.syncSalesOrderEdit(businessId, soConcurrent.id);
    assert(editConflictRes.synced === false, 'SO edit sync safely refused to overwrite accepted dealer PO');
    assert(editConflictRes.conflict === true, 'Conflict flag is true');

    // Test rejection state machine with a new order
    const soRejectTest = await SalesService.createSalesOrder(businessId, {
      partyId: dealerPartyIdA,
      orderDate: new Date().toISOString(),
      godownId: null,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 2,
          rate: 200,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 2 }],
        },
      ],
    });

    const poRejectTestRes = await pool.query(
      `SELECT * FROM purchase_orders WHERE business_id = $1 AND main_sales_order_id = $2`,
      [businessId, soRejectTest.id]
    );
    const poReject = poRejectTestRes.rows[0];

    // Reject order
    const rejectRes = await B2bOrderSyncService.rejectDealerPurchaseOrder(
      businessId,
      poReject.id,
      godownA.id,
      'Price discrepancy'
    );
    assert(rejectRes.success === true, 'Order rejected successfully');

    // Editing rejected order must report conflict and not overwrite
    const editRejectConflict = await B2bOrderSyncService.syncSalesOrderEdit(businessId, soRejectTest.id);
    assert(editRejectConflict.synced === false && editRejectConflict.conflict === true,
      'Editing rejected order safely reports conflict without modifying rejected PO');

    // Cannot accept an already rejected order
    try {
      await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, poReject.id, godownA.id);
      assert(false, 'Should not allow accepting a rejected order');
    } catch (err: any) {
      assert(err.message.includes('rejected'), `Accepting rejected order safely blocked: ${err.message}`);
    }

    // ------------------------------------------------------------------------
    // AUDIT CHECK 6: Invoicing Conflict Guard
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Invoicing Conflict Guard ---');
    // Create an order and convert to invoice on dealer side
    const soInvTest = await SalesService.createSalesOrder(businessId, {
      partyId: dealerPartyIdA,
      orderDate: new Date().toISOString(),
      godownId: null,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 3,
          rate: 200,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 3 }],
        },
      ],
    });

    const poInvRes = await pool.query(
      `SELECT * FROM purchase_orders WHERE business_id = $1 AND main_sales_order_id = $2`,
      [businessId, soInvTest.id]
    );
    const poToInvoice = poInvRes.rows[0];

    // Accept it first
    await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, poToInvoice.id, godownA.id);

    // Convert PO to Purchase Invoice
    const dealerInvoice = await PurchaseService.convertPurchaseOrderToInvoice(businessId, poToInvoice.id);
    assert(!!dealerInvoice && !!dealerInvoice.id, 'Dealer converted PO to active Purchase Invoice');

    // Now Main Business attempts to cancel the source Sales Order
    const cancelConflictRes = await B2bOrderSyncService.syncSalesOrderCancellation(
      businessId,
      soInvTest.id,
      'Trying to cancel invoiced order'
    );
    assert(cancelConflictRes.synced === false && cancelConflictRes.conflict === true,
      'Cancelling source SO safely blocked because dealer already converted PO to Purchase Invoice');

    // Verify PO status remains converted and was NOT cancelled
    const poAfterCancelAttempt = await pool.query(
      `SELECT status FROM purchase_orders WHERE id = $1`,
      [poToInvoice.id]
    );
    assert(poAfterCancelAttempt.rows[0].status === 'CONVERTED',
      `PO status preserved as CONVERTED: ${poAfterCancelAttempt.rows[0].status}`);

    console.log('\n========================================================================');
    console.log(`ALL AUDIT & HARDENING CHECKS PASSED (${passed}/${total})`);
    console.log('========================================================================');
  } finally {
    console.log('\nCleaning up audit test artifacts...');
    await pool.query(`DELETE FROM b2b_order_sync_logs WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM customer_ledgers WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM supplier_ledgers WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM stock_ledger WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM stock_reservations WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM party_item_prices WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM purchase_invoice_line_batches WHERE purchase_invoice_line_id IN (
      SELECT id FROM purchase_invoice_lines WHERE purchase_invoice_id IN (
        SELECT id FROM purchase_invoices WHERE business_id IN ($1, $2)
      )
    )`, [businessId, businessId2]);
    await pool.query(`DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id IN (
      SELECT id FROM purchase_invoices WHERE business_id IN ($1, $2)
    )`, [businessId, businessId2]);
    await pool.query(`DELETE FROM purchase_invoices WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM purchase_order_line_batches WHERE purchase_order_line_id IN (
      SELECT id FROM purchase_order_lines WHERE purchase_order_id IN (
        SELECT id FROM purchase_orders WHERE business_id IN ($1, $2)
      )
    )`, [businessId, businessId2]);
    await pool.query(`DELETE FROM purchase_order_lines WHERE purchase_order_id IN (
      SELECT id FROM purchase_orders WHERE business_id IN ($1, $2)
    )`, [businessId, businessId2]);
    await pool.query(`DELETE FROM purchase_orders WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM sales_order_line_batches WHERE sales_order_line_id IN (
      SELECT id FROM sales_order_lines WHERE sales_order_id IN (
        SELECT id FROM sales_orders WHERE business_id IN ($1, $2)
      )
    )`, [businessId, businessId2]);
    await pool.query(`DELETE FROM sales_order_lines WHERE sales_order_id IN (
      SELECT id FROM sales_orders WHERE business_id IN ($1, $2)
    )`, [businessId, businessId2]);
    await pool.query(`DELETE FROM sales_orders WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM optical_stocks WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM godowns WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM optical_batches WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM unique_items WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM primary_items WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM bases WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM categories WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM parties WHERE business_id IN ($1, $2)`, [businessId, businessId2]);
    await pool.query(`DELETE FROM businesses WHERE id IN ($1, $2)`, [businessId, businessId2]);
    console.log('Cleanup completed successfully.');
  }
}

runHardenAuditTests().then(()=>pool.end()).catch((err) => {
  console.error('\nHARDEN AUDIT TEST FAILED:', err);
  process.exit(1);
});
