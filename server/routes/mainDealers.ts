import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { businesses } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { eq } from 'drizzle-orm';
import { DealerControlService } from '../services/dealerControlService.js';
import { DealerReturnService } from '../services/dealerReturnService.js';
import { DealerPaymentService } from '../services/dealerPaymentService.js';
import { DealerCreationService } from '../services/dealerCreationService.js';
import { DealerUserService } from '../services/dealerUserService.js';

const router = Router();

// Authentication required on all routes
router.use(authenticateToken);

/**
 * Helper: Resolve and verify MAIN business context
 */
async function resolveMainBusinessContext(req: Request): Promise<{
  mainBusiness: any;
} | { error: string; status: number }> {
  const currentBizId = req.user!.currentBusinessId;
  if (!currentBizId) {
    return { error: 'No active business selected.', status: 400 };
  }

  const [biz] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, currentBizId))
    .limit(1);

  if (!biz) {
    return { error: 'Current business not found.', status: 404 };
  }

  // Enforce MAIN business boundary
  if (biz.businessType !== 'MAIN' && !req.user?.isSuperAdmin) {
    return {
      error: 'Dealer Control Center is strictly restricted to MAIN Warehouse business entities.',
      status: 403,
    };
  }

  return { mainBusiness: biz };
}

/**
 * GET /api/main/dealers/summary
 * KPI summary for all dealers under this Main Warehouse
 */
