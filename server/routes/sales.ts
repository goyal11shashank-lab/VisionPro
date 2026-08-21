import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { SalesService } from '../services/salesService.js';

const router = Router();

// Require authentication for all sales endpoints
router.use(authenticateToken);

// ============================================================================
// SALES ORDERS
// ============================================================================

/**
 * GET /api/sales/orders
 * List sales orders
 */
router.get(
  '/orders',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.order.view', 'sales:order:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { partyId, status, search, limit, offset } = req.query;

      const result = await SalesService.getSalesOrders(businessId, {
        partyId: partyId as string,
        status: status as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/sales/orders Error]', err);
      res.status(400).json({ error: 'FETCH_ORDERS_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/orders/number-preview
 * Get preview of next auto-generated sales order number
 */
router.get('/orders/number-preview', async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const nextNum = await SalesService.generateOrderNumber(businessId);
    res.json({ orderNumber: nextNum });
  } catch (err: any) {
    res.status(400).json({ error: 'NUMBER_GEN_FAILED', message: err.message });
  }
});

/**
 * POST /api/sales/orders
 * Create new sales order (DRAFT or CONFIRMED)
 */
router.post(
  '/orders',
  requireAnyPermission(['sales:create', 'sales.create', 'sales.order.create', 'sales:order:create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const order = await SalesService.createSalesOrder(businessId, req.body, userId);
      res.status(201).json(order);
    } catch (err: any) {
      console.error('[POST /api/sales/orders Error]', err);
      res.status(400).json({ error: 'CREATE_ORDER_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/orders/:id
 * Get single sales order details
 */
router.get(
  '/orders/:id',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.order.view', 'sales:order:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const order = await SalesService.getSalesOrderById(businessId, req.params.id);
      res.json(order);
    } catch (err: any) {
      res.status(404).json({ error: 'ORDER_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * PUT /api/sales/orders/:id
 * Edit sales order
 */
router.put(
  '/orders/:id',
  requireAnyPermission(['sales:edit', 'sales.edit', 'sales.order.edit', 'sales:order:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const order = await SalesService.editSalesOrder(businessId, req.params.id, req.body, userId);
      res.json(order);
    } catch (err: any) {
      console.error('[PUT /api/sales/orders/:id Error]', err);
      res.status(400).json({ error: 'UPDATE_ORDER_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/sales/orders/:id/confirm
 * Confirm sales order and reserve inventory
 */
router.post(
  '/orders/:id/confirm',
  requireAnyPermission(['sales.order.confirm', 'sales:order:confirm', 'sales:edit', 'sales.edit', 'sales:create', 'sales.create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const order = await SalesService.confirmSalesOrder(businessId, req.params.id, userId);
      res.json(order);
    } catch (err: any) {
      console.error('[POST /api/sales/orders/:id/confirm Error]', err);
      res.status(400).json({ error: 'CONFIRM_ORDER_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/sales/orders/:id/cancel
 * Cancel sales order and release reservations
 */
router.post(
  '/orders/:id/cancel',
  requireAnyPermission(['sales.order.cancel', 'sales:order:cancel', 'sales:cancel', 'sales.cancel']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { reason } = req.body;

      const order = await SalesService.cancelSalesOrder(businessId, req.params.id, reason, userId);
      res.json(order);
    } catch (err: any) {
      console.error('[POST /api/sales/orders/:id/cancel Error]', err);
      res.status(400).json({ error: 'CANCEL_ORDER_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/sales/orders/:id/convert
 * Convert Sales Order to Sales Invoice (Partial or Full)
 */
router.post(
  '/orders/:id/convert',
  requireAnyPermission(['sales:invoice:create', 'sales.invoice.create', 'sales:create', 'sales.create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const invoice = await SalesService.convertOrderToInvoice(businessId, req.params.id, req.body, userId);
      res.status(201).json(invoice);
    } catch (err: any) {
      console.error('[POST /api/sales/orders/:id/convert Error]', err);
      res.status(400).json({ error: 'CONVERT_ORDER_FAILED', message: err.message });
    }
  }
);

// ============================================================================
// SALES INVOICES
// ============================================================================

/**
 * GET /api/sales/invoices
 * List sales invoices
 */
router.get(
  '/invoices',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.invoice.view', 'sales:invoice:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { partyId, status, search, limit, offset } = req.query;

      const result = await SalesService.getSalesInvoices(businessId, {
        partyId: partyId as string,
        status: status as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/sales/invoices Error]', err);
      res.status(400).json({ error: 'FETCH_INVOICES_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/invoices/number-preview
 * Get preview of next auto-generated sales invoice number
 */
router.get('/invoices/number-preview', async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const nextNum = await SalesService.generateInvoiceNumber(businessId);
    res.json({ invoiceNumber: nextNum });
  } catch (err: any) {
    res.status(400).json({ error: 'NUMBER_GEN_FAILED', message: err.message });
  }
});

/**
 * POST /api/sales/invoices
 * Create new sales invoice (DRAFT or POSTED)
 */
router.post(
  '/invoices',
  requireAnyPermission(['sales:create', 'sales.create', 'sales.invoice.create', 'sales:invoice:create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const invoice = await SalesService.createSalesInvoice(businessId, req.body, userId);
      res.status(201).json(invoice);
    } catch (err: any) {
      console.error('[POST /api/sales/invoices Error]', err);
      res.status(400).json({ error: 'CREATE_INVOICE_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/invoices/:id
 * Get single sales invoice details
 */
router.get(
  '/invoices/:id',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.invoice.view', 'sales:invoice:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const invoice = await SalesService.getSalesInvoiceById(businessId, req.params.id);
      res.json(invoice);
    } catch (err: any) {
      res.status(404).json({ error: 'INVOICE_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * POST /api/sales/invoices/:id/post
 * Post a DRAFT sales invoice to inventory and customer ledger
 */
router.post(
  '/invoices/:id/post',
  requireAnyPermission(['sales.invoice.post', 'sales:invoice:post', 'sales:create', 'sales.create', 'sales:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const invoice = await SalesService.postSalesInvoice(businessId, req.params.id, userId);
      res.json(invoice);
    } catch (err: any) {
      console.error('[POST /api/sales/invoices/:id/post Error]', err);
      res.status(400).json({ error: 'POST_INVOICE_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/sales/invoices/:id/cancel
 * Cancel finalized sales invoice and reverse stock & ledger
 */
router.post(
  '/invoices/:id/cancel',
  requireAnyPermission(['sales.invoice.cancel', 'sales:invoice:cancel', 'sales:cancel', 'sales.cancel']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { reason } = req.body;

      const invoice = await SalesService.cancelSalesInvoice(businessId, req.params.id, reason, userId);
      res.json(invoice);
    } catch (err: any) {
      console.error('[POST /api/sales/invoices/:id/cancel Error]', err);
      res.status(400).json({ error: 'CANCEL_INVOICE_FAILED', message: err.message });
    }
  }
);

// ============================================================================
// PARTY PRICING & CUSTOMER HELPERS
// ============================================================================

/**
 * GET /api/sales/parties/:partyId/prices
 * List all last sale prices for customer party
 */
router.get(
  '/parties/:partyId/prices',
  requireAnyPermission(['sales:view', 'sales.view', 'parties:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const prices = await SalesService.getPartyPrices(businessId, req.params.partyId);
      res.json({ prices });
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_PRICES_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/parties/:partyId/item-price/:itemId
 * GET /api/sales/pricing/:partyId/:uniqueItemId
 * Lookup last sale price for specific party & unique item
 */
router.get(
  ['/parties/:partyId/item-price/:itemId', '/pricing/:partyId/:uniqueItemId'],
  requireAnyPermission(['sales:view', 'sales.view', 'parties:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const itemId = req.params.itemId || req.params.uniqueItemId;
      const lastPrice = await SalesService.getPartyItemPrice(
        businessId,
        req.params.partyId,
        itemId
      );
      res.json({ lastSalePrice: lastPrice });
    } catch (err: any) {
      res.status(400).json({ error: 'LOOKUP_PRICE_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/parties/:partyId/credit-check
 * Check customer balance and credit limit
 */
router.get(
  '/parties/:partyId/credit-check',
  requireAnyPermission(['sales:view', 'sales.view', 'parties:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const additionalAmount = req.query.amount ? parseFloat(req.query.amount as string) : 0;
      const check = await SalesService.checkCreditLimit(businessId, req.params.partyId, additionalAmount);
      res.json(check);
    } catch (err: any) {
      res.status(400).json({ error: 'CREDIT_CHECK_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/parties/:partyId/ledger
 * Get customer running ledger
 */
router.get(
  '/parties/:partyId/ledger',
  requireAnyPermission(['sales:view', 'sales.view', 'parties:view', 'accounts:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { limit, offset } = req.query;
      const ledger = await SalesService.getCustomerLedger(businessId, req.params.partyId, {
        limit: limit ? parseInt(limit as string, 10) : 100,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json(ledger);
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_CUSTOMER_LEDGER_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/unique-items/:itemId/batches
 * Search available batches with stock for unique item
 */
router.get(
  '/unique-items/:itemId/batches',
  requireAnyPermission(['sales:view', 'sales.view', 'inventory:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const onlyInStock = req.query.onlyInStock === 'true';
      const batches = await SalesService.getBatchesForUniqueItem(businessId, req.params.itemId, {
        onlyInStock,
      });
      res.json({ batches });
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_ITEM_BATCHES_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/sales/barcode-lookup/:barcode
 * Scans barcode for sales details and stock availability
 */
router.get(
  '/barcode-lookup/:barcode',
  requireAnyPermission(['sales:view', 'sales.view', 'inventory:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const result = await SalesService.getBarcodeDetailsForSale(businessId, req.params.barcode);
      res.json(result);
    } catch (err: any) {
      res.status(404).json({ error: 'BARCODE_NOT_FOUND', message: err.message });
    }
  }
);

export default router;
