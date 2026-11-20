import assert from 'node:assert/strict';
import { PartyService } from '../services/partyService.js';
import { SalesService } from '../services/salesService.js';
import { BusinessSettingsService, DEFAULT_APP_SETTINGS } from '../services/businessSettingsService.js';
import { pool } from '../db/index.js';

if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432/erp_adminfix')) throw new Error('Local disposable clone required');
const saved = BusinessSettingsService.getSettings;
const ids: string[] = [];
let behavior: 'OFF' | 'WARNING' | 'BLOCK' = 'WARNING';
try {
  const { rows: [business] } = await pool.query('SELECT business_id FROM sales_invoices LIMIT 1');
  BusinessSettingsService.getSettings = async () => {
    const settings = { ...DEFAULT_APP_SETTINGS, party: { ...DEFAULT_APP_SETTINGS.party, creditLimitBehavior: behavior, defaultCreditLimit: 123 } };
    return { lowStockThreshold: 1, config: { settings }, settings };
  };
  for (const input of [
    { name: 'LOCAL ADMIN DEFAULT FIXTURE', partyType: 'CUSTOMER' as const },
    { name: 'LOCAL ADMIN ZERO FIXTURE', partyType: 'CUSTOMER' as const, creditLimit: 0 },
    { name: 'LOCAL ADMIN SUPPLIER FIXTURE', partyType: 'SUPPLIER' as const },
  ]) {
    const row = await PartyService.createParty(business.business_id, input);
    ids.push(row.id);
  }
  const { rows } = await pool.query('SELECT id, credit_limit FROM parties WHERE id=ANY($1)', [ids]);
  const limits = new Map(rows.map(r => [r.id, Number(r.credit_limit)]));
  assert.equal(limits.get(ids[0]), 123);
  assert.equal(limits.get(ids[1]), 0);
  assert.equal(limits.get(ids[2]), 0);
  behavior = 'BLOCK';
  assert.equal((await SalesService.checkCreditLimit(business.business_id, ids[0], 124)).allowed, false);
  behavior = 'WARNING';
  const warning = await SalesService.checkCreditLimit(business.business_id, ids[0], 124);
  assert.equal(warning.allowed, true);assert.ok(warning.warning);
  behavior = 'OFF';
  const off = await SalesService.checkCreditLimit(business.business_id, ids[0], 124);
  assert.equal(off.allowed, true);assert.equal(off.warning, undefined);
  console.log('PASS actual service creation defaults, explicit zero, supplier zero; actual sale credit BLOCK/WARNING/OFF without invoice creation');
} finally {
  BusinessSettingsService.getSettings = saved;
  if (ids.length) {
    await pool.query('DELETE FROM audit_logs WHERE entity_id=ANY($1)', [ids]);
    await pool.query('DELETE FROM parties WHERE id=ANY($1)', [ids]);
  }
  await pool.end();
}
