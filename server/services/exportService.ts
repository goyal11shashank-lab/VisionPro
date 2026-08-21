import * as XLSX from 'xlsx';
import { pool } from '../db/index.js';
import { BusinessSettingsService } from './businessSettingsService.js';

export type ExportDatasetType =
  | 'PARTIES'
  | 'OPTICAL_BATCHES'
  | 'INVENTORY'
  | 'STOCK_LEDGER'
  | 'PURCHASE_INVOICES'
  | 'PURCHASE_DETAILS'
  | 'PURCHASE_RETURNS'
  | 'SALES_ORDERS'
  | 'SALES_INVOICES'
  | 'SALES_DETAILS'
  | 'SALES_RETURNS'
  | 'CUSTOMER_OUTSTANDING'
  | 'SUPPLIER_OUTSTANDING'
  | 'PARTY_STATEMENT'
  | 'PAYMENTS'
  | 'PRODUCT_SALES'
  | 'POWER_SALES';

export interface ExportFilterOptions {
  startDate?: string;
  endDate?: string;
  partyId?: string;
  categoryId?: string;
  uniqueItemId?: string;
  status?: string;
  partyType?: string;
  paymentMode?: string;
  paymentType?: string;
  stockStatus?: string;
  sph?: number;
  cyl?: number;
  axis?: number;
  add?: number;
  side?: string;
}

