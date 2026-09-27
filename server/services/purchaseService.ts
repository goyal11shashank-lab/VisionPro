import { db, pool } from '../db/index.js';
import {
  purchaseOrders,
  purchaseOrderLines,
  purchaseOrderLineBatches,
  purchaseInvoices,
  purchaseInvoiceLines,
  purchaseInvoiceLineBatches,
  purchaseLots,
  supplierLedgers,
  parties,
  uniqueItems,
  primaryItems,
  categories,
  opticalBatches,
  opticalStocks,
  stockLedger,
} from '../db/schema.js';
import { eq, and, desc, count, ilike, or } from 'drizzle-orm';
import { calculateLineTax, calculateInvoiceTotals, round2 } from './taxCalculationService.js';
import { findOrCreateOpticalBatch, OpticalPowerInput } from './opticalMasterService.js';
import { AuditService } from './auditService.js';
import { PoolClient } from 'pg';
import { BusinessSettingsService } from './businessSettingsService.js';
import { assertValidQuantity } from '../utils/quantityValidator.js';
import { DocumentSequenceService } from './documentSequenceService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export interface PurchaseLineBatchInput {
  batchId?: string; // If existing batch is selected
  // Or powers to create/resolve
  sph?: number | string;
  cyl?: number | string;
  axis?: number | string;
  add?: number | string;
  side?: 'NONE' | 'R' | 'L' | 'BE';
  quantity: number; // In pairs
  rate?: number; // Defaults to line rate if omitted
}

export interface PurchaseLineInput {
  uniqueItemId: string;
  quantity: number; // In pairs
  rate: number;
  discountType?: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue?: number;
  gstRate?: number; // e.g. 5.00
  batches?: PurchaseLineBatchInput[];
}

export interface CreatePurchaseOrderDTO {
  supplierPartyId: string;
  orderDate?: string | Date;
  expectedDeliveryDate?: string | Date;
  orderNumber?: string;
  gstMode?: 'INTRA_STATE' | 'INTER_STATE';
  supplierReference?: string;
  notes?: string;
  source?: 'MANUAL' | 'MAIN_WAREHOUSE' | 'DEALER_ORDER';
  dealerOrderId?: string;
  mainSalesOrderId?: string;
  mainSalesInvoiceId?: string;
  lines: PurchaseLineInput[];
  idempotencyKey?: string;
}

export interface CreatePurchaseInvoiceDTO {
  supplierPartyId: string;
  purchaseOrderId?: string;
  invoiceDate: string | Date;
  invoiceNumber?: string;
  dueDate?: string | Date;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string | Date;
  gstMode?: 'INTRA_STATE' | 'INTER_STATE';
  status?: 'DRAFT' | 'POSTED';
  notes?: string;
  lines: PurchaseLineInput[];
  idempotencyKey?: string;
}

export class PurchaseService {
  /**
   * Generates a sequential, business-scoped purchase invoice number (e.g. PUR-000001)
   */
  static async generateInvoiceNumber(businessId: string, client?: PoolClient, options?: any): Promise<string> {
    return await DocumentSequenceService.getNextVoucherNumber(client || pool, businessId, 'PURCHASE_INVOICE', options);
  }

