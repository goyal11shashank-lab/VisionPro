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
  lines: PurchaseLineInput[];
}

export interface CreatePurchaseInvoiceDTO {
  supplierPartyId: string;
  purchaseOrderId?: string;
  invoiceDate: string | Date;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string | Date;
  gstMode?: 'INTRA_STATE' | 'INTER_STATE';
  notes?: string;
  lines: PurchaseLineInput[];
}

export class PurchaseService {
  /**
   * Generates a sequential, business-scoped purchase invoice number (e.g. PUR-000001)
   */
  static async generateInvoiceNumber(businessId: string): Promise<string> {
    const prefixConfig = await BusinessSettingsService.getVoucherPrefix(businessId, 'purchaseInvoice').catch(() => ({
      prefix: 'PUR-',
      startNumber: 1,
      method: 'AUTOMATIC',
    }));
    const prefix = prefixConfig.prefix || 'PUR-';
    const startNumber = prefixConfig.startNumber || 1;

    const res = await pool.query(
      `SELECT invoice_number FROM purchase_invoices 
       WHERE business_id = $1 AND invoice_number LIKE $2
       ORDER BY created_at DESC 
       LIMIT 50`,
      [businessId, `${prefix}%`]
    );

    let maxNum = startNumber - 1;
    for (const row of res.rows) {
      const numStr = (row.invoice_number || '').replace(prefix, '');
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    const nextSeq = Math.max(maxNum + 1, startNumber);
    const padded = String(nextSeq).padStart(6, '0');
    return `${prefix}${padded}`;
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
    const supplierInvoiceDate = data.supplierInvoiceDate ? new Date(data.supplierInvoiceDate) : null;
    const gstMode = data.gstMode || 'INTRA_STATE';
    const invoiceNumber = await this.generateInvoiceNumber(businessId);

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

      const qty = round2(line.quantity);
      if (qty <= 0) throw new Error(`Line ${i + 1}: Quantity must be greater than 0`);
      if (Math.abs(Math.round(qty * 2) - qty * 2) > 0.0001) {
        throw new Error(`Line ${i + 1}: Quantity must be a positive value in steps of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0)`);
      }
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
          const bQty = round2(b.quantity);
          if (bQty <= 0) throw new Error(`Line ${i + 1}: Batch allocation quantity must be positive`);
          if (Math.abs(Math.round(bQty * 2) - bQty * 2) > 0.0001) {
            throw new Error(`Line ${i + 1}: Batch allocation quantity must be a positive value in steps of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0)`);
          }
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
        categoryCode: uItem.category.code,
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

      const invRes = await client.query(
        `INSERT INTO purchase_invoices (
          business_id, supplier_party_id, purchase_order_id, invoice_number, invoice_date,
          supplier_invoice_number, supplier_invoice_date, gst_mode,
          subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, payment_status, status, notes,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'UNPAID', 'DRAFT', $20, $21, $21)
        RETURNING *`,
        [
          businessId,
          data.supplierPartyId,
          data.purchaseOrderId || null,
          invoiceNumber,
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
          data.notes || null,
          userId || null,
        ]
      );

      const invoice = invRes.rows[0];

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

      // If linked to a purchase order, mark it as CONVERTED
      if (data.purchaseOrderId) {
        await client.query(
          `UPDATE purchase_orders 
           SET status = 'CONVERTED', converted_invoice_id = $1, updated_at = NOW(), updated_by = $2 
           WHERE id = $3 AND business_id = $4`,
          [invoice.id, userId || null, data.purchaseOrderId, businessId]
        );
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
          categoryCode: uItem.category.code,
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
            business_id, party_id, transaction_date, reference_type, reference_id,
            credit, debit, balance, notes, created_by
          ) VALUES ($1, $2, $3, 'PURCHASE_INVOICE', $4, $5, '0.00', $6, $7, $8)`,
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
      ) VALUES ($1, $2, 'PURCHASE', 'PURCHASE_INVOICE', $3, $4, '0.00', $5, $6, $7, $8, NOW())`,
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
        ) VALUES ($1, $2, 'CANCELLATION_REVERSAL', 'PURCHASE_INVOICE_CANCEL', $3, '0.00', $4, $5, NOW(), $6, $7, NOW())`,
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
  static async generatePurchaseOrderNumber(businessId: string): Promise<string> {
    const prefixConfig = await BusinessSettingsService.getVoucherPrefix(businessId, 'purchaseOrder').catch(() => ({
      prefix: 'PO-',
      startNumber: 1,
      method: 'AUTOMATIC',
    }));
    const prefix = prefixConfig.prefix || 'PO-';
    const startNumber = prefixConfig.startNumber || 1;

    const res = await pool.query(
      `SELECT order_number FROM purchase_orders 
       WHERE business_id = $1 AND order_number LIKE $2
       ORDER BY created_at DESC 
       LIMIT 50`,
      [businessId, `${prefix}%`]
    );

    let maxNum = startNumber - 1;
    for (const r of res.rows) {
      const numStr = (r.order_number || '').replace(prefix, '');
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    const nextNum = Math.max(maxNum + 1, startNumber);
    return `${prefix}${nextNum.toString().padStart(6, '0')}`;
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
    const orderNumber = data.orderNumber || (await this.generatePurchaseOrderNumber(businessId));

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
          const bQty = round2(b.quantity);
          if (bQty <= 0) throw new Error(`Line ${i + 1}: Batch allocation quantity must be positive`);
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

      const poRes = await client.query(
        `INSERT INTO purchase_orders (
          business_id, supplier_party_id, order_number, order_date,
          expected_delivery_date, gst_mode, subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, status, supplier_reference, notes,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'OPEN', $18, $19, $20, $20)
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
          data.supplierReference || null,
          data.notes || null,
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

        return {
          ...l.line,
          uniqueItem: l.uniqueItem,
          primaryItem: l.primaryItem,
          category: l.category,
          batches: batchAllocations.map(ba => ({
            ...ba.batchAlloc,
            batch: ba.batch,
          })),
        };
      })
    );

    return {
      order: orderRow.order,
      supplier: orderRow.supplier,
      lines: populatedLines,
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

    if (existingOrder.status === 'CONVERTED') {
      throw new Error(`Cannot edit purchase order ${existingOrder.orderNumber} because it has already been converted to an invoice.`);
    }

    if (existingOrder.status === 'CANCELLED') {
      throw new Error(`Cannot edit cancelled purchase order ${existingOrder.orderNumber}.`);
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

      const qty = Number(line.quantity);
      const rate = Number(line.rate);
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
          quantity: b.quantity,
          rate: b.rate !== undefined ? b.rate : taxRes.rate,
          totalCost: round2(b.quantity * (b.rate !== undefined ? b.rate : taxRes.rate)),
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
   * Converts an OPEN Purchase Order into a fully posted Purchase Invoice
   */
  static async convertPurchaseOrderToInvoice(
    businessId: string,
    orderId: string,
    invoiceOverrides?: Partial<CreatePurchaseInvoiceDTO>,
    userId?: string
  ) {
    const orderData = await this.getPurchaseOrderById(businessId, orderId);
    if (!orderData || !orderData.order) {
      throw new Error(`Purchase order ${orderId} not found`);
    }
    const order = orderData.order;
    if (order.status === 'CONVERTED') {
      throw new Error(`Purchase order ${order.orderNumber} is already converted to an invoice`);
    }
    if (order.status === 'CANCELLED') {
      throw new Error(`Cannot convert cancelled purchase order ${order.orderNumber}`);
    }

    const lines: PurchaseLineInput[] = orderData.lines.map((l: any) => ({
      uniqueItemId: l.uniqueItemId,
      quantity: parseFloat(l.quantity),
      rate: parseFloat(l.rate),
      discountType: l.discountType,
      discountValue: parseFloat(l.discountValue || '0'),
      gstRate: parseFloat(l.gstRate || '0'),
      batches: (l.batches || []).map((b: any) => ({
        batchId: b.batchId,
        quantity: parseFloat(b.quantity),
        rate: parseFloat(b.rate),
      })),
    }));

    const invoicePayload: CreatePurchaseInvoiceDTO = {
      supplierPartyId: order.supplierPartyId,
      purchaseOrderId: order.id,
      invoiceDate: invoiceOverrides?.invoiceDate || new Date(),
      supplierInvoiceNumber: invoiceOverrides?.supplierInvoiceNumber || order.supplierReference || undefined,
      supplierInvoiceDate: invoiceOverrides?.supplierInvoiceDate,
      gstMode: order.gstMode as any,
      notes: invoiceOverrides?.notes || order.notes || undefined,
      lines: invoiceOverrides?.lines || lines,
    };

    return await this.createPurchaseInvoice(businessId, invoicePayload, userId);
  }
}
