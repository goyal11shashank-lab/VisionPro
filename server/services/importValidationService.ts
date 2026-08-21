import { db, pool } from '../db/index.js';
import { eq, and, sql, ilike, or } from 'drizzle-orm';
import {
  parties,
  uniqueItems,
  primaryItems,
  categories,
  opticalBatches,
  opticalStocks,
  purchaseInvoices,
  salesInvoices,
  stockLedger,
} from '../db/schema.js';
import { ImportType } from './excelTemplateService.js';
import { ColumnMappingService } from './columnMappingService.js';
import { validateOpticalPower, normalizeOpticalNumber } from './opticalMasterService.js';

export interface ImportError {
  row: number;
  field: string;
  value: any;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface ValidatedRow {
  rowNumber: number;
  raw: Record<string, any>;
  mapped: Record<string, any>;
  resolvedData?: Record<string, any>;
  isValid: boolean;
  isDuplicate: boolean;
  errors: ImportError[];
  documentKey?: string;
}

export interface DocumentGroup {
  documentKey: string;
  documentType: ImportType;
  headerData: Record<string, any>;
  lines: ValidatedRow[];
  isValid: boolean;
  totalAmount: number;
  totalQuantity: number;
  errors: ImportError[];
}

export interface ValidationResult {
  importType: ImportType;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  rows: ValidatedRow[];
  documentGroups: DocumentGroup[];
  errorSummary: ImportError[];
  canPost: boolean;
}

export class ImportValidationService {
  /**
   * Main validation entry point.
   */
  static async validateImportData(
    businessId: string,
    importType: ImportType,
    rawRows: Record<string, any>[],
    columnMapping: Record<string, string>
  ): Promise<ValidationResult> {
    const rows: ValidatedRow[] = [];
    const allErrors: ImportError[] = [];

    // Pre-fetch reference data for this business to do ultra-fast in-memory validation
    const [partyList, itemList, categoryList] = await Promise.all([
      db.select().from(parties).where(eq(parties.businessId, businessId)),
      db
        .select({
          id: uniqueItems.id,
          name: uniqueItems.name,
          code: uniqueItems.code,
          primaryItemId: uniqueItems.primaryItemId,
          categoryId: primaryItems.categoryId,
          purchaseRate: uniqueItems.purchaseRate,
          mrp: uniqueItems.mrp,
        })
        .from(uniqueItems)
        .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
        .where(eq(uniqueItems.businessId, businessId)),
      db
        .select()
        .from(categories)
        .where(or(eq(categories.businessId, businessId), sql`${categories.businessId} IS NULL`)),
    ]);

    const partyMapByName = new Map<string, typeof parties.$inferSelect>();
    const partyMapByCode = new Map<string, typeof parties.$inferSelect>();
    for (const p of partyList) {
      partyMapByName.set(p.name.trim().toLowerCase(), p);
      if (p.partyCode) partyMapByCode.set(p.partyCode.trim().toLowerCase(), p);
    }

    const itemMapByName = new Map<string, any>();
    const itemMapByCode = new Map<string, any>();
    for (const item of itemList) {
      itemMapByName.set(item.name.trim().toLowerCase(), item);
      if (item.code) itemMapByCode.set(item.code.trim().toLowerCase(), item);
    }

    const categoryMapById = new Map<string, typeof categories.$inferSelect>();
    for (const cat of categoryList) {
      categoryMapById.set(cat.id, cat);
    }

    // Step 1: Map and Validate each row individually
    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const rowNumber = i + 2; // Excel row indexing (1-based header is row 1)
      const mapped = ColumnMappingService.mapRow(raw, columnMapping);
      const rowErrors: ImportError[] = [];

      let resolvedData: Record<string, any> = {};
      let documentKey: string | undefined;

      switch (importType) {
        case 'PARTY': {
          resolvedData = await this.validatePartyRow(rowNumber, mapped, partyMapByName, partyMapByCode, rowErrors);
          break;
        }
        case 'PURCHASE': {
          resolvedData = await this.validatePurchaseRow(
            businessId,
            rowNumber,
            mapped,
            partyMapByName,
            partyMapByCode,
            itemMapByName,
            itemMapByCode,
            categoryMapById,
            rowErrors
          );
          if (resolvedData.supplierParty && mapped.supplierInvoiceNumber) {
            documentKey = `PUR_${resolvedData.supplierParty.id}_${mapped.supplierInvoiceNumber.trim().toUpperCase()}`;
          }
          break;
        }
        case 'SALES_ORDER': {
          resolvedData = await this.validateSalesOrderRow(
            businessId,
            rowNumber,
            mapped,
            partyMapByName,
            partyMapByCode,
            itemMapByName,
            itemMapByCode,
            categoryMapById,
            rowErrors
          );
          if (resolvedData.customerParty) {
            const dateKey = mapped.orderDate ? mapped.orderDate.trim() : 'TODAY';
            documentKey = `SO_${resolvedData.customerParty.id}_${dateKey}`;
          }
          break;
        }
        case 'SALES_INVOICE': {
          resolvedData = await this.validateSalesInvoiceRow(
            businessId,
            rowNumber,
            mapped,
            partyMapByName,
            partyMapByCode,
            itemMapByName,
            itemMapByCode,
            categoryMapById,
            rowErrors
          );
          if (resolvedData.customerParty) {
            const dateKey = mapped.invoiceDate ? mapped.invoiceDate.trim() : 'TODAY';
            documentKey = `SI_${resolvedData.customerParty.id}_${dateKey}`;
          }
          break;
        }
        case 'OPENING_STOCK': {
          resolvedData = await this.validateOpeningStockRow(
            businessId,
            rowNumber,
            mapped,
            itemMapByName,
            itemMapByCode,
            categoryMapById,
            rowErrors
          );
          break;
        }
      }

      const hasFatalErrors = rowErrors.some(e => e.severity === 'ERROR');

      rows.push({
        rowNumber,
        raw,
        mapped,
        resolvedData,
        isValid: !hasFatalErrors,
        isDuplicate: false,
        errors: rowErrors,
        documentKey,
      });

      allErrors.push(...rowErrors);
    }

