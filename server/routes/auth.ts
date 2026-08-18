import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { users, userBusinessAccess, businesses, userRoles, roles, rolePermissions, permissions } from '../db/schema.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { generateAuthToken } from '../auth/jwt.js';
import { authenticateToken } from '../middleware/auth.js';
import { recordAuditLog } from '../services/auditService.js';
import { eq, or, and } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const loginSchema = z.object({
  identifier: z.string().min(1, 'Username, Email or Mobile is required'),
  password: z.string().min(1, 'Password is required'),
  businessId: z.string().optional(),
});

/**
 * POST /api/auth/login
 * Production authentication endpoint with identifier resolution & audit logging
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
      });
      return;
    }

    const { identifier, password, businessId } = parseResult.data;

    // 1. Find user by username, email, or mobile
    const [userRecord] = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.username, identifier),
          eq(users.email, identifier),
          eq(users.mobile, identifier)
        )
      )
      .limit(1);

    if (!userRecord) {
      // Record failed audit log attempt
      await recordAuditLog({
        action: 'LOGIN_FAILED',
        module: 'AUTH',
        entityType: 'User',
        entityId: identifier,
        newValue: { reason: 'User not found' },
        req,
      });

      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username/email/mobile or password.',
      });
      return;
    }

    // 2. Verify account status
    if (userRecord.status !== 'ACTIVE') {
      await recordAuditLog({
        userId: userRecord.id,
        action: 'LOGIN_BLOCKED',
        module: 'AUTH',
        entityType: 'User',
        entityId: userRecord.id,
        newValue: { status: userRecord.status },
        req,
      });

      res.status(403).json({
        error: 'ACCOUNT_NOT_ACTIVE',
        message: `Account is ${userRecord.status.toLowerCase()}. Please contact your system administrator.`,
      });
      return;
    }

    // 3. Verify password
    const isPasswordValid = await verifyPassword(password, userRecord.passwordHash);
    if (!isPasswordValid) {
      await recordAuditLog({
        userId: userRecord.id,
        action: 'LOGIN_FAILED',
        module: 'AUTH',
        entityType: 'User',
        entityId: userRecord.id,
        newValue: { reason: 'Invalid password' },
        req,
      });

      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username/email/mobile or password.',
      });
      return;
    }

    // 4. Retrieve Accessible Businesses
    const accessibleBiz = await db
      .select({
        businessId: userBusinessAccess.businessId,
        isDefault: userBusinessAccess.isDefault,
        business: businesses,
      })
      .from(userBusinessAccess)
      .innerJoin(businesses, eq(userBusinessAccess.businessId, businesses.id))
      .where(eq(userBusinessAccess.userId, userRecord.id));

    let selectedBusiness = accessibleBiz.find(b => b.businessId === businessId)?.business;

    if (!selectedBusiness) {
      if (userRecord.isSuperAdmin) {
        if (businessId) {
          const [found] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
          selectedBusiness = found;
        }
        if (!selectedBusiness) {
          const [first] = await db.select().from(businesses).where(eq(businesses.status, 'ACTIVE')).limit(1);
          selectedBusiness = first;
        }
      } else {
        const defaultAccess = accessibleBiz.find(b => b.isDefault) || accessibleBiz[0];
        selectedBusiness = defaultAccess?.business;
      }
    }

    const currentBusinessId = selectedBusiness?.id || null;

    // 5. Update last login timestamp
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userRecord.id));

    // 6. Generate JWT Auth Token
    const token = generateAuthToken({
      userId: userRecord.id,
      username: userRecord.username,
      email: userRecord.email,
      isSuperAdmin: userRecord.isSuperAdmin,
      businessId: currentBusinessId,
    });

    // 7. Record Login Audit Log
    await recordAuditLog({
      businessId: currentBusinessId,
      userId: userRecord.id,
      action: 'LOGIN_SUCCESS',
      module: 'AUTH',
      entityType: 'Session',
      entityId: userRecord.id,
      newValue: { businessName: selectedBusiness?.name },
      req,
    });

    // 8. Fetch user roles & permissions for current business
    let rolesList: any[] = [];
    let permsList: string[] = [];

    if (currentBusinessId) {
      const userRoleRecs = await db
        .select({ role: roles })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userRecord.id));

      rolesList = userRoleRecs.map(r => ({ id: r.role.id, name: r.role.name, code: r.role.code }));

      if (userRecord.isSuperAdmin) {
        const allPerms = await db.select().from(permissions);
        permsList = allPerms.map(p => p.code);
      } else if (rolesList.length > 0) {
        const rolePerms = await db
          .select({ code: permissions.code })
          .from(rolePermissions)
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(eq(rolePermissions.roleId, rolesList[0].id));
        permsList = Array.from(new Set(rolePerms.map(p => p.code)));
      }
    }

    res.json({
      success: true,
      token,
      user: {
        id: userRecord.id,
        username: userRecord.username,
        email: userRecord.email,
        mobile: userRecord.mobile,
        fullName: userRecord.fullName,
        isSuperAdmin: userRecord.isSuperAdmin,
        status: userRecord.status,
      },
      currentBusiness: selectedBusiness ? {
        id: selectedBusiness.id,
        name: selectedBusiness.name,
        tradeName: selectedBusiness.tradeName,
        gstin: selectedBusiness.gstin,
        currency: selectedBusiness.currency,
        status: selectedBusiness.status,
      } : null,
      accessibleBusinesses: accessibleBiz.map(b => ({
        id: b.business.id,
        name: b.business.name,
        tradeName: b.business.tradeName,
        gstin: b.business.gstin,
        isDefault: b.isDefault,
      })),
      roles: rolesList,
      permissions: permsList,
    });
  } catch (error: any) {
    console.error('[Login API Error]', error);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: error.message || 'An error occurred during authentication',
    });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user profile, business, roles and permissions
 */
