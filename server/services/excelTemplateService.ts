import * as XLSX from 'xlsx';

export type ImportType = 'PARTY' | 'PURCHASE' | 'SALES_ORDER' | 'SALES_INVOICE' | 'OPENING_STOCK' | 'OPTICAL_BATCH' | 'STOCK_ITEM';

export interface TemplateDefinition {
  type: ImportType;
  title: string;
  fileName: string;
  columns: string[];
  sampleRow?: Record<string, any>;
  sampleRows?: Record<string, any>[];
  instructions: { field: string; requirement: string; description: string; allowedValues?: string }[];
}

export const TEMPLATE_DEFINITIONS: Record<ImportType, TemplateDefinition> = {
  OPTICAL_BATCH: {
    type: 'OPTICAL_BATCH',
    title: 'Optical Batches & Powers Import Template',
    fileName: 'Optical_Batches_Import_Template.xlsx',
    columns: [
      'unique_item',
      'batch_name',
      'sku',
      'opening_stock_quantity',
      'purchase_cost',
      'selling_price',
      'unit',
      'barcode',
      'supplier',
      'purchase_date',
      'batch_reference',
      'expiry_date',
      'location',
      'reorder_level',
      'remarks',
    ],
    sampleRows: [
      {
        'unique_item': 'HC_SV_-6/-2',
        'batch_name': '-6.00/-2.00',
        'sku': 'SKU-SV-M600-M200',
        'opening_stock_quantity': 10,
        'purchase_cost': 150.00,
        'selling_price': 250.00,
        'unit': 'prs',
        'barcode': 'OPT-SV-000101',
        'supplier': 'Vision Tech Distributors',
        'purchase_date': '2026-04-01',
        'batch_reference': 'LOT-2026-A1',
        'expiry_date': '2029-12-31',
        'location': 'Rack A-1',
        'reorder_level': 5,
        'remarks': 'Opening inventory batch for single vision lens',
      },
      {
        'unique_item': 'HC_KT_+1.75/-2.00',
        'batch_name': '+1.75/-2.00/90/+2.00',
        'sku': 'SKU-KT-P175-M200-90-P200',
        'opening_stock_quantity': 5,
        'purchase_cost': 280.00,
        'selling_price': 450.00,
        'unit': 'pairs',
        'barcode': '',
        'supplier': 'Essilor India Pvt Ltd',
        'purchase_date': '2026-04-01',
        'batch_reference': 'LOT-KT-09',
        'expiry_date': '2029-12-31',
        'location': 'Rack B-2',
        'reorder_level': 2,
        'remarks': 'Bifocal Kryptok batch with axis and add power',
      },
      {
        'unique_item': 'HC_PROG_+1.00/-0.50',
        'batch_name': '+1.00/-0.50/180/+1.50/R',
        'sku': 'SKU-PROG-P100-M050-180-P150-R',
        'opening_stock_quantity': 2,
        'purchase_cost': 650.00,
        'selling_price': 1100.00,
        'unit': 'prs',
        'barcode': '',
        'supplier': 'Hoya Lens India',
        'purchase_date': '2026-04-01',
        'batch_reference': 'LOT-PROG-01',
        'expiry_date': '2029-12-31',
        'location': 'Rack C-1',
        'reorder_level': 1,
        'remarks': 'Right eye progressive optical batch',
      },
    ],
    instructions: [
      { field: 'unique_item', requirement: 'Required', description: 'Unique Item code or commercial name. MUST already exist in the software (e.g. HC_SV_-6/-2). New items are NEVER auto-created.' },
      { field: 'batch_name', requirement: 'Required', description: 'Optical power representation. Formats: SPH/CYL (e.g. -6.00/-2.00), SPH/CYL/AXIS/ADD (e.g. +1.75/-2.00/90/+2.00), or SPH/CYL/AXIS/ADD/SIDE (e.g. +1.00/-0.50/180/+1.50/R).' },
      { field: 'sku', requirement: 'Required', description: 'Unique SKU identifier for the batch. Must be unique within the business and file.' },
      { field: 'opening_stock_quantity', requirement: 'Required', description: 'Initial stock quantity in pairs (positive numeric in steps of 0.5, e.g. 10, 0.5, 1.5).' },
      { field: 'purchase_cost', requirement: 'Required', description: 'Procurement / purchase rate per pair (positive numeric).' },
      { field: 'selling_price', requirement: 'Required', description: 'Selling price / MRP per pair. Uses existing Unique Item price architecture.' },
      { field: 'unit', requirement: 'Required', description: 'Unit of measurement (prs, pairs, pcs, pieces).' },
      { field: 'barcode', requirement: 'Optional', description: 'Code 128 permanent barcode. If left blank, the system automatically generates an authoritative barcode (e.g. OPT-SV-XXXXXX).' },
      { field: 'supplier', requirement: 'Optional', description: 'Supplier name or party code if associating with an opening procurement source.' },
      { field: 'purchase_date', requirement: 'Optional', description: 'Acquisition / inward date in YYYY-MM-DD format. Defaults to current date.' },
      { field: 'batch_reference', requirement: 'Optional', description: 'Manufacturer lot number or factory batch reference.' },
      { field: 'expiry_date', requirement: 'Optional', description: 'Product expiry or warranty date in YYYY-MM-DD format.' },
      { field: 'location', requirement: 'Optional', description: 'Warehouse bin, rack, or shelf storage location.' },
      { field: 'reorder_level', requirement: 'Optional', description: 'Minimum stock alert threshold (numeric).' },
      { field: 'remarks', requirement: 'Optional', description: 'Internal batch notes or comments.' },
    ],
  },
  PARTY: {
    type: 'PARTY',
    title: 'Parties / Customers & Suppliers Import Template',
    fileName: 'Party_Import_Template.xlsx',
    columns: [
      'Party Code',
      'Name',
      'Display Name',
      'Party Type',
      'Mobile',
      'Alternate Mobile',
      'Email',
      'Address Line 1',
      'Address Line 2',
      'City',
      'State',
      'Pincode',
      'GSTIN',
      'PAN',
      'Credit Limit',
      'Credit Days',
      'Status',
      'Notes',
    ],
    sampleRow: {
      'Party Code': 'CUST-00101',
      'Name': 'Shree Vision Opticals',
      'Display Name': 'Shree Vision Store',
      'Party Type': 'CUSTOMER',
      'Mobile': '9876543210',
      'Alternate Mobile': '9876543211',
      'Email': 'contact@shreevision.com',
      'Address Line 1': 'Shop 14, Optical Complex',
      'Address Line 2': 'Station Road',
      'City': 'Mumbai',
      'State': 'Maharashtra',
      'Pincode': '400001',
      'GSTIN': '27ABCDE1234F1Z5',
      'PAN': 'ABCDE1234F',
      'Credit Limit': '50000',
      'Credit Days': '30',
      'Status': 'ACTIVE',
      'Notes': 'Premier retail customer account',
    },
    instructions: [
      { field: 'Name', requirement: 'Required', description: 'Legal business name or customer name' },
      { field: 'Party Type', requirement: 'Required', description: 'Classification of party', allowedValues: 'CUSTOMER, SUPPLIER, BOTH' },
      { field: 'Party Code', requirement: 'Optional', description: 'Unique party identifier. If left blank, ERP auto-generates sequential code.' },
      { field: 'Mobile', requirement: 'Optional', description: '10-digit mobile number' },
      { field: 'GSTIN', requirement: 'Optional', description: '15-character Indian GST Identification Number' },
      { field: 'PAN', requirement: 'Optional', description: '10-character Permanent Account Number' },
      { field: 'Credit Limit', requirement: 'Optional', description: 'Credit limit amount in currency (numeric)' },
      { field: 'Credit Days', requirement: 'Optional', description: 'Payment credit period in days (integer)' },
      { field: 'Status', requirement: 'Optional', description: 'Account status (default: ACTIVE)', allowedValues: 'ACTIVE, INACTIVE' },
    ],
  },
  PURCHASE: {
    type: 'PURCHASE',
    title: 'Supplier Purchase Invoices Import Template',
    fileName: 'Purchase_Invoice_Import_Template.xlsx',
    columns: [
      'Supplier',
      'Supplier Invoice Number',
      'Supplier Invoice Date',
      'Invoice Date',
      'Unique Item',
      'SPH',
      'CYL',
      'AXIS',
      'ADD',
      'SIDE',
      'Quantity',
      'Rate',
      'Discount Type',
      'Discount Value',
      'GST Mode',
    ],
    sampleRow: {
      'Supplier': 'Essilor India Pvt Ltd',
      'Supplier Invoice Number': 'INV-ESS-2026-908',
      'Supplier Invoice Date': '2026-08-15',
      'Invoice Date': '2026-08-16',
      'Unique Item': 'Crizal Alize 1.56 SV HMC',
      'SPH': '-2.00',
      'CYL': '-0.50',
      'AXIS': '',
      'ADD': '',
      'SIDE': '',
      'Quantity': '10',
      'Rate': '450.00',
      'Discount Type': 'PERCENTAGE',
      'Discount Value': '5',
      'GST Mode': 'INTRA_STATE',
    },
    instructions: [
      { field: 'Supplier', requirement: 'Required', description: 'Supplier name or Party Code. Must exist in ERP and have partyType SUPPLIER or BOTH.' },
      { field: 'Supplier Invoice Number', requirement: 'Required', description: 'Vendor invoice/bill number. Used to group multiple line items into a single purchase bill.' },
      { field: 'Unique Item', requirement: 'Required', description: 'Exact Unique Item code or commercial item name.' },
      { field: 'SPH', requirement: 'Required', description: 'Spherical power in diopters (-2.00, +1.50, 0.00).' },
      { field: 'CYL', requirement: 'Required', description: 'Cylindrical power in diopters (0.00 if no cylinder).' },
      { field: 'AXIS', requirement: 'Category-specific', description: 'Required for KT & PROG when CYL is non-zero (0 to 180 degrees). FORBIDDEN for Single Vision (SV).' },
      { field: 'ADD', requirement: 'Category-specific', description: 'Required for KT & PROG lenses (+0.75 to +4.00). FORBIDDEN for Single Vision (SV).' },
      { field: 'SIDE', requirement: 'Category-specific', description: 'Required for Progressive (PROG) lenses: "R" (Right), "L" (Left), or "BE" (Both Eyes). FORBIDDEN for SV and KT.' },
      { field: 'Quantity', requirement: 'Required', description: 'Quantity in PAIRS (positive numeric, e.g. 1.0, 5.0).' },
      { field: 'Rate', requirement: 'Required', description: 'Purchase rate per pair in currency.' },
      { field: 'GST Mode', requirement: 'Optional', description: 'Tax computation mode (default: INTRA_STATE)', allowedValues: 'INTRA_STATE (CGST+SGST), INTER_STATE (IGST)' },
      { field: 'Discount Type', requirement: 'Optional', description: 'Line discount type', allowedValues: 'NONE, PERCENTAGE, FIXED' },
    ],
  },
  SALES_ORDER: {
    type: 'SALES_ORDER',
    title: 'Customer Sales Orders Import Template',
    fileName: 'Sales_Order_Import_Template.xlsx',
    columns: [
      'Customer',
      'Order Date',
      'Unique Item',
      'SPH',
      'CYL',
      'AXIS',
      'ADD',
      'SIDE',
      'Quantity',
      'Rate',
      'Discount Type',
      'Discount Value',
      'GST Mode',
    ],
    sampleRow: {
      'Customer': 'Shree Vision Opticals',
      'Order Date': '2026-08-18',
      'Unique Item': 'Crizal Alize 1.56 SV HMC',
      'SPH': '-2.00',
      'CYL': '-0.50',
      'AXIS': '',
      'ADD': '',
      'SIDE': '',
      'Quantity': '2',
      'Rate': '850.00',
      'Discount Type': 'NONE',
      'Discount Value': '0',
      'GST Mode': 'INTRA_STATE',
    },
    instructions: [
      { field: 'Customer', requirement: 'Required', description: 'Customer name or Party Code. Must exist in ERP and have partyType CUSTOMER or BOTH.' },
      { field: 'Order Date', requirement: 'Optional', description: 'Date of sales order (YYYY-MM-DD). Defaults to current date.' },
      { field: 'Unique Item', requirement: 'Required', description: 'Exact Unique Item code or commercial item name.' },
      { field: 'SPH', requirement: 'Required', description: 'Spherical power in diopters.' },
      { field: 'CYL', requirement: 'Required', description: 'Cylindrical power in diopters.' },
      { field: 'AXIS / ADD / SIDE', requirement: 'Category-specific', description: 'SV: no axis/add/side; KT: AXIS (if cyl!=0), ADD; PROG: AXIS, ADD, SIDE (R, L, BE).' },
      { field: 'Quantity', requirement: 'Required', description: 'Quantity in PAIRS (positive numeric).' },
      { field: 'Rate', requirement: 'Required', description: 'Selling rate per pair.' },
    ],
  },
  SALES_INVOICE: {
    type: 'SALES_INVOICE',
    title: 'Direct Sales Invoices Import Template',
    fileName: 'Sales_Invoice_Import_Template.xlsx',
    columns: [
      'Customer',
      'Invoice Date',
      'Unique Item',
      'SPH',
      'CYL',
      'AXIS',
      'ADD',
      'SIDE',
      'Quantity',
      'Rate',
      'Discount Type',
      'Discount Value',
      'GST Mode',
    ],
    sampleRow: {
      'Customer': 'Shree Vision Opticals',
      'Invoice Date': '2026-08-19',
      'Unique Item': 'Crizal Alize 1.56 SV HMC',
      'SPH': '-2.00',
      'CYL': '-0.50',
      'AXIS': '',
      'ADD': '',
      'SIDE': '',
      'Quantity': '1',
      'Rate': '850.00',
      'Discount Type': 'PERCENTAGE',
      'Discount Value': '10',
      'GST Mode': 'INTRA_STATE',
    },
    instructions: [
      { field: 'Customer', requirement: 'Required', description: 'Customer name or Party Code. Must exist in ERP and have partyType CUSTOMER or BOTH.' },
      { field: 'Invoice Date', requirement: 'Optional', description: 'Invoice date (YYYY-MM-DD). Defaults to current date.' },
      { field: 'Unique Item', requirement: 'Required', description: 'Unique Item name or code.' },
      { field: 'SPH & CYL', requirement: 'Required', description: 'Optical spherical and cylinder power.' },
      { field: 'AXIS / ADD / SIDE', requirement: 'Category-specific', description: 'Validated according to category (SV, KT, PROG).' },
      { field: 'Quantity', requirement: 'Required', description: 'Quantity in PAIRS. MUST have sufficient AVAILABLE stock in inventory.' },
      { field: 'Rate', requirement: 'Required', description: 'Selling price per pair.' },
    ],
  },
  OPENING_STOCK: {
    type: 'OPENING_STOCK',
    title: 'Opening Stock Initialization Import Template',
    fileName: 'Opening_Stock_Import_Template.xlsx',
    columns: [
      'Unique Item',
      'SPH',
      'CYL',
      'AXIS',
      'ADD',
      'SIDE',
      'Quantity',
      'Date',
      'Reason',
      'Remarks',
    ],
    sampleRow: {
      'Unique Item': 'Crizal Alize 1.56 SV HMC',
      'SPH': '-2.00',
      'CYL': '-0.50',
      'AXIS': '',
      'ADD': '',
      'SIDE': '',
      'Quantity': '25',
      'Date': '2026-04-01',
      'Reason': 'Opening Stock Initial Audit',
      'Remarks': 'Warehouse Section A Shelf 2',
    },
    instructions: [
      { field: 'Unique Item', requirement: 'Required', description: 'Exact Unique Item code or commercial item name.' },
      { field: 'SPH', requirement: 'Required', description: 'Spherical power of the existing batch.' },
      { field: 'CYL', requirement: 'Required', description: 'Cylindrical power of the existing batch.' },
      { field: 'AXIS / ADD / SIDE', requirement: 'Category-specific', description: 'Category-specific optical power matching.' },
      { field: 'CRITICAL RULE', requirement: 'STRICT', description: 'Opening Stock import can ONLY reference existing Optical Batches. It will REJECT rows where batch does not exist.' },
      { field: 'Quantity', requirement: 'Required', description: 'Initial stock quantity in PAIRS (positive numeric).' },
      { field: 'Date', requirement: 'Optional', description: 'Effective date (YYYY-MM-DD). Defaults to financial year start / current date.' },
    ],
  },
  STOCK_ITEM: {
    type: 'STOCK_ITEM',
    title: 'Stock Items Master Bulk Import Template',
    fileName: 'Stock_Items_Import_Template.xlsx',
    columns: [
      'stock_item_code',
      'stock_item_name',
      'category',
      'maintain_batches',
      'status',
      'purchase_rate',
      'mrp',
      'gst_rate',
      'description',
      'parent_primary_item',
      'last_purchase_price',
    ],
    sampleRows: [
      {
        'stock_item_code': 'SV-156-HMC',
        'stock_item_name': 'Single Vision 1.56 HMC Hard Coated',
        'category': 'SV',
        'maintain_batches': 'YES',
        'status': 'ACTIVE',
        'purchase_rate': 180.00,
        'mrp': 350.00,
        'gst_rate': 5,
        'description': 'Premium anti-reflective coated single vision finished lenses',
        'parent_primary_item': '',
        'last_purchase_price': 'READ ONLY (Derived from Purchases)',
      },
      {
        'stock_item_code': 'KT-156-WHITE',
        'stock_item_name': 'Kryptok Bifocal 1.56 White Finished',
        'category': 'KT',
        'maintain_batches': 'YES',
        'status': 'ACTIVE',
        'purchase_rate': 250.00,
        'mrp': 480.00,
        'gst_rate': 5,
        'description': 'Standard 28mm round segment bifocal lens',
        'parent_primary_item': '',
        'last_purchase_price': 'READ ONLY (Derived from Purchases)',
      },
      {
        'stock_item_code': 'PROG-EASY-156',
        'stock_item_name': 'EasyView Progressive 1.56 UC',
        'category': 'PROG',
        'maintain_batches': 'YES',
        'status': 'ACTIVE',
        'purchase_rate': 650.00,
        'mrp': 1200.00,
        'gst_rate': 5,
        'description': 'Wide corridor digital progressive lens',
        'parent_primary_item': '',
        'last_purchase_price': 'READ ONLY (Derived from Purchases)',
      },
      {
        'stock_item_code': 'ACC-CLEAN-SPRAY',
        'stock_item_name': 'Optical Lens Cleaner Spray Kit 50ml',
        'category': 'OTHER',
        'maintain_batches': 'NO',
        'status': 'ACTIVE',
        'purchase_rate': 45.00,
        'mrp': 120.00,
        'gst_rate': 18,
        'description': 'Antistatic lens cleaner with microfiber cloth',
        'parent_primary_item': '',
        'last_purchase_price': 'READ ONLY (Derived from Purchases)',
      },
    ],
    instructions: [
      { field: 'stock_item_code', requirement: 'Required', description: 'Unique Stock Item SKU / Code (e.g. SV-156-HMC). Must be unique across items in the business.' },
      { field: 'stock_item_name', requirement: 'Required', description: 'Commercial Stock Item Name (e.g. Single Vision 1.56 HMC).' },
      { field: 'category', requirement: 'Required', description: 'Optical Category. Allowed values: SV (Single Vision), KT (Kryptok Bifocal), PROG (Progressive), OTHER.', allowedValues: 'SV, KT, PROG, OTHER' },
      { field: 'maintain_batches', requirement: 'Optional', description: 'Whether to maintain batch powers for this item. Default: NO. Allowed: YES/NO, TRUE/FALSE, 1/0.', allowedValues: 'YES, NO' },
      { field: 'status', requirement: 'Optional', description: 'Lifecycle status. Default: ACTIVE. Allowed: ACTIVE, INACTIVE.', allowedValues: 'ACTIVE, INACTIVE' },
      { field: 'purchase_rate', requirement: 'Optional', description: 'Default procurement / purchase rate in INR (non-negative numeric). Default: 0.00.' },
      { field: 'mrp', requirement: 'Optional', description: 'Maximum Retail Price / selling price in INR (non-negative numeric). Default: 0.00.' },
      { field: 'gst_rate', requirement: 'Optional', description: 'GST rate percentage. Default: 5 (5%). Allowed: 0, 5, 12, 18, 28.', allowedValues: '0, 5, 12, 18, 28' },
      { field: 'description', requirement: 'Optional', description: 'Optional commercial notes or specification details.' },
      { field: 'parent_primary_item', requirement: 'Optional', description: 'Parent primary item name or code if grouping under a legacy primary master.' },
      { field: 'last_purchase_price', requirement: 'Read-Only / System', description: 'System-generated from actual Purchase Vouchers. Ignored on bulk import to prevent faking transaction history.' },
    ],
  },
};

