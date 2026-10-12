import { pool, db } from '../db/index.js';
import { businesses, userBusinessAccess, userRoles, roles } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export const DEDICATED_TEST_BUSINESS_NAMES = [
  'TEST - Dealer A',
  'TEST - Dealer B',
  'TEST - Inventory Sandbox',
] as const;

export type DedicatedTestBusinessName = typeof DEDICATED_TEST_BUSINESS_NAMES[number];

export const PROTECTED_BUSINESS_NAMES = [
  'Lumina Opticals Pvt Ltd',
  'VisionCraft Optical Labs',
] as const;

export const PROTECTED_BUSINESS_IDS = [
  'c43b93ef-8569-4857-80ff-faca53b4ed7c',
  '4d57ddd2-40d2-4f9c-adb4-1bc3c6227851',
] as const;

/**
 * Retrieves or idempotently provisions one of the 3 authorized dedicated test businesses.
 * Reuses existing dedicated test businesses across test runs to prevent uncontrolled accumulation.
 */
export async function getOrCreateDedicatedTestBusiness(
  name: DedicatedTestBusinessName,
  options: {
    parentBusinessId?: string | null;
    businessType?: 'MAIN' | 'DEALER';
    state?: string;
    stateCode?: string;
    gstin?: string;
  } = {}
) {
  if (!DEDICATED_TEST_BUSINESS_NAMES.includes(name)) {
    throw new Error(
      `Invalid test business name: '${name}'. AI Studio test suites must only reuse dedicated test businesses: ${DEDICATED_TEST_BUSINESS_NAMES.join(', ')}`
    );
  }

  // 1. Check if already exists
  const existingRes = await pool.query(
    `SELECT id, name, business_type, parent_business_id, status, gstin, state FROM businesses WHERE name = $1 LIMIT 1`,
    [name]
  );

  if (existingRes.rows.length > 0) {
    const biz = existingRes.rows[0];
    // Update parent if specified and different
    if (options.parentBusinessId !== undefined && biz.parent_business_id !== options.parentBusinessId) {
      await pool.query(
        `UPDATE businesses SET parent_business_id = $1, updated_at = NOW() WHERE id = $2`,
        [options.parentBusinessId, biz.id]
      );
      biz.parent_business_id = options.parentBusinessId;
    }
    return biz;
  }

  // 2. Count current dedicated test businesses to enforce the <= 3 limit
  const countRes = await pool.query(
    `SELECT count(*)::int as c FROM businesses WHERE name = ANY($1::text[])`,
    [[...DEDICATED_TEST_BUSINESS_NAMES]]
  );

  if (countRes.rows[0].c >= 3) {
    throw new Error('Maximum limit of 3 dedicated test businesses reached. Reuse existing test businesses.');
  }

  // 3. Create dedicated test business with standardized attributes
  const businessType = options.businessType || (name.includes('Dealer') ? 'DEALER' : 'MAIN');
  const codeSuffix = name.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const state = options.state || 'Maharashtra';
  const stateCode = options.stateCode || '27';
  const gstin = options.gstin || `${stateCode}AABCT${codeSuffix.slice(0, 4)}1Z1`;

  const insertRes = await pool.query(
    `INSERT INTO businesses (
      name, trade_name, gstin, pan, phone, email,
      address_line1, city, state, state_code, pincode,
      business_type, parent_business_id, status, currency
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, 'ACTIVE', 'INR'
    ) RETURNING id, name, business_type, parent_business_id, status, gstin, state`,
    [
      name,
      `${name} Trade Outlet`,
      gstin,
      `AABCT${codeSuffix.slice(0, 4)}`,
      '9876543210',
      `test_${codeSuffix.toLowerCase()}@optical-erp.test`,
      'Test Hub Terminal, Phase 4',
      'Mumbai',
      state,
      stateCode,
      '400001',
      businessType,
      options.parentBusinessId || null,
    ]
  );

  return insertRes.rows[0];
}

/**
 * Safely cleans up transactional test data inside a dedicated test business without deleting
 * the business record itself or affecting protected businesses.
 */
