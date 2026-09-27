import { pool, db } from '../db/index.js';
import { PoolClient } from 'pg';
import { round2 } from './taxCalculationService.js';
import { AuditService } from './auditService.js';
import { PurchaseReturnService, CreatePurchaseReturnInput } from './purchaseReturnService.js';
import { SalesReturnService, CreateSalesReturnInput } from './salesReturnService.js';

export interface DealerReturnLineRequestInput {
  dealerPurchaseInvoiceLineId: string;
  dealerUniqueItemId: string;
  dealerBatchId: string;
  requestedQuantity: number;
  reason?: string;
  notes?: string;
}

export interface CreateDealerReturnRequestInput {
  dealerPurchaseInvoiceId: string;
  returnReason: string;
  dealerReference?: string;
  notes?: string;
  lines: DealerReturnLineRequestInput[];
}

export interface ApproveDealerReturnLineInput {
  lineId: string;
  approvedQuantity: number;
}

export interface ApproveDealerReturnInput {
  notes?: string;
  lines: ApproveDealerReturnLineInput[];
}

export interface DispatchDealerReturnLineInput {
  lineId: string;
  sentQuantity: number;
}

export interface DispatchDealerReturnInput {
  dispatchDate?: string | Date;
  courierName?: string;
  trackingNumber?: string;
  notes?: string;
  lines?: DispatchDealerReturnLineInput[];
}

export interface ReceiveDealerReturnLineInput {
  lineId: string;
  receivedQuantity: number;
  acceptedQuantity: number;
  damagedQuantity: number;
  reason?: string;
  notes?: string;
}

export interface ReceiveDealerReturnInput {
  receiptDate?: string | Date;
  notes?: string;
  lines: ReceiveDealerReturnLineInput[];
}

/**
 * Optical Quantity Validator
 * - PRS: Must be in 0.5 increments (0.5, 1.0, 1.5, 2.0...)
 * - PCS: Must be integers (1.0, 2.0, 3.0...)
 */
export function validateOpticalReturnQuantity(quantity: number, unit?: string | null): void {
  if (isNaN(quantity) || quantity <= 0) {
    throw new Error(`Quantity must be a positive number greater than zero, received: ${quantity}`);
  }
  const u = (unit || 'PRS').toUpperCase();
  if (u === 'PRS' || u === 'PAIR' || u === 'PAIRS') {
    const multiplied = round2(quantity * 2);
    if (Math.abs(multiplied - Math.round(multiplied)) > 0.001) {
      throw new Error(`Quantity for pairs (PRS) must be in 0.5 increments (e.g. 0.5, 1.0, 1.5, 2.0). Received: ${quantity}`);
    }
  } else if (u === 'PCS' || u === 'PC' || u === 'PIECE' || u === 'PIECES') {
    if (Math.abs(quantity - Math.round(quantity)) > 0.001) {
      throw new Error(`Quantity for pieces (PCS) must be whole numbers only. Received: ${quantity}`);
    }
  }
}

