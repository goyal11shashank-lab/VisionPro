import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { PurchaseReturnService } from '../services/purchaseReturnService.js';

const router = Router();

// Require authentication for all purchase return endpoints
router.use(authenticateToken);

/**
 * GET /api/purchases/returns
 * List purchase returns (debit notes)
 */
router.get(
  '/',
  requireAnyPermission([
    'purchase:return:view',
    'purchase.return.view',
    'purchase:view',
    'purchase.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { supplierPartyId, purchaseInvoiceId, status, search, limit, offset } = req.query;

      const result = await PurchaseReturnService.getPurchaseReturns(businessId, {
        supplierPartyId: supplierPartyId as string,
        purchaseInvoiceId: purchaseInvoiceId as string,
        status: status as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/purchases/returns Error]', err);
      res.status(400).json({ error: 'FETCH_PURCHASE_RETURNS_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/purchases/returns/number-preview
 * Get preview of next auto-generated return number
 */
router.get('/number-preview', async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const nextNum = await PurchaseReturnService.generateReturnNumber(businessId);
    res.json({ returnNumber: nextNum });
  } catch (err: any) {
    res.status(400).json({ error: 'NUMBER_GEN_FAILED', message: err.message });
  }
});

/**
 * GET /api/purchases/returns/invoice-summary/:invoiceId
 * Get returnable lines, lots, and batches for a purchase invoice
 */
router.get(
  '/invoice-summary/:invoiceId',
  requireAnyPermission([
    'purchase:return:view',
    'purchase.return.view',
    'purchase:view',
    'purchase.view',
    'purchase:return:create',
    'purchase.return.create',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { invoiceId } = req.params;

      const result = await PurchaseReturnService.getReturnablePurchaseInvoiceSummary(businessId, invoiceId);
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/purchases/returns/invoice-summary Error]', err);
      res.status(400).json({ error: 'FETCH_PURCHASE_RETURNABLE_SUMMARY_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/purchases/returns
 * Create new purchase return (DRAFT or POSTED)
 */
router.post(
  '/',
  requireAnyPermission([
    'purchase:return:create',
    'purchase.return.create',
    'purchase:create',
    'purchase.create',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const result = await PurchaseReturnService.createPurchaseReturn(businessId, req.body, userId);
      res.status(201).json(result);
    } catch (err: any) {
      console.error('[POST /api/purchases/returns Error]', err);
      res.status(400).json({ error: 'CREATE_PURCHASE_RETURN_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/purchases/returns/:id
 * Get single purchase return by ID
 */
router.get(
  '/:id',
  requireAnyPermission([
    'purchase:return:view',
    'purchase.return.view',
    'purchase:view',
    'purchase.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;

      const result = await PurchaseReturnService.getPurchaseReturnById(businessId, id);
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/purchases/returns/:id Error]', err);
      res.status(404).json({ error: 'PURCHASE_RETURN_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * POST /api/purchases/returns/:id/post
 * Post a draft purchase return (deducts stock & adds debit to supplier ledger)
 */
router.post(
  '/:id/post',
  requireAnyPermission([
    'purchase:return:post',
    'purchase.return.post',
    'purchase:post',
    'purchase.post',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const result = await PurchaseReturnService.postPurchaseReturn(businessId, id, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/purchases/returns/:id/post Error]', err);
      res.status(400).json({ error: 'POST_PURCHASE_RETURN_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/purchases/returns/:id/cancel
 * Cancel a purchase return (reverses stock deduction & supplier ledger debit)
 */
router.post(
  '/:id/cancel',
  requireAnyPermission([
    'purchase:return:cancel',
    'purchase.return.cancel',
    'purchase:cancel',
    'purchase.cancel',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;
      const { reason } = req.body;

      const result = await PurchaseReturnService.cancelPurchaseReturn(businessId, id, reason, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/purchases/returns/:id/cancel Error]', err);
      res.status(400).json({ error: 'CANCEL_PURCHASE_RETURN_FAILED', message: err.message });
    }
  }
);

export default router;
