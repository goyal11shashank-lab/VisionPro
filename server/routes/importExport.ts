import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db, pool } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';
import { importSessions } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission } from '../middleware/permission.js';
import { ExcelTemplateService, ImportType, TEMPLATE_DEFINITIONS } from '../services/excelTemplateService.js';
import { ColumnMappingService, FIELD_DEFINITIONS } from '../services/columnMappingService.js';
import { ImportValidationService } from '../services/importValidationService.js';
import { ImportPostingService } from '../services/importPostingService.js';
import { ExportService, ExportDatasetType } from '../services/exportService.js';

const router = Router();

// Configure multer for memory storage (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];
    if (
      allowed.includes(file.mimetype) ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls') ||
      file.originalname.endsWith('.csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx, .xls, and .csv files are supported.'));
    }
  },
});

// Helper for type permissions
function getImportPermission(type: ImportType): string {
  switch (type) {
    case 'PARTY':
      return 'import.party';
    case 'PURCHASE':
      return 'import.purchase';
    case 'SALES_ORDER':
      return 'import.sales_order';
    case 'SALES_INVOICE':
      return 'import.sales_invoice';
    case 'OPENING_STOCK':
      return 'import.opening_stock';
    default:
      return 'import.view';
  }
}

/**
 * 1. Download Template XLSX
 * GET /api/imports/templates/:type
 */
router.get(
  '/templates/:type',
  authenticateToken,
  requireAnyPermission(['import.view', 'import:view']),
  async (req: Request, res: Response) => {
    try {
      const type = (req.params.type || '').toUpperCase() as ImportType;
      const def = TEMPLATE_DEFINITIONS[type];
      if (!def) {
        return res.status(400).json({ error: `Invalid import type "${req.params.type}". Supported types: PARTY, PURCHASE, SALES_ORDER, SALES_INVOICE, OPENING_STOCK` });
      }

      const buffer = ExcelTemplateService.generateTemplateWorkbook(type);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${def.fileName}"`);
      return res.send(buffer);
    } catch (err: any) {
      console.error('[Template Download Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to generate template' });
    }
  }
);

/**
 * 2. Get Available Columns and Definitions for an Import Type
 * GET /api/imports/definitions/:type
 */
