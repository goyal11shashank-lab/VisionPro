import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../middleware/permission.js';
import { db, pool } from '../db/index.js';
import {
  categories, bases, coatings, baseCategories, primaryItems, uniqueItems,
  opticalBatches, opticalStocks, stockLedger, businesses
} from '../db/schema.js';
import { eq, and, desc, sql, ilike, or, ne } from 'drizzle-orm';
import { recordAuditLog } from '../services/auditService.js';
import { findOrCreateOpticalBatch, OpticalPowerInput, validateOpticalPower, updateOpticalBatch } from '../services/opticalMasterService.js';
import { rankSearchMatch, formatOpticalBatchName } from '../utils/searchNormalization.js';
import { z } from 'zod';

const router = Router();
router.use(authenticateToken);

// ==========================================
// 1. CATEGORIES CRUD
// ==========================================

const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  code: z.string().min(1, 'Category code is required').toUpperCase(),
  description: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

router.get('/categories', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const list = await db
      .select()
      .from(categories)
      .where(or(eq(categories.businessId, bizId), sql`${categories.businessId} IS NULL`))
      .orderBy(categories.code);

    res.json({ success: true, categories: list });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch categories' });
  }
});

router.get('/categories/:id', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const [cat] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, req.params.id), or(eq(categories.businessId, bizId), sql`${categories.businessId} IS NULL`)))
      .limit(1);

    if (!cat) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    res.json({ success: true, category: cat });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch category' });
  }
});

router.post('/categories', requirePermission('master:create'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category data' });
      return;
    }

    const { name, code, description, status } = parsed.data;

    // Check duplicate code in business
    const existing = await db
      .select()
      .from(categories)
      .where(and(eq(categories.businessId, bizId), eq(categories.code, code)))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: `Category with code "${code}" already exists.` });
      return;
    }

    const [created] = await db
      .insert(categories)
      .values({
        businessId: bizId,
        name,
        code,
        description,
        status,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'CREATE',
      module: 'INVENTORY',
      entityType: 'Category',
      entityId: created.id,
      newValue: created,
      req,
    });

    res.status(201).json({ success: true, category: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create category' });
  }
});

router.patch('/categories/:id', requireAnyPermission(['master:edit', 'master.edit', 'master:manage', 'master:create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Category not found or cannot be modified (global standard)' });
      return;
    }

    let codeToUpdate = current.code;
    if (req.body.code && req.body.code.trim().toUpperCase() !== current.code) {
      codeToUpdate = req.body.code.trim().toUpperCase();
      const [existing] = await db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.code, codeToUpdate),
            or(eq(categories.businessId, bizId), sql`${categories.businessId} IS NULL`),
            ne(categories.id, id)
          )
        )
        .limit(1);
      if (existing) {
        res.status(400).json({ error: `Category with code "${codeToUpdate}" already exists.` });
        return;
      }
    }

    const [updated] = await db
      .update(categories)
      .set({
        code: codeToUpdate,
        name: req.body.name ?? current.name,
        description: req.body.description ?? current.description,
        status: req.body.status ?? current.status,
        updatedAt: new Date(),
        updatedBy: req.user!.id,
      })
      .where(eq(categories.id, id))
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: req.body.status && req.body.status !== current.status ? (req.body.status === 'ACTIVE' ? 'ENABLE' : 'DISABLE') : 'UPDATE',
      module: 'INVENTORY',
      entityType: 'Category',
      entityId: id,
      previousValue: current,
      newValue: updated,
      req,
    });

    res.json({ success: true, category: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update category' });
  }
});

router.delete('/categories/:id', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), or(eq(categories.businessId, bizId), sql`${categories.businessId} IS NULL`)))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    if (!current.businessId) {
      res.status(403).json({ error: 'Protected system standard categories cannot be deleted.' });
      return;
    }

    // Check if any invoices (sales or purchase) or documents reference this category
    const checkRes = await pool.query(
      `SELECT 
        (
          SELECT COUNT(*)::int 
          FROM sales_invoice_lines sil
          JOIN unique_items ui ON sil.unique_item_id = ui.id
          WHERE ui.category_id = $1
        ) AS sales_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_invoice_lines pil
          JOIN unique_items ui ON pil.unique_item_id = ui.id
          WHERE ui.category_id = $1
        ) AS purchase_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_order_lines sol
          JOIN unique_items ui ON sol.unique_item_id = ui.id
          WHERE ui.category_id = $1
        ) AS sales_order_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_return_lines srl
          JOIN unique_items ui ON srl.unique_item_id = ui.id
          WHERE ui.category_id = $1
        ) AS sales_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_return_lines prl
          JOIN unique_items ui ON prl.unique_item_id = ui.id
          WHERE ui.category_id = $1
        ) AS purchase_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM primary_items pi 
          WHERE pi.category_id = $1
        ) AS primary_items_count,
        (
          SELECT COUNT(*)::int 
          FROM optical_batches ob 
          WHERE ob.category_id = $1
        ) AS optical_batches_count
      `,
      [id]
    );

    const {
      sales_invoice_lines_count,
      purchase_invoice_lines_count,
      sales_order_lines_count,
      sales_return_lines_count,
      purchase_return_lines_count,
      primary_items_count,
      optical_batches_count,
    } = checkRes.rows[0];

    if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete category "${current.name}" (${current.code}): Sales or Purchase Invoices have already been created with products in this category.`
      });
      return;
    }

    if (sales_order_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete category "${current.name}" (${current.code}): Active Sales Orders reference products in this category.`
      });
      return;
    }

    if (primary_items_count > 0 || optical_batches_count > 0) {
      res.status(400).json({
        error: `Cannot delete category "${current.name}" (${current.code}): It is currently referenced by ${primary_items_count} primary item(s) and ${optical_batches_count} optical batch(es). Please remove linked items first.`
      });
      return;
    }

    // Delete base compatibility mappings
    await db.delete(baseCategories).where(and(eq(baseCategories.categoryId, id), eq(baseCategories.businessId, bizId)));

    // Delete category
    await db.delete(categories).where(and(eq(categories.id, id), eq(categories.businessId, bizId)));

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'DELETE',
      module: 'INVENTORY',
      entityType: 'Category',
      entityId: id,
      previousValue: current,
      req,
    });

    res.json({
      success: true,
      message: `Category "${current.name}" (${current.code}) was deleted successfully.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete category' });
  }
});

router.post('/categories/bulk-delete', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Please provide an array of category IDs to delete.' });
      return;
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const [current] = await db
          .select()
          .from(categories)
          .where(and(eq(categories.id, id), or(eq(categories.businessId, bizId), sql`${categories.businessId} IS NULL`)))
          .limit(1);

        if (!current) {
          errors.push(`Category ID ${id} not found.`);
          continue;
        }

        if (!current.businessId) {
          errors.push(`Category "${current.name}" (${current.code}) is a protected system standard category and cannot be deleted.`);
          continue;
        }

        const checkRes = await pool.query(
          `SELECT 
            (SELECT COUNT(*)::int FROM sales_invoice_lines sil JOIN unique_items ui ON sil.unique_item_id = ui.id WHERE ui.category_id = $1) AS sales_invoice_lines_count,
            (SELECT COUNT(*)::int FROM purchase_invoice_lines pil JOIN unique_items ui ON pil.unique_item_id = ui.id WHERE ui.category_id = $1) AS purchase_invoice_lines_count,
            (SELECT COUNT(*)::int FROM sales_order_lines sol JOIN unique_items ui ON sol.unique_item_id = ui.id WHERE ui.category_id = $1) AS sales_order_lines_count,
            (SELECT COUNT(*)::int FROM sales_return_lines srl JOIN unique_items ui ON srl.unique_item_id = ui.id WHERE ui.category_id = $1) AS sales_return_lines_count,
            (SELECT COUNT(*)::int FROM purchase_return_lines prl JOIN unique_items ui ON prl.unique_item_id = ui.id WHERE ui.category_id = $1) AS purchase_return_lines_count,
            (SELECT COUNT(*)::int FROM primary_items pi WHERE pi.category_id = $1) AS primary_items_count,
            (SELECT COUNT(*)::int FROM optical_batches ob WHERE ob.category_id = $1) AS optical_batches_count
          `,
          [id]
        );

        const {
          sales_invoice_lines_count,
          purchase_invoice_lines_count,
          sales_order_lines_count,
          sales_return_lines_count,
          purchase_return_lines_count,
          primary_items_count,
          optical_batches_count,
        } = checkRes.rows[0];

        if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has recorded sales or purchase invoices / returns.`);
          continue;
        }

        if (sales_order_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has active sales orders.`);
          continue;
        }

        if (primary_items_count > 0 || optical_batches_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has ${primary_items_count} linked primary item(s) and ${optical_batches_count} optical batch(es).`);
          continue;
        }

        await db.delete(baseCategories).where(and(eq(baseCategories.categoryId, id), eq(baseCategories.businessId, bizId)));
        await db.delete(categories).where(and(eq(categories.id, id), eq(categories.businessId, bizId)));

        await recordAuditLog({
          businessId: bizId,
          userId: req.user!.id,
          action: 'DELETE',
          module: 'INVENTORY',
          entityType: 'Category',
          entityId: id,
          previousValue: current,
          req,
        });

        deletedCount++;
      } catch (itemErr: any) {
        errors.push(`Failed to delete category ${id}: ${itemErr.message}`);
      }
    }

    res.json({
      success: true,
      totalRequested: ids.length,
      deletedCount,
      failedCount: errors.length,
      errors,
      message: deletedCount === ids.length
        ? `Successfully deleted ${deletedCount} category/categories.`
        : `Deleted ${deletedCount} of ${ids.length} category/categories. ${errors.length} item(s) could not be deleted.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform bulk delete of categories' });
  }
});

// ==========================================
// 2. COATINGS CRUD
// ==========================================

const coatingSchema = z.object({
  name: z.string().min(1, 'Coating name is required'),
  code: z.string().min(1, 'Coating code is required').toUpperCase(),
  description: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

router.get('/coatings', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const list = await db
      .select()
      .from(coatings)
      .where(or(eq(coatings.businessId, bizId), sql`${coatings.businessId} IS NULL`))
      .orderBy(coatings.code);

    res.json({ success: true, coatings: list });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch coatings' });
  }
});

router.post('/coatings', requirePermission('master:create'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const parsed = coatingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid coating data' });
      return;
    }

    const { name, code, description, status } = parsed.data;

    const existing = await db
      .select()
      .from(coatings)
      .where(and(eq(coatings.businessId, bizId), eq(coatings.code, code)))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: `Coating with code "${code}" already exists.` });
      return;
    }

    const [created] = await db
      .insert(coatings)
      .values({
        businessId: bizId,
        name,
        code,
        description,
        status,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'CREATE',
      module: 'INVENTORY',
      entityType: 'Coating',
      entityId: created.id,
      newValue: created,
      req,
    });

    res.status(201).json({ success: true, coating: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create coating' });
  }
});

router.patch('/coatings/:id', requireAnyPermission(['master:edit', 'master.edit', 'master:manage', 'master:create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(coatings).where(and(eq(coatings.id, id), eq(coatings.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Coating not found or cannot be modified' });
      return;
    }

    let codeToUpdate = current.code;
    if (req.body.code && req.body.code.trim().toUpperCase() !== current.code) {
      codeToUpdate = req.body.code.trim().toUpperCase();
      const [existing] = await db
        .select()
        .from(coatings)
        .where(
          and(
            eq(coatings.code, codeToUpdate),
            or(eq(coatings.businessId, bizId), sql`${coatings.businessId} IS NULL`),
            ne(coatings.id, id)
          )
        )
        .limit(1);
      if (existing) {
        res.status(400).json({ error: `Coating with code "${codeToUpdate}" already exists.` });
        return;
      }
    }

    const [updated] = await db
      .update(coatings)
      .set({
        code: codeToUpdate,
        name: req.body.name ?? current.name,
        description: req.body.description ?? current.description,
        status: req.body.status ?? current.status,
        updatedAt: new Date(),
        updatedBy: req.user!.id,
      })
      .where(eq(coatings.id, id))
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: req.body.status && req.body.status !== current.status ? (req.body.status === 'ACTIVE' ? 'ENABLE' : 'DISABLE') : 'UPDATE',
      module: 'INVENTORY',
      entityType: 'Coating',
      entityId: id,
      previousValue: current,
      newValue: updated,
      req,
    });

    res.json({ success: true, coating: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update coating' });
  }
});

router.delete('/coatings/:id', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db
      .select()
      .from(coatings)
      .where(and(eq(coatings.id, id), or(eq(coatings.businessId, bizId), sql`${coatings.businessId} IS NULL`)))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'Coating not found' });
      return;
    }

    if (!current.businessId) {
      res.status(403).json({ error: 'Protected system standard coatings cannot be deleted.' });
      return;
    }

    // Check if any invoices (sales or purchase) or documents reference products under this coating
    const checkRes = await pool.query(
      `SELECT 
        (
          SELECT COUNT(*)::int 
          FROM sales_invoice_lines sil
          JOIN unique_items ui ON sil.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.coating_id = $1
        ) AS sales_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_invoice_lines pil
          JOIN unique_items ui ON pil.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.coating_id = $1
        ) AS purchase_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_order_lines sol
          JOIN unique_items ui ON sol.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.coating_id = $1
        ) AS sales_order_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_return_lines srl
          JOIN unique_items ui ON srl.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.coating_id = $1
        ) AS sales_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_return_lines prl
          JOIN unique_items ui ON prl.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.coating_id = $1
        ) AS purchase_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM primary_items pi 
          WHERE pi.coating_id = $1
        ) AS primary_items_count
      `,
      [id]
    );

    const {
      sales_invoice_lines_count,
      purchase_invoice_lines_count,
      sales_order_lines_count,
      sales_return_lines_count,
      purchase_return_lines_count,
      primary_items_count,
    } = checkRes.rows[0];

    if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete coating "${current.name}" (${current.code}): Sales or Purchase Invoices have already been created with products using this coating.`
      });
      return;
    }

    if (sales_order_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete coating "${current.name}" (${current.code}): Active Sales Orders reference products with this coating.`
      });
      return;
    }

    if (primary_items_count > 0) {
      res.status(400).json({
        error: `Cannot delete coating "${current.name}" (${current.code}): It is currently linked to ${primary_items_count} primary item(s). Remove or reassign the primary items before deleting this coating.`
      });
      return;
    }

    // Set coatingId to null in bases referencing this coating
    await db
      .update(bases)
      .set({ coatingId: null, updatedAt: new Date() })
      .where(and(eq(bases.coatingId, id), eq(bases.businessId, bizId)));

    // Delete coating record
    await db.delete(coatings).where(and(eq(coatings.id, id), eq(coatings.businessId, bizId)));

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'DELETE',
      module: 'INVENTORY',
      entityType: 'Coating',
      entityId: id,
      previousValue: current,
      req,
    });

    res.json({
      success: true,
      message: `Coating "${current.name}" (${current.code}) was deleted successfully from database.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete coating' });
  }
});

