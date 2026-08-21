import { pool, db } from '../db/index.js';
import {
  opticalStocks,
  stockLedger,
  stockReservations,
  opticalBatches,
  uniqueItems,
  primaryItems,
  categories,
  auditLogs,
} from '../db/schema.js';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { AuditService } from './auditService.js';

export type StockAdjustmentType = 'INCREASE' | 'DECREASE';

export type StockAdjustmentReason =
  | 'PHYSICAL_COUNT'
  | 'DAMAGED'
  | 'LOST'
  | 'FOUND'
  | 'DATA_CORRECTION'
  | 'OPENING_CORRECTION'
  | 'EXPIRED'
  | 'OTHER';

export type ReservationStatus = 'ACTIVE' | 'RELEASED' | 'CONVERTED' | 'CANCELLED';

export interface OpeningStockInput {
  batchId: string;
  quantity: number; // pairs
  date?: string | Date;
  reason?: string;
}

export interface StockAdjustmentInput {
  batchId: string;
  adjustmentType: StockAdjustmentType;
  quantity: number; // pairs (positive)
  reason: StockAdjustmentReason | string;
  remarks?: string;
  referenceType?: string;
  referenceId?: string;
}

export interface CreateReservationInput {
  batchId: string;
  quantity: number; // pairs
  referenceType?: string;
  referenceId?: string;
  notes?: string;
}

