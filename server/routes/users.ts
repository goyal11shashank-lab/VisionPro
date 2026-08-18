import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
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
  email: z.string().email('Valid email required').optional().or(z.literal('')),
  mobile: z.string().min(10, 'Valid 10-digit mobile required').optional().or(z.literal('')),
  fullName: z.string().min(2, 'Full Name is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  roleId: z.string().min(1, 'Role assignment is required'),
  isSuperAdmin: z.boolean().default(false),
});

/**
 * GET /api/users
 * List users associated with current business
 */
router.get('/', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.currentBusinessId;

    const userList = await db
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
      .where(eq(userBusinessAccess.businessId, businessId));

    // Fetch roles for each user in this business
    const userRoleList = await db
      .select({
        userId: userRoles.userId,
        roleId: roles.id,
        roleName: roles.name,
        roleCode: roles.code,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.businessId, businessId));

    const usersWithRoles = userList.map(u => {
      const uRoles = userRoleList.filter(ur => ur.userId === u.id).map(ur => ({
        id: ur.roleId,
        name: ur.roleName,
        code: ur.roleCode,
      }));
      return {
        ...u,
        roles: uRoles,
      };
    });

    res.json(usersWithRoles);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list users' });
  }
});

/**
 * POST /api/users
 * Create a new user, hash password, assign business and role
 */
router.post('/', authenticateToken, requirePermission('admin:manage_users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid user parameters' });
      return;
    }

    const { username, email, mobile, fullName, password, roleId, isSuperAdmin } = parseResult.data;
    const businessId = req.user!.currentBusinessId;

    // Check unique username
    const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing) {
      res.status(400).json({ error: `Username '${username}' is already taken.` });
      return;
    }

    // Verify role exists
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) {
      res.status(400).json({ error: 'Selected role not found.' });
      return;
    }

    const passwordHash = await hashPassword(password);

    const [createdUser] = await db.insert(users).values({
      username,
      email: email || null,
      mobile: mobile || null,
      fullName,
      passwordHash,
      status: 'ACTIVE',
      isSuperAdmin: req.user!.isSuperAdmin ? isSuperAdmin : false, // Only super admins can grant super admin
      createdBy: req.user!.id,
    }).returning();

    // Link user to business
    await db.insert(userBusinessAccess).values({
      userId: createdUser.id,
      businessId,
      isDefault: true,
    });

    // Assign Role
    await db.insert(userRoles).values({
      userId: createdUser.id,
      businessId,
      roleId,
      assignedBy: req.user!.id,
    });

    await recordAuditLog({
      businessId,
      userId: req.user!.id,
      action: 'CREATE_USER',
      module: 'USERS',
      entityType: 'User',
      entityId: createdUser.id,
      newValue: {
        username: createdUser.username,
        fullName: createdUser.fullName,
        roleName: role.name,
        roleCode: role.code,
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
        fullName: createdUser.fullName,
        status: createdUser.status,
        isSuperAdmin: createdUser.isSuperAdmin,
        roles: [{ id: role.id, name: role.name, code: role.code }],
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create user' });
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
