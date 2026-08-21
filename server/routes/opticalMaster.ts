import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { db, pool } from '../db/index.js';
import {
  categories, bases, coatings, baseCategories, primaryItems, uniqueItems,
  opticalBatches, opticalStocks, stockLedger, businesses
} from '../db/schema.js';
import { eq, and, desc, sql, ilike, or } from 'drizzle-orm';
import { recordAuditLog } from '../services/auditService.js';
import { findOrCreateOpticalBatch, OpticalPowerInput, validateOpticalPower } from '../services/opticalMasterService.js';
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

router.patch('/categories/:id', requirePermission('master:edit'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Category not found or cannot be modified (global standard)' });
      return;
    }

    const [updated] = await db
      .update(categories)
      .set({
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

router.patch('/coatings/:id', requirePermission('master:edit'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(coatings).where(and(eq(coatings.id, id), eq(coatings.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Coating not found or cannot be modified' });
      return;
    }

    const [updated] = await db
      .update(coatings)
      .set({
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

router.patch('/bases/:id', requirePermission('master:edit'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(bases).where(and(eq(bases.id, id), eq(bases.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Base not found or cannot be modified' });
      return;
    }

    const [updated] = await db
      .update(bases)
      .set({
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

router.patch('/primary-items/:id', requirePermission('master:edit'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(primaryItems).where(and(eq(primaryItems.id, id), eq(primaryItems.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Primary Item not found' });
      return;
    }

    const [updated] = await db
      .update(primaryItems)
      .set({
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

// ==========================================
// 5. UNIQUE ITEMS CRUD
// ==========================================

const uniqueItemSchema = z.object({
  primaryItemId: z.string().uuid('Primary Item is required'),
  name: z.string().min(1, 'Unique item name is required'),
  code: z.string().min(1, 'Unique item code is required').toUpperCase(),
  description: z.string().optional().nullable(),
  purchaseRate: z.union([z.number(), z.string()]).default(0),
  lastPurchasePrice: z.union([z.number(), z.string()]).default(0),
  mrp: z.union([z.number(), z.string()]).default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

router.get('/unique-items', requirePermission('master:view'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { primaryItemId, search } = req.query;

    const rows = await db
      .select({
        id: uniqueItems.id,
        name: uniqueItems.name,
        code: uniqueItems.code,
        description: uniqueItems.description,
        purchaseRate: uniqueItems.purchaseRate,
        lastPurchasePrice: uniqueItems.lastPurchasePrice,
        mrp: uniqueItems.mrp,
        status: uniqueItems.status,
        createdAt: uniqueItems.createdAt,
        updatedAt: uniqueItems.updatedAt,
        primaryItemId: uniqueItems.primaryItemId,
        primaryItemName: primaryItems.name,
        primaryItemCode: primaryItems.code,
        categoryId: primaryItems.categoryId,
        categoryName: categories.name,
        categoryCode: categories.code,
        baseName: bases.name,
        baseCode: bases.code,
      })
      .from(uniqueItems)
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(primaryItems.categoryId, categories.id))
      .innerJoin(bases, eq(primaryItems.baseId, bases.id))
      .where(eq(uniqueItems.businessId, bizId))
      .orderBy(desc(uniqueItems.createdAt));

    let filtered = rows;
    if (primaryItemId) filtered = filtered.filter(r => r.primaryItemId === primaryItemId);
    if (search && typeof search === 'string') {
      const s = search.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.primaryItemName.toLowerCase().includes(s));
    }

    res.json({ success: true, uniqueItems: filtered });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch unique items' });
  }
});

router.post('/unique-items', requirePermission('master:create'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const parsed = uniqueItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid unique item data' });
      return;
    }

    const { primaryItemId, name, code, description, purchaseRate, lastPurchasePrice, mrp, status } = parsed.data;

    const existing = await db
      .select()
      .from(uniqueItems)
      .where(and(eq(uniqueItems.businessId, bizId), eq(uniqueItems.code, code)))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: `Unique Item with code "${code}" already exists.` });
      return;
    }

    const [created] = await db
      .insert(uniqueItems)
      .values({
        businessId: bizId,
        primaryItemId,
        name,
        code,
        description,
        purchaseRate: String(purchaseRate),
        lastPurchasePrice: String(lastPurchasePrice),
        mrp: String(mrp),
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

    res.status(201).json({ success: true, uniqueItem: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create unique item' });
  }
});

router.patch('/unique-items/:id', requirePermission('master:edit'), async (req: Request, res: Response): Promise<void> => {
  try {
    const bizId = req.user!.currentBusinessId;
    const { id } = req.params;

    const [current] = await db.select().from(uniqueItems).where(and(eq(uniqueItems.id, id), eq(uniqueItems.businessId, bizId))).limit(1);
    if (!current) {
      res.status(404).json({ error: 'Unique Item not found' });
      return;
    }

    const [updated] = await db
      .update(uniqueItems)
      .set({
        name: req.body.name ?? current.name,
        description: req.body.description ?? current.description,
        purchaseRate: req.body.purchaseRate !== undefined ? String(req.body.purchaseRate) : current.purchaseRate,
        lastPurchasePrice: req.body.lastPurchasePrice !== undefined ? String(req.body.lastPurchasePrice) : current.lastPurchasePrice,
        mrp: req.body.mrp !== undefined ? String(req.body.mrp) : current.mrp,
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

    res.json({ success: true, uniqueItem: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update unique item' });
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
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
      .innerJoin(categories, eq(opticalBatches.categoryId, categories.id))
      .leftJoin(opticalStocks, eq(opticalBatches.id, opticalStocks.batchId))
      .where(eq(opticalBatches.businessId, bizId))
      .orderBy(desc(opticalBatches.createdAt));

    let filtered = rows;
    if (uniqueItemId) filtered = filtered.filter(r => r.uniqueItemId === uniqueItemId);
    if (categoryId) filtered = filtered.filter(r => r.categoryId === categoryId);
    if (barcode && typeof barcode === 'string') filtered = filtered.filter(r => r.barcode.toLowerCase() === barcode.toLowerCase());
    if (search && typeof search === 'string') {
      const s = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.barcode.toLowerCase().includes(s) ||
        r.uniqueItemName.toLowerCase().includes(s) ||
        r.uniqueItemCode.toLowerCase().includes(s) ||
        r.identityKey.toLowerCase().includes(s)
      );
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
      .innerJoin(primaryItems, eq(uniqueItems.primaryItemId, primaryItems.id))
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
router.post('/batches/find-or-create', requirePermission('master:create'), async (req: Request, res: Response): Promise<void> => {
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
    res.status(400).json({ error: error.message || 'Failed to find or create optical batch' });
  }
});

router.patch('/batches/:id/status', requirePermission('master:edit'), async (req: Request, res: Response): Promise<void> => {
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
