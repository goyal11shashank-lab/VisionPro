import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { ReportService } from '../services/reportService.js';
import { ExportService } from '../services/exportService.js';

const router = Router();

// Helper to stream XLSX buffer as response
function sendXlsx(res: Response, fileName: string, buffer: Buffer) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

/**
 * 1. INVENTORY STOCK REPORT
 * GET /api/reports/inventory
 */
router.get(
  '/inventory',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.inventory.view',
    'reports:inventory',
    'inventory:view',
    'inventory.view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'INVENTORY',
          {
            stockStatus: req.query.stockStatus as string,
            categoryId: req.query.categoryId as string,
            uniqueItemId: req.query.uniqueItemId as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getInventoryReport(businessId, {
        stockStatus: req.query.stockStatus as any,
        categoryId: req.query.categoryId as string,
        categoryCode: req.query.categoryCode as string,
        uniqueItemId: req.query.uniqueItemId as string,
        brand: req.query.brand as string,
        search: req.query.search as string,
        sph: req.query.sph !== undefined ? Number(req.query.sph) : undefined,
        cyl: req.query.cyl !== undefined ? Number(req.query.cyl) : undefined,
        axis: req.query.axis !== undefined ? Number(req.query.axis) : undefined,
        add: req.query.add !== undefined ? Number(req.query.add) : undefined,
        side: req.query.side as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Inventory Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 2. STOCK LEDGER REPORT
 * GET /api/reports/stock-ledger
 */
router.get(
  '/stock-ledger',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.stock_ledger.view',
    'reports:stock_ledger',
    'inventory:view',
    'inventory.view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'STOCK_LEDGER',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getStockLedgerReport(businessId, {
        batchId: req.query.batchId as string,
        barcode: req.query.barcode as string,
        uniqueItemId: req.query.uniqueItemId as string,
        transactionType: req.query.transactionType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Stock Ledger Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 3. PURCHASE REGISTER REPORT
 * GET /api/reports/purchases
 */
router.get(
  '/purchases',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.purchase.view',
    'reports:purchase',
    'purchase:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'PURCHASE_INVOICES',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
            status: req.query.status as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getPurchaseReport(businessId, {
        partyId: req.query.partyId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        status: req.query.status as string,
        paymentStatus: req.query.paymentStatus as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Purchase Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 4. PURCHASE DETAIL (DRILL-DOWN) REPORT
 * GET /api/reports/purchases/details
 */
router.get(
  '/purchases/details',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.purchase.view',
    'reports:purchase',
    'purchase:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'PURCHASE_DETAILS',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getPurchaseDetailReport(businessId, {
        partyId: req.query.partyId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        status: req.query.status as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Purchase Details Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 5. PURCHASE RETURN REPORT
 * GET /api/reports/purchases/returns
 */
router.get(
  '/purchases/returns',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.purchase.view',
    'reports:purchase',
    'purchase:return:view',
    'purchase.return.view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'PURCHASE_RETURNS',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getPurchaseReturnReport(businessId, {
        partyId: req.query.partyId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        status: req.query.status as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Purchase Returns Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 6. SALES REGISTER REPORT
 * GET /api/reports/sales
 */
router.get(
  '/sales',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.sales.view',
    'reports:sales',
    'sales:view',
    'sales.view',
    'sales.invoice.view',
    'sales:invoice:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'SALES_INVOICES',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
            status: req.query.status as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getSalesReport(businessId, {
        partyId: req.query.partyId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        status: req.query.status as string,
        paymentStatus: req.query.paymentStatus as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Sales Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 7. SALES DETAIL (DRILL-DOWN) REPORT
 * GET /api/reports/sales/details
 */
router.get(
  '/sales/details',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.sales.view',
    'reports:sales',
    'sales:view',
    'sales.view',
    'sales.invoice.view',
    'sales:invoice:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'SALES_DETAILS',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getSalesDetailReport(businessId, {
        partyId: req.query.partyId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        status: req.query.status as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Sales Details Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 8. SALES RETURN REPORT
 * GET /api/reports/sales/returns
 */
router.get(
  '/sales/returns',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.sales.view',
    'reports:sales',
    'sales:return:view',
    'sales.return.view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'SALES_RETURNS',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getSalesReturnReport(businessId, {
        partyId: req.query.partyId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        status: req.query.status as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Sales Returns Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 9. CUSTOMER OUTSTANDING REPORT
 * GET /api/reports/outstanding/customers
 */
router.get(
  '/outstanding/customers',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.outstanding.view',
    'reports:outstanding',
    'accounts:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'CUSTOMER_OUTSTANDING'
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getOutstandingReport(
        businessId,
        'CUSTOMER',
        {
          search: req.query.search as string,
          page: req.query.page ? Number(req.query.page) : 1,
          limit: req.query.limit ? Number(req.query.limit) : 50,
        }
      );

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Customer Outstanding Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 10. SUPPLIER OUTSTANDING REPORT
 * GET /api/reports/outstanding/suppliers
 */
router.get(
  '/outstanding/suppliers',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.outstanding.view',
    'reports:outstanding',
    'accounts:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'SUPPLIER_OUTSTANDING'
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getOutstandingReport(
        businessId,
        'SUPPLIER',
        {
          search: req.query.search as string,
          page: req.query.page ? Number(req.query.page) : 1,
          limit: req.query.limit ? Number(req.query.limit) : 50,
        }
      );

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Supplier Outstanding Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 11. PARTY STATEMENT REPORT (Live Running Ledger)
 * GET /api/reports/party-statement/:partyId
 */
router.get(
  '/party-statement/:partyId',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.party_statement.view',
    'reports:party_statement',
    'accounts:view',
    'parties:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const partyId = req.params.partyId;
      const partyType = ((req.query.partyType as string) || 'CUSTOMER').toUpperCase() as 'CUSTOMER' | 'SUPPLIER';
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'PARTY_STATEMENT',
          {
            partyId,
            partyType,
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getPartyStatement(
        businessId,
        partyId,
        partyType,
        req.query.startDate as string,
        req.query.endDate as string
      );

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Party Statement Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 12. PAYMENTS & RECEIPTS REPORT
 * GET /api/reports/payments
 */
router.get(
  '/payments',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.payment.view',
    'reports:payment',
    'accounts:view',
    'payment.receipt.view',
    'payment:receipt:view',
    'payment.supplier.view',
    'payment:supplier:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'PAYMENTS',
          {
            paymentType: req.query.paymentType as string,
            paymentMode: req.query.paymentMode as string,
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getPaymentReport(businessId, {
        paymentType: req.query.paymentType as string,
        paymentMode: req.query.paymentMode as string,
        partyId: req.query.partyId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        status: req.query.status as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Payment Report Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 13. PRODUCT SALES ANALYTICS REPORT
 * GET /api/reports/analytics/product-sales
 */
router.get(
  '/analytics/product-sales',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.sales.view',
    'reports:sales',
    'sales:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'PRODUCT_SALES',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getProductSalesReport(businessId, {
        categoryId: req.query.categoryId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Product Sales Analytics Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

/**
 * 14. OPTICAL POWER SALES ANALYTICS REPORT
 * GET /api/reports/analytics/power-sales
 */
router.get(
  '/analytics/power-sales',
  authenticateToken,
  requireAnyPermission([
    'reports:view',
    'report.sales.view',
    'reports:sales',
    'sales:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const businessId = req.user!.currentBusinessId;
      const isExport = req.query.export === 'true';

      if (isExport) {
        const { fileName, buffer } = await ExportService.exportDataset(
          businessId,
          'POWER_SALES',
          {
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
          }
        );
        sendXlsx(res, fileName, buffer);
        return;
      }

      const report = await ReportService.getOpticalPowerSalesReport(businessId, {
        uniqueItemId: req.query.uniqueItemId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });

      res.json({ success: true, ...report });
    } catch (err: any) {
      console.error('[Optical Power Sales Analytics Error]', err);
      res.status(500).json({ error: 'REPORT_ERROR', message: err.message });
    }
  }
);

export default router;
