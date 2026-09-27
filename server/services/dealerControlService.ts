import { pool } from '../db/index.js';
import { BusinessSettingsService } from './businessSettingsService.js';

export interface DealerFilterParams {
  search?: string;
  status?: string;
  filter?: 'ALL' | 'OUTSTANDING_ONLY' | 'PENDING_ORDERS' | 'PENDING_DISPATCH' | 'NO_RECENT_ORDERS';
  page?: number;
  limit?: number;
}

export class DealerControlService {
  /**
   * Helper: Find Main Warehouse's Customer Party ID representing a specific Dealer
   */
  static async resolveDealerPartyId(client: any, mainBusinessId: string, dealerBusinessId: string): Promise<string | null> {
    // 1. Check dealer_orders linkage
    const doRes = await client.query(
      `SELECT dealer_party_id_in_main 
       FROM dealer_orders 
       WHERE main_business_id = $1 AND dealer_business_id = $2 
       ORDER BY created_at DESC LIMIT 1`,
      [mainBusinessId, dealerBusinessId]
    );
    if (doRes.rows.length > 0 && doRes.rows[0].dealer_party_id_in_main) {
      return doRes.rows[0].dealer_party_id_in_main;
    }

    // 2. Query dealer business info to match party
    const dealerRes = await client.query(
      `SELECT id, name, trade_name, gstin FROM businesses WHERE id = $1`,
      [dealerBusinessId]
    );
    if (dealerRes.rows.length === 0) return null;
    const dealer = dealerRes.rows[0];

    const partyRes = await client.query(
      `SELECT id FROM parties 
       WHERE business_id = $1 AND party_type IN ('CUSTOMER', 'BOTH')
         AND (
           notes LIKE $2
           OR LOWER(name) = LOWER($3)
           OR (display_name IS NOT NULL AND LOWER(display_name) = LOWER($3))
           OR ($4 <> '' AND gstin IS NOT NULL AND UPPER(gstin) = UPPER($4))
         )
       ORDER BY created_at DESC LIMIT 1`,
      [
        mainBusinessId,
        `%[DEALER_BIZ:${dealerBusinessId}]%`,
        dealer.name,
        dealer.gstin || '',
      ]
    );

    return partyRes.rows.length > 0 ? partyRes.rows[0].id : null;
  }

  /**
   * 1. GET Top Summary KPIs for MAIN Business Dealer Control Center
   */
  static async getDealerSummary(mainBusinessId: string) {
    const summary = await this.getMainDealersSummary(mainBusinessId);
    return {
      ...summary,
      totalReceivables: summary.totalOutstanding,
    };
  }

