/**
 * Dealer Logistics & Physical Movement Domain Service (Phase 3C)
 * 
 * Implements the independent physical movement and accounting lifecycle:
 * 1. Main Warehouse Dispatch (Creates Shipment from Sales Invoice / Order)
 * 2. Dealer Incoming Shipments Tracking (Strict multi-tenant isolation)
 * 3. Dealer Goods Receipt (GRN) with Good, Damaged, and Short quantity verification
 * 4. Dealer Isolated Stock Intake & Transactional Stock Ledger Recording
 * 5. Automatic Dealer Purchase Invoice Generation & Supplier Accounting Posting
 */

import { pool } from '../db/index.js';
import { PoolClient } from 'pg';
import { BarcodeService } from './opticalMasterService.js';
import { PurchaseService, PurchaseLineInput } from './purchaseService.js';
import { DocumentSequenceService } from './documentSequenceService.js';

export interface DispatchLineInput {
  salesInvoiceLineId?: string | null;
  mainUniqueItemId: string;
  mainBatchId: string;
  quantity?: number;
  dispatchedQuantity?: number;
  rate?: number;
  gstRate?: number;
}

export interface CreateShipmentInput {
  mainBusinessId: string;
  dealerBusinessId?: string; // Optional if derived from sales invoice / order
  mainSalesInvoiceId?: string | null;
  mainSalesOrderId?: string | null;
  dealerOrderId?: string | null;
  dealerPurchaseOrderId?: string | null;
  dispatchDate?: string | Date;
  courierName?: string | null;
  trackingNumber?: string | null;
  vehicleNumber?: string | null;
  ewayBillNumber?: string | null;
  totalPackages?: number;
  notes?: string | null;
  lines?: DispatchLineInput[];
  userId?: string | null;
}

export interface GoodsReceiptLineInput {
  shipmentLineId: string;
  receivedQuantity: number;
  damagedQuantity?: number;
  shortQuantity?: number;
}

export interface ConfirmGoodsReceiptInput {
  dealerBusinessId: string;
  dealerShipmentId: string;
  receiptDate?: string | Date;
  remarks?: string | null;
  autoCreatePurchaseInvoice?: boolean;
  lines: GoodsReceiptLineInput[];
  userId?: string | null;
}

