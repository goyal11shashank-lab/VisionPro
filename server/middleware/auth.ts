import { legacyScopeRouteAllowed } from '../services/legacyScopeSafetyService.js';
import { staffOwnBusinessId } from '../services/staffBusinessPolicy.js';
import { canonicalBusinessFor, restrictBusinessChoices } from '../services/canonicalLoginService.js';
import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken, AuthJwtPayload } from '../auth/jwt.js';
import { db, pool } from '../db/index.js';
import { users, userBusinessAccess, businesses, userRoles, roles, rolePermissions, permissions, godowns } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { businessUsableByStaff, businessInactiveBody } from '../services/businessStatusPolicy.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email?: string | null;
  mobile?: string | null;
  fullName: string;
  isSuperAdmin: boolean;
  currentBusinessId: string;
  assignedGodownId?: string | null;
  assignedGodown?: {
    id: string;
    code: string;
    name: string;
    godownType: string;
    status: string;
  } | null;
  currentBusiness?: {
    id: string;
    name: string;
    tradeName?: string | null;
    gstin?: string | null;
    state?: string | null;
    stateCode?: string | null;
    city?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    pincode?: string | null;
    currency: string;
    status: string;
    businessType: string;
    parentBusinessId?: string | null;
    onboardingCompleted?: boolean;
  };
  roles: Array<{ id: string; name: string; code: string }>;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Access denied. Valid Bearer authentication token is required.',
    });
    return;
  }

  try {
    const payload = verifyAuthToken(token);

    // 1. Fetch user from database to verify active status
    let userRecord: typeof users.$inferSelect | undefined;
    try {
      const rows = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      userRecord = rows[0];
    } catch (err: any) {
      try {
        const rawRes = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [payload.userId]);
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
            assignedGodownId: row.assigned_godown_id ?? row.assignedGodownId ?? null,
            userPermissionsOverride: row.user_permissions_override ?? row.userPermissionsOverride ?? null,
            createdAt: row.created_at ?? row.createdAt ?? new Date(),
            updatedAt: row.updated_at ?? row.updatedAt ?? new Date(),
            createdBy: row.created_by ?? row.createdBy ?? null,
          };
        }
      } catch (rawErr) {
        console.error('[AUTH_TOKEN_RAW_USER_LOOKUP_FAILED]', rawErr);
      }
    }

    if (!userRecord || userRecord.status !== 'ACTIVE') {
      res.status(401).json({
        error: 'USER_INACTIVE_OR_NOT_FOUND',
        message: 'Your account is inactive, locked, or no longer exists.',
      });
      return;
    }

    const canonicalBusinessId=await canonicalBusinessFor(userRecord);

    // 1B. Godown Staff Isolation Enforcement
    let assignedGodownRecord: typeof godowns.$inferSelect | undefined;
    if (userRecord.assignedGodownId) {
      const [gdn] = await db
        .select()
        .from(godowns)
        .where(eq(godowns.id, userRecord.assignedGodownId))
        .limit(1);

      if (!gdn || gdn.status !== 'ACTIVE') {
        res.status(403).json({
          error: 'GODOWN_INACTIVE_OR_SUSPENDED',
          message: 'Your assigned godown is inactive, suspended, or no longer exists. Access denied.',
        });
        return;
      }
      assignedGodownRecord = gdn;
    }

    // 2. Resolve target business ID
    let currentBusiness: typeof businesses.$inferSelect | undefined;

    if (assignedGodownRecord) {
      // ZERO-TRUST DERIVATION: Godown user's parent business is strictly derived from godown entity.
      // Any client-supplied x-business-id or token override is completely forbidden and ignored!
      const [parentBiz] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, assignedGodownRecord.businessId))
        .limit(1);

      if (!parentBiz || parentBiz.status !== 'ACTIVE') {
        res.status(403).json({
          error: 'PARENT_BUSINESS_INACTIVE',
          message: 'The parent business for this godown is inactive or unavailable.',
        });
        return;
      }
      currentBusiness = parentBiz;
    } else {
      const headerBizId = req.headers['x-business-id'] as string | undefined;
      const cleanHeaderBizId = headerBizId && headerBizId !== 'undefined' && headerBizId !== 'null' && headerBizId.trim()
        ? headerBizId.trim()
        : undefined;

      const tokenBizId = payload.businessId && payload.businessId !== 'undefined' && payload.businessId !== 'null' && payload.businessId.trim()
        ? payload.businessId.trim()
        : undefined;

      // Explicitly requested business (header takes precedence if supplied, else token)
      const explicitlyRequestedId = cleanHeaderBizId || tokenBizId;

      // Check user's authorized businesses
      let accessibleBusinesses = await db
        .select({
          businessId: userBusinessAccess.businessId,
          isDefault: userBusinessAccess.isDefault,
          business: businesses,
        })
        .from(userBusinessAccess)
        .innerJoin(businesses, eq(userBusinessAccess.businessId, businesses.id))
        .where(eq(userBusinessAccess.userId, userRecord.id));

      accessibleBusinesses=restrictBusinessChoices(accessibleBusinesses,canonicalBusinessId);
      // One staff login, one business: a legacy login with several access rows is held to its default business. No row is changed.
      if (!userRecord.isSuperAdmin) {
        const ownBizId = staffOwnBusinessId(accessibleBusinesses);
        if (ownBizId) accessibleBusinesses = accessibleBusinesses.filter(b => b.businessId === ownBizId);
      }

      if (accessibleBusinesses.length === 0 && !userRecord.isSuperAdmin) {
        res.status(403).json({
          error: 'NO_BUSINESS_ACCESS',
          message: 'No business assigned to your user account.',
        });
        return;
      }

      if (userRecord.isSuperAdmin) {
        // Super Admin can access any business
        if (explicitlyRequestedId) {
          try {
            const [foundBiz] = await db.select().from(businesses).where(eq(businesses.id, explicitlyRequestedId)).limit(1);
            currentBusiness = foundBiz;
          } catch (bizErr) {
            console.warn('[AUTH_TARGET_BIZ_LOOKUP_FAILED]', bizErr);
          }
        }
        if (!currentBusiness) {
          currentBusiness = accessibleBusinesses.find(b => b.isDefault)?.business || accessibleBusinesses[0]?.business;
        }
        if (!currentBusiness) {
          const [firstBiz] = await db.select().from(businesses).where(eq(businesses.status, 'ACTIVE')).limit(1);
          currentBusiness = firstBiz;
        }
      } else {
        // Normal users: strictly enforce authorized membership!
        if (explicitlyRequestedId) {
          const matchingAccess = accessibleBusinesses.find(b => b.businessId === explicitlyRequestedId);
          if (!matchingAccess) {
            // Explicitly requested an unauthorized business! Deny immediately.
            res.status(403).json({
              error: 'UNAUTHORIZED_BUSINESS_ACCESS',
              message: 'You do not have authorization to access this business.',
            });
            return;
          }
          currentBusiness = matchingAccess.business;
        } else {
          // No explicit business requested: fall back to default or first accessible
          const defaultBiz = accessibleBusinesses.find(b => b.isDefault) || accessibleBusinesses[0];
          currentBusiness = defaultBiz?.business;
        }
      }
    }

    if (!currentBusiness) {
      res.status(403).json({
        error: 'UNAUTHORIZED_BUSINESS_ACCESS',
        message: 'You do not have authorization to access this business.',
      });
      return;
    }

    // Owner rule (Nov 20, 2026): an inactive business stops its staff's access -
    // no entries and no continued session use. Super Administrator keeps access
    // for management and history. Applies to existing tokens, not only fresh logins.
    if (!userRecord.isSuperAdmin && !businessUsableByStaff(currentBusiness)) {
      res.status(403).json(businessInactiveBody(currentBusiness));
      return;
    }

    const targetBusinessId = currentBusiness.id;

    // 3. Fetch User Roles for current business
    const userRoleRecords = await db
      .select({
        role: roles,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userRecord.id),
          eq(userRoles.businessId, targetBusinessId)
        )
      );

    const userRolesList = userRoleRecords.map(r => ({
      id: r.role.id,
      name: r.role.name,
      code: r.role.code,
    }));

    // 4. Fetch granular permissions for these roles
    const roleIds = userRolesList.map(r => r.id);
    let userPermissionsList: string[] = [];

    if (userRecord.isSuperAdmin) {
      // Super admin possesses all permissions
      const allPerms = await db.select({ code: permissions.code }).from(permissions);
      userPermissionsList = allPerms.map(p => p.code);
    } else if (roleIds.length > 0) {
      const perms = await db
        .select({
          code: permissions.code,
        })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(
          inArray(rolePermissions.roleId, roleIds)
        );
      userPermissionsList = Array.from(new Set(perms.map(p => p.code)));
    }

    // If user has userPermissionsOverride, merge/override allowed permissions
    if ((userRecord as any).userPermissionsOverride && typeof (userRecord as any).userPermissionsOverride === 'object') {
      const overrides = (userRecord as any).userPermissionsOverride;
      for (const [permCode, enabled] of Object.entries(overrides)) {
        if (enabled === false) {
          userPermissionsList = userPermissionsList.filter(p => p !== permCode);
        } else if (enabled === true && !userPermissionsList.includes(permCode)) {
          userPermissionsList.push(permCode);
        }
      }
    }

    // Attach complete user context to request
    req.user = {
      id: userRecord.id,
      username: userRecord.username,
      email: userRecord.email,
      mobile: userRecord.mobile,
      fullName: userRecord.fullName,
      isSuperAdmin: userRecord.isSuperAdmin,
      currentBusinessId: targetBusinessId,
      assignedGodownId: assignedGodownRecord ? assignedGodownRecord.id : null,
      assignedGodown: assignedGodownRecord ? {
        id: assignedGodownRecord.id,
        code: assignedGodownRecord.code,
        name: assignedGodownRecord.name,
        godownType: assignedGodownRecord.godownType,
        status: assignedGodownRecord.status,
      } : null,
      currentBusiness: {
        id: currentBusiness.id,
        name: currentBusiness.name,
        tradeName: currentBusiness.tradeName,
        gstin: currentBusiness.gstin,
        state: currentBusiness.state,
        stateCode: currentBusiness.stateCode,
        city: currentBusiness.city,
        addressLine1: currentBusiness.addressLine1,
        addressLine2: currentBusiness.addressLine2,
        pincode: currentBusiness.pincode,
        currency: currentBusiness.currency,
        status: currentBusiness.status,
        businessType: currentBusiness.businessType || 'MAIN',
        parentBusinessId: currentBusiness.parentBusinessId || null,
        onboardingCompleted: Boolean((currentBusiness.settingsConfig as any)?.dealer?.onboardingCompleted ?? false),
      },
      roles: userRolesList,
      permissions: userPermissionsList,
    };

    if(!await legacyScopeRouteAllowed(req)){res.status(403).json({error:'LEGACY_SCOPE_ADAPTER_REQUIRED',message:'This historical stock-assigned login cannot open unscoped Business data. Its existing assignment is preserved pending reviewed Business conversion.'});return;}
    next();
  } catch (error: any) {
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: error.message || 'Invalid or expired session. Please log in again.',
    });
  }
}
