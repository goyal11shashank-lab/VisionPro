import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { StockItemLedgerService } from '../services/stockItemLedgerService.js';
import { pool } from '../db/index.js';
import { rankSearchMatch, formatOpticalBatchName } from '../utils/searchNormalization.js';

const router = Router();

router.use(authenticateToken);

/**
 * Helper to fetch batch ledger by batch ID
 */
async function handleBatchLedger(req: Request, res: Response, batchId: string) {
  const businessId = req.user!.currentBusinessId;
  const { from, to, partyId } = req.query;

  // 1. Get batch and parent stock item info
  const batchRes = await pool.query(
    `SELECT 
       ob.id, ob.unique_item_id, ob.barcode, ob.sph, ob.cyl, ob.axis, ob.add, ob.side, ob.status,
       ob.identity_key, ob.created_at,
       ui.name AS unique_item_name, ui.code AS unique_item_code, ui.unit, ui.optical_category,
       ui.maintain_batches,
       c.name AS category_name,
       COALESCE(ui.optical_category, c.code, 'SV') AS category_code,
       COALESCE(os.physical_stock, 0)::numeric AS stock,
       COALESCE(os.reserved_stock, 0)::numeric AS reserved,
       COALESCE(os.available_stock, 0)::numeric AS available
     FROM optical_batches ob
     JOIN unique_items ui ON ob.unique_item_id = ui.id
     LEFT JOIN primary_items pi ON ui.primary_item_id = pi.id
     LEFT JOIN categories c ON pi.category_id = c.id
     LEFT JOIN optical_stocks os ON ob.id = os.batch_id
     WHERE ob.id = $1 AND ob.business_id = $2
     LIMIT 1`,
    [batchId, businessId]
  );

  if (batchRes.rows.length === 0) {
    res.status(404).json({ error: 'BATCH_NOT_FOUND', message: 'Optical batch not found' });
    return;
  }

  const batch = batchRes.rows[0];
  const formattedPower = formatOpticalBatchName({
    sph: batch.sph,
    cyl: batch.cyl,
    axis: batch.axis,
    add: batch.add,
    side: batch.side,
    categoryCode: batch.category_code,
  });

  // 2. Query ledger service for this batch
  const ledger = await StockItemLedgerService.getLedger(businessId, batch.unique_item_id, {
    from: from as string | undefined,
    to: to as string | undefined,
    batchId: batch.id,
    partyId: partyId as string | undefined,
  });

  res.json({
    success: true,
    batch: {
      id: batch.id,
      uniqueItemId: batch.unique_item_id,
      barcode: batch.barcode,
      formattedName: formattedPower,
      sph: batch.sph !== null ? Number(batch.sph) : null,
      cyl: batch.cyl !== null ? Number(batch.cyl) : null,
      axis: batch.axis !== null ? Number(batch.axis) : null,
      add: batch.add !== null ? Number(batch.add) : null,
      side: batch.side,
      status: batch.status,
      stock: Number(batch.stock),
      reserved: Number(batch.reserved),
      available: Number(batch.available),
    },
    stockItem: {
      id: batch.unique_item_id,
      name: batch.unique_item_name,
      code: batch.unique_item_code,
      unit: batch.unit || 'PRS',
      categoryCode: batch.category_code,
      maintainBatches: batch.maintain_batches,
    },
    stockSummary: ledger.stockSummary,
    monthlySummaries: ledger.monthlySummaries,
    transactions: ledger.transactions,
    parties: ledger.parties,
  });
}

/**
 * GET /api/stock-items/:id/batches
 * Hierarchical drill-down: fetch all batches belonging to a specific stock item
 */
