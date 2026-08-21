import * as XLSX from 'xlsx';

export type ImportType = 'PARTY' | 'PURCHASE' | 'SALES_ORDER' | 'SALES_INVOICE' | 'OPENING_STOCK';

export interface TemplateDefinition {
  type: ImportType;
  title: string;
  fileName: string;
  columns: string[];
  sampleRow: Record<string, any>;
  instructions: { field: string; requirement: string; description: string; allowedValues?: string }[];
}

export const TEMPLATE_DEFINITIONS: Record<ImportType, TemplateDefinition> = {
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
    const dataRows = [
      def.sampleRow,
    ];
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
