/**
 * Phase 3 — Stock Operations, Opening Stock, Adjustments & Reservations Test Suite
 * Comprehensive 25-Scenario Verification Suite covering:
 * 1. Initial Opening Stock posting & balance updates
 * 2. Stock Ledger correctness on Opening Stock
 * 3. Duplicate Opening Stock rejection
 * 4. Positive Stock Adjustment (INCREASE)
 * 5. Negative Stock Adjustment (DECREASE)
 * 6. Negative Physical Stock allowance
 * 7. Stock Adjustment mandatory reason validation
 * 8. Stock Adjustment ledger audit correctness
 * 9. Reservation creation within available stock limits
 * 10. Reservation stock balance invariant (Physical constant, Reserved increases, Available decreases)
 * 11. Reservation Stock Ledger audit trail
 * 12. Reservation rejection when requested quantity > available stock
 * 13. Reservation rejection when available stock is negative
 * 14. Release Reservation restores available stock
 * 15. Release Reservation updates status to RELEASED and writes RESERVATION_RELEASE ledger entry
 * 16. Cancel Reservation restores available stock and sets status to CANCELLED
 * 17. Re-release / Re-cancel idempotency & status protection
 * 18. Convert Reservation consumes reservation & decrements physical stock
 * 19. Convert Reservation rejects inactive reservations
 * 20. Barcode-based real-time stock lookup
 * 21. Inventory listing & stock status filtering
 * 22. Concurrent reservation race condition safety (FOR UPDATE locking)
 * 23. Multi-business tenant isolation
 * 24. Fractional pairs decimal arithmetic precision (e.g. 0.50, 1.25)
 * 25. Complete audit logging on all stock operations
 */

import { pool, db } from '../db/index.js';
import {
  businesses,
  categories,
  coatings,
  bases,
  primaryItems,
  uniqueItems,
  opticalBatches,
  opticalStocks,
  stockLedger,
  stockReservations,
  auditLogs,
} from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { StockService } from '../services/stockService.js';
import { findOrCreateOpticalBatch } from '../services/opticalMasterService.js';
import { seedInitialDatabase } from '../db/seed.js';

export interface TestResult {
  scenario: number;
  title: string;
  passed: boolean;
  error?: string;
  details?: any;
}

