import { Router, Request, Response } from 'express';
import { db, pool } from '../db/index.js';
import { users, userBusinessAccess, userRoles, roles, businesses } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { hashPassword } from '../auth/password.js';
import { recordAuditLog } from '../services/auditService.js';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const createUserSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Valid email required').optional().or(z.literal('')).nullable(),
  mobile: z.string().min(10, 'Valid 10-digit mobile required').optional().or(z.literal('')).nullable(),
  fullName: z.string().min(2, 'Full Name is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional().default('ACTIVE'),
  isSuperAdmin: z.boolean().default(false),
  // Legacy single-role support
  roleId: z.string().optional(),
  // Multi-tenant business assignments
  businessAssignments: z.array(z.object({
    businessId: z.string().uuid(),
    roleId: z.string().uuid(),
    isDefault: z.boolean().optional(),
  })).optional(),
});

const updateUserProfileSchema = z.object({
  fullName: z.string().min(2, 'Full Name is required'),
  email: z.string().email('Valid email required').optional().or(z.literal('')).nullable(),
  mobile: z.string().min(10, 'Valid 10-digit mobile required').optional().or(z.literal('')).nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
  isSuperAdmin: z.boolean().optional(),
});

const updateBusinessAccessSchema = z.object({
  assignments: z.array(z.object({
    businessId: z.string().uuid(),
    roleId: z.string().uuid(),
  })),
  defaultBusinessId: z.string().uuid().optional().nullable(),
});

/**
 * GET /api/users
 * List users with multi-tenant authorized businesses, roles, and default business
 */
router.get('/', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const isSuperAdmin = Boolean(req.user?.isSuperAdmin);
    const currentBusinessId = req.user!.currentBusinessId;

    let userRows: any[];
    if (isSuperAdmin) {
      userRows = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          mobile: users.mobile,
          fullName: users.fullName,
          status: users.status,
          isSuperAdmin: users.isSuperAdmin,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(users.fullName);
    } else {
      userRows = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          mobile: users.mobile,
          fullName: users.fullName,
          status: users.status,
          isSuperAdmin: users.isSuperAdmin,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .innerJoin(userBusinessAccess, eq(users.id, userBusinessAccess.userId))
        .where(eq(userBusinessAccess.businessId, currentBusinessId))
        .orderBy(users.fullName);
    }

    // Query all business accesses and roles for all fetched users
    const userIds = userRows.map(u => u.id);
    if (userIds.length === 0) {
      res.json([]);
      return;
    }

    const accessQuery = await pool.query(`
      SELECT 
        uba.user_id as "userId",
        uba.business_id as "businessId",
        uba.is_default as "isDefault",
        b.name as "businessName",
        b.trade_name as "tradeName",
        b.status as "businessStatus",
        r.id as "roleId",
        r.name as "roleName",
        r.code as "roleCode"
      FROM user_business_access uba
      JOIN businesses b ON uba.business_id = b.id
      LEFT JOIN user_roles ur ON ur.user_id = uba.user_id AND ur.business_id = uba.business_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE uba.user_id = ANY($1::uuid[])
      ORDER BY uba.created_at ASC
    `, [userIds]);

    const accessByUser = new Map<string, any[]>();
    for (const row of accessQuery.rows) {
      if (!accessByUser.has(row.userId)) {
        accessByUser.set(row.userId, []);
      }
      accessByUser.get(row.userId)!.push({
        businessId: row.businessId,
        businessName: row.businessName,
        tradeName: row.tradeName,
        status: row.businessStatus,
        isDefault: row.isDefault,
        role: row.roleId ? {
          id: row.roleId,
          name: row.roleName,
          code: row.roleCode,
        } : null,
      });
    }

    const enrichedUsers = userRows.map(u => {
      const authorizedBusinesses = accessByUser.get(u.id) || [];
      const defaultBiz = authorizedBusinesses.find(b => b.isDefault);

      // Extract legacy roles list for current business
      const currentBizAccess = authorizedBusinesses.find(b => b.businessId === currentBusinessId);
      const rolesList = currentBizAccess?.role ? [currentBizAccess.role] : [];

      return {
        ...u,
        roles: rolesList,
        authorizedBusinesses,
        defaultBusinessId: defaultBiz?.businessId || null,
        defaultBusinessName: defaultBiz?.businessName || null,
      };
    });

    res.json(enrichedUsers);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list users' });
  }
});

