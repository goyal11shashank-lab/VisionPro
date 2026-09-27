import { Router, Request, Response } from 'express';
import { db, pool } from '../db/index.js';
import { businesses, parties, dealerOrders, salesOrders, uniqueItems } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { eq, and, desc } from 'drizzle-orm';
import { scoreCandidate, SearchCandidate } from '../utils/searchNormalization.js';
import { SalesService } from '../services/salesService.js';
import { StockService } from '../services/stockService.js';
import { BusinessSettingsService } from '../services/businessSettingsService.js';
import { recordAuditLog } from '../services/auditService.js';
import { round2 } from '../services/taxCalculationService.js';
import { DealerLogisticsService } from '../services/dealerLogisticsService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { DealerDashboardService } from '../services/dealerDashboardService.js';
import { DealerReturnService } from '../services/dealerReturnService.js';
import { DealerPaymentService } from '../services/dealerPaymentService.js';
import { DealerOnboardingService } from '../services/dealerOnboardingService.js';

const router = Router();

// Authentication required on all dealer routes
router.use(authenticateToken);

/**
 * Helper: Resolve and verify Main Warehouse for the calling business context
 */
async function resolveMainWarehouseContext(req: Request): Promise<{
  dealerBusiness: any;
  mainWarehouse: any;
} | { error: string; status: number }> {
  const currentBizId = req.user!.currentBusinessId;

  const [biz] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, currentBizId))
    .limit(1);

  if (!biz) {
    return { error: 'Current business entity could not be found.', status: 404 };
  }

  let mainWarehouseId = biz.parentBusinessId;

  // If Super Admin is previewing and current business is not a dealer, allow passing ?mainWarehouseId or default to first MAIN business
  if ((!mainWarehouseId || biz.businessType !== 'DEALER') && req.user?.isSuperAdmin) {
    const queryMainId = req.query.mainWarehouseId as string;
    if (queryMainId) {
      mainWarehouseId = queryMainId;
    } else {
      const [firstMain] = await db
        .select()
        .from(businesses)
        .where(and(eq(businesses.businessType, 'MAIN'), eq(businesses.status, 'ACTIVE')))
        .limit(1);
      if (firstMain) {
        mainWarehouseId = firstMain.id;
      }
    }
  }

  if (!mainWarehouseId) {
    return {
      error: 'This business is not configured as a Dealer with an assigned Main Warehouse. Main Warehouse availability is strictly available to Dealer entities.',
      status: 403,
    };
  }

  // Fetch Parent Main Warehouse business
  const [parentBiz] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      tradeName: businesses.tradeName,
      city: businesses.city,
      state: businesses.state,
      phone: businesses.phone,
      email: businesses.email,
      status: businesses.status,
      businessType: businesses.businessType,
    })
    .from(businesses)
    .where(eq(businesses.id, mainWarehouseId))
    .limit(1);

  if (!parentBiz) {
    return { error: 'Assigned Main Warehouse entity not found.', status: 404 };
  }

  if (parentBiz.status !== 'ACTIVE') {
    return { error: `Assigned Main Warehouse "${parentBiz.name}" is currently ${parentBiz.status.toLowerCase()}.`, status: 403 };
  }

  return {
    dealerBusiness: biz,
    mainWarehouse: parentBiz,
  };
}

/**
 * GET /api/dealer/main-warehouse/availability
 * Real-time, read-only stock availability feed from designated Main Warehouse.
 * 
 * Strict Guarantees:
 * - Direct database query from Main Warehouse records (no duplicate tables or copied quantities)
 * - Negative stock is clamped to 0
 * - Internal costs, supplier names, purchase margins, and internal ledgers are NEVER exposed
 * - Dealer local available stock is provided alongside for immediate stock comparison
 */