router.post('/coatings/bulk-delete', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Please provide an array of coating IDs to delete.' });
      return;
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const [current] = await db
          .select()
          .from(coatings)
          .where(and(eq(coatings.id, id), or(eq(coatings.businessId, bizId), sql`${coatings.businessId} IS NULL`)))
          .limit(1);

        if (!current) {
          errors.push(`Coating ID ${id} not found.`);
          continue;
        }

        if (!current.businessId) {
          errors.push(`Coating "${current.name}" (${current.code}) is a protected system standard coating and cannot be deleted.`);
          continue;
        }

        const checkRes = await pool.query(
          `SELECT 
            (SELECT COUNT(*)::int FROM sales_invoice_lines sil JOIN unique_items ui ON sil.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.coating_id = $1) AS sales_invoice_lines_count,
            (SELECT COUNT(*)::int FROM purchase_invoice_lines pil JOIN unique_items ui ON pil.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.coating_id = $1) AS purchase_invoice_lines_count,
            (SELECT COUNT(*)::int FROM sales_order_lines sol JOIN unique_items ui ON sol.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.coating_id = $1) AS sales_order_lines_count,
            (SELECT COUNT(*)::int FROM sales_return_lines srl JOIN unique_items ui ON srl.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.coating_id = $1) AS sales_return_lines_count,
            (SELECT COUNT(*)::int FROM purchase_return_lines prl JOIN unique_items ui ON prl.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.coating_id = $1) AS purchase_return_lines_count,
            (SELECT COUNT(*)::int FROM primary_items pi WHERE pi.coating_id = $1) AS primary_items_count
          `,
          [id]
        );

        const {
          sales_invoice_lines_count,
          purchase_invoice_lines_count,
          sales_order_lines_count,
          sales_return_lines_count,
          purchase_return_lines_count,
          primary_items_count,
        } = checkRes.rows[0];

        if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has recorded sales or purchase invoices / returns.`);
          continue;
        }

        if (sales_order_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has active sales orders.`);
          continue;
        }

        if (primary_items_count > 0) {
          errors.push(`"${current.name}" (${current.code}) is linked to ${primary_items_count} primary item(s).`);
          continue;
        }

        await db
          .update(bases)
          .set({ coatingId: null, updatedAt: new Date() })
          .where(and(eq(bases.coatingId, id), eq(bases.businessId, bizId)));

        await db.delete(coatings).where(and(eq(coatings.id, id), eq(coatings.businessId, bizId)));

        await recordAuditLog({
          businessId: bizId,
          userId: req.user!.id,
          action: 'DELETE',
          module: 'INVENTORY',
          entityType: 'Coating',
          entityId: id,
          previousValue: current,
          req,
        });

        deletedCount++;
      } catch (itemErr: any) {
        errors.push(`Failed to delete coating ${id}: ${itemErr.message}`);
      }
    }

    res.json({
      success: true,
      totalRequested: ids.length,
      deletedCount,
      failedCount: errors.length,
      errors,
      message: deletedCount === ids.length
        ? `Successfully deleted ${deletedCount} coating(s).`
        : `Deleted ${deletedCount} of ${ids.length} coating(s). ${errors.length} item(s) could not be deleted.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform bulk delete of coatings' });
  }
});

// ==========================================
// 3. BASES & BASE-CATEGORIES CRUD
// ==========================================

const baseSchema = z.object({
  name: z.string().min(1, 'Base name is required'),
  code: z.string().min(1, 'Base code is required').toUpperCase(),
  family: z.string().optional().nullable(),
  coatingId: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  compatibleCategoryIds: z.array(z.string().uuid()).optional(),
});

router.get('/bases', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const baseList = await db
      .select({
        id: bases.id,
        name: bases.name,
        code: bases.code,
        family: bases.family,
        coatingId: bases.coatingId,
        description: bases.description,
        status: bases.status,
        createdAt: bases.createdAt,
        updatedAt: bases.updatedAt,
      })
      .from(bases)
      .where(or(eq(bases.businessId, bizId), sql`${bases.businessId} IS NULL`))
      .orderBy(bases.family, bases.code);

    // Fetch compatible category IDs
    const allCompat = await db
      .select({
        baseId: baseCategories.baseId,
        categoryId: baseCategories.categoryId,
        categoryCode: categories.code,
        categoryName: categories.name,
      })
      .from(baseCategories)
      .innerJoin(categories, eq(baseCategories.categoryId, categories.id))
      .where(or(eq(baseCategories.businessId, bizId), sql`${baseCategories.businessId} IS NULL`));

    const compatMap = new Map<string, Array<{ id: string; code: string; name: string }>>();
    for (const c of allCompat) {
      if (!compatMap.has(c.baseId)) compatMap.set(c.baseId, []);
      compatMap.get(c.baseId)!.push({ id: c.categoryId, code: c.categoryCode, name: c.categoryName });
    }

    const result = baseList.map(b => ({
      ...b,
      compatibleCategories: compatMap.get(b.id) || [],
    }));

    res.json({ success: true, bases: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch bases' });
  }
});

router.post('/bases', requirePermission('master:create'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const parsed = baseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid base data' });
      return;
    }

    const { name, code, family, coatingId, description, status, compatibleCategoryIds } = parsed.data;

    const existing = await db
      .select()
      .from(bases)
      .where(and(eq(bases.businessId, bizId), eq(bases.code, code)))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: `Base with code "${code}" already exists.` });
      return;
    }

    const [created] = await db
      .insert(bases)
      .values({
        businessId: bizId,
        name,
        code,
        family,
        coatingId: coatingId || null,
        description,
        status,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .returning();

    // Map compatible categories
    if (compatibleCategoryIds && compatibleCategoryIds.length > 0) {
      for (const catId of compatibleCategoryIds) {
        await db.insert(baseCategories).values({
          businessId: bizId,
          baseId: created.id,
          categoryId: catId,
        });
      }
    }

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'CREATE',
      module: 'INVENTORY',
      entityType: 'Base',
      entityId: created.id,
      newValue: { ...created, compatibleCategoryIds },
      req,
    });

    res.status(201).json({ success: true, base: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create base' });
  }
});

router.patch('/bases/:id', requireAnyPermission(['master:edit', 'master.edit', 'master:manage', 'master:create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(bases).where(and(eq(bases.id, id), eq(bases.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Base not found or cannot be modified' });
      return;
    }

    let codeToUpdate = current.code;
    if (req.body.code && req.body.code.trim().toUpperCase() !== current.code) {
      codeToUpdate = req.body.code.trim().toUpperCase();
      const [existing] = await db
        .select()
        .from(bases)
        .where(
          and(
            eq(bases.code, codeToUpdate),
            or(eq(bases.businessId, bizId), sql`${bases.businessId} IS NULL`),
            ne(bases.id, id)
          )
        )
        .limit(1);
      if (existing) {
        res.status(400).json({ error: `Base with code "${codeToUpdate}" already exists.` });
        return;
      }
    }

    const [updated] = await db
      .update(bases)
      .set({
        code: codeToUpdate,
        name: req.body.name ?? current.name,
        family: req.body.family ?? current.family,
        coatingId: req.body.coatingId !== undefined ? req.body.coatingId : current.coatingId,
        description: req.body.description ?? current.description,
        status: req.body.status ?? current.status,
        updatedAt: new Date(),
        updatedBy: req.user!.id,
      })
      .where(eq(bases.id, id))
      .returning();

    // Update compatible categories if provided
    if (Array.isArray(req.body.compatibleCategoryIds)) {
      await db.delete(baseCategories).where(and(eq(baseCategories.baseId, id), eq(baseCategories.businessId, bizId)));
      for (const catId of req.body.compatibleCategoryIds) {
        await db.insert(baseCategories).values({
          businessId: bizId,
          baseId: id,
          categoryId: catId,
        });
      }
    }

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: req.body.status && req.body.status !== current.status ? (req.body.status === 'ACTIVE' ? 'ENABLE' : 'DISABLE') : 'UPDATE',
      module: 'INVENTORY',
      entityType: 'Base',
      entityId: id,
      previousValue: current,
      newValue: updated,
      req,
    });

    res.json({ success: true, base: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update base' });
  }
});

router.delete('/bases/:id', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db
      .select()
      .from(bases)
      .where(and(eq(bases.id, id), or(eq(bases.businessId, bizId), sql`${bases.businessId} IS NULL`)))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'Base not found' });
      return;
    }

    if (!current.businessId) {
      res.status(403).json({ error: 'Protected system standard bases cannot be deleted.' });
      return;
    }

    // Check if any invoices (sales or purchase) or documents reference products under this base
    const checkRes = await pool.query(
      `SELECT 
        (
          SELECT COUNT(*)::int 
          FROM sales_invoice_lines sil
          JOIN unique_items ui ON sil.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.base_id = $1
        ) AS sales_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_invoice_lines pil
          JOIN unique_items ui ON pil.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.base_id = $1
        ) AS purchase_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_order_lines sol
          JOIN unique_items ui ON sol.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.base_id = $1
        ) AS sales_order_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_return_lines srl
          JOIN unique_items ui ON srl.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.base_id = $1
        ) AS sales_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_return_lines prl
          JOIN unique_items ui ON prl.unique_item_id = ui.id
          JOIN primary_items pi ON ui.primary_item_id = pi.id
          WHERE pi.base_id = $1
        ) AS purchase_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM primary_items pi 
          WHERE pi.base_id = $1
        ) AS primary_items_count
      `,
      [id]
    );

    const {
      sales_invoice_lines_count,
      purchase_invoice_lines_count,
      sales_order_lines_count,
      sales_return_lines_count,
      purchase_return_lines_count,
      primary_items_count,
    } = checkRes.rows[0];

    if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete base "${current.name}" (${current.code}): Sales or Purchase Invoices have already been created with products under this category/base.`
      });
      return;
    }

    if (sales_order_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete base "${current.name}" (${current.code}): Active Sales Orders reference products with this base.`
      });
      return;
    }

    if (primary_items_count > 0) {
      res.status(400).json({
        error: `Cannot delete base "${current.name}" (${current.code}): It is currently linked to ${primary_items_count} primary item(s). Remove the primary items before deleting this base.`
      });
      return;
    }

    // Delete base-category compatibility mappings
    await db.delete(baseCategories).where(and(eq(baseCategories.baseId, id), eq(baseCategories.businessId, bizId)));

    // Delete base record
    await db.delete(bases).where(and(eq(bases.id, id), eq(bases.businessId, bizId)));

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'DELETE',
      module: 'INVENTORY',
      entityType: 'Base',
      entityId: id,
      previousValue: current,
      req,
    });

    res.json({
      success: true,
      message: `Base "${current.name}" (${current.code}) and its category compatibility mappings were deleted successfully from database.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete base' });
  }
});