export async function resetDedicatedTestBusinessData(businessId: string) {
  // Guard against accidental reset of protected businesses
  if (PROTECTED_BUSINESS_IDS.includes(businessId as any)) {
    throw new Error(`CRITICAL GUARD: Cannot reset data for protected business ${businessId}!`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clean dealer tables
    await client.query(
      `DELETE FROM dealer_return_lines WHERE dealer_return_id IN (SELECT id FROM dealer_returns WHERE dealer_business_id = $1 OR main_business_id = $1)`,
      [businessId]
    );
    await client.query(`DELETE FROM dealer_returns WHERE dealer_business_id = $1 OR main_business_id = $1`, [businessId]);
    await client.query(
      `DELETE FROM dealer_goods_receipt_lines WHERE goods_receipt_id IN (SELECT id FROM dealer_goods_receipts WHERE dealer_business_id = $1 OR main_business_id = $1)`,
      [businessId]
    );
    await client.query(`DELETE FROM dealer_goods_receipts WHERE dealer_business_id = $1 OR main_business_id = $1`, [businessId]);
    await client.query(
      `DELETE FROM dealer_shipment_lines WHERE dealer_shipment_id IN (SELECT id FROM dealer_shipments WHERE dealer_business_id = $1 OR main_business_id = $1)`,
      [businessId]
    );
    await client.query(`DELETE FROM dealer_shipments WHERE dealer_business_id = $1 OR main_business_id = $1`, [businessId]);
    await client.query(`DELETE FROM dealer_payment_advices WHERE dealer_business_id = $1 OR main_business_id = $1`, [businessId]);
    await client.query(`DELETE FROM dealer_orders WHERE dealer_business_id = $1 OR main_business_id = $1`, [businessId]);

    // Clean sales & purchase transactions
    await client.query(`DELETE FROM sales_return_line_batches WHERE sales_return_line_id IN (SELECT l.id FROM sales_return_lines l JOIN sales_returns r ON l.sales_return_id = r.id WHERE r.business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM sales_return_lines WHERE sales_return_id IN (SELECT id FROM sales_returns WHERE business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM sales_returns WHERE business_id = $1`, [businessId]);

    await client.query(`DELETE FROM purchase_return_line_batches WHERE purchase_return_line_id IN (SELECT l.id FROM purchase_return_lines l JOIN purchase_returns r ON l.purchase_return_id = r.id WHERE r.business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM purchase_return_lines WHERE purchase_return_id IN (SELECT id FROM purchase_returns WHERE business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM purchase_returns WHERE business_id = $1`, [businessId]);

    await client.query(`DELETE FROM payment_allocations WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM payments WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM customer_ledgers WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM supplier_ledgers WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM party_item_prices WHERE business_id = $1`, [businessId]);

    await client.query(`DELETE FROM purchase_lots WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM purchase_invoice_line_batches WHERE purchase_invoice_line_id IN (SELECT l.id FROM purchase_invoice_lines l JOIN purchase_invoices i ON l.purchase_invoice_id = i.id WHERE i.business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id IN (SELECT id FROM purchase_invoices WHERE business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM purchase_invoices WHERE business_id = $1`, [businessId]);

    await client.query(`DELETE FROM purchase_order_line_batches WHERE purchase_order_line_id IN (SELECT l.id FROM purchase_order_lines l JOIN purchase_orders o ON l.purchase_order_id = o.id WHERE o.business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM purchase_order_lines WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM purchase_orders WHERE business_id = $1`, [businessId]);

    await client.query(`DELETE FROM sales_invoice_line_batches WHERE sales_invoice_line_id IN (SELECT l.id FROM sales_invoice_lines l JOIN sales_invoices i ON l.sales_invoice_id = i.id WHERE i.business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM sales_invoice_lines WHERE sales_invoice_id IN (SELECT id FROM sales_invoices WHERE business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM sales_invoices WHERE business_id = $1`, [businessId]);

    await client.query(`DELETE FROM sales_order_line_batches WHERE sales_order_line_id IN (SELECT l.id FROM sales_order_lines l JOIN sales_orders o ON l.sales_order_id = o.id WHERE o.business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM sales_order_lines WHERE sales_order_id IN (SELECT id FROM sales_orders WHERE business_id = $1)`, [businessId]);
    await client.query(`DELETE FROM sales_orders WHERE business_id = $1`, [businessId]);

    await client.query(`DELETE FROM stock_reservations WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM stock_ledger WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM optical_stocks WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM optical_batches WHERE business_id = $1`, [businessId]);
    await client.query(`DELETE FROM unique_items WHERE business_id = $1`, [businessId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