export interface ConvertReservationInput {
  referenceType?: string;
  referenceId?: string;
  notes?: string;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export class StockService {
  /**
   * Helper: Ensure optical_stocks row exists and lock it FOR UPDATE inside an active transaction client.
   * Returns current physical, reserved, and available stock numbers.
   */
  static async lockAndGetStock(
    client: any,
    businessId: string,
    batchId: string
  ): Promise<{
    stockId: string;
    physicalStock: number;
    reservedStock: number;
    availableStock: number;
  }> {
    // 1. Verify batch belongs to the business
    const batchRes = await client.query(
      `SELECT id, business_id FROM optical_batches WHERE id = $1 AND business_id = $2`,
      [batchId, businessId]
    );

    if (batchRes.rows.length === 0) {
      throw new Error(`Optical batch ${batchId} not found in this business.`);
    }

    // 2. Ensure optical_stocks row exists
    await client.query(
      `INSERT INTO optical_stocks (business_id, batch_id, physical_stock, reserved_stock, available_stock)
       VALUES ($1, $2, '0.00', '0.00', '0.00')
       ON CONFLICT (business_id, batch_id) DO NOTHING`,
      [businessId, batchId]
    );

    // 3. Lock row FOR UPDATE
    const stockRes = await client.query(
      `SELECT id, physical_stock, reserved_stock, available_stock 
       FROM optical_stocks 
       WHERE business_id = $1 AND batch_id = $2 
       FOR UPDATE`,
      [businessId, batchId]
    );

    const row = stockRes.rows[0];
    const physicalStock = round2(parseFloat(row.physical_stock));
    const reservedStock = round2(parseFloat(row.reserved_stock));
    const availableStock = round2(parseFloat(row.available_stock));

    return {
      stockId: row.id,
      physicalStock,
      reservedStock,
      availableStock,
    };
  }

  /**
   * Reads current stock balance for a batch
   */
  static async getStock(businessId: string, batchId: string) {
    const [row] = await db
      .select({
        batchId: opticalStocks.batchId,
        physicalStock: opticalStocks.physicalStock,
        reservedStock: opticalStocks.reservedStock,
        availableStock: opticalStocks.availableStock,
        updatedAt: opticalStocks.updatedAt,
      })
      .from(opticalStocks)
      .where(and(eq(opticalStocks.businessId, businessId), eq(opticalStocks.batchId, batchId)))
      .limit(1);

    if (!row) {
      return {
        batchId,
        physicalStock: 0,
        reservedStock: 0,
        availableStock: 0,
      };
    }

    return {
      batchId: row.batchId,
      physicalStock: round2(parseFloat(row.physicalStock)),
      reservedStock: round2(parseFloat(row.reservedStock)),
      availableStock: round2(parseFloat(row.availableStock)),
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Reads available stock specifically
   */
  static async getAvailableStock(businessId: string, batchId: string): Promise<number> {
    const stock = await this.getStock(businessId, batchId);
    return stock.availableStock;
  }

  /**
   * 1. RECORD OPENING STOCK
   * Increases physical stock and writes an OPENING_STOCK stock ledger entry.
   * Rejects if opening stock was already posted for this batch.
   */
  static async recordOpeningStock(businessId: string, input: OpeningStockInput, userId?: string) {
    const { batchId, reason } = input;
    const quantity = round2(input.quantity);

    if (isNaN(quantity) || quantity <= 0) {
      throw new Error('Opening stock quantity must be a positive number of pairs (e.g. 1.0, 0.5).');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if opening stock already recorded for this batch
      const existingOpening = await client.query(
        `SELECT id FROM stock_ledger 
         WHERE business_id = $1 AND batch_id = $2 AND transaction_type = 'OPENING_STOCK'
         LIMIT 1`,
        [businessId, batchId]
      );

      if (existingOpening.rows.length > 0) {
        throw new Error(
          'Opening stock has already been initialized for this Optical Batch. Please use Stock Adjustment to make quantity corrections.'
        );
      }

      // Lock current stock
      const stock = await this.lockAndGetStock(client, businessId, batchId);

      const newPhysical = round2(stock.physicalStock + quantity);
      const newAvailable = round2(newPhysical - stock.reservedStock);

      // Update optical_stocks
      await client.query(
        `UPDATE optical_stocks 
         SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newPhysical.toFixed(2), newAvailable.toFixed(2), stock.stockId]
      );

      const transactionDate = input.date ? new Date(input.date) : new Date();

      // Write Stock Ledger
      const ledgerRes = await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out, balance,
          reason, created_by, created_at
        ) VALUES ($1, $2, 'OPENING_STOCK', 'MANUAL_ENTRY', NULL, $3, '0.00', '0.00', '0.00', $4, $5, $6, $7)
        RETURNING *`,
        [
          businessId,
          batchId,
          quantity.toFixed(2),
          newPhysical.toFixed(2),
          reason || 'Opening Stock Initial Entry',
          userId || null,
          transactionDate,
        ]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId,
        userId,
        module: 'inventory',
        action: 'OPENING_STOCK',
        entityType: 'StockLedger',
        entityId: ledgerRes.rows[0].id,
        newValue: {
          batchId,
          quantityIn: quantity,
          newPhysical,
          newAvailable,
          reason,
        },
      });

      return {
        success: true,
        batchId,
        quantityIn: quantity,
        physicalStock: newPhysical,
        reservedStock: stock.reservedStock,
        availableStock: newAvailable,
        ledgerEntry: ledgerRes.rows[0],
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 2. STOCK ADJUSTMENT (INCREASE / DECREASE)
   * Mandatory reason. Negative resulting physical stock IS allowed.
   */
  static async adjustStock(businessId: string, input: StockAdjustmentInput, userId?: string) {
    const { batchId, adjustmentType, reason, remarks, referenceType, referenceId } = input;
    const quantity = round2(input.quantity);

    if (isNaN(quantity) || quantity <= 0) {
      throw new Error('Adjustment quantity must be a positive number of pairs (e.g. 1.0, 0.5).');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Stock adjustment reason is mandatory (e.g., PHYSICAL_COUNT, DAMAGED, LOST, FOUND, DATA_CORRECTION).');
    }

    if (adjustmentType !== 'INCREASE' && adjustmentType !== 'DECREASE') {
      throw new Error('Adjustment type must be either INCREASE or DECREASE.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const stock = await this.lockAndGetStock(client, businessId, batchId);

      let newPhysical: number;
      let qtyIn: number;
      let qtyOut: number;

      if (adjustmentType === 'INCREASE') {
        newPhysical = round2(stock.physicalStock + quantity);
        qtyIn = quantity;
        qtyOut = 0;
      } else {
        // DECREASE: Negative physical stock IS allowed
        newPhysical = round2(stock.physicalStock - quantity);
        qtyIn = 0;
        qtyOut = quantity;
      }

      const newAvailable = round2(newPhysical - stock.reservedStock);

      // Update optical_stocks
      await client.query(
        `UPDATE optical_stocks 
         SET physical_stock = $1, available_stock = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newPhysical.toFixed(2), newAvailable.toFixed(2), stock.stockId]
      );

      const fullReasonText = remarks ? `${reason}: ${remarks.trim()}` : reason;

      // Write Stock Ledger
      const ledgerRes = await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out, balance,
          reason, created_by, created_at
        ) VALUES ($1, $2, 'STOCK_ADJUSTMENT', $3, $4, $5, $6, '0.00', '0.00', $7, $8, $9, NOW())
        RETURNING *`,
        [
          businessId,
          batchId,
          referenceType || 'MANUAL_ADJUSTMENT',
          referenceId || null,
          qtyIn.toFixed(2),
          qtyOut.toFixed(2),
          newPhysical.toFixed(2),
          fullReasonText,
          userId || null,
        ]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId,
        userId,
        module: 'inventory',
        action: adjustmentType === 'INCREASE' ? 'STOCK_INCREASE' : 'STOCK_DECREASE',
        entityType: 'StockLedger',
        entityId: ledgerRes.rows[0].id,
        newValue: {
          batchId,
          adjustmentType,
          quantity,
          previousPhysical: stock.physicalStock,
          newPhysical,
          previousAvailable: stock.availableStock,
          newAvailable,
          reason: fullReasonText,
        },
      });

      return {
        success: true,
        batchId,
        adjustmentType,
        quantity,
        previousPhysical: stock.physicalStock,
        physicalStock: newPhysical,
        reservedStock: stock.reservedStock,
        availableStock: newAvailable,
        ledgerEntry: ledgerRes.rows[0],
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 3. CREATE STOCK RESERVATION
   * Does NOT reduce physical stock. Increases reserved stock, reducing available stock.
   * Rejects if requested quantity exceeds current available stock.
   */
  static async createReservation(businessId: string, input: CreateReservationInput, userId?: string) {
    const { batchId, referenceType, referenceId, notes } = input;
    const quantity = round2(input.quantity);

    if (isNaN(quantity) || quantity <= 0) {
      throw new Error('Reservation quantity must be a positive number of pairs (e.g. 1.0, 0.5).');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const stock = await this.lockAndGetStock(client, businessId, batchId);

      // Rule: Requested reservation quantity must not exceed available stock.
      if (quantity > stock.availableStock) {
        throw new Error(
          `Cannot create reservation: Requested quantity (${quantity} prs) exceeds available stock (${stock.availableStock} prs). Current Physical: ${stock.physicalStock} prs, Current Reserved: ${stock.reservedStock} prs.`
        );
      }

      const newReserved = round2(stock.reservedStock + quantity);
      const newAvailable = round2(stock.physicalStock - newReserved);

      // Update optical_stocks
      await client.query(
        `UPDATE optical_stocks 
         SET reserved_stock = $1, available_stock = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newReserved.toFixed(2), newAvailable.toFixed(2), stock.stockId]
      );

      // Create stock_reservations record
      const resIns = await client.query(
        `INSERT INTO stock_reservations (
          business_id, batch_id, quantity, status, reference_type, reference_id, notes, created_by, created_at
        ) VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, $7, NOW())
        RETURNING *`,
        [
          businessId,
          batchId,
          quantity.toFixed(2),
          referenceType || 'MANUAL_HOLD',
          referenceId || null,
          notes || null,
          userId || null,
        ]
      );

      const reservation = resIns.rows[0];

      // Write Stock Ledger (Reservation only, physical balance remains unchanged)
      await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out, balance,
          reason, created_by, created_at
        ) VALUES ($1, $2, 'RESERVATION', $3, $4, '0.00', '0.00', $5, '0.00', $6, $7, $8, NOW())`,
        [
          businessId,
          batchId,
          referenceType || 'MANUAL_HOLD',
          reservation.id,
          quantity.toFixed(2),
          stock.physicalStock.toFixed(2),
          notes ? `Reservation Created: ${notes}` : 'Stock Reservation Hold Created',
          userId || null,
        ]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId,
        userId,
        module: 'inventory',
        action: 'RESERVATION_CREATED',
        entityType: 'StockReservation',
        entityId: reservation.id,
        newValue: {
          batchId,
          quantity,
          referenceType: reservation.reference_type,
          referenceId: reservation.reference_id,
          newReserved,
          newAvailable,
        },
      });

      return {
        success: true,
        reservation,
        physicalStock: stock.physicalStock,
        reservedStock: newReserved,
        availableStock: newAvailable,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 4. RELEASE STOCK RESERVATION
   * Decrements reserved stock and restores available stock.
   * Rejects if already released, converted, or cancelled.
   */
  static async releaseReservation(businessId: string, reservationId: string, userId?: string, reason?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock reservation row
      const resQuery = await client.query(
        `SELECT * FROM stock_reservations WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [reservationId, businessId]
      );

      if (resQuery.rows.length === 0) {
        throw new Error(`Reservation not found with ID ${reservationId}`);
      }

      const reservation = resQuery.rows[0];

      if (reservation.status !== 'ACTIVE') {
        throw new Error(
          `Reservation ${reservationId} cannot be released because its status is already '${reservation.status}'.`
        );
      }

      const quantity = round2(parseFloat(reservation.quantity));
      const batchId = reservation.batch_id;

      // Lock stock row
      const stock = await this.lockAndGetStock(client, businessId, batchId);

      const newReserved = Math.max(0, round2(stock.reservedStock - quantity));
      const newAvailable = round2(stock.physicalStock - newReserved);

      // Update optical_stocks
      await client.query(
        `UPDATE optical_stocks 
         SET reserved_stock = $1, available_stock = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newReserved.toFixed(2), newAvailable.toFixed(2), stock.stockId]
      );

      // Update reservation status to RELEASED
      await client.query(
        `UPDATE stock_reservations 
         SET status = 'RELEASED', released_at = NOW() 
         WHERE id = $1`,
        [reservationId]
      );

      // Write Stock Ledger entry
      await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out, balance,
          reason, created_by, created_at
        ) VALUES ($1, $2, 'RESERVATION_RELEASE', $3, $4, '0.00', '0.00', '0.00', $5, $6, $7, $8, NOW())`,
        [
          businessId,
          batchId,
          reservation.reference_type,
          reservation.id,
          quantity.toFixed(2),
          stock.physicalStock.toFixed(2),
          reason || 'Stock Reservation Released',
          userId || null,
        ]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId,
        userId,
        module: 'inventory',
        action: 'RESERVATION_RELEASED',
        entityType: 'StockReservation',
        entityId: reservationId,
        newValue: {
          quantityReleased: quantity,
          newReserved,
          newAvailable,
          reason,
        },
      });

      return {
        success: true,
        reservationId,
        status: 'RELEASED',
        quantityReleased: quantity,
        physicalStock: stock.physicalStock,
        reservedStock: newReserved,
        availableStock: newAvailable,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 5. CANCEL STOCK RESERVATION
   * Cancelling an ACTIVE reservation releases the reserved stock and sets status to CANCELLED.
   */
  static async cancelReservation(businessId: string, reservationId: string, userId?: string, reason?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const resQuery = await client.query(
        `SELECT * FROM stock_reservations WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [reservationId, businessId]
      );

      if (resQuery.rows.length === 0) {
        throw new Error(`Reservation not found with ID ${reservationId}`);
      }

      const reservation = resQuery.rows[0];

      if (reservation.status !== 'ACTIVE') {
        throw new Error(
          `Reservation ${reservationId} cannot be cancelled because its status is already '${reservation.status}'.`
        );
      }

      const quantity = round2(parseFloat(reservation.quantity));
      const batchId = reservation.batch_id;

      // Lock stock row
      const stock = await this.lockAndGetStock(client, businessId, batchId);

      const newReserved = Math.max(0, round2(stock.reservedStock - quantity));
      const newAvailable = round2(stock.physicalStock - newReserved);

      // Update optical_stocks
      await client.query(
        `UPDATE optical_stocks 
         SET reserved_stock = $1, available_stock = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newReserved.toFixed(2), newAvailable.toFixed(2), stock.stockId]
      );

      // Update reservation status to CANCELLED
      await client.query(
        `UPDATE stock_reservations 
         SET status = 'CANCELLED', cancelled_at = NOW() 
         WHERE id = $1`,
        [reservationId]
      );

      // Write Stock Ledger entry
      await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out, balance,
          reason, created_by, created_at
        ) VALUES ($1, $2, 'RESERVATION_RELEASE', $3, $4, '0.00', '0.00', '0.00', $5, $6, $7, $8, NOW())`,
        [
          businessId,
          batchId,
          reservation.reference_type,
          reservation.id,
          quantity.toFixed(2),
          stock.physicalStock.toFixed(2),
          reason ? `Reservation Cancelled: ${reason}` : 'Stock Reservation Cancelled & Hold Released',
          userId || null,
        ]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId,
        userId,
        module: 'inventory',
        action: 'RESERVATION_CANCELLED',
        entityType: 'StockReservation',
        entityId: reservationId,
        newValue: {
          quantityCancelled: quantity,
          newReserved,
          newAvailable,
          reason,
        },
      });

      return {
        success: true,
        reservationId,
        status: 'CANCELLED',
        quantityCancelled: quantity,
        physicalStock: stock.physicalStock,
        reservedStock: newReserved,
        availableStock: newAvailable,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 6. CONVERT STOCK RESERVATION
   * Consumes the reservation AND reduces physical stock.
   * Used when finalizing a sales invoice or delivery order.
   */
  static async convertReservation(
    businessId: string,
    reservationId: string,
    input: ConvertReservationInput = {},
    userId?: string
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const resQuery = await client.query(
        `SELECT * FROM stock_reservations WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [reservationId, businessId]
      );

      if (resQuery.rows.length === 0) {
        throw new Error(`Reservation not found with ID ${reservationId}`);
      }

      const reservation = resQuery.rows[0];

      if (reservation.status !== 'ACTIVE') {
        throw new Error(
          `Reservation ${reservationId} cannot be converted because its status is already '${reservation.status}'.`
        );
      }

      const quantity = round2(parseFloat(reservation.quantity));
      const batchId = reservation.batch_id;

      // Lock stock row
      const stock = await this.lockAndGetStock(client, businessId, batchId);

      // Conversion reduces physical stock AND reserved stock
      const newPhysical = round2(stock.physicalStock - quantity);
      const newReserved = Math.max(0, round2(stock.reservedStock - quantity));
      const newAvailable = round2(newPhysical - newReserved);

      // Update optical_stocks
      await client.query(
        `UPDATE optical_stocks 
         SET physical_stock = $1, reserved_stock = $2, available_stock = $3, updated_at = NOW() 
         WHERE id = $4`,
        [newPhysical.toFixed(2), newReserved.toFixed(2), newAvailable.toFixed(2), stock.stockId]
      );

      // Update reservation status to CONVERTED
      await client.query(
        `UPDATE stock_reservations 
         SET status = 'CONVERTED', converted_at = NOW(), 
             reference_type = COALESCE($2, reference_type),
             reference_id = COALESCE($3, reference_id)
         WHERE id = $1`,
        [reservationId, input.referenceType || null, input.referenceId || null]
      );

      // Write Stock Ledger entry
      await client.query(
        `INSERT INTO stock_ledger (
          business_id, batch_id, transaction_type, reference_type, reference_id,
          quantity_in, quantity_out, reserved_in, reserved_out, balance,
          reason, created_by, created_at
        ) VALUES ($1, $2, 'RESERVATION_CONVERSION', $3, $4, '0.00', $5, '0.00', $6, $7, $8, $9, NOW())`,
        [
          businessId,
          batchId,
          input.referenceType || reservation.reference_type || 'SALES_INVOICE',
          input.referenceId || reservation.reference_id || reservation.id,
          quantity.toFixed(2),
          quantity.toFixed(2),
          newPhysical.toFixed(2),
          input.notes || 'Reservation converted to sales fulfillment',
          userId || null,
        ]
      );

      await client.query('COMMIT');

      // Audit Log
      await AuditService.log({
        businessId,
        userId,
        module: 'inventory',
        action: 'RESERVATION_CONVERTED',
        entityType: 'StockReservation',
        entityId: reservationId,
        newValue: {
          quantityConverted: quantity,
          newPhysical,
          newReserved,
          newAvailable,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
        },
      });

      return {
        success: true,
        reservationId,
        status: 'CONVERTED',
        quantityConverted: quantity,
        physicalStock: newPhysical,
        reservedStock: newReserved,
        availableStock: newAvailable,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 7. BARCODE-BASED STOCK LOOKUP
   * Resolves optical batch, unique item, category, powers, and real-time stock balances by barcode.
   */
  static async lookupByBarcode(businessId: string, barcode: string) {
    if (!barcode || barcode.trim() === '') {
      throw new Error('Barcode parameter is required.');
    }

    const cleanBarcode = barcode.trim().toUpperCase();

    const [batchRecord] = await db
      .select({
        batch: opticalBatches,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
      })
      .from(opticalBatches)
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .where(and(eq(opticalBatches.businessId, businessId), eq(opticalBatches.barcode, cleanBarcode)))
      .limit(1);

    if (!batchRecord) {
      throw new Error(`No optical batch found with barcode '${cleanBarcode}' in this business.`);
    }

    // Fetch stock
    const stock = await this.getStock(businessId, batchRecord.batch.id);

    return {
      barcode: batchRecord.batch.barcode,
      batchId: batchRecord.batch.id,
      identityKey: batchRecord.batch.identityKey,
      category: {
        id: batchRecord.category.id,
        name: batchRecord.category.name,
        code: batchRecord.category.code,
      },
      primaryItem: {
        id: batchRecord.primaryItem.id,
        name: batchRecord.primaryItem.name,
        code: batchRecord.primaryItem.code,
      },
      uniqueItem: {
        id: batchRecord.uniqueItem.id,
        name: batchRecord.uniqueItem.name,
        code: batchRecord.uniqueItem.code,
        purchaseRate: batchRecord.uniqueItem.purchaseRate,
        mrp: batchRecord.uniqueItem.mrp,
      },
      sph: parseFloat(batchRecord.batch.sph),
      cyl: parseFloat(batchRecord.batch.cyl),
      axis: parseFloat(batchRecord.batch.axis),
      add: parseFloat(batchRecord.batch.add),
      side: batchRecord.batch.side,
      physicalStock: stock.physicalStock,
      reservedStock: stock.reservedStock,
      availableStock: stock.availableStock,
      status: batchRecord.batch.status,
    };
  }

  /**
   * 8. INVENTORY REGISTER & STOCK LISTING
   * Full optical batch stock register with category, item, power, and stock status filters.
   */
  static async getInventoryList(
    businessId: string,
    filters: {
      categoryId?: string;
      uniqueItemId?: string;
      primaryItemId?: string;
      stockStatus?: 'ALL' | 'IN_STOCK' | 'ZERO' | 'NEGATIVE' | 'RESERVED' | 'LOW_STOCK';
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const limit = Math.min(filters.limit || 50, 200);
    const offset = filters.offset || 0;

    let query = db
      .select({
        batch: opticalBatches,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
        stock: opticalStocks,
      })
      .from(opticalBatches)
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .leftJoin(
        opticalStocks,
        and(eq(opticalBatches.id, opticalStocks.batchId), eq(opticalBatches.businessId, opticalStocks.businessId))
      )
      .where(eq(opticalBatches.businessId, businessId));

    const allRows = await query;

    // In-memory filter pipeline for robust composite search and stockStatus
    let filtered = allRows.map((r) => {
      const physical = r.stock ? round2(parseFloat(r.stock.physicalStock)) : 0;
      const reserved = r.stock ? round2(parseFloat(r.stock.reservedStock)) : 0;
      const available = r.stock ? round2(parseFloat(r.stock.availableStock)) : 0;

      let computedStatus = 'ZERO';
      if (physical > 0) computedStatus = 'IN_STOCK';
      else if (physical < 0) computedStatus = 'NEGATIVE';

      return {
        batchId: r.batch.id,
        barcode: r.batch.barcode,
        identityKey: r.batch.identityKey,
        categoryId: r.category.id,
        categoryName: r.category.name,
        categoryCode: r.category.code,
        primaryItemId: r.primaryItem.id,
        primaryItemName: r.primaryItem.name,
        primaryItemCode: r.primaryItem.code,
        uniqueItemId: r.uniqueItem.id,
        uniqueItemName: r.uniqueItem.name,
        uniqueItemCode: r.uniqueItem.code,
        purchaseRate: parseFloat(r.uniqueItem.purchaseRate || '0'),
        mrp: parseFloat(r.uniqueItem.mrp || '0'),
        sph: parseFloat(r.batch.sph),
        cyl: parseFloat(r.batch.cyl),
        axis: parseFloat(r.batch.axis),
        add: parseFloat(r.batch.add),
        side: r.batch.side,
        physicalStock: physical,
        reservedStock: reserved,
        availableStock: available,
        stockStatus: computedStatus,
        hasReservation: reserved > 0,
        status: r.batch.status,
        updatedAt: r.stock?.updatedAt || r.batch.updatedAt,
      };
    });

    if (filters.categoryId) {
      filtered = filtered.filter((r) => r.categoryId === filters.categoryId);
    }
    if (filters.uniqueItemId) {
      filtered = filtered.filter((r) => r.uniqueItemId === filters.uniqueItemId);
    }
    if (filters.primaryItemId) {
      filtered = filtered.filter((r) => r.primaryItemId === filters.primaryItemId);
    }

    if (filters.stockStatus && filters.stockStatus !== 'ALL') {
      if (filters.stockStatus === 'IN_STOCK') {
        filtered = filtered.filter((r) => r.physicalStock > 0);
      } else if (filters.stockStatus === 'ZERO') {
        filtered = filtered.filter((r) => r.physicalStock === 0);
      } else if (filters.stockStatus === 'NEGATIVE') {
        filtered = filtered.filter((r) => r.physicalStock < 0);
      } else if (filters.stockStatus === 'RESERVED') {
        filtered = filtered.filter((r) => r.reservedStock > 0);
      } else if (filters.stockStatus === 'LOW_STOCK') {
        filtered = filtered.filter((r) => r.physicalStock > 0 && r.physicalStock <= 2);
      }
    }

    if (filters.search && filters.search.trim() !== '') {
      const q = filters.search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.barcode.toLowerCase().includes(q) ||
          r.uniqueItemName.toLowerCase().includes(q) ||
          r.uniqueItemCode.toLowerCase().includes(q) ||
          r.primaryItemName.toLowerCase().includes(q) ||
          r.categoryName.toLowerCase().includes(q) ||
          r.identityKey.toLowerCase().includes(q)
      );
    }

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      items: paginated,
      total,
      limit,
      offset,
    };
  }

  /**
   * 9. BATCH STOCK DETAIL & CHRONOLOGICAL STOCK LEDGER
   * Returns complete batch specs, current stock, and chronological ledger movements.
   */
  static async getBatchStockDetail(businessId: string, batchId: string) {
    const [batchRecord] = await db
      .select({
        batch: opticalBatches,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
      })
      .from(opticalBatches)
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .where(and(eq(opticalBatches.businessId, businessId), eq(opticalBatches.id, batchId)))
      .limit(1);

    if (!batchRecord) {
      throw new Error(`Optical batch not found with ID ${batchId}`);
    }

    const stock = await this.getStock(businessId, batchId);

    // Fetch chronological stock ledger
    const ledger = await db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.businessId, businessId), eq(stockLedger.batchId, batchId)))
      .orderBy(desc(stockLedger.createdAt));

    // Fetch active and past reservations
    const reservations = await db
      .select()
      .from(stockReservations)
      .where(and(eq(stockReservations.businessId, businessId), eq(stockReservations.batchId, batchId)))
      .orderBy(desc(stockReservations.createdAt));

    return {
      batch: {
        id: batchRecord.batch.id,
        barcode: batchRecord.batch.barcode,
        identityKey: batchRecord.batch.identityKey,
        sph: parseFloat(batchRecord.batch.sph),
        cyl: parseFloat(batchRecord.batch.cyl),
        axis: parseFloat(batchRecord.batch.axis),
        add: parseFloat(batchRecord.batch.add),
        side: batchRecord.batch.side,
        status: batchRecord.batch.status,
      },
      category: batchRecord.category,
      primaryItem: batchRecord.primaryItem,
      uniqueItem: batchRecord.uniqueItem,
      stock,
      ledger: ledger.map((l) => ({
        id: l.id,
        transactionType: l.transactionType,
        referenceType: l.referenceType,
        referenceId: l.referenceId,
        quantityIn: parseFloat(l.quantityIn),
        quantityOut: parseFloat(l.quantityOut),
        reservedIn: parseFloat(l.reservedIn),
        reservedOut: parseFloat(l.reservedOut),
        balance: parseFloat(l.balance),
        reason: l.reason,
        createdBy: l.createdBy,
        createdAt: l.createdAt,
      })),
      reservations: reservations.map((r) => ({
        id: r.id,
        quantity: parseFloat(r.quantity),
        status: r.status,
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        notes: r.notes,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        releasedAt: r.releasedAt,
        convertedAt: r.convertedAt,
        cancelledAt: r.cancelledAt,
      })),
    };
  }

  /**
   * 10. LIST RESERVATIONS
   */
  static async getReservations(
    businessId: string,
    filters: {
      status?: ReservationStatus | string;
      batchId?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    let query = db
      .select({
        reservation: stockReservations,
        batch: opticalBatches,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
      })
      .from(stockReservations)
      .innerJoin(opticalBatches, eq(stockReservations.batchId, opticalBatches.id))
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .where(eq(stockReservations.businessId, businessId));

    const rows = await query;

    let filtered = rows.map((r) => ({
      id: r.reservation.id,
      batchId: r.batch.id,
      barcode: r.batch.barcode,
      identityKey: r.batch.identityKey,
      categoryName: r.category.name,
      primaryItemName: r.primaryItem.name,
      uniqueItemName: r.uniqueItem.name,
      sph: parseFloat(r.batch.sph),
      cyl: parseFloat(r.batch.cyl),
      axis: parseFloat(r.batch.axis),
      add: parseFloat(r.batch.add),
      side: r.batch.side,
      quantity: parseFloat(r.reservation.quantity),
      status: r.reservation.status as ReservationStatus,
      referenceType: r.reservation.referenceType,
      referenceId: r.reservation.referenceId,
      notes: r.reservation.notes,
      createdBy: r.reservation.createdBy,
      createdAt: r.reservation.createdAt,
      releasedAt: r.reservation.releasedAt,
      convertedAt: r.reservation.convertedAt,
      cancelledAt: r.reservation.cancelledAt,
    }));

    if (filters.status && filters.status !== 'ALL') {
      filtered = filtered.filter((r) => r.status === filters.status);
    }
    if (filters.batchId) {
      filtered = filtered.filter((r) => r.batchId === filters.batchId);
    }

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      items: paginated,
      total,
      limit,
      offset,
    };
  }

  /**
   * 11. LIST OPENING STOCK HISTORY
   */
  static async getOpeningStockHistory(
    businessId: string,
    filters: { limit?: number; offset?: number } = {}
  ) {
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    const rows = await db
      .select({
        ledger: stockLedger,
        batch: opticalBatches,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
      })
      .from(stockLedger)
      .innerJoin(opticalBatches, eq(stockLedger.batchId, opticalBatches.id))
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .where(
        and(
          eq(stockLedger.businessId, businessId),
          eq(stockLedger.transactionType, 'OPENING_STOCK')
        )
      )
      .orderBy(desc(stockLedger.createdAt));

    const total = rows.length;
    const paginated = rows.slice(offset, offset + limit).map((r) => ({
      id: r.ledger.id,
      batchId: r.batch.id,
      barcode: r.batch.barcode,
      identityKey: r.batch.identityKey,
      categoryName: r.category.name,
      primaryItemName: r.primaryItem.name,
      uniqueItemName: r.uniqueItem.name,
      sph: parseFloat(r.batch.sph),
      cyl: parseFloat(r.batch.cyl),
      axis: parseFloat(r.batch.axis),
      add: parseFloat(r.batch.add),
      side: r.batch.side,
      quantityIn: parseFloat(r.ledger.quantityIn),
      balance: parseFloat(r.ledger.balance),
      reason: r.ledger.reason,
      createdAt: r.ledger.createdAt,
    }));

    return {
      items: paginated,
      total,
      limit,
      offset,
    };
  }

  /**
   * 12. LIST STOCK ADJUSTMENT HISTORY
   */
  static async getAdjustmentHistory(
    businessId: string,
    filters: { limit?: number; offset?: number } = {}
  ) {
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    const rows = await db
      .select({
        ledger: stockLedger,
        batch: opticalBatches,
        uniqueItem: uniqueItems,
        primaryItem: primaryItems,
        category: categories,
      })
      .from(stockLedger)
      .innerJoin(opticalBatches, eq(stockLedger.batchId, opticalBatches.id))
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .where(
        and(
          eq(stockLedger.businessId, businessId),
          eq(stockLedger.transactionType, 'STOCK_ADJUSTMENT')
        )
      )
      .orderBy(desc(stockLedger.createdAt));

    const total = rows.length;
    const paginated = rows.slice(offset, offset + limit).map((r) => {
      const qtyIn = parseFloat(r.ledger.quantityIn);
      const qtyOut = parseFloat(r.ledger.quantityOut);
      const isIncrease = qtyIn > 0;

      return {
        id: r.ledger.id,
        batchId: r.batch.id,
        barcode: r.batch.barcode,
        identityKey: r.batch.identityKey,
        categoryName: r.category.name,
        primaryItemName: r.primaryItem.name,
        uniqueItemName: r.uniqueItem.name,
        sph: parseFloat(r.batch.sph),
        cyl: parseFloat(r.batch.cyl),
        axis: parseFloat(r.batch.axis),
        add: parseFloat(r.batch.add),
        side: r.batch.side,
        adjustmentType: isIncrease ? 'INCREASE' : 'DECREASE',
        quantity: isIncrease ? qtyIn : qtyOut,
        balance: parseFloat(r.ledger.balance),
        reason: r.ledger.reason,
        createdAt: r.ledger.createdAt,
      };
    });

    return {
      items: paginated,
      total,
      limit,
      offset,
    };
  }
}
