import { db, pool } from '../db/index.js';
import {
  businesses,
  salesOrders,
  salesOrderLines,
  salesOrderLineBatches,
  salesInvoices,
  salesInvoiceLines,
  salesInvoiceLineBatches,
  partyItemPrices,
  customerLedgers,
  parties,
  uniqueItems,
  opticalBatches,
  opticalStocks,
  stockLedger,
  stockReservations,
} from '../db/schema.js';
import { eq, and, desc, count, ilike, or, sql, inArray } from 'drizzle-orm';
import { calculateLineTax, calculateInvoiceTotals, round2 } from './taxCalculationService.js';
import { AuditService } from './auditService.js';
import { PoolClient } from 'pg';

export interface SalesLineBatchInput {
  batchId: string;
  quantity: number; // in pairs
}

export interface SalesLineInput {
  uniqueItemId: string;
  quantity: number; // in pairs
  rate: number;
  discountType?: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue?: number;
  discountPercent?: number;
  gstRate?: number; // e.g. 5, 12, 18
  batches?: SalesLineBatchInput[];
}

export interface CreateSalesOrderDTO {
  partyId: string;
  orderDate?: string | Date;
  orderNumber?: string;
  gstMode?: 'INTRA_STATE' | 'INTER_STATE';
  paymentTerms?: string;
  notes?: string;
  lines: SalesLineInput[];
  status?: 'DRAFT' | 'CONFIRMED';
}

export interface CreateSalesInvoiceDTO {
  partyId: string;
  salesOrderId?: string;
  invoiceDate?: string | Date;
  invoiceNumber?: string;
  gstMode?: 'INTRA_STATE' | 'INTER_STATE';
  paymentTerms?: string;
  notes?: string;
  lines: SalesLineInput[];
  status?: 'DRAFT' | 'POSTED';
}

export interface ConvertOrderToInvoiceDTO {
  invoiceDate?: string | Date;
  invoiceNumber?: string;
  paymentTerms?: string;
  notes?: string;
  lines?: {
    salesOrderLineId?: string;
    uniqueItemId: string;
    quantity: number;
    rate: number;
    discountType?: 'NONE' | 'PERCENTAGE' | 'FIXED';
    discountValue?: number;
    discountPercent?: number;
    gstRate?: number;
    batches: SalesLineBatchInput[];
  }[];
}