    // Step 2: Check Intra-file Duplicates and Group Documents
    this.detectIntraFileDuplicates(importType, rows, allErrors);

    // Step 3: Group Multi-line Documents (Purchase, Sales Orders, Sales Invoices)
    const documentGroups = this.groupIntoDocuments(importType, rows);

    const totalRows = rows.length;
    const invalidRows = rows.filter(r => !r.isValid).length;
    const validRows = rows.filter(r => r.isValid).length;
    const duplicateRows = rows.filter(r => r.isDuplicate).length;

    return {
      importType,
      totalRows,
      validRows,
      invalidRows,
      duplicateRows,
      rows,
      documentGroups,
      errorSummary: allErrors,
      canPost: validRows > 0,
    };
  }

  /**
   * Validates a single Party import row.
   */
  private static async validatePartyRow(
    rowNumber: number,
    mapped: Record<string, any>,
    partyMapByName: Map<string, any>,
    partyMapByCode: Map<string, any>,
    errors: ImportError[]
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {};

    // 1. Name (Required)
    if (!mapped.name || String(mapped.name).trim() === '') {
      errors.push({ row: rowNumber, field: 'name', value: mapped.name, severity: 'ERROR', message: 'Party Name is required.' });
    } else {
      resolved.name = String(mapped.name).trim();
      const existing = partyMapByName.get(resolved.name.toLowerCase());
      if (existing) {
        errors.push({
          row: rowNumber,
          field: 'name',
          value: mapped.name,
          severity: 'WARNING',
          message: `Party with name "${resolved.name}" already exists in system. Duplicate party may be created or updated.`,
        });
      }
    }

    // 2. Party Type (Required: CUSTOMER, SUPPLIER, BOTH)
    if (!mapped.partyType || String(mapped.partyType).trim() === '') {
      errors.push({ row: rowNumber, field: 'partyType', value: mapped.partyType, severity: 'ERROR', message: 'Party Type is required (CUSTOMER, SUPPLIER, or BOTH).' });
    } else {
      const cleanType = String(mapped.partyType).trim().toUpperCase();
      if (!['CUSTOMER', 'SUPPLIER', 'BOTH'].includes(cleanType)) {
        errors.push({
          row: rowNumber,
          field: 'partyType',
          value: mapped.partyType,
          severity: 'ERROR',
          message: `Invalid Party Type "${mapped.partyType}". Allowed values: CUSTOMER, SUPPLIER, BOTH.`,
        });
      } else {
        resolved.partyType = cleanType;
      }
    }

    // 3. Party Code
    if (mapped.partyCode && String(mapped.partyCode).trim() !== '') {
      resolved.partyCode = String(mapped.partyCode).trim();
      if (partyMapByCode.has(resolved.partyCode.toLowerCase())) {
        errors.push({
          row: rowNumber,
          field: 'partyCode',
          value: mapped.partyCode,
          severity: 'ERROR',
          message: `Party Code "${resolved.partyCode}" is already assigned to another party in your business.`,
        });
      }
    }

    // 4. Mobile & Email
    if (mapped.mobile) {
      const cleanMobile = String(mapped.mobile).replace(/[^0-9]/g, '');
      if (cleanMobile.length < 10) {
        errors.push({
          row: rowNumber,
          field: 'mobile',
          value: mapped.mobile,
          severity: 'WARNING',
          message: 'Mobile number should contain at least 10 digits.',
        });
      }
      resolved.mobile = cleanMobile;
    }

    if (mapped.email) {
      const emailStr = String(mapped.email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
        errors.push({
          row: rowNumber,
          field: 'email',
          value: mapped.email,
          severity: 'WARNING',
          message: 'Invalid email address format.',
        });
      }
      resolved.email = emailStr;
    }

    // 5. GSTIN
    if (mapped.gstin && String(mapped.gstin).trim() !== '') {
      const gstinStr = String(mapped.gstin).trim().toUpperCase();
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(gstinStr)) {
        errors.push({
          row: rowNumber,
          field: 'gstin',
          value: mapped.gstin,
          severity: 'WARNING',
          message: `GSTIN "${gstinStr}" does not match standard 15-character Indian GST format.`,
        });
      }
      resolved.gstin = gstinStr;
    }