router.get(
  '/main-warehouse/availability',
  requireAnyPermission(['inventory:view', 'inventory.view', 'sales:view', 'sales:create', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainWarehouseContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerBusiness, mainWarehouse } = context;
      const {
        search,
        categoryId,
        categoryCode,
        sph,
        cyl,
        axis,
        add,
        side,
        inStockOnly,
        page = '1',
        limit = '50',
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      // 1. Build Query for Main Warehouse stock
      const queryParams: any[] = [mainWarehouse.id];
      const whereClauses: string[] = [
        `ob.business_id = $1`,
        `ob.status = 'ACTIVE'`,
      ];

      if (inStockOnly === 'true' || inStockOnly === '1') {
        whereClauses.push(`COALESCE(os.available_stock, 0) > 0`);
      }

      if (categoryId) {
        queryParams.push(categoryId);
        whereClauses.push(`ob.category_id = $${queryParams.length}`);
      }

      if (categoryCode) {
        queryParams.push(String(categoryCode).toUpperCase());
        whereClauses.push(`UPPER(c.code) = $${queryParams.length}`);
      }

      if (sph !== undefined && sph !== '') {
        queryParams.push(parseFloat(sph as string));
        whereClauses.push(`ob.sph = $${queryParams.length}`);
      }

      if (cyl !== undefined && cyl !== '') {
        queryParams.push(parseFloat(cyl as string));
        whereClauses.push(`ob.cyl = $${queryParams.length}`);
      }

      if (axis !== undefined && axis !== '') {
        queryParams.push(parseFloat(axis as string));
        whereClauses.push(`ob.axis = $${queryParams.length}`);
      }

      if (add !== undefined && add !== '') {
        queryParams.push(parseFloat(add as string));
        whereClauses.push(`ob.add = $${queryParams.length}`);
      }

      if (side && side !== 'ALL' && side !== 'NONE') {
        queryParams.push(side);
        whereClauses.push(`ob.side = $${queryParams.length}`);
      }

      const whereSql = whereClauses.join(' AND ');

      // Query Main Warehouse batches and current stock
      // CRITICAL: Strict field projection. NO purchase price, NO cost, NO margin, NO supplier!
      const mainStockSql = `
        SELECT 
          ob.id AS batch_id,
          ob.barcode,
          ob.identity_key,
          ob.sph,
          ob.cyl,
          ob.axis,
          ob.add,
          ob.side,
          ob.status AS batch_status,
          ui.id AS unique_item_id,
          ui.name AS unique_item_name,
          ui.code AS unique_item_code,
          pi.name AS primary_item_name,
          c.id AS category_id,
          c.name AS category_name,
          c.code AS category_code,
          GREATEST(COALESCE(os.available_stock, 0), 0)::float AS main_available_stock,
          GREATEST(COALESCE(os.physical_stock, 0), 0)::float AS main_physical_stock
        FROM optical_batches ob
        INNER JOIN unique_items ui ON ob.unique_item_id = ui.id
        LEFT JOIN primary_items pi ON ui.primary_item_id = pi.id
        LEFT JOIN categories c ON ob.category_id = c.id
        LEFT JOIN optical_stocks os ON ob.id = os.batch_id
        WHERE ${whereSql}
        ORDER BY ui.name ASC, ob.sph ASC, ob.cyl ASC
      `;

      const { rows } = await pool.query(mainStockSql, queryParams);

      // 2. Fetch Dealer's corresponding local stock for comparison using identity_key
      const dealerStockMap = new Map<string, { available: number; physical: number }>();
      if (dealerBusiness.id !== mainWarehouse.id) {
        const dealerStockSql = `
          SELECT 
            ob.identity_key,
            ui.code AS unique_item_code,
            GREATEST(COALESCE(os.available_stock, 0), 0)::float AS dealer_available,
            GREATEST(COALESCE(os.physical_stock, 0), 0)::float AS dealer_physical
          FROM optical_batches ob
          INNER JOIN unique_items ui ON ob.unique_item_id = ui.id
          LEFT JOIN optical_stocks os ON ob.id = os.batch_id
          WHERE ob.business_id = $1
        `;
        const dealerStockRes = await pool.query(dealerStockSql, [dealerBusiness.id]);
        for (const r of dealerStockRes.rows) {
          if (r.identity_key) {
            dealerStockMap.set(r.identity_key, {
              available: r.dealer_available || 0,
              physical: r.dealer_physical || 0,
            });
          }
          if (r.unique_item_code) {
            dealerStockMap.set(`${r.unique_item_code}:${r.identity_key}`, {
              available: r.dealer_available || 0,
              physical: r.dealer_physical || 0,
            });
          }
        }
      }

      // 3. Format items with canonical power display & attach dealer stock
      let formattedItems = rows.map((row: any) => {
        const sphStr = row.sph != null ? (row.sph > 0 ? `+${Number(row.sph).toFixed(2)}` : Number(row.sph).toFixed(2)) : '0.00';
        const cylStr = row.cyl != null ? (row.cyl > 0 ? `+${Number(row.cyl).toFixed(2)}` : Number(row.cyl).toFixed(2)) : '0.00';
        let formattedPower = `SPH ${sphStr} / CYL ${cylStr}`;
        if (row.axis) formattedPower += ` AXIS ${row.axis}°`;
        if (row.add) formattedPower += ` ADD +${Number(row.add).toFixed(2)}`;
        if (row.side && row.side !== 'NONE') formattedPower += ` (${row.side})`;

        const dealerStock = dealerStockMap.get(`${row.unique_item_code}:${row.identity_key}`)
          || dealerStockMap.get(row.identity_key)
          || { available: 0, physical: 0 };

        return {
          batchId: row.batch_id,
          barcode: row.barcode,
          identityKey: row.identity_key,
          sph: row.sph != null ? Number(row.sph) : null,
          cyl: row.cyl != null ? Number(row.cyl) : null,
          axis: row.axis != null ? Number(row.axis) : null,
          add: row.add != null ? Number(row.add) : null,
          side: row.side || 'NONE',
          formattedPower,
          uniqueItemId: row.unique_item_id,
          uniqueItemName: row.unique_item_name,
          uniqueItemCode: row.unique_item_code,
          primaryItemName: row.primary_item_name || '',
          categoryId: row.category_id,
          categoryName: row.category_name || 'Standard',
          categoryCode: row.category_code || '',
          mainWarehouseAvailable: row.main_available_stock,
          mainWarehousePhysical: row.main_physical_stock,
          dealerAvailable: dealerStock.available,
          dealerPhysical: dealerStock.physical,
        };
      });

      // 4. Apply smart search ranking if search query provided
      if (search && String(search).trim()) {
        const queryStr = String(search).trim();
        const scored = formattedItems.map(item => {
          const candidate: SearchCandidate = {
            id: item.batchId,
            name: `${item.uniqueItemName} ${item.primaryItemName || ''}`.trim(),
            code: item.uniqueItemCode,
            barcode: item.barcode,
            sph: item.sph,
            cyl: item.cyl,
            axis: item.axis,
            add: item.add,
            side: item.side,
            categoryCode: item.categoryCode,
            rawText: `${item.uniqueItemName} ${item.uniqueItemCode} ${item.formattedPower} ${item.barcode}`,
          };
          const score = scoreCandidate(candidate, queryStr);
          return { item, score };
        });

        console.log('Availability search query:', queryStr, 'scored count:', scored.length, 'scores:', scored.map(s => ({ sph: s.item.sph, cyl: s.item.cyl, score: s.score })));

        formattedItems = scored
          .filter(s => s.score > 30)
          .sort((a, b) => b.score - a.score)
          .map(s => s.item);
      }

      const totalItems = formattedItems.length;
      const totalPages = Math.ceil(totalItems / limitNum) || 1;
      const paginatedItems = formattedItems.slice(offset, offset + limitNum);

      res.json({
        success: true,
        mainWarehouse: {
          id: mainWarehouse.id,
          name: mainWarehouse.name,
          tradeName: mainWarehouse.tradeName,
          city: mainWarehouse.city,
          state: mainWarehouse.state,
          phone: mainWarehouse.phone,
          email: mainWarehouse.email,
        },
        dealerBusiness: {
          id: dealerBusiness.id,
          name: dealerBusiness.name,
          businessType: dealerBusiness.businessType,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalItems,
          totalPages,
        },
        items: paginatedItems,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/main-warehouse/availability Error]', error);
      res.status(500).json({
        error: error.message || 'Failed to fetch Main Warehouse stock availability',
      });
    }
  }
);

/**
 * GET /api/dealer/main-warehouse/summary
 * Aggregate metrics of Main Warehouse catalog and availability for Dashboard/Header banner
 */
router.get(
  '/main-warehouse/summary',
  requireAnyPermission(['inventory:view', 'inventory.view', 'sales:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const context = await resolveMainWarehouseContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { mainWarehouse, dealerBusiness } = context;

      // Summary counts
      const summaryRes = await pool.query(`
        SELECT 
          COUNT(DISTINCT ob.id)::int AS total_batches,
          COUNT(DISTINCT ob.unique_item_id)::int AS total_unique_items,
          COUNT(DISTINCT CASE WHEN COALESCE(os.available_stock, 0) > 0 THEN ob.id END)::int AS in_stock_batches,
          COALESCE(SUM(GREATEST(COALESCE(os.available_stock, 0), 0)), 0)::float AS total_units_available
        FROM optical_batches ob
        LEFT JOIN optical_stocks os ON ob.id = os.batch_id
        WHERE ob.business_id = $1 AND ob.status = 'ACTIVE'
      `, [mainWarehouse.id]);

      // Category breakdown
      const categoryRes = await pool.query(`
        SELECT 
          c.id,
          c.name,
          c.code,
          COUNT(ob.id)::int AS total_batches,
          COUNT(CASE WHEN COALESCE(os.available_stock, 0) > 0 THEN 1 END)::int AS in_stock_batches,
          COALESCE(SUM(GREATEST(COALESCE(os.available_stock, 0), 0)), 0)::float AS available_units
        FROM categories c
        JOIN optical_batches ob ON c.id = ob.category_id AND ob.business_id = $1 AND ob.status = 'ACTIVE'
        LEFT JOIN optical_stocks os ON ob.id = os.batch_id
        GROUP BY c.id, c.name, c.code
        ORDER BY available_units DESC
      `, [mainWarehouse.id]);

      const stats = summaryRes.rows[0] || {
        total_batches: 0,
        total_unique_items: 0,
        in_stock_batches: 0,
        total_units_available: 0,
      };

      res.json({
        success: true,
        mainWarehouse: {
          id: mainWarehouse.id,
          name: mainWarehouse.name,
          tradeName: mainWarehouse.tradeName,
          city: mainWarehouse.city,
          state: mainWarehouse.state,
        },
        dealerBusiness: {
          id: dealerBusiness.id,
          name: dealerBusiness.name,
        },
        metrics: {
          totalBatches: stats.total_batches,
          totalUniqueItems: stats.total_unique_items,
          inStockBatches: stats.in_stock_batches,
          totalUnitsAvailable: stats.total_units_available,
        },
        categories: categoryRes.rows.map((c: any) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          totalBatches: c.total_batches,
          inStockBatches: c.in_stock_batches,
          availableUnits: c.available_units,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to fetch Main Warehouse summary' });
    }
  }
);

/**
 * Helper: Resolve or provision Dealer as a Customer Party inside Main Warehouse business
 */
async function resolveDealerPartyInMain(
  client: any,
  dealerBusiness: any,
  mainWarehouse: any
): Promise<string> {
  // 1. Search for existing active Customer party matching Dealer business in Main Warehouse
  const existingRes = await client.query(
    `SELECT id, name, party_code, status, party_type FROM parties
     WHERE business_id = $1
       AND (
         notes LIKE $2
         OR LOWER(name) = LOWER($3)
         OR (gstin IS NOT NULL AND gstin <> '' AND UPPER(gstin) = UPPER($4))
       )
     LIMIT 1`,
    [
      mainWarehouse.id,
      `%[DEALER_BIZ:${dealerBusiness.id}]%`,
      dealerBusiness.name.trim(),
      dealerBusiness.gstin ? dealerBusiness.gstin.trim() : '___NONE___',
    ]
  );

  if (existingRes.rows.length > 0) {
    const existing = existingRes.rows[0];
    if (existing.status !== 'ACTIVE') {
      await client.query(`UPDATE parties SET status = 'ACTIVE' WHERE id = $1`, [existing.id]);
    }
    if (existing.party_type === 'SUPPLIER') {
      await client.query(`UPDATE parties SET party_type = 'BOTH' WHERE id = $1`, [existing.id]);
    }
    return existing.id;
  }

  // 2. Generate unique party code in Main Warehouse
  const codeCountRes = await client.query(
    `SELECT COUNT(*)::int as count FROM parties WHERE business_id = $1`,
    [mainWarehouse.id]
  );
  const nextSeq = (codeCountRes.rows[0]?.count || 0) + 1;
  const partyCode = `DLR-${String(nextSeq).padStart(4, '0')}`;

  // 3. Provision customer party in Main Warehouse
  const insertPartyRes = await client.query(
    `INSERT INTO parties (
      business_id, party_code, name, display_name, party_type,
      mobile, email, address_line_1, address_line_2, city, state, pincode,
      gstin, pan, status, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, 'CUSTOMER',
      $5, $6, $7, $8, $9, $10, $11,
      $12, $13, 'ACTIVE', $14, NOW(), NOW()
    ) RETURNING id`,
    [
      mainWarehouse.id,
      partyCode,
      dealerBusiness.name,
      dealerBusiness.tradeName || dealerBusiness.name,
      dealerBusiness.phone || null,
      dealerBusiness.email || null,
      dealerBusiness.addressLine1 || null,
      dealerBusiness.addressLine2 || null,
      dealerBusiness.city || null,
      dealerBusiness.state || null,
      dealerBusiness.pincode || null,
      dealerBusiness.gstin || null,
      dealerBusiness.pan || null,
      `Auto-provisioned Dealer Account [DEALER_BIZ:${dealerBusiness.id}]`,
    ]
  );

  return insertPartyRes.rows[0].id;
}

/**
 * POST /api/dealer/order
 * Place an authoritative Dealer Order directly against Parent Main Warehouse
 * Reuses existing Sales Order engine under Main Warehouse business context.
 * Performs real-time concurrency-safe stock re-validation and stock reservation.
 */
router.post(
  '/order',
  requireAnyPermission(['sales:create', 'sales.create', 'sales.order.create', 'sales:order:create', 'master:view']),
  async (req: Request, res: Response) => {
    const context = await resolveMainWarehouseContext(req);
    if ('error' in context) {
      res.status(context.status).json({ error: context.error });
      return;
    }

    const { dealerBusiness, mainWarehouse } = context;
    const { lines, notes, idempotencyKey } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: 'Order must contain at least one line item.' });
      return;
    }

    // Check idempotency if key provided
    if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0) {
      const trimmedKey = idempotencyKey.trim();
      const existingDealerOrder = await db
        .select()
        .from(dealerOrders)
        .where(
          and(
            eq(dealerOrders.dealerBusinessId, dealerBusiness.id),
            eq(dealerOrders.idempotencyKey, trimmedKey)
          )
        )
        .limit(1);

      if (existingDealerOrder.length > 0) {
        // Return already processed order
        const [existing] = existingDealerOrder;
        const mainSo = await SalesService.getSalesOrderById(mainWarehouse.id, existing.mainSalesOrderId).catch(() => null);
        res.json({
          success: true,
          message: 'Order already processed (idempotent submission).',
          order: {
            id: existing.id,
            orderNumber: existing.orderNumber,
            status: existing.status,
            grandTotal: parseFloat(existing.grandTotal),
            totalQuantity: parseFloat(existing.totalQuantity),
            itemCount: parseFloat(existing.itemCount),
            salesOrder: mainSo,
          },
        });
        return;
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Resolve Dealer as Customer Party in Main Warehouse
      const dealerPartyId = await resolveDealerPartyInMain(client, dealerBusiness, mainWarehouse);

      // 2. Re-read and re-validate real-time Main Warehouse stock for all requested batches
      // Collect batch IDs
      const requestedBatches: {
        batchId: string;
        uniqueItemId: string;
        quantity: number;
        rate?: number;
      }[] = [];

      for (const line of lines) {
        const qty = parseFloat(line.quantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`Invalid line quantity: ${line.quantity}`);
        }
        if (Math.abs(Math.round(qty * 2) - qty * 2) > 0.0001) {
          throw new Error(`Quantity (${qty}) must be in steps of 0.5 (e.g., 0.5, 1.0, 1.5, 2.0).`);
        }

        if (line.batchId) {
          requestedBatches.push({
            batchId: line.batchId,
            uniqueItemId: line.uniqueItemId,
            quantity: qty,
            rate: line.rate ? parseFloat(line.rate) : undefined,
          });
        } else if (Array.isArray(line.batches) && line.batches.length > 0) {
          for (const b of line.batches) {
            const bQty = parseFloat(b.quantity);
            if (isNaN(bQty) || bQty <= 0) continue;
            if (Math.abs(Math.round(bQty * 2) - bQty * 2) > 0.0001) {
              throw new Error(`Batch quantity (${bQty}) must be in steps of 0.5 (e.g., 0.5, 1.0, 1.5, 2.0).`);
            }
            requestedBatches.push({
              batchId: b.batchId,
              uniqueItemId: line.uniqueItemId,
              quantity: bQty,
              rate: line.rate ? parseFloat(line.rate) : undefined,
            });
          }
        } else {
          throw new Error('Every order item must specify an optical batch ID to reserve at Main Warehouse.');
        }
      }

      if (requestedBatches.length === 0) {
        throw new Error('No valid batch items found to order.');
      }

      // Check stock for all requested batches with FOR UPDATE lock against Main Warehouse
      for (const reqItem of requestedBatches) {
        // Lock stock record at Main Warehouse
        const stock = await StockService.lockAndGetStock(client, mainWarehouse.id, reqItem.batchId);

        // Fetch batch details to give friendly error if insufficient
        const batchInfoRes = await client.query(
          `SELECT ob.id, ob.barcode, ob.sph, ob.cyl, ob.axis, ob.add, ui.name as item_name
           FROM optical_batches ob
           JOIN unique_items ui ON ob.unique_item_id = ui.id
           WHERE ob.id = $1 AND ob.business_id = $2`,
          [reqItem.batchId, mainWarehouse.id]
        );

        const batchInfo = batchInfoRes.rows[0] || { item_name: 'Item', barcode: reqItem.batchId };
        const powerDesc = [
          batchInfo.sph !== null ? `SPH ${Number(batchInfo.sph) > 0 ? '+' : ''}${batchInfo.sph}` : '',
          batchInfo.cyl !== null ? `CYL ${Number(batchInfo.cyl) > 0 ? '+' : ''}${batchInfo.cyl}` : '',
        ].filter(Boolean).join(' ') || batchInfo.barcode || 'Batch';

        if (stock.availableStock < reqItem.quantity) {
          throw new Error(
            `Insufficient Main Warehouse stock for "${batchInfo.item_name}" (${powerDesc}). ` +
            `Requested: ${reqItem.quantity} units, Currently Available at HQ: ${Math.max(0, stock.availableStock)} units.`
          );
        }
      }

      // 3. Construct Sales Order DTO for Main Warehouse
      // Group lines by uniqueItemId
      const itemsMap = new Map<string, {
        uniqueItemId: string;
        quantity: number;
        rate: number;
        gstRate: number;
        batches: { batchId: string; quantity: number }[];
      }>();

      for (const reqItem of requestedBatches) {
        // Fetch item rate and GST from Main Warehouse unique_items
        const [itemData] = await db
          .select({
            id: uniqueItems.id,
            mrp: uniqueItems.mrp,
            purchaseRate: uniqueItems.purchaseRate,
            gstRate: uniqueItems.gstRate,
          })
          .from(uniqueItems)
          .where(and(eq(uniqueItems.id, reqItem.uniqueItemId), eq(uniqueItems.businessId, mainWarehouse.id)))
          .limit(1);

        // Determine rate: check partyItemPrices, or mrp, or purchaseRate, or provided rate
        let resolvedRate = reqItem.rate;
        if (resolvedRate === undefined || isNaN(resolvedRate) || resolvedRate <= 0) {
          const lastRate = await SalesService.getPartyItemPrice(mainWarehouse.id, dealerPartyId, reqItem.uniqueItemId);
          if (lastRate && lastRate > 0) {
            resolvedRate = lastRate;
          } else if (itemData?.mrp && parseFloat(itemData.mrp) > 0) {
            resolvedRate = parseFloat(itemData.mrp);
          } else if (itemData?.purchaseRate && parseFloat(itemData.purchaseRate) > 0) {
            resolvedRate = parseFloat(itemData.purchaseRate);
          } else {
            resolvedRate = 100.00; // fallback standard unit rate
          }
        }

        const existing = itemsMap.get(reqItem.uniqueItemId);
        if (existing) {
          existing.quantity = round2(existing.quantity + reqItem.quantity);
          existing.batches.push({ batchId: reqItem.batchId, quantity: reqItem.quantity });
        } else {
          itemsMap.set(reqItem.uniqueItemId, {
            uniqueItemId: reqItem.uniqueItemId,
            quantity: reqItem.quantity,
            rate: resolvedRate,
            gstRate: 5.0, // Optical lens standard GST 5%
            batches: [{ batchId: reqItem.batchId, quantity: reqItem.quantity }],
          });
        }
      }

      const salesLines = Array.from(itemsMap.values()).map(item => ({
        uniqueItemId: item.uniqueItemId,
        quantity: item.quantity,
        rate: item.rate,
        discountType: 'NONE' as const,
        discountValue: 0,
        gstRate: item.gstRate,
        batches: item.batches,
      }));

      // Commit early stock lock check so createSalesOrder can execute cleanly within its own transaction
      await client.query('COMMIT');
      client.release();

      // 4. Create authoritative Sales Order directly in Main Warehouse
      const orderNotes = [
        notes ? notes.trim() : null,
        `[DEALER_ORDER] Placed by Dealer: "${dealerBusiness.name}" (${dealerBusiness.id})`,
      ].filter(Boolean).join('\n');

      const mainSalesOrder = await SalesService.createSalesOrder(
        mainWarehouse.id,
        {
          partyId: dealerPartyId,
          orderDate: new Date(),
          gstMode: dealerBusiness.state && mainWarehouse.state && dealerBusiness.state.trim().toLowerCase() !== mainWarehouse.state.trim().toLowerCase()
            ? 'INTER_STATE'
            : 'INTRA_STATE',
          notes: orderNotes,
          status: 'CONFIRMED', // Immediately reserve stock at Main Warehouse
          lines: salesLines,
        },
        req.user!.id
      );

      // 5. Store Dealer Order linkage record in dealer_orders table
      const totalQuantity = salesLines.reduce((acc, l) => acc + l.quantity, 0);
      const [dealerOrderRecord] = await db
        .insert(dealerOrders)
        .values({
          dealerBusinessId: dealerBusiness.id,
          mainBusinessId: mainWarehouse.id,
          mainSalesOrderId: mainSalesOrder.id,
          dealerPartyIdInMain: dealerPartyId,
          orderNumber: mainSalesOrder.orderNumber,
          status: 'CONFIRMED',
          itemCount: String(salesLines.length),
          totalQuantity: String(totalQuantity),
          taxableAmount: String(mainSalesOrder.taxableAmount || 0),
          taxAmount: String(round2(parseFloat(String(mainSalesOrder.cgstAmount || 0)) + parseFloat(String(mainSalesOrder.sgstAmount || 0)) + parseFloat(String(mainSalesOrder.igstAmount || 0)))),
          grandTotal: String(mainSalesOrder.grandTotal || 0),
          notes: notes || null,
          idempotencyKey: idempotencyKey ? idempotencyKey.trim() : null,
          createdBy: req.user!.id,
        })
        .returning();

      // 5b. PHASE 3C ARCHITECTURAL MANDATE:
      // Create corresponding Dealer Purchase Order in Dealer business
      let dealerPurchaseOrder: any = null;
      try {
        const pClient = await pool.connect();
        try {
          const mainSupplierPartyId = await DealerLogisticsService.resolveMainWarehouseSupplierParty(
            pClient,
            dealerBusiness.id,
            mainWarehouse.id
          );

          // Resolve/replicate items in Dealer catalog
          const poLines = [];
          for (const sLine of salesLines) {
            let dealerUniqueItemId: string | null = null;
            let dealerBatchId: string | null = null;
            if (sLine.batches && sLine.batches.length > 0) {
              const rep = await DealerLogisticsService.resolveOrReplicateItemAndBatchInDealer(
                pClient,
                dealerBusiness.id,
                sLine.uniqueItemId,
                sLine.batches[0].batchId,
                req.user!.id
              );
              dealerUniqueItemId = rep.dealerUniqueItemId;
              dealerBatchId = rep.dealerBatchId;
            } else {
              // Resolve item without batch
              const uiRes = await pClient.query(
                `SELECT id FROM unique_items WHERE business_id = $1 AND code = (SELECT code FROM unique_items WHERE id = $2) LIMIT 1`,
                [dealerBusiness.id, sLine.uniqueItemId]
              );
              if (uiRes.rows.length > 0) {
                dealerUniqueItemId = uiRes.rows[0].id;
              }
            }

            if (dealerUniqueItemId) {
              poLines.push({
                uniqueItemId: dealerUniqueItemId,
                quantity: sLine.quantity,
                rate: sLine.rate,
                discountType: 'NONE' as const,
                discountValue: 0,
                gstRate: sLine.gstRate,
                batches: dealerBatchId ? [{ batchId: dealerBatchId, quantity: sLine.quantity }] : undefined,
              });
            }
          }

          const isInterState = dealerBusiness.state && mainWarehouse.state &&
            dealerBusiness.state.trim().toLowerCase() !== mainWarehouse.state.trim().toLowerCase();

          dealerPurchaseOrder = await PurchaseService.createPurchaseOrder(
            dealerBusiness.id,
            {
              supplierPartyId: mainSupplierPartyId,
              orderDate: new Date(),
              expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              gstMode: isInterState ? 'INTER_STATE' : 'INTRA_STATE',
              source: 'DEALER_ORDER',
              dealerOrderId: dealerOrderRecord.id,
              mainSalesOrderId: mainSalesOrder.id,
              notes: `Linked to Main Sales Order ${mainSalesOrder.orderNumber}`,
              lines: poLines,
            },
            req.user!.id
          );

          const poId = dealerPurchaseOrder?.order?.id || dealerPurchaseOrder?.id;

          // Update dealer_orders with dealer_purchase_order_id
          if (poId) {
            await pool.query(
              `UPDATE dealer_orders SET dealer_purchase_order_id = $1 WHERE id = $2`,
              [poId, dealerOrderRecord.id]
            );
          }
        } finally {
          pClient.release();
        }
      } catch (poErr) {
        console.error('Failed to create linked dealer purchase order:', poErr);
      }

      const linkedPoId = dealerPurchaseOrder?.order?.id || dealerPurchaseOrder?.id || null;

      // 6. Record Audit Log for Dealer Business
      await recordAuditLog({
        businessId: dealerBusiness.id,
        userId: req.user!.id,
        action: 'DEALER_ORDER_PLACED',
        module: 'SALES',
        entityType: 'DealerOrder',
        entityId: dealerOrderRecord.id,
        newValue: {
          orderNumber: mainSalesOrder.orderNumber,
          mainSalesOrderId: mainSalesOrder.id,
          mainWarehouseId: mainWarehouse.id,
          dealerPurchaseOrderId: linkedPoId,
          grandTotal: mainSalesOrder.grandTotal,
          totalQuantity,
        },
        req,
      });

      res.status(201).json({
        success: true,
        message: `Order ${mainSalesOrder.orderNumber} placed successfully with Main Warehouse "${mainWarehouse.name}". Stock reserved.`,
        order: {
          id: dealerOrderRecord.id,
          orderNumber: mainSalesOrder.orderNumber,
          mainSalesOrderId: mainSalesOrder.id,
          dealerPurchaseOrderId: linkedPoId,
          status: 'CONFIRMED',
          grandTotal: parseFloat(String(mainSalesOrder.grandTotal)),
          totalQuantity,
          itemCount: salesLines.length,
          salesOrder: mainSalesOrder,
          purchaseOrder: dealerPurchaseOrder?.order || dealerPurchaseOrder,
        },
      });
    } catch (error: any) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      client.release();
      console.error('[Dealer Order Error]', error);
      res.status(400).json({
        error: error.message || 'Failed to place order against Main Warehouse',
      });
    }
  }
);

