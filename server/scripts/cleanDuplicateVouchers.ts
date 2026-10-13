import { pool } from '../db/index.js';

interface StockLedgerRow {
  id: string;
  batch_id: string;
  business_id: string;
  transaction_type: string;
  reference_type: string | null;
  reference_id: string | null;
  quantity_in: string;
  quantity_out: string;
  balance: string;
  reason: string | null;
  created_at: Date;
}

export async function runVoucherCleanup() {
  const bizId = 'c43b93ef-8569-4857-80ff-faca53b4ed7c'; // Lumina Opticals Pvt Ltd
  console.log('--- Starting Voucher Cleanup for Lumina Opticals Pvt Ltd ---');

  const client = await pool.connect();

  try {
    // -------------------------------------------------------------
    // PART 1: For item bcbprog+3sph, delete voucher type stock adjustment
    // -------------------------------------------------------------
    console.log('\n[Part 1] Processing item bcbprog+3sph: delete voucher type stock adjustment...');

    const itemRes = await client.query(`
      SELECT id, name, code
      FROM unique_items
      WHERE business_id = $1 AND (code ILIKE 'BCBPROG+3SPH' OR name ILIKE '%bcb%prog%+3%sph%')
    `, [bizId]);

    if (itemRes.rows.length === 0) {
      throw new Error('Item bcbprog+3sph not found in business Lumina Opticals');
    }

    const bcbItem = itemRes.rows[0];
    console.log(`Found target item: "${bcbItem.name}" (${bcbItem.code}), ID: ${bcbItem.id}`);

    // Fetch all STOCK_ADJUSTMENT vouchers for batches of this item
    const adjustmentsRes = await client.query<StockLedgerRow>(`
      SELECT sl.*
      FROM stock_ledger sl
      JOIN optical_batches ob ON ob.id = sl.batch_id
      WHERE sl.business_id = $1
        AND ob.unique_item_id = $2
        AND sl.transaction_type = 'STOCK_ADJUSTMENT'
      ORDER BY sl.batch_id, sl.created_at ASC
    `, [bizId, bcbItem.id]);

    console.log(`Found ${adjustmentsRes.rows.length} STOCK_ADJUSTMENT vouchers for item ${bcbItem.code}.`);

    let adjustmentsDeleted = 0;
    for (const adjRow of adjustmentsRes.rows) {
      await client.query('BEGIN');
      try {
        const qtyIn = parseFloat(adjRow.quantity_in) || 0;
        const qtyOut = parseFloat(adjRow.quantity_out) || 0;
        const netAdjustment = qtyIn - qtyOut;

        // 1. Delete the adjustment voucher from stock_ledger
        await client.query(`
          DELETE FROM stock_ledger
          WHERE id = $1 AND business_id = $2
        `, [adjRow.id, bizId]);

        // 2. Adjust optical_stocks (reduce physical & available stock by net added stock)
        await client.query(`
          UPDATE optical_stocks
          SET 
            physical_stock = GREATEST(0, physical_stock - $1),
            available_stock = GREATEST(0, (physical_stock - $1) - reserved_stock),
            updated_at = NOW()
          WHERE batch_id = $2 AND business_id = $3
        `, [netAdjustment, adjRow.batch_id, bizId]);

        // 3. Recalculate running balances for this batch
        await client.query(`
          WITH calculated AS (
            SELECT id,
              SUM(quantity_in::numeric - quantity_out::numeric) OVER (
                PARTITION BY batch_id ORDER BY created_at ASC, id ASC
              ) as calc_balance
            FROM stock_ledger
            WHERE batch_id = $1
          )
          UPDATE stock_ledger sl
          SET balance = calculated.calc_balance
          FROM calculated
          WHERE sl.id = calculated.id
        `, [adjRow.batch_id]);

        await client.query('COMMIT');
        adjustmentsDeleted++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error deleting adjustment ${adjRow.id} for batch ${adjRow.batch_id}:`, err);
        throw err;
      }
    }

    console.log(`✓ Successfully deleted ${adjustmentsDeleted} STOCK_ADJUSTMENT vouchers for item ${bcbItem.code}.`);

    // -------------------------------------------------------------
    // PART 2: Check for optical batches with duplicate vouchers for opening stock initial entry.
    // DELETE duplicate identical opening stock initial entry, keeping one.
    // Check across all batches of all stock items.
    // -------------------------------------------------------------
    console.log('\n[Part 2] Processing optical batches with duplicate opening stock entries across all stock items...');

    // Find all batches in Lumina Opticals that have > 1 OPENING_STOCK entry
    const dupBatchesRes = await client.query<{ batch_id: string; barcode: string; item_name: string; count: string }>(`
      SELECT ob.id as batch_id, ob.barcode, ui.name as item_name, count(sl.id) as count
      FROM optical_batches ob
      JOIN unique_items ui ON ui.id = ob.unique_item_id
      JOIN stock_ledger sl ON sl.batch_id = ob.id AND sl.business_id = $1
      WHERE ob.business_id = $1 AND sl.transaction_type = 'OPENING_STOCK'
      GROUP BY ob.id, ob.barcode, ui.name
      HAVING count(sl.id) > 1
      ORDER BY ui.name, ob.barcode
    `, [bizId]);

    console.log(`Found ${dupBatchesRes.rows.length} batches with duplicate opening stock initial entries across all stock items.`);

    let duplicateEntriesDeleted = 0;
    let batchesProcessed = 0;

    for (const b of dupBatchesRes.rows) {
      await client.query('BEGIN');
      try {
        // Fetch all OPENING_STOCK entries for this batch ordered chronologically
        const entriesRes = await client.query<StockLedgerRow>(`
          SELECT *
          FROM stock_ledger
          WHERE batch_id = $1 AND business_id = $2 AND transaction_type = 'OPENING_STOCK'
          ORDER BY created_at ASC, id ASC
        `, [b.batch_id, bizId]);

        const entries = entriesRes.rows;
        if (entries.length <= 1) {
          await client.query('COMMIT');
          continue;
        }

        // Keep the first (earliest) entry, delete all subsequent duplicate identical entries
        const keepEntry = entries[0];
        const deleteEntries = entries.slice(1);

        const deleteIds = deleteEntries.map(e => e.id);
        const singleQty = parseFloat(keepEntry.quantity_in) || 0;

        // 1. Delete duplicate rows from stock_ledger
        await client.query(`
          DELETE FROM stock_ledger
          WHERE id = ANY($1::uuid[]) AND business_id = $2
        `, [deleteIds, bizId]);

        // 2. Set optical_stocks to the correct single opening stock quantity
        await client.query(`
          UPDATE optical_stocks
          SET 
            physical_stock = $1,
            available_stock = GREATEST(0, $1 - reserved_stock),
            updated_at = NOW()
          WHERE batch_id = $2 AND business_id = $3
        `, [singleQty, b.batch_id, bizId]);

        // 3. Recalculate balance for the batch in stock_ledger
        await client.query(`
          WITH calculated AS (
            SELECT id,
              SUM(quantity_in::numeric - quantity_out::numeric) OVER (
                PARTITION BY batch_id ORDER BY created_at ASC, id ASC
              ) as calc_balance
            FROM stock_ledger
            WHERE batch_id = $1
          )
          UPDATE stock_ledger sl
          SET balance = calculated.calc_balance
          FROM calculated
          WHERE sl.id = calculated.id
        `, [b.batch_id]);

        await client.query('COMMIT');
        duplicateEntriesDeleted += deleteEntries.length;
        batchesProcessed++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error processing batch ${b.batch_id} (${b.barcode}):`, err);
        throw err;
      }
    }

    console.log(`✓ Successfully processed ${batchesProcessed} batches and deleted ${duplicateEntriesDeleted} duplicate opening stock entries.`);

    // -------------------------------------------------------------
    // PART 3: Post-cleanup verification & assertions
    // -------------------------------------------------------------
    console.log('\n[Part 3] Verifying cleanup results...');

    // Verify 1: No STOCK_ADJUSTMENT vouchers remain for bcbprog+3sph
    const remainingAdj = await client.query(`
      SELECT count(*) as count
      FROM stock_ledger sl
      JOIN optical_batches ob ON ob.id = sl.batch_id
      WHERE sl.business_id = $1
        AND ob.unique_item_id = $2
        AND sl.transaction_type = 'STOCK_ADJUSTMENT'
    `, [bizId, bcbItem.id]);
    console.log(`Remaining STOCK_ADJUSTMENT for bcbprog+3sph: ${remainingAdj.rows[0].count} (Expected: 0)`);

    // Verify 2: No batches in Lumina Opticals have > 1 OPENING_STOCK entry
    const remainingDupOpening = await client.query(`
      SELECT count(*) as count
      FROM (
        SELECT batch_id
        FROM stock_ledger
        WHERE business_id = $1 AND transaction_type = 'OPENING_STOCK'
        GROUP BY batch_id
        HAVING count(*) > 1
      ) sub
    `, [bizId]);
    console.log(`Remaining batches with > 1 OPENING_STOCK entries: ${remainingDupOpening.rows[0].count} (Expected: 0)`);

    // Verify 3: Total ledger entries for bcbprog+3sph
    const remainingBcbLedger = await client.query(`
      SELECT sl.transaction_type, count(*) as count
      FROM stock_ledger sl
      JOIN optical_batches ob ON ob.id = sl.batch_id
      WHERE sl.business_id = $1 AND ob.unique_item_id = $2
      GROUP BY sl.transaction_type
    `, [bizId, bcbItem.id]);
    console.log('Remaining ledger breakdown for bcbprog+3sph:', remainingBcbLedger.rows);

    // Verify 4: Check optical_stocks alignment with stock_ledger for sample batches
    const sampleCheck = await client.query(`
      SELECT ob.barcode, os.physical_stock, os.available_stock, sl.quantity_in, sl.balance
      FROM optical_stocks os
      JOIN optical_batches ob ON ob.id = os.batch_id
      JOIN stock_ledger sl ON sl.batch_id = os.batch_id AND sl.business_id = os.business_id
      WHERE os.business_id = $1 AND ob.unique_item_id = $2
      LIMIT 3
    `, [bizId, bcbItem.id]);
    console.log('Sample bcbprog+3sph batch stocks after cleanup:', sampleCheck.rows);

    console.log('\n--- Voucher Cleanup Completed Successfully! ---');
  } finally {
    client.release();
  }
}

// Allow direct execution via tsx
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('cleanDuplicateVouchers')) {
  runVoucherCleanup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal cleanup error:', err);
      process.exit(1);
    });
}