function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export class DealerLogisticsService {
  /**
   * Generates sequential shipment number: DSP-YYYYMM-XXXX
   */
  static async generateShipmentNumber(client: PoolClient, mainBusinessId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `DSP-${yearMonth}-`;

    const seqRes = await client.query(
      `SELECT shipment_number FROM dealer_shipments 
       WHERE main_business_id = $1 AND shipment_number LIKE $2
       ORDER BY shipment_number DESC LIMIT 1 FOR UPDATE`,
      [mainBusinessId, `${prefix}%`]
    );

    let nextSeq = 1;
    if (seqRes.rows.length > 0) {
      const lastNum = seqRes.rows[0].shipment_number;
      const parts = lastNum.split('-');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed)) {
        nextSeq = parsed + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Generates sequential Goods Receipt Note (GRN) number: GRN-YYYYMM-XXXX
   */
  static async generateReceiptNumber(client: PoolClient, dealerBusinessId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `GRN-${yearMonth}-`;

    const seqRes = await client.query(
      `SELECT receipt_number FROM dealer_goods_receipts 
       WHERE dealer_business_id = $1 AND receipt_number LIKE $2
       ORDER BY receipt_number DESC LIMIT 1 FOR UPDATE`,
      [dealerBusinessId, `${prefix}%`]
    );

    let nextSeq = 1;
    if (seqRes.rows.length > 0) {
      const lastNum = seqRes.rows[0].receipt_number;
      const parts = lastNum.split('-');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed)) {
        nextSeq = parsed + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Generates sequential Purchase Invoice number in Dealer: PUR-000001
   */
  static async generatePurchaseInvoiceNumber(client: PoolClient, businessId: string): Promise<string> {
    return await DocumentSequenceService.getNextVoucherNumber(client, businessId, 'PURCHASE_INVOICE');
  }

  /**
   * 1. CREATE DISPATCH / SHIPMENT (Main Warehouse Side)
   * Dispatches items against a Main Sales Invoice (or Sales Order).
   * MAIN stock was already deducted upon invoice creation; this step tracks logistics.
   * DEALER stock is NOT increased here.
   */
  static async createShipment(input: CreateShipmentInput) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const {
        mainBusinessId,
        mainSalesInvoiceId,
        mainSalesOrderId,
        dealerOrderId,
        dealerPurchaseOrderId,
        dispatchDate = new Date(),
        courierName,
        trackingNumber,
        vehicleNumber,
        ewayBillNumber,
        totalPackages = 1,
        notes,
        userId,
      } = input;

      let resolvedDealerBusinessId = input.dealerBusinessId;
      let resolvedSalesOrderId = mainSalesOrderId;
      let resolvedDealerOrderId = dealerOrderId;
      let resolvedSalesInvoiceId = mainSalesInvoiceId;
      let resolvedDealerPurchaseOrderId: string | null = dealerPurchaseOrderId || null;

      // If sales invoice is provided, resolve dealer business and verify ownership
      if (mainSalesInvoiceId) {
        const invRes = await client.query(
          `SELECT si.*, so.id as sales_order_id, d.id as dealer_order_id, d.dealer_business_id
           FROM sales_invoices si
           LEFT JOIN sales_orders so ON si.sales_order_id = so.id
           LEFT JOIN dealer_orders d ON d.main_sales_order_id = so.id
           WHERE si.id = $1 AND si.business_id = $2`,
          [mainSalesInvoiceId, mainBusinessId]
        );

        if (invRes.rows.length === 0) {
          throw new Error('Sales invoice not found or does not belong to Main Warehouse.');
        }

        const invoice = invRes.rows[0];
        if (invoice.status === 'CANCELLED') {
          throw new Error('Cannot create dispatch for a cancelled sales invoice.');
        }

        if (!resolvedDealerBusinessId) {
          resolvedDealerBusinessId = invoice.dealer_business_id;
        }
        if (!resolvedSalesOrderId && invoice.sales_order_id) {
          resolvedSalesOrderId = invoice.sales_order_id;
        }
        if (!resolvedDealerOrderId && invoice.dealer_order_id) {
          resolvedDealerOrderId = invoice.dealer_order_id;
        }
      }

      // If dealer business still not resolved, try resolving through dealer_orders
      if (!resolvedDealerBusinessId && resolvedDealerOrderId) {
        const doRes = await client.query(
          `SELECT dealer_business_id, main_sales_order_id FROM dealer_orders WHERE id = $1 AND main_business_id = $2`,
          [resolvedDealerOrderId, mainBusinessId]
        );
        if (doRes.rows.length > 0) {
          resolvedDealerBusinessId = doRes.rows[0].dealer_business_id;
          resolvedSalesOrderId = doRes.rows[0].main_sales_order_id;
        }
      }

      // Fallback: Check if the customer party in the sales invoice links to a dealer business
      if (!resolvedDealerBusinessId && mainSalesInvoiceId) {
        const partyRes = await client.query(
          `SELECT p.name, b.id as matched_business_id
           FROM sales_invoices si
           JOIN parties p ON si.customer_party_id = p.id
           LEFT JOIN businesses b ON (LOWER(b.name) = LOWER(p.name) OR LOWER(b.trade_name) = LOWER(p.name))
           WHERE si.id = $1`,
          [mainSalesInvoiceId]
        );
        if (partyRes.rows.length > 0 && partyRes.rows[0].matched_business_id) {
          resolvedDealerBusinessId = partyRes.rows[0].matched_business_id;
        }
      }

      if (!resolvedDealerBusinessId) {
        throw new Error('Target Dealer Business could not be identified for this dispatch.');
      }

      // Prepare shipment lines: if not explicitly supplied, extract from Sales Invoice batches
      let linesToDispatch: DispatchLineInput[] = input.lines || [];

      if (linesToDispatch.length === 0 && resolvedSalesInvoiceId) {
        // Auto-populate from sales invoice lines & allocated batches
        const linesRes = await client.query(
          `SELECT 
             sil.id as sales_invoice_line_id,
             sil.unique_item_id,
             sil.rate,
             sil.gst_rate,
             silb.batch_id,
             silb.quantity as allocated_quantity
           FROM sales_invoice_lines sil
           JOIN sales_invoice_line_batches silb ON sil.id = silb.sales_invoice_line_id
           WHERE sil.sales_invoice_id = $1`,
          [resolvedSalesInvoiceId]
        );

        if (linesRes.rows.length === 0) {
          throw new Error('No item batches found in Sales Invoice to dispatch.');
        }

        // Check how much has already been dispatched for each sales_invoice_line_id / batch
        for (const row of linesRes.rows) {
          const dispatchedRes = await client.query(
            `SELECT COALESCE(SUM(sdl.dispatched_quantity), 0) as already_dispatched
             FROM dealer_shipment_lines sdl
             JOIN dealer_shipments ds ON sdl.dealer_shipment_id = ds.id
             WHERE sdl.sales_invoice_line_id = $1 AND sdl.main_batch_id = $2 AND ds.status != 'CANCELLED'`,
            [row.sales_invoice_line_id, row.batch_id]
          );

          const alreadyDispatched = parseFloat(dispatchedRes.rows[0].already_dispatched || '0');
          const remainingToDispatch = round2(parseFloat(row.allocated_quantity) - alreadyDispatched);

          if (remainingToDispatch > 0) {
            linesToDispatch.push({
              salesInvoiceLineId: row.sales_invoice_line_id,
              mainUniqueItemId: row.unique_item_id,
              mainBatchId: row.batch_id,
              quantity: remainingToDispatch,
              rate: parseFloat(row.rate),
              gstRate: parseFloat(row.gst_rate),
            });
          }
        }
      }

      if (linesToDispatch.length === 0) {
        throw new Error('No remaining items available to dispatch. This invoice may have already been fully dispatched.');
      }

      // Calculate total dispatch quantity
      let totalQty = 0;
      for (const line of linesToDispatch) {
        const qty = line.dispatchedQuantity !== undefined ? Number(line.dispatchedQuantity) : Number(line.quantity || 0);
        (line as any).quantity = qty;
        if (qty <= 0) {
          throw new Error('Dispatched quantity must be greater than zero.');
        }
        if (Math.abs(Math.round(qty * 2) - qty * 2) > 0.0001) {
          throw new Error(`Dispatched quantity (${qty}) must be in steps of 0.5 (e.g., 0.5, 1.0, 1.5, 2.0).`);
        }
        totalQty += qty;
      }
      totalQty = round2(totalQty);

      // Resolve linked Dealer Purchase Order if available
      if (!resolvedDealerPurchaseOrderId && resolvedDealerOrderId) {
        const doRes = await client.query(
          `SELECT dealer_purchase_order_id FROM dealer_orders WHERE id = $1`,
          [resolvedDealerOrderId]
        );
        if (doRes.rows.length > 0 && doRes.rows[0].dealer_purchase_order_id) {
          resolvedDealerPurchaseOrderId = doRes.rows[0].dealer_purchase_order_id;
        }
      }
      if (!resolvedDealerPurchaseOrderId && resolvedSalesOrderId) {
        const poRes = await client.query(
          `SELECT id FROM purchase_orders WHERE main_sales_order_id = $1 AND business_id = $2 LIMIT 1`,
          [resolvedSalesOrderId, resolvedDealerBusinessId]
        );
        if (poRes.rows.length > 0) {
          resolvedDealerPurchaseOrderId = poRes.rows[0].id;
        }
      }

      // Generate shipment number
      const shipmentNumber = await this.generateShipmentNumber(client, mainBusinessId);

      // Insert dealer_shipments
      const shipmentInsertRes = await client.query(
        `INSERT INTO dealer_shipments (
          shipment_number, main_business_id, dealer_business_id,
          dealer_order_id, dealer_purchase_order_id, main_sales_order_id, main_sales_invoice_id,
          dispatch_date, courier_name, tracking_number, vehicle_number, eway_bill_number,
          total_packages, total_quantity, status, notes, created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, 'DISPATCHED', $15, $16, NOW(), NOW()
        ) RETURNING *`,
        [
          shipmentNumber,
          mainBusinessId,
          resolvedDealerBusinessId,
          resolvedDealerOrderId || null,
          resolvedDealerPurchaseOrderId || null,
          resolvedSalesOrderId || null,
          resolvedSalesInvoiceId || null,
          dispatchDate,
          courierName || null,
          trackingNumber || null,
          vehicleNumber || null,
          ewayBillNumber || null,
          totalPackages || 1,
          totalQty,
          notes || null,
          userId || null,
        ]
      );

      const shipment = shipmentInsertRes.rows[0];

      // If dealer PO exists and main sales invoice is linked, record sales invoice reference on PO
      if (resolvedDealerPurchaseOrderId && resolvedSalesInvoiceId) {
        await client.query(
          `UPDATE purchase_orders SET main_sales_invoice_id = $1 WHERE id = $2`,
          [resolvedSalesInvoiceId, resolvedDealerPurchaseOrderId]
        );
      }

      // Insert dealer_shipment_lines
      const createdLines = [];
      for (const line of linesToDispatch) {
        const lineInsertRes = await client.query(
          `INSERT INTO dealer_shipment_lines (
            dealer_shipment_id, sales_invoice_line_id,
            main_unique_item_id, main_batch_id,
            dispatched_quantity, received_quantity, damaged_quantity, short_quantity,
            rate, gst_rate, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, 0.00, 0.00, 0.00, $6, $7, NOW()
          ) RETURNING *`,
          [
            shipment.id,
            line.salesInvoiceLineId || null,
            line.mainUniqueItemId,
            line.mainBatchId,
            line.quantity,
            line.rate || 0.0,
            line.gstRate || 0.0,
          ]
        );
        createdLines.push(lineInsertRes.rows[0]);
      }

      await client.query('COMMIT');

      return {
        success: true,
        shipment: {
          ...shipment,
          lines: createdLines,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 2. LIST SHIPMENTS FOR MAIN WAREHOUSE
   */
  static async listShipmentsForMain(mainBusinessId: string, filters: { status?: string; search?: string } = {}) {
    let query = `
      SELECT 
        ds.*,
        db.name as dealer_business_name,
        db.trade_name as dealer_trade_name,
        db.city as dealer_city,
        si.invoice_number as sales_invoice_number,
        so.order_number as sales_order_number,
        deo.order_number as dealer_order_number,
        COUNT(dsl.id) as line_count,
        COALESCE(SUM(dsl.received_quantity), 0) as total_received_quantity
      FROM dealer_shipments ds
      JOIN businesses db ON ds.dealer_business_id = db.id
      LEFT JOIN sales_invoices si ON ds.main_sales_invoice_id = si.id
      LEFT JOIN sales_orders so ON ds.main_sales_order_id = so.id
      LEFT JOIN dealer_orders deo ON ds.dealer_order_id = deo.id
      LEFT JOIN dealer_shipment_lines dsl ON ds.id = dsl.dealer_shipment_id
      WHERE ds.main_business_id = $1
    `;

    const params: any[] = [mainBusinessId];

    if (filters.status && filters.status !== 'ALL') {
      params.push(filters.status);
      query += ` AND ds.status = $${params.length}`;
    }

    if (filters.search && filters.search.trim()) {
      params.push(`%${filters.search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(ds.shipment_number) LIKE $${params.length} OR
        LOWER(COALESCE(ds.tracking_number, '')) LIKE $${params.length} OR
        LOWER(COALESCE(ds.courier_name, '')) LIKE $${params.length} OR
        LOWER(db.name) LIKE $${params.length}
      )`;
    }

    query += ` GROUP BY ds.id, db.name, db.trade_name, db.city, si.invoice_number, so.order_number, deo.order_number
               ORDER BY ds.created_at DESC LIMIT 100`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  /**
   * 3. LIST INCOMING SHIPMENTS FOR DEALER
   * Strictly isolated to the calling Dealer business.
   */
  static async listIncomingShipmentsForDealer(dealerBusinessId: string, filters: { status?: string; search?: string } = {}) {
    let query = `
      SELECT 
        ds.*,
        mw.name as main_warehouse_name,
        mw.trade_name as main_warehouse_trade_name,
        mw.city as main_warehouse_city,
        si.invoice_number as sales_invoice_number,
        deo.order_number as dealer_order_number,
        COUNT(dsl.id) as line_count,
        COALESCE(SUM(dsl.received_quantity), 0) as total_received_quantity,
        COALESCE(SUM(dsl.damaged_quantity), 0) as total_damaged_quantity,
        COALESCE(SUM(dsl.short_quantity), 0) as total_short_quantity
      FROM dealer_shipments ds
      JOIN businesses mw ON ds.main_business_id = mw.id
      LEFT JOIN sales_invoices si ON ds.main_sales_invoice_id = si.id
      LEFT JOIN dealer_orders deo ON ds.dealer_order_id = deo.id
      LEFT JOIN dealer_shipment_lines dsl ON ds.id = dsl.dealer_shipment_id
      WHERE ds.dealer_business_id = $1
    `;

    const params: any[] = [dealerBusinessId];

    if (filters.status && filters.status !== 'ALL') {
      params.push(filters.status);
      query += ` AND ds.status = $${params.length}`;
    }

    if (filters.search && filters.search.trim()) {
      params.push(`%${filters.search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(ds.shipment_number) LIKE $${params.length} OR
        LOWER(COALESCE(ds.tracking_number, '')) LIKE $${params.length} OR
        LOWER(COALESCE(ds.courier_name, '')) LIKE $${params.length} OR
        LOWER(mw.name) LIKE $${params.length}
      )`;
    }

    query += ` GROUP BY ds.id, mw.name, mw.trade_name, mw.city, si.invoice_number, deo.order_number
               ORDER BY ds.created_at DESC LIMIT 100`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  /**
   * 4. GET SHIPMENT DETAILS
   * Accessible by either the Main Warehouse or the recipient Dealer.
   */
  static async getShipmentDetails(shipmentId: string, callingBusinessId: string) {
    const shipmentRes = await pool.query(
      `SELECT 
         ds.*,
         mw.name as main_warehouse_name,
         mw.trade_name as main_warehouse_trade_name,
         mw.gstin as main_warehouse_gstin,
         mw.state as main_warehouse_state,
         db.name as dealer_business_name,
         db.trade_name as dealer_trade_name,
         db.gstin as dealer_gstin,
         db.state as dealer_state,
         si.invoice_number as sales_invoice_number,
         si.invoice_date as sales_invoice_date,
         deo.order_number as dealer_order_number
       FROM dealer_shipments ds
       JOIN businesses mw ON ds.main_business_id = mw.id
       JOIN businesses db ON ds.dealer_business_id = db.id
       LEFT JOIN sales_invoices si ON ds.main_sales_invoice_id = si.id
       LEFT JOIN dealer_orders deo ON ds.dealer_order_id = deo.id
       WHERE ds.id = $1 AND (ds.main_business_id = $2 OR ds.dealer_business_id = $2)`,
      [shipmentId, callingBusinessId]
    );

    if (shipmentRes.rows.length === 0) {
      throw new Error('Shipment not found or access denied.');
    }

    const shipment = shipmentRes.rows[0];

    // Fetch lines with rich optical details
    const linesRes = await pool.query(
      `SELECT 
         dsl.*,
         ui.name as unique_item_name,
         ui.code as unique_item_code,
         ui.optical_category,
         c.name as category_name,
         c.code as category_code,
         ob.sph,
         ob.cyl,
         ob.axis,
         ob.add,
         ob.side,
         ob.barcode,
         ob.identity_key,
         GREATEST(0, dsl.dispatched_quantity - (dsl.received_quantity + dsl.damaged_quantity + dsl.short_quantity)) as remaining_quantity
       FROM dealer_shipment_lines dsl
       JOIN unique_items ui ON dsl.main_unique_item_id = ui.id
       JOIN optical_batches ob ON dsl.main_batch_id = ob.id
       LEFT JOIN categories c ON ob.category_id = c.id
       WHERE dsl.dealer_shipment_id = $1
       ORDER BY ui.name ASC, ob.sph ASC, ob.cyl ASC`,
      [shipmentId]
    );

    // Fetch past Goods Receipts (GRNs) for this shipment
    const receiptsRes = await pool.query(
      `SELECT 
         gr.*,
         pi.invoice_number as purchase_invoice_number,
         u.full_name as received_by_user_name
       FROM dealer_goods_receipts gr
       LEFT JOIN purchase_invoices pi ON gr.dealer_purchase_invoice_id = pi.id
       LEFT JOIN users u ON gr.created_by = u.id
       WHERE gr.dealer_shipment_id = $1
       ORDER BY gr.created_at DESC`,
      [shipmentId]
    );

    return {
      shipment,
      lines: linesRes.rows,
      goodsReceipts: receiptsRes.rows,
    };
  }

  /**
   * Helper: Resolves or Replicates Main uniqueItem & batch into Dealer business
   */
  public static async resolveOrReplicateItemAndBatchInDealer(
    client: PoolClient,
    dealerBusinessId: string,
    mainUniqueItemId: string,
    mainBatchId: string,
    userId?: string | null
  ): Promise<{ dealerUniqueItemId: string; dealerBatchId: string }> {
    // 1. Fetch source item and batch from Main
    const srcRes = await client.query(
      `SELECT 
         ui.code as item_code,
         ui.name as item_name,
         ui.optical_category,
         ui.maintain_batches,
         ui.unit,
         ui.gst_rate,
         c.name as category_name,
         c.code as category_code,
         pi.name as primary_item_name,
         pi.code as primary_item_code,
         b.name as base_name,
         b.code as base_code,
         ob.sph,
         ob.cyl,
         ob.axis,
         ob.add,
         ob.side,
         ob.identity_key,
         ob.barcode
       FROM unique_items ui
       JOIN optical_batches ob ON ob.id = $1
       LEFT JOIN categories c ON ob.category_id = c.id
       LEFT JOIN primary_items pi ON ui.primary_item_id = pi.id
       LEFT JOIN bases b ON pi.base_id = b.id
       WHERE ui.id = $2`,
      [mainBatchId, mainUniqueItemId]
    );

    if (srcRes.rows.length === 0) {
      throw new Error(`Main warehouse item/batch not found: item ${mainUniqueItemId}, batch ${mainBatchId}`);
    }

    const src = srcRes.rows[0];

    // 2. Resolve Category in Dealer
    let dealerCategoryId: string | null = null;
    if (src.category_code) {
      const catRes = await client.query(
        `SELECT id FROM categories WHERE business_id = $1 AND code = $2 LIMIT 1`,
        [dealerBusinessId, src.category_code]
      );
      if (catRes.rows.length > 0) {
        dealerCategoryId = catRes.rows[0].id;
      } else {
        const newCatRes = await client.query(
          `INSERT INTO categories (business_id, name, code, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW()) RETURNING id`,
          [dealerBusinessId, src.category_name || src.category_code, src.category_code]
        );
        dealerCategoryId = newCatRes.rows[0].id;
      }
    }

    // 2b. Resolve Base in Dealer (required for primary_items)
    let dealerBaseId: string | null = null;
    if (src.base_code) {
      const baseRes = await client.query(
        `SELECT id FROM bases WHERE business_id = $1 AND code = $2 LIMIT 1`,
        [dealerBusinessId, src.base_code]
      );
      if (baseRes.rows.length > 0) {
        dealerBaseId = baseRes.rows[0].id;
      } else {
        const newBaseRes = await client.query(
          `INSERT INTO bases (business_id, name, code, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW()) RETURNING id`,
          [dealerBusinessId, src.base_name || src.base_code, src.base_code]
        );
        dealerBaseId = newBaseRes.rows[0].id;
      }
    } else {
      const anyBase = await client.query(
        `SELECT id FROM bases WHERE business_id = $1 LIMIT 1`,
        [dealerBusinessId]
      );
      if (anyBase.rows.length > 0) {
        dealerBaseId = anyBase.rows[0].id;
      } else {
        const newBaseRes = await client.query(
          `INSERT INTO bases (business_id, name, code, status, created_at, updated_at)
           VALUES ($1, 'Standard Base', 'STD-BASE', 'ACTIVE', NOW(), NOW()) RETURNING id`,
          [dealerBusinessId]
        );
        dealerBaseId = newBaseRes.rows[0].id;
      }
    }

    // 3. Resolve Primary Item in Dealer
    let dealerPrimaryItemId: string | null = null;
    if (src.primary_item_code) {
      const piRes = await client.query(
        `SELECT id FROM primary_items WHERE business_id = $1 AND code = $2 LIMIT 1`,
        [dealerBusinessId, src.primary_item_code]
      );
      if (piRes.rows.length > 0) {
        dealerPrimaryItemId = piRes.rows[0].id;
      } else {
        const newPiRes = await client.query(
          `INSERT INTO primary_items (business_id, name, code, category_id, base_id, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW()) RETURNING id`,
          [dealerBusinessId, src.primary_item_name || src.primary_item_code, src.primary_item_code, dealerCategoryId, dealerBaseId]
        );
        dealerPrimaryItemId = newPiRes.rows[0].id;
      }
    }

    // 4. Resolve Unique Item in Dealer (match by unique code)
    let dealerUniqueItemId: string;
    const uiRes = await client.query(
      `SELECT id FROM unique_items WHERE business_id = $1 AND code = $2 LIMIT 1`,
      [dealerBusinessId, src.item_code]
    );

    if (uiRes.rows.length > 0) {
      dealerUniqueItemId = uiRes.rows[0].id;
    } else {
      const newUiRes = await client.query(
        `INSERT INTO unique_items (
          business_id, primary_item_id, code, name,
          optical_category, maintain_batches, unit, gst_rate,
          status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          'ACTIVE', NOW(), NOW()
        ) RETURNING id`,
        [
          dealerBusinessId,
          dealerPrimaryItemId,
          src.item_code,
          src.item_name,
          src.optical_category || 'SV',
          src.maintain_batches ?? true,
          src.unit || 'PRS',
          src.gst_rate || 12.0,
        ]
      );
      dealerUniqueItemId = newUiRes.rows[0].id;
    }

    // 5. Resolve Optical Batch in Dealer (match by identity_key)
    let dealerBatchId: string;
    const batchRes = await client.query(
      `SELECT id FROM optical_batches WHERE business_id = $1 AND unique_item_id = $2 AND identity_key = $3 LIMIT 1`,
      [dealerBusinessId, dealerUniqueItemId, src.identity_key]
    );

    if (batchRes.rows.length > 0) {
      dealerBatchId = batchRes.rows[0].id;
    } else {
      // Ensure categoryId for batch FK
      if (!dealerCategoryId) {
        const anyCatRes = await client.query(
          `SELECT id FROM categories WHERE business_id = $1 LIMIT 1`,
          [dealerBusinessId]
        );
        if (anyCatRes.rows.length > 0) {
          dealerCategoryId = anyCatRes.rows[0].id;
        } else {
          const newCat = await client.query(
            `INSERT INTO categories (business_id, name, code, status, created_at, updated_at)
             VALUES ($1, 'General SV', 'SV', 'ACTIVE', NOW(), NOW()) RETURNING id`,
            [dealerBusinessId]
          );
          dealerCategoryId = newCat.rows[0].id;
        }
      }

      const barcode = BarcodeService.generatePermanentBarcode(dealerBusinessId, src.optical_category || 'SV');
      const newBatchRes = await client.query(
        `INSERT INTO optical_batches (
          business_id, unique_item_id, category_id, barcode,
          sph, cyl, axis, add, side, identity_key, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9, $10, 'ACTIVE', NOW(), NOW()
        ) RETURNING id`,
        [
          dealerBusinessId,
          dealerUniqueItemId,
          dealerCategoryId,
          barcode,
          src.sph,
          src.cyl,
          src.axis || 0.0,
          src.add || 0.0,
          src.side || 'NONE',
          src.identity_key,
        ]
      );
      dealerBatchId = newBatchRes.rows[0].id;

      // Initialize stock record
      await client.query(
        `INSERT INTO optical_stocks (
          business_id, batch_id, physical_stock, available_stock, reserved_stock, updated_at
        ) VALUES ($1, $2, 0.0, 0.0, 0.0, NOW())
        ON CONFLICT (business_id, batch_id) DO NOTHING`,
        [dealerBusinessId, dealerBatchId]
      );
    }

    return { dealerUniqueItemId, dealerBatchId };
  }

  /**
   * Helper: Resolve or Create Main Warehouse as a SUPPLIER Party in Dealer
   */
  public static async resolveMainWarehouseSupplierParty(
    client: PoolClient,
    dealerBusinessId: string,
    mainWarehouseId: string
  ): Promise<string> {
    // 1. Fetch Main Warehouse details
    const mwRes = await client.query(
      `SELECT name, trade_name, gstin, phone, email, address_line1, state, city, pincode FROM businesses WHERE id = $1`,
      [mainWarehouseId]
    );
    if (mwRes.rows.length === 0) {
      throw new Error('Main Warehouse business not found.');
    }
    const mw = mwRes.rows[0];

    // 2. Check if a Supplier party already represents Main Warehouse
    const partyRes = await client.query(
      `SELECT id FROM parties 
       WHERE business_id = $1 AND party_type IN ('SUPPLIER', 'BOTH') 
         AND (
           notes LIKE $2
           OR LOWER(name) = LOWER($3)
           OR (display_name IS NOT NULL AND LOWER(display_name) = LOWER($3))
           OR ($4 <> '' AND gstin IS NOT NULL AND UPPER(gstin) = UPPER($4))
         )
       LIMIT 1`,
      [
        dealerBusinessId,
        `%[MAIN_BIZ:${mainWarehouseId}]%`,
        mw.name,
        mw.gstin || '',
      ]
    );

    if (partyRes.rows.length > 0) {
      return partyRes.rows[0].id;
    }

    // 3. Create Supplier party for Main Warehouse in Dealer
    const partyCode = `SUP-MW-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const supplierName = mw.trade_name ? `${mw.name} (${mw.trade_name})` : mw.name;
    const newPartyRes = await client.query(
      `INSERT INTO parties (
        business_id, party_code, party_type, name, display_name, gstin, mobile, email,
        address_line_1, state, city, pincode, notes, status, created_at, updated_at
      ) VALUES (
        $1, $2, 'SUPPLIER', $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, 'ACTIVE', NOW(), NOW()
      ) RETURNING id`,
      [
        dealerBusinessId,
        partyCode,
        supplierName,
        mw.trade_name || mw.name,
        mw.gstin || null,
        mw.phone || null,
        mw.email || null,
        mw.address_line1 || null,
        mw.state || 'Maharashtra',
        mw.city || null,
        mw.pincode || null,
        `[MAIN_BIZ:${mainWarehouseId}] Auto-mapped Main Warehouse Supplier`,
      ]
    );

    return newPartyRes.rows[0].id;
  }

  /**
   * 5. CONFIRM DEALER GOODS RECEIPT (GRN) & STOCK INTAKE & DEALER PURCHASE INVOICE
   * 
   * Atomically executes:
   * - Verification of quantities against shipment lines
   * - Isolation of stock addition ONLY to Good Received quantities
   * - Stock ledger creation in Dealer business context
   * - Purchase Invoice creation and Supplier ledger posting against Main Warehouse
   * - Updates shipment line received/damaged/short counters and overall shipment status
   */
  static async confirmDealerGoodsReceipt(input: ConfirmGoodsReceiptInput) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { dealerBusinessId, dealerShipmentId, receiptDate = new Date(), remarks, lines, userId } = input;

      if (!lines || lines.length === 0) {
        throw new Error('At least one item must be inspected to confirm goods receipt.');
      }

      // 1. Lock shipment record and verify recipient
      const shipmentRes = await client.query(
        `SELECT ds.*, mw.state as main_state, db.state as dealer_state
         FROM dealer_shipments ds
         JOIN businesses mw ON ds.main_business_id = mw.id
         JOIN businesses db ON ds.dealer_business_id = db.id
         WHERE ds.id = $1 FOR UPDATE`,
        [dealerShipmentId]
      );

      if (shipmentRes.rows.length === 0) {
        throw new Error('Shipment record not found.');
      }

      const shipment = shipmentRes.rows[0];

      if (shipment.dealer_business_id !== dealerBusinessId) {
        throw new Error('Unauthorized: This shipment was not dispatched to your dealer business.');
      }

      if (shipment.status === 'RECEIVED') {
        throw new Error('This shipment has already been completely received.');
      }

      if (shipment.status === 'CANCELLED') {
        throw new Error('Cannot receive a cancelled shipment.');
      }

      // 2. Lock shipment lines
      const dbLinesRes = await client.query(
        `SELECT * FROM dealer_shipment_lines WHERE dealer_shipment_id = $1 FOR UPDATE`,
        [dealerShipmentId]
      );

      const dbLinesMap = new Map<string, any>();
      for (const dbl of dbLinesRes.rows) {
        dbLinesMap.set(dbl.id, dbl);
      }

      // 3. Validate input lines and check bounds
      let totalGoodReceived = 0;
      let totalDamaged = 0;
      let totalShort = 0;

      for (const inpLine of lines) {
        const dbLine = dbLinesMap.get(inpLine.shipmentLineId);
        if (!dbLine) {
          throw new Error(`Invalid shipment line ID: ${inpLine.shipmentLineId}`);
        }

        const recv = Number(inpLine.receivedQuantity || 0);
        const dmg = Number(inpLine.damagedQuantity || 0);
        const shrt = Number(inpLine.shortQuantity || 0);

        if (recv < 0 || dmg < 0 || shrt < 0) {
          throw new Error('Received, damaged, and short quantities cannot be negative.');
        }

        const lineSum = round2(recv + dmg + shrt);
        if (lineSum <= 0) {
          continue; // No action on this line
        }

        const prevTotalAccounted = round2(
          parseFloat(dbLine.received_quantity || '0') +
          parseFloat(dbLine.damaged_quantity || '0') +
          parseFloat(dbLine.short_quantity || '0')
        );

        const remainingToAccount = round2(parseFloat(dbLine.dispatched_quantity) - prevTotalAccounted);

        if (lineSum > remainingToAccount) {
          throw new Error(
            `Total accounted quantity (${lineSum}) exceeds remaining dispatched quantity (${remainingToAccount}) for item line.`
          );
        }

        totalGoodReceived += recv;
        totalDamaged += dmg;
        totalShort += shrt;
      }

      totalGoodReceived = round2(totalGoodReceived);
      totalDamaged = round2(totalDamaged);
      totalShort = round2(totalShort);

      if (totalGoodReceived + totalDamaged + totalShort <= 0) {
        throw new Error('Please specify at least one received, damaged, or short quantity.');
      }

      // 4. Generate GRN number
      const receiptNumber = await this.generateReceiptNumber(client, dealerBusinessId);

      // 4b. Resolve linked Dealer Purchase Order ID
      let dealerPurchaseOrderId: string | null = shipment.dealer_purchase_order_id || null;
      if (!dealerPurchaseOrderId && shipment.dealer_order_id) {
        const doRes = await client.query(
          `SELECT dealer_purchase_order_id FROM dealer_orders WHERE id = $1`,
          [shipment.dealer_order_id]
        );
        if (doRes.rows.length > 0 && doRes.rows[0].dealer_purchase_order_id) {
          dealerPurchaseOrderId = doRes.rows[0].dealer_purchase_order_id;
        }
      }
      if (!dealerPurchaseOrderId && shipment.main_sales_order_id) {
        const poRes = await client.query(
          `SELECT id FROM purchase_orders WHERE main_sales_order_id = $1 AND business_id = $2 LIMIT 1`,
          [shipment.main_sales_order_id, dealerBusinessId]
        );
        if (poRes.rows.length > 0) {
          dealerPurchaseOrderId = poRes.rows[0].id;
        }
      }

      // 5. Insert dealer_goods_receipts record
      const grnRes = await client.query(
        `INSERT INTO dealer_goods_receipts (
          receipt_number, dealer_shipment_id, dealer_business_id, main_business_id,
          dealer_purchase_order_id, receipt_date, status, total_received_qty, total_damaged_qty, total_short_qty,
          remarks, created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, 'CONFIRMED', $7, $8, $9,
          $10, $11, NOW(), NOW()
        ) RETURNING *`,
        [
          receiptNumber,
          dealerShipmentId,
          dealerBusinessId,
          shipment.main_business_id,
          dealerPurchaseOrderId,
          receiptDate,
          totalGoodReceived,
          totalDamaged,
          totalShort,
          remarks || null,
          userId || null,
        ]
      );

      const goodsReceipt = grnRes.rows[0];

      // 6. Process each line: Resolve/replicate in Dealer catalog, update shipment counters, collect accepted lines
      const processedGoodLines: Array<{
        dealerUniqueItemId: string;
        dealerBatchId: string;
        quantity: number;
        rate: number;
        gstRate: number;
      }> = [];

      for (const inpLine of lines) {
        const dbLine = dbLinesMap.get(inpLine.shipmentLineId);
        const recv = Number(inpLine.receivedQuantity || 0);
        const dmg = Number(inpLine.damagedQuantity || 0);
        const shrt = Number(inpLine.shortQuantity || 0);

        if (recv < 0 || dmg < 0 || shrt < 0) {
          throw new Error('Received, damaged, and short quantities cannot be negative.');
        }

        for (const [val, label] of [[recv, 'Received'], [dmg, 'Damaged'], [shrt, 'Short']] as const) {
          if (val > 0 && Math.abs(Math.round(val * 2) - val * 2) > 0.0001) {
            throw new Error(`${label} quantity (${val}) must be in steps of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0).`);
          }
        }

        if (recv + dmg + shrt <= 0) continue;

        // Resolve or replicate item & batch in Dealer business
        const { dealerUniqueItemId, dealerBatchId } = await this.resolveOrReplicateItemAndBatchInDealer(
          client,
          dealerBusinessId,
          dbLine.main_unique_item_id,
          dbLine.main_batch_id,
          userId
        );

        // Insert goods receipt line
        await client.query(
          `INSERT INTO dealer_goods_receipt_lines (
            goods_receipt_id, shipment_line_id,
            main_unique_item_id, main_batch_id,
            dealer_unique_item_id, dealer_batch_id,
            dispatched_quantity, received_quantity, damaged_quantity, short_quantity,
            rate, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
          )`,
          [
            goodsReceipt.id,
            dbLine.id,
            dbLine.main_unique_item_id,
            dbLine.main_batch_id,
            dealerUniqueItemId,
            dealerBatchId,
            dbLine.dispatched_quantity,
            recv,
            dmg,
            shrt,
            dbLine.rate,
          ]
        );

        // Update shipment line quantities
        await client.query(
          `UPDATE dealer_shipment_lines
           SET received_quantity = received_quantity + $1,
               damaged_quantity = damaged_quantity + $2,
               short_quantity = short_quantity + $3
           WHERE id = $4`,
          [recv, dmg, shrt, dbLine.id]
        );

        // If good stock was received, collect for Purchase Invoice conversion
        // (Stock will ONLY be increased via authoritative Purchase Invoice posting!)
        if (recv > 0) {
          processedGoodLines.push({
            dealerUniqueItemId,
            dealerBatchId,
            quantity: recv,
            rate: parseFloat(dbLine.rate),
            gstRate: parseFloat(dbLine.gst_rate),
          });
        }
      }

      // 7. Update shipment overall status based on remaining quantities
      const remainingCheckRes = await client.query(
        `SELECT 
           COALESCE(SUM(GREATEST(0, dispatched_quantity - (received_quantity + damaged_quantity + short_quantity))), 0) as total_remaining
         FROM dealer_shipment_lines
         WHERE dealer_shipment_id = $1`,
        [dealerShipmentId]
      );

      const totalRemaining = parseFloat(remainingCheckRes.rows[0].total_remaining || '0');
      const newStatus = totalRemaining <= 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

      await client.query(
        `UPDATE dealer_shipments SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, dealerShipmentId]
      );

      // Resolve Main Warehouse Supplier party in Dealer
      const mainSupplierPartyId = await this.resolveMainWarehouseSupplierParty(
        client,
        dealerBusinessId,
        shipment.main_business_id
      );

      // Commit the GRN and shipment update
      await client.query('COMMIT');
      client.release();

      // 8. DEALER PURCHASE INVOICE & ACCOUNTING
      // Stock increases ONLY through the authoritative Purchase Invoice posting mechanism!
      let createdPurchaseInvoice: any = null;
      if (input.autoCreatePurchaseInvoice !== false && processedGoodLines.length > 0) {
        // Group items for PurchaseInvoice lines
        const poItemsMap = new Map<string, PurchaseLineInput>();
        for (const pgl of processedGoodLines) {
          const existing = poItemsMap.get(pgl.dealerUniqueItemId);
          if (existing) {
            existing.quantity = round2(existing.quantity + pgl.quantity);
            existing.batches!.push({
              batchId: pgl.dealerBatchId,
              quantity: pgl.quantity,
              rate: pgl.rate,
            });
          } else {
            poItemsMap.set(pgl.dealerUniqueItemId, {
              uniqueItemId: pgl.dealerUniqueItemId,
              quantity: pgl.quantity,
              rate: pgl.rate,
              gstRate: pgl.gstRate,
              discountType: 'NONE',
              discountValue: 0,
              batches: [
                {
                  batchId: pgl.dealerBatchId,
                  quantity: pgl.quantity,
                  rate: pgl.rate,
                },
              ],
            });
          }
        }

        const isInterState =
          shipment.main_state &&
          shipment.dealer_state &&
          shipment.main_state.trim().toLowerCase() !== shipment.dealer_state.trim().toLowerCase();
        const gstMode = isInterState ? 'INTER_STATE' : 'INTRA_STATE';

        // Check if main sales invoice has an invoice number
        let supplierInvoiceNumber = shipment.shipment_number;
        if (shipment.main_sales_invoice_id) {
          const siRes = await pool.query(
            `SELECT invoice_number FROM sales_invoices WHERE id = $1`,
            [shipment.main_sales_invoice_id]
          );
          if (siRes.rows.length > 0 && siRes.rows[0].invoice_number) {
            supplierInvoiceNumber = siRes.rows[0].invoice_number;
          }
        }

        createdPurchaseInvoice = await PurchaseService.createPurchaseInvoice(
          dealerBusinessId,
          {
            supplierPartyId: mainSupplierPartyId,
            purchaseOrderId: dealerPurchaseOrderId || undefined,
            invoiceDate: receiptDate,
            supplierInvoiceNumber,
            supplierInvoiceDate: shipment.dispatch_date || receiptDate,
            gstMode,
            notes: `Auto-generated from Goods Receipt ${receiptNumber} (Main Shipment ${shipment.shipment_number})`,
            lines: Array.from(poItemsMap.values()),
          },
          userId || undefined
        );

        // Post the Purchase Invoice authoritatively so it creates purchase lots,
        // increases physical stock, posts to stock_ledger, and updates supplier_ledger
        await PurchaseService.postPurchaseInvoice(
          dealerBusinessId,
          createdPurchaseInvoice.id,
          userId || undefined
        );

        createdPurchaseInvoice = await PurchaseService.getPurchaseInvoiceById(
          dealerBusinessId,
          createdPurchaseInvoice.id
        );

        // Update dealer_goods_receipts with dealer_purchase_invoice_id
        await pool.query(
          `UPDATE dealer_goods_receipts SET dealer_purchase_invoice_id = $1 WHERE id = $2`,
          [createdPurchaseInvoice.id, goodsReceipt.id]
        );
      }

      return {
        success: true,
        receiptNumber,
        goodsReceiptId: goodsReceipt.id,
        purchaseInvoiceId: createdPurchaseInvoice ? createdPurchaseInvoice.id : null,
        purchaseInvoice: createdPurchaseInvoice || null,
        shipmentStatus: newStatus,
        totalGoodReceived,
        totalDamaged,
        totalShort,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw error;
    } finally {
      try {
        client.release();
      } catch (_) {}
    }
  }
}
