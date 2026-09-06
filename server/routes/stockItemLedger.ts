import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { StockItemLedgerService } from '../services/stockItemLedgerService.js';

const router = Router();

router.use(authenticateToken);

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

export default router;
