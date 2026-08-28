import { db, pool } from '../db/index.js';
import {
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

export interface CreatePurchaseInvoiceDTO {
  supplierPartyId: string;
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
    const res = await pool.query(
      `SELECT invoice_number FROM purchase_invoices 
       WHERE business_id = $1 AND invoice_number LIKE 'PUR-%' 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [businessId]
    );

    let maxNum = 0;
    for (const row of res.rows) {
      const numStr = (row.invoice_number || '').replace('PUR-', '');
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }

    const nextSeq = maxNum + 1;
    const padded = String(nextSeq).padStart(6, '0');
    return `PUR-${padded}`;
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
        .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
        .innerJoin(categories, eq(primaryItems.categoryId, categories.id))
        .where(and(eq(uniqueItems.businessId, businessId), eq(uniqueItems.id, line.uniqueItemId)))
        .limit(1);

      if (!uItem) {
        throw new Error(`Line ${i + 1}: Unique Item not found in this business`);
      }

      const qty = round2(line.quantity);
      if (qty <= 0) throw new Error(`Line ${i + 1}: Quantity must be greater than 0`);
      const rate = round2(line.rate);
      if (rate < 0) throw new Error(`Line ${i + 1}: Rate cannot be negative`);

      const taxRes = calculateLineTax({
        quantity: qty,
        rate,
        discountType: line.discountType,
        discountValue: line.discountValue,
        gstRate: line.gstRate ?? 5.00,
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
      } else {
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
          business_id, supplier_party_id, invoice_number, invoice_date,
          supplier_invoice_number, supplier_invoice_date, gst_mode,
          subtotal, discount_total, taxable_amount,
          igst_rate, igst_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
          round_off, grand_total, payment_status, status, notes,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'UNPAID', 'DRAFT', $19, $20, $20)
        RETURNING *`,
        [
          businessId,
          data.supplierPartyId,
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
          status: 'DRAFT',
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
            const newPhysical = round2(Math.max(0, parseFloat(stockRow.physical_stock) - qty));
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
      const targetStatus = data.status || (existingInv.status === 'CANCELLED' ? 'DRAFT' : existingInv.status);

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
          .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
          .innerJoin(categories, eq(primaryItems.categoryId, categories.id))
          .where(and(eq(uniqueItems.businessId, businessId), eq(uniqueItems.id, line.uniqueItemId)))
          .limit(1);

        if (!uItem) {
          throw new Error(`Line ${i + 1}: Unique Item not found in this business`);
        }

        const qty = Number(line.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`Line ${i + 1}: Quantity must be greater than zero`);
        }

        const rate = Number(line.rate);
        if (isNaN(rate) || rate < 0) {
          throw new Error(`Line ${i + 1}: Purchase rate must be non-negative`);
        }

        const taxRes = calculateLineTax({
          quantity: qty,
          rate,
          discountType: line.discountType || 'NONE',
          discountValue: Number(line.discountValue || 0),
          gstRate: Number(line.gstRate !== undefined ? line.gstRate : 12),
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
        } else {
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
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(primaryItems.categoryId, categories.id))
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
        primaryItem: l.primaryItem,
        category: l.category,
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
   * Atomic POST of a Purchase Invoice:
   * 1. Increases physical stock for every batch allocation
   * 2. Writes PURCHASE entries to stock ledger
   * 3. Creates PurchaseLot records
   * 4. Updates Unique Item last purchase price
   * 5. Updates Supplier Ledger outstanding balance
   * 6. Marks invoice POSTED
   * If any step fails, entire operation rolls back.
   */
  static async postPurchaseInvoice(businessId: string, invoiceId: string, userId?: string) {
    if (!businessId || !invoiceId || !isValidUUID(invoiceId)) {
      throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock invoice FOR UPDATE
      const invRes = await client.query(
        `SELECT * FROM purchase_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, invoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error(`Purchase Invoice not found with ID ${invoiceId}`);
      }

      const inv = invRes.rows[0];

      if (inv.status === 'POSTED') {
        throw new Error('Purchase Invoice is already POSTED');
      }
      if (inv.status === 'CANCELLED') {
        throw new Error('Cancelled Purchase Invoice cannot be posted');
      }

      // 2. Fetch lines & allocations
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

        // If no explicit batch allocations were created, locate or insert default batch for this unique item using client
        if (allocations.length === 0) {
          let batchRow = (
            await client.query(
              `SELECT * FROM optical_batches WHERE business_id = $1 AND unique_item_id = $2 AND identity_key = 'SV:SPH=0.00:CYL=0.00' LIMIT 1`,
              [businessId, line.unique_item_id]
            )
          ).rows[0];

          if (!batchRow) {
            // Get category of the unique item
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
              [businessId, line.unique_item_id, catRow.category_id, barcode, userId || null]
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

        // 3. Update Unique Item last purchase price
        await client.query(
          `UPDATE unique_items 
           SET last_purchase_price = $1, updated_at = NOW(), updated_by = $2 
           WHERE id = $3`,
          [line.rate, userId || null, line.unique_item_id]
        );
      }

      // 4. Update Supplier Ledger
      // Lock last balance
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

      // 5. Update invoice status to POSTED
      await client.query(
        `UPDATE purchase_invoices 
         SET status = 'POSTED', payment_status = 'UNPAID', updated_at = NOW(), updated_by = $1 
         WHERE id = $2`,
        [userId || null, inv.id]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'post',
        entityType: 'purchase_invoice',
        entityId: inv.id,
        newValue: {
          status: 'POSTED',
          invoiceNumber: inv.invoice_number,
          grandTotal: inv.grand_total,
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
            const newPhysical = round2(Math.max(0, parseFloat(stockRow.physical_stock) - qty));
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
   * Backward-compatible alias for deletePurchaseInvoice
   */
  static async deleteDraftPurchaseInvoice(businessId: string, invoiceId: string, userId?: string) {
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
}
