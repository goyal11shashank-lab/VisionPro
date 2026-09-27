import { Router, Request, Response } from 'express';
import { db, pool } from '../db/index.js';
import { businesses, userBusinessAccess, userRoles, roles, businessSettings } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, requireSuperAdmin } from '../middleware/permission.js';
import { recordAuditLog } from '../services/auditService.js';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const updateBusinessSchema = z.object({
  name: z.string().min(2, 'Business Name is required'),
  tradeName: z.string().optional().nullable(),
  gstin: z.string().max(15).optional().nullable(),
  pan: z.string().max(10).optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  phone: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  stateCode: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  currency: z.string().default('INR'),
  financialYearStart: z.string().default('04-01'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']).optional().default('ACTIVE'),
  businessType: z.enum(['MAIN', 'DEALER']).optional().default('MAIN'),
  parentBusinessId: z.string().uuid('Invalid parent business ID').optional().nullable(),
});

/**
 * GET /api/businesses
 * List accessible businesses with assigned user count and parent warehouse metadata
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    let bizList: any[];
    if (req.user?.isSuperAdmin) {
      bizList = await db.select().from(businesses).orderBy(businesses.name);
    } else {
      const access = await db
        .select({ business: businesses })
        .from(userBusinessAccess)
        .innerJoin(businesses, eq(userBusinessAccess.businessId, businesses.id))
        .where(eq(userBusinessAccess.userId, req.user!.id))
        .orderBy(businesses.name);
      bizList = access.map(a => a.business);
    }

    // Query distinct user count per business
    const userCountsQuery = await pool.query(`
      SELECT business_id, COUNT(DISTINCT user_id)::int as user_count
      FROM user_business_access
      GROUP BY business_id
    `);
    const countMap = new Map<string, number>();
    for (const row of userCountsQuery.rows) {
      countMap.set(row.business_id, row.user_count);
    }

    // Query all businesses to build parent name map
    const allBizQuery = await pool.query(`SELECT id, name FROM businesses`);
    const parentMap = new Map<string, string>();
    for (const row of allBizQuery.rows) {
      parentMap.set(row.id, row.name);
    }

    const enriched = bizList.map(b => ({
      ...b,
      businessType: b.businessType || 'MAIN',
      parentBusinessId: b.parentBusinessId || null,
      parentBusinessName: b.parentBusinessId ? (parentMap.get(b.parentBusinessId) || null) : null,
      userCount: countMap.get(b.id) || 0,
      isDefault: b.id === req.user?.currentBusinessId,
    }));

    res.json(enriched);
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
 * Update operational settings for the current business.
 */
router.put(
  '/settings',
  authenticateToken,
  requirePermission('admin:manage_settings'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { BusinessSettingsService } = await import('../services/businessSettingsService.js');
      const { lowStockThreshold, config, settings } = req.body;
      const updated = await BusinessSettingsService.updateSettings(
        req.user!.currentBusinessId,
        {
          lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
          config,
          settings,
        },
        req.user!.id,
        req
      );
      res.json({ success: true, settings: updated.settings, lowStockThreshold: updated.lowStockThreshold });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update business settings' });
    }
  }
);

/**
 * POST /api/businesses/settings/restore-defaults
 * Restore recommended defaults for the current business.
 */
router.post(
  '/settings/restore-defaults',
  authenticateToken,
  requirePermission('admin:manage_settings'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { BusinessSettingsService } = await import('../services/businessSettingsService.js');
      const restored = await BusinessSettingsService.restoreDefaults(
        req.user!.currentBusinessId,
        req.user!.id,
        req
      );
      res.json({ success: true, settings: restored.settings, lowStockThreshold: restored.lowStockThreshold });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to restore default settings' });
    }
  }
);

