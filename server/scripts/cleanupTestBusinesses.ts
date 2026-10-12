import { pool } from '../db/index.js';

export const RETAINED_BUSINESSES = [
  {
    id: 'c43b93ef-8569-4857-80ff-faca53b4ed7c',
    name: 'Lumina Opticals Pvt Ltd',
  },
  {
    id: '4d57ddd2-40d2-4f9c-adb4-1bc3c6227851',
    name: 'VisionCraft Optical Labs',
  },
] as const;

export const RETAINED_BUSINESS_IDS = RETAINED_BUSINESSES.map(b => b.id);

export interface CleanupResult {
  preview: {
    retainedBusinesses: Array<{ id: string; name: string }>;
    candidateBusinessesCount: number;
    candidateBusinesses: Array<{ id: string; name: string; business_type: string }>;
    estimatedCounts: Record<string, number>;
  };
  deletedCounts: Record<string, number>;
  retainedVerification: Array<{
    businessId: string;
    name: string;
    baselineCounts: Record<string, number>;
    postCounts: Record<string, number>;
  }>;
  totalBusinessesRemaining: number;
}

export async function runCleanup(options: { dryRun?: boolean } = {}): Promise<CleanupResult> {
  const client = await pool.connect();

  try {
    // ==========================================
    // STEP 1: SAFETY CHECKS & ALLOWLIST AUDIT
    // ==========================================
    console.log('[Cleanup] Step 1: Performing strict allowlist and safety validation...');
    
    // Check that both retained businesses exist
    const retainedQuery = await client.query(
      `SELECT id, name, business_type, status FROM businesses WHERE id = ANY($1::uuid[])`,
      [RETAINED_BUSINESS_IDS]
    );

    if (retainedQuery.rows.length !== 2) {
      throw new Error(
        `Safety Check Failed: Expected exactly 2 retained businesses in DB, found ${retainedQuery.rows.length}. Aborting!`
      );
    }

    for (const b of RETAINED_BUSINESSES) {
      const found = retainedQuery.rows.find(r => r.id === b.id);
      if (!found) {
        throw new Error(`Safety Check Failed: Protected business '${b.name}' (${b.id}) is missing! Aborting!`);
      }
      if (found.name.trim().toLowerCase() !== b.name.trim().toLowerCase()) {
        throw new Error(`Safety Check Failed: Business ID ${b.id} name mismatch: expected '${b.name}', found '${found.name}'! Aborting!`);
      }
    }

    // Query all candidate businesses to delete
    const candidatesQuery = await client.query(
      `SELECT id, name, business_type, parent_business_id, status FROM businesses WHERE NOT (id = ANY($1::uuid[])) ORDER BY name`,
      [RETAINED_BUSINESS_IDS]
    );
    const candidateBusinesses = candidatesQuery.rows;
    const candidateIds = candidateBusinesses.map(b => b.id);

    // Hard assert: candidateIds must NOT contain ANY retained ID
    for (const rid of RETAINED_BUSINESS_IDS) {
      if (candidateIds.includes(rid)) {
        throw new Error(`CRITICAL INTEGRITY VIOLATION: Retained business ID ${rid} was classified for deletion! Aborting!`);
      }
    }

    console.log(`[Cleanup] Verified: 2 Protected businesses excluded. ${candidateBusinesses.length} Candidate businesses scheduled for removal.`);

    // ==========================================
    // STEP 2: RECORD BASELINE FOR RETAINED BIZ
    // ==========================================
    console.log('[Cleanup] Step 2: Capturing baseline counts for protected businesses...');
    
    const countBaseline = async (bizId: string) => {
      const counts: Record<string, number> = {};
      const tables = [
        'parties', 'unique_items', 'optical_batches', 'optical_stocks',
        'stock_ledger', 'stock_reservations', 'sales_invoices', 'purchase_invoices',
        'sales_orders', 'purchase_orders', 'sales_returns', 'purchase_returns',
        'payments', 'customer_ledgers', 'supplier_ledgers', 'user_business_access',
        'user_roles', 'base_categories', 'categories', 'bases', 'coatings',
        'primary_items', 'party_item_prices', 'document_sequences', 'import_sessions'
      ];

      for (const t of tables) {
        const res = await client.query(`SELECT count(*)::int as c FROM "${t}" WHERE business_id = $1`, [bizId]);
        counts[t] = res.rows[0].c;
      }
      return counts;
    };

    const luminaBaseline = await countBaseline(RETAINED_BUSINESS_IDS[0]);
    const visioncraftBaseline = await countBaseline(RETAINED_BUSINESS_IDS[1]);

    // ==========================================
    // STEP 3: ESTIMATE COUNTS FOR DELETION
    // ==========================================
    console.log('[Cleanup] Step 3: Estimating deletion record counts across all candidate tables...');
    const estimatedCounts: Record<string, number> = {};

    if (candidateIds.length > 0) {
      // Direct business_id tables
      const directTables = [
        'audit_logs', 'base_categories', 'bases', 'business_settings', 'categories',
        'coatings', 'customer_ledgers', 'document_sequences', 'idempotency_records',
        'import_sessions', 'optical_batches', 'optical_stocks', 'parties',
        'party_item_prices', 'payment_allocations', 'payments', 'primary_items',
        'purchase_invoices', 'purchase_lots', 'purchase_orders', 'purchase_returns',
        'roles', 'sales_invoices', 'sales_orders', 'sales_returns', 'stock_ledger',
        'stock_reservations', 'supplier_ledgers', 'unique_items', 'user_business_access',
        'user_roles'
      ];

      for (const t of directTables) {
        const res = await client.query(
          `SELECT count(*)::int as c FROM "${t}" WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        estimatedCounts[t] = res.rows[0].c;
      }

      // Dealer tables
      const dealerShipmentRes = await client.query(
        `SELECT count(*)::int as c FROM dealer_shipments WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
        [candidateIds]
      );
      estimatedCounts['dealer_shipments'] = dealerShipmentRes.rows[0].c;

      const dealerReceiptRes = await client.query(
        `SELECT count(*)::int as c FROM dealer_goods_receipts WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
        [candidateIds]
      );
      estimatedCounts['dealer_goods_receipts'] = dealerReceiptRes.rows[0].c;

      const dealerOrdersRes = await client.query(
        `SELECT count(*)::int as c FROM dealer_orders WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
        [candidateIds]
      );
      estimatedCounts['dealer_orders'] = dealerOrdersRes.rows[0].c;

      const dealerReturnsRes = await client.query(
        `SELECT count(*)::int as c FROM dealer_returns WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
        [candidateIds]
      );
      estimatedCounts['dealer_returns'] = dealerReturnsRes.rows[0].c;

      const dealerAdvicesRes = await client.query(
        `SELECT count(*)::int as c FROM dealer_payment_advices WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
        [candidateIds]
      );
      estimatedCounts['dealer_payment_advices'] = dealerAdvicesRes.rows[0].c;

      estimatedCounts['businesses'] = candidateBusinesses.length;
    }

    const preview = {
      retainedBusinesses: RETAINED_BUSINESSES.map(b => ({ id: b.id, name: b.name })),
      candidateBusinessesCount: candidateBusinesses.length,
      candidateBusinesses: candidateBusinesses.map(b => ({
        id: b.id,
        name: b.name,
        business_type: b.business_type,
      })),
      estimatedCounts,
    };

    if (options.dryRun) {
      console.log('[Cleanup] Dry-run mode completed. No data was deleted.');
      return {
        preview,
        deletedCounts: {},
        retainedVerification: [
          { businessId: RETAINED_BUSINESSES[0].id, name: RETAINED_BUSINESSES[0].name, baselineCounts: luminaBaseline, postCounts: luminaBaseline },
          { businessId: RETAINED_BUSINESSES[1].id, name: RETAINED_BUSINESSES[1].name, baselineCounts: visioncraftBaseline, postCounts: visioncraftBaseline },
        ],
        totalBusinessesRemaining: 2 + candidateBusinesses.length,
      };
    }

    // ==========================================
    // STEP 4: TRANSACTIONAL DEPENDENCY DELETION
    // ==========================================
    console.log('[Cleanup] Step 4: Beginning transactional deletion of test data...');
    const deletedCounts: Record<string, number> = {};

    await client.query('BEGIN');

    try {
      if (candidateIds.length > 0) {
        // Re-verify allowlist inside transaction
        const inTxRetained = await client.query(
          `SELECT count(*)::int as c FROM businesses WHERE id = ANY($1::uuid[])`,
          [RETAINED_BUSINESS_IDS]
        );
        if (inTxRetained.rows[0].c !== 2) {
          throw new Error('Integrity Check Failed inside transaction: Retained businesses missing!');
        }

        // Helper to run delete and record count
        const runDelete = async (label: string, sql: string, params: any[]) => {
          const res = await client.query(sql, params);
          deletedCounts[label] = res.rowCount || 0;
          console.log(`[Cleanup] Deleted from ${label}: ${deletedCounts[label]} records`);
        };

        // 1. Dealer Return lines & returns
        await runDelete(
          'dealer_return_lines',
          `DELETE FROM dealer_return_lines WHERE dealer_return_id IN (
            SELECT id FROM dealer_returns WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'dealer_returns',
          `DELETE FROM dealer_returns WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 2. Dealer Goods Receipt lines & receipts
        await runDelete(
          'dealer_goods_receipt_lines',
          `DELETE FROM dealer_goods_receipt_lines WHERE goods_receipt_id IN (
            SELECT id FROM dealer_goods_receipts WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'dealer_goods_receipts',
          `DELETE FROM dealer_goods_receipts WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 3. Dealer Shipment lines & shipments
        await runDelete(
          'dealer_shipment_lines',
          `DELETE FROM dealer_shipment_lines WHERE dealer_shipment_id IN (
            SELECT id FROM dealer_shipments WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'dealer_shipments',
          `DELETE FROM dealer_shipments WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 4. Dealer Payment Advices & Orders
        await runDelete(
          'dealer_payment_advices',
          `DELETE FROM dealer_payment_advices WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'dealer_orders',
          `DELETE FROM dealer_orders WHERE dealer_business_id = ANY($1::uuid[]) OR main_business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 5. Sales Returns (batches -> lines -> returns)
        await runDelete(
          'sales_return_line_batches',
          `DELETE FROM sales_return_line_batches WHERE sales_return_line_id IN (
            SELECT l.id FROM sales_return_lines l
            JOIN sales_returns r ON l.sales_return_id = r.id
            WHERE r.business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'sales_return_lines',
          `DELETE FROM sales_return_lines WHERE sales_return_id IN (
            SELECT id FROM sales_returns WHERE business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'sales_returns',
          `DELETE FROM sales_returns WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 6. Purchase Returns (batches -> lines -> returns)
        await runDelete(
          'purchase_return_line_batches',
          `DELETE FROM purchase_return_line_batches WHERE purchase_return_line_id IN (
            SELECT l.id FROM purchase_return_lines l
            JOIN purchase_returns r ON l.purchase_return_id = r.id
            WHERE r.business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'purchase_return_lines',
          `DELETE FROM purchase_return_lines WHERE purchase_return_id IN (
            SELECT id FROM purchase_returns WHERE business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'purchase_returns',
          `DELETE FROM purchase_returns WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 7. Payment allocations & Payments
        await runDelete(
          'payment_allocations',
          `DELETE FROM payment_allocations WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'payments',
          `DELETE FROM payments WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 8. Party ledgers & prices
        await runDelete(
          'customer_ledgers',
          `DELETE FROM customer_ledgers WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'supplier_ledgers',
          `DELETE FROM supplier_ledgers WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'party_item_prices',
          `DELETE FROM party_item_prices WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 9. Purchase lots & invoices
        await runDelete(
          'purchase_lots',
          `DELETE FROM purchase_lots WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'purchase_invoice_line_batches',
          `DELETE FROM purchase_invoice_line_batches WHERE purchase_invoice_line_id IN (
            SELECT l.id FROM purchase_invoice_lines l
            JOIN purchase_invoices i ON l.purchase_invoice_id = i.id
            WHERE i.business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'purchase_invoice_lines',
          `DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id IN (
            SELECT id FROM purchase_invoices WHERE business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'purchase_invoices',
          `DELETE FROM purchase_invoices WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 10. Purchase orders
        await runDelete(
          'purchase_order_line_batches',
          `DELETE FROM purchase_order_line_batches WHERE purchase_order_line_id IN (
            SELECT l.id FROM purchase_order_lines l
            JOIN purchase_orders o ON l.purchase_order_id = o.id
            WHERE o.business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'purchase_order_lines',
          `DELETE FROM purchase_order_lines WHERE purchase_order_id IN (
            SELECT id FROM purchase_orders WHERE business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'purchase_orders',
          `DELETE FROM purchase_orders WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 11. Sales invoices
        await runDelete(
          'sales_invoice_line_batches',
          `DELETE FROM sales_invoice_line_batches WHERE sales_invoice_line_id IN (
            SELECT l.id FROM sales_invoice_lines l
            JOIN sales_invoices i ON l.sales_invoice_id = i.id
            WHERE i.business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'sales_invoice_lines',
          `DELETE FROM sales_invoice_lines WHERE sales_invoice_id IN (
            SELECT id FROM sales_invoices WHERE business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'sales_invoices',
          `DELETE FROM sales_invoices WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 12. Sales orders
        await runDelete(
          'sales_order_line_batches',
          `DELETE FROM sales_order_line_batches WHERE sales_order_line_id IN (
            SELECT l.id FROM sales_order_lines l
            JOIN sales_orders o ON l.sales_order_id = o.id
            WHERE o.business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'sales_order_lines',
          `DELETE FROM sales_order_lines WHERE sales_order_id IN (
            SELECT id FROM sales_orders WHERE business_id = ANY($1::uuid[])
          )`,
          [candidateIds]
        );
        await runDelete(
          'sales_orders',
          `DELETE FROM sales_orders WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 13. Stock reservations & stock ledger
        await runDelete(
          'stock_reservations',
          `DELETE FROM stock_reservations WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'stock_ledger',
          `DELETE FROM stock_ledger WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 14. Optical stocks & batches
        await runDelete(
          'optical_stocks',
          `DELETE FROM optical_stocks WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'optical_batches',
          `DELETE FROM optical_batches WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 15. Unique items, Primary items, Masters
        await runDelete(
          'unique_items',
          `DELETE FROM unique_items WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'primary_items',
          `DELETE FROM primary_items WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'coatings',
          `DELETE FROM coatings WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'bases',
          `DELETE FROM bases WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'base_categories',
          `DELETE FROM base_categories WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'categories',
          `DELETE FROM categories WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 16. Parties (customers & suppliers)
        await runDelete(
          'parties',
          `DELETE FROM parties WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 17. Roles & user access
        await runDelete(
          'user_roles',
          `DELETE FROM user_roles WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'role_permissions',
          `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE business_id = ANY($1::uuid[]))`,
          [candidateIds]
        );
        await runDelete(
          'roles',
          `DELETE FROM roles WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'user_business_access',
          `DELETE FROM user_business_access WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 18. Config & utilities
        await runDelete(
          'business_settings',
          `DELETE FROM business_settings WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'document_sequences',
          `DELETE FROM document_sequences WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'idempotency_records',
          `DELETE FROM idempotency_records WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'import_sessions',
          `DELETE FROM import_sessions WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );
        await runDelete(
          'audit_logs',
          `DELETE FROM audit_logs WHERE business_id = ANY($1::uuid[])`,
          [candidateIds]
        );

        // 19. Businesses:
        // First delete child dealer businesses that have parent_business_id
        await runDelete(
          'dealer_businesses',
          `DELETE FROM businesses WHERE id = ANY($1::uuid[]) AND parent_business_id IS NOT NULL`,
          [candidateIds]
        );
        // Then delete remaining parent businesses
        await runDelete(
          'main_businesses',
          `DELETE FROM businesses WHERE id = ANY($1::uuid[])`,
          [candidateIds]
        );
      }

      await client.query('COMMIT');
      console.log('[Cleanup] Transaction successfully committed.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[Cleanup] Transaction failed and rolled back:', err);
      throw err;
    }

    // ==========================================
    // STEP 5: POST-DELETION VERIFICATION
    // ==========================================
    console.log('[Cleanup] Step 5: Post-cleanup verification and baseline comparisons...');
    
    // Check remaining businesses
    const remainingBizRes = await client.query(`SELECT id, name FROM businesses ORDER BY name`);
    const totalRemaining = remainingBizRes.rows.length;
    console.log(`[Cleanup] Remaining businesses in database: ${totalRemaining}`);
    for (const b of remainingBizRes.rows) {
      console.log(` - ${b.name} (${b.id})`);
    }

    if (totalRemaining !== 2) {
      throw new Error(`Verification Failure: Expected exactly 2 businesses to remain, found ${totalRemaining}!`);
    }

    // Baseline checks
    const luminaPost = await countBaseline(RETAINED_BUSINESS_IDS[0]);
    const visioncraftPost = await countBaseline(RETAINED_BUSINESS_IDS[1]);

    return {
      preview,
      deletedCounts,
      retainedVerification: [
        {
          businessId: RETAINED_BUSINESS_IDS[0],
          name: RETAINED_BUSINESSES[0].name,
          baselineCounts: luminaBaseline,
          postCounts: luminaPost,
        },
        {
          businessId: RETAINED_BUSINESS_IDS[1],
          name: RETAINED_BUSINESSES[1].name,
          baselineCounts: visioncraftBaseline,
          postCounts: visioncraftPost,
        },
      ],
      totalBusinessesRemaining: totalRemaining,
    };
  } finally {
    client.release();
  }
}

// Direct CLI invocation
if (import.meta.url === `file://${process.argv[1]}`) {
  const isDryRun = process.argv.includes('--dry-run');
  runCleanup({ dryRun: isDryRun })
    .then(res => {
      console.log('[Cleanup Completed Successfully]');
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[Cleanup Failed]', err);
      process.exit(1);
    });
}
