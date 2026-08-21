import { pool } from '../db/index.js';
import { BusinessSettingsService } from './businessSettingsService.js';

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface InventoryReportFilters extends PaginationParams {
  stockStatus?: 'ALL' | 'IN_STOCK' | 'ZERO_STOCK' | 'NEGATIVE_STOCK' | 'RESERVED' | 'LOW_STOCK';
  categoryId?: string;
  categoryCode?: string;
  uniqueItemId?: string;
  brand?: string;
  search?: string;
  sph?: number;
  cyl?: number;
  axis?: number;
  add?: number;
  side?: string;
}

export interface StockLedgerFilters extends PaginationParams {
  batchId?: string;
  barcode?: string;
  uniqueItemId?: string;
  transactionType?: string;
  startDate?: string;
  endDate?: string;
}

export interface DocumentReportFilters extends PaginationParams {
  partyId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  paymentStatus?: string;
  search?: string;
}

export class ReportService {
  /**
   * 1. INVENTORY STOCK REPORT
   */
  static async getInventoryReport(businessId: string, filters: InventoryReportFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const settings = await BusinessSettingsService.getSettings(businessId);
    const lowStockThreshold = settings.lowStockThreshold;

    const conditions: string[] = ['b.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    // Stock Status filter
    if (filters.stockStatus === 'IN_STOCK') {
      conditions.push('COALESCE(s.physical_stock, 0) > 0');
    } else if (filters.stockStatus === 'ZERO_STOCK') {
      conditions.push('COALESCE(s.physical_stock, 0) = 0');
    } else if (filters.stockStatus === 'NEGATIVE_STOCK') {
      conditions.push('COALESCE(s.physical_stock, 0) < 0');
    } else if (filters.stockStatus === 'RESERVED') {
      conditions.push('COALESCE(s.reserved_stock, 0) > 0');
    } else if (filters.stockStatus === 'LOW_STOCK') {
      conditions.push(`COALESCE(s.physical_stock, 0) > 0 AND COALESCE(s.physical_stock, 0) <= $${paramIndex}`);
      params.push(lowStockThreshold);
      paramIndex++;
    }

    // Category filter
    if (filters.categoryId) {
      conditions.push(`b.category_id = $${paramIndex}`);
      params.push(filters.categoryId);
      paramIndex++;
    } else if (filters.categoryCode) {
      conditions.push(`c.code = $${paramIndex}`);
      params.push(filters.categoryCode);
      paramIndex++;
    }

    // Unique item filter
    if (filters.uniqueItemId) {
      conditions.push(`b.unique_item_id = $${paramIndex}`);
      params.push(filters.uniqueItemId);
      paramIndex++;
    }

    // Power filters
    if (filters.sph !== undefined && !isNaN(Number(filters.sph))) {
      conditions.push(`b.sph = $${paramIndex}`);
      params.push(Number(filters.sph));
      paramIndex++;
    }
    if (filters.cyl !== undefined && !isNaN(Number(filters.cyl))) {
      conditions.push(`b.cyl = $${paramIndex}`);
      params.push(Number(filters.cyl));
      paramIndex++;
    }
    if (filters.axis !== undefined && !isNaN(Number(filters.axis))) {
      conditions.push(`b.axis = $${paramIndex}`);
      params.push(Number(filters.axis));
      paramIndex++;
    }
    if (filters.add !== undefined && !isNaN(Number(filters.add))) {
      conditions.push(`b.add = $${paramIndex}`);
      params.push(Number(filters.add));
      paramIndex++;
    }
    if (filters.side) {
      conditions.push(`b.side = $${paramIndex}`);
      params.push(filters.side);
      paramIndex++;
    }

    // Search term
    if (filters.search) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(`(b.barcode ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex} OR u.sku ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // 1. Get summary totals across the entire filtered dataset
    const summaryQuery = `
      SELECT
        COUNT(b.id) AS total_batches,
        COALESCE(SUM(COALESCE(s.physical_stock, 0)), 0) AS total_physical,
        COALESCE(SUM(COALESCE(s.reserved_stock, 0)), 0) AS total_reserved,
        COALESCE(SUM(COALESCE(s.available_stock, 0)), 0) AS total_available
      FROM optical_batches b
      JOIN categories c ON b.category_id = c.id
      JOIN unique_items u ON b.unique_item_id = u.id
      JOIN primary_items p ON u.primary_item_id = p.id
      LEFT JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
      WHERE ${whereClause}
    `;
    const summaryRes = await pool.query(summaryQuery, params);
    const summary = {
      totalBatches: parseInt(summaryRes.rows[0]?.total_batches, 10) || 0,
      totalPhysical: parseFloat(summaryRes.rows[0]?.total_physical) || 0,
      totalReserved: parseFloat(summaryRes.rows[0]?.total_reserved) || 0,
      totalAvailable: parseFloat(summaryRes.rows[0]?.total_available) || 0,
    };

    // 2. Fetch paginated data
    const dataQuery = `
      SELECT
        b.id AS batch_id,
        b.barcode,
        b.sph,
        b.cyl,
        b.axis,
        b.add,
        b.side,
        u.id AS unique_item_id,
        u.name AS unique_item_name,
        u.sku,
        u.mrp,
        p.id AS primary_item_id,
        p.name AS primary_item_name,
        c.code AS category_code,
        c.name AS category_name,
        COALESCE(s.physical_stock, 0) AS physical_stock,
        COALESCE(s.reserved_stock, 0) AS reserved_stock,
        COALESCE(s.available_stock, 0) AS available_stock,
        (COALESCE(s.physical_stock, 0) > 0 AND COALESCE(s.physical_stock, 0) <= ${lowStockThreshold}) AS is_low_stock,
        (COALESCE(s.physical_stock, 0) < 0) AS is_negative_stock
      FROM optical_batches b
      JOIN categories c ON b.category_id = c.id
      JOIN unique_items u ON b.unique_item_id = u.id
      JOIN primary_items p ON u.primary_item_id = p.id
      LEFT JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
      WHERE ${whereClause}
      ORDER BY b.barcode ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataRes = await pool.query(dataQuery, [...params, limit, offset]);

    return {
      data: dataRes.rows.map(r => ({
        batchId: r.batch_id,
        barcode: r.barcode,
        uniqueItemId: r.unique_item_id,
        uniqueItemName: r.unique_item_name,
        sku: r.sku,
        mrp: parseFloat(r.mrp) || 0,
        primaryItemId: r.primary_item_id,
        brand: r.primary_item_name,
        categoryCode: r.category_code,
        categoryName: r.category_name,
        sph: parseFloat(r.sph) || 0,
        cyl: parseFloat(r.cyl) || 0,
        axis: parseFloat(r.axis) || 0,
        add: parseFloat(r.add) || 0,
        side: r.side,
        physicalStock: parseFloat(r.physical_stock) || 0,
        reservedStock: parseFloat(r.reserved_stock) || 0,
        availableStock: parseFloat(r.available_stock) || 0,
        isLowStock: Boolean(r.is_low_stock),
        isNegativeStock: Boolean(r.is_negative_stock),
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: summary.totalBatches,
        totalPages: Math.ceil(summary.totalBatches / limit) || 1,
      },
    };
  }

  /**
   * 2. STOCK LEDGER REPORT
   */
  static async getStockLedgerReport(businessId: string, filters: StockLedgerFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['sl.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.batchId) {
      conditions.push(`sl.batch_id = $${paramIndex}`);
      params.push(filters.batchId);
      paramIndex++;
    }
    if (filters.barcode) {
      conditions.push(`b.barcode = $${paramIndex}`);
      params.push(filters.barcode);
      paramIndex++;
    }
    if (filters.uniqueItemId) {
      conditions.push(`b.unique_item_id = $${paramIndex}`);
      params.push(filters.uniqueItemId);
      paramIndex++;
    }
    if (filters.transactionType) {
      conditions.push(`sl.transaction_type = $${paramIndex}`);
      params.push(filters.transactionType);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`sl.created_at >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`sl.created_at <= ($${paramIndex}::date + INTERVAL '1 day')`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT
         COUNT(sl.id) AS total_records,
         COALESCE(SUM(sl.quantity_in), 0) AS total_qty_in,
         COALESCE(SUM(sl.quantity_out), 0) AS total_qty_out
       FROM stock_ledger sl
       JOIN optical_batches b ON sl.batch_id = b.id
       WHERE ${whereClause}`,
      params
    );

    const totalRecords = parseInt(countRes.rows[0]?.total_records, 10) || 0;
    const summary = {
      totalRecords,
      totalQtyIn: parseFloat(countRes.rows[0]?.total_qty_in) || 0,
      totalQtyOut: parseFloat(countRes.rows[0]?.total_qty_out) || 0,
    };

    const dataRes = await pool.query(
      `SELECT
         sl.id,
         sl.batch_id,
         b.barcode,
         b.sph,
         b.cyl,
         b.axis,
         b.add,
         b.side,
         u.name AS unique_item_name,
         u.sku,
         c.name AS category_name,
         sl.transaction_type,
         sl.document_type,
         sl.document_number,
         sl.document_id,
         sl.quantity_in,
         sl.quantity_out,
         sl.balance_after,
         sl.notes,
         sl.created_at,
         us.full_name AS created_by_name
       FROM stock_ledger sl
       JOIN optical_batches b ON sl.batch_id = b.id
       JOIN unique_items u ON b.unique_item_id = u.id
       JOIN categories c ON b.category_id = c.id
       LEFT JOIN users us ON sl.created_by = us.id
       WHERE ${whereClause}
       ORDER BY sl.created_at DESC, sl.id DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        id: r.id,
        batchId: r.batch_id,
        barcode: r.barcode,
        uniqueItemName: r.unique_item_name,
        sku: r.sku,
        categoryName: r.category_name,
        power: `SPH:${r.sph} CYL:${r.cyl} AXIS:${r.axis} ADD:${r.add} SIDE:${r.side}`,
        transactionType: r.transaction_type,
        documentType: r.document_type,
        documentNumber: r.document_number,
        documentId: r.document_id,
        quantityIn: parseFloat(r.quantity_in) || 0,
        quantityOut: parseFloat(r.quantity_out) || 0,
        balanceAfter: parseFloat(r.balance_after) || 0,
        notes: r.notes,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalRecords,
        totalPages: Math.ceil(totalRecords / limit) || 1,
      },
    };
  }

  /**
   * 3. PURCHASE REGISTER REPORT
   */
  static async getPurchaseReport(businessId: string, filters: DocumentReportFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['pi.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.partyId) {
      conditions.push(`pi.supplier_party_id = $${paramIndex}`);
      params.push(filters.partyId);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`pi.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.paymentStatus) {
      conditions.push(`pi.payment_status = $${paramIndex}`);
      params.push(filters.paymentStatus);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`pi.invoice_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`pi.invoice_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.search) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(`(pi.invoice_number ILIKE $${paramIndex} OR pi.supplier_invoice_number ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Summary calculations (only POSTED for financial totals unless specifically filtered)
    const summaryRes = await pool.query(
      `SELECT
         COUNT(pi.id) AS total_invoices,
         COALESCE(SUM(pi.subtotal), 0) AS total_subtotal,
         COALESCE(SUM(pi.discount_total), 0) AS total_discount,
         COALESCE(SUM(pi.taxable_amount), 0) AS total_taxable,
         COALESCE(SUM(pi.igst_amount), 0) AS total_igst,
         COALESCE(SUM(pi.cgst_amount), 0) AS total_cgst,
         COALESCE(SUM(pi.sgst_amount), 0) AS total_sgst,
         COALESCE(SUM(pi.igst_amount + pi.cgst_amount + pi.sgst_amount), 0) AS total_gst,
         COALESCE(SUM(pi.grand_total), 0) AS total_grand_total,
         COALESCE(SUM(pa_sub.paid_amount), 0) AS total_paid_amount,
         COALESCE(SUM(pi.grand_total - COALESCE(pa_sub.paid_amount, 0)), 0) AS total_outstanding
       FROM purchase_invoices pi
       JOIN parties p ON pi.supplier_party_id = p.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
         FROM payment_allocations pa
         JOIN payments pmt ON pmt.id = pa.payment_id
         WHERE pa.document_id = pi.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
       ) pa_sub ON true
       WHERE ${whereClause}`,
      params
    );

    const sRow = summaryRes.rows[0] || {};
    const totalInvoices = parseInt(sRow.total_invoices, 10) || 0;
    const summary = {
      totalInvoices,
      subtotal: parseFloat(sRow.total_subtotal) || 0,
      discountTotal: parseFloat(sRow.total_discount) || 0,
      taxableAmount: parseFloat(sRow.total_taxable) || 0,
      igst: parseFloat(sRow.total_igst) || 0,
      cgst: parseFloat(sRow.total_cgst) || 0,
      sgst: parseFloat(sRow.total_sgst) || 0,
      gstTotal: parseFloat(sRow.total_gst) || 0,
      grandTotal: parseFloat(sRow.total_grand_total) || 0,
      paidAmount: parseFloat(sRow.total_paid_amount) || 0,
      outstandingAmount: parseFloat(sRow.total_outstanding) || 0,
    };

    const dataRes = await pool.query(
      `SELECT
         pi.id,
         pi.invoice_number,
         pi.supplier_invoice_number,
         pi.invoice_date,
         (pi.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') AS due_date,
         pi.supplier_party_id AS party_id,
         p.name AS party_name,
         p.party_code,
         p.gstin,
         pi.subtotal,
         pi.discount_total,
         pi.taxable_amount,
         pi.igst_amount,
         pi.cgst_amount,
         pi.sgst_amount,
         (pi.igst_amount + pi.cgst_amount + pi.sgst_amount) AS total_tax,
         pi.grand_total,
         COALESCE(pa_sub.paid_amount, 0) AS paid_amount,
         (pi.grand_total - COALESCE(pa_sub.paid_amount, 0)) AS outstanding_balance,
         pi.status,
         pi.payment_status,
         pi.created_at
       FROM purchase_invoices pi
       JOIN parties p ON pi.supplier_party_id = p.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
         FROM payment_allocations pa
         JOIN payments pmt ON pmt.id = pa.payment_id
         WHERE pa.document_id = pi.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
       ) pa_sub ON true
       WHERE ${whereClause}
       ORDER BY pi.invoice_date DESC, pi.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        supplierInvoiceNumber: r.supplier_invoice_number,
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        partyId: r.party_id,
        partyName: r.party_name,
        partyCode: r.party_code,
        gstin: r.gstin,
        subtotal: parseFloat(r.subtotal) || 0,
        discountTotal: parseFloat(r.discount_total) || 0,
        taxableAmount: parseFloat(r.taxable_amount) || 0,
        igst: parseFloat(r.igst_amount) || 0,
        cgst: parseFloat(r.cgst_amount) || 0,
        sgst: parseFloat(r.sgst_amount) || 0,
        totalTax: parseFloat(r.total_tax) || 0,
        grandTotal: parseFloat(r.grand_total) || 0,
        paidAmount: parseFloat(r.paid_amount) || 0,
        outstandingBalance: parseFloat(r.outstanding_balance) || 0,
        status: r.status,
        paymentStatus: r.payment_status,
        createdAt: r.created_at,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalInvoices,
        totalPages: Math.ceil(totalInvoices / limit) || 1,
      },
    };
  }

  /**
   * 4. PURCHASE DETAIL (DRILL-DOWN) REPORT
   */
  static async getPurchaseDetailReport(businessId: string, filters: DocumentReportFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['pi.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.partyId) {
      conditions.push(`pi.supplier_party_id = $${paramIndex}`);
      params.push(filters.partyId);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`pi.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`pi.invoice_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`pi.invoice_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.search) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(`(pi.invoice_number ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex} OR b.barcode ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT
         COUNT(pil.id) AS total_lines,
         COALESCE(SUM(pil.quantity), 0) AS total_quantity,
         COALESCE(SUM(pil.total_amount), 0) AS total_amount
       FROM purchase_invoice_lines pil
       JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
       JOIN parties p ON pi.supplier_party_id = p.id
       JOIN unique_items u ON pil.unique_item_id = u.id
       LEFT JOIN optical_batches b ON pil.batch_id = b.id
       WHERE ${whereClause}`,
      params
    );

    const totalLines = parseInt(countRes.rows[0]?.total_lines, 10) || 0;
    const summary = {
      totalLines,
      totalQuantity: parseFloat(countRes.rows[0]?.total_quantity) || 0,
      totalAmount: parseFloat(countRes.rows[0]?.total_amount) || 0,
    };

    const dataRes = await pool.query(
      `SELECT
         pil.id AS line_id,
         pi.id AS invoice_id,
         pi.invoice_number,
         pi.invoice_date,
         p.name AS supplier_name,
         u.name AS unique_item_name,
         u.sku,
         b.barcode,
         b.sph,
         b.cyl,
         b.axis,
         b.add,
         b.side,
         pil.quantity,
         pil.unit_cost,
         pil.discount_percent,
         pil.tax_rate,
         pil.tax_amount,
         pil.total_amount,
         pi.status
       FROM purchase_invoice_lines pil
       JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
       JOIN parties p ON pi.supplier_party_id = p.id
       JOIN unique_items u ON pil.unique_item_id = u.id
       LEFT JOIN optical_batches b ON pil.batch_id = b.id
       WHERE ${whereClause}
       ORDER BY pi.invoice_date DESC, pil.id ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        lineId: r.line_id,
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        supplierName: r.supplier_name,
        uniqueItemName: r.unique_item_name,
        sku: r.sku,
        barcode: r.barcode,
        power: r.barcode ? `SPH:${r.sph} CYL:${r.cyl} AXIS:${r.axis} ADD:${r.add} SIDE:${r.side}` : 'N/A',
        quantity: parseFloat(r.quantity) || 0,
        unitCost: parseFloat(r.unit_cost) || 0,
        discountPercent: parseFloat(r.discount_percent) || 0,
        taxRate: parseFloat(r.tax_rate) || 0,
        taxAmount: parseFloat(r.tax_amount) || 0,
        totalAmount: parseFloat(r.total_amount) || 0,
        status: r.status,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalLines,
        totalPages: Math.ceil(totalLines / limit) || 1,
      },
    };
  }

  /**
   * 5. PURCHASE RETURN REPORT
   */
  static async getPurchaseReturnReport(businessId: string, filters: DocumentReportFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['pr.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.partyId) {
      conditions.push(`pr.supplier_party_id = $${paramIndex}`);
      params.push(filters.partyId);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`pr.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`pr.return_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`pr.return_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const summaryRes = await pool.query(
      `SELECT
         COUNT(pr.id) AS total_returns,
         COALESCE(SUM(pr.subtotal), 0) AS total_subtotal,
         COALESCE(SUM(pr.tax_amount), 0) AS total_tax,
         COALESCE(SUM(pr.grand_total), 0) AS total_grand_total
       FROM purchase_returns pr
       JOIN parties p ON pr.supplier_party_id = p.id
       WHERE ${whereClause}`,
      params
    );

    const totalReturns = parseInt(summaryRes.rows[0]?.total_returns, 10) || 0;
    const summary = {
      totalReturns,
      subtotal: parseFloat(summaryRes.rows[0]?.total_subtotal) || 0,
      taxAmount: parseFloat(summaryRes.rows[0]?.total_tax) || 0,
      grandTotal: parseFloat(summaryRes.rows[0]?.total_grand_total) || 0,
    };

    const dataRes = await pool.query(
      `SELECT
         pr.id,
         pr.return_number,
         pr.return_date,
         pr.supplier_party_id AS party_id,
         p.name AS party_name,
         pr.subtotal,
         pr.tax_amount,
         pr.grand_total,
         pr.reason,
         pr.status,
         pr.created_at
       FROM purchase_returns pr
       JOIN parties p ON pr.supplier_party_id = p.id
       WHERE ${whereClause}
       ORDER BY pr.return_date DESC, pr.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        id: r.id,
        returnNumber: r.return_number,
        returnDate: r.return_date,
        partyId: r.party_id,
        partyName: r.party_name,
        subtotal: parseFloat(r.subtotal) || 0,
        taxAmount: parseFloat(r.tax_amount) || 0,
        grandTotal: parseFloat(r.grand_total) || 0,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalReturns,
        totalPages: Math.ceil(totalReturns / limit) || 1,
      },
    };
  }

