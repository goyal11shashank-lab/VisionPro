import * as XLSX from 'xlsx';
import { db, pool } from '../db/index.js';
import {
  businesses,
  users,
  parties,
  uniqueItems,
  categories,
  opticalBatches,
  opticalStocks,
  stockLedger,
  purchaseInvoices,
  salesInvoices,
  importSessions,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { ExcelTemplateService } from '../services/excelTemplateService.js';
import { ColumnMappingService } from '../services/columnMappingService.js';
import { ImportValidationService } from '../services/importValidationService.js';
import { ImportPostingService } from '../services/importPostingService.js';
import { ExportService } from '../services/exportService.js';
import { findOrCreateOpticalBatch } from '../services/opticalMasterService.js';
import { StockService } from '../services/stockService.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    console.log(`\n  >> Running: ${name}`);
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('STARTING PHASE 7 IMPORT, EXPORT & BULK DATA TEST SUITE');
  console.log('=============================================================\n');

  let testBizId1: string;
  let testBizId2: string;
  let adminUserId: string;

  let catSVId: string;
  let catKTId: string;
  let catProgId: string;

  let itemSVId: string;
  let itemKTId: string;
  let itemProgId: string;

  let supplierPartyId: string;
  let customerPartyId: string;

  let preExistingBatchId: string;
  let preExistingBarcode: string;

  const client = await pool.connect();
  try {
    const bizSuffix = Date.now().toString().slice(-4);

    // 2. Setup Test Business 1
    const biz1Res = await client.query(
      `INSERT INTO businesses (name, trade_name, state, gstin, status)
       VALUES ($1, $2, 'Maharashtra', '27AAAAA0000A1Z5', 'ACTIVE')
       RETURNING id`,
      [`Phase 7 Hub ${bizSuffix}`, `P7_${bizSuffix}`]
    );
    testBizId1 = biz1Res.rows[0].id;

    // 3. Setup Test Business 2 (for isolation tests)
    const biz2Res = await client.query(
      `INSERT INTO businesses (name, trade_name, state, gstin, status)
       VALUES ($1, $2, 'Delhi', '07BBBBB0000B1Z6', 'ACTIVE')
       RETURNING id`,
      [`Phase 7 Isolated Store ${bizSuffix}`, `ISO_${bizSuffix}`]
    );
    testBizId2 = biz2Res.rows[0].id;

    // 4. Setup Admin User
    const userRes = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, status, is_super_admin)
       VALUES ($1, $2, 'hash123', 'Phase 7 Admin', 'ACTIVE', false)
       RETURNING id`,
      [`p7admin_${bizSuffix}`, `p7admin_${bizSuffix}@hub.com`]
    );
    adminUserId = userRes.rows[0].id;

    // 5. Setup Categories
    const catSVRes = await client.query(
      `INSERT INTO categories (business_id, name, code, status)
       VALUES ($1, 'Single Vision Standard', 'SV', 'ACTIVE')
       RETURNING id`,
      [testBizId1]
    );
    catSVId = catSVRes.rows[0].id;

    const catKTRes = await client.query(
      `INSERT INTO categories (business_id, name, code, status)
       VALUES ($1, 'Kryptok Bifocal Standard', 'KT', 'ACTIVE')
       RETURNING id`,
      [testBizId1]
    );
    catKTId = catKTRes.rows[0].id;

    const catProgRes = await client.query(
      `INSERT INTO categories (business_id, name, code, status)
       VALUES ($1, 'Progressive Deluxe', 'PROG', 'ACTIVE')
       RETURNING id`,
      [testBizId1]
    );
    catProgId = catProgRes.rows[0].id;

    // Bases
    const baseRes = await client.query(
      `INSERT INTO bases (business_id, name, code, status)
       VALUES ($1, 'CR-39 1.56 Material', $2, 'ACTIVE')
       RETURNING id`,
      [testBizId1, `BASE_${bizSuffix}`]
    );
    const baseId = baseRes.rows[0].id;

    // Primary Items
    const piSVRes = await client.query(
      `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status)
       VALUES ($1, $2, $3, 'Crizal Alize 1.56 SV HMC Primary', $4, 'ACTIVE')
       RETURNING id`,
      [testBizId1, catSVId, baseId, `PI_SV_${bizSuffix}`]
    );
    const piSVId = piSVRes.rows[0].id;

    const piKTRes = await client.query(
      `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status)
       VALUES ($1, $2, $3, '1.50 KT Bifocal Primary', $4, 'ACTIVE')
       RETURNING id`,
      [testBizId1, catKTId, baseId, `PI_KT_${bizSuffix}`]
    );
    const piKTId = piKTRes.rows[0].id;

    const piProgRes = await client.query(
      `INSERT INTO primary_items (business_id, category_id, base_id, name, code, status)
       VALUES ($1, $2, $3, 'Varilux Comfort Max Primary', $4, 'ACTIVE')
       RETURNING id`,
      [testBizId1, catProgId, baseId, `PI_PROG_${bizSuffix}`]
    );
    const piProgId = piProgRes.rows[0].id;

    // 6. Setup Unique Items
    const uiSVRes = await client.query(
      `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, status)
       VALUES ($1, $2, 'Crizal Alize 1.56 SV HMC', 'ITEM-SV-001', 450.00, 900.00, 'ACTIVE')
       RETURNING id`,
      [testBizId1, piSVId]
    );
    itemSVId = uiSVRes.rows[0].id;

    const uiKTRes = await client.query(
      `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, status)
       VALUES ($1, $2, '1.50 KT Bifocal Hard Coat', 'ITEM-KT-001', 600.00, 1200.00, 'ACTIVE')
       RETURNING id`,
      [testBizId1, piKTId]
    );
    itemKTId = uiKTRes.rows[0].id;

    const uiProgRes = await client.query(
      `INSERT INTO unique_items (business_id, primary_item_id, name, code, purchase_rate, mrp, status)
       VALUES ($1, $2, 'Varilux Comfort Max 1.60', 'ITEM-PROG-001', 1800.00, 3500.00, 'ACTIVE')
       RETURNING id`,
      [testBizId1, piProgId]
    );
    itemProgId = uiProgRes.rows[0].id;

    // 7. Setup Parties
    const supRes = await client.query(
      `INSERT INTO parties (business_id, name, party_code, party_type, mobile, status)
       VALUES ($1, 'Essilor India Private Limited', 'SUP-ESSILOR', 'SUPPLIER', '9820011223', 'ACTIVE')
       RETURNING id`,
      [testBizId1]
    );
    supplierPartyId = supRes.rows[0].id;

    const custRes = await client.query(
      `INSERT INTO parties (business_id, name, party_code, party_type, mobile, status)
       VALUES ($1, 'Modern Eye Care Clinic', 'CUST-MODERN', 'CUSTOMER', '9820099887', 'ACTIVE')
       RETURNING id`,
      [testBizId1]
    );
    customerPartyId = custRes.rows[0].id;

    // 8. Create a pre-existing optical batch for opening stock & sales tests
    const preBatchRes = await findOrCreateOpticalBatch({
      businessId: testBizId1,
      uniqueItemId: itemSVId,
      sph: '-2.00',
      cyl: '-0.50',
      userId: adminUserId,
    });
    preExistingBatchId = preBatchRes.batch.id;
    preExistingBarcode = preBatchRes.batch.barcode;
  } finally {
    client.release();
  }

  // ==========================================
  // 1. TEMPLATE GENERATION & COLUMN MAPPING
  // ==========================================
  await test('TEST 1: Should generate valid XLSX templates for all import types', () => {
    const types: any[] = ['PARTY', 'PURCHASE', 'SALES_ORDER', 'SALES_INVOICE', 'OPENING_STOCK'];
    for (const t of types) {
      const buffer = ExcelTemplateService.generateTemplateWorkbook(t);
      if (!buffer || buffer.length === 0) throw new Error(`Template for ${t} produced empty buffer`);

      const wb = XLSX.read(buffer, { type: 'buffer' });
      if (!wb.SheetNames.includes('Import Data')) throw new Error(`Workbook for ${t} missing "Import Data" sheet`);
      if (!wb.SheetNames.includes('Instructions & Rules')) throw new Error(`Workbook for ${t} missing "Instructions & Rules" sheet`);
    }
  });

  await test('TEST 2: Column mapping service should detect standard and fuzzy aliases', () => {
    const rawHeaders = ['Vendor', 'Bill No', 'Item Name', 'Sphere', 'Cylinder', 'Qty', 'Unit Price'];
    const detected = ColumnMappingService.detectMapping('PURCHASE', rawHeaders);

    if (detected.columnMapping.supplier !== 'Vendor') throw new Error('Expected supplier mapped to Vendor');
    if (detected.columnMapping.supplierInvoiceNumber !== 'Bill No') throw new Error('Expected supplierInvoiceNumber mapped to Bill No');
    if (detected.columnMapping.uniqueItem !== 'Item Name') throw new Error('Expected uniqueItem mapped to Item Name');
    if (detected.columnMapping.sph !== 'Sphere') throw new Error('Expected sph mapped to Sphere');
    if (detected.columnMapping.cyl !== 'Cylinder') throw new Error('Expected cyl mapped to Cylinder');
    if (detected.columnMapping.quantity !== 'Qty') throw new Error('Expected quantity mapped to Qty');
    if (detected.columnMapping.rate !== 'Unit Price') throw new Error('Expected rate mapped to Unit Price');
    if (detected.missingRequired.length !== 0) throw new Error('Expected 0 missing required columns');
  });

  await test('TEST 3: Diopter power normalizer handles plano, negative and positive decimals', () => {
    if (ImportValidationService.normalizeDiopter('-2') !== '-2.00') throw new Error('Failed -2');
    if (ImportValidationService.normalizeDiopter('-2.0') !== '-2.00') throw new Error('Failed -2.0');
    if (ImportValidationService.normalizeDiopter('-2.00') !== '-2.00') throw new Error('Failed -2.00');
    if (ImportValidationService.normalizeDiopter('1.5') !== '+1.50') throw new Error('Failed 1.5');
    if (ImportValidationService.normalizeDiopter('+1.50') !== '+1.50') throw new Error('Failed +1.50');
    if (ImportValidationService.normalizeDiopter('0') !== '0.00') throw new Error('Failed 0');
    if (ImportValidationService.normalizeDiopter('PLANO') !== '0.00') throw new Error('Failed PLANO');
    if (ImportValidationService.normalizeDiopter('pl') !== '0.00') throw new Error('Failed pl');
  });

  // ==========================================
  // 2. PARTY IMPORT & DUPLICATE DETECTION
  // ==========================================
  await test('TEST 4: Should validate and import valid parties into database', async () => {
    const rawRows = [
      {
        'Name': 'Alpha Opticians',
        'Party Type': 'CUSTOMER',
        'Mobile': '9811122233',
        'City': 'Pune',
        'State': 'Maharashtra',
        'Credit Limit': '25000',
        'Credit Days': '15',
      },
      {
        'Name': 'Beta Lens Lab',
        'Party Type': 'SUPPLIER',
        'Mobile': '9822233344',
        'City': 'Mumbai',
        'State': 'Maharashtra',
      },
    ];

    const mapping = {
      name: 'Name',
      partyType: 'Party Type',
      mobile: 'Mobile',
      city: 'City',
      state: 'State',
      creditLimit: 'Credit Limit',
      creditDays: 'Credit Days',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'PARTY', rawRows, mapping);
    if (validation.totalRows !== 2 || validation.validRows !== 2 || validation.invalidRows !== 0) {
      throw new Error(`Validation failed: total=${validation.totalRows}, valid=${validation.validRows}, invalid=${validation.invalidRows}`);
    }

    const [session] = await db
      .insert(importSessions)
      .values({
        businessId: testBizId1,
        importType: 'PARTY',
        fileName: 'test_parties.xlsx',
        status: 'READY',
        totalRows: '2',
        validRows: '2',
        invalidRows: '0',
        columnMapping: mapping,
        previewData: validation,
        errorSummary: validation.errorSummary,
        createdBy: adminUserId,
      })
      .returning();

    const postResult = await ImportPostingService.postImportSession(testBizId1, session.id, adminUserId);
    if (postResult.status !== 'COMPLETED' || postResult.postedRows !== 2) {
      throw new Error(`Posting failed: status=${postResult.status}, posted=${postResult.postedRows}`);
    }

    // Verify in DB
    const [p1] = await db.select().from(parties).where(and(eq(parties.businessId, testBizId1), eq(parties.name, 'Alpha Opticians')));
    if (!p1 || p1.partyType !== 'CUSTOMER') throw new Error('Party not created accurately in DB');
  });

  await test('TEST 5: Should reject party with invalid partyType and detect intra-file duplicate codes', async () => {
    const rawRows = [
      {
        'Party Code': 'DUP-001',
        'Name': 'Invalid Party Type Account',
        'Party Type': 'INVALID_TYPE_XYZ',
      },
      {
        'Party Code': 'DUP-001',
        'Name': 'Duplicate Code Party',
        'Party Type': 'CUSTOMER',
      },
    ];

    const mapping = {
      partyCode: 'Party Code',
      name: 'Name',
      partyType: 'Party Type',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'PARTY', rawRows, mapping);
    if (validation.invalidRows !== 2 || validation.validRows !== 0) {
      throw new Error(`Expected 2 invalid rows, got invalid=${validation.invalidRows}, valid=${validation.validRows}`);
    }
  });

  // ==========================================
  // 3. PURCHASE IMPORT & BATCH AUTO-CREATION
  // ==========================================
  await test('TEST 6: Should import multi-line purchase invoice, auto-create batches, and post to stock and ledger', async () => {
    const rawRows = [
      {
        'Supplier': 'SUP-ESSILOR',
        'Supplier Invoice Number': 'INV-ESS-P7-101',
        'Supplier Invoice Date': '2026-08-10',
        'Unique Item': 'ITEM-SV-001',
        'SPH': '-3.00',
        'CYL': '-0.75',
        'Quantity': '10',
        'Rate': '450.00',
      },
      {
        'Supplier': 'SUP-ESSILOR',
        'Supplier Invoice Number': 'INV-ESS-P7-101',
        'Supplier Invoice Date': '2026-08-10',
        'Unique Item': 'ITEM-SV-001',
        'SPH': '-3.00',
        'CYL': '-1.00',
        'Quantity': '5',
        'Rate': '450.00',
      },
    ];

    const mapping = {
      supplier: 'Supplier',
      supplierInvoiceNumber: 'Supplier Invoice Number',
      supplierInvoiceDate: 'Supplier Invoice Date',
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      quantity: 'Quantity',
      rate: 'Rate',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'PURCHASE', rawRows, mapping);
    if (validation.validRows !== 2 || validation.documentGroups.length !== 1) {
      throw new Error('Purchase validation failed on multi-line grouping');
    }

    const [session] = await db
      .insert(importSessions)
      .values({
        businessId: testBizId1,
        importType: 'PURCHASE',
        fileName: 'purchase_invoice_test.xlsx',
        status: 'READY',
        totalRows: '2',
        validRows: '2',
        invalidRows: '0',
        columnMapping: mapping,
        previewData: validation,
        errorSummary: validation.errorSummary,
        createdBy: adminUserId,
      })
      .returning();

    const postResult = await ImportPostingService.postImportSession(testBizId1, session.id, adminUserId);
    if (postResult.status !== 'COMPLETED' || postResult.postedRows !== 2) {
      throw new Error(`Purchase invoice post failed: ${JSON.stringify(postResult.errors)}`);
    }

    // Verify batch was created and physical stock updated
    const [batch] = await db
      .select()
      .from(opticalBatches)
      .where(and(eq(opticalBatches.businessId, testBizId1), eq(opticalBatches.uniqueItemId, itemSVId), eq(opticalBatches.sph, '-3.00'), eq(opticalBatches.cyl, '-0.75')))
      .limit(1);
    if (!batch) throw new Error('Optical batch (-3.00, -0.75) not found in DB');

    const stock = await StockService.getStock(testBizId1, batch.id);
    if (stock.physicalStock !== 10 || stock.availableStock !== 10) {
      throw new Error(`Stock mismatch: physical=${stock.physicalStock}, available=${stock.availableStock}`);
    }
  });

  // ==========================================
  // 4. CATEGORY-AWARE OPTICAL POWER VALIDATIONS
  // ==========================================
  await test('TEST 7: SV lens with AXIS or ADD should be rejected', async () => {
    const rawRows = [
      {
        'Supplier': 'SUP-ESSILOR',
        'Supplier Invoice Number': 'INV-ERR-001',
        'Unique Item': 'ITEM-SV-001', // Single Vision Item
        'SPH': '-2.00',
        'CYL': '-0.50',
        'AXIS': '90', // Invalid for SV
        'Quantity': '2',
        'Rate': '400',
      },
    ];

    const mapping = {
      supplier: 'Supplier',
      supplierInvoiceNumber: 'Supplier Invoice Number',
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      axis: 'AXIS',
      quantity: 'Quantity',
      rate: 'Rate',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'PURCHASE', rawRows, mapping);
    if (validation.validRows !== 0 || validation.invalidRows !== 1) {
      throw new Error('SV with AXIS should be rejected');
    }
  });

  await test('TEST 8: KT Bifocal with non-zero CYL missing AXIS should be rejected', async () => {
    const rawRows = [
      {
        'Supplier': 'SUP-ESSILOR',
        'Supplier Invoice Number': 'INV-ERR-002',
        'Unique Item': 'ITEM-KT-001', // KT Bifocal
        'SPH': '+1.50',
        'CYL': '-1.00',
        'AXIS': '', // Missing required AXIS when CYL != 0
        'ADD': '+2.00',
        'Quantity': '2',
        'Rate': '500',
      },
    ];

    const mapping = {
      supplier: 'Supplier',
      supplierInvoiceNumber: 'Supplier Invoice Number',
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      axis: 'AXIS',
      add: 'ADD',
      quantity: 'Quantity',
      rate: 'Rate',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'PURCHASE', rawRows, mapping);
    if (validation.validRows !== 0 || validation.invalidRows !== 1) {
      throw new Error('KT Bifocal with non-zero CYL missing AXIS should be rejected');
    }
  });

  await test('TEST 9: PROG lens missing SIDE should be rejected', async () => {
    const rawRows = [
      {
        'Supplier': 'SUP-ESSILOR',
        'Supplier Invoice Number': 'INV-ERR-003',
        'Unique Item': 'ITEM-PROG-001', // Progressive
        'SPH': '-1.50',
        'CYL': '0.00',
        'ADD': '+2.00',
        'SIDE': '', // Missing required SIDE
        'Quantity': '1',
        'Rate': '1800',
      },
    ];

    const mapping = {
      supplier: 'Supplier',
      supplierInvoiceNumber: 'Supplier Invoice Number',
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      add: 'ADD',
      side: 'SIDE',
      quantity: 'Quantity',
      rate: 'Rate',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'PURCHASE', rawRows, mapping);
    if (validation.validRows !== 0 || validation.invalidRows !== 1) {
      throw new Error('Progressive lens missing SIDE should be rejected');
    }
  });

  // ==========================================
  // 5. OPENING STOCK STRICT CONSTRAINTS
  // ==========================================
  await test('TEST 10: Opening stock for non-existent batch should be strictly REJECTED', async () => {
    const rawRows = [
      {
        'Unique Item': 'ITEM-SV-001',
        'SPH': '-9.25', // Batch does not exist
        'CYL': '-2.75',
        'Quantity': '50',
      },
    ];

    const mapping = {
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      quantity: 'Quantity',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'OPENING_STOCK', rawRows, mapping);
    if (validation.validRows !== 0 || validation.invalidRows !== 1) {
      throw new Error('Opening stock for non-existent batch should be rejected');
    }
  });

  await test('TEST 11: Opening stock for existing batch should post successfully', async () => {
    const rawRows = [
      {
        'Unique Item': 'ITEM-SV-001',
        'SPH': '-2.00', // Pre-existing batch
        'CYL': '-0.50',
        'Quantity': '25',
        'Reason': 'Annual Stock Verification',
      },
    ];

    const mapping = {
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      quantity: 'Quantity',
      reason: 'Reason',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'OPENING_STOCK', rawRows, mapping);
    if (validation.validRows !== 1 || validation.invalidRows !== 0) {
      throw new Error('Opening stock validation failed for existing batch');
    }

    const [session] = await db
      .insert(importSessions)
      .values({
        businessId: testBizId1,
        importType: 'OPENING_STOCK',
        fileName: 'opening_stock_test.xlsx',
        status: 'READY',
        totalRows: '1',
        validRows: '1',
        invalidRows: '0',
        columnMapping: mapping,
        previewData: validation,
        errorSummary: validation.errorSummary,
        createdBy: adminUserId,
      })
      .returning();

    const postResult = await ImportPostingService.postImportSession(testBizId1, session.id, adminUserId);
    if (postResult.status !== 'COMPLETED' || postResult.postedRows !== 1) {
      throw new Error(`Opening stock post failed: ${JSON.stringify(postResult.errors)}`);
    }

    const stock = await StockService.getStock(testBizId1, preExistingBatchId);
    if (stock.physicalStock !== 25 || stock.availableStock !== 25) {
      throw new Error(`Expected physical 25, available 25, got physical=${stock.physicalStock}, available=${stock.availableStock}`);
    }
  });

  // ==========================================
  // 6. SALES INVOICE STOCK VERIFICATION
  // ==========================================
  await test('TEST 12: Sales invoice import should reject if available stock is insufficient', async () => {
    const rawRows = [
      {
        'Customer': 'CUST-MODERN',
        'Invoice Date': '2026-08-12',
        'Unique Item': 'ITEM-SV-001',
        'SPH': '-2.00',
        'CYL': '-0.50',
        'Quantity': '999', // Available is 25
        'Rate': '900.00',
      },
    ];

    const mapping = {
      customer: 'Customer',
      invoiceDate: 'Invoice Date',
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      quantity: 'Quantity',
      rate: 'Rate',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'SALES_INVOICE', rawRows, mapping);
    if (validation.validRows !== 0 || validation.invalidRows !== 1) {
      throw new Error('Sales invoice with insufficient stock should be rejected');
    }
  });

  await test('TEST 13: Sales invoice import with sufficient stock should post and deduct inventory', async () => {
    const rawRows = [
      {
        'Customer': 'CUST-MODERN',
        'Invoice Date': '2026-08-12',
        'Unique Item': 'ITEM-SV-001',
        'SPH': '-2.00',
        'CYL': '-0.50',
        'Quantity': '5', // 5 out of 25 available
        'Rate': '900.00',
      },
    ];

    const mapping = {
      customer: 'Customer',
      invoiceDate: 'Invoice Date',
      uniqueItem: 'Unique Item',
      sph: 'SPH',
      cyl: 'CYL',
      quantity: 'Quantity',
      rate: 'Rate',
    };

    const validation = await ImportValidationService.validateImportData(testBizId1, 'SALES_INVOICE', rawRows, mapping);
    if (validation.validRows !== 1) throw new Error('Sales invoice validation failed');

    const [session] = await db
      .insert(importSessions)
      .values({
        businessId: testBizId1,
        importType: 'SALES_INVOICE',
        fileName: 'sales_invoice_test.xlsx',
        status: 'READY',
        totalRows: '1',
        validRows: '1',
        invalidRows: '0',
        columnMapping: mapping,
        previewData: validation,
        errorSummary: validation.errorSummary,
        createdBy: adminUserId,
      })
      .returning();

    const postResult = await ImportPostingService.postImportSession(testBizId1, session.id, adminUserId);
    if (postResult.status !== 'COMPLETED' || postResult.postedRows !== 1) {
      throw new Error(`Sales invoice posting failed: ${JSON.stringify(postResult.errors)}`);
    }

    // Verify stock deducted: was 25, sold 5 -> remaining 20
    const stockAfter = await StockService.getStock(testBizId1, preExistingBatchId);
    if (stockAfter.physicalStock !== 20 || stockAfter.availableStock !== 20) {
      throw new Error(`Expected physical 20, got physical=${stockAfter.physicalStock}`);
    }
  });

  // ==========================================
  // 7. EXPORT DATASETS & BARCODE FIDELITY
  // ==========================================
  await test('TEST 14: Export datasets should be strictly scoped to business and preserve barcodes', async () => {
    // 1. Export Parties
    const partyExport = await ExportService.exportDataset(testBizId1, 'PARTIES');
    if (partyExport.rowCount < 2 || !partyExport.fileName.includes('Parties_Directory')) {
      throw new Error('Party export failed');
    }

    // 2. Export Batches
    const batchExport = await ExportService.exportDataset(testBizId1, 'OPTICAL_BATCHES');
    if (batchExport.rowCount < 1) throw new Error('Batch export failed');

    const wb = XLSX.read(batchExport.buffer, { type: 'buffer' });
    const sheetData = XLSX.utils.sheet_to_json(wb.Sheets['Batches']);
    const hasPreBatch = sheetData.some((r: any) => r['Barcode'] === preExistingBarcode);
    if (!hasPreBatch) throw new Error(`Exported batches sheet must contain barcode ${preExistingBarcode}`);

    // 3. Export Inventory
    const invExport = await ExportService.exportDataset(testBizId1, 'INVENTORY');
    if (invExport.rowCount < 1) throw new Error('Inventory export failed');

    // 4. Export Purchase Invoices
    const purExport = await ExportService.exportDataset(testBizId1, 'PURCHASE_INVOICES');
    if (purExport.rowCount < 1) throw new Error('Purchase export failed');

    // 5. Cross-business isolation verification
    const biz2Export = await ExportService.exportDataset(testBizId2, 'PARTIES');
    if (biz2Export.rowCount !== 0) throw new Error('Business isolation breach: Biz 2 returned Biz 1 parties');
  });

  await test('TEST 15: Error Report Generator creates formatted error workbook', () => {
    const mockErrors = [
      { row: 2, field: 'quantity', value: '-10', severity: 'ERROR' as const, message: 'Quantity must be positive' },
      { row: 3, field: 'supplier', value: 'Ghost Vendor', severity: 'ERROR' as const, message: 'Supplier not found' },
    ];

    const errBuf = ExcelTemplateService.generateErrorReportWorkbook('failed_purchase.xlsx', 'PURCHASE', mockErrors);
    if (!errBuf || errBuf.length === 0) throw new Error('Error report generated empty buffer');

    const wb = XLSX.read(errBuf, { type: 'buffer' });
    if (!wb.SheetNames.includes('Validation Errors')) throw new Error('Validation Errors sheet missing');
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Validation Errors']);
    if (rows.length !== 2) throw new Error(`Expected 2 error rows, got ${rows.length}`);
  });

  // Cleanup
  try {
    if (testBizId1) await pool.query('DELETE FROM businesses WHERE id = $1', [testBizId1]);
    if (testBizId2) await pool.query('DELETE FROM businesses WHERE id = $1', [testBizId2]);
  } catch {}

  console.log('\n=============================================================');
  console.log(`PHASE 7 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  try {
    await pool.end();
  } catch {}

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(async err => {
  console.error('Unhandled Phase 7 Test Suite Error:', err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
