import { db, pool } from '../db/index.js';
import {
  b2bOrderSyncLogs,
  godowns,
  parties,
  purchaseOrders,
  purchaseOrderLines,
  purchaseOrderLineBatches,
  salesOrders,
  salesOrderLines,
  salesOrderLineBatches,
  salesInvoices,
  salesInvoiceLines,
  salesInvoiceLineBatches,
  businesses,
  uniqueItems,
  opticalBatches,
} from '../db/schema.js';
import { eq, and, desc, sql, or, ilike, count } from 'drizzle-orm';
import { DocumentSequenceService } from './documentSequenceService.js';
import { AuditService } from './auditService.js';
import { round2 } from './taxCalculationService.js';

export interface B2bSyncResult {
  synced: boolean;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  idempotent?: boolean;
  conflict?: boolean;
  reason?: string;
  error?: string;
}

export class B2bOrderSyncService {
  /**
   * 1. Get Active B2B Sync Configuration for a Customer / Dealer Party
   */
  static async getSyncConfigForParty(businessId: string, partyId: string) {
    if (!partyId) return null;

    const [godown] = await db
      .select()
      .from(godowns)
      .where(
        and(
          eq(godowns.businessId, businessId),
          eq(godowns.dealerPartyId, partyId),
          eq(godowns.status, 'ACTIVE'),
          eq(godowns.enableB2bOrderSync, true),
          eq(godowns.syncStatus, 'ACTIVE')
        )
      )
      .limit(1);

    return godown || null;
  }

