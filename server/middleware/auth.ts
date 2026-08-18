import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken, AuthJwtPayload } from '../auth/jwt.js';
import { db } from '../db/index.js';
import { users, userBusinessAccess, businesses, userRoles, roles, rolePermissions, permissions } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email?: string | null;
  mobile?: string | null;
  fullName: string;
  isSuperAdmin: boolean;
  currentBusinessId: string;
  currentBusiness?: {
    id: string;
    name: string;
    tradeName?: string | null;
    gstin?: string | null;
    currency: string;
    status: string;
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
    const [userRecord] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);

    if (!userRecord || userRecord.status !== 'ACTIVE') {
      res.status(401).json({
        error: 'USER_INACTIVE_OR_NOT_FOUND',
        message: 'Your account is inactive, locked, or no longer exists.',
      });
      return;
    }

    // 2. Resolve target business ID
    const requestedBusinessId = (req.headers['x-business-id'] as string) || payload.businessId;

    let targetBusinessId = requestedBusinessId;

    // Check user's authorized businesses
    const accessibleBusinesses = await db
      .select({
        businessId: userBusinessAccess.businessId,
        isDefault: userBusinessAccess.isDefault,
        business: businesses,
      })
      .from(userBusinessAccess)
      .innerJoin(businesses, eq(userBusinessAccess.businessId, businesses.id))
      .where(eq(userBusinessAccess.userId, userRecord.id));

    if (accessibleBusinesses.length === 0 && !userRecord.isSuperAdmin) {
      res.status(403).json({
        error: 'NO_BUSINESS_ACCESS',
        message: 'No business assigned to your user account.',
      });
      return;
    }

    // If super admin has no explicit access row, allow access to first active business or requested
    let currentBusiness = accessibleBusinesses.find(b => b.businessId === targetBusinessId)?.business;

    if (!currentBusiness) {
      if (userRecord.isSuperAdmin) {
        if (targetBusinessId) {
          const [foundBiz] = await db.select().from(businesses).where(eq(businesses.id, targetBusinessId)).limit(1);
          currentBusiness = foundBiz;
        } else {
          const [firstBiz] = await db.select().from(businesses).where(eq(businesses.status, 'ACTIVE')).limit(1);
          currentBusiness = firstBiz;
        }
      } else {
        // Pick default or first accessible business
        const defaultBiz = accessibleBusinesses.find(b => b.isDefault) || accessibleBusinesses[0];
        currentBusiness = defaultBiz?.business;
      }
    }

    if (!currentBusiness) {
      res.status(403).json({
        error: 'UNAUTHORIZED_BUSINESS_ACCESS',
        message: 'You do not have authorization to access this business.',
      });
      return;
    }

    targetBusinessId = currentBusiness.id;

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
          // Role matching
          eq(rolePermissions.roleId, roleIds[0]) // or inArray if multiple
        );
      userPermissionsList = Array.from(new Set(perms.map(p => p.code)));
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
      currentBusiness: {
        id: currentBusiness.id,
        name: currentBusiness.name,
        tradeName: currentBusiness.tradeName,
        gstin: currentBusiness.gstin,
        currency: currentBusiness.currency,
        status: currentBusiness.status,
      },
      roles: userRolesList,
      permissions: userPermissionsList,
    };

    next();
  } catch (error: any) {
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message: error.message || 'Invalid or expired session. Please log in again.',
    });
  }
}
