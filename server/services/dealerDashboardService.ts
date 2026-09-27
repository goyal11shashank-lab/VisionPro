import { pool } from '../db/index.js';

export class DealerDashboardService {
  /**
   * Helper: Resolve Parent Main Warehouse ID for this Dealer
   */
  static async resolveParentMainWarehouse(client: any, dealerBusinessId: string) {
    const bizRes = await client.query(
      `SELECT id, name, trade_name, business_type, parent_business_id, gstin, phone, email, city, state 
       FROM businesses WHERE id = $1`,
      [dealerBusinessId]
    );

    if (bizRes.rows.length === 0) {
      throw new Error('Dealer business not found.');
    }

    const dealerBiz = bizRes.rows[0];
    if (dealerBiz.business_type !== 'DEALER') {
      throw new Error('This business is not a DEALER business type.');
    }

    let mainWarehouseId = dealerBiz.parent_business_id;
    if (!mainWarehouseId) {
      // Fallback to first active MAIN business if parent is not explicitly linked
      const firstMainRes = await client.query(
        `SELECT id FROM businesses WHERE business_type = 'MAIN' AND status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1`
      );
      if (firstMainRes.rows.length > 0) {
        mainWarehouseId = firstMainRes.rows[0].id;
      }
    }

    if (!mainWarehouseId) {
      throw new Error('No Main Warehouse assigned to this Dealer.');
    }

    const mainRes = await client.query(
      `SELECT id, name, trade_name, gstin, phone, email, city, state, status FROM businesses WHERE id = $1`,
      [mainWarehouseId]
    );

    if (mainRes.rows.length === 0) {
      throw new Error('Assigned Main Warehouse not found.');
    }

    return {
      dealerBiz,
      mainWarehouse: mainRes.rows[0],
    };
  }

  /**
   * Helper: Resolve Main Warehouse Supplier Party in Dealer's business
   */
  static async resolveMainWarehouseSupplierParty(client: any, dealerBusinessId: string, mainWarehouse: any): Promise<string | null> {
    const partyRes = await client.query(
      `SELECT id FROM parties 
       WHERE business_id = $1 AND party_type IN ('SUPPLIER', 'BOTH')
         AND (
           notes LIKE $2
           OR LOWER(name) = LOWER($3)
           OR (display_name IS NOT NULL AND LOWER(display_name) = LOWER($3))
           OR ($4 <> '' AND gstin IS NOT NULL AND UPPER(gstin) = UPPER($4))
         )
       ORDER BY created_at DESC LIMIT 1`,
      [
        dealerBusinessId,
        `%[MAIN_BIZ:${mainWarehouse.id}]%`,
        mainWarehouse.name,
        mainWarehouse.gstin || '',
      ]
    );

    return partyRes.rows.length > 0 ? partyRes.rows[0].id : null;
  }

