import { db, pool } from '../db/index.js';
import {
  salesReturns,
  salesReturnLines,
  salesReturnLineBatches,
  salesInvoices,
  salesInvoiceLines,
  salesInvoiceLineBatches,
  parties,
  uniqueItems,
  opticalBatches,
  opticalStocks,
  businesses,
} from '../db/schema.js';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { calculateLineTax, calculateInvoiceTotals, round2 } from './taxCalculationService.js';
import { AuditService } from './auditService.js';

export interface CreateSalesReturnLineBatchInput {
  batchId: string;
  quantity: number;
}

export interface CreateSalesReturnLineInput {
  salesInvoiceLineId: string;
  uniqueItemId: string;
  quantity: number;
  rate?: number;
  discountType?: 'NONE' | 'PERCENTAGE' | 'FLAT';
  discountValue?: number;
  gstRate?: number;
  batches: CreateSalesReturnLineBatchInput[];
}

export interface CreateSalesReturnInput {
  salesInvoiceId: string;
  partyId?: string;
  returnDate?: string | Date;
  status?: 'DRAFT' | 'POSTED';
  reason?: string;
  notes?: string;
  lines: CreateSalesReturnLineInput[];
}

export class SalesReturnService {
  /**
   * Generate next sequential return number per business (e.g., SR-000001)
   */
  static async generateReturnNumber(businessId: string): Promise<string> {
    const [latest] = await db
      .select({ returnNumber: salesReturns.returnNumber })
      .from(salesReturns)
      .where(eq(salesReturns.businessId, businessId))
      .orderBy(desc(salesReturns.createdAt))
      .limit(1);

    if (!latest || !latest.returnNumber) {
      return 'SR-000001';
    }

    const match = latest.returnNumber.match(/SR-(\d+)/);
    if (!match) {
      return `SR-${Date.now().toString().slice(-6)}`;
    }

    const nextSeq = parseInt(match[1], 10) + 1;
    return `SR-${nextSeq.toString().padStart(6, '0')}`;
  }

  /**
   * Get returnable item summary for a sales invoice (original qty, returned qty, remaining returnable qty)
   */
  static async getReturnableInvoiceSummary(businessId: string, invoiceId: string) {
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
      throw new Error(`Sales Invoice not found with ID ${invoiceId}`);
    }

    // Fetch lines
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

    // Fetch previous active returns for this invoice
    const previousReturns = await db
      .select({
        returnLine: salesReturnLines,
        returnBatch: salesReturnLineBatches,
      })
      .from(salesReturnLines)
      .innerJoin(salesReturns, eq(salesReturnLines.salesReturnId, salesReturns.id))
      .leftJoin(salesReturnLineBatches, eq(salesReturnLines.id, salesReturnLineBatches.salesReturnLineId))
      .where(and(eq(salesReturns.salesInvoiceId, invoiceId), sql`${salesReturns.status} != 'CANCELLED'`));

    // Calculate returned quantities per invoice line and per batch
    const returnedByLine = new Map<string, number>();
    const returnedByBatch = new Map<string, number>();

    for (const pr of previousReturns) {
      const lineId = pr.returnLine.salesInvoiceLineId;
      const qty = parseFloat(pr.returnLine.quantity);
      returnedByLine.set(lineId, round2((returnedByLine.get(lineId) || 0) + qty));

      if (pr.returnBatch) {
        const key = `${lineId}_${pr.returnBatch.batchId}`;
        const bQty = parseFloat(pr.returnBatch.quantity);
        returnedByBatch.set(key, round2((returnedByBatch.get(key) || 0) + bQty));
      }
    }

    const processedLines = lines.map(l => {
      const lineBatches = batches.filter(b => b.lineBatch.salesInvoiceLineId === l.line.id);
      const invoicedQty = parseFloat(l.line.quantity);
      const returnedQty = returnedByLine.get(l.line.id) || 0;
      const returnableQty = Math.max(0, round2(invoicedQty - returnedQty));

      const processedBatches = lineBatches.map(b => {
        const bInvoicedQty = parseFloat(b.lineBatch.quantity);
        const bKey = `${l.line.id}_${b.batch.id}`;
        const bReturnedQty = returnedByBatch.get(bKey) || 0;
        const bReturnableQty = Math.max(0, round2(bInvoicedQty - bReturnedQty));

        return {
          ...b.lineBatch,
          batch: b.batch,
          invoicedQuantity: bInvoicedQty,
          returnedQuantity: bReturnedQty,
          returnableQuantity: bReturnableQty,
        };
      });

      return {
        ...l.line,
        uniqueItem: l.uniqueItem,
        invoicedQuantity: invoicedQty,
        returnedQuantity: returnedQty,
        returnableQuantity: returnableQty,
        batches: processedBatches,
      };
    });

