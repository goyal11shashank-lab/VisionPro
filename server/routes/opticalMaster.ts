import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../middleware/permission.js';
import { db, pool } from '../db/index.js';
import {
  categories, bases, coatings, baseCategories, primaryItems, uniqueItems,
  opticalBatches, opticalStocks, stockLedger, businesses
} from '../db/schema.js';
import { eq, and, desc, sql, ilike, or, ne, inArray } from 'drizzle-orm';
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

    // Check all dependencies and audit records referencing this stock item
    const checkRes = await pool.query(
      `SELECT 
        (SELECT COUNT(*)::int FROM sales_invoice_lines sil WHERE sil.unique_item_id = $1) AS sales_invoice_lines_count,
        (SELECT COUNT(*)::int FROM purchase_invoice_lines pil WHERE pil.unique_item_id = $1) AS purchase_invoice_lines_count,
        (SELECT COUNT(*)::int FROM sales_order_lines sol WHERE sol.unique_item_id = $1) AS sales_order_lines_count,
        (SELECT COUNT(*)::int FROM purchase_order_lines pol WHERE pol.unique_item_id = $1) AS purchase_order_lines_count,
        (SELECT COUNT(*)::int FROM sales_return_lines srl WHERE srl.unique_item_id = $1) AS sales_return_lines_count,
        (SELECT COUNT(*)::int FROM purchase_return_lines prl WHERE prl.unique_item_id = $1) AS purchase_return_lines_count,
        (SELECT COUNT(*)::int FROM optical_batches ob WHERE ob.unique_item_id = $1) AS optical_batches_count,
        (SELECT COUNT(*)::int FROM stock_ledger sl JOIN optical_batches ob ON sl.batch_id = ob.id WHERE ob.unique_item_id = $1) AS stock_ledger_count,
        (SELECT COUNT(*)::int FROM stock_reservations sr JOIN optical_batches ob ON sr.batch_id = ob.id WHERE ob.unique_item_id = $1 AND sr.status = 'ACTIVE') AS stock_reservations_count,
        (SELECT COALESCE(SUM(ABS(os.physical_stock)), 0)::numeric FROM optical_batches ob JOIN optical_stocks os ON ob.id = os.batch_id WHERE ob.unique_item_id = $1) AS total_physical_stock
      `,
      [id]
    );

    const {
      sales_invoice_lines_count,
      purchase_invoice_lines_count,
      sales_order_lines_count,
      purchase_order_lines_count,
      sales_return_lines_count,
      purchase_return_lines_count,
      optical_batches_count,
      stock_ledger_count,
      stock_reservations_count,
      total_physical_stock,
    } = checkRes.rows[0];

    if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Sales or Purchase Invoices / Returns have already been recorded with this SKU item. Invoiced items cannot be deleted to preserve financial audit trails. Mark it INACTIVE instead.`
      });
      return;
    }

    if (sales_order_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Active Sales Orders reference this SKU item. Cancel or complete the orders first, or mark the item INACTIVE.`
      });
      return;
    }

    if (purchase_order_lines_count > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Active Purchase Orders reference this SKU item. Cancel or complete the orders first, or mark the item INACTIVE.`
      });
      return;
    }

    if (Number(stock_ledger_count) > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Inventory movements (${stock_ledger_count}) have already been recorded in the stock ledger. Mark it INACTIVE instead to preserve audit trails.`
      });
      return;
    }

    if (Number(total_physical_stock) !== 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Item currently holds active inventory stock (${total_physical_stock}). Transfer stock to 0, or mark the item INACTIVE.`
      });
      return;
    }

    if (Number(stock_reservations_count) > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Item has ${stock_reservations_count} active stock reservations. Release or convert reservations first, or mark the item INACTIVE.`
      });
      return;
    }

    if (Number(optical_batches_count) > 0) {
      res.status(400).json({
        error: `Cannot delete Stock Item "${current.name}" (${current.code}): Item has ${optical_batches_count} associated optical batches. Please delete or mark batches inactive first, or mark the item INACTIVE.`
      });
      return;
    }

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
            (SELECT COUNT(*)::int FROM purchase_order_lines pol WHERE pol.unique_item_id = $1) AS purchase_order_lines_count,
            (SELECT COUNT(*)::int FROM sales_return_lines srl WHERE srl.unique_item_id = $1) AS sales_return_lines_count,
            (SELECT COUNT(*)::int FROM purchase_return_lines prl WHERE prl.unique_item_id = $1) AS purchase_return_lines_count,
            (SELECT COUNT(*)::int FROM optical_batches ob WHERE ob.unique_item_id = $1) AS optical_batches_count,
            (SELECT COUNT(*)::int FROM stock_ledger sl JOIN optical_batches ob ON sl.batch_id = ob.id WHERE ob.unique_item_id = $1) AS stock_ledger_count,
            (SELECT COUNT(*)::int FROM stock_reservations sr JOIN optical_batches ob ON sr.batch_id = ob.id WHERE ob.unique_item_id = $1 AND sr.status = 'ACTIVE') AS stock_reservations_count,
            (SELECT COALESCE(SUM(ABS(os.physical_stock)), 0)::numeric FROM optical_batches ob JOIN optical_stocks os ON ob.id = os.batch_id WHERE ob.unique_item_id = $1) AS total_physical_stock
          `,
          [id]
        );

        const {
          sales_invoice_lines_count,
          purchase_invoice_lines_count,
          sales_order_lines_count,
          purchase_order_lines_count,
          sales_return_lines_count,
          purchase_return_lines_count,
          optical_batches_count,
          stock_ledger_count,
          stock_reservations_count,
          total_physical_stock,
        } = checkRes.rows[0];

        if (sales_invoice_lines_count > 0 || purchase_invoice_lines_count > 0 || sales_return_lines_count > 0 || purchase_return_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has recorded invoices or returns.`);
          continue;
        }

        if (sales_order_lines_count > 0 || purchase_order_lines_count > 0) {
          errors.push(`"${current.name}" (${current.code}) has active orders.`);
          continue;
        }

        if (Number(stock_ledger_count) > 0 || Number(total_physical_stock) !== 0 || Number(stock_reservations_count) > 0 || Number(optical_batches_count) > 0) {
          errors.push(`"${current.name}" (${current.code}) has associated batches, stock, or ledger transactions.`);
          continue;
        }

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
    openingStockOnly?: boolean;
    openingQuantity?: number;
  };
}

