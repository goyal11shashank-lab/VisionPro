import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { PaymentService } from '../services/paymentService.js';

const router = Router();

// Require authenticated user for all payment routes
router.use(authenticateToken);

// ============================================================================
// OUTSTANDING & STATEMENTS
// ============================================================================

/**
 * GET /api/payments/outstanding/customers
 * Overview of customer ledger outstandings, credit limits, and unpaid invoices
 */
router.get(
  '/outstanding/customers',
  requireAnyPermission([
    'payment.receipt.view',
    'payment:receipt:view',
    'accounts:view',
    'accounts.view',
    'parties:view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { search } = req.query;
      const result = await PaymentService.getCustomerOutstanding(businessId, {
        search: search as string,
      });
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments/outstanding/customers Error]', err);
      res.status(400).json({ error: 'FETCH_CUSTOMER_OUTSTANDING_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/outstanding/suppliers
 * Overview of supplier ledger outstandings and unpaid bills
 */
router.get(
  '/outstanding/suppliers',
  requireAnyPermission([
    'payment.supplier.view',
    'payment:supplier:view',
    'accounts:view',
    'accounts.view',
    'parties:view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { search } = req.query;
      const result = await PaymentService.getSupplierOutstanding(businessId, {
        search: search as string,
      });
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments/outstanding/suppliers Error]', err);
      res.status(400).json({ error: 'FETCH_SUPPLIER_OUTSTANDING_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/statement/:partyId
 * Chronological party ledger statement with running balance
 */
router.get(
  '/statement/:partyId',
  requireAnyPermission([
    'payment.receipt.view',
    'payment:receipt:view',
    'payment.supplier.view',
    'payment:supplier:view',
    'accounts:view',
    'accounts.view',
    'parties:view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { partyId } = req.params;
      const { fromDate, toDate } = req.query;

      const result = await PaymentService.getPartyStatement(businessId, partyId, {
        fromDate: fromDate as string,
        toDate: toDate as string,
      });
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments/statement/:partyId Error]', err);
      res.status(400).json({ error: 'FETCH_STATEMENT_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/unpaid-invoices/:partyId
 * Returns all unpaid or partially paid invoices for a customer or supplier
 */
router.get(
  '/unpaid-invoices/:partyId',
  requireAnyPermission([
    'payment.receipt.view',
    'payment:receipt:view',
    'payment.supplier.view',
    'payment:supplier:view',
    'payment.allocation.view',
    'payment:allocation:view',
    'accounts:view',
    'accounts.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { partyId } = req.params;
      const paymentType = (req.query.paymentType as 'RECEIPT' | 'PAYMENT') || 'RECEIPT';

      const result = await PaymentService.getUnpaidInvoices(businessId, partyId, paymentType);
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments/unpaid-invoices Error]', err);
      res.status(400).json({ error: 'FETCH_UNPAID_INVOICES_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/number-preview
 * Returns auto-generated next payment number preview
 */
router.get('/number-preview', async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const paymentType = (req.query.paymentType as 'RECEIPT' | 'PAYMENT') || 'RECEIPT';
    const nextNum = await PaymentService.generatePaymentNumber(businessId, paymentType);
    res.json({ paymentNumber: nextNum });
  } catch (err: any) {
    console.error('[GET /api/payments/number-preview Error]', err);
    res.status(400).json({ error: 'PREVIEW_NUMBER_FAILED', message: err.message });
  }
});

// ============================================================================
// PAYMENT VOUCHER CRUD
// ============================================================================

/**
 * GET /api/payments
 * List payment vouchers with search, party, type, mode, status filters
 */
router.get(
  '/',
  requireAnyPermission([
    'payment.receipt.view',
    'payment:receipt:view',
    'payment.supplier.view',
    'payment:supplier:view',
    'accounts:view',
    'accounts.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const {
        partyId,
        paymentType,
        paymentMode,
        status,
        search,
        fromDate,
        toDate,
        page,
        limit,
      } = req.query;

      const result = await PaymentService.getPayments(businessId, {
        partyId: partyId as string,
        paymentType: paymentType as 'RECEIPT' | 'PAYMENT',
        paymentMode: paymentMode as string,
        status: status as string,
        search: search as string,
        fromDate: fromDate as string,
        toDate: toDate as string,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments Error]', err);
      res.status(400).json({ error: 'FETCH_PAYMENTS_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/:id
 * Retrieve single payment voucher by ID
 */
router.get(
  '/:id',
  requireAnyPermission([
    'payment.receipt.view',
    'payment:receipt:view',
    'payment.supplier.view',
    'payment:supplier:view',
    'accounts:view',
    'accounts.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;

      const result = await PaymentService.getPaymentById(businessId, id);
      if (!result) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment voucher not found' });
      }

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments/:id Error]', err);
      res.status(400).json({ error: 'FETCH_PAYMENT_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/payments
 * Create a new Customer Receipt or Supplier Payment
 */
router.post(
  '/',
  requireAnyPermission([
    'payment.receipt.create',
    'payment:receipt:create',
    'payment.supplier.create',
    'payment:supplier:create',
    'accounts:create',
    'accounts.create',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const data = req.body;

      const result = await PaymentService.createPayment(businessId, data, userId);
      res.status(201).json(result);
    } catch (err: any) {
      console.error('[POST /api/payments Error]', err);
      res.status(400).json({ error: 'CREATE_PAYMENT_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/payments/:id/post
 * Post and finalize a DRAFT payment voucher
 */
router.post(
  '/:id/post',
  requireAnyPermission([
    'payment.receipt.post',
    'payment:receipt:post',
    'payment.supplier.post',
    'payment:supplier:post',
    'accounts:edit',
    'accounts:approve',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const result = await PaymentService.postPayment(businessId, id, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/payments/:id/post Error]', err);
      res.status(400).json({ error: 'POST_PAYMENT_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/payments/:id/allocate
 * Allocate payment against specific invoices
 */
router.post(
  '/:id/allocate',
  requireAnyPermission([
    'payment.allocation.create',
    'payment:allocation:create',
    'accounts:edit',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;
      const { allocations } = req.body;

      const result = await PaymentService.allocatePayment(businessId, id, allocations, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/payments/:id/allocate Error]', err);
      res.status(400).json({ error: 'ALLOCATE_PAYMENT_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/payments/:id/cancel
 * Cancel payment and reverse ledger impacts
 */
router.post(
  '/:id/cancel',
  requireAnyPermission([
    'payment.receipt.cancel',
    'payment:receipt:cancel',
    'payment.supplier.cancel',
    'payment:supplier:cancel',
    'accounts:edit',
    'accounts:delete',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;
      const { reason } = req.body;

      const result = await PaymentService.cancelPayment(businessId, id, reason, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/payments/:id/cancel Error]', err);
      res.status(400).json({ error: 'CANCEL_PAYMENT_FAILED', message: err.message });
    }
  }
);

export default router;