/**
 * GET /api/dealer/orders
 * List all orders placed by the calling Dealer business against Main Warehouse
 */
router.get(
  '/orders',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.order.view', 'sales:order:view', 'master:view']),
  async (req: Request, res: Response) => {
    try {
      const context = await resolveMainWarehouseContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const { dealerBusiness, mainWarehouse } = context;
      const statusFilter = req.query.status as string;
      const search = req.query.search as string;

      // Query dealer_orders joined with sales_orders from Main Warehouse
      let query = `
        SELECT 
          d.id,
          d.dealer_business_id,
          d.main_business_id,
          d.main_sales_order_id,
          d.dealer_purchase_order_id,
          d.dealer_party_id_in_main,
          d.order_number,
          so.status as main_status,
          COALESCE(so.status, d.status) as status,
          po.status as purchase_order_status,
          d.item_count,
          d.total_quantity,
          d.taxable_amount,
          d.tax_amount,
          d.grand_total,
          d.notes,
          d.created_at,
          so.order_date,
          so.converted_invoice_id,
          p.name as party_name,
          mw.name as main_warehouse_name
        FROM dealer_orders d
        JOIN sales_orders so ON d.main_sales_order_id = so.id
        LEFT JOIN purchase_orders po ON d.dealer_purchase_order_id = po.id
        LEFT JOIN parties p ON d.dealer_party_id_in_main = p.id
        LEFT JOIN businesses mw ON d.main_business_id = mw.id
        WHERE d.dealer_business_id = $1
      `;

      const params: any[] = [dealerBusiness.id];

      if (statusFilter && statusFilter !== 'ALL') {
        params.push(statusFilter);
        query += ` AND so.status = $${params.length}`;
      }

      if (search && search.trim().length > 0) {
        params.push(`%${search.trim().toLowerCase()}%`);
        query += ` AND (LOWER(d.order_number) LIKE $${params.length} OR LOWER(COALESCE(d.notes, '')) LIKE $${params.length})`;
      }

      query += ` ORDER BY d.created_at DESC LIMIT 100`;

      const ordersRes = await pool.query(query, params);

      res.json({
        success: true,
        orders: ordersRes.rows.map(r => ({
          id: r.id,
          orderNumber: r.order_number,
          mainSalesOrderId: r.main_sales_order_id,
          dealerPurchaseOrderId: r.dealer_purchase_order_id,
          purchaseOrderStatus: r.purchase_order_status,
          status: r.status,
          mainStatus: r.main_status,
          itemCount: parseFloat(r.item_count || '0'),
          totalQuantity: parseFloat(r.total_quantity || '0'),
          taxableAmount: parseFloat(r.taxable_amount || '0'),
          taxAmount: parseFloat(r.tax_amount || '0'),
          grandTotal: parseFloat(r.grand_total || '0'),
          notes: r.notes,
          orderDate: r.order_date || r.created_at,
          createdAt: r.created_at,
          mainWarehouseName: r.main_warehouse_name,
          convertedInvoiceId: r.converted_invoice_id,
        })),
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/orders Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer orders' });
    }
  }
);

/**
 * GET /api/dealer/orders/:id
 * Retrieve details of a specific Dealer Order including item lines and allocated batches
 */
router.get(
  '/orders/:id',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.order.view', 'sales:order:view', 'master:view']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;
      const orderId = req.params.id;

      // Find dealer order record belonging to current business
      const orderRes = await pool.query(
        `SELECT d.*, mw.name as main_warehouse_name, mw.trade_name as main_warehouse_trade_name
         FROM dealer_orders d
         LEFT JOIN businesses mw ON d.main_business_id = mw.id
         WHERE d.id = $1 AND (d.dealer_business_id = $2 OR d.main_business_id = $2)`,
        [orderId, currentBizId]
      );

      if (orderRes.rows.length === 0) {
        res.status(404).json({ error: 'Dealer order not found or access denied.' });
        return;
      }

      const dOrder = orderRes.rows[0];

      // Fetch full Sales Order from Main Warehouse
      const fullSo = await SalesService.getSalesOrderById(dOrder.main_business_id, dOrder.main_sales_order_id);

      // Fetch linked Dealer Purchase Order if available
      let linkedPurchaseOrder: any = null;
      if (dOrder.dealer_purchase_order_id) {
        try {
          linkedPurchaseOrder = await PurchaseService.getPurchaseOrderById(
            dOrder.dealer_business_id,
            dOrder.dealer_purchase_order_id
          );
        } catch (_) {}
      }

      res.json({
        success: true,
        order: {
          id: dOrder.id,
          orderNumber: dOrder.order_number,
          mainSalesOrderId: dOrder.main_sales_order_id,
          dealerPurchaseOrderId: dOrder.dealer_purchase_order_id,
          mainWarehouseName: dOrder.main_warehouse_name,
          status: fullSo ? fullSo.status : dOrder.status,
          itemCount: parseFloat(dOrder.item_count),
          totalQuantity: parseFloat(dOrder.total_quantity),
          grandTotal: parseFloat(dOrder.grand_total),
          notes: dOrder.notes,
          createdAt: dOrder.created_at,
          salesOrder: fullSo,
          purchaseOrder: linkedPurchaseOrder,
        },
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/orders/:id Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch dealer order details' });
    }
  }
);

/**
 * POST /api/dealer/orders/:id/cancel
 * Cancel an un-invoiced dealer order, releasing reservations at Main Warehouse
 * and updating linked dealer order and purchase order statuses.
 */
router.post(
  '/orders/:id/cancel',
  requireAnyPermission(['sales:create', 'sales.create', 'purchase:create', 'purchase.create', 'sales:delete', 'purchase:delete']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;
      const orderId = req.params.id;
      const { reason } = req.body || {};

      const dOrderRes = await pool.query(
        `SELECT id, dealer_business_id, main_business_id, main_sales_order_id, status 
         FROM dealer_orders 
         WHERE id = $1 AND (dealer_business_id = $2 OR main_business_id = $2)`,
        [orderId, currentBizId]
      );

      if (dOrderRes.rows.length === 0) {
        res.status(404).json({ error: 'Dealer order not found or access denied.' });
        return;
      }

      const dOrder = dOrderRes.rows[0];
      if (dOrder.status === 'CANCELLED') {
        res.status(400).json({ error: 'Dealer order is already cancelled.' });
        return;
      }

      // Authoritatively cancel via SalesService in Main Warehouse
      const cancelledSo = await SalesService.cancelSalesOrder(
        dOrder.main_business_id,
        dOrder.main_sales_order_id,
        reason || 'Cancelled by Dealer',
        req.user!.id
      );

      res.json({
        success: true,
        message: 'Dealer order cancelled successfully and inventory reservations released.',
        order: {
          id: dOrder.id,
          status: 'CANCELLED',
          salesOrder: cancelledSo,
        },
      });
    } catch (error: any) {
      console.error('[POST /api/dealer/orders/:id/cancel Error]', error);
      res.status(400).json({ error: error.message || 'Failed to cancel dealer order' });
    }
  }
);

/**
 * ============================================================================
 * PHASE 3C: PHYSICAL MOVEMENT LIFECYCLE (DISPATCH → GRN → PURCHASE → STOCK)
 * ============================================================================
 */

/**
 * GET /api/dealer/shipments/eligible-invoices
 * Lists Main Warehouse sales invoices that have pending items ready for dispatch.
 */
router.get(
  '/shipments/eligible-invoices',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.order.view', 'sales:order:view', 'master:view']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;

      // Query sales invoices in this business that belong to dealers
      const invoicesRes = await pool.query(
        `SELECT 
           si.id,
           si.invoice_number,
           si.invoice_date,
           si.grand_total,
           si.status,
           p.name as customer_name,
           d.id as dealer_order_id,
           COALESCE(d.dealer_business_id, match_b.id) as dealer_business_id,
           d.order_number as dealer_order_number,
           COALESCE(db.name, match_b.name, p.name) as dealer_business_name,
           COALESCE(SUM(silb.quantity), 0) as total_invoice_quantity,
           COALESCE(disp.total_dispatched, 0) as already_dispatched_quantity
         FROM sales_invoices si
         JOIN parties p ON si.customer_party_id = p.id
         LEFT JOIN sales_orders so ON si.sales_order_id = so.id
         LEFT JOIN dealer_orders d ON d.main_sales_order_id = so.id
         LEFT JOIN businesses db ON d.dealer_business_id = db.id
         LEFT JOIN businesses match_b ON (LOWER(match_b.name) = LOWER(p.name) OR LOWER(match_b.trade_name) = LOWER(p.name))
         LEFT JOIN sales_invoice_lines sil ON si.id = sil.sales_invoice_id
         LEFT JOIN sales_invoice_line_batches silb ON sil.id = silb.sales_invoice_line_id
         LEFT JOIN (
           SELECT 
             dsl.sales_invoice_line_id,
             SUM(dsl.dispatched_quantity) as total_dispatched
           FROM dealer_shipment_lines dsl
           JOIN dealer_shipments ds ON dsl.dealer_shipment_id = ds.id
           WHERE ds.status != 'CANCELLED'
           GROUP BY dsl.sales_invoice_line_id
         ) disp ON sil.id = disp.sales_invoice_line_id
         WHERE si.business_id = $1 AND si.status = 'POSTED'
           AND (d.dealer_business_id IS NOT NULL OR match_b.id IS NOT NULL)
         GROUP BY si.id, si.invoice_number, si.invoice_date, si.grand_total, si.status,
                  p.name, d.id, d.dealer_business_id, match_b.id, match_b.name, d.order_number, db.name, disp.total_dispatched
         ORDER BY si.created_at DESC LIMIT 50`,
        [currentBizId]
      );

      const eligible = invoicesRes.rows
        .map(r => {
          const totalQty = parseFloat(r.total_invoice_quantity || '0');
          const dispatchedQty = parseFloat(r.already_dispatched_quantity || '0');
          const remainingQty = Math.max(0, totalQty - dispatchedQty);
          return {
            id: r.id,
            invoiceNumber: r.invoice_number,
            invoiceDate: r.invoice_date,
            grandTotal: parseFloat(r.grand_total || '0'),
            dealerBusinessId: r.dealer_business_id,
            dealerName: r.dealer_business_name || r.customer_name,
            dealerOrderNumber: r.dealer_order_number,
            totalQuantity: totalQty,
            dispatchedQuantity: dispatchedQty,
            remainingQuantity: remainingQty,
            isFullyDispatched: remainingQty <= 0 && totalQty > 0,
          };
        })
        .filter(inv => inv.remainingQuantity > 0 || inv.totalQuantity === 0);

      res.json({
        success: true,
        invoices: eligible,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/shipments/eligible-invoices Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch eligible invoices' });
    }
  }
);

/**
 * POST /api/dealer/shipments
 * Create a new dispatch shipment from Main Warehouse to Dealer
 */
router.post(
  '/shipments',
  requireAnyPermission(['sales:create', 'sales.create', 'sales.order.create', 'sales:order:create', 'master:edit']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;
      const {
        dealerBusinessId,
        mainSalesInvoiceId,
        mainSalesOrderId,
        dealerOrderId,
        dispatchDate,
        courierName,
        trackingNumber,
        vehicleNumber,
        ewayBillNumber,
        totalPackages,
        notes,
        lines,
      } = req.body;

      if (!mainSalesInvoiceId && !dealerOrderId) {
        res.status(400).json({ error: 'A valid Sales Invoice or Dealer Order is required for dispatch.' });
        return;
      }

      const result = await DealerLogisticsService.createShipment({
        mainBusinessId: currentBizId,
        dealerBusinessId,
        mainSalesInvoiceId,
        mainSalesOrderId,
        dealerOrderId,
        dispatchDate,
        courierName,
        trackingNumber,
        vehicleNumber,
        ewayBillNumber,
        totalPackages: totalPackages ? parseInt(String(totalPackages), 10) : 1,
        notes,
        lines,
        userId: req.user!.id,
      });

      await recordAuditLog({
        businessId: currentBizId,
        userId: req.user!.id,
        action: 'CREATE',
        module: 'DEALER_LOGISTICS',
        entityType: 'dealer_shipments',
        entityId: result.shipment.id,
        newValue: {
          shipmentNumber: result.shipment.shipment_number,
          dealerBusinessId: result.shipment.dealer_business_id,
          totalQuantity: result.shipment.total_quantity,
          courierName,
          trackingNumber,
        },
      });

      res.status(201).json(result);
    } catch (error: any) {
      console.error('[POST /api/dealer/shipments Error]', error);
      res.status(400).json({ error: error.message || 'Failed to create dispatch shipment' });
    }
  }
);