export class ExcelTemplateService {
  /**
   * Generates a complete XLSX workbook buffer for a given import type template.
   */
  static generateTemplateWorkbook(importType: ImportType): Buffer {
    const def = TEMPLATE_DEFINITIONS[importType];
    if (!def) {
      throw new Error(`Unsupported import template type: ${importType}`);
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Data Entry / Template Sheet
    const dataRows = def.sampleRows && def.sampleRows.length > 0
      ? def.sampleRows
      : def.sampleRow ? [def.sampleRow] : [];
    const wsData = XLSX.utils.json_to_sheet(dataRows, { header: def.columns });

    // Set column widths
    wsData['!cols'] = def.columns.map(col => ({ wch: Math.max(col.length + 4, 16) }));

    XLSX.utils.book_append_sheet(wb, wsData, 'Import Data');

    // Sheet 2: Guidelines & Field Instructions
    const instructionsData = def.instructions.map(inst => ({
      'ERP Field': inst.field,
      'Requirement': inst.requirement,
      'Description & Rules': inst.description,
      'Allowed Values / Format': inst.allowedValues || 'Standard',
    }));

    const wsInstructions = XLSX.utils.json_to_sheet(instructionsData);
    wsInstructions['!cols'] = [
      { wch: 20 },
      { wch: 18 },
      { wch: 60 },
      { wch: 35 },
    ];

    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions & Rules');

    // Write workbook buffer
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Generates an Error Report Excel workbook from an import session's error summary.
   */
  static generateErrorReportWorkbook(
    fileName: string,
    importType: string,
    errorSummary: Array<{ row: number; field: string; value: any; severity: string; message: string }>
  ): Buffer {
    const wb = XLSX.utils.book_new();

    const formattedErrors = errorSummary.map(err => ({
      'Row Number': err.row,
      'Field Name': err.field || 'General',
      'Provided Value': err.value !== undefined && err.value !== null ? String(err.value) : '<empty>',
      'Severity': err.severity || 'ERROR',
      'Error Description': err.message,
    }));

    const wsErrors = XLSX.utils.json_to_sheet(formattedErrors);
    wsErrors['!cols'] = [
      { wch: 14 },
      { wch: 22 },
      { wch: 25 },
      { wch: 14 },
      { wch: 60 },
    ];

    XLSX.utils.book_append_sheet(wb, wsErrors, 'Validation Errors');

    // Metadata sheet
    const metaData = [
      { Property: 'Import File', Details: fileName },
      { Property: 'Import Type', Details: importType },
      { Property: 'Total Issue Count', Details: errorSummary.length },
      { Property: 'Generated At', Details: new Date().toISOString() },
    ];
    const wsMeta = XLSX.utils.json_to_sheet(metaData);
    wsMeta['!cols'] = [{ wch: 20 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Session Metadata');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}
