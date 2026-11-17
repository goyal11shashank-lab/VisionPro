import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { pool } from '../db/index.js';
import { ReportService } from '../services/reportService.js';
import { ExportService } from '../services/exportService.js';
import { BusinessSettingsService } from '../services/businessSettingsService.js';

interface MockStockRow {
  business_id: string;
  batch_id: string;
  godown_id: string | null;
  physical_stock: number;
  reserved_stock: number;
  // Intentionally stale/mismatched stored available_stock to prove queries compute (physical_stock - reserved_stock)
  available_stock: number;
}

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const BATCH_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BATCH_NO_STOCK = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GODOWN_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const GODOWN_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const mockStockRows: MockStockRow[] = [
  // Business A, Batch 1 across Main (NULL), Secondary A, Secondary B
  // Stored available_stock is intentionally poisoned (999) to ensure computed expression is used
  { business_id: BIZ_A, batch_id: BATCH_1, godown_id: null, physical_stock: -10, reserved_stock: 0, available_stock: 999 },
  { business_id: BIZ_A, batch_id: BATCH_1, godown_id: GODOWN_A, physical_stock: 4, reserved_stock: 1, available_stock: 999 },
  { business_id: BIZ_A, batch_id: BATCH_1, godown_id: GODOWN_B, physical_stock: 8, reserved_stock: 2, available_stock: 999 },
  // Business B isolation row (must never leak into Business A)
  { business_id: BIZ_B, batch_id: BATCH_1, godown_id: null, physical_stock: 500, reserved_stock: 10, available_stock: 490 },
];

function computeFromMock(businessId: string, godownId?: string) {
  const batches = [
    { batch_id: BATCH_1, barcode: 'BC-001', unique_item_name: 'SV Lens', sku: 'SV-01', mrp: '500', category_code: 'SV', category_name: 'Single Vision' },
    { batch_id: BATCH_NO_STOCK, barcode: 'BC-002', unique_item_name: 'SV Lens Empty', sku: 'SV-02', mrp: '500', category_code: 'SV', category_name: 'Single Vision' },
  ];

  return batches.map((b) => {
    let scoped = mockStockRows.filter((r) => r.business_id === businessId && r.batch_id === b.batch_id);
    if (godownId === 'MAIN' || godownId === 'null' || godownId === 'MAIN_WAREHOUSE') {
      scoped = scoped.filter((r) => r.godown_id === null);
    } else if (godownId && godownId !== 'ALL' && godownId !== '') {
      scoped = scoped.filter((r) => r.godown_id === godownId);
    }
    const physical = scoped.reduce((sum, r) => sum + r.physical_stock, 0);
    const reserved = scoped.reduce((sum, r) => sum + r.reserved_stock, 0);
    const available = scoped.reduce((sum, r) => sum + (r.physical_stock - r.reserved_stock), 0);
    return {
      ...b,
      sph: '0',
      cyl: '0',
      axis: '0',
      add: '0',
      side: 'NONE',
      unique_item_id: 'item-1',
      primary_item_id: null,
      primary_item_name: 'Brand',
      physical_stock: String(physical),
      reserved_stock: String(reserved),
      available_stock: String(available),
      is_low_stock: physical > 0 && physical <= 1,
      is_negative_stock: physical < 0,
    };
  });
}

