import { db, pool } from '../db/index.js';
import {
  purchaseReturns,
  purchaseReturnLines,
  purchaseReturnLineBatches,
  purchaseInvoices,
  purchaseInvoiceLines,
  purchaseInvoiceLineBatches,
  purchaseLots,
  parties,
  uniqueItems,
  opticalBatches,
  opticalStocks,
  businesses,
} from '../db/schema.js';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { calculateLineTax, calculateInvoiceTotals, round2 } from './taxCalculationService.js';
import { AuditService } from './auditService.js';

export interface CreatePurchaseReturnLineBatchInput {
  batchId: string;
  purchaseLotId?: string;
  quantity: number;
  rate?: number;
}

export interface CreatePurchaseReturnLineInput {
  purchaseInvoiceLineId: string;
  uniqueItemId: string;
  quantity: number;
  rate?: number;
  discountType?: 'NONE' | 'PERCENTAGE' | 'FLAT';
  discountValue?: number;
  gstRate?: number;
  batches: CreatePurchaseReturnLineBatchInput[];
}

export interface CreatePurchaseReturnInput {
  purchaseInvoiceId: string;
  supplierPartyId?: string;
  returnDate?: string | Date;
  status?: 'DRAFT' | 'POSTED';
  reason?: string;
  notes?: string;
  lines: CreatePurchaseReturnLineInput[];
}

export class PurchaseReturnService {
  /**
   * Generate next sequential return number per business (e.g., PR-000001)
   */
  static async generateReturnNumber(businessId: string): Promise<string> {
    const [latest] = await db
      .select({ returnNumber: purchaseReturns.returnNumber })
      .from(purchaseReturns)
      .where(eq(purchaseReturns.businessId, businessId))
      .orderBy(desc(purchaseReturns.createdAt))
      .limit(1);

    if (!latest || !latest.returnNumber) {
      return 'PR-000001';
    }

    const match = latest.returnNumber.match(/PR-(\d+)/);
    if (!match) {
      return `PR-${Date.now().toString().slice(-6)}`;
    }

    const nextSeq = parseInt(match[1], 10) + 1;
    return `PR-${nextSeq.toString().padStart(6, '0')}`;
  }