/**
 * GET /api/dealer/shipments/main
 * List all dispatches created by the Main Warehouse
 */
router.get(
  '/shipments/main',
  requireAnyPermission(['sales:view', 'sales.view', 'sales.order.view', 'sales:order:view', 'master:view']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;
      const status = req.query.status as string;
      const search = req.query.search as string;

      const shipments = await DealerLogisticsService.listShipmentsForMain(currentBizId, { status, search });

      res.json({
        success: true,
        shipments: shipments.map(s => ({
          id: s.id,
          shipmentNumber: s.shipment_number,
          dispatchDate: s.dispatch_date,
          status: s.status,
          dealerBusinessId: s.dealer_business_id,
          dealerBusinessName: s.dealer_business_name,
          dealerTradeName: s.dealer_trade_name,
          dealerCity: s.dealer_city,
          salesInvoiceNumber: s.sales_invoice_number,
          salesOrderNumber: s.sales_order_number,
          dealerOrderNumber: s.dealer_order_number,
          courierName: s.courier_name,
          trackingNumber: s.tracking_number,
          vehicleNumber: s.vehicle_number,
          ewayBillNumber: s.eway_bill_number,
          totalPackages: parseFloat(s.total_packages || '1'),
          totalQuantity: parseFloat(s.total_quantity || '0'),
          totalReceivedQuantity: parseFloat(s.total_received_quantity || '0'),
          lineCount: parseInt(s.line_count || '0', 10),
          notes: s.notes,
          createdAt: s.created_at,
        })),
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/shipments/main Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch shipments' });
    }
  }
);

/**
 * GET /api/dealer/shipments/incoming
 * List all incoming shipments destined for the calling Dealer business
 */
router.get(
  '/shipments/incoming',
  requireAnyPermission(['purchase:view', 'purchase.view', 'inventory:view', 'sales:view', 'master:view']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;
      const status = req.query.status as string;
      const search = req.query.search as string;

      const shipments = await DealerLogisticsService.listIncomingShipmentsForDealer(currentBizId, { status, search });

      res.json({
        success: true,
        shipments: shipments.map(s => ({
          id: s.id,
          shipmentNumber: s.shipment_number,
          dispatchDate: s.dispatch_date,
          status: s.status,
          mainBusinessId: s.main_business_id,
          mainWarehouseName: s.main_warehouse_name,
          mainWarehouseTradeName: s.main_warehouse_trade_name,
          mainWarehouseCity: s.main_warehouse_city,
          salesInvoiceNumber: s.sales_invoice_number,
          dealerOrderNumber: s.dealer_order_number,
          courierName: s.courier_name,
          trackingNumber: s.tracking_number,
          vehicleNumber: s.vehicle_number,
          ewayBillNumber: s.eway_bill_number,
          totalPackages: parseFloat(s.total_packages || '1'),
          totalQuantity: parseFloat(s.total_quantity || '0'),
          totalReceivedQuantity: parseFloat(s.total_received_quantity || '0'),
          totalDamagedQuantity: parseFloat(s.total_damaged_quantity || '0'),
          totalShortQuantity: parseFloat(s.total_short_quantity || '0'),
          lineCount: parseInt(s.line_count || '0', 10),
          notes: s.notes,
          createdAt: s.created_at,
        })),
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/shipments/incoming Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch incoming shipments' });
    }
  }
);

/**
 * GET /api/dealer/shipments/:id
 * Retrieve details of a shipment (accessible by Main Warehouse or recipient Dealer)
 */
router.get(
  '/shipments/:id',
  requireAnyPermission(['sales:view', 'sales.view', 'purchase:view', 'purchase.view', 'inventory:view', 'master:view']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;
      const shipmentId = req.params.id;

      const details = await DealerLogisticsService.getShipmentDetails(shipmentId, currentBizId);

      res.json({
        success: true,
        ...details,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/shipments/:id Error]', error);
      res.status(404).json({ error: error.message || 'Failed to fetch shipment details' });
    }
  }
);

/**
 * POST /api/dealer/shipments/:id/receive
 * Dealer confirms Goods Receipt (GRN), performs physical count (Good, Damaged, Short),
 * adds good items to Dealer local stock, and generates Dealer Purchase Invoice & accounts payable.
 */
router.post(
  '/shipments/:id/receive',
  requireAnyPermission(['purchase:create', 'purchase.create', 'inventory:edit', 'master:edit', 'sales:create']),
  async (req: Request, res: Response) => {
    try {
      const currentBizId = req.user!.currentBusinessId;
      const shipmentId = req.params.id;
      const { receiptDate, remarks, lines } = req.body;

      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        res.status(400).json({ error: 'Inspection lines are required to confirm goods receipt.' });
        return;
      }

      const result = await DealerLogisticsService.confirmDealerGoodsReceipt({
        dealerBusinessId: currentBizId,
        dealerShipmentId: shipmentId,
        receiptDate,
        remarks,
        lines,
        userId: req.user!.id,
      });

      await recordAuditLog({
        businessId: currentBizId,
        userId: req.user!.id,
        action: 'CREATE',
        module: 'DEALER_LOGISTICS',
        entityType: 'dealer_goods_receipts',
        entityId: result.goodsReceiptId,
        newValue: {
          receiptNumber: result.receiptNumber,
          shipmentId,
          totalGoodReceived: result.totalGoodReceived,
          totalDamaged: result.totalDamaged,
          totalShort: result.totalShort,
          purchaseInvoiceId: result.purchaseInvoiceId,
        },
      });

      res.status(200).json(result);
    } catch (error: any) {
      console.error('[POST /api/dealer/shipments/:id/receive Error]', error);
      res.status(400).json({ error: error.message || 'Failed to confirm goods receipt' });
    }
  }
);

/**
 * GET /api/dealer/dashboard/summary
 * Purpose-built Dealer operations dashboard KPIs and feeds
 */
router.get(
  '/dashboard/summary',
  requireAnyPermission(['inventory:view', 'inventory.view', 'sales:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      let dealerBizId = req.user!.currentBusinessId;
      if (req.user?.isSuperAdmin && req.query.dealerBusinessId) {
        dealerBizId = req.query.dealerBusinessId as string;
      }

      if (!dealerBizId) {
        res.status(400).json({ error: 'No active business selected.' });
        return;
      }

      const summary = await DealerDashboardService.getDealerDashboardSummary(dealerBizId);
      res.json({
        success: true,
        ...summary,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/dashboard/summary Error]', error);
      res.status(error.message?.includes('not a DEALER') ? 403 : 500).json({
        error: error.message || 'Failed to fetch dealer dashboard summary',
      });
    }
  }
);

/**
 * GET /api/dealer/dashboard/search
 * Fast search of parent Main Warehouse available optical stock
 */
router.get(
  '/dashboard/search',
  requireAnyPermission(['inventory:view', 'inventory.view', 'sales:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      let dealerBizId = req.user!.currentBusinessId;
      if (req.user?.isSuperAdmin && req.query.dealerBusinessId) {
        dealerBizId = req.query.dealerBusinessId as string;
      }

      const q = (req.query.q as string) || '';
      const limit = parseInt(req.query.limit as string, 10) || 8;

      const result = await DealerDashboardService.searchMainAvailability(dealerBizId, q, limit);
      res.json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/dashboard/search Error]', error);
      res.status(500).json({ error: error.message || 'Failed to search Main Warehouse availability' });
    }
  }
);

/**
 * GET /api/dealer/settings/stock-sharing
 * Get current stock sharing setting for this Dealer
 */
router.get(
  '/settings/stock-sharing',
  requireAnyPermission(['admin:manage_settings', 'inventory:view', 'sales:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      let dealerBizId = req.user!.currentBusinessId;
      if (req.user?.isSuperAdmin && req.query.dealerBusinessId) {
        dealerBizId = req.query.dealerBusinessId as string;
      }

      const settings = await BusinessSettingsService.getSettings(dealerBizId);
      const shareStockWithMain = Boolean(settings.settings?.dealer?.shareStockWithMain);

      res.json({
        success: true,
        shareStockWithMain,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/settings/stock-sharing Error]', error);
      res.status(500).json({ error: error.message || 'Failed to get stock sharing setting' });
    }
  }
);

/**
 * POST /api/dealer/settings/stock-sharing
 * Update stock sharing setting for this Dealer
 */
router.post(
  '/settings/stock-sharing',
  requireAnyPermission(['admin:manage_settings', 'business:edit', 'admin:manage_roles']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      let dealerBizId = req.user!.currentBusinessId;
      if (req.user?.isSuperAdmin && req.body.dealerBusinessId) {
        dealerBizId = req.body.dealerBusinessId as string;
      }

      const { shareStockWithMain } = req.body;
      if (typeof shareStockWithMain !== 'boolean') {
        res.status(400).json({ error: 'shareStockWithMain must be a boolean.' });
        return;
      }

      const current = await BusinessSettingsService.getSettings(dealerBizId);
      const updatedSettings = {
        ...current.settings,
        dealer: {
          ...(current.settings.dealer || {}),
          shareStockWithMain,
        },
      };

      await BusinessSettingsService.updateSettings(
        dealerBizId,
        { settings: updatedSettings },
        req.user!.id,
        req
      );

      // Keep businesses.settings_config in sync as well
      await pool.query(
        `UPDATE businesses SET settings_config = jsonb_set(COALESCE(settings_config, '{}'::jsonb), '{dealer}', COALESCE(settings_config->'dealer', '{}'::jsonb) || jsonb_build_object('shareStockWithMain', $1::boolean)) WHERE id = $2`,
        [shareStockWithMain, dealerBizId]
      );

      res.json({
        success: true,
        shareStockWithMain,
        message: shareStockWithMain
          ? 'Stock visibility sharing enabled with Main Warehouse. Quantities are visible, but prices and margins remain private.'
          : 'Stock visibility sharing disabled. Local inventory is now private.',
      });
    } catch (error: any) {
      console.error('[POST /api/dealer/settings/stock-sharing Error]', error);
      res.status(500).json({ error: error.message || 'Failed to update stock sharing setting' });
    }
  }
);

/* =========================================================================
   PHASE 4C: DEALER ONBOARDING & FIRST-LOGIN EXPERIENCE
   ========================================================================= */

const requireDealerBusiness = (req: Request, res: Response, next: () => void): void => {
  if (req.user?.currentBusiness?.businessType !== 'DEALER') {
    res.status(403).json({ error: 'Access denied. Dealer onboarding is exclusively for Dealer businesses.' });
    return;
  }
  next();
};

/**
 * GET /api/dealer/onboarding/status
 * Check if the current dealer has completed onboarding & retrieve setup information
 */
router.get(
  '/onboarding/status',
  requireDealerBusiness,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const status = await DealerOnboardingService.getOnboardingStatus(dealerBizId, req.user!);
      res.json(status);
    } catch (error: any) {
      console.error('[GET /api/dealer/onboarding/status Error]', error);
      res.status(500).json({ error: error.message || 'Failed to get dealer onboarding status' });
    }
  }
);

