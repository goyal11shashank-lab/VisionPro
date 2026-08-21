import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { SalesReturnService } from '../services/salesReturnService.js';

const router = Router();

// Require authentication for all sales return endpoints
router.use(authenticateToken);

/**
 * GET /api/sales/returns
 * List sales returns (credit notes)
 */
router.get(
  '/',
  requireAnyPermission([
    'sales:return:view',
    'sales.return.view',
    'sales:view',
    'sales.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { partyId, salesInvoiceId, status, search, limit, offset } = req.query;

      const result = await SalesReturnService.getSalesReturns(businessId, {
        partyId: partyId as string,
        salesInvoiceId: salesInvoiceId as string,
        status: status as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/sales/returns Error]', err);
      res.status(400).json({ error: 'FETCH_SALES_RETURNS_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/returns/number-preview
 * Get preview of next auto-generated return number
 */
router.get('/number-preview', async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const nextNum = await SalesReturnService.generateReturnNumber(businessId);
    res.json({ returnNumber: nextNum });
  } catch (err: any) {
    res.status(400).json({ error: 'NUMBER_GEN_FAILED', message: err.message });
  }
});

/**
 * GET /api/sales/returns/invoice-summary/:invoiceId
 * Get returnable lines and batches for an invoice
 */
router.get(
  '/invoice-summary/:invoiceId',
  requireAnyPermission([
    'sales:return:view',
    'sales.return.view',
    'sales:view',
    'sales.view',
    'sales:return:create',
    'sales.return.create',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { invoiceId } = req.params;

      const result = await SalesReturnService.getReturnableInvoiceSummary(businessId, invoiceId);
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/sales/returns/invoice-summary Error]', err);
      res.status(400).json({ error: 'FETCH_RETURNABLE_SUMMARY_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/sales/returns
 * Create new sales return (DRAFT or POSTED)
 */
router.post(
  '/',
  requireAnyPermission([
    'sales:return:create',
    'sales.return.create',
    'sales:create',
    'sales.create',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const result = await SalesReturnService.createSalesReturn(businessId, req.body, userId);
      res.status(201).json(result);
    } catch (err: any) {
      console.error('[POST /api/sales/returns Error]', err);
      res.status(400).json({ error: 'CREATE_SALES_RETURN_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/returns/:id
 * Get single sales return by ID
 */
router.get(
  '/:id',
  requireAnyPermission([
    'sales:return:view',
    'sales.return.view',
    'sales:view',
    'sales.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;

      const result = await SalesReturnService.getSalesReturnById(businessId, id);
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/sales/returns/:id Error]', err);
      res.status(404).json({ error: 'SALES_RETURN_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * POST /api/sales/returns/:id/post
 * Post a draft sales return (restores stock & adds credit to customer ledger)
 */
router.post(
  '/:id/post',
  requireAnyPermission([
    'sales:return:post',
    'sales.return.post',
    'sales:invoice:post',
    'sales.invoice.post',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const result = await SalesReturnService.postSalesReturn(businessId, id, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/sales/returns/:id/post Error]', err);
      res.status(400).json({ error: 'POST_SALES_RETURN_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/sales/returns/:id/cancel
 * Cancel a sales return (reverses stock restoration & customer ledger credit)
 */
router.post(
  '/:id/cancel',
  requireAnyPermission([
    'sales:return:cancel',
    'sales.return.cancel',
    'sales:invoice:cancel',
    'sales.invoice.cancel',
    'sales:cancel',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;
      const { reason } = req.body;

      const result = await SalesReturnService.cancelSalesReturn(businessId, id, reason, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/sales/returns/:id/cancel Error]', err);
      res.status(400).json({ error: 'CANCEL_SALES_RETURN_FAILED', message: err.message });
    }
  }
);

export default router;