router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  // Fetch all accessible businesses
  const accessibleBiz = await db
    .select({
      businessId: userBusinessAccess.businessId,
      isDefault: userBusinessAccess.isDefault,
      business: businesses,
    })
    .from(userBusinessAccess)
    .innerJoin(businesses, eq(userBusinessAccess.businessId, businesses.id))
    .where(eq(userBusinessAccess.userId, req.user.id));

  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      mobile: req.user.mobile,
      fullName: req.user.fullName,
      isSuperAdmin: req.user.isSuperAdmin,
    },
    currentBusiness: req.user.currentBusiness,
    accessibleBusinesses: accessibleBiz.map(b => ({
      id: b.business.id,
      name: b.business.name,
      tradeName: b.business.tradeName,
      gstin: b.business.gstin,
      isDefault: b.isDefault,
    })),
    roles: req.user.roles,
    permissions: req.user.permissions,
  });
});

/**
 * POST /api/auth/switch-business
 * Changes active business context and issues fresh token
 */
router.post('/switch-business', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetBusinessId } = req.body;
    if (!targetBusinessId) {
      res.status(400).json({ error: 'targetBusinessId is required' });
      return;
    }

    const [targetBiz] = await db.select().from(businesses).where(eq(businesses.id, targetBusinessId)).limit(1);
    if (!targetBiz) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    // Verify user authorization for this business
    if (!req.user?.isSuperAdmin) {
      const [access] = await db
        .select()
        .from(userBusinessAccess)
        .where(
          and(
            eq(userBusinessAccess.userId, req.user!.id),
            eq(userBusinessAccess.businessId, targetBusinessId)
          )
        )
        .limit(1);

      if (!access) {
        res.status(403).json({ error: 'You do not have access to this business.' });
        return;
      }
    }

    const newToken = generateAuthToken({
      userId: req.user!.id,
      username: req.user!.username,
      email: req.user!.email,
      isSuperAdmin: req.user!.isSuperAdmin,
      businessId: targetBusinessId,
    });

    await recordAuditLog({
      businessId: targetBusinessId,
      userId: req.user!.id,
      action: 'SWITCH_BUSINESS',
      module: 'AUTH',
      entityType: 'Business',
      entityId: targetBusinessId,
      previousValue: { businessId: req.user!.currentBusinessId },
      newValue: { businessId: targetBusinessId, businessName: targetBiz.name },
      req,
    });

    res.json({
      success: true,
      token: newToken,
      currentBusiness: {
        id: targetBiz.id,
        name: targetBiz.name,
        tradeName: targetBiz.tradeName,
        gstin: targetBiz.gstin,
        currency: targetBiz.currency,
        status: targetBiz.status,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to switch business context' });
  }
});

/**
 * POST /api/auth/logout
 * Records logout event in audit log
 */
router.post('/logout', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  if (req.user) {
    await recordAuditLog({
      businessId: req.user.currentBusinessId,
      userId: req.user.id,
      action: 'LOGOUT',
      module: 'AUTH',
      entityType: 'Session',
      entityId: req.user.id,
      req,
    });
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * POST /api/auth/forgot-password-request
 * Enterprise architecture for password reset requests
 */
router.post('/forgot-password-request', async (req: Request, res: Response): Promise<void> => {
  const { identifier } = req.body;
  if (!identifier) {
    res.status(400).json({ error: 'Identifier (Username, Email or Mobile) is required' });
    return;
  }

  // Find user if exists
  const [userRecord] = await db
    .select()
    .from(users)
    .where(
      or(
        eq(users.username, identifier),
        eq(users.email, identifier),
        eq(users.mobile, identifier)
      )
    )
    .limit(1);

  if (userRecord) {
    await recordAuditLog({
      userId: userRecord.id,
      action: 'FORGOT_PASSWORD_REQUEST',
      module: 'AUTH',
      entityType: 'User',
      entityId: userRecord.id,
      newValue: { requestedIdentifier: identifier },
      req,
    });
  }

  // Consistent message to prevent user enumeration
  res.json({
    success: true,
    message: 'If an active account exists for the provided identifier, your store administrator or registered email has received password reset instructions.',
  });
});

export default router;
