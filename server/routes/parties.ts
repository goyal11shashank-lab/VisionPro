import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { PartyService } from '../services/partyService.js';
import { PaymentService } from '../services/paymentService.js';
import { db } from '../db/index.js';
import { supplierLedgers } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

// Protect all party routes with authentication
router.use(authenticateToken);

/**
 * GET /api/parties
 * List parties scoped to business
 */
router.get(
  '/',
  requireAnyPermission(['parties:view', 'parties.view', 'purchase:view', 'purchase:create', 'sales:view', 'sales:create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { partyType, status, search, limit, offset } = req.query;

      const result = await PartyService.getParties(businessId, {
        partyType: partyType as string,
        status: status as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/parties Error]', err);
      res.status(400).json({ error: 'FETCH_PARTIES_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/parties/code-preview
 * Generate next sequence code preview
 */
router.get('/code-preview', async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const partyType = (req.query.partyType as 'CUSTOMER' | 'SUPPLIER' | 'BOTH') || 'SUPPLIER';
    const nextCode = await PartyService.generatePartyCode(businessId, partyType);
    res.json({ partyCode: nextCode });
  } catch (err: any) {
    res.status(400).json({ error: 'CODE_GEN_FAILED', message: err.message });
  }
});

/**
 * GET /api/parties/:id
 * Get single party by ID
 */
router.get(
  '/:id',
  requireAnyPermission(['parties:view', 'parties.view', 'purchase:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const party = await PartyService.getPartyById(businessId, req.params.id);
      res.json(party);
    } catch (err: any) {
      res.status(404).json({ error: 'PARTY_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * GET /api/parties/:id/ledger
 * Get ledger statement of account for party
 */
router.get(
  '/:id/ledger',
  requireAnyPermission(['parties:view', 'parties.view', 'accounts:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { fromDate, toDate, ledgerType } = req.query;
      const statement = await PaymentService.getPartyStatement(businessId, req.params.id, {
        fromDate: fromDate as string,
        toDate: toDate as string,
        ledgerType: ledgerType as any,
      });

      res.json({
        ...statement,
        party: statement.party,
        entries: statement.entries,
        currentBalance: statement.summary.closingBalanceFormatted,
      });
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_LEDGER_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/parties
 * Create new party
 */
router.post(
  '/',
  requireAnyPermission(['parties:create', 'parties.create', 'purchase:create', 'sales:create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const party = await PartyService.createParty(businessId, req.body, req.user!.id);
      res.status(201).json(party);
    } catch (err: any) {
      console.error('[POST /api/parties Error]', err);
      res.status(400).json({ error: 'CREATE_PARTY_FAILED', message: err.message });
    }
  }
);

/**
 * PUT /api/parties/:id
 * Update existing party
 */
router.put(
  '/:id',
  requireAnyPermission(['parties:edit', 'parties.edit', 'purchase:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const updated = await PartyService.updateParty(businessId, req.params.id, req.body, req.user!.id);
      res.json(updated);
    } catch (err: any) {
      console.error('[PUT /api/parties/:id Error]', err);
      res.status(400).json({ error: 'UPDATE_PARTY_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/parties/bulk-delete
 * Delete multiple parties
 */
router.post(
  '/bulk-delete',
  requireAnyPermission(['parties:delete', 'parties.delete', 'parties:edit', 'parties.edit', 'purchase:delete', 'purchase:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { ids } = req.body;
      const result = await PartyService.bulkDeleteParties(businessId, ids, req.user!.id);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/parties/bulk-delete Error]', err);
      res.status(400).json({ error: 'BULK_DELETE_PARTIES_FAILED', message: err.message });
    }
  }
);

/**
 * DELETE /api/parties/:id
 * Delete single party
 */
router.delete(
  '/:id',
  requireAnyPermission(['parties:delete', 'parties.delete', 'parties:edit', 'parties.edit', 'purchase:delete', 'purchase:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const result = await PartyService.deleteParty(businessId, req.params.id, req.user!.id);
      res.json(result);
    } catch (err: any) {
      console.error('[DELETE /api/parties/:id Error]', err);
      res.status(400).json({ error: 'DELETE_PARTY_FAILED', message: err.message });
    }
  }
);

export default router;
