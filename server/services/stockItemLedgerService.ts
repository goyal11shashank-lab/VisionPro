import { pool } from '../db/index.js';

export interface StockItemLedgerFilters {
  from?: string;
  to?: string;
  batchId?: string;
  partyId?: string;
}

export interface MonthlyStockSummary {
  month: string; // YYYY-MM
  monthLabel: string; // e.g. "August 2026"
  openingQty: number;
  purchaseQty: number;
  purchaseValue: number;
  salesQty: number;
  salesValue: number;
  returnIn: number;
  returnOut: number;
  adjustment: number;
  openingStockEntry: number;
  closingQty: number;
  transactionCount: number;
}

export interface StockLedgerTransactionRow {
  id: string;
  date: string;
  transactionType: string;
  transactionLabel: string;
  voucherNo: string;
  voucherId: string | null;
  referenceType: string;
  partyId: string | null;
  partyName: string;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'INTERNAL';
  batchId: string;
  batchBarcode: string;
  batchPower: string;
  sph: number | null;
  cyl: number | null;
  quantityIn: number;
  quantityOut: number;
  reservedIn: number;
  reservedOut: number;
  rate: number;
  value: number;
  runningBalance: number;
  notes: string;
}

export class StockItemLedgerService {
  /**
   * Fetch complete stock item ledger with Tally-style monthly summaries & transaction drill-downs
   */
  static async getLedger(businessId: string, itemId: string, filters: StockItemLedgerFilters = {}) {
    // 1. Fetch Item Master Details
    const itemRes = await pool.query(
      `SELECT 
        ui.id,
        ui.name,
        ui.code,
        ui.description,
        ui.purchase_rate,
        ui.last_purchase_price,
        ui.mrp,
        ui.status,
        pi.name AS primary_item_name,
        c.code AS category_code
      FROM unique_items ui
      LEFT JOIN primary_items pi ON ui.primary_item_id = pi.id
      LEFT JOIN categories c ON pi.category_id = c.id
      WHERE ui.id = $1 AND ui.business_id = $2
      LIMIT 1`,
      [itemId, businessId]
    );

    if (itemRes.rows.length === 0) {
      throw new Error(`Stock Item with ID ${itemId} not found`);
    }

    const itemRow = itemRes.rows[0];
    const defaultPurchaseRate = parseFloat(itemRow.purchase_rate) || 0;
    const defaultMrp = parseFloat(itemRow.mrp) || 0;

    // 2. Fetch all batches for this item with optical stock levels
    const batchesRes = await pool.query(
      `SELECT 
        ob.id,
        ob.barcode,
        ob.sph,
        ob.cyl,
        ob.axis,
        ob.add,
        ob.side,
        COALESCE(os.physical_stock, 0) AS physical_stock,
        COALESCE(os.reserved_stock, 0) AS reserved_stock,
        COALESCE(os.available_stock, 0) AS available_stock
      FROM optical_batches ob
      LEFT JOIN optical_stocks os ON ob.id = os.batch_id
      WHERE ob.unique_item_id = $1 AND ob.business_id = $2
      ORDER BY ob.sph ASC, ob.cyl ASC, ob.barcode ASC`,
      [itemId, businessId]
    );

    const batches = batchesRes.rows.map(b => ({
      id: b.id,
      barcode: b.barcode,
      sph: b.sph !== null ? parseFloat(b.sph) : null,
      cyl: b.cyl !== null ? parseFloat(b.cyl) : null,
      axis: b.axis !== null ? parseFloat(b.axis) : null,
      add: b.add !== null ? parseFloat(b.add) : null,
      side: b.side,
      physicalStock: parseFloat(b.physical_stock) || 0,
      reservedStock: parseFloat(b.reserved_stock) || 0,
      availableStock: parseFloat(b.available_stock) || 0,
    }));

    // Calculate aggregated current stock levels
    let currentPhysicalStock = 0;
    let currentReservedStock = 0;
    let currentAvailableStock = 0;

    if (filters.batchId) {
      const selectedBatch = batches.find(b => b.id === filters.batchId);
      if (selectedBatch) {
        currentPhysicalStock = selectedBatch.physicalStock;
        currentReservedStock = selectedBatch.reservedStock;
        currentAvailableStock = selectedBatch.availableStock;
      }
    } else {
      currentPhysicalStock = batches.reduce((sum, b) => sum + b.physicalStock, 0);
      currentReservedStock = batches.reduce((sum, b) => sum + b.reservedStock, 0);
      currentAvailableStock = batches.reduce((sum, b) => sum + b.availableStock, 0);
    }

    // 3. Query all stock ledger entries for batches belonging to this Stock Item
    const queryParams: any[] = [itemId, businessId];
    let filterClauses = '';

    if (filters.batchId) {
      queryParams.push(filters.batchId);
      filterClauses += ` AND sl.batch_id = $${queryParams.length}`;
    }

    const rawLedgerRes = await pool.query(
      `SELECT 
        sl.id,
        sl.created_at,
        sl.batch_id,
        sl.transaction_type,
        sl.reference_type,
        sl.reference_id,
        sl.quantity_in,
        sl.quantity_out,
        sl.reserved_in,
        sl.reserved_out,
        sl.balance,
        sl.reason,
        ob.barcode AS batch_barcode,
        ob.sph AS batch_sph,
        ob.cyl AS batch_cyl,
        ob.axis AS batch_axis,

        -- Sales Invoice resolution
        si.id AS sales_invoice_id,
        si.invoice_number AS sales_invoice_number,
        si.party_id AS sales_customer_id,
        psi.name AS sales_customer_name,
        sil.rate AS sales_invoice_rate,

        -- Purchase Invoice resolution
        pi.id AS purchase_invoice_id,
        pi.invoice_number AS purchase_invoice_number,
        pi.supplier_party_id AS purchase_supplier_id,
        ppi.name AS purchase_supplier_name,
        pil.rate AS purchase_invoice_rate,

        -- Sales Return resolution
        sr.id AS sales_return_id,
        sr.return_number AS sales_return_number,
        sr.party_id AS return_customer_id,
        psr.name AS return_customer_name,
        srl.rate AS sales_return_rate,

        -- Purchase Return resolution
        pr.id AS purchase_return_id,
        pr.return_number AS purchase_return_number,
        pr.supplier_party_id AS return_supplier_id,
        ppr.name AS return_supplier_name,
        prl.rate AS purchase_return_rate,

        -- Sales Order resolution (for reservations)
        so.id AS sales_order_id,
        so.order_number AS sales_order_number,
        so.party_id AS order_customer_id,
        pso.name AS order_customer_name

      FROM stock_ledger sl
      JOIN optical_batches ob ON sl.batch_id = ob.id
      
      -- Join Sales Invoice details
      LEFT JOIN sales_invoices si ON (sl.reference_type IN ('SALES_INVOICE', 'SALES_INVOICE_CANCEL') AND sl.reference_id = si.id::text)
      LEFT JOIN parties psi ON si.party_id = psi.id
      LEFT JOIN sales_invoice_lines sil ON (sil.sales_invoice_id = si.id AND sil.unique_item_id = ob.unique_item_id)

      -- Join Purchase Invoice details
      LEFT JOIN purchase_invoices pi ON (sl.reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_CANCEL') AND sl.reference_id = pi.id::text)
      LEFT JOIN parties ppi ON pi.supplier_party_id = ppi.id
      LEFT JOIN purchase_invoice_lines pil ON (pil.purchase_invoice_id = pi.id AND pil.unique_item_id = ob.unique_item_id)

      -- Join Sales Return details
      LEFT JOIN sales_returns sr ON (sl.reference_type IN ('SALES_RETURN', 'SALES_RETURN_CANCEL') AND sl.reference_id = sr.id::text)
      LEFT JOIN parties psr ON sr.party_id = psr.id
      LEFT JOIN sales_return_lines srl ON (srl.sales_return_id = sr.id AND srl.unique_item_id = ob.unique_item_id)

      -- Join Purchase Return details
      LEFT JOIN purchase_returns pr ON (sl.reference_type IN ('PURCHASE_RETURN', 'PURCHASE_RETURN_CANCEL') AND sl.reference_id = pr.id::text)
      LEFT JOIN parties ppr ON pr.supplier_party_id = ppr.id
      LEFT JOIN purchase_return_lines prl ON (prl.purchase_return_id = pr.id AND prl.unique_item_id = ob.unique_item_id)

      -- Join Sales Order details
      LEFT JOIN sales_orders so ON (sl.reference_type = 'SALES_ORDER' AND sl.reference_id = so.id::text)
      LEFT JOIN parties pso ON so.party_id = pso.id

      WHERE ob.unique_item_id = $1 AND sl.business_id = $2 ${filterClauses}
      ORDER BY sl.created_at ASC, sl.id ASC`,
      queryParams
    );

    // 4. Transform raw records into normalized transaction models
    const allTransactions: StockLedgerTransactionRow[] = [];
    const partyMap = new Map<string, { id: string; name: string; type: string }>();

    for (const r of rawLedgerRes.rows) {
      const qIn = parseFloat(r.quantity_in) || 0;
      const qOut = parseFloat(r.quantity_out) || 0;
      const resIn = parseFloat(r.reserved_in) || 0;
      const resOut = parseFloat(r.reserved_out) || 0;

      let voucherNo = '';
      let voucherId: string | null = null;
      let partyId: string | null = null;
      let partyName = 'Internal / Adjustment';
      let partyType: 'CUSTOMER' | 'SUPPLIER' | 'INTERNAL' = 'INTERNAL';
      let transactionLabel = r.transaction_type;
      let rate = 0;

      switch (r.transaction_type) {
        case 'PURCHASE':
          transactionLabel = 'Purchase Invoice';
          voucherNo = r.purchase_invoice_number || (r.reason ? r.reason.replace('Purchase Invoice ', '') : 'PUR');
          voucherId = r.purchase_invoice_id || r.reference_id;
          partyId = r.purchase_supplier_id;
          partyName = r.purchase_supplier_name || 'Vendor';
          partyType = 'SUPPLIER';
          rate = parseFloat(r.purchase_invoice_rate) || defaultPurchaseRate;
          break;

        case 'SALE':
          transactionLabel = 'Sales Invoice';
          voucherNo = r.sales_invoice_number || (r.reason ? r.reason.replace('Sales Invoice: ', '') : 'INV');
          voucherId = r.sales_invoice_id || r.reference_id;
          partyId = r.sales_customer_id;
          partyName = r.sales_customer_name || 'Customer';
          partyType = 'CUSTOMER';
          rate = parseFloat(r.sales_invoice_rate) || defaultMrp;
          break;

        case 'SALES_RETURN':
          transactionLabel = 'Sales Return (Credit Note)';
          voucherNo = r.sales_return_number || (r.reason ? r.reason.replace('Sales Return ', '') : 'SR');
          voucherId = r.sales_return_id || r.reference_id;
          partyId = r.return_customer_id;
          partyName = r.return_customer_name || 'Customer';
          partyType = 'CUSTOMER';
          rate = parseFloat(r.sales_return_rate) || defaultMrp;
          break;

        case 'PURCHASE_RETURN':
          transactionLabel = 'Purchase Return (Debit Note)';
          voucherNo = r.purchase_return_number || (r.reason ? r.reason.replace('Purchase Return ', '') : 'PR');
          voucherId = r.purchase_return_id || r.reference_id;
          partyId = r.return_supplier_id;
          partyName = r.return_supplier_name || 'Vendor';
          partyType = 'SUPPLIER';
          rate = parseFloat(r.purchase_return_rate) || defaultPurchaseRate;
          break;

        case 'OPENING_STOCK':
          transactionLabel = 'Opening Stock Initial Entry';
          voucherNo = 'OPENING-STOCK';
          voucherId = null;
          partyName = 'System Initialization';
          partyType = 'INTERNAL';
          rate = defaultPurchaseRate;
          break;

        case 'STOCK_ADJUSTMENT':
          transactionLabel = 'Stock Adjustment';
          voucherNo = 'STK-ADJ';
          voucherId = null;
          partyName = 'Physical Verification';
          partyType = 'INTERNAL';
          rate = defaultPurchaseRate;
          break;

        case 'CANCELLATION_REVERSAL':
          transactionLabel = 'Cancellation Reversal';
          voucherNo = r.sales_invoice_number || r.purchase_invoice_number || 'REVERSAL';
          voucherId = r.reference_id;
          partyName = r.sales_customer_name || r.purchase_supplier_name || 'Transaction Reversal';
          partyType = r.sales_customer_name ? 'CUSTOMER' : r.purchase_supplier_name ? 'SUPPLIER' : 'INTERNAL';
          rate = defaultPurchaseRate;
          break;

        case 'RESERVATION':
        case 'RESERVATION_HOLD':
          transactionLabel = 'Stock Reservation';
          voucherNo = r.sales_order_number || (r.reason ? r.reason.slice(0, 20) : 'RESERVE');
          voucherId = r.sales_order_id || r.reference_id;
          partyId = r.order_customer_id;
          partyName = r.order_customer_name || 'Customer Hold';
          partyType = 'CUSTOMER';
          rate = defaultMrp;
          break;

        case 'RESERVATION_RELEASE':
          transactionLabel = 'Reservation Released';
          voucherNo = r.sales_order_number || 'RELEASE';
          voucherId = r.sales_order_id || r.reference_id;
          partyId = r.order_customer_id;
          partyName = r.order_customer_name || 'Reservation Released';
          partyType = 'CUSTOMER';
          rate = defaultMrp;
          break;

        default:
          transactionLabel = r.transaction_type.replace(/_/g, ' ');
          voucherNo = r.reason ? r.reason.slice(0, 18) : r.reference_type;
          voucherId = r.reference_id;
          partyName = 'Internal Movement';
          partyType = 'INTERNAL';
          rate = defaultPurchaseRate;
          break;
      }

      if (partyId && partyName) {
        partyMap.set(partyId, { id: partyId, name: partyName, type: partyType });
      }

      const sphFormatted = r.batch_sph !== null ? (r.batch_sph >= 0 ? `+${parseFloat(r.batch_sph).toFixed(2)}` : parseFloat(r.batch_sph).toFixed(2)) : '';
      const cylFormatted = r.batch_cyl !== null ? (r.batch_cyl >= 0 ? `+${parseFloat(r.batch_cyl).toFixed(2)}` : parseFloat(r.batch_cyl).toFixed(2)) : '';
      const batchPower = sphFormatted || cylFormatted ? `SPH ${sphFormatted || '0.00'} / CYL ${cylFormatted || '0.00'}` : 'Standard';

      const rowQty = qIn > 0 ? qIn : qOut;
      const value = rowQty * rate;

      allTransactions.push({
        id: r.id,
        date: r.created_at,
        transactionType: r.transaction_type,
        transactionLabel,
        voucherNo,
        voucherId,
        referenceType: r.reference_type,
        partyId,
        partyName,
        partyType,
        batchId: r.batch_id,
        batchBarcode: r.batch_barcode,
        batchPower,
        sph: r.batch_sph !== null ? parseFloat(r.batch_sph) : null,
        cyl: r.batch_cyl !== null ? parseFloat(r.batch_cyl) : null,
        quantityIn: qIn,
        quantityOut: qOut,
        reservedIn: resIn,
        reservedOut: resOut,
        rate,
        value,
        runningBalance: 0, // calculated below
        notes: r.reason || '',
      });
    }

    // 5. Apply Party Filter if requested
    let filteredTransactions = allTransactions;
    if (filters.partyId) {
      filteredTransactions = filteredTransactions.filter(t => t.partyId === filters.partyId);
    }

    // 6. Calculate Opening Balance before the "from" date filter
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (filters.from) {
      fromDate = new Date(filters.from);
      fromDate.setHours(0, 0, 0, 0);
    }
    if (filters.to) {
      toDate = new Date(filters.to);
      toDate.setHours(23, 59, 59, 999);
    }

    let openingBalanceBeforeRange = 0;
    const inRangeTransactions: StockLedgerTransactionRow[] = [];

    for (const tx of filteredTransactions) {
      const txDate = new Date(tx.date);

      if (fromDate && txDate < fromDate) {
        // Transactions prior to start date contribute to opening balance
        openingBalanceBeforeRange += (tx.quantityIn - tx.quantityOut);
      } else if (!toDate || txDate <= toDate) {
        inRangeTransactions.push(tx);
      }
    }

    // 7. Compute Chronological Running Balance for in-range transactions
    let runningPhysicalBalance = openingBalanceBeforeRange;
    for (const tx of inRangeTransactions) {
      runningPhysicalBalance += (tx.quantityIn - tx.quantityOut);
      tx.runningBalance = runningPhysicalBalance;
    }

    // 8. Tally-Style Monthly Summary Calculation
    // Build calendar months representation
    const monthMap = new Map<string, {
      openingQty: number;
      purchaseQty: number;
      purchaseValue: number;
      salesQty: number;
      salesValue: number;
      returnIn: number;
      returnOut: number;
      adjustment: number;
      openingStockEntry: number;
      closingQty: number;
      count: number;
    }>();

    // Determine the range of months to display
    const monthKeys: string[] = [];
    if (inRangeTransactions.length > 0) {
      const earliestTx = new Date(inRangeTransactions[0].date);
      const latestTx = new Date(inRangeTransactions[inRangeTransactions.length - 1].date);
      
      const cur = new Date(earliestTx.getFullYear(), earliestTx.getMonth(), 1);
      const end = new Date(latestTx.getFullYear(), latestTx.getMonth(), 1);

      while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        monthKeys.push(key);
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      // If no transactions in range, show current month
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(currentMonthKey);
    }

    // Initialize month records
    for (const mKey of monthKeys) {
      monthMap.set(mKey, {
        openingQty: 0,
        purchaseQty: 0,
        purchaseValue: 0,
        salesQty: 0,
        salesValue: 0,
        returnIn: 0,
        returnOut: 0,
        adjustment: 0,
        openingStockEntry: 0,
        closingQty: 0,
        count: 0,
      });
    }

    // Aggregate transactions into respective month buckets
    for (const tx of inRangeTransactions) {
      const txDate = new Date(tx.date);
      const mKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;

      let mData = monthMap.get(mKey);
      if (!mData) {
        mData = {
          openingQty: 0,
          purchaseQty: 0,
          purchaseValue: 0,
          salesQty: 0,
          salesValue: 0,
          returnIn: 0,
          returnOut: 0,
          adjustment: 0,
          openingStockEntry: 0,
          closingQty: 0,
          count: 0,
        };
        monthMap.set(mKey, mData);
      }

      mData.count++;

      if (tx.transactionType === 'PURCHASE') {
        mData.purchaseQty += tx.quantityIn;
        mData.purchaseValue += tx.value;
      } else if (tx.transactionType === 'SALE') {
        mData.salesQty += tx.quantityOut;
        mData.salesValue += tx.value;
      } else if (tx.transactionType === 'SALES_RETURN') {
        mData.returnIn += tx.quantityIn;
      } else if (tx.transactionType === 'PURCHASE_RETURN') {
        mData.returnOut += tx.quantityOut;
      } else if (tx.transactionType === 'OPENING_STOCK') {
        mData.openingStockEntry += tx.quantityIn;
      } else if (tx.transactionType === 'STOCK_ADJUSTMENT' || tx.transactionType === 'CANCELLATION_REVERSAL') {
        mData.adjustment += (tx.quantityIn - tx.quantityOut);
      }
    }

    // Compute continuous opening and closing balances across consecutive months
    const monthlySummaries: MonthlyStockSummary[] = [];
    let rollingOpening = openingBalanceBeforeRange;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    for (const mKey of monthKeys) {
      const mData = monthMap.get(mKey)!;
      mData.openingQty = rollingOpening;
      
      mData.closingQty = 
        mData.openingQty + 
        mData.purchaseQty + 
        mData.openingStockEntry + 
        mData.returnIn - 
        mData.salesQty - 
        mData.returnOut + 
        mData.adjustment;

      const [yearStr, monthStr] = mKey.split('-');
      const monthIdx = parseInt(monthStr, 10) - 1;
      const monthLabel = `${monthNames[monthIdx]} ${yearStr}`;

      monthlySummaries.push({
        month: mKey,
        monthLabel,
        openingQty: mData.openingQty,
        purchaseQty: mData.purchaseQty,
        purchaseValue: mData.purchaseValue,
        salesQty: mData.salesQty,
        salesValue: mData.salesValue,
        returnIn: mData.returnIn,
        returnOut: mData.returnOut,
        adjustment: mData.adjustment,
        openingStockEntry: mData.openingStockEntry,
        closingQty: mData.closingQty,
        transactionCount: mData.count,
      });

      // Next month opening exactly equals this month's closing
      rollingOpening = mData.closingQty;
    }

    // 9. Cumulative summary aggregates
    const totalPurchasedQty = inRangeTransactions
      .filter(t => t.transactionType === 'PURCHASE')
      .reduce((sum, t) => sum + t.quantityIn, 0);

    const totalPurchasedValue = inRangeTransactions
      .filter(t => t.transactionType === 'PURCHASE')
      .reduce((sum, t) => sum + t.value, 0);

    const totalSoldQty = inRangeTransactions
      .filter(t => t.transactionType === 'SALE')
      .reduce((sum, t) => sum + t.quantityOut, 0);

    const totalSoldValue = inRangeTransactions
      .filter(t => t.transactionType === 'SALE')
      .reduce((sum, t) => sum + t.value, 0);

    return {
      item: {
        id: itemRow.id,
        name: itemRow.name,
        code: itemRow.code,
        description: itemRow.description,
        purchaseRate: defaultPurchaseRate,
        lastPurchasePrice: parseFloat(itemRow.last_purchase_price) || defaultPurchaseRate,
        mrp: defaultMrp,
        status: itemRow.status,
        primaryItemName: itemRow.primary_item_name || '',
        categoryCode: itemRow.category_code || '',
      },
      stockSummary: {
        physicalStock: currentPhysicalStock,
        reservedStock: currentReservedStock,
        availableStock: currentAvailableStock,
        totalPurchasedQty,
        totalPurchasedValue,
        totalSoldQty,
        totalSoldValue,
        openingBalance: openingBalanceBeforeRange,
        closingBalance: rollingOpening,
      },
      batches,
      parties: Array.from(partyMap.values()),
      monthlySummaries,
      transactions: inRangeTransactions,
    };
  }
}
