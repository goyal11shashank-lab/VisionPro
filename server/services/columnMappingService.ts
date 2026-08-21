import { ImportType } from './excelTemplateService';

export interface ColumnDefinition {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const FIELD_DEFINITIONS: Record<ImportType, ColumnDefinition[]> = {
  PARTY: [
    { key: 'name', label: 'Name', required: true, aliases: ['name', 'party name', 'customer name', 'supplier name', 'business name', 'company', 'party_name'] },
    { key: 'partyType', label: 'Party Type', required: true, aliases: ['party type', 'type', 'party_type', 'role', 'customer/supplier', 'category'] },
    { key: 'partyCode', label: 'Party Code', required: false, aliases: ['party code', 'code', 'party_code', 'customer code', 'supplier code', 'account code', 'id'] },
    { key: 'displayName', label: 'Display Name', required: false, aliases: ['display name', 'display_name', 'trade name', 'alias'] },
    { key: 'mobile', label: 'Mobile', required: false, aliases: ['mobile', 'phone', 'contact number', 'mobile number', 'cell', 'mobile_no'] },
    { key: 'alternateMobile', label: 'Alternate Mobile', required: false, aliases: ['alt mobile', 'alternate mobile', 'secondary phone', 'alt_phone', 'alternate_mobile'] },
    { key: 'email', label: 'Email', required: false, aliases: ['email', 'e-mail', 'email address', 'email_id'] },
    { key: 'addressLine1', label: 'Address Line 1', required: false, aliases: ['address line 1', 'address', 'address 1', 'street', 'address_line1', 'addressline1'] },
    { key: 'addressLine2', label: 'Address Line 2', required: false, aliases: ['address line 2', 'address 2', 'area', 'landmark', 'address_line2', 'addressline2'] },
    { key: 'city', label: 'City', required: false, aliases: ['city', 'town', 'district'] },
    { key: 'state', label: 'State', required: false, aliases: ['state', 'province'] },
    { key: 'pincode', label: 'Pincode', required: false, aliases: ['pincode', 'pin code', 'zip', 'zip code', 'postal code'] },
    { key: 'gstin', label: 'GSTIN', required: false, aliases: ['gstin', 'gst number', 'gst no', 'gst', 'tax id', 'gst_no'] },
    { key: 'pan', label: 'PAN', required: false, aliases: ['pan', 'pan number', 'pan no', 'pan_no'] },
    { key: 'creditLimit', label: 'Credit Limit', required: false, aliases: ['credit limit', 'limit', 'credit_limit'] },
    { key: 'creditDays', label: 'Credit Days', required: false, aliases: ['credit days', 'days', 'payment terms', 'credit_days'] },
    { key: 'status', label: 'Status', required: false, aliases: ['status', 'is active', 'active', 'state'] },
    { key: 'notes', label: 'Notes', required: false, aliases: ['notes', 'remarks', 'comments', 'description'] },
  ],
  PURCHASE: [
    { key: 'supplier', label: 'Supplier', required: true, aliases: ['supplier', 'supplier name', 'vendor', 'party', 'supplier code', 'vendor name'] },
    { key: 'supplierInvoiceNumber', label: 'Supplier Invoice Number', required: true, aliases: ['supplier invoice number', 'supplier inv no', 'bill no', 'invoice no', 'invoice number', 'supplier_invoice_no', 'bill_number'] },
    { key: 'supplierInvoiceDate', label: 'Supplier Invoice Date', required: false, aliases: ['supplier invoice date', 'bill date', 'supplier inv date', 'supplier_invoice_date'] },
    { key: 'invoiceDate', label: 'Invoice Date', required: false, aliases: ['invoice date', 'entry date', 'date', 'posting date', 'received date'] },
    { key: 'uniqueItem', label: 'Unique Item', required: true, aliases: ['unique item', 'item', 'item code', 'sku', 'product', 'lens model', 'item name', 'unique_item'] },
    { key: 'sph', label: 'SPH', required: true, aliases: ['sph', 'sphere', 'spherical', 'sph power', 'power sph'] },
    { key: 'cyl', label: 'CYL', required: true, aliases: ['cyl', 'cylinder', 'cylindrical', 'cyl power', 'power cyl'] },
    { key: 'axis', label: 'AXIS', required: false, aliases: ['axis', 'deg', 'angle', 'axis degree'] },
    { key: 'add', label: 'ADD', required: false, aliases: ['add', 'addition', 'add power', 'reading addition', 'nv add'] },
    { key: 'side', label: 'SIDE', required: false, aliases: ['side', 'eye', 'r/l', 'right/left', 'side (r/l/be)'] },
    { key: 'quantity', label: 'Quantity', required: true, aliases: ['quantity', 'qty', 'pairs', 'count', 'pcs'] },
    { key: 'rate', label: 'Rate', required: true, aliases: ['rate', 'price', 'purchase rate', 'cost', 'unit price', 'buy rate'] },
    { key: 'discountType', label: 'Discount Type', required: false, aliases: ['discount type', 'disc type', 'discount_type'] },
    { key: 'discountValue', label: 'Discount Value', required: false, aliases: ['discount value', 'discount', 'disc', 'discount amount', 'discount %', 'disc_val'] },
    { key: 'gstMode', label: 'GST Mode', required: false, aliases: ['gst mode', 'tax mode', 'gst type', 'inter/intra'] },
  ],
  SALES_ORDER: [
    { key: 'customer', label: 'Customer', required: true, aliases: ['customer', 'customer name', 'party', 'client', 'party name', 'customer code'] },
    { key: 'orderDate', label: 'Order Date', required: false, aliases: ['order date', 'date', 'so date', 'booking date'] },
    { key: 'uniqueItem', label: 'Unique Item', required: true, aliases: ['unique item', 'item', 'sku', 'product', 'item name', 'lens'] },
    { key: 'sph', label: 'SPH', required: true, aliases: ['sph', 'sphere', 'spherical', 'power sph'] },
    { key: 'cyl', label: 'CYL', required: true, aliases: ['cyl', 'cylinder', 'cylindrical', 'power cyl'] },
    { key: 'axis', label: 'AXIS', required: false, aliases: ['axis', 'deg', 'angle'] },
    { key: 'add', label: 'ADD', required: false, aliases: ['add', 'addition', 'add power'] },
    { key: 'side', label: 'SIDE', required: false, aliases: ['side', 'eye', 'r/l', 'side (r/l/be)'] },
    { key: 'quantity', label: 'Quantity', required: true, aliases: ['quantity', 'qty', 'pairs', 'order qty'] },
    { key: 'rate', label: 'Rate', required: true, aliases: ['rate', 'price', 'sale rate', 'unit price', 'selling price'] },
    { key: 'discountType', label: 'Discount Type', required: false, aliases: ['discount type', 'disc type'] },
    { key: 'discountValue', label: 'Discount Value', required: false, aliases: ['discount value', 'discount', 'disc'] },
    { key: 'gstMode', label: 'GST Mode', required: false, aliases: ['gst mode', 'tax mode', 'gst type'] },
  ],
  SALES_INVOICE: [
    { key: 'customer', label: 'Customer', required: true, aliases: ['customer', 'customer name', 'party', 'client', 'party name', 'customer code'] },
    { key: 'invoiceDate', label: 'Invoice Date', required: false, aliases: ['invoice date', 'date', 'billing date', 'sale date'] },
    { key: 'uniqueItem', label: 'Unique Item', required: true, aliases: ['unique item', 'item', 'sku', 'product', 'item name', 'lens'] },
    { key: 'sph', label: 'SPH', required: true, aliases: ['sph', 'sphere', 'spherical', 'power sph'] },
    { key: 'cyl', label: 'CYL', required: true, aliases: ['cyl', 'cylinder', 'cylindrical', 'power cyl'] },
    { key: 'axis', label: 'AXIS', required: false, aliases: ['axis', 'deg', 'angle'] },
    { key: 'add', label: 'ADD', required: false, aliases: ['add', 'addition', 'add power'] },
    { key: 'side', label: 'SIDE', required: false, aliases: ['side', 'eye', 'r/l', 'side (r/l/be)'] },
    { key: 'quantity', label: 'Quantity', required: true, aliases: ['quantity', 'qty', 'pairs', 'billed qty'] },
    { key: 'rate', label: 'Rate', required: true, aliases: ['rate', 'price', 'sale rate', 'unit price', 'selling price'] },
    { key: 'discountType', label: 'Discount Type', required: false, aliases: ['discount type', 'disc type'] },
    { key: 'discountValue', label: 'Discount Value', required: false, aliases: ['discount value', 'discount', 'disc'] },
    { key: 'gstMode', label: 'GST Mode', required: false, aliases: ['gst mode', 'tax mode', 'gst type'] },
  ],
  OPENING_STOCK: [
    { key: 'uniqueItem', label: 'Unique Item', required: true, aliases: ['unique item', 'item', 'sku', 'product', 'item name', 'lens', 'unique_item'] },
    { key: 'sph', label: 'SPH', required: true, aliases: ['sph', 'sphere', 'spherical', 'power sph'] },
    { key: 'cyl', label: 'CYL', required: true, aliases: ['cyl', 'cylinder', 'cylindrical', 'power cyl'] },
    { key: 'axis', label: 'AXIS', required: false, aliases: ['axis', 'deg', 'angle'] },
    { key: 'add', label: 'ADD', required: false, aliases: ['add', 'addition', 'add power'] },
    { key: 'side', label: 'SIDE', required: false, aliases: ['side', 'eye', 'r/l', 'side (r/l/be)'] },
    { key: 'quantity', label: 'Quantity', required: true, aliases: ['quantity', 'qty', 'pairs', 'opening qty', 'stock'] },
    { key: 'date', label: 'Date', required: false, aliases: ['date', 'opening date', 'as of date', 'audit date'] },
    { key: 'reason', label: 'Reason', required: false, aliases: ['reason', 'cause', 'type'] },
    { key: 'remarks', label: 'Remarks', required: false, aliases: ['remarks', 'notes', 'location', 'shelf', 'comments'] },
  ],
};

export class ColumnMappingService {
  /**
   * Normalizes a header string for reliable comparison.
   */
  static normalizeHeader(header: string): string {
    return (header || '')
      .toLowerCase()
      .replace(/[_\-\/\.\(\)]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Automatically detect column mapping from uploaded spreadsheet headers.
   */
  static detectMapping(importType: ImportType, detectedHeaders: string[]): {
    columnMapping: Record<string, string>; // { [erpKey]: spreadsheetHeader }
    missingRequired: string[]; // erpKeys that are required but not found
    unmappedSpreadsheetHeaders: string[];
  } {
    const definitions = FIELD_DEFINITIONS[importType] || [];
    const normalizedDetected = detectedHeaders.map(h => ({
      original: h,
      clean: this.normalizeHeader(h),
    }));

    const columnMapping: Record<string, string> = {};
    const usedHeaders = new Set<string>();

    for (const def of definitions) {
      // 1. Direct match with aliases
      const match = normalizedDetected.find(h => !usedHeaders.has(h.original) && (
        def.aliases.includes(h.clean) ||
        this.normalizeHeader(def.label) === h.clean ||
        this.normalizeHeader(def.key) === h.clean
      ));

      if (match) {
        columnMapping[def.key] = match.original;
        usedHeaders.add(match.original);
        continue;
      }

      // 2. Partial substring match
      const subMatch = normalizedDetected.find(h => !usedHeaders.has(h.original) && (
        def.aliases.some(alias => h.clean.includes(alias) || alias.includes(h.clean))
      ));

      if (subMatch) {
        columnMapping[def.key] = subMatch.original;
        usedHeaders.add(subMatch.original);
      }
    }

    const missingRequired = definitions
      .filter(def => def.required && !columnMapping[def.key])
      .map(def => def.key);

    const unmappedSpreadsheetHeaders = detectedHeaders.filter(h => !usedHeaders.has(h));

    return {
      columnMapping,
      missingRequired,
      unmappedSpreadsheetHeaders,
    };
  }

  /**
   * Transforms raw Excel row object into standardized ERP object according to mapping.
   */
  static mapRow(row: Record<string, any>, columnMapping: Record<string, string>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [erpKey, spreadsheetHeader] of Object.entries(columnMapping)) {
      if (spreadsheetHeader && row[spreadsheetHeader] !== undefined) {
        let val = row[spreadsheetHeader];
        if (typeof val === 'string') {
          val = val.trim();
        }
        result[erpKey] = val;
      }
    }
    return result;
  }
}
