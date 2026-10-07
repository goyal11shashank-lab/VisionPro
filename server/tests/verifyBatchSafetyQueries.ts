import { pool } from '../db/index.js';

async function test() {
  const dummyBatchId = '00000000-0000-0000-0000-000000000000';
  const queries = [
    {
      name: '1. sales_invoices',
      sql: `SELECT si.id AS doc_id, si.invoice_number AS doc_number, si.status AS doc_status, si.invoice_date AS doc_date, silb.quantity, p.name AS party_name
            FROM sales_invoice_line_batches silb
            JOIN sales_invoice_lines sil ON silb.sales_invoice_line_id = sil.id
            JOIN sales_invoices si ON sil.sales_invoice_id = si.id
            LEFT JOIN parties p ON si.party_id = p.id
            WHERE silb.batch_id = $1`
    },
    {
      name: '2. purchase_invoices',
      sql: `SELECT pi.id AS doc_id, pi.invoice_number AS doc_number, pi.status AS doc_status, pi.invoice_date AS doc_date, pilb.quantity, p.name AS party_name
            FROM purchase_invoice_line_batches pilb
            JOIN purchase_invoice_lines pil ON pilb.purchase_invoice_line_id = pil.id
            JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
            LEFT JOIN parties p ON pi.supplier_party_id = p.id
            WHERE pilb.batch_id = $1`
    },
    {
      name: '3. purchase_lots',
      sql: `SELECT pl.id AS doc_id, COALESCE(pi.invoice_number, 'LOT-' || SUBSTRING(pl.id::text, 1, 8)) AS doc_number, 'ACTIVE' AS doc_status, pl.received_at AS doc_date, pl.quantity_received AS quantity
            FROM purchase_lots pl
            LEFT JOIN purchase_invoices pi ON pl.purchase_invoice_id = pi.id
            WHERE pl.batch_id = $1`
    },
    {
      name: '4. sales_returns',
      sql: `SELECT sr.id AS doc_id, sr.return_number AS doc_number, sr.status AS doc_status, sr.return_date AS doc_date, srlb.quantity, p.name AS party_name
            FROM sales_return_line_batches srlb
            JOIN sales_return_lines srl ON srlb.sales_return_line_id = srl.id
            JOIN sales_returns sr ON srl.sales_return_id = sr.id
            LEFT JOIN parties p ON sr.party_id = p.id
            WHERE srlb.batch_id = $1`
    },
    {
      name: '5. purchase_returns',
      sql: `SELECT pr.id AS doc_id, pr.return_number AS doc_number, pr.status AS doc_status, pr.return_date AS doc_date, prlb.quantity, p.name AS party_name
            FROM purchase_return_line_batches prlb
            JOIN purchase_return_lines prl ON prlb.purchase_return_line_id = prl.id
            JOIN purchase_returns pr ON prl.purchase_return_id = pr.id
            LEFT JOIN parties p ON pr.supplier_party_id = p.id
            WHERE prlb.batch_id = $1`
    },
    {
      name: '6. sales_orders',
      sql: `SELECT so.id AS doc_id, so.order_number AS doc_number, so.status AS doc_status, so.order_date AS doc_date, solb.quantity, p.name AS party_name
            FROM sales_order_line_batches solb
            JOIN sales_order_lines sol ON solb.sales_order_line_id = sol.id
            JOIN sales_orders so ON sol.sales_order_id = so.id
            LEFT JOIN parties p ON so.party_id = p.id
            WHERE solb.batch_id = $1`
    },
    {
      name: '6B. purchase_orders',
      sql: `SELECT po.id AS doc_id, po.order_number AS doc_number, po.status AS doc_status, po.order_date AS doc_date, polb.quantity, p.name AS party_name
            FROM purchase_order_line_batches polb
            JOIN purchase_order_lines pol ON polb.purchase_order_line_id = pol.id
            JOIN purchase_orders po ON pol.purchase_order_id = po.id
            LEFT JOIN parties p ON po.supplier_party_id = p.id
            WHERE polb.batch_id = $1`
    },
    {
      name: '6C1. dealer_shipment_lines',
      sql: `SELECT ds.id AS doc_id, ds.shipment_number AS doc_number, ds.status AS doc_status, ds.dispatch_date AS doc_date, dsl.dispatched_quantity AS quantity, 'Dealer Shipment' AS party_name
            FROM dealer_shipment_lines dsl
            JOIN dealer_shipments ds ON dsl.dealer_shipment_id = ds.id
            WHERE dsl.main_batch_id = $1`
    },
    {
      name: '6C2. dealer_goods_receipt_lines',
      sql: `SELECT dgr.id AS doc_id, dgr.receipt_number AS doc_number, dgr.status AS doc_status, dgr.receipt_date AS doc_date, dgrl.received_quantity AS quantity, 'Dealer Goods Receipt' AS party_name
            FROM dealer_goods_receipt_lines dgrl
            JOIN dealer_goods_receipts dgr ON dgrl.goods_receipt_id = dgr.id
            WHERE dgrl.main_batch_id = $1 OR dgrl.dealer_batch_id = $1`
    },
    {
      name: '6C3. dealer_return_lines',
      sql: `SELECT dr.id AS doc_id, dr.return_number AS doc_number, dr.status AS doc_status, dr.created_at AS doc_date, drl.sent_quantity AS quantity, 'Dealer Return' AS party_name
            FROM dealer_return_lines drl
            JOIN dealer_returns dr ON drl.dealer_return_id = dr.id
            WHERE drl.main_batch_id = $1 OR drl.dealer_batch_id = $1`
    },
    {
      name: '7. stock_ledger',
      sql: `SELECT id, transaction_type, reference_type, reference_id, quantity_in, quantity_out, balance, reason, created_at
            FROM stock_ledger WHERE batch_id = $1 ORDER BY created_at ASC`
    },
    {
      name: '8. optical_stocks',
      sql: `SELECT COALESCE(physical_stock, 0) AS physical_stock, COALESCE(reserved_stock, 0) AS reserved_stock, COALESCE(available_stock, 0) AS available_stock
            FROM optical_stocks WHERE batch_id = $1`
    },
    {
      name: '9. stock_reservations',
      sql: `SELECT COUNT(*)::int AS count FROM stock_reservations WHERE batch_id = $1 AND status = 'ACTIVE'`
    }
  ];

  let allPassed = true;
  for (const q of queries) {
    try {
      await pool.query(q.sql, [dummyBatchId]);
      console.log('✓ ' + q.name + ' PASSED');
    } catch (e: any) {
      console.error('✗ ' + q.name + ' FAILED: ' + e.message);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('ALL SQL queries in checkBatchDeletionSafety are 100% VALID!');
  } else {
    process.exit(1);
  }
  process.exit(0);
}

test();
