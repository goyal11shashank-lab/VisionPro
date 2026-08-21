/**
 * Phase 2 — Parties, Suppliers & Purchase Management Test Suite
 * Comprehensive automated verification for:
 * 1. Party Master creation (Supplier, Customer, Both) with business isolation
 * 2. Party Code auto-generation sequence
 * 3. Validation: Reject Customer as Purchase Supplier
 * 4. Draft Purchase Invoice with multiple lines, batch allocations, and deterministic GST
 * 5. Permanent barcode lookup for purchase entry
 * 6. Purchase Posting (Atomic Stock Inward, Stock Ledger, Purchase Lot, Item Last Purchase Price, Supplier Ledger)
 * 7. Negative Stock Support & Idempotency / Double-post prevention
 * 8. Purchase Cancellation (Atomic stock reversal, stock ledger, supplier ledger reversal)
 * 9. Draft Purchase Deletion (Draft allowed, Posted/Cancelled blocked)
 * 10. Multi-business tenant data isolation
 */

import { pool, db } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { seedInitialDatabase } from '../db/seed.js';
import {
  businesses,
  categories,
  bases,
  coatings,
  primaryItems,
  uniqueItems,
  parties,
  purchaseInvoices,
  purchaseInvoiceLines,
  purchaseInvoiceLineBatches,
  purchaseLots,
  supplierLedgers,
  opticalStocks,
  stockLedger,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { PartyService } from '../services/partyService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { findOrCreateOpticalBatch } from '../services/opticalMasterService.js';
import { calculateLineTax, calculateInvoiceTotals } from '../services/taxCalculationService.js';

interface TestResult {
  scenario: number;
  title: string;
  passed: boolean;
  error?: string;
  details?: any;
}

export async function runPurchaseAndPartiesTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}> {
  console.log('====================================================');
  console.log('STARTING PHASE 2 PURCHASE & PARTIES TEST SUITE');
  console.log('====================================================');

  const results: TestResult[] = [];


  // Setup: Default Business & Secondary Business for isolation
  const [bizA] = await db.select().from(businesses).where(eq(businesses.status, 'ACTIVE')).limit(1);
  if (!bizA) throw new Error('Default business not found');

  let [bizB] = await db.select().from(businesses).where(eq(businesses.name, 'VisionCraft Optical Labs')).limit(1);
  if (!bizB) {
    const [inserted] = await db
      .insert(businesses)
      .values({
        name: 'VisionCraft Optical Labs',
        tradeName: 'VisionCraft',
        currency: 'INR',
        status: 'ACTIVE',
      })
      .returning();
    bizB = inserted;
  }

  // --- Scenario 1: Party Master Creation & Code Auto-Generation ---
  try {
    const sup1 = await PartyService.createParty(bizA.id, {
      name: 'Essilor India Private Limited',
      partyType: 'SUPPLIER',
      gstin: '29AAACE1234F1Z5',
      city: 'Bengaluru',
      state: 'Karnataka',
      creditDays: 30,
    });

    const sup2 = await PartyService.createParty(bizA.id, {
      name: 'Hoya Lens India',
      partyType: 'SUPPLIER',
      gstin: '27AAACH5678K1Z2',
      city: 'Mumbai',
      state: 'Maharashtra',
      creditDays: 45,
    });

    if (!sup1.partyCode.startsWith('SUP-') || !sup2.partyCode.startsWith('SUP-')) {
      throw new Error(`Invalid auto-generated supplier codes: ${sup1.partyCode}, ${sup2.partyCode}`);
    }

    results.push({
      scenario: 1,
      title: 'Party Master Creation & Auto-Generated Supplier Code',
      passed: true,
      details: { sup1Code: sup1.partyCode, sup2Code: sup2.partyCode },
    });
  } catch (err: any) {
    results.push({
      scenario: 1,
      title: 'Party Master Creation & Auto-Generated Supplier Code',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 2: Reject Customer as Purchase Supplier ---
  try {
    const cust = await PartyService.createParty(bizA.id, {
      name: 'Rajesh Sharma',
      partyType: 'CUSTOMER',
      mobile: '9876543210',
    });

    let caught = false;
    try {
      await PurchaseService.createPurchaseInvoice(bizA.id, {
        supplierPartyId: cust.id,
        invoiceDate: new Date(),
        lines: [
          {
            uniqueItemId: '00000000-0000-0000-0000-000000000000',
            quantity: 1,
            rate: 100,
          },
        ],
      });
    } catch (e: any) {
      if (e.message.includes('CUSTOMER')) {
        caught = true;
      }
    }

    if (!caught) {
      throw new Error('Purchase creation should reject party of type CUSTOMER');
    }

    results.push({
      scenario: 2,
      title: 'Validation: Reject Customer as Purchase Supplier',
      passed: true,
    });
  } catch (err: any) {
    results.push({
      scenario: 2,
      title: 'Validation: Reject Customer as Purchase Supplier',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 3: Tax Calculation Engine Precision ---
  try {
    // 5 pairs @ ₹850.00 with 10% discount and 12% GST
    const lineTax = calculateLineTax({
      quantity: 5,
      rate: 850,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      gstRate: 12,
    });

    // Gross: 4250.00
    // Discount: 425.00
    // Taxable: 3825.00
    // Tax (12%): 459.00
    // Line Total: 4284.00
    if (
      lineTax.gross !== 4250 ||
      lineTax.discountAmount !== 425 ||
      lineTax.taxableAmount !== 3825 ||
      lineTax.taxAmount !== 459 ||
      lineTax.lineTotal !== 4284
    ) {
      throw new Error(`Tax calculation mismatch: ${JSON.stringify(lineTax)}`);
    }

    const totalsIntra = calculateInvoiceTotals({
      lines: [lineTax],
      gstMode: 'INTRA_STATE',
    });

    if (
      totalsIntra.taxableAmount !== 3825 ||
      totalsIntra.cgstAmount !== 229.5 ||
      totalsIntra.sgstAmount !== 229.5 ||
      totalsIntra.igstAmount !== 0 ||
      totalsIntra.grandTotal !== 4284
    ) {
      throw new Error(`Intra-state GST reconciliation mismatch: ${JSON.stringify(totalsIntra)}`);
    }

    results.push({
      scenario: 3,
      title: 'Decimal Precision & GST Reconciliation Calculation',
      passed: true,
      details: { totalsIntra },
    });
  } catch (err: any) {
    results.push({
      scenario: 3,
      title: 'Decimal Precision & GST Reconciliation Calculation',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 4: Setup Optical Master Items for Purchase ---
  let testSupplier: any;
  let svUniqueItem: any;
  let progUniqueItem: any;

  try {
    const suffix = Date.now().toString(36);
    testSupplier = await PartyService.createParty(bizA.id, {
      name: `Carl Zeiss Vision India ${suffix}`,
      partyType: 'BOTH',
      gstin: '29AAACZ9999P1Z1',
      city: 'Bengaluru',
      state: 'Karnataka',
    });

    // Fetch seeded categories
    const [catSV] = await db.select().from(categories).where(and(eq(categories.businessId, bizA.id), eq(categories.code, 'SV'))).limit(1);
    const [catPROG] = await db.select().from(categories).where(and(eq(categories.businessId, bizA.id), eq(categories.code, 'PROG'))).limit(1);

    const [coat1] = await db.insert(coatings).values({
      businessId: bizA.id,
      code: `ARC_${suffix}`,
      name: `Anti-Reflective Green ${suffix}`,
    }).returning();

    const [base1] = await db.insert(bases).values({
      businessId: bizA.id,
      code: `CR39_${suffix}`,
      name: `CR-39 Standard 1.50 ${suffix}`,
      family: 'CLEAR',
      coatingId: coat1.id,
    }).returning();

    const [primSV] = await db.insert(primaryItems).values({
      businessId: bizA.id,
      categoryId: catSV.id,
      baseId: base1.id,
      coatingId: coat1.id,
      code: `ZEISS_SV_${suffix}`,
      name: `Zeiss Single Vision Clear 1.50 ${suffix}`,
    }).returning();

    const [uSV] = await db.insert(uniqueItems).values({
      businessId: bizA.id,
      primaryItemId: primSV.id,
      name: `Zeiss SV 1.50 AR Clear ${suffix}`,
      code: `ZEISS-SV-${suffix}`,
      purchaseRate: '400.00',
      mrp: '1200.00',
    }).returning();
    svUniqueItem = uSV;

    const [primPAL] = await db.insert(primaryItems).values({
      businessId: bizA.id,
      categoryId: catPROG.id,
      baseId: base1.id,
      coatingId: coat1.id,
      code: `ZEISS_PROG_${suffix}`,
      name: `Zeiss Progressive Light 3D ${suffix}`,
    }).returning();

    const [uPAL] = await db.insert(uniqueItems).values({
      businessId: bizA.id,
      primaryItemId: primPAL.id,
      name: `Zeiss Progressive 1.50 AR ${suffix}`,
      code: `ZEISS-PAL-${suffix}`,
      purchaseRate: '1500.00',
      mrp: '4500.00',
    }).returning();
    progUniqueItem = uPAL;

    results.push({
      scenario: 4,
      title: 'Setup Optical Unique Items and Supplier for Purchase Tests',
      passed: true,
      details: { supplierId: testSupplier.id, svId: svUniqueItem.id, palId: progUniqueItem.id },
    });
  } catch (err: any) {
    results.push({
      scenario: 4,
      title: 'Setup Optical Unique Items and Supplier for Purchase Tests',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 5: Create DRAFT Purchase Invoice with optical power batch allocations ---
  let draftInvoice: any;
  try {
    draftInvoice = await PurchaseService.createPurchaseInvoice(bizA.id, {
      supplierPartyId: testSupplier.id,
      invoiceDate: new Date(),
      supplierInvoiceNumber: 'INV-ZEISS-2026-001',
      gstMode: 'INTRA_STATE',
      notes: 'Initial monthly optical stock procurement',
      lines: [
        {
          uniqueItemId: svUniqueItem.id,
          quantity: 4, // 4 pairs total
          rate: 450,
          discountType: 'PERCENTAGE',
          discountValue: 10,
          gstRate: 12,
          batches: [
            { sph: -2.0, cyl: 0.0, axis: 0, add: 0, side: 'NONE', quantity: 2, rate: 450 },
            { sph: -3.5, cyl: -0.5, axis: 0, add: 0, side: 'NONE', quantity: 2, rate: 450 },
          ],
        },
        {
          uniqueItemId: progUniqueItem.id,
          quantity: 2, // 2 pairs total
          rate: 1600,
          discountType: 'NONE',
          gstRate: 18,
          batches: [
            { sph: 1.5, cyl: -0.75, axis: 180, add: 2.0, side: 'R', quantity: 1, rate: 1600 },
            { sph: 1.5, cyl: -0.75, axis: 180, add: 2.0, side: 'L', quantity: 1, rate: 1600 },
          ],
        },
      ],
    });

    if (draftInvoice.status !== 'DRAFT') {
      throw new Error(`Expected invoice status DRAFT, got ${draftInvoice.status}`);
    }

    if (draftInvoice.lines.length !== 2) {
      throw new Error(`Expected 2 lines, got ${draftInvoice.lines.length}`);
    }

    // Verify stock has NOT been increased during DRAFT
    const batches = draftInvoice.lines[0].batches;
    const [stockRow] = await db
      .select()
      .from(opticalStocks)
      .where(and(eq(opticalStocks.businessId, bizA.id), eq(opticalStocks.batchId, batches[0].batchId)));

    const physicalStock = stockRow ? parseFloat(stockRow.physicalStock) : 0;
    if (physicalStock !== 0) {
      throw new Error(`Draft invoice should not modify stock. Found physical stock: ${physicalStock}`);
    }

    results.push({
      scenario: 5,
      title: 'Create Draft Purchase Invoice with Optical Power Batches',
      passed: true,
      details: {
        invoiceNumber: draftInvoice.invoiceNumber,
        grandTotal: draftInvoice.grandTotal,
        linesCount: draftInvoice.lines.length,
      },
    });
  } catch (err: any) {
    results.push({
      scenario: 5,
      title: 'Create Draft Purchase Invoice with Optical Power Batches',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 6: Permanent Barcode Lookup for Purchase Entry ---
  try {
    const firstBatch = draftInvoice.lines[0].batches[0].batch;
    const lookup = await PurchaseService.getBarcodeDetailsForPurchase(bizA.id, firstBatch.barcode);

    if (lookup.batch.id !== firstBatch.id || lookup.uniqueItem.id !== svUniqueItem.id) {
      throw new Error('Barcode lookup returned incorrect batch or item');
    }

    results.push({
      scenario: 6,
      title: 'Permanent Barcode Lookup for Purchase Scanning',
      passed: true,
      details: { barcode: firstBatch.barcode, batchId: lookup.batch.id },
    });
  } catch (err: any) {
    results.push({
      scenario: 6,
      title: 'Permanent Barcode Lookup for Purchase Scanning',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 7: POST Purchase Invoice (Atomic Stock Inward, Ledger & Lots) ---
  let postedInvoice: any;
  try {
    postedInvoice = await PurchaseService.postPurchaseInvoice(bizA.id, draftInvoice.id);

    if (postedInvoice.status !== 'POSTED') {
      throw new Error(`Expected invoice status POSTED, got ${postedInvoice.status}`);
    }

    // 1. Verify physical stock for batch 1 (was 0, received 2 pairs -> now 2.00)
    const batch1Id = draftInvoice.lines[0].batches[0].batchId;
    const [stock1] = await db
      .select()
      .from(opticalStocks)
      .where(and(eq(opticalStocks.businessId, bizA.id), eq(opticalStocks.batchId, batch1Id)));

    if (!stock1 || parseFloat(stock1.physicalStock) !== 2.0) {
      throw new Error(`Expected physical stock 2.00, got ${stock1?.physicalStock}`);
    }

    // 2. Verify stock ledger entry
    const [ledgerEntry] = await db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.businessId, bizA.id), eq(stockLedger.batchId, batch1Id), eq(stockLedger.transactionType, 'PURCHASE')));

    if (!ledgerEntry || parseFloat(ledgerEntry.quantityIn) !== 2.0) {
      throw new Error('Stock ledger PURCHASE entry not recorded properly');
    }

    // 3. Verify Purchase Lot created
    const [lot] = await db
      .select()
      .from(purchaseLots)
      .where(and(eq(purchaseLots.businessId, bizA.id), eq(purchaseLots.batchId, batch1Id)));

    if (!lot || parseFloat(lot.quantityReceived) !== 2.0) {
      throw new Error('Purchase lot record not created');
    }

    // 4. Verify Unique Item last_purchase_price updated
    const [uItemUpdated] = await db
      .select()
      .from(uniqueItems)
      .where(and(eq(uniqueItems.businessId, bizA.id), eq(uniqueItems.id, svUniqueItem.id)));

    if (!uItemUpdated || parseFloat(uItemUpdated.lastPurchasePrice || '0') !== 450) {
      throw new Error(`Unique item last purchase price not updated to 450. Found: ${uItemUpdated?.lastPurchasePrice}`);
    }

    // 5. Verify Supplier Ledger entry
    const [supLedger] = await db
      .select()
      .from(supplierLedgers)
      .where(and(eq(supplierLedgers.businessId, bizA.id), eq(supplierLedgers.partyId, testSupplier.id), eq(supplierLedgers.transactionType, 'PURCHASE')));

    if (!supLedger || parseFloat(supLedger.debit) !== parseFloat(postedInvoice.grandTotal)) {
      throw new Error(`Supplier ledger debit mismatch. Expected ${postedInvoice.grandTotal}, found ${supLedger?.debit}`);
    }

    results.push({
      scenario: 7,
      title: 'Atomic Post Purchase Invoice (Stock + Stock Ledger + Lots + Supplier Ledger)',
      passed: true,
      details: {
        physicalStock: stock1.physicalStock,
        supplierBalance: supLedger.balance,
      },
    });
  } catch (err: any) {
    results.push({
      scenario: 7,
      title: 'Atomic Post Purchase Invoice (Stock + Stock Ledger + Lots + Supplier Ledger)',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 8: Idempotency & Double-Posting Prevention ---
  try {
    let caught = false;
    try {
      await PurchaseService.postPurchaseInvoice(bizA.id, draftInvoice.id);
    } catch (e: any) {
      if (e.message.includes('already POSTED')) {
        caught = true;
      }
    }

    if (!caught) {
      throw new Error('Should prevent double-posting of already POSTED invoice');
    }

    results.push({
      scenario: 8,
      title: 'Idempotency & Double-Posting Prevention',
      passed: true,
    });
  } catch (err: any) {
    results.push({
      scenario: 8,
      title: 'Idempotency & Double-Posting Prevention',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 9: Atomic Cancellation & Stock/Ledger Reversal ---
  try {
    const cancelled = await PurchaseService.cancelPurchaseInvoice(
      bizA.id,
      postedInvoice.id,
      'Supplier billing error - incorrect GST rate applied'
    );

    if (cancelled.status !== 'CANCELLED') {
      throw new Error(`Expected invoice status CANCELLED, got ${cancelled.status}`);
    }

    // 1. Verify physical stock reversed back to 0.00
    const batch1Id = draftInvoice.lines[0].batches[0].batchId;
    const [stock1] = await db
      .select()
      .from(opticalStocks)
      .where(and(eq(opticalStocks.businessId, bizA.id), eq(opticalStocks.batchId, batch1Id)));

    if (!stock1 || parseFloat(stock1.physicalStock) !== 0.0) {
      throw new Error(`Expected physical stock 0.00 after cancellation reversal, got ${stock1?.physicalStock}`);
    }

    // 2. Verify stock ledger reversal entry
    const [revLedger] = await db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.businessId, bizA.id), eq(stockLedger.batchId, batch1Id), eq(stockLedger.transactionType, 'CANCELLATION_REVERSAL')));

    if (!revLedger || parseFloat(revLedger.quantityOut) !== 2.0) {
      throw new Error('Stock ledger CANCELLATION_REVERSAL entry missing');
    }

    // 3. Verify Supplier Ledger reversal entry
    const [supRev] = await db
      .select()
      .from(supplierLedgers)
      .where(and(eq(supplierLedgers.businessId, bizA.id), eq(supplierLedgers.partyId, testSupplier.id), eq(supplierLedgers.transactionType, 'CANCELLATION_REVERSAL')));

    if (!supRev || parseFloat(supRev.credit) !== parseFloat(postedInvoice.grandTotal)) {
      throw new Error(`Supplier ledger credit reversal mismatch. Expected ${postedInvoice.grandTotal}, found ${supRev?.credit}`);
    }

    results.push({
      scenario: 9,
      title: 'Atomic Purchase Cancellation & Stock Reversal',
      passed: true,
      details: {
        physicalStockAfterCancel: stock1.physicalStock,
        reversalCredit: supRev.credit,
        balanceAfterCancel: supRev.balance,
      },
    });
  } catch (err: any) {
    results.push({
      scenario: 9,
      title: 'Atomic Purchase Cancellation & Stock Reversal',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 10: Draft Deletion & Guarding Posted/Cancelled from Physical Deletion ---
  try {
    // 1. Create a draft invoice
    const draft2 = await PurchaseService.createPurchaseInvoice(bizA.id, {
      supplierPartyId: testSupplier.id,
      invoiceDate: new Date(),
      lines: [
        {
          uniqueItemId: svUniqueItem.id,
          quantity: 1,
          rate: 450,
        },
      ],
    });

    // Delete the draft
    const delRes = await PurchaseService.deleteDraftPurchaseInvoice(bizA.id, draft2.id);
    if (!delRes.success) throw new Error('Failed to delete draft invoice');

    // 2. Attempt to delete CANCELLED or POSTED invoice (must fail)
    let caught = false;
    try {
      await PurchaseService.deleteDraftPurchaseInvoice(bizA.id, postedInvoice.id);
    } catch (e: any) {
      if (e.message.includes('Only DRAFT')) {
        caught = true;
      }
    }

    if (!caught) {
      throw new Error('Should prevent deletion of non-draft invoices');
    }

    results.push({
      scenario: 10,
      title: 'Draft Invoice Deletion & Guarding Posted Invoices from Physical Deletion',
      passed: true,
    });
  } catch (err: any) {
    results.push({
      scenario: 10,
      title: 'Draft Invoice Deletion & Guarding Posted Invoices from Physical Deletion',
      passed: false,
      error: err.message,
    });
  }

  // --- Scenario 11: Multi-Business Tenant Isolation ---
  try {
    // Try to access Biz A party from Biz B
    let caughtParty = false;
    try {
      await PartyService.getPartyById(bizB.id, testSupplier.id);
    } catch (e: any) {
      caughtParty = true;
    }

    // Try to access Biz A invoice from Biz B
    let caughtInvoice = false;
    try {
      await PurchaseService.getPurchaseInvoiceById(bizB.id, postedInvoice.id);
    } catch (e: any) {
      caughtInvoice = true;
    }

    if (!caughtParty || !caughtInvoice) {
      throw new Error('Multi-tenant isolation failed: Cross-business record access was not rejected');
    }

    results.push({
      scenario: 11,
      title: 'Multi-Business Tenant Data Isolation for Parties and Purchases',
      passed: true,
    });
  } catch (err: any) {
    results.push({
      scenario: 11,
      title: 'Multi-Business Tenant Data Isolation for Parties and Purchases',
      passed: false,
      error: err.message,
    });
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('\n====================================================');
  console.log(`TEST RUN COMPLETE: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('====================================================');
  results.forEach(r => {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] Scenario ${r.scenario}: ${r.title}`);
    if (!r.passed) {
      console.log(`       Error: ${r.error}`);
    }
  });

  return { total, passed, failed, results };
}

// Auto-run when executed
runPurchaseAndPartiesTests()
  .then(async res => {
    console.log('TEST_RESULTS_OUTPUT:', JSON.stringify(res, null, 2));
    await pool.end();
    process.exit(res.failed === 0 ? 0 : 1);
  })
  .catch(async err => {
    console.error('Fatal test error:', err);
    await pool.end();
    process.exit(1);
  });


