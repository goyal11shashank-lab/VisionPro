import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { SearchService } from '../services/searchService.js';

const router = Router();

/**
 * GET /api/search?q=...
 * Global search across Batches/Barcodes, Documents, Parties, and Products.
 * Prioritizes exact barcode matches first.
 * Respects business isolation and user permissions.
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.currentBusinessId;
    const query = String(req.query.q || '').trim();
    const userPermissions = (req.user as any)?.permissions || [];
    const isSuperAdmin = Boolean((req.user as any)?.role?.isSuperAdmin || (req.user as any)?.role?.code === 'SUPER_ADMIN');

    if (!query) {
      res.json({
        success: true,
        query: '',
        barcodes: [],
        documents: [],
        parties: [],
        products: [],
      });
      return;
    }

    const results = await SearchService.search(
      businessId,
      query,
      userPermissions,
      isSuperAdmin
    );

    res.json({
      success: true,
      query,
      ...results,
    });
  } catch (err: any) {
    console.error('[Search Error]', err);
    res.status(500).json({
      error: 'SEARCH_ERROR',
      message: err.message || 'Global search failed',
    });
  }
});

export default router;