async function runUnitTests() {
  const capturedQueries: Array<{ sql: string; params: any[] }> = [];
  const originalQuery = pool.query.bind(pool);
  const originalGetSettings = BusinessSettingsService.getSettings.bind(BusinessSettingsService);

  (BusinessSettingsService as any).getSettings = async () => ({
    lowStockThreshold: 1,
    config: {},
    settings: {},
  });

  (pool as any).query = async (sql: string, params: any[] = []) => {
    capturedQueries.push({ sql, params });
    const businessId = params[0];
    // Extract godownId based on query pattern
    let godownMode: string | undefined;
    if (sql.includes('WHERE business_id = $1 AND godown_id IS NULL')) {
      godownMode = 'MAIN';
    } else if (sql.includes('WHERE business_id = $1 AND godown_id = $2')) {
      godownMode = params[1];
    } else {
      godownMode = 'ALL';
    }

    const rows = computeFromMock(businessId, godownMode);

    if (sql.includes('AS total_batches')) {
      return {
        rows: [
          {
            total_batches: String(rows.length),
            total_physical: String(rows.reduce((s, r) => s + Number(r.physical_stock), 0)),
            total_reserved: String(rows.reduce((s, r) => s + Number(r.reserved_stock), 0)),
            total_available: String(rows.reduce((s, r) => s + Number(r.available_stock), 0)),
          },
        ],
      };
    }

    if (sql.includes('AS "Barcode"')) {
      return {
        rows: rows.map((r) => ({
          Barcode: r.barcode,
          'Product Name': r.unique_item_name,
          SKU: r.sku,
          Category: r.category_name,
          Brand: r.primary_item_name,
          SPH: r.sph,
          CYL: r.cyl,
          AXIS: r.axis,
          ADD: r.add,
          SIDE: r.side,
          Quantity: r.physical_stock,
          'Physical Stock': r.physical_stock,
          'Reserved Stock': r.reserved_stock,
          'Available Stock': r.available_stock,
          MRP: r.mrp,
          'Stock Status': Number(r.physical_stock) < 0 ? 'NEGATIVE_STOCK' : Number(r.physical_stock) === 0 ? 'ZERO_STOCK' : 'IN_STOCK',
        })),
      };
    }

    return { rows };
  };

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  }

  try {
    console.log('=== Unit Tests: Inventory Report & Export Godown-Aware SQL & Calculations ===');

    await test('1. ReportService.getInventoryReport() ALL godowns aggregates across all godowns (+2, 3, -1)', async () => {
      capturedQueries.length = 0;
      const res = await ReportService.getInventoryReport(BIZ_A, {});
      assert.equal(capturedQueries.length, 2, 'Should run summaryQuery and dataQuery');
      for (const q of capturedQueries) {
        assert.match(q.sql, /WITH aggregated_stock AS/);
        assert.match(q.sql, /SUM\(physical_stock - reserved_stock\) AS available_stock/);
        assert.match(q.sql, /GROUP BY batch_id, business_id/);
        assert.deepEqual(q.params.slice(0, 1), [BIZ_A]);
      }
      assert.equal(res.summary.totalBatches, 2);
      assert.equal(res.summary.totalPhysical, 2);
      assert.equal(res.summary.totalReserved, 3);
      assert.equal(res.summary.totalAvailable, -1);
      const b1 = res.data.find((d) => d.batchId === BATCH_1)!;
      assert.equal(b1.physicalStock, 2);
      assert.equal(b1.reservedStock, 3);
      assert.equal(b1.availableStock, -1);
      assert.equal(b1.stockStatus, 'IN_STOCK');
      const bEmpty = res.data.find((d) => d.batchId === BATCH_NO_STOCK)!;
      assert.equal(bEmpty.physicalStock, 0);
      assert.equal(bEmpty.availableStock, 0);
    });

    await test('2. ReportService.getInventoryReport() MAIN branch computes (physical_stock - reserved_stock) and filters godown_id IS NULL', async () => {
      for (const flag of ['MAIN', 'null', 'MAIN_WAREHOUSE']) {
        capturedQueries.length = 0;
        const res = await ReportService.getInventoryReport(BIZ_A, { godownId: flag });
        for (const q of capturedQueries) {
          assert.match(q.sql, /WHERE business_id = \$1 AND godown_id IS NULL/);
          assert.match(q.sql, /\(physical_stock - reserved_stock\) AS available_stock/);
          assert.doesNotMatch(q.sql, /SELECT[\s\S]*,\s*available_stock\s*FROM optical_stocks/);
        }
        const b1 = res.data.find((d) => d.batchId === BATCH_1)!;
        assert.equal(b1.physicalStock, -10);
        assert.equal(b1.reservedStock, 0);
        assert.equal(b1.availableStock, -10);
        assert.equal(b1.stockStatus, 'NEGATIVE_STOCK');
      }
    });

    await test('3. ReportService.getInventoryReport() SPECIFIC branch computes (physical_stock - reserved_stock) and binds godown UUID', async () => {
      capturedQueries.length = 0;
      const resA = await ReportService.getInventoryReport(BIZ_A, { godownId: GODOWN_A });
      for (const q of capturedQueries) {
        assert.match(q.sql, /WHERE business_id = \$1 AND godown_id = \$2/);
        assert.match(q.sql, /\(physical_stock - reserved_stock\) AS available_stock/);
        assert.equal(q.params[0], BIZ_A);
        assert.equal(q.params[1], GODOWN_A);
      }
      const b1A = resA.data.find((d) => d.batchId === BATCH_1)!;
      assert.equal(b1A.physicalStock, 4);
      assert.equal(b1A.reservedStock, 1);
      assert.equal(b1A.availableStock, 3);

      capturedQueries.length = 0;
      const resB = await ReportService.getInventoryReport(BIZ_A, { godownId: GODOWN_B });
      const b1B = resB.data.find((d) => d.batchId === BATCH_1)!;
      assert.equal(b1B.physicalStock, 8);
      assert.equal(b1B.reservedStock, 2);
      assert.equal(b1B.availableStock, 6);
    });

    await test('4. ExportService INVENTORY export computes (physical_stock - reserved_stock) in MAIN/SPECIFIC and matches report totals', async () => {
      for (const scope of ['ALL', 'MAIN', GODOWN_A, GODOWN_B]) {
        capturedQueries.length = 0;
        const exp = await ExportService.exportDataset(BIZ_A, 'INVENTORY', { godownId: scope });
        assert.equal(capturedQueries.length, 1);
        const q = capturedQueries[0];
        if (scope === 'ALL') {
          assert.match(q.sql, /SUM\(physical_stock - reserved_stock\) AS available_stock/);
        } else if (scope === 'MAIN') {
          assert.match(q.sql, /WHERE business_id = \$1 AND godown_id IS NULL/);
          assert.match(q.sql, /\(physical_stock - reserved_stock\) AS available_stock/);
        } else {
          assert.match(q.sql, /WHERE business_id = \$1 AND godown_id = \$2/);
          assert.match(q.sql, /\(physical_stock - reserved_stock\) AS available_stock/);
          assert.equal(q.params[1], scope);
        }

        const wb = XLSX.read(exp.buffer, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['Stock Summary']);
        const row1 = rows.find((r) => r['Barcode'] === 'BC-001')!;
        const report = await ReportService.getInventoryReport(BIZ_A, { godownId: scope });
        const repRow1 = report.data.find((d) => d.batchId === BATCH_1)!;
        assert.equal(Number(row1['Physical Stock']), repRow1.physicalStock);
        assert.equal(Number(row1['Reserved Stock']), repRow1.reservedStock);
        assert.equal(Number(row1['Available Stock']), repRow1.availableStock);
      }
    });

    console.log(`\nUnit Test Summary: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    (pool as any).query = originalQuery;
    (BusinessSettingsService as any).getSettings = originalGetSettings;
  }
}

runUnitTests().catch((err) => {
  console.error('Unit test runner crashed:', err);
  process.exit(1);
});
