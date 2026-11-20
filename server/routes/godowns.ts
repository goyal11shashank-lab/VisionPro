import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { GodownService } from '../services/godownService.js';
import { B2bOrderSyncService } from '../services/b2bOrderSyncService.js';

const router = Router();

// Authentication required for all godown endpoints
router.use(authenticateToken);

/**
 * GET /api/godowns
 * List extra godowns for active business context
 * If caller is a restricted godown staff, only returns their assigned godown!
 */
router.get('/', requireAnyPermission(['inventory:view','inventory.view','godown:view','admin:manage_settings']), async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;

    if (req.user?.assignedGodownId) {
      const gdn = await GodownService.getGodownById(businessId, req.user.assignedGodownId);
      res.json({ success: true, godowns: [gdn], items: [gdn], total: 1 });
      return;
    }

    const { search, status, godownType } = req.query;
    const godownsList = await GodownService.listGodowns(businessId, {
      search: search as string,
      status: status as string,
      godownType: godownType as string,
    });

    res.json({ success: true, godowns: godownsList, items: godownsList, total: godownsList.length });
  } catch (err: any) {
    console.error('[GET /api/godowns Error]', err);
    res.status(500).json({ error: 'FETCH_GODOWNS_FAILED', message: err.message });
  }
});

// Old parent-warehouse feeds exposed quantities. Use the linked Business boolean API.
for (const path of ['/main-warehouse/stock-lookup','/main-warehouse-stock']) {
  router.get(path, requireAnyPermission(['inventory:view','master:view','sales:view','sales:create','purchase:view','purchase:create','godown:view','godown:main_warehouse_search']), (_req: Request, res: Response) => {
    res.status(410).json({error:'LEGACY_STOCK_FEED_RETIRED',message:'Use Business stock availability to check an exact item and optical power.'});
  });
}

/**
 * GET /api/godowns/:id/stock
 * View stock balances for a specific godown
 */
router.get('/:id/stock', requireAnyPermission(['inventory:view','inventory.view','godown:view','admin:manage_settings']), async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const godownId = req.params.id;
    const { search, limit, offset } = req.query;

    if (req.user?.assignedGodownId && req.user.assignedGodownId !== godownId) {
      res.status(403).json({ error: 'UNAUTHORIZED_ACCESS', message: 'Restricted to assigned godown.' });
      return;
    }

    const items = await GodownService.getGodownStockBalance(businessId, {
      godownId,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });

    res.json({ success: true, items, total: items.length });
  } catch (err: any) {
    console.error('[GET /api/godowns/:id/stock Error]', err);
    res.status(500).json({ error: 'FETCH_GODOWN_STOCK_FAILED', message: err.message });
  }
});

/**
 * GET /api/godowns/stock/balance
 * View stock balances per godown or consolidated
 * If caller is restricted godown staff, strictly scoped to their godown!
 */
router.get('/stock/balance', requireAnyPermission(['inventory:view','inventory.view','godown:view','admin:manage_settings']), async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    let targetGodownId = req.query.godownId as string | undefined;

    // Restricted godown user cannot view other godowns or main warehouse balances
    if (req.user?.assignedGodownId) {
      targetGodownId = req.user.assignedGodownId;
    }

    const { search, limit, offset } = req.query;
    const items = await GodownService.getGodownStockBalance(businessId, {
      godownId: targetGodownId,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });

    res.json(items);
  } catch (err: any) {
    console.error('[GET /api/godowns/stock/balance Error]', err);
    res.status(500).json({ error: 'FETCH_GODOWN_STOCK_FAILED', message: err.message });
  }
});

/**
 * GET /api/godowns/:id
 * Retrieve single godown details
 */
router.get('/:id', requireAnyPermission(['inventory:view','inventory.view','godown:view','admin:manage_settings']), async (req: Request, res: Response) => {
  try {
    const businessId = req.user!.currentBusinessId;
    const godownId = req.params.id;

    // Restricted user can only access their assigned godown
    if (req.user?.assignedGodownId && req.user.assignedGodownId !== godownId) {
      res.status(403).json({
        error: 'UNAUTHORIZED_GODOWN_ACCESS',
        message: 'You are restricted to your assigned godown only.',
      });
      return;
    }

    const gdn = await GodownService.getGodownById(businessId, godownId);
    res.json(gdn);
  } catch (err: any) {
    res.status(404).json({ error: 'GODOWN_NOT_FOUND', message: err.message });
  }
});

/**
 * POST /api/godowns
 * Create new Extra Godown (Admin only)
 */
router.post('/',requireAnyPermission(['godown:create','admin:manage_settings']),(_req:Request,res:Response)=>{
  res.status(410).json({error:'LEGACY_ENTITY_CREATION_RETIRED',message:'Create an independent Business. Existing stock scopes and history are preserved for reviewed conversion.'});
});

/**
 * PUT /api/godowns/:id
 * Update Extra Godown details / status (Admin only)
 */