  /**
   * Get returnable item summary for a purchase invoice (original qty, returned qty, remaining returnable qty)
   */
  static async getReturnablePurchaseInvoiceSummary(businessId: string, invoiceId: string) {
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
      })
      .from(purchaseInvoiceLines)
      .innerJoin(uniqueItems, eq(purchaseInvoiceLines.uniqueItemId, uniqueItems.id))
      .where(eq(purchaseInvoiceLines.purchaseInvoiceId, invoiceId));

    const lineIds = lines.map(l => l.line.id);
    let batches: any[] = [];
    let lots: any[] = [];
    if (lineIds.length > 0) {
      batches = await db
        .select({
          lineBatch: purchaseInvoiceLineBatches,
          batch: opticalBatches,
        })
        .from(purchaseInvoiceLineBatches)
        .innerJoin(opticalBatches, eq(purchaseInvoiceLineBatches.batchId, opticalBatches.id))
        .where(inArray(purchaseInvoiceLineBatches.purchaseInvoiceLineId, lineIds));

      lots = await db
        .select()
        .from(purchaseLots)
        .where(inArray(purchaseLots.purchaseInvoiceLineId, lineIds));
    }

    // Fetch previous active returns for this invoice
    const previousReturns = await db
      .select({
        returnLine: purchaseReturnLines,
        returnBatch: purchaseReturnLineBatches,
      })
      .from(purchaseReturnLines)
      .innerJoin(purchaseReturns, eq(purchaseReturnLines.purchaseReturnId, purchaseReturns.id))
      .leftJoin(purchaseReturnLineBatches, eq(purchaseReturnLines.id, purchaseReturnLineBatches.purchaseReturnLineId))
      .where(and(eq(purchaseReturns.purchaseInvoiceId, invoiceId), sql`${purchaseReturns.status} != 'CANCELLED'`));

    // Calculate returned quantities per invoice line and per batch
    const returnedByLine = new Map<string, number>();
    const returnedByBatch = new Map<string, number>();

    for (const pr of previousReturns) {
      const lineId = pr.returnLine.purchaseInvoiceLineId;
      const qty = parseFloat(pr.returnLine.quantity);
      returnedByLine.set(lineId, round2((returnedByLine.get(lineId) || 0) + qty));

      if (pr.returnBatch) {
        const key = `${lineId}_${pr.returnBatch.batchId}`;
        const bQty = parseFloat(pr.returnBatch.quantity);
        returnedByBatch.set(key, round2((returnedByBatch.get(key) || 0) + bQty));
      }
    }

    const processedLines = lines.map(l => {
      const lineBatches = batches.filter(b => b.lineBatch.purchaseInvoiceLineId === l.line.id);
      const lineLots = lots.filter(lot => lot.purchaseInvoiceLineId === l.line.id);
      const purchasedQty = parseFloat(l.line.quantity);
      const returnedQty = returnedByLine.get(l.line.id) || 0;
      const returnableQty = Math.max(0, round2(purchasedQty - returnedQty));

      const processedBatches = lineBatches.map(b => {
        const bPurchasedQty = parseFloat(b.lineBatch.quantity);
        const bKey = `${l.line.id}_${b.batch.id}`;
        const bReturnedQty = returnedByBatch.get(bKey) || 0;
        const bReturnableQty = Math.max(0, round2(bPurchasedQty - bReturnedQty));
        const matchedLot = lineLots.find(lt => lt.batchId === b.batch.id);

        return {
          ...b.lineBatch,
          batch: b.batch,
          purchaseLot: matchedLot || null,
          purchasedQuantity: bPurchasedQty,
          returnedQuantity: bReturnedQty,
          returnableQuantity: bReturnableQty,
        };
      });

      return {
        ...l.line,
        uniqueItem: l.uniqueItem,
        purchasedQuantity: purchasedQty,
        returnedQuantity: returnedQty,
        returnableQuantity: returnableQty,
        batches: processedBatches,
      };
    });

    const isEligible = inv.invoice.status === 'POSTED' && processedLines.some(l => l.returnableQuantity > 0);

    return {
      invoice: inv.invoice,
      supplier: inv.supplier,
      isEligible,
      lines: processedLines,
    };
  }

  /**
   * Create a Purchase Return (Debit Note)
   */
  static async createPurchaseReturn(businessId: string, data: CreatePurchaseReturnInput, userId?: string) {
    if (!data.purchaseInvoiceId) {
      throw new Error('Original Purchase Invoice ID is required');
    }
    if (!data.lines || data.lines.length === 0) {
      throw new Error('At least one item line must be returned');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock invoice FOR UPDATE
      const invRes = await client.query(
        `SELECT * FROM purchase_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, data.purchaseInvoiceId]
      );

      if (invRes.rows.length === 0) {
        throw new Error(`Purchase invoice not found in this business`);
      }

      const inv = invRes.rows[0];
      if (inv.status !== 'POSTED') {
        throw new Error(`Cannot create Purchase Return against ${inv.status} purchase invoice. Invoice must be POSTED.`);
      }

      const supplierPartyId = data.supplierPartyId || inv.supplier_party_id;
      if (supplierPartyId !== inv.supplier_party_id) {
        throw new Error('Supplier mismatch: Purchase Return supplier must match original invoice supplier');
      }

      // Check Business & Supplier Party for tax determination
      const bizRes = await client.query(`SELECT state FROM businesses WHERE id = $1`, [businessId]);
      const partyRes = await client.query(`SELECT state FROM parties WHERE id = $1`, [supplierPartyId]);
      const bizState = (bizRes.rows[0]?.state || '').trim().toLowerCase();
      const partyState = (partyRes.rows[0]?.state || '').trim().toLowerCase();
      const isInterState = bizState && partyState && bizState !== partyState;

      // 2. Fetch original invoice lines & batches
      const invLinesRes = await client.query(
        `SELECT pil.*, pilb.batch_id, pilb.quantity AS batch_qty, pilb.rate AS batch_rate
         FROM purchase_invoice_lines pil
         LEFT JOIN purchase_invoice_line_batches pilb ON pil.id = pilb.purchase_invoice_line_id
         WHERE pil.purchase_invoice_id = $1`,
        [data.purchaseInvoiceId]
      );

      const invLinesMap = new Map<string, any>();
      for (const row of invLinesRes.rows) {
        if (!invLinesMap.has(row.id)) {
          invLinesMap.set(row.id, {
            ...row,
            batches: new Map<string, { qty: number; rate: number }>(),
          });
        }
        if (row.batch_id) {
          invLinesMap.get(row.id).batches.set(row.batch_id, {
            qty: parseFloat(row.batch_qty),
            rate: parseFloat(row.batch_rate),
          });
        }
      }

      // Fetch purchase lots for this invoice
      const lotsRes = await client.query(
        `SELECT * FROM purchase_lots WHERE business_id = $1 AND purchase_invoice_id = $2`,
        [businessId, data.purchaseInvoiceId]
      );
      const lotByLineAndBatch = new Map<string, any>();
      for (const lot of lotsRes.rows) {
        lotByLineAndBatch.set(`${lot.purchase_invoice_line_id}_${lot.batch_id}`, lot);
      }

      // 3. Fetch cumulative already-returned quantities
      const prevReturnsRes = await client.query(
        `SELECT prl.purchase_invoice_line_id, prlb.batch_id, prl.quantity AS line_qty, prlb.quantity AS batch_qty
         FROM purchase_return_lines prl
         INNER JOIN purchase_returns pr ON prl.purchase_return_id = pr.id
         LEFT JOIN purchase_return_line_batches prlb ON prl.id = prlb.purchase_return_line_id
         WHERE pr.purchase_invoice_id = $1 AND pr.status != 'CANCELLED'`,
        [data.purchaseInvoiceId]
      );

      const cumulativeLineReturned = new Map<string, number>();
      const cumulativeBatchReturned = new Map<string, number>();

      for (const row of prevReturnsRes.rows) {
        const lid = row.purchase_invoice_line_id;
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
        const origLine = invLinesMap.get(reqLine.purchaseInvoiceLineId);

        if (!origLine) {
          throw new Error(`Line ${i + 1}: Purchase invoice line not found on original invoice`);
        }
        if (origLine.unique_item_id !== reqLine.uniqueItemId) {
          throw new Error(`Line ${i + 1}: Unique item mismatch with original purchase invoice line`);
        }

        const returnQty = round2(reqLine.quantity);
        if (returnQty <= 0) {
          throw new Error(`Line ${i + 1}: Return quantity must be greater than 0`);
        }

        const origLineQty = parseFloat(origLine.quantity);
        const alreadyReturned = cumulativeLineReturned.get(reqLine.purchaseInvoiceLineId) || 0;
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
        const processedBatches = [];

        for (const b of reqBatches) {
          const bQty = round2(b.quantity);
          if (bQty <= 0) {
            throw new Error(`Line ${i + 1}: Batch return quantity must be greater than 0`);
          }
          sumBatchQty = round2(sumBatchQty + bQty);

          const origBatchInfo = origLine.batches.get(b.batchId);
          if (!origBatchInfo) {
            throw new Error(
              `Line ${i + 1}: Batch ${b.batchId} was not part of the original purchase invoice line.`
            );
          }

          const bKey = `${reqLine.purchaseInvoiceLineId}_${b.batchId}`;
          const bAlreadyReturned = cumulativeBatchReturned.get(bKey) || 0;
          const bMaxReturnable = round2(origBatchInfo.qty - bAlreadyReturned);

          if (bQty > bMaxReturnable) {
            throw new Error(
              `Line ${i + 1}: Batch return quantity (${bQty}) exceeds remaining returnable batch quantity (${bMaxReturnable})`
            );
          }

          const matchedLot = lotByLineAndBatch.get(bKey);
          const bRate = b.rate !== undefined ? round2(b.rate) : origBatchInfo.rate;
          const totalCost = round2(bQty * bRate);

          processedBatches.push({
            batchId: b.batchId,
            purchaseLotId: b.purchaseLotId || (matchedLot ? matchedLot.id : null),
            quantity: bQty,
            rate: bRate,
            totalCost,
          });
        }

        if (Math.abs(sumBatchQty - returnQty) > 0.001) {
          throw new Error(
            `Line ${i + 1}: Sum of batch quantities (${sumBatchQty}) must match line return quantity (${returnQty})`
          );
        }

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
          batches: processedBatches,
        });
      }

      // Calculate document totals
      const docTotals = calculateInvoiceTotals({
        lines: calculatedLineResults.map(c => c.taxRes),
        gstMode: isInterState ? 'INTER_STATE' : 'INTRA_STATE',
      });

      const returnNumber = await this.generateReturnNumber(businessId);
      const returnDate = data.returnDate ? new Date(data.returnDate) : new Date();

      // 5. Insert Purchase Return header
      const returnRes = await client.query(
        `INSERT INTO purchase_returns (
          business_id, purchase_invoice_id, supplier_party_id, return_number, return_date,
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
          data.purchaseInvoiceId,
          supplierPartyId,
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
          'DRAFT',
          data.reason || null,
          data.notes || null,
          userId || null,
        ]
      );

      const pReturn = returnRes.rows[0];

      // 6. Insert Return lines and batch allocations
      for (const item of calculatedLineResults) {
        const { reqLine, taxRes, batches } = item;

        const lineRes = await client.query(
          `INSERT INTO purchase_return_lines (
            purchase_return_id, purchase_invoice_line_id, unique_item_id, quantity,
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
            pReturn.id,
            reqLine.purchaseInvoiceLineId,
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
            `INSERT INTO purchase_return_line_batches (
              purchase_return_line_id, batch_id, purchase_lot_id, quantity, rate, total_cost, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
              returnLine.id,
              b.batchId,
              b.purchaseLotId || null,
              round2(b.quantity).toFixed(2),
              round2(b.rate).toFixed(2),
              round2(b.totalCost).toFixed(2),
            ]
          );
        }
      }

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'PURCHASE_RETURN_CREATED',
        entityType: 'PURCHASE_RETURN',
        entityId: pReturn.id,
        newValue: {
          returnNumber: pReturn.return_number,
          invoiceId: data.purchaseInvoiceId,
          grandTotal: pReturn.grand_total,
        },
      });

      if (data.status === 'POSTED') {
        return await this.postPurchaseReturn(businessId, pReturn.id, userId);
      }

      return await this.getPurchaseReturnById(businessId, pReturn.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Post a Purchase Return (Debit Note):
   * 1. Deducts physical and available stock from batch
   * 2. Writes PURCHASE_RETURN entries to stock_ledger
   * 3. Decrements remaining_quantity on purchase_lots
   * 4. Writes DEBIT_NOTE / PURCHASE_RETURN debit to supplier_ledgers (supplier balance decreases)
   * 5. Updates status to POSTED
   */
  static async postPurchaseReturn(businessId: string, returnId: string, userId?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock Purchase Return FOR UPDATE
      const returnRes = await client.query(
        `SELECT * FROM purchase_returns WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, returnId]
      );

      if (returnRes.rows.length === 0) {
        throw new Error(`Purchase Return not found with ID ${returnId}`);
      }

      const pReturn = returnRes.rows[0];
      if (pReturn.status === 'POSTED') {
        throw new Error('Purchase Return is already POSTED');
      }
      if (pReturn.status === 'CANCELLED') {
        throw new Error('Cancelled Purchase Return cannot be posted');
      }

      // 2. Lock original Purchase Invoice FOR UPDATE
      const invRes = await client.query(
        `SELECT * FROM purchase_invoices WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, pReturn.purchase_invoice_id]
      );

      if (invRes.rows.length === 0) {
        throw new Error('Referenced Purchase Invoice not found');
      }

      const inv = invRes.rows[0];
      if (inv.status !== 'POSTED') {
        throw new Error(`Cannot post return against ${inv.status} purchase invoice`);
      }

      // 3. Fetch return lines and batches
      const returnBatchesRes = await client.query(
        `SELECT prlb.batch_id, prlb.purchase_lot_id, prlb.quantity, prl.purchase_invoice_line_id, prl.unique_item_id
         FROM purchase_return_line_batches prlb
         INNER JOIN purchase_return_lines prl ON prlb.purchase_return_line_id = prl.id
         WHERE prl.purchase_return_id = $1`,
        [returnId]
      );

      if (returnBatchesRes.rows.length === 0) {
        throw new Error('Cannot post Purchase Return with zero batch allocations');
      }

      // 4. Deduct stock and update purchase lots
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
        const newPhys = round2(curPhys - returnQty);
        const newAvail = round2(newPhys - curResv);

        await client.query(
          `UPDATE optical_stocks 
           SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newPhys.toFixed(2), newAvail.toFixed(2), stockRow.id]
        );

        // Stock Ledger entry: quantity_out = returnQty
        await client.query(
          `INSERT INTO stock_ledger (
            business_id, batch_id, transaction_type, reference_type, reference_id,
            quantity_in, quantity_out, reserved_in, reserved_out, balance,
            reason, created_by, created_at
          ) VALUES (
            $1, $2, 'PURCHASE_RETURN', 'PURCHASE_RETURN', $3,
            '0.00', $4, '0.00', '0.00', $5,
            $6, $7, NOW()
          )`,
          [
            businessId,
            batchId,
            returnId,
            returnQty.toFixed(2),
            newPhys.toFixed(2),
            `Purchase Return ${pReturn.return_number} against Bill ${inv.invoice_number}`,
            userId || null,
          ]
        );

        // Decrement Purchase Lot remaining quantity
        if (row.purchase_lot_id) {
          const lotRes = await client.query(
            `SELECT remaining_quantity FROM purchase_lots WHERE id = $1 FOR UPDATE`,
            [row.purchase_lot_id]
          );
          if (lotRes.rows.length > 0) {
            const curRem = parseFloat(lotRes.rows[0].remaining_quantity);
            const newRem = Math.max(0, round2(curRem - returnQty));
            await client.query(
              `UPDATE purchase_lots SET remaining_quantity = $1 WHERE id = $2`,
              [newRem.toFixed(2), row.purchase_lot_id]
            );
          }
        }
      }

      // 5. Supplier Ledger entry (Debit Note reduces supplier liability)
      const grandTotal = parseFloat(pReturn.grand_total);
      const lastLedgerRes = await client.query(
        `SELECT balance FROM supplier_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY transaction_date DESC, created_at DESC 
         LIMIT 1`,
        [businessId, pReturn.supplier_party_id]
      );

      const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
      const newBalance = round2(prevBalance - grandTotal);

      await client.query(
        `INSERT INTO supplier_ledgers (
          business_id, party_id, transaction_type, reference_type, reference_id,
          debit, credit, balance, transaction_date, notes, created_by, created_at
        ) VALUES (
          $1, $2, 'PURCHASE_RETURN', 'PURCHASE_RETURN', $3,
          $4, '0.00', $5, NOW(), $6, $7, NOW()
        )`,
        [
          businessId,
          pReturn.supplier_party_id,
          returnId,
          grandTotal.toFixed(2),
          newBalance.toFixed(2),
          `Debit Note ${pReturn.return_number} for Bill ${inv.invoice_number}`,
          userId || null,
        ]
      );

      // 6. Update return status to POSTED
      await client.query(
        `UPDATE purchase_returns 
         SET status = 'POSTED', updated_at = NOW(), updated_by = $1 
         WHERE id = $2`,
        [userId || null, returnId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'PURCHASE_RETURN_POSTED',
        entityType: 'PURCHASE_RETURN',
        entityId: returnId,
        newValue: {
          returnNumber: pReturn.return_number,
          status: 'POSTED',
          grandTotal: pReturn.grand_total,
        },
      });

      return await this.getPurchaseReturnById(businessId, returnId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cancel a Purchase Return:
   * If POSTED:
   * 1. Reverses stock deduction (restores stock to batch)
   * 2. Writes CANCELLATION_REVERSAL to stock_ledger
   * 3. Restores remaining_quantity in purchase_lots
   * 4. Writes CANCELLATION_REVERSAL credit to supplier_ledgers
   * 5. Updates status to CANCELLED
   */
  static async cancelPurchaseReturn(
    businessId: string,
    returnId: string,
    reason?: string,
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const returnRes = await client.query(
        `SELECT * FROM purchase_returns WHERE business_id = $1 AND id = $2 FOR UPDATE`,
        [businessId, returnId]
      );

      if (returnRes.rows.length === 0) {
        throw new Error(`Purchase Return not found with ID ${returnId}`);
      }

      const pReturn = returnRes.rows[0];
      if (pReturn.status === 'CANCELLED') {
        throw new Error('Purchase Return is already CANCELLED');
      }

      // If POSTED, reverse stock, lots, and supplier ledger
      if (pReturn.status === 'POSTED') {
        const batchesRes = await client.query(
          `SELECT prlb.batch_id, prlb.purchase_lot_id, prlb.quantity
           FROM purchase_return_line_batches prlb
           INNER JOIN purchase_return_lines prl ON prlb.purchase_return_line_id = prl.id
           WHERE prl.purchase_return_id = $1`,
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
            const newPhys = round2(curPhys + qty);
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
                $1, $2, 'CANCELLATION_REVERSAL', 'PURCHASE_RETURN_CANCEL', $3,
                $4, '0.00', '0.00', '0.00', $5,
                $6, $7, NOW()
              )`,
              [
                businessId,
                batchId,
                returnId,
                qty.toFixed(2),
                newPhys.toFixed(2),
                `Cancellation reversal of Purchase Return ${pReturn.return_number}`,
                userId || null,
              ]
            );
          }

          // Restore Purchase Lot remaining quantity
          if (row.purchase_lot_id) {
            const lotRes = await client.query(
              `SELECT remaining_quantity FROM purchase_lots WHERE id = $1 FOR UPDATE`,
              [row.purchase_lot_id]
            );
            if (lotRes.rows.length > 0) {
              const curRem = parseFloat(lotRes.rows[0].remaining_quantity);
              const newRem = round2(curRem + qty);
              await client.query(
                `UPDATE purchase_lots SET remaining_quantity = $1 WHERE id = $2`,
                [newRem.toFixed(2), row.purchase_lot_id]
              );
            }
          }
        }

        // Reverse Supplier Ledger (Credit back)
        const grandTotal = parseFloat(pReturn.grand_total);
        const lastLedgerRes = await client.query(
          `SELECT balance FROM supplier_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY transaction_date DESC, created_at DESC 
           LIMIT 1`,
          [businessId, pReturn.supplier_party_id]
        );

        const prevBalance = lastLedgerRes.rows.length > 0 ? parseFloat(lastLedgerRes.rows[0].balance) : 0;
        const newBalance = round2(prevBalance + grandTotal);

        await client.query(
          `INSERT INTO supplier_ledgers (
            business_id, party_id, transaction_type, reference_type, reference_id,
            debit, credit, balance, transaction_date, notes, created_by, created_at
          ) VALUES (
            $1, $2, 'CANCELLATION_REVERSAL', 'PURCHASE_RETURN_CANCEL', $3,
            '0.00', $4, $5, NOW(), $6, $7, NOW()
          )`,
          [
            businessId,
            pReturn.supplier_party_id,
            returnId,
            grandTotal.toFixed(2),
            newBalance.toFixed(2),
            `Cancellation reversal of Debit Note ${pReturn.return_number}. Reason: ${reason || 'Cancelled'}`,
            userId || null,
          ]
        );
      }

      // Update status to CANCELLED
      await client.query(
        `UPDATE purchase_returns 
         SET status = 'CANCELLED', notes = COALESCE(notes || E'\\n', '') || $1, updated_at = NOW(), updated_by = $2 
         WHERE id = $3`,
        [`[CANCELLED: ${reason || 'User cancelled'}]`, userId || null, returnId]
      );

      await client.query('COMMIT');

      await AuditService.log({
        businessId,
        userId,
        module: 'purchase',
        action: 'PURCHASE_RETURN_CANCELLED',
        entityType: 'PURCHASE_RETURN',
        entityId: returnId,
        newValue: {
          status: 'CANCELLED',
          reason,
        },
      });

      return await this.getPurchaseReturnById(businessId, returnId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get single Purchase Return by ID with lines and batches
   */
  static async getPurchaseReturnById(businessId: string, returnId: string) {
    const [ret] = await db
      .select({
        purchaseReturn: purchaseReturns,
        supplier: parties,
        invoice: purchaseInvoices,
      })
      .from(purchaseReturns)
      .innerJoin(parties, eq(purchaseReturns.supplierPartyId, parties.id))
      .innerJoin(purchaseInvoices, eq(purchaseReturns.purchaseInvoiceId, purchaseInvoices.id))
      .where(and(eq(purchaseReturns.businessId, businessId), eq(purchaseReturns.id, returnId)))
      .limit(1);

    if (!ret) {
      throw new Error(`Purchase Return not found with ID ${returnId}`);
    }

    const lines = await db
      .select({
        line: purchaseReturnLines,
        uniqueItem: uniqueItems,
      })
      .from(purchaseReturnLines)
      .innerJoin(uniqueItems, eq(purchaseReturnLines.uniqueItemId, uniqueItems.id))
      .where(eq(purchaseReturnLines.purchaseReturnId, returnId));

    const lineIds = lines.map(l => l.line.id);
    let batches: any[] = [];
    if (lineIds.length > 0) {
      batches = await db
        .select({
          lineBatch: purchaseReturnLineBatches,
          batch: opticalBatches,
        })
        .from(purchaseReturnLineBatches)
        .innerJoin(opticalBatches, eq(purchaseReturnLineBatches.batchId, opticalBatches.id))
        .where(inArray(purchaseReturnLineBatches.purchaseReturnLineId, lineIds));
    }

    const batchMap = new Map<string, any[]>();
    for (const b of batches) {
      const lid = b.lineBatch.purchaseReturnLineId;
      if (!batchMap.has(lid)) batchMap.set(lid, []);
      batchMap.get(lid)!.push({
        ...b.lineBatch,
        batch: b.batch,
      });
    }

    return {
      ...ret.purchaseReturn,
      supplier: ret.supplier,
      invoice: ret.invoice,
      lines: lines.map(l => ({
        ...l.line,
        uniqueItem: l.uniqueItem,
        batches: batchMap.get(l.line.id) || [],
      })),
    };
  }

  /**
   * List Purchase Returns with filtering and pagination
   */
  static async getPurchaseReturns(
    businessId: string,
    params: {
      search?: string;
      status?: string;
      supplierPartyId?: string;
      purchaseInvoiceId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const limit = Math.min(params.limit || 50, 100);
    const offset = params.offset || 0;

    let query = db
      .select({
        purchaseReturn: purchaseReturns,
        supplier: parties,
        invoice: purchaseInvoices,
      })
      .from(purchaseReturns)
      .innerJoin(parties, eq(purchaseReturns.supplierPartyId, parties.id))
      .innerJoin(purchaseInvoices, eq(purchaseReturns.purchaseInvoiceId, purchaseInvoices.id))
      .where(eq(purchaseReturns.businessId, businessId))
      .$dynamic();

    const conditions = [eq(purchaseReturns.businessId, businessId)];

    if (params.status) {
      conditions.push(eq(purchaseReturns.status, params.status));
    }
    if (params.supplierPartyId) {
      conditions.push(eq(purchaseReturns.supplierPartyId, params.supplierPartyId));
    }
    if (params.purchaseInvoiceId) {
      conditions.push(eq(purchaseReturns.purchaseInvoiceId, params.purchaseInvoiceId));
    }
    if (params.search) {
      const s = `%${params.search.trim()}%`;
      conditions.push(
        sql`(${purchaseReturns.returnNumber} ILIKE ${s} OR ${parties.name} ILIKE ${s} OR ${purchaseInvoices.invoiceNumber} ILIKE ${s})`
      );
    }

    const items = await query
      .where(and(...conditions))
      .orderBy(desc(purchaseReturns.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseReturns)
      .innerJoin(parties, eq(purchaseReturns.supplierPartyId, parties.id))
      .innerJoin(purchaseInvoices, eq(purchaseReturns.purchaseInvoiceId, purchaseInvoices.id))
      .where(and(...conditions));

    return {
      items: items.map(i => ({
        ...i.purchaseReturn,
        supplier: i.supplier,
        invoice: i.invoice,
      })),
      total: countRes?.count || 0,
      limit,
      offset,
    };
  }
}