router.get(
  '/:id/batches',
  requireAnyPermission(['inventory:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;
      const { 
        search, 
        barcode, 
        status, 
        stockFilter, 
        showZeroStock, 
        sortBy, 
        page = '1', 
        limit = '50' 
      } = req.query;

      // 1. Fetch parent stock item details
      const itemRes = await pool.query(
        `SELECT 
           ui.id, ui.name, ui.code, ui.description, ui.unit, ui.maintain_batches,
           ui.optical_category, ui.purchase_rate, ui.last_purchase_price, ui.mrp, ui.status,
           c.name AS category_name,
           COALESCE(ui.optical_category, c.code, 'SV') AS category_code
         FROM unique_items ui
         LEFT JOIN primary_items pi ON ui.primary_item_id = pi.id
         LEFT JOIN categories c ON pi.category_id = c.id
         WHERE ui.id = $1 AND ui.business_id = $2
         LIMIT 1`,
        [id, businessId]
      );

      if (itemRes.rows.length === 0) {
        res.status(404).json({ error: 'STOCK_ITEM_NOT_FOUND', message: 'Stock item not found' });
        return;
      }

      const stockItem = itemRes.rows[0];

      // 2. Fetch stock totals across all batches for this Stock Item
      const totalsRes = await pool.query(
        `SELECT 
           COUNT(ob.id)::int AS total_batches,
           COALESCE(SUM(os.physical_stock), 0)::numeric AS total_stock,
           COALESCE(SUM(os.reserved_stock), 0)::numeric AS total_reserved,
           COALESCE(SUM(os.available_stock), 0)::numeric AS total_available
         FROM optical_batches ob
         LEFT JOIN optical_stocks os ON ob.id = os.batch_id
         WHERE ob.unique_item_id = $1 AND ob.business_id = $2`,
        [id, businessId]
      );
      const totals = totalsRes.rows[0];

      // 3. Build dynamic WHERE clauses for batches
      let whereSql = `WHERE ob.unique_item_id = $1 AND ob.business_id = $2`;
      const params: any[] = [id, businessId];

      if (barcode && typeof barcode === 'string' && barcode.trim()) {
        params.push(barcode.trim());
        whereSql += ` AND ob.barcode = $${params.length}`;
      }

      if (status && status !== 'ALL') {
        params.push(status);
        whereSql += ` AND ob.status = $${params.length}`;
      }

      // Stock status / Zero stock filter
      if (showZeroStock === 'false' || stockFilter === 'NON_ZERO') {
        whereSql += ` AND COALESCE(os.physical_stock, 0) != 0`;
      } else if (stockFilter === 'POSITIVE') {
        whereSql += ` AND COALESCE(os.physical_stock, 0) > 0`;
      } else if (stockFilter === 'NEGATIVE') {
        whereSql += ` AND COALESCE(os.physical_stock, 0) < 0`;
      } else if (stockFilter === 'ZERO') {
        whereSql += ` AND COALESCE(os.physical_stock, 0) = 0`;
      }

      // Search handling (Symbol-insensitive, Power normalized, Barcode, etc.)
      if (search && typeof search === 'string' && search.trim()) {
        const rawSearch = search.trim();
        const stripped = rawSearch.toLowerCase().replace(/[^a-z0-9]/g, '');
        const powerPairMatch = rawSearch.match(/^([+-]?\d+(?:\.\d+)?)\s*[\/,\s]\s*([+-]?\d+(?:\.\d+)?)$/);
        const singlePowerMatch = rawSearch.match(/^([+-]?\d+(?:\.\d+)?)$/);

        const searchOrClauses: string[] = [];

        // 1) Barcode ILIKE
        params.push(`%${rawSearch}%`);
        searchOrClauses.push(`ob.barcode ILIKE $${params.length}`);

        // 2) Stripped barcode match
        if (stripped.length >= 2) {
          params.push(`%${stripped}%`);
          searchOrClauses.push(`REPLACE(REPLACE(REPLACE(REPLACE(ob.barcode, '-', ''), '+', ''), '/', ''), ' ', '') ILIKE $${params.length}`);
        }

        // 3) Identity key
        params.push(`%${rawSearch}%`);
        searchOrClauses.push(`ob.identity_key ILIKE $${params.length}`);

        // 4) Power pair match (e.g. "-2.50/-1.00" or "-2.50 -1.00")
        if (powerPairMatch) {
          const p1 = parseFloat(powerPairMatch[1]);
          const p2 = parseFloat(powerPairMatch[2]);
          if (!isNaN(p1) && !isNaN(p2)) {
            params.push(p1, p2, Math.abs(p1), Math.abs(p2));
            const p1Idx = params.length - 3;
            const p2Idx = params.length - 2;
            const abs1Idx = params.length - 1;
            const abs2Idx = params.length;
            searchOrClauses.push(`((ob.sph = $${p1Idx} AND ob.cyl = $${p2Idx}) OR (ABS(ob.sph) = $${abs1Idx} AND ABS(ob.cyl) = $${abs2Idx}))`);
          }
        }
        // 5) Stripped digits (e.g. "250100" -> SPH 2.50, CYL 1.00)
        else if (/^\d{6}$/.test(stripped)) {
          const s = parseInt(stripped.slice(0, 3), 10) / 100;
          const c = parseInt(stripped.slice(3, 6), 10) / 100;
          params.push(s, c);
          searchOrClauses.push(`(ABS(ob.sph) = $${params.length - 1} AND ABS(ob.cyl) = $${params.length})`);
        }
        // 6) Stripped digits 4-digit (e.g. "2510" -> SPH 2.5, CYL 1.0)
        else if (/^\d{4}$/.test(stripped)) {
          const s = parseInt(stripped.slice(0, 2), 10) / 10;
          const c = parseInt(stripped.slice(2, 4), 10) / 10;
          params.push(s, c);
          searchOrClauses.push(`(ABS(ob.sph) = $${params.length - 1} AND ABS(ob.cyl) = $${params.length})`);
        }
        // 7) Single power match (e.g. "-2.50" or "+1.75")
        else if (singlePowerMatch) {
          const p = parseFloat(singlePowerMatch[1]);
          if (!isNaN(p)) {
            params.push(p, Math.abs(p));
            searchOrClauses.push(`(ob.sph = $${params.length - 1} OR ob.cyl = $${params.length - 1} OR ABS(ob.sph) = $${params.length} OR ABS(ob.cyl) = $${params.length})`);
          }
        }

        // 8) Side matching
        if (/^(r|l|re|le|be|none)$/i.test(rawSearch.trim())) {
          const sideVal = rawSearch.trim().toUpperCase();
          params.push(sideVal);
          searchOrClauses.push(`ob.side = $${params.length}`);
        }

        if (searchOrClauses.length > 0) {
          whereSql += ` AND (${searchOrClauses.join(' OR ')})`;
        }
      }

      // 4. Count total matching rows for pagination
      const countRes = await pool.query(
        `SELECT COUNT(ob.id)::int AS total
         FROM optical_batches ob
         LEFT JOIN optical_stocks os ON ob.id = os.batch_id
         ${whereSql}`,
        params
      );
      const totalCount = countRes.rows[0]?.total || 0;

      // 5. Query paginated rows
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.max(1, Math.min(200, parseInt(limit as string, 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      const totalPages = Math.ceil(totalCount / limitNum) || 1;

      let orderBy = `ob.sph ASC NULLS FIRST, ob.cyl ASC NULLS FIRST, ob.axis ASC NULLS FIRST, ob.barcode ASC`;
      if (sortBy === 'stock_desc') {
        orderBy = `stock DESC, ob.sph ASC NULLS FIRST`;
      } else if (sortBy === 'stock_asc') {
        orderBy = `stock ASC, ob.sph ASC NULLS FIRST`;
      } else if (sortBy === 'barcode') {
        orderBy = `ob.barcode ASC`;
      }

      const paginatedParams = [...params, limitNum, offset];
      const pageQuery = `
        SELECT 
          ob.id, ob.unique_item_id, ob.barcode, ob.sph, ob.cyl, ob.axis, ob.add, ob.side,
          ob.identity_key, ob.status, ob.created_at, ob.updated_at,
          COALESCE(os.physical_stock, 0)::numeric AS stock,
          COALESCE(os.reserved_stock, 0)::numeric AS reserved,
          COALESCE(os.available_stock, 0)::numeric AS available,
          (SELECT MAX(created_at) FROM stock_ledger sl WHERE sl.batch_id = ob.id) AS last_transaction_date
        FROM optical_batches ob
        LEFT JOIN optical_stocks os ON ob.id = os.batch_id
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $${paginatedParams.length - 1} OFFSET $${paginatedParams.length}
      `;

      const batchesRes = await pool.query(pageQuery, paginatedParams);

      // 6. Map & format optical batches
      const batchRows = batchesRes.rows.map(b => {
        const formattedName = formatOpticalBatchName({
          sph: b.sph,
          cyl: b.cyl,
          axis: b.axis,
          add: b.add,
          side: b.side,
          categoryCode: stockItem.category_code,
        });

        return {
          id: b.id,
          uniqueItemId: b.unique_item_id,
          barcode: b.barcode,
          formattedName,
          sph: b.sph !== null ? Number(b.sph) : null,
          cyl: b.cyl !== null ? Number(b.cyl) : null,
          axis: b.axis !== null ? Number(b.axis) : null,
          add: b.add !== null ? Number(b.add) : null,
          side: b.side,
          identityKey: b.identity_key,
          status: b.status,
          stock: Number(b.stock),
          reserved: Number(b.reserved),
          available: Number(b.available),
          lastTransactionDate: b.last_transaction_date,
          createdAt: b.created_at,
          updatedAt: b.updated_at,
        };
      });

      res.json({
        success: true,
        stockItem: {
          id: stockItem.id,
          name: stockItem.name,
          code: stockItem.code,
          description: stockItem.description,
          unit: stockItem.unit || 'PRS',
          categoryName: stockItem.category_name,
          categoryCode: stockItem.category_code,
          maintainBatches: stockItem.maintain_batches,
          purchaseRate: stockItem.purchase_rate ? Number(stockItem.purchase_rate) : null,
          lastPurchasePrice: stockItem.last_purchase_price ? Number(stockItem.last_purchase_price) : null,
          mrp: stockItem.mrp ? Number(stockItem.mrp) : null,
          status: stockItem.status,
        },
        totals: {
          batchesCount: Number(totals.total_batches || 0),
          stock: Number(totals.total_stock || 0),
          reserved: Number(totals.total_reserved || 0),
          available: Number(totals.total_available || 0),
        },
        batches: batchRows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount,
          totalPages,
        },
      });
    } catch (error: any) {
      console.error('[StockItemBatches Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch stock item batches' });
    }
  }
);

/**
 * GET /api/stock-items/:id/ledger
 * Fetch Tally-style monthly summary and transaction-level drill-down for a specific Stock Item
 */
router.get(
  '/:id/ledger',
  requireAnyPermission(['inventory:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;
      const { from, to, batchId, partyId } = req.query;

      // Check if :id is an optical batch ID
      const batchCheck = await pool.query(
        `SELECT id FROM optical_batches WHERE id = $1 AND business_id = $2 LIMIT 1`,
        [id, businessId]
      );

      if (batchCheck.rows.length > 0) {
        return await handleBatchLedger(req, res, id);
      }

      // Otherwise handle as stock item ledger
      const ledger = await StockItemLedgerService.getLedger(businessId, id, {
        from: from as string | undefined,
        to: to as string | undefined,
        batchId: batchId as string | undefined,
        partyId: partyId as string | undefined,
      });

      res.json({
        success: true,
        data: ledger,
      });
    } catch (error: any) {
      console.error('[StockItemLedger Error]', error);
      res.status(500).json({
        error: error.message || 'Failed to fetch stock item ledger report',
      });
    }
  }
);

/**
 * GET /api/stock-items/:id/batches/:batchId/ledger OR /api/batches/:batchId/ledger
 */
router.get(
  '/:id/batches/:batchId/ledger',
  requireAnyPermission(['inventory:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await handleBatchLedger(req, res, req.params.batchId);
    } catch (error: any) {
      console.error('[BatchLedger Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch batch ledger' });
    }
  }
);

