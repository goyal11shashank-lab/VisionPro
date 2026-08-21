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

const stockAdjustmentSchema = z.object({
  batchId: z.string().uuid('Valid Optical Batch ID is required'),
  adjustmentType: z.enum(['INCREASE', 'DECREASE']),
  quantity: z.number().positive('Quantity must be greater than 0'),
  reason: z.string().min(1, 'Adjustment reason is required'),
  remarks: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
});

const reservationSchema = z.object({
  batchId: z.string().uuid('Valid Optical Batch ID is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  notes: z.string().optional(),
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
  requireAnyPermission(['inventory:opening_stock', 'inventory.opening_stock', 'inventory:create', 'inventory:edit', 'inventory:adjust', 'inventory.adjust', 'inventory:adjust_stock']),
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
  requireAnyPermission(['inventory:view', 'inventory.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { limit, offset } = req.query;

      const result = await StockService.getOpeningStockHistory(businessId, {
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_OPENING_HISTORY_FAILED', message: err.message });
    }
  }
);

/**
 * POST /api/inventory/adjustments
 * Perform manual stock adjustment (INCREASE / DECREASE)
 */
router.post(
  '/adjustments',
  requireAnyPermission(['inventory:adjust', 'inventory.adjust', 'inventory:adjust_stock']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userId = req.user!.id;

      const parsed = stockAdjustmentSchema.parse(req.body);
      const result = await StockService.adjustStock(businessId, parsed, userId);

      res.status(201).json(result);
    } catch (err: any) {
      console.error('[POST /api/inventory/adjustments Error]', err);
      res.status(400).json({ error: 'STOCK_ADJUSTMENT_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/adjustments/history
 * List stock adjustments history
 */
router.get(
  '/adjustments/history',
  requireAnyPermission(['inventory:view', 'inventory.view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { limit, offset } = req.query;

      const result = await StockService.getAdjustmentHistory(businessId, {
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: 'FETCH_ADJUSTMENT_HISTORY_FAILED', message: err.message });
    }
  }
);

/**
 * GET /api/inventory/reservations
 * List active and historical reservations
 */
router.get(
  '/reservations',
  requireAnyPermission(['inventory:reservation:view', 'inventory.reservation.view', 'inventory:view', 'inventory.view']),
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
 * POST /api/inventory/reservations
 * Create a new stock reservation hold
 */
router.post(
  '/reservations',
  requireAnyPermission(['inventory:reservation:create', 'inventory.reservation.create', 'inventory:adjust', 'inventory.adjust', 'inventory:adjust_stock']),
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
 * POST /api/inventory/reservations/:id/release
 * Release an active stock reservation back to available
 */
router.post(
  '/reservations/:id/release',
  requireAnyPermission(['inventory:reservation:release', 'inventory.reservation.release', 'inventory:adjust', 'inventory.adjust', 'inventory:adjust_stock']),
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
  requireAnyPermission(['inventory:reservation:cancel', 'inventory.reservation.cancel', 'inventory:adjust', 'inventory.adjust', 'inventory:adjust_stock']),
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
  requireAnyPermission(['inventory:reservation:convert', 'inventory.reservation.convert', 'inventory:adjust', 'inventory.adjust', 'inventory:adjust_stock']),
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
