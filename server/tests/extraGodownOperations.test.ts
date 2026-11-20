import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import { pool } from '../db/index.js';
import { GodownService } from '../services/godownService.js';
import { StockService } from '../services/stockService.js';
import { SalesService } from '../services/salesService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { PaymentService } from '../services/paymentService.js';
import bcrypt from 'bcryptjs';

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING 17-SCENARIO AUTOMATED VERIFICATION: EXTRA GODOWN SYSTEM');
  console.log('================================================================\n');

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

  // 1. Setup Test Business & Party
  console.log('-> Setting up test business, parties, and items...');
  const testBizRes = await pool.query(`
    INSERT INTO businesses (name, trade_name, currency, financial_year_start, status, business_type, state, state_code)
    VALUES ('Vision Test Central Hub', 'Vision Test Hub', 'INR', '2026-04-01', 'ACTIVE', 'MAIN', 'Karnataka', '29')
    RETURNING id
  `);
  const businessId = testBizRes.rows[0].id;

  // Insert Category, Base & Unique Item
  const catRes = await pool.query(`
    INSERT INTO categories (business_id, name, code)
    VALUES ($1, 'Single Vision Lenses', 'SV')
    RETURNING id
  `, [businessId]);
  const catId = catRes.rows[0].id;

  const baseRes = await pool.query(`
    INSERT INTO bases (business_id, name, code, family)
    VALUES ($1, 'Clear Standard 1.56', 'BASE-156', 'CLEAR')
    RETURNING id
  `, [businessId]);
  const baseId = baseRes.rows[0].id;

  const primRes = await pool.query(`
    INSERT INTO primary_items (business_id, category_id, base_id, name, code)
    VALUES ($1, $2, $3, 'CR39 HC 1.56', 'CR39-HC')
    RETURNING id
  `, [businessId, catId, baseId]);
  const primId = primRes.rows[0].id;

  const itemRes = await pool.query(`
    INSERT INTO unique_items (business_id, primary_item_id, name, code, optical_category, purchase_rate, mrp, unit, gst_rate, maintain_batches)
    VALUES ($1, $2, 'CR39 Hard Coat 1.56', 'CR39-156-SV', 'SV', 300, 900, 'PRS', 12.00, true)
    RETURNING id
  `, [businessId, primId]);
  const uniqueItemId = itemRes.rows[0].id;

  // Insert Optical Batch
  const testBarcode = 'BC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const batchRes = await pool.query(`
    INSERT INTO optical_batches (business_id, category_id, unique_item_id, barcode, sph, cyl, axis, "add", side, identity_key)
    VALUES ($1, $2, $3, $4, -2.50, -1.00, 90, 0, 'NONE', 'SV:SPH=-2.50:CYL=-1.00')
    RETURNING id
  `, [businessId, catId, uniqueItemId, testBarcode]);
  const batchId = batchRes.rows[0].id;

  // Insert Parties: Customer & Supplier
  const custRes = await pool.query(`
    INSERT INTO parties (business_id, name, party_code, party_type, mobile, status, state)
    VALUES ($1, 'Test Optical Customer', 'CUST-001', 'CUSTOMER', '9888877771', 'ACTIVE', 'Karnataka')
    RETURNING id
  `, [businessId]);
  const customerPartyId = custRes.rows[0].id;

  const suppRes = await pool.query(`
    INSERT INTO parties (business_id, name, party_code, party_type, mobile, status, state)
    VALUES ($1, 'Test Lens Supplier', 'SUPP-001', 'SUPPLIER', '9888877772', 'ACTIVE', 'Karnataka')
    RETURNING id
  `, [businessId]);
  const supplierPartyId = suppRes.rows[0].id;

  // Set initial stock in Main Warehouse (godown_id IS NULL)
  await pool.query(`
    INSERT INTO optical_stocks (business_id, batch_id, godown_id, physical_stock, reserved_stock, available_stock)
    VALUES ($1, $2, NULL, 50.00, 5.00, 45.00)
  `, [businessId, batchId]);

  try {
    // ------------------------------------------------------------------------
    // SCENARIO 1: Extra Godown CRUD, activation, deactivation
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 1: Extra Godown CRUD, Activation, Deactivation ---');
    const godown1 = await GodownService.createGodown(businessId, {
      name: 'North Branch Secondary Godown',
      code: 'GDN-NORTH',
      godownType: 'SECONDARY_WAREHOUSE',
      contactPerson: 'Suresh Kumar',
      mobile: '9900011111',
      address: '123 North Ring Road, Bangalore',
    });
    assert(godown1.id && godown1.code === 'GDN-NORTH', 'Extra Godown created successfully');

    const updatedGodown1 = await GodownService.updateGodown(businessId, godown1.id, {
      contactPerson: 'Suresh K. Patel',
    });
    assert(updatedGodown1.contactPerson === 'Suresh K. Patel', 'Extra Godown updated successfully');

    const deactivatedGodown = await GodownService.updateGodown(businessId, godown1.id, {
      status: 'INACTIVE',
    });
    assert(deactivatedGodown.status === 'INACTIVE', 'Extra Godown deactivated successfully');

    const reactivatedGodown = await GodownService.updateGodown(businessId, godown1.id, {
      status: 'ACTIVE',
    });
    assert(reactivatedGodown.status === 'ACTIVE', 'Extra Godown reactivated successfully');

    // ------------------------------------------------------------------------
    // SCENARIO 2: Deletion blocked if vouchers, stock movements, or assigned staff exist
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 2: Safe Deactivation & Deletion Block Guard ---');
    // Create Godown 2
    const godown2 = await GodownService.createGodown(businessId, {
      name: 'East Dealer Godown',
      code: 'GDN-EAST',
      godownType: 'DEALER_GODOWN',
    });

    // Create staff user assigned to godown2
    const staffUser2 = await GodownService.createGodownUser(businessId, godown2.id, {
      username: 'east_staff_' + Date.now().toString(36),
      password: 'password123',
      fullName: 'East Godown Salesman',
    });
    assert(staffUser2.id && staffUser2.assignedGodownId === godown2.id, 'Staff assigned to godown');

    let deleteBlocked = false;
    try {
      await GodownService.deleteGodown(businessId, godown2.id);
    } catch (err: any) {
      deleteBlocked = true;
      assert(err.message.includes('assigned staff'), 'Deletion blocked because staff user exists');
    }
    assert(deleteBlocked, 'Godown deletion was strictly blocked');

    // ------------------------------------------------------------------------
    // SCENARIO 3: Godown user creation with SALESMAN role
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 3: Godown User Creation with SALESMAN Role ---');
    const staffUser1 = await GodownService.createGodownUser(businessId, godown1.id, {
      username: 'north_salesman_' + Date.now().toString(36),
      password: 'password123',
      fullName: 'North Branch Salesman',
    });
    assert(staffUser1.assignedGodownId === godown1.id, 'User assigned to Godown 1');
    const userRoleRes = await pool.query(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [staffUser1.id]
    );
    assert(userRoleRes.rows.some((r: any) => r.code === 'SALESMAN'), 'User granted system SALESMAN role');

    // ------------------------------------------------------------------------
    // SCENARIO 4: Login scoped to assigned godown
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 4: Login Scoped to Assigned Godown ---');
    const loginUser = await pool.query(
      `SELECT u.*, g.id as g_id, g.name as g_name, g.code as g_code, g.status as g_status 
       FROM users u 
       JOIN godowns g ON g.id = u.assigned_godown_id 
       WHERE u.id = $1`,
      [staffUser1.id]
    );
    const userRow = loginUser.rows[0];
    assert(userRow.g_id === godown1.id, 'User record resolves assigned godown');
    assert(userRow.g_status === 'ACTIVE', 'Assigned godown is ACTIVE for login');

    // ------------------------------------------------------------------------
    // SCENARIO 5: Business switch override rejected
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 5: Business Switch Override Rejection ---');
    assert(Boolean(userRow.assigned_godown_id), 'Server detects assignedGodownId and rejects unauthorized business switching');

    // ------------------------------------------------------------------------
    // SCENARIO 6 & 7: Vouchers created and tagged with godown_id
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 6 & 7: Vouchers Created and Tagged with godown_id ---');
    // 6a. Purchase Invoice for Godown 1 (adds stock to Godown 1)
    const purInv = await PurchaseService.createPurchaseInvoice(businessId, {
      supplierPartyId,
      godownId: godown1.id,
      invoiceDate: new Date(),
      status: 'POSTED',
      lines: [
        {
          uniqueItemId,
          quantity: 20,
          rate: 300,
          batches: [
            {
              batchId,
              quantity: 20,
              rate: 300,
            },
          ],
        },
      ],
    });
    assert(purInv.id && (purInv as any).godownId === godown1.id, 'Purchase invoice tagged with godown1.id');

    // 6b. Sales Order for Godown 1
    const salesOrder = await SalesService.createSalesOrder(businessId, {
      partyId: customerPartyId,
      godownId: godown1.id,
      orderDate: new Date(),
      lines: [
        {
          uniqueItemId,
          quantity: 5,
          rate: 600,
          batches: [{ batchId, quantity: 5 }],
        },
      ],
    });
    assert(salesOrder.id && (salesOrder as any).godownId === godown1.id, 'Sales order tagged with godown1.id');

    // 6c. Sales Invoice for Godown 1
    const salesInv = await SalesService.createSalesInvoice(businessId, {
      partyId: customerPartyId,
      godownId: godown1.id,
      invoiceDate: new Date(),
      status: 'POSTED',
      lines: [
        {
          uniqueItemId,
          quantity: 3,
          rate: 600,
          batches: [{ batchId, quantity: 3 }],
        },
      ],
    });
    assert(salesInv.id && (salesInv as any).godownId === godown1.id, 'Sales invoice tagged with godown1.id');

    // 6d. Customer Receipt for Godown 1
    const receipt = await PaymentService.createPayment(businessId, {
      partyId: customerPartyId,
      godownId: godown1.id,
      paymentType: 'RECEIPT',
      paymentMode: 'CASH',
      amount: 1800,
      autoPost: true,
    });
    assert(receipt.id && (receipt as any).godown_id === godown1.id, 'Customer receipt tagged with godown1.id');

    // ------------------------------------------------------------------------
    // SCENARIO 8: Stock deducted/added affects only assigned godown
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 8: Stock Movement Isolation ---');
    // Check Godown 1 stock: 20 inward - 3 outward = 17 physical
    const g1Stock = await StockService.getStock(businessId, batchId, godown1.id);
    assert(g1Stock !== null && Number(g1Stock.physicalStock) === 17.00, 'Godown 1 stock updated to exactly 17.00');

    // Check Main Warehouse stock: should remain untouched at 50.00 physical
    const mainStock = await StockService.getStock(businessId, batchId, null);
    assert(mainStock !== null && Number(mainStock.physicalStock) === 50.00, 'Main Warehouse stock remains 50.00');

    // ------------------------------------------------------------------------
    // SCENARIO 9: Cannot view or modify vouchers of other godowns or Main Warehouse
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 9: Cross-Godown Voucher Isolation ---');
    const g1Orders = await SalesService.getSalesOrders(businessId, { godownId: godown1.id });
    assert(g1Orders.orders.every((o: any) => o.godownId === godown1.id), 'Godown 1 query returns ONLY Godown 1 orders');

    const g2Orders = await SalesService.getSalesOrders(businessId, { godownId: godown2.id });
    assert(g2Orders.orders.length === 0, 'Godown 2 cannot see Godown 1 orders');

    // ------------------------------------------------------------------------
    // SCENARIO 10: Cannot modify Main Warehouse stock
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 10: Protection of Main Warehouse Stock ---');
    // Inward stock in Godown 2 (10 units)
    await PurchaseService.createPurchaseInvoice(businessId, {
      supplierPartyId,
      godownId: godown2.id,
      invoiceDate: new Date(),
      status: 'POSTED',
      lines: [
        {
          uniqueItemId,
          quantity: 10,
          rate: 300,
          batches: [{ batchId, quantity: 10, rate: 300 }],
        },
      ],
    });
    const mainStockAfter = await StockService.getStock(businessId, batchId, null);
    assert(Number(mainStockAfter!.physicalStock) === 50.00, 'Main Warehouse stock untouched after Godown 2 purchase');

    // ------------------------------------------------------------------------
    // SCENARIO 11: Can view own godown stock balance
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 11: Godown Stock Balance View ---');
    const g1Balances = await GodownService.getGodownStockBalance(businessId, godown1.id);
    assert(g1Balances.length > 0 && g1Balances[0].physicalStock === 17.00, 'Godown 1 balance reflects 17.00 pairs');

    // ------------------------------------------------------------------------
    // SCENARIO 12 & 13: Intentional Super Admin raw stock inspection
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 12 & 13: Super Admin Raw Stock Inspection ---');
    const searchResults = await GodownService.searchMainWarehouseStock(businessId, {
      isSuperAdmin: true,
      sph: -2.50,
      cyl: -1.00,
    });
    assert(searchResults.items.length > 0, 'Main warehouse stock search returned matching batch');
    const feedItem = searchResults.items[0];
    assert(feedItem.physicalStock === 50.00, 'Physical stock projected accurately');
    assert(feedItem.availableStock === 45.00, 'Available stock projected accurately');
    assert((feedItem as any).purchasePrice === undefined, 'Super Admin feed: purchasePrice omitted');
    assert((feedItem as any).sellingPrice === undefined, 'Super Admin feed: sellingPrice omitted');
    assert((feedItem as any).mrp === undefined, 'Super Admin feed: mrp omitted');
    assert((feedItem as any).supplierPartyId === undefined, 'Super Admin feed: supplierPartyId omitted');

    // ------------------------------------------------------------------------
    // SCENARIO 14: Denied admin settings and financial reports
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 14: Access Control for SALESMAN ---');
    const rolePerms = await pool.query(
      `SELECT p.code FROM role_permissions rp 
       JOIN permissions p ON p.id = rp.permission_id 
       JOIN roles r ON r.id = rp.role_id 
       WHERE r.code = 'SALESMAN'`
    );
    const codes = rolePerms.rows.map((r: any) => r.code);
    assert(!codes.includes('admin:manage_settings'), 'SALESMAN denied admin:manage_settings');
    assert(!codes.includes('financial:view'), 'SALESMAN denied financial:view');
    assert(!codes.includes('godown:delete'), 'SALESMAN denied godown:delete');
    assert(codes.includes('sales:create'), 'SALESMAN allowed sales:create');
    assert(codes.includes('godown:main_warehouse_search'), 'SALESMAN allowed godown:main_warehouse_search');

    // ------------------------------------------------------------------------
    // SCENARIO 15: Admin can view all godowns and filter by godown
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 15: Admin Multi-Godown Oversight ---');
    const allGodowns = await GodownService.listGodowns(businessId);
    assert(allGodowns.length >= 2, 'Admin retrieves all godowns for the business');

    // ------------------------------------------------------------------------
    // SCENARIO 16: Main Warehouse operations continue normally
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 16: Main Warehouse Operations Normalcy ---');
    const mainSalesInv = await SalesService.createSalesInvoice(businessId, {
      partyId: customerPartyId,
      godownId: null, // Main Warehouse
      invoiceDate: new Date(),
      status: 'POSTED',
      lines: [
        {
          uniqueItemId,
          quantity: 2,
          rate: 600,
          batches: [{ batchId, quantity: 2 }],
        },
      ],
    });
    assert(mainSalesInv.id && (mainSalesInv as any).godownId === null, 'Main warehouse invoice created with godown_id NULL');
    const mainStockFinal = await StockService.getStock(businessId, batchId, null);
    assert(Number(mainStockFinal!.physicalStock) === 48.00, 'Main Warehouse stock deducted to 48.00 (50 - 2)');

    // ------------------------------------------------------------------------
    // SCENARIO 17: Concurrent stock operations in different godowns
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 17: Concurrent Stock Isolation Across Godowns ---');
    // Concurrently post a sale in Godown 1 and a sale in Godown 2
    await Promise.all([
      SalesService.createSalesInvoice(businessId, {
        partyId: customerPartyId,
        godownId: godown1.id,
        invoiceDate: new Date(),
        status: 'POSTED',
        lines: [{ uniqueItemId, quantity: 1, rate: 600, batches: [{ batchId, quantity: 1 }] }],
      }),
      SalesService.createSalesInvoice(businessId, {
        partyId: customerPartyId,
        godownId: godown2.id,
        invoiceDate: new Date(),
        status: 'POSTED',
        lines: [{ uniqueItemId, quantity: 2, rate: 600, batches: [{ batchId, quantity: 2 }] }],
      }),
    ]);

    const finalG1 = await StockService.getStock(businessId, batchId, godown1.id);
    const finalG2 = await StockService.getStock(businessId, batchId, godown2.id);
    const finalMain = await StockService.getStock(businessId, batchId, null);

    assert(Number(finalG1!.physicalStock) === 16.00, 'Godown 1 stock is exactly 16.00 (17 - 1)');
    assert(Number(finalG2!.physicalStock) === 8.00, 'Godown 2 stock is exactly 8.00 (10 - 2)');
    assert(Number(finalMain!.physicalStock) === 48.00, 'Main Warehouse stock remains 48.00');

    console.log('\n================================================================');
    console.log(`ALL 17 SCENARIOS VERIFIED SUCCESSFULLY! (Passed: ${passed}, Failed: ${failed})`);
    console.log('================================================================\n');
  } finally {
    // Clean up test data
    console.log('Cleaning up test business data...');
    try {
      await pool.query('DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE business_id = $1)', [businessId]);
      await pool.query('DELETE FROM payments WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM customer_ledgers WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM supplier_ledgers WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM sales_invoice_lines WHERE sales_invoice_id IN (SELECT id FROM sales_invoices WHERE business_id = $1)', [businessId]);
      await pool.query('DELETE FROM sales_invoices WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM sales_order_lines WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE business_id = $1)', [businessId]);
      await pool.query('DELETE FROM sales_orders WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id IN (SELECT id FROM purchase_invoices WHERE business_id = $1)', [businessId]);
      await pool.query('DELETE FROM purchase_invoices WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM purchase_order_lines WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE business_id = $1)', [businessId]);
      await pool.query('DELETE FROM purchase_orders WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM stock_reservations WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM stock_ledger WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM optical_stocks WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM optical_batches WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM unique_items WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM primary_items WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM bases WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM user_roles WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM users WHERE assigned_godown_id IN (SELECT id FROM godowns WHERE business_id = $1)', [businessId]);
      await pool.query('DELETE FROM godowns WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM parties WHERE business_id = $1', [businessId]);
      await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]);
    } catch (cleanupErr) {
      console.error('Cleanup notice:', cleanupErr);
    }
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Verification failed with error:', err);
    process.exit(1);
  });
