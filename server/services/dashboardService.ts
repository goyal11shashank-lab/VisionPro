import { pool } from '../db/index.js';
import { BusinessSettingsService } from './businessSettingsService.js';

export interface DashboardFilterOptions {
  startDate?: string;
  endDate?: string;
}

export class DashboardService {
  /**
   * Fetch complete live operational dashboard data strictly scoped to businessId.
   */
  static async getDashboardData(
    businessId: string,
    userPermissions: string[] = [],
    isSuperAdmin: boolean = false
  ) {
    const hasSalesPerm = isSuperAdmin || userPermissions.some(p => p.startsWith('sales') || p.includes('sales'));
    const hasPurchasePerm = isSuperAdmin || userPermissions.some(p => p.startsWith('purchase') || p.includes('purchase'));
    const hasInventoryPerm = isSuperAdmin || userPermissions.some(p => p.startsWith('inventory') || p.includes('inventory') || p.startsWith('master'));
    const hasAccountsPerm = isSuperAdmin || userPermissions.some(p => p.startsWith('accounts') || p.startsWith('payment') || p.includes('payment') || p.includes('outstanding'));

    // 1. Fetch business settings (e.g. low stock threshold)
    const settings = await BusinessSettingsService.getSettings(businessId);
    const lowStockThreshold = settings.lowStockThreshold;

    // 2. LIVE STOCK METRICS
    let stockKPIs = {
      totalPhysicalStock: 0,
      totalReservedStock: 0,
      totalAvailableStock: 0,
      totalBatches: 0,
      inStockBatches: 0,
      zeroStockBatches: 0,
      negativeStockBatches: 0,
      reservedBatches: 0,
      lowStockBatches: 0,
      lowStockThreshold,
    };

    let stockByCategory: Array<{
      categoryCode: string;
      categoryName: string;
      batchCount: number;
      physicalStock: number;
      reservedStock: number;
      availableStock: number;
    }> = [];

    if (hasInventoryPerm) {
      const stockRes = await pool.query(
        `SELECT 
           COUNT(b.id) AS total_batches,
           COALESCE(SUM(COALESCE(s.physical_stock, 0)), 0) AS total_physical,
           COALESCE(SUM(COALESCE(s.reserved_stock, 0)), 0) AS total_reserved,
           COALESCE(SUM(COALESCE(s.available_stock, 0)), 0) AS total_available,
           COUNT(b.id) FILTER (WHERE COALESCE(s.physical_stock, 0) > 0) AS in_stock_count,
           COUNT(b.id) FILTER (WHERE COALESCE(s.physical_stock, 0) = 0) AS zero_stock_count,
           COUNT(b.id) FILTER (WHERE COALESCE(s.physical_stock, 0) < 0) AS negative_stock_count,
           COUNT(b.id) FILTER (WHERE COALESCE(s.reserved_stock, 0) > 0) AS reserved_count,
           COUNT(b.id) FILTER (WHERE COALESCE(s.physical_stock, 0) > 0 AND COALESCE(s.physical_stock, 0) <= $2) AS low_stock_count
         FROM optical_batches b
         LEFT JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
         WHERE b.business_id = $1`,
        [businessId, lowStockThreshold]
      );

      if (stockRes.rows.length > 0) {
        const r = stockRes.rows[0];
        stockKPIs = {
          totalPhysicalStock: parseFloat(r.total_physical) || 0,
          totalReservedStock: parseFloat(r.total_reserved) || 0,
          totalAvailableStock: parseFloat(r.total_available) || 0,
          totalBatches: parseInt(r.total_batches, 10) || 0,
          inStockBatches: parseInt(r.in_stock_count, 10) || 0,
          zeroStockBatches: parseInt(r.zero_stock_count, 10) || 0,
          negativeStockBatches: parseInt(r.negative_stock_count, 10) || 0,
          reservedBatches: parseInt(r.reserved_count, 10) || 0,
          lowStockBatches: parseInt(r.low_stock_count, 10) || 0,
          lowStockThreshold,
        };
      }

      const catRes = await pool.query(
        `SELECT 
           c.code AS category_code,
           c.name AS category_name,
           COUNT(b.id) AS batch_count,
           COALESCE(SUM(COALESCE(s.physical_stock, 0)), 0) AS physical_stock,
           COALESCE(SUM(COALESCE(s.reserved_stock, 0)), 0) AS reserved_stock,
           COALESCE(SUM(COALESCE(s.available_stock, 0)), 0) AS available_stock
         FROM optical_batches b
         JOIN categories c ON b.category_id = c.id
         LEFT JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
         WHERE b.business_id = $1
         GROUP BY c.code, c.name
         ORDER BY c.code ASC`,
        [businessId]
      );

      stockByCategory = catRes.rows.map(r => ({
        categoryCode: r.category_code,
        categoryName: r.category_name,
        batchCount: parseInt(r.batch_count, 10),
        physicalStock: parseFloat(r.physical_stock) || 0,
        reservedStock: parseFloat(r.reserved_stock) || 0,
        availableStock: parseFloat(r.available_stock) || 0,
      }));
    }

    // 3. TODAY'S FINANCIAL METRICS
    let todaysSales = { count: 0, gross: 0, net: 0, returnsCount: 0, returnsAmount: 0, netAfterReturns: 0 };
    let todaysPurchases = { count: 0, gross: 0, net: 0, returnsCount: 0, returnsAmount: 0, netAfterReturns: 0 };
    let todaysReceipts = { count: 0, amount: 0 };
    let todaysSupplierPayments = { count: 0, amount: 0 };

    if (hasSalesPerm) {
      // Sales today (POSTED only)
      const salesTodayRes = await pool.query(
        `SELECT 
           COUNT(id) AS count,
           COALESCE(SUM(subtotal), 0) AS gross,
           COALESCE(SUM(grand_total), 0) AS net
         FROM sales_invoices
         WHERE business_id = $1 AND status = 'POSTED' AND invoice_date = CURRENT_DATE`,
        [businessId]
      );
      const salesReturnTodayRes = await pool.query(
        `SELECT 
           COUNT(id) AS count,
           COALESCE(SUM(grand_total), 0) AS total
         FROM sales_returns
         WHERE business_id = $1 AND status = 'POSTED' AND return_date = CURRENT_DATE`,
        [businessId]
      );

      const sRow = salesTodayRes.rows[0] || {};
      const srRow = salesReturnTodayRes.rows[0] || {};
      const sNet = parseFloat(sRow.net) || 0;
      const srTotal = parseFloat(srRow.total) || 0;

      todaysSales = {
        count: parseInt(sRow.count, 10) || 0,
        gross: parseFloat(sRow.gross) || 0,
        net: sNet,
        returnsCount: parseInt(srRow.count, 10) || 0,
        returnsAmount: srTotal,
        netAfterReturns: Math.round((sNet - srTotal + Number.EPSILON) * 100) / 100,
      };
    }

    if (hasPurchasePerm) {
      // Purchases today (POSTED only)
      const purchaseTodayRes = await pool.query(
        `SELECT 
           COUNT(id) AS count,
           COALESCE(SUM(subtotal), 0) AS gross,
           COALESCE(SUM(grand_total), 0) AS net
         FROM purchase_invoices
         WHERE business_id = $1 AND status = 'POSTED' AND invoice_date = CURRENT_DATE`,
        [businessId]
      );
      const purchaseReturnTodayRes = await pool.query(
        `SELECT 
           COUNT(id) AS count,
           COALESCE(SUM(grand_total), 0) AS total
         FROM purchase_returns
         WHERE business_id = $1 AND status = 'POSTED' AND return_date = CURRENT_DATE`,
        [businessId]
      );

      const pRow = purchaseTodayRes.rows[0] || {};
      const prRow = purchaseReturnTodayRes.rows[0] || {};
      const pNet = parseFloat(pRow.net) || 0;
      const prTotal = parseFloat(prRow.total) || 0;

      todaysPurchases = {
        count: parseInt(pRow.count, 10) || 0,
        gross: parseFloat(pRow.gross) || 0,
        net: pNet,
        returnsCount: parseInt(prRow.count, 10) || 0,
        returnsAmount: prTotal,
        netAfterReturns: Math.round((pNet - prTotal + Number.EPSILON) * 100) / 100,
      };
    }

    if (hasAccountsPerm) {
      // Receipts & Supplier payments today (POSTED only)
      const paymentsTodayRes = await pool.query(
        `SELECT 
           payment_type,
           COUNT(id) AS count,
           COALESCE(SUM(amount), 0) AS total_amount
         FROM payments
         WHERE business_id = $1 AND status = 'POSTED' AND payment_date = CURRENT_DATE
         GROUP BY payment_type`,
        [businessId]
      );

      for (const row of paymentsTodayRes.rows) {
        if (row.payment_type === 'RECEIPT') {
          todaysReceipts = {
            count: parseInt(row.count, 10) || 0,
            amount: parseFloat(row.total_amount) || 0,
          };
        } else if (row.payment_type === 'SUPPLIER_PAYMENT') {
          todaysSupplierPayments = {
            count: parseInt(row.count, 10) || 0,
            amount: parseFloat(row.total_amount) || 0,
          };
        }
      }
    }

    // 4. CURRENT OUTSTANDING SUMMARY
    let outstandingSummary = {
      customerOutstanding: 0,
      supplierOutstanding: 0,
      totalReceivables: 0,
      totalPayables: 0,
      customerOverdue: 0,
      customerCurrent: 0,
      supplierOverdue: 0,
      supplierCurrent: 0,
    };

    if (hasAccountsPerm) {
      // Fetch latest customer ledger balances
      const custOutRes = await pool.query(
        `SELECT COALESCE(SUM(sub.balance), 0) AS total_balance
         FROM (
           SELECT DISTINCT ON (party_id) balance 
           FROM customer_ledgers 
           WHERE business_id = $1 
           ORDER BY party_id, created_at DESC
         ) sub
         WHERE sub.balance > 0`,
        [businessId]
      );
      const custOut = parseFloat(custOutRes.rows[0]?.total_balance) || 0;

      // Fetch latest supplier ledger balances
      const suppOutRes = await pool.query(
        `SELECT COALESCE(SUM(sub.balance), 0) AS total_balance
         FROM (
           SELECT DISTINCT ON (party_id) balance 
           FROM supplier_ledgers 
           WHERE business_id = $1 
           ORDER BY party_id, created_at DESC
         ) sub
         WHERE sub.balance > 0`,
        [businessId]
      );
      const suppOut = parseFloat(suppOutRes.rows[0]?.total_balance) || 0;

      // Overdue vs Current for customer invoices
      const custAgingRes = await pool.query(
        `SELECT 
           COALESCE(SUM(CASE 
             WHEN (si.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') < CURRENT_DATE 
             THEN (si.grand_total - COALESCE(pa_sub.paid_amount, 0)) 
             ELSE 0 
           END), 0) AS overdue_amount,
           COALESCE(SUM(CASE 
             WHEN (si.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') >= CURRENT_DATE 
             THEN (si.grand_total - COALESCE(pa_sub.paid_amount, 0)) 
             ELSE 0 
           END), 0) AS current_amount
         FROM sales_invoices si
         JOIN parties p ON si.party_id = p.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
           FROM payment_allocations pa
           JOIN payments pmt ON pmt.id = pa.payment_id
           WHERE pa.document_id = si.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
         ) pa_sub ON true
         WHERE si.business_id = $1 
           AND si.status = 'POSTED' 
           AND (si.grand_total - COALESCE(pa_sub.paid_amount, 0)) > 0`,
        [businessId]
      );

      // Overdue vs Current for supplier invoices
      const suppAgingRes = await pool.query(
        `SELECT 
           COALESCE(SUM(CASE 
             WHEN (pi.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') < CURRENT_DATE 
             THEN (pi.grand_total - COALESCE(pa_sub.paid_amount, 0)) 
             ELSE 0 
           END), 0) AS overdue_amount,
           COALESCE(SUM(CASE 
             WHEN (pi.invoice_date + COALESCE(NULLIF(regexp_replace(p.credit_days, '[^0-9]', '', 'g'), '')::integer, 0) * INTERVAL '1 day') >= CURRENT_DATE 
             THEN (pi.grand_total - COALESCE(pa_sub.paid_amount, 0)) 
             ELSE 0 
           END), 0) AS current_amount
         FROM purchase_invoices pi
         JOIN parties p ON pi.supplier_party_id = p.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(pa.allocated_amount), 0) AS paid_amount
           FROM payment_allocations pa
           JOIN payments pmt ON pmt.id = pa.payment_id
           WHERE pa.document_id = pi.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
         ) pa_sub ON true
         WHERE pi.business_id = $1 
           AND pi.status = 'POSTED' 
           AND (pi.grand_total - COALESCE(pa_sub.paid_amount, 0)) > 0`,
        [businessId]
      );

      const ca = custAgingRes.rows[0] || {};
      const sa = suppAgingRes.rows[0] || {};

      outstandingSummary = {
        customerOutstanding: custOut,
        supplierOutstanding: suppOut,
        totalReceivables: custOut,
        totalPayables: suppOut,
        customerOverdue: parseFloat(ca.overdue_amount) || 0,
        customerCurrent: parseFloat(ca.current_amount) || 0,
        supplierOverdue: parseFloat(sa.overdue_amount) || 0,
        supplierCurrent: parseFloat(sa.current_amount) || 0,
      };
    }

    // 5. SALES SUMMARIES: Today, This Week, This Month
    let salesSummary = {
      today: { invoiceCount: 0, grossSales: 0, discount: 0, taxableSales: 0, gst: 0, netSales: 0, salesReturns: 0, netSalesAfterReturns: 0 },
      thisWeek: { invoiceCount: 0, grossSales: 0, discount: 0, taxableSales: 0, gst: 0, netSales: 0, salesReturns: 0, netSalesAfterReturns: 0 },
      thisMonth: { invoiceCount: 0, grossSales: 0, discount: 0, taxableSales: 0, gst: 0, netSales: 0, salesReturns: 0, netSalesAfterReturns: 0 },
    };

    if (hasSalesPerm) {
      const fetchSalesPeriod = async (dateFilterSql: string, returnDateFilterSql: string) => {
        const invRes = await pool.query(
          `SELECT 
             COUNT(id) AS count,
             COALESCE(SUM(subtotal), 0) AS gross,
             COALESCE(SUM(discount_total), 0) AS discount,
             COALESCE(SUM(taxable_amount), 0) AS taxable,
             COALESCE(SUM(igst_amount + cgst_amount + sgst_amount), 0) AS gst,
             COALESCE(SUM(grand_total), 0) AS net
           FROM sales_invoices
           WHERE business_id = $1 AND status = 'POSTED' AND ${dateFilterSql}`,
          [businessId]
        );
        const retRes = await pool.query(
          `SELECT COALESCE(SUM(grand_total), 0) AS total_return
           FROM sales_returns
           WHERE business_id = $1 AND status = 'POSTED' AND ${returnDateFilterSql}`,
          [businessId]
        );

        const r = invRes.rows[0] || {};
        const net = parseFloat(r.net) || 0;
        const returns = parseFloat(retRes.rows[0]?.total_return) || 0;

        return {
          invoiceCount: parseInt(r.count, 10) || 0,
          grossSales: parseFloat(r.gross) || 0,
          discount: parseFloat(r.discount) || 0,
          taxableSales: parseFloat(r.taxable) || 0,
          gst: parseFloat(r.gst) || 0,
          netSales: net,
          salesReturns: returns,
          netSalesAfterReturns: Math.round((net - returns + Number.EPSILON) * 100) / 100,
        };
      };

      salesSummary = {
        today: await fetchSalesPeriod('invoice_date = CURRENT_DATE', 'return_date = CURRENT_DATE'),
        thisWeek: await fetchSalesPeriod("invoice_date >= date_trunc('week', CURRENT_DATE)", "return_date >= date_trunc('week', CURRENT_DATE)"),
        thisMonth: await fetchSalesPeriod("invoice_date >= date_trunc('month', CURRENT_DATE)", "return_date >= date_trunc('month', CURRENT_DATE)"),
      };
    }

    // 6. PURCHASE SUMMARIES: Today, This Week, This Month
    let purchaseSummary = {
      today: { invoiceCount: 0, grossPurchases: 0, discount: 0, taxablePurchases: 0, gst: 0, netPurchases: 0, purchaseReturns: 0, netPurchasesAfterReturns: 0 },
      thisWeek: { invoiceCount: 0, grossPurchases: 0, discount: 0, taxablePurchases: 0, gst: 0, netPurchases: 0, purchaseReturns: 0, netPurchasesAfterReturns: 0 },
      thisMonth: { invoiceCount: 0, grossPurchases: 0, discount: 0, taxablePurchases: 0, gst: 0, netPurchases: 0, purchaseReturns: 0, netPurchasesAfterReturns: 0 },
    };

    if (hasPurchasePerm) {
      const fetchPurchasePeriod = async (dateFilterSql: string, returnDateFilterSql: string) => {
        const invRes = await pool.query(
          `SELECT 
             COUNT(id) AS count,
             COALESCE(SUM(subtotal), 0) AS gross,
             COALESCE(SUM(discount_total), 0) AS discount,
             COALESCE(SUM(taxable_amount), 0) AS taxable,
             COALESCE(SUM(igst_amount + cgst_amount + sgst_amount), 0) AS gst,
             COALESCE(SUM(grand_total), 0) AS net
           FROM purchase_invoices
           WHERE business_id = $1 AND status = 'POSTED' AND ${dateFilterSql}`,
          [businessId]
        );
        const retRes = await pool.query(
          `SELECT COALESCE(SUM(grand_total), 0) AS total_return
           FROM purchase_returns
           WHERE business_id = $1 AND status = 'POSTED' AND ${returnDateFilterSql}`,
          [businessId]
        );

        const r = invRes.rows[0] || {};
        const net = parseFloat(r.net) || 0;
        const returns = parseFloat(retRes.rows[0]?.total_return) || 0;

        return {
          invoiceCount: parseInt(r.count, 10) || 0,
          grossPurchases: parseFloat(r.gross) || 0,
          discount: parseFloat(r.discount) || 0,
          taxablePurchases: parseFloat(r.taxable) || 0,
          gst: parseFloat(r.gst) || 0,
          netPurchases: net,
          purchaseReturns: returns,
          netPurchasesAfterReturns: Math.round((net - returns + Number.EPSILON) * 100) / 100,
        };
      };

      purchaseSummary = {
        today: await fetchPurchasePeriod('invoice_date = CURRENT_DATE', 'return_date = CURRENT_DATE'),
        thisWeek: await fetchPurchasePeriod("invoice_date >= date_trunc('week', CURRENT_DATE)", "return_date >= date_trunc('week', CURRENT_DATE)"),
        thisMonth: await fetchPurchasePeriod("invoice_date >= date_trunc('month', CURRENT_DATE)", "return_date >= date_trunc('month', CURRENT_DATE)"),
      };
    }

    // 7. TOP PRODUCTS (Top Selling Unique Items & Top Purchased Unique Items)
    // NOTE: NO profit / COGS / margin labels or calculations!
    let topSellingProducts: Array<{
      uniqueItemId: string;
      name: string;
      sku: string;
      category: string;
      quantitySold: number;
      netSales: number;
    }> = [];

    let topPurchasedProducts: Array<{
      uniqueItemId: string;
      name: string;
      sku: string;
      category: string;
      quantityPurchased: number;
      netPurchases: number;
    }> = [];

    if (hasSalesPerm) {
      const topSalesRes = await pool.query(
        `SELECT 
           u.id AS unique_item_id,
           u.name,
           u.sku,
           c.name AS category,
           COALESCE(SUM(sil.quantity), 0) AS quantity_sold,
           COALESCE(SUM(sil.total_amount), 0) AS total_sales
         FROM sales_invoice_lines sil
         JOIN sales_invoices si ON sil.sales_invoice_id = si.id
         JOIN unique_items u ON sil.unique_item_id = u.id
         JOIN primary_items p ON u.primary_item_id = p.id
         JOIN categories c ON p.category_id = c.id
         WHERE si.business_id = $1 AND si.status = 'POSTED'
         GROUP BY u.id, u.name, u.sku, c.name
         ORDER BY total_sales DESC
         LIMIT 5`,
        [businessId]
      );

      topSellingProducts = topSalesRes.rows.map(r => ({
        uniqueItemId: r.unique_item_id,
        name: r.name,
        sku: r.sku,
        category: r.category,
        quantitySold: parseFloat(r.quantity_sold) || 0,
        netSales: parseFloat(r.total_sales) || 0,
      }));
    }

    if (hasPurchasePerm) {
      const topPurchRes = await pool.query(
        `SELECT 
           u.id AS unique_item_id,
           u.name,
           u.sku,
           c.name AS category,
           COALESCE(SUM(pil.quantity), 0) AS quantity_purchased,
           COALESCE(SUM(pil.total_amount), 0) AS total_purchases
         FROM purchase_invoice_lines pil
         JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
         JOIN unique_items u ON pil.unique_item_id = u.id
         JOIN primary_items p ON u.primary_item_id = p.id
         JOIN categories c ON p.category_id = c.id
         WHERE pi.business_id = $1 AND pi.status = 'POSTED'
         GROUP BY u.id, u.name, u.sku, c.name
         ORDER BY total_purchases DESC
         LIMIT 5`,
        [businessId]
      );

      topPurchasedProducts = topPurchRes.rows.map(r => ({
        uniqueItemId: r.unique_item_id,
        name: r.name,
        sku: r.sku,
        category: r.category,
        quantityPurchased: parseFloat(r.quantity_purchased) || 0,
        netPurchases: parseFloat(r.total_purchases) || 0,
      }));
    }

    // 8. TOP CUSTOMERS & TOP SUPPLIERS
    let topCustomers: Array<{
      partyId: string;
      partyName: string;
      partyCode: string;
      netSales: number;
      outstanding: number;
    }> = [];

    let topSuppliers: Array<{
      partyId: string;
      partyName: string;
      partyCode: string;
      netPurchases: number;
      outstanding: number;
    }> = [];

    if (hasSalesPerm) {
      const topCustRes = await pool.query(
        `SELECT 
           p.id AS party_id,
           p.name AS party_name,
           p.party_code,
           COALESCE(SUM(si.grand_total), 0) - COALESCE(
             (SELECT SUM(sr.grand_total) FROM sales_returns sr WHERE sr.party_id = p.id AND sr.status = 'POSTED'), 0
           ) AS net_sales,
           COALESCE((
             SELECT balance FROM customer_ledgers cl WHERE cl.party_id = p.id AND cl.business_id = $1 ORDER BY cl.created_at DESC LIMIT 1
           ), 0) AS outstanding
         FROM sales_invoices si
         JOIN parties p ON si.party_id = p.id
         WHERE si.business_id = $1 AND si.status = 'POSTED'
         GROUP BY p.id, p.name, p.party_code
         ORDER BY net_sales DESC
         LIMIT 5`,
        [businessId]
      );

      topCustomers = topCustRes.rows.map(r => ({
        partyId: r.party_id,
        partyName: r.party_name,
        partyCode: r.party_code,
        netSales: parseFloat(r.net_sales) || 0,
        outstanding: parseFloat(r.outstanding) || 0,
      }));
    }

    if (hasPurchasePerm) {
      const topSuppRes = await pool.query(
        `SELECT 
           p.id AS party_id,
           p.name AS party_name,
           p.party_code,
           COALESCE(SUM(pi.grand_total), 0) - COALESCE(
             (SELECT SUM(pr.grand_total) FROM purchase_returns pr WHERE pr.supplier_party_id = p.id AND pr.status = 'POSTED'), 0
           ) AS net_purchases,
           COALESCE((
             SELECT balance FROM supplier_ledgers sl WHERE sl.party_id = p.id AND sl.business_id = $1 ORDER BY sl.created_at DESC LIMIT 1
           ), 0) AS outstanding
         FROM purchase_invoices pi
         JOIN parties p ON pi.supplier_party_id = p.id
         WHERE pi.business_id = $1 AND pi.status = 'POSTED'
         GROUP BY p.id, p.name, p.party_code
         ORDER BY net_purchases DESC
         LIMIT 5`,
        [businessId]
      );

      topSuppliers = topSuppRes.rows.map(r => ({
        partyId: r.party_id,
        partyName: r.party_name,
        partyCode: r.party_code,
        netPurchases: parseFloat(r.net_purchases) || 0,
        outstanding: parseFloat(r.outstanding) || 0,
      }));
    }

    // 9. ACTIONABLE ALERTS
    let negativeStockAlerts: Array<{ batchId: string; barcode: string; uniqueItem: string; power: string; physical: number }> = [];
    let lowStockAlerts: Array<{ batchId: string; barcode: string; uniqueItem: string; power: string; physical: number }> = [];
    let activeReservationsCount = 0;
    let highOutstandingCustomers: Array<{ partyId: string; name: string; outstanding: number }> = [];

    if (hasInventoryPerm) {
      const negRes = await pool.query(
        `SELECT 
           b.id AS batch_id,
           b.barcode,
           u.name AS unique_item,
           CONCAT('SPH:', b.sph, ' CYL:', b.cyl, ' AXIS:', b.axis, ' ADD:', b.add, ' SIDE:', b.side) AS power,
           COALESCE(s.physical_stock, 0) AS physical
         FROM optical_batches b
         JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
         JOIN unique_items u ON b.unique_item_id = u.id
         WHERE b.business_id = $1 AND s.physical_stock < 0
         ORDER BY s.physical_stock ASC
         LIMIT 5`,
        [businessId]
      );
      negativeStockAlerts = negRes.rows.map(r => ({
        batchId: r.batch_id,
        barcode: r.barcode,
        uniqueItem: r.unique_item,
        power: r.power,
        physical: parseFloat(r.physical) || 0,
      }));

      const lowRes = await pool.query(
        `SELECT 
           b.id AS batch_id,
           b.barcode,
           u.name AS unique_item,
           CONCAT('SPH:', b.sph, ' CYL:', b.cyl, ' AXIS:', b.axis, ' ADD:', b.add, ' SIDE:', b.side) AS power,
           COALESCE(s.physical_stock, 0) AS physical
         FROM optical_batches b
         JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
         JOIN unique_items u ON b.unique_item_id = u.id
         WHERE b.business_id = $1 AND s.physical_stock > 0 AND s.physical_stock <= $2
         ORDER BY s.physical_stock ASC
         LIMIT 5`,
        [businessId, lowStockThreshold]
      );
      lowStockAlerts = lowRes.rows.map(r => ({
        batchId: r.batch_id,
        barcode: r.barcode,
        uniqueItem: r.unique_item,
        power: r.power,
        physical: parseFloat(r.physical) || 0,
      }));

      const resCountRes = await pool.query(
        `SELECT COUNT(id) AS count FROM stock_reservations WHERE business_id = $1 AND status = 'ACTIVE'`,
        [businessId]
      );
      activeReservationsCount = parseInt(resCountRes.rows[0]?.count, 10) || 0;
    }

    if (hasAccountsPerm) {
      const highCustRes = await pool.query(
        `SELECT 
           p.id AS party_id,
           p.name,
           sub.balance
         FROM (
           SELECT DISTINCT ON (party_id) party_id, balance
           FROM customer_ledgers
           WHERE business_id = $1
           ORDER BY party_id, created_at DESC
         ) sub
         JOIN parties p ON sub.party_id = p.id
         WHERE sub.balance > 1000
         ORDER BY sub.balance DESC
         LIMIT 5`,
        [businessId]
      );
      highOutstandingCustomers = highCustRes.rows.map(r => ({
        partyId: r.party_id,
        name: r.name,
        outstanding: parseFloat(r.balance) || 0,
      }));
    }

    // 10. RECENT TRANSACTIONS (Operational activity stream)
    const recentTransactions: Array<{
      id: string;
      type: string;
      docNumber: string;
      partyName?: string;
      amount?: number;
      status: string;
      createdAt: Date;
    }> = [];

    if (hasSalesPerm) {
      const recentSalesRes = await pool.query(
        `SELECT si.id, si.invoice_number, p.name AS party_name, si.grand_total, si.status, si.created_at
         FROM sales_invoices si
         JOIN parties p ON si.party_id = p.id
         WHERE si.business_id = $1
         ORDER BY si.created_at DESC
         LIMIT 4`,
        [businessId]
      );
      recentSalesRes.rows.forEach(r => {
        recentTransactions.push({
          id: r.id,
          type: 'SALES_INVOICE',
          docNumber: r.invoice_number,
          partyName: r.party_name,
          amount: parseFloat(r.grand_total) || 0,
          status: r.status,
          createdAt: r.created_at,
        });
      });
    }

    if (hasPurchasePerm) {
      const recentPurchRes = await pool.query(
        `SELECT pi.id, pi.invoice_number, p.name AS party_name, pi.grand_total, pi.status, pi.created_at
         FROM purchase_invoices pi
         JOIN parties p ON pi.supplier_party_id = p.id
         WHERE pi.business_id = $1
         ORDER BY pi.created_at DESC
         LIMIT 4`,
        [businessId]
      );
      recentPurchRes.rows.forEach(r => {
        recentTransactions.push({
          id: r.id,
          type: 'PURCHASE_INVOICE',
          docNumber: r.invoice_number,
          partyName: r.party_name,
          amount: parseFloat(r.grand_total) || 0,
          status: r.status,
          createdAt: r.created_at,
        });
      });
    }

    if (hasAccountsPerm) {
      const recentPayRes = await pool.query(
        `SELECT pm.id, pm.payment_number, pm.payment_type, p.name AS party_name, pm.amount, pm.status, pm.created_at
         FROM payments pm
         JOIN parties p ON pm.party_id = p.id
         WHERE pm.business_id = $1
         ORDER BY pm.created_at DESC
         LIMIT 4`,
        [businessId]
      );
      recentPayRes.rows.forEach(r => {
        recentTransactions.push({
          id: r.id,
          type: r.payment_type,
          docNumber: r.payment_number,
          partyName: r.party_name,
          amount: parseFloat(r.amount) || 0,
          status: r.status,
          createdAt: r.created_at,
        });
      });
    }

    // Sort recent combined transactions descending
    recentTransactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      stockKPIs,
      stockByCategory,
      todaysSales,
      todaysPurchases,
      todaysReceipts,
      todaysSupplierPayments,
      outstandingSummary,
      salesSummary,
      purchaseSummary,
      topSellingProducts,
      topPurchasedProducts,
      topCustomers,
      topSuppliers,
      alerts: {
        negativeStockAlerts,
        lowStockAlerts,
        activeReservationsCount,
        highOutstandingCustomers,
      },
      recentTransactions: recentTransactions.slice(0, 10),
      permissions: {
        hasSalesPerm,
        hasPurchasePerm,
        hasInventoryPerm,
        hasAccountsPerm,
      },
    };
  }
}
