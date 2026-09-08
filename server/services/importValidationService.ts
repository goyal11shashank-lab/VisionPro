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
  importMode?: 'CREATE_ONLY' | 'UPSERT';
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
    columnMapping: Record<string, string>,
    options: { importMode?: 'CREATE_ONLY' | 'UPSERT' } = {}
  ): Promise<ValidationResult> {
    const importMode = options.importMode || 'CREATE_ONLY';
    const rows: ValidatedRow[] = [];
    const allErrors: ImportError[] = [];

    // Pre-fetch reference data for this business to do ultra-fast in-memory validation
    const [partyList, itemList, categoryList, allUniqueItemsList, allPrimaryItemsList] = await Promise.all([
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
        .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
        .where(eq(uniqueItems.businessId, businessId)),
      db
        .select()
        .from(categories)
        .where(or(eq(categories.businessId, businessId), sql`${categories.businessId} IS NULL`)),
      importType === 'STOCK_ITEM'
        ? db.select().from(uniqueItems).where(eq(uniqueItems.businessId, businessId))
        : Promise.resolve([]),
      importType === 'STOCK_ITEM'
        ? db.select().from(primaryItems).where(eq(primaryItems.businessId, businessId))
        : Promise.resolve([]),
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

    const stockItemByCode = new Map<string, typeof uniqueItems.$inferSelect>();
    for (const item of allUniqueItemsList) {
      if (item.code) stockItemByCode.set(item.code.trim().toUpperCase(), item);
    }

    const primaryItemByName = new Map<string, typeof primaryItems.$inferSelect>();
    const primaryItemByCode = new Map<string, typeof primaryItems.$inferSelect>();
    for (const pi of allPrimaryItemsList) {
      primaryItemByName.set(pi.name.trim().toLowerCase(), pi);
      if (pi.code) primaryItemByCode.set(pi.code.trim().toLowerCase(), pi);
    }

    const batchCountMap = new Map<string, number>();
    if (importType === 'STOCK_ITEM') {
      const bcRes = await pool.query(
        `SELECT unique_item_id, COUNT(*)::int as batch_count FROM optical_batches WHERE business_id = $1 GROUP BY unique_item_id`,
        [businessId]
      );
      for (const r of bcRes.rows) {
        batchCountMap.set(r.unique_item_id, r.batch_count);
      }
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
        case 'OPTICAL_BATCH': {
          resolvedData = await this.validateOpticalBatchRow(
            businessId,
            rowNumber,
            mapped,
            itemMapByName,
            itemMapByCode,
            categoryMapById,
            partyMapByName,
            partyMapByCode,
            rowErrors
          );
          break;
        }
        case 'STOCK_ITEM': {
          resolvedData = await this.validateStockItemRow(
            businessId,
            rowNumber,
            mapped,
            stockItemByCode,
            primaryItemByName,
            primaryItemByCode,
            batchCountMap,
            importMode,
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
      importMode,
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
            severity: 'WARNING',
            message: `Warning: Available stock is insufficient for Batch ${existingBatch.barcode}. Required: ${resolved.quantity} pairs, Available: ${available} pairs. Inventory will become negative upon sale.`,
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
      } else if (Math.abs(Math.round(qty * 2) - qty * 2) > 0.0001) {
        errors.push({ row: rowNumber, field: 'quantity', value: mapped.quantity, severity: 'ERROR', message: 'Quantity must be in steps of 0.5 pairs or pieces (e.g. 0.5, 1.0, 1.5, 2.0).' });
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
   * Validates a single Optical Batch & Powers import row.
   * STRICT CONSTRAINT: Unique Item MUST already exist in the database.
   * Reuses validateOpticalPower from opticalMasterService.
   */
  private static async validateOpticalBatchRow(
    businessId: string,
    rowNumber: number,
    mapped: Record<string, any>,
    itemMapByName: Map<string, any>,
    itemMapByCode: Map<string, any>,
    categoryMapById: Map<string, any>,
    partyMapByName: Map<string, any>,
    partyMapByCode: Map<string, any>,
    errors: ImportError[]
  ): Promise<Record<string, any>> {
    const resolved: Record<string, any> = {};

    // 1. Unique Item (Required - MUST already exist in database)
    const uniqueItemInput = mapped.unique_item || mapped.uniqueItem || mapped.item || mapped.sku_name;
    if (!uniqueItemInput || String(uniqueItemInput).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'unique_item',
        value: uniqueItemInput,
        severity: 'ERROR',
        message: 'Unique Item is required.',
      });
      return resolved;
    }

    const itemKey = String(uniqueItemInput).trim().toLowerCase();
    const item = itemMapByCode.get(itemKey) || itemMapByName.get(itemKey);

    if (!item) {
      errors.push({
        row: rowNumber,
        field: 'unique_item',
        value: uniqueItemInput,
        severity: 'ERROR',
        message: `Unique Item "${uniqueItemInput}" does not exist in the database. Create the Unique Item in the software before importing batches.`,
      });
      return resolved;
    }

    resolved.uniqueItem = item;
    const category = categoryMapById.get(item.categoryId);
    const catCode = (category?.code || 'SV').toUpperCase();
    resolved.category = category || { id: item.categoryId, code: catCode, name: catCode };

    // 2. Batch Name & Optical Power Validation
    const batchNameInput = mapped.batch_name || mapped.batchName || mapped.power || mapped.powers;
    const parsedPowers = this.parseOpticalPowerValues(batchNameInput, mapped, catCode);

    if (!parsedPowers) {
      errors.push({
        row: rowNumber,
        field: 'batch_name',
        value: batchNameInput,
        severity: 'ERROR',
        message: 'Valid optical batch power is required (e.g. "-6.00/-2.00", "+1.75/-2.00/90/+2.00", or "+1.00/-0.50/180/+1.50/R").',
      });
    } else {
      try {
        const validatedPowers = validateOpticalPower(
          catCode,
          parsedPowers.sph,
          parsedPowers.cyl,
          parsedPowers.axis,
          parsedPowers.add,
          parsedPowers.side
        );
        resolved.powers = validatedPowers;
        resolved.identityKey = validatedPowers.identityKey;
        resolved.fullIdentityKey = `${item.id}:${validatedPowers.identityKey}`;
      } catch (err: any) {
        errors.push({
          row: rowNumber,
          field: 'batch_name',
          value: batchNameInput,
          severity: 'ERROR',
          message: `Optical power validation failed: ${err.message}`,
        });
      }
    }

    // 3. SKU (Required)
    const skuInput = mapped.sku || mapped.sku_code || mapped.batch_sku;
    if (!skuInput || String(skuInput).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'sku',
        value: skuInput,
        severity: 'ERROR',
        message: 'SKU is required for optical batch.',
      });
    } else {
      resolved.sku = String(skuInput).trim();
    }

    // 4. Opening Stock Quantity (Required, numeric >= 0)
    const qtyInput = mapped.opening_stock_quantity !== undefined && mapped.opening_stock_quantity !== ''
      ? mapped.opening_stock_quantity
      : mapped.quantity;
    if (qtyInput === undefined || qtyInput === null || String(qtyInput).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'opening_stock_quantity',
        value: qtyInput,
        severity: 'ERROR',
        message: 'Opening stock quantity is required.',
      });
    } else {
      const qtyNum = Number(qtyInput);
      if (isNaN(qtyNum) || qtyNum < 0) {
        errors.push({
          row: rowNumber,
          field: 'opening_stock_quantity',
          value: qtyInput,
          severity: 'ERROR',
          message: `Opening stock quantity must be a positive number or zero (e.g. 10, 0.5, 1.5). Received "${qtyInput}".`,
        });
      } else if (qtyNum > 0 && Math.abs(Math.round(qtyNum * 2) - qtyNum * 2) > 0.0001) {
        errors.push({
          row: rowNumber,
          field: 'opening_stock_quantity',
          value: qtyInput,
          severity: 'ERROR',
          message: `Opening stock quantity must be in steps of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0). Received "${qtyInput}".`,
        });
      } else {
        resolved.openingStockQuantity = qtyNum;
      }
    }

    // 5. Purchase Cost (Required, numeric >= 0)
    const costInput = mapped.purchase_cost !== undefined && mapped.purchase_cost !== ''
      ? mapped.purchase_cost
      : mapped.rate;
    if (costInput === undefined || costInput === null || String(costInput).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'purchase_cost',
        value: costInput,
        severity: 'ERROR',
        message: 'Purchase cost is required.',
      });
    } else {
      const costNum = Number(costInput);
      if (isNaN(costNum) || costNum < 0) {
        errors.push({
          row: rowNumber,
          field: 'purchase_cost',
          value: costInput,
          severity: 'ERROR',
          message: 'Purchase cost must be a non-negative number.',
        });
      } else {
        resolved.purchaseCost = costNum;
      }
    }

    // 6. Selling Price (Required, numeric >= 0)
    const priceInput = mapped.selling_price !== undefined && mapped.selling_price !== ''
      ? mapped.selling_price
      : mapped.mrp;
    if (priceInput === undefined || priceInput === null || String(priceInput).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'selling_price',
        value: priceInput,
        severity: 'ERROR',
        message: 'Selling price is required.',
      });
    } else {
      const priceNum = Number(priceInput);
      if (isNaN(priceNum) || priceNum < 0) {
        errors.push({
          row: rowNumber,
          field: 'selling_price',
          value: priceInput,
          severity: 'ERROR',
          message: 'Selling price must be a non-negative number.',
        });
      } else {
        resolved.sellingPrice = priceNum;
      }
    }

    // 7. Unit (Required, allowed units: prs, pairs, pcs, pieces)
    const unitInput = mapped.unit || 'prs';
    const validUnits = ['prs', 'pairs', 'pcs', 'pieces', 'pr', 'pair', 'pc', 'piece'];
    const normUnit = String(unitInput).trim().toLowerCase();
    if (!validUnits.includes(normUnit)) {
      errors.push({
        row: rowNumber,
        field: 'unit',
        value: unitInput,
        severity: 'ERROR',
        message: `Unit "${unitInput}" is invalid. Allowed units: prs, pairs, pcs, pieces.`,
      });
    } else {
      resolved.unit = normUnit;
    }

    // 8. Barcode (Optional)
    if (mapped.barcode && String(mapped.barcode).trim() !== '') {
      resolved.barcode = String(mapped.barcode).trim();
    }

    // 9. Supplier (Optional)
    if (mapped.supplier && String(mapped.supplier).trim() !== '') {
      const sKey = String(mapped.supplier).trim().toLowerCase();
      const party = partyMapByCode.get(sKey) || partyMapByName.get(sKey);
      if (!party) {
        errors.push({
          row: rowNumber,
          field: 'supplier',
          value: mapped.supplier,
          severity: 'WARNING',
          message: `Supplier "${mapped.supplier}" not found in ERP parties list. Will import batch without linking supplier party.`,
        });
      } else {
        resolved.supplierParty = party;
      }
    }

    // 10. Optional Metadata
    if (mapped.purchase_date || mapped.purchaseDate || mapped.date) {
      resolved.purchaseDate = String(mapped.purchase_date || mapped.purchaseDate || mapped.date).trim();
    }
    if (mapped.batch_reference || mapped.batchReference || mapped.lot) {
      resolved.batchReference = String(mapped.batch_reference || mapped.batchReference || mapped.lot).trim();
    }
    if (mapped.expiry_date || mapped.expiryDate) {
      resolved.expiryDate = String(mapped.expiry_date || mapped.expiryDate).trim();
    }
    if (mapped.location) {
      resolved.location = String(mapped.location).trim();
    }
    if (mapped.reorder_level !== undefined && mapped.reorder_level !== '') {
      const rl = Number(mapped.reorder_level);
      if (!isNaN(rl) && rl >= 0) resolved.reorderLevel = rl;
    }
    if (mapped.remarks) {
      resolved.remarks = String(mapped.remarks).trim();
    }

    // 11. Check if batch already exists in DB
    if (resolved.uniqueItem && resolved.powers) {
      const existingBatch = await this.findBatchByPowers(businessId, resolved.uniqueItem.id, {
        sph: resolved.powers.sphNum.toFixed(2),
        cyl: resolved.powers.cylNum.toFixed(2),
        axis: resolved.powers.axisNum,
        add: resolved.powers.addNum.toFixed(2),
        side: resolved.powers.sideNormalized,
      });

      if (existingBatch) {
        resolved.existingBatch = existingBatch;
        errors.push({
          row: rowNumber,
          field: 'batch_name',
          value: batchNameInput,
          severity: 'WARNING',
          message: `Optical Batch with barcode ${existingBatch.barcode} already exists in database for this power combination. Importing will add to opening stock balance.`,
        });
      }
    }

    return resolved;
  }

  /**
   * Helper: Parses optical power parameters from batch_name string or explicit fields.
   */
  private static parseOpticalPowerValues(
    batchNameRaw: any,
    mapped: Record<string, any>,
    categoryCode: string
  ): { sph: string; cyl: string; axis: string | null; add: string | null; side: string | null } | null {
    const cat = categoryCode.toUpperCase();
    let sph: string | null = null;
    let cyl: string | null = null;
    let axis: string | null = null;
    let add: string | null = null;
    let side: string | null = null;

    // Check if explicit power fields are provided in mapped
    if (mapped.sph !== undefined && mapped.sph !== '') sph = String(mapped.sph).trim();
    if (mapped.cyl !== undefined && mapped.cyl !== '') cyl = String(mapped.cyl).trim();
    if (mapped.axis !== undefined && mapped.axis !== '') axis = String(mapped.axis).trim();
    if (mapped.add !== undefined && mapped.add !== '') add = String(mapped.add).trim();
    if (mapped.side !== undefined && mapped.side !== '') side = String(mapped.side).trim().toUpperCase();

    // If batch_name string is provided, extract power coordinates
    const batchName = String(batchNameRaw || '').trim();
    if (batchName) {
      if (/SPH[:=\s]/i.test(batchName)) {
        const sphMatch = batchName.match(/SPH[:=\s]*([+-]?\d+(?:\.\d+)?)/i);
        const cylMatch = batchName.match(/CYL[:=\s]*([+-]?\d+(?:\.\d+)?)/i);
        const axisMatch = batchName.match(/AXIS[:=\s]*(\d+(?:\.\d+)?)/i);
        const addMatch = batchName.match(/ADD[:=\s]*([+-]?\d+(?:\.\d+)?)/i);
        const sideMatch = batchName.match(/SIDE[:=\s]*(NONE|R|L|BE)/i);

        if (sphMatch && !sph) sph = sphMatch[1];
        if (cylMatch && !cyl) cyl = cylMatch[1];
        if (axisMatch && !axis) axis = axisMatch[1];
        if (addMatch && !add) add = addMatch[1];
        if (sideMatch && !side) side = sideMatch[1].toUpperCase();
      } else {
        // Clean up leading/trailing brackets or prefixes
        const cleaned = batchName.replace(/^[(\[]|[)\]]$/g, '').trim();
        const parts = cleaned.split(/[\/\s,]+/).filter(p => p.length > 0);

        if (parts.length >= 1 && !sph) {
          sph = parts[0];
        }
        if (parts.length >= 2 && !cyl) {
          cyl = parts[1];
        }
        if (parts.length >= 3 && !axis && (cat === 'KT' || cat === 'PROG')) {
          axis = parts[2];
        }
        if (parts.length >= 4 && !add && (cat === 'KT' || cat === 'PROG')) {
          add = parts[3];
        }
        if (parts.length >= 5 && !side && cat === 'PROG') {
          side = parts[4].toUpperCase();
        } else if (parts.length >= 3 && !side && cat === 'PROG' && ['R', 'L', 'BE'].includes(parts[2].toUpperCase())) {
          side = parts[2].toUpperCase();
        }
      }
    }

    if (!sph) return null;
    if (!cyl) cyl = '0.00';

    return {
      sph,
      cyl,
      axis: axis || (cat === 'SV' ? null : '0'),
      add: add || (cat === 'SV' ? null : '0.00'),
      side: side || (cat === 'PROG' ? 'BE' : 'NONE'),
    };
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
      } else if (Math.abs(Math.round(qty * 2) - qty * 2) > 0.0001) {
        errors.push({ row: rowNumber, field: 'quantity', value: mapped.quantity, severity: 'ERROR', message: 'Quantity must be in steps of 0.5 pairs or pieces (e.g. 0.5, 1.0, 1.5, 2.0).' });
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

    if (importType === 'OPTICAL_BATCH') {
      const seenBatches = new Map<string, number>();
      const seenSkus = new Map<string, number>();
      const seenBarcodes = new Map<string, number>();

      for (const row of rows) {
        // Check batch identity key duplication under same unique item
        if (row.resolvedData?.fullIdentityKey) {
          const key = row.resolvedData.fullIdentityKey;
          if (seenBatches.has(key)) {
            row.isDuplicate = true;
            row.isValid = false;
            const prevRow = seenBatches.get(key);
            const msg = `Duplicate optical batch power for this Unique Item in row ${prevRow}. Each batch must have a distinct optical power configuration.`;
            row.errors.push({ row: row.rowNumber, field: 'batch_name', value: row.mapped.batch_name || row.mapped.batchName, severity: 'ERROR', message: msg });
            allErrors.push({ row: row.rowNumber, field: 'batch_name', value: row.mapped.batch_name || row.mapped.batchName, severity: 'ERROR', message: msg });
          } else {
            seenBatches.set(key, row.rowNumber);
          }
        }

        // Check SKU duplication
        if (row.resolvedData?.sku) {
          const sku = row.resolvedData.sku.toLowerCase();
          if (seenSkus.has(sku)) {
            row.isDuplicate = true;
            row.isValid = false;
            const prevRow = seenSkus.get(sku);
            const msg = `Duplicate SKU "${row.resolvedData.sku}" detected in file (already on row ${prevRow}). SKUs must be unique.`;
            row.errors.push({ row: row.rowNumber, field: 'sku', value: row.resolvedData.sku, severity: 'ERROR', message: msg });
            allErrors.push({ row: row.rowNumber, field: 'sku', value: row.resolvedData.sku, severity: 'ERROR', message: msg });
          } else {
            seenSkus.set(sku, row.rowNumber);
          }
        }

        // Check Barcode duplication (if provided)
        if (row.resolvedData?.barcode) {
          const bc = row.resolvedData.barcode.toLowerCase();
          if (seenBarcodes.has(bc)) {
            row.isDuplicate = true;
            row.isValid = false;
            const prevRow = seenBarcodes.get(bc);
            const msg = `Duplicate Barcode "${row.resolvedData.barcode}" detected in file (already on row ${prevRow}). Barcodes must be unique.`;
            row.errors.push({ row: row.rowNumber, field: 'barcode', value: row.resolvedData.barcode, severity: 'ERROR', message: msg });
            allErrors.push({ row: row.rowNumber, field: 'barcode', value: row.resolvedData.barcode, severity: 'ERROR', message: msg });
          } else {
            seenBarcodes.set(bc, row.rowNumber);
          }
        }
      }
    }

    if (importType === 'STOCK_ITEM') {
      const seenCodes = new Map<string, number>();
      for (const row of rows) {
        if (row.resolvedData?.code) {
          const code = String(row.resolvedData.code).trim().toUpperCase();
          if (seenCodes.has(code)) {
            row.isDuplicate = true;
            row.isValid = false;
            const prevRow = seenCodes.get(code);
            const msg = `Duplicate Stock Item Code "${row.resolvedData.code}" in file (already on row ${prevRow}). Stock Item codes must be unique per file.`;
            row.errors.push({ row: row.rowNumber, field: 'stock_item_code', value: row.resolvedData.code, severity: 'ERROR', message: msg });
            allErrors.push({ row: row.rowNumber, field: 'stock_item_code', value: row.resolvedData.code, severity: 'ERROR', message: msg });
          } else {
            seenCodes.set(code, row.rowNumber);
          }
        }
      }
    }
  }

  /**
   * Groups rows into multi-line document structures (for Purchase, Sales Orders, Sales Invoices).
   */
  private static groupIntoDocuments(importType: ImportType, rows: ValidatedRow[]): DocumentGroup[] {
    if (importType === 'PARTY' || importType === 'OPENING_STOCK' || importType === 'OPTICAL_BATCH' || importType === 'STOCK_ITEM') {
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

  /**
   * Checks if an existing Stock Item has batch inventory or transaction history.
   * Used to safely prevent disabling maintain_batches.
   */
  static async checkItemHasBatchHistory(uniqueItemId: string): Promise<boolean> {
    try {
      const stockCheck = await pool.query(
        `SELECT 
           COALESCE(SUM(os.physical_stock), 0) as total_physical,
           COALESCE(SUM(os.reserved_stock), 0) as total_reserved
         FROM optical_stocks os
         JOIN optical_batches ob ON os.batch_id = ob.id
         WHERE ob.unique_item_id = $1`,
        [uniqueItemId]
      );
      const totalPhysical = Number(stockCheck.rows[0]?.total_physical || 0);
      const totalReserved = Number(stockCheck.rows[0]?.total_reserved || 0);
      if (totalPhysical > 0 || totalReserved > 0) return true;

      const historyCheck = await pool.query(
        `SELECT 
           (SELECT COUNT(*)::int FROM stock_ledger sl JOIN optical_batches ob ON sl.batch_id = ob.id WHERE ob.unique_item_id = $1) as ledger_count,
           (SELECT COUNT(*)::int FROM sales_invoice_lines sil WHERE sil.unique_item_id = $1) as sales_lines_count,
           (SELECT COUNT(*)::int FROM purchase_invoice_lines pil WHERE pil.unique_item_id = $1) as purchase_lines_count,
           (SELECT COUNT(*)::int FROM sales_invoice_line_batches silb JOIN optical_batches ob ON silb.batch_id = ob.id WHERE ob.unique_item_id = $1) as sales_count,
           (SELECT COUNT(*)::int FROM purchase_invoice_line_batches pilb JOIN optical_batches ob ON pilb.batch_id = ob.id WHERE ob.unique_item_id = $1) as purchase_count,
           (SELECT COUNT(*)::int FROM purchase_lots pl WHERE pl.unique_item_id = $1 OR pl.batch_id IN (SELECT id FROM optical_batches WHERE unique_item_id = $1)) as lot_count
        `,
        [uniqueItemId]
      );
      const h = historyCheck.rows[0];
      const totalHistory = (h?.ledger_count || 0) + (h?.sales_lines_count || 0) + (h?.purchase_lines_count || 0) + (h?.sales_count || 0) + (h?.purchase_count || 0) + (h?.lot_count || 0);
      return totalHistory > 0;
    } catch {
      return false;
    }
  }

  /**
   * Validates a single Stock Item import row.
   */
  private static async validateStockItemRow(
    businessId: string,
    rowNumber: number,
    mapped: Record<string, any>,
    stockItemByCode: Map<string, any>,
    primaryItemByName: Map<string, any>,
    primaryItemByCode: Map<string, any>,
    batchCountMap: Map<string, number>,
    importMode: 'CREATE_ONLY' | 'UPSERT',
    errors: ImportError[]
  ): Promise<Record<string, any>> {
    const rawCode = mapped.stock_item_code ?? mapped.code ?? mapped.stockItemCode ?? mapped.sku;
    const rawName = mapped.stock_item_name ?? mapped.name ?? mapped.stockItemName ?? mapped.item_name;
    const rawCategory = mapped.category ?? mapped.optical_category ?? mapped.opticalCategory ?? mapped.type;
    const rawMaintainBatches = mapped.maintain_batches ?? mapped.maintainBatches ?? mapped.batch;
    const rawUnit = mapped.unit ?? mapped.uom;
    const rawStatus = mapped.status ?? mapped.isActive ?? mapped.active;
    const rawPurchaseRate = mapped.purchase_rate ?? mapped.purchaseRate ?? mapped.cost;
    const rawMrp = mapped.mrp ?? mapped.selling_price ?? mapped.sellingPrice ?? mapped.price;
    const rawGstRate = mapped.gst_rate ?? mapped.gstRate ?? mapped.gst;
    const rawDescription = mapped.description ?? mapped.desc ?? mapped.remarks ?? mapped.notes;
    const rawPrimaryItem = mapped.parent_primary_item ?? mapped.primary_item ?? mapped.primaryItem;
    const rawLpp = mapped.last_purchase_price ?? mapped.lastPurchasePrice;

    // 1. Code validation
    if (!rawCode || String(rawCode).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'stock_item_code',
        value: rawCode,
        severity: 'ERROR',
        message: 'Stock Item Code is required.',
      });
    }
    const cleanCode = String(rawCode || '').trim().toUpperCase();
    if (cleanCode.length > 100) {
      errors.push({
        row: rowNumber,
        field: 'stock_item_code',
        value: cleanCode,
        severity: 'ERROR',
        message: 'Stock Item Code must not exceed 100 characters.',
      });
    }

    // 2. Name validation
    if (!rawName || String(rawName).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'stock_item_name',
        value: rawName,
        severity: 'ERROR',
        message: 'Stock Item Name is required.',
      });
    }
    const cleanName = String(rawName || '').trim();
    if (cleanName.length > 255) {
      errors.push({
        row: rowNumber,
        field: 'stock_item_name',
        value: cleanName,
        severity: 'ERROR',
        message: 'Stock Item Name must not exceed 255 characters.',
      });
    }

    // 3. Category validation (SV, KT, PROG, OTHER)
    let normCategory: 'SV' | 'KT' | 'PROG' | 'OTHER' = 'SV';
    if (!rawCategory || String(rawCategory).trim() === '') {
      errors.push({
        row: rowNumber,
        field: 'category',
        value: rawCategory,
        severity: 'ERROR',
        message: 'Category is required (Allowed: SV, KT, PROG, OTHER).',
      });
    } else {
      const c = String(rawCategory).trim().toUpperCase();
      if (c === 'SV' || c.includes('SINGLE')) normCategory = 'SV';
      else if (c === 'KT' || c.includes('KRYPTOK') || c.includes('BIFOCAL')) normCategory = 'KT';
      else if (c === 'PROG' || c.includes('PROGRESSIVE') || c === 'PAL') normCategory = 'PROG';
      else if (c === 'OTHER' || c.includes('MISC') || c.includes('ACCESSOR')) normCategory = 'OTHER';
      else {
        errors.push({
          row: rowNumber,
          field: 'category',
          value: rawCategory,
          severity: 'ERROR',
          message: `Unsupported category "${rawCategory}". Must be SV, KT, PROG, or OTHER.`,
        });
      }
    }

    // 4. Maintain Batches (default: false)
    let maintainBatches = false;
    if (rawMaintainBatches !== undefined && rawMaintainBatches !== null && String(rawMaintainBatches).trim() !== '') {
      if (typeof rawMaintainBatches === 'boolean') {
        maintainBatches = rawMaintainBatches;
      } else {
        const mbStr = String(rawMaintainBatches).trim().toUpperCase();
        if (['YES', 'Y', 'TRUE', '1'].includes(mbStr)) {
          maintainBatches = true;
        } else if (['NO', 'N', 'FALSE', '0'].includes(mbStr)) {
          maintainBatches = false;
        } else {
          errors.push({
            row: rowNumber,
            field: 'maintain_batches',
            value: rawMaintainBatches,
            severity: 'ERROR',
            message: `Maintain Batches must be YES or NO (received "${rawMaintainBatches}").`,
          });
        }
      }
    }

    // 5. Unit (default: PRS, allowed: PRS, PCS)
    let unit: 'PRS' | 'PCS' = 'PRS';
    if (rawUnit !== undefined && rawUnit !== null && String(rawUnit).trim() !== '') {
      const u = String(rawUnit).trim().toUpperCase();
      if (['PRS', 'PAIRS', 'PAIR'].includes(u)) {
        unit = 'PRS';
      } else if (['PCS', 'PIECES', 'PIECE'].includes(u)) {
        unit = 'PCS';
      } else {
        errors.push({
          row: rowNumber,
          field: 'unit',
          value: rawUnit,
          severity: 'ERROR',
          message: 'Invalid unit. Allowed values are PRS or PCS.',
        });
      }
    } else {
      unit = 'PRS';
    }

    // 6. Status (default: ACTIVE)
    let status = 'ACTIVE';
    if (rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== '') {
      const s = String(rawStatus).trim().toUpperCase();
      if (['ACTIVE', 'ENABLE', 'ENABLED', 'TRUE', '1', 'YES'].includes(s)) {
        status = 'ACTIVE';
      } else if (['INACTIVE', 'DISABLE', 'DISABLED', 'FALSE', '0', 'NO'].includes(s)) {
        status = 'INACTIVE';
      } else {
        errors.push({
          row: rowNumber,
          field: 'status',
          value: rawStatus,
          severity: 'ERROR',
          message: `Status must be ACTIVE or INACTIVE (received "${rawStatus}").`,
        });
      }
    }

    // 6. Purchase Rate (default: 0.00)
    let purchaseRate = '0.00';
    if (rawPurchaseRate !== undefined && rawPurchaseRate !== null && String(rawPurchaseRate).trim() !== '') {
      const pr = Number(rawPurchaseRate);
      if (isNaN(pr) || pr < 0) {
        errors.push({
          row: rowNumber,
          field: 'purchase_rate',
          value: rawPurchaseRate,
          severity: 'ERROR',
          message: 'Purchase Rate must be a non-negative number.',
        });
      } else {
        purchaseRate = pr.toFixed(2);
      }
    }

    // 7. MRP (default: 0.00)
    let mrp = '0.00';
    if (rawMrp !== undefined && rawMrp !== null && String(rawMrp).trim() !== '') {
      const m = Number(rawMrp);
      if (isNaN(m) || m < 0) {
        errors.push({
          row: rowNumber,
          field: 'mrp',
          value: rawMrp,
          severity: 'ERROR',
          message: 'MRP must be a non-negative number.',
        });
      } else {
        mrp = m.toFixed(2);
      }
    }

    // 8. GST Rate (default: 5.00)
    let gstRate = '5.00';
    if (rawGstRate !== undefined && rawGstRate !== null && String(rawGstRate).trim() !== '') {
      const gst = Number(rawGstRate);
      if (isNaN(gst) || gst < 0 || gst > 100) {
        errors.push({
          row: rowNumber,
          field: 'gst_rate',
          value: rawGstRate,
          severity: 'ERROR',
          message: 'GST Rate must be a valid percentage between 0 and 100.',
        });
      } else {
        gstRate = gst.toFixed(2);
      }
    }

    // 9. Description (optional)
    const description = rawDescription !== undefined && rawDescription !== null && String(rawDescription).trim() !== ''
      ? String(rawDescription).trim()
      : null;

    // 10. Parent Primary Item (optional)
    let primaryItemId: string | null = null;
    let resolvedPrimaryItem: any = null;
    if (rawPrimaryItem !== undefined && rawPrimaryItem !== null && String(rawPrimaryItem).trim() !== '') {
      const pKey = String(rawPrimaryItem).trim().toLowerCase();
      const match = primaryItemByCode.get(pKey) || primaryItemByName.get(pKey);
      if (match) {
        primaryItemId = match.id;
        resolvedPrimaryItem = { id: match.id, name: match.name, code: match.code };
      } else {
        errors.push({
          row: rowNumber,
          field: 'parent_primary_item',
          value: rawPrimaryItem,
          severity: 'ERROR',
          message: `Parent Primary Item "${rawPrimaryItem}" was not found in the database.`,
        });
      }
    }

    // 11. Last Purchase Price (READ ONLY notice)
    if (rawLpp !== undefined && rawLpp !== null && String(rawLpp).trim() !== '' && !String(rawLpp).trim().toUpperCase().includes('READ ONLY')) {
      errors.push({
        row: rowNumber,
        field: 'last_purchase_price',
        value: rawLpp,
        severity: 'WARNING',
        message: 'Last Purchase Price is transaction-derived from purchase vouchers and will not be overwritten by bulk import.',
      });
    }

    // 12. Mode & Safety Checks against existing database Stock Items
    let isUpdate = false;
    let existingId: string | null = null;
    const existingItem = stockItemByCode.get(cleanCode);

    if (existingItem) {
      existingId = existingItem.id;
      if (importMode === 'CREATE_ONLY') {
        errors.push({
          row: rowNumber,
          field: 'stock_item_code',
          value: cleanCode,
          severity: 'ERROR',
          message: `Stock Item code "${cleanCode}" already exists. Switch to "Create or Update" mode to update existing stock items.`,
        });
      } else {
        // Mode is UPSERT -> Enforce safety rules
        isUpdate = true;

        // Safety 1: Maintain Batches YES -> NO
        if (existingItem.maintainBatches === true && maintainBatches === false) {
          const batchCount = batchCountMap.get(existingItem.id) || 0;
          if (batchCount > 0) {
            const hasHistory = await this.checkItemHasBatchHistory(existingItem.id);
            if (hasHistory) {
              errors.push({
                row: rowNumber,
                field: 'maintain_batches',
                value: 'NO',
                severity: 'ERROR',
                message: `Maintain Batches cannot be disabled for "${cleanCode}" because this Stock Item has batch-wise inventory or transaction history.`,
              });
            }
          }
        }

        // Safety 2: Optical Category change when batches exist
        if (existingItem.opticalCategory !== normCategory) {
          const batchCount = batchCountMap.get(existingItem.id) || 0;
          if (batchCount > 0) {
            errors.push({
              row: rowNumber,
              field: 'category',
              value: normCategory,
              severity: 'ERROR',
              message: `Optical Category cannot be changed from "${existingItem.opticalCategory}" to "${normCategory}" because Stock Item "${cleanCode}" already contains ${batchCount} optical batches.`,
            });
          }
        }

        // Safety 3: Unit change when stock or transactions exist
        const currentItemUnit = existingItem.unit || 'PRS';
        if (currentItemUnit !== unit) {
          const hasHistory = await this.checkItemHasBatchHistory(existingItem.id);
          if (hasHistory) {
            errors.push({
              row: rowNumber,
              field: 'unit',
              value: unit,
              severity: 'ERROR',
              message: `Unit cannot be changed from "${currentItemUnit}" to "${unit}" because Stock Item "${cleanCode}" already has stock or transaction history.`,
            });
          }
        }
      }
    } else {
      isUpdate = false;
    }

    return {
      code: cleanCode,
      name: cleanName,
      category: normCategory,
      opticalCategory: normCategory,
      maintainBatches,
      unit,
      status,
      purchaseRate,
      mrp,
      gstRate,
      description,
      primaryItemId,
      primaryItem: resolvedPrimaryItem,
      isUpdate,
      existingId,
    };
  }
}
