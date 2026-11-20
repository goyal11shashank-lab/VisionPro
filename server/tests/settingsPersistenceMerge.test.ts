/**
 * Settings write-merge persistence fixture (no database, no live writes).
 *
 * Replicates the exact merge chain used by BusinessSettingsService.updateSettings:
 *   previous.settings = deepMerge(DEFAULT_APP_SETTINGS, storedRow)
 *   merged           = deepMerge(previous.settings, incomingUpdate)
 * and proves a UI toggle write neither resets existing configuration nor drops
 * defaults that predate the stored row.
 *
 * Run: npx tsx server/tests/settingsPersistenceMerge.test.ts
 */
import { DEFAULT_APP_SETTINGS, deepMerge } from '../services/businessSettingsService.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, extra ?? '');
  }
}

// A stored settings row as it existed before the ui section shipped:
// customized business config, no ui key at all.
const storedRow: any = {
  general: { currencySymbol: 'Rs.', dateFormat: 'DD/MM/YYYY' },
  party: { defaultCreditLimit: 75000, creditLimitBehavior: 'WARNING' },
  print: { showBatchDetails: true, defaultOrientation: 'PORTRAIT' },
};

// What the Interface & Printing page sends when one toggle is flipped off
// (it spreads the current ui object, so both keys are present).
const incomingUpdate: any = {
  ui: { rightClickRowActions: false, hideStockItemMasterColumns: true },
};

// Exact chain from updateSettings():
const previousSettings = deepMerge(DEFAULT_APP_SETTINGS as any, storedRow);
const merged = deepMerge(previousSettings, incomingUpdate);

check('flipped toggle persisted', merged.ui.rightClickRowActions === false);
check('sibling ui toggle preserved', merged.ui.hideStockItemMasterColumns === true);
check('custom currencySymbol preserved', (merged as any).general.currencySymbol === 'Rs.');
check('custom dateFormat preserved', (merged as any).general.dateFormat === 'DD/MM/YYYY');
check('custom credit limit preserved', (merged as any).party.defaultCreditLimit === 75000);
check('custom credit behavior preserved', (merged as any).party.creditLimitBehavior === 'WARNING');
check('print batch flag preserved', (merged as any).print.showBatchDetails === true);
check('A5 portrait default preserved', (merged as any).print.defaultOrientation === 'PORTRAIT');
check('defaults still present for untouched sections', !!(merged as any).inventory && !!(merged as any).voucher);
check(
  'stored row not mutated by merge',
  storedRow.ui === undefined && storedRow.general.currencySymbol === 'Rs.'
);
check(
  'defaults object not mutated by merge',
  (DEFAULT_APP_SETTINGS as any).ui.rightClickRowActions === true &&
    (DEFAULT_APP_SETTINGS as any).general.currencySymbol !== 'Rs.'
);

// Second write flipping the other toggle must retain the first flip.
const secondUpdate: any = {
  ui: { rightClickRowActions: false, hideStockItemMasterColumns: false },
};
const merged2 = deepMerge(deepMerge(DEFAULT_APP_SETTINGS as any, merged), secondUpdate);
check('second write keeps first flip', merged2.ui.rightClickRowActions === false);
check('second write applies its own flip', merged2.ui.hideStockItemMasterColumns === false);
check('second write still preserves business config', (merged2 as any).party.defaultCreditLimit === 75000);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll settings persistence merge checks passed.');