/**
 * POST /api/dealer/onboarding/start
 * Log that onboarding has been started/viewed
 */
router.post(
  '/onboarding/start',
  requireDealerBusiness,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const result = await DealerOnboardingService.startOnboarding(dealerBizId, req.user!, req);
      res.json(result);
    } catch (error: any) {
      console.error('[POST /api/dealer/onboarding/start Error]', error);
      res.status(500).json({ error: error.message || 'Failed to start dealer onboarding' });
    }
  }
);

/**
 * PUT /api/dealer/onboarding/business-details
 * Update master business details during Step 2 of onboarding
 */
router.put(
  '/onboarding/business-details',
  requireDealerBusiness,
  requireAnyPermission(['admin:manage_settings', 'business:edit', 'admin:manage_roles']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const result = await DealerOnboardingService.updateBusinessDetails(dealerBizId, req.user!, req.body, req);
      res.json(result);
    } catch (error: any) {
      console.error('[PUT /api/dealer/onboarding/business-details Error]', error);
      res.status(400).json({ error: error.message || 'Failed to update business details' });
    }
  }
);

/**
 * POST /api/dealer/onboarding/preferences
 * Update inventory & stock sharing preferences during Step 4
 */
router.post(
  '/onboarding/preferences',
  requireDealerBusiness,
  requireAnyPermission(['admin:manage_settings', 'business:edit', 'admin:manage_roles']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const result = await DealerOnboardingService.updatePreferences(dealerBizId, req.user!, req.body, req);
      res.json(result);
    } catch (error: any) {
      console.error('[POST /api/dealer/onboarding/preferences Error]', error);
      res.status(400).json({ error: error.message || 'Failed to update onboarding preferences' });
    }
  }
);