/**
 * GET /api/businesses/:id
 * Retrieve specific business details
 */
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
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

    // Get user count
    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT user_id)::int as user_count FROM user_business_access WHERE business_id = $1`,
      [biz.id]
    );

    let parentBusinessName: string | null = null;
    if (biz.parentBusinessId) {
      const [pb] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, biz.parentBusinessId)).limit(1);
      parentBusinessName = pb?.name || null;
    }

    res.json({
      ...biz,
      businessType: biz.businessType || 'MAIN',
      parentBusinessId: biz.parentBusinessId || null,
      parentBusinessName,
      userCount: countRes.rows[0]?.user_count || 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch business details' });
  }
});

/**
 * POST /api/businesses
 * Create new business (Super Admin only)
 * Automatically initializes business_settings and assigns super admin access
 */
router.post('/', authenticateToken, requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const parseResult = updateBusinessSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid business data' });
      return;
    }

    const data = parseResult.data;
    const businessType = data.businessType || 'MAIN';
    let parentBusinessId: string | null = null;

    if (businessType === 'DEALER') {
      if (!data.parentBusinessId) {
        res.status(400).json({ error: 'Parent Main Warehouse business is required for Dealer entities.' });
        return;
      }
      const parentCheck = await client.query(`SELECT id, name, business_type, status FROM businesses WHERE id = $1`, [data.parentBusinessId]);
      if (parentCheck.rows.length === 0) {
        res.status(400).json({ error: 'Selected Parent Main Warehouse does not exist.' });
        return;
      }
      if (parentCheck.rows[0].business_type !== 'MAIN') {
        res.status(400).json({ error: 'Selected Parent must be a MAIN warehouse entity, not another Dealer.' });
        return;
      }
      parentBusinessId = parentCheck.rows[0].id;
    }

    await client.query('BEGIN');

    const insertRes = await client.query(`
      INSERT INTO businesses (
        name, trade_name, gstin, pan, email, phone,
        address_line1, address_line2, city, state, state_code, pincode,
        currency, financial_year_start, status, business_type, parent_business_id,
        created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, NOW(), NOW()
      ) RETURNING *
    `, [
      data.name,
      data.tradeName || null,
      data.gstin || null,
      data.pan || null,
      data.email || null,
      data.phone || null,
      data.addressLine1 || null,
      data.addressLine2 || null,
      data.city || null,
      data.state || null,
      data.stateCode || null,
      data.pincode || null,
      data.currency || 'INR',
      data.financialYearStart || '04-01',
      data.status || 'ACTIVE',
      businessType,
      parentBusinessId,
      req.user!.id,
    ]);

    const created = insertRes.rows[0];

    // Give super admin access to this new business (not default to preserve existing default)
    await client.query(`
      INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
      VALUES ($1, $2, false, NOW())
      ON CONFLICT (user_id, business_id) DO NOTHING
    `, [req.user!.id, created.id]);

    // Assign Super Admin role for this business
    const roleRes = await client.query(`SELECT id FROM roles WHERE code = 'SUPER_ADMIN' LIMIT 1`);
    if (roleRes.rows.length > 0) {
      await client.query(`
        INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, business_id, role_id) DO NOTHING
      `, [req.user!.id, created.id, roleRes.rows[0].id, req.user!.id]);
    }

    await client.query('COMMIT');

    // Initialize business settings with standard optical defaults
    try {
      const { BusinessSettingsService } = await import('../services/businessSettingsService.js');
      await BusinessSettingsService.restoreDefaults(created.id, req.user!.id, req);
    } catch (settingsErr) {
      console.warn('[Create Business] Warning initializing business settings defaults:', settingsErr);
    }

    await recordAuditLog({
      businessId: created.id,
      userId: req.user!.id,
      action: 'BUSINESS_CREATED',
      module: 'BUSINESS',
      entityType: 'Business',
      entityId: created.id,
      newValue: created,
      req,
    });

    res.status(201).json({ success: true, business: created });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Failed to create business' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/businesses/:id
 * Update business profile / GST / contact settings
 */
router.put('/:id', authenticateToken, requirePermission('admin:manage_settings'), async (req: Request, res: Response): Promise<void> => {
  try {
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

    const updatedData = { ...parseResult.data };

    // Validate Dealer / Main assignment logic
    if (updatedData.businessType === 'DEALER') {
      if (!updatedData.parentBusinessId) {
        res.status(400).json({ error: 'Parent Main Warehouse is required for Dealer entities.' });
        return;
      }
      if (updatedData.parentBusinessId === req.params.id) {
        res.status(400).json({ error: 'A business cannot be its own parent warehouse.' });
        return;
      }
      const [parentBiz] = await db.select().from(businesses).where(eq(businesses.id, updatedData.parentBusinessId)).limit(1);
      if (!parentBiz) {
        res.status(400).json({ error: 'Selected Parent Main Warehouse does not exist.' });
        return;
      }
      if (parentBiz.businessType !== 'MAIN') {
        res.status(400).json({ error: 'Selected Parent must be a MAIN warehouse entity.' });
        return;
      }
    } else if (updatedData.businessType === 'MAIN') {
      updatedData.parentBusinessId = null;
    }

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
      action: 'BUSINESS_UPDATED',
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
 * POST /api/businesses/:id/activate
 * Activate a business entity
 */
router.post('/:id/activate', authenticateToken, requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const [existing] = await db.select().from(businesses).where(eq(businesses.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const [updated] = await db
      .update(businesses)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(businesses.id, req.params.id))
      .returning();

    await recordAuditLog({
      businessId: updated.id,
      userId: req.user!.id,
      action: 'BUSINESS_ACTIVATED',
      module: 'BUSINESS',
      entityType: 'Business',
      entityId: updated.id,
      previousValue: { status: existing.status },
      newValue: { status: 'ACTIVE' },
      req,
    });

    res.json({ success: true, business: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to activate business' });
  }
});

/**
 * POST /api/businesses/:id/deactivate
 * Deactivate a business entity (Super Admin only)
 */
router.post('/:id/deactivate', authenticateToken, requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const [existing] = await db.select().from(businesses).where(eq(businesses.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    // Count assigned users who will be affected
    const userCountRes = await pool.query(
      `SELECT COUNT(DISTINCT user_id)::int as count FROM user_business_access WHERE business_id = $1`,
      [req.params.id]
    );
    const affectedUsers = userCountRes.rows[0]?.count || 0;

    const [updated] = await db
      .update(businesses)
      .set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(eq(businesses.id, req.params.id))
      .returning();

    await recordAuditLog({
      businessId: updated.id,
      userId: req.user!.id,
      action: 'BUSINESS_DEACTIVATED',
      module: 'BUSINESS',
      entityType: 'Business',
      entityId: updated.id,
      previousValue: { status: existing.status },
      newValue: { status: 'INACTIVE', affectedUsers },
      req,
    });

    res.json({
      success: true,
      business: updated,
      affectedUsers,
      message: `Business deactivated successfully. ${affectedUsers} user access link(s) preserved.`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to deactivate business' });
  }
});

/**
 * DELETE /api/businesses/:id
 * Permanent deletion strictly guarded by dependency checks
 */
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.params.id;

    if (req.user!.currentBusinessId === bizId) {
      res.status(400).json({
        error: 'Cannot delete the business you are currently logged into. Please switch to another business first.',
      });
      return;
    }

    const [existing] = await db.select().from(businesses).where(eq(businesses.id, bizId)).limit(1);
    if (!existing) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    // Perform exhaustive dependency check across operational tables
    const checkTables = [
      { table: 'unique_items', label: 'Stock Items' },
      { table: 'optical_batches', label: 'Optical Batches' },
      { table: 'stock_ledger', label: 'Stock Ledger Entries' },
      { table: 'stock_reservations', label: 'Stock Reservations' },
      { table: 'parties', label: 'Parties / Customers / Suppliers' },
      { table: 'sales_orders', label: 'Sales Orders' },
      { table: 'sales_invoices', label: 'Sales Invoices' },
      { table: 'sales_returns', label: 'Sales Returns' },
      { table: 'purchase_orders', label: 'Purchase Orders' },
      { table: 'purchase_invoices', label: 'Purchase Invoices' },
      { table: 'purchase_returns', label: 'Purchase Returns' },
      { table: 'payments', label: 'Payment Records' },
      { table: 'customer_ledgers', label: 'Customer Ledgers' },
      { table: 'supplier_ledgers', label: 'Supplier Ledgers' },
    ];

    const dependenciesFound: Array<{ table: string; label: string; count: number }> = [];

    for (const item of checkTables) {
      try {
        const countRes = await pool.query(
          `SELECT COUNT(*)::int as cnt FROM "${item.table}" WHERE business_id = $1`,
          [bizId]
        );
        const cnt = countRes.rows[0]?.cnt || 0;
        if (cnt > 0) {
          dependenciesFound.push({ table: item.table, label: item.label, count: cnt });
        }
      } catch (err: any) {
        // Table might not exist or schema variation; continue safely
      }
    }

    if (dependenciesFound.length > 0) {
      res.status(400).json({
        error: 'This business contains accounting, inventory, party, or transaction records and cannot be permanently deleted. Deactivate the business instead.',
        dependencies: dependenciesFound,
      });
      return;
    }

    // Business is empty of operational data; perform clean permanent deletion in transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM user_roles WHERE business_id = $1`, [bizId]);
      await client.query(`DELETE FROM user_business_access WHERE business_id = $1`, [bizId]);
      await client.query(`DELETE FROM business_settings WHERE business_id = $1`, [bizId]);
      await client.query(`DELETE FROM businesses WHERE id = $1`, [bizId]);
      await client.query('COMMIT');
    } catch (txErr: any) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    await recordAuditLog({
      businessId: req.user!.currentBusinessId,
      userId: req.user!.id,
      action: 'BUSINESS_DELETED',
      module: 'BUSINESS',
      entityType: 'Business',
      entityId: bizId,
      previousValue: existing,
      req,
    });

    res.json({
      success: true,
      message: `Business '${existing.name}' permanently deleted.`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete business' });
  }
});