router.post('/bases/bulk-delete', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Please provide an array of base IDs to delete.' });
      return;
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const [current] = await db
          .select()
          .from(bases)
          .where(and(eq(bases.id, id), or(eq(bases.businessId, bizId), sql`${bases.businessId} IS NULL`)))
          .limit(1);

        if (!current) {
          errors.push(`Base ID ${id} not found.`);
          continue;
        }

        if (!current.businessId) {
          errors.push(`Base "${current.name}" (${current.code}) is a protected system standard base and cannot be deleted.`);
          continue;
        }

        const checkRes = await pool.query(
          `SELECT 
            (SELECT COUNT(*)::int FROM sales_invoice_lines sil JOIN unique_items ui ON sil.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.base_id = $1) AS sales_invoice_lines_count,
            (SELECT COUNT(*)::int FROM purchase_invoice_lines pil JOIN unique_items ui ON pil.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.base_id = $1) AS purchase_invoice_lines_count,
            (SELECT COUNT(*)::int FROM sales_order_lines sol JOIN unique_items ui ON sol.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.base_id = $1) AS sales_order_lines_count,
            (SELECT COUNT(*)::int FROM sales_return_lines srl JOIN unique_items ui ON srl.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.base_id = $1) AS sales_return_lines_count,
            (SELECT COUNT(*)::int FROM purchase_return_lines prl JOIN unique_items ui ON prl.unique_item_id = ui.id JOIN primary_items pi ON ui.primary_item_id = pi.id WHERE pi.base_id = $1) AS purchase_return_lines_count,
            (SELECT COUNT(*)::int FROM primary_items pi WHERE pi.base_id = $1) AS primary_items_count
          `,
          [id]
        );

        const {
          sales_invoice_lines_count,
          purchase_invoice_lines_count,
          sales_order_lines_count,
          sales_return_lines_count,
          purchase_return_lines_count,
          primary_items_count,
        } = checkRes.rows[0];

        if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has recorded sales or purchase invoices / returns.`);
          continue;
        }

        if (sales_order_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has active sales orders.`);
          continue;
        }

        if (primary_items_count > 0) {
          errors.push(`"${current.name}" (${current.code}) is linked to ${primary_items_count} primary item(s).`);
          continue;
        }

        await db.delete(baseCategories).where(and(eq(baseCategories.baseId, id), eq(baseCategories.businessId, bizId)));
        await db.delete(bases).where(and(eq(bases.id, id), eq(bases.businessId, bizId)));

        await recordAuditLog({
          businessId: bizId,
          userId: req.user!.id,
          action: 'DELETE',
          module: 'INVENTORY',
          entityType: 'Base',
          entityId: id,
          previousValue: current,
          req,
        });

        deletedCount++;
      } catch (itemErr: any) {
        errors.push(`Failed to delete base ${id}: ${itemErr.message}`);
      }
    }

    res.json({
      success: true,
      totalRequested: ids.length,
      deletedCount,
      failedCount: errors.length,
      errors,
      message: deletedCount === ids.length
        ? `Successfully deleted ${deletedCount} base(s).`
        : `Deleted ${deletedCount} of ${ids.length} base(s). ${errors.length} item(s) could not be deleted.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform bulk delete of bases' });
  }
});

// ==========================================
// 4. PRIMARY ITEMS CRUD
// ==========================================

const primaryItemSchema = z.object({
  categoryId: z.string().uuid('Valid category is required'),
  baseId: z.string().uuid('Valid base is required'),
  coatingId: z.string().uuid().optional().nullable(),
  name: z.string().min(1, 'Primary item name is required'),
  code: z.string().min(1, 'Primary item code is required').toUpperCase(),
  description: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

router.get('/primary-items', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { categoryId, baseId, search } = req.query;

    let query = db
      .select({
        id: primaryItems.id,
        name: primaryItems.name,
        code: primaryItems.code,
        description: primaryItems.description,
        status: primaryItems.status,
        createdAt: primaryItems.createdAt,
        updatedAt: primaryItems.updatedAt,
        categoryId: primaryItems.categoryId,
        categoryName: categories.name,
        categoryCode: categories.code,
        baseId: primaryItems.baseId,
        baseName: bases.name,
        baseCode: bases.code,
        baseFamily: bases.family,
        coatingId: primaryItems.coatingId,
        coatingName: coatings.name,
        coatingCode: coatings.code,
      })
      .from(primaryItems)
      .innerJoin(categories, eq(primaryItems.categoryId, categories.id))
      .innerJoin(bases, eq(primaryItems.baseId, bases.id))
      .leftJoin(coatings, eq(primaryItems.coatingId, coatings.id))
      .where(eq(primaryItems.businessId, bizId));

    const rows = await query.orderBy(desc(primaryItems.createdAt));

    let filtered = rows;
    if (categoryId) filtered = filtered.filter(r => r.categoryId === categoryId);
    if (baseId) filtered = filtered.filter(r => r.baseId === baseId);
    if (search && typeof search === 'string') {
      const s = search.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
    }

    res.json({ success: true, primaryItems: filtered });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch primary items' });
  }
});

router.post('/primary-items', requirePermission('master:create'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const parsed = primaryItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid primary item data' });
      return;
    }

    const { categoryId, baseId, coatingId, name, code, description, status } = parsed.data;

    // Check code uniqueness in business
    const existing = await db
      .select()
      .from(primaryItems)
      .where(and(eq(primaryItems.businessId, bizId), eq(primaryItems.code, code)))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: `Primary Item with code "${code}" already exists.` });
      return;
    }

    const [created] = await db
      .insert(primaryItems)
      .values({
        businessId: bizId,
        categoryId,
        baseId,
        coatingId: coatingId || null,
        name,
        code,
        description,
        status,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'CREATE',
      module: 'INVENTORY',
      entityType: 'PrimaryItem',
      entityId: created.id,
      newValue: created,
      req,
    });

    res.status(201).json({ success: true, primaryItem: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create primary item' });
  }
});

router.patch('/primary-items/:id', requireAnyPermission(['master:edit', 'master.edit', 'master:manage', 'master:create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(primaryItems).where(and(eq(primaryItems.id, id), eq(primaryItems.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Primary Item not found' });
      return;
    }

    let codeToUpdate = current.code;
    if (req.body.code && req.body.code.trim().toUpperCase() !== current.code) {
      codeToUpdate = req.body.code.trim().toUpperCase();
      const [existing] = await db
        .select()
        .from(primaryItems)
        .where(
          and(
            eq(primaryItems.code, codeToUpdate),
            eq(primaryItems.businessId, bizId),
            ne(primaryItems.id, id)
          )
        )
        .limit(1);
      if (existing) {
        res.status(400).json({ error: `Primary item with code "${codeToUpdate}" already exists.` });
        return;
      }
    }

    const [updated] = await db
      .update(primaryItems)
      .set({
        code: codeToUpdate,
        name: req.body.name ?? current.name,
        description: req.body.description ?? current.description,
        status: req.body.status ?? current.status,
        categoryId: req.body.categoryId ?? current.categoryId,
        baseId: req.body.baseId ?? current.baseId,
        coatingId: req.body.coatingId !== undefined ? req.body.coatingId : current.coatingId,
        updatedAt: new Date(),
        updatedBy: req.user!.id,
      })
      .where(eq(primaryItems.id, id))
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: req.body.status && req.body.status !== current.status ? (req.body.status === 'ACTIVE' ? 'ENABLE' : 'DISABLE') : 'UPDATE',
      module: 'INVENTORY',
      entityType: 'PrimaryItem',
      entityId: id,
      previousValue: current,
      newValue: updated,
      req,
    });

    res.json({ success: true, primaryItem: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update primary item' });
  }
});

router.delete('/primary-items/:id', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db
      .select()
      .from(primaryItems)
      .where(and(eq(primaryItems.id, id), eq(primaryItems.businessId, bizId)))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'Primary Item not found' });
      return;
    }

    // Check if any invoices (sales or purchase) or documents reference unique items under this primary item
    const checkRes = await pool.query(
      `SELECT 
        (
          SELECT COUNT(*)::int 
          FROM sales_invoice_lines sil
          JOIN unique_items ui ON sil.unique_item_id = ui.id
          WHERE ui.primary_item_id = $1
        ) AS sales_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_invoice_lines pil
          JOIN unique_items ui ON pil.unique_item_id = ui.id
          WHERE ui.primary_item_id = $1
        ) AS purchase_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_order_lines sol
          JOIN unique_items ui ON sol.unique_item_id = ui.id
          WHERE ui.primary_item_id = $1
        ) AS sales_order_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_return_lines srl
          JOIN unique_items ui ON srl.unique_item_id = ui.id
          WHERE ui.primary_item_id = $1
        ) AS sales_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_return_lines prl
          JOIN unique_items ui ON prl.unique_item_id = ui.id
          WHERE ui.primary_item_id = $1
        ) AS purchase_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM unique_items ui 
          WHERE ui.primary_item_id = $1
        ) AS unique_items_count
      `,
      [id]
    );

    const {
      sales_invoice_lines_count,
      purchase_invoice_lines_count,
      sales_order_lines_count,
      sales_return_lines_count,
      purchase_return_lines_count,
      unique_items_count,
    } = checkRes.rows[0];

    if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete Primary Item "${current.name}" (${current.code}): Sales or Purchase Invoices / Returns have already been recorded with this item. Invoiced records are immutable to preserve financial audit trails.`
      });
      return;
    }

    if (sales_order_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete Primary Item "${current.name}" (${current.code}): Active Sales Orders reference this item. Cancel or complete the orders first.`
      });
      return;
    }

    // Clean up dependent child master data in sequence
    await pool.query(
      `DELETE FROM stock_ledger 
       WHERE batch_id IN (
         SELECT ob.id FROM optical_batches ob
         JOIN unique_items ui ON ob.unique_item_id = ui.id
         WHERE ui.primary_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM stock_reservations 
       WHERE batch_id IN (
         SELECT ob.id FROM optical_batches ob
         JOIN unique_items ui ON ob.unique_item_id = ui.id
         WHERE ui.primary_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM optical_stocks 
       WHERE batch_id IN (
         SELECT ob.id FROM optical_batches ob
         JOIN unique_items ui ON ob.unique_item_id = ui.id
         WHERE ui.primary_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM optical_batches 
       WHERE unique_item_id IN (
         SELECT id FROM unique_items WHERE primary_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM party_item_prices 
       WHERE unique_item_id IN (
         SELECT id FROM unique_items WHERE primary_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM unique_items WHERE primary_item_id = $1`,
      [id]
    );

    await db.delete(primaryItems).where(and(eq(primaryItems.id, id), eq(primaryItems.businessId, bizId)));

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'DELETE',
      module: 'INVENTORY',
      entityType: 'PrimaryItem',
      entityId: id,
      previousValue: current,
      req,
    });

    res.json({
      success: true,
      message: `Primary Item "${current.name}" (${current.code}) ${unique_items_count > 0 ? `and ${unique_items_count} child SKU item(s)` : ''} deleted successfully from database.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete primary item' });
  }
});

router.post('/primary-items/bulk-delete', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Please provide an array of Primary Item IDs to delete.' });
      return;
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const [current] = await db
          .select()
          .from(primaryItems)
          .where(and(eq(primaryItems.id, id), eq(primaryItems.businessId, bizId)))
          .limit(1);

        if (!current) {
          errors.push(`Primary Item ID ${id} not found.`);
          continue;
        }

        const checkRes = await pool.query(
          `SELECT 
            (SELECT COUNT(*)::int FROM sales_invoice_lines sil JOIN unique_items ui ON sil.unique_item_id = ui.id WHERE ui.primary_item_id = $1) AS sales_invoice_lines_count,
            (SELECT COUNT(*)::int FROM purchase_invoice_lines pil JOIN unique_items ui ON pil.unique_item_id = ui.id WHERE ui.primary_item_id = $1) AS purchase_invoice_lines_count,
            (SELECT COUNT(*)::int FROM sales_order_lines sol JOIN unique_items ui ON sol.unique_item_id = ui.id WHERE ui.primary_item_id = $1) AS sales_order_lines_count,
            (SELECT COUNT(*)::int FROM sales_return_lines srl JOIN unique_items ui ON srl.unique_item_id = ui.id WHERE ui.primary_item_id = $1) AS sales_return_lines_count,
            (SELECT COUNT(*)::int FROM purchase_return_lines prl JOIN unique_items ui ON prl.unique_item_id = ui.id WHERE ui.primary_item_id = $1) AS purchase_return_lines_count
          `,
          [id]
        );

        const {
          sales_invoice_lines_count,
          purchase_invoice_lines_count,
          sales_order_lines_count,
          sales_return_lines_count,
          purchase_return_lines_count,
        } = checkRes.rows[0];

        if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has recorded sales/purchase invoices or returns.`);
          continue;
        }

        if (sales_order_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has active sales orders.`);
          continue;
        }

        // Clean up child tables
        await pool.query(
          `DELETE FROM stock_ledger 
           WHERE batch_id IN (
             SELECT ob.id FROM optical_batches ob
             JOIN unique_items ui ON ob.unique_item_id = ui.id
             WHERE ui.primary_item_id = $1
           )`,
          [id]
        );

        await pool.query(
          `DELETE FROM stock_reservations 
           WHERE batch_id IN (
             SELECT ob.id FROM optical_batches ob
             JOIN unique_items ui ON ob.unique_item_id = ui.id
             WHERE ui.primary_item_id = $1
           )`,
          [id]
        );

        await pool.query(
          `DELETE FROM optical_stocks 
           WHERE batch_id IN (
             SELECT ob.id FROM optical_batches ob
             JOIN unique_items ui ON ob.unique_item_id = ui.id
             WHERE ui.primary_item_id = $1
           )`,
          [id]
        );

        await pool.query(
          `DELETE FROM optical_batches 
           WHERE unique_item_id IN (
             SELECT id FROM unique_items WHERE primary_item_id = $1
           )`,
          [id]
        );

        await pool.query(
          `DELETE FROM party_item_prices 
           WHERE unique_item_id IN (
             SELECT id FROM unique_items WHERE primary_item_id = $1
           )`,
          [id]
        );

        await pool.query(`DELETE FROM unique_items WHERE primary_item_id = $1`, [id]);
        await db.delete(primaryItems).where(and(eq(primaryItems.id, id), eq(primaryItems.businessId, bizId)));

        await recordAuditLog({
          businessId: bizId,
          userId: req.user!.id,
          action: 'DELETE',
          module: 'INVENTORY',
          entityType: 'PrimaryItem',
          entityId: id,
          previousValue: current,
          req,
        });

        deletedCount++;
      } catch (itemErr: any) {
        errors.push(`Failed to delete primary item ${id}: ${itemErr.message}`);
      }
    }

    res.json({
      success: true,
      totalRequested: ids.length,
      deletedCount,
      failedCount: errors.length,
      errors,
      message: deletedCount === ids.length
        ? `Successfully deleted ${deletedCount} primary item(s).`
        : `Deleted ${deletedCount} of ${ids.length} primary item(s). ${errors.length} item(s) could not be deleted.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform bulk delete of primary items' });
  }
});

// ==========================================
// 5. UNIQUE ITEMS CRUD
// ==========================================

const uniqueItemSchema = z.object({
  primaryItemId: z.string().uuid('Invalid Primary Item ID').optional().nullable(),
  name: z.string().trim().min(1, 'Stock item name is required'),
  code: z.string().trim().min(1, 'Stock item code is required').toUpperCase(),
  description: z.string().optional().nullable(),
  maintainBatches: z.boolean().default(false),
  opticalCategory: z.enum(['SV', 'KT', 'PROG', 'OTHER']).default('SV'),
  unit: z.enum(['PRS', 'PCS']).default('PRS'),
  purchaseRate: z.union([z.number(), z.string()]).default(0),
  lastPurchasePrice: z.union([z.number(), z.string()]).default(0),
  mrp: z.union([z.number(), z.string()]).default(0),
  gstRate: z.union([z.number(), z.string()]).default(5),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

router.get(['/unique-items', '/stock-items', '/'], requireAnyPermission(['master:view', 'master.view', 'sales:view', 'sales:create', 'purchase:view', 'purchase:create', 'inventory:view']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { primaryItemId, search } = req.query;

    const rows = await db
      .select({
        id: uniqueItems.id,
        name: uniqueItems.name,
        code: uniqueItems.code,
        description: uniqueItems.description,
        maintainBatches: uniqueItems.maintainBatches,
        opticalCategory: uniqueItems.opticalCategory,
        unit: uniqueItems.unit,
        batchesCount: sql<number>`(SELECT COUNT(*)::int FROM "optical_batches" WHERE "optical_batches"."unique_item_id" = ${uniqueItems.id})`,
        stock: sql<number>`COALESCE((
          SELECT SUM(os.physical_stock)::numeric
          FROM "optical_batches" ob
          JOIN "optical_stocks" os ON ob.id = os.batch_id
          WHERE ob.unique_item_id = ${uniqueItems.id}
        ), 0)`,
        reserved: sql<number>`COALESCE((
          SELECT SUM(os.reserved_stock)::numeric
          FROM "optical_batches" ob
          JOIN "optical_stocks" os ON ob.id = os.batch_id
          WHERE ob.unique_item_id = ${uniqueItems.id}
        ), 0)`,
        available: sql<number>`COALESCE((
          SELECT SUM(os.available_stock)::numeric
          FROM "optical_batches" ob
          JOIN "optical_stocks" os ON ob.id = os.batch_id
          WHERE ob.unique_item_id = ${uniqueItems.id}
        ), 0)`,
        purchaseRate: uniqueItems.purchaseRate,
        lastPurchasePrice: uniqueItems.lastPurchasePrice,
        mrp: uniqueItems.mrp,
        gstRate: uniqueItems.gstRate,
        status: uniqueItems.status,
        createdAt: uniqueItems.createdAt,
        updatedAt: uniqueItems.updatedAt,
        primaryItemId: uniqueItems.primaryItemId,
        primaryItemName: primaryItems.name,
        primaryItemCode: primaryItems.code,
        categoryId: primaryItems.categoryId,
        categoryName: categories.name,
        categoryCode: sql<string>`COALESCE(${uniqueItems.opticalCategory}, ${categories.code}, 'SV')`,
        baseName: bases.name,
        baseCode: bases.code,
      })
      .from(uniqueItems)
      .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .leftJoin(categories, eq(primaryItems.categoryId, categories.id))
      .leftJoin(bases, eq(primaryItems.baseId, bases.id))
      .where(eq(uniqueItems.businessId, bizId))
      .orderBy(desc(uniqueItems.createdAt));

    let filtered = rows;
    if (primaryItemId) filtered = filtered.filter(r => r.primaryItemId === primaryItemId);
    if (search && typeof search === 'string') {
      filtered = rankSearchMatch(filtered, search, r => ({
        id: r.id,
        name: r.name,
        code: r.code,
        categoryCode: r.opticalCategory || r.categoryCode,
        rawText: `${r.primaryItemName || ''} ${r.primaryItemCode || ''} ${r.description || ''}`,
      }));
    }

    res.json({ success: true, uniqueItems: filtered, stockItems: filtered });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch stock items' });
  }
});

router.post(['/unique-items', '/stock-items'], requireAnyPermission(['master:create', 'master.create', 'purchase:create', 'sales:create', 'inventory:create', 'inventory.create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const rawCat = req.body.opticalCategory || req.body.optical_category || req.body.category || req.body.itemCategory || req.body.item_category;

    let itemCode = (req.body.code || '').trim().toUpperCase();
    if (!itemCode && (req.body.name || '').trim()) {
      const countRes = await pool.query(
        `SELECT code FROM unique_items WHERE business_id = $1 AND code LIKE 'ITM-%' ORDER BY created_at DESC LIMIT 50`,
        [bizId]
      );
      let maxNum = 0;
      for (const row of countRes.rows) {
        const match = (row.code || '').match(/^ITM-(\d+)$/i);
        if (match) {
          const n = parseInt(match[1], 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      }
      itemCode = `ITM-${String(maxNum + 1).padStart(5, '0')}`;
    }

    const bodyToParse = {
      ...req.body,
      code: itemCode,
      maintainBatches: req.body.maintainBatches !== undefined ? req.body.maintainBatches : req.body.maintain_batches,
      opticalCategory: rawCat && ['SV', 'KT', 'PROG', 'OTHER'].includes(String(rawCat).toUpperCase())
        ? String(rawCat).toUpperCase()
        : 'SV',
    };
    const parsed = uniqueItemSchema.safeParse(bodyToParse);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid stock item data' });
      return;
    }

    const { primaryItemId, name, code, description, maintainBatches, opticalCategory, unit, purchaseRate, lastPurchasePrice, mrp, gstRate, status } = parsed.data;

    const existing = await db
      .select()
      .from(uniqueItems)
      .where(and(eq(uniqueItems.businessId, bizId), eq(uniqueItems.code, code)))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: `Stock Item with code "${code}" already exists.` });
      return;
    }

    const [created] = await db
      .insert(uniqueItems)
      .values({
        businessId: bizId,
        primaryItemId: primaryItemId ? primaryItemId : null,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description || null,
        maintainBatches: Boolean(maintainBatches),
        opticalCategory,
        unit: unit || 'PRS',
        purchaseRate: String(purchaseRate),
        lastPurchasePrice: String(lastPurchasePrice),
        mrp: String(mrp),
        gstRate: String(gstRate !== undefined ? gstRate : '5.00'),
        status,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'CREATE',
      module: 'INVENTORY',
      entityType: 'UniqueItem',
      entityId: created.id,
      newValue: created,
      req,
    });

    res.status(201).json({ success: true, uniqueItem: created, stockItem: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create stock item' });
  }
});

router.patch(['/unique-items/:id', '/stock-items/:id'], requireAnyPermission(['master:edit', 'master.edit', 'master:manage', 'master:create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.id, id), eq(uniqueItems.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Stock Item not found' });
      return;
    }

    let codeToUpdate = current.code;
    if (req.body.code && req.body.code.trim().toUpperCase() !== current.code) {
      codeToUpdate = req.body.code.trim().toUpperCase();
      const [existing] = await db
        .select()
        .from(uniqueItems)
        .where(
          and(
            eq(uniqueItems.code, codeToUpdate),
            eq(uniqueItems.businessId, bizId),
            ne(uniqueItems.id, id)
          )
        )
        .limit(1);
      if (existing) {
        res.status(400).json({ error: `Stock item with code "${codeToUpdate}" already exists.` });
        return;
      }
    }

    let primaryItemIdToSet = current.primaryItemId;
    if (req.body.primaryItemId !== undefined) {
      primaryItemIdToSet = req.body.primaryItemId === null || req.body.primaryItemId === '' ? null : req.body.primaryItemId;
    }

    let maintainBatchesToSet = current.maintainBatches;
    const incomingMaintainBatches = req.body.maintainBatches !== undefined ? req.body.maintainBatches : req.body.maintain_batches;

    if (incomingMaintainBatches !== undefined) {
      if (typeof incomingMaintainBatches !== 'boolean') {
        res.status(400).json({ error: 'Maintain Batches must be a boolean (true/false).' });
        return;
      }

      if (current.maintainBatches === true && incomingMaintainBatches === false) {
        // YES -> NO safety validation
        const batchCheck = await pool.query(
          `SELECT id FROM "optical_batches" WHERE "unique_item_id" = $1 LIMIT 1`,
          [id]
        );

        if (batchCheck.rows.length > 0) {
          const stockCheck = await pool.query(
            `SELECT 
               COALESCE(SUM(os.physical_stock), 0) as total_physical,
               COALESCE(SUM(os.reserved_stock), 0) as total_reserved
             FROM "optical_stocks" os
             JOIN "optical_batches" ob ON os.batch_id = ob.id
             WHERE ob.unique_item_id = $1`,
            [id]
          );
          const totalPhysical = Number(stockCheck.rows[0]?.total_physical || 0);
          const totalReserved = Number(stockCheck.rows[0]?.total_reserved || 0);

          if (totalPhysical > 0 || totalReserved > 0) {
            res.status(400).json({
              error: 'Maintain Batches cannot be disabled because this Stock Item has batch-wise inventory or transaction history.'
            });
            return;
          }

          const historyCheck = await pool.query(
            `SELECT 
               (SELECT COUNT(*)::int FROM "stock_ledger" sl JOIN "optical_batches" ob ON sl.batch_id = ob.id WHERE ob.unique_item_id = $1) as ledger_count,
               (SELECT COUNT(*)::int FROM "sales_invoice_line_batches" silb JOIN "optical_batches" ob ON silb.batch_id = ob.id WHERE ob.unique_item_id = $1) as sales_count,
               (SELECT COUNT(*)::int FROM "purchase_invoice_line_batches" pilb JOIN "optical_batches" ob ON pilb.batch_id = ob.id WHERE ob.unique_item_id = $1) as purchase_count,
               (SELECT COUNT(*)::int FROM "purchase_lots" pl WHERE pl.unique_item_id = $1 OR pl.batch_id IN (SELECT id FROM "optical_batches" WHERE unique_item_id = $1)) as lot_count,
               (SELECT COUNT(*)::int FROM "sales_order_line_batches" solb JOIN "optical_batches" ob ON solb.batch_id = ob.id WHERE ob.unique_item_id = $1) as order_count,
               (SELECT COUNT(*)::int FROM "sales_return_line_batches" srlb JOIN "optical_batches" ob ON srlb.batch_id = ob.id WHERE ob.unique_item_id = $1) as sales_return_count,
               (SELECT COUNT(*)::int FROM "purchase_return_line_batches" prlb JOIN "optical_batches" ob ON prlb.batch_id = ob.id WHERE ob.unique_item_id = $1) as purchase_return_count,
               (SELECT COUNT(*)::int FROM "stock_reservations" sr JOIN "optical_batches" ob ON sr.batch_id = ob.id WHERE ob.unique_item_id = $1) as reservation_count
            `,
            [id]
          );
          const h = historyCheck.rows[0];
          const totalHistory = (h?.ledger_count || 0) + (h?.sales_count || 0) + (h?.purchase_count || 0) +
                               (h?.lot_count || 0) + (h?.order_count || 0) + (h?.sales_return_count || 0) +
                               (h?.purchase_return_count || 0) + (h?.reservation_count || 0);

          if (totalHistory > 0) {
            res.status(400).json({
              error: 'Maintain Batches cannot be disabled because this Stock Item has batch-wise inventory or transaction history.'
            });
            return;
          }
        }

        maintainBatchesToSet = false;
      } else if (current.maintainBatches === false && incomingMaintainBatches === true) {
        maintainBatchesToSet = true;
      }
    }

    let opticalCategoryToSet = current.opticalCategory;
    const incomingCat = req.body.opticalCategory || req.body.optical_category || req.body.category || req.body.itemCategory || req.body.item_category;
    if (incomingCat && ['SV', 'KT', 'PROG', 'OTHER'].includes(String(incomingCat).toUpperCase())) {
      opticalCategoryToSet = String(incomingCat).toUpperCase();
    }

    let unitToSet = current.unit || 'PRS';
    const rawUnit = req.body.unit;
    if (rawUnit !== undefined && rawUnit !== null && String(rawUnit).trim() !== '') {
      const incomingUnit = String(rawUnit).trim().toUpperCase();
      if (!['PRS', 'PCS'].includes(incomingUnit)) {
        res.status(400).json({ error: 'Unit must be either PRS (Pairs) or PCS (Pieces).' });
        return;
      }
      if (incomingUnit !== (current.unit || 'PRS')) {
        // Safe check: verify if item has stock or transaction history
        const stockCheck = await pool.query(
          `SELECT 
             COALESCE(SUM(os.physical_stock), 0) as total_physical,
             COALESCE(SUM(os.reserved_stock), 0) as total_reserved
           FROM "optical_stocks" os
           JOIN "optical_batches" ob ON os.batch_id = ob.id
           WHERE ob.unique_item_id = $1`,
          [id]
        );
        const totalPhysical = Number(stockCheck.rows[0]?.total_physical || 0);
        const totalReserved = Number(stockCheck.rows[0]?.total_reserved || 0);

        const historyCheck = await pool.query(
          `SELECT 
             (SELECT COUNT(*)::int FROM "stock_ledger" sl JOIN "optical_batches" ob ON sl.batch_id = ob.id WHERE ob.unique_item_id = $1) as batch_ledger_count,
             (SELECT COUNT(*)::int FROM "sales_invoice_lines" sil WHERE sil.unique_item_id = $1) as sales_lines_count,
             (SELECT COUNT(*)::int FROM "purchase_invoice_lines" pil WHERE pil.unique_item_id = $1) as purchase_lines_count,
             (SELECT COUNT(*)::int FROM "purchase_lots" pl WHERE pl.unique_item_id = $1) as lots_count,
             (SELECT COUNT(*)::int FROM "sales_order_lines" sol WHERE sol.unique_item_id = $1) as order_lines_count,
             (SELECT COUNT(*)::int FROM "sales_return_lines" srl WHERE srl.unique_item_id = $1) as sales_return_count,
             (SELECT COUNT(*)::int FROM "purchase_return_lines" prl WHERE prl.unique_item_id = $1) as purchase_return_count
          `,
          [id]
        );
        const h = historyCheck.rows[0];
        const totalHistory = (h?.batch_ledger_count || 0) + (h?.sales_lines_count || 0) + (h?.purchase_lines_count || 0) +
                             (h?.lots_count || 0) + (h?.order_lines_count || 0) + (h?.sales_return_count || 0) +
                             (h?.purchase_return_count || 0);

        if (totalPhysical > 0 || totalReserved > 0 || totalHistory > 0) {
          res.status(400).json({
            error: 'Unit cannot be changed because this Stock Item already has stock or transaction history.'
          });
          return;
        }

        unitToSet = incomingUnit;
      }
    }

    const [updated] = await db
      .update(uniqueItems)
      .set({
        code: codeToUpdate,
        name: req.body.name ?? current.name,
        primaryItemId: primaryItemIdToSet,
        maintainBatches: maintainBatchesToSet,
        opticalCategory: opticalCategoryToSet,
        unit: unitToSet,
        description: req.body.description !== undefined ? req.body.description : current.description,
        purchaseRate: req.body.purchaseRate !== undefined ? String(req.body.purchaseRate) : current.purchaseRate,
        lastPurchasePrice: req.body.lastPurchasePrice !== undefined ? String(req.body.lastPurchasePrice) : current.lastPurchasePrice,
        mrp: req.body.mrp !== undefined ? String(req.body.mrp) : current.mrp,
        gstRate: req.body.gstRate !== undefined ? String(req.body.gstRate) : current.gstRate,
        status: req.body.status ?? current.status,
        updatedAt: new Date(),
        updatedBy: req.user!.id,
      })
      .where(eq(uniqueItems.id, id))
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: req.body.status && req.body.status !== current.status ? (req.body.status === 'ACTIVE' ? 'ENABLE' : 'DISABLE') : 'UPDATE',
      module: 'INVENTORY',
      entityType: 'UniqueItem',
      entityId: id,
      previousValue: current,
      newValue: updated,
      req,
    });

    res.json({ success: true, uniqueItem: updated, stockItem: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update stock item' });
  }
});

router.delete(['/unique-items/:id', '/stock-items/:id'], requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db
      .select()
      .from(uniqueItems)
      .where(and(eq(uniqueItems.id, id), eq(uniqueItems.businessId, bizId)))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'Stock Item not found' });
      return;
    }

    // Check if any invoices (sales or purchase) or documents reference this unique item
    const checkRes = await pool.query(
      `SELECT 
        (
          SELECT COUNT(*)::int 
          FROM sales_invoice_lines sil
          WHERE sil.unique_item_id = $1
        ) AS sales_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_invoice_lines pil
          WHERE pil.unique_item_id = $1
        ) AS purchase_invoice_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_order_lines sol
          WHERE sol.unique_item_id = $1
        ) AS sales_order_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM sales_return_lines srl
          WHERE srl.unique_item_id = $1
        ) AS sales_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM purchase_return_lines prl
          WHERE prl.unique_item_id = $1
        ) AS purchase_return_lines_count,
        (
          SELECT COUNT(*)::int 
          FROM optical_batches ob
          WHERE ob.unique_item_id = $1
        ) AS optical_batches_count
      `,
      [id]
    );

    const {
      sales_invoice_lines_count,
      purchase_invoice_lines_count,
      sales_order_lines_count,
      sales_return_lines_count,
      purchase_return_lines_count,
      optical_batches_count,
    } = checkRes.rows[0];

    if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Sales or Purchase Invoices / Returns have already been recorded with this SKU item. Invoiced items cannot be deleted to preserve financial audit trails.`
      });
      return;
    }

    if (sales_order_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Active Sales Orders reference this SKU item. Cancel or complete the orders first.`
      });
      return;
    }

    // Clean up dependent child master data in sequence
    await pool.query(
      `DELETE FROM stock_ledger 
       WHERE batch_id IN (
         SELECT id FROM optical_batches WHERE unique_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM stock_reservations 
       WHERE batch_id IN (
         SELECT id FROM optical_batches WHERE unique_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM optical_stocks 
       WHERE batch_id IN (
         SELECT id FROM optical_batches WHERE unique_item_id = $1
       )`,
      [id]
    );

    await pool.query(
      `DELETE FROM optical_batches WHERE unique_item_id = $1`,
      [id]
    );

    await pool.query(
      `DELETE FROM party_item_prices WHERE unique_item_id = $1`,
      [id]
    );

    await db.delete(uniqueItems).where(and(eq(uniqueItems.id, id), eq(uniqueItems.businessId, bizId)));

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'DELETE',
      module: 'INVENTORY',
      entityType: 'UniqueItem',
      entityId: id,
      previousValue: current,
      req,
    });

    res.json({
      success: true,
      message: `Stock Item "${current.name}" (${current.code}) ${optical_batches_count > 0 ? `and ${optical_batches_count} optical power batch(es)` : ''} deleted successfully from database.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete stock item' });
  }
});