export class SalesService {
  /**
   * Generates a sequential, business-scoped sales order number (e.g. SO-000001)
   */
  static async generateOrderNumber(businessId: string): Promise<string> {
    const res = await pool.query(
      `SELECT order_number FROM sales_orders 
       WHERE business_id = $1 AND order_number LIKE 'SO-%' 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [businessId]
    );

    let maxNum = 0;
    for (const row of res.rows) {
      const numStr = (row.order_number || '').replace('SO-', '');
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    const nextSeq = maxNum + 1;
    const padded = String(nextSeq).padStart(6, '0');
    return `SO-${padded}`;
  }

  /**
   * Generates a sequential, business-scoped sales invoice number (e.g. INV-000001)
   */
  static async generateInvoiceNumber(businessId: string): Promise<string> {
    const res = await pool.query(
      `SELECT invoice_number FROM sales_invoices 
       WHERE business_id = $1 AND invoice_number LIKE 'INV-%' 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [businessId]
    );

    let maxNum = 0;
    for (const row of res.rows) {
      const numStr = (row.invoice_number || '').replace('INV-', '');
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    const nextSeq = maxNum + 1;
    const padded = String(nextSeq).padStart(6, '0');
    return `INV-${padded}`;
  }

  /**
   * Validates that a party is a valid Customer (CUSTOMER or BOTH)
   */
  static async validateCustomerParty(businessId: string, partyId: string) {
    if (!partyId) throw new Error('Customer Party ID is required');

    const [party] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.id, partyId)))
      .limit(1);

    if (!party) {
      throw new Error('Selected customer does not exist in this business');
    }

    if (party.partyType === 'SUPPLIER') {
      throw new Error('Selected party is a SUPPLIER only. Only parties of type CUSTOMER or BOTH can be used for sales.');
    }

    if (party.status !== 'ACTIVE') {
      throw new Error('Selected customer party is marked as inactive');
    }

    return party;
  }

  /**
   * Look up Party + Unique Item last sale price
   */
  static async getPartyItemPrice(businessId: string, partyId: string, uniqueItemId: string): Promise<number | null> {
    const [record] = await db
      .select()
      .from(partyItemPrices)
      .where(
        and(
          eq(partyItemPrices.businessId, businessId),
          eq(partyItemPrices.partyId, partyId),
          eq(partyItemPrices.uniqueItemId, uniqueItemId)
        )
      )
      .limit(1);

    return record ? parseFloat(record.lastSalePrice) : null;
  }

  /**
   * List all last sale prices for a customer party
   */
  static async getPartyPrices(businessId: string, partyId: string) {
    return await db
      .select({
        id: partyItemPrices.id,
        uniqueItemId: partyItemPrices.uniqueItemId,
        lastSalePrice: partyItemPrices.lastSalePrice,
        lastSaleAt: partyItemPrices.lastSaleAt,
        uniqueItemName: uniqueItems.name,
        code: uniqueItems.code,
      })
      .from(partyItemPrices)
      .innerJoin(uniqueItems, eq(partyItemPrices.uniqueItemId, uniqueItems.id))
      .where(and(eq(partyItemPrices.businessId, businessId), eq(partyItemPrices.partyId, partyId)));
  }

  /**
   * Updates Party + Unique Item last sale price (used inside transactional DB operations)
   */
  static async updatePartyItemPriceInTx(
    client: PoolClient,
    businessId: string,
    partyId: string,
    uniqueItemId: string,
    price: number
  ) {
    const priceStr = round2(price).toFixed(2);
    await client.query(
      `INSERT INTO party_item_prices (business_id, party_id, unique_item_id, last_sale_price, last_sale_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (business_id, party_id, unique_item_id)
       DO UPDATE SET 
         last_sale_price = EXCLUDED.last_sale_price,
         last_sale_at = NOW(),
         updated_at = NOW()`,
      [businessId, partyId, uniqueItemId, priceStr]
    );
  }

  /**
   * Get barcode details for sales lookup
   */
  static async getBarcodeDetailsForSale(businessId: string, barcode: string) {
    if (!barcode || barcode.trim().length === 0) {
      throw new Error('Barcode is required for lookup');
    }

    const trimmed = barcode.trim().toUpperCase();

    const [batch] = await db
      .select({
        batch: opticalBatches,
        uniqueItem: uniqueItems,
      })
      .from(opticalBatches)
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .where(and(eq(opticalBatches.businessId, businessId), sql`LOWER(${opticalBatches.barcode}) = LOWER(${trimmed})`))
      .limit(1);

    if (!batch) {
      throw new Error(`No optical batch found with barcode '${barcode}' in this business`);
    }

    const [stock] = await db
      .select()
      .from(opticalStocks)
      .where(and(eq(opticalStocks.businessId, businessId), eq(opticalStocks.batchId, batch.batch.id)))
      .limit(1);

    return {
      batch: batch.batch,
      uniqueItem: batch.uniqueItem,
      stock: stock || { physicalStock: '0.00', reservedStock: '0.00', availableStock: '0.00' },
    };
  }

  /**
   * Search available batches for a Unique Item
   */
  static async getBatchesForUniqueItem(
    businessId: string,
    uniqueItemId: string,
    options?: { search?: string; onlyInStock?: boolean }
  ) {
    let query = db
      .select({
        batch: opticalBatches,
        stock: opticalStocks,
      })
      .from(opticalBatches)
      .leftJoin(
        opticalStocks,
        and(eq(opticalStocks.batchId, opticalBatches.id), eq(opticalStocks.businessId, businessId))
      )
      .where(and(eq(opticalBatches.businessId, businessId), eq(opticalBatches.uniqueItemId, uniqueItemId)));

    const rows = await query;
    let result = rows.map(r => ({
      ...r.batch,
      physicalStock: r.stock ? parseFloat(r.stock.physicalStock) : 0,
      reservedStock: r.stock ? parseFloat(r.stock.reservedStock) : 0,
      availableStock: r.stock ? parseFloat(r.stock.availableStock) : 0,
    }));

    if (options?.onlyInStock) {
      result = result.filter(b => b.availableStock > 0);
    }

    return result;
  }

  /**
   * Calculate customer balance & check credit limit
   */
  static async getCustomerBalance(businessId: string, partyId: string): Promise<number> {
    const res = await pool.query(
      `SELECT balance FROM customer_ledgers 
       WHERE business_id = $1 AND party_id = $2 
       ORDER BY transaction_date DESC, created_at DESC 
       LIMIT 1`,
      [businessId, partyId]
    );

    if (res.rows.length === 0) return 0;
    return parseFloat(res.rows[0].balance || '0');
  }

  /**
   * Check credit limit compliance for customer
   */
  static async checkCreditLimit(
    businessId: string,
    partyId: string,
    additionalAmount: number
  ): Promise<{ allowed: boolean; currentBalance: number; newBalance: number; creditLimit: number; warning?: string }> {
    const [party] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.id, partyId)))
      .limit(1);

    if (!party) throw new Error('Customer party not found');

    const currentBalance = await this.getCustomerBalance(businessId, partyId);
    const newBalance = round2(currentBalance + additionalAmount);
    const creditLimit = party.creditLimit ? parseFloat(party.creditLimit) : 0;

    if (creditLimit > 0 && newBalance > creditLimit) {
      return {
        allowed: true, // Warning mode by default
        currentBalance,
        newBalance,
        creditLimit,
        warning: `Customer credit limit exceeded! Current Balance: ₹${currentBalance.toFixed(2)}, After Sale: ₹${newBalance.toFixed(2)}, Limit: ₹${creditLimit.toFixed(2)}`,
      };
    }

    return {
      allowed: true,
      currentBalance,
      newBalance,
      creditLimit,
    };
  }

  // =========================================================================
  // SALES ORDER LIFECYCLE
  // =========================================================================

  /**
   * Creates a Sales Order (DRAFT or directly CONFIRMED)
   */
  static async createSalesOrder(businessId: string, data: CreateSalesOrderDTO, userId?: string) {
    if (!businessId) throw new Error('Business ID is required');
    const party = await this.validateCustomerParty(businessId, data.partyId);

    if (!data.lines || data.lines.length === 0) {
      throw new Error('At least one sales line is required');
    }

    const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    const isInterState =
      biz?.state && party?.state && biz.state.trim().toLowerCase() !== party.state.trim().toLowerCase();
    const gstMode = data.gstMode || (isInterState ? 'INTER_STATE' : 'INTRA_STATE');

    const orderDate = new Date(data.orderDate || new Date());
    const orderNumber = data.orderNumber || (await this.generateOrderNumber(businessId));
    const targetStatus = data.status || 'DRAFT';

    // Calculate line items tax and invoice totals
    const computedLines = data.lines.map(line => {
      if (line.quantity <= 0) throw new Error('Line quantity must be greater than zero');
      if (line.rate < 0) throw new Error('Line rate cannot be negative');

      const discType =
        line.discountType || (line.discountPercent !== undefined && line.discountPercent > 0 ? 'PERCENTAGE' : 'NONE');
      const discVal = line.discountValue !== undefined ? line.discountValue : (line.discountPercent ?? 0);

      const taxRes = calculateLineTax({
        quantity: line.quantity,
        rate: line.rate,
        discountType: discType,
        discountValue: discVal,
        gstRate: line.gstRate ?? 5.0,
      });

      return {
        ...line,
        taxRes,
      };
    });

    const totals = calculateInvoiceTotals({
      lines: computedLines.map(l => l.taxRes),
      gstMode,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert Sales Order
      const insertOrderRes = await client.query(
        `INSERT INTO sales_orders (
          business_id, party_id, order_number, order_date,
          subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, notes, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19
        ) RETURNING id`,
        [
          businessId,
          data.partyId,
          orderNumber,
          orderDate,
          totals.subtotal.toFixed(2),
          totals.discountTotal.toFixed(2),
          totals.taxableAmount.toFixed(2),
          totals.igstRate.toFixed(2),
          totals.igstAmount.toFixed(2),
          totals.cgstRate.toFixed(2),
          totals.cgstAmount.toFixed(2),
          totals.sgstRate.toFixed(2),
          totals.sgstAmount.toFixed(2),
          totals.roundOff.toFixed(2),
          totals.grandTotal.toFixed(2),
          'DRAFT', // Create as DRAFT initially
          data.notes || null,
          userId || null,
          userId || null,
        ]
      );

      const orderId = insertOrderRes.rows[0].id;

      // 2. Insert Lines & Batches
      for (const line of computedLines) {
        const lineRes = await client.query(
          `INSERT INTO sales_order_lines (
            sales_order_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11
          ) RETURNING id`,
          [
            orderId,
            line.uniqueItemId,
            line.taxRes.quantity.toFixed(2),
            line.taxRes.rate.toFixed(2),
            line.taxRes.discountType,
            line.taxRes.discountValue.toFixed(2),
            line.taxRes.discountAmount.toFixed(2),
            line.taxRes.taxableAmount.toFixed(2),
            line.taxRes.gstRate.toFixed(2),
            line.taxRes.taxAmount.toFixed(2),
            line.taxRes.lineTotal.toFixed(2),
          ]
        );

        const lineId = lineRes.rows[0].id;

        if (line.batches && line.batches.length > 0) {
          let batchSum = 0;
          for (const b of line.batches) {
            batchSum += b.quantity;
            await client.query(
              `INSERT INTO sales_order_line_batches (sales_order_line_id, batch_id, quantity)
               VALUES ($1, $2, $3)`,
              [lineId, b.batchId, b.quantity.toFixed(2)]
            );
          }
          if (round2(batchSum) !== round2(line.quantity)) {
            throw new Error(`Allocated batch quantity (${batchSum}) does not match line quantity (${line.quantity})`);
          }
        }
      }

      // 3. If target status is CONFIRMED, execute reservation in the same transaction
      if (targetStatus === 'CONFIRMED') {
        await this._confirmOrderInternal(client, businessId, orderId, userId);
      }

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: targetStatus === 'CONFIRMED' ? 'SALES_ORDER_CONFIRMED' : 'SALES_ORDER_CREATED',
        entityType: 'SALES_ORDER',
        entityId: orderId,
        newValue: { orderNumber, partyId: data.partyId, grandTotal: totals.grandTotal, status: targetStatus },
      });

      return await this.getSalesOrderById(businessId, orderId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Internal helper to reserve inventory for a sales order inside an active transaction
   */
  private static async _confirmOrderInternal(
    client: PoolClient,
    businessId: string,
    orderId: string,
    userId?: string
  ) {
    // Select order lines and batches
    const linesRes = await client.query(
      `SELECT sol.id, sol.unique_item_id, sol.quantity, solb.batch_id, solb.quantity as batch_qty
       FROM sales_order_lines sol
       JOIN sales_order_line_batches solb ON sol.id = solb.sales_order_line_id
       WHERE sol.sales_order_id = $1`,
      [orderId]
    );

    if (linesRes.rows.length === 0) {
      throw new Error('Sales order has no allocated batches to reserve');
    }

    for (const row of linesRes.rows) {
      const batchId = row.batch_id;
      const qty = parseFloat(row.batch_qty);

      // Lock optical_stocks row
      const stockRes = await client.query(
        `SELECT id, physical_stock, reserved_stock, available_stock 
         FROM optical_stocks 
         WHERE business_id = $1 AND batch_id = $2 
         FOR UPDATE`,
        [businessId, batchId]
      );

      if (stockRes.rows.length === 0) {
        throw new Error(`No stock entry found for batch ${batchId}`);
      }

      const currentStock = stockRes.rows[0];
      const available = parseFloat(currentStock.available_stock || '0');

      if (available < qty) {
        throw new Error(
          `Insufficient available stock for batch. Available: ${available} pairs, Required: ${qty} pairs.`
        );
      }

      const newReserved = round2(parseFloat(currentStock.reserved_stock || '0') + qty);
      const newAvailable = round2(parseFloat(currentStock.physical_stock || '0') - newReserved);

      // Update optical_stocks
      await client.query(
        `UPDATE optical_stocks 
         SET reserved_stock = $1, available_stock = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newReserved.toFixed(2), newAvailable.toFixed(2), currentStock.id]
      );

      // Insert stock_reservations
      await client.query(
        `INSERT INTO stock_reservations (
          business_id, batch_id, quantity, status, reference_type, reference_id, notes, created_by
        ) VALUES (
          $1, $2, $3, 'ACTIVE', 'SALES_ORDER', $4, 'Sales Order Reservation', $5
        )`,
        [businessId, batchId, qty.toFixed(2), orderId, userId || null]
      );

      // Insert stock_ledger for reservation hold
      await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out,
          balance, reason, created_by
        ) VALUES (
          $1, $2, 'RESERVATION_HOLD', 'SALES_ORDER', $3,
          0.00, 0.00, $4, 0.00,
          $5, 'Sales Order Reservation Hold', $6
        )`,
        [
          businessId,
          batchId,
          orderId,
          qty.toFixed(2),
          parseFloat(currentStock.physical_stock).toFixed(2),
          userId || null,
        ]
      );
    }

    // Set order status to CONFIRMED
    await client.query(
      `UPDATE sales_orders SET status = 'CONFIRMED', updated_at = NOW(), updated_by = $1 WHERE id = $2`,
      [userId || null, orderId]
    );
  }

  /**
   * Confirms a DRAFT Sales Order and creates reservations atomically
   */
  static async confirmSalesOrder(businessId: string, orderId: string, userId?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        `SELECT id, order_number, status, party_id, grand_total 
         FROM sales_orders 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, orderId]
      );

      if (orderRes.rows.length === 0) {
        throw new Error('Sales order not found');
      }

      const order = orderRes.rows[0];
      if (order.status !== 'DRAFT') {
        throw new Error(`Only DRAFT orders can be confirmed. Current status: ${order.status}`);
      }

      await this._confirmOrderInternal(client, businessId, orderId, userId);

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_ORDER_CONFIRMED',
        entityType: 'SALES_ORDER',
        entityId: orderId,
        newValue: { orderNumber: order.order_number, status: 'CONFIRMED' },
      });

      return await this.getSalesOrderById(businessId, orderId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Edit a Sales Order. If already CONFIRMED, releases previous reservations and re-reserves newly allocated batches.
   */
  static async editSalesOrder(
    businessId: string,
    orderId: string,
    data: Partial<CreateSalesOrderDTO>,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        `SELECT id, order_number, status, party_id 
         FROM sales_orders 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, orderId]
      );

      if (orderRes.rows.length === 0) {
        throw new Error('Sales order not found');
      }

      const existingOrder = orderRes.rows[0];
      if (existingOrder.status === 'CONVERTED' || existingOrder.status === 'CANCELLED') {
        throw new Error(`Cannot edit order in status ${existingOrder.status}`);
      }

      // If status is CONFIRMED, release previous reservations first
      if (existingOrder.status === 'CONFIRMED') {
        await this._releaseOrderReservationsInternal(client, businessId, orderId, userId);
      }

      const partyId = data.partyId || existingOrder.party_id;
      await this.validateCustomerParty(businessId, partyId);

      // If new lines are provided, recompute totals and replace lines
      if (data.lines && data.lines.length > 0) {
        const gstMode = data.gstMode || 'INTRA_STATE';
        const computedLines = data.lines.map(line => {
          if (line.quantity <= 0) throw new Error('Line quantity must be greater than zero');
          if (line.rate < 0) throw new Error('Line rate cannot be negative');

          const taxRes = calculateLineTax({
            quantity: line.quantity,
            rate: line.rate,
            discountType: line.discountType || 'NONE',
            discountValue: line.discountValue || 0,
            gstRate: line.gstRate ?? 5.0,
          });

          return {
            ...line,
            taxRes,
          };
        });

        const totals = calculateInvoiceTotals({
          lines: computedLines.map(l => l.taxRes),
          gstMode,
        });

        // Update Sales Order record
        await client.query(
          `UPDATE sales_orders SET
            party_id = $1,
            subtotal = $2,
            discount_total = $3,
            taxable_amount = $4,
            igst_rate = $5,
            igst_amount = $6,
            cgst_rate = $7,
            cgst_amount = $8,
            sgst_rate = $9,
            sgst_amount = $10,
            round_off = $11,
            grand_total = $12,
            notes = COALESCE($13, notes),
            updated_at = NOW(),
            updated_by = $14
           WHERE id = $15`,
          [
            partyId,
            totals.subtotal.toFixed(2),
            totals.discountTotal.toFixed(2),
            totals.taxableAmount.toFixed(2),
            totals.igstRate.toFixed(2),
            totals.igstAmount.toFixed(2),
            totals.cgstRate.toFixed(2),
            totals.cgstAmount.toFixed(2),
            totals.sgstRate.toFixed(2),
            totals.sgstAmount.toFixed(2),
            totals.roundOff.toFixed(2),
            totals.grandTotal.toFixed(2),
            data.notes || null,
            userId || null,
            orderId,
          ]
        );

        // Delete old lines (cascades to sales_order_line_batches)
        await client.query(`DELETE FROM sales_order_lines WHERE sales_order_id = $1`, [orderId]);

        // Insert updated lines and batches
        for (const line of computedLines) {
          const lineRes = await client.query(
            `INSERT INTO sales_order_lines (
              sales_order_id, unique_item_id, quantity, rate,
              discount_type, discount_value, discount_amount,
              taxable_amount, gst_rate, tax_amount, line_total
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, $7,
              $8, $9, $10, $11
            ) RETURNING id`,
            [
              orderId,
              line.uniqueItemId,
              line.taxRes.quantity.toFixed(2),
              line.taxRes.rate.toFixed(2),
              line.taxRes.discountType,
              line.taxRes.discountValue.toFixed(2),
              line.taxRes.discountAmount.toFixed(2),
              line.taxRes.taxableAmount.toFixed(2),
              line.taxRes.gstRate.toFixed(2),
              line.taxRes.taxAmount.toFixed(2),
              line.taxRes.lineTotal.toFixed(2),
            ]
          );

          const lineId = lineRes.rows[0].id;

          if (line.batches && line.batches.length > 0) {
            for (const b of line.batches) {
              await client.query(
                `INSERT INTO sales_order_line_batches (sales_order_line_id, batch_id, quantity)
                 VALUES ($1, $2, $3)`,
                [lineId, b.batchId, b.quantity.toFixed(2)]
              );
            }
          }
        }
      }

      // If the order was CONFIRMED (or target is CONFIRMED), re-apply reservation hold
      if (existingOrder.status === 'CONFIRMED' || data.status === 'CONFIRMED') {
        await this._confirmOrderInternal(client, businessId, orderId, userId);
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_ORDER_EDITED',
        entityType: 'SALES_ORDER',
        entityId: orderId,
        newValue: { orderNumber: existingOrder.order_number, changes: data },
      });

      return await this.getSalesOrderById(businessId, orderId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Internal helper to release reservations of a sales order
   */
  private static async _releaseOrderReservationsInternal(
    client: PoolClient,
    businessId: string,
    orderId: string,
    userId?: string
  ) {
    const res = await client.query(
      `SELECT id, batch_id, quantity 
       FROM stock_reservations 
       WHERE business_id = $1 AND reference_type = 'SALES_ORDER' AND reference_id = $2 AND status = 'ACTIVE'`,
      [businessId, orderId]
    );

    for (const r of res.rows) {
      const batchId = r.batch_id;
      const qty = parseFloat(r.quantity);

      // Lock optical_stocks
      const stockRes = await client.query(
        `SELECT id, physical_stock, reserved_stock, available_stock 
         FROM optical_stocks 
         WHERE business_id = $1 AND batch_id = $2 
         FOR UPDATE`,
        [businessId, batchId]
      );

      if (stockRes.rows.length > 0) {
        const cur = stockRes.rows[0];
        const newReserved = round2(Math.max(0, parseFloat(cur.reserved_stock || '0') - qty));
        const newAvailable = round2(parseFloat(cur.physical_stock || '0') - newReserved);

        await client.query(
          `UPDATE optical_stocks 
           SET reserved_stock = $1, available_stock = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newReserved.toFixed(2), newAvailable.toFixed(2), cur.id]
        );

        // Update reservation record
        await client.query(
          `UPDATE stock_reservations 
           SET status = 'RELEASED', released_at = NOW() 
           WHERE id = $1`,
          [r.id]
        );

        // Record stock_ledger entry
        await client.query(
          `INSERT INTO stock_ledger (
            business_id, batch_id, transaction_type, reference_type, reference_id,
            quantity_in, quantity_out, reserved_in, reserved_out,
            balance, reason, created_by
          ) VALUES (
            $1, $2, 'RESERVATION_RELEASE', 'SALES_ORDER', $3,
            0.00, 0.00, 0.00, $4,
            $5, 'Sales Order Reservation Released', $6
          )`,
          [
            businessId,
            batchId,
            orderId,
            qty.toFixed(2),
            parseFloat(cur.physical_stock).toFixed(2),
            userId || null,
          ]
        );
      }
    }
  }

  /**
   * Cancels a Sales Order and releases all active reservations
   */
  static async cancelSalesOrder(businessId: string, orderId: string, reason?: string, userId?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        `SELECT id, order_number, status 
         FROM sales_orders 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, orderId]
      );

      if (orderRes.rows.length === 0) {
        throw new Error('Sales order not found');
      }

      const order = orderRes.rows[0];
      if (order.status === 'CANCELLED') {
        throw new Error('Sales order is already cancelled');
      }
      if (order.status === 'CONVERTED') {
        throw new Error('Cannot cancel a fully converted sales order');
      }

      // If CONFIRMED or PARTIALLY_CONVERTED, release active reservations
      if (order.status === 'CONFIRMED' || order.status === 'PARTIALLY_CONVERTED') {
        await this._releaseOrderReservationsInternal(client, businessId, orderId, userId);
      }

      await client.query(
        `UPDATE sales_orders SET status = 'CANCELLED', updated_at = NOW(), updated_by = $1 WHERE id = $2`,
        [userId || null, orderId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_ORDER_CANCELLED',
        entityType: 'SALES_ORDER',
        entityId: orderId,
        newValue: { orderNumber: order.order_number, status: 'CANCELLED', reason },
      });

      return await this.getSalesOrderById(businessId, orderId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get single Sales Order by ID with lines and batches
   */
  static async getSalesOrderById(businessId: string, orderId: string) {
    const [order] = await db
      .select({
        order: salesOrders,
        party: parties,
      })
      .from(salesOrders)
      .innerJoin(parties, eq(salesOrders.partyId, parties.id))
      .where(and(eq(salesOrders.businessId, businessId), eq(salesOrders.id, orderId)))
      .limit(1);

    if (!order) {
      throw new Error('Sales order not found');
    }

    const lines = await db
      .select({
        line: salesOrderLines,
        uniqueItem: uniqueItems,
      })
      .from(salesOrderLines)
      .innerJoin(uniqueItems, eq(salesOrderLines.uniqueItemId, uniqueItems.id))
      .where(eq(salesOrderLines.salesOrderId, orderId));

    const lineIds = lines.map(l => l.line.id);
    let batches: any[] = [];
    if (lineIds.length > 0) {
      batches = await db
        .select({
          lineBatch: salesOrderLineBatches,
          batch: opticalBatches,
        })
        .from(salesOrderLineBatches)
        .innerJoin(opticalBatches, eq(salesOrderLineBatches.batchId, opticalBatches.id))
        .where(inArray(salesOrderLineBatches.salesOrderLineId, lineIds));
    }

    const batchMap = new Map<string, any[]>();
    for (const b of batches) {
      const lid = b.lineBatch.salesOrderLineId;
      if (!batchMap.has(lid)) batchMap.set(lid, []);
      batchMap.get(lid)!.push({
        ...b.lineBatch,
        batch: b.batch,
      });
    }

    return {
      ...order.order,
      party: order.party,
      lines: lines.map(l => ({
        ...l.line,
        uniqueItem: l.uniqueItem,
        batches: batchMap.get(l.line.id) || [],
      })),
    };
  }

  /**
   * List Sales Orders with pagination and filters
   */
  static async getSalesOrders(
    businessId: string,
    filters?: {
      partyId?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    let conditions = [eq(salesOrders.businessId, businessId)];

    if (filters?.partyId) {
      conditions.push(eq(salesOrders.partyId, filters.partyId));
    }
    if (filters?.status) {
      conditions.push(eq(salesOrders.status, filters.status));
    }
    if (filters?.search) {
      conditions.push(
        or(
          ilike(salesOrders.orderNumber, `%${filters.search}%`),
          ilike(parties.name, `%${filters.search}%`)
        )!
      );
    }

    const [totalCountRes] = await db
      .select({ count: count() })
      .from(salesOrders)
      .innerJoin(parties, eq(salesOrders.partyId, parties.id))
      .where(and(...conditions));

    const orders = await db
      .select({
        order: salesOrders,
        party: parties,
      })
      .from(salesOrders)
      .innerJoin(parties, eq(salesOrders.partyId, parties.id))
      .where(and(...conditions))
      .orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      total: Number(totalCountRes?.count || 0),
      orders: orders.map(o => ({
        ...o.order,
        party: o.party,
      })),
    };
  }

  // =========================================================================
  // SALES INVOICE LIFECYCLE
  // =========================================================================

  /**
   * Direct Sales Invoice Creation (DRAFT or directly POSTED)
   */
  static async createSalesInvoice(businessId: string, data: CreateSalesInvoiceDTO, userId?: string) {
    if (!businessId) throw new Error('Business ID is required');
    const customer = await this.validateCustomerParty(businessId, data.partyId);

    if (!data.lines || data.lines.length === 0) {
      throw new Error('At least one sales line is required');
    }

    const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    const isInterState =
      biz?.state && customer?.state && biz.state.trim().toLowerCase() !== customer.state.trim().toLowerCase();
    const gstMode = data.gstMode || (isInterState ? 'INTER_STATE' : 'INTRA_STATE');

    const invoiceDate = new Date(data.invoiceDate || new Date());
    const invoiceNumber = data.invoiceNumber || (await this.generateInvoiceNumber(businessId));
    const targetStatus = data.status || 'DRAFT';

    const computedLines = data.lines.map(line => {
      if (line.quantity <= 0) throw new Error('Line quantity must be greater than zero');
      if (line.rate < 0) throw new Error('Line rate cannot be negative');

      const discType =
        line.discountType || (line.discountPercent !== undefined && line.discountPercent > 0 ? 'PERCENTAGE' : 'NONE');
      const discVal = line.discountValue !== undefined ? line.discountValue : (line.discountPercent ?? 0);

      const taxRes = calculateLineTax({
        quantity: line.quantity,
        rate: line.rate,
        discountType: discType,
        discountValue: discVal,
        gstRate: line.gstRate ?? 5.0,
      });

      return {
        ...line,
        taxRes,
      };
    });

    const totals = calculateInvoiceTotals({
      lines: computedLines.map(l => l.taxRes),
      gstMode,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert Sales Invoice
      const insertInvRes = await client.query(
        `INSERT INTO sales_invoices (
          business_id, party_id, sales_order_id, invoice_number, invoice_date,
          subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, notes, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20
        ) RETURNING id`,
        [
          businessId,
          data.partyId,
          data.salesOrderId || null,
          invoiceNumber,
          invoiceDate,
          totals.subtotal.toFixed(2),
          totals.discountTotal.toFixed(2),
          totals.taxableAmount.toFixed(2),
          totals.igstRate.toFixed(2),
          totals.igstAmount.toFixed(2),
          totals.cgstRate.toFixed(2),
          totals.cgstAmount.toFixed(2),
          totals.sgstRate.toFixed(2),
          totals.sgstAmount.toFixed(2),
          totals.roundOff.toFixed(2),
          totals.grandTotal.toFixed(2),
          'DRAFT',
          data.notes || null,
          userId || null,
          userId || null,
        ]
      );

      const invoiceId = insertInvRes.rows[0].id;

      // 2. Insert Lines and Batches
      for (const line of computedLines) {
        const lineRes = await client.query(
          `INSERT INTO sales_invoice_lines (
            sales_invoice_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11
          ) RETURNING id`,
          [
            invoiceId,
            line.uniqueItemId,
            line.taxRes.quantity.toFixed(2),
            line.taxRes.rate.toFixed(2),
            line.taxRes.discountType,
            line.taxRes.discountValue.toFixed(2),
            line.taxRes.discountAmount.toFixed(2),
            line.taxRes.taxableAmount.toFixed(2),
            line.taxRes.gstRate.toFixed(2),
            line.taxRes.taxAmount.toFixed(2),
            line.taxRes.lineTotal.toFixed(2),
          ]
        );

        const lineId = lineRes.rows[0].id;

        if (line.batches && line.batches.length > 0) {
          let batchSum = 0;
          for (const b of line.batches) {
            batchSum += b.quantity;
            await client.query(
              `INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
               VALUES ($1, $2, $3)`,
              [lineId, b.batchId, b.quantity.toFixed(2)]
            );
          }
          if (round2(batchSum) !== round2(line.quantity)) {
            throw new Error(`Allocated batch quantity (${batchSum}) does not match line quantity (${line.quantity})`);
          }
        }
      }

      // 3. If target status is POSTED, perform atomic stock deduction and ledger posting
      if (targetStatus === 'POSTED') {
        await this._postDirectInvoiceInternal(client, businessId, invoiceId, userId);
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: targetStatus === 'POSTED' ? 'SALES_INVOICE_POSTED' : 'SALES_INVOICE_CREATED',
        entityType: 'SALES_INVOICE',
        entityId: invoiceId,
        newValue: { invoiceNumber, partyId: data.partyId, grandTotal: totals.grandTotal, status: targetStatus },
      });

      return await this.getSalesInvoiceById(businessId, invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Internal helper to post a direct invoice to stock and customer ledger
   */
  private static async _postDirectInvoiceInternal(
    client: PoolClient,
    businessId: string,
    invoiceId: string,
    userId?: string
  ) {
    const invRes = await client.query(
      `SELECT id, invoice_number, party_id, grand_total, invoice_date 
       FROM sales_invoices 
       WHERE id = $1`,
      [invoiceId]
    );
    const invoice = invRes.rows[0];

    const linesRes = await client.query(
      `SELECT sil.id, sil.unique_item_id, sil.rate, silb.batch_id, silb.quantity as batch_qty
       FROM sales_invoice_lines sil
       JOIN sales_invoice_line_batches silb ON sil.id = silb.sales_invoice_line_id
       WHERE sil.sales_invoice_id = $1`,
      [invoiceId]
    );

    if (linesRes.rows.length === 0) {
      throw new Error('Sales invoice has no allocated batches for stock deduction');
    }

    for (const row of linesRes.rows) {
      const batchId = row.batch_id;
      const qty = parseFloat(row.batch_qty);
      const uniqueItemId = row.unique_item_id;
      const lineRate = parseFloat(row.rate);

      // Lock optical_stocks row
      const stockRes = await client.query(
        `SELECT id, physical_stock, reserved_stock, available_stock 
         FROM optical_stocks 
         WHERE business_id = $1 AND batch_id = $2 
         FOR UPDATE`,
        [businessId, batchId]
      );

      if (stockRes.rows.length === 0) {
        throw new Error(`Stock record not found for optical batch ${batchId}`);
      }

      const cur = stockRes.rows[0];
      const avail = parseFloat(cur.available_stock || '0');
      const phys = parseFloat(cur.physical_stock || '0');

      if (avail < qty) {
        throw new Error(
          `Insufficient available stock for batch. Available: ${avail} pairs, Required: ${qty} pairs.`
        );
      }

      const newPhys = round2(phys - qty);
      const newAvail = round2(newPhys - parseFloat(cur.reserved_stock || '0'));

      // Update physical stock
      await client.query(
        `UPDATE optical_stocks 
         SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newPhys.toFixed(2), newAvail.toFixed(2), cur.id]
      );

      // Stock Ledger entry
      await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out,
          balance, reason, created_by
        ) VALUES (
          $1, $2, 'SALE', 'SALES_INVOICE', $3,
          0.00, $4, 0.00, 0.00,
          $5, $6, $7
        )`,
        [
          businessId,
          batchId,
          invoiceId,
          qty.toFixed(2),
          newPhys.toFixed(2),
          `Sales Invoice: ${invoice.invoice_number}`,
          userId || null,
        ]
      );

      // Update Party-wise Last Sale Price
      await this.updatePartyItemPriceInTx(client, businessId, invoice.party_id, uniqueItemId, lineRate);
    }

    // Customer Ledger update (Debit = grand_total, balance increases)
    const grandTotal = parseFloat(invoice.grand_total);
    const lastLedgerRes = await client.query(
      `SELECT balance FROM customer_ledgers 
       WHERE business_id = $1 AND party_id = $2 
       ORDER BY transaction_date DESC, created_at DESC 
       LIMIT 1`,
      [businessId, invoice.party_id]
    );

    const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
    const newBalance = round2(prevBalance + grandTotal);

    await client.query(
      `INSERT INTO customer_ledgers (
        business_id, party_id, transaction_type, reference_type, reference_id,
        debit, credit, balance, transaction_date, notes, created_by
      ) VALUES (
        $1, $2, 'SALE', 'SALES_INVOICE', $3,
        $4, 0.00, $5, $6, $7, $8
      )`,
      [
        businessId,
        invoice.party_id,
        invoiceId,
        grandTotal.toFixed(2),
        newBalance.toFixed(2),
        invoice.invoice_date,
        `Sales Invoice: ${invoice.invoice_number}`,
        userId || null,
      ]
    );

    // Update invoice status to POSTED
    await client.query(
      `UPDATE sales_invoices SET status = 'POSTED', updated_at = NOW(), updated_by = $1 WHERE id = $2`,
      [userId || null, invoiceId]
    );
  }

  /**
   * Post a DRAFT Sales Invoice
   */
  static async postSalesInvoice(businessId: string, invoiceId: string, userId?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invRes = await client.query(
        `SELECT id, invoice_number, status, party_id, grand_total 
         FROM sales_invoices 
         WHERE business_id = $1 AND id = $2 
         FOR UPDATE`,
        [businessId, invoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error('Sales invoice not found');
      }

      const invoice = invRes.rows[0];
      if (invoice.status !== 'DRAFT') {
        throw new Error(`Only DRAFT invoices can be posted. Current status: ${invoice.status}`);
      }

      await this._postDirectInvoiceInternal(client, businessId, invoiceId, userId);

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_INVOICE_POSTED',
        entityType: 'SALES_INVOICE',
        entityId: invoiceId,
        newValue: { invoiceNumber: invoice.invoice_number, status: 'POSTED' },
      });

      return await this.getSalesInvoiceById(businessId, invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Convert Sales Order -> Sales Invoice (Atomic Reservation Conversion)
   */
  static async convertOrderToInvoice(
    businessId: string,
    orderId: string,
    data: ConvertOrderToInvoiceDTO,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock and verify Sales Order
      const orderRes = await client.query(
        `SELECT * FROM sales_orders WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, orderId]
      );

      if (orderRes.rows.length === 0) {
        throw new Error('Sales order not found');
      }

      const order = orderRes.rows[0];
      if (order.status !== 'CONFIRMED' && order.status !== 'PARTIALLY_CONVERTED') {
        throw new Error(`Cannot convert order in status ${order.status}. Order must be CONFIRMED.`);
      }

      // Fetch existing order lines and batches
      const orderLinesRes = await client.query(
        `SELECT sol.*, solb.batch_id, solb.quantity as batch_qty
         FROM sales_order_lines sol
         JOIN sales_order_line_batches solb ON sol.id = solb.sales_order_line_id
         WHERE sol.sales_order_id = $1`,
        [orderId]
      );

      const invoiceNumber = data.invoiceNumber || (await this.generateInvoiceNumber(businessId));
      const invoiceDate = new Date(data.invoiceDate || new Date());

      // Prepare conversion lines
      let linesToConvert: SalesLineInput[] = [];

      if (data.lines && data.lines.length > 0) {
        linesToConvert = data.lines.map(l => {
          const discType =
            l.discountType || (l.discountPercent !== undefined && l.discountPercent > 0 ? 'PERCENTAGE' : 'NONE');
          const discVal = l.discountValue !== undefined ? l.discountValue : (l.discountPercent ?? 0);
          return {
            uniqueItemId: l.uniqueItemId,
            quantity: l.quantity,
            rate: l.rate,
            discountType: discType,
            discountValue: discVal,
            gstRate: l.gstRate ?? 5.0,
            batches: l.batches,
          };
        });
      } else {
        // Full conversion of entire order lines
        const lineMap = new Map<string, SalesLineInput>();
        for (const row of orderLinesRes.rows) {
          if (!lineMap.has(row.id)) {
            lineMap.set(row.id, {
              uniqueItemId: row.unique_item_id,
              quantity: parseFloat(row.quantity),
              rate: parseFloat(row.rate),
              discountType: row.discount_type,
              discountValue: parseFloat(row.discount_value),
              gstRate: parseFloat(row.gst_rate),
              batches: [],
            });
          }
          lineMap.get(row.id)!.batches!.push({
            batchId: row.batch_id,
            quantity: parseFloat(row.batch_qty),
          });
        }
        linesToConvert = Array.from(lineMap.values());
      }

      // Calculate taxes & totals
      const computedLines = linesToConvert.map(line => {
        const taxRes = calculateLineTax({
          quantity: line.quantity,
          rate: line.rate,
          discountType: line.discountType || 'NONE',
          discountValue: line.discountValue || 0,
          gstRate: line.gstRate ?? 5.0,
        });
        return { ...line, taxRes };
      });

      const totals = calculateInvoiceTotals({
        lines: computedLines.map(l => l.taxRes),
        gstMode: parseFloat(order.igst_amount) > 0 ? 'INTER_STATE' : 'INTRA_STATE',
      });

      // Insert Sales Invoice
      const insertInvRes = await client.query(
        `INSERT INTO sales_invoices (
          business_id, party_id, sales_order_id, invoice_number, invoice_date,
          subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, notes, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16, 'POSTED', $17, $18, $19
        ) RETURNING id`,
        [
          businessId,
          order.party_id,
          orderId,
          invoiceNumber,
          invoiceDate,
          totals.subtotal.toFixed(2),
          totals.discountTotal.toFixed(2),
          totals.taxableAmount.toFixed(2),
          totals.igstRate.toFixed(2),
          totals.igstAmount.toFixed(2),
          totals.cgstRate.toFixed(2),
          totals.cgstAmount.toFixed(2),
          totals.sgstRate.toFixed(2),
          totals.sgstAmount.toFixed(2),
          totals.roundOff.toFixed(2),
          totals.grandTotal.toFixed(2),
          data.notes || `Converted from Sales Order ${order.order_number}`,
          userId || null,
          userId || null,
        ]
      );

      const invoiceId = insertInvRes.rows[0].id;

      // Insert Invoice Lines & deduct converted reservations
      for (const line of computedLines) {
        const lineRes = await client.query(
          `INSERT INTO sales_invoice_lines (
            sales_invoice_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11
          ) RETURNING id`,
          [
            invoiceId,
            line.uniqueItemId,
            line.taxRes.quantity.toFixed(2),
            line.taxRes.rate.toFixed(2),
            line.taxRes.discountType,
            line.taxRes.discountValue.toFixed(2),
            line.taxRes.discountAmount.toFixed(2),
            line.taxRes.taxableAmount.toFixed(2),
            line.taxRes.gstRate.toFixed(2),
            line.taxRes.taxAmount.toFixed(2),
            line.taxRes.lineTotal.toFixed(2),
          ]
        );

        const lineId = lineRes.rows[0].id;

        if (line.batches) {
          for (const b of line.batches) {
            await client.query(
              `INSERT INTO sales_invoice_line_batches (sales_invoice_line_id, batch_id, quantity)
               VALUES ($1, $2, $3)`,
              [lineId, b.batchId, b.quantity.toFixed(2)]
            );

            // Convert / consume the reservation
            const batchId = b.batchId;
            const convQty = b.quantity;

            // Lock optical_stocks
            const stockRes = await client.query(
              `SELECT id, physical_stock, reserved_stock, available_stock 
               FROM optical_stocks 
               WHERE business_id = $1 AND batch_id = $2 
               FOR UPDATE`,
              [businessId, batchId]
            );

            if (stockRes.rows.length === 0) {
              throw new Error(`Stock record not found for batch ${batchId}`);
            }

            const cur = stockRes.rows[0];
            const newPhys = round2(parseFloat(cur.physical_stock) - convQty);
            const newRes = round2(Math.max(0, parseFloat(cur.reserved_stock) - convQty));
            const newAvail = round2(newPhys - newRes);

            await client.query(
              `UPDATE optical_stocks 
               SET physical_stock = $1, reserved_stock = $2, available_stock = $3, updated_at = NOW() 
               WHERE id = $4`,
              [newPhys.toFixed(2), newRes.toFixed(2), newAvail.toFixed(2), cur.id]
            );

            // Update reservation record
            const resRec = await client.query(
              `SELECT id, quantity FROM stock_reservations 
               WHERE business_id = $1 AND reference_type = 'SALES_ORDER' AND reference_id = $2 AND batch_id = $3 AND status = 'ACTIVE'
               LIMIT 1`,
              [businessId, orderId, batchId]
            );

            if (resRec.rows.length > 0) {
              const resRow = resRec.rows[0];
              const curResQty = parseFloat(resRow.quantity);
              if (curResQty <= convQty) {
                await client.query(
                  `UPDATE stock_reservations SET status = 'CONVERTED', converted_at = NOW() WHERE id = $1`,
                  [resRow.id]
                );
              } else {
                // Split reservation: reduce active qty by converted qty
                const remainResQty = round2(curResQty - convQty);
                await client.query(
                  `UPDATE stock_reservations SET quantity = $1 WHERE id = $2`,
                  [remainResQty.toFixed(2), resRow.id]
                );
              }
            }

            // Stock Ledger entry
            await client.query(
              `INSERT INTO stock_ledger (
                business_id, batch_id, transaction_type, reference_type, reference_id,
                quantity_in, quantity_out, reserved_in, reserved_out,
                balance, reason, created_by
              ) VALUES (
                $1, $2, 'RESERVATION_CONVERSION', 'SALES_INVOICE', $3,
                0.00, $4, 0.00, $4,
                $5, $6, $7
              )`,
              [
                businessId,
                batchId,
                invoiceId,
                convQty.toFixed(2),
                newPhys.toFixed(2),
                `Invoice: ${invoiceNumber} (Converted from Order: ${order.order_number})`,
                userId || null,
              ]
            );

            // Update Last Sale Price
            await this.updatePartyItemPriceInTx(client, businessId, order.party_id, line.uniqueItemId, line.rate);
          }
        }
      }

      // Customer Ledger entry
      const grandTotal = totals.grandTotal;
      const lastLedgerRes = await client.query(
        `SELECT balance FROM customer_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY transaction_date DESC, created_at DESC 
         LIMIT 1`,
        [businessId, order.party_id]
      );

      const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
      const newBalance = round2(prevBalance + grandTotal);

      await client.query(
        `INSERT INTO customer_ledgers (
          business_id, party_id, transaction_type, reference_type, reference_id,
          debit, credit, balance, transaction_date, notes, created_by
        ) VALUES (
          $1, $2, 'SALE', 'SALES_INVOICE', $3,
          $4, 0.00, $5, $6, $7, $8
        )`,
        [
          businessId,
          order.party_id,
          invoiceId,
          grandTotal.toFixed(2),
          newBalance.toFixed(2),
          invoiceDate,
          `Sales Invoice: ${invoiceNumber} (from SO: ${order.order_number})`,
          userId || null,
        ]
      );

      // Check if order still has any active reservations left
      const remainingRes = await client.query(
        `SELECT id FROM stock_reservations 
         WHERE business_id = $1 AND reference_type = 'SALES_ORDER' AND reference_id = $2 AND status = 'ACTIVE'`,
        [businessId, orderId]
      );

      const newOrderStatus = remainingRes.rows.length === 0 ? 'CONVERTED' : 'PARTIALLY_CONVERTED';
      await client.query(
        `UPDATE sales_orders SET status = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3`,
        [newOrderStatus, userId || null, orderId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_ORDER_CONVERTED',
        entityType: 'SALES_INVOICE',
        entityId: invoiceId,
        newValue: {
          invoiceNumber,
          orderNumber: order.order_number,
          orderStatus: newOrderStatus,
          grandTotal,
        },
      });

      return await this.getSalesInvoiceById(businessId, invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cancels a Sales Invoice and reverses stock & customer ledger
   */
  static async cancelSalesInvoice(businessId: string, invoiceId: string, reason?: string, userId?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invRes = await client.query(
        `SELECT * FROM sales_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, invoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error('Sales invoice not found');
      }

      const invoice = invRes.rows[0];
      if (invoice.status === 'CANCELLED') {
        throw new Error('Sales invoice is already cancelled');
      }

      // Check if any active sales returns exist for this invoice
      const activeReturnsRes = await client.query(
        `SELECT id, return_number, status FROM sales_returns 
         WHERE business_id = $1 AND sales_invoice_id = $2 AND status != 'CANCELLED'
         LIMIT 1`,
        [businessId, invoiceId]
      );
      if (activeReturnsRes.rows.length > 0) {
        throw new Error(
          `Cannot cancel Sales Invoice: active Sales Return ${activeReturnsRes.rows[0].return_number} (${activeReturnsRes.rows[0].status}) exists against this invoice. Cancel or resolve returns first.`
        );
      }

      // Check if any active payment allocations exist for this invoice
      const activeAllocRes = await client.query(
        `SELECT pa.id, p.payment_number, pa.allocated_amount 
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         WHERE pa.business_id = $1 AND pa.document_id = $2 AND pa.status = 'ACTIVE' AND p.status != 'CANCELLED'
         LIMIT 1`,
        [businessId, invoiceId]
      );
      if (activeAllocRes.rows.length > 0) {
        throw new Error(
          `Cannot cancel Sales Invoice: active payment allocation (${activeAllocRes.rows[0].payment_number}) of ₹${parseFloat(activeAllocRes.rows[0].allocated_amount).toFixed(2)} is applied. Please cancel or reallocate the payment first.`
        );
      }

      // If invoice was POSTED, reverse stock and ledger
      if (invoice.status === 'POSTED') {
        const linesRes = await client.query(
          `SELECT silb.batch_id, silb.quantity 
           FROM sales_invoice_lines sil
           JOIN sales_invoice_line_batches silb ON sil.id = silb.sales_invoice_line_id
           WHERE sil.sales_invoice_id = $1`,
          [invoiceId]
        );

        for (const row of linesRes.rows) {
          const batchId = row.batch_id;
          const qty = parseFloat(row.quantity);

          const stockRes = await client.query(
            `SELECT id, physical_stock, reserved_stock, available_stock 
             FROM optical_stocks 
             WHERE business_id = $1 AND batch_id = $2 
             FOR UPDATE`,
            [businessId, batchId]
          );

          if (stockRes.rows.length > 0) {
            const cur = stockRes.rows[0];
            const newPhys = round2(parseFloat(cur.physical_stock) + qty);
            const newAvail = round2(newPhys - parseFloat(cur.reserved_stock));

            await client.query(
              `UPDATE optical_stocks 
               SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
               WHERE id = $3`,
              [newPhys.toFixed(2), newAvail.toFixed(2), cur.id]
            );

            // Stock Ledger entry for reversal
            await client.query(
              `INSERT INTO stock_ledger (
                business_id, batch_id, transaction_type, reference_type, reference_id,
                quantity_in, quantity_out, reserved_in, reserved_out,
                balance, reason, created_by
              ) VALUES (
                $1, $2, 'CANCELLATION_REVERSAL', 'SALES_INVOICE', $3,
                $4, 0.00, 0.00, 0.00,
                $5, $6, $7
              )`,
              [
                businessId,
                batchId,
                invoiceId,
                qty.toFixed(2),
                newPhys.toFixed(2),
                `Cancelled Sales Invoice: ${invoice.invoice_number}`,
                userId || null,
              ]
            );
          }
        }

        // Customer Ledger reversal (Credit = grand_total, balance decreases)
        const grandTotal = parseFloat(invoice.grand_total);
        const lastLedgerRes = await client.query(
          `SELECT balance FROM customer_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY transaction_date DESC, created_at DESC 
           LIMIT 1`,
          [businessId, invoice.party_id]
        );

        const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
        const newBalance = round2(prevBalance - grandTotal);

        await client.query(
          `INSERT INTO customer_ledgers (
            business_id, party_id, transaction_type, reference_type, reference_id,
            debit, credit, balance, transaction_date, notes, created_by
          ) VALUES (
            $1, $2, 'CANCELLATION_REVERSAL', 'SALES_INVOICE', $3,
            0.00, $4, $5, NOW(), $6, $7
          )`,
          [
            businessId,
            invoice.party_id,
            invoiceId,
            grandTotal.toFixed(2),
            newBalance.toFixed(2),
            `Reversal for Cancelled Sales Invoice: ${invoice.invoice_number}`,
            userId || null,
          ]
        );
      }

      await client.query(
        `UPDATE sales_invoices SET status = 'CANCELLED', updated_at = NOW(), updated_by = $1 WHERE id = $2`,
        [userId || null, invoiceId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_INVOICE_CANCELLED',
        entityType: 'SALES_INVOICE',
        entityId: invoiceId,
        newValue: { invoiceNumber: invoice.invoice_number, status: 'CANCELLED', reason },
      });

      return await this.getSalesInvoiceById(businessId, invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get single Sales Invoice by ID
   */
  static async getSalesInvoiceById(businessId: string, invoiceId: string) {
    const [inv] = await db
      .select({
        invoice: salesInvoices,
        party: parties,
      })
      .from(salesInvoices)
      .innerJoin(parties, eq(salesInvoices.partyId, parties.id))
      .where(and(eq(salesInvoices.businessId, businessId), eq(salesInvoices.id, invoiceId)))
      .limit(1);

    if (!inv) {
      throw new Error('Sales invoice not found');
    }

    const lines = await db
      .select({
        line: salesInvoiceLines,
        uniqueItem: uniqueItems,
      })
      .from(salesInvoiceLines)
      .innerJoin(uniqueItems, eq(salesInvoiceLines.uniqueItemId, uniqueItems.id))
      .where(eq(salesInvoiceLines.salesInvoiceId, invoiceId));

    const lineIds = lines.map(l => l.line.id);
    let batches: any[] = [];
    if (lineIds.length > 0) {
      batches = await db
        .select({
          lineBatch: salesInvoiceLineBatches,
          batch: opticalBatches,
        })
        .from(salesInvoiceLineBatches)
        .innerJoin(opticalBatches, eq(salesInvoiceLineBatches.batchId, opticalBatches.id))
        .where(inArray(salesInvoiceLineBatches.salesInvoiceLineId, lineIds));
    }

    const batchMap = new Map<string, any[]>();
    for (const b of batches) {
      const lid = b.lineBatch.salesInvoiceLineId;
      if (!batchMap.has(lid)) batchMap.set(lid, []);
      batchMap.get(lid)!.push({
        ...b.lineBatch,
        batch: b.batch,
      });
    }

    // Fetch active payment allocations
    const allocsRes = await pool.query(
      `SELECT pa.*, p.payment_number, p.payment_date, p.payment_mode, p.status as payment_status_master
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.business_id = $1 AND pa.document_type = 'SALES_INVOICE' AND pa.document_id = $2 AND pa.status = 'ACTIVE' AND p.status = 'POSTED'`,
      [businessId, invoiceId]
    );

    const paidAmount = allocsRes.rows.reduce((sum, r) => sum + parseFloat(r.allocated_amount), 0);
    const grandTotal = parseFloat(inv.invoice.grandTotal);
    const outstandingAmount = Math.max(0, grandTotal - paidAmount);

    return {
      ...inv.invoice,
      party: inv.party,
      paidAmount,
      outstandingAmount,
      paymentAllocations: allocsRes.rows.map(r => ({
        id: r.id,
        paymentId: r.payment_id,
        paymentNumber: r.payment_number,
        paymentDate: r.payment_date,
        paymentMode: r.payment_mode,
        allocatedAmount: parseFloat(r.allocated_amount),
      })),
      lines: lines.map(l => ({
        ...l.line,
        uniqueItem: l.uniqueItem,
        batches: batchMap.get(l.line.id) || [],
      })),
    };
  }

  /**
   * List Sales Invoices with pagination & filters
   */
  static async getSalesInvoices(
    businessId: string,
    filters?: {
      partyId?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    let conditions = [eq(salesInvoices.businessId, businessId)];

    if (filters?.partyId) {
      conditions.push(eq(salesInvoices.partyId, filters.partyId));
    }
    if (filters?.status) {
      conditions.push(eq(salesInvoices.status, filters.status));
    }
    if (filters?.search) {
      conditions.push(
        or(
          ilike(salesInvoices.invoiceNumber, `%${filters.search}%`),
          ilike(parties.name, `%${filters.search}%`)
        )!
      );
    }

    const [totalCountRes] = await db
      .select({ count: count() })
      .from(salesInvoices)
      .innerJoin(parties, eq(salesInvoices.partyId, parties.id))
      .where(and(...conditions));

    const invoices = await db
      .select({
        invoice: salesInvoices,
        party: parties,
      })
      .from(salesInvoices)
      .innerJoin(parties, eq(salesInvoices.partyId, parties.id))
      .where(and(...conditions))
      .orderBy(desc(salesInvoices.invoiceDate), desc(salesInvoices.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      total: Number(totalCountRes?.count || 0),
      invoices: invoices.map(i => ({
        ...i.invoice,
        party: i.party,
      })),
    };
  }

  // =========================================================================
  // CUSTOMER LEDGER & OUTSTANDING
  // =========================================================================

  /**
   * Get customer running ledger entries
   */
  static async getCustomerLedger(
    businessId: string,
    partyId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const [party] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.id, partyId)))
      .limit(1);

    if (!party) throw new Error('Customer not found');

    const [totalCountRes] = await db
      .select({ count: count() })
      .from(customerLedgers)
      .where(and(eq(customerLedgers.businessId, businessId), eq(customerLedgers.partyId, partyId)));

    const entries = await db
      .select()
      .from(customerLedgers)
      .where(and(eq(customerLedgers.businessId, businessId), eq(customerLedgers.partyId, partyId)))
      .orderBy(desc(customerLedgers.transactionDate), desc(customerLedgers.createdAt))
      .limit(limit)
      .offset(offset);

    const currentBalance = entries.length > 0 ? parseFloat(entries[0].balance) : 0;

    return {
      party,
      currentBalance,
      total: Number(totalCountRes?.count || 0),
      entries,
    };
  }
}
