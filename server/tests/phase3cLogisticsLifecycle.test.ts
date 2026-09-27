/**
 * Phase 3C — Physical Movement & Accounting Lifecycle Test Suite
 * (Phase 3C Revision: Purchase Order -> Goods Receipt -> Purchase Invoice Workflow)
 * 
 * Verifies:
 * 1. Dealer Order placement creates Main Sales Order AND linked Dealer Purchase Order.
 * 2. Dealer Purchase Order does NOT increase stock or post accounts payable.
 * 3. Main Sales Invoice reduces Main stock without affecting Dealer stock.
 * 4. Main Warehouse Dispatch creates Shipment linking Sales Order, Invoice, Dealer Order, and Dealer PO.
 * 5. Multi-tenant shipment isolation between dealers.
 * 6. Bounds validation prevents over-receipt.
 * 7. Dealer Goods Receipt Note (GRN) accounts for Good, Damaged, and Short items.
 * 8. Authoritative conversion of Dealer PO to Purchase Invoice via PurchaseService.
 * 9. Dealer stock increases ONLY by Good Received quantity.
 * 10. Stock Ledger and Supplier Ledger record transactions via standard Purchase Invoice mechanism.
 */

import { pool } from '../db/index.js';
import { seedInitialDatabase } from '../db/seed.js';
import { SalesService } from '../services/salesService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { DealerLogisticsService } from '../services/dealerLogisticsService.js';
import { findOrCreateOpticalBatch } from '../services/opticalMasterService.js';

