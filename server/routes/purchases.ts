import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { PurchaseService } from '../services/purchaseService.js';

const router = Router();

// Require authentication for all purchase endpoints
router.use(authenticateToken);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

// ============================================================================
// PURCHASE INVOICES LIST & NUMBER PREVIEW
// ============================================================================

/**
 * GET /api/purchases/invoices and GET /api/purchases
 * List purchase invoices
 */
const listInvoicesHandler = async (req: Request, res: Response) => {
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
    console.error('[GET /api/purchases/invoices Error]', err);
    res.status(400).json({ error: 'FETCH_PURCHASES_FAILED', message: err.message });
  }
};

router.get('/invoices', requireAnyPermission(['purchase:view', 'purchase.view']), listInvoicesHandler);
router.get('/', requireAnyPermission(['purchase:view', 'purchase.view']), listInvoicesHandler);

/**
 * GET /api/purchases/invoices/number-preview and GET /api/purchases/number-preview
 * Get preview of next auto-generated purchase invoice number
 */
const numberPreviewHandler = async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const nextNum = await PurchaseService.generateInvoiceNumber(businessId);
    res.json({ invoiceNumber: nextNum });
  } catch (err: any) {
    res.status(400).json({ error: 'NUMBER_GEN_FAILED', message: err.message });
  }
};

router.get('/invoices/number-preview', numberPreviewHandler);
router.get('/number-preview', numberPreviewHandler);

/**
 * GET /api/purchases/lots
 * List granular procurement lots with remaining balances
 */
router.get(
  '/lots',
  requireAnyPermission(['purchase:view', 'purchase.view', 'inventory:view', 'inventory.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { search, limit, offset } = req.query;

      const result = await PurchaseService.getPurchaseLots(businessId, {
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 100,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/purchases/lots Error]', err);
      res.status(400).json({ error: 'FETCH_LOTS_FAILED', message: err.message });
    }
  }
);

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
 * POST /api/purchases/invoices and POST /api/purchases
 * Create a new DRAFT purchase invoice
 */
const createInvoiceHandler = async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const invoice = await PurchaseService.createPurchaseInvoice(businessId, req.body, req.user!.id);
    res.status(201).json(invoice);
  } catch (err: any) {
    console.error('[POST /api/purchases Error]', err);
    res.status(400).json({ error: 'CREATE_PURCHASE_FAILED', message: err.message });
  }
};

router.post('/invoices', requireAnyPermission(['purchase:create', 'purchase.create']), createInvoiceHandler);
router.post('/', requireAnyPermission(['purchase:create', 'purchase.create']), createInvoiceHandler);

/**
 * GET /api/purchases/invoices/:id and GET /api/purchases/:id
 * Retrieve full details of a purchase invoice
 */
const getInvoiceByIdHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(404).json({ error: 'INVOICE_NOT_FOUND', message: `Invalid invoice ID format: ${id}` });
      return;
    }
    const businessId = req.user!.currentBusinessId;
    const invoice = await PurchaseService.getPurchaseInvoiceById(businessId, id);
    res.json(invoice);
  } catch (err: any) {
    res.status(404).json({ error: 'INVOICE_NOT_FOUND', message: err.message });
  }
};

router.get('/invoices/:id', requireAnyPermission(['purchase:view', 'purchase.view']), getInvoiceByIdHandler);

/**
 * PUT /api/purchases/invoices/:id and PUT /api/purchases/:id
 * Update an existing purchase invoice (DRAFT, POSTED, CANCELLED)
 */
const updateInvoiceHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: 'INVALID_ID_FORMAT', message: `Invalid invoice ID format: ${id}` });
      return;
    }
    const businessId = req.user!.currentBusinessId;
    const updatedInvoice = await PurchaseService.updatePurchaseInvoice(businessId, id, req.body, req.user!.id);
    res.json(updatedInvoice);
  } catch (err: any) {
    console.error('[PUT purchase update Error]', err);
    res.status(400).json({ error: 'UPDATE_PURCHASE_FAILED', message: err.message });
  }
};

router.put('/invoices/:id', requireAnyPermission(['purchase:edit', 'purchase.edit', 'purchase:create', 'purchase.create']), updateInvoiceHandler);
router.put('/:id', requireAnyPermission(['purchase:edit', 'purchase.edit', 'purchase:create', 'purchase.create']), updateInvoiceHandler);