/**
 * GET /api/users/:id
 * Retrieve specific user with authorized businesses
 */
router.get('/:id', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const targetUserId = req.params.id;

    const [targetUser] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        mobile: users.mobile,
        fullName: users.fullName,
        status: users.status,
        isSuperAdmin: users.isSuperAdmin,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Access check for non-superadmin
    if (!req.user?.isSuperAdmin) {
      const [userAccess] = await db
        .select()
        .from(userBusinessAccess)
        .where(and(eq(userBusinessAccess.userId, targetUserId), eq(userBusinessAccess.businessId, req.user!.currentBusinessId)))
        .limit(1);

      if (!userAccess) {
        res.status(403).json({ error: 'Access denied: Target user does not belong to your business' });
        return;
      }
    }

    const accessQuery = await pool.query(`
      SELECT 
        uba.business_id as "businessId",
        uba.is_default as "isDefault",
        b.name as "businessName",
        b.trade_name as "tradeName",
        b.status as "businessStatus",
        r.id as "roleId",
        r.name as "roleName",
        r.code as "roleCode"
      FROM user_business_access uba
      JOIN businesses b ON uba.business_id = b.id
      LEFT JOIN user_roles ur ON ur.user_id = uba.user_id AND ur.business_id = uba.business_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE uba.user_id = $1
      ORDER BY uba.created_at ASC
    `, [targetUserId]);

    const authorizedBusinesses = accessQuery.rows.map(row => ({
      businessId: row.businessId,
      businessName: row.businessName,
      tradeName: row.tradeName,
      status: row.businessStatus,
      isDefault: row.isDefault,
      role: row.roleId ? {
        id: row.roleId,
        name: row.roleName,
        code: row.roleCode,
      } : null,
    }));

    const defaultBiz = authorizedBusinesses.find(b => b.isDefault);

    res.json({
      ...targetUser,
      authorizedBusinesses,
      defaultBusinessId: defaultBiz?.businessId || null,
      defaultBusinessName: defaultBiz?.businessName || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch user' });
  }
});

/**
 * POST /api/users
 * Create a new user with multi-business assignments, roles, and default business
 */