  /**
   * Looks up an existing optical batch by its permanent barcode
   */
  static async getBarcodeDetailsForPurchase(businessId: string, barcode: string) {
    if (!barcode || barcode.trim().length === 0) {
      throw new Error('Barcode is required for lookup');
    }

    const trimmed = barcode.trim().toUpperCase();

    const [batch] = await db
      .select({
        batch: opticalBatches,
        uniqueItem: uniqueItems,
        category: categories,
      })
      .from(opticalBatches)
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .where(and(eq(opticalBatches.businessId, businessId), eq(opticalBatches.barcode, trimmed)))
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
      category: batch.category,
      stock: stock || { physicalStock: '0.00', reservedStock: '0.00', availableStock: '0.00' },
    };
  }

  /**
   * Creates a new DRAFT Purchase Invoice with lines and batch allocations.
   * DRAFT does NOT affect physical stock or stock ledger.
   */
  static async createPurchaseInvoice(
    businessId: string,
    data: CreatePurchaseInvoiceDTO,
    userId?: string
  ) {
    if (!businessId) throw new Error('Business ID is strictly required');
    if (!data.supplierPartyId) throw new Error('Supplier party ID is required');
    if (!data.lines || data.lines.length === 0) throw new Error('At least one purchase line is required');

    if (data.idempotencyKey) {
      const existingId = await DocumentSequenceService.checkIdempotency(pool, businessId, 'PURCHASE_INVOICE', data.idempotencyKey);
      if (existingId) {
        return await this.getPurchaseInvoiceById(businessId, existingId);
      }
    }

    // 1. Verify supplier party
    const [supplier] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.id, data.supplierPartyId)))
      .limit(1);

    if (!supplier) {
      throw new Error('Selected supplier does not exist in this business');
    }

    if (supplier.partyType === 'CUSTOMER') {
      throw new Error('Selected party is a CUSTOMER. Only parties of type SUPPLIER or BOTH can be used for purchase.');
    }

    const invoiceDate = new Date(data.invoiceDate || new Date());
    const creditDaysSnapshot = parseInt(String((supplier as any)?.creditDays || (supplier as any)?.credit_days || 0), 10) || 0;
    const dueDate = data.dueDate
      ? new Date(data.dueDate)
      : new Date(invoiceDate.getTime() + creditDaysSnapshot * 24 * 60 * 60 * 1000);

    const supplierInvoiceDate = data.supplierInvoiceDate ? new Date(data.supplierInvoiceDate) : null;
    const gstMode = data.gstMode || 'INTRA_STATE';

    // 2. Validate Unique Items and calculate line values
    const processedLines = [];
    const calculatedLineTaxResults = [];

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      if (!line.uniqueItemId) throw new Error(`Line ${i + 1}: Unique Item ID is missing`);

      const [uItem] = await db
        .select({
          uniqueItem: uniqueItems,
          primaryItem: primaryItems,
          category: categories,
        })
        .from(uniqueItems)
        .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
        .leftJoin(categories, eq(primaryItems.categoryId, categories.id))
        .where(and(eq(uniqueItems.businessId, businessId), eq(uniqueItems.id, line.uniqueItemId)))
        .limit(1);

      if (!uItem) {
        throw new Error(`Line ${i + 1}: Unique Item not found in this business`);
      }

      const itemUnit = uItem.uniqueItem.unit || 'PRS';
      const qty = assertValidQuantity(line.quantity, itemUnit, { fieldName: `Line ${i + 1} quantity` });
      const rate = round2(line.rate);
      if (rate < 0) throw new Error(`Line ${i + 1}: Rate cannot be negative`);

      const itemGst = uItem.uniqueItem.gstRate ? parseFloat(uItem.uniqueItem.gstRate) : 5.00;
      const taxRes = calculateLineTax({
        quantity: qty,
        rate,
        discountType: line.discountType,
        discountValue: line.discountValue,
        gstRate: line.gstRate !== undefined ? line.gstRate : itemGst,
      });

      calculatedLineTaxResults.push(taxRes);

      // Validate and pre-resolve batches if provided (or auto-resolve default batch for zero-power)
      const resolvedBatches = [];
      const batches = line.batches || [];
      if (batches.length > 0) {
        let totalBatchQty = 0;
        for (const b of batches) {
          const bQty = assertValidQuantity(b.quantity, itemUnit, { fieldName: `Line ${i + 1} batch allocation quantity` });
          totalBatchQty = round2(totalBatchQty + bQty);

          let batchId = b.batchId;
          if (!batchId) {
            const resolved = await findOrCreateOpticalBatch({
              businessId,
              uniqueItemId: line.uniqueItemId,
              sph: b.sph ?? 0,
              cyl: b.cyl ?? 0,
              axis: b.axis ?? 0,
              add: b.add ?? 0,
              side: b.side ?? 'NONE',
              userId,
            });
            batchId = resolved.batch.id;
          }

          const batchRate = b.rate !== undefined ? round2(b.rate) : taxRes.rate;
          const totalCost = round2(bQty * batchRate);

          resolvedBatches.push({
            batchId,
            quantity: bQty,
            rate: batchRate,
            totalCost,
          });
        }

        if (Math.abs(totalBatchQty - qty) > 0.001) {
          throw new Error(
            `Line ${i + 1}: Sum of batch quantities (${totalBatchQty} prs) must equal line quantity (${qty} prs)`
          );
        }
      } else if (uItem.uniqueItem.maintainBatches) {
        // Auto-allocate default (0.00 power) batch for line quantity
        const defaultBatch = await findOrCreateOpticalBatch({
          businessId,
          uniqueItemId: line.uniqueItemId,
          sph: 0,
          cyl: 0,
          axis: 0,
          add: 0,
          side: 'NONE',
          userId,
        });

        resolvedBatches.push({
          batchId: defaultBatch.batch.id,
          quantity: qty,
          rate: taxRes.rate,
          totalCost: round2(qty * taxRes.rate),
        });
      } else {
        // Maintain batches is false: item has no batch allocations
      }

      processedLines.push({
        uniqueItemId: line.uniqueItemId,
        taxRes,
        resolvedBatches,
        categoryCode: uItem.category?.code || uItem.uniqueItem?.opticalCategory || '',
      });
    }

    // 3. Compute invoice totals
    const totals = calculateInvoiceTotals({
      lines: calculatedLineTaxResults,
      gstMode,
    });

    // 4. Insert into database inside transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invoiceNumber =
        data.invoiceNumber ||
        (await DocumentSequenceService.getNextVoucherNumber(client, businessId, 'PURCHASE_INVOICE', {
          voucherDate: invoiceDate,
        }));

      const invRes = await client.query(
        `INSERT INTO purchase_invoices (
          business_id, supplier_party_id, purchase_order_id, invoice_number, invoice_date,
          due_date, credit_days_snapshot,
          supplier_invoice_number, supplier_invoice_date, gst_mode,
          subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, payment_status, status, notes,
          created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7,
          $8, $9, $10,
          $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, 'UNPAID', 'DRAFT', $22,
          $23, $23
        ) RETURNING *`,
        [
          businessId,
          data.supplierPartyId,
          data.purchaseOrderId || null,
          invoiceNumber,
          invoiceDate.toISOString(),
          dueDate.toISOString(),
          creditDaysSnapshot,
          data.supplierInvoiceNumber || null,
          supplierInvoiceDate ? supplierInvoiceDate.toISOString() : null,
          gstMode,
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
        ]
      );

      const invoice = invRes.rows[0];

      if (data.idempotencyKey) {
        await DocumentSequenceService.recordIdempotency(
          client,
          businessId,
          'PURCHASE_INVOICE',
          data.idempotencyKey,
          invoice.id
        );
      }

      // Insert lines
      for (const pLine of processedLines) {
        const lineRes = await client.query(
          `INSERT INTO purchase_invoice_lines (
            purchase_invoice_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *`,
          [
            invoice.id,
            pLine.uniqueItemId,
            pLine.taxRes.quantity.toFixed(2),
            pLine.taxRes.rate.toFixed(2),
            pLine.taxRes.discountType,
            pLine.taxRes.discountValue.toFixed(2),
            pLine.taxRes.discountAmount.toFixed(2),
            pLine.taxRes.taxableAmount.toFixed(2),
            pLine.taxRes.gstRate.toFixed(2),
            pLine.taxRes.taxAmount.toFixed(2),
            pLine.taxRes.lineTotal.toFixed(2),
          ]
        );

        const createdLine = lineRes.rows[0];

        // Process batch allocations
        for (const b of pLine.resolvedBatches) {
          await client.query(
            `INSERT INTO purchase_invoice_line_batches (
              purchase_invoice_line_id, batch_id, quantity, rate, total_cost
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              createdLine.id,
              b.batchId,
              b.quantity.toFixed(2),
              b.rate.toFixed(2),
              b.totalCost.toFixed(2),
            ]
          );
        }
      }

      // If linked to a purchase order, validate and update its status
      if (data.purchaseOrderId) {
        // Lock the purchase order FOR UPDATE to prevent concurrent race conditions
        const poRes = await client.query(
          `SELECT * FROM purchase_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [data.purchaseOrderId, businessId]
        );
        if (poRes.rows.length === 0) {
          throw new Error(`Linked purchase order ${data.purchaseOrderId} not found in this business`);
        }
        const poRow = poRes.rows[0];

        if (poRow.status === 'CONVERTED') {
          throw new Error(`Cannot convert Purchase Order ${poRow.order_number}: already fully converted`);
        }
        if (poRow.status === 'CANCELLED') {
          throw new Error(`Cannot convert cancelled Purchase Order ${poRow.order_number}`);
        }
        if (poRow.source === 'DEALER_ORDER' || poRow.dealer_order_id) {
          throw new Error(
            `Dealer-linked purchase orders must be processed via the Dealer GRN lifecycle and cannot be directly converted to a Purchase Invoice.`
          );
        }

        // Calculate total ordered quantity on the Purchase Order
        const poLinesRes = await client.query(
          `SELECT COALESCE(SUM(quantity), 0) as total_ordered FROM purchase_order_lines WHERE purchase_order_id = $1`,
          [data.purchaseOrderId]
        );
        const totalOrdered = parseFloat(poLinesRes.rows[0]?.total_ordered || '0');

        // Calculate total invoiced quantity against this PO across all active purchase invoices (including this new one)
        const piLinesRes = await client.query(
          `SELECT COALESCE(SUM(pil.quantity), 0) as total_invoiced
           FROM purchase_invoice_lines pil
           JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
           WHERE pi.purchase_order_id = $1 AND pi.status != 'CANCELLED'`,
          [data.purchaseOrderId]
        );
        const totalInvoiced = parseFloat(piLinesRes.rows[0]?.total_invoiced || '0');

        if (totalInvoiced > totalOrdered + 0.001) {
          throw new Error(
            `Over-conversion detected: Total invoiced quantity (${totalInvoiced.toFixed(2)}) would exceed ordered quantity (${totalOrdered.toFixed(2)}) for Purchase Order ${poRow.order_number}`
          );
        }

        const poStatus = (totalOrdered > 0 && totalInvoiced >= (totalOrdered - 0.001))
          ? 'CONVERTED'
          : 'PARTIALLY_CONVERTED';

        await client.query(
          `UPDATE purchase_orders 
           SET status = $1, converted_invoice_id = $2, updated_at = NOW(), updated_by = $3 
           WHERE id = $4 AND business_id = $5`,
          [poStatus, invoice.id, userId || null, data.purchaseOrderId, businessId]
        );
      }

      // If immediate posting requested (e.g. during conversion)
      if (data.status === 'POSTED') {
        await this._postPurchaseInvoiceInternal(client, businessId, invoice.id, userId);
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'create',
        entityType: 'purchase_invoice',
        entityId: invoice.id,
        newValue: {
          invoiceNumber: invoice.invoice_number,
          supplierPartyId: invoice.supplier_party_id,
          grandTotal: invoice.grand_total,
          status: 'POSTED',
        },
      });

      return await this.getPurchaseInvoiceById(businessId, invoice.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Updates an existing Purchase Invoice (DRAFT, POSTED, or CANCELLED)
   */
  static async updatePurchaseInvoice(
    businessId: string,
    invoiceId: string,
    data: CreatePurchaseInvoiceDTO & { status?: string },
    userId?: string
  ) {
    if (!businessId || !invoiceId || !isValidUUID(invoiceId)) {
      throw new Error(`Invalid Purchase Invoice ID: ${invoiceId}`);
    }
    if (!data.supplierPartyId) throw new Error('Supplier party ID is required');
    if (!data.lines || data.lines.length === 0) throw new Error('At least one purchase line is required');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invRes = await client.query(
        `SELECT * FROM purchase_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, invoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
      }

      const existingInv = invRes.rows[0];

      if (existingInv.status === 'CANCELLED') {
        throw new Error(`Cannot edit Purchase Invoice ${existingInv.invoice_number} because it has been CANCELLED. Cancelled invoices are permanently read-only.`);
      }

      // Check active returns
      const activeReturnsRes = await client.query(
        `SELECT id, return_number, status FROM purchase_returns 
         WHERE business_id = $1 AND purchase_invoice_id = $2 AND status != 'CANCELLED' 
         LIMIT 1`,
        [businessId, invoiceId]
      );
      if (activeReturnsRes.rows.length > 0) {
        throw new Error(
          `Cannot modify Purchase Invoice ${existingInv.invoice_number} because active Purchase Return ${activeReturnsRes.rows[0].return_number} exists against it. Please delete or cancel the return first.`
        );
      }

      // If existing invoice was POSTED, reverse its stock and ledger effects first
      if (existingInv.status === 'POSTED') {
        const oldAllocRes = await client.query(
          `SELECT pilb.batch_id, pilb.quantity 
           FROM purchase_invoice_lines pil
           JOIN purchase_invoice_line_batches pilb ON pil.id = pilb.purchase_invoice_line_id
           WHERE pil.purchase_invoice_id = $1`,
          [invoiceId]
        );

        for (const alloc of oldAllocRes.rows) {
          const qty = parseFloat(alloc.quantity);
          const stockRes = await client.query(
            `SELECT id, physical_stock, reserved_stock, available_stock 
             FROM optical_stocks 
             WHERE business_id = $1 AND batch_id = $2 
             FOR UPDATE`,
            [businessId, alloc.batch_id]
          );

          if (stockRes.rows.length > 0) {
            const stockRow = stockRes.rows[0];
            const newPhysical = round2(parseFloat(stockRow.physical_stock) - qty);
            const newAvailable = round2(newPhysical - parseFloat(stockRow.reserved_stock));

            await client.query(
              `UPDATE optical_stocks 
               SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
               WHERE id = $3`,
              [newPhysical.toFixed(2), newAvailable.toFixed(2), stockRow.id]
            );
          }
        }

        await client.query(
          `DELETE FROM stock_ledger WHERE business_id = $1 AND reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL') AND reference_id = $2`,
          [businessId, invoiceId]
        );

        await client.query(
          `DELETE FROM supplier_ledgers WHERE business_id = $1 AND reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL') AND reference_id = $2`,
          [businessId, invoiceId]
        );

        await client.query(
          `DELETE FROM purchase_lots WHERE business_id = $1 AND purchase_invoice_id = $2`,
          [businessId, invoiceId]
        );
      }

      // 1. Verify supplier
      const [supplier] = await db
        .select()
        .from(parties)
        .where(and(eq(parties.businessId, businessId), eq(parties.id, data.supplierPartyId)))
        .limit(1);

      if (!supplier) {
        throw new Error('Selected supplier does not exist in this business');
      }

      const invoiceDate = new Date(data.invoiceDate || existingInv.invoice_date);
      const supplierInvoiceDate = data.supplierInvoiceDate ? new Date(data.supplierInvoiceDate) : null;
      const gstMode = data.gstMode || existingInv.gst_mode || 'INTRA_STATE';
      const targetStatus = 'POSTED'; // Invoices are always real posted transactions

      // Process new lines
      const processedLines = [];
      const calculatedLineTaxResults = [];

      for (let i = 0; i < data.lines.length; i++) {
        const line = data.lines[i];
        if (!line.uniqueItemId) throw new Error(`Line ${i + 1}: Unique Item ID is missing`);

        const [uItem] = await db
          .select({
            uniqueItem: uniqueItems,
            primaryItem: primaryItems,
            category: categories,
          })
          .from(uniqueItems)
          .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
          .leftJoin(categories, eq(primaryItems.categoryId, categories.id))
          .where(and(eq(uniqueItems.businessId, businessId), eq(uniqueItems.id, line.uniqueItemId)))
          .limit(1);

        if (!uItem) {
          throw new Error(`Line ${i + 1}: Unique Item not found in this business`);
        }

        const qty = Number(line.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`Line ${i + 1}: Quantity must be greater than zero`);
        }
        if (Math.abs(Math.round(qty * 2) - qty * 2) > 0.0001) {
          throw new Error(`Line ${i + 1}: Quantity must be a positive value in steps of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0)`);
        }

        const rate = Number(line.rate);
        if (isNaN(rate) || rate < 0) {
          throw new Error(`Line ${i + 1}: Purchase rate must be non-negative`);
        }

        const itemGst = uItem.uniqueItem.gstRate ? parseFloat(uItem.uniqueItem.gstRate) : 5.00;
        const taxRes = calculateLineTax({
          quantity: qty,
          rate,
          discountType: line.discountType || 'NONE',
          discountValue: Number(line.discountValue || 0),
          gstRate: Number(line.gstRate !== undefined ? line.gstRate : itemGst),
        });

        calculatedLineTaxResults.push(taxRes);

        const resolvedBatches = [];
        if (line.batches && line.batches.length > 0) {
          let batchSum = 0;
          for (let bIdx = 0; bIdx < line.batches.length; bIdx++) {
            const b = line.batches[bIdx];
            const bQty = Number(b.quantity);
            if (isNaN(bQty) || bQty <= 0) {
              throw new Error(`Line ${i + 1}, Batch ${bIdx + 1}: Quantity must be greater than zero`);
            }
            if (Math.abs(Math.round(bQty * 2) - bQty * 2) > 0.0001) {
              throw new Error(`Line ${i + 1}, Batch ${bIdx + 1}: Quantity must be a positive value in steps of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0)`);
            }
            batchSum += bQty;

            let resolvedBatchId = b.batchId;
            if (!resolvedBatchId) {
              const res = await findOrCreateOpticalBatch({
                businessId,
                uniqueItemId: line.uniqueItemId,
                sph: Number(b.sph || 0),
                cyl: Number(b.cyl || 0),
                axis: Number(b.axis || 0),
                add: Number(b.add || 0),
                side: b.side || 'NONE',
                userId,
              });
              resolvedBatchId = res.batch.id;
            }

            const bRate = b.rate !== undefined ? Number(b.rate) : taxRes.rate;
            resolvedBatches.push({
              batchId: resolvedBatchId,
              quantity: bQty,
              rate: bRate,
              totalCost: round2(bQty * bRate),
            });
          }

          if (Math.abs(batchSum - qty) > 0.001) {
            throw new Error(
              `Line ${i + 1} (${uItem.uniqueItem.name}): Sum of batch quantities (${batchSum}) must equal line quantity (${qty})`
            );
          }
        } else if (uItem.uniqueItem.maintainBatches) {
          const defaultBatch = await findOrCreateOpticalBatch({
            businessId,
            uniqueItemId: line.uniqueItemId,
            sph: 0,
            cyl: 0,
            axis: 0,
            add: 0,
            side: 'NONE',
            userId,
          });

          resolvedBatches.push({
            batchId: defaultBatch.batch.id,
            quantity: qty,
            rate: taxRes.rate,
            totalCost: round2(qty * taxRes.rate),
          });
        } else {
          // Maintain batches is false
        }

        processedLines.push({
          uniqueItemId: line.uniqueItemId,
          taxRes,
          resolvedBatches,
          categoryCode: uItem.category?.code || uItem.uniqueItem?.opticalCategory || '',
        });
      }

      const totals = calculateInvoiceTotals({
        lines: calculatedLineTaxResults,
        gstMode,
      });

      // Delete old line batches & invoice lines
      await client.query(
        `DELETE FROM purchase_invoice_line_batches WHERE purchase_invoice_line_id IN (
           SELECT id FROM purchase_invoice_lines WHERE purchase_invoice_id = $1
         )`,
        [invoiceId]
      );
      await client.query(
        `DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id = $1`,
        [invoiceId]
      );

      // Update invoice header
      await client.query(
        `UPDATE purchase_invoices SET
          supplier_party_id = $1,
          invoice_date = $2,
          supplier_invoice_number = $3,
          supplier_invoice_date = $4,
          gst_mode = $5,
          subtotal = $6,
          discount_total = $7,
          taxable_amount = $8,
          igst_rate = $9,
          igst_amount = $10,
          cgst_rate = $11,
          cgst_amount = $12,
          sgst_rate = $13,
          sgst_amount = $14,
          round_off = $15,
          grand_total = $16,
          status = $17,
          notes = $18,
          updated_by = $19,
          updated_at = NOW()
        WHERE business_id = $20 AND id = $21`,
        [
          data.supplierPartyId,
          invoiceDate.toISOString(),
          data.supplierInvoiceNumber || null,
          supplierInvoiceDate ? supplierInvoiceDate.toISOString() : null,
          gstMode,
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
          targetStatus,
          data.notes || null,
          userId || null,
          businessId,
          invoiceId,
        ]
      );

      // Insert new lines and batches
      for (const pLine of processedLines) {
        const lineRes = await client.query(
          `INSERT INTO purchase_invoice_lines (
            purchase_invoice_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *`,
          [
            invoiceId,
            pLine.uniqueItemId,
            pLine.taxRes.quantity.toFixed(2),
            pLine.taxRes.rate.toFixed(2),
            pLine.taxRes.discountType,
            pLine.taxRes.discountValue.toFixed(2),
            pLine.taxRes.discountAmount.toFixed(2),
            pLine.taxRes.taxableAmount.toFixed(2),
            pLine.taxRes.gstRate.toFixed(2),
            pLine.taxRes.taxAmount.toFixed(2),
            pLine.taxRes.lineTotal.toFixed(2),
          ]
        );

        const createdLine = lineRes.rows[0];

        for (const b of pLine.resolvedBatches) {
          await client.query(
            `INSERT INTO purchase_invoice_line_batches (
              purchase_invoice_line_id, batch_id, quantity, rate, total_cost
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              createdLine.id,
              b.batchId,
              b.quantity.toFixed(2),
              b.rate.toFixed(2),
              b.totalCost.toFixed(2),
            ]
          );
        }
      }

      // If target status is POSTED, re-apply stock, lots, and ledger
      if (targetStatus === 'POSTED') {
        const grandTotalNum = parseFloat(totals.grandTotal.toFixed(2));

        for (const pLine of processedLines) {
          for (const b of pLine.resolvedBatches) {
            const batchId = b.batchId;
            const qtyNum = b.quantity;

            // Optical stock update
            const stockRes = await client.query(
              `SELECT * FROM optical_stocks WHERE business_id = $1 AND batch_id = $2 FOR UPDATE`,
              [businessId, batchId]
            );

            let newPhysical = qtyNum;
            let newAvailable = qtyNum;

            if (stockRes.rows.length > 0) {
              const curStock = stockRes.rows[0];
              newPhysical = round2(parseFloat(curStock.physical_stock) + qtyNum);
              newAvailable = round2(newPhysical - parseFloat(curStock.reserved_stock));

              await client.query(
                `UPDATE optical_stocks 
                 SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
                 WHERE id = $3`,
                [newPhysical.toFixed(2), newAvailable.toFixed(2), curStock.id]
              );
            } else {
              await client.query(
                `INSERT INTO optical_stocks (
                  business_id, batch_id, physical_stock, reserved_stock, available_stock
                ) VALUES ($1, $2, $3, '0.00', $3)`,
                [businessId, batchId, qtyNum.toFixed(2)]
              );
            }

            // Stock ledger
            await client.query(
              `INSERT INTO stock_ledger (
                business_id, batch_id, transaction_type, reference_type, reference_id,
                quantity, unit_cost, balance_after, created_by
              ) VALUES ($1, $2, 'INWARD', 'PURCHASE_INVOICE', $3, $4, $5, $6, $7)`,
              [
                businessId,
                batchId,
                invoiceId,
                qtyNum.toFixed(2),
                b.rate.toFixed(2),
                newPhysical.toFixed(2),
                userId || null,
              ]
            );

            // Purchase lot
            await client.query(
              `INSERT INTO purchase_lots (
                business_id, purchase_invoice_id, batch_id,
                received_quantity, available_quantity, unit_cost, received_date
              ) VALUES ($1, $2, $3, $4, $4, $5, $6)`,
              [
                businessId,
                invoiceId,
                batchId,
                qtyNum.toFixed(2),
                b.rate.toFixed(2),
                invoiceDate.toISOString(),
              ]
            );
          }

          // Update unique item last purchase price
          await client.query(
            `UPDATE unique_items 
             SET purchase_price = $1, updated_at = NOW() 
             WHERE id = $2 AND business_id = $3`,
            [pLine.taxRes.rate.toFixed(2), pLine.uniqueItemId, businessId]
          );
        }

        // Supplier ledger running balance
        const lastLedgerRes = await client.query(
          `SELECT balance FROM supplier_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY transaction_date DESC, created_at DESC 
           LIMIT 1`,
          [businessId, data.supplierPartyId]
        );

        const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
        const newBalance = round2(prevBalance + grandTotalNum);

        await client.query(
          `INSERT INTO supplier_ledgers (
            business_id, party_id, transaction_type, transaction_date, reference_type, reference_id,
            credit, debit, balance, notes, created_by
          ) VALUES ($1, $2, 'PURCHASE', $3, 'PURCHASE_INVOICE', $4, $5, '0.00', $6, $7, $8)`,
          [
            businessId,
            data.supplierPartyId,
            invoiceDate.toISOString(),
            invoiceId,
            grandTotalNum.toFixed(2),
            newBalance.toFixed(2),
            `Purchase Invoice #${existingInv.invoice_number}`,
            userId || null,
          ]
        );
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'UPDATE_PURCHASE_INVOICE',
        entityType: 'purchase_invoice',
        entityId: invoiceId,
        newValue: {
          invoiceNumber: existingInv.invoice_number,
          supplierPartyId: data.supplierPartyId,
          grandTotal: totals.grandTotal,
          status: targetStatus,
        },
      });

      return await this.getPurchaseInvoiceById(businessId, invoiceId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves single Purchase Invoice with full supplier, lines, and batch details
   */
  static async getPurchaseInvoiceById(businessId: string, invoiceId: string) {
    if (!businessId || !invoiceId || !isValidUUID(invoiceId)) {
      throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
    }

    const [inv] = await db
      .select({
        invoice: purchaseInvoices,
        supplier: parties,
      })
      .from(purchaseInvoices)
      .innerJoin(parties, eq(purchaseInvoices.supplierPartyId, parties.id))
      .where(and(eq(purchaseInvoices.businessId, businessId), eq(purchaseInvoices.id, invoiceId)))
      .limit(1);

    if (!inv) {
      throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
    }

    // Fetch lines
    const lines = await db
      .select({
        line: purchaseInvoiceLines,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
      })
      .from(purchaseInvoiceLines)
      .innerJoin(uniqueItems, eq(purchaseInvoiceLines.uniqueItemId, uniqueItems.id))
      .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .leftJoin(categories, eq(primaryItems.categoryId, categories.id))
      .where(eq(purchaseInvoiceLines.purchaseInvoiceId, invoiceId));

    // Fetch batch allocations for each line
    const enrichedLines = [];
    for (const l of lines) {
      const lineBatches = await db
        .select({
          allocation: purchaseInvoiceLineBatches,
          batch: opticalBatches,
        })
        .from(purchaseInvoiceLineBatches)
        .innerJoin(opticalBatches, eq(purchaseInvoiceLineBatches.batchId, opticalBatches.id))
        .where(eq(purchaseInvoiceLineBatches.purchaseInvoiceLineId, l.line.id));

      enrichedLines.push({
        ...l.line,
        uniqueItem: l.uniqueItem,
        primaryItem: l.primaryItem || null,
        category: l.category || null,
        batches: lineBatches.map(b => ({
          ...b.allocation,
          batch: b.batch,
        })),
      });
    }

    // Fetch active payment allocations
    const allocsRes = await pool.query(
      `SELECT pa.*, p.payment_number, p.payment_date, p.payment_mode, p.status as payment_status_master
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.business_id = $1 AND pa.document_type = 'PURCHASE_INVOICE' AND pa.document_id = $2 AND pa.status = 'ACTIVE' AND p.status = 'POSTED'`,
      [businessId, invoiceId]
    );

    const paidAmount = allocsRes.rows.reduce((sum, r) => sum + parseFloat(r.allocated_amount), 0);
    const grandTotal = parseFloat(inv.invoice.grandTotal);
    const outstandingAmount = Math.max(0, grandTotal - paidAmount);

    return {
      ...inv.invoice,
      supplier: inv.supplier,
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
      lines: enrichedLines,
    };
  }

  /**
   * Lists Purchase Invoices with filters and pagination
   */
  static async getPurchaseInvoices(
    businessId: string,
    filters: {
      supplierPartyId?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const limit = Math.min(filters.limit || 50, 200);
    const offset = filters.offset || 0;

    let conditions = [eq(purchaseInvoices.businessId, businessId)];

    if (filters.supplierPartyId) {
      conditions.push(eq(purchaseInvoices.supplierPartyId, filters.supplierPartyId));
    }

    if (filters.status) {
      conditions.push(eq(purchaseInvoices.status, filters.status));
    }

    if (filters.search) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(purchaseInvoices.invoiceNumber, term),
          ilike(purchaseInvoices.supplierInvoiceNumber, term)
        )!
      );
    }

    const rows = await db
      .select({
        invoice: purchaseInvoices,
        supplier: parties,
      })
      .from(purchaseInvoices)
      .innerJoin(parties, eq(purchaseInvoices.supplierPartyId, parties.id))
      .where(and(...conditions))
      .orderBy(desc(purchaseInvoices.invoiceDate), desc(purchaseInvoices.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalCount] = await db
      .select({ count: count() })
      .from(purchaseInvoices)
      .where(and(...conditions));

    return {
      invoices: rows.map(r => ({ ...r.invoice, supplier: r.supplier })),
      total: totalCount.count,
      limit,
      offset,
    };
  }

  /**
   * Internal helper to atomically post a purchase invoice:
   * 1. Updates inventory physical & available stock
   * 2. Writes stock ledger entries
   * 3. Creates purchase lots
   * 4. Updates unique items last purchase price
   * 5. Appends to supplier ledger
   * 6. Marks invoice POSTED
   */
  private static async _postPurchaseInvoiceInternal(
    client: PoolClient,
    businessId: string,
    invoiceId: string,
    userId?: string
  ) {
    const invRes = await client.query(
      `SELECT * FROM purchase_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
      [businessId, invoiceId]
    );

    if (invRes.rows.length === 0) {
      throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
    }

    const inv = invRes.rows[0];

    if (inv.status === 'CANCELLED') {
      throw new Error('Cancelled Purchase Invoice cannot be posted');
    }

    if (inv.status === 'POSTED') {
      throw new Error('Purchase Invoice is already posted');
    }

    // Fetch lines & allocations
    const linesRes = await client.query(
      `SELECT * FROM purchase_invoice_lines WHERE purchase_invoice_id = $1`,
      [invoiceId]
    );

    if (linesRes.rows.length === 0) {
      throw new Error('Cannot post a purchase invoice with zero lines');
    }

    const grandTotalNum = parseFloat(inv.grand_total);

    for (const line of linesRes.rows) {
      const lineBatchesRes = await client.query(
        `SELECT * FROM purchase_invoice_line_batches WHERE purchase_invoice_line_id = $1`,
        [line.id]
      );

      let allocations = lineBatchesRes.rows;

      // If no explicit batch allocations were created, locate or insert default batch
      if (allocations.length === 0) {
        let batchRow = (
          await client.query(
            `SELECT * FROM optical_batches WHERE business_id = $1 AND unique_item_id = $2 AND identity_key = 'SV:SPH=0.00:CYL=0.00' LIMIT 1`,
            [businessId, line.unique_item_id]
          )
        ).rows[0];

        if (!batchRow) {
          const catRow = (
            await client.query(
              `SELECT pi.category_id FROM unique_items ui 
               INNER JOIN primary_items pi ON ui.primary_item_id = pi.id 
               WHERE ui.id = $1`,
              [line.unique_item_id]
            )
          ).rows[0];

          const barcode = `OPT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

          const insBatch = await client.query(
            `INSERT INTO optical_batches (
              business_id, unique_item_id, category_id, barcode, sph, cyl, axis, "add", side, identity_key, created_by
            ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 'NONE', 'SV:SPH=0.00:CYL=0.00', $5)
            RETURNING *`,
            [businessId, line.unique_item_id, catRow ? catRow.category_id : null, barcode, userId || null]
          );
          batchRow = insBatch.rows[0];
        }

        const allocRes = await client.query(
          `INSERT INTO purchase_invoice_line_batches (
            purchase_invoice_line_id, batch_id, quantity, rate, total_cost
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *`,
          [
            line.id,
            batchRow.id,
            line.quantity,
            line.rate,
            line.line_total,
          ]
        );
        allocations = [allocRes.rows[0]];
      }

      // Apply each batch allocation
      for (const alloc of allocations) {
        const qty = parseFloat(alloc.quantity);
        const rate = parseFloat(alloc.rate);

        // Lock stock row FOR UPDATE (or initialize if missing)
        let stockRow = (
          await client.query(
            `SELECT * FROM optical_stocks WHERE business_id = $1 AND batch_id = $2 FOR UPDATE`,
            [businessId, alloc.batch_id]
          )
        ).rows[0];

        if (!stockRow) {
          const insStock = await client.query(
            `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock)
             VALUES ($1, $2, '0.00', '0.00', '0.00')
             RETURNING *`,
            [businessId, alloc.batch_id]
          );
          stockRow = insStock.rows[0];
        }

        const currentPhysical = parseFloat(stockRow.physical_stock);
        const currentReserved = parseFloat(stockRow.reserved_stock);
        const newPhysical = round2(currentPhysical + qty);
        const newAvailable = round2(newPhysical - currentReserved);

        // Update stock balance
        await client.query(
          `UPDATE optical_stocks 
           SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newPhysical.toFixed(2), newAvailable.toFixed(2), stockRow.id]
        );

        // Write stock ledger entry
        await client.query(
          `INSERT INTO stock_ledger (
            business_id, batch_id, transaction_type, reference_type, reference_id,
            quantity_in, quantity_out, reserved_in, reserved_out, balance,
            reason, created_by, created_at
          ) VALUES ($1, $2, 'PURCHASE', 'PURCHASE_INVOICE', $3, $4, '0.00', '0.00', '0.00', $5, $6, $7, NOW())`,
          [
            businessId,
            alloc.batch_id,
            inv.id,
            qty.toFixed(2),
            newPhysical.toFixed(2),
            `Purchase Invoice ${inv.invoice_number}`,
            userId || null,
          ]
        );

        // Create PurchaseLot entry for historical pricing preservation
        await client.query(
          `INSERT INTO purchase_lots (
            business_id, purchase_invoice_id, purchase_invoice_line_id,
            batch_id, unique_item_id, quantity_received, rate, tax_rate,
            received_at, remaining_quantity, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            businessId,
            inv.id,
            line.id,
            alloc.batch_id,
            line.unique_item_id,
            qty.toFixed(2),
            rate.toFixed(2),
            line.gst_rate || '0.00',
            inv.invoice_date,
            qty.toFixed(2),
          ]
        );
      }

      // Update Unique Item last purchase price
      await client.query(
        `UPDATE unique_items 
         SET last_purchase_price = $1, updated_at = NOW(), updated_by = $2 
         WHERE id = $3`,
        [line.rate, userId || null, line.unique_item_id]
      );
    }

    // Update Supplier Ledger
    const lastLedgerRes = await client.query(
      `SELECT balance FROM supplier_ledgers 
       WHERE business_id = $1 AND party_id = $2 
       ORDER BY transaction_date DESC, created_at DESC 
       LIMIT 1 FOR UPDATE`,
      [businessId, inv.supplier_party_id]
    );

    const previousBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
    const newSupplierBalance = round2(previousBalance + grandTotalNum);

    await client.query(
      `INSERT INTO supplier_ledgers (
        business_id, party_id, transaction_type, reference_type, reference_id,
        debit, credit, balance, transaction_date, notes, created_by, created_at
      ) VALUES ($1, $2, 'PURCHASE', 'PURCHASE_INVOICE', $3, '0.00', $4, $5, $6, $7, $8, NOW())`,
      [
        businessId,
        inv.supplier_party_id,
        inv.id,
        grandTotalNum.toFixed(2),
        newSupplierBalance.toFixed(2),
        inv.invoice_date,
        `Purchase Bill ${inv.invoice_number}`,
        userId || null,
      ]
    );

    // Update invoice status to POSTED
    await client.query(
      `UPDATE purchase_invoices 
       SET status = 'POSTED', payment_status = 'UNPAID', updated_at = NOW(), updated_by = $1 
       WHERE id = $2`,
      [userId || null, inv.id]
    );
  }

  /**
   * Finalizes and posts a Purchase Invoice to physical stock and supplier ledger.
   * If any step fails, entire operation rolls back.
   */
  static async postPurchaseInvoice(businessId: string, invoiceId: string, userId?: string) {
    if (!businessId || !invoiceId || !isValidUUID(invoiceId)) {
      throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this._postPurchaseInvoiceInternal(client, businessId, invoiceId, userId);
      await client.query('COMMIT');

      const inv = await this.getPurchaseInvoiceById(businessId, invoiceId);
      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'post',
        entityType: 'purchase_invoice',
        entityId: invoiceId,
        newValue: {
          status: 'POSTED',
          invoiceNumber: (inv as any).invoiceNumber || (inv as any).invoice?.invoiceNumber,
          grandTotal: (inv as any).grandTotal || (inv as any).invoice?.grandTotal,
        },
      });

      return inv;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomic Cancellation of a POSTED Purchase Invoice:
   * 1. Reverses physical stock movements (permits negative stock)
   * 2. Writes CANCELLATION_REVERSAL entries to stock ledger
   * 3. Writes CANCELLATION_REVERSAL entry to supplier ledger
   * 4. Marks invoice CANCELLED
   */
  static async cancelPurchaseInvoice(
    businessId: string,
    invoiceId: string,
    reason?: string,
    userId?: string
  ) {
    if (!businessId || !invoiceId || !isValidUUID(invoiceId)) {
      throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invRes = await client.query(
        `SELECT * FROM purchase_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, invoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
      }

      const inv = invRes.rows[0];

      if (inv.status !== 'POSTED') {
        throw new Error(`Only POSTED purchase invoices can be cancelled. Current status is ${inv.status}`);
      }

      // Check if any active purchase returns exist for this invoice
      const activeReturnsRes = await client.query(
        `SELECT id, return_number, status FROM purchase_returns 
         WHERE business_id = $1 AND purchase_invoice_id = $2 AND status != 'CANCELLED'
         LIMIT 1`,
        [businessId, invoiceId]
      );
      if (activeReturnsRes.rows.length > 0) {
        throw new Error(
          `Cannot cancel Purchase Invoice: active Purchase Return ${activeReturnsRes.rows[0].return_number} (${activeReturnsRes.rows[0].status}) exists against this invoice. Cancel or resolve returns first.`
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
          `Cannot cancel Purchase Invoice: active payment allocation (${activeAllocRes.rows[0].payment_number}) of ₹${parseFloat(activeAllocRes.rows[0].allocated_amount).toFixed(2)} is applied. Please cancel or reallocate the payment first.`
        );
      }

      const grandTotalNum = parseFloat(inv.grand_total);

      // Fetch all batch allocations belonging to this invoice
      const allocationsRes = await client.query(
        `SELECT b.* 
         FROM purchase_invoice_line_batches b
         INNER JOIN purchase_invoice_lines l ON b.purchase_invoice_line_id = l.id
         WHERE l.purchase_invoice_id = $1`,
        [invoiceId]
      );

      // Reverse stock for each batch allocation
      for (const alloc of allocationsRes.rows) {
        const qty = parseFloat(alloc.quantity);

        const stockRes = await client.query(
          `SELECT * FROM optical_stocks WHERE business_id = $1 AND batch_id = $2 FOR UPDATE`,
          [businessId, alloc.batch_id]
        );

        if (stockRes.rows.length > 0) {
          const stockRow = stockRes.rows[0];
          const currentPhysical = parseFloat(stockRow.physical_stock);
          const currentReserved = parseFloat(stockRow.reserved_stock);

          // Negative stock permitted by domain architecture
          const newPhysical = round2(currentPhysical - qty);
          const newAvailable = round2(newPhysical - currentReserved);

          await client.query(
            `UPDATE optical_stocks 
             SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
             WHERE id = $3`,
            [newPhysical.toFixed(2), newAvailable.toFixed(2), stockRow.id]
          );

          await client.query(
            `INSERT INTO stock_ledger (
              business_id, batch_id, transaction_type, reference_type, reference_id,
              quantity_in, quantity_out, reserved_in, reserved_out, balance,
              reason, created_by, created_at
            ) VALUES ($1, $2, 'CANCELLATION_REVERSAL', 'PURCHASE_INVOICE_CANCEL', $3, '0.00', $4, '0.00', '0.00', $5, $6, $7, NOW())`,
            [
              businessId,
              alloc.batch_id,
              inv.id,
              qty.toFixed(2),
              newPhysical.toFixed(2),
              `Cancellation reversal of Purchase Invoice ${inv.invoice_number}`,
              userId || null,
            ]
          );
        }
      }

      // Reverse supplier ledger
      const lastLedgerRes = await client.query(
        `SELECT balance FROM supplier_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY transaction_date DESC, created_at DESC 
         LIMIT 1 FOR UPDATE`,
        [businessId, inv.supplier_party_id]
      );

      const previousBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
      const newSupplierBalance = round2(previousBalance - grandTotalNum);

      await client.query(
        `INSERT INTO supplier_ledgers (
          business_id, party_id, transaction_type, reference_type, reference_id,
          debit, credit, balance, transaction_date, notes, created_by, created_at
        ) VALUES ($1, $2, 'CANCELLATION_REVERSAL', 'PURCHASE_INVOICE_CANCEL', $3, $4, '0.00', $5, NOW(), $6, $7, NOW())`,
        [
          businessId,
          inv.supplier_party_id,
          inv.id,
          grandTotalNum.toFixed(2),
          newSupplierBalance.toFixed(2),
          `Cancellation reversal of Purchase Invoice ${inv.invoice_number}. Reason: ${reason || 'Cancelled'}`,
          userId || null,
        ]
      );

      // Update invoice status
      await client.query(
        `UPDATE purchase_invoices 
         SET status = 'CANCELLED', notes = COALESCE(notes || E'\\n', '') || $1, updated_at = NOW(), updated_by = $2 
         WHERE id = $3`,
        [`[CANCELLED: ${reason || 'User cancelled'}]`, userId || null, inv.id]
      );

      // If linked to a purchase order, recalculate PO status
      if (inv.purchase_order_id) {
        const poLinesRes = await client.query(
          `SELECT COALESCE(SUM(quantity), 0) as total_ordered FROM purchase_order_lines WHERE purchase_order_id = $1`,
          [inv.purchase_order_id]
        );
        const totalOrdered = parseFloat(poLinesRes.rows[0]?.total_ordered || '0');

        const piLinesRes = await client.query(
          `SELECT COALESCE(SUM(pil.quantity), 0) as total_invoiced
           FROM purchase_invoice_lines pil
           JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
           WHERE pi.purchase_order_id = $1 AND pi.status != 'CANCELLED' AND pi.id != $2`,
          [inv.purchase_order_id, inv.id]
        );
        const totalInvoiced = parseFloat(piLinesRes.rows[0]?.total_invoiced || '0');

        const poStatus = (totalOrdered > 0 && totalInvoiced >= (totalOrdered - 0.001))
          ? 'CONVERTED'
          : totalInvoiced > 0
          ? 'PARTIALLY_CONVERTED'
          : 'OPEN';

        await client.query(
          `UPDATE purchase_orders 
           SET status = $1, updated_at = NOW(), updated_by = $2 
           WHERE id = $3 AND business_id = $4`,
          [poStatus, userId || null, inv.purchase_order_id, businessId]
        );
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'cancel',
        entityType: 'purchase_invoice',
        entityId: inv.id,
        newValue: {
          status: 'CANCELLED',
          reason,
        },
      });

      return await this.getPurchaseInvoiceById(businessId, inv.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Deletes a purchase invoice (DRAFT, CANCELLED, or POSTED) with full atomic reversal
   */
  static async deletePurchaseInvoice(businessId: string, invoiceId: string, userId?: string) {
    if (!businessId || !invoiceId || !isValidUUID(invoiceId)) {
      throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invRes = await client.query(
        `SELECT * FROM purchase_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, invoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
      }

      const inv = invRes.rows[0];

      // Check active purchase returns
      const activeReturnsRes = await client.query(
        `SELECT id, return_number, status FROM purchase_returns 
         WHERE business_id = $1 AND purchase_invoice_id = $2 AND status != 'CANCELLED'
         LIMIT 1`,
        [businessId, invoiceId]
      );
      if (activeReturnsRes.rows.length > 0) {
        throw new Error(
          `Cannot delete Purchase Invoice ${inv.invoice_number}: active Purchase Return ${activeReturnsRes.rows[0].return_number} (${activeReturnsRes.rows[0].status}) exists against it. Please delete or cancel the purchase return first.`
        );
      }

      // If POSTED, reverse stock additions and supplier ledger entries
      if (inv.status === 'POSTED') {
        const batchAllocRes = await client.query(
          `SELECT pilb.batch_id, pilb.quantity 
           FROM purchase_invoice_lines pil
           JOIN purchase_invoice_line_batches pilb ON pil.id = pilb.purchase_invoice_line_id
           WHERE pil.purchase_invoice_id = $1`,
          [invoiceId]
        );

        for (const alloc of batchAllocRes.rows) {
          const qty = parseFloat(alloc.quantity);
          const stockRes = await client.query(
            `SELECT id, physical_stock, reserved_stock, available_stock 
             FROM optical_stocks 
             WHERE business_id = $1 AND batch_id = $2 
             FOR UPDATE`,
            [businessId, alloc.batch_id]
          );

          if (stockRes.rows.length > 0) {
            const stockRow = stockRes.rows[0];
            const newPhysical = round2(parseFloat(stockRow.physical_stock) - qty);
            const newAvailable = round2(newPhysical - parseFloat(stockRow.reserved_stock));

            await client.query(
              `UPDATE optical_stocks 
               SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
               WHERE id = $3`,
              [newPhysical.toFixed(2), newAvailable.toFixed(2), stockRow.id]
            );
          }
        }

        // Delete stock ledger entries for this invoice
        await client.query(
          `DELETE FROM stock_ledger WHERE business_id = $1 AND reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL') AND reference_id = $2`,
          [businessId, invoiceId]
        );

        // Delete supplier ledger entries for this invoice
        await client.query(
          `DELETE FROM supplier_ledgers WHERE business_id = $1 AND reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL') AND reference_id = $2`,
          [businessId, invoiceId]
        );
      } else if (inv.status === 'CANCELLED') {
        // For already cancelled invoices, stock was already reversed during cancellation.
        // Clean up any remaining ledger references for this invoice.
        await client.query(
          `DELETE FROM stock_ledger WHERE business_id = $1 AND reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL') AND reference_id = $2`,
          [businessId, invoiceId]
        );

        await client.query(
          `DELETE FROM supplier_ledgers WHERE business_id = $1 AND reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL') AND reference_id = $2`,
          [businessId, invoiceId]
        );
      }

      // Delete payment allocations
      await client.query(
        `DELETE FROM payment_allocations WHERE business_id = $1 AND document_id = $2`,
        [businessId, invoiceId]
      );

      // Delete purchase lots
      await client.query(
        `DELETE FROM purchase_lots WHERE business_id = $1 AND purchase_invoice_id = $2`,
        [businessId, invoiceId]
      );

      // Delete line batches
      await client.query(
        `DELETE FROM purchase_invoice_line_batches 
         WHERE purchase_invoice_line_id IN (
           SELECT id FROM purchase_invoice_lines WHERE purchase_invoice_id = $1
         )`,
        [invoiceId]
      );

      // Delete invoice lines
      await client.query(
        `DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id = $1`,
        [invoiceId]
      );

      // Delete purchase invoice
      await client.query(
        `DELETE FROM purchase_invoices WHERE business_id = $1 AND id = $2`,
        [businessId, invoiceId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'DELETE_PURCHASE_INVOICE',
        entityType: 'purchase_invoice',
        entityId: invoiceId,
        previousValue: { invoiceNumber: inv.invoice_number, grandTotal: inv.grand_total, status: inv.status },
      });

      return { success: true, message: `Purchase invoice ${inv.invoice_number} deleted successfully` };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Deletes only DRAFT purchase invoices
   */
  static async deleteDraftPurchaseInvoice(businessId: string, invoiceId: string, userId?: string) {
    const inv = await this.getPurchaseInvoiceById(businessId, invoiceId);
    if (!inv) throw new Error(`Purchase invoice ${invoiceId} not found`);
    if (inv.status !== 'DRAFT') {
      throw new Error('Only DRAFT purchase invoices can be deleted using this method.');
    }
    return this.deletePurchaseInvoice(businessId, invoiceId, userId);
  }

  /**
   * Retrieves purchase lots with associated batch, unique item, invoice, and supplier details
   */
  static async getPurchaseLots(
    businessId: string,
    filters: {
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const limit = Math.min(filters.limit || 50, 200);
    const offset = filters.offset || 0;

    let conditions = [eq(purchaseLots.businessId, businessId)];

    if (filters.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(uniqueItems.name, term),
          ilike(uniqueItems.code, term),
          ilike(opticalBatches.barcode, term),
          ilike(purchaseInvoices.invoiceNumber, term),
          ilike(parties.name, term)
        )!
      );
    }

    const rows = await db
      .select({
        lot: purchaseLots,
        uniqueItem: uniqueItems,
        batch: opticalBatches,
        invoice: purchaseInvoices,
        supplier: parties,
      })
      .from(purchaseLots)
      .innerJoin(uniqueItems, eq(purchaseLots.uniqueItemId, uniqueItems.id))
      .innerJoin(opticalBatches, eq(purchaseLots.batchId, opticalBatches.id))
      .innerJoin(purchaseInvoices, eq(purchaseLots.purchaseInvoiceId, purchaseInvoices.id))
      .innerJoin(parties, eq(purchaseInvoices.supplierPartyId, parties.id))
      .where(and(...conditions))
      .orderBy(desc(purchaseLots.receivedAt), desc(purchaseLots.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalCount] = await db
      .select({ count: count() })
      .from(purchaseLots)
      .innerJoin(uniqueItems, eq(purchaseLots.uniqueItemId, uniqueItems.id))
      .innerJoin(opticalBatches, eq(purchaseLots.batchId, opticalBatches.id))
      .innerJoin(purchaseInvoices, eq(purchaseLots.purchaseInvoiceId, purchaseInvoices.id))
      .innerJoin(parties, eq(purchaseInvoices.supplierPartyId, parties.id))
      .where(and(...conditions));

    return {
      lots: rows.map(r => ({
        ...r.lot,
        uniqueItem: r.uniqueItem,
        batch: r.batch,
        invoice: {
          id: r.invoice.id,
          invoiceNumber: r.invoice.invoiceNumber,
          supplierInvoiceNumber: r.invoice.supplierInvoiceNumber || undefined,
          invoiceDate: r.invoice.invoiceDate ? r.invoice.invoiceDate.toISOString() : '',
          supplier: {
            id: r.supplier.id,
            name: r.supplier.name,
            partyCode: r.supplier.partyCode,
          },
        },
      })),
      total: Number(totalCount?.count || 0),
      limit,
      offset,
    };
  }

  /**
   * Generates a sequential, business-scoped purchase order number (e.g. PO-000001)
   */
  static async generatePurchaseOrderNumber(businessId: string, client?: PoolClient, options?: any): Promise<string> {
    return await DocumentSequenceService.getNextVoucherNumber(client || pool, businessId, 'PURCHASE_ORDER', options);
  }

  /**
   * Creates a new OPEN Purchase Order.
   * Does NOT alter physical stock or ledger balances.
   */
  static async createPurchaseOrder(
    businessId: string,
    data: CreatePurchaseOrderDTO,
    userId?: string
  ) {
    if (!businessId) throw new Error('Business ID is strictly required');
    if (!data.supplierPartyId) throw new Error('Supplier party ID is required');
    if (!data.lines || data.lines.length === 0) throw new Error('At least one order line is required');

    if (data.idempotencyKey) {
      const existingId = await DocumentSequenceService.checkIdempotency(pool, businessId, 'PURCHASE_ORDER', data.idempotencyKey);
      if (existingId) {
        return await this.getPurchaseOrderById(businessId, existingId);
      }
    }

    const [supplier] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.id, data.supplierPartyId)))
      .limit(1);

    if (!supplier) {
      throw new Error('Selected supplier does not exist in this business');
    }

    const orderDate = new Date(data.orderDate || new Date());
    const expectedDeliveryDate = data.expectedDeliveryDate ? new Date(data.expectedDeliveryDate) : null;
    const gstMode = data.gstMode || 'INTRA_STATE';

    const processedLines = [];
    const calculatedLineTaxResults = [];

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      if (!line.uniqueItemId) throw new Error(`Line ${i + 1}: Unique Item ID is missing`);

      const [uItem] = await db
        .select({
          uniqueItem: uniqueItems,
          primaryItem: primaryItems,
          category: categories,
        })
        .from(uniqueItems)
        .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
        .leftJoin(categories, eq(primaryItems.categoryId, categories.id))
        .where(and(eq(uniqueItems.businessId, businessId), eq(uniqueItems.id, line.uniqueItemId)))
        .limit(1);

      if (!uItem) {
        throw new Error(`Line ${i + 1}: Unique Item not found in this business`);
      }

      const itemUnit = uItem.uniqueItem.unit || 'PRS';
      const qty = assertValidQuantity(line.quantity, itemUnit, { fieldName: `Line ${i + 1} quantity` });

      const rate = Number(line.rate);
      if (isNaN(rate) || rate < 0) {
        throw new Error(`Line ${i + 1}: Rate must be non-negative`);
      }

      const effectiveGstRate =
        line.gstRate !== undefined
          ? Number(line.gstRate)
          : Number(uItem.uniqueItem?.gstRate ?? 12.0);

      const taxRes = calculateLineTax({
        quantity: qty,
        rate,
        discountType: line.discountType || 'NONE',
        discountValue: Number(line.discountValue || 0),
        gstRate: effectiveGstRate,
      });

      calculatedLineTaxResults.push(taxRes);

      const resolvedBatches = [];
      const batches = line.batches || [];
      if (batches.length > 0) {
        let totalBatchQty = 0;
        for (const b of batches) {
          const bQty = assertValidQuantity(b.quantity, itemUnit, { fieldName: `Line ${i + 1} batch allocation quantity` });
          totalBatchQty = round2(totalBatchQty + bQty);

          let batchId = b.batchId;
          if (!batchId) {
            const resolved = await findOrCreateOpticalBatch({
              businessId,
              uniqueItemId: line.uniqueItemId,
              sph: b.sph ?? 0,
              cyl: b.cyl ?? 0,
              axis: b.axis ?? 0,
              add: b.add ?? 0,
              side: b.side ?? 'NONE',
              userId,
            });
            batchId = resolved.batch.id;
          }

          const batchRate = b.rate !== undefined ? round2(b.rate) : taxRes.rate;
          resolvedBatches.push({
            batchId,
            quantity: bQty,
            rate: batchRate,
            totalCost: round2(bQty * batchRate),
          });
        }

        if (Math.abs(totalBatchQty - qty) > 0.001) {
          throw new Error(
            `Line ${i + 1}: Sum of batch quantities (${totalBatchQty}) must equal line quantity (${qty})`
          );
        }
      }

      processedLines.push({
        uniqueItemId: line.uniqueItemId,
        taxRes,
        resolvedBatches,
      });
    }

    const totals = calculateInvoiceTotals({
      lines: calculatedLineTaxResults,
      gstMode,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderNumber =
        data.orderNumber ||
        (await DocumentSequenceService.getNextVoucherNumber(client, businessId, 'PURCHASE_ORDER', {
          voucherDate: orderDate,
        }));

      const poRes = await client.query(
        `INSERT INTO purchase_orders (
          business_id, supplier_party_id, order_number, order_date,
          expected_delivery_date, gst_mode, subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, source, supplier_reference, notes,
          dealer_order_id, main_sales_order_id, main_sales_invoice_id,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'OPEN', $18, $19, $20, $21, $22, $23, $24, $24)
        RETURNING *`,
        [
          businessId,
          data.supplierPartyId,
          orderNumber,
          orderDate.toISOString(),
          expectedDeliveryDate ? expectedDeliveryDate.toISOString() : null,
          gstMode,
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
          data.source || 'MANUAL',
          data.supplierReference || null,
          data.notes || null,
          data.dealerOrderId || null,
          data.mainSalesOrderId || null,
          data.mainSalesInvoiceId || null,
          userId || null,
        ]
      );

      const order = poRes.rows[0];

      for (const pLine of processedLines) {
        const lineRes = await client.query(
          `INSERT INTO purchase_order_lines (
            purchase_order_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *`,
          [
            order.id,
            pLine.uniqueItemId,
            pLine.taxRes.quantity.toFixed(2),
            pLine.taxRes.rate.toFixed(2),
            pLine.taxRes.discountType,
            pLine.taxRes.discountValue.toFixed(2),
            pLine.taxRes.discountAmount.toFixed(2),
            pLine.taxRes.taxableAmount.toFixed(2),
            pLine.taxRes.gstRate.toFixed(2),
            pLine.taxRes.taxAmount.toFixed(2),
            pLine.taxRes.lineTotal.toFixed(2),
          ]
        );

        const createdLine = lineRes.rows[0];

        for (const b of pLine.resolvedBatches) {
          await client.query(
            `INSERT INTO purchase_order_line_batches (
              purchase_order_line_id, batch_id, quantity, rate, total_cost
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              createdLine.id,
              b.batchId,
              b.quantity.toFixed(2),
              b.rate.toFixed(2),
              b.totalCost.toFixed(2),
            ]
          );
        }
      }

      if (data.idempotencyKey) {
        await DocumentSequenceService.recordIdempotency(
          client,
          businessId,
          'PURCHASE_ORDER',
          data.idempotencyKey,
          order.id
        );
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase_order',
        action: 'create',
        entityType: 'purchase_order',
        entityId: order.id,
        newValue: {
          orderNumber: order.order_number,
          supplierPartyId: order.supplier_party_id,
          grandTotal: order.grand_total,
          status: 'OPEN',
        },
      });

      return await this.getPurchaseOrderById(businessId, order.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves paginated Purchase Orders with supplier party details
   */
  static async getPurchaseOrders(
    businessId: string,
    options?: {
      supplierPartyId?: string;
      status?: string;
      source?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const conditions = [eq(purchaseOrders.businessId, businessId)];

    if (options?.supplierPartyId && isValidUUID(options.supplierPartyId)) {
      conditions.push(eq(purchaseOrders.supplierPartyId, options.supplierPartyId));
    }
    if (options?.status) {
      conditions.push(eq(purchaseOrders.status, options.status as any));
    }
    if (options?.source) {
      conditions.push(eq(purchaseOrders.source, options.source));
    }
    if (options?.search && options.search.trim() !== '') {
      const term = `%${options.search.trim()}%`;
      conditions.push(
        or(
          ilike(purchaseOrders.orderNumber, term),
          ilike(purchaseOrders.supplierReference, term),
          ilike(parties.name, term)
        )!
      );
    }

    const rows = await db
      .select({
        order: purchaseOrders,
        supplier: {
          id: parties.id,
          name: parties.name,
          partyCode: parties.partyCode,
          phone: parties.mobile,
          gstin: parties.gstin,
        },
      })
      .from(purchaseOrders)
      .innerJoin(parties, eq(purchaseOrders.supplierPartyId, parties.id))
      .where(and(...conditions))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalCount] = await db
      .select({ count: count() })
      .from(purchaseOrders)
      .innerJoin(parties, eq(purchaseOrders.supplierPartyId, parties.id))
      .where(and(...conditions));

    return {
      orders: rows.map(r => ({ ...r.order, supplier: r.supplier })),
      total: Number(totalCount?.count || 0),
      limit,
      offset,
    };
  }

  /**
   * Retrieves a single Purchase Order with lines, batches, and supplier
   */
  static async getPurchaseOrderById(businessId: string, orderId: string) {
    if (!businessId || !orderId || !isValidUUID(orderId)) {
      throw new Error(`Purchase order not found with ID ${orderId}`);
    }

    const [orderRow] = await db
      .select({
        order: purchaseOrders,
        supplier: {
          id: parties.id,
          name: parties.name,
          partyCode: parties.partyCode,
          phone: parties.mobile,
          email: parties.email,
          gstin: parties.gstin,
          addressLine1: parties.addressLine1,
          city: parties.city,
          state: parties.state,
          pincode: parties.pincode,
        },
      })
      .from(purchaseOrders)
      .innerJoin(parties, eq(purchaseOrders.supplierPartyId, parties.id))
      .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.id, orderId)))
      .limit(1);

    if (!orderRow) {
      throw new Error(`Purchase order not found with ID ${orderId}`);
    }

    const lines = await db
      .select({
        line: purchaseOrderLines,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
      })
      .from(purchaseOrderLines)
      .innerJoin(uniqueItems, eq(purchaseOrderLines.uniqueItemId, uniqueItems.id))
      .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .leftJoin(categories, eq(primaryItems.categoryId, categories.id))
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));

    // Query invoiced quantity by item and by batch from active linked purchase invoices
    const invoicedLinesRes = await pool.query(
      `SELECT pil.unique_item_id, COALESCE(SUM(pil.quantity), 0) as total_invoiced
       FROM purchase_invoice_lines pil
       JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
       WHERE pi.business_id = $1 AND pi.purchase_order_id = $2 AND pi.status != 'CANCELLED'
       GROUP BY pil.unique_item_id`,
      [businessId, orderId]
    );
    const invoicedQtyByItem = new Map<string, number>();
    for (const r of invoicedLinesRes.rows) {
      invoicedQtyByItem.set(r.unique_item_id, parseFloat(r.total_invoiced || '0'));
    }

    const invoicedBatchesRes = await pool.query(
      `SELECT pilb.batch_id, COALESCE(SUM(pilb.quantity), 0) as total_invoiced
       FROM purchase_invoice_line_batches pilb
       JOIN purchase_invoice_lines pil ON pilb.purchase_invoice_line_id = pil.id
       JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
       WHERE pi.business_id = $1 AND pi.purchase_order_id = $2 AND pi.status != 'CANCELLED'
       GROUP BY pilb.batch_id`,
      [businessId, orderId]
    );
    const invoicedQtyByBatch = new Map<string, number>();
    for (const r of invoicedBatchesRes.rows) {
      invoicedQtyByBatch.set(r.batch_id, parseFloat(r.total_invoiced || '0'));
    }

    const populatedLines = await Promise.all(
      lines.map(async l => {
        const batchAllocations = await db
          .select({
            batchAlloc: purchaseOrderLineBatches,
            batch: opticalBatches,
          })
          .from(purchaseOrderLineBatches)
          .innerJoin(opticalBatches, eq(purchaseOrderLineBatches.batchId, opticalBatches.id))
          .where(eq(purchaseOrderLineBatches.purchaseOrderLineId, l.line.id));

        const lineQty = parseFloat(l.line.quantity);
        const invQty = invoicedQtyByItem.get(l.line.uniqueItemId) || 0;
        const remQty = Math.max(0, round2(lineQty - invQty));

        return {
          ...l.line,
          uniqueItem: l.uniqueItem,
          primaryItem: l.primaryItem,
          category: l.category,
          invoicedQuantity: invQty,
          remainingQuantity: remQty,
          batches: batchAllocations.map(ba => {
            const bQty = parseFloat(ba.batchAlloc.quantity);
            const invBQty = invoicedQtyByBatch.get(ba.batch.id) || 0;
            const remBQty = Math.max(0, round2(bQty - invBQty));
            return {
              ...ba.batchAlloc,
              batch: ba.batch,
              invoicedQuantity: invBQty,
              remainingQuantity: remBQty,
            };
          }),
        };
      })
    );

    // Query linked Purchase Invoices
    const linkedInvoicesRes = await pool.query(
      `SELECT id, invoice_number, invoice_date, status, taxable_amount, grand_total, created_at
       FROM purchase_invoices
       WHERE business_id = $1 AND purchase_order_id = $2
       ORDER BY invoice_date DESC, created_at DESC`,
      [businessId, orderId]
    );

    // Query linked shipments (via dealer_purchase_order_id OR dealer_order_id)
    const linkedShipmentsRes = await pool.query(
      `SELECT id, shipment_number, dispatch_date, status, courier_name, tracking_number,
              vehicle_number, total_packages, total_quantity, created_at
       FROM dealer_shipments
       WHERE dealer_business_id = $1 AND (dealer_purchase_order_id = $2 OR (dealer_order_id IS NOT NULL AND dealer_order_id = $3))
       ORDER BY dispatch_date DESC, created_at DESC`,
      [businessId, orderId, (orderRow.order as any).dealerOrderId || null]
    );

    // Query linked goods receipts
    const linkedGrnsRes = await pool.query(
      `SELECT id, receipt_number, receipt_date, status, total_received_qty, total_damaged_qty, total_short_qty, created_at
       FROM dealer_goods_receipts
       WHERE dealer_business_id = $1 AND (dealer_purchase_order_id = $2 OR dealer_shipment_id IN (
         SELECT id FROM dealer_shipments WHERE dealer_business_id = $1 AND (dealer_purchase_order_id = $2 OR (dealer_order_id IS NOT NULL AND dealer_order_id = $3))
       ))
       ORDER BY receipt_date DESC, created_at DESC`,
      [businessId, orderId, (orderRow.order as any).dealerOrderId || null]
    );

    // Calculate aggregated fulfilment quantities
    const orderedQty = round2(populatedLines.reduce((acc, l) => acc + parseFloat((l as any).quantity || '0'), 0));
    
    // Invoiced quantity from active linked purchase invoices
    const invoicedQtyRes = await pool.query(
      `SELECT COALESCE(SUM(pil.quantity), 0) as total_invoiced
       FROM purchase_invoice_lines pil
       JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
       WHERE pi.business_id = $1 AND pi.purchase_order_id = $2 AND pi.status != 'CANCELLED'`,
      [businessId, orderId]
    );
    const invoicedQty = round2(parseFloat(invoicedQtyRes.rows[0]?.total_invoiced || '0'));

    // Dispatched quantity from non-cancelled shipments
    const dispatchedQty = round2(linkedShipmentsRes.rows
      .filter((s: any) => s.status !== 'CANCELLED')
      .reduce((acc: number, s: any) => acc + parseFloat(s.total_quantity || '0'), 0)
    );

    // Received, Damaged, Short from non-cancelled GRNs
    const receivedQty = round2(linkedGrnsRes.rows
      .filter((g: any) => g.status !== 'CANCELLED')
      .reduce((acc: number, g: any) => acc + parseFloat(g.total_received_qty || '0'), 0)
    );
    const damagedQty = round2(linkedGrnsRes.rows
      .filter((g: any) => g.status !== 'CANCELLED')
      .reduce((acc: number, g: any) => acc + parseFloat(g.total_damaged_qty || '0'), 0)
    );
    const shortQty = round2(linkedGrnsRes.rows
      .filter((g: any) => g.status !== 'CANCELLED')
      .reduce((acc: number, g: any) => acc + parseFloat(g.total_short_qty || '0'), 0)
    );

    const pendingDispatchQty = round2(Math.max(0, orderedQty - dispatchedQty));
    const pendingReceiptQty = round2(Math.max(0, dispatchedQty - (receivedQty + damagedQty + shortQty)));
    const pendingInvoiceQty = round2(Math.max(0, orderedQty - invoicedQty));

    const fulfilmentStats = {
      orderedQty,
      dispatchedQty,
      receivedQty,
      damagedQty,
      shortQty,
      invoicedQty,
      pendingDispatchQty,
      pendingReceiptQty,
      pendingInvoiceQty,
    };

    return {
      ...orderRow.order,
      order: orderRow.order,
      supplier: orderRow.supplier,
      lines: populatedLines,
      linkedInvoices: linkedInvoicesRes.rows,
      linkedShipments: linkedShipmentsRes.rows,
      linkedGoodsReceipts: linkedGrnsRes.rows,
      fulfilmentStats,
    };
  }

  /**
   * Updates an OPEN Purchase Order
   */
  static async updatePurchaseOrder(
    businessId: string,
    orderId: string,
    data: CreatePurchaseOrderDTO,
    userId?: string
  ) {
    if (!businessId || !orderId || !isValidUUID(orderId)) {
      throw new Error(`Invalid Purchase Order ID: ${orderId}`);
    }

    const [existingOrder] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.id, orderId)))
      .limit(1);

    if (!existingOrder) {
      throw new Error(`Purchase Order ${orderId} not found`);
    }

    if (existingOrder.status !== 'OPEN') {
      throw new Error(`Cannot edit purchase order ${existingOrder.orderNumber} because it is in status ${existingOrder.status}.`);
    }

    if (existingOrder.source === 'DEALER_ORDER' || (existingOrder as any).dealerOrderId) {
      throw new Error('Dealer-linked purchase orders cannot be modified directly.');
    }

    const orderDate = new Date(data.orderDate || existingOrder.orderDate);
    const expectedDeliveryDate = data.expectedDeliveryDate ? new Date(data.expectedDeliveryDate) : null;
    const gstMode = data.gstMode || existingOrder.gstMode;

    const processedLines = [];
    const calculatedLineTaxResults = [];

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      if (!line.uniqueItemId) throw new Error(`Line ${i + 1}: Unique Item ID is missing`);

      const [uItem] = await db
        .select({
          uniqueItem: uniqueItems,
          primaryItem: primaryItems,
          category: categories,
        })
        .from(uniqueItems)
        .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
        .leftJoin(categories, eq(primaryItems.categoryId, categories.id))
        .where(and(eq(uniqueItems.businessId, businessId), eq(uniqueItems.id, line.uniqueItemId)))
        .limit(1);

      if (!uItem) throw new Error(`Line ${i + 1}: Unique Item not found`);

      const itemUnit = uItem.uniqueItem.unit || 'PRS';
      const qty = assertValidQuantity(line.quantity, itemUnit, { fieldName: `Line ${i + 1} quantity` });
      const rate = Number(line.rate);
      if (isNaN(rate) || rate < 0) {
        throw new Error(`Line ${i + 1}: Rate must be non-negative`);
      }
      const effectiveGstRate =
        line.gstRate !== undefined
          ? Number(line.gstRate)
          : Number(uItem.uniqueItem?.gstRate ?? 12.0);

      const taxRes = calculateLineTax({
        quantity: qty,
        rate,
        discountType: line.discountType || 'NONE',
        discountValue: Number(line.discountValue || 0),
        gstRate: effectiveGstRate,
      });

      calculatedLineTaxResults.push(taxRes);

      const resolvedBatches = [];
      const batches = line.batches || [];
      for (const b of batches) {
        const bQty = assertValidQuantity(b.quantity, itemUnit, { fieldName: `Line ${i + 1} batch allocation quantity` });
        let batchId = b.batchId;
        if (!batchId) {
          const res = await findOrCreateOpticalBatch({
            businessId,
            uniqueItemId: line.uniqueItemId,
            sph: Number(b.sph || 0),
            cyl: Number(b.cyl || 0),
            axis: Number(b.axis || 0),
            add: Number(b.add || 0),
            side: b.side || 'NONE',
            userId,
          });
          batchId = res.batch.id;
        }
        resolvedBatches.push({
          batchId,
          quantity: bQty,
          rate: b.rate !== undefined ? b.rate : taxRes.rate,
          totalCost: round2(bQty * (b.rate !== undefined ? b.rate : taxRes.rate)),
        });
      }

      processedLines.push({
        uniqueItemId: line.uniqueItemId,
        taxRes,
        resolvedBatches,
      });
    }

    const totals = calculateInvoiceTotals({
      lines: calculatedLineTaxResults,
      gstMode: (gstMode as 'INTRA_STATE' | 'INTER_STATE') || 'INTRA_STATE',
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing lines & batches
      const oldLines = await client.query(
        `SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`,
        [orderId]
      );
      for (const ol of oldLines.rows) {
        await client.query(
          `DELETE FROM purchase_order_line_batches WHERE purchase_order_line_id = $1`,
          [ol.id]
        );
      }
      await client.query(
        `DELETE FROM purchase_order_lines WHERE purchase_order_id = $1`,
        [orderId]
      );

      // Update order header
      await client.query(
        `UPDATE purchase_orders
         SET supplier_party_id = $1, order_date = $2, expected_delivery_date = $3,
             gst_mode = $4, subtotal = $5, discount_total = $6, taxable_amount = $7,
             igst_rate = $8, igst_amount = $9, cgst_rate = $10, cgst_amount = $11,
             sgst_rate = $12, sgst_amount = $13, round_off = $14, grand_total = $15,
             supplier_reference = $16, notes = $17, updated_by = $18, updated_at = NOW()
         WHERE business_id = $19 AND id = $20`,
        [
          data.supplierPartyId,
          orderDate.toISOString(),
          expectedDeliveryDate ? expectedDeliveryDate.toISOString() : null,
          gstMode,
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
          data.supplierReference || null,
          data.notes || null,
          userId || null,
          businessId,
          orderId,
        ]
      );

      // Insert new lines & batches
      for (const pLine of processedLines) {
        const lineRes = await client.query(
          `INSERT INTO purchase_order_lines (
            purchase_order_id, unique_item_id, quantity, rate,
            discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *`,
          [
            orderId,
            pLine.uniqueItemId,
            pLine.taxRes.quantity.toFixed(2),
            pLine.taxRes.rate.toFixed(2),
            pLine.taxRes.discountType,
            pLine.taxRes.discountValue.toFixed(2),
            pLine.taxRes.discountAmount.toFixed(2),
            pLine.taxRes.taxableAmount.toFixed(2),
            pLine.taxRes.gstRate.toFixed(2),
            pLine.taxRes.taxAmount.toFixed(2),
            pLine.taxRes.lineTotal.toFixed(2),
          ]
        );

        const createdLine = lineRes.rows[0];

        for (const b of pLine.resolvedBatches) {
          await client.query(
            `INSERT INTO purchase_order_line_batches (
              purchase_order_line_id, batch_id, quantity, rate, total_cost
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              createdLine.id,
              b.batchId,
              b.quantity.toFixed(2),
              b.rate.toFixed(2),
              b.totalCost.toFixed(2),
            ]
          );
        }
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase_order',
        action: 'update',
        entityType: 'purchase_order',
        entityId: orderId,
        newValue: {
          grandTotal: totals.grandTotal.toFixed(2),
        },
      });

      return await this.getPurchaseOrderById(businessId, orderId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cancels an OPEN Purchase Order
   */
  static async cancelPurchaseOrder(
    businessId: string,
    orderId: string,
    reason?: string,
    userId?: string
  ) {
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.id, orderId)))
      .limit(1);

    if (!order) {
      throw new Error(`Purchase order ${orderId} not found`);
    }
    if (order.status === 'CONVERTED') {
      throw new Error(`Cannot cancel purchase order ${order.orderNumber} because it is already converted to an invoice`);
    }
    if (order.status === 'CANCELLED') {
      throw new Error(`Purchase order ${order.orderNumber} is already cancelled`);
    }

    await db
      .update(purchaseOrders)
      .set({
        status: 'CANCELLED',
        notes: reason ? `${order.notes || ''} [Cancelled: ${reason}]`.trim() : order.notes,
        updatedBy: userId || null,
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.id, orderId)));

    await AuditService.log({
      businessId,
      userId,
      module: 'purchase_order',
      action: 'cancel',
      entityType: 'purchase_order',
      entityId: orderId,
      newValue: {
        orderNumber: order.orderNumber,
        status: 'CANCELLED',
        reason,
      },
    });

    return await this.getPurchaseOrderById(businessId, orderId);
  }

  /**
   * Converts an OPEN or PARTIALLY_CONVERTED Purchase Order into a fully posted Purchase Invoice
   * Supports partial conversion, over-conversion protection, unit-aware quantity validation,
   * optical batch allocations, dealer-linked PO protection, and row-level locking.
   */
  static async convertPurchaseOrderToInvoice(
    businessId: string,
    orderId: string,
    invoiceOverrides?: Partial<CreatePurchaseInvoiceDTO>,
    userId?: string
  ) {
    if (!businessId || !orderId || !isValidUUID(orderId)) {
      throw new Error(`Invalid Purchase Order ID format: ${orderId}`);
    }

    const client = await pool.connect();
    let order: any;
    let linesToConvert: PurchaseLineInput[] = [];

    try {
      await client.query('BEGIN');

      // 1. Lock the Purchase Order row FOR UPDATE to guard against concurrent conversions
      const poRes = await client.query(
        `SELECT * FROM purchase_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [orderId, businessId]
      );

      if (poRes.rows.length === 0) {
        throw new Error(`Purchase order ${orderId} not found in this business`);
      }
      order = poRes.rows[0];

      if (order.status === 'CONVERTED') {
        throw new Error(`Cannot convert Purchase Order ${order.order_number}: already fully converted`);
      }
      if (order.status === 'CANCELLED') {
        throw new Error(`Cannot convert cancelled Purchase Order ${order.order_number}`);
      }
      if (order.source === 'DEALER_ORDER' || order.dealer_order_id) {
        throw new Error(
          `Dealer-linked purchase orders must be processed via the Dealer GRN lifecycle and cannot be directly converted to a Purchase Invoice.`
        );
      }

      // 2. Query PO lines with item unit details
      const poLinesRes = await client.query(
        `SELECT pol.*, ui.unit, ui.name as item_name, ui.maintain_batches, ui.optical_category
         FROM purchase_order_lines pol
         JOIN unique_items ui ON pol.unique_item_id = ui.id
         WHERE pol.purchase_order_id = $1`,
        [orderId]
      );
      const poLines = poLinesRes.rows;

      // 3. Query PO line batches
      const poBatchesRes = await client.query(
        `SELECT polb.*, ob.sph, ob.cyl, ob.axis, ob.add, ob.side, ob.barcode
         FROM purchase_order_line_batches polb
         JOIN optical_batches ob ON polb.batch_id = ob.id
         WHERE polb.purchase_order_line_id IN (
           SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1
         )`,
        [orderId]
      );
      const poBatches = poBatchesRes.rows;

      const poBatchesByLineId = new Map<string, any[]>();
      for (const b of poBatches) {
        const arr = poBatchesByLineId.get(b.purchase_order_line_id) || [];
        arr.push(b);
        poBatchesByLineId.set(b.purchase_order_line_id, arr);
      }

      // 4. Query active invoiced quantities
      const invoicedLinesRes = await client.query(
        `SELECT pil.unique_item_id, COALESCE(SUM(pil.quantity), 0) as total_invoiced
         FROM purchase_invoice_lines pil
         JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
         WHERE pi.business_id = $1 AND pi.purchase_order_id = $2 AND pi.status != 'CANCELLED'
         GROUP BY pil.unique_item_id`,
        [businessId, orderId]
      );
      const invoicedByItem = new Map<string, number>();
      for (const r of invoicedLinesRes.rows) {
        invoicedByItem.set(r.unique_item_id, parseFloat(r.total_invoiced || '0'));
      }

      const invoicedBatchesRes = await client.query(
        `SELECT pilb.batch_id, COALESCE(SUM(pilb.quantity), 0) as total_invoiced
         FROM purchase_invoice_line_batches pilb
         JOIN purchase_invoice_lines pil ON pilb.purchase_invoice_line_id = pil.id
         JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
         WHERE pi.business_id = $1 AND pi.purchase_order_id = $2 AND pi.status != 'CANCELLED'
         GROUP BY pilb.batch_id`,
        [businessId, orderId]
      );
      const invoicedByBatch = new Map<string, number>();
      for (const r of invoicedBatchesRes.rows) {
        invoicedByBatch.set(r.batch_id, parseFloat(r.total_invoiced || '0'));
      }

      const orderedByItem = new Map<string, number>();
      for (const pol of poLines) {
        const cur = orderedByItem.get(pol.unique_item_id) || 0;
        orderedByItem.set(pol.unique_item_id, cur + parseFloat(pol.quantity));
      }

      const orderedByBatch = new Map<string, number>();
      for (const pob of poBatches) {
        const cur = orderedByBatch.get(pob.batch_id) || 0;
        orderedByBatch.set(pob.batch_id, cur + parseFloat(pob.quantity));
      }

      // 5. Determine lines to convert
      if (invoiceOverrides?.lines && invoiceOverrides.lines.length > 0) {
        // Line overrides supplied (partial conversion)
        for (const line of invoiceOverrides.lines) {
          const poLineMatch = poLines.find(l => l.unique_item_id === line.uniqueItemId);
          if (!poLineMatch) {
            throw new Error(`Item ${line.uniqueItemId} does not exist on Purchase Order ${order.order_number}`);
          }
          const itemUnit = poLineMatch.unit || 'PRS';
          const validLineQty = assertValidQuantity(line.quantity, itemUnit, {
            fieldName: `Item ${poLineMatch.item_name || line.uniqueItemId} quantity`,
          });

          const curInvoiced = invoicedByItem.get(line.uniqueItemId) || 0;
          const totalOrdered = orderedByItem.get(line.uniqueItemId) || 0;
          if (curInvoiced + validLineQty > totalOrdered + 0.001) {
            throw new Error(
              `Cannot convert ${validLineQty} units for item ${poLineMatch.item_name || line.uniqueItemId}. Only ${(totalOrdered - curInvoiced).toFixed(2)} units remain unconverted on Purchase Order ${order.order_number}.`
            );
          }

          const convertedBatches: PurchaseLineBatchInput[] = [];
          if (line.batches && line.batches.length > 0) {
            let sumBatchQty = 0;
            for (const b of line.batches) {
              const validBQty = assertValidQuantity(b.quantity, itemUnit, {
                fieldName: `Batch ${b.batchId || 'item'} quantity`,
              });
              sumBatchQty += validBQty;
              if (b.batchId) {
                const bInvoiced = invoicedByBatch.get(b.batchId) || 0;
                const bOrdered = orderedByBatch.get(b.batchId) || 0;
                if (bOrdered > 0 && bInvoiced + validBQty > bOrdered + 0.001) {
                  throw new Error(
                    `Cannot convert ${validBQty} units for batch ID ${b.batchId}. Only ${(bOrdered - bInvoiced).toFixed(2)} units remain unconverted on Purchase Order.`
                  );
                }
              }
              convertedBatches.push({
                ...b,
                quantity: validBQty,
              });
            }

            if (Math.abs(sumBatchQty - validLineQty) > 0.001) {
              throw new Error(
                `Sum of batch quantities (${sumBatchQty}) must equal line quantity (${validLineQty})`
              );
            }
          }

          linesToConvert.push({
            uniqueItemId: line.uniqueItemId,
            quantity: validLineQty,
            rate: line.rate !== undefined ? line.rate : parseFloat(poLineMatch.rate),
            discountType: line.discountType || poLineMatch.discount_type || 'NONE',
            discountValue: line.discountValue !== undefined ? line.discountValue : parseFloat(poLineMatch.discount_value || '0'),
            gstRate: line.gstRate !== undefined ? line.gstRate : parseFloat(poLineMatch.gst_rate || '0'),
            batches: convertedBatches.length > 0 ? convertedBatches : undefined,
          });
        }
      } else {
        // No line overrides: convert remaining unconverted quantities across the PO
        for (const pol of poLines) {
          const itemUnit = pol.unit || 'PRS';
          const alreadyInvoiced = invoicedByItem.get(pol.unique_item_id) || 0;
          const lineOrdered = parseFloat(pol.quantity);
          const lineRemaining = Math.max(0, round2(lineOrdered - alreadyInvoiced));

          if (lineRemaining <= 0) continue;

          const lineBatches = poBatchesByLineId.get(pol.id) || [];
          const convertedBatches: PurchaseLineBatchInput[] = [];

          if (lineBatches.length > 0) {
            for (const pob of lineBatches) {
              const bAlready = invoicedByBatch.get(pob.batch_id) || 0;
              const bOrdered = parseFloat(pob.quantity);
              const bRemaining = Math.max(0, round2(bOrdered - bAlready));
              if (bRemaining > 0) {
                convertedBatches.push({
                  batchId: pob.batch_id,
                  sph: pob.sph,
                  cyl: pob.cyl,
                  axis: pob.axis,
                  add: pob.add,
                  side: pob.side,
                  quantity: bRemaining,
                  rate: parseFloat(pob.rate || pol.rate),
                });
              }
            }
          }

          const finalLineQty = convertedBatches.length > 0
            ? convertedBatches.reduce((acc, b) => acc + b.quantity, 0)
            : lineRemaining;

          assertValidQuantity(finalLineQty, itemUnit);

          linesToConvert.push({
            uniqueItemId: pol.unique_item_id,
            quantity: finalLineQty,
            rate: parseFloat(pol.rate),
            discountType: pol.discount_type,
            discountValue: parseFloat(pol.discount_value || '0'),
            gstRate: parseFloat(pol.gst_rate || '0'),
            batches: convertedBatches.length > 0 ? convertedBatches : undefined,
          });
        }

        if (linesToConvert.length === 0) {
          throw new Error(`Purchase order ${order.order_number} has already been fully converted`);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 6. Create and atomically post the Purchase Invoice
    const invoicePayload: CreatePurchaseInvoiceDTO = {
      supplierPartyId: order.supplier_party_id,
      purchaseOrderId: order.id,
      invoiceDate: invoiceOverrides?.invoiceDate || new Date(),
      supplierInvoiceNumber: invoiceOverrides?.supplierInvoiceNumber || order.supplier_reference || undefined,
      supplierInvoiceDate: invoiceOverrides?.supplierInvoiceDate,
      gstMode: invoiceOverrides?.gstMode || (order.gst_mode as any),
      notes: invoiceOverrides?.notes || (order.notes ? `Converted from PO #${order.order_number}. ${order.notes}` : `Converted from PO #${order.order_number}`),
      status: 'POSTED',
      lines: linesToConvert,
    };

    const invoice = await this.createPurchaseInvoice(businessId, invoicePayload, userId);

    await AuditService.log({
      businessId,
      userId,
      module: 'purchase',
      action: 'convert_order',
      entityType: 'purchase_order',
      entityId: order.id,
      newValue: {
        orderNumber: order.order_number,
        convertedInvoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      },
    });

    return invoice;
  }
}
