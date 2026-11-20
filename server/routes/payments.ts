import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { PaymentService } from '../services/paymentService.js';
import { BusinessSettingsService } from '../services/businessSettingsService.js';
import { pool } from '../db/index.js';

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
      const { search, asOfDate } = req.query;
      const result = await PaymentService.getCustomerOutstanding(businessId, {
        search: search as string,
        asOfDate: asOfDate as string,
      });
      res.json({ success: true, customers: result, data: result });
    } catch (err: any) {
      console.error('[GET /api/payments/outstanding/customers Error]', err);
      res.status(400).json({ error: 'FETCH_CUSTOMER_OUTSTANDING_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/outstanding/suppliers
 * Overview of supplier ledger outstandings and unpaid bills with 6 aging buckets and asOfDate
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
      const { search, asOfDate } = req.query;
      const result = await PaymentService.getSupplierOutstanding(businessId, {
        search: search as string,
        asOfDate: asOfDate as string,
      });
      res.json({ success: true, suppliers: result, data: result });
    } catch (err: any) {
      console.error('[GET /api/payments/outstanding/suppliers Error]', err);
      res.status(400).json({ error: 'FETCH_SUPPLIER_OUTSTANDING_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/outstanding/invoices/customers
 * Line-by-line detailed Customer invoice outstanding with Due Date, Paid/Adjusted, Overdue Days
 */
router.get(
  '/outstanding/invoices/customers',
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
      const { partyId, search, asOfDate, status } = req.query;
      const result = await PaymentService.getInvoiceWiseCustomerOutstanding(businessId, {
        partyId: partyId as string,
        search: search as string,
        asOfDate: asOfDate as string,
        status: status as any,
      });
      res.json({ success: true, invoices: result, data: result });
    } catch (err: any) {
      console.error('[GET /api/payments/outstanding/invoices/customers Error]', err);
      res.status(400).json({ error: 'FETCH_CUSTOMER_INVOICES_OUTSTANDING_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/outstanding/invoices/suppliers
 * Line-by-line detailed Supplier bills outstanding with Due Date, Paid/Adjusted, Overdue Days
 */
router.get(
  '/outstanding/invoices/suppliers',
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
      const { partyId, search, asOfDate, status } = req.query;
      const result = await PaymentService.getInvoiceWiseSupplierOutstanding(businessId, {
        partyId: partyId as string,
        search: search as string,
        asOfDate: asOfDate as string,
        status: status as any,
      });
      res.json({ success: true, bills: result, data: result });
    } catch (err: any) {
      console.error('[GET /api/payments/outstanding/invoices/suppliers Error]', err);
      res.status(400).json({ error: 'FETCH_SUPPLIER_INVOICES_OUTSTANDING_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/reconciliation
 * Accounting Reconciliation Diagnostics (party ledgers, invoice status, payment over-allocation)
 */
router.get(
  '/reconciliation',
  requireAnyPermission([
    'accounts:view',
    'accounts.view',
    'accounts:approve',
    'reports:view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const result = await PaymentService.getAccountingReconciliation(businessId);
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments/reconciliation Error]', err);
      res.status(500).json({ error: 'RECONCILIATION_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/payments/reconciliation/sync
 * Automatically synchronizes invoice payment statuses to resolve return-adjustment discrepancies
 */
router.post(
  '/reconciliation/sync',
  requireAnyPermission([
    'accounts:approve',
    'accounts.approve',
    'accounts:manage',
    'admin:manage',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      await PaymentService.syncAllInvoicePaymentStatuses(businessId);
      const result = await PaymentService.getAccountingReconciliation(businessId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/payments/reconciliation/sync Error]', err);
      res.status(500).json({ error: 'RECONCILIATION_SYNC_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/reconciliation/:partyId
 * Single party accounting reconciliation check
 */
router.get(
  '/reconciliation/:partyId',
  requireAnyPermission([
    'accounts:view',
    'accounts.view',
    'parties:view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { partyId } = req.params;
      const result = await PaymentService.getAccountingReconciliation(businessId, partyId);
      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/payments/reconciliation/:partyId Error]', err);
      res.status(500).json({ error: 'RECONCILIATION_PARTY_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/payments/statement/:partyId
 * Chronological party ledger statement with running balance and opening balance
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
      const { fromDate, toDate, ledgerType } = req.query;

      const result = await PaymentService.getPartyStatement(businessId, partyId, {
        fromDate: fromDate as string,
        toDate: toDate as string,
        ledgerType: ledgerType as any,
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
router.get('/number-preview',
  requireAnyPermission(['accounts:view', 'accounts.view']),
  async (req: Request, res: Response) => {
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
      const targetGodownId = req.user?.assignedGodownId || (req.query.godownId as string | undefined);
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
        godownId: targetGodownId,
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
 * GET /api/payments/cash-movement?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Recorded POSTED receipts and payments by payment mode, with per-mode totals.
 * This is recorded movement only. There is no opening balance, so the net is NOT cash in hand or a bank balance.
 * Modes are never merged: CASH, BANK, UPI, CHEQUE and OTHER each get their own list and totals.
 */
router.get(
  '/cash-movement',
  requireAnyPermission(['accounts:view', 'accounts.view', 'payment.receipt.view', 'payment.supplier.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const from = isDate(req.query.from) ? (req.query.from as string) : null;
      const to = isDate(req.query.to) ? (req.query.to as string) : null;
      const rows = (await pool.query(
        `SELECT p.id, p.payment_number AS "paymentNumber", p.payment_date AS "paymentDate", p.payment_type AS "paymentType",
                p.payment_mode AS "paymentMode", p.amount, p.reference_number AS "referenceNumber", p.notes, pr.name AS "partyName"
           FROM payments p JOIN parties pr ON pr.id = p.party_id
          WHERE p.business_id = $1 AND p.status = 'POSTED'
            AND ($2::date IS NULL OR p.payment_date >= $2::date)
            AND ($3::date IS NULL OR p.payment_date < ($3::date + INTERVAL '1 day'))
          ORDER BY p.payment_date DESC, p.payment_number DESC
          LIMIT 1000`,
        [businessId, from, to]
      )).rows;
      const modes: Record<string, { receipts: number; payments: number; net: number; count: number }> = {};
      for (const r of rows) {
        const m = String(r.paymentMode || 'OTHER').toUpperCase();
        const t = (modes[m] ||= { receipts: 0, payments: 0, net: 0, count: 0 });
        const a = parseFloat(r.amount) || 0;
        if (r.paymentType === 'RECEIPT') t.receipts += a; else t.payments += a;
        t.count++;
      }
      for (const m of Object.keys(modes)) {
        modes[m].receipts = Math.round(modes[m].receipts * 100) / 100;
        modes[m].payments = Math.round(modes[m].payments * 100) / 100;
        modes[m].net = Math.round((modes[m].receipts - modes[m].payments) * 100) / 100;
      }
      // Cash opening balance (CASH mode only), configured in Settings > Accounts.
      // Opening as of `from` = configured opening + all POSTED CASH movement
      // from the configured opening date up to `from` (exclusive).
      const { settings } = await BusinessSettingsService.getSettings(businessId);
      const rawOpening = Number(settings.accounts?.cashOpeningBalance ?? 0);
      const cashOpening = Number.isFinite(rawOpening) ? rawOpening : 0;
      const rawDate = settings.accounts?.cashOpeningDate;
      const cashOpeningDate =
        typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
      const openingBalanceConfigured = cashOpeningDate !== null;

      let openingBalance: number | null = null;
      let closingBalance: number | null = null;
      if (openingBalanceConfigured) {
        const pre = (await pool.query(
          `SELECT payment_type AS "paymentType", COALESCE(SUM(amount), 0) AS total
             FROM payments
            WHERE business_id = $1 AND status = 'POSTED'
              AND UPPER(payment_mode) = 'CASH'
              AND payment_date >= $2::date
              AND payment_date < $3::date
            GROUP BY payment_type`,
          [businessId, cashOpeningDate, from ?? cashOpeningDate]
        )).rows;
        let preNet = 0;
        for (const r of pre) {
          const a = parseFloat(r.total) || 0;
          preNet += r.paymentType === 'RECEIPT' ? a : -a;
        }
        openingBalance = Math.round((cashOpening + preNet) * 100) / 100;
        closingBalance = Math.round((openingBalance + (modes['CASH']?.net ?? 0)) * 100) / 100;
      }

      res.json({
        success: true,
        openingBalanceConfigured,
        cashOpeningDate,
        openingBalance,
        closingBalance,
        caveat: openingBalanceConfigured
          ? 'Opening and closing balances are shown for CASH mode only. Other modes are recorded movement only.'
          : 'Recorded movement only. No opening balance is configured, so the net is not cash in hand or a bank balance.',
        truncated: rows.length >= 1000,
        modes,
        entries: rows,
      });
    } catch (err: any) {
      console.error('[GET /api/payments/cash-movement Error]', err);
      res.status(400).json({ error: 'FETCH_CASH_MOVEMENT_FAILED', message: err.message });
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
      const data = {
        ...req.body,
        godownId: req.user?.assignedGodownId || req.body.godownId || null,
      };

      const result = await PaymentService.createPayment(businessId, data, userId);
      res.status(201).json(result);
    } catch (err: any) {
      console.error('[POST /api/payments Error]', err);
      res.status(400).json({ error: 'CREATE_PAYMENT_FAILED', message: err.message });
    }
  }
);

/**
 * PUT /api/payments/:id
 * Update an existing payment voucher
 */
router.put(
  '/:id',
  requireAnyPermission([
    'payment.receipt.edit',
    'payment:receipt:edit',
    'payment.supplier.edit',
    'payment:supplier:edit',
    'accounts:edit',
    'accounts.edit',
    'payment:create',
    'accounts:create',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;
      const data = req.body;

      const result = await PaymentService.updatePayment(businessId, id, data, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[PUT /api/payments/:id Error]', err);
      res.status(400).json({ error: 'UPDATE_PAYMENT_FAILED', message: err.message });
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

/**
 * DELETE /api/payments/:id
 * Permanently delete payment voucher and restore ledger impacts
 */
router.delete(
  '/:id',
  requireAnyPermission([
    'payment.receipt.delete',
    'payment:receipt:delete',
    'payment.supplier.delete',
    'payment:supplier:delete',
    'payment:delete',
    'payment.delete',
    'accounts:delete',
    'accounts:edit',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const result = await PaymentService.deletePayment(businessId, id, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[DELETE /api/payments/:id Error]', err);
      res.status(400).json({ error: 'DELETE_PAYMENT_FAILED', message: err.message });
    }
  }
);

export default router;
