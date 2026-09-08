import { pool } from '../index.js';

export async function runMigration0003() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('[Migration 0003] Creating purchase_orders tables...');

    // 1. Purchase Orders Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        supplier_party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        order_number VARCHAR(100) NOT NULL,
        order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expected_delivery_date TIMESTAMPTZ,
        gst_mode VARCHAR(20) NOT NULL DEFAULT 'INTRA_STATE',
        subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        discount_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        igst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
        igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        cgst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
        cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        sgst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
        sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        round_off NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
        notes TEXT,
        supplier_reference VARCHAR(100),
        converted_invoice_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT uq_purchase_order_number UNIQUE (business_id, order_number)
      );

      CREATE INDEX IF NOT EXISTS purchase_orders_biz_idx ON purchase_orders(business_id);
      CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON purchase_orders(supplier_party_id);
      CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders(status);
      CREATE INDEX IF NOT EXISTS purchase_orders_date_idx ON purchase_orders(order_date);

      CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        unique_item_id UUID NOT NULL REFERENCES unique_items(id) ON DELETE RESTRICT,
        quantity NUMERIC(12, 2) NOT NULL,
        rate NUMERIC(12, 2) NOT NULL,
        discount_type VARCHAR(20) NOT NULL DEFAULT 'NONE',
        discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        gst_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
        tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        line_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS purchase_order_lines_order_idx ON purchase_order_lines(purchase_order_id);
      CREATE INDEX IF NOT EXISTS purchase_order_lines_item_idx ON purchase_order_lines(unique_item_id);

      CREATE TABLE IF NOT EXISTS purchase_order_line_batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
        batch_id UUID NOT NULL REFERENCES optical_batches(id) ON DELETE RESTRICT,
        quantity NUMERIC(12, 2) NOT NULL,
        rate NUMERIC(12, 2),
        total_cost NUMERIC(12, 2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS purchase_order_line_batches_line_idx ON purchase_order_line_batches(purchase_order_line_id);
      CREATE INDEX IF NOT EXISTS purchase_order_line_batches_batch_idx ON purchase_order_line_batches(batch_id);

      ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS purchase_invoices_order_idx ON purchase_invoices(purchase_order_id);
    `);

    // 2. Safe migration of existing Draft Sales Invoices to Sales Orders
    console.log('[Migration 0003] Checking existing DRAFT sales invoices...');
    const draftInvoicesRes = await client.query(`
      SELECT * FROM sales_invoices WHERE status = 'DRAFT' ORDER BY created_at ASC
    `);

    console.log(`[Migration 0003] Found ${draftInvoicesRes.rows.length} DRAFT sales invoices to migrate.`);

    for (const inv of draftInvoicesRes.rows) {
      // Generate a unique order number for this business
      const orderSeqRes = await client.query(
        `SELECT order_number FROM sales_orders WHERE business_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [inv.business_id]
      );
      let maxNum = 0;
      for (const row of orderSeqRes.rows) {
        const match = (row.order_number || '').match(/SO-(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
      const nextNum = String(maxNum + 1).padStart(6, '0');
      const orderNumber = `SO-${nextNum}`;

      console.log(`[Migration 0003] Migrating draft invoice ${inv.invoice_number} -> ${orderNumber}`);

      // Insert sales_order
      const soRes = await client.query(
        `INSERT INTO sales_orders (
          business_id, party_id, order_number, order_date,
          subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, notes,
          created_at, updated_at, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, 'CONFIRMED', $16,
          $17, $18, $19, $20
        ) RETURNING id`,
        [
          inv.business_id,
          inv.party_id,
          orderNumber,
          inv.invoice_date,
          inv.subtotal,
          inv.discount_total,
          inv.taxable_amount,
          inv.igst_rate,
          inv.igst_amount,
          inv.cgst_rate,
          inv.cgst_amount,
          inv.sgst_rate,
          inv.sgst_amount,
          inv.round_off,
          inv.grand_total,
          inv.notes ? `${inv.notes} (Migrated from draft invoice ${inv.invoice_number})` : `Migrated from draft invoice ${inv.invoice_number}`,
          inv.created_at,
          inv.updated_at,
          inv.created_by,
          inv.updated_by,
        ]
      );

      const salesOrderId = soRes.rows[0].id;

      // Fetch invoice lines
      const linesRes = await client.query(
        `SELECT * FROM sales_invoice_lines WHERE sales_invoice_id = $1`,
        [inv.id]
      );

      for (const line of linesRes.rows) {
        const soLineRes = await client.query(
          `INSERT INTO sales_order_lines (
            sales_order_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
          [
            salesOrderId,
            line.unique_item_id,
            line.quantity,
            line.rate,
            line.discount_type || 'NONE',
            line.discount_value || 0,
            line.discount_amount || 0,
            line.taxable_amount,
            line.gst_rate || 0,
            line.tax_amount || 0,
            line.line_total,
            line.created_at,
            line.updated_at,
          ]
        );

        const soLineId = soLineRes.rows[0].id;

        // Fetch invoice line batches
        const batchesRes = await client.query(
          `SELECT * FROM sales_invoice_line_batches WHERE sales_invoice_line_id = $1`,
          [line.id]
        );

        for (const b of batchesRes.rows) {
          await client.query(
            `INSERT INTO sales_order_line_batches (
              sales_order_line_id, batch_id, quantity, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $4)`,
            [soLineId, b.batch_id, b.quantity, b.created_at]
          );

          const qtyNum = parseFloat(b.quantity);

          // Reserve stock for this order
          await client.query(
            `INSERT INTO stock_reservations (
              business_id, batch_id, quantity, status, reference_type, reference_id, notes, created_by, created_at
            ) VALUES ($1, $2, $3, 'ACTIVE', 'SALES_ORDER', $4, $5, $6, $7)`,
            [
              inv.business_id,
              b.batch_id,
              qtyNum,
              salesOrderId,
              `Auto-reserved on migration of order ${orderNumber}`,
              inv.created_by,
              inv.created_at,
            ]
          );

          // Update optical_stocks
          await client.query(
            `UPDATE optical_stocks 
             SET reserved_stock = reserved_stock + $1,
                 available_stock = physical_stock - (reserved_stock + $1),
                 updated_at = NOW()
             WHERE business_id = $2 AND batch_id = $3`,
            [qtyNum, inv.business_id, b.batch_id]
          );

          // Stock ledger entry for reservation
          const curStockRes = await client.query(
            `SELECT physical_stock FROM optical_stocks WHERE business_id = $1 AND batch_id = $2`,
            [inv.business_id, b.batch_id]
          );
          const currentBal = curStockRes.rows.length > 0 ? parseFloat(curStockRes.rows[0].physical_stock) : 0;

          await client.query(
            `INSERT INTO stock_ledger (
              business_id, batch_id, transaction_type, reference_type, reference_id,
              quantity_in, quantity_out, reserved_in, reserved_out, balance, reason, created_by, created_at
            ) VALUES ($1, $2, 'RESERVATION', 'SALES_ORDER', $3, 0, 0, $4, 0, $5, $6, $7, $8)`,
            [
              inv.business_id,
              b.batch_id,
              salesOrderId,
              qtyNum,
              currentBal,
              `Reserved for Sales Order ${orderNumber} (migrated from draft invoice ${inv.invoice_number})`,
              inv.created_by,
              inv.created_at,
            ]
          );
        }
      }

      // Delete draft invoice lines and batches, then invoice
      await client.query(`
        DELETE FROM sales_invoice_line_batches 
        WHERE sales_invoice_line_id IN (SELECT id FROM sales_invoice_lines WHERE sales_invoice_id = $1)
      `, [inv.id]);

      await client.query(`DELETE FROM sales_invoice_lines WHERE sales_invoice_id = $1`, [inv.id]);
      await client.query(`DELETE FROM sales_invoices WHERE id = $1`, [inv.id]);
    }

    await client.query('COMMIT');
    console.log('[Migration 0003] Completed successfully.');
    return { success: true, migratedCount: draftInvoicesRes.rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration 0003 Error]', err);
    throw err;
  } finally {
    client.release();
  }
}

if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('0003_purchase_orders_and_draft_migration.ts')) {
  runMigration0003()
    .then((res) => {
      console.log('Done:', res);
      pool.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}