/**
 * POST /api/purchases/invoices/:id/post and POST /api/purchases/:id/post
 * Finalize and post purchase invoice to inventory stock and supplier ledger
 */
const postInvoiceHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: 'INVALID_ID_FORMAT', message: `Invalid invoice ID format: ${id}` });
      return;
    }
    const businessId = req.user!.currentBusinessId;
    const postedInvoice = await PurchaseService.postPurchaseInvoice(businessId, id, req.user!.id);
    res.json(postedInvoice);
  } catch (err: any) {
    console.error('[POST purchase post Error]', err);
    res.status(400).json({ error: 'POST_PURCHASE_FAILED', message: err.message });
  }
};

router.post('/invoices/:id/post', requireAnyPermission(['purchase:post', 'purchase.post', 'purchase:edit', 'purchase:create']), postInvoiceHandler);
router.post('/:id/post', requireAnyPermission(['purchase:post', 'purchase.post', 'purchase:edit', 'purchase:create']), postInvoiceHandler);

/**
 * POST /api/purchases/invoices/:id/cancel and POST /api/purchases/:id/cancel
 * Cancel a POSTED purchase invoice and reverse stock and ledger
 */
const cancelInvoiceHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: 'INVALID_ID_FORMAT', message: `Invalid invoice ID format: ${id}` });
      return;
    }
    const businessId = req.user!.currentBusinessId;
    const { reason } = req.body;
    const cancelledInvoice = await PurchaseService.cancelPurchaseInvoice(
      businessId,
      id,
      reason,
      req.user!.id
    );
    res.json(cancelledInvoice);
  } catch (err: any) {
    console.error('[POST purchase cancel Error]', err);
    res.status(400).json({ error: 'CANCEL_PURCHASE_FAILED', message: err.message });
  }
};

router.post('/invoices/:id/cancel', requireAnyPermission(['purchase:cancel', 'purchase.cancel']), cancelInvoiceHandler);
router.post('/:id/cancel', requireAnyPermission(['purchase:cancel', 'purchase.cancel']), cancelInvoiceHandler);

/**
 * DELETE /api/purchases/invoices/:id and DELETE /api/purchases/:id
 * Delete a purchase invoice (DRAFT, POSTED, or CANCELLED) with transactional reversal
 */
const deleteInvoiceHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: 'INVALID_ID_FORMAT', message: `Invalid invoice ID format: ${id}` });
      return;
    }
    const businessId = req.user!.currentBusinessId;
    const result = await PurchaseService.deletePurchaseInvoice(businessId, id, req.user!.id);
    res.json(result);
  } catch (err: any) {
    console.error('[DELETE purchase Error]', err);
    if (err.message && err.message.includes('not found with ID')) {
      res.status(404).json({ error: 'INVOICE_NOT_FOUND', message: err.message });
      return;
    }
    res.status(400).json({ error: 'DELETE_PURCHASE_FAILED', message: err.message });
  }
};

router.delete(
  '/invoices/:id',
  requireAnyPermission([
    'purchase:delete_draft',
    'purchase:delete',
    'purchase.delete',
    'purchases:delete',
    'purchases.delete',
    'purchase:cancel',
    'purchase.cancel',
    'purchase:edit',
    'purchase.edit',
    'purchases:edit',
    'purchases.edit',
    'purchase:create',
    'purchase.create',
    'purchases:create',
    'purchases.create',
    'purchase:view',
    'purchase.view',
    'purchases:view',
    'purchases.view',
  ]),
  deleteInvoiceHandler
);
router.delete(
  '/:id',
  requireAnyPermission([
    'purchase:delete_draft',
    'purchase:delete',
    'purchase.delete',
    'purchases:delete',
    'purchases.delete',
    'purchase:cancel',
    'purchase.cancel',
    'purchase:edit',
    'purchase.edit',
    'purchases:edit',
    'purchases.edit',
    'purchase:create',
    'purchase.create',
    'purchases:create',
    'purchases.create',
    'purchase:view',
    'purchase.view',
    'purchases:view',
    'purchases.view',
  ]),
  deleteInvoiceHandler
);

// Top-level fallback /:id (defined last to prevent intercepting static endpoints)
router.get('/:id', requireAnyPermission(['purchase:view', 'purchase.view']), getInvoiceByIdHandler);

export default router;

