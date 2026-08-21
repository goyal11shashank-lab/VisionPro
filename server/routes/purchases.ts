import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { PurchaseService } from '../services/purchaseService.js';

const router = Router();

// Require authentication for all purchase endpoints
router.use(authenticateToken);

/**
 * GET /api/purchases
 * List purchase invoices
 */
router.get(
  '/',
  requireAnyPermission(['purchase:view', 'purchase.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { supplierPartyId, status, search, limit, offset } = req.query;

      const result = await PurchaseService.getPurchaseInvoices(businessId, {
        supplierPartyId: supplierPartyId as string,
        status: status as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/purchases Error]', err);
      res.status(400).json({ error: 'FETCH_PURCHASES_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/purchases/number-preview
 * Get preview of next auto-generated purchase invoice number
 */
router.get('/number-preview', async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const nextNum = await PurchaseService.generateInvoiceNumber(businessId);
    res.json({ invoiceNumber: nextNum });
  } catch (err: any) {
    res.status(400).json({ error: 'NUMBER_GEN_FAILED', message: err.message });
  }
});

/**
 * GET /api/purchases/barcode-lookup/:barcode
 * Scans / looks up existing optical batch details and stock by permanent barcode
 */
router.get(
  '/barcode-lookup/:barcode',
  requireAnyPermission(['purchase:create', 'purchase:view', 'purchase.create', 'purchase.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const result = await PurchaseService.getBarcodeDetailsForPurchase(businessId, req.params.barcode);
      res.json(result);
    } catch (err: any) {
      res.status(404).json({ error: 'BARCODE_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * GET /api/purchases/:id
 * Retrieve full details of a purchase invoice
 */
router.get(
  '/:id',
  requireAnyPermission(['purchase:view', 'purchase.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const invoice = await PurchaseService.getPurchaseInvoiceById(businessId, req.params.id);
      res.json(invoice);
    } catch (err: any) {
      res.status(404).json({ error: 'INVOICE_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * POST /api/purchases
 * Create a new DRAFT purchase invoice
 */
router.post(
  '/',
  requireAnyPermission(['purchase:create', 'purchase.create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const invoice = await PurchaseService.createPurchaseInvoice(businessId, req.body, req.user!.id);
      res.status(201).json(invoice);
    } catch (err: any) {
      console.error('[POST /api/purchases Error]', err);
      res.status(400).json({ error: 'CREATE_PURCHASE_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/purchases/:id/post
 * Finalize and post purchase invoice to inventory stock and supplier ledger
 */
router.post(
  '/:id/post',
  requireAnyPermission(['purchase:post', 'purchase.post', 'purchase:edit', 'purchase:create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const postedInvoice = await PurchaseService.postPurchaseInvoice(businessId, req.params.id, req.user!.id);
      res.json(postedInvoice);
    } catch (err: any) {
      console.error('[POST /api/purchases/:id/post Error]', err);
      res.status(400).json({ error: 'POST_PURCHASE_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/purchases/:id/cancel
 * Cancel a POSTED purchase invoice and reverse stock and ledger
 */
router.post(
  '/:id/cancel',
  requireAnyPermission(['purchase:cancel', 'purchase.cancel']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { reason } = req.body;
      const cancelledInvoice = await PurchaseService.cancelPurchaseInvoice(
        businessId,
        req.params.id,
        reason,
        req.user!.id
      );
      res.json(cancelledInvoice);
    } catch (err: any) {
      console.error('[POST /api/purchases/:id/cancel Error]', err);
      res.status(400).json({ error: 'CANCEL_PURCHASE_FAILED', message: err.message });
    }
  }
);

/**
 * DELETE /api/purchases/:id
 * Delete an unposted DRAFT purchase invoice
 */
router.delete(
  '/:id',
  requireAnyPermission(['purchase:delete_draft', 'purchase:delete', 'purchase.delete']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const result = await PurchaseService.deleteDraftPurchaseInvoice(businessId, req.params.id, req.user!.id);
      res.json(result);
    } catch (err: any) {
      console.error('[DELETE /api/purchases/:id Error]', err);
      res.status(400).json({ error: 'DELETE_PURCHASE_FAILED', message: err.message });
    }
  }
);

export default router;
