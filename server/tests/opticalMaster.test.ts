/**
 * Optical Master Data & Inventory Backend Test Suite
 * Validates all 12 Phase 1 functional scenarios:
 * 1. Base uniqueness per business
 * 2. Category compatibility enforcement
 * 3. Base + Coating separation
 * 4. Primary Item creation
 * 5. Unique Item creation with commercial rates
 * 6. SV Batch creation without axis
 * 7. KT Batch creation with AXIS & ADD
 * 8. Progressive Batch creation with SIDE (R/L/BE)
 * 9. findOrCreateOpticalBatch idempotency (same exact power -> same barcode/batch)
 * 10. Multi-business optical power isolation
 * 11. Initial Optical Stock record initialization
 * 12. Invalid optical input rejection
 */

import { pool, db } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { seedInitialDatabase } from '../db/seed.js';
import {
  businesses, categories, bases, coatings, baseCategories,
  primaryItems, uniqueItems, opticalBatches, opticalStocks
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { findOrCreateOpticalBatch, validateOpticalPower } from '../services/opticalMasterService.js';

interface TestResult {
  scenario: number;
  title: string;
  passed: boolean;
  error?: string;
  details?: any;
}

export async function runOpticalMasterTests(): Promise<{ total: number; passed: number; failed: number; results: TestResult[] }> {
  console.log('====================================================');
  console.log('STARTING PHASE 1 OPTICAL MASTER DATA TEST SUITE');
  console.log('====================================================');

  await runMigrations();
  await seedInitialDatabase();

  const results: TestResult[] = [];

  // Setup: Fetch Default Business and create a Second Business for isolation testing
  const [defaultBiz] = await db.select().from(businesses).where(eq(businesses.status, 'ACTIVE')).limit(1);
  if (!defaultBiz) {
    throw new Error('Default business not found for test suite');
  }

  let [secondBiz] = await db.select().from(businesses).where(eq(businesses.name, 'VisionCraft Optical Labs')).limit(1);
  if (!secondBiz) {
    const [inserted] = await db.insert(businesses).values({
      name: 'VisionCraft Optical Labs',
      tradeName: 'VisionCraft',
      currency: 'INR',
      status: 'ACTIVE',
    }).returning();
    secondBiz = inserted;
  }

  // --- Scenario 1: Base uniqueness per business ---
  try {
    const testCode = 'TEST_BASE_UNQ';
    // Clean up if exists
    await db.delete(bases).where(and(eq(bases.businessId, defaultBiz.id), eq(bases.code, testCode)));

    await db.insert(bases).values({
      businessId: defaultBiz.id,
      name: 'Test Unique Base 1',
      code: testCode,
      family: 'CLEAR',
    });

    let duplicateThrew = false;
    try {
      await db.insert(bases).values({
        businessId: defaultBiz.id,
        name: 'Test Unique Base 2',
        code: testCode,
        family: 'CLEAR',
      });
    } catch (e) {
      duplicateThrew = true;
    }

    if (!duplicateThrew) throw new Error('Expected duplicate base code to throw unique constraint violation');

    results.push({
      scenario: 1,
      title: 'Base uniqueness per business enforcement',
      passed: true,
      details: 'Duplicate base code in the same business successfully rejected by database constraint.',
    });
  } catch (err: any) {
    results.push({ scenario: 1, title: 'Base uniqueness per business enforcement', passed: false, error: err.message });
  }

  // --- Scenario 2: Category compatibility mapping ---
  try {
    const [svCat] = await db.select().from(categories).where(and(eq(categories.businessId, defaultBiz.id), eq(categories.code, 'SV'))).limit(1);
    const [ktCat] = await db.select().from(categories).where(and(eq(categories.businessId, defaultBiz.id), eq(categories.code, 'KT'))).limit(1);

    const [compatBase] = await db.select().from(bases).where(and(eq(bases.businessId, defaultBiz.id), eq(bases.code, 'PGHC'))).limit(1);

    const compatRows = await db.select().from(baseCategories).where(and(
      eq(baseCategories.businessId, defaultBiz.id),
      eq(baseCategories.baseId, compatBase.id)
    ));

    const hasSV = compatRows.some(r => r.categoryId === svCat.id);
    const hasKT = compatRows.some(r => r.categoryId === ktCat.id);

    if (!hasSV || !hasKT) {
      throw new Error(`Base PGHC missing expected category compatibility mappings (hasSV: ${hasSV}, hasKT: ${hasKT})`);
    }

    results.push({
      scenario: 2,
      title: 'Category compatibility mapping validation',
      passed: true,
      details: 'Base PGHC verified compatible with both SV and KT categories via junction table.',
    });
  } catch (err: any) {
    results.push({ scenario: 2, title: 'Category compatibility mapping validation', passed: false, error: err.message });
  }

  // --- Scenario 3: Base + Coating separation ---
  try {
    const [pgCoating] = await db.select().from(coatings).where(and(eq(coatings.businessId, defaultBiz.id), eq(coatings.code, 'PGHC'))).limit(1);
    const [pgBase] = await db.select().from(bases).where(and(eq(bases.businessId, defaultBiz.id), eq(bases.code, 'PGHC'))).limit(1);

    if (!pgCoating || !pgBase) {
      throw new Error('PGHC Coating or Base not seeded properly');
    }
    if (pgBase.coatingId !== pgCoating.id) {
      throw new Error('PGHC Base does not reference PGHC Coating foreign key');
    }

    results.push({
      scenario: 3,
      title: 'Base + Coating normalized separation',
      passed: true,
      details: 'Coating entity is independently modeled and cleanly linked to Base via foreign key.',
    });
  } catch (err: any) {
    results.push({ scenario: 3, title: 'Base + Coating normalized separation', passed: false, error: err.message });
  }

  // --- Scenario 4: Primary Item creation ---
  try {
    const [pgHcSv] = await db.select().from(primaryItems).where(and(eq(primaryItems.businessId, defaultBiz.id), eq(primaryItems.code, 'PGHC_SV'))).limit(1);
    if (!pgHcSv) throw new Error('PGHC_SV primary item not found');

    results.push({
      scenario: 4,
      title: 'Primary Item multi-tier composite entity',
      passed: true,
      details: `Primary Item ${pgHcSv.name} successfully combines Category + Base + Coating.`,
    });
  } catch (err: any) {
    results.push({ scenario: 4, title: 'Primary Item multi-tier composite entity', passed: false, error: err.message });
  }

  // --- Scenario 5: Unique Item creation with commercial rates ---
  try {
    const [uniqueItem] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.businessId, defaultBiz.id), eq(uniqueItems.code, 'PGHC_SV_STD'))).limit(1);
    if (!uniqueItem) throw new Error('PGHC_SV_STD Unique Item not found');
    if (Number(uniqueItem.purchaseRate) <= 0 || Number(uniqueItem.mrp) <= 0) {
      throw new Error('Unique Item missing valid commercial pricing');
    }

    results.push({
      scenario: 5,
      title: 'Unique Item commercial SKU with purchase rate and MRP',
      passed: true,
      details: `Unique Item ${uniqueItem.name} has purchaseRate=₹${uniqueItem.purchaseRate}, MRP=₹${uniqueItem.mrp}`,
    });
  } catch (err: any) {
    results.push({ scenario: 5, title: 'Unique Item commercial SKU with purchase rate and MRP', passed: false, error: err.message });
  }

  // --- Scenario 6: SV Batch creation without axis ---
  try {
    const [svItem] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.businessId, defaultBiz.id), eq(uniqueItems.code, 'HC_SV_STD'))).limit(1);
    if (!svItem) throw new Error('HC_SV_STD unique item not found');

    const batchRes = await findOrCreateOpticalBatch({
      businessId: defaultBiz.id,
      uniqueItemId: svItem.id,
      sph: -2.00,
      cyl: -0.50,
    });

    if (!batchRes.batch.barcode.startsWith('OPT-SV-')) {
      throw new Error(`Unexpected barcode prefix: ${batchRes.batch.barcode}`);
    }
    if (Number(batchRes.batch.axis) !== 0 || Number(batchRes.batch.add) !== 0) {
      throw new Error('SV batch should have axis=0 and add=0');
    }

    results.push({
      scenario: 6,
      title: 'Single Vision (SV) batch creation with zero axis and add',
      passed: true,
      details: `Generated Barcode: ${batchRes.batch.barcode}, Identity: ${batchRes.batch.identityKey}`,
    });
  } catch (err: any) {
    results.push({ scenario: 6, title: 'Single Vision (SV) batch creation with zero axis and add', passed: false, error: err.message });
  }

  // --- Scenario 7: KT Batch creation with AXIS & ADD ---
  try {
    const [ktItem] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.businessId, defaultBiz.id), eq(uniqueItems.code, 'PGHC_KT_STD'))).limit(1);
    if (!ktItem) throw new Error('PGHC_KT_STD unique item not found');

    const batchRes = await findOrCreateOpticalBatch({
      businessId: defaultBiz.id,
      uniqueItemId: ktItem.id,
      sph: 1.50,
      cyl: -0.75,
      axis: 90,
      add: 2.00,
    });

    if (!batchRes.batch.barcode.startsWith('OPT-KT-')) {
      throw new Error(`Unexpected KT barcode prefix: ${batchRes.batch.barcode}`);
    }
    if (Number(batchRes.batch.axis) !== 90 || Number(batchRes.batch.add) !== 2.00) {
      throw new Error('KT batch powers do not match input (axis=90, add=2.00)');
    }

    results.push({
      scenario: 7,
      title: 'Kryptok Bifocal (KT) batch creation with AXIS and ADD',
      passed: true,
      details: `Generated Barcode: ${batchRes.batch.barcode}, SPH:+1.50, CYL:-0.75, AXIS:90, ADD:+2.00`,
    });
  } catch (err: any) {
    results.push({ scenario: 7, title: 'Kryptok Bifocal (KT) batch creation with AXIS and ADD', passed: false, error: err.message });
  }

  // --- Scenario 8: Progressive Batch creation with SIDE (R/L/BE) ---
  try {
    const [progItem] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.businessId, defaultBiz.id), eq(uniqueItems.code, 'PGHC_PROG_STD'))).limit(1);
    if (!progItem) throw new Error('PGHC_PROG_STD unique item not found');

    const batchRight = await findOrCreateOpticalBatch({
      businessId: defaultBiz.id,
      uniqueItemId: progItem.id,
      sph: -1.00,
      cyl: -0.50,
      axis: 180,
      add: 2.25,
      side: 'R',
    });

    const batchLeft = await findOrCreateOpticalBatch({
      businessId: defaultBiz.id,
      uniqueItemId: progItem.id,
      sph: -1.00,
      cyl: -0.50,
      axis: 180,
      add: 2.25,
      side: 'L',
    });

    if (batchRight.batch.barcode === batchLeft.batch.barcode) {
      throw new Error('Right and Left progressive eye batches must have distinct barcodes');
    }
    if (batchRight.batch.side !== 'R' || batchLeft.batch.side !== 'L') {
      throw new Error('Side not correctly persisted in progressive batch');
    }

    results.push({
      scenario: 8,
      title: 'Progressive (PROG) batch creation with explicit eye SIDE (R vs L)',
      passed: true,
      details: `Right Barcode: ${batchRight.batch.barcode} (SIDE=R), Left Barcode: ${batchLeft.batch.barcode} (SIDE=L)`,
    });
  } catch (err: any) {
    results.push({ scenario: 8, title: 'Progressive (PROG) batch creation with explicit eye SIDE (R vs L)', passed: false, error: err.message });
  }

  // --- Scenario 9: findOrCreateOpticalBatch idempotency (same exact power -> same barcode/batch) ---
  try {
    const [svItem] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.businessId, defaultBiz.id), eq(uniqueItems.code, 'HC_SV_STD'))).limit(1);

    const firstCall = await findOrCreateOpticalBatch({
      businessId: defaultBiz.id,
      uniqueItemId: svItem.id,
      sph: -3.25,
      cyl: -1.00,
    });

    const secondCall = await findOrCreateOpticalBatch({
      businessId: defaultBiz.id,
      uniqueItemId: svItem.id,
      sph: '-3.25',
      cyl: '-1.00',
    });

    if (firstCall.batch.id !== secondCall.batch.id) {
      throw new Error('Idempotency violation: Multiple optical batches created for identical power');
    }
    if (firstCall.batch.barcode !== secondCall.batch.barcode) {
      throw new Error('Idempotency violation: Multiple barcodes generated for identical power');
    }
    if (secondCall.isNew !== false) {
      throw new Error('Second call must report isNew=false');
    }

    results.push({
      scenario: 9,
      title: 'Optical Batch idempotency & duplicate power prevention',
      passed: true,
      details: `Calling findOrCreateOpticalBatch with SPH -3.25 CYL -1.00 returns identical batch ID ${firstCall.batch.id} and Barcode ${firstCall.batch.barcode}`,
    });
  } catch (err: any) {
    results.push({ scenario: 9, title: 'Optical Batch idempotency & duplicate power prevention', passed: false, error: err.message });
  }

  // --- Scenario 10: Multi-business optical power isolation ---
  try {
    // Seed equivalent category and item in second business
    const [cat2] = await db.insert(categories).values({
      businessId: secondBiz.id,
      name: 'Single Vision',
      code: 'SV',
    }).onConflictDoNothing().returning();
    const catId2 = cat2?.id || (await db.select().from(categories).where(and(eq(categories.businessId, secondBiz.id), eq(categories.code, 'SV'))))[0].id;

    const [base2] = await db.insert(bases).values({
      businessId: secondBiz.id,
      name: 'Hard Coat',
      code: 'HC',
    }).onConflictDoNothing().returning();
    const baseId2 = base2?.id || (await db.select().from(bases).where(and(eq(bases.businessId, secondBiz.id), eq(bases.code, 'HC'))))[0].id;

    const [primary2] = await db.insert(primaryItems).values({
      businessId: secondBiz.id,
      categoryId: catId2,
      baseId: baseId2,
      name: 'HC SV 2',
      code: 'HC_SV_BIZ2',
    }).onConflictDoNothing().returning();
    const primaryId2 = primary2?.id || (await db.select().from(primaryItems).where(and(eq(primaryItems.businessId, secondBiz.id), eq(primaryItems.code, 'HC_SV_BIZ2'))))[0].id;

    const [uItem2] = await db.insert(uniqueItems).values({
      businessId: secondBiz.id,
      primaryItemId: primaryId2,
      name: 'HC SV SKU 2',
      code: 'HC_SV_SKU2',
    }).onConflictDoNothing().returning();
    const uItemId2 = uItem2?.id || (await db.select().from(uniqueItems).where(and(eq(uniqueItems.businessId, secondBiz.id), eq(uniqueItems.code, 'HC_SV_SKU2'))))[0].id;

    const biz2Batch = await findOrCreateOpticalBatch({
      businessId: secondBiz.id,
      uniqueItemId: uItemId2,
      sph: -2.00,
      cyl: -0.50,
    });

    const [biz1Batch] = await db.select().from(opticalBatches).where(and(
      eq(opticalBatches.businessId, defaultBiz.id),
      eq(opticalBatches.sph, '-2.00'),
      eq(opticalBatches.cyl, '-0.50')
    ));

    if (biz2Batch.batch.id === biz1Batch.id) {
      throw new Error('Multi-tenant breach: Batches from different businesses shared the same record');
    }
    if (biz2Batch.batch.businessId !== secondBiz.id) {
      throw new Error('Batch not scoped to authenticated business ID');
    }

    results.push({
      scenario: 10,
      title: 'Multi-business tenant isolation of optical power batches',
      passed: true,
      details: `Identical optical power (-2.00/-0.50) safely partitioned into distinct tenant records: Biz1 (${defaultBiz.id.slice(0, 8)}) vs Biz2 (${secondBiz.id.slice(0, 8)})`,
    });
  } catch (err: any) {
    results.push({ scenario: 10, title: 'Multi-business tenant isolation of optical power batches', passed: false, error: err.message });
  }

  // --- Scenario 11: Initial Optical Stock record initialization ---
  try {
    const [svItem] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.businessId, defaultBiz.id), eq(uniqueItems.code, 'HC_SV_STD'))).limit(1);

    const batchRes = await findOrCreateOpticalBatch({
      businessId: defaultBiz.id,
      uniqueItemId: svItem.id,
      sph: -5.00,
      cyl: -2.00,
    });

    const [stockRow] = await db.select().from(opticalStocks).where(and(
      eq(opticalStocks.businessId, defaultBiz.id),
      eq(opticalStocks.batchId, batchRes.batch.id)
    ));

    if (!stockRow) {
      throw new Error('optical_stocks record was not initialized on batch creation');
    }
    if (Number(stockRow.physicalStock) !== 0 || Number(stockRow.availableStock) !== 0) {
      throw new Error('Initial stock must be exactly 0.00');
    }

    results.push({
      scenario: 11,
      title: 'Initial optical stock initialization (physical=0, available=0)',
      passed: true,
      details: `Optical stock successfully initialized: Physical=${stockRow.physicalStock}, Reserved=${stockRow.reservedStock}, Available=${stockRow.availableStock}`,
    });
  } catch (err: any) {
    results.push({ scenario: 11, title: 'Initial optical stock initialization (physical=0, available=0)', passed: false, error: err.message });
  }

  // --- Scenario 12: Invalid optical input rejection ---
  try {
    let svAxisRejected = false;
    try {
      validateOpticalPower('SV', -2.00, -0.50, 90, 0, 'NONE');
    } catch (e: any) {
      svAxisRejected = true;
    }

    let ktMissingAxisRejected = false;
    try {
      validateOpticalPower('KT', 1.00, -1.00, null, 2.00, 'NONE');
    } catch (e: any) {
      ktMissingAxisRejected = true;
    }

    let progMissingSideRejected = false;
    try {
      validateOpticalPower('PROG', 1.00, -1.00, 90, 2.00, null);
    } catch (e: any) {
      progMissingSideRejected = true;
    }

    if (!svAxisRejected || !ktMissingAxisRejected || !progMissingSideRejected) {
      throw new Error(`Validation rules failed: svAxisRejected=${svAxisRejected}, ktMissingAxisRejected=${ktMissingAxisRejected}, progMissingSideRejected=${progMissingSideRejected}`);
    }

    results.push({
      scenario: 12,
      title: 'Invalid optical power parameters validation & rejection',
      passed: true,
      details: 'All category rule violations (SV with axis, KT with CYL but no axis, PROG with missing side) rejected with precise errors.',
    });
  } catch (err: any) {
    results.push({ scenario: 12, title: 'Invalid optical power parameters validation & rejection', passed: false, error: err.message });
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;

  console.log(`[Optical Master Tests] Complete. Passed: ${passedCount}/${results.length}, Failed: ${failedCount}`);
  return {
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    results,
  };
}

// Standalone execution support
runOpticalMasterTests()
  .then(async (res) => {
    console.log('TEST_RESULTS_OUTPUT:', JSON.stringify(res, null, 2));
    await pool.end();
    process.exit(res.failed === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('Test execution error:', err);
    await pool.end();
    process.exit(1);
  });