export class DealerReturnService {
  /**
   * Helper: Generate sequential Dealer Return number: DR-YYYYMM-XXXX
   */
  public static async generateReturnNumber(client: PoolClient, dealerBusinessId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `DR-${yearMonth}-`;

    const res = await client.query(
      `SELECT return_number FROM dealer_returns 
       WHERE dealer_business_id = $1 AND return_number LIKE $2
       ORDER BY return_number DESC LIMIT 1`,
      [dealerBusinessId, `${prefix}%`]
    );

    let seq = 1;
    if (res.rows.length > 0) {
      const lastNum = res.rows[0].return_number;
      const parts = lastNum.split('-');
      if (parts.length >= 3) {
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) {
          seq = parsed + 1;
        }
      }
    }

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  /**
   * 1. GET RETURNABLE PURCHASE INVOICE FOR DEALER
   * Returns line-by-line and batch-by-batch breakdown with optical powers,
   * purchased quantity, previously returned, pending requests, and max returnable.
   */
  static async getReturnablePurchaseInvoice(dealerBusinessId: string, purchaseInvoiceId: string) {
    const client = await pool.connect();
    try {
      // 1. Fetch Purchase Invoice
      const invRes = await client.query(
        `SELECT pi.*, p.name as supplier_name, p.display_name as supplier_trade_name, p.party_code
         FROM purchase_invoices pi
         JOIN parties p ON pi.supplier_party_id = p.id
         WHERE pi.id = $1 AND pi.business_id = $2`,
        [purchaseInvoiceId, dealerBusinessId]
      );

      if (invRes.rows.length === 0) {
        throw new Error('Purchase Invoice not found or does not belong to your business.');
      }

      const inv = invRes.rows[0];

      if (inv.status !== 'POSTED') {
        throw new Error(`Cannot return against ${inv.status} Purchase Invoice. Invoice must be POSTED.`);
      }

      // 2. Discover Main Warehouse linkage
      let mainBusinessId: string | null = null;
      let mainSalesInvoiceId: string | null = inv.main_sales_invoice_id || null;
      let mainBusinessName: string | null = null;

      // Check dealer_goods_receipts
      const grnRes = await client.query(
        `SELECT gr.main_business_id, ds.main_sales_invoice_id, mb.name as main_name
         FROM dealer_goods_receipts gr
         JOIN businesses mb ON gr.main_business_id = mb.id
         LEFT JOIN dealer_shipments ds ON gr.dealer_shipment_id = ds.id
         WHERE gr.dealer_purchase_invoice_id = $1
         LIMIT 1`,
        [purchaseInvoiceId]
      );

      if (grnRes.rows.length > 0) {
        mainBusinessId = grnRes.rows[0].main_business_id;
        mainSalesInvoiceId = mainSalesInvoiceId || grnRes.rows[0].main_sales_invoice_id;
        mainBusinessName = grnRes.rows[0].main_name;
      } else {
        // Check dealer's parent business
        const bizRes = await client.query(
          `SELECT b.parent_business_id, pb.name as parent_name
           FROM businesses b
           LEFT JOIN businesses pb ON b.parent_business_id = pb.id
           WHERE b.id = $1`,
          [dealerBusinessId]
        );
        if (bizRes.rows.length > 0 && bizRes.rows[0].parent_business_id) {
          mainBusinessId = bizRes.rows[0].parent_business_id;
          mainBusinessName = bizRes.rows[0].parent_name;
        }
      }

      // 3. Fetch Invoice Lines & Batches
      const linesRes = await client.query(
        `SELECT 
           pil.id as line_id,
           pil.unique_item_id,
           pil.quantity as purchased_quantity,
           pil.rate,
           pil.discount_type,
           pil.discount_value,
           pil.gst_rate,
           pil.taxable_amount,
           pil.line_total,
           ui.code as item_code,
           ui.name as item_name,
           ui.optical_category,
           ui.unit,
           pilb.id as line_batch_id,
           pilb.batch_id,
           pilb.quantity as batch_purchased_quantity,
           pilb.rate as batch_rate,
           ob.barcode,
           ob.sph,
           ob.cyl,
           ob.axis,
           ob.add,
           ob.side,
           ob.identity_key,
           c.name as category_name
         FROM purchase_invoice_lines pil
         JOIN unique_items ui ON pil.unique_item_id = ui.id
         LEFT JOIN purchase_invoice_line_batches pilb ON pil.id = pilb.purchase_invoice_line_id
         LEFT JOIN optical_batches ob ON pilb.batch_id = ob.id
         LEFT JOIN categories c ON ob.category_id = c.id
         WHERE pil.purchase_invoice_id = $1
         ORDER BY pil.created_at ASC`,
        [purchaseInvoiceId]
      );

      // 4. Calculate already returned via posted Purchase Returns
      const prevReturnsRes = await client.query(
        `SELECT 
           prlb.batch_id,
           prl.purchase_invoice_line_id,
           SUM(prlb.quantity) as returned_batch_qty,
           SUM(prl.quantity) as returned_line_qty
         FROM purchase_returns pr
         JOIN purchase_return_lines prl ON pr.id = prl.purchase_return_id
         LEFT JOIN purchase_return_line_batches prlb ON prl.id = prlb.purchase_return_line_id
         WHERE pr.purchase_invoice_id = $1 AND pr.status = 'POSTED'
         GROUP BY prlb.batch_id, prl.purchase_invoice_line_id`,
        [purchaseInvoiceId]
      );

      const postedReturnedByBatch = new Map<string, number>();
      const postedReturnedByLine = new Map<string, number>();
      for (const row of prevReturnsRes.rows) {
        if (row.purchase_invoice_line_id) {
          postedReturnedByLine.set(
            row.purchase_invoice_line_id,
            round2((postedReturnedByLine.get(row.purchase_invoice_line_id) || 0) + parseFloat(row.returned_line_qty || '0'))
          );
        }
        if (row.batch_id) {
          const key = `${row.purchase_invoice_line_id}_${row.batch_id}`;
          postedReturnedByBatch.set(
            key,
            round2((postedReturnedByBatch.get(key) || 0) + parseFloat(row.returned_batch_qty || '0'))
          );
        }
      }

      // 5. Calculate pending Dealer Returns that are not cancelled or rejected
      const pendingDealerReturnsRes = await client.query(
        `SELECT 
           drl.dealer_purchase_invoice_line_id,
           drl.dealer_batch_id,
           SUM(drl.requested_quantity) as pending_qty
         FROM dealer_returns dr
         JOIN dealer_return_lines drl ON dr.id = drl.dealer_return_id
         WHERE dr.dealer_purchase_invoice_id = $1
           AND dr.status IN ('REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')
         GROUP BY drl.dealer_purchase_invoice_line_id, drl.dealer_batch_id`,
        [purchaseInvoiceId]
      );

      const pendingByBatch = new Map<string, number>();
      const pendingByLine = new Map<string, number>();
      for (const row of pendingDealerReturnsRes.rows) {
        if (row.dealer_purchase_invoice_line_id) {
          pendingByLine.set(
            row.dealer_purchase_invoice_line_id,
            round2((pendingByLine.get(row.dealer_purchase_invoice_line_id) || 0) + parseFloat(row.pending_qty || '0'))
          );
        }
        if (row.dealer_batch_id) {
          const key = `${row.dealer_purchase_invoice_line_id}_${row.dealer_batch_id}`;
          pendingByBatch.set(
            key,
            round2((pendingByBatch.get(key) || 0) + parseFloat(row.pending_qty || '0'))
          );
        }
      }

      // 6. Group into clean lines and batches structure
      const linesMap = new Map<string, any>();

      for (const row of linesRes.rows) {
        let line = linesMap.get(row.line_id);
        if (!line) {
          const purchasedQty = parseFloat(row.purchased_quantity || '0');
          const postedReturned = postedReturnedByLine.get(row.line_id) || 0;
          const pendingReturned = pendingByLine.get(row.line_id) || 0;
          const maxReturnable = Math.max(0, round2(purchasedQty - postedReturned - pendingReturned));

          line = {
            lineId: row.line_id,
            uniqueItemId: row.unique_item_id,
            itemCode: row.item_code,
            itemName: row.item_name,
            opticalCategory: row.optical_category,
            unit: row.unit || 'PRS',
            purchasedQuantity: purchasedQty,
            rate: parseFloat(row.rate || '0'),
            discountType: row.discount_type,
            discountValue: parseFloat(row.discount_value || '0'),
            gstRate: parseFloat(row.gst_rate || '0'),
            postedReturnedQuantity: postedReturned,
            pendingReturnedQuantity: pendingReturned,
            maximumReturnable: maxReturnable,
            batches: [],
          };
          linesMap.set(row.line_id, line);
        }

        if (row.batch_id) {
          const batchPurchased = parseFloat(row.batch_purchased_quantity || row.purchased_quantity || '0');
          const key = `${row.line_id}_${row.batch_id}`;
          const batchPostedReturned = postedReturnedByBatch.get(key) || 0;
          const batchPendingReturned = pendingByBatch.get(key) || 0;
          const batchMaxReturnable = Math.max(0, round2(batchPurchased - batchPostedReturned - batchPendingReturned));

          line.batches.push({
            batchId: row.batch_id,
            barcode: row.barcode,
            sph: row.sph !== null ? parseFloat(row.sph) : null,
            cyl: row.cyl !== null ? parseFloat(row.cyl) : null,
            axis: row.axis !== null ? parseFloat(row.axis) : null,
            add: row.add !== null ? parseFloat(row.add) : null,
            side: row.side || 'NONE',
            identityKey: row.identity_key,
            categoryName: row.category_name,
            purchasedQuantity: batchPurchased,
            postedReturnedQuantity: batchPostedReturned,
            pendingReturnedQuantity: batchPendingReturned,
            maximumReturnable: batchMaxReturnable,
            rate: parseFloat(row.batch_rate || row.rate || '0'),
          });
        }
      }

      const formattedLines = Array.from(linesMap.values());
      const totalReturnableQty = formattedLines.reduce((sum, l) => sum + l.maximumReturnable, 0);

      return {
        invoice: {
          id: inv.id,
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.invoice_date,
          supplierInvoiceNumber: inv.supplier_invoice_number,
          supplierPartyId: inv.supplier_party_id,
          supplierName: inv.supplier_name,
          supplierTradeName: inv.supplier_trade_name,
          grandTotal: parseFloat(inv.grand_total || '0'),
          status: inv.status,
          mainBusinessId,
          mainBusinessName,
          mainSalesInvoiceId,
        },
        lines: formattedLines,
        isEligible: totalReturnableQty > 0,
        totalReturnableQty,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 2. CREATE DEALER RETURN REQUEST
   * Initiates a return request against an original Purchase Invoice.
   * DOES NOT alter Dealer stock, Main stock, or financial ledgers!
   */
  static async createDealerReturnRequest(
    dealerBusinessId: string,
    input: CreateDealerReturnRequestInput,
    userId?: string
  ) {
    const { dealerPurchaseInvoiceId, returnReason, dealerReference, notes, lines } = input;

    if (!dealerPurchaseInvoiceId) {
      throw new Error('Purchase Invoice ID is required to create a return request.');
    }

    if (!returnReason) {
      throw new Error('Return reason is required.');
    }

    if (!lines || lines.length === 0) {
      throw new Error('At least one item line must be included in the return request.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock Purchase Invoice FOR UPDATE
      const invRes = await client.query(
        `SELECT pi.*, p.name as supplier_name, mb.id as parent_main_id
         FROM purchase_invoices pi
         JOIN parties p ON pi.supplier_party_id = p.id
         JOIN businesses db ON pi.business_id = db.id
         LEFT JOIN businesses mb ON db.parent_business_id = mb.id
         WHERE pi.id = $1 AND pi.business_id = $2 FOR UPDATE OF pi`,
        [dealerPurchaseInvoiceId, dealerBusinessId]
      );

      if (invRes.rows.length === 0) {
        throw new Error('Purchase Invoice not found or does not belong to this dealer business.');
      }

      const inv = invRes.rows[0];

      if (inv.status !== 'POSTED') {
        throw new Error(`Cannot return against ${inv.status} Purchase Invoice. Invoice must be POSTED.`);
      }

      // 2. Resolve Main Warehouse business & Main Sales Invoice
      let mainBusinessId = inv.parent_main_id;
      let mainSalesInvoiceId = inv.main_sales_invoice_id;

      if (!mainBusinessId || !mainSalesInvoiceId) {
        const grnRes = await client.query(
          `SELECT gr.main_business_id, ds.main_sales_invoice_id
           FROM dealer_goods_receipts gr
           LEFT JOIN dealer_shipments ds ON gr.dealer_shipment_id = ds.id
           WHERE gr.dealer_purchase_invoice_id = $1 LIMIT 1`,
          [dealerPurchaseInvoiceId]
        );
        if (grnRes.rows.length > 0) {
          mainBusinessId = mainBusinessId || grnRes.rows[0].main_business_id;
          mainSalesInvoiceId = mainSalesInvoiceId || grnRes.rows[0].main_sales_invoice_id;
        }
      }

      if (!mainBusinessId) {
        throw new Error('Cannot determine Main Warehouse for this dealer. Parent business is not configured.');
      }

      // 3. Validate each line: Quantity step rules & Maximum returnable
      let totalRequestedQty = 0;
      const validatedLines: Array<{
        dealerPurchaseInvoiceLineId: string;
        dealerUniqueItemId: string;
        dealerBatchId: string;
        mainUniqueItemId: string | null;
        mainBatchId: string | null;
        mainSalesInvoiceLineId: string | null;
        requestedQuantity: number;
        rate: number;
        gstRate: number;
        reason?: string;
        notes?: string;
      }> = [];

      for (const line of lines) {
        const reqQty = round2(line.requestedQuantity);
        if (reqQty <= 0) continue;

        // Fetch invoice line details and unit
        const lineRes = await client.query(
          `SELECT pil.*, ui.code as item_code, ui.unit, ob.identity_key, ob.sph, ob.cyl, ob.axis, ob.add, ob.side
           FROM purchase_invoice_lines pil
           JOIN unique_items ui ON pil.unique_item_id = ui.id
           JOIN optical_batches ob ON ob.id = $1
           WHERE pil.id = $2 AND pil.purchase_invoice_id = $3`,
          [line.dealerBatchId, line.dealerPurchaseInvoiceLineId, dealerPurchaseInvoiceId]
        );

        if (lineRes.rows.length === 0) {
          throw new Error(`Invoice line ${line.dealerPurchaseInvoiceLineId} or batch ${line.dealerBatchId} not found.`);
        }

        const invLine = lineRes.rows[0];

        // Validate optical step rules
        validateOpticalReturnQuantity(reqQty, invLine.unit);

        // Calculate already returned via posted Purchase Returns
        const prevPrRes = await client.query(
          `SELECT COALESCE(SUM(prlb.quantity), 0) as returned_qty
           FROM purchase_returns pr
           JOIN purchase_return_lines prl ON pr.id = prl.purchase_return_id
           JOIN purchase_return_line_batches prlb ON prl.id = prlb.purchase_return_line_id
           WHERE pr.purchase_invoice_id = $1 
             AND pr.status = 'POSTED'
             AND prl.purchase_invoice_line_id = $2
             AND prlb.batch_id = $3`,
          [dealerPurchaseInvoiceId, line.dealerPurchaseInvoiceLineId, line.dealerBatchId]
        );
        const alreadyPostedQty = parseFloat(prevPrRes.rows[0].returned_qty || '0');

        // Calculate pending requested quantity in other active Dealer Returns
        const pendingDrRes = await client.query(
          `SELECT COALESCE(SUM(drl.requested_quantity), 0) as pending_qty
           FROM dealer_returns dr
           JOIN dealer_return_lines drl ON dr.id = drl.dealer_return_id
           WHERE dr.dealer_purchase_invoice_id = $1
             AND dr.status IN ('REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')
             AND drl.dealer_purchase_invoice_line_id = $2
             AND drl.dealer_batch_id = $3`,
          [dealerPurchaseInvoiceId, line.dealerPurchaseInvoiceLineId, line.dealerBatchId]
        );
        const alreadyPendingQty = parseFloat(pendingDrRes.rows[0].pending_qty || '0');

        // Fetch original batch quantity for this invoice line
        const batchLineRes = await client.query(
          `SELECT quantity FROM purchase_invoice_line_batches 
           WHERE purchase_invoice_line_id = $1 AND batch_id = $2`,
          [line.dealerPurchaseInvoiceLineId, line.dealerBatchId]
        );

        const originalBatchQty = batchLineRes.rows.length > 0
          ? parseFloat(batchLineRes.rows[0].quantity)
          : parseFloat(invLine.quantity);

        const maxReturnable = round2(originalBatchQty - alreadyPostedQty - alreadyPendingQty);

        if (reqQty > maxReturnable) {
          throw new Error(
            `Requested return quantity (${reqQty}) exceeds maximum returnable quantity (${maxReturnable}) for item ${invLine.item_code} (Batch ID: ${line.dealerBatchId})`
          );
        }

        // 4. Resolve exact Main Item & Main Batch from GRN or Optical Identity
        let mainUniqueItemId: string | null = null;
        let mainBatchId: string | null = null;
        let mainSalesInvoiceLineId: string | null = null;

        // Try dealer_goods_receipt_lines first
        const grnLineRes = await client.query(
          `SELECT dgrl.main_unique_item_id, dgrl.main_batch_id, dsl.sales_invoice_line_id
           FROM dealer_goods_receipt_lines dgrl
           JOIN dealer_goods_receipts dgr ON dgrl.goods_receipt_id = dgr.id
           JOIN dealer_shipment_lines dsl ON dgrl.shipment_line_id = dsl.id
           WHERE dgr.dealer_purchase_invoice_id = $1 
             AND dgrl.dealer_batch_id = $2
           LIMIT 1`,
          [dealerPurchaseInvoiceId, line.dealerBatchId]
        );

        if (grnLineRes.rows.length > 0) {
          mainUniqueItemId = grnLineRes.rows[0].main_unique_item_id;
          mainBatchId = grnLineRes.rows[0].main_batch_id;
          mainSalesInvoiceLineId = grnLineRes.rows[0].sales_invoice_line_id;
        } else if (mainSalesInvoiceId) {
          // Canonical optical identity matching in Main Sales Invoice
          const matchRes = await client.query(
            `SELECT sil.id as sales_invoice_line_id, sil.unique_item_id, silb.batch_id
             FROM sales_invoice_lines sil
             JOIN sales_invoice_line_batches silb ON sil.id = silb.sales_invoice_line_id
             JOIN optical_batches mob ON silb.batch_id = mob.id
             WHERE sil.sales_invoice_id = $1
               AND ROUND(mob.sph::numeric, 2) = ROUND($2::numeric, 2)
               AND ROUND(mob.cyl::numeric, 2) = ROUND($3::numeric, 2)
               AND ROUND(COALESCE(mob.axis, 0)::numeric, 2) = ROUND(COALESCE($4, 0)::numeric, 2)
               AND ROUND(COALESCE(mob.add, 0)::numeric, 2) = ROUND(COALESCE($5, 0)::numeric, 2)
               AND COALESCE(mob.side, 'NONE') = COALESCE($6, 'NONE')
             LIMIT 1`,
            [
              mainSalesInvoiceId,
              invLine.sph || 0,
              invLine.cyl || 0,
              invLine.axis || 0,
              invLine.add || 0,
              invLine.side || 'NONE',
            ]
          );

          if (matchRes.rows.length > 0) {
            mainUniqueItemId = matchRes.rows[0].unique_item_id;
            mainBatchId = matchRes.rows[0].batch_id;
            mainSalesInvoiceLineId = matchRes.rows[0].sales_invoice_line_id;
          }
        }

        totalRequestedQty = round2(totalRequestedQty + reqQty);

        validatedLines.push({
          dealerPurchaseInvoiceLineId: line.dealerPurchaseInvoiceLineId,
          dealerUniqueItemId: invLine.unique_item_id,
          dealerBatchId: line.dealerBatchId,
          mainUniqueItemId,
          mainBatchId,
          mainSalesInvoiceLineId,
          requestedQuantity: reqQty,
          rate: parseFloat(invLine.rate || '0'),
          gstRate: parseFloat(invLine.gst_rate || '0'),
          reason: line.reason || returnReason,
          notes: line.notes,
        });
      }

      if (validatedLines.length === 0 || totalRequestedQty <= 0) {
        throw new Error('At least one line must have a valid return quantity greater than 0.');
      }

      // 5. Generate return number: DR-YYYYMM-XXXX
      const returnNumber = await this.generateReturnNumber(client, dealerBusinessId);

      // 6. Insert Dealer Return Header (Status: REQUESTED)
      const drRes = await client.query(
        `INSERT INTO dealer_returns (
          return_number, dealer_business_id, main_business_id,
          dealer_purchase_invoice_id, main_sales_invoice_id,
          status, return_reason, dealer_reference, notes,
          total_requested_qty, total_approved_qty, total_sent_qty,
          total_received_qty, total_accepted_qty, total_damaged_qty,
          created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3,
          $4, $5,
          'REQUESTED', $6, $7, $8,
          $9, 0.00, 0.00,
          0.00, 0.00, 0.00,
          $10, NOW(), NOW()
        ) RETURNING *`,
        [
          returnNumber,
          dealerBusinessId,
          mainBusinessId,
          dealerPurchaseInvoiceId,
          mainSalesInvoiceId || null,
          returnReason,
          dealerReference || null,
          notes || null,
          totalRequestedQty,
          userId || null,
        ]
      );

      const createdReturn = drRes.rows[0];

      // 7. Insert Dealer Return Lines
      for (const vl of validatedLines) {
        await client.query(
          `INSERT INTO dealer_return_lines (
            dealer_return_id, dealer_purchase_invoice_line_id, main_sales_invoice_line_id,
            dealer_unique_item_id, dealer_batch_id,
            main_unique_item_id, main_batch_id,
            rate, gst_rate,
            requested_quantity, approved_quantity, sent_quantity,
            received_quantity, accepted_quantity, damaged_quantity,
            reason, notes, created_at
          ) VALUES (
            $1, $2, $3,
            $4, $5,
            $6, $7,
            $8, $9,
            $10, 0.00, 0.00,
            0.00, 0.00, 0.00,
            $11, $12, NOW()
          )`,
          [
            createdReturn.id,
            vl.dealerPurchaseInvoiceLineId,
            vl.mainSalesInvoiceLineId,
            vl.dealerUniqueItemId,
            vl.dealerBatchId,
            vl.mainUniqueItemId,
            vl.mainBatchId,
            vl.rate,
            vl.gstRate,
            vl.requestedQuantity,
            vl.reason || null,
            vl.notes || null,
          ]
        );
      }

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId: dealerBusinessId,
        userId,
        module: 'purchase',
        action: 'DEALER_RETURN_REQUESTED',
        entityType: 'DEALER_RETURN',
        entityId: createdReturn.id,
        newValue: {
          returnNumber,
          purchaseInvoiceId: dealerPurchaseInvoiceId,
          totalRequestedQty,
          returnReason,
          status: 'REQUESTED',
        },
      });

      return await this.getDealerReturnById(dealerBusinessId, createdReturn.id, false);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 3. GET DEALER RETURNS LIST
   * Supports filtering by status, dealer, or search term with strict tenant isolation.
   */
  static async getDealerReturnsList(
    businessId: string,
    isMain: boolean,
    filters?: { status?: string; dealerBusinessId?: string; search?: string }
  ) {
    const client = await pool.connect();
    try {
      const conditions: string[] = [];
      const params: any[] = [];

      if (isMain) {
        params.push(businessId);
        conditions.push(`dr.main_business_id = $${params.length}`);
        if (filters?.dealerBusinessId) {
          params.push(filters.dealerBusinessId);
          conditions.push(`dr.dealer_business_id = $${params.length}`);
        }
      } else {
        params.push(businessId);
        conditions.push(`dr.dealer_business_id = $${params.length}`);
      }

      if (filters?.status && filters.status !== 'ALL') {
        params.push(filters.status);
        conditions.push(`dr.status = $${params.length}`);
      }

      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(
          `(dr.return_number ILIKE $${params.length} OR pi.invoice_number ILIKE $${params.length} OR db.name ILIKE $${params.length})`
        );
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const query = `
        SELECT 
          dr.*,
          db.name as dealer_business_name,
          db.trade_name as dealer_trade_name,
          mb.name as main_business_name,
          pi.invoice_number as purchase_invoice_number,
          pi.invoice_date as purchase_invoice_date,
          si.invoice_number as sales_invoice_number,
          pr.return_number as purchase_return_number,
          sr.return_number as sales_return_number,
          u.full_name as created_by_name,
          app_u.full_name as approved_by_name,
          COUNT(drl.id) as lines_count
        FROM dealer_returns dr
        JOIN businesses db ON dr.dealer_business_id = db.id
        JOIN businesses mb ON dr.main_business_id = mb.id
        JOIN purchase_invoices pi ON dr.dealer_purchase_invoice_id = pi.id
        LEFT JOIN sales_invoices si ON dr.main_sales_invoice_id = si.id
        LEFT JOIN purchase_returns pr ON dr.dealer_purchase_return_id = pr.id
        LEFT JOIN sales_returns sr ON dr.main_sales_return_id = sr.id
        LEFT JOIN users u ON dr.created_by = u.id
        LEFT JOIN users app_u ON dr.approved_by = app_u.id
        LEFT JOIN dealer_return_lines drl ON dr.id = drl.dealer_return_id
        ${whereClause}
        GROUP BY dr.id, db.name, db.trade_name, mb.name, pi.invoice_number, pi.invoice_date, si.invoice_number, pr.return_number, sr.return_number, u.full_name, app_u.full_name
        ORDER BY dr.created_at DESC
      `;

      const res = await client.query(query, params);
      return res.rows.map(r => ({
        ...r,
        total_requested_qty: parseFloat(r.total_requested_qty || '0'),
        total_approved_qty: parseFloat(r.total_approved_qty || '0'),
        total_sent_qty: parseFloat(r.total_sent_qty || '0'),
        total_received_qty: parseFloat(r.total_received_qty || '0'),
        total_accepted_qty: parseFloat(r.total_accepted_qty || '0'),
        total_damaged_qty: parseFloat(r.total_damaged_qty || '0'),
        lines_count: parseInt(r.lines_count || '0', 10),
      }));
    } finally {
      client.release();
    }
  }

  /**
   * 4. GET DEALER RETURN BY ID
   * Full details including lines, batch powers, and audit status.
   */
  static async getDealerReturnById(businessId: string, returnId: string, isMain: boolean) {
    const client = await pool.connect();
    try {
      const authCondition = isMain ? 'dr.main_business_id = $1' : 'dr.dealer_business_id = $1';

      const res = await client.query(
        `SELECT 
           dr.*,
           db.name as dealer_business_name,
           db.trade_name as dealer_trade_name,
           db.gstin as dealer_gstin,
           db.city as dealer_city,
           db.state as dealer_state,
           mb.name as main_business_name,
           mb.trade_name as main_trade_name,
           pi.invoice_number as purchase_invoice_number,
           pi.invoice_date as purchase_invoice_date,
           si.invoice_number as sales_invoice_number,
           pr.return_number as purchase_return_number,
           sr.return_number as sales_return_number,
           u.full_name as created_by_name,
           app_u.full_name as approved_by_name
         FROM dealer_returns dr
         JOIN businesses db ON dr.dealer_business_id = db.id
         JOIN businesses mb ON dr.main_business_id = mb.id
         JOIN purchase_invoices pi ON dr.dealer_purchase_invoice_id = pi.id
         LEFT JOIN sales_invoices si ON dr.main_sales_invoice_id = si.id
         LEFT JOIN purchase_returns pr ON dr.dealer_purchase_return_id = pr.id
         LEFT JOIN sales_returns sr ON dr.main_sales_return_id = sr.id
         LEFT JOIN users u ON dr.created_by = u.id
         LEFT JOIN users app_u ON dr.approved_by = app_u.id
         WHERE ${authCondition} AND dr.id = $2`,
        [businessId, returnId]
      );

      if (res.rows.length === 0) {
        throw new Error('Dealer Return not found or access unauthorized.');
      }

      const returnDoc = res.rows[0];

      // Fetch Lines
      const linesRes = await client.query(
        `SELECT 
           drl.*,
           ui.code as item_code,
           ui.name as item_name,
           ui.optical_category,
           ui.unit,
           ob.barcode,
           ob.sph,
           ob.cyl,
           ob.axis,
           ob.add,
           ob.side,
           ob.identity_key,
           c.name as category_name
         FROM dealer_return_lines drl
         JOIN unique_items ui ON drl.dealer_unique_item_id = ui.id
         JOIN optical_batches ob ON drl.dealer_batch_id = ob.id
         LEFT JOIN categories c ON ob.category_id = c.id
         WHERE drl.dealer_return_id = $1
         ORDER BY drl.created_at ASC`,
        [returnId]
      );

      return {
        ...returnDoc,
        total_requested_qty: parseFloat(returnDoc.total_requested_qty || '0'),
        total_approved_qty: parseFloat(returnDoc.total_approved_qty || '0'),
        total_sent_qty: parseFloat(returnDoc.total_sent_qty || '0'),
        total_received_qty: parseFloat(returnDoc.total_received_qty || '0'),
        total_accepted_qty: parseFloat(returnDoc.total_accepted_qty || '0'),
        total_damaged_qty: parseFloat(returnDoc.total_damaged_qty || '0'),
        lines: linesRes.rows.map(l => ({
          ...l,
          rate: parseFloat(l.rate || '0'),
          gst_rate: parseFloat(l.gst_rate || '0'),
          requested_quantity: parseFloat(l.requested_quantity || '0'),
          approved_quantity: parseFloat(l.approved_quantity || '0'),
          sent_quantity: parseFloat(l.sent_quantity || '0'),
          received_quantity: parseFloat(l.received_quantity || '0'),
          accepted_quantity: parseFloat(l.accepted_quantity || '0'),
          damaged_quantity: parseFloat(l.damaged_quantity || '0'),
          sph: l.sph !== null ? parseFloat(l.sph) : null,
          cyl: l.cyl !== null ? parseFloat(l.cyl) : null,
          axis: l.axis !== null ? parseFloat(l.axis) : null,
          add: l.add !== null ? parseFloat(l.add) : null,
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * 5. MAIN WAREHOUSE APPROVE RETURN
   * Main reviews requested return and approves quantity (full or partial).
   * DOES NOT alter stock or ledgers!
   */
  static async approveDealerReturn(
    mainBusinessId: string,
    returnId: string,
    input: ApproveDealerReturnInput,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const retRes = await client.query(
        `SELECT * FROM dealer_returns 
         WHERE id = $1 AND main_business_id = $2 FOR UPDATE`,
        [returnId, mainBusinessId]
      );

      if (retRes.rows.length === 0) {
        throw new Error('Dealer Return not found or does not belong to your warehouse.');
      }

      const returnDoc = retRes.rows[0];

      if (returnDoc.status !== 'REQUESTED') {
        throw new Error(`Cannot approve return with status '${returnDoc.status}'. Only REQUESTED returns can be approved.`);
      }

      // Fetch existing lines
      const linesRes = await client.query(
        `SELECT drl.*, ui.unit 
         FROM dealer_return_lines drl
         JOIN unique_items ui ON drl.dealer_unique_item_id = ui.id
         WHERE drl.dealer_return_id = $1`,
        [returnId]
      );

      const dbLinesMap = new Map<string, any>(linesRes.rows.map(r => [r.id, r]));
      let totalApprovedQty = 0;

      const linesToProcess = (Array.isArray(input.lines) && input.lines.length > 0)
        ? input.lines
        : linesRes.rows.map(r => ({
            lineId: r.id,
            approvedQuantity: parseFloat(r.requested_quantity),
          }));

      for (const appLine of linesToProcess) {
        const dbLine = dbLinesMap.get(appLine.lineId);
        if (!dbLine) {
          throw new Error(`Return line ID ${appLine.lineId} not found.`);
        }

        const appQty = round2(appLine.approvedQuantity);
        if (appQty < 0) {
          throw new Error(`Approved quantity cannot be negative for line ${appLine.lineId}`);
        }

        const reqQty = parseFloat(dbLine.requested_quantity);
        if (appQty > reqQty) {
          throw new Error(`Approved quantity (${appQty}) cannot exceed requested quantity (${reqQty}) for line ${appLine.lineId}`);
        }

        if (appQty > 0) {
          validateOpticalReturnQuantity(appQty, dbLine.unit);
        }

        await client.query(
          `UPDATE dealer_return_lines 
           SET approved_quantity = $1 
           WHERE id = $2`,
          [appQty, appLine.lineId]
        );

        totalApprovedQty = round2(totalApprovedQty + appQty);
      }

      if (totalApprovedQty <= 0) {
        throw new Error('At least one item must have an approved quantity greater than 0. Otherwise reject the return.');
      }

      // Update Header
      await client.query(
        `UPDATE dealer_returns 
         SET status = 'APPROVED',
             total_approved_qty = $1,
             approved_by = $2,
             approved_at = NOW(),
             notes = COALESCE($3, notes),
             updated_at = NOW()
         WHERE id = $4`,
        [totalApprovedQty, userId || null, input.notes || null, returnId]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId: mainBusinessId,
        userId,
        module: 'sales',
        action: 'DEALER_RETURN_APPROVED',
        entityType: 'DEALER_RETURN',
        entityId: returnId,
        newValue: {
          returnNumber: returnDoc.return_number,
          totalApprovedQty,
          status: 'APPROVED',
        },
      });

      return await this.getDealerReturnById(mainBusinessId, returnId, true);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 6. MAIN WAREHOUSE REJECT RETURN
   */
  static async rejectDealerReturn(
    mainBusinessId: string,
    returnId: string,
    rejectionReason: string,
    userId?: string
  ) {
    if (!rejectionReason) {
      throw new Error('Rejection reason is required.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const retRes = await client.query(
        `SELECT * FROM dealer_returns 
         WHERE id = $1 AND main_business_id = $2 FOR UPDATE`,
        [returnId, mainBusinessId]
      );

      if (retRes.rows.length === 0) {
        throw new Error('Dealer Return not found or access unauthorized.');
      }

      const returnDoc = retRes.rows[0];

      if (returnDoc.status !== 'REQUESTED') {
        throw new Error(`Cannot reject return in status '${returnDoc.status}'. Only REQUESTED returns can be rejected.`);
      }

      await client.query(
        `UPDATE dealer_returns 
         SET status = 'REJECTED',
             rejection_reason = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [rejectionReason, returnId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId: mainBusinessId,
        userId,
        module: 'sales',
        action: 'DEALER_RETURN_REJECTED',
        entityType: 'DEALER_RETURN',
        entityId: returnId,
        newValue: {
          returnNumber: returnDoc.return_number,
          rejectionReason,
          status: 'REJECTED',
        },
      });

      return await this.getDealerReturnById(mainBusinessId, returnId, true);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 7. DEALER CANCEL RETURN
   */
  static async cancelDealerReturn(
    dealerBusinessId: string,
    returnId: string,
    reason?: string,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const retRes = await client.query(
        `SELECT * FROM dealer_returns 
         WHERE id = $1 AND dealer_business_id = $2 FOR UPDATE`,
        [returnId, dealerBusinessId]
      );

      if (retRes.rows.length === 0) {
        throw new Error('Dealer Return not found.');
      }

      const returnDoc = retRes.rows[0];

      if (returnDoc.status !== 'REQUESTED' && returnDoc.status !== 'APPROVED') {
        throw new Error(`Cannot cancel return in status '${returnDoc.status}'. Dispatched or received returns cannot be cancelled.`);
      }

      await client.query(
        `UPDATE dealer_returns 
         SET status = 'CANCELLED',
             notes = COALESCE($1, notes),
             updated_at = NOW()
         WHERE id = $2`,
        [reason ? `Cancelled by Dealer: ${reason}` : 'Cancelled by Dealer', returnId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId: dealerBusinessId,
        userId,
        module: 'purchase',
        action: 'DEALER_RETURN_CANCELLED',
        entityType: 'DEALER_RETURN',
        entityId: returnId,
        newValue: {
          returnNumber: returnDoc.return_number,
          status: 'CANCELLED',
        },
      });

      return await this.getDealerReturnById(dealerBusinessId, returnId, false);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 8. DEALER DISPATCH RETURN (POST PURCHASE RETURN & DECREASE DEALER STOCK)
   * Once approved, Dealer dispatches items back to Main Warehouse.
   * Invokes existing PurchaseReturnService to:
   * - Reduce physical and available stock in Dealer business exactly once.
   * - Post PURCHASE_RETURN to stock_ledger.
   * - Post DEBIT_NOTE to supplier_ledgers.
   * Updates Dealer Return status to IN_TRANSIT.
   * Main stock does NOT increase yet!
   */
  static async dispatchDealerReturn(
    dealerBusinessId: string,
    returnId: string,
    input: DispatchDealerReturnInput,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock Return FOR UPDATE
      const retRes = await client.query(
        `SELECT dr.*, pi.supplier_party_id
         FROM dealer_returns dr
         JOIN purchase_invoices pi ON dr.dealer_purchase_invoice_id = pi.id
         WHERE dr.id = $1 AND dr.dealer_business_id = $2 FOR UPDATE`,
        [returnId, dealerBusinessId]
      );

      if (retRes.rows.length === 0) {
        throw new Error('Dealer Return not found.');
      }

      const returnDoc = retRes.rows[0];

      if (returnDoc.status !== 'APPROVED') {
        throw new Error(`Cannot dispatch return in status '${returnDoc.status}'. Return must be APPROVED first.`);
      }

      if (returnDoc.dealer_purchase_return_id) {
        throw new Error('A Purchase Return has already been posted for this return.');
      }

      // 2. Fetch lines
      const linesRes = await client.query(
        `SELECT drl.*, ui.unit 
         FROM dealer_return_lines drl
         JOIN unique_items ui ON drl.dealer_unique_item_id = ui.id
         WHERE drl.dealer_return_id = $1`,
        [returnId]
      );

      const dbLinesMap = new Map<string, any>(linesRes.rows.map(r => [r.id, r]));
      const sentLinesMap = new Map<string, number>();

      if (input.lines && input.lines.length > 0) {
        for (const l of input.lines) {
          sentLinesMap.set(l.lineId, round2(l.sentQuantity));
        }
      }

      let totalSentQty = 0;
      const prLineInputs: Array<{
        purchaseInvoiceLineId: string;
        uniqueItemId: string;
        quantity: number;
        rate: number;
        batches: Array<{ batchId: string; quantity: number; rate: number }>;
      }> = [];

      for (const line of linesRes.rows) {
        const approvedQty = parseFloat(line.approved_quantity || '0');
        // Default to approved quantity if not specified in input
        const sentQty = sentLinesMap.has(line.id) ? sentLinesMap.get(line.id)! : approvedQty;

        if (sentQty < 0) {
          throw new Error(`Sent quantity cannot be negative for line ${line.id}`);
        }
        if (sentQty > approvedQty) {
          throw new Error(`Sent quantity (${sentQty}) cannot exceed approved quantity (${approvedQty}) for line ${line.id}`);
        }

        if (sentQty > 0) {
          validateOpticalReturnQuantity(sentQty, line.unit);

          await client.query(
            `UPDATE dealer_return_lines SET sent_quantity = $1 WHERE id = $2`,
            [sentQty, line.id]
          );

          totalSentQty = round2(totalSentQty + sentQty);

          prLineInputs.push({
            purchaseInvoiceLineId: line.dealer_purchase_invoice_line_id,
            uniqueItemId: line.dealer_unique_item_id,
            quantity: sentQty,
            rate: parseFloat(line.rate || '0'),
            batches: [
              {
                batchId: line.dealer_batch_id,
                quantity: sentQty,
                rate: parseFloat(line.rate || '0'),
              },
            ],
          });
        }
      }

      if (totalSentQty <= 0 || prLineInputs.length === 0) {
        throw new Error('At least one item must have a sent quantity greater than 0.');
      }

      await client.query('COMMIT');
      client.release();

      // 3. EXECUTE EXISTING PURCHASE RETURN POSTING
      // This will:
      // - Deduct physical and available stock in Dealer
      // - Post PURCHASE_RETURN to stock_ledger
      // - Post DEBIT_NOTE to supplier_ledgers
      const purchaseReturnInput: CreatePurchaseReturnInput = {
        purchaseInvoiceId: returnDoc.dealer_purchase_invoice_id,
        supplierPartyId: returnDoc.supplier_party_id,
        returnDate: input.dispatchDate ? new Date(input.dispatchDate) : new Date(),
        reason: returnDoc.return_reason,
        notes: `Dealer Return ${returnDoc.return_number} dispatched to Main Warehouse`,
        lines: prLineInputs,
      };

      const createdPR = await PurchaseReturnService.createPurchaseReturn(
        dealerBusinessId,
        purchaseReturnInput,
        userId
      );

      // Post the Purchase Return authoritatively
      await PurchaseReturnService.postPurchaseReturn(dealerBusinessId, createdPR.id, userId);

      // 4. Update Dealer Return with PR Link and IN_TRANSIT status
      await pool.query(
        `UPDATE dealer_returns 
         SET status = 'IN_TRANSIT',
             dealer_purchase_return_id = $1,
             total_sent_qty = $2,
             dispatch_date = $3,
             courier_name = $4,
             tracking_number = $5,
             notes = COALESCE($6, notes),
             updated_at = NOW()
         WHERE id = $7`,
        [
          createdPR.id,
          totalSentQty,
          input.dispatchDate ? new Date(input.dispatchDate) : new Date(),
          input.courierName || null,
          input.trackingNumber || null,
          input.notes || null,
          returnId,
        ]
      );

      // Audit Log
      await AuditService.log({
        businessId: dealerBusinessId,
        userId,
        module: 'purchase',
        action: 'DEALER_PURCHASE_RETURN_POSTED',
        entityType: 'DEALER_RETURN',
        entityId: returnId,
        newValue: {
          returnNumber: returnDoc.return_number,
          purchaseReturnId: createdPR.id,
          totalSentQty,
          status: 'IN_TRANSIT',
        },
      });

      return await this.getDealerReturnById(dealerBusinessId, returnId, false);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      try {
        client.release();
      } catch (_) {}
    }
  }

  /**
   * 9. MAIN WAREHOUSE RECEIVE RETURN & EXECUTE SALES RETURN
   * Physical intake inspection by Main Warehouse.
   * - Inspects received, accepted (saleable), and damaged/short goods.
   * - Restores stock ONLY for accepted saleable quantity via existing SalesReturnService!
   * - Posts SALES_RETURN to stock_ledger in Main.
   * - Posts Credit Note to customer_ledgers (reduces Dealer balance).
   * - Damaged items do NOT enter saleable stock.
   * - Supports partial receipt: updates status to PARTIALLY_RECEIVED or RECEIVED.
   */
  static async receiveDealerReturn(
    mainBusinessId: string,
    returnId: string,
    input: ReceiveDealerReturnInput,
    userId?: string
  ) {
    if (!input.lines || input.lines.length === 0) {
      throw new Error('At least one line must be inspected to receive return.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock return record FOR UPDATE
      const retRes = await client.query(
        `SELECT dr.*, si.party_id as customer_party_id, si.invoice_number as main_si_number
         FROM dealer_returns dr
         LEFT JOIN sales_invoices si ON dr.main_sales_invoice_id = si.id
         WHERE dr.id = $1 AND dr.main_business_id = $2 FOR UPDATE OF dr`,
        [returnId, mainBusinessId]
      );

      if (retRes.rows.length === 0) {
        throw new Error('Dealer Return not found or does not belong to your warehouse.');
      }

      const returnDoc = retRes.rows[0];

      if (returnDoc.status !== 'IN_TRANSIT' && returnDoc.status !== 'PARTIALLY_RECEIVED') {
        throw new Error(`Cannot receive return in status '${returnDoc.status}'. Return must be IN_TRANSIT or PARTIALLY_RECEIVED.`);
      }

      if (!returnDoc.main_sales_invoice_id) {
        throw new Error('Linked Main Sales Invoice is missing. Cannot post Sales Return.');
      }

      // 2. Fetch lines
      const linesRes = await client.query(
        `SELECT drl.*, ui.unit 
         FROM dealer_return_lines drl
         LEFT JOIN unique_items ui ON drl.main_unique_item_id = ui.id
         WHERE drl.dealer_return_id = $1`,
        [returnId]
      );

      const dbLinesMap = new Map<string, any>(linesRes.rows.map(r => [r.id, r]));
      let batchAcceptedForSalesReturn: Array<{
        salesInvoiceLineId: string;
        uniqueItemId: string;
        batchId: string;
        quantity: number;
        rate: number;
      }> = [];

      let sessionReceivedTotal = 0;
      let sessionAcceptedTotal = 0;
      let sessionDamagedTotal = 0;

      for (const recLine of input.lines) {
        const lineIdToFind = recLine.lineId || (recLine as any).returnLineId;
        const dbLine = dbLinesMap.get(lineIdToFind);
        if (!dbLine) {
          throw new Error(`Line ${lineIdToFind} not found in this return.`);
        }

        const recv = round2(recLine.receivedQuantity || 0);
        const acc = round2(recLine.acceptedQuantity || 0);
        const dmg = round2(recLine.damagedQuantity || 0);

        if (acc + dmg > recv) {
          throw new Error(`Accepted (${acc}) + Damaged (${dmg}) cannot exceed Received (${recv}) for line ${recLine.lineId}`);
        }

        const sentQty = parseFloat(dbLine.sent_quantity || '0');
        const prevRecv = parseFloat(dbLine.received_quantity || '0');
        const maxReceivable = round2(sentQty - prevRecv);

        if (recv > maxReceivable) {
          throw new Error(`Received quantity (${recv}) exceeds remaining sent quantity (${maxReceivable}) for line ${recLine.lineId}`);
        }

        if (recv <= 0) continue;

        if (acc > 0) {
          validateOpticalReturnQuantity(acc, dbLine.unit);
        }

        // Update dealer_return_lines quantities
        await client.query(
          `UPDATE dealer_return_lines 
           SET received_quantity = received_quantity + $1,
               accepted_quantity = accepted_quantity + $2,
               damaged_quantity = damaged_quantity + $3,
               notes = COALESCE($4, notes)
           WHERE id = $5`,
          [recv, acc, dmg, recLine.notes || null, recLine.lineId]
        );

        sessionReceivedTotal = round2(sessionReceivedTotal + recv);
        sessionAcceptedTotal = round2(sessionAcceptedTotal + acc);
        sessionDamagedTotal = round2(sessionDamagedTotal + dmg);

        // Collect accepted lines for Main Sales Return posting
        if (acc > 0) {
          if (!dbLine.main_unique_item_id || !dbLine.main_batch_id || !dbLine.main_sales_invoice_line_id) {
            throw new Error(`Cannot match Main warehouse Item/Batch for line ${recLine.lineId}. Check optical batch mapping.`);
          }

          batchAcceptedForSalesReturn.push({
            salesInvoiceLineId: dbLine.main_sales_invoice_line_id,
            uniqueItemId: dbLine.main_unique_item_id,
            batchId: dbLine.main_batch_id,
            quantity: acc,
            rate: parseFloat(dbLine.rate || '0'),
          });
        }
      }

      // Check remaining across all lines to determine overall status
      const updatedLinesRes = await client.query(
        `SELECT 
           COALESCE(SUM(GREATEST(0, sent_quantity - received_quantity)), 0) as remaining_qty,
           COALESCE(SUM(received_quantity), 0) as total_received,
           COALESCE(SUM(accepted_quantity), 0) as total_accepted,
           COALESCE(SUM(damaged_quantity), 0) as total_damaged
         FROM dealer_return_lines
         WHERE dealer_return_id = $1`,
        [returnId]
      );

      const remainingQty = parseFloat(updatedLinesRes.rows[0].remaining_qty || '0');
      const newTotalReceived = parseFloat(updatedLinesRes.rows[0].total_received || '0');
      const newTotalAccepted = parseFloat(updatedLinesRes.rows[0].total_accepted || '0');
      const newTotalDamaged = parseFloat(updatedLinesRes.rows[0].total_damaged || '0');
      const newStatus = remainingQty <= 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

      await client.query(
        `UPDATE dealer_returns 
         SET status = $1,
             total_received_qty = $2,
             total_accepted_qty = $3,
             total_damaged_qty = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [newStatus, newTotalReceived, newTotalAccepted, newTotalDamaged, returnId]
      );

      await client.query('COMMIT');
      client.release();

      // 3. EXECUTE EXISTING SALES RETURN POSTING FOR ACCEPTED GOODS ONLY
      // This will:
      // - Increase physical and available stock in Main for accepted goods ONLY!
      // - Post SALES_RETURN to stock_ledger in Main.
      // - Post Credit Note to customer_ledgers (reduces Dealer balance).
      let createdSR: any = null;
      if (batchAcceptedForSalesReturn.length > 0) {
        // Group by sales invoice line
        const srLinesMap = new Map<string, any>();
        for (const item of batchAcceptedForSalesReturn) {
          const existing = srLinesMap.get(item.salesInvoiceLineId);
          if (existing) {
            existing.quantity = round2(existing.quantity + item.quantity);
            existing.batches.push({
              batchId: item.batchId,
              quantity: item.quantity,
            });
          } else {
            srLinesMap.set(item.salesInvoiceLineId, {
              salesInvoiceLineId: item.salesInvoiceLineId,
              uniqueItemId: item.uniqueItemId,
              quantity: item.quantity,
              rate: item.rate,
              batches: [
                {
                  batchId: item.batchId,
                  quantity: item.quantity,
                },
              ],
            });
          }
        }

        const salesReturnInput: CreateSalesReturnInput = {
          salesInvoiceId: returnDoc.main_sales_invoice_id,
          partyId: returnDoc.customer_party_id,
          returnDate: input.receiptDate ? new Date(input.receiptDate) : new Date(),
          reason: returnDoc.return_reason,
          notes: `Received from Dealer Return ${returnDoc.return_number}`,
          lines: Array.from(srLinesMap.values()),
        };

        createdSR = await SalesReturnService.createSalesReturn(
          mainBusinessId,
          salesReturnInput,
          userId
        );

        // Authoritatively post Sales Return
        await SalesReturnService.postSalesReturn(mainBusinessId, createdSR.id, userId);

        // Update dealer_returns with main_sales_return_id
        await pool.query(
          `UPDATE dealer_returns SET main_sales_return_id = $1 WHERE id = $2`,
          [createdSR.id, returnId]
        );
      }

      // Audit Log
      await AuditService.log({
        businessId: mainBusinessId,
        userId,
        module: 'sales',
        action: 'DEALER_RETURN_RECEIVED',
        entityType: 'DEALER_RETURN',
        entityId: returnId,
        newValue: {
          returnNumber: returnDoc.return_number,
          sessionReceivedTotal,
          sessionAcceptedTotal,
          sessionDamagedTotal,
          salesReturnId: createdSR ? createdSR.id : null,
          status: newStatus,
        },
      });

      return {
        success: true,
        status: newStatus,
        sessionReceivedTotal,
        sessionAcceptedTotal,
        sessionDamagedTotal,
        salesReturnId: createdSR ? createdSR.id : null,
        dealerReturn: await this.getDealerReturnById(mainBusinessId, returnId, true),
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      try {
        client.release();
      } catch (_) {}
    }
  }
}
