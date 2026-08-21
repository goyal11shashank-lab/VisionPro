import { pool } from '../db/index.js';
import { SalesService } from '../services/salesService.js';
import { round2 } from '../services/taxCalculationService.js';
import crypto from 'crypto';

interface TestContext {
  businessId: string;
  userId: string;
  categoryId: string;
  baseId: string;
  primaryItemId: string;
  uniqueItemId: string;
  batchId1: string;
  batchId2: string;
  customerPartyId: string;
  supplierPartyId: string;
}

async function setupTestData(): Promise<TestContext> {
  const client = await pool.connect();
  try {
    const bizSuffix = crypto.randomBytes(4).toString('hex');
    
    // 1. Create Business
    const bizRes = await client.query(
      `INSERT INTO businesses (name, trade_name, state, gstin, status) 
       VALUES ($1, $2, 'Delhi', '07AAAAA0000A1Z5', 'ACTIVE') 
       RETURNING id`,
      [`Optical Sales Biz ${bizSuffix}`, `SO_BIZ_${bizSuffix}`]
    );
    const businessId = bizRes.rows[0].id;

    // 2. Create User
    const userRes = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, status, is_super_admin) 
       VALUES ($1, $2, 'hash', 'Sales Manager', 'ACTIVE', false) 
       RETURNING id`,
      [`user_${bizSuffix}`, `sales_${bizSuffix}@example.com`]
    );
    const userId = userRes.rows[0].id;

    // 3. Category (Single Vision)
    const catRes = await client.query(
      `INSERT INTO categories (business_id, name, code, status) 
       VALUES ($1, 'Single Vision', $2, 'ACTIVE') 
       RETURNING id`,
      [businessId, `SV_${bizSuffix}`]
    );
    const categoryId = catRes.rows[0].id;

    // 4. Base
    const baseRes = await client.query(
      `INSERT INTO bases (business_id, name, code, status) 
       VALUES ($1, 'CR-39 1.56', $2, 'ACTIVE') 
       RETURNING id`,
      [businessId, `BASE_${bizSuffix}`]
    );
    const baseId = baseRes.rows[0].id;

    // 5. Primary Item
    const piRes = await client.query(
      `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status) 
       VALUES ($1, $2, $3, 'SV 1.56 HC Lenses', $4, 'ACTIVE') 
       RETURNING id`,
      [businessId, categoryId, baseId, `PI_${bizSuffix}`]
    );
    const primaryItemId = piRes.rows[0].id;

    // 6. Unique Item
    const uiRes = await client.query(
      `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, status) 
       VALUES ($1, $2, 'SV 1.56 HC Standard Pair', $3, 200.00, 500.00, 'ACTIVE') 
       RETURNING id`,
      [businessId, primaryItemId, `UI_${bizSuffix}`]
    );
    const uniqueItemId = uiRes.rows[0].id;

    // 7. Optical Batches
    const b1Res = await client.query(
      `INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, "add", side, identity_key) 
       VALUES ($1, $2, $3, $4, 2.00, -0.50, 0, 0, 'NONE', $5) 
       RETURNING id`,
      [businessId, uniqueItemId, categoryId, `BAR1_${bizSuffix}`, `KEY1_${bizSuffix}`]
    );
    const batchId1 = b1Res.rows[0].id;

    const b2Res = await client.query(
      `INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, axis, "add", side, identity_key) 
       VALUES ($1, $2, $3, $4, -1.00, -0.75, 0, 0, 'NONE', $5) 
       RETURNING id`,
      [businessId, uniqueItemId, categoryId, `BAR2_${bizSuffix}`, `KEY2_${bizSuffix}`]
    );
    const batchId2 = b2Res.rows[0].id;

    // 8. Add initial physical stock for batch 1 (100 pairs) and batch 2 (50 pairs)
    await client.query(
      `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock) 
       VALUES ($1, $2, 100.00, 0.00, 100.00), ($1, $3, 50.00, 0.00, 50.00)`,
      [businessId, batchId1, batchId2]
    );

    // 9. Create Customer Party (Intra-state: Delhi)
    const custRes = await client.query(
      `INSERT INTO parties (business_id, party_code, name, party_type, state, gstin, credit_limit, status) 
       VALUES ($1, $2, 'Vision Opticals Delhi', 'CUSTOMER', 'Delhi', '07BBBBB1111B1Z2', 50000.00, 'ACTIVE') 
       RETURNING id`,
      [businessId, `CUST_${bizSuffix}`]
    );
    const customerPartyId = custRes.rows[0].id;

    // 10. Create Supplier Party (For negative validation check)
    const supRes = await client.query(
      `INSERT INTO parties (business_id, party_code, name, party_type, state, status) 
       VALUES ($1, $2, 'Lens Manufacturer Inc', 'SUPPLIER', 'Maharashtra', 'ACTIVE') 
       RETURNING id`,
      [businessId, `SUP_${bizSuffix}`]
    );
    const supplierPartyId = supRes.rows[0].id;

    return {
      businessId,
      userId,
      categoryId,
      baseId,
      primaryItemId,
      uniqueItemId,
      batchId1,
      batchId2,
      customerPartyId,
      supplierPartyId,
    };
  } finally {
    client.release();
  }
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('STARTING PHASE 4 SALES ENGINE & TRANSACTION VERIFICATION');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  const ctx = await setupTestData();

  // Test 1: Reject sales order with SUPPLIER party
  await test('Reject Sales Order creation for SUPPLIER party', async () => {
    let threw = false;
    try {
      await SalesService.createSalesOrder(
        ctx.businessId,
        {
          partyId: ctx.supplierPartyId,
          orderDate: '2026-08-20',
          lines: [
            {
              uniqueItemId: ctx.uniqueItemId,
              quantity: 10,
              rate: 350,
              batches: [{ batchId: ctx.batchId1, quantity: 10 }],
            },
          ],
        },
        ctx.userId
      );
    } catch (err: any) {
      threw = true;
      if (!err.message.includes('SUPPLIER')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
    }
    if (!threw) throw new Error('Expected SUPPLIER party rejection for sales order');
  });

  // Test 2: Create DRAFT Sales Order with intra-state tax (CGST + SGST 6% each = 12%)
  let draftOrder: any;
  await test('Create DRAFT Sales Order with correct tax calculation', async () => {
    draftOrder = await SalesService.createSalesOrder(
      ctx.businessId,
      {
        partyId: ctx.customerPartyId,
        orderDate: '2026-08-20',
        notes: 'Priority customer order',
        status: 'DRAFT',
        lines: [
          {
            uniqueItemId: ctx.uniqueItemId,
            quantity: 10,
            rate: 400.0,
            discountPercent: 10, // 400 * 10 = 4000 - 400 = 3600 taxable
            gstRate: 12,
            batches: [{ batchId: ctx.batchId1, quantity: 10 }],
          },
        ],
      },
      ctx.userId
    );

    if (draftOrder.status !== 'DRAFT') throw new Error(`Expected DRAFT status, got ${draftOrder.status}`);
    if (draftOrder.lines.length !== 1) throw new Error('Expected 1 line');
    
    // Taxable = 3600.00, CGST = 216.00, SGST = 216.00, Grand Total = 4032.00
    if (parseFloat(draftOrder.taxableAmount) !== 3600.00) {
      throw new Error(`Expected taxable 3600.00, got ${draftOrder.taxableAmount}`);
    }
    if (parseFloat(draftOrder.cgstAmount) !== 216.00 || parseFloat(draftOrder.sgstAmount) !== 216.00) {
      throw new Error(`Expected CGST/SGST 216.00, got CGST=${draftOrder.cgstAmount}, SGST=${draftOrder.sgstAmount}`);
    }
    if (parseFloat(draftOrder.grandTotal) !== 4032.00) {
      throw new Error(`Expected grandTotal 4032.00, got ${draftOrder.grandTotal}`);
    }

    // Verify inventory is NOT yet reserved in DRAFT status
    const stockRes = await pool.query(
      `SELECT physical_stock, reserved_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId1]
    );
    const stock = stockRes.rows[0];
    if (parseFloat(stock.reserved_stock) !== 0 || parseFloat(stock.available_stock) !== 100) {
      throw new Error(`DRAFT order must not reserve stock: reserved=${stock.reserved_stock}, available=${stock.available_stock}`);
    }
  });

  // Test 3: Confirm Sales Order and verify inventory reservation
  await test('Confirm Sales Order and verify atomic stock reservation', async () => {
    const confirmed = await SalesService.confirmSalesOrder(ctx.businessId, draftOrder.id, ctx.userId);
    if (confirmed.status !== 'CONFIRMED') throw new Error(`Expected CONFIRMED status, got ${confirmed.status}`);

    const stockRes = await pool.query(
      `SELECT physical_stock, reserved_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId1]
    );
    const stock = stockRes.rows[0];
    if (parseFloat(stock.physical_stock) !== 100.00) {
      throw new Error(`Physical stock must remain unchanged (100), got ${stock.physical_stock}`);
    }
    if (parseFloat(stock.reserved_stock) !== 10.00) {
      throw new Error(`Reserved stock must be 10.00, got ${stock.reserved_stock}`);
    }
    if (parseFloat(stock.available_stock) !== 90.00) {
      throw new Error(`Available stock must be 90.00, got ${stock.available_stock}`);
    }

    // Verify active reservation record exists
    const resRes = await pool.query(
      `SELECT * FROM stock_reservations WHERE business_id = $1 AND reference_id = $2 AND status = 'ACTIVE'`,
      [ctx.businessId, draftOrder.id]
    );
    if (resRes.rows.length === 0) throw new Error('Expected ACTIVE stock reservation record');
    if (parseFloat(resRes.rows[0].quantity) !== 10.00) throw new Error('Expected reservation quantity 10.00');
  });

  // Test 4: Prevent overselling / reserving more than available stock
  await test('Reject Sales Order confirmation when available stock is insufficient', async () => {
    // Current available is 90 pairs. Attempting to reserve 95 pairs should fail.
    let threw = false;
    try {
      await SalesService.createSalesOrder(
        ctx.businessId,
        {
          partyId: ctx.customerPartyId,
          orderDate: '2026-08-20',
          status: 'CONFIRMED',
          lines: [
            {
              uniqueItemId: ctx.uniqueItemId,
              quantity: 95,
              rate: 400.0,
              gstRate: 12,
              batches: [{ batchId: ctx.batchId1, quantity: 95 }],
            },
          ],
        },
        ctx.userId
      );
    } catch (err: any) {
      threw = true;
      if (!err.message.includes('Insufficient available stock')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
    }
    if (!threw) throw new Error('Expected rejection for overselling batch');
  });

  // Test 5: Convert Sales Order to Sales Invoice (Full Conversion)
  let convertedInvoice: any;
  await test('Convert Sales Order to Sales Invoice (Atomic Reservation Conversion)', async () => {
    convertedInvoice = await SalesService.convertOrderToInvoice(
      ctx.businessId,
      draftOrder.id,
      {
        invoiceDate: '2026-08-20',
        paymentTerms: 'NET 30',
        lines: [
          {
            salesOrderLineId: draftOrder.lines[0].id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 10,
            rate: 400.0,
            discountPercent: 10,
            gstRate: 12,
            batches: [{ batchId: ctx.batchId1, quantity: 10 }],
          },
        ],
      },
      ctx.userId
    );

    if (convertedInvoice.status !== 'POSTED') {
      throw new Error(`Converted invoice must be POSTED, got ${convertedInvoice.status}`);
    }

    // Verify stock state: Physical stock reduced from 100 to 90, Reserved reduced from 10 to 0, Available remains 90
    const stockRes = await pool.query(
      `SELECT physical_stock, reserved_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId1]
    );
    const stock = stockRes.rows[0];
    if (parseFloat(stock.physical_stock) !== 90.00) {
      throw new Error(`Expected physical stock 90.00, got ${stock.physical_stock}`);
    }
    if (parseFloat(stock.reserved_stock) !== 0.00) {
      throw new Error(`Expected reserved stock 0.00, got ${stock.reserved_stock}`);
    }
    if (parseFloat(stock.available_stock) !== 90.00) {
      throw new Error(`Expected available stock 90.00, got ${stock.available_stock}`);
    }

    // Verify Sales Order status changed to CONVERTED
    const soRes = await pool.query(`SELECT status FROM sales_orders WHERE id = $1`, [draftOrder.id]);
    if (soRes.rows[0].status !== 'CONVERTED') {
      throw new Error(`Expected order status CONVERTED, got ${soRes.rows[0].status}`);
    }

    // Verify reservation status changed to CONVERTED
    const resRes = await pool.query(
      `SELECT status FROM stock_reservations WHERE reference_id = $1`,
      [draftOrder.id]
    );
    if (resRes.rows[0].status !== 'CONVERTED') {
      throw new Error(`Expected reservation status CONVERTED, got ${resRes.rows[0].status}`);
    }

    // Verify Customer Ledger entry (Debit = 4032.00, Balance = 4032.00)
    const ledRes = await pool.query(
      `SELECT * FROM customer_ledgers WHERE business_id = $1 AND party_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [ctx.businessId, ctx.customerPartyId]
    );
    if (ledRes.rows.length === 0) throw new Error('Customer ledger entry not found');
    const entry = ledRes.rows[0];
    if (parseFloat(entry.debit) !== 4032.00) throw new Error(`Expected debit 4032.00, got ${entry.debit}`);
    if (parseFloat(entry.balance) !== 4032.00) throw new Error(`Expected balance 4032.00, got ${entry.balance}`);

    // Verify Party Item Price updated to Last Sale Price (400.00)
    const priceRes = await pool.query(
      `SELECT last_sale_price FROM party_item_prices WHERE business_id = $1 AND party_id = $2 AND unique_item_id = $3`,
      [ctx.businessId, ctx.customerPartyId, ctx.uniqueItemId]
    );
    if (priceRes.rows.length === 0) throw new Error('party_item_prices not updated');
    if (parseFloat(priceRes.rows[0].last_sale_price) !== 400.00) {
      throw new Error(`Expected last_sale_price 400.00, got ${priceRes.rows[0].last_sale_price}`);
    }
  });

  // Test 6: Direct Sales Invoice (Inter-State IGST 12%)
  let directInvoice: any;
  await test('Create & Post Direct Sales Invoice with Inter-State IGST', async () => {
    // Create an inter-state party (Haryana)
    const haryanaPartyRes = await pool.query(
      `INSERT INTO parties (business_id, party_code, name, party_type, state, gstin, status) 
       VALUES ($1, 'CUST_HR', 'Haryana Vision Hub', 'CUSTOMER', 'Haryana', '06AAAAA0000A1Z5', 'ACTIVE') 
       RETURNING id`,
      [ctx.businessId]
    );
    const haryanaPartyId = haryanaPartyRes.rows[0].id;

    directInvoice = await SalesService.createSalesInvoice(
      ctx.businessId,
      {
        partyId: haryanaPartyId,
        invoiceDate: '2026-08-20',
        status: 'POSTED',
        lines: [
          {
            uniqueItemId: ctx.uniqueItemId,
            quantity: 20,
            rate: 450.0,
            gstRate: 12,
            batches: [{ batchId: ctx.batchId2, quantity: 20 }], // Available stock is 50
          },
        ],
      },
      ctx.userId
    );

    if (directInvoice.status !== 'POSTED') throw new Error(`Expected POSTED, got ${directInvoice.status}`);
    
    // Taxable = 9000.00, IGST = 1080.00, CGST = 0.00, SGST = 0.00, Grand Total = 10080.00
    if (parseFloat(directInvoice.taxableAmount) !== 9000.00) {
      throw new Error(`Expected taxable 9000.00, got ${directInvoice.taxableAmount}`);
    }
    if (parseFloat(directInvoice.igstAmount) !== 1080.00) {
      throw new Error(`Expected IGST 1080.00, got ${directInvoice.igstAmount}`);
    }
    if (parseFloat(directInvoice.cgstAmount) !== 0.00 || parseFloat(directInvoice.sgstAmount) !== 0.00) {
      throw new Error('Inter-state invoice must have 0 CGST and SGST');
    }
    if (parseFloat(directInvoice.grandTotal) !== 10080.00) {
      throw new Error(`Expected grand total 10080.00, got ${directInvoice.grandTotal}`);
    }

    // Verify batch 2 stock reduced from 50 to 30
    const stockRes = await pool.query(
      `SELECT physical_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId2]
    );
    const stock = stockRes.rows[0];
    if (parseFloat(stock.physical_stock) !== 30.00 || parseFloat(stock.available_stock) !== 30.00) {
      throw new Error(`Expected batch2 stock 30.00, got physical=${stock.physical_stock}, avail=${stock.available_stock}`);
    }

    // Verify Haryana customer ledger has 10080.00 debit
    const ledRes = await pool.query(
      `SELECT * FROM customer_ledgers WHERE business_id = $1 AND party_id = $2`,
      [ctx.businessId, haryanaPartyId]
    );
    if (parseFloat(ledRes.rows[0].debit) !== 10080.00 || parseFloat(ledRes.rows[0].balance) !== 10080.00) {
      throw new Error(`Expected ledger balance 10080.00, got ${ledRes.rows[0].balance}`);
    }
  });

  // Test 7: Cancel Sales Invoice and reverse stock & ledger
  await test('Cancel Sales Invoice and verify atomic stock and ledger reversal', async () => {
    const cancelled = await SalesService.cancelSalesInvoice(
      ctx.businessId,
      directInvoice.id,
      'Customer order cancelled prior to dispatch',
      ctx.userId
    );

    if (cancelled.status !== 'CANCELLED') throw new Error(`Expected CANCELLED, got ${cancelled.status}`);

    // Verify batch 2 stock restored back to 50.00
    const stockRes = await pool.query(
      `SELECT physical_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId2]
    );
    const stock = stockRes.rows[0];
    if (parseFloat(stock.physical_stock) !== 50.00 || parseFloat(stock.available_stock) !== 50.00) {
      throw new Error(`Expected restored stock 50.00, got physical=${stock.physical_stock}, avail=${stock.available_stock}`);
    }

    // Verify customer ledger reversal entry (Credit = 10080.00, Balance = 0.00)
    const ledRes = await pool.query(
      `SELECT * FROM customer_ledgers WHERE business_id = $1 AND reference_id = $2 AND transaction_type = 'CANCELLATION_REVERSAL'`,
      [ctx.businessId, directInvoice.id]
    );
    if (ledRes.rows.length === 0) throw new Error('Expected CANCELLATION_REVERSAL ledger entry');
    const rev = ledRes.rows[0];
    if (parseFloat(rev.credit) !== 10080.00) throw new Error(`Expected credit 10080.00, got ${rev.credit}`);
    if (parseFloat(rev.balance) !== 0.00) throw new Error(`Expected ledger balance 0.00, got ${rev.balance}`);
  });

  // Test 8: Partial Order Conversion & Remainder Reservation Management
  await test('Partial Sales Order Conversion & Remainder Handling', async () => {
    // 1. Create and confirm an order for 20 pairs of batch 1 (current available = 90)
    const order = await SalesService.createSalesOrder(
      ctx.businessId,
      {
        partyId: ctx.customerPartyId,
        orderDate: '2026-08-20',
        status: 'CONFIRMED',
        lines: [
          {
            uniqueItemId: ctx.uniqueItemId,
            quantity: 20,
            rate: 420.0,
            gstRate: 12,
            batches: [{ batchId: ctx.batchId1, quantity: 20 }],
          },
        ],
      },
      ctx.userId
    );

    // Stock: Physical = 90, Reserved = 20, Available = 70
    let stockRes = await pool.query(
      `SELECT physical_stock, reserved_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId1]
    );
    if (parseFloat(stockRes.rows[0].reserved_stock) !== 20.00 || parseFloat(stockRes.rows[0].available_stock) !== 70.00) {
      throw new Error('Stock reservation mismatch before partial conversion');
    }

    // 2. Convert partially (12 pairs converted, 8 pairs remain reserved)
    await SalesService.convertOrderToInvoice(
      ctx.businessId,
      order.id,
      {
        invoiceDate: '2026-08-20',
        lines: [
          {
            salesOrderLineId: order.lines[0].id,
            uniqueItemId: ctx.uniqueItemId,
            quantity: 12,
            rate: 420.0,
            gstRate: 12,
            batches: [{ batchId: ctx.batchId1, quantity: 12 }],
          },
        ],
      },
      ctx.userId
    );

    // Order status should be PARTIALLY_CONVERTED
    const soRes = await pool.query(`SELECT status FROM sales_orders WHERE id = $1`, [order.id]);
    if (soRes.rows[0].status !== 'PARTIALLY_CONVERTED') {
      throw new Error(`Expected PARTIALLY_CONVERTED, got ${soRes.rows[0].status}`);
    }

    // Stock: Physical = 90 - 12 = 78, Reserved = 20 - 12 = 8, Available = 78 - 8 = 70
    stockRes = await pool.query(
      `SELECT physical_stock, reserved_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId1]
    );
    const curStock = stockRes.rows[0];
    if (parseFloat(curStock.physical_stock) !== 78.00) {
      throw new Error(`Expected physical 78.00, got ${curStock.physical_stock}`);
    }
    if (parseFloat(curStock.reserved_stock) !== 8.00) {
      throw new Error(`Expected reserved 8.00, got ${curStock.reserved_stock}`);
    }
    if (parseFloat(curStock.available_stock) !== 70.00) {
      throw new Error(`Expected available 70.00, got ${curStock.available_stock}`);
    }

    // 3. Cancel the remaining order — active reservation of 8 pairs should be released
    await SalesService.cancelSalesOrder(ctx.businessId, order.id, 'Customer cancelled remainder', ctx.userId);

    stockRes = await pool.query(
      `SELECT physical_stock, reserved_stock, available_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
      [ctx.businessId, ctx.batchId1]
    );
    const finalStock = stockRes.rows[0];
    if (parseFloat(finalStock.physical_stock) !== 78.00) {
      throw new Error(`Expected physical 78.00, got ${finalStock.physical_stock}`);
    }
    if (parseFloat(finalStock.reserved_stock) !== 0.00) {
      throw new Error(`Expected reserved 0.00, got ${finalStock.reserved_stock}`);
    }
    if (parseFloat(finalStock.available_stock) !== 78.00) {
      throw new Error(`Expected available 78.00, got ${finalStock.available_stock}`);
    }
  });

  // Test 9: Barcode lookup for sale
  await test('Barcode lookup for sales details', async () => {
    const bRes = await pool.query(`SELECT barcode FROM optical_batches WHERE id = $1`, [ctx.batchId1]);
    const barcode = bRes.rows[0].barcode;

    const details = await SalesService.getBarcodeDetailsForSale(ctx.businessId, barcode);
    if (!details.batch || details.batch.id !== ctx.batchId1) {
      throw new Error('Barcode lookup did not return matching batch');
    }
    if (parseFloat(String(details.stock.availableStock)) !== 78.0) {
      throw new Error(`Expected available stock 78.0, got ${details.stock.availableStock}`);
    }
  });

  console.log('\n=============================================================');
  console.log(`PHASE 4 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