router.get(
  '/batch/:batchId/ledger',
  requireAnyPermission(['inventory:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await handleBatchLedger(req, res, req.params.batchId);
    } catch (error: any) {
      console.error('[BatchLedger Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch batch ledger' });
    }
  }
);

/**
 * GET /api/stock-items/:id/reconcile-diagnostics
 * Diagnostic check: compares stored optical_stocks vs calculated stock_ledger balance
 * and stored reserved_stock vs active stock_reservations.
 */
router.get(
  '/:id/reconcile-diagnostics',
  requireAnyPermission(['inventory:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;

      const diagnosticsQuery = `
        SELECT 
          ob.id AS batch_id,
          ob.barcode,
          ob.sph,
          ob.cyl,
          ob.axis,
          ob.add,
          ob.side,
          COALESCE(os.physical_stock, 0)::numeric AS stored_physical_stock,
          COALESCE(os.reserved_stock, 0)::numeric AS stored_reserved_stock,
          COALESCE(os.available_stock, 0)::numeric AS stored_available_stock,
          COALESCE((
            SELECT SUM(sl.quantity_in - sl.quantity_out)
            FROM stock_ledger sl
            WHERE sl.batch_id = ob.id AND sl.business_id = $2
          ), 0)::numeric AS ledger_calculated_stock,
          COALESCE((
            SELECT SUM(sr.quantity)
            FROM stock_reservations sr
            WHERE sr.batch_id = ob.id AND sr.business_id = $2 AND sr.status = 'ACTIVE'
          ), 0)::numeric AS active_calculated_reservations
        FROM optical_batches ob
        LEFT JOIN optical_stocks os ON ob.id = os.batch_id
        WHERE ob.unique_item_id = $1 AND ob.business_id = $2
        ORDER BY ob.sph ASC NULLS FIRST, ob.cyl ASC NULLS FIRST, ob.barcode ASC
      `;

      const diagRes = await pool.query(diagnosticsQuery, [id, businessId]);

      let reconciledBatchesCount = 0;
      let discrepantBatchesCount = 0;
      const discrepancies: any[] = [];

      for (const row of diagRes.rows) {
        const storedStock = Number(row.stored_physical_stock);
        const ledgerStock = Number(row.ledger_calculated_stock);
        const storedReserved = Number(row.stored_reserved_stock);
        const activeReservations = Number(row.active_calculated_reservations);

        const stockDiscrepancy = Number((storedStock - ledgerStock).toFixed(4));
        const reservationDiscrepancy = Number((storedReserved - activeReservations).toFixed(4));

        const isStockOk = stockDiscrepancy === 0;
        const isReservedOk = reservationDiscrepancy === 0;

        if (isStockOk && isReservedOk) {
          reconciledBatchesCount++;
        } else {
          discrepantBatchesCount++;
          discrepancies.push({
            batchId: row.batch_id,
            barcode: row.barcode,
            sph: row.sph !== null ? Number(row.sph) : null,
            cyl: row.cyl !== null ? Number(row.cyl) : null,
            axis: row.axis !== null ? Number(row.axis) : null,
            add: row.add !== null ? Number(row.add) : null,
            side: row.side,
            storedPhysicalStock: storedStock,
            ledgerCalculatedStock: ledgerStock,
            stockDiscrepancy,
            storedReservedStock: storedReserved,
            activeCalculatedReservations: activeReservations,
            reservationDiscrepancy,
            status: 'DISCREPANCY',
            auditMessage: `Stock difference: ${stockDiscrepancy}, Reservation difference: ${reservationDiscrepancy}`,
          });
        }
      }

      res.json({
        success: true,
        summary: {
          totalBatchesChecked: diagRes.rows.length,
          reconciledBatchesCount,
          discrepantBatchesCount,
          isFullyReconciled: discrepantBatchesCount === 0,
        },
        discrepancies,
      });
    } catch (error: any) {
      console.error('[ReconcileDiagnostics Error]', error);
      res.status(500).json({ error: error.message || 'Failed to run stock reconciliation diagnostics' });
    }
  }
);

