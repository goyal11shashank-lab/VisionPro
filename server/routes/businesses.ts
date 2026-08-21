import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { businesses, userBusinessAccess, userRoles, roles } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, requireSuperAdmin } from '../middleware/permission.js';
import { recordAuditLog } from '../services/auditService.js';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const updateBusinessSchema = z.object({
  name: z.string().min(2, 'Business Name is required'),
  tradeName: z.string().optional(),
  gstin: z.string().max(15).optional(),
  pan: z.string().max(10).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  stateCode: z.string().optional(),
  pincode: z.string().optional(),
  currency: z.string().default('INR'),
  financialYearStart: z.string().default('04-01'),
});

/**
 * GET /api/businesses
 * List accessible businesses
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    let result;
    if (req.user?.isSuperAdmin) {
      result = await db.select().from(businesses);
    } else {
      const access = await db
        .select({ business: businesses })
        .from(userBusinessAccess)
        .innerJoin(businesses, eq(userBusinessAccess.businessId, businesses.id))
        .where(eq(userBusinessAccess.userId, req.user!.id));
      result = access.map(a => a.business);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch businesses' });
  }
});

/**
 * GET /api/businesses/settings
 * Retrieve operational settings for the current authenticated business.
 */
router.get('/settings', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { BusinessSettingsService } = await import('../services/businessSettingsService.js');
    const settings = await BusinessSettingsService.getSettings(req.user!.currentBusinessId);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch business settings' });
  }
});

/**
 * PUT /api/businesses/settings
 * Update operational settings (e.g. low stock threshold) for the current business.
 */
router.put(
  '/settings',
  authenticateToken,
  requirePermission('admin:manage_settings'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { BusinessSettingsService } = await import('../services/businessSettingsService.js');
      const { lowStockThreshold, config } = req.body;
      const updated = await BusinessSettingsService.updateSettings(req.user!.currentBusinessId, {
        lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
        config,
      });
      res.json({ success: true, settings: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update business settings' });
    }
  }
);

/**
 * GET /api/businesses/:id
 * Retrieve specific business details
 */
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    // Non-superadmin can only query businesses they have access to
    if (!req.user?.isSuperAdmin) {
      const [access] = await db
        .select()
        .from(userBusinessAccess)
        .where(and(eq(userBusinessAccess.userId, req.user!.id), eq(userBusinessAccess.businessId, req.params.id)))
        .limit(1);

      if (!access) {
        res.status(403).json({ error: 'Access denied to this business' });
        return;
      }
    }

    const [biz] = await db.select().from(businesses).where(eq(businesses.id, req.params.id)).limit(1);
    if (!biz) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    res.json(biz);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch business details' });
  }
});

/**
 * PUT /api/businesses/:id
 * Update business profile / GST / contact settings
 */
router.put('/:id', authenticateToken, requirePermission('admin:manage_settings'), async (req: Request, res: Response): Promise<void> => {
  try {
    // Non-superadmin can only update their own active business
    if (!req.user?.isSuperAdmin && req.user?.currentBusinessId !== req.params.id) {
      res.status(403).json({ error: 'Cannot modify other business profiles' });
      return;
    }

    const parseResult = updateBusinessSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid input data' });
      return;
    }

    const [existing] = await db.select().from(businesses).where(eq(businesses.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const updatedData = parseResult.data;
    const [updated] = await db
      .update(businesses)
      .set({
        ...updatedData,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, req.params.id))
      .returning();

    await recordAuditLog({
      businessId: updated.id,
      userId: req.user!.id,
      action: 'UPDATE_BUSINESS_SETTINGS',
      module: 'SETTINGS',
      entityType: 'Business',
      entityId: updated.id,
      previousValue: existing,
      newValue: updated,
      req,
    });

    res.json({ success: true, business: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update business settings' });
  }
});

/**
 * POST /api/businesses
 * Create new business (Super Admin only)
 */
router.post('/', authenticateToken, requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = updateBusinessSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid business data' });
      return;
    }

    const [created] = await db.insert(businesses).values({
      ...parseResult.data,
      createdBy: req.user!.id,
    }).returning();

    // Assign super admin access to this business
    await db.insert(userBusinessAccess).values({
      userId: req.user!.id,
      businessId: created.id,
      isDefault: false,
    });

    // Assign Super Admin role for this business
    const [superAdminRole] = await db.select().from(roles).where(eq(roles.code, 'SUPER_ADMIN')).limit(1);
    if (superAdminRole) {
      await db.insert(userRoles).values({
        userId: req.user!.id,
        businessId: created.id,
        roleId: superAdminRole.id,
        assignedBy: req.user!.id,
      });
    }

    await recordAuditLog({
      businessId: created.id,
      userId: req.user!.id,
      action: 'CREATE_BUSINESS',
      module: 'BUSINESS',
      entityType: 'Business',
      entityId: created.id,
      newValue: created,
      req,
    });

    res.status(201).json({ success: true, business: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create business' });
  }
});

export default router;