  static async getMainDealersSummary(mainBusinessId: string) {
    const client = await pool.connect();
    try {
      // 1. Total Dealers & Active Dealers count
      const dealersRes = await client.query(
        `SELECT 
           COUNT(*)::int AS total_dealers,
           COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_dealers
         FROM businesses 
         WHERE parent_business_id = $1 AND business_type = 'DEALER'`,
        [mainBusinessId]
      );
      const totalDealers = dealersRes.rows[0]?.total_dealers || 0;
      const activeDealers = dealersRes.rows[0]?.active_dealers || 0;

      // 2. Open Dealer Orders count
      const openOrdersRes = await client.query(
        `SELECT COUNT(*)::int AS open_orders
         FROM dealer_orders 
         WHERE main_business_id = $1 
           AND status IN ('CONFIRMED', 'PENDING', 'PROCESSING')`,
        [mainBusinessId]
      );
      const openDealerOrders = openOrdersRes.rows[0]?.open_orders || 0;

      // 3. Pending Dispatches count (shipments in transit or partially received)
      const pendingDispRes = await client.query(
        `SELECT COUNT(*)::int AS pending_dispatches
         FROM dealer_shipments 
         WHERE main_business_id = $1 
           AND status IN ('DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')`,
        [mainBusinessId]
      );
      const pendingDispatches = pendingDispRes.rows[0]?.pending_dispatches || 0;

      // 3b. Pending Returns count (requested or in-transit dealer returns)
      const pendingReturnsRes = await client.query(
        `SELECT COUNT(*)::int AS pending_returns
         FROM dealer_returns 
         WHERE main_business_id = $1 
           AND status IN ('REQUESTED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')`,
        [mainBusinessId]
      );
      const pendingReturns = pendingReturnsRes.rows[0]?.pending_returns || 0;

      // 3c. Pending Payment Advices to Verify
      const pendingPayRes = await client.query(
        `SELECT COUNT(*)::int AS pending_count,
                COALESCE(SUM(amount), 0)::numeric(12, 2) AS pending_amount
         FROM dealer_payment_advices
         WHERE main_business_id = $1 AND status = 'SUBMITTED'`,
        [mainBusinessId]
      );
      const pendingPaymentsCount = pendingPayRes.rows[0]?.pending_count || 0;
      const pendingPaymentsAmount = parseFloat(pendingPayRes.rows[0]?.pending_amount || '0.00');

      // 4. Total Dealer Outstanding from authoritative Customer Ledgers
      const outstandingRes = await client.query(
        `WITH dealer_parties AS (
           SELECT DISTINCT p.id as party_id
           FROM parties p
           JOIN businesses d ON d.parent_business_id = $1 AND d.business_type = 'DEALER'
           WHERE p.business_id = $1 AND p.party_type IN ('CUSTOMER', 'BOTH')
             AND (
               p.notes LIKE '%[DEALER_BIZ:' || d.id || ']%'
               OR LOWER(p.name) = LOWER(d.name)
               OR (p.gstin IS NOT NULL AND p.gstin <> '' AND UPPER(p.gstin) = UPPER(d.gstin))
             )
           UNION
           SELECT DISTINCT dealer_party_id_in_main as party_id
           FROM dealer_orders
           WHERE main_business_id = $1
         ),
         latest_balances AS (
           SELECT DISTINCT ON (cl.party_id) cl.party_id, cl.balance
           FROM customer_ledgers cl
           JOIN dealer_parties dp ON cl.party_id = dp.party_id
           WHERE cl.business_id = $1
           ORDER BY cl.party_id, cl.created_at DESC
         )
         SELECT COALESCE(SUM(balance), 0)::numeric(14, 2) AS total_outstanding
         FROM latest_balances
         WHERE balance > 0`,
        [mainBusinessId]
      );
      const totalOutstanding = parseFloat(outstandingRes.rows[0]?.total_outstanding || '0.00');

      return {
        totalDealers,
        activeDealers,
        openDealerOrders,
        pendingDispatches,
        pendingReturns,
        pendingPaymentsCount,
        pendingPaymentsAmount,
        totalOutstanding,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 2. GET List of Dealers belonging to this Main Warehouse
   */
  static async getMainDealersList(mainBusinessId: string, params: DealerFilterParams = {}) {
    const client = await pool.connect();
    try {
      const {
        search = '',
        status = 'ALL',
        filter = 'ALL',
        page = 1,
        limit = 50,
      } = params;

      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
      const offset = (pageNum - 1) * limitNum;

      // 1. Base query to fetch all dealers for this Main Warehouse
      let query = `
        SELECT 
          b.id,
          b.name,
          b.trade_name,
          b.code,
          b.gstin,
          b.phone,
          b.email,
          b.city,
          b.state,
          b.status,
          b.created_at,
          bs.config AS settings_config
        FROM businesses b
        LEFT JOIN business_settings bs ON bs.business_id = b.id
        WHERE b.parent_business_id = $1 AND b.business_type = 'DEALER'
      `;
      const queryParams: any[] = [mainBusinessId];

      if (status !== 'ALL') {
        queryParams.push(status);
        query += ` AND b.status = $${queryParams.length}`;
      }

      if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        queryParams.push(searchTerm);
        const idx = queryParams.length;
        query += ` AND (
          LOWER(b.name) LIKE $${idx}
          OR LOWER(COALESCE(b.trade_name, '')) LIKE $${idx}
          OR LOWER(COALESCE(b.code, '')) LIKE $${idx}
          OR LOWER(COALESCE(b.gstin, '')) LIKE $${idx}
          OR LOWER(COALESCE(b.phone, '')) LIKE $${idx}
          OR LOWER(COALESCE(b.city, '')) LIKE $${idx}
        )`;
      }

      query += ` ORDER BY b.name ASC`;

      const dealersRes = await client.query(query, queryParams);
      const rawDealers = dealersRes.rows;

      // 2. Enhance each dealer with commercial relationship metrics
      const enrichedDealers = await Promise.all(
        rawDealers.map(async (d) => {
          const partyId = await this.resolveDealerPartyId(client, mainBusinessId, d.id);

          // Orders count & open orders count
          const ordersRes = await client.query(
            `SELECT 
               COUNT(*)::int as total_orders,
               COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'PENDING', 'PROCESSING'))::int as open_orders,
               MAX(created_at) as last_order_date
             FROM dealer_orders 
             WHERE main_business_id = $1 AND dealer_business_id = $2`,
            [mainBusinessId, d.id]
          );
          const totalOrders = ordersRes.rows[0]?.total_orders || 0;
          const openOrders = ordersRes.rows[0]?.open_orders || 0;
          const lastOrderDate = ordersRes.rows[0]?.last_order_date || null;

          // Pending dispatches count
          const dispRes = await client.query(
            `SELECT COUNT(*)::int as pending_dispatches
             FROM dealer_shipments 
             WHERE main_business_id = $1 AND dealer_business_id = $2 
               AND status IN ('DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')`,
            [mainBusinessId, d.id]
          );
          const pendingDispatches = dispRes.rows[0]?.pending_dispatches || 0;

          // Outstanding balance from Main customer_ledgers
          let outstanding = 0;
          let lastInvoiceDate: string | null = null;
          if (partyId) {
            const clRes = await client.query(
              `SELECT balance FROM customer_ledgers 
               WHERE business_id = $1 AND party_id = $2 
               ORDER BY created_at DESC LIMIT 1`,
              [mainBusinessId, partyId]
            );
            if (clRes.rows.length > 0) {
              outstanding = Math.max(0, parseFloat(clRes.rows[0].balance || '0.00'));
            }

            const invRes = await client.query(
              `SELECT MAX(invoice_date) as last_invoice_date
               FROM sales_invoices 
               WHERE business_id = $1 AND customer_party_id = $2 AND status = 'POSTED'`,
              [mainBusinessId, partyId]
            );
            lastInvoiceDate = invRes.rows[0]?.last_invoice_date || null;
          }

          // Stock sharing toggle check
          const config = d.settings_config || {};
          const settings = config.settings || config;
          const stockSharingEnabled = Boolean(settings?.dealer?.shareStockWithMain);

          return {
            id: d.id,
            name: d.name,
            tradeName: d.trade_name,
            code: d.code,
            gstin: d.gstin,
            phone: d.phone,
            email: d.email,
            city: d.city,
            state: d.state,
            status: d.status,
            customerPartyId: partyId,
            ordersCount: totalOrders,
            openOrdersCount: openOrders,
            pendingDispatchCount: pendingDispatches,
            outstanding,
            lastOrderDate,
            lastInvoiceDate,
            stockSharingEnabled,
            createdAt: d.created_at,
          };
        })
      );

      // 3. Apply operational filters
      let filteredDealers = enrichedDealers;
      if (filter === 'OUTSTANDING_ONLY') {
        filteredDealers = filteredDealers.filter((d) => d.outstanding > 0);
      } else if (filter === 'PENDING_ORDERS') {
        filteredDealers = filteredDealers.filter((d) => d.openOrdersCount > 0);
      } else if (filter === 'PENDING_DISPATCH') {
        filteredDealers = filteredDealers.filter((d) => d.pendingDispatchCount > 0);
      } else if (filter === 'NO_RECENT_ORDERS') {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        filteredDealers = filteredDealers.filter(
          (d) => !d.lastOrderDate || new Date(d.lastOrderDate) < thirtyDaysAgo
        );
      }

      const totalCount = filteredDealers.length;
      const paginatedDealers = filteredDealers.slice(offset, offset + limitNum);

      return {
        dealers: paginatedDealers,
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 3. GET Dealer Relationship Details & Overview (Single Dealer Context)
   */
  static async getDealerRelationshipDetails(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      // 1. Verify Tenant Boundary: Dealer must belong to current Main Warehouse
      const dealerRes = await client.query(
        `SELECT 
           b.id, b.name, b.trade_name, b.code, b.gstin, b.phone, b.email,
           b.address_line_1, b.address_line_2, b.city, b.state, b.pincode,
           b.status, b.created_at, bs.config as settings_config
         FROM businesses b
         LEFT JOIN business_settings bs ON bs.business_id = b.id
         WHERE b.id = $1 AND b.parent_business_id = $2 AND b.business_type = 'DEALER'`,
        [dealerBusinessId, mainBusinessId]
      );

      if (dealerRes.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }
      const dealer = dealerRes.rows[0];
      const partyId = await this.resolveDealerPartyId(client, mainBusinessId, dealerBusinessId);

      // 2. Fetch Customer Party info
      let commercialParty: any = null;
      let totalOutstanding = 0;
      let overdueAmount = 0;
      let oldestDueDate: string | null = null;
      let creditLimit = 0;
      let creditDays = 0;

      if (partyId) {
        const pRes = await client.query(
          `SELECT id, party_code, name, display_name, gstin, phone, mobile, credit_limit, credit_days 
           FROM parties WHERE id = $1 AND business_id = $2`,
          [partyId, mainBusinessId]
        );
        if (pRes.rows.length > 0) {
          commercialParty = pRes.rows[0];
          creditLimit = parseFloat(commercialParty.credit_limit || '0.00');
          creditDays = parseInt(commercialParty.credit_days || '0', 10);
        }

        // Ledger balance
        const clRes = await client.query(
          `SELECT balance FROM customer_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY created_at DESC LIMIT 1`,
          [mainBusinessId, partyId]
        );
        if (clRes.rows.length > 0) {
          totalOutstanding = Math.max(0, parseFloat(clRes.rows[0].balance || '0.00'));
        }

        // Overdue calculation based on unpaid invoices
        const overdueRes = await client.query(
          `SELECT 
             COALESCE(SUM(balance), 0)::numeric(12, 2) as overdue,
             MIN(due_date) as oldest_due
           FROM sales_invoices 
           WHERE business_id = $1 AND customer_party_id = $2 
             AND status = 'POSTED' AND balance > 0 
             AND due_date IS NOT NULL AND due_date < NOW()`,
          [mainBusinessId, partyId]
        );
        overdueAmount = parseFloat(overdueRes.rows[0]?.overdue || '0.00');
        oldestDueDate = overdueRes.rows[0]?.oldest_due || null;
      }

      // 3. Operational KPIs
      // Open Orders & Reserved Qty
      const openOrdersRes = await client.query(
        `SELECT 
           COUNT(DISTINCT so.id)::int as open_orders_count,
           COALESCE(SUM(sol.quantity), 0)::numeric(12, 2) as reserved_qty
         FROM sales_orders so
         LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
         WHERE so.business_id = $1 
           AND (so.party_id = $2 OR so.id IN (SELECT main_sales_order_id FROM dealer_orders WHERE dealer_business_id = $3))
           AND so.status IN ('CONFIRMED', 'PROCESSING', 'PARTIALLY_DELIVERED')`,
        [mainBusinessId, partyId, dealerBusinessId]
      );
      const openOrders = openOrdersRes.rows[0]?.open_orders_count || 0;
      const reservedQty = parseFloat(openOrdersRes.rows[0]?.reserved_qty || '0.00');

      // Pending Dispatch Qty & In Transit Qty
      const transitRes = await client.query(
        `SELECT 
           COALESCE(SUM(ds.total_quantity - (
             SELECT COALESCE(SUM(received_quantity + damaged_quantity + short_quantity), 0) 
             FROM dealer_shipment_lines WHERE dealer_shipment_id = ds.id
           )), 0)::numeric(12, 2) as in_transit_qty
         FROM dealer_shipments ds
         WHERE ds.main_business_id = $1 AND ds.dealer_business_id = $2 
           AND ds.status IN ('DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')`,
        [mainBusinessId, dealerBusinessId]
      );
      const inTransitQty = parseFloat(transitRes.rows[0]?.in_transit_qty || '0.00');

      // 4. Last Order & Last Invoice Dates
      const datesRes = await client.query(
        `SELECT 
           (SELECT MAX(created_at) FROM dealer_orders WHERE main_business_id = $1 AND dealer_business_id = $2) as last_order_date,
           (SELECT MAX(invoice_date) FROM sales_invoices WHERE business_id = $1 AND customer_party_id = $3 AND status = 'POSTED') as last_invoice_date`,
        [mainBusinessId, dealerBusinessId, partyId]
      );
      const lastOrderDate = datesRes.rows[0]?.last_order_date || null;
      const lastInvoiceDate = datesRes.rows[0]?.last_invoice_date || null;

      // 5. Recent Orders (Latest 5)
      const recentOrdersRes = await client.query(
        `SELECT 
           d.id,
           d.order_number,
           d.status,
           d.total_quantity,
           d.grand_total,
           d.created_at,
           so.order_number as sales_order_number,
           po.order_number as dealer_po_number
         FROM dealer_orders d
         LEFT JOIN sales_orders so ON d.main_sales_order_id = so.id
         LEFT JOIN purchase_orders po ON d.dealer_purchase_order_id = po.id
         WHERE d.main_business_id = $1 AND d.dealer_business_id = $2
         ORDER BY d.created_at DESC LIMIT 5`,
        [mainBusinessId, dealerBusinessId]
      );

      // 6. Recent Invoices (Latest 5)
      let recentInvoices: any[] = [];
      if (partyId) {
        const invRes = await client.query(
          `SELECT 
             si.id,
             si.invoice_number,
             si.invoice_date,
             si.due_date,
             si.grand_total,
             si.balance,
             si.status,
             (SELECT COUNT(*) FROM dealer_shipments ds WHERE ds.main_sales_invoice_id = si.id)::int > 0 as is_dispatched
           FROM sales_invoices si
           WHERE si.business_id = $1 AND si.customer_party_id = $2 AND si.status = 'POSTED'
           ORDER BY si.invoice_date DESC, si.created_at DESC LIMIT 5`,
          [mainBusinessId, partyId]
        );
        recentInvoices = invRes.rows;
      }

      // 7. Pending Dispatches (Active shipments)
      const pendingDispatchesRes = await client.query(
        `SELECT 
           ds.id,
           ds.shipment_number,
           ds.dispatch_date,
           ds.total_quantity,
           ds.courier_name,
           ds.tracking_number,
           ds.status,
           si.invoice_number
         FROM dealer_shipments ds
         LEFT JOIN sales_invoices si ON ds.main_sales_invoice_id = si.id
         WHERE ds.main_business_id = $1 AND ds.dealer_business_id = $2
           AND ds.status IN ('DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')
         ORDER BY ds.dispatch_date DESC LIMIT 5`,
        [mainBusinessId, dealerBusinessId]
      );

      // Stock Sharing Config
      const config = dealer.settings_config || {};
      const settings = config.settings || config;
      const stockSharingEnabled = Boolean(settings?.dealer?.shareStockWithMain);

      return {
        dealer: {
          id: dealer.id,
          name: dealer.name,
          tradeName: dealer.trade_name,
          code: dealer.code,
          gstin: dealer.gstin,
          phone: dealer.phone,
          email: dealer.email,
          addressLine1: dealer.address_line_1,
          addressLine2: dealer.address_line_2,
          city: dealer.city,
          state: dealer.state,
          pincode: dealer.pincode,
          status: dealer.status,
          createdAt: dealer.created_at,
          stockSharingEnabled,
        },
        commercialParty,
        kpis: {
          openOrders,
          reservedQty,
          inTransitQty,
          totalOutstanding,
          overdueAmount,
          creditLimit,
          creditDays,
          availableCredit: creditLimit > 0 ? Math.max(0, creditLimit - totalOutstanding) : null,
          lastOrderDate,
          lastInvoiceDate,
          oldestDueDate,
        },
        recentOrders: recentOrdersRes.rows,
        recentInvoices,
        pendingDispatches: pendingDispatchesRes.rows,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 4. GET Orders for this Dealer in Main Warehouse
   */
  static async getDealerOrders(mainBusinessId: string, dealerBusinessId: string, options: { page?: number; limit?: number; search?: string } = {}) {
    const client = await pool.connect();
    try {
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
      const offset = (page - 1) * limit;

      const partyId = await this.resolveDealerPartyId(client, mainBusinessId, dealerBusinessId);

      let query = `
        SELECT 
          d.id,
          d.order_number,
          d.status as dealer_order_status,
          d.item_count,
          d.total_quantity,
          d.taxable_amount,
          d.tax_amount,
          d.grand_total,
          d.notes,
          d.created_at,
          so.id as sales_order_id,
          so.order_number as sales_order_number,
          so.status as sales_order_status,
          so.order_date as sales_order_date,
          po.id as dealer_po_id,
          po.order_number as dealer_po_number
        FROM dealer_orders d
        LEFT JOIN sales_orders so ON d.main_sales_order_id = so.id
        LEFT JOIN purchase_orders po ON d.dealer_purchase_order_id = po.id
        WHERE d.main_business_id = $1 AND d.dealer_business_id = $2
      `;
      const params: any[] = [mainBusinessId, dealerBusinessId];

      if (options.search && options.search.trim()) {
        params.push(`%${options.search.trim().toLowerCase()}%`);
        query += ` AND (
          LOWER(d.order_number) LIKE $${params.length}
          OR LOWER(COALESCE(so.order_number, '')) LIKE $${params.length}
          OR LOWER(COALESCE(po.order_number, '')) LIKE $${params.length}
        )`;
      }

      query += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const ordersRes = await client.query(query, params);

      // Count
      const countRes = await client.query(
        `SELECT COUNT(*)::int as total FROM dealer_orders WHERE main_business_id = $1 AND dealer_business_id = $2`,
        [mainBusinessId, dealerBusinessId]
      );
      const total = countRes.rows[0]?.total || 0;

      return {
        orders: ordersRes.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 5. GET Sales Invoices for this Dealer
   */
  static async getDealerInvoices(mainBusinessId: string, dealerBusinessId: string, options: { page?: number; limit?: number; search?: string } = {}) {
    const client = await pool.connect();
    try {
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
      const offset = (page - 1) * limit;

      const partyId = await this.resolveDealerPartyId(client, mainBusinessId, dealerBusinessId);
      if (!partyId) {
        return { invoices: [], total: 0, page, limit, totalPages: 0 };
      }

      let query = `
        SELECT 
          si.id,
          si.invoice_number,
          si.invoice_date,
          si.due_date,
          si.subtotal,
          si.tax_amount,
          si.grand_total,
          si.paid_amount,
          si.balance,
          si.status,
          so.order_number as sales_order_number,
          (SELECT COUNT(*) FROM dealer_shipments ds WHERE ds.main_sales_invoice_id = si.id)::int as dispatch_count,
          (SELECT status FROM dealer_shipments ds WHERE ds.main_sales_invoice_id = si.id ORDER BY ds.created_at DESC LIMIT 1) as latest_dispatch_status
        FROM sales_invoices si
        LEFT JOIN sales_orders so ON si.sales_order_id = so.id
        WHERE si.business_id = $1 AND si.customer_party_id = $2 AND si.status = 'POSTED'
      `;
      const params: any[] = [mainBusinessId, partyId];

      if (options.search && options.search.trim()) {
        params.push(`%${options.search.trim().toLowerCase()}%`);
        query += ` AND (LOWER(si.invoice_number) LIKE $${params.length} OR LOWER(COALESCE(so.order_number, '')) LIKE $${params.length})`;
      }

      query += ` ORDER BY si.invoice_date DESC, si.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const res = await client.query(query, params);
      const countRes = await client.query(
        `SELECT COUNT(*)::int as total FROM sales_invoices WHERE business_id = $1 AND customer_party_id = $2 AND status = 'POSTED'`,
        [mainBusinessId, partyId]
      );
      const total = countRes.rows[0]?.total || 0;

      return {
        invoices: res.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 6. GET Dispatches / Shipments from Main to this Dealer
   */
  static async getDealerDispatches(mainBusinessId: string, dealerBusinessId: string, options: { page?: number; limit?: number } = {}) {
    const client = await pool.connect();
    try {
      const page = Math.max(1, Number(options.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
      const offset = (page - 1) * limit;

      const res = await client.query(
        `SELECT 
           ds.id,
           ds.shipment_number,
           ds.dispatch_date,
           ds.courier_name,
           ds.tracking_number,
           ds.vehicle_number,
           ds.eway_bill_number,
           ds.total_packages,
           ds.total_quantity,
           ds.status,
           ds.notes,
           si.invoice_number,
           d.order_number as dealer_order_number,
           COALESCE(grn_stat.total_received, 0)::numeric(12, 2) as received_quantity,
           COALESCE(grn_stat.total_damaged, 0)::numeric(12, 2) as damaged_quantity,
           COALESCE(grn_stat.total_short, 0)::numeric(12, 2) as short_quantity,
           (ds.total_quantity - COALESCE(grn_stat.total_received, 0) - COALESCE(grn_stat.total_damaged, 0) - COALESCE(grn_stat.total_short, 0))::numeric(12, 2) as pending_receipt_quantity
         FROM dealer_shipments ds
         LEFT JOIN sales_invoices si ON ds.main_sales_invoice_id = si.id
         LEFT JOIN dealer_orders d ON ds.dealer_order_id = d.id
         LEFT JOIN LATERAL (
           SELECT 
             SUM(received_quantity) as total_received,
             SUM(damaged_quantity) as total_damaged,
             SUM(short_quantity) as total_short
           FROM dealer_shipment_lines
           WHERE dealer_shipment_id = ds.id
         ) grn_stat ON true
         WHERE ds.main_business_id = $1 AND ds.dealer_business_id = $2
         ORDER BY ds.dispatch_date DESC, ds.created_at DESC
         LIMIT $3 OFFSET $4`,
        [mainBusinessId, dealerBusinessId, limit, offset]
      );

      const countRes = await client.query(
        `SELECT COUNT(*)::int as total FROM dealer_shipments WHERE main_business_id = $1 AND dealer_business_id = $2`,
        [mainBusinessId, dealerBusinessId]
      );
      const total = countRes.rows[0]?.total || 0;

      return {
        dispatches: res.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 7. GET Outstanding Statement & Aging for this Dealer
   */
  static async getDealerOutstanding(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      const partyId = await this.resolveDealerPartyId(client, mainBusinessId, dealerBusinessId);
      if (!partyId) {
        return {
          currentOutstanding: 0,
          overdueAmount: 0,
          creditLimit: 0,
          creditDays: 0,
          availableCredit: null,
          oldestDueDate: null,
          aging: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90Plus: 0 },
          invoices: [],
          ledger: [],
        };
      }

      // Party Info
      const pRes = await client.query(
        `SELECT credit_limit, credit_days FROM parties WHERE id = $1 AND business_id = $2`,
        [partyId, mainBusinessId]
      );
      const creditLimit = parseFloat(pRes.rows[0]?.credit_limit || '0.00');
      const creditDays = parseInt(pRes.rows[0]?.credit_days || '0', 10);

      // Latest customer ledger balance
      const clRes = await client.query(
        `SELECT balance FROM customer_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY created_at DESC LIMIT 1`,
        [mainBusinessId, partyId]
      );
      const currentOutstanding = Math.max(0, parseFloat(clRes.rows[0]?.balance || '0.00'));

      // Unpaid Sales Invoices with aging calculation
      const invRes = await client.query(
        `SELECT 
           si.id,
           si.invoice_number,
           si.invoice_date,
           si.due_date,
           si.grand_total,
           si.paid_amount,
           si.balance,
           CURRENT_DATE - COALESCE(si.due_date::date, si.invoice_date::date) as days_overdue
         FROM sales_invoices si
         WHERE si.business_id = $1 AND si.customer_party_id = $2 
           AND si.status = 'POSTED' AND si.balance > 0
         ORDER BY si.invoice_date ASC`,
        [mainBusinessId, partyId]
      );

      let overdueAmount = 0;
      let oldestDueDate: string | null = null;
      const aging = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90Plus: 0 };

      const invoices = invRes.rows.map((r: any) => {
        const bal = parseFloat(r.balance || '0.00');
        const days = parseInt(r.days_overdue || '0', 10);

        if (days > 0) {
          overdueAmount += bal;
          if (!oldestDueDate || (r.due_date && new Date(r.due_date) < new Date(oldestDueDate))) {
            oldestDueDate = r.due_date;
          }

          if (days <= 30) aging.days1to30 += bal;
          else if (days <= 60) aging.days31to60 += bal;
          else if (days <= 90) aging.days61to90 += bal;
          else aging.days90Plus += bal;
        } else {
          aging.current += bal;
        }

        return {
          id: r.id,
          invoiceNumber: r.invoice_number,
          invoiceDate: r.invoice_date,
          dueDate: r.due_date,
          grandTotal: parseFloat(r.grand_total),
          paidAmount: parseFloat(r.paid_amount),
          balance: bal,
          daysOverdue: days,
        };
      });

      // Recent 20 Customer Ledger entries
      const ledgerRes = await client.query(
        `SELECT 
           id,
           voucher_type,
           voucher_number,
           debit,
           credit,
           balance,
           narration,
           created_at
         FROM customer_ledgers 
         WHERE business_id = $1 AND party_id = $2 
         ORDER BY created_at DESC LIMIT 20`,
        [mainBusinessId, partyId]
      );

      return {
        currentOutstanding,
        overdueAmount,
        creditLimit,
        creditDays,
        availableCredit: creditLimit > 0 ? Math.max(0, creditLimit - currentOutstanding) : null,
        oldestDueDate,
        aging,
        invoices,
        ledger: ledgerRes.rows,
      };
    } finally {
      client.release();
    }
  }

  /**
   * 8. GET Relationship Activity Timeline
   */
  static async getDealerActivity(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      const partyId = await this.resolveDealerPartyId(client, mainBusinessId, dealerBusinessId);

      const events: any[] = [];

      // 1. Dealer Orders
      const doRes = await client.query(
        `SELECT id, order_number, grand_total, total_quantity, status, created_at
         FROM dealer_orders 
         WHERE main_business_id = $1 AND dealer_business_id = $2 
         ORDER BY created_at DESC LIMIT 15`,
        [mainBusinessId, dealerBusinessId]
      );
      for (const o of doRes.rows) {
        events.push({
          type: 'DEALER_ORDER',
          title: `Dealer Order Placed #${o.order_number}`,
          description: `Total ${o.total_quantity} units | Value: ₹${parseFloat(o.grand_total).toLocaleString('en-IN')}`,
          status: o.status,
          date: o.created_at,
          link: `/dealer/orders`,
        });
      }

      // 2. Main Sales Orders
      const soRes = await client.query(
        `SELECT so.id, so.order_number, so.grand_total, so.status, so.created_at
         FROM sales_orders so
         WHERE so.business_id = $1 
           AND (so.party_id = $2 OR so.id IN (SELECT main_sales_order_id FROM dealer_orders WHERE dealer_business_id = $3))
         ORDER BY so.created_at DESC LIMIT 15`,
        [mainBusinessId, partyId, dealerBusinessId]
      );
      for (const so of soRes.rows) {
        events.push({
          type: 'SALES_ORDER',
          title: `Sales Order Confirmed #${so.order_number}`,
          description: `Stock reserved at Main Warehouse | Value: ₹${parseFloat(so.grand_total).toLocaleString('en-IN')}`,
          status: so.status,
          date: so.created_at,
          link: `/sales/orders`,
        });
      }

      // 3. Sales Invoices
      if (partyId) {
        const siRes = await client.query(
          `SELECT id, invoice_number, grand_total, invoice_date, created_at
           FROM sales_invoices 
           WHERE business_id = $1 AND customer_party_id = $2 AND status = 'POSTED'
           ORDER BY created_at DESC LIMIT 15`,
          [mainBusinessId, partyId]
        );
        for (const si of siRes.rows) {
          events.push({
            type: 'SALES_INVOICE',
            title: `Tax Invoice Generated #${si.invoice_number}`,
            description: `Amount: ₹${parseFloat(si.grand_total).toLocaleString('en-IN')}`,
            status: 'POSTED',
            date: si.created_at || si.invoice_date,
            link: `/sales/invoices`,
          });
        }
      }

      // 4. Dispatches
      const dsRes = await client.query(
        `SELECT id, shipment_number, total_quantity, courier_name, tracking_number, status, dispatch_date
         FROM dealer_shipments 
         WHERE main_business_id = $1 AND dealer_business_id = $2 
         ORDER BY dispatch_date DESC LIMIT 15`,
        [mainBusinessId, dealerBusinessId]
      );
      for (const ds of dsRes.rows) {
        events.push({
          type: 'SHIPMENT',
          title: `Consignment Dispatched #${ds.shipment_number}`,
          description: `${ds.total_quantity} units via ${ds.courier_name || 'Direct Vehicle'} ${ds.tracking_number ? `(AWB: ${ds.tracking_number})` : ''}`,
          status: ds.status,
          date: ds.dispatch_date,
        });
      }

      // 5. Goods Receipts at Dealer
      const grnRes = await client.query(
        `SELECT grn.id, grn.receipt_number, grn.total_received_qty, grn.status, grn.receipt_date, ds.shipment_number
         FROM dealer_goods_receipts grn
         JOIN dealer_shipments ds ON grn.dealer_shipment_id = ds.id
         WHERE grn.main_business_id = $1 AND grn.dealer_business_id = $2 
         ORDER BY grn.receipt_date DESC LIMIT 15`,
        [mainBusinessId, dealerBusinessId]
      );
      for (const g of grnRes.rows) {
        events.push({
          type: 'GOODS_RECEIPT',
          title: `Goods Received at Dealer #${g.receipt_number}`,
          description: `Intake confirmed for shipment #${g.shipment_number} (${g.total_received_qty} units)`,
          status: g.status,
          date: g.receipt_date,
        });
      }

      // 6. Customer Payments from Dealer
      if (partyId) {
        const cpRes = await client.query(
          `SELECT cl.id, cl.voucher_number, cl.credit as amount, cl.narration, cl.created_at
           FROM customer_ledgers cl
           WHERE cl.business_id = $1 AND cl.party_id = $2 AND cl.credit > 0
           ORDER BY cl.created_at DESC LIMIT 15`,
          [mainBusinessId, partyId]
        );
        for (const cp of cpRes.rows) {
          events.push({
            type: 'PAYMENT',
            title: `Payment Received #${cp.voucher_number || 'REC'}`,
            description: `Credited ₹${parseFloat(cp.amount).toLocaleString('en-IN')} | ${cp.narration || 'Payment received'}`,
            status: 'RECEIVED',
            date: cp.created_at,
          });
        }
      }

      // Sort by date DESC
      events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return events.slice(0, 30);
    } finally {
      client.release();
    }
  }

  /**
   * 9. GET Dealer Stock (Optional Sharing - Strictly Privacy Preserving)
   */
  static async getDealerStock(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      // 1. Verify tenant relationship
      const dealerRes = await client.query(
        `SELECT b.id, b.name, b.settings_config as b_config, bs.config as bs_config
         FROM businesses b
         LEFT JOIN business_settings bs ON bs.business_id = b.id
         WHERE b.id = $1 AND b.parent_business_id = $2 AND b.business_type = 'DEALER'`,
        [dealerBusinessId, mainBusinessId]
      );
      if (dealerRes.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }
      const dealer = dealerRes.rows[0];

      // 2. Check Dealer's stock sharing setting (Default is OFF)
      const settingsRes = await BusinessSettingsService.getSettings(dealerBusinessId).catch(() => null);
      const bsDealerShare = settingsRes?.settings?.dealer?.shareStockWithMain;
      const bConf = dealer.b_config || {};
      const bsConf = dealer.bs_config || {};
      const shareVal = 
        bConf?.dealer?.shareStockWithMain ?? 
        bConf?.settings?.dealer?.shareStockWithMain ??
        bsConf?.dealer?.shareStockWithMain ?? 
        bsConf?.settings?.dealer?.shareStockWithMain ??
        bsDealerShare;
      const shareStockWithMain = shareVal === true || shareVal === 'true';

      if (!shareStockWithMain) {
        return {
          sharingEnabled: false,
          dealerName: dealer.name,
          message: `${dealer.name} has not enabled inventory sharing with Main Warehouse. Local inventory is kept strictly private by default.`,
          items: [],
        };
      }

      // 3. Query Dealer stock: Item Name, Category, Batch, Power, Available Qty ONLY
      // NO cost, NO purchase rate, NO selling price, NO margins, NO customers!
      const stockRes = await client.query(
        `SELECT 
           COALESCE(pi.name, ui.name) as primary_item_name,
           c.name as category_name,
           c.code as category_code,
           ob.barcode as batch_number,
           ob.sph,
           ob.cyl,
           ob.axis,
           ob.add,
           ob.side,
           GREATEST(os.available_stock, 0)::numeric(12, 2) as available_stock,
           os.physical_stock::numeric(12, 2) as physical_stock,
           os.reserved_stock::numeric(12, 2) as reserved_stock
         FROM optical_stocks os
         JOIN optical_batches ob ON os.batch_id = ob.id
         JOIN unique_items ui ON ob.unique_item_id = ui.id
         LEFT JOIN primary_items pi ON ui.primary_item_id = pi.id
         LEFT JOIN categories c ON ob.category_id = c.id
         WHERE os.business_id = $1 AND os.available_stock > 0
         ORDER BY COALESCE(pi.name, ui.name) ASC, ob.sph ASC, ob.cyl ASC
         LIMIT 200`,
        [dealerBusinessId]
      );

      return {
        sharingEnabled: true,
        dealerName: dealer.name,
        message: `Showing authoritative available inventory shared by ${dealer.name}. Cost, margins, and customers are strictly excluded.`,
        items: stockRes.rows,
      };
    } finally {
      client.release();
    }
  }

  static async getDealerStockSharing(mainBusinessId: string, dealerBusinessId: string) {
    return this.getDealerStock(mainBusinessId, dealerBusinessId);
  }

  /**
   * 10. GET Reconciliation Comparison for Super Admin / Main Admin
   * Non-destructive: Compares Main Customer Ledger vs Dealer Supplier Ledger
   */
  static async getReconciliation(mainBusinessId: string, dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      // 1. Verify tenant relationship
      const dealerRes = await client.query(
        `SELECT b.id, b.name, b.trade_name, m.name as main_name 
         FROM businesses b
         JOIN businesses m ON b.parent_business_id = m.id
         WHERE b.id = $1 AND b.parent_business_id = $2 AND b.business_type = 'DEALER'`,
        [dealerBusinessId, mainBusinessId]
      );
      if (dealerRes.rows.length === 0) {
        throw new Error('Dealer not found or does not belong to this Main Warehouse.');
      }
      const { name: dealerName, main_name: mainName } = dealerRes.rows[0];

      // 2. Main's Customer Ledger balance for Dealer
      const partyIdInMain = await this.resolveDealerPartyId(client, mainBusinessId, dealerBusinessId);
      let mainCustomerBalance = 0;
      let lastMainLedgerDate: string | null = null;

      if (partyIdInMain) {
        const clRes = await client.query(
          `SELECT balance, created_at FROM customer_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY created_at DESC LIMIT 1`,
          [mainBusinessId, partyIdInMain]
        );
        if (clRes.rows.length > 0) {
          mainCustomerBalance = parseFloat(clRes.rows[0].balance || '0.00');
          lastMainLedgerDate = clRes.rows[0].created_at;
        }
      }

      // 3. Dealer's Supplier Ledger balance for Main
      const partyResInDealer = await client.query(
        `SELECT id FROM parties 
         WHERE business_id = $1 AND party_type IN ('SUPPLIER', 'BOTH')
           AND (
             notes LIKE $2
             OR LOWER(name) = LOWER($3)
             OR (display_name IS NOT NULL AND LOWER(display_name) = LOWER($3))
           )
         ORDER BY created_at DESC LIMIT 1`,
        [dealerBusinessId, `%[MAIN_BIZ:${mainBusinessId}]%`, mainName]
      );

      let dealerSupplierBalance = 0;
      let lastDealerLedgerDate: string | null = null;
      if (partyResInDealer.rows.length > 0) {
        const supPartyId = partyResInDealer.rows[0].id;
        const slRes = await client.query(
          `SELECT balance, created_at FROM supplier_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY created_at DESC LIMIT 1`,
          [dealerBusinessId, supPartyId]
        );
        if (slRes.rows.length > 0) {
          dealerSupplierBalance = parseFloat(slRes.rows[0].balance || '0.00');
          lastDealerLedgerDate = slRes.rows[0].created_at;
        }
      }

      // 4. Query payments awaiting verification
      const pendingPayRes = await client.query(
        `SELECT id, advice_number, amount, payment_date, payment_mode, reference_number, created_at
         FROM dealer_payment_advices
         WHERE dealer_business_id = $1 AND main_business_id = $2 AND status = 'SUBMITTED'
         ORDER BY payment_date DESC`,
        [dealerBusinessId, mainBusinessId]
      );
      const pendingAdvices = pendingPayRes.rows.map(r => ({
        id: r.id,
        adviceNumber: r.advice_number,
        amount: parseFloat(r.amount),
        paymentDate: r.payment_date,
        paymentMode: r.payment_mode,
        referenceNumber: r.reference_number,
        createdAt: r.created_at,
      }));
      const paymentsAwaitingVerification = pendingAdvices.reduce((sum, a) => Math.round((sum + a.amount) * 100) / 100, 0);

      const difference = Math.round((mainCustomerBalance - dealerSupplierBalance) * 100) / 100;
      const reconciledDifference = Math.round((difference - paymentsAwaitingVerification) * 100) / 100;

      let status = 'DIFFERENCE';
      const notes: string[] = [];

      if (Math.abs(difference) < 0.01) {
        status = 'MATCHED';
        notes.push('Ledgers are fully reconciled. Main Customer Ledger matches Dealer Supplier Ledger exactly.');
      } else if (Math.abs(reconciledDifference) < 0.01 && paymentsAwaitingVerification > 0) {
        status = 'TIMING_PENDING_PAYMENTS';
        notes.push(`The temporary discrepancy of ₹${difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })} is explained by ₹${paymentsAwaitingVerification.toLocaleString('en-IN', { minimumFractionDigits: 2 })} in payment advices recorded by Dealer awaiting Main Warehouse verification.`);
      } else {
        notes.push(`Discrepancy of ₹${Math.abs(difference).toLocaleString('en-IN', { minimumFractionDigits: 2 })} detected.`);
        if (paymentsAwaitingVerification > 0) {
          notes.push(`₹${paymentsAwaitingVerification.toLocaleString('en-IN', { minimumFractionDigits: 2 })} is currently awaiting verification by Main Warehouse.`);
        }
        notes.push('Legitimate timing differences may occur when dispatches/goods receipts are in-transit, pending invoice conversion, or payments are awaiting posting on either side.');
      }

      return {
        dealerName,
        mainName,
        mainCustomerBalance,
        dealerSupplierBalance,
        difference,
        paymentsAwaitingVerification,
        reconciledDifference,
        pendingAdvices,
        status,
        lastMainLedgerDate,
        lastDealerLedgerDate,
        reconciledAt: new Date().toISOString(),
        notes,
      };
    } finally {
      client.release();
    }
  }
}
