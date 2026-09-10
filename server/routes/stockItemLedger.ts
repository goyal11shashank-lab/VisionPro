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
      const { search, barcode, status, page = '1', limit = '50' } = req.query;

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

      // 3. Query all batches belonging to this stock item
      let query = `
        SELECT 
          ob.id, ob.unique_item_id, ob.barcode, ob.sph, ob.cyl, ob.axis, ob.add, ob.side,
          ob.identity_key, ob.status, ob.created_at, ob.updated_at,
          COALESCE(os.physical_stock, 0)::numeric AS stock,
          COALESCE(os.reserved_stock, 0)::numeric AS reserved,
          COALESCE(os.available_stock, 0)::numeric AS available,
          (SELECT MAX(created_at) FROM stock_ledger sl WHERE sl.batch_id = ob.id) AS last_transaction_date
        FROM optical_batches ob
        LEFT JOIN optical_stocks os ON ob.id = os.batch_id
        WHERE ob.unique_item_id = $1 AND ob.business_id = $2
      `;
      const params: any[] = [id, businessId];

      if (barcode && typeof barcode === 'string' && barcode.trim()) {
        params.push(barcode.trim());
        query += ` AND ob.barcode = $${params.length}`;
      }

      if (status && status !== 'ALL') {
        params.push(status);
        query += ` AND ob.status = $${params.length}`;
      }

      query += ` ORDER BY ob.sph ASC NULLS FIRST, ob.cyl ASC NULLS FIRST, ob.axis ASC NULLS FIRST, ob.barcode ASC`;

      const batchesRes = await pool.query(query, params);

      // 4. Map & format optical batches
      let batchRows = batchesRes.rows.map(b => {
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

      // 5. Apply symbol-insensitive search if provided
      if (search && typeof search === 'string' && search.trim()) {
        batchRows = rankSearchMatch(batchRows, search.trim(), b => ({
          id: b.id,
          name: b.formattedName,
          barcode: b.barcode,
          sph: b.sph,
          cyl: b.cyl,
          axis: b.axis,
          add: b.add,
          side: b.side,
          rawText: `${b.barcode} ${b.identityKey || ''}`,
        }));
      }

      // 6. Pagination
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.max(1, Math.min(200, parseInt(limit as string, 10) || 50));
      const totalCount = batchRows.length;
      const totalPages = Math.ceil(totalCount / limitNum) || 1;
      const paginatedBatches = batchRows.slice((pageNum - 1) * limitNum, pageNum * limitNum);

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
        batches: paginatedBatches,
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

export default router;