    // 6. Numeric credit limits
    if (mapped.creditLimit !== undefined && mapped.creditLimit !== '') {
      const limit = Number(mapped.creditLimit);
      if (isNaN(limit) || limit < 0) {
        errors.push({ row: rowNumber, field: 'creditLimit', value: mapped.creditLimit, severity: 'ERROR', message: 'Credit limit must be a positive number.' });
      } else {
        resolved.creditLimit = limit.toFixed(2);
      }
    }

    if (mapped.creditDays !== undefined && mapped.creditDays !== '') {
      const days = parseInt(mapped.creditDays, 10);
      if (isNaN(days) || days < 0) {
        errors.push({ row: rowNumber, field: 'creditDays', value: mapped.creditDays, severity: 'ERROR', message: 'Credit days must be a non-negative integer.' });
      } else {
        resolved.creditDays = days;
      }
    }

    return resolved;
  }

  /**
   * Validates a single Purchase import row.
   */
  private static async validatePurchaseRow(
    businessId: string,
    rowNumber: number,
    mapped: Record<string, any>,
    partyMapByName: Map<string, any>,
    partyMapByCode: Map<string, any>,
    itemMapByName: Map<string, any>,
    itemMapByCode: Map<string, any>,
    categoryMapById: Map<string, any>,
    errors: ImportError[]
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {};

    // 1. Supplier Party
    if (!mapped.supplier || String(mapped.supplier).trim() === '') {
      errors.push({ row: rowNumber, field: 'supplier', value: mapped.supplier, severity: 'ERROR', message: 'Supplier is required.' });
    } else {
      const sKey = String(mapped.supplier).trim().toLowerCase();
      const party = partyMapByCode.get(sKey) || partyMapByName.get(sKey);
      if (!party) {
        errors.push({ row: rowNumber, field: 'supplier', value: mapped.supplier, severity: 'ERROR', message: `Supplier "${mapped.supplier}" not found in ERP parties list.` });
      } else if (party.partyType !== 'SUPPLIER' && party.partyType !== 'BOTH') {
        errors.push({ row: rowNumber, field: 'supplier', value: mapped.supplier, severity: 'ERROR', message: `Party "${party.name}" has type "${party.partyType}", but a SUPPLIER or BOTH is required.` });
      } else {
        resolved.supplierParty = party;
      }
    }

    // 2. Supplier Invoice Number
    if (!mapped.supplierInvoiceNumber || String(mapped.supplierInvoiceNumber).trim() === '') {
      errors.push({ row: rowNumber, field: 'supplierInvoiceNumber', value: mapped.supplierInvoiceNumber, severity: 'ERROR', message: 'Supplier Invoice Number is required.' });
    } else {
      resolved.supplierInvoiceNumber = String(mapped.supplierInvoiceNumber).trim();
    }

    // 3. Unique Item & Optical Category
    const itemResolution = this.resolveAndValidateOpticalItem(
      rowNumber,
      mapped,
      itemMapByName,
      itemMapByCode,
      categoryMapById,
      errors
    );
    if (itemResolution) {
      resolved.uniqueItem = itemResolution.item;
      resolved.category = itemResolution.category;
      resolved.powers = itemResolution.normalizedPowers;

      // Check if batch exists in DB
      const existingBatch = await this.findBatchByPowers(businessId, resolved.uniqueItem.id, resolved.powers);
      resolved.existingBatch = existingBatch;
    }

    // 4. Quantity & Rate
    this.validateQuantityAndRate(rowNumber, mapped, resolved, errors);

    return resolved;
  }

  /**
   * Validates a single Sales Order import row.
   */
  private static async validateSalesOrderRow(
    businessId: string,
    rowNumber: number,
    mapped: Record<string, any>,
    partyMapByName: Map<string, any>,
    partyMapByCode: Map<string, any>,
    itemMapByName: Map<string, any>,
    itemMapByCode: Map<string, any>,
    categoryMapById: Map<string, any>,
    errors: ImportError[]
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {};

    // 1. Customer Party
    if (!mapped.customer || String(mapped.customer).trim() === '') {
      errors.push({ row: rowNumber, field: 'customer', value: mapped.customer, severity: 'ERROR', message: 'Customer is required.' });
    } else {
      const cKey = String(mapped.customer).trim().toLowerCase();
      const party = partyMapByCode.get(cKey) || partyMapByName.get(cKey);
      if (!party) {
        errors.push({ row: rowNumber, field: 'customer', value: mapped.customer, severity: 'ERROR', message: `Customer "${mapped.customer}" not found in ERP parties list.` });
      } else if (party.partyType !== 'CUSTOMER' && party.partyType !== 'BOTH') {
        errors.push({ row: rowNumber, field: 'customer', value: mapped.customer, severity: 'ERROR', message: `Party "${party.name}" has type "${party.partyType}", but a CUSTOMER or BOTH is required.` });
      } else {
        resolved.customerParty = party;
      }
    }

    // 2. Unique Item & Optical Category
    const itemResolution = this.resolveAndValidateOpticalItem(
      rowNumber,
      mapped,
      itemMapByName,
      itemMapByCode,
      categoryMapById,
      errors
    );
    if (itemResolution) {
      resolved.uniqueItem = itemResolution.item;
      resolved.category = itemResolution.category;
      resolved.powers = itemResolution.normalizedPowers;

      const existingBatch = await this.findBatchByPowers(businessId, resolved.uniqueItem.id, resolved.powers);
      resolved.existingBatch = existingBatch;
    }

    // 3. Quantity & Rate
    this.validateQuantityAndRate(rowNumber, mapped, resolved, errors);

    return resolved;
  }

  /**
   * Validates a single Sales Invoice import row with STOCK AVAILABILITY CHECK.
   */
  private static async validateSalesInvoiceRow(
    businessId: string,
    rowNumber: number,
    mapped: Record<string, any>,
    partyMapByName: Map<string, any>,
    partyMapByCode: Map<string, any>,
    itemMapByName: Map<string, any>,
    itemMapByCode: Map<string, any>,
    categoryMapById: Map<string, any>,
    errors: ImportError[]
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {};

    // 1. Customer Party
    if (!mapped.customer || String(mapped.customer).trim() === '') {
      errors.push({ row: rowNumber, field: 'customer', value: mapped.customer, severity: 'ERROR', message: 'Customer is required.' });
    } else {
      const cKey = String(mapped.customer).trim().toLowerCase();
      const party = partyMapByCode.get(cKey) || partyMapByName.get(cKey);
      if (!party) {
        errors.push({ row: rowNumber, field: 'customer', value: mapped.customer, severity: 'ERROR', message: `Customer "${mapped.customer}" not found in ERP parties list.` });
      } else if (party.partyType !== 'CUSTOMER' && party.partyType !== 'BOTH') {
        errors.push({ row: rowNumber, field: 'customer', value: mapped.customer, severity: 'ERROR', message: `Party "${party.name}" has type "${party.partyType}", but a CUSTOMER or BOTH is required.` });
      } else {
        resolved.customerParty = party;
      }
    }

    // 2. Unique Item & Optical Category
    const itemResolution = this.resolveAndValidateOpticalItem(
      rowNumber,
      mapped,
      itemMapByName,
      itemMapByCode,
      categoryMapById,
      errors
    );

    // 3. Quantity & Rate
    this.validateQuantityAndRate(rowNumber, mapped, resolved, errors);

    if (itemResolution) {
      resolved.uniqueItem = itemResolution.item;
      resolved.category = itemResolution.category;
      resolved.powers = itemResolution.normalizedPowers;

      // Find batch and verify stock
      const existingBatch = await this.findBatchByPowers(businessId, resolved.uniqueItem.id, resolved.powers);
      resolved.existingBatch = existingBatch;

      if (!existingBatch) {
        errors.push({
          row: rowNumber,
          field: 'uniqueItem',
          value: mapped.uniqueItem,
          severity: 'ERROR',
          message: `Optical Batch does not exist in inventory for powers (SPH: ${resolved.powers.sph}, CYL: ${resolved.powers.cyl}). Cannot sell non-existent batch.`,
        });
      } else {
        // Check stock summary
        const [stock] = await db
          .select()
          .from(opticalStocks)
          .where(and(eq(opticalStocks.businessId, businessId), eq(opticalStocks.batchId, existingBatch.id)))
          .limit(1);

        const available = stock ? Number(stock.availableStock) : 0;
        resolved.availableStock = available;

        if (resolved.quantity && available < resolved.quantity) {
          errors.push({
            row: rowNumber,
            field: 'quantity',
            value: mapped.quantity,
            severity: 'ERROR',
            message: `Insufficient available stock for Batch ${existingBatch.barcode}. Required: ${resolved.quantity} pairs, Available: ${available} pairs.`,
          });
        }
      }
    }

    return resolved;
  }

  /**
   * Validates a single Opening Stock import row.
   * STRICT CONSTRAINT: Batch MUST already exist; cannot create new batch.
   */
  private static async validateOpeningStockRow(
    businessId: string,
    rowNumber: number,
    mapped: Record<string, any>,
    itemMapByName: Map<string, any>,
    itemMapByCode: Map<string, any>,
    categoryMapById: Map<string, any>,
    errors: ImportError[]
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {};

    // 1. Unique Item & Optical Category
    const itemResolution = this.resolveAndValidateOpticalItem(
      rowNumber,
      mapped,
      itemMapByName,
      itemMapByCode,
      categoryMapById,
      errors
    );

    // 2. Quantity
    if (mapped.quantity === undefined || mapped.quantity === '') {
      errors.push({ row: rowNumber, field: 'quantity', value: mapped.quantity, severity: 'ERROR', message: 'Quantity is required.' });
    } else {
      const qty = Number(mapped.quantity);
      if (isNaN(qty) || qty <= 0) {
        errors.push({ row: rowNumber, field: 'quantity', value: mapped.quantity, severity: 'ERROR', message: 'Quantity must be a positive number greater than 0.' });
      } else {
        resolved.quantity = qty;
      }
    }

    if (itemResolution) {
      resolved.uniqueItem = itemResolution.item;
      resolved.category = itemResolution.category;
      resolved.powers = itemResolution.normalizedPowers;

      // Check if batch exists in DB
      const existingBatch = await this.findBatchByPowers(businessId, resolved.uniqueItem.id, resolved.powers);
      resolved.existingBatch = existingBatch;

      if (!existingBatch) {
        errors.push({
          row: rowNumber,
          field: 'uniqueItem',
          value: mapped.uniqueItem,
          severity: 'ERROR',
          message: `Optical Batch not found for powers (SPH: ${resolved.powers.sph}, CYL: ${resolved.powers.cyl}). Opening stock import cannot create new batches; batches must exist first.`,
        });
      } else {
        // Check if opening stock already exists for this batch
        const [existingOpening] = await db
          .select()
          .from(stockLedger)
          .where(
            and(
              eq(stockLedger.businessId, businessId),
              eq(stockLedger.batchId, existingBatch.id),
              eq(stockLedger.transactionType, 'OPENING_STOCK')
            )
          )
          .limit(1);

        if (existingOpening) {
          errors.push({
            row: rowNumber,
            field: 'uniqueItem',
            value: mapped.uniqueItem,
            severity: 'WARNING',
            message: `Opening stock entry already recorded previously for Batch ${existingBatch.barcode}. Adding more opening stock will increase the initial balance.`,
          });
        }
      }
    }

    return resolved;
  }

  /**
   * Helper: Resolves Unique Item and validates optical powers against its category rules.
   */
  private static resolveAndValidateOpticalItem(
    rowNumber: number,
    mapped: Record<string, any>,
    itemMapByName: Map<string, any>,
    itemMapByCode: Map<string, any>,
    categoryMapById: Map<string, any>,
    errors: ImportError[]
  ): { item: any; category: any; normalizedPowers: any } | null {
    if (!mapped.uniqueItem || String(mapped.uniqueItem).trim() === '') {
      errors.push({ row: rowNumber, field: 'uniqueItem', value: mapped.uniqueItem, severity: 'ERROR', message: 'Unique Item is required.' });
      return null;
    }

    const itemKey = String(mapped.uniqueItem).trim().toLowerCase();
    const item = itemMapByCode.get(itemKey) || itemMapByName.get(itemKey);

    if (!item) {
      errors.push({ row: rowNumber, field: 'uniqueItem', value: mapped.uniqueItem, severity: 'ERROR', message: `Unique Item "${mapped.uniqueItem}" not found in ERP item catalog.` });
      return null;
    }

    const category = categoryMapById.get(item.categoryId);
    const catCode = category?.code?.toUpperCase() || 'SV';

    // Normalize SPH
    let sphStr = mapped.sph !== undefined ? String(mapped.sph).trim() : '';
    if (sphStr === '') {
      errors.push({ row: rowNumber, field: 'sph', value: mapped.sph, severity: 'ERROR', message: 'SPH (Spherical power) is required.' });
      return null;
    }
    const normSph = this.normalizeDiopter(sphStr);
    if (normSph === null) {
      errors.push({ row: rowNumber, field: 'sph', value: mapped.sph, severity: 'ERROR', message: `Invalid SPH power value "${mapped.sph}". Must be a valid diopter number (e.g. -2.00, +1.50, 0.00).` });
      return null;
    }

    // Normalize CYL
    let cylStr = mapped.cyl !== undefined && String(mapped.cyl).trim() !== '' ? String(mapped.cyl).trim() : '0.00';
    const normCyl = this.normalizeDiopter(cylStr);
    if (normCyl === null) {
      errors.push({ row: rowNumber, field: 'cyl', value: mapped.cyl, severity: 'ERROR', message: `Invalid CYL power value "${mapped.cyl}". Must be a valid diopter number (e.g. -0.50, 0.00).` });
      return null;
    }

    let normAxis: number | null = null;
    let normAdd: string | null = null;
    let normSide: string | null = null;

    const cylVal = parseFloat(normCyl);

    // Validate based on category:
    // 1. Single Vision (SV)
    if (catCode === 'SV' || catCode.includes('SINGLE')) {
      if (mapped.axis && String(mapped.axis).trim() !== '' && String(mapped.axis).trim() !== '0') {
        errors.push({ row: rowNumber, field: 'axis', value: mapped.axis, severity: 'ERROR', message: 'Single Vision (SV) lens does not permit AXIS values.' });
      }
      if (mapped.add && String(mapped.add).trim() !== '' && String(mapped.add).trim() !== '0') {
        errors.push({ row: rowNumber, field: 'add', value: mapped.add, severity: 'ERROR', message: 'Single Vision (SV) lens does not permit ADD values.' });
      }
      if (mapped.side && String(mapped.side).trim() !== '') {
        errors.push({ row: rowNumber, field: 'side', value: mapped.side, severity: 'ERROR', message: 'Single Vision (SV) lens does not permit SIDE values.' });
      }
    }
    // 2. Bifocal (KT / Kryptok)
    else if (catCode === 'KT' || catCode.includes('BIFOCAL')) {
      if (cylVal !== 0) {
        if (mapped.axis === undefined || mapped.axis === null || String(mapped.axis).trim() === '') {
          errors.push({ row: rowNumber, field: 'axis', value: mapped.axis, severity: 'ERROR', message: 'AXIS is required for Bifocal (KT) lenses when CYL is non-zero (0 to 180 degrees).' });
        } else {
          normAxis = parseInt(String(mapped.axis).trim(), 10);
          if (isNaN(normAxis) || normAxis < 0 || normAxis > 180) {
            errors.push({ row: rowNumber, field: 'axis', value: mapped.axis, severity: 'ERROR', message: 'AXIS must be between 0 and 180 degrees.' });
          }
        }
      }

      if (mapped.add !== undefined && String(mapped.add).trim() !== '') {
        normAdd = this.normalizeDiopter(String(mapped.add).trim());
        if (normAdd === null) {
          errors.push({ row: rowNumber, field: 'add', value: mapped.add, severity: 'ERROR', message: `Invalid ADD value "${mapped.add}".` });
        }
      }

      if (mapped.side && String(mapped.side).trim() !== '') {
        errors.push({ row: rowNumber, field: 'side', value: mapped.side, severity: 'ERROR', message: 'Bifocal (KT) lens does not permit SIDE values.' });
      }
    }
    // 3. Progressive (PROG)
    else if (catCode === 'PROG' || catCode.includes('PROGRESSIVE')) {
      if (cylVal !== 0) {
        if (mapped.axis === undefined || mapped.axis === null || String(mapped.axis).trim() === '') {
          errors.push({ row: rowNumber, field: 'axis', value: mapped.axis, severity: 'ERROR', message: 'AXIS is required for Progressive (PROG) lenses when CYL is non-zero (0 to 180 degrees).' });
        } else {
          normAxis = parseInt(String(mapped.axis).trim(), 10);
          if (isNaN(normAxis) || normAxis < 0 || normAxis > 180) {
            errors.push({ row: rowNumber, field: 'axis', value: mapped.axis, severity: 'ERROR', message: 'AXIS must be between 0 and 180 degrees.' });
          }
        }
      }

      if (mapped.add !== undefined && String(mapped.add).trim() !== '') {
        normAdd = this.normalizeDiopter(String(mapped.add).trim());
        if (normAdd === null) {
          errors.push({ row: rowNumber, field: 'add', value: mapped.add, severity: 'ERROR', message: `Invalid ADD value "${mapped.add}".` });
        }
      }

      if (!mapped.side || String(mapped.side).trim() === '') {
        errors.push({ row: rowNumber, field: 'side', value: mapped.side, severity: 'ERROR', message: 'SIDE is required for Progressive (PROG) lenses ("R", "L", or "BE").' });
      } else {
        const s = String(mapped.side).trim().toUpperCase();
        if (['R', 'RIGHT'].includes(s)) normSide = 'R';
        else if (['L', 'LEFT'].includes(s)) normSide = 'L';
        else if (['BE', 'BOTH', 'BOTH EYES'].includes(s)) normSide = 'BE';
        else {
          errors.push({ row: rowNumber, field: 'side', value: mapped.side, severity: 'ERROR', message: `Invalid SIDE "${mapped.side}". Allowed values: R, L, BE.` });
        }
      }
    }

    return {
      item,
      category,
      normalizedPowers: {
        sph: normSph,
        cyl: normCyl,
        axis: normAxis,
        add: normAdd,
        side: normSide,
      },
    };
  }

  /**
   * Helper: Normalizes optical diopter strings: "-2" -> "-2.00", "+1.5" -> "+1.50", "0" -> "0.00".
   */
  static normalizeDiopter(val: string): string | null {
    if (!val) return null;
    const clean = val.trim().toUpperCase();
    if (clean === 'PLANO' || clean === 'PL' || clean === '0' || clean === '0.0' || clean === '0.00') {
      return '0.00';
    }

    const num = parseFloat(clean);
    if (isNaN(num)) return null;

    const formatted = Math.abs(num).toFixed(2);
    if (num > 0) return `+${formatted}`;
    if (num < 0) return `-${formatted}`;
    return '0.00';
  }

  /**
   * Helper: Validates Quantity and Rate fields.
   */
  private static validateQuantityAndRate(
    rowNumber: number,
    mapped: Record<string, any>,
    resolved: Record<string, any>,
    errors: ImportError[]
  ): void {
    if (mapped.quantity === undefined || mapped.quantity === '') {
      errors.push({ row: rowNumber, field: 'quantity', value: mapped.quantity, severity: 'ERROR', message: 'Quantity is required.' });
    } else {
      const qty = Number(mapped.quantity);
      if (isNaN(qty) || qty <= 0) {
        errors.push({ row: rowNumber, field: 'quantity', value: mapped.quantity, severity: 'ERROR', message: 'Quantity must be a positive number greater than 0.' });
      } else {
        resolved.quantity = qty;
      }
    }

    if (mapped.rate === undefined || mapped.rate === '') {
      errors.push({ row: rowNumber, field: 'rate', value: mapped.rate, severity: 'ERROR', message: 'Rate is required.' });
    } else {
      const rate = Number(mapped.rate);
      if (isNaN(rate) || rate < 0) {
        errors.push({ row: rowNumber, field: 'rate', value: mapped.rate, severity: 'ERROR', message: 'Rate must be a non-negative number.' });
      } else {
        resolved.rate = rate.toFixed(2);
      }
    }

    // Discount
    if (mapped.discountType) {
      const dt = String(mapped.discountType).trim().toUpperCase();
      if (!['NONE', 'PERCENTAGE', 'FIXED'].includes(dt)) {
        errors.push({ row: rowNumber, field: 'discountType', value: mapped.discountType, severity: 'WARNING', message: 'Discount Type should be PERCENTAGE, FIXED, or NONE.' });
      }
      resolved.discountType = dt;
    } else {
      resolved.discountType = 'NONE';
    }

    if (mapped.discountValue !== undefined && mapped.discountValue !== '') {
      const dv = Number(mapped.discountValue);
      if (isNaN(dv) || dv < 0) {
        errors.push({ row: rowNumber, field: 'discountValue', value: mapped.discountValue, severity: 'WARNING', message: 'Discount value must be a non-negative number.' });
      } else {
        resolved.discountValue = dv.toFixed(2);
      }
    } else {
      resolved.discountValue = '0.00';
    }

    // GST Mode
    if (mapped.gstMode) {
      const gm = String(mapped.gstMode).trim().toUpperCase();
      if (['INTRA', 'INTRA_STATE', 'LOCAL'].includes(gm)) {
        resolved.gstMode = 'INTRA_STATE';
      } else if (['INTER', 'INTER_STATE', 'IGST'].includes(gm)) {
        resolved.gstMode = 'INTER_STATE';
      } else {
        resolved.gstMode = 'INTRA_STATE';
      }
    } else {
      resolved.gstMode = 'INTRA_STATE';
    }
  }

  /**
   * Helper: Searches optical batch by unique item ID and normalized power values.
   */
  private static async findBatchByPowers(
    businessId: string,
    uniqueItemId: string,
    powers: { sph: string; cyl: string; axis: number | null; add: string | null; side: string | null }
  ): Promise<typeof opticalBatches.$inferSelect | null> {
    const conditions = [
      eq(opticalBatches.businessId, businessId),
      eq(opticalBatches.uniqueItemId, uniqueItemId),
      eq(opticalBatches.sph, String(powers.sph)),
      eq(opticalBatches.cyl, String(powers.cyl)),
    ];

    if (powers.axis !== null && powers.axis !== undefined) {
      conditions.push(eq(opticalBatches.axis, String(powers.axis)));
    }
    if (powers.add !== null && powers.add !== undefined) {
      conditions.push(eq(opticalBatches.add, String(powers.add)));
    }
    if (powers.side !== null && powers.side !== undefined) {
      conditions.push(eq(opticalBatches.side, powers.side));
    }

    const [batch] = await db
      .select()
      .from(opticalBatches)
      .where(and(...conditions))
      .limit(1);

    return batch || null;
  }

  /**
   * Detects duplicate rows within the uploaded file itself.
   */
  private static detectIntraFileDuplicates(
    importType: ImportType,
    rows: ValidatedRow[],
    allErrors: ImportError[]
  ): void {
    if (importType === 'PARTY') {
      const seenPartyCodes = new Map<string, number>();
      const seenPartyNames = new Map<string, number>();

      for (const row of rows) {
        if (row.resolvedData?.partyCode) {
          const code = row.resolvedData.partyCode.toLowerCase();
          if (seenPartyCodes.has(code)) {
            row.isDuplicate = true;
            row.isValid = false;
            const msg = `Duplicate Party Code "${row.resolvedData.partyCode}" found in file (already on row ${seenPartyCodes.get(code)}).`;
            row.errors.push({ row: row.rowNumber, field: 'partyCode', value: row.resolvedData.partyCode, severity: 'ERROR', message: msg });
            allErrors.push({ row: row.rowNumber, field: 'partyCode', value: row.resolvedData.partyCode, severity: 'ERROR', message: msg });
          } else {
            seenPartyCodes.set(code, row.rowNumber);
          }
        }

        if (row.resolvedData?.name) {
          const name = row.resolvedData.name.toLowerCase();
          if (seenPartyNames.has(name)) {
            row.errors.push({
              row: row.rowNumber,
              field: 'name',
              value: row.resolvedData.name,
              severity: 'WARNING',
              message: `Duplicate Party Name "${row.resolvedData.name}" repeated in file (first seen on row ${seenPartyNames.get(name)}).`,
            });
          } else {
            seenPartyNames.set(name, row.rowNumber);
          }
        }
      }
    }
  }

  /**
   * Groups rows into multi-line document structures (for Purchase, Sales Orders, Sales Invoices).
   */
  private static groupIntoDocuments(importType: ImportType, rows: ValidatedRow[]): DocumentGroup[] {
    if (importType === 'PARTY' || importType === 'OPENING_STOCK') {
      return [];
    }

    const groupMap = new Map<string, DocumentGroup>();

    for (const row of rows) {
      if (!row.documentKey) continue;

      let group = groupMap.get(row.documentKey);
      if (!group) {
        group = {
          documentKey: row.documentKey,
          documentType: importType,
          headerData: {
            supplier: row.resolvedData?.supplierParty,
            customer: row.resolvedData?.customerParty,
            supplierInvoiceNumber: row.mapped.supplierInvoiceNumber,
            supplierInvoiceDate: row.mapped.supplierInvoiceDate,
            invoiceDate: row.mapped.invoiceDate,
            orderDate: row.mapped.orderDate,
            gstMode: row.resolvedData?.gstMode || 'INTRA_STATE',
          },
          lines: [],
          isValid: true,
          totalAmount: 0,
          totalQuantity: 0,
          errors: [],
        };
        groupMap.set(row.documentKey, group);
      }

      group.lines.push(row);
      if (!row.isValid) {
        group.isValid = false;
      }

      if (row.resolvedData?.quantity && row.resolvedData?.rate) {
        const qty = Number(row.resolvedData.quantity);
        const rate = Number(row.resolvedData.rate);
        group.totalQuantity += qty;
        group.totalAmount += qty * rate;
      }
    }

    return Array.from(groupMap.values());
  }
}
