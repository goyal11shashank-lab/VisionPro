import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { PurchaseService } from '../services/purchaseService.js';
import { B2bOrderSyncService } from '../services/b2bOrderSyncService.js';
import { PurchaseExcelImportService } from '../services/purchaseExcelImportService.js';

const router = Router();

// Require authentication for all purchase endpoints
router.use(authenticateToken);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

// ============================================================================
// PURCHASE ORDERS
// ============================================================================

router.get(
  '/orders/generate-number',
  requireAnyPermission(['purchase:create', 'purchase:view', 'purchase.create', 'purchase.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const orderNumber = await PurchaseService.generatePurchaseOrderNumber(businessId);
      res.json({ orderNumber });
    } catch (err: any) {
      res.status(400).json({ error: 'ORDER_NUM_GEN_FAILED', message: err.message });
    }
  }
);

router.get(
  '/orders',
  requireAnyPermission(['purchase:view', 'purchase.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const targetGodownId = req.user?.assignedGodownId || (req.query.godownId as string | undefined);
      const { supplierPartyId, status, search, limit, offset } = req.query;
      const result = await PurchaseService.getPurchaseOrders(businessId, {
        supplierPartyId: supplierPartyId as string,
        status: status as string,
        godownId: targetGodownId,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_ORDERS_FAILED', message: err.message });
    }
  }
);

router.post(
  '/orders',
  requireAnyPermission(['purchase:create', 'purchase.create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const orderPayload = {
        ...req.body,
        godownId: req.user?.assignedGodownId || req.body.godownId || null,
      };
      const order = await PurchaseService.createPurchaseOrder(businessId, orderPayload, req.user!.id);
      res.status(201).json(order);
    } catch (err: any) {
      res.status(400).json({ error: 'CREATE_ORDER_FAILED', message: err.message });
    }
  }
);

router.get(
  '/orders/:id',
  requireAnyPermission(['purchase:view', 'purchase.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const order = await PurchaseService.getPurchaseOrderById(businessId, req.params.id);
      if (req.user?.assignedGodownId && order.godownId && order.godownId !== req.user.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Access denied: You cannot view purchase orders for another godown.' });
        return;
      }
      res.json(order);
    } catch (err: any) {
      res.status(404).json({ error: 'ORDER_NOT_FOUND', message: err.message });
    }
  }
);

router.put(
  '/orders/:id',
  requireAnyPermission(['purchase:edit', 'purchase.edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const existing = await PurchaseService.getPurchaseOrderById(businessId, req.params.id);
      if (req.user?.assignedGodownId && existing.godownId && existing.godownId !== req.user.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Access denied: You cannot edit purchase orders for another godown.' });
        return;
      }
      if (existing.isB2bSynchronized) {
        res.status(400).json({ error: 'AUTO_SYNCED_ORDER_LOCKED', message: 'Auto-synchronized B2B purchase orders cannot be modified directly. Please accept or reject the order as billed by Main Business.' });
        return;
      }
      const order = await PurchaseService.updatePurchaseOrder(businessId, req.params.id, req.body, req.user!.id);
      res.json(order);
    } catch (err: any) {
      res.status(400).json({ error: 'UPDATE_ORDER_FAILED', message: err.message });
    }
  }
);

router.post(
  '/orders/:id/cancel',
  requireAnyPermission(['purchase:cancel', 'purchase.cancel']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const existing = await PurchaseService.getPurchaseOrderById(businessId, req.params.id);
      if (req.user?.assignedGodownId && existing.godownId && existing.godownId !== req.user.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Access denied: You cannot cancel purchase orders for another godown.' });
        return;
      }
      const { reason } = req.body;
      const order = await PurchaseService.cancelPurchaseOrder(businessId, req.params.id, reason, req.user!.id);
      res.json(order);
    } catch (err: any) {
      res.status(400).json({ error: 'CANCEL_ORDER_FAILED', message: err.message });
    }
  }
);