router.get(
  '/definitions/:type',
  authenticateToken,
  requireAnyPermission(['import.view', 'import:view']),
  async (req: Request, res: Response) => {
    try {
      const type = (req.params.type || '').toUpperCase() as ImportType;
      const fields = FIELD_DEFINITIONS[type];
      if (!fields) {
        return res.status(400).json({ error: `Invalid import type "${req.params.type}".` });
      }
      return res.json({
        importType: type,
        fields,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * 3. Upload File, Parse, Auto-Detect Mapping, and Run Validation
 * POST /api/imports/upload
 */
router.post(
  '/upload',
  authenticateToken,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
      const userId = req.user?.id;

      if (!businessId) {
        return res.status(400).json({ error: 'Business context required.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Please provide an Excel (.xlsx/.xls) or CSV file.' });
      }

      const importType = (req.body.importType || '').toUpperCase() as ImportType;
      if (!TEMPLATE_DEFINITIONS[importType]) {
        return res.status(400).json({ error: `Invalid importType "${importType}". Allowed: PARTY, PURCHASE, SALES_ORDER, SALES_INVOICE, OPENING_STOCK` });
      }

      // Read spreadsheet buffer
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) {
        return res.status(400).json({ error: 'Spreadsheet contains no worksheets.' });
      }

      const ws = wb.Sheets[firstSheetName];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        return res.status(400).json({ error: 'Uploaded sheet contains no data rows.' });
      }

      // Extract detected header keys
      const detectedHeaders = Object.keys(rawRows[0] || {});

      // Auto-detect column mapping or use provided override
      let columnMapping: Record<string, string> = {};
      if (req.body.columnMapping) {
        try {
          columnMapping = typeof req.body.columnMapping === 'string' ? JSON.parse(req.body.columnMapping) : req.body.columnMapping;
        } catch {
          columnMapping = {};
        }
      }

      const mappingDetection = ColumnMappingService.detectMapping(importType, detectedHeaders);
      if (Object.keys(columnMapping).length === 0) {
        columnMapping = mappingDetection.columnMapping;
      }

      // Run deep validation
      const validation = await ImportValidationService.validateImportData(
        businessId,
        importType,
        rawRows,
        columnMapping
      );

      // Create import session in database
      const [session] = await db
        .insert(importSessions)
        .values({
          businessId,
          importType,
          fileName: req.file.originalname,
          fileSize: String(req.file.size),
          status: 'READY',
          totalRows: String(validation.totalRows),
          validRows: String(validation.validRows),
          invalidRows: String(validation.invalidRows),
          duplicateRows: String(validation.duplicateRows),
          postedRows: '0',
          failedRows: '0',
          columnMapping,
          previewData: validation,
          errorSummary: validation.errorSummary,
          createdBy: userId,
        })
        .returning();

      return res.json({
        sessionId: session.id,
        fileName: req.file.originalname,
        importType,
        totalRows: validation.totalRows,
        validRows: validation.validRows,
        invalidRows: validation.invalidRows,
        duplicateRows: validation.duplicateRows,
        columnMapping,
        detectedHeaders,
        missingRequired: mappingDetection.missingRequired,
        unmappedHeaders: mappingDetection.unmappedSpreadsheetHeaders,
        preview: validation,
      });
    } catch (err: any) {
      console.error('[Import Upload Error]', err);
      return res.status(500).json({ error: err.message || 'File processing failed' });
    }
  }
);

/**
 * 4. Revalidate Session with Custom Mapping
 * POST /api/imports/:sessionId/revalidate
 */
router.post(
  '/:sessionId/revalidate',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
      const { sessionId } = req.params;
      const { columnMapping } = req.body;

      if (!businessId) return res.status(400).json({ error: 'Business context required.' });

      const [session] = await db
        .select()
        .from(importSessions)
        .where(eq(importSessions.id, sessionId))
        .limit(1);

      if (!session || session.businessId !== businessId) {
        return res.status(404).json({ error: 'Import session not found.' });
      }

      const prevPreview = session.previewData as any;
      const rawRows = (prevPreview?.rows || []).map((r: any) => r.raw);

      const validation = await ImportValidationService.validateImportData(
        businessId,
        session.importType as ImportType,
        rawRows,
        columnMapping || (session.columnMapping as any)
      );

      await db
        .update(importSessions)
        .set({
          columnMapping: columnMapping || session.columnMapping,
          previewData: validation,
          errorSummary: validation.errorSummary,
          validRows: String(validation.validRows),
          invalidRows: String(validation.invalidRows),
          duplicateRows: String(validation.duplicateRows),
        })
        .where(eq(importSessions.id, sessionId));

      return res.json({
        sessionId: session.id,
        validation,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * 5. Retrieve Preview Data for Session
 * GET /api/imports/:sessionId/preview
 */
router.get(
  '/:sessionId/preview',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
      const { sessionId } = req.params;

      const [session] = await db
        .select()
        .from(importSessions)
        .where(eq(importSessions.id, sessionId))
        .limit(1);

      if (!session || session.businessId !== businessId) {
        return res.status(404).json({ error: 'Import session not found.' });
      }

      return res.json({
        session: {
          id: session.id,
          fileName: session.fileName,
          fileSize: session.fileSize,
          importType: session.importType,
          status: session.status,
          totalRows: Number(session.totalRows),
          validRows: Number(session.validRows),
          invalidRows: Number(session.invalidRows),
          duplicateRows: Number(session.duplicateRows),
          postedRows: Number(session.postedRows),
          failedRows: Number(session.failedRows),
          columnMapping: session.columnMapping,
          createdAt: session.createdAt,
          completedAt: session.completedAt,
        },
        preview: session.previewData,
        errorSummary: session.errorSummary,
        postedDocumentIds: session.postedDocumentIds,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * 6. Execute Transactional Post
 * POST /api/imports/:sessionId/post
 */
router.post(
  '/:sessionId/post',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
      const userId = req.user?.id;
      const { sessionId } = req.params;

      if (!businessId) return res.status(400).json({ error: 'Business context required.' });

      const result = await ImportPostingService.postImportSession(businessId, sessionId, userId);
      return res.json(result);
    } catch (err: any) {
      console.error('[Import Post Error]', err);
      return res.status(500).json({ error: err.message || 'Import posting failed' });
    }
  }
);

/**
 * 7. Download Error Report XLSX
 * GET /api/imports/:sessionId/errors/xlsx
 */
router.get(
  '/:sessionId/errors/xlsx',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
      const { sessionId } = req.params;

      const [session] = await db
        .select()
        .from(importSessions)
        .where(eq(importSessions.id, sessionId))
        .limit(1);

      if (!session || session.businessId !== businessId) {
        return res.status(404).json({ error: 'Import session not found.' });
      }

      const errors = (session.errorSummary as any[]) || [];
      const buffer = ExcelTemplateService.generateErrorReportWorkbook(
        session.fileName,
        session.importType,
        errors
      );

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Error_Report_${session.importType}_${session.fileName}.xlsx"`);
      return res.send(buffer);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to generate error report' });
    }
  }
);

/**
 * 8. List Import History
 * GET /api/imports/history
 */
router.get(
  '/history',
  authenticateToken,
  requireAnyPermission(['import.view', 'import:view']),
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
      if (!businessId) return res.status(400).json({ error: 'Business context required.' });

      const history = await db
        .select({
          id: importSessions.id,
          importType: importSessions.importType,
          fileName: importSessions.fileName,
          fileSize: importSessions.fileSize,
          status: importSessions.status,
          totalRows: importSessions.totalRows,
          validRows: importSessions.validRows,
          invalidRows: importSessions.invalidRows,
          duplicateRows: importSessions.duplicateRows,
          postedRows: importSessions.postedRows,
          failedRows: importSessions.failedRows,
          createdAt: importSessions.createdAt,
          completedAt: importSessions.completedAt,
        })
        .from(importSessions)
        .where(eq(importSessions.businessId, businessId))
        .orderBy(desc(importSessions.createdAt))
        .limit(50);

      return res.json({ items: history });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * 9. Export Operational Datasets (Parties, Batches, Inventory, Ledger, etc.)
 * POST /api/exports/:type
 */
router.post(
  '/export/:type',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const businessId = req.user?.currentBusinessId || (req.headers['x-business-id'] as string);
      if (!businessId) return res.status(400).json({ error: 'Business context required.' });

      const datasetType = (req.params.type || '').toUpperCase() as ExportDatasetType;
      const filters = req.body || {};

      const { fileName, buffer, rowCount } = await ExportService.exportDataset(
        businessId,
        datasetType,
        filters
      );

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('X-Total-Rows', String(rowCount));
      return res.send(buffer);
    } catch (err: any) {
      console.error('[Export Error]', err);
      return res.status(500).json({ error: err.message || 'Export failed' });
    }
  }
);

export default router;