router.get(
  '/summary',
  requireAnyPermission(['sales:view', 'master:view', 'reports:view', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const summary = await DealerControlService.getMainDealersSummary(context.mainBusiness.id);
      res.json({
        success: true,
        summary,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/summary Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealers summary' });
    }
  }
);

/**
 * GET /api/main/dealers
 * List of dealers belonging to this Main Warehouse with filters and metrics
 */
router.get(
  '/',
  requireAnyPermission(['sales:view', 'master:view', 'reports:view', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const {
        search,
        status = 'ALL',
        filter = 'ALL',
        page = '1',
        limit = '50',
      } = req.query;

      const result = await DealerControlService.getMainDealersList(context.mainBusiness.id, {
        search: search as string,
        status: status as string,
        filter: filter as any,
        page: parseInt(page as string, 10) || 1,
        limit: parseInt(limit as string, 10) || 50,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealers list' });
    }
  }
);

/**
 * GET /api/main/dealers/check-customer-duplicate
 * Checks if a Customer matching the GSTIN or Name already exists in Main Warehouse
 */
router.get(
  '/check-customer-duplicate',
  requireAnyPermission(['sales:view', 'parties:view', 'master:view', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { gstin, name } = req.query;
      const result = await DealerCreationService.checkCustomerDuplicate(
        context.mainBusiness.id,
        gstin as string,
        name as string
      );

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/check-customer-duplicate Error]', error);
      res.status(500).json({ error: error.message || 'Failed to check customer duplicate' });
    }
  }
);

/**
 * GET /api/main/dealers/search-customers
 * Tally-style searchable customer selector for linking existing Main Customer
 */
router.get(
  '/search-customers',
  requireAnyPermission(['sales:view', 'parties:view', 'master:view', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const query = (req.query.query as string) || '';
      const limit = parseInt((req.query.limit as string) || '20', 10);

      const customers = await DealerCreationService.searchMainCustomers(
        context.mainBusiness.id,
        query,
        limit
      );

      res.json({ success: true, customers });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/search-customers Error]', error);
      res.status(500).json({ error: error.message || 'Failed to search customers' });
    }
  }
);

/**
 * POST /api/main/dealers
 * Atomic Dealer Onboarding: Creates Dealer Business + Links/Creates Main Customer + Provisions Dealer Supplier
 */
router.post(
  '/',
  requireAnyPermission(['admin:manage_settings', 'admin:manage_roles', 'parties:create', 'master:create']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const userId = req.user?.id || '';
      const result = await DealerCreationService.createDealer(
        context.mainBusiness.id,
        userId,
        req.body,
        req
      );

      res.status(result.requiresConfirmation ? 200 : 201).json(result);
    } catch (error: any) {
      console.error('[POST /api/main/dealers Error]', error);
      res.status(400).json({ error: error.message || 'Failed to create dealer company' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/relationship
 * Dealer Overview & Commercial Relationship KPIs
 */
router.get(
  '/:dealerId/relationship',
  requireAnyPermission(['sales:view', 'master:view', 'reports:view', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const details = await DealerControlService.getDealerRelationshipDetails(context.mainBusiness.id, dealerId);

      res.json({
        success: true,
        details,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/relationship Error]', error);
      res.status(error.message?.includes('not found') ? 404 : 500).json({
        error: error.message || 'Failed to fetch dealer relationship details',
      });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/orders
 * Orders for this Dealer in Main Warehouse
 */
router.get(
  '/:dealerId/orders',
  requireAnyPermission(['sales:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const { page = '1', limit = '20', search } = req.query;

      const result = await DealerControlService.getDealerOrders(context.mainBusiness.id, dealerId, {
        page: parseInt(page as string, 10) || 1,
        limit: parseInt(limit as string, 10) || 20,
        search: search as string,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/orders Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer orders' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/invoices
 * Main Sales Invoices for this Dealer
 */
router.get(
  '/:dealerId/invoices',
  requireAnyPermission(['sales:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const { page = '1', limit = '20', search } = req.query;

      const result = await DealerControlService.getDealerInvoices(context.mainBusiness.id, dealerId, {
        page: parseInt(page as string, 10) || 1,
        limit: parseInt(limit as string, 10) || 20,
        search: search as string,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/invoices Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer invoices' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/dispatches
 * Dispatches / Shipments from Main to this Dealer
 */
router.get(
  '/:dealerId/dispatches',
  requireAnyPermission(['sales:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const { page = '1', limit = '20' } = req.query;

      const result = await DealerControlService.getDealerDispatches(context.mainBusiness.id, dealerId, {
        page: parseInt(page as string, 10) || 1,
        limit: parseInt(limit as string, 10) || 20,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/dispatches Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer dispatches' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/outstanding
 * Outstanding balance, invoice aging, and customer ledger entries
 */
router.get(
  '/:dealerId/outstanding',
  requireAnyPermission(['sales:view', 'accounts:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const result = await DealerControlService.getDealerOutstanding(context.mainBusiness.id, dealerId);

      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/outstanding Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer outstanding' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/activity
 * Relationship chronological timeline
 */
router.get(
  '/:dealerId/activity',
  requireAnyPermission(['sales:view', 'master:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const activity = await DealerControlService.getDealerActivity(context.mainBusiness.id, dealerId);

      res.json({
        success: true,
        activity,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/activity Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer activity' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/stock
 * Optional stock sharing (if enabled by Dealer; strictly excludes costs/pricing/margins)
 */
router.get(
  '/:dealerId/stock',
  requireAnyPermission(['sales:view', 'inventory:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const stock = await DealerControlService.getDealerStock(context.mainBusiness.id, dealerId);

      res.json({
        success: true,
        ...stock,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/stock Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer stock' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/reconciliation
 * Non-destructive reconciliation comparison for Super Admin / Main Admin
 */
router.get(
  '/:dealerId/reconciliation',
  requireAnyPermission(['admin:manage_settings', 'accounts:view', 'reports:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const reconciliation = await DealerControlService.getReconciliation(context.mainBusiness.id, dealerId);

      res.json({
        success: true,
        reconciliation,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/reconciliation Error]', error);
      res.status(500).json({ error: error.message || 'Failed to perform ledger reconciliation' });
    }
  }
);

/* =========================================================================
   PHASE 3E: MAIN WAREHOUSE DEALER RETURN APPROVAL & RECEIPT
   ========================================================================= */

/**
 * GET /api/main/dealers/returns
 * List all returns initiated by dealers under this Main Warehouse
 */
router.get(
  '/returns',
  requireAnyPermission(['sales:view', 'master:view', 'inventory:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { status, dealerBusinessId, search } = req.query;

      const returns = await DealerReturnService.getDealerReturnsList(
        context.mainBusiness.id,
        true,
        {
          status: status as string,
          dealerBusinessId: dealerBusinessId as string,
          search: search as string,
        }
      );

      res.json({
        success: true,
        returns,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/returns Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer returns' });
    }
  }
);

/**
 * GET /api/main/dealers/returns/:returnId
 * Detailed return request view
 */
router.get(
  '/returns/:returnId',
  requireAnyPermission(['sales:view', 'master:view', 'inventory:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { returnId } = req.params;

      const returnDoc = await DealerReturnService.getDealerReturnById(
        context.mainBusiness.id,
        returnId,
        true
      );

      res.json({
        success: true,
        dealerReturn: returnDoc,
      });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/returns/:returnId Error]', error);
      res.status(404).json({ error: error.message || 'Return not found' });
    }
  }
);

/**
 * POST /api/main/dealers/returns/:returnId/approve
 * Main Warehouse reviews requested return and approves quantity per line
 */
router.post(
  '/returns/:returnId/approve',
  requireAnyPermission(['sales:create', 'sales:manage', 'inventory:manage']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { returnId } = req.params;

      const approvedReturn = await DealerReturnService.approveDealerReturn(
        context.mainBusiness.id,
        returnId,
        req.body,
        req.user?.id
      );

      res.json({
        success: true,
        message: `Return ${approvedReturn.return_number} approved. Dealer can now dispatch goods.`,
        dealerReturn: approvedReturn,
      });
    } catch (error: any) {
      console.error('[POST /api/main/dealers/returns/:returnId/approve Error]', error);
      res.status(400).json({ error: error.message || 'Failed to approve return' });
    }
  }
);

/**
 * POST /api/main/dealers/returns/:returnId/reject
 * Main Warehouse rejects return request
 */
router.post(
  '/returns/:returnId/reject',
  requireAnyPermission(['sales:create', 'sales:manage', 'inventory:manage']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { returnId } = req.params;
      const { rejectionReason } = req.body;

      const rejectedReturn = await DealerReturnService.rejectDealerReturn(
        context.mainBusiness.id,
        returnId,
        rejectionReason,
        req.user?.id
      );

      res.json({
        success: true,
        message: `Return ${rejectedReturn.return_number} rejected.`,
        dealerReturn: rejectedReturn,
      });
    } catch (error: any) {
      console.error('[POST /api/main/dealers/returns/:returnId/reject Error]', error);
      res.status(400).json({ error: error.message || 'Failed to reject return' });
    }
  }
);

/**
 * POST /api/main/dealers/returns/:returnId/receive
 * Main Warehouse receives shipment, inspects accepted vs damaged items,
 * and executes SalesReturnService to increase saleable stock only!
 */
router.post(
  '/returns/:returnId/receive',
  requireAnyPermission(['sales:create', 'sales:manage', 'inventory:manage']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { returnId } = req.params;

      const receiveResult = await DealerReturnService.receiveDealerReturn(
        context.mainBusiness.id,
        returnId,
        req.body,
        req.user?.id
      );

      res.json({
        success: true,
        message: `Return goods received successfully. ${receiveResult.sessionAcceptedTotal} units accepted into Main Warehouse stock.`,
        ...receiveResult,
      });
    } catch (error: any) {
      console.error('[POST /api/main/dealers/returns/:returnId/receive Error]', error);
      res.status(400).json({ error: error.message || 'Failed to process receipt' });
    }
  }
);

// ============================================================================
// PHASE 3F: INCOMING DEALER PAYMENT ADVICES (MAIN WAREHOUSE VERIFICATION QUEUE)
// ============================================================================

/**
 * GET /api/main/dealers/payments/advices
 * or /api/dealers/payments/advices
 * List all incoming dealer payment advices for the Main Warehouse.
 */
router.get(
  '/payments/advices',
  requireAnyPermission([
    'payment.customer.view',
    'payment:customer:view',
    'payment.customer.create',
    'payment:customer:create',
    'accounts:view',
    'accounts.view',
    'sales:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerBusinessId, status, fromDate, toDate, search, page, limit } = req.query;

      const result = await DealerPaymentService.getPaymentAdvices(context.mainBusiness.id, true, {
        dealerBusinessId: dealerBusinessId as string,
        status: status as string,
        fromDate: fromDate as string,
        toDate: toDate as string,
        search: search as string,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/payments/advices Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch incoming payment advices' });
    }
  }
);

/**
 * GET /api/main/dealers/payments/advices/:id
 * Retrieve single payment advice details with server revalidation of current Main Sales Invoices.
 */
router.get(
  '/payments/advices/:id',
  requireAnyPermission([
    'payment.customer.view',
    'payment:customer:view',
    'accounts:view',
    'accounts.view',
    'sales:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { id } = req.params;
      const advice = await DealerPaymentService.getPaymentAdviceDetails(context.mainBusiness.id, id, true);
      res.json({ success: true, advice });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/payments/advices/:id Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch payment advice details' });
    }
  }
);

/**
 * POST /api/main/dealers/payments/advices/:id/verify
 * Main Warehouse Accountant verifies the payment:
 * Creates authoritative Customer Receipt in Main Warehouse, updates sales invoice balances,
 * updates Customer Ledger balance, and marks advice as VERIFIED.
 */
router.post(
  '/payments/advices/:id/verify',
  requireAnyPermission([
    'payment.customer.create',
    'payment:customer:create',
    'accounts:create',
    'accounts.create',
    'sales:manage',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { id } = req.params;
      const userId = req.user?.id || '';
      const { customAllocations, notes } = req.body;

      const result = await DealerPaymentService.verifyAndPostMainReceipt(
        context.mainBusiness.id,
        id,
        userId,
        {
          customAllocations,
          notes,
        }
      );

      res.json({
        success: true,
        message: `Payment Advice ${result.adviceNumber} verified successfully. Customer Receipt ${result.mainReceiptNumber} created and posted.`,
        ...result,
      });
    } catch (error: any) {
      console.error('[POST /api/main/dealers/payments/advices/:id/verify Error]', error);
      res.status(400).json({ error: error.message || 'Failed to verify payment advice' });
    }
  }
);

/**
 * POST /api/main/dealers/payments/advices/:id/reject
 * Reject a payment advice with a mandatory reason.
 * Does NOT delete Dealer's supplier payment record.
 */
router.post(
  '/payments/advices/:id/reject',
  requireAnyPermission([
    'payment.customer.create',
    'payment:customer:create',
    'accounts:create',
    'accounts.create',
    'sales:manage',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { id } = req.params;
      const userId = req.user?.id || '';
      const { reason } = req.body;

      if (!reason || reason.trim().length === 0) {
        res.status(400).json({ error: 'Rejection reason is required.' });
        return;
      }

      const result = await DealerPaymentService.rejectPaymentAdvice(
        context.mainBusiness.id,
        id,
        userId,
        reason
      );

      res.json({
        success: true,
        message: `Payment Advice ${result.adviceNumber} rejected.`,
        ...result,
      });
    } catch (error: any) {
      console.error('[POST /api/main/dealers/payments/advices/:id/reject Error]', error);
      res.status(400).json({ error: error.message || 'Failed to reject payment advice' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/payment-reconciliation
 * Authoritative inter-business payment reconciliation between Main Customer Ledger and Dealer Supplier Ledger.
 */
router.get(
  '/:dealerId/payment-reconciliation',
  requireAnyPermission([
    'payment.customer.view',
    'payment:customer:view',
    'accounts:view',
    'accounts.view',
    'reports:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const reconciliation = await DealerPaymentService.getPaymentReconciliation(
        context.mainBusiness.id,
        dealerId
      );

      res.json({ success: true, reconciliation });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/payment-reconciliation Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch payment reconciliation' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/administration
 * Administration tab details: codes, parent, linked parties, users count, stock sharing
 */
router.get(
  '/:dealerId/administration',
  requireAnyPermission(['sales:view', 'master:view', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const adminInfo = await DealerCreationService.getDealerAdministrationInfo(
        context.mainBusiness.id,
        dealerId
      );

      res.json({ success: true, ...adminInfo });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/administration Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch dealer administration info' });
    }
  }
);

/**
 * PUT /api/main/dealers/:dealerId
 * Edit dealer details with controlled synchronization to Main Customer Party
 */
router.put(
  '/:dealerId',
  requireAnyPermission(['admin:manage_settings', 'parties:edit', 'master:create']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const userId = req.user?.id || '';

      const result = await DealerCreationService.updateDealer(
        context.mainBusiness.id,
        dealerId,
        userId,
        req.body,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[PUT /api/main/dealers/:dealerId Error]', error);
      res.status(400).json({ error: error.message || 'Failed to update dealer' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/deactivation-warnings
 * Checks operational transactions before deactivation
 */
router.get(
  '/:dealerId/deactivation-warnings',
  requireAnyPermission(['admin:manage_settings', 'sales:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const warnings = await DealerCreationService.getDeactivationWarnings(
        context.mainBusiness.id,
        dealerId
      );

      res.json({ success: true, ...warnings });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/deactivation-warnings Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch deactivation warnings' });
    }
  }
);

/**
 * POST /api/main/dealers/:dealerId/deactivate
 * Deactivates dealer and its linked customer party
 */
router.post(
  '/:dealerId/deactivate',
  requireAnyPermission(['admin:manage_settings', 'admin:manage_roles']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const userId = req.user?.id || '';

      const result = await DealerCreationService.deactivateDealer(
        context.mainBusiness.id,
        dealerId,
        userId,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[POST /api/main/dealers/:dealerId/deactivate Error]', error);
      res.status(400).json({ error: error.message || 'Failed to deactivate dealer' });
    }
  }
);

/**
 * POST /api/main/dealers/:dealerId/activate
 * Activates dealer and restores its linked customer party
 */
router.post(
  '/:dealerId/activate',
  requireAnyPermission(['admin:manage_settings', 'admin:manage_roles']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const userId = req.user?.id || '';

      const result = await DealerCreationService.activateDealer(
        context.mainBusiness.id,
        dealerId,
        userId,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[POST /api/main/dealers/:dealerId/activate Error]', error);
      res.status(400).json({ error: error.message || 'Failed to activate dealer' });
    }
  }
);

/**
 * DELETE /api/main/dealers/:dealerId
 * Permanent deletion strictly guarded by zero-dependency check
 */
router.delete(
  '/:dealerId',
  requireAnyPermission(['admin:manage_settings', 'admin:manage_roles']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const userId = req.user?.id || '';

      const result = await DealerCreationService.deleteEmptyDealer(
        context.mainBusiness.id,
        dealerId,
        userId,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[DELETE /api/main/dealers/:dealerId Error]', error);
      res.status(400).json({ error: error.message || 'Failed to delete empty dealer' });
    }
  }
);

/* =========================================================================
   PHASE 4B: DEALER USER MANAGEMENT & ROLE ASSIGNMENT ROUTES
   ========================================================================= */

/**
 * GET /api/main/dealers/:dealerId/users
 * List all users assigned to this Dealer business
 */
router.get(
  '/:dealerId/users',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings', 'sales:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const data = await DealerUserService.getDealerUsers(dealerId);

      res.json({ success: true, ...data });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/users Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer users' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/users/candidates
 * Search active users not yet assigned to this Dealer
 */
router.get(
  '/:dealerId/users/candidates',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const q = req.query.q as string;
      const candidates = await DealerUserService.searchCandidateUsers(dealerId, q);

      res.json({ success: true, candidates });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/users/candidates Error]', error);
      res.status(500).json({ error: error.message || 'Failed to search candidate users' });
    }
  }
);

/**
 * POST /api/main/dealers/:dealerId/users/check-duplicate
 * Live check for username / email / mobile collisions
 */
router.post(
  '/:dealerId/users/check-duplicate',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { username = '', email, mobile } = req.body;
      const result = await DealerUserService.checkUserDuplicates(username, email, mobile);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Duplicate check failed' });
    }
  }
);

/**
 * POST /api/main/dealers/:dealerId/users
 * Create a new user and assign to this Dealer business
 */
router.post(
  '/:dealerId/users',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const actorUserId = req.user!.id;
      const isSuperAdmin = Boolean(req.user!.isSuperAdmin);

      const result = await DealerUserService.createDealerUser(
        dealerId,
        actorUserId,
        isSuperAdmin,
        req.body,
        req
      );

      res.status(201).json(result);
    } catch (error: any) {
      console.error('[POST /api/main/dealers/:dealerId/users Error]', error);
      res.status(400).json({
        error: error.message || 'Failed to create dealer user',
        code: error.code || 'USER_CREATION_FAILED',
        existingUser: error.existingUser || null,
      });
    }
  }
);

/**
 * POST /api/main/dealers/:dealerId/users/assign-existing
 * Assign an existing active user to this Dealer business
 */
router.post(
  '/:dealerId/users/assign-existing',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId } = req.params;
      const actorUserId = req.user!.id;
      const isSuperAdmin = Boolean(req.user!.isSuperAdmin);

      const result = await DealerUserService.assignExistingUser(
        dealerId,
        actorUserId,
        isSuperAdmin,
        req.body,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[POST /api/main/dealers/:dealerId/users/assign-existing Error]', error);
      res.status(400).json({ error: error.message || 'Failed to assign existing user' });
    }
  }
);

/**
 * PUT /api/main/dealers/:dealerId/users/:userId/role
 * Change role of user in this Dealer business
 */
router.put(
  '/:dealerId/users/:userId/role',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId, userId } = req.params;
      const { roleId } = req.body;
      const actorUserId = req.user!.id;
      const isSuperAdmin = Boolean(req.user!.isSuperAdmin);

      const result = await DealerUserService.updateUserRole(
        dealerId,
        userId,
        roleId,
        actorUserId,
        isSuperAdmin,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[PUT /api/main/dealers/:dealerId/users/:userId/role Error]', error);
      res.status(400).json({ error: error.message || 'Failed to update user role' });
    }
  }
);

/**
 * PUT /api/main/dealers/:dealerId/users/:userId/default
 * Set this Dealer business as default for user
 */
router.put(
  '/:dealerId/users/:userId/default',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId, userId } = req.params;
      const actorUserId = req.user!.id;

      const result = await DealerUserService.setUserDefaultBusiness(
        userId,
        dealerId,
        actorUserId,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[PUT /api/main/dealers/:dealerId/users/:userId/default Error]', error);
      res.status(400).json({ error: error.message || 'Failed to set default business' });
    }
  }
);

/**
 * PUT /api/main/dealers/:dealerId/users/:userId/status
 * Activate or Deactivate user
 */
router.put(
  '/:dealerId/users/:userId/status',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { userId } = req.params;
      const { status } = req.body;
      const actorUserId = req.user!.id;

      if (status !== 'ACTIVE' && status !== 'INACTIVE') {
        res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE' });
        return;
      }

      const result = await DealerUserService.toggleUserStatus(
        userId,
        status,
        actorUserId,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[PUT /api/main/dealers/:dealerId/users/:userId/status Error]', error);
      res.status(400).json({ error: error.message || 'Failed to update user status' });
    }
  }
);

/**
 * PUT /api/main/dealers/:dealerId/users/:userId/profile
 * Edit user profile (fullName, email, mobile)
 */
router.put(
  '/:dealerId/users/:userId/profile',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { userId } = req.params;
      const actorUserId = req.user!.id;

      const result = await DealerUserService.updateUserProfile(
        userId,
        req.body,
        actorUserId,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[PUT /api/main/dealers/:dealerId/users/:userId/profile Error]', error);
      res.status(400).json({ error: error.message || 'Failed to update user profile' });
    }
  }
);

/**
 * GET /api/main/dealers/:dealerId/users/:userId/access
 * Get summary of all business memberships and roles for this user
 */
router.get(
  '/:dealerId/users/:userId/access',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { userId } = req.params;
      const data = await DealerUserService.getUserAccessSummary(userId);

      res.json({ success: true, ...data });
    } catch (error: any) {
      console.error('[GET /api/main/dealers/:dealerId/users/:userId/access Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch user access summary' });
    }
  }
);

/**
 * DELETE /api/main/dealers/:dealerId/users/:userId
 * Safely remove user access from this Dealer business
 */
router.delete(
  '/:dealerId/users/:userId',
  requireAnyPermission(['admin:manage_users', 'admin:manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainBusinessContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerId, userId } = req.params;
      const actorUserId = req.user!.id;

      const result = await DealerUserService.removeDealerUserAccess(
        dealerId,
        userId,
        actorUserId,
        req
      );

      res.json(result);
    } catch (error: any) {
      console.error('[DELETE /api/main/dealers/:dealerId/users/:userId Error]', error);
      res.status(400).json({ error: error.message || 'Failed to remove user access' });
    }
  }
);

export default router;
