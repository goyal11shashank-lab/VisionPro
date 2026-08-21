import { Router, Request, Response } from 'express';
import { db, pool, checkDatabaseConnection, resolveDatabaseConfig } from '../db/index.js';
import { users, userBusinessAccess, businesses, userRoles, roles, rolePermissions, permissions, auditLogs } from '../db/schema.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { generateAuthToken } from '../auth/jwt.js';
import { authenticateToken } from '../middleware/auth.js';
import { recordAuditLog } from '../services/auditService.js';
import { ensureMigrationsRun } from '../db/migrate.js';
import { eq, or, and } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

function safeError(error: any) {
  if (!error) return { message: 'Unknown error' };
  const cause = error.cause || {};
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code || cause.code,
    detail: error.detail || cause.detail,
    hint: error.hint || cause.hint,
    table: error.table || cause.table,
    column: error.column || cause.column,
    constraint: error.constraint || cause.constraint,
    position: error.position || cause.position,
    causeMessage: cause.message || undefined,
  };
}

const loginSchema = z.object({
  identifier: z.string().min(1, 'Username, Email or Mobile is required'),
  password: z.string().min(1, 'Password is required'),
  businessId: z.string().optional(),
});

const bootstrapSchema = z.object({
  fullName: z.string().min(2, 'Full Name is required'),
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Valid email is required'),
  mobile: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  businessName: z.string().min(2, 'Initial Business Name is required'),
  tradeName: z.string().optional(),
  gstin: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

/**
 * GET /api/auth/bootstrap-status
 * Inspects whether the system requires initial Super Admin setup.
 */
router.get('/bootstrap-status', async (req: Request, res: Response): Promise<void> => {
  try {
    const dbStatus = await checkDatabaseConnection();
    if (!dbStatus.connected) {
      res.status(200).json({
        needsBootstrap: false,
        databaseConnected: false,
        provider: dbStatus.provider,
        error: dbStatus.error || 'Database connection unavailable. Please check the server configuration.',
        tip: dbStatus.tip,
      });
      return;
    }

    await ensureMigrationsRun();

    // Check if any Super Admin exists in the database
    const superAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isSuperAdmin, true))
      .limit(1);

    const hasSuperAdmin = superAdmins.length > 0;

    res.json({
      needsBootstrap: !hasSuperAdmin,
      databaseConnected: true,
      provider: dbStatus.provider,
    });
  } catch (error: any) {
    console.error('[Bootstrap Status Error]', error);
    res.status(200).json({
      needsBootstrap: false,
      databaseConnected: false,
      error: error?.message || 'Database initialization error. Please verify PostgreSQL connection.',
      tip: 'Check server logs for database migration details.',
    });
  }
});

/**
 * POST /api/auth/bootstrap-admin
 * Secure First-Admin Bootstrap Mechanism.
 * Strictly allowed only when ZERO Super Admins exist in PostgreSQL database.
 */
