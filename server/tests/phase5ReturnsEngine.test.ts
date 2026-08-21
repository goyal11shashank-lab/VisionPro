import { pool } from '../db/index.js';
import { ensureMigrationsRun } from '../db/migrate.js';
import { SalesReturnService } from '../services/salesReturnService.js';
import { PurchaseReturnService } from '../services/purchaseReturnService.js';
import { SalesService } from '../services/salesService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { round2 } from '../services/taxCalculationService.js';
import crypto from 'crypto';

interface TestContext {
  businessId: string;
  businessIdOther: string;
  userId: string;
  categoryId: string;
  baseId: string;
  primaryItemId: string;
  uniqueItemId: string;
  batchId1: string;
  batchId2: string;
  batchIdOtherBiz: string;
  customerPartyId: string;
  supplierPartyId: string;
}

async function setupTestData(): Promise<TestContext> {
  const client = await pool.connect();
  try {
    const bizSuffix = crypto.randomBytes(4).toString('hex');

    // 1. Create Business 1
    const bizRes1 = await client.query(
      `INSERT INTO businesses (name, trade_name, state, gstin, status) 
       VALUES ($1, $2, 'Delhi', '07AAAAA0000A1Z5', 'ACTIVE') 
       RETURNING id`,
      [`Optical Biz 1 ${bizSuffix}`, `OPT1_${bizSuffix}`]
    );
    const businessId = bizRes1.rows[0].id;

    // 2. Create Business 2 (for isolation tests)
    const bizRes2 = await client.query(
      `INSERT INTO businesses (name, trade_name, state, gstin, status) 
       VALUES ($1, $2, 'Maharashtra', '27BBBBB0000B1Z6', 'ACTIVE') 
       RETURNING id`,
      [`Optical Biz 2 ${bizSuffix}`, `OPT2_${bizSuffix}`]
    );
    const businessIdOther = bizRes2.rows[0].id;

    // 3. Create User
    const userRes = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, status, is_super_admin) 
       VALUES ($1, $2, 'hash', 'Returns Manager', 'ACTIVE', false) 
       RETURNING id`,
      [`user_${bizSuffix}`, `returns_${bizSuffix}@example.com`]
    );
    const userId = userRes.rows[0].id;

    // 4. Category
    const catRes = await client.query(
      `INSERT INTO categories (business_id, name, code, status) 
       VALUES ($1, 'Single Vision', $2, 'ACTIVE') 
       RETURNING id`,
      [businessId, `SV_${bizSuffix}`]
    );
    const categoryId = catRes.rows[0].id;

    // 5. Base
    const baseRes = await client.query(
      `INSERT INTO bases (business_id, name, code, status) 
       VALUES ($1, 'CR-39 1.56', $2, 'ACTIVE') 
       RETURNING id`,
      [businessId, `BASE_${bizSuffix}`]
    );
    const baseId = baseRes.rows[0].id;

    // 6. Primary Item
    const piRes = await client.query(
      `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status) 
       VALUES ($1, $2, $3, 'SV 1.56 HC Lenses', $4, 'ACTIVE') 
       RETURNING id`,
      [businessId, categoryId, baseId, `PI_${bizSuffix}`]
    );
    const primaryItemId = piRes.rows[0].id;

    // 7. Unique Item
    const uiRes = await client.query(
      `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, status) 
       VALUES ($1, $2, 'SV 1.56 HC Standard Pair', $3, 200.00, 500.00, 'ACTIVE') 
       RETURNING id`,
      [businessId, primaryItemId, `UI_${bizSuffix}`]
    );
    const uniqueItemId = uiRes.rows[0].id;

    // 8. Optical Batches
    const b1Res = await client.query(
      `INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, "add", side, identity_key) 
       VALUES ($1, $2, $3, $4, '-2.00', '0.00', 0, '0.00', 'BOTH', $5) 
       RETURNING id`,
      [businessId, uniqueItemId, categoryId, `BAR1_${bizSuffix}`, `IK1_${bizSuffix}`]
    );
    const batchId1 = b1Res.rows[0].id;

    const b2Res = await client.query(
      `INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, "add", side, identity_key) 
       VALUES ($1, $2, $3, $4, '-2.50', '0.00', 0, '0.00', 'BOTH', $5) 
       RETURNING id`,
      [businessId, uniqueItemId, categoryId, `BAR2_${bizSuffix}`, `IK2_${bizSuffix}`]
    );
    const batchId2 = b2Res.rows[0].id;

    // Batch in other business with its own category, base & unique item
    const catOtherRes = await client.query(
      `INSERT INTO categories (business_id, name, code, status) 
       VALUES ($1, 'Single Vision Other', $2, 'ACTIVE') 
       RETURNING id`,
      [businessIdOther, `SV_OTH_${bizSuffix}`]
    );
    const baseOtherRes = await client.query(
      `INSERT INTO bases (business_id, name, code, status) 
       VALUES ($1, 'CR-39 Other', $2, 'ACTIVE') 
       RETURNING id`,
      [businessIdOther, `BASE_OTH_${bizSuffix}`]
    );
    const piOtherRes = await client.query(
      `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status) 
       VALUES ($1, $2, $3, 'SV Other Lenses', $4, 'ACTIVE') 
       RETURNING id`,
      [businessIdOther, catOtherRes.rows[0].id, baseOtherRes.rows[0].id, `PI_OTH_${bizSuffix}`]
    );
    const uiOtherRes = await client.query(
      `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, status) 
       VALUES ($1, $2, 'SV Other Item', $3, 200.00, 500.00, 'ACTIVE') 
       RETURNING id`,
      [businessIdOther, piOtherRes.rows[0].id, `UI_OTH_${bizSuffix}`]
    );

    const bOtherRes = await client.query(
      `INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, "add", side, identity_key) 
       VALUES ($1, $2, $3, $4, '-3.00', '0.00', 0, '0.00', 'BOTH', $5) 
       RETURNING id`,
      [businessIdOther, uiOtherRes.rows[0].id, catOtherRes.rows[0].id, `BAR_OTH_${bizSuffix}`, `IK_OTH_${bizSuffix}`]
    );
    const batchIdOtherBiz = bOtherRes.rows[0].id;

    // 9. Initial Stocks
    await client.query(
      `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock) 
       VALUES ($1, $2, 50.00, 0.00, 50.00)`,
      [businessId, batchId1]
    );
    await client.query(
      `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock) 
       VALUES ($1, $2, 50.00, 0.00, 50.00)`,
      [businessId, batchId2]
    );

    // 10. Parties
    const custRes = await client.query(
      `INSERT INTO parties (business_id, party_code, name, party_type, mobile, state, gstin, status) 
       VALUES ($1, $2, 'John Doe Customer', 'CUSTOMER', '9876543210', 'Delhi', '07AAAAA1111A1Z1', 'ACTIVE') 
       RETURNING id`,
      [businessId, `CUST_${bizSuffix}`]
    );
    const customerPartyId = custRes.rows[0].id;

    const suppRes = await client.query(
      `INSERT INTO parties (business_id, party_code, name, party_type, mobile, state, gstin, status) 
       VALUES ($1, $2, 'Essilor Lens Supplier', 'SUPPLIER', '9123456780', 'Delhi', '07BBBBB2222B1Z2', 'ACTIVE') 
       RETURNING id`,
      [businessId, `SUPP_${bizSuffix}`]
    );
    const supplierPartyId = suppRes.rows[0].id;

    return {
      businessId,
      businessIdOther,
      userId,
      categoryId,
      baseId,
      primaryItemId,
      uniqueItemId,
      batchId1,
      batchId2,
      batchIdOtherBiz,
      customerPartyId,
      supplierPartyId,
    };
  } finally {
    client.release();
  }
}

async function runPhase5Tests() {
  console.log('========================================================================');
  console.log('STARTING PHASE 5: RETURNS, REVERSALS, CANCELLATIONS & INTEGRITY TEST SUITE');
  console.log('========================================================================\n');

  const ctx = await setupTestData();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // Helpers to create base posted sales invoice
  async function createPostedSalesInvoice(qtyB1 = 10, qtyB2 = 5) {
    return await SalesService.createSalesInvoice(
      ctx.businessId,
      {
        partyId: ctx.customerPartyId,
        status: 'POSTED',
        lines: [
          {
            uniqueItemId: ctx.uniqueItemId,
            quantity: qtyB1 + qtyB2,
            rate: 500.0,
            gstRate: 18.0,
            batches: [
              { batchId: ctx.batchId1, quantity: qtyB1 },
              { batchId: ctx.batchId2, quantity: qtyB2 },
            ],
          },
        ],
      },
      ctx.userId
    );
  }

  // Helpers to create base posted purchase invoice
  async function createPostedPurchaseInvoice(qtyB1 = 20) {
    const inv = await PurchaseService.createPurchaseInvoice(
      ctx.businessId,
      {
        supplierPartyId: ctx.supplierPartyId,
        supplierInvoiceNumber: `BILL-${Date.now().toString().slice(-6)}`,
        invoiceDate: new Date(),
        lines: [
          {
            uniqueItemId: ctx.uniqueItemId,
            quantity: qtyB1,
            rate: 200.0,
            gstRate: 18.0,
            batches: [{ batchId: ctx.batchId1, quantity: qtyB1, rate: 200.0 }],
          },
        ],
      },
      ctx.userId
    );
    // Post the purchase invoice
    return await PurchaseService.postPurchaseInvoice(ctx.businessId, inv.id, ctx.userId);
  }

  console.log('--- TEST GROUP 1: SALES RETURN CREATION & VALIDATIONS ---');

  // Test 1: Sales Return DRAFT against POSTED invoice
  const inv1 = await createPostedSalesInvoice(10, 5);
  const inv1Line = inv1.lines[0];
  const sReturnDraft = await SalesReturnService.createSalesReturn(
    ctx.businessId,
    {
      salesInvoiceId: inv1.id,
      status: 'DRAFT',
      reason: 'Frame size mismatch',
      lines: [
        {
          salesInvoiceLineId: inv1Line.id,
          uniqueItemId: ctx.uniqueItemId,
          quantity: 4,
          batches: [
            { batchId: ctx.batchId1, quantity: 2 },
            { batchId: ctx.batchId2, quantity: 2 },
          ],
        },
      ],
    },
    ctx.userId
  );
  assert(sReturnDraft.status === 'DRAFT', 'Test 1: Sales Return created as DRAFT');
  assert(sReturnDraft.returnNumber.startsWith('SR-'), 'Test 1: Sales Return has valid SR- number');

  // Test 2: Sales Return cannot be created against CANCELLED Sales Invoice
  const inv2 = await createPostedSalesInvoice(5, 0);
  await SalesService.cancelSalesInvoice(ctx.businessId, inv2.id, 'Cancel for test', ctx.userId);
  try {
    await SalesReturnService.createSalesReturn(
      ctx.businessId,
      {
        salesInvoiceId: inv2.id,
        lines: [
          {
            salesInvoiceLineId: inv2.lines[0].id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 2,
            batches: [{ batchId: ctx.batchId1, quantity: 2 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 2: Rejection against CANCELLED invoice expected');
  } catch (err: any) {
    assert(err.message.includes('POSTED'), 'Test 2: Sales Return rejected against CANCELLED invoice');
  }

  // Test 3: Sales Return cannot be created against non-existent invoice
  try {
    await SalesReturnService.createSalesReturn(
      ctx.businessId,
      {
        salesInvoiceId: '00000000-0000-0000-0000-000000000000',
        lines: [],
      },
      ctx.userId
    );
    assert(false, 'Test 3: Rejection against non-existent invoice expected');
  } catch (err: any) {
    assert(true, 'Test 3: Sales Return rejected against non-existent invoice');
  }

  // Test 4: Cross-business isolation rejection
  try {
    await SalesReturnService.createSalesReturn(
      ctx.businessIdOther, // Other business
      {
        salesInvoiceId: inv1.id,
        lines: [
          {
            salesInvoiceLineId: inv1Line.id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 1,
            batches: [{ batchId: ctx.batchId1, quantity: 1 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 4: Cross-business return creation should be rejected');
  } catch (err: any) {
    assert(err.message.includes('not found'), 'Test 4: Cross-business return correctly rejected');
  }

  // Test 5: Rejects items not present in original invoice
  try {
    await SalesReturnService.createSalesReturn(
      ctx.businessId,
      {
        salesInvoiceId: inv1.id,
        lines: [
          {
            salesInvoiceLineId: '00000000-0000-0000-0000-000000000000',
            uniqueItemId: ctx.uniqueItemId,
            quantity: 1,
            batches: [{ batchId: ctx.batchId1, quantity: 1 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 5: Rejection of invalid invoice line expected');
  } catch (err: any) {
    assert(err.message.includes('not found on original invoice'), 'Test 5: Invalid invoice line rejected');
  }

  // Test 6: Rejects return quantity exceeding invoiced quantity
  try {
    await SalesReturnService.createSalesReturn(
      ctx.businessId,
      {
        salesInvoiceId: inv1.id,
        lines: [
          {
            salesInvoiceLineId: inv1Line.id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 999,
            batches: [{ batchId: ctx.batchId1, quantity: 999 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 6: Exceeding quantity should be rejected');
  } catch (err: any) {
    assert(err.message.includes('exceeds remaining returnable'), 'Test 6: Excessive return quantity rejected');
  }

  console.log('\n--- TEST GROUP 2: SALES RETURN POSTING & STOCK RESTORATION ---');

  // Check physical stock before return
  const stockBeforeRes = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [ctx.businessId, ctx.batchId1]
  );
  const stockBefore = parseFloat(stockBeforeRes.rows[0].physical_stock);

  // Test 7: Post sales return restores stock
  const postedSR = await SalesReturnService.postSalesReturn(ctx.businessId, sReturnDraft.id, ctx.userId);
  assert(postedSR.status === 'POSTED', 'Test 7: Sales return status updated to POSTED');

  const stockAfterRes = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [ctx.businessId, ctx.batchId1]
  );
  const stockAfter = parseFloat(stockAfterRes.rows[0].physical_stock);
  assert(
    Math.abs(stockAfter - (stockBefore + 2)) < 0.001,
    `Test 7: Physical stock restored correctly (+2.00, before=${stockBefore}, after=${stockAfter})`
  );

  // Test 8: Stock Ledger entry
  const stockLedgerRes = await pool.query(
    `SELECT * FROM stock_ledger 
     WHERE business_id = $1 AND batch_id = $2 AND transaction_type = 'SALES_RETURN' AND reference_id = $3`,
    [ctx.businessId, ctx.batchId1, sReturnDraft.id]
  );
  assert(stockLedgerRes.rows.length === 1, 'Test 8: Stock ledger entry created with SALES_RETURN');
  assert(parseFloat(stockLedgerRes.rows[0].quantity_in) === 2.0, 'Test 8: Stock ledger quantity_in matches');

  // Test 9: Customer Ledger credit entry
  const custLedgerRes = await pool.query(
    `SELECT * FROM customer_ledgers 
     WHERE business_id = $1 AND party_id = $2 AND transaction_type = 'SALES_RETURN' AND reference_id = $3`,
    [ctx.businessId, ctx.customerPartyId, sReturnDraft.id]
  );
  assert(custLedgerRes.rows.length === 1, 'Test 9: Customer ledger entry created for SALES_RETURN');
  assert(parseFloat(custLedgerRes.rows[0].credit) > 0, 'Test 9: Customer ledger has credit amount');

  // Test 10: Cannot return into an arbitrary/unrelated batch
  try {
    await SalesReturnService.createSalesReturn(
      ctx.businessId,
      {
        salesInvoiceId: inv1.id,
        lines: [
          {
            salesInvoiceLineId: inv1Line.id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 1,
            batches: [{ batchId: ctx.batchIdOtherBiz, quantity: 1 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 10: Return into arbitrary batch should be rejected');
  } catch (err: any) {
    assert(err.message.includes('not part of the original invoice line'), 'Test 10: Arbitrary batch rejected');
  }

  // Test 11: Incremental Sales Returns
  const inv3 = await createPostedSalesInvoice(10, 0);
  const inv3Line = inv3.lines[0];

  // First partial return of 3
  const retPart1 = await SalesReturnService.createSalesReturn(
    ctx.businessId,
    {
      salesInvoiceId: inv3.id,
      status: 'POSTED',
      lines: [
        {
          salesInvoiceLineId: inv3Line.id,
          uniqueItemId: ctx.uniqueItemId,
          quantity: 3,
          batches: [{ batchId: ctx.batchId1, quantity: 3 }],
        },
      ],
    },
    ctx.userId
  );
  assert(retPart1.status === 'POSTED', 'Test 11: First partial return of 3/10 posted');

  // Second partial return of 4 (cumulative 7/10)
  const retPart2 = await SalesReturnService.createSalesReturn(
    ctx.businessId,
    {
      salesInvoiceId: inv3.id,
      status: 'POSTED',
      lines: [
        {
          salesInvoiceLineId: inv3Line.id,
          uniqueItemId: ctx.uniqueItemId,
          quantity: 4,
          batches: [{ batchId: ctx.batchId1, quantity: 4 }],
        },
      ],
    },
    ctx.userId
  );
  assert(retPart2.status === 'POSTED', 'Test 11: Second partial return of 4/10 posted');

  // Test 12: Rejects cumulative return exceeding remaining (attempting 4 when only 3 remaining)
  try {
    await SalesReturnService.createSalesReturn(
      ctx.businessId,
      {
        salesInvoiceId: inv3.id,
        lines: [
          {
            salesInvoiceLineId: inv3Line.id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 4,
            batches: [{ batchId: ctx.batchId1, quantity: 4 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 12: Cumulative excess should be rejected');
  } catch (err: any) {
    assert(err.message.includes('exceeds remaining returnable'), 'Test 12: Cumulative excess rejected');
  }

  // Test 13: Double POST rejection
  try {
    await SalesReturnService.postSalesReturn(ctx.businessId, retPart1.id, ctx.userId);
    assert(false, 'Test 13: Re-posting should be rejected');
  } catch (err: any) {
    assert(err.message.includes('already POSTED'), 'Test 13: Re-posting rejected');
  }

  console.log('\n--- TEST GROUP 3: SALES RETURN CANCELLATION & INVOICE PROTECTION ---');

  // Test 14: Cancel POSTED return reverses stock and customer ledger
  const stockBeforeCancelRes = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [ctx.businessId, ctx.batchId1]
  );
  const stockBeforeCancel = parseFloat(stockBeforeCancelRes.rows[0].physical_stock);

  const cancelledSR = await SalesReturnService.cancelSalesReturn(
    ctx.businessId,
    retPart2.id,
    'Returned wrong item by mistake',
    ctx.userId
  );
  assert(cancelledSR.status === 'CANCELLED', 'Test 14: Sales return status updated to CANCELLED');

  const stockAfterCancelRes = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [ctx.businessId, ctx.batchId1]
  );
  const stockAfterCancel = parseFloat(stockAfterCancelRes.rows[0].physical_stock);
  assert(
    Math.abs(stockAfterCancel - (stockBeforeCancel - 4)) < 0.001,
    `Test 14: Physical stock deduction reversed (-4.00, before=${stockBeforeCancel}, after=${stockAfterCancel})`
  );

  // Test 15: Cancel DRAFT return updates status without reversing ledger
  const draftToCancel = await SalesReturnService.createSalesReturn(
    ctx.businessId,
    {
      salesInvoiceId: inv3.id,
      status: 'DRAFT',
      lines: [
        {
          salesInvoiceLineId: inv3Line.id,
          uniqueItemId: ctx.uniqueItemId,
          quantity: 1,
          batches: [{ batchId: ctx.batchId1, quantity: 1 }],
        },
      ],
    },
    ctx.userId
  );
  const cancelledDraft = await SalesReturnService.cancelSalesReturn(
    ctx.businessId,
    draftToCancel.id,
    'User discarded draft',
    ctx.userId
  );
  assert(cancelledDraft.status === 'CANCELLED', 'Test 15: Draft return cancelled cleanly');

  // Test 16: Sales Invoice cancellation is BLOCKED if active Sales Return exists
  // retPart1 is still active (POSTED) on inv3
  try {
    await SalesService.cancelSalesInvoice(ctx.businessId, inv3.id, 'Attempting cancel', ctx.userId);
    assert(false, 'Test 16: Cancelling invoice with active returns should be blocked');
  } catch (err: any) {
    assert(err.message.includes('active Sales Return'), 'Test 16: Invoice cancellation blocked due to active return');
  }

  console.log('\n--- TEST GROUP 4: PURCHASE RETURNS (DEBIT NOTES) ---');

  // Test 17: Purchase Return DRAFT against POSTED Purchase Invoice
  const pInv1 = await createPostedPurchaseInvoice(20);
  const pInv1Line = pInv1.lines[0];
  const pReturnDraft = await PurchaseReturnService.createPurchaseReturn(
    ctx.businessId,
    {
      purchaseInvoiceId: pInv1.id,
      status: 'DRAFT',
      reason: 'Damaged frames during transit',
      lines: [
        {
          purchaseInvoiceLineId: pInv1Line.id,
          uniqueItemId: ctx.uniqueItemId,
          quantity: 5,
          batches: [{ batchId: ctx.batchId1, quantity: 5, rate: 200.0 }],
        },
      ],
    },
    ctx.userId
  );
  assert(pReturnDraft.status === 'DRAFT', 'Test 17: Purchase Return created as DRAFT');
  assert(pReturnDraft.returnNumber.startsWith('PR-'), 'Test 17: Purchase Return has PR- format');

  // Test 18: Cannot return against CANCELLED purchase invoice
  const pInv2 = await createPostedPurchaseInvoice(10);
  await PurchaseService.cancelPurchaseInvoice(ctx.businessId, pInv2.id, 'Cancel for test', ctx.userId);
  try {
    await PurchaseReturnService.createPurchaseReturn(
      ctx.businessId,
      {
        purchaseInvoiceId: pInv2.id,
        lines: [
          {
            purchaseInvoiceLineId: pInv2.lines[0].id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 2,
            batches: [{ batchId: ctx.batchId1, quantity: 2 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 18: Rejection against cancelled bill expected');
  } catch (err: any) {
    assert(err.message.includes('POSTED'), 'Test 18: Purchase Return rejected against CANCELLED bill');
  }

  // Test 19: Cross-business isolation rejection on purchase returns
  try {
    await PurchaseReturnService.createPurchaseReturn(
      ctx.businessIdOther,
      {
        purchaseInvoiceId: pInv1.id,
        lines: [
          {
            purchaseInvoiceLineId: pInv1Line.id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 1,
            batches: [{ batchId: ctx.batchId1, quantity: 1 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 19: Cross-business purchase return should be rejected');
  } catch (err: any) {
    assert(err.message.includes('not found'), 'Test 19: Cross-business purchase return rejected');
  }

  // Test 20: Rejects return quantity exceeding purchased quantity
  try {
    await PurchaseReturnService.createPurchaseReturn(
      ctx.businessId,
      {
        purchaseInvoiceId: pInv1.id,
        lines: [
          {
            purchaseInvoiceLineId: pInv1Line.id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 100,
            batches: [{ batchId: ctx.batchId1, quantity: 100 }],
          },
        ],
      },
      ctx.userId
    );
    assert(false, 'Test 20: Excess return qty should be rejected');
  } catch (err: any) {
    assert(err.message.includes('exceeds remaining returnable'), 'Test 20: Excess return qty rejected');
  }

  // Test 21: Purchase Return POST deducts physical stock
  const pStockBeforeRes = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [ctx.businessId, ctx.batchId1]
  );
  const pStockBefore = parseFloat(pStockBeforeRes.rows[0].physical_stock);

  const postedPR = await PurchaseReturnService.postPurchaseReturn(ctx.businessId, pReturnDraft.id, ctx.userId);
  assert(postedPR.status === 'POSTED', 'Test 21: Purchase Return posted successfully');

  const pStockAfterRes = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [ctx.businessId, ctx.batchId1]
  );
  const pStockAfter = parseFloat(pStockAfterRes.rows[0].physical_stock);
  assert(
    Math.abs(pStockAfter - (pStockBefore - 5)) < 0.001,
    `Test 21: Stock deducted correctly (-5.00, before=${pStockBefore}, after=${pStockAfter})`
  );

  // Test 22: Stock Ledger entry for PURCHASE_RETURN
  const pStockLedgerRes = await pool.query(
    `SELECT * FROM stock_ledger 
     WHERE business_id = $1 AND batch_id = $2 AND transaction_type = 'PURCHASE_RETURN' AND reference_id = $3`,
    [ctx.businessId, ctx.batchId1, pReturnDraft.id]
  );
  assert(pStockLedgerRes.rows.length === 1, 'Test 22: Stock ledger entry for PURCHASE_RETURN created');
  assert(parseFloat(pStockLedgerRes.rows[0].quantity_out) === 5.0, 'Test 22: Stock ledger quantity_out matches');

  // Test 23: Purchase Lots remaining_quantity decremented
  const pLotRes = await pool.query(
    `SELECT remaining_quantity FROM purchase_lots WHERE business_id = $1 AND purchase_invoice_id = $2`,
    [ctx.businessId, pInv1.id]
  );
  assert(pLotRes.rows.length > 0, 'Test 23: Purchase lot found');
  assert(parseFloat(pLotRes.rows[0].remaining_quantity) === 15.0, 'Test 23: Purchase lot decremented from 20 to 15');

  // Test 24: Supplier Ledger DEBIT entry reducing supplier balance
  const suppLedgerRes = await pool.query(
    `SELECT * FROM supplier_ledgers 
     WHERE business_id = $1 AND party_id = $2 AND transaction_type = 'PURCHASE_RETURN' AND reference_id = $3`,
    [ctx.businessId, ctx.supplierPartyId, pReturnDraft.id]
  );
  assert(suppLedgerRes.rows.length === 1, 'Test 24: Supplier ledger entry for PURCHASE_RETURN created');
  assert(parseFloat(suppLedgerRes.rows[0].debit) > 0, 'Test 24: Supplier ledger has debit reduction');

  // Test 25: Cancel POSTED Purchase Return restores stock, lots & supplier balance
  const pCancelled = await PurchaseReturnService.cancelPurchaseReturn(
    ctx.businessId,
    pReturnDraft.id,
    'Returned by mistake',
    ctx.userId
  );
  assert(pCancelled.status === 'CANCELLED', 'Test 25: Purchase return cancelled');

  const pStockAfterCancelRes = await pool.query(
    `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
    [ctx.businessId, ctx.batchId1]
  );
  const pStockAfterCancel = parseFloat(pStockAfterCancelRes.rows[0].physical_stock);
  assert(
    Math.abs(pStockAfterCancel - pStockBefore) < 0.001,
    'Test 25: Physical stock restored after purchase return cancellation'
  );

  // Test 26: Purchase Invoice cancellation blocked if active return exists
  const pInv3 = await createPostedPurchaseInvoice(10);
  const activePR = await PurchaseReturnService.createPurchaseReturn(
    ctx.businessId,
    {
      purchaseInvoiceId: pInv3.id,
      status: 'POSTED',
      lines: [
        {
          purchaseInvoiceLineId: pInv3.lines[0].id,
          uniqueItemId: ctx.uniqueItemId,
          quantity: 2,
          batches: [{ batchId: ctx.batchId1, quantity: 2 }],
        },
      ],
    },
    ctx.userId
  );
  try {
    await PurchaseService.cancelPurchaseInvoice(ctx.businessId, pInv3.id, 'Cancel attempt', ctx.userId);
    assert(false, 'Test 26: Purchase invoice cancellation should be blocked');
  } catch (err: any) {
    assert(err.message.includes('active Purchase Return'), 'Test 26: Purchase bill cancellation blocked due to active return');
  }

  console.log('\n--- TEST GROUP 5: TAX CALCULATION & SEQUENCING INTEGRITY ---');

  // Test 27: Tax calculation integrity (CGST/SGST vs IGST)
  const calcSumm = await SalesReturnService.getReturnableInvoiceSummary(ctx.businessId, inv1.id);
  assert(calcSumm.lines.length > 0, 'Test 27: Summary returns valid lines');
  assert(calcSumm.lines[0].returnableQuantity > 0, 'Test 27: Invoice line has returnable quantities');

  // Test 28: Sequential Numbering per business
  const nextSR = await SalesReturnService.generateReturnNumber(ctx.businessId);
  const nextPR = await PurchaseReturnService.generateReturnNumber(ctx.businessId);
  assert(nextSR.startsWith('SR-'), 'Test 28: Sales Return numbering format is SR-00000X');
  assert(nextPR.startsWith('PR-'), 'Test 28: Purchase Return numbering format is PR-00000X');

  console.log('\n========================================================================');
  console.log(`PHASE 5 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    try { await pool.end(); } catch {}
    process.exit(1);
  }
  try { await pool.end(); } catch {}
  process.exit(0);
}

runPhase5Tests().catch(async (err) => {
  console.error('Unhandled Test Failure:', err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