  /**
   * 6. SALES REGISTER REPORT
   */
  static async getSalesReport(businessId: string, filters: DocumentReportFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['si.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.partyId) {
      conditions.push(`si.party_id = $${paramIndex}`);
      params.push(filters.partyId);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`si.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.paymentStatus) {
      conditions.push(`si.payment_status = $${paramIndex}`);
      params.push(filters.paymentStatus);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`si.invoice_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`si.invoice_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.search) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(`(si.invoice_number ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex} OR p.mobile ILIKE $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const summaryRes = await pool.query(
      `SELECT
         COUNT(si.id) AS total_invoices,
         COALESCE(SUM(si.subtotal), 0) AS total_subtotal,
         COALESCE(SUM(si.discount_total), 0) AS total_discount,
         COALESCE(SUM(si.taxable_amount), 0) AS total_taxable,
         COALESCE(SUM(si.igst_amount), 0) AS total_igst,
         COALESCE(SUM(si.cgst_amount), 0) AS total_cgst,
         COALESCE(SUM(si.sgst_amount), 0) AS total_sgst,
         COALESCE(SUM(si.igst_amount + si.cgst_amount + si.sgst_amount), 0) AS total_gst,
         COALESCE(SUM(si.grand_total), 0) AS total_grand_total,
         COALESCE(SUM(pa_sub.paid_amount), 0) AS total_paid_amount,
         COALESCE(SUM(si.grand_total - COALESCE(pa_sub.paid_amount, 0)), 0) AS total_outstanding
       FROM sales_invoices si
       JOIN parties p ON si.party_id = p.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
         FROM payment_allocations pa
         JOIN payments pmt ON pmt.id = pa.payment_id
         WHERE pa.document_id = si.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
       ) pa_sub ON true
       WHERE ${whereClause}`,
      params
    );

    const sRow = summaryRes.rows[0] || {};
    const totalInvoices = parseInt(sRow.total_invoices, 10) || 0;
    const summary = {
      totalInvoices,
      subtotal: parseFloat(sRow.total_subtotal) || 0,
      discountTotal: parseFloat(sRow.total_discount) || 0,
      taxableAmount: parseFloat(sRow.total_taxable) || 0,
      igst: parseFloat(sRow.total_igst) || 0,
      cgst: parseFloat(sRow.total_cgst) || 0,
      sgst: parseFloat(sRow.total_sgst) || 0,
      gstTotal: parseFloat(sRow.total_gst) || 0,
      grandTotal: parseFloat(sRow.total_grand_total) || 0,
      paidAmount: parseFloat(sRow.total_paid_amount) || 0,
      outstandingAmount: parseFloat(sRow.total_outstanding) || 0,
    };

    const dataRes = await pool.query(
      `SELECT
         si.id,
         si.invoice_number,
         si.invoice_date,
         (si.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') AS due_date,
         si.party_id,
         p.name AS party_name,
         p.party_code,
         p.mobile,
         si.subtotal,
         si.discount_total,
         si.taxable_amount,
         si.igst_amount,
         si.cgst_amount,
         si.sgst_amount,
         (si.igst_amount + si.cgst_amount + si.sgst_amount) AS total_tax,
         si.grand_total,
         COALESCE(pa_sub.paid_amount, 0) AS paid_amount,
         (si.grand_total - COALESCE(pa_sub.paid_amount, 0)) AS outstanding_balance,
         si.status,
         si.payment_status,
         si.created_at
       FROM sales_invoices si
       JOIN parties p ON si.party_id = p.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
         FROM payment_allocations pa
         JOIN payments pmt ON pmt.id = pa.payment_id
         WHERE pa.document_id = si.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
       ) pa_sub ON true
       WHERE ${whereClause}
       ORDER BY si.invoice_date DESC, si.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        partyId: r.party_id,
        partyName: r.party_name,
        partyCode: r.party_code,
        mobile: r.mobile,
        subtotal: parseFloat(r.subtotal) || 0,
        discountTotal: parseFloat(r.discount_total) || 0,
        taxableAmount: parseFloat(r.taxable_amount) || 0,
        igst: parseFloat(r.igst_amount) || 0,
        cgst: parseFloat(r.cgst_amount) || 0,
        sgst: parseFloat(r.sgst_amount) || 0,
        totalTax: parseFloat(r.total_tax) || 0,
        grandTotal: parseFloat(r.grand_total) || 0,
        paidAmount: parseFloat(r.paid_amount) || 0,
        outstandingBalance: parseFloat(r.outstanding_balance) || 0,
        status: r.status,
        paymentStatus: r.payment_status,
        createdAt: r.created_at,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalInvoices,
        totalPages: Math.ceil(totalInvoices / limit) || 1,
      },
    };
  }

  /**
   * 7. SALES DETAIL (DRILL-DOWN) REPORT
   */
  static async getSalesDetailReport(businessId: string, filters: DocumentReportFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['si.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.partyId) {
      conditions.push(`si.party_id = $${paramIndex}`);
      params.push(filters.partyId);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`si.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`si.invoice_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`si.invoice_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.search) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(`(si.invoice_number ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex} OR b.barcode ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT
         COUNT(sil.id) AS total_lines,
         COALESCE(SUM(sil.quantity), 0) AS total_quantity,
         COALESCE(SUM(sil.total_amount), 0) AS total_amount
       FROM sales_invoice_lines sil
       JOIN sales_invoices si ON sil.sales_invoice_id = si.id
       JOIN parties p ON si.party_id = p.id
       JOIN unique_items u ON sil.unique_item_id = u.id
       LEFT JOIN optical_batches b ON sil.batch_id = b.id
       WHERE ${whereClause}`,
      params
    );

    const totalLines = parseInt(countRes.rows[0]?.total_lines, 10) || 0;
    const summary = {
      totalLines,
      totalQuantity: parseFloat(countRes.rows[0]?.total_quantity) || 0,
      totalAmount: parseFloat(countRes.rows[0]?.total_amount) || 0,
    };

    const dataRes = await pool.query(
      `SELECT
         sil.id AS line_id,
         si.id AS invoice_id,
         si.invoice_number,
         si.invoice_date,
         p.name AS customer_name,
         u.name AS unique_item_name,
         u.sku,
         b.barcode,
         b.sph,
         b.cyl,
         b.axis,
         b.add,
         b.side,
         sil.quantity,
         sil.unit_price,
         sil.discount_percent,
         sil.tax_rate,
         sil.tax_amount,
         sil.total_amount,
         si.status
       FROM sales_invoice_lines sil
       JOIN sales_invoices si ON sil.sales_invoice_id = si.id
       JOIN parties p ON si.party_id = p.id
       JOIN unique_items u ON sil.unique_item_id = u.id
       LEFT JOIN optical_batches b ON sil.batch_id = b.id
       WHERE ${whereClause}
       ORDER BY si.invoice_date DESC, sil.id ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        lineId: r.line_id,
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        customerName: r.customer_name,
        uniqueItemName: r.unique_item_name,
        sku: r.sku,
        barcode: r.barcode,
        power: r.barcode ? `SPH:${r.sph} CYL:${r.cyl} AXIS:${r.axis} ADD:${r.add} SIDE:${r.side}` : 'N/A',
        quantity: parseFloat(r.quantity) || 0,
        unitPrice: parseFloat(r.unit_price) || 0,
        discountPercent: parseFloat(r.discount_percent) || 0,
        taxRate: parseFloat(r.tax_rate) || 0,
        taxAmount: parseFloat(r.tax_amount) || 0,
        totalAmount: parseFloat(r.total_amount) || 0,
        status: r.status,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalLines,
        totalPages: Math.ceil(totalLines / limit) || 1,
      },
    };
  }

  /**
   * 8. SALES RETURN REPORT
   */
  static async getSalesReturnReport(businessId: string, filters: DocumentReportFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['sr.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.partyId) {
      conditions.push(`sr.party_id = $${paramIndex}`);
      params.push(filters.partyId);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`sr.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`sr.return_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`sr.return_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const summaryRes = await pool.query(
      `SELECT
         COUNT(sr.id) AS total_returns,
         COALESCE(SUM(sr.subtotal), 0) AS total_subtotal,
         COALESCE(SUM(sr.tax_amount), 0) AS total_tax,
         COALESCE(SUM(sr.grand_total), 0) AS total_grand_total
       FROM sales_returns sr
       JOIN parties p ON sr.party_id = p.id
       WHERE ${whereClause}`,
      params
    );

    const totalReturns = parseInt(summaryRes.rows[0]?.total_returns, 10) || 0;
    const summary = {
      totalReturns,
      subtotal: parseFloat(summaryRes.rows[0]?.total_subtotal) || 0,
      taxAmount: parseFloat(summaryRes.rows[0]?.total_tax) || 0,
      grandTotal: parseFloat(summaryRes.rows[0]?.total_grand_total) || 0,
    };

    const dataRes = await pool.query(
      `SELECT
         sr.id,
         sr.return_number,
         sr.return_date,
         sr.party_id,
         p.name AS party_name,
         sr.subtotal,
         sr.tax_amount,
         sr.grand_total,
         sr.reason,
         sr.status,
         sr.created_at
       FROM sales_returns sr
       JOIN parties p ON sr.party_id = p.id
       WHERE ${whereClause}
       ORDER BY sr.return_date DESC, sr.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        id: r.id,
        returnNumber: r.return_number,
        returnDate: r.return_date,
        partyId: r.party_id,
        partyName: r.party_name,
        subtotal: parseFloat(r.subtotal) || 0,
        taxAmount: parseFloat(r.tax_amount) || 0,
        grandTotal: parseFloat(r.grand_total) || 0,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalReturns,
        totalPages: Math.ceil(totalReturns / limit) || 1,
      },
    };
  }

  /**
   * 9. CUSTOMER / SUPPLIER OUTSTANDING AGING REPORT
   */
  static async getOutstandingReport(
    businessId: string,
    partyType: 'CUSTOMER' | 'SUPPLIER',
    filters: PaginationParams & { search?: string }
  ) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const isCustomer = partyType === 'CUSTOMER';
    const ledgerTable = isCustomer ? 'customer_ledgers' : 'supplier_ledgers';
    const invoiceTable = isCustomer ? 'sales_invoices' : 'purchase_invoices';
    const returnTable = isCustomer ? 'sales_returns' : 'purchase_returns';

    const conditions: string[] = ['p.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (isCustomer) {
      conditions.push(`p.party_type IN ('CUSTOMER', 'BOTH')`);
    } else {
      conditions.push(`p.party_type IN ('SUPPLIER', 'BOTH')`);
    }

    if (filters.search) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(`(p.name ILIKE $${paramIndex} OR p.party_code ILIKE $${paramIndex} OR p.mobile ILIKE $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(p.id) AS total_parties
       FROM parties p
       WHERE ${whereClause}`,
      params
    );
    const totalParties = parseInt(countRes.rows[0]?.total_parties, 10) || 0;

    const dataRes = await pool.query(
      `SELECT
         p.id AS party_id,
         p.name AS party_name,
         p.party_code,
         p.mobile,
         p.credit_days,
         COALESCE((
           SELECT balance
           FROM ${ledgerTable} l
           WHERE l.party_id = p.id AND l.business_id = $1
           ORDER BY l.created_at DESC
           LIMIT 1
         ), 0) AS current_balance,
         COALESCE((
           SELECT SUM(grand_total)
           FROM ${invoiceTable} inv
           WHERE (CASE WHEN '${invoiceTable}' = 'purchase_invoices' THEN inv.supplier_party_id ELSE inv.party_id END) = p.id AND inv.business_id = $1 AND inv.status = 'POSTED'
         ), 0) AS total_invoiced,
         COALESCE((
           SELECT SUM(grand_total)
           FROM ${returnTable} ret
           WHERE (CASE WHEN '${returnTable}' = 'purchase_returns' THEN ret.supplier_party_id ELSE ret.party_id END) = p.id AND ret.business_id = $1 AND ret.status = 'POSTED'
         ), 0) AS total_returned,
         COALESCE((
           SELECT SUM(CASE
             WHEN (inv.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') < CURRENT_DATE
             THEN (inv.grand_total - COALESCE(pa_sub.paid_amount, 0))
             ELSE 0
           END)
           FROM ${invoiceTable} inv
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
             FROM payment_allocations pa
             JOIN payments pmt ON pmt.id = pa.payment_id
             WHERE pa.document_id = inv.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
           ) pa_sub ON true
           WHERE (CASE WHEN '${invoiceTable}' = 'purchase_invoices' THEN inv.supplier_party_id ELSE inv.party_id END) = p.id AND inv.business_id = $1 AND inv.status = 'POSTED' AND (inv.grand_total - COALESCE(pa_sub.paid_amount, 0)) > 0
         ), 0) AS overdue_balance
       FROM parties p
       WHERE ${whereClause}
       ORDER BY current_balance DESC, p.name ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    // Calculate summary of total outstanding
    const sumRes = await pool.query(
      `SELECT
         COALESCE(SUM(sub.balance), 0) AS total_outstanding
       FROM (
         SELECT DISTINCT ON (party_id) balance
         FROM ${ledgerTable}
         WHERE business_id = $1
         ORDER BY party_id, created_at DESC
       ) sub
       WHERE sub.balance > 0`,
      [businessId]
    );

    return {
      data: dataRes.rows.map(r => ({
        partyId: r.party_id,
        partyName: r.party_name,
        partyCode: r.party_code,
        mobile: r.mobile,
        creditDays: parseInt(r.credit_days, 10) || 0,
        totalInvoiced: parseFloat(r.total_invoiced) || 0,
        totalReturned: parseFloat(r.total_returned) || 0,
        currentBalance: parseFloat(r.current_balance) || 0,
        overdueBalance: parseFloat(r.overdue_balance) || 0,
      })),
      summary: {
        totalParties,
        totalOutstanding: parseFloat(sumRes.rows[0]?.total_outstanding) || 0,
      },
      pagination: {
        page,
        limit,
        totalItems: totalParties,
        totalPages: Math.ceil(totalParties / limit) || 1,
      },
    };
  }

  /**
   * 10. PARTY STATEMENT REPORT (Live Running Ledger)
   */
  static async getPartyStatement(
    businessId: string,
    partyId: string,
    partyType: 'CUSTOMER' | 'SUPPLIER',
    startDate?: string,
    endDate?: string
  ) {
    const isCustomer = partyType === 'CUSTOMER';
    const ledgerTable = isCustomer ? 'customer_ledgers' : 'supplier_ledgers';

    // 1. Fetch party info
    const partyRes = await pool.query(
      `SELECT id, party_code, name, display_name, party_type, mobile, email, gstin, address_line1, city, state, credit_days
       FROM parties
       WHERE id = $1 AND business_id = $2`,
      [partyId, businessId]
    );

    if (partyRes.rows.length === 0) {
      throw new Error('Party not found');
    }
    const party = partyRes.rows[0];

    // 2. Opening balance as of startDate
    let openingBalance = 0;
    if (startDate) {
      const obRes = await pool.query(
        `SELECT balance
         FROM ${ledgerTable}
         WHERE business_id = $1 AND party_id = $2 AND created_at < $3::date
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [businessId, partyId, startDate]
      );
      if (obRes.rows.length > 0) {
        openingBalance = parseFloat(obRes.rows[0].balance) || 0;
      }
    }

    // 3. Transactions within date range
    const conditions: string[] = ['l.business_id = $1', 'l.party_id = $2'];
    const params: any[] = [businessId, partyId];
    let paramIndex = 3;

    if (startDate) {
      conditions.push(`l.created_at >= $${paramIndex}::date`);
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      conditions.push(`l.created_at <= ($${paramIndex}::date + INTERVAL '1 day')`);
      params.push(endDate);
      paramIndex++;
    }

    const txRes = await pool.query(
      `SELECT
         l.id,
         l.transaction_type,
         l.document_type,
         l.document_id,
         l.document_number,
         l.debit,
         l.credit,
         l.balance,
         l.notes,
         l.created_at
       FROM ${ledgerTable} l
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.created_at ASC, l.id ASC`,
      params
    );

    let totalDebit = 0;
    let totalCredit = 0;

    const entries = txRes.rows.map(r => {
      const debit = parseFloat(r.debit) || 0;
      const credit = parseFloat(r.credit) || 0;
      totalDebit += debit;
      totalCredit += credit;

      return {
        id: r.id,
        transactionType: r.transaction_type,
        documentType: r.document_type,
        documentId: r.document_id,
        documentNumber: r.document_number,
        debit,
        credit,
        balance: parseFloat(r.balance) || 0,
        notes: r.notes,
        createdAt: r.created_at,
      };
    });

    const closingBalance = entries.length > 0 ? entries[entries.length - 1].balance : openingBalance;

    return {
      party: {
        id: party.id,
        partyCode: party.party_code,
        name: party.name,
        displayName: party.display_name,
        partyType: party.party_type,
        mobile: party.mobile,
        email: party.email,
        gstin: party.gstin,
        address: `${party.address_line1 || ''}, ${party.city || ''} ${party.state || ''}`.trim(),
        creditDays: parseInt(party.credit_days, 10) || 0,
      },
      startDate: startDate || null,
      endDate: endDate || null,
      openingBalance,
      totalDebit,
      totalCredit,
      closingBalance,
      entries,
    };
  }

  /**
   * 11. PAYMENT & SETTLEMENTS REPORT
   */
  static async getPaymentReport(
    businessId: string,
    filters: PaginationParams & {
      paymentType?: string;
      paymentMode?: string;
      partyId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      search?: string;
    }
  ) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['pm.business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.paymentType) {
      conditions.push(`pm.payment_type = $${paramIndex}`);
      params.push(filters.paymentType);
      paramIndex++;
    }
    if (filters.paymentMode) {
      conditions.push(`pm.payment_mode = $${paramIndex}`);
      params.push(filters.paymentMode);
      paramIndex++;
    }
    if (filters.partyId) {
      conditions.push(`pm.party_id = $${paramIndex}`);
      params.push(filters.partyId);
      paramIndex++;
    }
    if (filters.status) {
      conditions.push(`pm.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`pm.payment_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`pm.payment_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }
    if (filters.search) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(`(pm.payment_number ILIKE $${paramIndex} OR pm.reference_number ILIKE $${paramIndex} OR p.name ILIKE $${paramIndex})`);
      params.push(q);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // 1. Overall Summary
    const summaryRes = await pool.query(
      `SELECT
         COUNT(pm.id) AS total_payments,
         COALESCE(SUM(pm.amount), 0) AS total_amount,
         COALESCE(SUM(pm.allocated_amount), 0) AS total_allocated,
         COALESCE(SUM(pm.unallocated_amount), 0) AS total_unallocated,
         COALESCE(SUM(pm.amount) FILTER (WHERE pm.payment_type = 'RECEIPT'), 0) AS total_receipts,
         COALESCE(SUM(pm.amount) FILTER (WHERE pm.payment_type = 'SUPPLIER_PAYMENT'), 0) AS total_supplier_payments
       FROM payments pm
       JOIN parties p ON pm.party_id = p.id
       WHERE ${whereClause}`,
      params
    );

    // 2. Payment Mode Breakdown
    const modeRes = await pool.query(
      `SELECT
         pm.payment_mode,
         COUNT(pm.id) AS count,
         COALESCE(SUM(pm.amount), 0) AS total_amount
       FROM payments pm
       WHERE ${whereClause}
       GROUP BY pm.payment_mode
       ORDER BY total_amount DESC`,
      params
    );

    const sRow = summaryRes.rows[0] || {};
    const totalPayments = parseInt(sRow.total_payments, 10) || 0;

    const summary = {
      totalPayments,
      totalAmount: parseFloat(sRow.total_amount) || 0,
      totalAllocated: parseFloat(sRow.total_allocated) || 0,
      totalUnallocated: parseFloat(sRow.total_unallocated) || 0,
      totalReceipts: parseFloat(sRow.total_receipts) || 0,
      totalSupplierPayments: parseFloat(sRow.total_supplier_payments) || 0,
      modeBreakdown: modeRes.rows.map(r => ({
        mode: r.payment_mode,
        count: parseInt(r.count, 10),
        amount: parseFloat(r.total_amount) || 0,
      })),
    };

    const dataRes = await pool.query(
      `SELECT
         pm.id,
         pm.payment_number,
         pm.payment_date,
         pm.payment_type,
         pm.payment_mode,
         pm.reference_number,
         pm.party_id,
         p.name AS party_name,
         p.party_code,
         pm.amount,
         pm.allocated_amount,
         pm.unallocated_amount,
         pm.status,
         pm.notes,
         pm.created_at
       FROM payments pm
       JOIN parties p ON pm.party_id = p.id
       WHERE ${whereClause}
       ORDER BY pm.payment_date DESC, pm.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        id: r.id,
        paymentNumber: r.payment_number,
        paymentDate: r.payment_date,
        paymentType: r.payment_type,
        paymentMode: r.payment_mode,
        referenceNumber: r.reference_number,
        partyId: r.party_id,
        partyName: r.party_name,
        partyCode: r.party_code,
        amount: parseFloat(r.amount) || 0,
        allocatedAmount: parseFloat(r.allocated_amount) || 0,
        unallocatedAmount: parseFloat(r.unallocated_amount) || 0,
        status: r.status,
        notes: r.notes,
        createdAt: r.created_at,
      })),
      summary,
      pagination: {
        page,
        limit,
        totalItems: totalPayments,
        totalPages: Math.ceil(totalPayments / limit) || 1,
      },
    };
  }

  /**
   * 12. PRODUCT SALES ANALYTICS REPORT
   */
  static async getProductSalesReport(
    businessId: string,
    filters: PaginationParams & { categoryId?: string; startDate?: string; endDate?: string }
  ) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['si.business_id = $1', "si.status = 'POSTED'"];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.categoryId) {
      conditions.push(`p.category_id = $${paramIndex}`);
      params.push(filters.categoryId);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`si.invoice_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`si.invoice_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT u.id) AS total_products
       FROM sales_invoice_lines sil
       JOIN sales_invoices si ON sil.sales_invoice_id = si.id
       JOIN unique_items u ON sil.unique_item_id = u.id
       JOIN primary_items p ON u.primary_item_id = p.id
       WHERE ${whereClause}`,
      params
    );
    const totalProducts = parseInt(countRes.rows[0]?.total_products, 10) || 0;

    const dataRes = await pool.query(
      `SELECT
         u.id AS unique_item_id,
         u.name AS unique_item_name,
         u.sku,
         c.name AS category_name,
         p.name AS brand_name,
         COUNT(DISTINCT si.id) AS invoice_count,
         COALESCE(SUM(sil.quantity), 0) AS total_quantity_sold,
         COALESCE(SUM(sil.total_amount), 0) AS total_sales_amount
       FROM sales_invoice_lines sil
       JOIN sales_invoices si ON sil.sales_invoice_id = si.id
       JOIN unique_items u ON sil.unique_item_id = u.id
       JOIN primary_items p ON u.primary_item_id = p.id
       JOIN categories c ON p.category_id = c.id
       WHERE ${whereClause}
       GROUP BY u.id, u.name, u.sku, c.name, p.name
       ORDER BY total_sales_amount DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        uniqueItemId: r.unique_item_id,
        uniqueItemName: r.unique_item_name,
        sku: r.sku,
        categoryName: r.category_name,
        brandName: r.brand_name,
        invoiceCount: parseInt(r.invoice_count, 10) || 0,
        totalQuantitySold: parseFloat(r.total_quantity_sold) || 0,
        totalSalesAmount: parseFloat(r.total_sales_amount) || 0,
      })),
      pagination: {
        page,
        limit,
        totalItems: totalProducts,
        totalPages: Math.ceil(totalProducts / limit) || 1,
      },
    };
  }

  /**
   * 13. OPTICAL POWER SALES REPORT
   */
  static async getOpticalPowerSalesReport(
    businessId: string,
    filters: PaginationParams & { uniqueItemId?: string; startDate?: string; endDate?: string }
  ) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['si.business_id = $1', "si.status = 'POSTED'", 'b.id IS NOT NULL'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (filters.uniqueItemId) {
      conditions.push(`b.unique_item_id = $${paramIndex}`);
      params.push(filters.uniqueItemId);
      paramIndex++;
    }
    if (filters.startDate) {
      conditions.push(`si.invoice_date >= $${paramIndex}::date`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`si.invoice_date <= $${paramIndex}::date`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT CONCAT(b.sph, ':', b.cyl, ':', b.axis, ':', b.add, ':', b.side, ':', b.unique_item_id)) AS total_powers
       FROM sales_invoice_lines sil
       JOIN sales_invoices si ON sil.sales_invoice_id = si.id
       JOIN optical_batches b ON sil.batch_id = b.id
       WHERE ${whereClause}`,
      params
    );
    const totalPowers = parseInt(countRes.rows[0]?.total_powers, 10) || 0;

    const dataRes = await pool.query(
      `SELECT
         u.name AS unique_item_name,
         u.sku,
         b.sph,
         b.cyl,
         b.axis,
         b.add,
         b.side,
         COALESCE(SUM(sil.quantity), 0) AS total_quantity_sold,
         COALESCE(SUM(sil.total_amount), 0) AS total_sales_amount
       FROM sales_invoice_lines sil
       JOIN sales_invoices si ON sil.sales_invoice_id = si.id
       JOIN optical_batches b ON sil.batch_id = b.id
       JOIN unique_items u ON b.unique_item_id = u.id
       WHERE ${whereClause}
       GROUP BY u.name, u.sku, b.sph, b.cyl, b.axis, b.add, b.side
       ORDER BY total_quantity_sold DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map(r => ({
        uniqueItemName: r.unique_item_name,
        sku: r.sku,
        sph: parseFloat(r.sph) || 0,
        cyl: parseFloat(r.cyl) || 0,
        axis: parseFloat(r.axis) || 0,
        add: parseFloat(r.add) || 0,
        side: r.side,
        powerString: `SPH:${r.sph} CYL:${r.cyl} AXIS:${r.axis} ADD:${r.add} SIDE:${r.side}`,
        totalQuantitySold: parseFloat(r.total_quantity_sold) || 0,
        totalSalesAmount: parseFloat(r.total_sales_amount) || 0,
      })),
      pagination: {
        page,
        limit,
        totalItems: totalPowers,
        totalPages: Math.ceil(totalPowers / limit) || 1,
      },
    };
  }
}
