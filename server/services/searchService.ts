import { pool } from '../db/index.js';

export interface GlobalSearchResult {
  barcodes: Array<{
    batchId: string;
    barcode: string;
    uniqueItemId: string;
    uniqueItemName: string;
    sku: string;
    categoryCode: string;
    categoryName: string;
    sph: number;
    cyl: number;
    axis: number;
    add: number;
    side: string;
    physicalStock: number;
    reservedStock: number;
    availableStock: number;
    isExactMatch: boolean;
  }>;
  documents: Array<{
    id: string;
    docType: 'SALES_INVOICE' | 'SALES_ORDER' | 'PURCHASE_INVOICE' | 'SALES_RETURN' | 'PURCHASE_RETURN' | 'PAYMENT';
    docNumber: string;
    partyName?: string;
    partyId?: string;
    date: string | Date;
    amount: number;
    status: string;
  }>;
  parties: Array<{
    id: string;
    partyCode: string;
    name: string;
    displayName?: string;
    partyType: string;
    mobile?: string;
    email?: string;
    gstin?: string;
    outstanding: number;
    status: string;
  }>;
  products: Array<{
    id: string;
    name: string;
    sku: string;
    category: string;
    brand?: string;
    mrp: number;
    status: string;
  }>;
}

export class SearchService {
  /**
   * Global Search across authorized entities within a business.
   */
  static async search(
    businessId: string,
    query: string,
    userPermissions: string[] = [],
    isSuperAdmin: boolean = false
  ): Promise<GlobalSearchResult> {
    const rawQuery = (query || '').trim();
    if (!rawQuery) {
      return { barcodes: [], documents: [], parties: [], products: [] };
    }

    const likeQuery = `%${rawQuery}%`;

    const hasSalesPerm = isSuperAdmin || userPermissions.some(p => p.startsWith('sales') || p.includes('sales'));
    const hasPurchasePerm = isSuperAdmin || userPermissions.some(p => p.startsWith('purchase') || p.includes('purchase'));
    const hasInventoryPerm = isSuperAdmin || userPermissions.some(p => p.startsWith('inventory') || p.includes('inventory') || p.startsWith('master'));
    const hasAccountsPerm = isSuperAdmin || userPermissions.some(p => p.startsWith('accounts') || p.startsWith('payment') || p.includes('payment') || p.includes('outstanding'));
    const hasPartiesPerm = isSuperAdmin || userPermissions.some(p => p.startsWith('parties') || p.includes('parties'));

    const result: GlobalSearchResult = {
      barcodes: [],
      documents: [],
      parties: [],
      products: [],
    };

    // 1. OPTICAL BATCH / BARCODE SEARCH (Exact matches prioritized first)
    if (hasInventoryPerm) {
      const barcodeRes = await pool.query(
        `SELECT 
           b.id AS batch_id,
           b.barcode,
           u.id AS unique_item_id,
           u.name AS unique_item_name,
           u.sku,
           c.code AS category_code,
           c.name AS category_name,
           b.sph,
           b.cyl,
           b.axis,
           b.add,
           b.side,
           COALESCE(s.physical_stock, 0) AS physical_stock,
           COALESCE(s.reserved_stock, 0) AS reserved_stock,
           COALESCE(s.available_stock, 0) AS available_stock,
           (LOWER(b.barcode) = LOWER($2)) AS is_exact
         FROM optical_batches b
         JOIN unique_items u ON b.unique_item_id = u.id
         JOIN categories c ON b.category_id = c.id
         LEFT JOIN optical_stocks s ON (s.batch_id = b.id AND s.business_id = b.business_id)
         WHERE b.business_id = $1 
           AND (b.barcode ILIKE $3 OR u.name ILIKE $3 OR u.sku ILIKE $3)
         ORDER BY (LOWER(b.barcode) = LOWER($2)) DESC, b.barcode ASC
         LIMIT 10`,
        [businessId, rawQuery, likeQuery]
      );

      result.barcodes = barcodeRes.rows.map(r => ({
        batchId: r.batch_id,
        barcode: r.barcode,
        uniqueItemId: r.unique_item_id,
        uniqueItemName: r.unique_item_name,
        sku: r.sku,
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
        isExactMatch: Boolean(r.is_exact),
      }));
    }

    // 2. DOCUMENT SEARCH (Sales Invoices, Orders, Purchases, Returns, Payments)
    if (hasSalesPerm) {
      // Sales Invoices
      const siRes = await pool.query(
        `SELECT si.id, si.invoice_number, p.name AS party_name, p.id AS party_id, si.invoice_date, si.grand_total, si.status
         FROM sales_invoices si
         JOIN parties p ON si.party_id = p.id
         WHERE si.business_id = $1 AND (si.invoice_number ILIKE $2 OR p.name ILIKE $2)
         ORDER BY si.created_at DESC
         LIMIT 5`,
        [businessId, likeQuery]
      );
      siRes.rows.forEach(r => {
        result.documents.push({
          id: r.id,
          docType: 'SALES_INVOICE',
          docNumber: r.invoice_number,
          partyName: r.party_name,
          partyId: r.party_id,
          date: r.invoice_date,
          amount: parseFloat(r.grand_total) || 0,
          status: r.status,
        });
      });

      // Sales Orders
      const soRes = await pool.query(
        `SELECT so.id, so.order_number, p.name AS party_name, p.id AS party_id, so.order_date, so.grand_total, so.status
         FROM sales_orders so
         JOIN parties p ON so.party_id = p.id
         WHERE so.business_id = $1 AND (so.order_number ILIKE $2 OR p.name ILIKE $2)
         ORDER BY so.created_at DESC
         LIMIT 5`,
        [businessId, likeQuery]
      );
      soRes.rows.forEach(r => {
        result.documents.push({
          id: r.id,
          docType: 'SALES_ORDER',
          docNumber: r.order_number,
          partyName: r.party_name,
          partyId: r.party_id,
          date: r.order_date,
          amount: parseFloat(r.grand_total) || 0,
          status: r.status,
        });
      });

      // Sales Returns
      const srRes = await pool.query(
        `SELECT sr.id, sr.return_number, p.name AS party_name, p.id AS party_id, sr.return_date, sr.grand_total, sr.status
         FROM sales_returns sr
         JOIN parties p ON sr.party_id = p.id
         WHERE sr.business_id = $1 AND (sr.return_number ILIKE $2 OR p.name ILIKE $2)
         ORDER BY sr.created_at DESC
         LIMIT 5`,
        [businessId, likeQuery]
      );
      srRes.rows.forEach(r => {
        result.documents.push({
          id: r.id,
          docType: 'SALES_RETURN',
          docNumber: r.return_number,
          partyName: r.party_name,
          partyId: r.party_id,
          date: r.return_date,
          amount: parseFloat(r.grand_total) || 0,
          status: r.status,
        });
      });
    }

    if (hasPurchasePerm) {
      // Purchase Invoices
      const piRes = await pool.query(
        `SELECT pi.id, pi.invoice_number, pi.supplier_invoice_number, p.name AS party_name, p.id AS party_id, pi.invoice_date, pi.grand_total, pi.status
         FROM purchase_invoices pi
         JOIN parties p ON pi.supplier_party_id = p.id
         WHERE pi.business_id = $1 AND (pi.invoice_number ILIKE $2 OR pi.supplier_invoice_number ILIKE $2 OR p.name ILIKE $2)
         ORDER BY pi.created_at DESC
         LIMIT 5`,
        [businessId, likeQuery]
      );
      piRes.rows.forEach(r => {
        result.documents.push({
          id: r.id,
          docType: 'PURCHASE_INVOICE',
          docNumber: r.invoice_number + (r.supplier_invoice_number ? ` (${r.supplier_invoice_number})` : ''),
          partyName: r.party_name,
          partyId: r.party_id,
          date: r.invoice_date,
          amount: parseFloat(r.grand_total) || 0,
          status: r.status,
        });
      });

      // Purchase Returns
      const prRes = await pool.query(
        `SELECT pr.id, pr.return_number, p.name AS party_name, p.id AS party_id, pr.return_date, pr.grand_total, pr.status
         FROM purchase_returns pr
         JOIN parties p ON pr.supplier_party_id = p.id
         WHERE pr.business_id = $1 AND (pr.return_number ILIKE $2 OR p.name ILIKE $2)
         ORDER BY pr.created_at DESC
         LIMIT 5`,
        [businessId, likeQuery]
      );
      prRes.rows.forEach(r => {
        result.documents.push({
          id: r.id,
          docType: 'PURCHASE_RETURN',
          docNumber: r.return_number,
          partyName: r.party_name,
          partyId: r.party_id,
          date: r.return_date,
          amount: parseFloat(r.grand_total) || 0,
          status: r.status,
        });
      });
    }

    if (hasAccountsPerm) {
      // Payments
      const pmRes = await pool.query(
        `SELECT pm.id, pm.payment_number, pm.payment_type, p.name AS party_name, p.id AS party_id, pm.payment_date, pm.amount, pm.status
         FROM payments pm
         JOIN parties p ON pm.party_id = p.id
         WHERE pm.business_id = $1 AND (pm.payment_number ILIKE $2 OR pm.reference_number ILIKE $2 OR p.name ILIKE $2)
         ORDER BY pm.created_at DESC
         LIMIT 5`,
        [businessId, likeQuery]
      );
      pmRes.rows.forEach(r => {
        result.documents.push({
          id: r.id,
          docType: 'PAYMENT',
          docNumber: `${r.payment_number} (${r.payment_type})`,
          partyName: r.party_name,
          partyId: r.party_id,
          date: r.payment_date,
          amount: parseFloat(r.amount) || 0,
          status: r.status,
        });
      });
    }

    // 3. PARTY SEARCH
    if (hasPartiesPerm) {
      const partyRes = await pool.query(
        `SELECT 
           p.id,
           p.party_code,
           p.name,
           p.display_name,
           p.party_type,
           p.mobile,
           p.email,
           p.gstin,
           p.status,
           COALESCE(
             CASE WHEN p.party_type IN ('CUSTOMER', 'BOTH') 
                  THEN (SELECT balance FROM customer_ledgers cl WHERE cl.party_id = p.id AND cl.business_id = $1 ORDER BY cl.created_at DESC LIMIT 1)
                  ELSE (SELECT balance FROM supplier_ledgers sl WHERE sl.party_id = p.id AND sl.business_id = $1 ORDER BY sl.created_at DESC LIMIT 1)
             END, 0
           ) AS outstanding
         FROM parties p
         WHERE p.business_id = $1 
           AND (p.name ILIKE $2 OR p.party_code ILIKE $2 OR p.display_name ILIKE $2 OR p.mobile ILIKE $2 OR p.email ILIKE $2 OR p.gstin ILIKE $2)
         ORDER BY p.name ASC
         LIMIT 10`,
        [businessId, likeQuery]
      );

      result.parties = partyRes.rows.map(r => ({
        id: r.id,
        partyCode: r.party_code,
        name: r.name,
        displayName: r.display_name,
        partyType: r.party_type,
        mobile: r.mobile,
        email: r.email,
        gstin: r.gstin,
        outstanding: parseFloat(r.outstanding) || 0,
        status: r.status,
      }));
    }

    // 4. PRODUCT / UNIQUE ITEMS SEARCH
    if (hasInventoryPerm) {
      const prodRes = await pool.query(
        `SELECT 
           u.id,
           u.name,
           u.sku,
           u.mrp,
           u.status,
           c.name AS category_name,
           p.name AS primary_item_name
         FROM unique_items u
         JOIN primary_items p ON u.primary_item_id = p.id
         JOIN categories c ON p.category_id = c.id
         WHERE u.business_id = $1 
           AND (u.name ILIKE $2 OR u.sku ILIKE $2 OR p.name ILIKE $2)
         ORDER BY u.name ASC
         LIMIT 8`,
        [businessId, likeQuery]
      );

      result.products = prodRes.rows.map(r => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        category: r.category_name,
        brand: r.primary_item_name,
        mrp: parseFloat(r.mrp) || 0,
        status: r.status,
      }));
    }

    return result;
  }
}