/**
 * POST /api/dealer/onboarding/complete
 * Complete onboarding and mark dealer as onboarded
 */
router.post(
  '/onboarding/complete',
  requireDealerBusiness,
  requireAnyPermission(['admin:manage_settings', 'business:edit', 'admin:manage_roles']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const result = await DealerOnboardingService.completeOnboarding(dealerBizId, req.user!, req);
      res.json(result);
    } catch (error: any) {
      console.error('[POST /api/dealer/onboarding/complete Error]', error);
      res.status(400).json({ error: error.message || 'Failed to complete dealer onboarding' });
    }
  }
);

/* =========================================================================
   PHASE 3E: DEALER RETURNS → MAIN WAREHOUSE RETURN LIFECYCLE
   ========================================================================= */

/**
 * GET /api/dealer/returns/returnable-invoices
 * List of eligible Purchase Invoices from Main Warehouse that Dealer can return against
 */
router.get(
  '/returns/returnable-invoices',
  requireAnyPermission(['purchases:view', 'inventory:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const context = await resolveMainWarehouseContext(req);
      if ('error' in context) {
        res.status(context.status).json({ error: context.error });
        return;
      }

      const client = await pool.connect();
      try {
        const invoicesRes = await client.query(
          `SELECT 
             pi.id,
             pi.invoice_number,
             pi.invoice_date,
             pi.supplier_invoice_number,
             pi.grand_total,
             pi.status,
             p.name as supplier_name,
             p.trade_name as supplier_trade_name,
             pi.created_at,
             COUNT(pil.id) as lines_count,
             COALESCE(SUM(pil.quantity), 0)::numeric(12, 2) as total_quantity
           FROM purchase_invoices pi
           JOIN parties p ON pi.supplier_party_id = p.id
           JOIN purchase_invoice_lines pil ON pi.id = pil.purchase_invoice_id
           WHERE pi.business_id = $1 
             AND pi.status = 'POSTED'
           GROUP BY pi.id, p.name, p.trade_name
           ORDER BY pi.invoice_date DESC, pi.created_at DESC
           LIMIT 50`,
          [dealerBizId]
        );

        res.json({
          success: true,
          invoices: invoicesRes.rows.map(r => ({
            ...r,
            grand_total: parseFloat(r.grand_total || '0'),
            total_quantity: parseFloat(r.total_quantity || '0'),
            lines_count: parseInt(r.lines_count || '0', 10),
          })),
        });
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error('[GET /api/dealer/returns/returnable-invoices Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch returnable invoices' });
    }
  }
);

