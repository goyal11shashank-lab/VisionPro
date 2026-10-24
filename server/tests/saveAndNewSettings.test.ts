import { BusinessSettingsService } from '../services/businessSettingsService.js';
import { getOrCreateDedicatedTestBusiness } from './testBusinessHelper.js';
import { pool } from '../db/index.js';
import assert from 'assert';

async function runTest() {
  console.log('🧪 Starting Save & New Settings & Voucher Workflow Test...');

  const business = await getOrCreateDedicatedTestBusiness('TEST - Inventory Sandbox');
  const businessId = business.id;

  const userRes = await pool.query('SELECT id FROM users LIMIT 1');
  const testUserId = userRes.rows[0]?.id;

  // 1. Verify default value for showSuccessModalAfterSave is false
  console.log('--- 1. Testing Default Setting ---');
  const initialSettings = await BusinessSettingsService.getSettings(businessId);
  console.log('Initial showSuccessModalAfterSave:', initialSettings.settings?.voucher?.showSuccessModalAfterSave);
  assert.strictEqual(
    initialSettings.settings?.voucher?.showSuccessModalAfterSave ?? false,
    false,
    'Default for showSuccessModalAfterSave must be false (Off)'
  );
  console.log('✅ PASS: Default value is false (Off)');

  // 2. Test updating showSuccessModalAfterSave to true (On)
  console.log('--- 2. Testing Update to True (On) ---');
  const updateResult = await BusinessSettingsService.updateSettings(
    businessId,
    {
      settings: {
        ...initialSettings.settings,
        voucher: {
          ...initialSettings.settings.voucher,
          showSuccessModalAfterSave: true,
        },
      },
    },
    testUserId
  );
  assert.strictEqual(
    updateResult.settings.voucher.showSuccessModalAfterSave,
    true,
    'showSuccessModalAfterSave should update to true'
  );
  console.log('✅ PASS: Successfully updated setting to true (On)');

  // 3. Test persistence from clean database fetch
  console.log('--- 3. Testing Database Persistence ---');
  const reloaded = await BusinessSettingsService.getSettings(businessId);
  assert.strictEqual(
    reloaded.settings.voucher.showSuccessModalAfterSave,
    true,
    'showSuccessModalAfterSave must persist as true across database reloads'
  );
  console.log('✅ PASS: Setting persists in database');

  // 4. Test toggling back to false (Off)
  console.log('--- 4. Testing Toggle Back to False (Off) ---');
  const toggleBack = await BusinessSettingsService.updateSettings(
    businessId,
    {
      settings: {
        ...reloaded.settings,
        voucher: {
          ...reloaded.settings.voucher,
          showSuccessModalAfterSave: false,
        },
      },
    },
    testUserId
  );
  assert.strictEqual(
    toggleBack.settings.voucher.showSuccessModalAfterSave,
    false,
    'showSuccessModalAfterSave should update to false'
  );

  const reloadedFinal = await BusinessSettingsService.getSettings(businessId);
  assert.strictEqual(
    reloadedFinal.settings.voucher.showSuccessModalAfterSave,
    false,
    'showSuccessModalAfterSave must persist as false (Off) in database'
  );
  console.log('✅ PASS: Toggled back to false (Off) and verified persistence');

  console.log('====================================================');
  console.log('ALL SAVE & NEW SETTINGS TESTS PASSED (4/4)');
  console.log('====================================================');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