router.post(['/unique-items/bulk-delete', '/stock-items/bulk-delete'], requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Please provide an array of Stock Item IDs to delete.' });
      return;
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        const [current] = await db
          .select()
          .from(uniqueItems)
          .where(and(eq(uniqueItems.id, id), eq(uniqueItems.businessId, bizId)))
          .limit(1);

        if (!current) {
          errors.push(`Stock Item ID ${id} not found.`);
          continue;
        }

        const checkRes = await pool.query(
          `SELECT 
            (SELECT COUNT(*)::int FROM sales_invoice_lines sil WHERE sil.unique_item_id = $1) AS sales_invoice_lines_count,
            (SELECT COUNT(*)::int FROM purchase_invoice_lines pil WHERE pil.unique_item_id = $1) AS purchase_invoice_lines_count,
            (SELECT COUNT(*)::int FROM sales_order_lines sol WHERE sol.unique_item_id = $1) AS sales_order_lines_count,
            (SELECT COUNT(*)::int FROM sales_return_lines srl WHERE srl.unique_item_id = $1) AS sales_return_lines_count,
            (SELECT COUNT(*)::int FROM purchase_return_lines prl WHERE prl.unique_item_id = $1) AS purchase_return_lines_count
          `,
          [id]
        );

        const {
          sales_invoice_lines_count,
          purchase_invoice_lines_count,
          sales_order_lines_count,
          sales_return_lines_count,
          purchase_return_lines_count,
        } = checkRes.rows[0];

        if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has recorded sales/purchase invoices or returns.`);
          continue;
        }

        if (sales_order_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has active sales orders.`);
          continue;
        }

        // Clean up child tables
        await pool.query(
          `DELETE FROM stock_ledger 
           WHERE batch_id IN (
             SELECT id FROM optical_batches WHERE unique_item_id = $1
           )`,
          [id]
        );

        await pool.query(
          `DELETE FROM stock_reservations 
           WHERE batch_id IN (
             SELECT id FROM optical_batches WHERE unique_item_id = $1
           )`,
          [id]
        );

        await pool.query(
          `DELETE FROM optical_stocks 
           WHERE batch_id IN (
             SELECT id FROM optical_batches WHERE unique_item_id = $1
           )`,
          [id]
        );

        await pool.query(`DELETE FROM optical_batches WHERE unique_item_id = $1`, [id]);
        await pool.query(`DELETE FROM party_item_prices WHERE unique_item_id = $1`, [id]);
        await db.delete(uniqueItems).where(and(eq(uniqueItems.id, id), eq(uniqueItems.businessId, bizId)));

        await recordAuditLog({
          businessId: bizId,
          userId: req.user!.id,
          action: 'DELETE',
          module: 'INVENTORY',
          entityType: 'UniqueItem',
          entityId: id,
          previousValue: current,
          req,
        });

        deletedCount++;
      } catch (itemErr: any) {
        errors.push(`Failed to delete stock item ${id}: ${itemErr.message}`);
      }
    }

    res.json({
      success: true,
      totalRequested: ids.length,
      deletedCount,
      failedCount: errors.length,
      errors,
      message: deletedCount === ids.length
        ? `Successfully deleted ${deletedCount} stock item(s).`
        : `Deleted ${deletedCount} of ${ids.length} stock item(s). ${errors.length} item(s) could not be deleted.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform bulk delete of stock items' });
  }
});

// ==========================================
// 6. OPTICAL BATCHES & STOCK CRUD
// ==========================================

router.get('/batches', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { uniqueItemId, categoryId, search, barcode } = req.query;

    const rows = await db
      .select({
        id: opticalBatches.id,
        barcode: opticalBatches.barcode,
        sph: opticalBatches.sph,
        cyl: opticalBatches.cyl,
        axis: opticalBatches.axis,
        add: opticalBatches.add,
        side: opticalBatches.side,
        identityKey: opticalBatches.identityKey,
        status: opticalBatches.status,
        createdAt: opticalBatches.createdAt,
        updatedAt: opticalBatches.updatedAt,
        uniqueItemId: opticalBatches.uniqueItemId,
        uniqueItemName: uniqueItems.name,
        uniqueItemCode: uniqueItems.code,
        opticalCategory: uniqueItems.opticalCategory,
        primaryItemName: primaryItems.name,
        categoryId: opticalBatches.categoryId,
        categoryName: categories.name,
        categoryCode: sql<string>`COALESCE(${uniqueItems.opticalCategory}, ${categories.code}, 'SV')`,
        physicalStock: opticalStocks.physicalStock,
        reservedStock: opticalStocks.reservedStock,
        availableStock: opticalStocks.availableStock,
      })
      .from(opticalBatches)
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .leftJoin(opticalStocks, eq(opticalBatches.id, opticalStocks.batchId))
      .where(eq(opticalBatches.businessId, bizId))
      .orderBy(desc(opticalBatches.createdAt));

    const mappedRows = rows.map(r => {
      const catCode = r.opticalCategory || r.categoryCode || 'SV';
      const formattedName = formatOpticalBatchName({
        sph: r.sph,
        cyl: r.cyl,
        axis: r.axis,
        add: r.add,
        side: r.side,
        categoryCode: catCode,
      });
      return {
        ...r,
        categoryCode: catCode,
        formattedName,
        name: formattedName,
      };
    });

    let filtered = mappedRows;
    if (uniqueItemId) filtered = filtered.filter(r => r.uniqueItemId === uniqueItemId);
    if (categoryId) filtered = filtered.filter(r => r.categoryId === categoryId);
    if (barcode && typeof barcode === 'string') filtered = filtered.filter(r => r.barcode.toLowerCase() === barcode.toLowerCase());
    if (search && typeof search === 'string') {
      filtered = rankSearchMatch(filtered, search, r => ({
        id: r.id,
        name: r.formattedName,
        code: r.uniqueItemCode,
        barcode: r.barcode,
        sph: r.sph,
        cyl: r.cyl,
        axis: r.axis,
        add: r.add,
        side: r.side,
        categoryCode: r.categoryCode,
        rawText: `${r.uniqueItemName} ${r.barcode} ${r.identityKey}`,
      }));
    }

    res.json({ success: true, batches: filtered });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch optical batches' });
  }
});

router.get('/batches/:id', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const [batch] = await db
      .select({
        id: opticalBatches.id,
        barcode: opticalBatches.barcode,
        sph: opticalBatches.sph,
        cyl: opticalBatches.cyl,
        axis: opticalBatches.axis,
        add: opticalBatches.add,
        side: opticalBatches.side,
        identityKey: opticalBatches.identityKey,
        status: opticalBatches.status,
        createdAt: opticalBatches.createdAt,
        updatedAt: opticalBatches.updatedAt,
        uniqueItemId: opticalBatches.uniqueItemId,
        uniqueItemName: uniqueItems.name,
        uniqueItemCode: uniqueItems.code,
        primaryItemName: primaryItems.name,
        categoryId: opticalBatches.categoryId,
        categoryName: categories.name,
        categoryCode: categories.code,
        physicalStock: opticalStocks.physicalStock,
        reservedStock: opticalStocks.reservedStock,
        availableStock: opticalStocks.availableStock,
      })
      .from(opticalBatches)
      .innerJoin(uniqueItems, eq(opticalBatches.uniqueItemId, uniqueItems.id))
      .leftJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .leftJoin(opticalStocks, eq(opticalBatches.id, opticalStocks.batchId))
      .where(and(eq(opticalBatches.id, req.params.id), eq(opticalBatches.businessId, bizId)))
      .limit(1);

    if (!batch) {
      res.status(404).json({ error: 'Optical Batch not found' });
      return;
    }

    res.json({ success: true, batch });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch optical batch' });
  }
});

/**
 * POST /api/optical-master/batches/find-or-create
 * Canonical endpoint to find or create optical batch with permanent barcode
 */
router.post(
  '/batches/find-or-create',
  requireAnyPermission(['master:create', 'master.create', 'purchase:create', 'purchase.create', 'purchase:edit', 'sales:create']),
  async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { uniqueItemId, categoryId, sph, cyl, axis, add, side } = req.body;

    if (!uniqueItemId) {
      res.status(400).json({ error: 'uniqueItemId is required' });
      return;
    }

    const result = await findOrCreateOpticalBatch({
      businessId: bizId,
      uniqueItemId,
      categoryId,
      sph,
      cyl,
      axis,
      add,
      side,
      userId: req.user!.id,
    });

    if (result.isNew) {
      await recordAuditLog({
        businessId: bizId,
        userId: req.user!.id,
        action: 'CREATE',
        module: 'INVENTORY',
        entityType: 'OpticalBatch',
        entityId: result.batch.id,
        newValue: { batch: result.batch, stock: result.stock },
        req,
      });
    }

    res.json({
      success: true,
      batch: result.batch,
      stock: result.stock,
      isNew: result.isNew,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to find or create optical batch', code: error.code });
  }
});

router.patch('/batches/:id', requireAnyPermission(['master:edit', 'master.edit', 'master:manage', 'master:create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db
      .select()
      .from(opticalBatches)
      .where(and(eq(opticalBatches.id, id), eq(opticalBatches.businessId, bizId)))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'Optical Batch not found' });
      return;
    }

    const updated = await updateOpticalBatch(bizId, id, req.body, req.user!.id);

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: req.body.status && req.body.status !== current.status ? (req.body.status === 'ACTIVE' ? 'ENABLE' : 'DISABLE') : 'UPDATE',
      module: 'INVENTORY',
      entityType: 'OpticalBatch',
      entityId: id,
      previousValue: current,
      newValue: updated,
      req,
    });

    res.json({ success: true, batch: updated });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to update optical batch' });
  }
});

router.patch('/batches/:id/status', requireAnyPermission(['master:edit', 'master.edit', 'master:manage', 'master:create']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;
    const { status } = req.body;

    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE' });
      return;
    }

    const [current] = await db.select().from(opticalBatches).where(and(eq(opticalBatches.id, id), eq(opticalBatches.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Optical Batch not found' });
      return;
    }

    const [updated] = await db
      .update(opticalBatches)
      .set({
        status,
        updatedAt: new Date(),
        updatedBy: req.user!.id,
      })
      .where(eq(opticalBatches.id, id))
      .returning();

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: status === 'ACTIVE' ? 'ENABLE' : 'DISABLE',
      module: 'INVENTORY',
      entityType: 'OpticalBatch',
      entityId: id,
      previousValue: current,
      newValue: updated,
      req,
    });

    res.json({ success: true, batch: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update batch status' });
  }
});

interface BatchReferenceItem {
  type: string;
  typeLabel: string;
  documentId: string;
  documentNumber: string;
  status: string;
  date: string | null;
  quantity: number;
  partyName?: string;
  details?: string;
}

interface BatchDeletionSafetyResult {
  canDelete: boolean;
  error?: string;
  reasonSummary?: string;
  references: BatchReferenceItem[];
  stockInfo: {
    physicalStock: number;
    reservedStock: number;
    availableStock: number;
    hasLedgerHistory: boolean;
    ledgerCount: number;
  };
}

async function checkBatchDeletionSafety(batchId: string): Promise<BatchDeletionSafetyResult> {
  const references: BatchReferenceItem[] = [];

  // 1. Sales Invoices referencing this batch
  const salesInvRes = await pool.query(
    `SELECT 
      si.id AS doc_id,
      si.invoice_number AS doc_number,
      si.status AS doc_status,
      si.invoice_date AS doc_date,
      silb.quantity,
      p.name AS party_name
    FROM sales_invoice_line_batches silb
    JOIN sales_invoice_lines sil ON silb.sales_invoice_line_id = sil.id
    JOIN sales_invoices si ON sil.sales_invoice_id = si.id
    LEFT JOIN parties p ON si.party_id = p.id
    WHERE silb.batch_id = $1`,
    [batchId]
  );
  for (const r of salesInvRes.rows) {
    references.push({
      type: 'SALES_INVOICE',
      typeLabel: 'Sales Invoice',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: r.party_name || 'Customer',
    });
  }

  // 2. Purchase Invoices referencing this batch
  const purchInvRes = await pool.query(
    `SELECT 
      pi.id AS doc_id,
      pi.invoice_number AS doc_number,
      pi.status AS doc_status,
      pi.invoice_date AS doc_date,
      pilb.quantity,
      p.name AS party_name
    FROM purchase_invoice_line_batches pilb
    JOIN purchase_invoice_lines pil ON pilb.purchase_invoice_line_id = pil.id
    JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
    LEFT JOIN parties p ON pi.supplier_party_id = p.id
    WHERE pilb.batch_id = $1`,
    [batchId]
  );
  for (const r of purchInvRes.rows) {
    references.push({
      type: 'PURCHASE_INVOICE',
      typeLabel: 'Purchase Invoice',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: r.party_name || 'Supplier',
    });
  }

  // 3. Purchase Lots
  const lotsRes = await pool.query(
    `SELECT 
      pl.id AS doc_id,
      COALESCE(pi.invoice_number, 'LOT-' || SUBSTRING(pl.id::text, 1, 8)) AS doc_number,
      'ACTIVE' AS doc_status,
      pl.received_at AS doc_date,
      pl.quantity_received AS quantity
    FROM purchase_lots pl
    LEFT JOIN purchase_invoices pi ON pl.purchase_invoice_id = pi.id
    WHERE pl.batch_id = $1`,
    [batchId]
  );
  for (const r of lotsRes.rows) {
    references.push({
      type: 'PURCHASE_LOT',
      typeLabel: 'Purchase Lot',
      documentId: r.doc_id,
      documentNumber: r.doc_number || 'Lot',
      status: 'ACTIVE',
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
    });
  }

  // 4. Sales Returns
  const salesRetRes = await pool.query(
    `SELECT 
      sr.id AS doc_id,
      sr.return_number AS doc_number,
      sr.status AS doc_status,
      sr.return_date AS doc_date,
      srlb.quantity,
      p.name AS party_name
    FROM sales_return_line_batches srlb
    JOIN sales_return_lines srl ON srlb.sales_return_line_id = srl.id
    JOIN sales_returns sr ON srl.sales_return_id = sr.id
    LEFT JOIN parties p ON sr.party_id = p.id
    WHERE srlb.batch_id = $1`,
    [batchId]
  );
  for (const r of salesRetRes.rows) {
    references.push({
      type: 'SALES_RETURN',
      typeLabel: 'Sales Return',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: r.party_name || 'Customer',
    });
  }

  // 5. Purchase Returns
  const purchRetRes = await pool.query(
    `SELECT 
      pr.id AS doc_id,
      pr.return_number AS doc_number,
      pr.status AS doc_status,
      pr.return_date AS doc_date,
      prlb.quantity,
      p.name AS party_name
    FROM purchase_return_line_batches prlb
    JOIN purchase_return_lines prl ON prlb.purchase_return_line_id = prl.id
    JOIN purchase_returns pr ON prl.purchase_return_id = pr.id
    LEFT JOIN parties p ON pr.supplier_party_id = p.id
    WHERE prlb.batch_id = $1`,
    [batchId]
  );
  for (const r of purchRetRes.rows) {
    references.push({
      type: 'PURCHASE_RETURN',
      typeLabel: 'Purchase Return',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: r.party_name || 'Supplier',
    });
  }

  // 6. Sales Orders
  const salesOrdRes = await pool.query(
    `SELECT 
      so.id AS doc_id,
      so.order_number AS doc_number,
      so.status AS doc_status,
      so.order_date AS doc_date,
      solb.quantity,
      p.name AS party_name
    FROM sales_order_line_batches solb
    JOIN sales_order_lines sol ON solb.sales_order_line_id = sol.id
    JOIN sales_orders so ON sol.sales_order_id = so.id
    LEFT JOIN parties p ON so.party_id = p.id
    WHERE solb.batch_id = $1`,
    [batchId]
  );
  for (const r of salesOrdRes.rows) {
    references.push({
      type: 'SALES_ORDER',
      typeLabel: 'Sales Order',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: r.party_name || 'Customer',
    });
  }

  // 7. Stock Ledger Records Count
  const ledgerCountRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM stock_ledger WHERE batch_id = $1`,
    [batchId]
  );
  const ledgerCount = ledgerCountRes.rows[0]?.count || 0;

  // 8. Stock Levels & Reservations
  const stockRes = await pool.query(
    `SELECT 
      COALESCE(physical_stock, 0) AS physical_stock,
      COALESCE(reserved_stock, 0) AS reserved_stock,
      COALESCE(available_stock, 0) AS available_stock
    FROM optical_stocks
    WHERE batch_id = $1`,
    [batchId]
  );
  const physicalStock = parseFloat(stockRes.rows[0]?.physical_stock) || 0;
  const reservedStock = parseFloat(stockRes.rows[0]?.reserved_stock) || 0;
  const availableStock = parseFloat(stockRes.rows[0]?.available_stock) || 0;

  const resCountRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM stock_reservations WHERE batch_id = $1`,
    [batchId]
  );
  const reservationCount = resCountRes.rows[0]?.count || 0;

  const stockInfo = {
    physicalStock,
    reservedStock,
    availableStock,
    hasLedgerHistory: ledgerCount > 0,
    ledgerCount,
  };

  // Determine if can delete safely
  if (references.length > 0) {
    const docSummary = references
      .slice(0, 3)
      .map(ref => `${ref.typeLabel} ${ref.documentNumber} (${ref.status})`)
      .join(', ');
    const more = references.length > 3 ? ` and ${references.length - 3} more` : '';

    return {
      canDelete: false,
      reasonSummary: 'Batch has active document line references',
      error: `Cannot delete this batch because it is referenced by ${docSummary}${more}.`,
      references,
      stockInfo,
    };
  }

  if (ledgerCount > 0) {
    const slSample = await pool.query(
      `SELECT transaction_type, reason, created_at, GREATEST(quantity_in, quantity_out) as qty
       FROM stock_ledger WHERE batch_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [batchId]
    );
    const ledgerRefs: BatchReferenceItem[] = slSample.rows.map(sl => ({
      type: 'STOCK_LEDGER',
      typeLabel: sl.transaction_type.replace(/_/g, ' '),
      documentId: batchId,
      documentNumber: sl.reason || sl.transaction_type,
      status: 'RECORDED',
      date: sl.created_at ? new Date(sl.created_at).toISOString() : null,
      quantity: parseFloat(sl.qty) || 0,
      details: sl.reason || undefined,
    }));

    return {
      canDelete: false,
      reasonSummary: 'Batch has recorded stock ledger history',
      error: `Cannot delete this batch because it has ${ledgerCount} recorded inventory movement(s) in the stock ledger.`,
      references: ledgerRefs,
      stockInfo,
    };
  }

  if (physicalStock > 0 || reservedStock > 0 || reservationCount > 0) {
    return {
      canDelete: false,
      reasonSummary: 'Batch has active inventory or reservations',
      error: `Cannot delete this batch because it currently has physical stock (${physicalStock}) or reserved stock (${reservedStock}).`,
      references: [],
      stockInfo,
    };
  }

  return {
    canDelete: true,
    references: [],
    stockInfo,
  };
}