/**
 * Check whether an optical batch can be safely deleted.
 * 
 * Rules:
 * Rule A: Opening stock alone is NOT a deletion blocker.
 * Rule B: Block deletion when used in a posted Sales Invoice.
 * Rule C: Block deletion when used in a posted Purchase Invoice or Purchase Lot.
 * Rule D: Orders are not invoices. Active orders block deletion, cancelled/draft orders do not.
 * Rule E: Posted Sales/Purchase Returns block deletion to preserve financial/inventory history.
 * Rule F: Active stock reservations, active dealer orders, or live trading movements in stock_ledger block deletion.
 */
async function checkBatchDeletionSafety(batchId: string, queryable: any = pool): Promise<BatchDeletionSafetyResult> {
  const references: BatchReferenceItem[] = [];

  // 1. Sales Invoices referencing this batch (Rule B)
  const salesInvRes = await queryable.query(
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

  // 2. Purchase Invoices referencing this batch (Rule C)
  const purchInvRes = await queryable.query(
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

  // 3. Purchase Lots (Rule C)
  const lotsRes = await queryable.query(
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

  // 4. Sales Returns (Rule E)
  const salesRetRes = await queryable.query(
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

  // 5. Purchase Returns (Rule E)
  const purchRetRes = await queryable.query(
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

  // 6. Sales Orders (Rule D - Orders are not invoices)
  const salesOrdRes = await queryable.query(
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

  // 6B. Purchase Orders (Rule D)
  const purchOrdRes = await queryable.query(
    `SELECT 
      po.id AS doc_id,
      po.order_number AS doc_number,
      po.status AS doc_status,
      po.order_date AS doc_date,
      polb.quantity,
      p.name AS party_name
    FROM purchase_order_line_batches polb
    JOIN purchase_order_lines pol ON polb.purchase_order_line_id = pol.id
    JOIN purchase_orders po ON pol.purchase_order_id = po.id
    LEFT JOIN parties p ON po.supplier_party_id = p.id
    WHERE polb.batch_id = $1`,
    [batchId]
  );
  for (const r of purchOrdRes.rows) {
    references.push({
      type: 'PURCHASE_ORDER',
      typeLabel: 'Purchase Order',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: r.party_name || 'Supplier',
    });
  }

  // 6C. Dealer Logistics & Transfers (Rule F)
  const dealerShipRes = await queryable.query(
    `SELECT 
      ds.id AS doc_id,
      ds.shipment_number AS doc_number,
      ds.status AS doc_status,
      ds.dispatch_date AS doc_date,
      dsl.dispatched_quantity AS quantity
    FROM dealer_shipment_lines dsl
    JOIN dealer_shipments ds ON dsl.dealer_shipment_id = ds.id
    WHERE dsl.main_batch_id = $1`,
    [batchId]
  );
  for (const r of dealerShipRes.rows) {
    references.push({
      type: 'DEALER_SHIPMENT',
      typeLabel: 'Dealer Shipment',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: 'Dealer Branch',
    });
  }

  const dealerGrnRes = await queryable.query(
    `SELECT 
      dgr.id AS doc_id,
      dgr.receipt_number AS doc_number,
      dgr.status AS doc_status,
      dgr.receipt_date AS doc_date,
      dgrl.received_quantity AS quantity
    FROM dealer_goods_receipt_lines dgrl
    JOIN dealer_goods_receipts dgr ON dgrl.goods_receipt_id = dgr.id
    WHERE dgrl.main_batch_id = $1 OR dgrl.dealer_batch_id = $1`,
    [batchId]
  );
  for (const r of dealerGrnRes.rows) {
    references.push({
      type: 'DEALER_GRN',
      typeLabel: 'Dealer Goods Receipt',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: 'Dealer Branch',
    });
  }

  const dealerRetRes = await queryable.query(
    `SELECT 
      dr.id AS doc_id,
      dr.return_number AS doc_number,
      dr.status AS doc_status,
      dr.created_at AS doc_date,
      drl.sent_quantity AS quantity
    FROM dealer_return_lines drl
    JOIN dealer_returns dr ON drl.dealer_return_id = dr.id
    WHERE drl.main_batch_id = $1 OR drl.dealer_batch_id = $1`,
    [batchId]
  );
  for (const r of dealerRetRes.rows) {
    references.push({
      type: 'DEALER_RETURN',
      typeLabel: 'Dealer Return',
      documentId: r.doc_id,
      documentNumber: r.doc_number,
      status: r.doc_status,
      date: r.doc_date ? new Date(r.doc_date).toISOString() : null,
      quantity: parseFloat(r.quantity) || 0,
      partyName: 'Dealer Branch',
    });
  }

  // 7. Stock Ledger Records Inspection
  const ledgerRowsRes = await queryable.query(
    `SELECT id, transaction_type, reference_type, reference_id, quantity_in, quantity_out, balance, reason, created_at
     FROM stock_ledger 
     WHERE batch_id = $1 
     ORDER BY created_at ASC`,
    [batchId]
  );
  const ledgerRows = ledgerRowsRes.rows;
  const ledgerCount = ledgerRows.length;

  // Filter for live trading movements (SALE, PURCHASE, RETURNS, TRANSFERS, FULFILLMENT)
  const liveTradingLedgerRows = ledgerRows.filter((sl: any) => {
    const type = sl.transaction_type;
    return (
      type === 'SALE' ||
      type === 'SALES_RETURN' ||
      type === 'PURCHASE' ||
      type === 'PURCHASE_RETURN' ||
      type === 'STOCK_TRANSFER' ||
      type === 'RESERVATION_CONVERSION' ||
      (sl.reference_type && ['INVOICE', 'BILL', 'TRANSFER'].includes(sl.reference_type))
    );
  });

  // Calculate opening stock quantity if present
  let totalOpeningQty = 0;
  for (const sl of ledgerRows) {
    if (sl.transaction_type === 'OPENING_STOCK' || (sl.transaction_type === 'STOCK_ADJUSTMENT' && (!sl.reference_type || ['MANUAL_ENTRY', 'MANUAL_ADJUSTMENT', 'IMPORT'].includes(sl.reference_type)))) {
      totalOpeningQty += parseFloat(sl.quantity_in) || 0;
    }
  }

  // 8. Stock Levels & Active Reservations
  const stockRes = await queryable.query(
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

  // Check active reservations (only ACTIVE reservations block deletion; RELEASED/CANCELLED do not)
  const activeResCountRes = await queryable.query(
    `SELECT COUNT(*)::int AS count FROM stock_reservations WHERE batch_id = $1 AND status = 'ACTIVE'`,
    [batchId]
  );
  const activeReservationCount = activeResCountRes.rows[0]?.count || 0;

  const stockInfo = {
    physicalStock,
    reservedStock,
    availableStock,
    hasLedgerHistory: liveTradingLedgerRows.length > 0,
    ledgerCount,
    openingStockOnly: liveTradingLedgerRows.length === 0 && ledgerCount > 0,
    openingQuantity: totalOpeningQty,
  };

  // CHECK BLOCKING RULES:

  // Rule B Check: Posted Sales Invoice
  const salesInvoices = references.filter(r => r.type === 'SALES_INVOICE');
  if (salesInvoices.length > 0) {
    const docSummary = salesInvoices.slice(0, 3).map(r => r.documentNumber || r.documentId).join(', ');
    const more = salesInvoices.length > 3 ? ` and ${salesInvoices.length - 3} more` : '';
    return {
      canDelete: false,
      reasonSummary: 'Batch has been used in a Sales Invoice',
      error: `This batch cannot be deleted because it has been used in a Sales Invoice (${docSummary}${more}). Open the related voucher to review the transaction.`,
      references,
      stockInfo,
    };
  }

  // Rule C Check: Posted Purchase Invoice or Purchase Lot
  const purchInvoices = references.filter(r => r.type === 'PURCHASE_INVOICE' || r.type === 'PURCHASE_LOT');
  if (purchInvoices.length > 0) {
    const docSummary = purchInvoices.slice(0, 3).map(r => r.documentNumber || r.documentId).join(', ');
    const more = purchInvoices.length > 3 ? ` and ${purchInvoices.length - 3} more` : '';
    return {
      canDelete: false,
      reasonSummary: 'Batch has been used in a Purchase Invoice',
      error: `This batch cannot be deleted because it has been used in a Purchase Invoice (${docSummary}${more}). Open the related voucher to review the transaction.`,
      references,
      stockInfo,
    };
  }

  // Rule E Check: Returns and Reversals
  const returns = references.filter(r => (r.type === 'SALES_RETURN' || r.type === 'PURCHASE_RETURN') && r.status !== 'DRAFT');
  if (returns.length > 0) {
    const docSummary = returns.slice(0, 3).map(r => `${r.typeLabel} ${r.documentNumber || r.documentId}`).join(', ');
    const more = returns.length > 3 ? ` and ${returns.length - 3} more` : '';
    return {
      canDelete: false,
      reasonSummary: 'Batch has transaction history in Sales/Purchase Returns',
      error: `This batch cannot be deleted because it has been used in return transactions (${docSummary}${more}). Historical transaction records cannot be deleted.`,
      references,
      stockInfo,
    };
  }

  // Rule D Check: Active Orders (Orders are not invoices)
  const activeOrders = references.filter(r => {
    if (r.type === 'SALES_ORDER' || r.type === 'PURCHASE_ORDER' || r.type === 'DEALER_ORDER') {
      const s = String(r.status || '').toUpperCase();
      return !['CANCELLED', 'DRAFT', 'CLOSED', 'REJECTED'].includes(s);
    }
    return false;
  });
  if (activeOrders.length > 0) {
    const docSummary = activeOrders.slice(0, 3).map(r => `${r.typeLabel} ${r.documentNumber || r.documentId} (${r.status})`).join(', ');
    const more = activeOrders.length > 3 ? ` and ${activeOrders.length - 3} more` : '';
    return {
      canDelete: false,
      reasonSummary: 'Batch is allocated to active order(s)',
      error: `This batch cannot be deleted because it is allocated to active order workflow(s): ${docSummary}${more}. Cancel or complete the orders before deleting.`,
      references,
      stockInfo,
    };
  }

  // Rule F Check: Active Dealer Transfers
  const activeDealerDocs = references.filter(r => {
    if (r.type === 'DEALER_SHIPMENT' || r.type === 'DEALER_GRN' || r.type === 'DEALER_RETURN') {
      const s = String(r.status || '').toUpperCase();
      return !['CANCELLED', 'REJECTED'].includes(s);
    }
    return false;
  });
  if (activeDealerDocs.length > 0) {
    const docSummary = activeDealerDocs.slice(0, 3).map(r => `${r.typeLabel} ${r.documentNumber || r.documentId} (${r.status})`).join(', ');
    const more = activeDealerDocs.length > 3 ? ` and ${activeDealerDocs.length - 3} more` : '';
    return {
      canDelete: false,
      reasonSummary: 'Batch is referenced by active dealer transfer(s)',
      error: `This batch cannot be deleted because it is referenced in active dealer transfer records: ${docSummary}${more}. Complete or cancel dealer transfers before deleting.`,
      references,
      stockInfo,
    };
  }

  // Rule F Check: Active stock reservations
  if (activeReservationCount > 0 || reservedStock > 0) {
    return {
      canDelete: false,
      reasonSummary: 'Batch has active reservations',
      error: `Cannot delete this batch because it currently has active stock reservations (${activeReservationCount} hold(s), ${reservedStock} pairs reserved). Release or cancel reservations first.`,
      references,
      stockInfo,
    };
  }

  // Rule F Check: Live trading activity in stock ledger
  if (liveTradingLedgerRows.length > 0) {
    const distinctTypes = Array.from(new Set(liveTradingLedgerRows.map((r: any) => r.transaction_type))).join(', ');
    return {
      canDelete: false,
      reasonSummary: 'Batch has live trading history in stock ledger',
      error: `Cannot delete this batch because it contains live transaction history (${distinctTypes}) in the stock ledger. Deactivate the batch instead.`,
      references,
      stockInfo,
    };
  }

  // Rule A: Opening stock alone is NOT a deletion blocker!
  // If the batch only has opening stock or import-session adjustments without posted invoices, orders, or returns,
  // deletion is completely safe and permitted.
  return {
    canDelete: true,
    references: [],
    stockInfo,
  };
}

/**
 * Execute atomic batch deletion within a database transaction.
 * Safely removes exclusively owned batch records:
 * - Cancelled/draft order line batch allocations
 * - Released/cancelled stock reservations
 * - Opening stock and batch-specific stock ledger records
 * - Optical stock balance row
 * - Optical batch master row
 * NEVER creates duplicate stock adjustments or stock receipts.
 */
async function executeDeleteOpticalBatch(
  client: any,
  batchId: string,
  bizId: string,
  batchRecord: any,
  req: Request
) {
  // 1. Clean up cancelled/draft/closed/rejected sales order line allocations
  await client.query(
    `DELETE FROM sales_order_line_batches 
     WHERE batch_id = $1 
       AND sales_order_line_id IN (
         SELECT sol.id FROM sales_order_lines sol
         JOIN sales_orders so ON sol.sales_order_id = so.id
         WHERE so.status IN ('CANCELLED', 'DRAFT', 'CLOSED', 'REJECTED')
       )`,
    [batchId]
  );

  // 2. Clean up cancelled/draft/closed/rejected purchase order line allocations
  await client.query(
    `DELETE FROM purchase_order_line_batches 
     WHERE batch_id = $1 
       AND purchase_order_line_id IN (
         SELECT pol.id FROM purchase_order_lines pol
         JOIN purchase_orders po ON pol.purchase_order_id = po.id
         WHERE po.status IN ('CANCELLED', 'DRAFT', 'CLOSED', 'REJECTED')
       )`,
    [batchId]
  );

  // 2B. Clean up cancelled/rejected dealer return lines
  await client.query(
    `DELETE FROM dealer_return_lines 
     WHERE (main_batch_id = $1 OR dealer_batch_id = $1)
       AND dealer_return_id IN (
         SELECT dr.id FROM dealer_returns dr WHERE dr.status IN ('CANCELLED', 'REJECTED')
       )`,
    [batchId]
  );

  // 2C. Clean up cancelled/rejected dealer shipment lines
  await client.query(
    `DELETE FROM dealer_shipment_lines 
     WHERE main_batch_id = $1
       AND dealer_shipment_id IN (
         SELECT ds.id FROM dealer_shipments ds WHERE ds.status IN ('CANCELLED', 'REJECTED')
       )`,
    [batchId]
  );

  // 2D. Clean up cancelled/rejected dealer goods receipt lines
  await client.query(
    `DELETE FROM dealer_goods_receipt_lines 
     WHERE (main_batch_id = $1 OR dealer_batch_id = $1)
       AND goods_receipt_id IN (
         SELECT dgr.id FROM dealer_goods_receipts dgr WHERE dgr.status IN ('CANCELLED', 'REJECTED')
       )`,
    [batchId]
  );

  // 3. Clean up non-active reservations belonging exclusively to this batch
  await client.query(
    `DELETE FROM stock_reservations WHERE batch_id = $1 AND business_id = $2`,
    [batchId, bizId]
  );

  // 4. Delete opening stock and batch-specific ledger entries
  await client.query(
    `DELETE FROM stock_ledger WHERE batch_id = $1 AND business_id = $2`,
    [batchId, bizId]
  );

  // 5. Delete optical stocks balance row
  await client.query(`DELETE FROM optical_stocks WHERE batch_id = $1`, [batchId]);

  // 6. Delete optical batch master row
  await client.query(
    `DELETE FROM optical_batches WHERE id = $1 AND business_id = $2`,
    [batchId, bizId]
  );

  // 7. Record audit log
  await recordAuditLog({
    businessId: bizId,
    userId: req.user!.id,
    action: 'DELETE',
    module: 'INVENTORY',
    entityType: 'OpticalBatch',
    entityId: batchId,
    previousValue: batchRecord,
    req,
  });
}

router.get('/batches/:id/dependencies', requireAnyPermission(['master:view', 'inventory:view']), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const bizId = req.user!.currentBusinessId;
    const batchRes = await pool.query(
      `SELECT b.id, b.barcode, b.sph, b.cyl, b.axis, b.add, b.side, 
              b.unique_item_id as "uniqueItemId", u.name as "itemName", u.code as "itemCode", u.unit
       FROM optical_batches b
       JOIN unique_items u ON b.unique_item_id = u.id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bizId]
    );
    const safetyCheck = await checkBatchDeletionSafety(id);
    res.json({
      success: true,
      data: {
        ...safetyCheck,
        batch: batchRes.rows[0] || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to check batch dependencies' });
  }
});

router.delete('/batches/:id', requireAnyPermission(['master:delete', 'master.delete', 'master:edit', 'master.edit', 'master:manage', 'inventory:delete', 'inventory:manage']), async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    await client.query('BEGIN');

    // Lock the batch row for update to prevent concurrent duplicate deletion
    const batchRes = await client.query(
      `SELECT b.id, b.barcode, b.sph, b.cyl, b.axis, b.add, b.side, 
              b.unique_item_id as "uniqueItemId", b.identity_key as "identityKey", 
              b.business_id as "businessId", u.name as "itemName", u.code as "itemCode"
       FROM optical_batches b
       JOIN unique_items u ON b.unique_item_id = u.id
       WHERE b.id = $1 AND b.business_id = $2
       FOR UPDATE`,
      [id, bizId]
    );

    if (batchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Optical Batch not found or already deleted.' });
      return;
    }

    const current = batchRes.rows[0];

    // Check safety of batch deletion within the transaction
    const safetyCheck = await checkBatchDeletionSafety(id, client);

    if (!safetyCheck.canDelete) {
      await client.query('ROLLBACK');
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
          itemName: current.itemName,
        },
      });
      return;
    }

    // Safely delete batch and its opening-stock records
    await executeDeleteOpticalBatch(client, id, bizId, current, req);

    await client.query('COMMIT');

    res.json({
      success: true,
      canDelete: true,
      message: `Optical Batch (${current.barcode}, SPH: ${current.sph}, CYL: ${current.cyl}) deleted successfully.`
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || 'Failed to delete optical batch' });
  } finally {
    client.release();
  }
});

router.post('/batches/bulk-delete', requireAnyPermission(['master:delete', 'master.delete', 'master:edit', 'master.edit', 'master:manage', 'inventory:delete', 'inventory:manage']), async (req: Request, res: Response): Promise<void> => {
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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Lock batch row
        const batchRes = await client.query(
          `SELECT b.id, b.barcode, b.sph, b.cyl, b.axis, b.add, b.side, 
                  b.unique_item_id as "uniqueItemId", b.identity_key as "identityKey", 
                  b.business_id as "businessId", u.name as "itemName"
           FROM optical_batches b
           JOIN unique_items u ON b.unique_item_id = u.id
           WHERE b.id = $1 AND b.business_id = $2
           FOR UPDATE`,
          [id, bizId]
        );

        if (batchRes.rows.length === 0) {
          await client.query('ROLLBACK');
          errors.push(`Optical Batch ID ${id} not found or already deleted.`);
          continue;
        }

        const current = batchRes.rows[0];

        const safetyCheck = await checkBatchDeletionSafety(id, client);

        if (!safetyCheck.canDelete) {
          await client.query('ROLLBACK');
          errors.push(`"${current.barcode}" (${current.sph}/${current.cyl}): ${safetyCheck.error}`);
          blockedBatches.push({
            batchId: id,
            barcode: current.barcode,
            sph: current.sph,
            cyl: current.cyl,
            uniqueItemId: current.uniqueItemId,
            itemName: current.itemName,
            reason: safetyCheck.reasonSummary,
            error: safetyCheck.error,
            references: safetyCheck.references,
            stockInfo: safetyCheck.stockInfo,
          });
          continue;
        }

        await executeDeleteOpticalBatch(client, id, bizId, current, req);
        await client.query('COMMIT');
        deletedCount++;
      } catch (itemErr: any) {
        await client.query('ROLLBACK');
        errors.push(`Failed to delete optical batch ${id}: ${itemErr.message}`);
      } finally {
        client.release();
      }
    }

    res.json({
      success: true,
      totalRequested: ids.length,
      deletedCount,
      failedCount: blockedBatches.length + (errors.length - blockedBatches.length),
      errors,
      blockedBatches,
      message: deletedCount === ids.length
        ? `Successfully deleted ${deletedCount} optical batch(es).`
        : `Deleted ${deletedCount} of ${ids.length} optical batch(es). ${blockedBatches.length} item(s) could not be deleted due to safety constraints.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform bulk delete of optical batches' });
  }
});

router.post('/batches/bulk-status', requireAnyPermission(['master:edit', 'master.edit', 'master:manage']), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Please provide an array of Optical Batch IDs.' });
      return;
    }
    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE.' });
      return;
    }
    await db
      .update(opticalBatches)
      .set({
        status,
        updatedAt: new Date(),
        updatedBy: req.user!.id,
      })
      .where(and(inArray(opticalBatches.id, ids), eq(opticalBatches.businessId, bizId)));

    await recordAuditLog({
      businessId: bizId,
      userId: req.user!.id,
      action: status === 'ACTIVE' ? 'ENABLE' : 'DISABLE',
      module: 'INVENTORY',
      entityType: 'OpticalBatch',
      entityId: ids[0],
      newValue: { ids, status, count: ids.length },
      req,
    });

    res.json({
      success: true,
      updatedCount: ids.length,
      status,
      message: `Updated status to ${status} for ${ids.length} optical batch(es).`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update batch status in bulk' });
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
