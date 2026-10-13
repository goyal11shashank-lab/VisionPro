import { pool } from '../db/index.js';

async function runTests() {
  console.log('=== Running Voucher Usage Count Verification Test ===\n');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Create two test businesses
    const b1Res = await client.query(`
      INSERT INTO businesses (name, currency, status)
      VALUES ('Voucher Test Biz 1', 'INR', 'ACTIVE')
      RETURNING id
    `);
    const biz1Id = b1Res.rows[0].id;

    const b2Res = await client.query(`
      INSERT INTO businesses (name, currency, status)
      VALUES ('Voucher Test Biz 2', 'INR', 'ACTIVE')
      RETURNING id
    `);
    const biz2Id = b2Res.rows[0].id;

    // Create Category & Stock Item for Biz 1 & Biz 2
    const cat1Res = await client.query(`
      INSERT INTO categories (business_id, name, code)
      VALUES ($1, 'Single Vision', 'SV')
      RETURNING id
    `, [biz1Id]);
    const cat1Id = cat1Res.rows[0].id;

    const cat2Res = await client.query(`
      INSERT INTO categories (business_id, name, code)
      VALUES ($1, 'Single Vision', 'SV')
      RETURNING id
    `, [biz2Id]);
    const cat2Id = cat2Res.rows[0].id;

    const item1Res = await client.query(`
      INSERT INTO unique_items (business_id, name, code, optical_category)
      VALUES ($1, 'Test Lens Item 1', 'ITEM-001', 'SV')
      RETURNING id
    `, [biz1Id]);
    const item1Id = item1Res.rows[0].id;

    const item2Res = await client.query(`
      INSERT INTO unique_items (business_id, name, code, optical_category)
      VALUES ($1, 'Test Lens Item 2', 'ITEM-002', 'SV')
      RETURNING id
    `, [biz2Id]);
    const item2Id = item2Res.rows[0].id;

    // Create parties
    const cust1Res = await client.query(`
      INSERT INTO parties (business_id, party_code, name, party_type)
      VALUES ($1, 'CUST-001', 'Test Customer 1', 'CUSTOMER')
      RETURNING id
    `, [biz1Id]);
    const cust1Id = cust1Res.rows[0].id;

    const supp1Res = await client.query(`
      INSERT INTO parties (business_id, party_code, name, party_type)
      VALUES ($1, 'SUPP-001', 'Test Supplier 1', 'SUPPLIER')
      RETURNING id
    `, [biz1Id]);
    const supp1Id = supp1Res.rows[0].id;

    // Create Batches:
    // Batch 1 (Biz 1): 0 vouchers
    const batch1Res = await client.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, identity_key)
      VALUES ($1, $2, $3, 'BARCODE-001', -2.00, -0.50, 'KEY-001')
      RETURNING id
    `, [biz1Id, item1Id, cat1Id]);
    const batch1Id = batch1Res.rows[0].id;

    // Batch 2 (Biz 1): 1 sales voucher
    const batch2Res = await client.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, identity_key)
      VALUES ($1, $2, $3, 'BARCODE-002', -2.00, -0.50, 'KEY-002')
      RETURNING id
    `, [biz1Id, item1Id, cat1Id]);
    const batch2Id = batch2Res.rows[0].id;

    // Batch 3 (Biz 1): multiple sales vouchers (2 sales invoices)
    const batch3Res = await client.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, identity_key)
      VALUES ($1, $2, $3, 'BARCODE-003', -3.00, 0.00, 'KEY-003')
      RETURNING id
    `, [biz1Id, item1Id, cat1Id]);
    const batch3Id = batch3Res.rows[0].id;

    // Batch 4 (Biz 1): purchase voucher
    const batch4Res = await client.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, identity_key)
      VALUES ($1, $2, $3, 'BARCODE-004', -4.00, 0.00, 'KEY-004')
      RETURNING id
    `, [biz1Id, item1Id, cat1Id]);
    const batch4Id = batch4Res.rows[0].id;

    // Batch 5 (Biz 1): used MULTIPLE TIMES within a single voucher (2 lines on the same invoice)
    const batch5Res = await client.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, identity_key)
      VALUES ($1, $2, $3, 'BARCODE-005', -5.00, 0.00, 'KEY-005')
      RETURNING id
    `, [biz1Id, item1Id, cat1Id]);
    const batch5Id = batch5Res.rows[0].id;

    // Batch 6 (Biz 2): Matching power combination in a DIFFERENT business
    const batch6Res = await client.query(`
      INSERT INTO optical_batches (business_id, unique_item_id, category_id, barcode, sph, cyl, identity_key)
      VALUES ($1, $2, $3, 'BARCODE-006', -2.00, -0.50, 'KEY-006')
      RETURNING id
    `, [biz2Id, item2Id, cat2Id]);
    const batch6Id = batch6Res.rows[0].id;

    // Create vouchers:
    // Voucher A: Sales Invoice 1 (POSTED) in Biz 1 -> uses Batch 2
    const si1Res = await client.query(`
      INSERT INTO sales_invoices (business_id, party_id, invoice_number, status)
      VALUES ($1, $2, 'SI-TEST-001', 'POSTED')
      RETURNING id
    `, [biz1Id, cust1Id]);
    const si1Id = si1Res.rows[0].id;
    const sil1Res = await client.query(`
      INSERT INTO sales_invoice_lines (sales_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 1, 100, 100, 100)
      RETURNING id
    `, [si1Id, item1Id]);
    await client.query(`
      INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
      VALUES ($1, $2, 1)
    `, [sil1Res.rows[0].id, batch2Id]);

    // Voucher B: Sales Invoice 2 (POSTED) in Biz 1 -> uses Batch 3
    const si2Res = await client.query(`
      INSERT INTO sales_invoices (business_id, party_id, invoice_number, status)
      VALUES ($1, $2, 'SI-TEST-002', 'POSTED')
      RETURNING id
    `, [biz1Id, cust1Id]);
    const si2Id = si2Res.rows[0].id;
    const sil2Res = await client.query(`
      INSERT INTO sales_invoice_lines (sales_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 1, 100, 100, 100)
      RETURNING id
    `, [si2Id, item1Id]);
    await client.query(`
      INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
      VALUES ($1, $2, 1)
    `, [sil2Res.rows[0].id, batch3Id]);

    // Voucher C: Sales Invoice 3 (POSTED) in Biz 1 -> ALSO uses Batch 3
    const si3Res = await client.query(`
      INSERT INTO sales_invoices (business_id, party_id, invoice_number, status)
      VALUES ($1, $2, 'SI-TEST-003', 'POSTED')
      RETURNING id
    `, [biz1Id, cust1Id]);
    const si3Id = si3Res.rows[0].id;
    const sil3Res = await client.query(`
      INSERT INTO sales_invoice_lines (sales_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 1, 100, 100, 100)
      RETURNING id
    `, [si3Id, item1Id]);
    await client.query(`
      INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
      VALUES ($1, $2, 1)
    `, [sil3Res.rows[0].id, batch3Id]);

    // Voucher D: Purchase Invoice 1 (POSTED) in Biz 1 -> uses Batch 4
    const pi1Res = await client.query(`
      INSERT INTO purchase_invoices (business_id, supplier_party_id, invoice_number, invoice_date, status)
      VALUES ($1, $2, 'PI-TEST-001', NOW(), 'POSTED')
      RETURNING id
    `, [biz1Id, supp1Id]);
    const pi1Id = pi1Res.rows[0].id;
    const pil1Res = await client.query(`
      INSERT INTO purchase_invoice_lines (purchase_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 2, 50, 100, 100)
      RETURNING id
    `, [pi1Id, item1Id]);
    await client.query(`
      INSERT INTO purchase_invoice_line_batches (purchase_invoice_line_id, batch_id, quantity, rate, total_cost)
      VALUES ($1, $2, 2, 50, 100)
    `, [pil1Res.rows[0].id, batch4Id]);

    // Voucher E: Sales Invoice 4 (POSTED) in Biz 1 -> uses Batch 5 MULTIPLE TIMES
    const si4Res = await client.query(`
      INSERT INTO sales_invoices (business_id, party_id, invoice_number, status)
      VALUES ($1, $2, 'SI-TEST-004', 'POSTED')
      RETURNING id
    `, [biz1Id, cust1Id]);
    const si4Id = si4Res.rows[0].id;
    const sil4a = await client.query(`
      INSERT INTO sales_invoice_lines (sales_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 1, 100, 100, 100)
      RETURNING id
    `, [si4Id, item1Id]);
    const sil4b = await client.query(`
      INSERT INTO sales_invoice_lines (sales_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 2, 100, 200, 200)
      RETURNING id
    `, [si4Id, item1Id]);
    await client.query(`
      INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
      VALUES ($1, $2, 1)
    `, [sil4a.rows[0].id, batch5Id]);
    await client.query(`
      INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
      VALUES ($1, $2, 2)
    `, [sil4b.rows[0].id, batch5Id]);

    // Voucher F: CANCELLED Sales Invoice in Biz 1 -> uses Batch 1 (must be excluded!)
    const siCancelRes = await client.query(`
      INSERT INTO sales_invoices (business_id, party_id, invoice_number, status)
      VALUES ($1, $2, 'SI-TEST-CANCELLED', 'CANCELLED')
      RETURNING id
    `, [biz1Id, cust1Id]);
    const silCancel = await client.query(`
      INSERT INTO sales_invoice_lines (sales_invoice_id, unique_item_id, quantity, rate, taxable_amount, line_total)
      VALUES ($1, $2, 1, 100, 100, 100)
      RETURNING id
    `, [siCancelRes.rows[0].id, item1Id]);
    await client.query(`
      INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
      VALUES ($1, $2, 1)
    `, [silCancel.rows[0].id, batch1Id]);

    // Query helper function mimicking our production SQL logic
    async function getVoucherCountsForBiz(bizId: string) {
      const q = `
        SELECT
          ob.id AS batch_id,
          ob.barcode,
          COALESCE(vu.voucher_count, 0)::int AS voucher_count
        FROM optical_batches ob
        LEFT JOIN (
          SELECT
            b_usage.batch_id,
            COUNT(DISTINCT b_usage.voucher_id)::int AS voucher_count
          FROM (
            SELECT silb.batch_id, si.id AS voucher_id
            FROM sales_invoice_line_batches silb
            JOIN sales_invoice_lines sil ON silb.sales_invoice_line_id = sil.id
            JOIN sales_invoices si ON sil.sales_invoice_id = si.id
            WHERE si.business_id = $1 AND si.status NOT IN ('CANCELLED', 'DRAFT')

            UNION ALL

            SELECT pilb.batch_id, pi.id AS voucher_id
            FROM purchase_invoice_line_batches pilb
            JOIN purchase_invoice_lines pil ON pilb.purchase_invoice_line_id = pil.id
            JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
            WHERE pi.business_id = $1 AND pi.status NOT IN ('CANCELLED', 'DRAFT')

            UNION ALL

            SELECT srlb.batch_id, sr.id AS voucher_id
            FROM sales_return_line_batches srlb
            JOIN sales_return_lines srl ON srlb.sales_return_line_id = srl.id
            JOIN sales_returns sr ON srl.sales_return_id = sr.id
            WHERE sr.business_id = $1 AND sr.status NOT IN ('CANCELLED', 'DRAFT')

            UNION ALL

            SELECT prlb.batch_id, pr.id AS voucher_id
            FROM purchase_return_line_batches prlb
            JOIN purchase_return_lines prl ON prlb.purchase_return_line_id = prl.id
            JOIN purchase_returns pr ON prl.purchase_return_id = pr.id
            WHERE pr.business_id = $1 AND pr.status NOT IN ('CANCELLED', 'DRAFT')
          ) b_usage
          GROUP BY b_usage.batch_id
        ) vu ON ob.id = vu.batch_id
        WHERE ob.business_id = $1
      `;
      const res = await client.query(q, [bizId]);
      const map: Record<string, number> = {};
      for (const r of res.rows) {
        map[r.batch_id] = r.voucher_count;
      }
      return map;
    }

    const biz1Counts = await getVoucherCountsForBiz(biz1Id);
    const biz2Counts = await getVoucherCountsForBiz(biz2Id);

    console.log('Test Results:');

    // Case 1: Batch 1 has NO active voucher usage (cancelled invoice must be excluded)
    const c1 = biz1Counts[batch1Id];
    console.log(`- Case 1: Batch 1 (no voucher usage, cancelled excluded): ${c1} (Expected: 0) -> ${c1 === 0 ? 'PASS' : 'FAIL'}`);
    if (c1 !== 0) throw new Error('Case 1 failed');

    // Case 2: Batch 2 has ONE sales voucher
    const c2 = biz1Counts[batch2Id];
    console.log(`- Case 2: Batch 2 (one sales voucher): ${c2} (Expected: 1) -> ${c2 === 1 ? 'PASS' : 'FAIL'}`);
    if (c2 !== 1) throw new Error('Case 2 failed');

    // Case 3: Batch 3 has MULTIPLE sales vouchers (SI-002 and SI-003)
    const c3 = biz1Counts[batch3Id];
    console.log(`- Case 3: Batch 3 (multiple sales vouchers): ${c3} (Expected: 2) -> ${c3 === 2 ? 'PASS' : 'FAIL'}`);
    if (c3 !== 2) throw new Error('Case 3 failed');

    // Case 4: Batch 4 has purchase vouchers
    const c4 = biz1Counts[batch4Id];
    console.log(`- Case 4: Batch 4 (purchase voucher): ${c4} (Expected: 1) -> ${c4 === 1 ? 'PASS' : 'FAIL'}`);
    if (c4 !== 1) throw new Error('Case 4 failed');

    // Case 5: Batch 5 used MULTIPLE TIMES within a single voucher (2 lines in SI-004)
    const c5 = biz1Counts[batch5Id];
    console.log(`- Case 5: Batch 5 (same batch used multiple times in 1 voucher): ${c5} (Expected: 1 distinct voucher) -> ${c5 === 1 ? 'PASS' : 'FAIL'}`);
    if (c5 !== 1) throw new Error('Case 5 failed');

    // Case 6: Matching power combination belonging to different batch records
    console.log(`- Case 6: Matching power combinations on different batches: Batch 1 = ${c1}, Batch 2 = ${c2} -> ${c1 === 0 && c2 === 1 ? 'PASS' : 'FAIL'}`);
    if (c1 !== 0 || c2 !== 1) throw new Error('Case 6 failed');

    // Case 7: Data in two different businesses
    const c6 = biz2Counts[batch6Id];
    console.log(`- Case 7: Data in two different businesses: Batch 6 in Biz 2 = ${c6} (Expected: 0) -> ${c6 === 0 ? 'PASS' : 'FAIL'}`);
    if (c6 !== 0) throw new Error('Case 7 failed');

    // Rollback test changes to leave database pristine
    await client.query('ROLLBACK');
    console.log('\nAll 7 test cases passed! Database transaction rolled back cleanly.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Test execution failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