    const isEligible = inv.invoice.status === 'POSTED' && processedLines.some(l => l.returnableQuantity > 0);

    return {
      invoice: inv.invoice,
      party: inv.party,
      isEligible,
      lines: processedLines,
    };
  }

  /**
   * Create a Sales Return (Credit Note)
   */
  static async createSalesReturn(businessId: string, data: CreateSalesReturnInput, userId?: string) {
    if (!data.salesInvoiceId) {
      throw new Error('Original Sales Invoice ID is required');
    }
    if (!data.lines || data.lines.length === 0) {
      throw new Error('At least one item line must be returned');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock invoice FOR UPDATE
      const invRes = await client.query(
        `SELECT * FROM sales_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, data.salesInvoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error(`Sales invoice not found in this business`);
      }

      const inv = invRes.rows[0];
      if (inv.status !== 'POSTED') {
        throw new Error(`Cannot create Sales Return against ${inv.status} sales invoice. Invoice must be POSTED.`);
      }

      const partyId = data.partyId || inv.party_id;
      if (partyId !== inv.party_id) {
        throw new Error('Party mismatch: Sales Return party must match original invoice customer');
      }

      // Check Business & Party for tax determination
      const bizRes = await client.query(`SELECT state FROM businesses WHERE id = $1`, [businessId]);
      const partyRes = await client.query(`SELECT state FROM parties WHERE id = $1`, [partyId]);
      const bizState = (bizRes.rows[0]?.state || '').trim().toLowerCase();
      const partyState = (partyRes.rows[0]?.state || '').trim().toLowerCase();
      const isInterState = bizState && partyState && bizState !== partyState;

      // 2. Fetch original invoice lines & batches
      const invLinesRes = await client.query(
        `SELECT sil.*, silb.batch_id, silb.quantity AS batch_qty
         FROM sales_invoice_lines sil
         LEFT JOIN sales_invoice_line_batches silb ON sil.id = silb.sales_invoice_line_id
         WHERE sil.sales_invoice_id = $1`,
        [data.salesInvoiceId]
      );

      const invLinesMap = new Map<string, any>();
      for (const row of invLinesRes.rows) {
        if (!invLinesMap.has(row.id)) {
          invLinesMap.set(row.id, {
            ...row,
            batches: new Map<string, number>(),
          });
        }
        if (row.batch_id) {
          invLinesMap.get(row.id).batches.set(row.batch_id, parseFloat(row.batch_qty));
        }
      }

      // 3. Fetch cumulative already-returned quantities
      const prevReturnsRes = await client.query(
        `SELECT srl.sales_invoice_line_id, srlb.batch_id, srl.quantity AS line_qty, srlb.quantity AS batch_qty
         FROM sales_return_lines srl
         INNER JOIN sales_returns sr ON srl.sales_return_id = sr.id
         LEFT JOIN sales_return_line_batches srlb ON srl.id = srlb.sales_return_line_id
         WHERE sr.sales_invoice_id = $1 AND sr.status != 'CANCELLED'`,
        [data.salesInvoiceId]
      );

      const cumulativeLineReturned = new Map<string, number>();
      const cumulativeBatchReturned = new Map<string, number>();

      for (const row of prevReturnsRes.rows) {
        const lid = row.sales_invoice_line_id;
        cumulativeLineReturned.set(
          lid,
          round2((cumulativeLineReturned.get(lid) || 0) + parseFloat(row.line_qty))
        );
        if (row.batch_id) {
          const key = `${lid}_${row.batch_id}`;
          cumulativeBatchReturned.set(
            key,
            round2((cumulativeBatchReturned.get(key) || 0) + parseFloat(row.batch_qty))
          );
        }
      }

      // 4. Validate return lines and calculate taxes
      const calculatedLineResults: any[] = [];
      let totalSubtotal = 0;
      let totalDiscount = 0;
      let totalTaxable = 0;
      let totalGstAmount = 0;

      for (let i = 0; i < data.lines.length; i++) {
        const reqLine = data.lines[i];
        const origLine = invLinesMap.get(reqLine.salesInvoiceLineId);

        if (!origLine) {
          throw new Error(`Line ${i + 1}: Sales invoice line not found on original invoice`);
        }
        if (origLine.unique_item_id !== reqLine.uniqueItemId) {
          throw new Error(`Line ${i + 1}: Unique item mismatch with original invoice line`);
        }

        const returnQty = round2(reqLine.quantity);
        if (returnQty <= 0) {
          throw new Error(`Line ${i + 1}: Return quantity must be greater than 0`);
        }

        const origLineQty = parseFloat(origLine.quantity);
        const alreadyReturned = cumulativeLineReturned.get(reqLine.salesInvoiceLineId) || 0;
        const maxReturnable = round2(origLineQty - alreadyReturned);

        if (returnQty > maxReturnable) {
          throw new Error(
            `Line ${i + 1}: Return quantity (${returnQty}) exceeds remaining returnable quantity (${maxReturnable})`
          );
        }

        // Validate batch allocations
        const reqBatches = reqLine.batches || [];
        if (reqBatches.length === 0) {
          throw new Error(`Line ${i + 1}: Must specify optical batch allocations for return`);
        }

        let sumBatchQty = 0;
        for (const b of reqBatches) {
          const bQty = round2(b.quantity);
          if (bQty <= 0) {
            throw new Error(`Line ${i + 1}: Batch return quantity must be greater than 0`);
          }
          sumBatchQty = round2(sumBatchQty + bQty);

          // Validate batch belongs to original invoice line
          const origBatchQty = origLine.batches.get(b.batchId);
          if (origBatchQty === undefined) {
            throw new Error(
              `Line ${i + 1}: Batch ${b.batchId} was not part of the original invoice line. Returns must restore original batches.`
            );
          }

          const bKey = `${reqLine.salesInvoiceLineId}_${b.batchId}`;
          const bAlreadyReturned = cumulativeBatchReturned.get(bKey) || 0;
          const bMaxReturnable = round2(origBatchQty - bAlreadyReturned);

          if (bQty > bMaxReturnable) {
            throw new Error(
              `Line ${i + 1}: Batch return quantity (${bQty}) exceeds remaining returnable batch quantity (${bMaxReturnable})`
            );
          }
        }

        if (Math.abs(sumBatchQty - returnQty) > 0.001) {
          throw new Error(
            `Line ${i + 1}: Sum of batch quantities (${sumBatchQty}) must match line return quantity (${returnQty})`
          );
        }

        // Use original line rate / discount unless overridden
        const rate = reqLine.rate !== undefined ? round2(reqLine.rate) : parseFloat(origLine.rate);
        const discountType = reqLine.discountType || origLine.discount_type || 'NONE';
        const discountValue = reqLine.discountValue !== undefined ? round2(reqLine.discountValue) : parseFloat(origLine.discount_value || '0');
        const gstRate = reqLine.gstRate !== undefined ? round2(reqLine.gstRate) : parseFloat(origLine.gst_rate || '0');

        const taxRes = calculateLineTax({
          quantity: returnQty,
          rate,
          discountType,
          discountValue,
          gstRate,
        });

        totalSubtotal = round2(totalSubtotal + taxRes.gross);
        totalDiscount = round2(totalDiscount + taxRes.discountAmount);
        totalTaxable = round2(totalTaxable + taxRes.taxableAmount);
        totalGstAmount = round2(totalGstAmount + taxRes.taxAmount);

        calculatedLineResults.push({
          reqLine,
          taxRes,
          batches: reqBatches,
        });
      }

      // Calculate document totals
      const docTotals = calculateInvoiceTotals({
        lines: calculatedLineResults.map(c => c.taxRes),
        gstMode: isInterState ? 'INTER_STATE' : 'INTRA_STATE',
      });

      const returnNumber = await this.generateReturnNumber(businessId);
      const returnDate = data.returnDate ? new Date(data.returnDate) : new Date();

      // 5. Insert Sales Return header
      const returnRes = await client.query(
        `INSERT INTO sales_returns (
          business_id, sales_invoice_id, party_id, return_number, return_date,
          subtotal, discount_total, taxable_amount, igst_rate, igst_amount,
          cgst_rate, cgst_amount, sgst_rate, sgst_amount, round_off, grand_total,
          status, reason, notes, created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, NOW(), NOW()
        ) RETURNING *`,
        [
          businessId,
          data.salesInvoiceId,
          partyId,
          returnNumber,
          returnDate,
          totalSubtotal.toFixed(2),
          totalDiscount.toFixed(2),
          totalTaxable.toFixed(2),
          docTotals.igstRate.toFixed(2),
          docTotals.igstAmount.toFixed(2),
          docTotals.cgstRate.toFixed(2),
          docTotals.cgstAmount.toFixed(2),
          docTotals.sgstRate.toFixed(2),
          docTotals.sgstAmount.toFixed(2),
          docTotals.roundOff.toFixed(2),
          docTotals.grandTotal.toFixed(2),
          'DRAFT', // Always create as DRAFT first, then post if requested
          data.reason || null,
          data.notes || null,
          userId || null,
        ]
      );

      const sReturn = returnRes.rows[0];

      // 6. Insert Return lines and batch allocations
      for (const item of calculatedLineResults) {
        const { reqLine, taxRes, batches } = item;

        const lineRes = await client.query(
          `INSERT INTO sales_return_lines (
            sales_return_id, sales_invoice_line_id, unique_item_id, quantity,
            rate, discount_type, discount_value, discount_amount,
            taxable_amount, gst_rate, tax_amount, line_total,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, $11, $12,
            NOW(), NOW()
          ) RETURNING *`,
          [
            sReturn.id,
            reqLine.salesInvoiceLineId,
            reqLine.uniqueItemId,
            taxRes.quantity.toFixed(2),
            taxRes.rate.toFixed(2),
            taxRes.discountType,
            taxRes.discountValue.toFixed(2),
            taxRes.discountAmount.toFixed(2),
            taxRes.taxableAmount.toFixed(2),
            taxRes.gstRate.toFixed(2),
            taxRes.taxAmount.toFixed(2),
            taxRes.lineTotal.toFixed(2),
          ]
        );

        const returnLine = lineRes.rows[0];

        for (const b of batches) {
          await client.query(
            `INSERT INTO sales_return_line_batches (
              sales_return_line_id, batch_id, quantity, created_at
            ) VALUES ($1, $2, $3, NOW())`,
            [returnLine.id, b.batchId, round2(b.quantity).toFixed(2)]
          );
        }
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_RETURN_CREATED',
        entityType: 'SALES_RETURN',
        entityId: sReturn.id,
        newValue: {
          returnNumber: sReturn.return_number,
          invoiceId: data.salesInvoiceId,
          grandTotal: sReturn.grand_total,
        },
      });

      // If POSTED requested, execute atomic post
      if (data.status === 'POSTED') {
        return await this.postSalesReturn(businessId, sReturn.id, userId);
      }

      return await this.getSalesReturnById(businessId, sReturn.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Post a Sales Return (Credit Note):
   * 1. Restores physical and available stock to original batch
   * 2. Writes SALES_RETURN entries to stock_ledger
   * 3. Writes CREDIT_NOTE / SALES_RETURN credit to customer_ledgers
   * 4. Updates status to POSTED
   */
  static async postSalesReturn(businessId: string, returnId: string, userId?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock Sales Return FOR UPDATE
      const returnRes = await client.query(
        `SELECT * FROM sales_returns WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, returnId]
      );

      if (returnRes.rows.length === 0) {
        throw new Error(`Sales Return not found with ID ${returnId}`);
      }

      const sReturn = returnRes.rows[0];
      if (sReturn.status === 'POSTED') {
        throw new Error('Sales Return is already POSTED');
      }
      if (sReturn.status === 'CANCELLED') {
        throw new Error('Cancelled Sales Return cannot be posted');
      }

      // 2. Lock original Sales Invoice FOR UPDATE
      const invRes = await client.query(
        `SELECT * FROM sales_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, sReturn.sales_invoice_id]
      );

      if (invRes.rows.length === 0) {
        throw new Error('Referenced Sales Invoice not found');
      }

      const inv = invRes.rows[0];
      if (inv.status !== 'POSTED') {
        throw new Error(`Cannot post return against ${inv.status} sales invoice`);
      }

      // 3. Fetch return lines and batches
      const returnBatchesRes = await client.query(
        `SELECT srlb.batch_id, srlb.quantity, srl.sales_invoice_line_id, srl.unique_item_id
         FROM sales_return_line_batches srlb
         INNER JOIN sales_return_lines srl ON srlb.sales_return_line_id = srl.id
         WHERE srl.sales_return_id = $1`,
        [returnId]
      );

      if (returnBatchesRes.rows.length === 0) {
        throw new Error('Cannot post Sales Return with zero batch allocations');
      }

      // 4. Restore stock for each returned batch
      for (const row of returnBatchesRes.rows) {
        const batchId = row.batch_id;
        const returnQty = parseFloat(row.quantity);

        const stockRes = await client.query(
          `SELECT * FROM optical_stocks WHERE business_id = $1 AND batch_id = $2 FOR UPDATE`,
          [businessId, batchId]
        );

        let stockRow = stockRes.rows[0];
        if (!stockRow) {
          const insStock = await client.query(
            `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock)
             VALUES ($1, $2, '0.00', '0.00', '0.00')
             RETURNING *`,
            [businessId, batchId]
          );
          stockRow = insStock.rows[0];
        }

        const curPhys = parseFloat(stockRow.physical_stock);
        const curResv = parseFloat(stockRow.reserved_stock);
        const newPhys = round2(curPhys + returnQty);
        const newAvail = round2(newPhys - curResv);

        await client.query(
          `UPDATE optical_stocks 
           SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newPhys.toFixed(2), newAvail.toFixed(2), stockRow.id]
        );

        // Stock Ledger entry: quantity_in = returnQty
        await client.query(
          `INSERT INTO stock_ledger (
            business_id, batch_id, transaction_type, reference_type, reference_id,
            quantity_in, quantity_out, reserved_in, reserved_out, balance,
            reason, created_by, created_at
          ) VALUES (
            $1, $2, 'SALES_RETURN', 'SALES_RETURN', $3,
            $4, '0.00', '0.00', '0.00', $5,
            $6, $7, NOW()
          )`,
          [
            businessId,
            batchId,
            returnId,
            returnQty.toFixed(2),
            newPhys.toFixed(2),
            `Sales Return ${sReturn.return_number} against Invoice ${inv.invoice_number}`,
            userId || null,
          ]
        );
      }

      // 5. Customer Ledger entry (Credit Note reduces customer balance)
      const grandTotal = parseFloat(sReturn.grand_total);
      const lastLedgerRes = await client.query(
        `SELECT balance FROM customer_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY transaction_date DESC, created_at DESC 
         LIMIT 1`,
        [businessId, sReturn.party_id]
      );

      const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
      const newBalance = round2(prevBalance - grandTotal);

      await client.query(
        `INSERT INTO customer_ledgers (
          business_id, party_id, transaction_type, reference_type, reference_id,
          debit, credit, balance, transaction_date, notes, created_by, created_at
        ) VALUES (
          $1, $2, 'SALES_RETURN', 'SALES_RETURN', $3,
          '0.00', $4, $5, NOW(), $6, $7, NOW()
        )`,
        [
          businessId,
          sReturn.party_id,
          returnId,
          grandTotal.toFixed(2),
          newBalance.toFixed(2),
          `Credit Note ${sReturn.return_number} for Invoice ${inv.invoice_number}`,
          userId || null,
        ]
      );

      // 6. Update return status to POSTED
      await client.query(
        `UPDATE sales_returns 
         SET status = 'POSTED', updated_at = NOW(), updated_by = $1 
         WHERE id = $2`,
        [userId || null, returnId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_RETURN_POSTED',
        entityType: 'SALES_RETURN',
        entityId: returnId,
        newValue: {
          returnNumber: sReturn.return_number,
          status: 'POSTED',
          grandTotal: sReturn.grand_total,
        },
      });

      return await this.getSalesReturnById(businessId, returnId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cancel a Sales Return:
   * If POSTED:
   * 1. Reverses stock restoration (deducts stock from batch)
   * 2. Writes CANCELLATION_REVERSAL to stock_ledger
   * 3. Writes CANCELLATION_REVERSAL debit to customer_ledgers
   * 4. Updates status to CANCELLED
   */
  static async cancelSalesReturn(
    businessId: string,
    returnId: string,
    reason?: string,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const returnRes = await client.query(
        `SELECT * FROM sales_returns WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, returnId]
      );

      if (returnRes.rows.length === 0) {
        throw new Error(`Sales Return not found with ID ${returnId}`);
      }

      const sReturn = returnRes.rows[0];
      if (sReturn.status === 'CANCELLED') {
        throw new Error('Sales Return is already CANCELLED');
      }

      // If POSTED, reverse stock and customer ledger
      if (sReturn.status === 'POSTED') {
        const batchesRes = await client.query(
          `SELECT srlb.batch_id, srlb.quantity
           FROM sales_return_line_batches srlb
           INNER JOIN sales_return_lines srl ON srlb.sales_return_line_id = srl.id
           WHERE srl.sales_return_id = $1`,
          [returnId]
        );

        for (const row of batchesRes.rows) {
          const batchId = row.batch_id;
          const qty = parseFloat(row.quantity);

          const stockRes = await client.query(
            `SELECT * FROM optical_stocks WHERE business_id = $1 AND batch_id = $2 FOR UPDATE`,
            [businessId, batchId]
          );

          if (stockRes.rows.length > 0) {
            const stockRow = stockRes.rows[0];
            const curPhys = parseFloat(stockRow.physical_stock);
            const curResv = parseFloat(stockRow.reserved_stock);
            const newPhys = round2(curPhys - qty);
            const newAvail = round2(newPhys - curResv);

            await client.query(
              `UPDATE optical_stocks 
               SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
               WHERE id = $3`,
              [newPhys.toFixed(2), newAvail.toFixed(2), stockRow.id]
            );

            await client.query(
              `INSERT INTO stock_ledger (
                business_id, batch_id, transaction_type, reference_type, reference_id,
                quantity_in, quantity_out, reserved_in, reserved_out, balance,
                reason, created_by, created_at
              ) VALUES (
                $1, $2, 'CANCELLATION_REVERSAL', 'SALES_RETURN_CANCEL', $3,
                '0.00', $4, '0.00', '0.00', $5,
                $6, $7, NOW()
              )`,
              [
                businessId,
                batchId,
                returnId,
                qty.toFixed(2),
                newPhys.toFixed(2),
                `Cancellation reversal of Sales Return ${sReturn.return_number}`,
                userId || null,
              ]
            );
          }
        }

        // Reverse Customer Ledger (Debit back)
        const grandTotal = parseFloat(sReturn.grand_total);
        const lastLedgerRes = await client.query(
          `SELECT balance FROM customer_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY transaction_date DESC, created_at DESC 
           LIMIT 1`,
          [businessId, sReturn.party_id]
        );

        const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
        const newBalance = round2(prevBalance + grandTotal);

        await client.query(
          `INSERT INTO customer_ledgers (
            business_id, party_id, transaction_type, reference_type, reference_id,
            debit, credit, balance, transaction_date, notes, created_by, created_at
          ) VALUES (
            $1, $2, 'CANCELLATION_REVERSAL', 'SALES_RETURN_CANCEL', $3,
            $4, '0.00', $5, NOW(), $6, $7, NOW()
          )`,
          [
            businessId,
            sReturn.party_id,
            returnId,
            grandTotal.toFixed(2),
            newBalance.toFixed(2),
            `Cancellation reversal of Credit Note ${sReturn.return_number}. Reason: ${reason || 'Cancelled'}`,
            userId || null,
          ]
        );
      }

      // Update status to CANCELLED
      await client.query(
        `UPDATE sales_returns 
         SET status = 'CANCELLED', notes = COALESCE(notes || E'\\n', '') || $1, updated_at = NOW(), updated_by = $2 
         WHERE id = $3`,
        [`[CANCELLED: ${reason || 'User cancelled'}]`, userId || null, returnId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'sales',
        action: 'SALES_RETURN_CANCELLED',
        entityType: 'SALES_RETURN',
        entityId: returnId,
        newValue: {
          status: 'CANCELLED',
          reason,
        },
      });

      return await this.getSalesReturnById(businessId, returnId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get single Sales Return by ID with lines and batches
   */
  static async getSalesReturnById(businessId: string, returnId: string) {
    const [ret] = await db
      .select({
        salesReturn: salesReturns,
        party: parties,
        invoice: salesInvoices,
      })
      .from(salesReturns)
      .innerJoin(parties, eq(salesReturns.partyId, parties.id))
      .innerJoin(salesInvoices, eq(salesReturns.salesInvoiceId, salesInvoices.id))
      .where(and(eq(salesReturns.businessId, businessId), eq(salesReturns.id, returnId)))
      .limit(1);

    if (!ret) {
      throw new Error(`Sales Return not found with ID ${returnId}`);
    }

    const lines = await db
      .select({
        line: salesReturnLines,
        uniqueItem: uniqueItems,
      })
      .from(salesReturnLines)
      .innerJoin(uniqueItems, eq(salesReturnLines.uniqueItemId, uniqueItems.id))
      .where(eq(salesReturnLines.salesReturnId, returnId));

    const lineIds = lines.map(l => l.line.id);
    let batches: any[] = [];
    if (lineIds.length > 0) {
      batches = await db
        .select({
          lineBatch: salesReturnLineBatches,
          batch: opticalBatches,
        })
        .from(salesReturnLineBatches)
        .innerJoin(opticalBatches, eq(salesReturnLineBatches.batchId, opticalBatches.id))
        .where(inArray(salesReturnLineBatches.salesReturnLineId, lineIds));
    }

    const batchMap = new Map<string, any[]>();
    for (const b of batches) {
      const lid = b.lineBatch.salesReturnLineId;
      if (!batchMap.has(lid)) batchMap.set(lid, []);
      batchMap.get(lid)!.push({
        ...b.lineBatch,
        batch: b.batch,
      });
    }

    return {
      ...ret.salesReturn,
      party: ret.party,
      invoice: ret.invoice,
      lines: lines.map(l => ({
        ...l.line,
        uniqueItem: l.uniqueItem,
        batches: batchMap.get(l.line.id) || [],
      })),
    };
  }

  /**
   * List Sales Returns with filtering and pagination
   */
  static async getSalesReturns(
    businessId: string,
    params: {
      search?: string;
      status?: string;
      partyId?: string;
      salesInvoiceId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const limit = Math.min(params.limit || 50, 100);
    const offset = params.offset || 0;

    let query = db
      .select({
        salesReturn: salesReturns,
        party: parties,
        invoice: salesInvoices,
      })
      .from(salesReturns)
      .innerJoin(parties, eq(salesReturns.partyId, parties.id))
      .innerJoin(salesInvoices, eq(salesReturns.salesInvoiceId, salesInvoices.id))
      .where(eq(salesReturns.businessId, businessId))
      .$dynamic();

    const conditions = [eq(salesReturns.businessId, businessId)];

    if (params.status) {
      conditions.push(eq(salesReturns.status, params.status));
    }
    if (params.partyId) {
      conditions.push(eq(salesReturns.partyId, params.partyId));
    }
    if (params.salesInvoiceId) {
      conditions.push(eq(salesReturns.salesInvoiceId, params.salesInvoiceId));
    }
    if (params.search) {
      const s = `%${params.search.trim()}%`;
      conditions.push(
        sql`(${salesReturns.returnNumber} ILIKE ${s} OR ${parties.name} ILIKE ${s} OR ${salesInvoices.invoiceNumber} ILIKE ${s})`
      );
    }

    const items = await query
      .where(and(...conditions))
      .orderBy(desc(salesReturns.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesReturns)
      .innerJoin(parties, eq(salesReturns.partyId, parties.id))
      .innerJoin(salesInvoices, eq(salesReturns.salesInvoiceId, salesInvoices.id))
      .where(and(...conditions));

    return {
      items: items.map(i => ({
        ...i.salesReturn,
        party: i.party,
        invoice: i.invoice,
      })),
      total: countRes?.count || 0,
      limit,
      offset,
    };
  }
}