/**
 * GET /api/businesses/:id/users
 * List users assigned to a specific business with their per-business role
 */
router.get('/:id/users', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.params.id;

    if (!req.user?.isSuperAdmin && req.user?.currentBusinessId !== bizId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const result = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.full_name as "fullName", 
        u.email, 
        u.mobile, 
        u.status, 
        u.is_super_admin as "isSuperAdmin",
        uba.is_default as "isDefault",
        uba.created_at as "assignedAt",
        r.id as "roleId",
        r.name as "roleName",
        r.code as "roleCode"
      FROM user_business_access uba
      JOIN users u ON uba.user_id = u.id
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.business_id = uba.business_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE uba.business_id = $1
      ORDER BY u.full_name ASC
    `, [bizId]);

    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch business users' });
  }
});

/**
 * POST /api/businesses/:id/users
 * Assign an existing user to this business with a specified role
 */
router.post('/:id/users', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const bizId = req.params.id;
    const { userId, roleId, isDefault } = req.body;

    if (!userId || !roleId) {
      res.status(400).json({ error: 'userId and roleId are required.' });
      return;
    }

    await client.query('BEGIN');

    // Check if business is active
    const bizRes = await client.query(`SELECT id, name, status FROM businesses WHERE id = $1`, [bizId]);
    if (bizRes.rows.length === 0) {
      res.status(404).json({ error: 'Business not found' });
      await client.query('ROLLBACK');
      return;
    }

    // Check user exists
    const userRes = await client.query(`SELECT id, username, full_name FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      await client.query('ROLLBACK');
      return;
    }

    // Check role exists
    const roleRes = await client.query(`SELECT id, name, code FROM roles WHERE id = $1`, [roleId]);
    if (roleRes.rows.length === 0) {
      res.status(404).json({ error: 'Role not found' });
      await client.query('ROLLBACK');
      return;
    }

    // Check if user already has access
    const accessRes = await client.query(
      `SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2`,
      [userId, bizId]
    );
    if (accessRes.rows.length > 0) {
      res.status(400).json({ error: 'User is already assigned to this business.' });
      await client.query('ROLLBACK');
      return;
    }

    // Check if user currently has any default business
    const existingDefaultRes = await client.query(
      `SELECT id FROM user_business_access WHERE user_id = $1 AND is_default = true`,
      [userId]
    );

    // If isDefault is requested, or if user has 0 current default businesses, make this default
    const shouldBeDefault = Boolean(isDefault) || existingDefaultRes.rows.length === 0;

    if (shouldBeDefault) {
      await client.query(`
        UPDATE user_business_access
        SET is_default = false
        WHERE user_id = $1
      `, [userId]);
    }

    await client.query(`
      INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [userId, bizId, shouldBeDefault]);

    await client.query(`
      INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, business_id, role_id) DO NOTHING
    `, [userId, bizId, roleId, req.user!.id]);

    await client.query('COMMIT');

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'USER_BUSINESS_ASSIGNED',
      module: 'USERS',
      entityType: 'UserBusinessAccess',
      entityId: userId,
      newValue: {
        userId,
        businessId: bizId,
        businessName: bizRes.rows[0].name,
        roleId,
        roleName: roleRes.rows[0].name,
        isDefault: shouldBeDefault,
      },
      req,
    });

    res.status(201).json({ success: true, message: 'User assigned to business successfully.' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Failed to assign user to business' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/businesses/:id/users/:userId/role
 * Update user's role within a specific business
 */
router.put('/:id/users/:userId/role', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const bizId = req.params.id;
    const userId = req.params.userId;
    const { roleId } = req.body;

    if (!roleId) {
      res.status(400).json({ error: 'roleId is required.' });
      return;
    }

    await client.query('BEGIN');

    // Verify role
    const roleRes = await client.query(`SELECT id, name, code FROM roles WHERE id = $1`, [roleId]);
    if (roleRes.rows.length === 0) {
      res.status(404).json({ error: 'Role not found' });
      await client.query('ROLLBACK');
      return;
    }

    // Update user role
    await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND business_id = $2`, [userId, bizId]);
    await client.query(`
      INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [userId, bizId, roleId, req.user!.id]);

    await client.query('COMMIT');

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'USER_BUSINESS_ROLE_UPDATED',
      module: 'USERS',
      entityType: 'UserRole',
      entityId: userId,
      newValue: {
        userId,
        businessId: bizId,
        roleId,
        roleName: roleRes.rows[0].name,
      },
      req,
    });

    res.json({ success: true, message: 'User role updated successfully.' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Failed to update user role' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/businesses/:id/users/:userId
 * Remove user access from a specific business
 */
router.delete('/:id/users/:userId', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const bizId = req.params.id;
    const userId = req.params.userId;

    await client.query('BEGIN');

    // Check if this was the default business
    const accessRes = await client.query(
      `SELECT is_default FROM user_business_access WHERE user_id = $1 AND business_id = $2`,
      [userId, bizId]
    );

    if (accessRes.rows.length === 0) {
      res.status(404).json({ error: 'User does not have access to this business' });
      await client.query('ROLLBACK');
      return;
    }

    const wasDefault = accessRes.rows[0].is_default;

    // Delete access and role
    await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND business_id = $2`, [userId, bizId]);
    await client.query(`DELETE FROM user_business_access WHERE user_id = $1 AND business_id = $2`, [userId, bizId]);

    // If it was default, promote another remaining business to default if available
    if (wasDefault) {
      const remainingRes = await client.query(
        `SELECT id, business_id FROM user_business_access WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [userId]
      );
      if (remainingRes.rows.length > 0) {
        await client.query(
          `UPDATE user_business_access SET is_default = true WHERE id = $1`,
          [remainingRes.rows[0].id]
        );
      }
    }

    await client.query('COMMIT');

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'USER_BUSINESS_REMOVED',
      module: 'USERS',
      entityType: 'UserBusinessAccess',
      entityId: userId,
      previousValue: { userId, businessId: bizId },
      req,
    });

    res.json({ success: true, message: 'User access removed successfully.' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Failed to remove user access' });
  } finally {
    client.release();
  }
});

export default router;