/**
 * GET /api/dealer/returns/returnable-invoice/:invoiceId
 * Optical breakdown of lines and batches with maximum returnable calculation
 */
router.get(
  '/returns/returnable-invoice/:invoiceId',
  requireAnyPermission(['purchases:view', 'inventory:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { invoiceId } = req.params;

      const summary = await DealerReturnService.getReturnablePurchaseInvoice(dealerBizId, invoiceId);
      res.json({
        success: true,
        ...summary,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/returns/returnable-invoice/:invoiceId Error]', error);
      res.status(400).json({ error: error.message || 'Failed to load returnable invoice details' });
    }
  }
);

/**
 * GET /api/dealer/returns
 * List all Dealer Returns created by this dealer
 */
router.get(
  '/returns',
  requireAnyPermission(['purchases:view', 'inventory:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { status, search } = req.query;

      const returns = await DealerReturnService.getDealerReturnsList(dealerBizId, false, {
        status: status as string,
        search: search as string,
      });

      res.json({
        success: true,
        returns,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/returns Error]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch returns' });
    }
  }
);

/**
 * GET /api/dealer/returns/:returnId
 * Detailed view of single return
 */
router.get(
  '/returns/:returnId',
  requireAnyPermission(['purchases:view', 'inventory:view', 'master:view']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { returnId } = req.params;

      const returnDoc = await DealerReturnService.getDealerReturnById(dealerBizId, returnId, false);
      res.json({
        success: true,
        dealerReturn: returnDoc,
      });
    } catch (error: any) {
      console.error('[GET /api/dealer/returns/:returnId Error]', error);
      res.status(404).json({ error: error.message || 'Return not found' });
    }
  }
);

/**
 * POST /api/dealer/returns
 * Create new Dealer Return Request against Purchase Invoice
 */
router.post(
  '/returns',
  requireAnyPermission(['purchase:create', 'purchases:create', 'purchase.create', 'inventory:manage', 'inventory:create']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const createdReturn = await DealerReturnService.createDealerReturnRequest(
        dealerBizId,
        req.body,
        req.user?.id
      );

      res.status(201).json({
        success: true,
        message: `Return request ${createdReturn.return_number} submitted to Main Warehouse for approval.`,
        dealerReturn: createdReturn,
      });
    } catch (error: any) {
      console.error('[POST /api/dealer/returns Error]', error);
      res.status(400).json({ error: error.message || 'Failed to create return request' });
    }
  }
);