router.post('/', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid user parameters' });
      return;
    }

    const {
      username,
      email,
      mobile,
      fullName,
      password,
      status,
      isSuperAdmin,
      roleId,
      businessAssignments,
    } = parseResult.data;

    // Check unique username
    const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing) {
      res.status(400).json({ error: `Username '${username}' is already taken.` });
      return;
    }

    // Normalize assignments
    let finalAssignments: Array<{ businessId: string; roleId: string; isDefault: boolean }> = [];

    if (businessAssignments && businessAssignments.length > 0) {
      // Determine default
      let hasDefault = businessAssignments.some(a => a.isDefault);
      finalAssignments = businessAssignments.map((a, idx) => ({
        businessId: a.businessId,
        roleId: a.roleId,
        isDefault: hasDefault ? Boolean(a.isDefault) : idx === 0, // if none specified, first is default
      }));

      // Ensure exactly one is default
      const defaultCount = finalAssignments.filter(a => a.isDefault).length;
      if (defaultCount > 1) {
        // Keep only first
        let foundFirst = false;
        finalAssignments = finalAssignments.map(a => {
          if (a.isDefault && !foundFirst) {
            foundFirst = true;
            return a;
          }
          return { ...a, isDefault: false };
        });
      }
    } else if (roleId) {
      // Legacy single role on current business
      finalAssignments = [{
        businessId: req.user!.currentBusinessId,
        roleId,
        isDefault: true,
      }];
    } else if (!isSuperAdmin) {
      res.status(400).json({ error: 'At least one business and role assignment is required.' });
      return;
    }

    const passwordHash = await hashPassword(password);

    await client.query('BEGIN');

    const canGrantSuperAdmin = req.user!.isSuperAdmin ? Boolean(isSuperAdmin) : false;

    const insertUserRes = await client.query(`
      INSERT INTO users (
        username, email, mobile, full_name, password_hash,
        status, is_super_admin, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `, [
      username,
      email || null,
      mobile || null,
      fullName,
      passwordHash,
      status || 'ACTIVE',
      canGrantSuperAdmin,
      req.user!.id,
    ]);

    const createdUser = insertUserRes.rows[0];

    // Insert business accesses and roles
    for (const assignment of finalAssignments) {
      await client.query(`
        INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id, business_id) DO UPDATE SET is_default = EXCLUDED.is_default
      `, [createdUser.id, assignment.businessId, assignment.isDefault]);

      await client.query(`
        INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, business_id, role_id) DO NOTHING
      `, [createdUser.id, assignment.businessId, assignment.roleId, req.user!.id]);
    }

    await client.query('COMMIT');

    await recordAuditLog({
      businessId: req.user!.currentBusinessId,
      userId: req.user!.id,
      action: 'CREATE_USER',
      module: 'USERS',
      entityType: 'User',
      entityId: createdUser.id,
      newValue: {
        username: createdUser.username,
        fullName: createdUser.fullName,
        isSuperAdmin: createdUser.is_super_admin,
        assignmentsCount: finalAssignments.length,
      },
      req,
    });

    res.status(201).json({
      success: true,
      user: {
        id: createdUser.id,
        username: createdUser.username,
        email: createdUser.email,
        mobile: createdUser.mobile,
        fullName: createdUser.full_name,
        status: createdUser.status,
        isSuperAdmin: createdUser.is_super_admin,
        businessAssignments: finalAssignments,
      },
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Failed to create user' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/users/:id
 * Update user basic profile (Full Name, Email, Mobile, Status, Super Admin)
 */
router.put('/:id', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = updateUserProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid user data' });
      return;
    }

    const targetUserId = req.params.id;
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { fullName, email, mobile, status, isSuperAdmin } = parseResult.data;

    // Prevent self-deactivation
    if (targetUserId === req.user!.id && status && status !== 'ACTIVE') {
      res.status(400).json({ error: 'You cannot deactivate your own user account.' });
      return;
    }

    const updateFields: any = {
      fullName,
      email: email || null,
      mobile: mobile || null,
      updatedAt: new Date(),
    };

    if (status) {
      updateFields.status = status;
    }

    // Only Super Admin can change isSuperAdmin flag
    if (req.user!.isSuperAdmin && isSuperAdmin !== undefined) {
      // Prevent super admin from removing their own super admin flag if they are the only one
      if (targetUserId === req.user!.id && isSuperAdmin === false) {
        const countRes = await pool.query(`SELECT COUNT(*)::int as cnt FROM users WHERE is_super_admin = true AND status = 'ACTIVE'`);
        if ((countRes.rows[0]?.cnt || 0) <= 1) {
          res.status(400).json({ error: 'Cannot remove Super Admin from the only active Super Administrator.' });
          return;
        }
      }
      updateFields.isSuperAdmin = isSuperAdmin;
    }

    const [updated] = await db
      .update(users)
      .set(updateFields)
      .where(eq(users.id, targetUserId))
      .returning();

    await recordAuditLog({
      businessId: req.user!.currentBusinessId,
      userId: req.user!.id,
      action: 'UPDATE_USER',
      module: 'USERS',
      entityType: 'User',
      entityId: updated.id,
      previousValue: {
        fullName: targetUser.fullName,
        email: targetUser.email,
        mobile: targetUser.mobile,
        status: targetUser.status,
        isSuperAdmin: targetUser.isSuperAdmin,
      },
      newValue: {
        fullName: updated.fullName,
        email: updated.email,
        mobile: updated.mobile,
        status: updated.status,
        isSuperAdmin: updated.isSuperAdmin,
      },
      req,
    });

    res.json({ success: true, user: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update user profile' });
  }
});

/**
 * PUT /api/users/:id/business-access
 * Update authorized businesses, roles per business, and default business atomically
 */
router.put('/:id/business-access', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const parseResult = updateBusinessAccessSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid access payload' });
      return;
    }

    const targetUserId = req.params.id;
    const { assignments, defaultBusinessId } = parseResult.data;

    // Check user exists
    const userRes = await client.query(`SELECT id, username, is_super_admin FROM users WHERE id = $1`, [targetUserId]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const targetUser = userRes.rows[0];

    // Non-superadmin cannot have 0 business assignments
    if (!targetUser.is_super_admin && assignments.length === 0) {
      res.status(400).json({ error: 'Standard users must be assigned to at least one business.' });
      return;
    }

    // Determine and validate the default business
    let resolvedDefaultBusinessId: string | null = null;
    if (assignments.length > 0) {
      if (defaultBusinessId && assignments.some(a => a.businessId === defaultBusinessId)) {
        resolvedDefaultBusinessId = defaultBusinessId;
      } else {
        // Pick first assigned business as default
        resolvedDefaultBusinessId = assignments[0].businessId;
      }
    }

    await client.query('BEGIN');

    // Remove existing roles and business accesses for this user
    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [targetUserId]);
    await client.query(`DELETE FROM user_business_access WHERE user_id = $1`, [targetUserId]);

    // Insert new business access rows (at most one is_default = true)
    for (const a of assignments) {
      const isDef = a.businessId === resolvedDefaultBusinessId;
      await client.query(`
        INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
        VALUES ($1, $2, $3, NOW())
      `, [targetUserId, a.businessId, isDef]);

      await client.query(`
        INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, business_id, role_id) DO NOTHING
      `, [targetUserId, a.businessId, a.roleId, req.user!.id]);
    }

    await client.query('COMMIT');

    await recordAuditLog({
      businessId: req.user!.currentBusinessId,
      userId: req.user!.id,
      action: 'UPDATE_USER_BUSINESS_ACCESS',
      module: 'USERS',
      entityType: 'UserBusinessAccess',
      entityId: targetUserId,
      newValue: {
        userId: targetUserId,
        assignmentsCount: assignments.length,
        defaultBusinessId: resolvedDefaultBusinessId,
      },
      req,
    });

    res.json({
      success: true,
      message: 'User business access and roles updated successfully.',
      defaultBusinessId: resolvedDefaultBusinessId,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Failed to update user business access' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/users/:id/status
 * Update user active/inactive/locked status
 */
router.put('/:id/status', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE', 'LOCKED'].includes(status)) {
      res.status(400).json({ error: 'Status must be ACTIVE, INACTIVE, or LOCKED' });
      return;
    }

    const [targetUser] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!req.user!.isSuperAdmin) {
      const [userAccess] = await db
        .select()
        .from(userBusinessAccess)
        .where(and(eq(userBusinessAccess.userId, targetUser.id), eq(userBusinessAccess.businessId, req.user!.currentBusinessId)))
        .limit(1);

      if (!userAccess) {
        res.status(403).json({ error: 'Access denied: Target user does not belong to your business' });
        return;
      }
    }

    if (targetUser.id === req.user!.id && status !== 'ACTIVE') {
      res.status(400).json({ error: 'You cannot deactivate your own user account.' });
      return;
    }

    const [updated] = await db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, req.params.id))
      .returning();

    await recordAuditLog({
      businessId: req.user!.currentBusinessId,
      userId: req.user!.id,
      action: 'UPDATE_USER_STATUS',
      module: 'USERS',
      entityType: 'User',
      entityId: updated.id,
      previousValue: { status: targetUser.status },
      newValue: { status: updated.status },
      req,
    });

    res.json({ success: true, status: updated.status });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update status' });
  }
});

/**
 * POST /api/users/:id/reset-password
 * Reset user password
 */
router.post('/:id/reset-password', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }

    const [targetUser] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!req.user!.isSuperAdmin) {
      const [userAccess] = await db
        .select()
        .from(userBusinessAccess)
        .where(and(eq(userBusinessAccess.userId, targetUser.id), eq(userBusinessAccess.businessId, req.user!.currentBusinessId)))
        .limit(1);

      if (!userAccess) {
        res.status(403).json({ error: 'Access denied: Target user does not belong to your business' });
        return;
      }
    }

    const passwordHash = await hashPassword(newPassword);

    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, req.params.id));

    await recordAuditLog({
      businessId: req.user!.currentBusinessId,
      userId: req.user!.id,
      action: 'RESET_PASSWORD',
      module: 'USERS',
      entityType: 'User',
      entityId: targetUser.id,
      newValue: { message: 'Password was updated by administrator' },
      req,
    });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to reset password' });
  }
});

export default router;
