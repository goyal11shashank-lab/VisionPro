import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { auditLogs, users } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { eq, and, desc, sql, ilike } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/audit-logs
 * Query immutable audit trail for active business with filters
 */
router.get('/', authenticateToken, requirePermission('admin:view_audit_logs'), async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.currentBusinessId;
    const { module, action, search, limit = '50', page = '1' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(10, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];

    // If super admin, allow seeing all or filtered by business
    if (!req.user!.isSuperAdmin || businessId) {
      conditions.push(eq(auditLogs.businessId, businessId));
    }

    if (module && typeof module === 'string') {
      conditions.push(eq(auditLogs.module, module));
    }

    if (action && typeof action === 'string') {
      conditions.push(eq(auditLogs.action, action));
    }

    if (search && typeof search === 'string') {
      conditions.push(ilike(auditLogs.entityType, `%${search}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await db
      .select({
        id: auditLogs.id,
        businessId: auditLogs.businessId,
        userId: auditLogs.userId,
        userName: users.fullName,
        username: users.username,
        action: auditLogs.action,
        module: auditLogs.module,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        previousValue: auditLogs.previousValue,
        newValue: auditLogs.newValue,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count
    const [totalCountRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(whereClause);

    const totalCount = Number(totalCountRes?.count || 0);

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch audit logs' });
  }
});

export default router;
