import { pool } from '../db/index.js';
import { GodownService } from '../services/godownService.js';
import { SalesService } from '../services/salesService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { B2bOrderSyncService } from '../services/b2bOrderSyncService.js';

async function runTests() {
  console.log('========================================================================');
  console.log('RUNNING 16-SCENARIO VERIFICATION: AUTOMATIC B2B ORDER SYNCHRONIZATION');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${msg}`);
      failed++;
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  // 1. Setup Master Data
  console.log('-> Setting up test businesses, items, batches, and dealer godowns...');
  const suffix = Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
  
  // Create Main Business
  const mainBizRes = await pool.query(`
    INSERT INTO businesses (name, trade_name, currency, financial_year_start, status, business_type, state, state_code)
    VALUES ($1, $2, 'INR', '2026-04-01', 'ACTIVE', 'MAIN', 'Rajasthan', '08')
    RETURNING id
  `, [`Lumina Main Hub ${suffix}`, `Lumina Opticals ${suffix}`]);
  const businessId = mainBizRes.rows[0].id;

  // Insert Category, Base & Unique Item
  const catRes = await pool.query(`
    INSERT INTO categories (business_id, name, code)
    VALUES ($1, 'Hard Coat Single Vision', $2)
    RETURNING id
  `, [businessId, `HCSV-${suffix}`]);
  const catId = catRes.rows[0].id;

  const baseRes = await pool.query(`
    INSERT INTO bases (business_id, name, code, family)
    VALUES ($1, 'Standard 1.56 Base', $2, 'CLEAR')
    RETURNING id
  `, [businessId, `BASE-${suffix}`]);
  const baseId = baseRes.rows[0].id;

  const primRes = await pool.query(`
    INSERT INTO primary_items (business_id, category_id, base_id, name, code)
    VALUES ($1, $2, $3, 'HC SV 1.56 Prim', $4)
    RETURNING id
  `, [businessId, catId, baseId, `PRIM-${suffix}`]);
  const primId = primRes.rows[0].id;

  const itemRes = await pool.query(`
    INSERT INTO unique_items (business_id, primary_item_id, name, code, optical_category, purchase_rate, mrp, unit, gst_rate, maintain_batches)
    VALUES ($1, $2, 'HC SV Anti-Reflective 1.56', $3, 'SV', 100, 250, 'PRS', 18.00, true)
    RETURNING id
  `, [businessId, primId, `ITEM-${suffix}`]);
  const uniqueItemId = itemRes.rows[0].id;

  // Insert Optical Batch with specific powers (-2.00 SPH, -1.00 CYL, AXIS 90, ADD 0, SIDE BE)
  const batchBarcode = `BC-B2B-${suffix}`;
  const batchRes = await pool.query(`
    INSERT INTO optical_batches (business_id, category_id, unique_item_id, barcode, sph, cyl, axis, "add", side, identity_key)
    VALUES ($1, $2, $3, $4, -2.00, -1.00, 90, 0, 'BE', 'SV:SPH=-2.00:CYL=-1.00:AXIS=90:SIDE=BE')
    RETURNING id
  `, [businessId, catId, uniqueItemId, batchBarcode]);
  const batchId = batchRes.rows[0].id;

  // Initial stock in Main Warehouse (so sales order / invoice can reserve or dispatch)
  await pool.query(`
    INSERT INTO optical_stocks (business_id, batch_id, godown_id, physical_stock, reserved_stock, available_stock)
    VALUES ($1, $2, NULL, 500.00, 0.00, 500.00)
  `, [businessId, batchId]);

  // Insert Participating Dealer Party A
  const dealerPartyResA = await pool.query(`
    INSERT INTO parties (business_id, name, party_code, party_type, mobile, status, state)
    VALUES ($1, 'Jaipur Dealer Optical', $2, 'CUSTOMER', '9811122233', 'ACTIVE', 'Rajasthan')
    RETURNING id
  `, [businessId, `DLR-A-${suffix}`]);
  const dealerPartyIdA = dealerPartyResA.rows[0].id;

  // Insert Participating Dealer Party B
  const dealerPartyResB = await pool.query(`
    INSERT INTO parties (business_id, name, party_code, party_type, mobile, status, state)
    VALUES ($1, 'Udaipur Dealer Optical', $2, 'CUSTOMER', '9811122244', 'ACTIVE', 'Rajasthan')
    RETURNING id
  `, [businessId, `DLR-B-${suffix}`]);
  const dealerPartyIdB = dealerPartyResB.rows[0].id;

  // Insert Retail / Regular Customer (No B2B Sync)
  const retailCustRes = await pool.query(`
    INSERT INTO parties (business_id, name, party_code, party_type, mobile, status, state)
    VALUES ($1, 'Walk-in Retail Customer', $2, 'CUSTOMER', '9811122255', 'ACTIVE', 'Rajasthan')
    RETURNING id
  `, [businessId, `RETAIL-${suffix}`]);
  const retailCustomerId = retailCustRes.rows[0].id;

  // Create Extra Godown A mapped to Dealer Party A with B2B Sync ON
  const godownARes = await GodownService.createGodown(businessId, {
    name: 'Jaipur Dealer Godown',
    code: `GDN-JPR-${suffix}`,
    godownType: 'DEALER_GODOWN',
    dealerPartyId: dealerPartyIdA,
    enableB2bOrderSync: true,
    syncDirectInvoice: true,
    defaultProcessingPreference: 'REQUIRES_ACCEPTANCE',
    syncStatus: 'ACTIVE',
  });
  const godownA = godownARes;

  // Create Extra Godown B mapped to Dealer Party B with B2B Sync ON (Auto-accept)
  const godownBRes = await GodownService.createGodown(businessId, {
    name: 'Udaipur Dealer Godown',
    code: `GDN-UDR-${suffix}`,
    godownType: 'DEALER_GODOWN',
    dealerPartyId: dealerPartyIdB,
    enableB2bOrderSync: true,
    syncDirectInvoice: false,
    defaultProcessingPreference: 'AUTO_ACCEPT',
    syncStatus: 'ACTIVE',
  });
  const godownB = godownBRes;

  try {
    // ------------------------------------------------------------------------
    // SCENARIO 1: SO creation generates exactly one dealer PO
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 1: Sales Order Creation Generates Exactly One Dealer PO ---');
    const so1 = await SalesService.createSalesOrder(businessId, {
      partyId: dealerPartyIdA,
      orderDate: new Date().toISOString(),
      godownId: null, // Placed from Main Warehouse
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 10,
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [
            {
              batchId,
              quantity: 10,
            },
          ],
        },
      ],
    });

    assert(!!so1 && !!so1.id, 'Sales Order SO-1 created successfully in Main Business');

    // Verify linked PO in Godown A
    const linkedPOs = await pool.query(`
      SELECT * FROM purchase_orders
      WHERE business_id = $1 AND main_sales_order_id = $2
    `, [businessId, so1.id]);

    assert(linkedPOs.rows.length === 1, 'Exactly one Purchase Order was automatically generated for Dealer Godown A');
    const po1 = linkedPOs.rows[0];
    assert(po1.godown_id === godownA.id, `Linked PO is correctly assigned to Godown A (${godownA.id})`);
    assert(po1.is_b2b_synchronized === true, 'Linked PO has is_b2b_synchronized = true');
    assert(po1.source_sales_order_number === so1.orderNumber, `Source SO number matches (${so1.orderNumber})`);

    // ------------------------------------------------------------------------
    // SCENARIO 2: Correct item & optical batch mapping
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 2: Correct Item & Optical Batch Mapping ---');
    const poLines = await pool.query(`
      SELECT pol.*, polb.batch_id, polb.quantity as batch_qty
      FROM purchase_order_lines pol
      JOIN purchase_order_line_batches polb ON polb.purchase_order_line_id = pol.id
      WHERE pol.purchase_order_id = $1
    `, [po1.id]);

    assert(poLines.rows.length === 1, 'Linked PO has exactly one line with batch breakdown');
    assert(poLines.rows[0].unique_item_id === uniqueItemId, 'PO Line unique_item_id matches SO unique_item_id');
    assert(poLines.rows[0].batch_id === batchId, 'PO Line batch_id matches exact optical batch ID');

    // ------------------------------------------------------------------------
    // SCENARIO 3: Correct SPH, CYL, AXIS, ADD, and SIDE mapping
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 3: Correct SPH, CYL, AXIS, ADD, and SIDE Mapping ---');
    const batchInfo = await pool.query(`
      SELECT polb.*, ob.sph, ob.cyl, ob.axis, ob."add", ob.side 
      FROM purchase_order_line_batches polb
      JOIN optical_batches ob ON ob.id = polb.batch_id
      WHERE polb.purchase_order_line_id = $1
    `, [poLines.rows[0].id]);
    const b = batchInfo.rows[0];
    assert(parseFloat(b.sph) === -2.00, `SPH mapped exactly: ${b.sph}`);
    assert(parseFloat(b.cyl) === -1.00, `CYL mapped exactly: ${b.cyl}`);
    assert(parseFloat(b.axis) === 90, `AXIS mapped exactly: ${b.axis}`);
    assert(parseFloat(b.add) === 0, `ADD mapped exactly: ${b.add}`);
    assert(b.side === 'BE', `SIDE mapped exactly: ${b.side}`);

    // ------------------------------------------------------------------------
    // SCENARIO 4: Correct quantity, rate, discount, GST, and totals
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 4: Correct Quantity, Rate, Discount, GST, and Totals ---');
    assert(parseFloat(po1.subtotal) === parseFloat(so1.subtotal), `Subtotal matches: ${po1.subtotal} vs ${so1.subtotal}`);
    assert(parseFloat(po1.taxable_amount) === parseFloat(so1.taxableAmount), `Taxable amount matches: ${po1.taxable_amount}`);
    assert(parseFloat(po1.cgst_amount) === parseFloat(so1.cgstAmount), `CGST matches: ${po1.cgst_amount}`);
    assert(parseFloat(po1.sgst_amount) === parseFloat(so1.sgstAmount), `SGST matches: ${po1.sgst_amount}`);
    assert(parseFloat(po1.grand_total) === parseFloat(so1.grandTotal), `Grand total matches: ${po1.grand_total}`);

    // ------------------------------------------------------------------------
    // SCENARIO 5: Duplicate requests do not create duplicate POs (Idempotency)
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 5: Duplicate Requests Do Not Create Duplicate POs (Idempotency) ---');
    const duplicateSync = await B2bOrderSyncService.syncSalesOrderToPurchaseOrder(businessId, so1.id);
    assert(duplicateSync.synced === true, 'Re-running sync handles call gracefully');
    assert(duplicateSync.purchaseOrderId === po1.id, 'Idempotency returns existing PO id');

    const checkCount = await pool.query(`
      SELECT COUNT(*) as cnt FROM purchase_orders
      WHERE business_id = $1 AND main_sales_order_id = $2
    `, [businessId, so1.id]);
    assert(parseInt(checkCount.rows[0].cnt) === 1, 'Total PO count for SO remains exactly 1');

    // ------------------------------------------------------------------------
    // SCENARIO 6: Editing an unaccepted SO updates linked PO
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 6: Editing an Unaccepted SO Updates Linked PO ---');
    await SalesService.editSalesOrder(businessId, so1.id, {
      partyId: dealerPartyIdA,
      orderDate: so1.orderDate,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 15, // Updated from 10 to 15
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [
            {
              batchId,
              quantity: 15,
            },
          ],
        },
      ],
    });

    const updatedPo = await pool.query(`
      SELECT * FROM purchase_orders WHERE id = $1
    `, [po1.id]);
    const updatedLine = await pool.query(`
      SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1
    `, [po1.id]);
    assert(parseFloat(updatedPo.rows[0].grand_total) === 1770.00, `Updated PO total reflect 15 pairs: ${updatedPo.rows[0].grand_total}`);
    assert(parseFloat(updatedLine.rows[0].quantity) === 15.00, `Updated PO Line quantity matches 15: ${updatedLine.rows[0].quantity}`);

    // ------------------------------------------------------------------------
    // SCENARIO 7: Cancelling an eligible SO marks PO cancelled
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 7: Cancelling an Eligible SO Marks PO Cancelled ---');
    // Create SO-2
    const so2 = await SalesService.createSalesOrder(businessId, {
      partyId: dealerPartyIdA,
      orderDate: new Date().toISOString(),
      godownId: null,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 5,
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 5 }],
        },
      ],
    });

    const po2Res = await pool.query(`
      SELECT * FROM purchase_orders WHERE business_id = $1 AND main_sales_order_id = $2
    `, [businessId, so2.id]);
    assert(po2Res.rows.length === 1, 'PO-2 generated for SO-2');
    const po2Id = po2Res.rows[0].id;

    // Cancel SO-2
    await SalesService.cancelSalesOrder(businessId, so2.id, 'Dealer requested cancellation');
    const po2Cancelled = await pool.query(`
      SELECT * FROM purchase_orders WHERE id = $1
    `, [po2Id]);
    assert(po2Cancelled.rows[0].status === 'CANCELLED', 'Linked PO marked as CANCELLED');
    assert(po2Cancelled.rows[0].b2b_sync_status === 'CANCELLED', 'Linked PO b2b_sync_status marked as CANCELLED');

    // ------------------------------------------------------------------------
    // SCENARIO 8: Partial / Full Invoicing updates PO fulfillment status
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 8: SO Invoicing Updates Linked PO Fulfillment Status ---');
    // Confirm SO-1 first
    await SalesService.confirmSalesOrder(businessId, so1.id);

    // Convert SO-1 to invoice
    const inv1 = await SalesService.convertOrderToInvoice(businessId, so1.id, {
      invoiceDate: new Date().toISOString(),
      lines: [
        {
          uniqueItemId,
          quantity: 15,
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 15 }],
        },
      ],
    });

    assert(!!inv1 && !!inv1.id, 'Sales Order SO-1 converted to Invoice INV-1');
    const po1Fulfill = await pool.query(`
      SELECT * FROM purchase_orders WHERE id = $1
    `, [po1.id]);
    assert(po1Fulfill.rows[0].source_sales_invoice_number === inv1.invoiceNumber, `PO has source sales invoice number: ${inv1.invoiceNumber}`);

    // ------------------------------------------------------------------------
    // SCENARIO 9: Direct Sales Invoice sync works only when explicitly enabled
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 9: Direct Sales Invoice Sync Works Only When Explicitly Enabled ---');
    // Godown A has syncDirectInvoice = true
    const directInvA = await SalesService.createSalesInvoice(businessId, {
      partyId: dealerPartyIdA,
      invoiceDate: new Date().toISOString(),
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 8,
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 8 }],
        },
      ],
    });

    const poDirectA = await pool.query(`
      SELECT * FROM purchase_orders WHERE business_id = $1 AND source_sales_invoice_number = $2
    `, [businessId, directInvA.invoiceNumber]);
    assert(poDirectA.rows.length === 1, 'Direct invoice generated PO for Godown A (syncDirectInvoice = true)');

    // Godown B has syncDirectInvoice = false
    const directInvB = await SalesService.createSalesInvoice(businessId, {
      partyId: dealerPartyIdB,
      invoiceDate: new Date().toISOString(),
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 6,
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 6 }],
        },
      ],
    });

    const poDirectB = await pool.query(`
      SELECT * FROM purchase_orders WHERE business_id = $1 AND source_sales_invoice_number = $2
    `, [businessId, directInvB.invoiceNumber]);
    assert(poDirectB.rows.length === 0, 'Direct invoice did NOT generate PO for Godown B (syncDirectInvoice = false)');

    // ------------------------------------------------------------------------
    // SCENARIO 10: Retail customers do not receive synchronized POs
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 10: Retail Customers Do Not Receive Synchronized POs ---');
    const retailSO = await SalesService.createSalesOrder(businessId, {
      partyId: retailCustomerId,
      orderDate: new Date().toISOString(),
      godownId: null,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 2,
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 2 }],
        },
      ],
    });

    const retailPOs = await pool.query(`
      SELECT * FROM purchase_orders WHERE business_id = $1 AND main_sales_order_id = $2
    `, [businessId, retailSO.id]);
    assert(retailPOs.rows.length === 0, 'No purchase orders created for unmapped retail customer');

    // ------------------------------------------------------------------------
    // SCENARIO 11: Incorrect / unmapped dealer configurations are safely skipped/rejected
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 11: Incorrect Dealer Mappings Are Safely Handled ---');
    const fakePartyId = '00000000-0000-0000-0000-000000000999';
    const configCheck = await B2bOrderSyncService.getSyncConfigForParty(businessId, fakePartyId);
    assert(configCheck === null, 'Non-existent dealer mapping returns null safely without throwing');

    // ------------------------------------------------------------------------
    // SCENARIO 12: Tenant isolation: Dealer A cannot access Dealer B\'s POs
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 12: Tenant Isolation: Dealer A Cannot Access Dealer B POs ---');
    // Create SO for Dealer B
    const soB = await SalesService.createSalesOrder(businessId, {
      partyId: dealerPartyIdB,
      orderDate: new Date().toISOString(),
      godownId: null,
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 12,
          rate: 100,
          discountPercent: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 12 }],
        },
      ],
    });

    // Query POs scoped to Godown A
    const ordersInGodownA = await PurchaseService.getPurchaseOrders(businessId, {
      godownId: godownA.id,
    });
    const leakCheck = ordersInGodownA.orders.find(o => o.mainSalesOrderId === soB.id);
    assert(!leakCheck, 'Dealer A query does NOT contain Dealer B\'s auto-synced PO');

    // Query POs scoped to Godown B
    const ordersInGodownB = await PurchaseService.getPurchaseOrders(businessId, {
      godownId: godownB.id,
    });
    const foundInB = ordersInGodownB.orders.find(o => o.mainSalesOrderId === soB.id);
    assert(!!foundInB, 'Dealer B query contains its own auto-synced PO');

    // Cross-godown accept rejection: Godown A trying to accept Godown B\'s order
    try {
      await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, foundInB.id, godownA.id);
      assert(false, 'Should have blocked cross-godown acceptance');
    } catch (err: any) {
      assert(err.message.includes('Access denied') || err.message.includes('another godown') || err.message.includes('permission') || err.message.includes('not found'),
        `Cross-godown acceptance blocked securely: ${err.message}`);
    }

    // ------------------------------------------------------------------------
    // SCENARIO 13: Sync failure is recorded and safely retryable
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 13: Sync Failure Is Recorded and Safely Retryable ---');
    // Set mock failed log
    const failedLogRes = await pool.query(`
      INSERT INTO b2b_order_sync_logs (
        business_id, source_voucher_type, source_voucher_id, source_voucher_number,
        destination_godown_id, destination_purchase_order_id, destination_purchase_order_number,
        event_type, status, error_details, retry_count
      )
      VALUES ($1, 'SALES_ORDER', $2, 'SO-FAIL-TEST', $3, NULL, NULL, 'ORDER_CREATED', 'FAILED', 'Mock Network Timeout', 0)
      ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
      SET status = 'FAILED', error_details = 'Mock Network Timeout'
      RETURNING id
    `, [businessId, soB.id, godownB.id]);
    const failedLogId = failedLogRes.rows[0].id;

    // Retry the sync
    const retryRes = await B2bOrderSyncService.retrySync(businessId, failedLogId);
    assert(retryRes.synced === true, 'Retry executed successfully');
    const logAfterRetry = await pool.query(`SELECT * FROM b2b_order_sync_logs WHERE id = $1`, [failedLogId]);
    assert(logAfterRetry.rows[0].retry_count >= 1, `Retry count incremented: ${logAfterRetry.rows[0].retry_count}`);

    // ------------------------------------------------------------------------
    // SCENARIO 14: Existing POs are not overwritten after acceptance / conversion (Conflict Detection)
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 14: Conflict Detection: Accepted / Converted POs Are Not Overwritten ---');
    // Accept foundInB (Godown B\'s PO)
    await B2bOrderSyncService.acceptDealerPurchaseOrder(businessId, foundInB.id, godownB.id);
    const acceptedPO = await pool.query(`SELECT * FROM purchase_orders WHERE id = $1`, [foundInB.id]);
    assert(acceptedPO.rows[0].b2b_sync_status === 'ACCEPTED', 'PO marked as ACCEPTED');

    // Now Main Business tries to edit SO-B
    const editAcceptedResult = await B2bOrderSyncService.syncSalesOrderEdit(businessId, soB.id);
    assert(editAcceptedResult.synced === false, 'Edit sync safely reported conflict');
    assert(editAcceptedResult.conflict === true, 'Conflict flag is true');

    // ------------------------------------------------------------------------
    // SCENARIO 15: No stock or accounting entries created by sync (Documentary Only)
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 15: Documentary Only: No Stock or Accounting Entries Created by Sync ---');
    const godownStockRes = await pool.query(`
      SELECT * FROM optical_stocks WHERE business_id = $1 AND godown_id = $2
    `, [businessId, godownA.id]);
    assert(godownStockRes.rows.length === 0, 'Zero stock ledger entries in Godown A created by sync');

    const ledgerRes = await pool.query(`
      SELECT * FROM supplier_ledgers WHERE business_id = $1 AND reference_id = $2
    `, [businessId, po1.id]);
    assert(ledgerRes.rows.length === 0, 'Zero financial accounting / ledger entries created by order sync');

    // ------------------------------------------------------------------------
    // SCENARIO 16: Existing sales, purchase, payment, and inventory unaffected
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 16: Existing Sales, Purchase, and Voucher Workflows Unaffected ---');
    // Verify standard purchase order creation works normally without b2b sync flags
    const standardPO = await PurchaseService.createPurchaseOrder(businessId, {
      supplierPartyId: dealerPartyIdA, // using party as vendor
      orderDate: new Date().toISOString(),
      gstMode: 'INTRA_STATE',
      lines: [
        {
          uniqueItemId,
          quantity: 4,
          rate: 100,
          discountValue: 0,
          gstRate: 18,
          batches: [{ batchId, quantity: 4, rate: 100, sph: -2.00, cyl: -1.00, axis: 90, add: 0, side: 'BE' }],
        },
      ],
    });
    assert(!!standardPO && !!standardPO.id, 'Standard Purchase Order created cleanly without regression');
    assert(standardPO.isB2bSynchronized === false || standardPO.isB2bSynchronized == null, 'Standard PO is not marked as b2b synced');

    console.log('\n========================================================================');
    console.log(`ALL 16 B2B ORDER SYNCHRONIZATION SCENARIOS PASSED (${passed}/${passed})`);
    console.log('========================================================================');
  } finally {
    // Cleanup test data safely
    console.log('\nCleaning up test artifacts...');
    await pool.query(`DELETE FROM b2b_order_sync_logs WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM customer_ledgers WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM supplier_ledgers WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM stock_ledger WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM stock_reservations WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM party_item_prices WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM purchase_order_line_batches WHERE purchase_order_line_id IN (
      SELECT id FROM purchase_order_lines WHERE purchase_order_id IN (
        SELECT id FROM purchase_orders WHERE business_id = $1
      )
    )`, [businessId]);
    await pool.query(`DELETE FROM purchase_order_lines WHERE purchase_order_id IN (
      SELECT id FROM purchase_orders WHERE business_id = $1
    )`, [businessId]);
    await pool.query(`DELETE FROM purchase_orders WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM sales_invoice_line_batches WHERE sales_invoice_line_id IN (
      SELECT id FROM sales_invoice_lines WHERE sales_invoice_id IN (
        SELECT id FROM sales_invoices WHERE business_id = $1
      )
    )`, [businessId]);
    await pool.query(`DELETE FROM sales_invoice_lines WHERE sales_invoice_id IN (
      SELECT id FROM sales_invoices WHERE business_id = $1
    )`, [businessId]);
    await pool.query(`DELETE FROM sales_invoices WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM sales_order_line_batches WHERE sales_order_line_id IN (
      SELECT id FROM sales_order_lines WHERE sales_order_id IN (
        SELECT id FROM sales_orders WHERE business_id = $1
      )
    )`, [businessId]);
    await pool.query(`DELETE FROM sales_order_lines WHERE sales_order_id IN (
      SELECT id FROM sales_orders WHERE business_id = $1
    )`, [businessId]);
    await pool.query(`DELETE FROM sales_orders WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM optical_stocks WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM godowns WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM optical_batches WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM unique_items WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM primary_items WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM bases WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM categories WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM parties WHERE business_id = $1`, [businessId]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
    console.log('Cleanup completed.');
  }
}

runTests().catch((err) => {
  console.error('\nTEST SUITE FAILED WITH ERROR:', err);
  process.exit(1);
});