router.post('/bootstrap-admin', async (req: Request, res: Response): Promise<void> => {
  try {
    const dbStatus = await checkDatabaseConnection();
    if (!dbStatus.connected) {
      res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: 'Database connection unavailable. Please check the server configuration.',
      });
      return;
    }

    await ensureMigrationsRun();

    // 1. Guard: Check if a Super Admin already exists
    const existingSuperAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isSuperAdmin, true))
      .limit(1);

    if (existingSuperAdmins.length > 0) {
      res.status(403).json({
        error: 'BOOTSTRAP_ALREADY_COMPLETED',
        message: 'System bootstrap has already been completed. A Super Admin already exists.',
      });
      return;
    }

    // 2. Validate input payload
    const parseResult = bootstrapSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid setup data',
      });
      return;
    }

    const {
      fullName,
      username,
      email,
      mobile,
      password,
      businessName,
      tradeName,
      gstin,
      city,
      state,
    } = parseResult.data;

    // Hash secure password
    const passwordHash = await hashPassword(password);

    // Execute atomic transaction for all bootstrap steps (Business, User, Access, Role, Audit)
    const result = await db.transaction(async (tx) => {
      // 1. Create First Business Record
      const [newBiz] = await tx.insert(businesses).values({
        name: businessName.trim(),
        tradeName: tradeName?.trim() || businessName.trim(),
        gstin: gstin?.trim().toUpperCase() || null,
        email: email.trim().toLowerCase(),
        phone: mobile?.trim() || null,
        city: city?.trim() || 'Headquarters',
        state: state?.trim() || 'Central',
        currency: 'INR',
        financialYearStart: '04-01',
        status: 'ACTIVE',
      }).returning();

      // 2. Insert initial Super Admin into users table
      const [superAdminUser] = await tx.insert(users).values({
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        mobile: mobile?.trim() || null,
        fullName: fullName.trim(),
        passwordHash,
        status: 'ACTIVE',
        isSuperAdmin: true,
        lastLoginAt: new Date(),
      }).returning();

      // 3. Grant Super Admin default access to the initial business
      await tx.insert(userBusinessAccess).values({
        userId: superAdminUser.id,
        businessId: newBiz.id,
        isDefault: true,
      });

      // 4. Find or assign SUPER_ADMIN system role
      const [superAdminRole] = await tx.select().from(roles).where(eq(roles.code, 'SUPER_ADMIN')).limit(1);
      if (superAdminRole) {
        await tx.insert(userRoles).values({
          userId: superAdminUser.id,
          businessId: newBiz.id,
          roleId: superAdminRole.id,
        });
      }

      // 5. Record audit log of system bootstrap
      await tx.insert(auditLogs).values({
        businessId: newBiz.id,
        userId: superAdminUser.id,
        action: 'SUPER_ADMIN_CREATED',
        module: 'AUTH',
        entityType: 'SystemBootstrap',
        entityId: superAdminUser.id,
        newValue: {
          username: superAdminUser.username,
          email: superAdminUser.email,
          businessName: newBiz.name,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || undefined,
      });

      return {
        newBiz,
        superAdminUser,
        superAdminRole,
      };
    });

    const { newBiz, superAdminUser, superAdminRole } = result;

    // Generate JWT Auth Token
    const token = generateAuthToken({
      userId: superAdminUser.id,
      username: superAdminUser.username,
      email: superAdminUser.email,
      isSuperAdmin: true,
      businessId: newBiz.id,
    });

    // Fetch all permissions for Super Admin
    const allPerms = await db.select().from(permissions);
    const permsList = allPerms.map(p => p.code);

    res.json({
      success: true,
      message: 'Super Administrator bootstrapped successfully.',
      token,
      user: {
        id: superAdminUser.id,
        username: superAdminUser.username,
        email: superAdminUser.email,
        mobile: superAdminUser.mobile,
        fullName: superAdminUser.fullName,
        isSuperAdmin: true,
        status: superAdminUser.status,
      },
      currentBusiness: {
        id: newBiz.id,
        name: newBiz.name,
        tradeName: newBiz.tradeName,
        gstin: newBiz.gstin,
        currency: newBiz.currency,
        status: newBiz.status,
      },
      accessibleBusinesses: [{
        id: newBiz.id,
        name: newBiz.name,
        tradeName: newBiz.tradeName,
        gstin: newBiz.gstin,
        isDefault: true,
      }],
      roles: superAdminRole ? [{ id: superAdminRole.id, name: superAdminRole.name, code: superAdminRole.code }] : [],
      permissions: permsList,
    });
  } catch (error: any) {
    console.error('[Bootstrap Admin Error]', error);
    res.status(500).json({
      error: 'BOOTSTRAP_FAILED',
      message: error.message || 'Database connection unavailable. Please check the server configuration.',
    });
  }
});