export async function runPhase3StockTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}> {
  console.log('====================================================');
  console.log('STARTING PHASE 3 STOCK OPERATIONS & RESERVATIONS TEST SUITE');
  console.log('====================================================\n');

  const results: TestResult[] = [];

  // Setup: Business A and Business B
  const [bizA] = await db.select().from(businesses).where(eq(businesses.status, 'ACTIVE')).limit(1);
  if (!bizA) throw new Error('Default business not found');

  let [bizB] = await db.select().from(businesses).where(eq(businesses.name, 'VisionCraft Optical Labs')).limit(1);
  if (!bizB) {
    const [inserted] = await db
      .insert(businesses)
      .values({
        name: 'VisionCraft Optical Labs',
        tradeName: 'VisionCraft Labs',
        gstin: '27AABCV1234F1Z8',
        currency: 'INR',
        status: 'ACTIVE',
      })
      .returning();
    bizB = inserted;
  }

  // Setup test categories & items
  let [catSV] = await db.select().from(categories).where(eq(categories.code, 'SV')).limit(1);
  if (!catSV) {
    const [firstCat] = await db.select().from(categories).limit(1);
    catSV = firstCat;
  }
  if (!catSV) {
    const [insertedCat] = await db
      .insert(categories)
      .values({
        businessId: bizA.id,
        name: 'Single Vision',
        code: 'SV',
        description: 'Single vision optical lenses',
        status: 'ACTIVE',
      })
      .returning();
    catSV = insertedCat;
  }

  // Create isolated primary & unique test items for testing
  const testTimestamp = Date.now().toString(36);

  const [coat1] = await db
    .insert(coatings)
    .values({
      businessId: bizA.id,
      code: `HC_${testTimestamp}`.toUpperCase(),
      name: `Hard Coat ${testTimestamp}`,
    })
    .returning();

  const [base1] = await db
    .insert(bases)
    .values({
      businessId: bizA.id,
      code: `CR39_${testTimestamp}`.toUpperCase(),
      name: `CR-39 Standard ${testTimestamp}`,
      family: 'CLEAR',
      coatingId: coat1.id,
    })
    .returning();

  const [primaryItemA] = await db
    .insert(primaryItems)
    .values({
      businessId: bizA.id,
      categoryId: catSV.id,
      baseId: base1.id,
      coatingId: coat1.id,
      name: `Test SV Lens ${testTimestamp}`,
      code: `TSV-${testTimestamp}`.toUpperCase(),
    })
    .returning();

  const [uniqueItemA] = await db
    .insert(uniqueItems)
    .values({
      businessId: bizA.id,
      primaryItemId: primaryItemA.id,
      name: `Test BlueCoat 1.56 ${testTimestamp}`,
      code: `U-TSV-${testTimestamp}`.toUpperCase(),
      purchaseRate: '500.00',
      mrp: '1200.00',
    })
    .returning();

  // Create 4 distinct optical batches for various scenarios
  const batch1Res = await findOrCreateOpticalBatch({
    businessId: bizA.id,
    uniqueItemId: uniqueItemA.id,
    sph: -1.5,
    cyl: -0.5,
    axis: 0,
    add: 0,
    side: 'NONE',
  });
  const batch1Id = batch1Res.batch.id;

  const batch2Res = await findOrCreateOpticalBatch({
    businessId: bizA.id,
    uniqueItemId: uniqueItemA.id,
    sph: -2.0,
    cyl: 0,
    axis: 0,
    add: 0,
    side: 'NONE',
  });
  const batch2Id = batch2Res.batch.id;

  const batch3Res = await findOrCreateOpticalBatch({
    businessId: bizA.id,
    uniqueItemId: uniqueItemA.id,
    sph: +1.0,
    cyl: -0.25,
    axis: 0,
    add: 0,
    side: 'NONE',
  });
  const batch3Id = batch3Res.batch.id;

  const batch4Res = await findOrCreateOpticalBatch({
    businessId: bizA.id,
    uniqueItemId: uniqueItemA.id,
    sph: 0,
    cyl: 0,
    axis: 0,
    add: 0,
    side: 'NONE',
  });
  const batch4Id = batch4Res.batch.id;

  console.log(`[Test Setup] Business A: ${bizA.name} (${bizA.id})`);
  console.log(`[Test Setup] Test Batches Created: Batch 1 (${batch1Id}), Batch 2 (${batch2Id}), Batch 3 (${batch3Id}), Batch 4 (${batch4Id})\n`);

  // =========================================================================
  // SCENARIO 1: Initial Opening Stock increases Physical and Available stock
  // =========================================================================
  try {
    const res = await StockService.recordOpeningStock(bizA.id, {
      batchId: batch1Id,
      quantity: 10.0,
      reason: 'Physical count verified from legacy ledger',
    });

    const stock = await StockService.getStock(bizA.id, batch1Id);

    if (stock.physicalStock === 10.0 && stock.reservedStock === 0 && stock.availableStock === 10.0) {
      results.push({
        scenario: 1,
        title: 'Initial Opening Stock increases Physical and Available stock by exact pairs',
        passed: true,
        details: { physical: stock.physicalStock, available: stock.availableStock },
      });
    } else {
      throw new Error(`Stock mismatch: Expected physical=10, available=10. Got physical=${stock.physicalStock}, available=${stock.availableStock}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 1,
      title: 'Initial Opening Stock increases Physical and Available stock by exact pairs',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 2: Opening Stock writes correct Stock Ledger record
  // =========================================================================
  try {
    const [ledgerEntry] = await db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.businessId, bizA.id), eq(stockLedger.batchId, batch1Id), eq(stockLedger.transactionType, 'OPENING_STOCK')))
      .limit(1);

    if (
      ledgerEntry &&
      parseFloat(ledgerEntry.quantityIn) === 10.0 &&
      parseFloat(ledgerEntry.quantityOut) === 0 &&
      parseFloat(ledgerEntry.balance) === 10.0
    ) {
      results.push({
        scenario: 2,
        title: 'Opening Stock writes correct Stock Ledger record (type OPENING_STOCK, quantity_in, balance)',
        passed: true,
        details: { ledgerId: ledgerEntry.id, balance: ledgerEntry.balance },
      });
    } else {
      throw new Error(`Ledger entry mismatch or missing. Found: ${JSON.stringify(ledgerEntry)}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 2,
      title: 'Opening Stock writes correct Stock Ledger record (type OPENING_STOCK, quantity_in, balance)',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 3: Duplicate Opening Stock rejection
  // =========================================================================
  try {
    let duplicateRejected = false;
    try {
      await StockService.recordOpeningStock(bizA.id, {
        batchId: batch1Id,
        quantity: 5.0,
        reason: 'Attempting second opening stock',
      });
    } catch (e: any) {
      duplicateRejected = true;
      if (!e.message.toLowerCase().includes('already been initialized')) {
        throw new Error(`Expected error about already initialized opening stock, got: ${e.message}`);
      }
    }

    if (duplicateRejected) {
      results.push({
        scenario: 3,
        title: 'Duplicate Opening Stock rejection on same batch',
        passed: true,
      });
    } else {
      throw new Error('Duplicate opening stock was improperly permitted!');
    }
  } catch (err: any) {
    results.push({
      scenario: 3,
      title: 'Duplicate Opening Stock rejection on same batch',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 4: Positive Stock Adjustment (INCREASE)
  // =========================================================================
  try {
    const adjRes = await StockService.adjustStock(bizA.id, {
      batchId: batch1Id,
      adjustmentType: 'INCREASE',
      quantity: 4.0,
      reason: 'FOUND',
      remarks: 'Found in showcase display drawer',
    });

    const stock = await StockService.getStock(bizA.id, batch1Id);

    if (stock.physicalStock === 14.0 && stock.availableStock === 14.0) {
      results.push({
        scenario: 4,
        title: 'Positive Stock Adjustment (INCREASE) increases Physical and Available stock',
        passed: true,
        details: { physical: stock.physicalStock, available: stock.availableStock },
      });
    } else {
      throw new Error(`Expected physical 14, got ${stock.physicalStock}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 4,
      title: 'Positive Stock Adjustment (INCREASE) increases Physical and Available stock',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 5: Negative Stock Adjustment (DECREASE)
  // =========================================================================
  try {
    const adjRes = await StockService.adjustStock(bizA.id, {
      batchId: batch1Id,
      adjustmentType: 'DECREASE',
      quantity: 2.0,
      reason: 'DAMAGED',
      remarks: 'Scratched lens during inspection',
    });

    const stock = await StockService.getStock(bizA.id, batch1Id);

    if (stock.physicalStock === 12.0 && stock.availableStock === 12.0) {
      results.push({
        scenario: 5,
        title: 'Negative Stock Adjustment (DECREASE) decreases Physical and Available stock',
        passed: true,
        details: { physical: stock.physicalStock, available: stock.availableStock },
      });
    } else {
      throw new Error(`Expected physical 12, got ${stock.physicalStock}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 5,
      title: 'Negative Stock Adjustment (DECREASE) decreases Physical and Available stock',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 6: Negative Physical Stock allowance
  // =========================================================================
  try {
    // batch2 has 0 initial stock, adjust downwards by 3 pairs
    await StockService.adjustStock(bizA.id, {
      batchId: batch2Id,
      adjustmentType: 'DECREASE',
      quantity: 3.0,
      reason: 'PHYSICAL_COUNT',
      remarks: 'Urgent optical delivery before invoice entry',
    });

    const stock = await StockService.getStock(bizA.id, batch2Id);

    if (stock.physicalStock === -3.0 && stock.availableStock === -3.0) {
      results.push({
        scenario: 6,
        title: 'Negative Physical Stock allowance (no zero clamping)',
        passed: true,
        details: { physical: stock.physicalStock, available: stock.availableStock },
      });
    } else {
      throw new Error(`Expected physical -3, got ${stock.physicalStock}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 6,
      title: 'Negative Physical Stock allowance (no zero clamping)',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 7: Stock Adjustment mandatory reason validation
  // =========================================================================
  try {
    let missingReasonRejected = false;
    try {
      await StockService.adjustStock(bizA.id, {
        batchId: batch1Id,
        adjustmentType: 'INCREASE',
        quantity: 1.0,
        reason: '',
      });
    } catch (e: any) {
      missingReasonRejected = true;
    }

    if (missingReasonRejected) {
      results.push({
        scenario: 7,
        title: 'Stock Adjustment mandatory reason validation',
        passed: true,
      });
    } else {
      throw new Error('Stock adjustment without reason was improperly permitted!');
    }
  } catch (err: any) {
    results.push({
      scenario: 7,
      title: 'Stock Adjustment mandatory reason validation',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 8: Stock Adjustment ledger entry records accurate balance
  // =========================================================================
  try {
    const ledgerEntries = await db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.businessId, bizA.id), eq(stockLedger.batchId, batch2Id)))
      .limit(1);

    const entry = ledgerEntries[0];
    if (entry && entry.transactionType === 'STOCK_ADJUSTMENT' && parseFloat(entry.quantityOut) === 3.0 && parseFloat(entry.balance) === -3.0) {
      results.push({
        scenario: 8,
        title: 'Stock Adjustment ledger audit records accurate balance and quantity direction',
        passed: true,
        details: { balance: entry.balance, qtyOut: entry.quantityOut },
      });
    } else {
      throw new Error(`Invalid ledger entry for adjustment: ${JSON.stringify(entry)}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 8,
      title: 'Stock Adjustment ledger audit records accurate balance and quantity direction',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 9: Stock Reservation creation succeeds when requested quantity <= available stock
  // =========================================================================
  let testResId1 = '';
  try {
    // batch1 has 12 available. Reserve 4 pairs.
    const res = await StockService.createReservation(bizA.id, {
      batchId: batch1Id,
      quantity: 4.0,
      referenceType: 'MANUAL_HOLD',
      notes: 'Hold for Dr. Sharma Clinic Rx Order #1042',
    });

    testResId1 = res.reservation.id;

    if (res.success && res.reservedStock === 4.0 && res.availableStock === 8.0) {
      results.push({
        scenario: 9,
        title: 'Stock Reservation creation succeeds when requested quantity <= available stock',
        passed: true,
        details: { resId: testResId1, reserved: res.reservedStock, available: res.availableStock },
      });
    } else {
      throw new Error(`Reservation balance error: reserved=${res.reservedStock}, available=${res.availableStock}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 9,
      title: 'Stock Reservation creation succeeds when requested quantity <= available stock',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 10: Stock Reservation stock balance invariant
  // =========================================================================
  try {
    const stock = await StockService.getStock(bizA.id, batch1Id);

    // Physical must remain 12.0, Reserved 4.0, Available 8.0
    if (stock.physicalStock === 12.0 && stock.reservedStock === 4.0 && stock.availableStock === 8.0) {
      results.push({
        scenario: 10,
        title: 'Stock Reservation invariant: Physical constant (12), Reserved increases (4), Available decreases (8)',
        passed: true,
        details: stock,
      });
    } else {
      throw new Error(`Invariant violated: ${JSON.stringify(stock)}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 10,
      title: 'Stock Reservation invariant: Physical constant, Reserved increases, Available decreases',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 11: Stock Reservation Stock Ledger audit trail
  // =========================================================================
  try {
    const [resLedger] = await db
      .select()
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.businessId, bizA.id),
          eq(stockLedger.batchId, batch1Id),
          eq(stockLedger.transactionType, 'RESERVATION')
        )
      )
      .limit(1);

    if (
      resLedger &&
      parseFloat(resLedger.reservedIn) === 4.0 &&
      parseFloat(resLedger.quantityIn) === 0 &&
      parseFloat(resLedger.quantityOut) === 0 &&
      parseFloat(resLedger.balance) === 12.0
    ) {
      results.push({
        scenario: 11,
        title: 'Stock Reservation Stock Ledger audit trail (reserved_in=4.0, physical balance=12.0)',
        passed: true,
        details: { ledgerId: resLedger.id, reservedIn: resLedger.reservedIn },
      });
    } else {
      throw new Error(`Reservation ledger entry mismatch: ${JSON.stringify(resLedger)}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 11,
      title: 'Stock Reservation Stock Ledger audit trail (reserved_in=4.0, physical balance=12.0)',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 12: Reservation rejection when requested quantity > available stock
  // =========================================================================
  try {
    // Current available is 8.0. Attempt to reserve 10.0.
    let overReserveRejected = false;
    try {
      await StockService.createReservation(bizA.id, {
        batchId: batch1Id,
        quantity: 10.0,
        referenceType: 'MANUAL_HOLD',
      });
    } catch (e: any) {
      overReserveRejected = true;
      if (!e.message.includes('exceeds available stock')) {
        throw new Error(`Expected exceeds available stock message, got: ${e.message}`);
      }
    }

    if (overReserveRejected) {
      results.push({
        scenario: 12,
        title: 'Reservation rejection when requested quantity > available stock',
        passed: true,
      });
    } else {
      throw new Error('Over-reservation was improperly permitted!');
    }
  } catch (err: any) {
    results.push({
      scenario: 12,
      title: 'Reservation rejection when requested quantity > available stock',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 13: Reservation rejection when available stock is negative
  // =========================================================================
  try {
    // batch2 has physical -3.0, available -3.0. Attempt to reserve 1.0.
    let negativeReserveRejected = false;
    try {
      await StockService.createReservation(bizA.id, {
        batchId: batch2Id,
        quantity: 1.0,
        referenceType: 'MANUAL_HOLD',
      });
    } catch (e: any) {
      negativeReserveRejected = true;
    }

    if (negativeReserveRejected) {
      results.push({
        scenario: 13,
        title: 'Reservation rejection when available stock is negative',
        passed: true,
      });
    } else {
      throw new Error('Reservation on negative available stock was improperly permitted!');
    }
  } catch (err: any) {
    results.push({
      scenario: 13,
      title: 'Reservation rejection when available stock is negative',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 14: Release Reservation restores available stock
  // =========================================================================
  try {
    const relRes = await StockService.releaseReservation(
      bizA.id,
      testResId1,
      undefined,
      'Customer cancelled Rx order'
    );

    const stock = await StockService.getStock(bizA.id, batch1Id);

    if (stock.physicalStock === 12.0 && stock.reservedStock === 0 && stock.availableStock === 12.0) {
      results.push({
        scenario: 14,
        title: 'Release Reservation restores reserved stock to 0 and available stock to 12',
        passed: true,
        details: stock,
      });
    } else {
      throw new Error(`Stock mismatch after release: ${JSON.stringify(stock)}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 14,
      title: 'Release Reservation restores reserved stock to 0 and available stock to 12',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 15: Release Reservation updates status & writes RESERVATION_RELEASE ledger entry
  // =========================================================================
  try {
    const [resRow] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, testResId1))
      .limit(1);

    const [releaseLedger] = await db
      .select()
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.businessId, bizA.id),
          eq(stockLedger.batchId, batch1Id),
          eq(stockLedger.transactionType, 'RESERVATION_RELEASE')
        )
      )
      .limit(1);

    if (
      resRow &&
      resRow.status === 'RELEASED' &&
      releaseLedger &&
      parseFloat(releaseLedger.reservedOut) === 4.0
    ) {
      results.push({
        scenario: 15,
        title: 'Release Reservation updates status to RELEASED and writes RESERVATION_RELEASE (reserved_out=4.0)',
        passed: true,
        details: { status: resRow.status, reservedOut: releaseLedger.reservedOut },
      });
    } else {
      throw new Error(`Release status or ledger mismatch: ${JSON.stringify({ resRow, releaseLedger })}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 15,
      title: 'Release Reservation updates status to RELEASED and writes RESERVATION_RELEASE',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 16: Cancel Reservation restores available stock and sets status to CANCELLED
  // =========================================================================
  let testResId2 = '';
  try {
    // Create new reservation of 3 pairs
    const res = await StockService.createReservation(bizA.id, {
      batchId: batch1Id,
      quantity: 3.0,
      notes: 'Temporary hold for VIP customer',
    });
    testResId2 = res.reservation.id;

    // Cancel reservation
    await StockService.cancelReservation(bizA.id, testResId2, undefined, 'VIP opted for different progressive lens');

    const stock = await StockService.getStock(bizA.id, batch1Id);
    const [cancelledRes] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, testResId2))
      .limit(1);

    if (
      cancelledRes &&
      cancelledRes.status === 'CANCELLED' &&
      stock.reservedStock === 0 &&
      stock.availableStock === 12.0
    ) {
      results.push({
        scenario: 16,
        title: 'Cancel Reservation restores available stock and sets status to CANCELLED',
        passed: true,
        details: { status: cancelledRes.status, available: stock.availableStock },
      });
    } else {
      throw new Error(`Cancellation verification failed: ${JSON.stringify({ cancelledRes, stock })}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 16,
      title: 'Cancel Reservation restores available stock and sets status to CANCELLED',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 17: Re-release / Re-cancel idempotency & status protection
  // =========================================================================
  try {
    let reReleaseBlocked = false;
    try {
      await StockService.releaseReservation(bizA.id, testResId1);
    } catch (e: any) {
      reReleaseBlocked = true;
    }

    let reCancelBlocked = false;
    try {
      await StockService.cancelReservation(bizA.id, testResId2);
    } catch (e: any) {
      reCancelBlocked = true;
    }

    if (reReleaseBlocked && reCancelBlocked) {
      results.push({
        scenario: 17,
        title: 'Re-releasing or re-cancelling inactive reservations is rejected with error',
        passed: true,
      });
    } else {
      throw new Error('Re-release or re-cancel on inactive reservation was not properly rejected!');
    }
  } catch (err: any) {
    results.push({
      scenario: 17,
      title: 'Re-releasing or re-cancelling inactive reservations is rejected with error',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 18: Convert Reservation consumes reservation & decrements physical stock
  // =========================================================================
  let testResId3 = '';
  try {
    // Current stock: physical=12, reserved=0, available=12.
    // Create reservation of 5 pairs
    const res = await StockService.createReservation(bizA.id, {
      batchId: batch1Id,
      quantity: 5.0,
      referenceType: 'SALES_ORDER',
      referenceId: 'SO-1092',
      notes: 'Customer confirmed frame and lens order',
    });
    testResId3 = res.reservation.id;

    // Convert reservation to sales delivery
    const convRes = await StockService.convertReservation(bizA.id, testResId3, {
      referenceType: 'SALES_INVOICE',
      referenceId: 'INV-2026-0045',
      notes: 'Delivered to customer at counter',
    });

    const stock = await StockService.getStock(bizA.id, batch1Id);
    const [convRow] = await db
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, testResId3))
      .limit(1);

    // After conversion of 5 pairs:
    // Physical becomes 12 - 5 = 7.0
    // Reserved becomes 5 - 5 = 0.0
    // Available becomes 7 - 0 = 7.0
    if (
      convRow &&
      convRow.status === 'CONVERTED' &&
      stock.physicalStock === 7.0 &&
      stock.reservedStock === 0.0 &&
      stock.availableStock === 7.0
    ) {
      results.push({
        scenario: 18,
        title: 'Convert Reservation consumes reservation (status=CONVERTED) & decrements physical stock (12 -> 7)',
        passed: true,
        details: stock,
      });
    } else {
      throw new Error(`Conversion balance mismatch: status=${convRow?.status}, physical=${stock.physicalStock}, reserved=${stock.reservedStock}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 18,
      title: 'Convert Reservation consumes reservation & decrements physical stock',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 19: Convert Reservation rejects inactive reservations
  // =========================================================================
  try {
    let reConvertRejected = false;
    try {
      await StockService.convertReservation(bizA.id, testResId3, {
        referenceType: 'SALES_INVOICE',
      });
    } catch (e: any) {
      reConvertRejected = true;
    }

    if (reConvertRejected) {
      results.push({
        scenario: 19,
        title: 'Converting an already converted or inactive reservation is rejected',
        passed: true,
      });
    } else {
      throw new Error('Re-converting a converted reservation was improperly permitted!');
    }
  } catch (err: any) {
    results.push({
      scenario: 19,
      title: 'Converting an already converted or inactive reservation is rejected',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 20: Barcode-based real-time stock lookup
  // =========================================================================
  try {
    const batch1Row = (await db.select().from(opticalBatches).where(eq(opticalBatches.id, batch1Id)).limit(1))[0];
    const barcodeLookup = await StockService.lookupByBarcode(bizA.id, batch1Row.barcode);

    if (
      barcodeLookup &&
      barcodeLookup.barcode === batch1Row.barcode &&
      barcodeLookup.batchId === batch1Id &&
      barcodeLookup.sph === -1.5 &&
      barcodeLookup.cyl === -0.5 &&
      barcodeLookup.physicalStock === 7.0 &&
      barcodeLookup.availableStock === 7.0
    ) {
      results.push({
        scenario: 20,
        title: 'Barcode lookup accurately resolves optical batch, powers (SPH=-1.5, CYL=-0.5), and live stock',
        passed: true,
        details: { barcode: barcodeLookup.barcode, physical: barcodeLookup.physicalStock },
      });
    } else {
      throw new Error(`Barcode lookup returned invalid data: ${JSON.stringify(barcodeLookup)}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 20,
      title: 'Barcode lookup accurately resolves optical batch, powers, and live stock',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 21: Inventory listing & stock status filtering
  // =========================================================================
  try {
    const invList = await StockService.getInventoryList(bizA.id, {
      stockStatus: 'IN_STOCK',
    });

    const hasBatch1 = invList.items.some((i) => i.batchId === batch1Id);

    const negList = await StockService.getInventoryList(bizA.id, {
      stockStatus: 'NEGATIVE',
    });

    const hasBatch2 = negList.items.some((i) => i.batchId === batch2Id);

    if (hasBatch1 && hasBatch2) {
      results.push({
        scenario: 21,
        title: 'Inventory listing and status filters (IN_STOCK, NEGATIVE) function properly',
        passed: true,
        details: { inStockCount: invList.total, negativeCount: negList.total },
      });
    } else {
      throw new Error(`Inventory filtering error: hasBatch1 in IN_STOCK=${hasBatch1}, hasBatch2 in NEGATIVE=${hasBatch2}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 21,
      title: 'Inventory listing and status filters function properly',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 22: Concurrent reservation race condition safety (FOR UPDATE locking)
  // =========================================================================
  try {
    // Setup batch 3 with exactly 5.0 pairs available
    await StockService.recordOpeningStock(bizA.id, {
      batchId: batch3Id,
      quantity: 5.0,
      reason: 'Opening for concurrency test',
    });

    // Launch 3 simultaneous reservation attempts of 3.0 pairs each (Total 9.0 requested, but only 5.0 available).
    // Exactly 1 must succeed (or maximum 1 if 3+3=6>5), and remaining MUST fail with insufficient stock error.
    const promises = [
      StockService.createReservation(bizA.id, { batchId: batch3Id, quantity: 3.0, notes: 'Thread A' }),
      StockService.createReservation(bizA.id, { batchId: batch3Id, quantity: 3.0, notes: 'Thread B' }),
      StockService.createReservation(bizA.id, { batchId: batch3Id, quantity: 3.0, notes: 'Thread C' }),
    ];

    const outcomes = await Promise.allSettled(promises);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    const finalStock = await StockService.getStock(bizA.id, batch3Id);

    // Exactly 1 could fit (3 pairs reserved, 2 available). The other 2 must be rejected.
    if (
      fulfilled.length === 1 &&
      rejected.length === 2 &&
      finalStock.reservedStock === 3.0 &&
      finalStock.availableStock === 2.0
    ) {
      results.push({
        scenario: 22,
        title: 'Concurrent reservation race condition test (PostgreSQL FOR UPDATE locks prevented double-reservation)',
        passed: true,
        details: { fulfilled: fulfilled.length, rejected: rejected.length, reserved: finalStock.reservedStock, available: finalStock.availableStock },
      });
    } else {
      throw new Error(
        `Concurrency failure: fulfilled=${fulfilled.length}, rejected=${rejected.length}, reserved=${finalStock.reservedStock}, available=${finalStock.availableStock}`
      );
    }
  } catch (err: any) {
    results.push({
      scenario: 22,
      title: 'Concurrent reservation race condition test (PostgreSQL FOR UPDATE locks)',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 23: Multi-business tenant isolation
  // =========================================================================
  try {
    // Attempt from Business B to access or reserve Batch 1 belonging to Business A
    let crossTenantBlocked = false;
    try {
      await StockService.createReservation(bizB.id, {
        batchId: batch1Id,
        quantity: 1.0,
        notes: 'Cross-tenant attack attempt',
      });
    } catch (e: any) {
      crossTenantBlocked = true;
      if (!e.message.toLowerCase().includes('not found in this business')) {
        throw new Error(`Expected business scoping error, got: ${e.message}`);
      }
    }

    if (crossTenantBlocked) {
      results.push({
        scenario: 23,
        title: 'Multi-business tenant isolation: Business B cannot reserve or mutate Business A batches',
        passed: true,
      });
    } else {
      throw new Error('Cross-tenant stock mutation was improperly permitted!');
    }
  } catch (err: any) {
    results.push({
      scenario: 23,
      title: 'Multi-business tenant isolation',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 24: Decimal precision preservation (Fractional pairs)
  // =========================================================================
  try {
    // batch 4: 0 stock. Record opening 0.50 pairs. Adjust +1.25. Reserve 0.75.
    await StockService.recordOpeningStock(bizA.id, {
      batchId: batch4Id,
      quantity: 0.5,
      reason: 'Half pair sample',
    });

    await StockService.adjustStock(bizA.id, {
      batchId: batch4Id,
      adjustmentType: 'INCREASE',
      quantity: 1.25,
      reason: 'FOUND',
    });

    const resFraction = await StockService.createReservation(bizA.id, {
      batchId: batch4Id,
      quantity: 0.75,
      notes: 'Fractional reserve',
    });

    const stock = await StockService.getStock(bizA.id, batch4Id);

    // Expected: Physical = 0.50 + 1.25 = 1.75
    // Reserved = 0.75
    // Available = 1.75 - 0.75 = 1.00
    if (stock.physicalStock === 1.75 && stock.reservedStock === 0.75 && stock.availableStock === 1.0) {
      results.push({
        scenario: 24,
        title: 'Fractional pairs decimal precision (0.50 + 1.25 - 0.75 = exactly 1.00 Available)',
        passed: true,
        details: stock,
      });
    } else {
      throw new Error(`Decimal precision drift: ${JSON.stringify(stock)}`);
    }
  } catch (err: any) {
    results.push({
      scenario: 24,
      title: 'Fractional pairs decimal precision',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SCENARIO 25: Audit Logging on all stock operations
  // =========================================================================
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.businessId, bizA.id), eq(auditLogs.module, 'inventory')));

    const hasOpening = logs.some((l) => l.action === 'OPENING_STOCK');
    const hasAdjustment = logs.some((l) => l.action === 'STOCK_INCREASE' || l.action === 'STOCK_DECREASE');
    const hasReservation = logs.some((l) => l.action === 'RESERVATION_CREATED');
    const hasRelease = logs.some((l) => l.action === 'RESERVATION_RELEASED');

    if (hasOpening && hasAdjustment && hasReservation && hasRelease) {
      results.push({
        scenario: 25,
        title: 'Audit Logging recorded for Opening Stock, Adjustments, Reservations, and Releases',
        passed: true,
        details: { totalInventoryLogs: logs.length },
      });
    } else {
      throw new Error(
        `Audit log coverage incomplete: hasOpening=${hasOpening}, hasAdjustment=${hasAdjustment}, hasReservation=${hasReservation}, hasRelease=${hasRelease}`
      );
    }
  } catch (err: any) {
    results.push({
      scenario: 25,
      title: 'Audit Logging recorded for all inventory operations',
      passed: false,
      error: err.message,
    });
  }

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('\n====================================================');
  console.log(`PHASE 3 TEST SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('====================================================');
  results.forEach((r) => {
    console.log(`[Scenario ${r.scenario.toString().padStart(2, '0')}] ${r.passed ? 'PASS' : 'FAIL'} - ${r.title}`);
    if (!r.passed && r.error) {
      console.log(`   ERROR: ${r.error}`);
    }
  });
  console.log('====================================================\n');

  return { total, passed, failed, results };
}

// Allow standalone execution via tsx
if (process.argv[1]?.endsWith('phase3StockOperations.test.ts')) {
  runPhase3StockTests()
    .then(async (summary) => {
      try {
        await pool.end();
      } catch {}
      if (summary.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch(async (err) => {
      console.error('[Test Execution Fatal Error]', err);
      try {
        await pool.end();
      } catch {}
      process.exit(1);
    });
}
