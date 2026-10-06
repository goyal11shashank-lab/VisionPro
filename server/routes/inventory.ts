import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { StockService } from '../services/stockService.js';
import { z } from 'zod';

const router = Router();

// Authentication required on all inventory routes
router.use(authenticateToken);

/**
 * Validation Schemas
 */
const openingStockSchema = z.object({
  batchId: z.string().uuid('Valid Optical Batch ID is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  date: z.string().optional(),
  reason: z.string().optional(),
});

const reservationSchema = z.object({
  batchId: z.string().uuid('Valid Optical Batch ID is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  notes: z.string().optional(),
});

const updateReservationSchema = z.object({
  quantity: z.number().positive('Quantity must be greater than 0').optional(),
  notes: z.string().optional().nullable(),
  referenceType: z.string().optional().nullable(),
  referenceId: z.string().optional().nullable(),
});

const updateOpeningStockSchema = z.object({
  quantity: z.number().positive('Quantity must be greater than 0'),
  reason: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
});

const convertReservationSchema = z.object({
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/inventory
 * List optical stock items with physical, reserved, and available balance
 */
router.get(
  '/',
  requireAnyPermission(['inventory:view', 'inventory.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { categoryId, uniqueItemId, primaryItemId, stockStatus, search, limit, offset } = req.query;

      const result = await StockService.getInventoryList(businessId, {
        categoryId: categoryId as string,
        uniqueItemId: uniqueItemId as string,
        primaryItemId: primaryItemId as string,
        stockStatus: stockStatus as any,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[GET /api/inventory Error]', err);
      res.status(400).json({ error: 'FETCH_INVENTORY_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/barcode-lookup/:barcode
 * Scans / looks up optical batch specs and real-time stock balances by barcode
 */
router.get(
  '/barcode-lookup/:barcode',
  requireAnyPermission(['inventory:view', 'inventory.view', 'purchase:view', 'purchase:create']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { barcode } = req.params;

      const result = await StockService.lookupByBarcode(businessId, barcode);
      res.json({ success: true, item: result });
    } catch (err: any) {
      res.status(404).json({ error: 'BARCODE_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/batches/:id
 * Detailed optical batch profile with chronological stock ledger and reservations
 */
router.get(
  '/batches/:id',
  requireAnyPermission(['inventory:view', 'inventory.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;

      const result = await StockService.getBatchStockDetail(businessId, id);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(404).json({ error: 'BATCH_STOCK_NOT_FOUND', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/opening-stock
 * Record initial opening stock entry for an optical batch
 */
router.post(
  '/opening-stock',
  requireAnyPermission([
    'inventory:opening_stock',
    'inventory.opening_stock',
    'inventory:create',
    'inventory:edit',
    'master:create',
    'master:edit',
    'master:manage',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const parsed = openingStockSchema.parse(req.body);
      const result = await StockService.recordOpeningStock(businessId, parsed, userId);

      res.status(201).json(result);
    } catch (err: any) {
      console.error('[POST /api/inventory/opening-stock Error]', err);
      res.status(400).json({ error: 'OPENING_STOCK_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/opening-stock/history
 * List opening stock entry logs
 */
router.get(
  '/opening-stock/history',
  requireAnyPermission([
    'inventory:view',
    'inventory.view',
    'inventory:opening_stock',
    'inventory.opening_stock',
    'master:view',
    'master:manage',
    'sales:view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { limit, offset, search, categoryId } = req.query;

      const result = await StockService.getOpeningStockHistory(businessId, {
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
        search: search as string,
        categoryId: categoryId as string,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_OPENING_HISTORY_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/opening-stock/:id
 * Fetch single opening stock entry by ledger ID
 */
router.get(
  '/opening-stock/:id',
  requireAnyPermission([
    'inventory:view',
    'inventory.view',
    'inventory:opening_stock',
    'inventory.opening_stock',
    'master:view',
    'master:manage',
    'sales:view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;

      const result = await StockService.getOpeningStockById(businessId, id);
      if (!result) {
        res.status(404).json({ error: 'OPENING_STOCK_NOT_FOUND', message: 'Opening stock entry not found.' });
        return;
      }

      res.json({ success: true, item: result });
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_OPENING_STOCK_FAILED', message: err.message });
    }
  }
);

/**
 * PATCH /api/inventory/opening-stock/:id
 * Edit opening stock quantity and recalculate ledger
 */
router.patch(
  '/opening-stock/:id',
  requireAnyPermission([
    'inventory:opening_stock',
    'inventory.opening_stock',
    'inventory:edit',
    'inventory:create',
    'master:edit',
    'master:manage',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const parsed = updateOpeningStockSchema.parse(req.body);
      const result = await StockService.updateOpeningStock(
        businessId,
        id,
        {
          quantity: parsed.quantity,
          reason: parsed.reason || undefined,
          date: parsed.date || undefined,
        },
        userId
      );

      res.json({ success: true, item: result, message: 'Opening stock updated successfully.' });
    } catch (err: any) {
      console.error('[PATCH /api/inventory/opening-stock/:id Error]', err);
      res.status(400).json({ error: 'UPDATE_OPENING_STOCK_FAILED', message: err.message });
    }
  }
);

/**
 * DELETE /api/inventory/opening-stock/:id
 * Delete opening stock entry and recalculate ledger
 */
router.delete(
  '/opening-stock/:id',
  requireAnyPermission([
    'inventory:opening_stock',
    'inventory.opening_stock',
    'inventory:delete',
    'inventory:edit',
    'master:delete',
    'master:manage',
    'master:edit',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const result = await StockService.deleteOpeningStock(businessId, id, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[DELETE /api/inventory/opening-stock/:id Error]', err);
      res.status(400).json({ error: 'DELETE_OPENING_STOCK_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/opening-stock/bulk-delete
 * Delete multiple opening stock entries
 */
router.post(
  '/opening-stock/bulk-delete',
  requireAnyPermission([
    'inventory:opening_stock',
    'inventory.opening_stock',
    'inventory:delete',
    'inventory:edit',
    'master:delete',
    'master:manage',
    'master:edit',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { ids } = req.body;

      const result = await StockService.bulkDeleteOpeningStock(businessId, ids, userId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'BULK_DELETE_OPENING_STOCK_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/reservations
 * List active and historical reservations
 */
router.get(
  '/reservations',
  requireAnyPermission([
    'inventory:reservation:view',
    'inventory.reservation.view',
    'inventory:view',
    'inventory.view',
    'sales:view',
    'sales.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { status, batchId, limit, offset } = req.query;

      const result = await StockService.getReservations(businessId, {
        status: status as any,
        batchId: batchId as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_RESERVATIONS_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/reservations/:id
 * View single reservation details
 */
router.get(
  '/reservations/:id',
  requireAnyPermission([
    'inventory:reservation:view',
    'inventory.reservation.view',
    'inventory:view',
    'inventory.view',
    'sales:view',
    'sales.view',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { id } = req.params;

      const result = await StockService.getReservationById(businessId, id);
      if (!result) {
        res.status(404).json({ error: 'RESERVATION_NOT_FOUND', message: 'Stock reservation not found.' });
        return;
      }

      res.json({ success: true, reservation: result });
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_RESERVATION_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/reservations
 * Create a new stock reservation hold
 */
router.post(
  '/reservations',
  requireAnyPermission([
    'inventory:reservation:create',
    'inventory.reservation.create',
    'inventory:create',
    'inventory:edit',
    'sales:create',
    'sales:edit',
    'sales:manage',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const parsed = reservationSchema.parse(req.body);
      const result = await StockService.createReservation(businessId, parsed, userId);

      res.status(201).json(result);
    } catch (err: any) {
      console.error('[POST /api/inventory/reservations Error]', err);
      res.status(400).json({ error: 'CREATE_RESERVATION_FAILED', message: err.message });
    }
  }
);

/**
 * PATCH /api/inventory/reservations/:id
 * Edit stock reservation details (quantity, notes, reference)
 */
router.patch(
  '/reservations/:id',
  requireAnyPermission([
    'inventory:reservation:edit',
    'inventory.reservation.edit',
    'inventory:edit',
    'sales:edit',
    'sales.edit',
    'sales:manage',
    'master:edit',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const parsed = updateReservationSchema.parse(req.body);
      const result = await StockService.updateReservation(
        businessId,
        id,
        {
          quantity: parsed.quantity,
          notes: parsed.notes || undefined,
          referenceType: parsed.referenceType || undefined,
          referenceId: parsed.referenceId || undefined,
        },
        userId
      );

      res.json({ success: true, reservation: result, message: 'Stock reservation updated successfully.' });
    } catch (err: any) {
      console.error('[PATCH /api/inventory/reservations/:id Error]', err);
      res.status(400).json({ error: 'UPDATE_RESERVATION_FAILED', message: err.message });
    }
  }
);

/**
 * DELETE /api/inventory/reservations/:id
 * Delete stock reservation (safely releases hold if ACTIVE)
 */
router.delete(
  '/reservations/:id',
  requireAnyPermission([
    'inventory:reservation:release',
    'inventory.reservation.release',
    'inventory:reservation:cancel',
    'inventory:delete',
    'inventory:edit',
    'sales:delete',
    'sales:edit',
    'sales.delete',
    'sales.edit',
    'master:delete',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const result = await StockService.deleteReservation(businessId, id, userId);
      res.json(result);
    } catch (err: any) {
      console.error('[DELETE /api/inventory/reservations/:id Error]', err);
      res.status(400).json({ error: 'DELETE_RESERVATION_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/reservations/bulk-delete
 * Delete multiple stock reservations
 */
router.post(
  '/reservations/bulk-delete',
  requireAnyPermission([
    'inventory:reservation:release',
    'inventory.reservation.release',
    'inventory:reservation:cancel',
    'inventory:delete',
    'inventory:edit',
    'sales:delete',
    'sales:edit',
    'sales.delete',
    'sales.edit',
    'master:delete',
  ]),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { ids } = req.body;

      const result = await StockService.bulkDeleteReservations(businessId, ids, userId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'BULK_DELETE_RESERVATIONS_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/reservations/:id/release
 * Release an active stock reservation back to available
 */
router.post(
  '/reservations/:id/release',
  requireAnyPermission(['inventory:reservation:release', 'inventory.reservation.release', 'inventory:edit', 'sales:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;
      const { reason } = req.body;

      const result = await StockService.releaseReservation(businessId, id, userId, reason);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'RELEASE_RESERVATION_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/reservations/:id/cancel
 * Cancel an active stock reservation
 */
router.post(
  '/reservations/:id/cancel',
  requireAnyPermission(['inventory:reservation:cancel', 'inventory.reservation.cancel', 'inventory:edit', 'sales:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;
      const { reason } = req.body;

      const result = await StockService.cancelReservation(businessId, id, userId, reason);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'CANCEL_RESERVATION_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/reservations/:id/convert
 * Convert reservation to sales delivery / stock consumption
 */
router.post(
  '/reservations/:id/convert',
  requireAnyPermission(['inventory:reservation:convert', 'inventory.reservation.convert', 'inventory:edit', 'sales:edit']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;
      const { id } = req.params;

      const parsed = convertReservationSchema.parse(req.body);
      const result = await StockService.convertReservation(businessId, id, parsed, userId);

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'CONVERT_RESERVATION_FAILED', message: err.message });
    }
  }
);

export default router;