/**
 * GET /api/stock-items/batch/:batchId/reconcile-diagnostics
 * Single batch reconciliation check
 */
router.get(
  '/batch/:batchId/reconcile-diagnostics',
  requireAnyPermission(['inventory:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { batchId } = req.params;

      const singleBatchDiag = await pool.query(
        `SELECT 
           ob.id AS batch_id,
           ob.barcode,
           ob.sph, ob.cyl, ob.axis, ob.add, ob.side,
           COALESCE(os.physical_stock, 0)::numeric AS stored_physical_stock,
           COALESCE(os.reserved_stock, 0)::numeric AS stored_reserved_stock,
           COALESCE(os.available_stock, 0)::numeric AS stored_available_stock,
           COALESCE((
             SELECT SUM(sl.quantity_in - sl.quantity_out)
             FROM stock_ledger sl
             WHERE sl.batch_id = ob.id AND sl.business_id = $2
           ), 0)::numeric AS ledger_calculated_stock,
           COALESCE((
             SELECT SUM(sr.quantity)
             FROM stock_reservations sr
             WHERE sr.batch_id = ob.id AND sr.business_id = $2 AND sr.status = 'ACTIVE'
           ), 0)::numeric AS active_calculated_reservations
         FROM optical_batches ob
         LEFT JOIN optical_stocks os ON ob.id = os.batch_id
         WHERE ob.id = $1 AND ob.business_id = $2
         LIMIT 1`,
        [batchId, businessId]
      );

      if (singleBatchDiag.rows.length === 0) {
        res.status(404).json({ error: 'BATCH_NOT_FOUND', message: 'Batch not found' });
        return;
      }

      const row = singleBatchDiag.rows[0];
      const storedStock = Number(row.stored_physical_stock);
      const ledgerStock = Number(row.ledger_calculated_stock);
      const storedReserved = Number(row.stored_reserved_stock);
      const activeReservations = Number(row.active_calculated_reservations);

      const stockDiscrepancy = Number((storedStock - ledgerStock).toFixed(4));
      const reservationDiscrepancy = Number((storedReserved - activeReservations).toFixed(4));

      res.json({
        success: true,
        batchId: row.batch_id,
        barcode: row.barcode,
        storedPhysicalStock: storedStock,
        ledgerCalculatedStock: ledgerStock,
        stockDiscrepancy,
        storedReservedStock: storedReserved,
        activeCalculatedReservations: activeReservations,
        reservationDiscrepancy,
        isFullyReconciled: stockDiscrepancy === 0 && reservationDiscrepancy === 0,
      });
    } catch (error: any) {
      console.error('[BatchReconcileDiagnostics Error]', error);
      res.status(500).json({ error: error.message || 'Failed to check batch reconciliation diagnostics' });
    }
  }
);

export default router;