  /**
   * 2. Ensure Main Business Internal Supplier Party exists in the business context
   * When an extra godown receives a purchase order, the supplier is the Main Business.
   */
  static async getOrCreateMainWarehouseSupplier(businessId: string) {
    const client = await pool.connect();
    try {
      // Find existing internal supplier party for main warehouse
      const partyRes = await client.query(
        `SELECT id, name, gstin, state FROM parties 
         WHERE business_id = $1 
           AND (party_code = 'SUP-MAIN-WH' OR party_code = 'MAIN-WH-SUP' OR name ILIKE '%Main Warehouse%')
           AND party_type IN ('SUPPLIER', 'BOTH')
         LIMIT 1`,
        [businessId]
      );

      if (partyRes.rows.length > 0) {
        return partyRes.rows[0];
      }

      // Fetch business details to create corresponding supplier
      const bizRes = await client.query(
        `SELECT id, name, gstin, state, state_code, address_line1, city, pincode 
         FROM businesses 
         WHERE id = $1`,
        [businessId]
      );

      if (bizRes.rows.length === 0) {
        throw new Error(`Business not found: ${businessId}`);
      }

      const biz = bizRes.rows[0];
      const supplierName = `${biz.name} (Main Warehouse)`;

      const insertRes = await client.query(
        `INSERT INTO parties (
          business_id, party_code, name, display_name, party_type,
          address_line_1, city, state, pincode, gstin, status, notes,
          created_at, updated_at
        ) VALUES (
          $1, 'SUP-MAIN-WH', $2, $2, 'SUPPLIER',
          $3, $4, $5, $6, $7, 'ACTIVE', 'Auto-created supplier party representing Main Business for B2B order synchronization',
          NOW(), NOW()
        ) RETURNING id, name, gstin, state`,
        [
          businessId,
          supplierName,
          biz.address_line1 || null,
          biz.city || null,
          biz.state || 'Karnataka',
          biz.pincode || null,
          biz.gstin || null,
        ]
      );

      return insertRes.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * 3. Sync Sales Order to Dealer Purchase Order
   * Triggered upon successful Sales Order save.
   */
  static async syncSalesOrderToPurchaseOrder(
    businessId: string,
    salesOrderId: string,
    userId?: string
  ): Promise<B2bSyncResult> {
    const client = await pool.connect();
    try {
      // 1. Fetch Sales Order header
      const soRes = await client.query(
        `SELECT * FROM sales_orders WHERE id = $1 AND business_id = $2`,
        [salesOrderId, businessId]
      );

      if (soRes.rows.length === 0) {
        return { synced: false, reason: 'SALES_ORDER_NOT_FOUND' };
      }

      const so = soRes.rows[0];

      // 2. Check if party is mapped to an enabled Extra Godown
      const destGodown = await this.getSyncConfigForParty(businessId, so.party_id);
      if (!destGodown) {
        return { synced: false, reason: 'PARTY_NOT_MAPPED_OR_SYNC_DISABLED' };
      }

      // Safety guard: Source godown cannot be the destination godown
      if (so.godown_id && so.godown_id === destGodown.id) {
        return { synced: false, reason: 'SOURCE_AND_DESTINATION_GODOWN_IDENTICAL' };
      }

      // 3. Idempotency Check: check if PO already created for this Sales Order and Godown
      const existingPoRes = await client.query(
        `SELECT id, order_number FROM purchase_orders 
         WHERE business_id = $1 AND godown_id = $2 AND main_sales_order_id = $3
         LIMIT 1`,
        [businessId, destGodown.id, salesOrderId]
      );

      if (existingPoRes.rows.length > 0) {
        const existingPo = existingPoRes.rows[0];
        return {
          synced: true,
          idempotent: true,
          purchaseOrderId: existingPo.id,
          purchaseOrderNumber: existingPo.order_number,
        };
      }

      // 4. Fetch Sales Order Lines and line batches
      const linesRes = await client.query(
        `SELECT * FROM sales_order_lines WHERE sales_order_id = $1 ORDER BY id ASC`,
        [salesOrderId]
      );

      if (linesRes.rows.length === 0) {
        return { synced: false, reason: 'SALES_ORDER_HAS_NO_LINES' };
      }

      // 5. Ensure Main Warehouse Supplier exists
      const mainSupplier = await this.getOrCreateMainWarehouseSupplier(businessId);

      // 6. Fetch Business Name for source branding
      const bizRes = await client.query(`SELECT name FROM businesses WHERE id = $1`, [businessId]);
      const bizName = bizRes.rows[0]?.name || 'Main Warehouse';

      await client.query('BEGIN');

      // Generate Purchase Order Number in sequence
      const orderDate = so.order_date ? new Date(so.order_date) : new Date();
      const poNumber = await DocumentSequenceService.getNextVoucherNumber(
        client,
        businessId,
        'PURCHASE_ORDER',
        { voucherDate: orderDate }
      );

      const defaultPref = destGodown.defaultProcessingPreference || (destGodown as any).default_processing_preference;
      const b2bSyncStatus =
        defaultPref === 'REQUIRES_ACCEPTANCE' ? 'PENDING' : 'SYNCED';

      // Insert Purchase Order Header
      const insertPoRes = await client.query(
        `INSERT INTO purchase_orders (
          business_id, supplier_party_id, godown_id, order_number, order_date,
          gst_mode, subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, source,
          is_b2b_synchronized, b2b_sync_status,
          source_sales_order_number, source_business_name,
          main_sales_order_id, sync_notes, notes,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, 'OPEN', 'MAIN_WAREHOUSE',
          true, $18,
          $19, $20,
          $21, $22, $23,
          $24, $24, NOW(), NOW()
        ) RETURNING id`,
        [
          businessId,
          mainSupplier.id,
          destGodown.id,
          poNumber,
          orderDate,
          so.gst_mode || 'INTRA_STATE',
          so.subtotal,
          so.discount_total,
          so.taxable_amount,
          so.igst_rate,
          so.igst_amount,
          so.cgst_rate,
          so.cgst_amount,
          so.sgst_rate,
          so.sgst_amount,
          so.round_off,
          so.grand_total,
          b2bSyncStatus,
          so.order_number,
          bizName,
          salesOrderId,
          `Auto-synchronized B2B Order from Main Business Sales Order ${so.order_number}`,
          so.notes || null,
          userId || null,
        ]
      );

      const poId = insertPoRes.rows[0].id;

      // Insert Purchase Order Lines and copy exact Batches
      for (const line of linesRes.rows) {
        const poLineRes = await client.query(
          `INSERT INTO purchase_order_lines (
            purchase_order_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11,
            NOW(), NOW()
          ) RETURNING id`,
          [
            poId,
            line.unique_item_id,
            line.quantity,
            line.rate,
            line.discount_type || 'NONE',
            line.discount_value || '0.00',
            line.discount_amount || '0.00',
            line.taxable_amount,
            line.gst_rate || '0.00',
            line.tax_amount || '0.00',
            line.line_total,
          ]
        );

        const poLineId = poLineRes.rows[0].id;

        // Fetch Sales Order Line Batches
        const batchesRes = await client.query(
          `SELECT batch_id, quantity FROM sales_order_line_batches WHERE sales_order_line_id = $1`,
          [line.id]
        );

        for (const b of batchesRes.rows) {
          const batchRate = parseFloat(line.rate || '0');
          const batchQty = parseFloat(b.quantity || '0');
          const totalCost = round2(batchQty * batchRate);

          await client.query(
            `INSERT INTO purchase_order_line_batches (
              purchase_order_line_id, batch_id, quantity, rate, total_cost,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              NOW(), NOW()
            )`,
            [poLineId, b.batch_id, b.quantity, batchRate.toFixed(2), totalCost.toFixed(2)]
          );
        }
      }

      // Record Sync Log (Idempotent event log)
      await client.query(
        `INSERT INTO b2b_order_sync_logs (
          business_id, source_voucher_type, source_voucher_id, source_voucher_number,
          destination_godown_id, destination_purchase_order_id, destination_purchase_order_number,
          event_type, status, payload, retry_count, created_at, updated_at
        ) VALUES (
          $1, 'SALES_ORDER', $2, $3,
          $4, $5, $6,
          'ORDER_CREATED', 'SYNCED', $7, 0, NOW(), NOW()
        )
        ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
        SET status = 'SYNCED',
            destination_purchase_order_id = EXCLUDED.destination_purchase_order_id,
            destination_purchase_order_number = EXCLUDED.destination_purchase_order_number,
            updated_at = NOW()`,
        [
          businessId,
          salesOrderId,
          so.order_number,
          destGodown.id,
          poId,
          poNumber,
          JSON.stringify({
            salesOrderId,
            salesOrderNumber: so.order_number,
            grandTotal: so.grand_total,
            linesCount: linesRes.rows.length,
            destinationGodown: destGodown.name,
          }),
        ]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'b2b_sync',
        action: 'B2B_PURCHASE_ORDER_GENERATED',
        entityType: 'PURCHASE_ORDER',
        entityId: poId,
        newValue: {
          purchaseOrderNumber: poNumber,
          sourceSalesOrderNumber: so.order_number,
          destinationGodownId: destGodown.id,
          destinationGodownName: destGodown.name,
          grandTotal: so.grand_total,
        },
      });

      return {
        synced: true,
        purchaseOrderId: poId,
        purchaseOrderNumber: poNumber,
      };
    } catch (err: any) {
      await client.query('ROLLBACK');

      // Concurrent execution recovery: if another thread committed the PO first
      if (err.code === '23505' && (err.constraint === 'purchase_orders_b2b_so_unique_idx' || String(err.detail).includes('main_sales_order_id'))) {
        const existingPoRes = await pool.query(
          `SELECT id, order_number FROM purchase_orders 
           WHERE business_id = $1 AND main_sales_order_id = $2
           LIMIT 1`,
          [businessId, salesOrderId]
        );
        if (existingPoRes.rows.length > 0) {
          return {
            synced: true,
            idempotent: true,
            purchaseOrderId: existingPoRes.rows[0].id,
            purchaseOrderNumber: existingPoRes.rows[0].order_number,
          };
        }
      }

      console.error('[B2B Order Sync Error]', err);

      // Record Failed Log
      try {
        await pool.query(
          `INSERT INTO b2b_order_sync_logs (
            business_id, source_voucher_type, source_voucher_id, source_voucher_number,
            destination_godown_id, event_type, status, error_details, retry_count, created_at, updated_at
          ) VALUES (
            $1, 'SALES_ORDER', $2, $3,
            $4, 'ORDER_CREATED', 'FAILED', $5, 0, NOW(), NOW()
          )
          ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
          SET status = 'FAILED', error_details = EXCLUDED.error_details, retry_count = b2b_order_sync_logs.retry_count + 1, updated_at = NOW()`,
          [
            businessId,
            salesOrderId,
            'UNKNOWN',
            '00000000-0000-0000-0000-000000000000',
            err.message || 'Unknown sync error',
          ]
        );
      } catch (logErr) {
        console.error('[Failed to record failed sync log]', logErr);
      }

      return {
        synced: false,
        error: err.message,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 4. Sync Sales Order Edits to Linked Dealer Purchase Order
   * Conflicting edits guard: If dealer has already accepted, partially received, or converted PO, preserve dealer record!
   */
  static async syncSalesOrderEdit(
    businessId: string,
    salesOrderId: string,
    userId?: string
  ): Promise<B2bSyncResult> {
    const client = await pool.connect();
    try {
      // Find linked Purchase Order
      const poRes = await client.query(
        `SELECT id, order_number, status, b2b_sync_status, godown_id, converted_invoice_id 
         FROM purchase_orders 
         WHERE business_id = $1 AND main_sales_order_id = $2
         LIMIT 1`,
        [businessId, salesOrderId]
      );

      if (poRes.rows.length === 0) {
        // If not synced yet, try initial sync
        return await this.syncSalesOrderToPurchaseOrder(businessId, salesOrderId, userId);
      }

      const po = poRes.rows[0];

      // Fetch latest SO
      const soRes = await client.query(
        `SELECT * FROM sales_orders WHERE id = $1 AND business_id = $2`,
        [salesOrderId, businessId]
      );
      if (soRes.rows.length === 0) return { synced: false, reason: 'SALES_ORDER_NOT_FOUND' };
      const so = soRes.rows[0];

      // CONFLICT DETECTION:
      // If dealer has already accepted, rejected, converted, cancelled, or received the PO, preserve dealer record!
      const isAlreadyAccepted = po.b2b_sync_status === 'ACCEPTED';
      const isRejected = po.b2b_sync_status === 'REJECTED';
      const isCancelled = po.status === 'CANCELLED';
      const isConverted = po.status === 'CONVERTED' || po.status === 'PARTIALLY_CONVERTED';
      const hasInvoice = Boolean(po.converted_invoice_id);

      const activeInvRes = await client.query(
        `SELECT id FROM purchase_invoices WHERE business_id = $1 AND purchase_order_id = $2 AND status != 'CANCELLED' LIMIT 1`,
        [businessId, po.id]
      );
      const hasActiveInvoice = activeInvRes.rows.length > 0;

      if (isAlreadyAccepted || isRejected || isCancelled || isConverted || hasInvoice || hasActiveInvoice) {
        let reasonLabel = 'accepted by dealer';
        if (isConverted || hasInvoice || hasActiveInvoice) reasonLabel = 'converted to invoice';
        else if (isRejected) reasonLabel = 'rejected by dealer';
        else if (isCancelled) reasonLabel = 'cancelled';

        const conflictReason = `Conflict: Dealer Purchase Order ${po.order_number} has already been ${reasonLabel}. Edits from Main Business Sales Order ${so.order_number} preserved without overwriting.`;

        await pool.query(
          `INSERT INTO b2b_order_sync_logs (
            business_id, source_voucher_type, source_voucher_id, source_voucher_number,
            destination_godown_id, destination_purchase_order_id, destination_purchase_order_number,
            event_type, status, error_details, retry_count, created_at, updated_at
          ) VALUES (
            $1, 'SALES_ORDER', $2, $3,
            $4, $5, $6,
            'ORDER_UPDATED', 'CONFLICT', $7, 0, NOW(), NOW()
          )
          ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
          SET status = 'CONFLICT', error_details = EXCLUDED.error_details, updated_at = NOW()`,
          [
            businessId,
            salesOrderId,
            so.order_number,
            po.godown_id,
            po.id,
            po.order_number,
            conflictReason,
          ]
        );

        return {
          synced: false,
          conflict: true,
          purchaseOrderId: po.id,
          purchaseOrderNumber: po.order_number,
          reason: conflictReason,
        };
      }

      // Safe to update PO
      await client.query('BEGIN');

      // Update PO header totals
      await client.query(
        `UPDATE purchase_orders SET
          subtotal = $1, discount_total = $2, taxable_amount = $3,
          igst_rate = $4, igst_amount = $5, cgst_rate = $6, cgst_amount = $7,
          sgst_rate = $8, sgst_amount = $9, round_off = $10, grand_total = $11,
          notes = $12, updated_by = $13, updated_at = NOW()
         WHERE id = $14`,
        [
          so.subtotal,
          so.discount_total,
          so.taxable_amount,
          so.igst_rate,
          so.igst_amount,
          so.cgst_rate,
          so.cgst_amount,
          so.sgst_rate,
          so.sgst_amount,
          so.round_off,
          so.grand_total,
          so.notes || null,
          userId || null,
          po.id,
        ]
      );

      // Re-create lines and batches
      await client.query(`DELETE FROM purchase_order_lines WHERE purchase_order_id = $1`, [po.id]);

      const linesRes = await client.query(
        `SELECT * FROM sales_order_lines WHERE sales_order_id = $1 ORDER BY id ASC`,
        [salesOrderId]
      );

      for (const line of linesRes.rows) {
        const poLineRes = await client.query(
          `INSERT INTO purchase_order_lines (
            purchase_order_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11,
            NOW(), NOW()
          ) RETURNING id`,
          [
            po.id,
            line.unique_item_id,
            line.quantity,
            line.rate,
            line.discount_type || 'NONE',
            line.discount_value || '0.00',
            line.discount_amount || '0.00',
            line.taxable_amount,
            line.gst_rate || '0.00',
            line.tax_amount || '0.00',
            line.line_total,
          ]
        );

        const poLineId = poLineRes.rows[0].id;

        const batchesRes = await client.query(
          `SELECT batch_id, quantity FROM sales_order_line_batches WHERE sales_order_line_id = $1`,
          [line.id]
        );

        for (const b of batchesRes.rows) {
          const batchRate = parseFloat(line.rate || '0');
          const batchQty = parseFloat(b.quantity || '0');
          const totalCost = round2(batchQty * batchRate);

          await client.query(
            `INSERT INTO purchase_order_line_batches (
              purchase_order_line_id, batch_id, quantity, rate, total_cost,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              NOW(), NOW()
            )`,
            [poLineId, b.batch_id, b.quantity, batchRate.toFixed(2), totalCost.toFixed(2)]
          );
        }
      }

      // Record Sync Log
      await client.query(
        `INSERT INTO b2b_order_sync_logs (
          business_id, source_voucher_type, source_voucher_id, source_voucher_number,
          destination_godown_id, destination_purchase_order_id, destination_purchase_order_number,
          event_type, status, retry_count, created_at, updated_at
        ) VALUES (
          $1, 'SALES_ORDER', $2, $3,
          $4, $5, $6,
          'ORDER_UPDATED', 'SYNCED', 0, NOW(), NOW()
        )
        ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
        SET status = 'SYNCED', updated_at = NOW()`,
        [businessId, salesOrderId, so.order_number, po.godown_id, po.id, po.order_number]
      );

      await client.query('COMMIT');

      return {
        synced: true,
        purchaseOrderId: po.id,
        purchaseOrderNumber: po.order_number,
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error('[B2B Order Sync Edit Error]', err);
      return { synced: false, error: err.message };
    } finally {
      client.release();
    }
  }

  /**
   * 5. Sync Sales Order Cancellation to Linked Dealer Purchase Order
   */
  static async syncSalesOrderCancellation(
    businessId: string,
    salesOrderId: string,
    reason?: string,
    userId?: string
  ): Promise<B2bSyncResult> {
    const client = await pool.connect();
    try {
      const poRes = await client.query(
        `SELECT id, order_number, status, godown_id, converted_invoice_id 
         FROM purchase_orders 
         WHERE business_id = $1 AND main_sales_order_id = $2
         LIMIT 1`,
        [businessId, salesOrderId]
      );

      if (poRes.rows.length === 0) {
        return { synced: false, reason: 'NO_LINKED_PO' };
      }

      const po = poRes.rows[0];

      if (po.status === 'CANCELLED') {
        return {
          synced: true,
          idempotent: true,
          purchaseOrderId: po.id,
          purchaseOrderNumber: po.order_number,
        };
      }

      // If already converted to invoice on dealer side, conflict
      const activeInvoicesRes = await client.query(
        `SELECT id, invoice_number FROM purchase_invoices 
         WHERE business_id = $1 AND purchase_order_id = $2 AND status != 'CANCELLED' 
         LIMIT 1`,
        [businessId, po.id]
      );

      if (po.converted_invoice_id || activeInvoicesRes.rows.length > 0) {
        const invNum = activeInvoicesRes.rows[0]?.invoice_number || 'an invoice';
        return {
          synced: false,
          conflict: true,
          reason: `Cannot cancel dealer Purchase Order because it has already been converted to a Purchase Invoice (${invNum}).`,
        };
      }

      const cancelReason = `Cancelled by Main Business: ${reason || 'Order cancelled'}`;

      await client.query(
        `UPDATE purchase_orders SET
          status = 'CANCELLED',
          b2b_sync_status = 'CANCELLED',
          cancellation_reason = $1,
          updated_by = $2,
          updated_at = NOW()
         WHERE id = $3`,
        [cancelReason, userId || null, po.id]
      );

      // Record Sync Log
      await client.query(
        `INSERT INTO b2b_order_sync_logs (
          business_id, source_voucher_type, source_voucher_id, source_voucher_number,
          destination_godown_id, destination_purchase_order_id, destination_purchase_order_number,
          event_type, status, error_details, retry_count, created_at, updated_at
        ) VALUES (
          $1, 'SALES_ORDER', $2, 'CANCELLED',
          $3, $4, $5,
          'ORDER_CANCELLED', 'SYNCED', $6, 0, NOW(), NOW()
        )
        ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
        SET status = 'SYNCED', error_details = EXCLUDED.error_details, updated_at = NOW()`,
        [businessId, salesOrderId, po.godown_id, po.id, po.order_number, cancelReason]
      );

      return {
        synced: true,
        purchaseOrderId: po.id,
        purchaseOrderNumber: po.order_number,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 6. Sync Sales Order Fulfillment (Invoice Conversion)
   * Links the source Sales Invoice reference and updates status.
   */
  static async syncSalesOrderFulfillment(
    businessId: string,
    salesOrderId: string,
    invoiceId: string,
    invoiceNumber: string,
    newOrderStatus: string,
    userId?: string
  ): Promise<B2bSyncResult> {
    const client = await pool.connect();
    try {
      const poRes = await client.query(
        `SELECT id, order_number, godown_id 
         FROM purchase_orders 
         WHERE business_id = $1 AND main_sales_order_id = $2
         LIMIT 1`,
        [businessId, salesOrderId]
      );

      if (poRes.rows.length === 0) {
        return { synced: false, reason: 'NO_LINKED_PO' };
      }

      const po = poRes.rows[0];

      await client.query(
        `UPDATE purchase_orders SET
          main_sales_invoice_id = $1,
          source_sales_invoice_number = $2,
          sync_notes = $3,
          updated_by = $4,
          updated_at = NOW()
         WHERE id = $5`,
        [
          invoiceId,
          invoiceNumber,
          `Fulfilled by Main Business Invoice ${invoiceNumber} (${newOrderStatus})`,
          userId || null,
          po.id,
        ]
      );

      // Record Fulfillment Log
      await client.query(
        `INSERT INTO b2b_order_sync_logs (
          business_id, source_voucher_type, source_voucher_id, source_voucher_number,
          destination_godown_id, destination_purchase_order_id, destination_purchase_order_number,
          event_type, status, error_details, retry_count, created_at, updated_at
        ) VALUES (
          $1, 'SALES_INVOICE', $2, $3,
          $4, $5, $6,
          'INVOICE_FULFILLED', 'SYNCED', $7, 0, NOW(), NOW()
        )
        ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
        SET status = 'SYNCED', error_details = EXCLUDED.error_details, updated_at = NOW()`,
        [
          businessId,
          invoiceId,
          invoiceNumber,
          po.godown_id,
          po.id,
          po.order_number,
          `Linked to Main Sales Invoice ${invoiceNumber}`,
        ]
      );

      return {
        synced: true,
        purchaseOrderId: po.id,
        purchaseOrderNumber: po.order_number,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 7. Direct Sales Invoice Synchronization
   * Creates a Purchase Order ONLY if the dealer godown configuration explicitly enables direct-invoice sync.
   */
  static async syncDirectInvoiceToPurchaseOrder(
    businessId: string,
    invoiceId: string,
    userId?: string
  ): Promise<B2bSyncResult> {
    const client = await pool.connect();
    try {
      const invRes = await client.query(
        `SELECT * FROM sales_invoices WHERE id = $1 AND business_id = $2`,
        [invoiceId, businessId]
      );

      if (invRes.rows.length === 0) return { synced: false, reason: 'INVOICE_NOT_FOUND' };
      const inv = invRes.rows[0];

      // Check if dealer godown is enabled and explicitly allows direct-invoice synchronization
      const destGodown = await this.getSyncConfigForParty(businessId, inv.party_id);
      if (!destGodown) {
        return { synced: false, reason: 'PARTY_NOT_MAPPED_OR_SYNC_DISABLED' };
      }

      const allowDirectInvoice = destGodown.syncDirectInvoice ?? (destGodown as any).sync_direct_invoice;
      if (!allowDirectInvoice) {
        return { synced: false, reason: 'DIRECT_INVOICE_SYNC_DISABLED_FOR_DEALER' };
      }

      // Check idempotency
      const existingPoRes = await client.query(
        `SELECT id, order_number FROM purchase_orders 
         WHERE business_id = $1 AND godown_id = $2 AND main_sales_invoice_id = $3
         LIMIT 1`,
        [businessId, destGodown.id, invoiceId]
      );

      if (existingPoRes.rows.length > 0) {
        return {
          synced: true,
          idempotent: true,
          purchaseOrderId: existingPoRes.rows[0].id,
          purchaseOrderNumber: existingPoRes.rows[0].order_number,
        };
      }

      // Fetch invoice lines and batches
      const linesRes = await client.query(
        `SELECT * FROM sales_invoice_lines WHERE sales_invoice_id = $1 ORDER BY id ASC`,
        [invoiceId]
      );

      if (linesRes.rows.length === 0) return { synced: false, reason: 'INVOICE_HAS_NO_LINES' };

      const mainSupplier = await this.getOrCreateMainWarehouseSupplier(businessId);
      const bizRes = await client.query(`SELECT name FROM businesses WHERE id = $1`, [businessId]);
      const bizName = bizRes.rows[0]?.name || 'Main Warehouse';

      await client.query('BEGIN');

      const invoiceDate = inv.invoice_date ? new Date(inv.invoice_date) : new Date();
      const poNumber = await DocumentSequenceService.getNextVoucherNumber(
        client,
        businessId,
        'PURCHASE_ORDER',
        { voucherDate: invoiceDate }
      );

      const defaultPref = destGodown.defaultProcessingPreference || (destGodown as any).default_processing_preference;
      const b2bSyncStatus =
        defaultPref === 'REQUIRES_ACCEPTANCE' ? 'PENDING' : 'SYNCED';

      const insertPoRes = await client.query(
        `INSERT INTO purchase_orders (
          business_id, supplier_party_id, godown_id, order_number, order_date,
          gst_mode, subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, source,
          is_b2b_synchronized, b2b_sync_status,
          source_sales_invoice_number, source_business_name,
          main_sales_invoice_id, sync_notes, notes,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, 'OPEN', 'MAIN_WAREHOUSE',
          true, $18,
          $19, $20,
          $21, $22, $23,
          $24, $24, NOW(), NOW()
        ) RETURNING id`,
        [
          businessId,
          mainSupplier.id,
          destGodown.id,
          poNumber,
          invoiceDate,
          inv.gst_mode || 'INTRA_STATE',
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
          b2bSyncStatus,
          inv.invoice_number,
          bizName,
          invoiceId,
          `Auto-synchronized B2B Order from Direct Sales Invoice ${inv.invoice_number}`,
          inv.notes || null,
          userId || null,
        ]
      );

      const poId = insertPoRes.rows[0].id;

      for (const line of linesRes.rows) {
        const poLineRes = await client.query(
          `INSERT INTO purchase_order_lines (
            purchase_order_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11,
            NOW(), NOW()
          ) RETURNING id`,
          [
            poId,
            line.unique_item_id,
            line.quantity,
            line.rate,
            line.discount_type || 'NONE',
            line.discount_value || '0.00',
            line.discount_amount || '0.00',
            line.taxable_amount,
            line.gst_rate || '0.00',
            line.tax_amount || '0.00',
            line.line_total,
          ]
        );

        const poLineId = poLineRes.rows[0].id;

        const batchesRes = await client.query(
          `SELECT batch_id, quantity FROM sales_invoice_line_batches WHERE sales_invoice_line_id = $1`,
          [line.id]
        );

        for (const b of batchesRes.rows) {
          const batchRate = parseFloat(line.rate || '0');
          const batchQty = parseFloat(b.quantity || '0');
          const totalCost = round2(batchQty * batchRate);

          await client.query(
            `INSERT INTO purchase_order_line_batches (
              purchase_order_line_id, batch_id, quantity, rate, total_cost,
              created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              NOW(), NOW()
            )`,
            [poLineId, b.batch_id, b.quantity, batchRate.toFixed(2), totalCost.toFixed(2)]
          );
        }
      }

      await client.query(
        `INSERT INTO b2b_order_sync_logs (
          business_id, source_voucher_type, source_voucher_id, source_voucher_number,
          destination_godown_id, destination_purchase_order_id, destination_purchase_order_number,
          event_type, status, retry_count, created_at, updated_at
        ) VALUES (
          $1, 'SALES_INVOICE', $2, $3,
          $4, $5, $6,
          'INVOICE_CREATED', 'SYNCED', 0, NOW(), NOW()
        )
        ON CONFLICT (source_voucher_id, destination_godown_id, event_type) DO UPDATE
        SET status = 'SYNCED', updated_at = NOW()`,
        [businessId, invoiceId, inv.invoice_number, destGodown.id, poId, poNumber]
      );

      await client.query('COMMIT');

      return {
        synced: true,
        purchaseOrderId: poId,
        purchaseOrderNumber: poNumber,
      };
    } catch (err: any) {
      await client.query('ROLLBACK');

      // Concurrent execution recovery: if another thread committed the PO first
      if (err.code === '23505' && (err.constraint === 'purchase_orders_b2b_si_unique_idx' || String(err.detail).includes('main_sales_invoice_id'))) {
        const existingPoRes = await pool.query(
          `SELECT id, order_number FROM purchase_orders 
           WHERE business_id = $1 AND main_sales_invoice_id = $2
           LIMIT 1`,
          [businessId, invoiceId]
        );
        if (existingPoRes.rows.length > 0) {
          return {
            synced: true,
            idempotent: true,
            purchaseOrderId: existingPoRes.rows[0].id,
            purchaseOrderNumber: existingPoRes.rows[0].order_number,
          };
        }
      }

      console.error('[Direct Invoice B2B Sync Error]', err);
      return { synced: false, error: err.message };
    } finally {
      client.release();
    }
  }

  /**
   * 8. Dealer Accept Purchase Order
   */
  static async acceptDealerPurchaseOrder(
    businessId: string,
    purchaseOrderId: string,
    godownId?: string | null,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      const poRes = await client.query(
        `SELECT id, order_number, godown_id, b2b_sync_status, status 
         FROM purchase_orders 
         WHERE id = $1 AND business_id = $2`,
        [purchaseOrderId, businessId]
      );

      if (poRes.rows.length === 0) {
        throw new Error('Purchase Order not found.');
      }

      const po = poRes.rows[0];

      // Enforce tenant isolation for godown staff
      if (godownId && po.godown_id !== godownId) {
        throw new Error('Access denied: You cannot accept orders belonging to another godown.');
      }

      if (po.status === 'CONVERTED') {
        throw new Error('Cannot accept purchase order: order has already been converted to an invoice.');
      }
      if (po.b2b_sync_status === 'REJECTED') {
        throw new Error('Cannot accept purchase order: order has already been rejected.');
      }
      if (po.status === 'CANCELLED') {
        throw new Error('Cannot accept purchase order: order has been cancelled.');
      }
      if (po.b2b_sync_status === 'ACCEPTED') {
        return { success: true, message: `Purchase Order ${po.order_number} is already accepted.`, idempotent: true };
      }

      await client.query(
        `UPDATE purchase_orders SET
          b2b_sync_status = 'ACCEPTED',
          updated_by = $1,
          updated_at = NOW()
         WHERE id = $2`,
        [userId || null, purchaseOrderId]
      );

      return { success: true, message: `Purchase Order ${po.order_number} accepted successfully.` };
    } finally {
      client.release();
    }
  }

  /**
   * 9. Dealer Reject Purchase Order
   */
  static async rejectDealerPurchaseOrder(
    businessId: string,
    purchaseOrderId: string,
    godownId?: string | null,
    reason?: string,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      const poRes = await client.query(
        `SELECT id, order_number, godown_id, b2b_sync_status, status 
         FROM purchase_orders 
         WHERE id = $1 AND business_id = $2`,
        [purchaseOrderId, businessId]
      );

      if (poRes.rows.length === 0) {
        throw new Error('Purchase Order not found.');
      }

      const po = poRes.rows[0];

      if (godownId && po.godown_id !== godownId) {
        throw new Error('Access denied: You cannot reject orders belonging to another godown.');
      }

      if (po.status === 'CONVERTED') {
        throw new Error('Cannot reject purchase order: order has already been converted to an invoice.');
      }
      if (po.status === 'CANCELLED' && po.b2b_sync_status !== 'REJECTED') {
        throw new Error('Cannot reject purchase order: order is already cancelled.');
      }
      if (po.b2b_sync_status === 'REJECTED') {
        return { success: true, message: `Purchase Order ${po.order_number} is already rejected.`, idempotent: true };
      }

      await client.query(
        `UPDATE purchase_orders SET
          b2b_sync_status = 'REJECTED',
          rejection_reason = $1,
          status = 'CANCELLED',
          updated_by = $2,
          updated_at = NOW()
         WHERE id = $3`,
        [reason || 'Rejected by Dealer', userId || null, purchaseOrderId]
      );

      return { success: true, message: `Purchase Order ${po.order_number} rejected.` };
    } finally {
      client.release();
    }
  }

  /**
   * 10. List B2B Order Sync Logs for Admin
   */
  static async listSyncLogs(
    businessId: string,
    options?: {
      status?: string;
      godownId?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = Math.min(options?.limit || 50, 100);
    const offset = options?.offset || 0;
    const client = await pool.connect();

    try {
      let sqlQuery = `
        SELECT 
          l.id,
          l.business_id as "businessId",
          l.source_voucher_type as "sourceVoucherType",
          l.source_voucher_id as "sourceVoucherId",
          l.source_voucher_number as "sourceVoucherNumber",
          l.destination_godown_id as "destinationGodownId",
          l.destination_purchase_order_id as "destinationPurchaseOrderId",
          l.destination_purchase_order_number as "destinationPurchaseOrderNumber",
          l.event_type as "eventType",
          l.status,
          l.error_details as "errorDetails",
          l.payload,
          l.retry_count as "retryCount",
          l.created_at as "createdAt",
          l.updated_at as "updatedAt",
          g.name as "destinationGodownName",
          g.code as "destinationGodownCode",
          p.name as "dealerPartyName"
        FROM b2b_order_sync_logs l
        LEFT JOIN godowns g ON l.destination_godown_id = g.id
        LEFT JOIN parties p ON g.dealer_party_id = p.id
        WHERE l.business_id = $1
      `;
      const params: any[] = [businessId];

      if (options?.status) {
        params.push(options.status);
        sqlQuery += ` AND l.status = $${params.length}`;
      }

      if (options?.godownId) {
        params.push(options.godownId);
        sqlQuery += ` AND l.destination_godown_id = $${params.length}`;
      }

      if (options?.search && options.search.trim()) {
        params.push(`%${options.search.trim().toLowerCase()}%`);
        sqlQuery += ` AND (
          LOWER(l.source_voucher_number) LIKE $${params.length} OR 
          LOWER(COALESCE(l.destination_purchase_order_number, '')) LIKE $${params.length} OR
          LOWER(COALESCE(g.name, '')) LIKE $${params.length}
        )`;
      }

      sqlQuery += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const res = await client.query(sqlQuery, params);

      // Count
      const countRes = await client.query(
        `SELECT COUNT(*) FROM b2b_order_sync_logs WHERE business_id = $1`,
        [businessId]
      );

      return {
        logs: res.rows,
        total: parseInt(countRes.rows[0].count || '0', 10),
        limit,
        offset,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 11. Retry Failed Sync
   */
  static async retrySync(businessId: string, logId: string, userId?: string): Promise<B2bSyncResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const logRes = await client.query(
        `SELECT * FROM b2b_order_sync_logs WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [logId, businessId]
      );

      if (logRes.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('Sync log record not found or does not belong to this business.');
      }

      const log = logRes.rows[0];

      await client.query(
        `UPDATE b2b_order_sync_logs SET retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1`,
        [logId]
      );
      await client.query('COMMIT');

      if (log.source_voucher_type === 'SALES_ORDER') {
        if (log.event_type === 'ORDER_CREATED') {
          return await this.syncSalesOrderToPurchaseOrder(businessId, log.source_voucher_id, userId);
        } else if (log.event_type === 'ORDER_UPDATED') {
          return await this.syncSalesOrderEdit(businessId, log.source_voucher_id, userId);
        } else if (log.event_type === 'ORDER_CANCELLED') {
          return await this.syncSalesOrderCancellation(businessId, log.source_voucher_id, undefined, userId);
        }
      } else if (log.source_voucher_type === 'SALES_INVOICE') {
        return await this.syncDirectInvoiceToPurchaseOrder(businessId, log.source_voucher_id, userId);
      }

      throw new Error(`Unsupported retry event type: ${log.event_type}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