router.put(
  '/:id',
  requireAnyPermission(['godown:edit', 'admin:manage_settings']),
  async (req: Request, res: Response) => {
    try {
      if (req.user?.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Restricted godown staff cannot edit godowns.' });
        return;
      }

      const businessId = req.user!.currentBusinessId;
      const godownId = req.params.id;
      const userId = req.user!.id;

      const updated = await GodownService.updateGodown(businessId, godownId, req.body, userId);
      res.json(updated);
    } catch (err: any) {
      console.error('[PUT /api/godowns/:id Error]', err);
      res.status(400).json({ error: 'UPDATE_GODOWN_FAILED', message: err.message });
    }
  }
);

/**
 * DELETE /api/godowns/:id
 * Safe Deletion check (Admin only)
 * Rejects deletion if vouchers, stock movements, or assigned staff exist!
 */
router.delete(
  '/:id',
  requireAnyPermission(['godown:delete', 'admin:manage_settings']),
  async (req: Request, res: Response) => {
    try {
      if (req.user?.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Restricted godown staff cannot delete godowns.' });
        return;
      }

      const businessId = req.user!.currentBusinessId;
      const godownId = req.params.id;
      const userId = req.user!.id;

      const result = await GodownService.deleteGodown(businessId, godownId, userId);
      res.json(result);
    } catch (err: any) {
      console.warn('[DELETE /api/godowns/:id Blocked]', err.message);
      res.status(400).json({ error: 'CANNOT_DELETE_GODOWN', message: err.message });
    }
  }
);

/**
 * GET /api/godowns/:id/users
 * List users assigned to a godown (Admin only)
 */
router.get(
  '/:id/users',
  requireAnyPermission(['godown:manage_users', 'admin:manage_users']),
  async (req: Request, res: Response) => {
    try {
      if (req.user?.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Access denied.' });
        return;
      }

      const businessId = req.user!.currentBusinessId;
      const godownId = req.params.id;

      const staffList = await GodownService.listGodownUsers(businessId, godownId);
      res.json({ success: true, users: staffList, items: staffList, total: staffList.length });
    } catch (err: any) {
      console.error('[GET /api/godowns/:id/users Error]', err);
      res.status(500).json({ error: 'FETCH_GODOWN_USERS_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/godowns/:id/users
 * Create new SALESMAN user assigned to this godown (Admin only)
 */
router.post(
  '/:id/users',
  requireAnyPermission(['godown:manage_users', 'admin:manage_users']),
  async (req: Request, res: Response) => {
    try {
      if (req.user?.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Access denied.' });
        return;
      }

      const businessId = req.user!.currentBusinessId;
      const godownId = req.params.id;
      const adminUserId = req.user!.id;

      const newUser = await GodownService.createGodownUser(businessId, godownId, req.body, adminUserId);
      res.status(201).json(newUser);
    } catch (err: any) {
      console.error('[POST /api/godowns/:id/users Error]', err);
      res.status(400).json({ error: 'CREATE_GODOWN_USER_FAILED', message: err.message });
    }
  }
);

/**
 * PUT /api/godowns/:id/users/:userId
 * Update godown staff (status, password, permissions override)
 */
router.put(
  '/:id/users/:userId',
  requireAnyPermission(['godown:manage_users', 'admin:manage_users']),
  async (req: Request, res: Response) => {
    try {
      if (req.user?.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Access denied.' });
        return;
      }

      const businessId = req.user!.currentBusinessId;
      const godownId = req.params.id;
      const targetUserId = req.params.userId;
      const adminUserId = req.user!.id;

      const updated = await GodownService.updateGodownUser(
        businessId,
        godownId,
        targetUserId,
        req.body,
        adminUserId
      );

      res.json(updated);
    } catch (err: any) {
      console.error('[PUT /api/godowns/:id/users/:userId Error]', err);
      res.status(400).json({ error: 'UPDATE_GODOWN_USER_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/godowns/b2b-sync/logs
 * List B2B order sync logs (Admin only, hidden from godown salesmen)
 */
router.get(
  '/b2b-sync/logs',
  requireAnyPermission(['admin:manage_settings', 'godown:view', 'master:view']),
  async (req: Request, res: Response) => {
    try {
      if (req.user?.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Restricted godown staff cannot access admin B2B sync logs.' });
        return;
      }

      const businessId = req.user!.currentBusinessId;
      const { status, godownId, search, limit, offset } = req.query;

      const result = await B2bOrderSyncService.listSyncLogs(businessId, {
        status: status as string,
        godownId: godownId as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/godowns/b2b-sync/logs Error]', err);
      res.status(500).json({ error: 'FETCH_B2B_LOGS_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/godowns/b2b-sync/logs/:id/retry
 * Retry a failed or pending B2B synchronization event
 */
router.post(
  '/b2b-sync/logs/:id/retry',
  requireAnyPermission(['admin:manage_settings', 'godown:edit', 'master:edit']),
  async (req: Request, res: Response) => {
    try {
      if (req.user?.assignedGodownId) {
        res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Restricted godown staff cannot retry sync events.' });
        return;
      }

      const businessId = req.user!.currentBusinessId;
      const logId = req.params.id;
      const userId = req.user!.id;

      const result = await B2bOrderSyncService.retrySync(businessId, logId, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[POST /api/godowns/b2b-sync/logs/:id/retry Error]', err);
      res.status(400).json({ error: 'RETRY_SYNC_FAILED', message: err.message });
    }
  }
);

export default router;
