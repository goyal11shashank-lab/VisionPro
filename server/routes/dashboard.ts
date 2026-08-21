import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { DashboardService } from '../services/dashboardService.js';
import { BusinessSettingsService } from '../services/businessSettingsService.js';

const router = Router();

/**
 * GET /api/dashboard/summary
 * Returns live, real-time PostgreSQL operational dashboard metrics scoped to authenticated business.
 */
router.get(
  '/summary',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const userPermissions = (req.user as any)?.permissions || [];
      const isSuperAdmin = Boolean((req.user as any)?.role?.isSuperAdmin || (req.user as any)?.role?.code === 'SUPER_ADMIN');

      const data = await DashboardService.getDashboardData(
        businessId,
        userPermissions,
        isSuperAdmin
      );

      // Backwards-compatible structure + rich Phase 8 analytics
      res.json({
        success: true,
        businessId,
        currency: req.user?.currentBusiness?.currency || 'INR',
        // Legacy metric object format for backwards compatibility
        metrics: {
          todaysSales: {
            amount: data.todaysSales.net,
            grossAmount: data.todaysSales.gross,
            count: data.todaysSales.count,
            returnsCount: data.todaysSales.returnsCount,
            returnsAmount: data.todaysSales.returnsAmount,
            netAfterReturns: data.todaysSales.netAfterReturns,
            currency: req.user?.currentBusiness?.currency || 'INR',
            isActualData: true,
          },
          todaysPurchases: {
            amount: data.todaysPurchases.net,
            grossAmount: data.todaysPurchases.gross,
            count: data.todaysPurchases.count,
            returnsCount: data.todaysPurchases.returnsCount,
            returnsAmount: data.todaysPurchases.returnsAmount,
            netAfterReturns: data.todaysPurchases.netAfterReturns,
            currency: req.user?.currentBusiness?.currency || 'INR',
            isActualData: true,
          },
          receivables: {
            amount: data.outstandingSummary.totalReceivables,
            overdue: data.outstandingSummary.customerOverdue,
            current: data.outstandingSummary.customerCurrent,
            currency: req.user?.currentBusiness?.currency || 'INR',
            isActualData: true,
          },
          payables: {
            amount: data.outstandingSummary.totalPayables,
            overdue: data.outstandingSummary.supplierOverdue,
            current: data.outstandingSummary.supplierCurrent,
            currency: req.user?.currentBusiness?.currency || 'INR',
            isActualData: true,
          },
          totalStock: {
            quantity: data.stockKPIs.totalPhysicalStock,
            reservedQuantity: data.stockKPIs.totalReservedStock,
            availableQuantity: data.stockKPIs.totalAvailableStock,
            unit: 'prs',
            batchCount: data.stockKPIs.totalBatches,
            inStockCount: data.stockKPIs.inStockBatches,
            zeroStockCount: data.stockKPIs.zeroStockBatches,
            negativeStockCount: data.stockKPIs.negativeStockBatches,
            isActualData: true,
          },
          reservedStock: {
            quantity: data.stockKPIs.totalReservedStock,
            unit: 'prs',
            orderCount: data.stockKPIs.reservedBatches,
            isActualData: true,
          },
          lowStock: {
            itemsCount: data.stockKPIs.lowStockBatches,
            threshold: data.stockKPIs.lowStockThreshold,
            isActualData: true,
          },
        },
        // Phase 8 Comprehensive Sections
        stockKPIs: data.stockKPIs,
        stockByCategory: data.stockByCategory,
        todaysSales: data.todaysSales,
        todaysPurchases: data.todaysPurchases,
        todaysReceipts: data.todaysReceipts,
        todaysSupplierPayments: data.todaysSupplierPayments,
        outstandingSummary: data.outstandingSummary,
        salesSummary: data.salesSummary,
        purchaseSummary: data.purchaseSummary,
        topSellingProducts: data.topSellingProducts,
        topPurchasedProducts: data.topPurchasedProducts,
        topCustomers: data.topCustomers,
        topSuppliers: data.topSuppliers,
        alerts: data.alerts,
        recentTransactions: data.recentTransactions,
        permissions: data.permissions,
      });
    } catch (err: any) {
      console.error('[Dashboard Error]', err);
      res.status(500).json({
        error: 'DASHBOARD_ERROR',
        message: err.message || 'Failed to fetch dashboard metrics',
      });
    }
  }
);

/**
 * GET /api/dashboard/settings
 * Read current business settings (e.g. low stock threshold).
 */
router.get(
  '/settings',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const settings = await BusinessSettingsService.getSettings(businessId);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: 'SETTINGS_ERROR', message: err.message });
    }
  }
);

/**
 * PUT /api/dashboard/settings
 * Update business operational settings (e.g. low stock threshold).
 */
router.put(
  '/settings',
  authenticateToken,
  requireAnyPermission(['admin:manage_settings', 'admin.manage_settings']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const { lowStockThreshold, config } = req.body;
      const updated = await BusinessSettingsService.updateSettings(businessId, {
        lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
        config,
      });
      res.json({ success: true, settings: updated });
    } catch (err: any) {
      res.status(500).json({ error: 'SETTINGS_UPDATE_ERROR', message: err.message });
    }
  }
);

export default router;