export class ExportService {
  /**
   * Generates a fully-formatted XLSX workbook buffer for the requested dataset.
   */
  static async exportDataset(
    businessId: string,
    datasetType: ExportDatasetType,
    filters: ExportFilterOptions = {}
  ): Promise<{ fileName: string; buffer: Buffer; rowCount: number }> {
    let rows: Record<string, any>[] = [];
    let sheetName = 'Export Data';
    let filePrefix = 'Export';

    switch (datasetType) {
      case 'PARTIES': {
        filePrefix = 'Parties_Directory';
        sheetName = 'Parties';
        rows = await this.queryParties(businessId, filters);
        break;
      }
      case 'OPTICAL_BATCHES': {
        filePrefix = 'Optical_Batches';
        sheetName = 'Batches';
        rows = await this.queryBatches(businessId, filters);
        break;
      }
      case 'INVENTORY': {
        filePrefix = 'Current_Inventory';
        sheetName = 'Stock Summary';
        rows = await this.queryInventory(businessId, filters);
        break;
      }
      case 'STOCK_LEDGER': {
        filePrefix = 'Stock_Ledger_Register';
        sheetName = 'Stock Ledger';
        rows = await this.queryStockLedger(businessId, filters);
        break;
      }
      case 'PURCHASE_INVOICES': {
        filePrefix = 'Purchase_Register';
        sheetName = 'Purchase Invoices';
        rows = await this.queryPurchaseInvoices(businessId, filters);
        break;
      }
      case 'PURCHASE_DETAILS': {
        filePrefix = 'Purchase_Details';
        sheetName = 'Purchase Line Items';
        rows = await this.queryPurchaseDetails(businessId, filters);
        break;
      }
      case 'PURCHASE_RETURNS': {
        filePrefix = 'Purchase_Returns';
        sheetName = 'Purchase Returns';
        rows = await this.queryPurchaseReturns(businessId, filters);
        break;
      }
      case 'SALES_ORDERS': {
        filePrefix = 'Sales_Orders_Register';
        sheetName = 'Sales Orders';
        rows = await this.querySalesOrders(businessId, filters);
        break;
      }
      case 'SALES_INVOICES': {
        filePrefix = 'Sales_Invoices_Register';
        sheetName = 'Sales Invoices';
        rows = await this.querySalesInvoices(businessId, filters);
        break;
      }
      case 'SALES_DETAILS': {
        filePrefix = 'Sales_Details';
        sheetName = 'Sales Line Items';
        rows = await this.querySalesDetails(businessId, filters);
        break;
      }
      case 'SALES_RETURNS': {
        filePrefix = 'Sales_Returns';
        sheetName = 'Sales Returns';
        rows = await this.querySalesReturns(businessId, filters);
        break;
      }
      case 'CUSTOMER_OUTSTANDING': {
        filePrefix = 'Customer_Outstanding';
        sheetName = 'Customer Balances';
        rows = await this.queryCustomerOutstanding(businessId, filters);
        break;
      }
      case 'SUPPLIER_OUTSTANDING': {
        filePrefix = 'Supplier_Outstanding';
        sheetName = 'Supplier Balances';
        rows = await this.querySupplierOutstanding(businessId, filters);
        break;
      }
      case 'PARTY_STATEMENT': {
        filePrefix = 'Party_Statement';
        sheetName = 'Ledger Statement';
        rows = await this.queryPartyStatement(businessId, filters);
        break;
      }
      case 'PAYMENTS': {
        filePrefix = 'Payment_Transactions';
        sheetName = 'Payments';
        rows = await this.queryPayments(businessId, filters);
        break;
      }
      case 'PRODUCT_SALES': {
        filePrefix = 'Product_Sales_Report';
        sheetName = 'Product Sales';
        rows = await this.queryProductSales(businessId, filters);
        break;
      }
      case 'POWER_SALES': {
        filePrefix = 'Optical_Power_Sales';
        sheetName = 'Power Sales';
        rows = await this.queryPowerSales(businessId, filters);
        break;
      }
      default:
        throw new Error(`Unsupported export dataset type: ${datasetType}`);
    }

    const timestamp = new Date().toISOString().replace(/[:\.]/g, '-').slice(0, 19);
    const fileName = `${filePrefix}_${timestamp}.xlsx`;

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Status: 'No records found matching criteria' }]);

    // Auto-calculate column widths
    if (rows.length > 0) {
      const colKeys = Object.keys(rows[0]);
      ws['!cols'] = colKeys.map(k => ({
        wch: Math.max(k.length + 3, 14),
      }));
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Summary metadata sheet
    const metaData = [
      { Parameter: 'Export Dataset', Value: datasetType },
      { Parameter: 'Business Scope', Value: businessId },
      { Parameter: 'Total Exported Records', Value: rows.length },
      { Parameter: 'Export Timestamp', Value: new Date().toISOString() },
      { Parameter: 'Filter: Start Date', Value: filters.startDate || 'All' },
      { Parameter: 'Filter: End Date', Value: filters.endDate || 'All' },
      { Parameter: 'Filter: Status', Value: filters.status || 'All' },
    ];
    const wsMeta = XLSX.utils.json_to_sheet(metaData);
    wsMeta['!cols'] = [{ wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Export Metadata');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { fileName, buffer, rowCount: rows.length };
  }

  private static async queryParties(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        p.party_code AS "Party Code",
        p.name AS "Party Name",
        p.display_name AS "Display Name",
        p.party_type AS "Party Type",
        p.mobile AS "Mobile",
        p.email AS "Email",
        p.gstin AS "GSTIN",
        p.pan AS "PAN",
        p.address_line1 AS "Address",
        p.city AS "City",
        p.state AS "State",
        p.pincode AS "Pincode",
        p.credit_limit AS "Credit Limit",
        p.credit_days AS "Credit Days",
        p.status AS "Status"
      FROM parties p
      WHERE p.business_id = $1
    `;
    const params: any[] = [businessId];
    if (filters.partyType && filters.partyType !== 'ALL') {
      sql += ` AND p.party_type = $2`;
      params.push(filters.partyType);
    }
    sql += ` ORDER BY p.name ASC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryBatches(businessId: string, _filters: ExportFilterOptions): Promise<any[]> {
    const sql = `
      SELECT
        b.barcode AS "Barcode",
        u.name AS "Item Name",
        u.sku AS "SKU",
        c.name AS "Category",
        p.name AS "Primary Item / Brand",
        b.sph AS "SPH",
        b.cyl AS "CYL",
        b.axis AS "AXIS",
        b.add AS "ADD",
        b.side AS "SIDE",
        COALESCE(s.physical_stock, 0) AS "Physical Stock",
        COALESCE(s.reserved_stock, 0) AS "Reserved Stock",
        COALESCE(s.available_stock, 0) AS "Available Stock",
        u.mrp AS "MRP",
        b.status AS "Status"
      FROM optical_batches b
      JOIN categories c ON b.category_id = c.id
      JOIN unique_items u ON b.unique_item_id = u.id
      JOIN primary_items p ON u.primary_item_id = p.id
      LEFT JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
      WHERE b.business_id = $1
      ORDER BY b.barcode ASC
    `;
    const res = await pool.query(sql, [businessId]);
    return res.rows;
  }

  private static async queryInventory(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    const settings = await BusinessSettingsService.getSettings(businessId);
    const lowStockThreshold = settings.lowStockThreshold;

    let sql = `
      SELECT
        b.barcode AS "Barcode",
        u.name AS "Product Name",
        u.sku AS "SKU",
        c.name AS "Category",
        p.name AS "Brand",
        b.sph AS "SPH",
        b.cyl AS "CYL",
        b.axis AS "AXIS",
        b.add AS "ADD",
        b.side AS "SIDE",
        COALESCE(s.physical_stock, 0) AS "Physical Stock",
        COALESCE(s.reserved_stock, 0) AS "Reserved Stock",
        COALESCE(s.available_stock, 0) AS "Available Stock",
        u.mrp AS "MRP",
        CASE
          WHEN COALESCE(s.physical_stock, 0) < 0 THEN 'NEGATIVE_STOCK'
          WHEN COALESCE(s.physical_stock, 0) = 0 THEN 'ZERO_STOCK'
          WHEN COALESCE(s.physical_stock, 0) <= ${lowStockThreshold} THEN 'LOW_STOCK'
          ELSE 'IN_STOCK'
        END AS "Stock Status"
      FROM optical_batches b
      JOIN categories c ON b.category_id = c.id
      JOIN unique_items u ON b.unique_item_id = u.id
      JOIN primary_items p ON u.primary_item_id = p.id
      LEFT JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
      WHERE b.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.stockStatus === 'IN_STOCK') {
      sql += ` AND COALESCE(s.physical_stock, 0) > 0`;
    } else if (filters.stockStatus === 'ZERO_STOCK') {
      sql += ` AND COALESCE(s.physical_stock, 0) = 0`;
    } else if (filters.stockStatus === 'NEGATIVE_STOCK') {
      sql += ` AND COALESCE(s.physical_stock, 0) < 0`;
    } else if (filters.stockStatus === 'RESERVED') {
      sql += ` AND COALESCE(s.reserved_stock, 0) > 0`;
    } else if (filters.stockStatus === 'LOW_STOCK') {
      sql += ` AND COALESCE(s.physical_stock, 0) > 0 AND COALESCE(s.physical_stock, 0) <= ${lowStockThreshold}`;
    }

    if (filters.categoryId) {
      sql += ` AND b.category_id = $${idx++}`;
      params.push(filters.categoryId);
    }
    if (filters.uniqueItemId) {
      sql += ` AND b.unique_item_id = $${idx++}`;
      params.push(filters.uniqueItemId);
    }

    sql += ` ORDER BY b.barcode ASC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryStockLedger(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        TO_CHAR(sl.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "Date & Time",
        b.barcode AS "Barcode",
        u.name AS "Product Name",
        u.sku AS "SKU",
        CONCAT('SPH:', b.sph, ' CYL:', b.cyl, ' AXIS:', b.axis, ' ADD:', b.add, ' SIDE:', b.side) AS "Optical Power",
        sl.transaction_type AS "Transaction Type",
        sl.document_type AS "Document Type",
        sl.document_number AS "Document No",
        sl.quantity_in AS "Qty In",
        sl.quantity_out AS "Qty Out",
        sl.balance_after AS "Balance After",
        COALESCE(sl.notes, '') AS "Notes"
      FROM stock_ledger sl
      JOIN optical_batches b ON sl.batch_id = b.id
      JOIN unique_items u ON b.unique_item_id = u.id
      WHERE sl.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND sl.created_at >= $${idx++}::date`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND sl.created_at <= ($${idx++}::date + INTERVAL '1 day')`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY sl.created_at DESC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryPurchaseInvoices(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        pi.invoice_number AS "Invoice Number",
        COALESCE(pi.supplier_invoice_number, '') AS "Supplier Inv No",
        TO_CHAR(pi.invoice_date, 'YYYY-MM-DD') AS "Invoice Date",
        TO_CHAR((pi.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day'), 'YYYY-MM-DD') AS "Due Date",
        p.name AS "Supplier Name",
        p.party_code AS "Supplier Code",
        p.gstin AS "Supplier GSTIN",
        pi.subtotal AS "Gross (Subtotal)",
        pi.discount_total AS "Discount Total",
        pi.taxable_amount AS "Taxable Amount",
        pi.igst_amount AS "IGST",
        pi.cgst_amount AS "CGST",
        pi.sgst_amount AS "SGST",
        (pi.igst_amount + pi.cgst_amount + pi.sgst_amount) AS "Total GST",
        pi.grand_total AS "Grand Total",
        COALESCE(pa_sub.paid_amount, 0) AS "Paid Amount",
        (pi.grand_total - COALESCE(pa_sub.paid_amount, 0)) AS "Outstanding Balance",
        pi.status AS "Status",
        pi.payment_status AS "Payment Status"
      FROM purchase_invoices pi
      JOIN parties p ON pi.supplier_party_id = p.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
        FROM payment_allocations pa
        JOIN payments pmt ON pmt.id = pa.payment_id
        WHERE pa.document_id = pi.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
      ) pa_sub ON true
      WHERE pi.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND pi.invoice_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND pi.invoice_date <= $${idx++}`;
      params.push(filters.endDate);
    }
    if (filters.status) {
      sql += ` AND pi.status = $${idx++}`;
      params.push(filters.status);
    }

    sql += ` ORDER BY pi.invoice_date DESC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryPurchaseDetails(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        pi.invoice_number AS "Invoice Number",
        TO_CHAR(pi.invoice_date, 'YYYY-MM-DD') AS "Invoice Date",
        p.name AS "Supplier Name",
        u.name AS "Unique Item",
        u.sku AS "SKU",
        COALESCE(b.barcode, 'N/A') AS "Barcode",
        CASE WHEN b.id IS NOT NULL THEN CONCAT('SPH:', b.sph, ' CYL:', b.cyl, ' AXIS:', b.axis, ' ADD:', b.add, ' SIDE:', b.side) ELSE 'N/A' END AS "Optical Power",
        pil.quantity AS "Quantity",
        pil.unit_cost AS "Unit Cost",
        pil.discount_percent AS "Discount %",
        pil.tax_rate AS "Tax Rate %",
        pil.tax_amount AS "Tax Amount",
        pil.total_amount AS "Line Total",
        pi.status AS "Status"
      FROM purchase_invoice_lines pil
      JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
      JOIN parties p ON pi.supplier_party_id = p.id
      JOIN unique_items u ON pil.unique_item_id = u.id
      LEFT JOIN optical_batches b ON pil.batch_id = b.id
      WHERE pi.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND pi.invoice_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND pi.invoice_date <= $${idx++}`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY pi.invoice_date DESC, pil.id ASC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryPurchaseReturns(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        pr.return_number AS "Debit Note Number",
        TO_CHAR(pr.return_date, 'YYYY-MM-DD') AS "Return Date",
        p.name AS "Supplier Name",
        pr.subtotal AS "Subtotal",
        pr.tax_amount AS "Tax Amount",
        pr.grand_total AS "Grand Total",
        pr.reason AS "Reason",
        pr.status AS "Status"
      FROM purchase_returns pr
      JOIN parties p ON pr.supplier_party_id = p.id
      WHERE pr.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND pr.return_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND pr.return_date <= $${idx++}`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY pr.return_date DESC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async querySalesOrders(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        so.order_number AS "Order Number",
        TO_CHAR(so.order_date, 'YYYY-MM-DD') AS "Order Date",
        p.name AS "Customer Name",
        p.party_code AS "Customer Code",
        so.subtotal AS "Subtotal",
        so.tax_amount AS "Tax Amount",
        so.grand_total AS "Grand Total",
        so.status AS "Status"
      FROM sales_orders so
      JOIN parties p ON so.party_id = p.id
      WHERE so.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND so.order_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND so.order_date <= $${idx++}`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY so.order_date DESC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async querySalesInvoices(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        si.invoice_number AS "Invoice Number",
        TO_CHAR(si.invoice_date, 'YYYY-MM-DD') AS "Invoice Date",
        p.name AS "Customer Name",
        p.party_code AS "Customer Code",
        p.mobile AS "Customer Mobile",
        si.subtotal AS "Gross (Subtotal)",
        si.discount_total AS "Discount Total",
        si.taxable_amount AS "Taxable Amount",
        si.igst_amount AS "IGST",
        si.cgst_amount AS "CGST",
        si.sgst_amount AS "SGST",
        (si.igst_amount + si.cgst_amount + si.sgst_amount) AS "Total GST",
        si.grand_total AS "Grand Total",
        COALESCE(pa_sub.paid_amount, 0) AS "Paid Amount",
        (si.grand_total - COALESCE(pa_sub.paid_amount, 0)) AS "Outstanding Balance",
        si.status AS "Status",
        si.payment_status AS "Payment Status"
      FROM sales_invoices si
      JOIN parties p ON si.party_id = p.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
        FROM payment_allocations pa
        JOIN payments pmt ON pmt.id = pa.payment_id
        WHERE pa.document_id = si.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
      ) pa_sub ON true
      WHERE si.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND si.invoice_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND si.invoice_date <= $${idx++}`;
      params.push(filters.endDate);
    }
    if (filters.status) {
      sql += ` AND si.status = $${idx++}`;
      params.push(filters.status);
    }

    sql += ` ORDER BY si.invoice_date DESC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async querySalesDetails(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        si.invoice_number AS "Invoice Number",
        TO_CHAR(si.invoice_date, 'YYYY-MM-DD') AS "Invoice Date",
        p.name AS "Customer Name",
        u.name AS "Unique Item",
        u.sku AS "SKU",
        COALESCE(b.barcode, 'N/A') AS "Barcode",
        CASE WHEN b.id IS NOT NULL THEN CONCAT('SPH:', b.sph, ' CYL:', b.cyl, ' AXIS:', b.axis, ' ADD:', b.add, ' SIDE:', b.side) ELSE 'N/A' END AS "Optical Power",
        sil.quantity AS "Quantity",
        sil.unit_price AS "Unit Price",
        sil.discount_percent AS "Discount %",
        sil.tax_rate AS "Tax Rate %",
        sil.tax_amount AS "Tax Amount",
        sil.total_amount AS "Line Total",
        si.status AS "Status"
      FROM sales_invoice_lines sil
      JOIN sales_invoices si ON sil.sales_invoice_id = si.id
      JOIN parties p ON si.party_id = p.id
      JOIN unique_items u ON sil.unique_item_id = u.id
      LEFT JOIN optical_batches b ON sil.batch_id = b.id
      WHERE si.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND si.invoice_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND si.invoice_date <= $${idx++}`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY si.invoice_date DESC, sil.id ASC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async querySalesReturns(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        sr.return_number AS "Credit Note Number",
        TO_CHAR(sr.return_date, 'YYYY-MM-DD') AS "Return Date",
        p.name AS "Customer Name",
        sr.subtotal AS "Subtotal",
        sr.tax_amount AS "Tax Amount",
        sr.grand_total AS "Grand Total",
        sr.reason AS "Reason",
        sr.status AS "Status"
      FROM sales_returns sr
      JOIN parties p ON sr.party_id = p.id
      WHERE sr.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND sr.return_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND sr.return_date <= $${idx++}`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY sr.return_date DESC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryCustomerOutstanding(businessId: string, _filters: ExportFilterOptions): Promise<any[]> {
    const sql = `
      SELECT
        p.party_code AS "Customer Code",
        p.name AS "Customer Name",
        p.mobile AS "Mobile",
        p.credit_limit AS "Credit Limit",
        p.credit_days AS "Credit Days",
        COALESCE((SELECT balance FROM customer_ledgers cl WHERE cl.party_id = p.id ORDER BY cl.created_at DESC LIMIT 1), '0.00') AS "Outstanding Balance",
        COALESCE((
          SELECT SUM(CASE
            WHEN (inv.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') < CURRENT_DATE
            THEN (inv.grand_total - COALESCE(pa_sub.paid_amount, 0))
            ELSE 0
          END)
          FROM sales_invoices inv
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
            FROM payment_allocations pa
            JOIN payments pmt ON pmt.id = pa.payment_id
            WHERE pa.document_id = inv.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
          ) pa_sub ON true
          WHERE inv.party_id = p.id AND inv.business_id = $1 AND inv.status = 'POSTED' AND (inv.grand_total - COALESCE(pa_sub.paid_amount, 0)) > 0
        ), 0) AS "Overdue Balance",
        p.status AS "Status"
      FROM parties p
      WHERE p.business_id = $1 AND p.party_type IN ('CUSTOMER', 'BOTH')
      ORDER BY "Outstanding Balance"::numeric DESC, p.name ASC
    `;
    const res = await pool.query(sql, [businessId]);
    return res.rows;
  }

  private static async querySupplierOutstanding(businessId: string, _filters: ExportFilterOptions): Promise<any[]> {
    const sql = `
      SELECT
        p.party_code AS "Supplier Code",
        p.name AS "Supplier Name",
        p.mobile AS "Mobile",
        p.credit_days AS "Credit Days",
        COALESCE((SELECT balance FROM supplier_ledgers sl WHERE sl.party_id = p.id ORDER BY sl.created_at DESC LIMIT 1), '0.00') AS "Outstanding Balance",
        COALESCE((
          SELECT SUM(CASE
            WHEN (inv.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') < CURRENT_DATE
            THEN (inv.grand_total - COALESCE(pa_sub.paid_amount, 0))
            ELSE 0
          END)
          FROM purchase_invoices inv
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
            FROM payment_allocations pa
            JOIN payments pmt ON pmt.id = pa.payment_id
            WHERE pa.document_id = inv.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
          ) pa_sub ON true
          WHERE inv.supplier_party_id = p.id AND inv.business_id = $1 AND inv.status = 'POSTED' AND (inv.grand_total - COALESCE(pa_sub.paid_amount, 0)) > 0
        ), 0) AS "Overdue Balance",
        p.status AS "Status"
      FROM parties p
      WHERE p.business_id = $1 AND p.party_type IN ('SUPPLIER', 'BOTH')
      ORDER BY "Outstanding Balance"::numeric DESC, p.name ASC
    `;
    const res = await pool.query(sql, [businessId]);
    return res.rows;
  }

  private static async queryPartyStatement(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    if (!filters.partyId) return [];
    const isCustomer = filters.partyType === 'CUSTOMER';
    const ledgerTable = isCustomer ? 'customer_ledgers' : 'supplier_ledgers';

    let sql = `
      SELECT
        TO_CHAR(l.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "Date",
        l.transaction_type AS "Transaction Type",
        l.document_type AS "Document Type",
        l.document_number AS "Document No",
        l.debit AS "Debit",
        l.credit AS "Credit",
        l.balance AS "Running Balance",
        COALESCE(l.notes, '') AS "Notes"
      FROM ${ledgerTable} l
      WHERE l.business_id = $1 AND l.party_id = $2
    `;
    const params: any[] = [businessId, filters.partyId];
    let idx = 3;

    if (filters.startDate) {
      sql += ` AND l.created_at >= $${idx++}::date`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND l.created_at <= ($${idx++}::date + INTERVAL '1 day')`;
      params.push(filters.endDate);
    }

    sql += ` ORDER BY l.created_at ASC, l.id ASC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryPayments(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        pm.payment_number AS "Payment Number",
        TO_CHAR(pm.payment_date, 'YYYY-MM-DD') AS "Payment Date",
        p.name AS "Party Name",
        p.party_type AS "Party Type",
        pm.payment_type AS "Payment Type",
        pm.payment_mode AS "Payment Mode",
        pm.amount AS "Amount",
        pm.allocated_amount AS "Allocated Amount",
        pm.unallocated_amount AS "Unallocated Amount",
        COALESCE(pm.reference_number, '') AS "Reference Number",
        COALESCE(pm.bank_name, '') AS "Bank Name",
        pm.status AS "Status",
        COALESCE(pm.notes, '') AS "Notes"
      FROM payments pm
      JOIN parties p ON pm.party_id = p.id
      WHERE pm.business_id = $1
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND pm.payment_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND pm.payment_date <= $${idx++}`;
      params.push(filters.endDate);
    }
    if (filters.paymentMode && filters.paymentMode !== 'ALL') {
      sql += ` AND pm.payment_mode = $${idx++}`;
      params.push(filters.paymentMode);
    }
    if (filters.paymentType && filters.paymentType !== 'ALL') {
      sql += ` AND pm.payment_type = $${idx++}`;
      params.push(filters.paymentType);
    }

    sql += ` ORDER BY pm.payment_date DESC`;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryProductSales(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        u.name AS "Product Name",
        u.sku AS "SKU",
        c.name AS "Category",
        p.name AS "Brand",
        COUNT(DISTINCT si.id) AS "Total Invoices",
        COALESCE(SUM(sil.quantity), 0) AS "Total Qty Sold",
        COALESCE(SUM(sil.total_amount), 0) AS "Total Sales Amount"
      FROM sales_invoice_lines sil
      JOIN sales_invoices si ON sil.sales_invoice_id = si.id
      JOIN unique_items u ON sil.unique_item_id = u.id
      JOIN primary_items p ON u.primary_item_id = p.id
      JOIN categories c ON p.category_id = c.id
      WHERE si.business_id = $1 AND si.status = 'POSTED'
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND si.invoice_date >= $${idx++}::date`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND si.invoice_date <= $${idx++}::date`;
      params.push(filters.endDate);
    }

    sql += `
      GROUP BY u.name, u.sku, c.name, p.name
      ORDER BY "Total Sales Amount" DESC
    `;
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private static async queryPowerSales(businessId: string, filters: ExportFilterOptions): Promise<any[]> {
    let sql = `
      SELECT
        u.name AS "Product Name",
        u.sku AS "SKU",
        b.sph AS "SPH",
        b.cyl AS "CYL",
        b.axis AS "AXIS",
        b.add AS "ADD",
        b.side AS "SIDE",
        COALESCE(SUM(sil.quantity), 0) AS "Total Qty Sold",
        COALESCE(SUM(sil.total_amount), 0) AS "Total Sales Amount"
      FROM sales_invoice_lines sil
      JOIN sales_invoices si ON sil.sales_invoice_id = si.id
      JOIN optical_batches b ON sil.batch_id = b.id
      JOIN unique_items u ON b.unique_item_id = u.id
      WHERE si.business_id = $1 AND si.status = 'POSTED'
    `;
    const params: any[] = [businessId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND si.invoice_date >= $${idx++}::date`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND si.invoice_date <= $${idx++}::date`;
      params.push(filters.endDate);
    }

    sql += `
      GROUP BY u.name, u.sku, b.sph, b.cyl, b.axis, b.add, b.side
      ORDER BY "Total Qty Sold" DESC
    `;
    const res = await pool.query(sql, params);
    return res.rows;
  }
}