export async function runPhase3cTests() {
  console.log('\n============================================================');
  console.log('STARTING PHASE 3C (REVISED) LOGISTICS & PO LIFECYCLE TESTS');
  console.log('============================================================\n');

  // Ensure DB seeded
  await seedInitialDatabase();

  // 1. Fetch Main Warehouse business & Dealer businesses
  const mainBizRes = await pool.query(
    `SELECT id, name, gstin, state FROM businesses WHERE business_type = 'MAIN' LIMIT 1`
  );
  if (mainBizRes.rows.length === 0) {
    throw new Error('No MAIN business found in database.');
  }
  const mainBiz = mainBizRes.rows[0];

  let dealerBizRes = await pool.query(
    `SELECT id, name, gstin, state FROM businesses WHERE business_type = 'DEALER' ORDER BY name ASC`
  );
  while (dealerBizRes.rows.length < 2) {
    const idx = dealerBizRes.rows.length + 1;
    await pool.query(
      `INSERT INTO businesses (
        name, trade_name, business_type, parent_business_id, status, state
      ) VALUES (
        $1, $2, 'DEALER', $3, 'ACTIVE', $4
      )`,
      [`Test Dealer ${idx}`, `Test Dealer ${idx} Trading`, mainBiz.id, idx === 1 ? 'Maharashtra' : 'Gujarat']
    );
    dealerBizRes = await pool.query(
      `SELECT id, name, gstin, state FROM businesses WHERE business_type = 'DEALER' ORDER BY name ASC`
    );
  }
  const dealerA = dealerBizRes.rows[0];
  const dealerB = dealerBizRes.rows[1];

  console.log(`[Setup] Main: ${mainBiz.name} (${mainBiz.id})`);
  console.log(`[Setup] Dealer A: ${dealerA.name} (${dealerA.id})`);
  console.log(`[Setup] Dealer B: ${dealerB.name} (${dealerB.id})`);

  // 2. Resolve or create Party representing Dealer A in Main Warehouse
  let dealerPartyInMainId: string;
  const partyRes = await pool.query(
    `SELECT id FROM parties WHERE business_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [mainBiz.id, dealerA.name]
  );
  if (partyRes.rows.length > 0) {
    dealerPartyInMainId = partyRes.rows[0].id;
  } else {
    const newP = await pool.query(
      `INSERT INTO parties (business_id, party_code, party_type, name, state, status)
       VALUES ($1, $2, 'CUSTOMER', $3, $4, 'ACTIVE') RETURNING id`,
      [mainBiz.id, `CUST-DLR-${Date.now().toString(36).slice(-4)}`, dealerA.name, dealerA.state || 'Maharashtra']
    );
    dealerPartyInMainId = newP.rows[0].id;
  }

  // 3. Ensure test item and batch with stock in Main Warehouse
  const catRes = await pool.query(
    `SELECT id FROM categories WHERE business_id = $1 AND code = 'SV' LIMIT 1`,
    [mainBiz.id]
  );
  if (catRes.rows.length === 0) {
    throw new Error('No SV category found in Main Warehouse.');
  }
  const mainCategoryId = catRes.rows[0].id;

  const itemRes = await pool.query(
    `SELECT id, code, name FROM unique_items WHERE business_id = $1 AND optical_category = 'SV' LIMIT 1`,
    [mainBiz.id]
  );
  if (itemRes.rows.length === 0) {
    throw new Error('No unique items found in Main Warehouse.');
  }
  const mainItem = itemRes.rows[0];

  const testBatchResult = await findOrCreateOpticalBatch({
    businessId: mainBiz.id,
    uniqueItemId: mainItem.id,
    categoryId: mainCategoryId,
    sph: -1.50,
    cyl: 0.00,
  });
  const mainBatch = testBatchResult.batch;

  // Add 100 units of physical & available stock in Main
  await pool.query(
    `UPDATE optical_stocks 
     SET physical_stock = 100.0, available_stock = 100.0, reserved_stock = 0.0
     WHERE business_id = $1 AND batch_id = $2`,
    [mainBiz.id, mainBatch.id]
  );

  const mainBatchIdentityKey = (mainBatch as any).identityKey || (mainBatch as any).identity_key;

  // Ensure Dealer A and Dealer B start with 0 stock for this identityKey
  await pool.query(
    `UPDATE optical_stocks os
     SET physical_stock = 0.0, available_stock = 0.0, reserved_stock = 0.0
     FROM optical_batches ob
     WHERE os.batch_id = ob.id AND ob.identity_key = $1 AND ob.business_id IN ($2, $3)`,
    [mainBatchIdentityKey, dealerA.id, dealerB.id]
  );

  // 4. TEST 1: Dealer Order & Linked Purchase Order Creation
  console.log(`\n[Test 1] Creating Main Sales Order and Linked Dealer Purchase Order...`);
  const salesOrder = await SalesService.createSalesOrder(mainBiz.id, {
    partyId: dealerPartyInMainId,
    orderDate: new Date(),
    status: 'CONFIRMED',
    lines: [
      {
        uniqueItemId: mainItem.id,
        quantity: 10,
        rate: 250.0,
        batches: [
          {
            batchId: mainBatch.id,
            quantity: 10,
          },
        ],
      },
    ],
  });

  // Replicate item & batch in Dealer A catalog
  const client = await pool.connect();
  let dealerUniqueItemId: string;
  let dealerBatchId: string;
  let mainSupplierPartyId: string;
  try {
    const rep = await DealerLogisticsService.resolveOrReplicateItemAndBatchInDealer(
      client,
      dealerA.id,
      mainItem.id,
      mainBatch.id
    );
    dealerUniqueItemId = rep.dealerUniqueItemId;
    dealerBatchId = rep.dealerBatchId;

    mainSupplierPartyId = await DealerLogisticsService.resolveMainWarehouseSupplierParty(
      client,
      dealerA.id,
      mainBiz.id
    );
  } finally {
    client.release();
  }

  // Insert Dealer Order record
  const dealerOrderRes = await pool.query(
    `INSERT INTO dealer_orders (
       dealer_business_id, main_business_id, main_sales_order_id,
       dealer_party_id_in_main, order_number, status, item_count,
       total_quantity, taxable_amount, grand_total
     ) VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', 1, 10, 2500.0, 2625.0)
     RETURNING id`,
    [dealerA.id, mainBiz.id, salesOrder.id, dealerPartyInMainId, salesOrder.orderNumber]
  );
  const dealerOrderId = dealerOrderRes.rows[0].id;

  // Create Linked Dealer Purchase Order
  const dealerPO = await PurchaseService.createPurchaseOrder(dealerA.id, {
    supplierPartyId: mainSupplierPartyId,
    orderDate: new Date(),
    source: 'DEALER_ORDER',
    dealerOrderId: dealerOrderId,
    mainSalesOrderId: salesOrder.id,
    lines: [
      {
        uniqueItemId: dealerUniqueItemId,
        quantity: 10,
        rate: 250.0,
        batches: [
          {
            batchId: dealerBatchId,
            quantity: 10,
          },
        ],
      },
    ],
  });

  const dealerPOId = (dealerPO as any).order?.id || (dealerPO as any).id;
  const dealerPONumber = (dealerPO as any).order?.orderNumber || (dealerPO as any).orderNumber;

  // Update dealer_orders linkage
  await pool.query(
    `UPDATE dealer_orders SET dealer_purchase_order_id = $1 WHERE id = $2`,
    [dealerPOId, dealerOrderId]
  );

  console.log(`✅ Dealer Order created: ${salesOrder.orderNumber}`);
  console.log(`✅ Linked Dealer PO created: ${dealerPONumber} (${dealerPOId})`);

  // Verify Dealer PO does NOT increase Dealer stock
  const dStockAfterPO = await pool.query(
    `SELECT COALESCE(os.physical_stock, 0) as physical_stock
     FROM optical_batches ob
     JOIN optical_stocks os ON ob.id = os.batch_id
     WHERE ob.business_id = $1 AND ob.identity_key = $2`,
    [dealerA.id, mainBatchIdentityKey]
  );
  const dStockPOVal = dStockAfterPO.rows.length > 0 ? parseFloat(dStockAfterPO.rows[0].physical_stock) : 0;
  if (dStockPOVal !== 0) {
    throw new Error(`VIOLATION: Dealer stock increased upon Purchase Order creation! Value: ${dStockPOVal}`);
  }

  // Verify Dealer PO did NOT create Supplier Ledger payable
  const poLedgerCheck = await pool.query(
    `SELECT * FROM supplier_ledgers WHERE business_id = $1 AND reference_id = $2`,
    [dealerA.id, dealerPOId]
  );
  if (poLedgerCheck.rows.length > 0) {
    throw new Error('VIOLATION: Purchase Order posted to Supplier Ledger!');
  }
  console.log('✅ Mandate Verified: Dealer PO created without increasing stock or posting Accounts Payable.');

  // 5. TEST 2: Main Sales Invoice
  console.log(`\n[Test 2] Posting Main Sales Invoice for 10 pairs...`);
  const salesInvoice = await SalesService.createSalesInvoice(mainBiz.id, {
    partyId: dealerPartyInMainId,
    salesOrderId: salesOrder.id,
    invoiceDate: new Date(),
    status: 'POSTED',
    lines: [
      {
        uniqueItemId: mainItem.id,
        quantity: 10,
        rate: 250.0,
        batches: [
          {
            batchId: mainBatch.id,
            quantity: 10,
          },
        ],
      },
    ],
  });

  // Verify Main stock was deducted (100 -> 90)
  const mainStockAfterInvoice = await pool.query(
    `SELECT physical_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [mainBiz.id, mainBatch.id]
  );
  const mainPhys = parseFloat(mainStockAfterInvoice.rows[0].physical_stock);
  if (mainPhys !== 90.0) {
    throw new Error(`Expected Main physical stock to be 90.0, got ${mainPhys}`);
  }

  // Verify Dealer stock STILL 0
  const dealerAStockCheck1 = await pool.query(
    `SELECT COALESCE(os.physical_stock, 0) as physical_stock
     FROM optical_batches ob
     JOIN optical_stocks os ON ob.id = os.batch_id
     WHERE ob.business_id = $1 AND ob.identity_key = $2`,
    [dealerA.id, mainBatchIdentityKey]
  );
  const dStock1 = dealerAStockCheck1.rows.length > 0 ? parseFloat(dealerAStockCheck1.rows[0].physical_stock) : 0;
  if (dStock1 !== 0) {
    throw new Error(`VIOLATION: Dealer stock increased upon Main Sales Invoice creation! Value: ${dStock1}`);
  }
  console.log('✅ Entity Isolation Verified: Main stock deducted to 90.0; Dealer stock strictly remains 0.0.');

  // 6. TEST 3: Main Warehouse Dispatch / Shipment
  console.log(`\n[Test 3] Creating Main Warehouse Dispatch / Shipment...`);
  const shipmentRes = await DealerLogisticsService.createShipment({
    mainBusinessId: mainBiz.id,
    dealerBusinessId: dealerA.id,
    mainSalesInvoiceId: salesInvoice.id,
    mainSalesOrderId: salesOrder.id,
    dealerOrderId: dealerOrderId,
    dealerPurchaseOrderId: dealerPOId,
    courierName: 'Blue Dart Express',
    trackingNumber: 'TRK-987654321',
    vehicleNumber: 'MH-12-AB-1234',
    totalPackages: 1,
    notes: 'Fragile optical lenses',
  });

  const shipment = shipmentRes.shipment;
  console.log(`✅ Shipment created: ${shipment.shipment_number} (Linked PO: ${shipment.dealer_purchase_order_id})`);

  // Verify Main stock did not decrease AGAIN
  const mainStockAfterDispatch = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [mainBiz.id, mainBatch.id]
  );
  if (parseFloat(mainStockAfterDispatch.rows[0].physical_stock) !== 90.0) {
    throw new Error('VIOLATION: Main stock was deducted a second time during dispatch!');
  }

  // 7. TEST 4: Multi-Tenant Incoming Shipment Isolation
  console.log(`\n[Test 4] Verifying Multi-Tenant Shipment Isolation...`);
  const dealerAShipments = await DealerLogisticsService.listIncomingShipmentsForDealer(dealerA.id);
  const dealerBShipments = await DealerLogisticsService.listIncomingShipmentsForDealer(dealerB.id);

  const foundInA = dealerAShipments.some(s => s.id === shipment.id);
  const foundInB = dealerBShipments.some(s => s.id === shipment.id);

  if (!foundInA) {
    throw new Error('Shipment not visible in recipient Dealer A portal.');
  }
  if (foundInB) {
    throw new Error('SECURITY VIOLATION: Dealer B can see Dealer A shipment!');
  }
  console.log('✅ Isolation Verified: Visible to Dealer A only; inaccessible to Dealer B.');

  // 8. TEST 5: Bounds Validation (Over-Receipt)
  console.log(`\n[Test 5] Testing Over-Receipt Validation...`);
  const shipmentLine = shipment.lines[0];
  let overReceiptFailed = false;
  try {
    await DealerLogisticsService.confirmDealerGoodsReceipt({
      dealerBusinessId: dealerA.id,
      dealerShipmentId: shipment.id,
      lines: [
        {
          shipmentLineId: shipmentLine.id,
          receivedQuantity: 15, // Dispatched was 10!
        },
      ],
    });
  } catch (err: any) {
    overReceiptFailed = true;
    console.log(`✅ Over-receipt successfully blocked: "${err.message}"`);
  }
  if (!overReceiptFailed) {
    throw new Error('Expected over-receipt quantity > dispatched quantity to fail!');
  }

  // 9. TEST 6: Goods Receipt Note & Authoritative PO -> PI Conversion
  console.log(`\n[Test 6] Confirming Dealer Goods Receipt (8 Good, 1 Damaged, 1 Short)...`);
  const grnResult = await DealerLogisticsService.confirmDealerGoodsReceipt({
    dealerBusinessId: dealerA.id,
    dealerShipmentId: shipment.id,
    remarks: 'Box inspected. 1 lens cracked in transit, 1 lens missing in package.',
    lines: [
      {
        shipmentLineId: shipmentLine.id,
        receivedQuantity: 8,
        damagedQuantity: 1,
        shortQuantity: 1,
      },
    ],
  });

  console.log(`✅ Goods Receipt confirmed: ${grnResult.receiptNumber}`);
  console.log(`   Status: ${grnResult.shipmentStatus}`);
  console.log(`   Good Received: ${grnResult.totalGoodReceived}`);
  console.log(`   Damaged: ${grnResult.totalDamaged}`);
  console.log(`   Short: ${grnResult.totalShort}`);
  console.log(`   Created Purchase Invoice ID: ${grnResult.purchaseInvoiceId}`);

  // 10. Verify Dealer PO Status Conversion
  const updatedPORes = await pool.query(
    `SELECT id, order_number, status, converted_invoice_id FROM purchase_orders WHERE id = $1`,
    [dealerPOId]
  );
  const updatedPO = updatedPORes.rows[0];
  console.log(`✅ Dealer PO Status: ${updatedPO.status} (Converted Invoice: ${updatedPO.converted_invoice_id})`);
  if (!['PARTIALLY_CONVERTED', 'CONVERTED'].includes(updatedPO.status)) {
    throw new Error(`Expected PO status to be CONVERTED or PARTIALLY_CONVERTED, got ${updatedPO.status}`);
  }

  // 11. Verify Dealer Inventory Increased by EXACTLY 8.0 (Good Received only!)
  const dealerAStockCheck3 = await pool.query(
    `SELECT os.physical_stock, os.available_stock
     FROM optical_batches ob
     JOIN optical_stocks os ON ob.id = os.batch_id
     WHERE ob.business_id = $1 AND ob.identity_key = $2`,
    [dealerA.id, mainBatchIdentityKey]
  );

  if (dealerAStockCheck3.rows.length === 0) {
    throw new Error('Dealer stock record not found after Goods Receipt!');
  }

  const dStock3 = parseFloat(dealerAStockCheck3.rows[0].physical_stock);
  if (dStock3 !== 8.0) {
    throw new Error(`Expected Dealer physical stock to be exactly 8.0, got ${dStock3}`);
  }
  console.log(`✅ Dealer Stock Verified: Physical stock increased to exactly 8.0 (Good items only).`);

  // 12. Verify Standard Purchase Invoice Posting in Stock Ledger
  const ledgerRes = await pool.query(
    `SELECT * FROM stock_ledger 
     WHERE business_id = $1 AND reference_type = 'PURCHASE_INVOICE' AND reference_id = $2`,
    [dealerA.id, grnResult.purchaseInvoiceId]
  );
  if (ledgerRes.rows.length === 0) {
    throw new Error('Stock ledger entry not found for Purchase Invoice in Dealer business.');
  }
  const ledgerEntry = ledgerRes.rows[0];
  if (parseFloat(ledgerEntry.quantity_in) !== 8.0) {
    throw new Error(`Expected ledger quantity_in 8.0, got ${ledgerEntry.quantity_in}`);
  }
  console.log(`✅ Dealer Stock Ledger Verified: Standard PURCHASE_INVOICE entry recorded (quantity_in = 8.0).`);

  // 13. Verify Dealer Purchase Invoice & Supplier Ledger (Accounts Payable)
  const piRes = await pool.query(
    `SELECT * FROM purchase_invoices WHERE id = $1 AND business_id = $2`,
    [grnResult.purchaseInvoiceId, dealerA.id]
  );
  if (piRes.rows.length === 0) {
    throw new Error('Purchase invoice not found in Dealer business.');
  }
  const pi = piRes.rows[0];
  console.log(`✅ Dealer Purchase Invoice Verified: ${pi.invoice_number} (Grand Total: ${pi.grand_total}, Status: ${pi.status})`);

  // 8 pairs * 250.0 = 2000.0 taxable
  const taxable = parseFloat(pi.taxable_amount);
  if (taxable !== 2000.0) {
    throw new Error(`Expected taxable amount 2000.0, got ${taxable}`);
  }

  const supLedgerRes = await pool.query(
    `SELECT * FROM supplier_ledgers 
     WHERE business_id = $1 AND reference_type = 'PURCHASE_INVOICE' AND reference_id = $2`,
    [dealerA.id, grnResult.purchaseInvoiceId]
  );
  if (supLedgerRes.rows.length === 0) {
    throw new Error('Supplier ledger entry not found in Dealer business for Purchase Invoice.');
  }
  console.log(`✅ Dealer Accounts Payable Verified: Credit of ${supLedgerRes.rows[0].credit} recorded in Supplier Ledger.`);

  console.log('\n============================================================');
  console.log('ALL PHASE 3C REVISED PO-FIRST LIFECYCLE TESTS PASSED! ✅');
  console.log('============================================================\n');

  return { success: true };
}

runPhase3cTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 3C Test Failed:', err);
    process.exit(1);
  });