  /**
   * GET Purpose-built Dealer Dashboard Summary
   */
  static async getDealerDashboardSummary(dealerBusinessId: string) {
    const client = await pool.connect();
    try {
      const { dealerBiz, mainWarehouse } = await this.resolveParentMainWarehouse(client, dealerBusinessId);

      // 1. KPI 1: MY AVAILABLE STOCK
      // Dealer's actual authoritative available inventory (not including ordered/incoming)
      const localStockRes = await client.query(
        `SELECT COALESCE(SUM(GREATEST(available_stock, 0)), 0)::numeric(12, 2) AS my_available_stock,
                COALESCE(SUM(physical_stock), 0)::numeric(12, 2) AS my_physical_stock,
                COALESCE(SUM(reserved_stock), 0)::numeric(12, 2) AS my_reserved_stock
         FROM optical_stocks 
         WHERE business_id = $1`,
        [dealerBusinessId]
      );
      const myAvailableStock = parseFloat(localStockRes.rows[0]?.my_available_stock || '0.00');
      const myPhysicalStock = parseFloat(localStockRes.rows[0]?.my_physical_stock || '0.00');
      const myReservedStock = parseFloat(localStockRes.rows[0]?.my_reserved_stock || '0.00');

      // 2. KPI 2: MAIN WAREHOUSE AVAILABLE
      // Read-only real-time availability from parent Main Warehouse
      const mainStockRes = await client.query(
        `SELECT COALESCE(SUM(GREATEST(available_stock, 0)), 0)::numeric(12, 2) AS main_available_stock
         FROM optical_stocks 
         WHERE business_id = $1`,
        [mainWarehouse.id]
      );
      const mainWarehouseAvailable = parseFloat(mainStockRes.rows[0]?.main_available_stock || '0.00');

      // 3. KPI 3: ON ORDER
      // Open Dealer Purchase Order quantities from Main Warehouse not yet received/converted
      const onOrderRes = await client.query(
        `SELECT 
           COALESCE(SUM(total_quantity), 0)::numeric(12, 2) AS on_order_qty
         FROM dealer_orders 
         WHERE dealer_business_id = $1 
           AND status IN ('CONFIRMED', 'PENDING', 'PROCESSING', 'PACKED')`,
        [dealerBusinessId]
      );
      const onOrderQuantity = parseFloat(onOrderRes.rows[0]?.on_order_qty || '0.00');

      // 4. KPI 4: INCOMING
      // Dispatched quantities not yet accepted/received
      const incomingRes = await client.query(
        `SELECT 
           COALESCE(SUM(ds.total_quantity - (
             SELECT COALESCE(SUM(received_quantity + damaged_quantity + short_quantity), 0)
             FROM dealer_shipment_lines WHERE dealer_shipment_id = ds.id
           )), 0)::numeric(12, 2) AS incoming_qty
         FROM dealer_shipments ds
         WHERE ds.dealer_business_id = $1 
           AND ds.status IN ('DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')`,
        [dealerBusinessId]
      );
      const incomingQuantity = parseFloat(incomingRes.rows[0]?.incoming_qty || '0.00');

      // 5. KPI 5: OUTSTANDING TO MAIN
      // Dealer's payable to linked Main Warehouse Supplier Party from Dealer's supplier_ledger
      const mainSupplierPartyId = await this.resolveMainWarehouseSupplierParty(client, dealerBusinessId, mainWarehouse);
      let outstandingToMain = 0;
      let overdueAmount = 0;

      if (mainSupplierPartyId) {
        const slRes = await client.query(
          `SELECT balance FROM supplier_ledgers 
           WHERE business_id = $1 AND party_id = $2 
           ORDER BY created_at DESC LIMIT 1`,
          [dealerBusinessId, mainSupplierPartyId]
        );
        if (slRes.rows.length > 0) {
          outstandingToMain = Math.max(0, parseFloat(slRes.rows[0].balance || '0.00'));
        }

        // Overdue calculation from Purchase Invoices
        const overdueRes = await client.query(
          `SELECT COALESCE(SUM(
             pi.grand_total 
             - COALESCE((
                 SELECT SUM(pa.allocated_amount)
                 FROM payment_allocations pa
                 JOIN payments pmt ON pmt.id = pa.payment_id
                 WHERE pa.document_id = pi.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
               ), 0)
             - COALESCE((
                 SELECT SUM(pr.grand_total)
                 FROM purchase_returns pr
                 WHERE pr.purchase_invoice_id = pi.id AND pr.status = 'POSTED'
               ), 0)
           ), 0)::numeric(12, 2) as overdue
           FROM purchase_invoices pi
           JOIN parties p ON p.id = pi.supplier_party_id
           WHERE pi.business_id = $1 AND pi.supplier_party_id = $2 
             AND pi.status = 'POSTED'
             AND (pi.invoice_date + (COALESCE(NULLIF(p.credit_days, ''), '0')::int * INTERVAL '1 day')) < NOW()
             AND (
               pi.grand_total 
               - COALESCE((
                   SELECT SUM(pa.allocated_amount)
                   FROM payment_allocations pa
                   JOIN payments pmt ON pmt.id = pa.payment_id
                   WHERE pa.document_id = pi.id AND pa.status = 'ACTIVE' AND pmt.status = 'POSTED'
                 ), 0)
               - COALESCE((
                   SELECT SUM(pr.grand_total)
                   FROM purchase_returns pr
                   WHERE pr.purchase_invoice_id = pi.id AND pr.status = 'POSTED'
                 ), 0)
             ) > 0`,
          [dealerBusinessId, mainSupplierPartyId]
        );
        overdueAmount = parseFloat(overdueRes.rows[0]?.overdue || '0.00');
      }

      // 5b. PAYMENTS AWAITING VERIFICATION (Submitted Payment Advices not yet verified by Main)
      const pendingPayRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric(12, 2) as pending_amount,
                COUNT(*)::int as pending_count
         FROM dealer_payment_advices
         WHERE dealer_business_id = $1 AND status = 'SUBMITTED'`,
        [dealerBusinessId]
      );
      const paymentsAwaitingVerification = parseFloat(pendingPayRes.rows[0]?.pending_amount || '0.00');
      const paymentsAwaitingCount = pendingPayRes.rows[0]?.pending_count || 0;

      // 6. NEEDS ATTENTION: Operational alerts
      const shipmentsAwaitingReceiptRes = await client.query(
        `SELECT COUNT(*)::int as count 
         FROM dealer_shipments 
         WHERE dealer_business_id = $1 AND status IN ('DISPATCHED', 'IN_TRANSIT')`,
        [dealerBusinessId]
      );
      const shipmentsAwaitingReceipt = shipmentsAwaitingReceiptRes.rows[0]?.count || 0;

      const partiallyReceivedRes = await client.query(
        `SELECT COUNT(*)::int as count 
         FROM dealer_shipments 
         WHERE dealer_business_id = $1 AND status = 'PARTIALLY_RECEIVED'`,
        [dealerBusinessId]
      );
      const partiallyReceivedShipments = partiallyReceivedRes.rows[0]?.count || 0;

      const openOrdersCountRes = await client.query(
        `SELECT COUNT(*)::int as count 
         FROM dealer_orders 
         WHERE dealer_business_id = $1 AND status IN ('CONFIRMED', 'PENDING', 'PROCESSING')`,
        [dealerBusinessId]
      );
      const openOrdersCount = openOrdersCountRes.rows[0]?.count || 0;

      // 6b. RETURNS ATTENTION
      const returnsCountRes = await client.query(
        `SELECT 
           COUNT(*) FILTER (WHERE status = 'REQUESTED')::int as requested_count,
           COUNT(*) FILTER (WHERE status = 'APPROVED')::int as approved_awaiting_dispatch,
           COUNT(*) FILTER (WHERE status = 'IN_TRANSIT')::int as in_transit_count
         FROM dealer_returns 
         WHERE dealer_business_id = $1`,
        [dealerBusinessId]
      );
      const returnStats = {
        requestedCount: returnsCountRes.rows[0]?.requested_count || 0,
        approvedAwaitingDispatch: returnsCountRes.rows[0]?.approved_awaiting_dispatch || 0,
        inTransitCount: returnsCountRes.rows[0]?.in_transit_count || 0,
      };

      // 7. RECENT ORDERS (Latest 5 with status lifecycle)
      const recentOrdersRes = await client.query(
        `SELECT 
           d.id,
           d.order_number,
           d.item_count,
           d.total_quantity,
           d.grand_total,
           d.status,
           d.created_at,
           so.order_number as sales_order_number,
           po.order_number as purchase_order_number,
           (SELECT status FROM dealer_shipments ds WHERE ds.dealer_order_id = d.id ORDER BY ds.created_at DESC LIMIT 1) as latest_shipment_status
         FROM dealer_orders d
         LEFT JOIN sales_orders so ON d.main_sales_order_id = so.id
         LEFT JOIN purchase_orders po ON d.dealer_purchase_order_id = po.id
         WHERE d.dealer_business_id = $1
         ORDER BY d.created_at DESC LIMIT 5`,
        [dealerBusinessId]
      );

      // 8. INCOMING SHIPMENTS (Latest 5 with pending receipt & action to receive)
      const incomingShipmentsRes = await client.query(
        `SELECT 
           ds.id,
           ds.shipment_number,
           ds.dispatch_date,
           ds.total_quantity,
           ds.courier_name,
           ds.tracking_number,
           ds.status,
           si.invoice_number,
           d.order_number as dealer_order_number,
           COALESCE(grn_stat.total_received, 0)::numeric(12, 2) as received_quantity,
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
         WHERE ds.dealer_business_id = $1 
           AND ds.status IN ('DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')
         ORDER BY ds.dispatch_date DESC LIMIT 5`,
        [dealerBusinessId]
      );

      // 8b. RECENT DEALER RETURNS (Latest 5)
      const recentReturnsRes = await client.query(
        `SELECT 
           dr.id,
           dr.return_number,
           dr.created_at,
           dr.status,
           dr.return_reason,
           dr.total_requested_qty,
           dr.total_approved_qty,
           dr.total_sent_qty,
           dr.total_received_qty,
           dr.total_accepted_qty,
           dr.total_damaged_qty,
           pi.invoice_number as purchase_invoice_number
         FROM dealer_returns dr
         JOIN purchase_invoices pi ON dr.dealer_purchase_invoice_id = pi.id
         WHERE dr.dealer_business_id = $1
         ORDER BY dr.created_at DESC LIMIT 5`,
        [dealerBusinessId]
      );

      // 9. LOW / ZERO LOCAL STOCK (Items with <= 0 available stock or negative stock)
      const lowStockRes = await client.query(
        `SELECT 
           pi.name as primary_item_name,
           c.name as category_name,
           ob.barcode as batch_number,
           ob.sph,
           ob.cyl,
           ob.axis,
           ob.add,
           ob.side,
           os.available_stock::numeric(12, 2) as available_stock,
           os.physical_stock::numeric(12, 2) as physical_stock,
           os.reserved_stock::numeric(12, 2) as reserved_stock
         FROM optical_stocks os
         JOIN optical_batches ob ON os.batch_id = ob.id
         JOIN unique_items ui ON ob.unique_item_id = ui.id
         JOIN primary_items pi ON ui.primary_item_id = pi.id
         LEFT JOIN categories c ON ob.category_id = c.id
         WHERE os.business_id = $1 AND os.available_stock <= 1.00
         ORDER BY os.available_stock ASC, pi.name ASC
         LIMIT 6`,
        [dealerBusinessId]
      );

      // 10. Check Dealer's stock sharing setting
      const settingsRes = await client.query(
        `SELECT config FROM business_settings WHERE business_id = $1`,
        [dealerBusinessId]
      );
      const config = settingsRes.rows[0]?.config || {};
      const settings = config.settings || config;
      const stockSharingEnabled = Boolean(settings?.dealer?.shareStockWithMain);

      return {
        dealerBusiness: {
          id: dealerBiz.id,
          name: dealerBiz.name,
          tradeName: dealerBiz.trade_name,
          city: dealerBiz.city,
          gstin: dealerBiz.gstin,
        },
        mainWarehouse: {
          id: mainWarehouse.id,
          name: mainWarehouse.name,
          tradeName: mainWarehouse.trade_name,
          city: mainWarehouse.city,
          phone: mainWarehouse.phone,
          email: mainWarehouse.email,
        },
        linkedSupplierPartyId: mainSupplierPartyId,
        kpis: {
          myAvailableStock,
          myPhysicalStock,
          myReservedStock,
          mainWarehouseAvailable,
          onOrderQuantity,
          incomingQuantity,
          outstandingToMain,
          supplierPayable: outstandingToMain,
          overdueAmount,
          paymentsAwaitingVerification,
          paymentsAwaitingCount,
        },
        needsAttention: {
          shipmentsAwaitingReceipt,
          partiallyReceivedShipments,
          openOrdersCount,
          overdueAmount,
          paymentsAwaitingVerification,
          paymentsAwaitingCount,
          returnsApprovedAwaitingDispatch: returnStats.approvedAwaitingDispatch,
          returnsRequestedCount: returnStats.requestedCount,
          hasUrgentAction:
            shipmentsAwaitingReceipt > 0 ||
            partiallyReceivedShipments > 0 ||
            overdueAmount > 0 ||
            returnStats.approvedAwaitingDispatch > 0 ||
            paymentsAwaitingCount > 0,
        },
        returnStats,
        recentOrders: recentOrdersRes.rows,
        incomingShipments: incomingShipmentsRes.rows,
        recentReturns: recentReturnsRes.rows,
        lowStockItems: lowStockRes.rows,
        stockSharingEnabled,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Search Main Warehouse available stock for quick order widget
   */
  static async searchMainAvailability(dealerBusinessId: string, searchTerm: string, limit: number = 8) {
    const client = await pool.connect();
    try {
      const { mainWarehouse } = await this.resolveParentMainWarehouse(client, dealerBusinessId);

      const queryParams: any[] = [mainWarehouse.id];
      let whereClause = `os.business_id = $1 AND os.available_stock > 0`;

      if (searchTerm && searchTerm.trim()) {
        queryParams.push(`%${searchTerm.trim().toLowerCase()}%`);
        const idx = queryParams.length;
        whereClause += ` AND (
          LOWER(pi.name) LIKE $${idx}
          OR LOWER(COALESCE(c.name, '')) LIKE $${idx}
          OR LOWER(ob.barcode) LIKE $${idx}
        )`;
      }

      queryParams.push(limit);
      const res = await client.query(
        `SELECT 
           ob.id as batch_id,
           ui.id as unique_item_id,
           pi.name as primary_item_name,
           c.name as category_name,
           c.code as category_code,
           ob.barcode as batch_number,
           ob.sph,
           ob.cyl,
           ob.axis,
           ob.add,
           ob.side,
           GREATEST(os.available_stock, 0)::numeric(12, 2) as main_available_stock
         FROM optical_stocks os
         JOIN optical_batches ob ON os.batch_id = ob.id
         JOIN unique_items ui ON ob.unique_item_id = ui.id
         JOIN primary_items pi ON ui.primary_item_id = pi.id
         LEFT JOIN categories c ON ob.category_id = c.id
         WHERE ${whereClause}
         ORDER BY pi.name ASC, ob.sph ASC
         LIMIT $${queryParams.length}`,
        queryParams
      );

      return {
        mainWarehouseName: mainWarehouse.name,
        results: res.rows,
      };
    } finally {
      client.release();
    }
  }
}
