import { pool } from '../db/index.js';

/**
 * Role/permission ceiling enforcement for user/role assignment surfaces.
 *
 * A non-Super Admin actor may only grant a role whose permission set is a subset of the
 * actor's own effective permissions in the business the role applies to. This blocks
 * privilege escalation where an actor holds strong access in one business but weak access
 * in another, and tries to grant a stronger role than they hold in the weaker business.
 */

export async function getRolePermissionCodes(roleId: string): Promise<Set<string>> {
  const res = await pool.query(
    `SELECT p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId]
  );
  return new Set<string>(res.rows.map((r: any) => r.code));
}

export async function getUserEffectivePermissionCodes(userId: string, businessId: string): Promise<Set<string>> {
  const res = await pool.query(
    `SELECT DISTINCT p.code
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1 AND ur.business_id = $2`,
    [userId, businessId]
  );
  const perms = new Set<string>(res.rows.map((r: any) => r.code));

  // Apply per-user permission overrides consistently with the auth middleware.
  const overrideRes = await pool.query(
    `SELECT user_permissions_override FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const overrides = overrideRes.rows[0]?.user_permissions_override;
  if (overrides && typeof overrides === 'object') {
    for (const [code, enabled] of Object.entries(overrides)) {
      if (enabled === false) {
        perms.delete(code);
      } else if (enabled === true) {
        perms.add(code);
      }
    }
  }
  return perms;
}

/**
 * Returns the permission codes the given role would grant in `businessId` that the actor
 * does not effectively hold there. An empty array means the assignment is within the
 * actor's ceiling.
 */
export async function findExceedingPermissions(
  actorUserId: string,
  businessId: string,
  roleId: string
): Promise<string[]> {
  const [rolePerms, actorPerms] = await Promise.all([
    getRolePermissionCodes(roleId),
    getUserEffectivePermissionCodes(actorUserId, businessId),
  ]);
  return Array.from(rolePerms).filter(code => !actorPerms.has(code));
}

/**
 * Returns the ids of every business the user holds a membership in.
 */
export async function getUserAccessibleBusinessIds(userId: string): Promise<Set<string>> {
  const res = await pool.query(
    `SELECT business_id FROM user_business_access WHERE user_id = $1`,
    [userId]
  );
  return new Set<string>(res.rows.map((r: any) => r.business_id));
}

/**
 * TENANT SCOPE for role assignments. A role may be assigned in `targetBusinessId` only when:
 *   - it is a system-wide role (roles.business_id IS NULL), or
 *   - it is a custom role owned by the target business itself, or
 *   - it is a custom role owned by the Main Warehouse that owns the target Dealer
 *     (legitimate owner-to-own-dealer assignment, e.g. DealerUserManagementModal lists
 *     system roles plus the actor's Main business roles while managing its Dealers).
 * Anything else is a foreign-tenant role: even when its current permission set is
 * harmless, assigning it couples the target business to future permission edits made
 * by a different tenant, so it is rejected.
 *
 * Returns a human-readable violation message, or null when the assignment is allowed.
 * Also rejects nonexistent roles (ceiling checks alone treat an unknown role as
 * zero-permission and would let it through to a foreign-key failure).
 */
export async function findRoleTenantScopeViolation(roleId: string, targetBusinessId: string): Promise<string | null> {
  const roleRes = await pool.query(`SELECT business_id FROM roles WHERE id = $1`, [roleId]);
  if (roleRes.rows.length === 0) {
    return 'Role not found.';
  }
  const ownerBusinessId = roleRes.rows[0].business_id as string | null;
  if (!ownerBusinessId || ownerBusinessId === targetBusinessId) {
    return null;
  }
  const bizRes = await pool.query(
    `SELECT business_type, parent_business_id FROM businesses WHERE id = $1`,
    [targetBusinessId]
  );
  const biz = bizRes.rows[0];
  if (biz && biz.business_type === 'DEALER' && biz.parent_business_id === ownerBusinessId) {
    return null;
  }
  return 'Role belongs to a different business tenant and cannot be assigned here.';
}

/**
 * Returns the business_id of the user's current default membership when that business is
 * OUTSIDE the actor's accessible set (i.e. the actor must not clear or replace it),
 * or null when there is no default or the default is within the actor's scope.
 */
export async function findOutOfScopeDefaultBusinessId(
  userId: string,
  actorBusinessIds: Set<string>
): Promise<string | null> {
  const res = await pool.query(
    `SELECT business_id FROM user_business_access WHERE user_id = $1 AND is_default = true LIMIT 1`,
    [userId]
  );
  if (res.rows.length === 0) {
    return null;
  }
  const defaultBusinessId = res.rows[0].business_id as string;
  return actorBusinessIds.has(defaultBusinessId) ? null : defaultBusinessId;
}