router.post(
  '/orders/:id/convert',
  requireAnyPermission(['purchase:create', 'purchase.create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const existing = await PurchaseService.getPurchaseOrderById(businessId, req.params.id);
      if (req.user?.assignedGodownId && existing.godownId && existing.godownId !== req.user.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Access denied: You cannot convert purchase orders for another godown.' });
        return;
      }
      if (existing.isB2bSynchronized && (existing.b2bSyncStatus === 'PENDING' || existing.b2bSyncStatus === 'PENDING_ACCEPTANCE')) {
        res.status(400).json({ error: 'ACCEPTANCE_REQUIRED', message: 'This auto-synced order requires dealer acceptance before it can be converted to a purchase invoice.' });
        return;
      }
      const invoice = await PurchaseService.convertPurchaseOrderToInvoice(businessId, req.params.id, req.body, req.user!.id);
      res.status(201).json(invoice);
    } catch (err: any) {
      res.status(400).json({ error: 'CONVERT_ORDER_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/purchases/orders/:id/accept
 * Dealer accepts auto-synced Purchase Order
 */
router.post(
  '/orders/:id/accept',
  requireAnyPermission(['purchase:create', 'purchase.create', 'purchase:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const godownId = req.user?.assignedGodownId || null;
      const result = await B2bOrderSyncService.acceptDealerPurchaseOrder(
        businessId,
        req.params.id,
        godownId,
        req.user!.id
      );
      res.json(result);
    } catch (err: any) {
      const isAuthError = err.message?.includes('Access denied') || err.message?.includes('permission') || err.message?.includes('another godown');
      res.status(isAuthError ? 403 : 400).json({ error: isAuthError ? 'PERMISSION_DENIED' : 'ACCEPT_ORDER_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/purchases/orders/:id/reject
 * Dealer rejects auto-synced Purchase Order
 */
router.post(
  '/orders/:id/reject',
  requireAnyPermission(['purchase:create', 'purchase.create', 'purchase:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const godownId = req.user?.assignedGodownId || null;
      const { reason } = req.body;
      const result = await B2bOrderSyncService.rejectDealerPurchaseOrder(
        businessId,
        req.params.id,
        godownId,
        reason,
        req.user!.id
      );
      res.json(result);
    } catch (err: any) {
      const isAuthError = err.message?.includes('Access denied') || err.message?.includes('permission') || err.message?.includes('another godown');
      res.status(isAuthError ? 403 : 400).json({ error: isAuthError ? 'PERMISSION_DENIED' : 'REJECT_ORDER_FAILED', message: err.message });
    }
  }
);

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
    const targetGodownId = req.user?.assignedGodownId || (req.query.godownId as string | undefined);
    const { supplierPartyId, status, search, limit, offset, fromDate, toDate } = req.query;

    const result = await PurchaseService.getPurchaseInvoices(businessId, {
      supplierPartyId: supplierPartyId as string,
      status: status as string,
      godownId: targetGodownId,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : 100,
      offset: offset ? parseInt(offset as string, 10) : 0,
      fromDate: fromDate as string,
      toDate: toDate as string,
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

router.get('/invoices/number-preview', requireAnyPermission(['purchase:view', 'purchase.view']), numberPreviewHandler);
router.get('/number-preview', requireAnyPermission(['purchase:view', 'purchase.view']), numberPreviewHandler);

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
 * POST /api/purchases/validate-excel-import
 * Validates Excel rows for purchase invoice import:
 * - Checks stock item existence
 * - Checks batch existence in master (ZERO batch creation - rejects missing batches)
 * - Groups batches under stock items, even if scattered across spreadsheet
 */
router.post(
  '/validate-excel-import',
  requireAnyPermission(['purchase:create', 'purchase.create', 'purchase:view', 'purchase.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { rows } = req.body;
      const result = await PurchaseExcelImportService.validateAndGroupImportRows(businessId, rows);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/purchases/validate-excel-import Error]', err);
      res.status(400).json({ error: 'EXCEL_VALIDATION_FAILED', message: err.message });
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
    const invoicePayload = {
      ...req.body,
      godownId: req.user?.assignedGodownId || req.body.godownId || null,
    };
    const invoice = await PurchaseService.createPurchaseInvoice(businessId, invoicePayload, req.user!.id);
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

router.put('/invoices/:id', requireAnyPermission(['purchase:edit','purchase.edit','purchase:invoice:edit','purchase.invoice.edit']), updateInvoiceHandler);
router.put('/:id', requireAnyPermission(['purchase:edit','purchase.edit','purchase:invoice:edit','purchase.invoice.edit']), updateInvoiceHandler);

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
  requireAnyPermission(['purchase:delete', 'purchase.delete', 'purchase:invoice:delete', 'purchase.invoice.delete']),
  deleteInvoiceHandler
);
router.delete(
  '/:id',
  requireAnyPermission(['purchase:delete', 'purchase.delete', 'purchase:invoice:delete', 'purchase.invoice.delete']),
  deleteInvoiceHandler
);

// Top-level fallback /:id (defined last to prevent intercepting static endpoints)
router.get('/:id', requireAnyPermission(['purchase:view', 'purchase.view']), getInvoiceByIdHandler);

export default router;

