import assert from 'node:assert/strict';
import { resolveOrderReservationSettings } from '../services/orderReservationSettings.js';
import { BusinessSettingsService, DEFAULT_APP_SETTINGS } from '../services/businessSettingsService.js';
import { pool } from '../db/index.js';

const originalGet = BusinessSettingsService.getSettings;
try {
  let legacyCases = 0;
  // All old-key conflicts retain the exact old effective engine behavior.
  for (const inventoryReserve of [false, true]) for (const inventoryBeyond of [false, true]) {
    for (const legacyReserve of [false, true]) for (const legacyBeyond of [false, true]) {
      for (const enableOrders of [false, true]) {
        const raw = {
          inventory: { reserveStockOnSalesOrder: inventoryReserve, allowOrderBeyondAvailable: inventoryBeyond },
          salesOrder: { reserveStockOnSalesOrder: legacyReserve, allowOrderBeyondAvailable: legacyBeyond },
          orders: { enableSalesOrders: enableOrders },
        };
        const before = JSON.stringify(raw);
        const policy = resolveOrderReservationSettings(raw);
        assert.equal(policy.salesOrdersEnabled && policy.reserveStock, enableOrders);
        assert.equal(policy.allowBeyondAvailable, legacyBeyond);
        assert.equal(JSON.stringify(raw), before);
        legacyCases++;
      }
    }
  }
  for (const enabled of [false, true]) for (const allowBeyond of [false, true]) {
    for (const enableOrders of [false, true]) {
      const raw = { inventory: { reservationControlsVersion: 1, reserveStockOnSalesOrder: enabled, allowOrderBeyondAvailable: allowBeyond },
        salesOrder: { reserveStockOnSalesOrder: !enabled, allowOrderBeyondAvailable: !allowBeyond },
        orders: { enableSalesOrders: enableOrders } };
      BusinessSettingsService.getSettings = async () => ({ lowStockThreshold: 1, config: { settings: raw }, settings: DEFAULT_APP_SETTINGS });
      assert.equal(await BusinessSettingsService.isOrderReservationEnabled('local-fixture'), enabled && enableOrders);
      assert.equal(await BusinessSettingsService.isAllowOrderBeyondAvailable('local-fixture'), allowBeyond);
    }
  }
  for (const behavior of ['OFF', 'WARNING', 'BLOCK'] as const) {
    const settings = { ...DEFAULT_APP_SETTINGS, party: { ...DEFAULT_APP_SETTINGS.party, creditLimitBehavior: behavior } };
    BusinessSettingsService.getSettings = async () => ({ lowStockThreshold: 1, config: { settings }, settings });
    assert.equal(await BusinessSettingsService.getCreditLimitBehavior('local-fixture'), behavior);
  }
  console.log(`PASS ${legacyCases} legacy conflict combinations preserve old policy, 8 explicit-edit combinations, credit getters, no input mutation`);
} finally {
  BusinessSettingsService.getSettings = originalGet;
  await pool.end();
}
