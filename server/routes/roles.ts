import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { roles, permissions, rolePermissions } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { recordAuditLog } from '../services/auditService.js';
import { eq, or, isNull } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  code: z.string().min(2, 'Role code is required').regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters, numbers, and underscores'),
  description: z.string().optional(),
  permissionIds: z.array(z.string()).default([]),
});

/**
 * GET /api/roles
 * Retrieve all roles (system default + business specific)
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.currentBusinessId;

    const roleList = await db
      .select()
      .from(roles)
      .where(
        or(
          isNull(roles.businessId),
          eq(roles.businessId, businessId)
        )
      );

    // Fetch assigned permissions for each role
    const allRolePerms = await db
      .select({
        roleId: rolePermissions.roleId,
        permission: permissions,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id));

    const rolesWithPerms = roleList.map(r => {
      const perms = allRolePerms.filter(rp => rp.roleId === r.id).map(rp => rp.permission);
      return {
        ...r,
        permissions: perms,
        permissionsCount: perms.length,
      };
    });

    res.json(rolesWithPerms);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch roles' });
  }
});

/**
 * GET /api/permissions
 * List all available granular permissions grouped by module
 */
router.get('/permissions', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const allPerms = await db.select().from(permissions);
    
    // Group by module
    const grouped = allPerms.reduce((acc: Record<string, typeof allPerms>, p) => {
      if (!acc[p.module]) acc[p.module] = [];
      acc[p.module].push(p);
      return acc;
    }, {});

    res.json({
      all: allPerms,
      grouped,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch permissions' });
  }
});

/**
 * POST /api/roles
 * Create custom role with permission assignments
 */
router.post('/', authenticateToken, requirePermission('admin:manage_roles'), async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = createRoleSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid role data' });
      return;
    }

    const { name, code, description, permissionIds } = parseResult.data;
    const businessId = req.user!.currentBusinessId;

    // Check duplicate code
    const [existing] = await db.select().from(roles).where(eq(roles.code, code)).limit(1);
    if (existing) {
      res.status(400).json({ error: `Role code '${code}' already exists.` });
      return;
    }

    const [newRole] = await db.insert(roles).values({
      businessId,
      name,
      code,
      description: description || null,
      isSystem: false,
    }).returning();

    // Map permissions
    if (permissionIds.length > 0) {
      for (const permId of permissionIds) {
        await db.insert(rolePermissions).values({
          roleId: newRole.id,
          permissionId: permId,
        });
      }
    }

    await recordAuditLog({
      businessId,
      userId: req.user!.id,
      action: 'CREATE_ROLE',
      module: 'ROLES',
      entityType: 'Role',
      entityId: newRole.id,
      newValue: { name: newRole.name, code: newRole.code, permissionsCount: permissionIds.length },
      req,
    });

    res.status(201).json({ success: true, role: newRole });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create role' });
  }
});

/**
 * PUT /api/roles/:id/permissions
 * Update role's permission matrix
 */
router.put('/:id/permissions', authenticateToken, requirePermission('admin:manage_roles'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds)) {
      res.status(400).json({ error: 'permissionIds array is required' });
      return;
    }

    const [role] = await db.select().from(roles).where(eq(roles.id, req.params.id)).limit(1);
    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    if (role.isSystem && role.code === 'SUPER_ADMIN') {
      res.status(400).json({ error: 'Cannot modify Super Administrator system role permissions.' });
      return;
    }

    // Delete existing permissions for this role
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));

    // Insert new permissions
    for (const pId of permissionIds) {
      await db.insert(rolePermissions).values({
        roleId: role.id,
        permissionId: pId,
      });
    }

    await recordAuditLog({
      businessId: req.user!.currentBusinessId,
      userId: req.user!.id,
      action: 'UPDATE_ROLE_PERMISSIONS',
      module: 'ROLES',
      entityType: 'Role',
      entityId: role.id,
      newValue: { roleName: role.name, permissionsCount: permissionIds.length },
      req,
    });

    res.json({ success: true, message: 'Role permissions updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update role permissions' });
  }
});

export default router;