/**
 * POST /api/dealer/returns/:returnId/dispatch
 * Dispatch approved items. Invokes PurchaseReturnService to decrement stock.
 */
router.post(
  '/returns/:returnId/dispatch',
  requireAnyPermission(['purchase:create', 'purchases:create', 'purchase.create', 'inventory:manage', 'inventory:create']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { returnId } = req.params;

      const dispatchedReturn = await DealerReturnService.dispatchDealerReturn(
        dealerBizId,
        returnId,
        req.body,
        req.user?.id
      );

      res.json({
        success: true,
        message: `Return ${dispatchedReturn.return_number} dispatched. Dealer stock deducted and Purchase Return posted.`,
        dealerReturn: dispatchedReturn,
      });
    } catch (error: any) {
      console.error('[POST /api/dealer/returns/:returnId/dispatch Error]', error);
      res.status(400).json({ error: error.message || 'Failed to dispatch return' });
    }
  }
);

/**
 * POST /api/dealer/returns/:returnId/cancel
 * Cancel return request before dispatch
 */
router.post(
  '/returns/:returnId/cancel',
  requireAnyPermission(['purchase:create', 'purchases:create', 'purchase.create', 'inventory:manage', 'inventory:create']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { returnId } = req.params;
      const { reason } = req.body;

      const cancelledReturn = await DealerReturnService.cancelDealerReturn(
        dealerBizId,
        returnId,
        reason,
        req.user?.id
      );

      res.json({
        success: true,
        message: `Return ${cancelledReturn.return_number} cancelled.`,
        dealerReturn: cancelledReturn,
      });
    } catch (error: any) {
      console.error('[POST /api/dealer/returns/:returnId/cancel Error]', error);
      res.status(400).json({ error: error.message || 'Failed to cancel return' });
    }
  }
);

// ============================================================================
// PHASE 3F: DEALER PAYMENTS & PAYMENT ADVICES
// ============================================================================

/**
 * GET /api/dealer/payments/unpaid-invoices
 * Returns all unpaid or partially paid purchase invoices for the Main-linked supplier party,
 * along with current outstanding balance and pending verification amount.
 */
router.get(
  '/payments/unpaid-invoices',
  requireAnyPermission([
    'payment.supplier.view',
    'payment:supplier:view',
    'accounts:view',
    'accounts.view',
    'purchases:view',
    'inventory:view',
    'sales:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const result = await DealerPaymentService.getDealerUnpaidInvoices(dealerBizId);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[GET /api/dealer/payments/unpaid-invoices Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch unpaid invoices' });
    }
  }
);

/**
 * POST /api/dealer/payments/check-duplicate
 * Checks if a payment with the same reference number and amount was recently submitted.
 */
router.post(
  '/payments/check-duplicate',
  requireAnyPermission([
    'payment.supplier.create',
    'payment:supplier:create',
    'accounts:create',
    'purchases:create',
    'inventory:manage',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { amount, referenceNumber, paymentDate } = req.body;
      const result = await DealerPaymentService.checkDuplicatePayment(dealerBizId, {
        amount: parseFloat(amount) || 0,
        referenceNumber,
        paymentDate,
      });
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[POST /api/dealer/payments/check-duplicate Error]', error);
      res.status(400).json({ error: error.message || 'Duplicate check failed' });
    }
  }
);

/**
 * POST /api/dealer/payments/advices
 * Submit a payment advice: posts authoritative Supplier Payment in Dealer's ledger,
 * updates purchase invoices, and creates pending advice record for Main Warehouse.
 */
router.post(
  '/payments/advices',
  requireAnyPermission([
    'payment.supplier.create',
    'payment:supplier:create',
    'accounts:create',
    'purchases:create',
    'inventory:manage',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const userId = req.user?.id || '';
      const {
        paymentDate,
        paymentMode,
        amount,
        referenceNumber,
        bankName,
        chequeNumber,
        chequeDate,
        notes,
        allocations,
      } = req.body;

      if (!amount || parseFloat(amount) <= 0) {
        res.status(400).json({ error: 'Valid payment amount is required.' });
        return;
      }
      if (!paymentMode) {
        res.status(400).json({ error: 'Payment mode is required.' });
        return;
      }

      const result = await DealerPaymentService.submitDealerPaymentAdvice(
        dealerBizId,
        userId,
        {
          paymentDate: paymentDate || new Date().toISOString(),
          paymentMode,
          amount: parseFloat(amount),
          referenceNumber,
          bankName,
          chequeNumber,
          chequeDate,
          notes,
          allocations: Array.isArray(allocations) ? allocations : [],
        }
      );

      res.status(201).json({
        success: true,
        message: `Payment advice ${result.adviceNumber} submitted successfully. Supplier Payment ${result.dealerPaymentNumber} recorded.`,
        ...result,
      });
    } catch (error: any) {
      console.error('[POST /api/dealer/payments/advices Error]', error);
      res.status(400).json({ error: error.message || 'Failed to submit payment advice' });
    }
  }
);

/**
 * GET /api/dealer/payments/advices
 * List all payment advices submitted by this dealer.
 */
router.get(
  '/payments/advices',
  requireAnyPermission([
    'payment.supplier.view',
    'payment:supplier:view',
    'accounts:view',
    'accounts.view',
    'purchases:view',
    'inventory:view',
    'sales:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { status, fromDate, toDate, search, page, limit } = req.query;

      const result = await DealerPaymentService.getPaymentAdvices(dealerBizId, false, {
        status: status as string,
        fromDate: fromDate as string,
        toDate: toDate as string,
        search: search as string,
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[GET /api/dealer/payments/advices Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch payment advices' });
    }
  }
);

/**
 * GET /api/dealer/payments/advices/:id
 * Retrieve details of a specific payment advice.
 */
router.get(
  '/payments/advices/:id',
  requireAnyPermission([
    'payment.supplier.view',
    'payment:supplier:view',
    'accounts:view',
    'accounts.view',
    'purchases:view',
    'inventory:view',
    'sales:view',
  ]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dealerBizId = req.user!.currentBusinessId;
      const { id } = req.params;

      const result = await DealerPaymentService.getPaymentAdviceDetails(dealerBizId, id, false);
      res.json({ success: true, advice: result });
    } catch (error: any) {
      console.error('[GET /api/dealer/payments/advices/:id Error]', error);
      res.status(400).json({ error: error.message || 'Failed to fetch payment advice details' });
    }
  }
);

export default router;