router.get('/batches/:id/dependencies', requireAnyPermission(['master:view', 'inventory:view']), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const safetyCheck = await checkBatchDeletionSafety(id);
    res.json({
      success: true,
      data: safetyCheck,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to check batch dependencies' });
  }
});

router.delete('/batches/:id', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db
      .select({
        id: opticalBatches.id,
        barcode: opticalBatches.barcode,
        sph: opticalBatches.sph,
        cyl: opticalBatches.cyl,
        axis: opticalBatches.axis,
        add: opticalBatches.add,
        side: opticalBatches.side,
        uniqueItemId: opticalBatches.uniqueItemId,
        identityKey: opticalBatches.identityKey,
        businessId: opticalBatches.businessId,
      })
      .from(opticalBatches)
      .where(and(eq(opticalBatches.id, id), eq(opticalBatches.businessId, bizId)))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'Optical Batch not found' });
      return;
    }

    // Check safety of batch deletion
    const safetyCheck = await checkBatchDeletionSafety(id);

    if (!safetyCheck.canDelete) {
      res.status(400).json({
        success: false,
        canDelete: false,
        error: safetyCheck.error,
        reasonSummary: safetyCheck.reasonSummary,
        references: safetyCheck.references,
        stockInfo: safetyCheck.stockInfo,
        batch: {
          id: current.id,
          barcode: current.barcode,
          sph: current.sph,
          cyl: current.cyl,
          uniqueItemId: current.uniqueItemId,
        },
      });
      return;
    }

    // Safe to delete: zero stock, zero reservations, zero ledger history, zero document references
    await pool.query(`DELETE FROM optical_stocks WHERE batch_id = $1`, [id]);
    await db.delete(opticalBatches).where(and(eq(opticalBatches.id, id), eq(opticalBatches.businessId, bizId)));

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: 'DELETE',
      module: 'INVENTORY',
      entityType: 'OpticalBatch',
      entityId: id,
      previousValue: current,
      req,
    });

    res.json({
      success: true,
      canDelete: true,
      message: `Optical Batch (${current.barcode}, SPH: ${current.sph}, CYL: ${current.cyl}) deleted successfully from database.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete optical batch' });
  }
});

router.post('/batches/bulk-delete', requireAnyPermission(['master:delete', 'master:edit']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Please provide an array of Optical Batch IDs to delete.' });
      return;
    }

    let deletedCount = 0;
    const errors: string[] = [];
    const blockedBatches: any[] = [];

    for (const id of ids) {
      try {
        const [current] = await db
          .select({
            id: opticalBatches.id,
            barcode: opticalBatches.barcode,
            sph: opticalBatches.sph,
            cyl: opticalBatches.cyl,
            axis: opticalBatches.axis,
            add: opticalBatches.add,
            side: opticalBatches.side,
            uniqueItemId: opticalBatches.uniqueItemId,
            identityKey: opticalBatches.identityKey,
            businessId: opticalBatches.businessId,
          })
          .from(opticalBatches)
          .where(and(eq(opticalBatches.id, id), eq(opticalBatches.businessId, bizId)))
          .limit(1);

        if (!current) {
          errors.push(`Optical Batch ID ${id} not found.`);
          continue;
        }

        const safetyCheck = await checkBatchDeletionSafety(id);

        if (!safetyCheck.canDelete) {
          errors.push(`"${current.barcode}" (${current.sph}/${current.cyl}): ${safetyCheck.error}`);
          blockedBatches.push({
            batchId: id,
            barcode: current.barcode,
            sph: current.sph,
            cyl: current.cyl,
            uniqueItemId: current.uniqueItemId,
            reason: safetyCheck.reasonSummary,
            error: safetyCheck.error,
            references: safetyCheck.references,
            stockInfo: safetyCheck.stockInfo,
          });
          continue;
        }

        // Clean up zero stock and batch record
        await pool.query(`DELETE FROM optical_stocks WHERE batch_id = $1`, [id]);
        await db.delete(opticalBatches).where(and(eq(opticalBatches.id, id), eq(opticalBatches.businessId, bizId)));

        await recordAuditLog({
          businessId: bizId,
          userId: req.user!.id,
          action: 'DELETE',
          module: 'INVENTORY',
          entityType: 'OpticalBatch',
          entityId: id,
          previousValue: current,
          req,
        });

        deletedCount++;
      } catch (itemErr: any) {
        errors.push(`Failed to delete optical batch ${id}: ${itemErr.message}`);
      }
    }

    res.json({
      success: true,
      totalRequested: ids.length,
      deletedCount,
      failedCount: errors.length,
      errors,
      blockedBatches,
      message: deletedCount === ids.length
        ? `Successfully deleted ${deletedCount} optical batch(es).`
        : `Deleted ${deletedCount} of ${ids.length} optical batch(es). ${errors.length} item(s) could not be deleted.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform bulk delete of optical batches' });
  }
});

// ==========================================
// 7. AUTOMATED TEST SUITE ENDPOINT
// ==========================================
router.post('/run-tests', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user?.isSuperAdmin) {
      res.status(403).json({ error: 'Super Admin privileges required to run master data test suite' });
      return;
    }
    const { runOpticalMasterTests } = await import('../tests/opticalMaster.test.js');
    const testResults = await runOpticalMasterTests();
    res.json({ success: true, ...testResults });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to run test suite' });
  }
});

export default router;