/**
 * POST /api/auth/login
 * Production authentication endpoint with identifier resolution & audit logging
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const dbStatus = await checkDatabaseConnection();
    if (!dbStatus.connected) {
      console.warn('[LOGIN_ERROR_DATABASE_UNAVAILABLE] Database offline/unavailable during login attempt');
      res.status(503).json({
        success: false,
        error: 'DATABASE_UNAVAILABLE',
        message: 'Database connection unavailable. Please check the server configuration.',
      });
      return;
    }

    // 1. Request Body Parsing
    let parseResult: ReturnType<typeof loginSchema.safeParse>;
    try {
      parseResult = loginSchema.safeParse(req.body);
    } catch (parseError: any) {
      console.error('[LOGIN_ERROR_REQUEST_PARSING]', safeError(parseError));
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Failed to parse request body',
      });
      return;
    }

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: parseResult.error.issues[0]?.message || 'Invalid input',
      });
      return;
    }

    const { identifier, password, businessId } = parseResult.data;

    // 2. Database User Lookup
    let userRecord: typeof users.$inferSelect | undefined;
    try {
      const rows = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.username, identifier.trim().toLowerCase()),
            eq(users.email, identifier.trim().toLowerCase()),
            eq(users.mobile, identifier.trim())
          )
        )
        .limit(1);
      userRecord = rows[0];
    } catch (dbError: any) {
      const errInfo = safeError(dbError);
      console.error('[LOGIN_USER_LOOKUP_ERROR]', errInfo);

      // Resilient fallback: Query via raw SQL in case of transient schema or column naming differences
      try {
        const rawRes = await pool.query(
          `SELECT * FROM users 
           WHERE LOWER(username) = LOWER($1) 
              OR LOWER(email) = LOWER($1) 
              OR mobile = $1 
           LIMIT 1`,
          [identifier.trim()]
        );
        if (rawRes.rows.length > 0) {
          const row = rawRes.rows[0];
          userRecord = {
            id: row.id,
            username: row.username,
            email: row.email,
            mobile: row.mobile,
            fullName: row.full_name ?? row.fullName ?? row.fullname ?? '',
            passwordHash: row.password_hash ?? row.passwordHash ?? row.password ?? '',
            status: row.status ?? 'ACTIVE',
            isSuperAdmin: row.is_super_admin ?? row.isSuperAdmin ?? row.issuperadmin ?? false,
            lastLoginAt: row.last_login_at ?? row.lastLoginAt ?? null,
            createdAt: row.created_at ?? row.createdAt ?? new Date(),
            updatedAt: row.updated_at ?? row.updatedAt ?? new Date(),
            createdBy: row.created_by ?? row.createdBy ?? null,
          };
        }
      } catch (fallbackErr: any) {
        console.error('[LOGIN_USER_LOOKUP_RAW_FALLBACK_FAILED]', safeError(fallbackErr));
      }

      if (!userRecord) {
        res.status(500).json({
          success: false,
          error: 'DATABASE_QUERY_ERROR',
          message: 'Database query failed during user lookup',
          details: errInfo,
        });
        return;
      }
    }

    if (!userRecord) {
      // Record failed audit log attempt without failing the response
      try {
        await recordAuditLog({
          action: 'LOGIN_FAILED',
          module: 'AUTH',
          entityType: 'User',
          entityId: identifier,
          newValue: { reason: 'User not found' },
          req,
        });
      } catch (auditErr: any) {
        console.warn('[LOGIN_ERROR_AUDIT] Failed to record login failed audit log:', safeError(auditErr).message);
      }

      res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username/email/mobile or password.',
      });
      return;
    }

    // Account Status Verification
    if (userRecord.status !== 'ACTIVE') {
      try {
        await recordAuditLog({
          userId: userRecord.id,
          action: 'LOGIN_BLOCKED',
          module: 'AUTH',
          entityType: 'User',
          entityId: userRecord.id,
          newValue: { status: userRecord.status },
          req,
        });
      } catch (auditErr: any) {
        console.warn('[LOGIN_ERROR_AUDIT] Failed to record login blocked audit log:', safeError(auditErr).message);
      }

      res.status(403).json({
        success: false,
        error: 'ACCOUNT_NOT_ACTIVE',
        message: `Account is ${userRecord.status.toLowerCase()}. Please contact your system administrator.`,
      });
      return;
    }

    // 3. Password Verification
    let isPasswordValid = false;
    try {
      isPasswordValid = await verifyPassword(password, userRecord.passwordHash);
    } catch (pwdError: any) {
      console.error('[LOGIN_ERROR_PASSWORD_VERIFY]', safeError(pwdError));
      res.status(500).json({
        success: false,
        error: 'PASSWORD_VERIFY_ERROR',
        message: 'Failed to verify password credentials',
        details: safeError(pwdError),
      });
      return;
    }

    if (!isPasswordValid) {
      try {
        await recordAuditLog({
          userId: userRecord.id,
          action: 'LOGIN_FAILED',
          module: 'AUTH',
          entityType: 'User',
          entityId: userRecord.id,
          newValue: { reason: 'Invalid password' },
          req,
        });
      } catch (auditErr: any) {
        console.warn('[LOGIN_ERROR_AUDIT] Failed to record login failure audit log:', safeError(auditErr).message);
      }

      res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username/email/mobile or password.',
      });
      return;
    }

    // 4. Role & Business Lookup
    let accessibleBiz: any[] = [];
    let selectedBusiness: any = null;
    let rolesList: any[] = [];
    let permsList: string[] = [];

    try {
      accessibleBiz = await db
        .select({
          businessId: userBusinessAccess.businessId,
          isDefault: userBusinessAccess.isDefault,
          business: businesses,
        })
        .from(userBusinessAccess)
        .innerJoin(businesses, eq(userBusinessAccess.businessId, businesses.id))
        .where(eq(userBusinessAccess.userId, userRecord.id));

      selectedBusiness = accessibleBiz.find(b => b.businessId === businessId)?.business;

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
    } catch (roleError: any) {
      console.error('[LOGIN_ERROR_ROLE_LOOKUP]', safeError(roleError));
      res.status(500).json({
        success: false,
        error: 'ROLE_LOOKUP_ERROR',
        message: 'Failed to retrieve user roles or business access',
        details: safeError(roleError),
      });
      return;
    }

    const currentBusinessId = selectedBusiness?.id || null;

    // Update last login timestamp (non-blocking if fails)
    try {
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userRecord.id));
    } catch (updateErr: any) {
      console.warn('[LOGIN_WARN] Failed to update lastLoginAt:', safeError(updateErr).message);
    }

    // 5. JWT Generation
    let token = '';
    try {
      token = generateAuthToken({
        userId: userRecord.id,
        username: userRecord.username,
        email: userRecord.email,
        isSuperAdmin: userRecord.isSuperAdmin,
        businessId: currentBusinessId,
      });
    } catch (jwtError: any) {
      console.error('[LOGIN_ERROR_JWT_CREATION]', safeError(jwtError));
      res.status(500).json({
        success: false,
        error: 'JWT_CREATION_ERROR',
        message: 'Failed to generate authentication token',
        details: safeError(jwtError),
      });
      return;
    }

    // 6. Audit Logging (Isolated)
    try {
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
    } catch (auditErr: any) {
      console.warn('[LOGIN_ERROR_AUDIT] Failed to record login audit log:', safeError(auditErr).message);
    }

    // 7. Response Creation
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
    const errObj = safeError(error);
    console.error('[LOGIN_FATAL_ERROR]', errObj);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: errObj.message || 'An error occurred during authentication',
      details: errObj,
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
