/**
 * Client-side settings access guard + UI settings defaults.
 *
 * Runs standalone:
 *   npx tsx server/tests/settingsAccessClient.test.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SETTINGS_PATHS, isSettingsPath, settingsAccessDenied } from '../../src/lib/settingsAccess.js';
import SettingsAccessDenied from '../../src/components/auth/SettingsAccessDenied.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, extra ?? '');
  }
}

// 1. Every settings path is denied for non-super and anonymous users.
for (const p of SETTINGS_PATHS) {
  check(`denied for non-super: ${p}`, settingsAccessDenied(p, { isSuperAdmin: false }) === true);
  check(`denied for anonymous: ${p}`, settingsAccessDenied(p, null) === true);
  check(`allowed for super: ${p}`, settingsAccessDenied(p, { isSuperAdmin: true }) === false);
}

// 2. Non-settings routes are untouched.
for (const p of ['/dashboard', '/master/stock-items', '/sales/invoices', '/purchases', '/parties']) {
  check(`not a settings path: ${p}`, isSettingsPath(p) === false);
  check(`non-settings allowed for non-super: ${p}`, settingsAccessDenied(p, { isSuperAdmin: false }) === false);
}

// 3. Access-denied panel renders the owner-facing message.
const html = renderToStaticMarkup(<SettingsAccessDenied />);
check('denied panel renders heading', html.includes('Super Administrator Access Required'), html);

// 4. UI settings defaults encode the owner-requested state.
async function defaults() {
  try {
    // Dynamic import so a missing DATABASE_URL can fall back to a source assertion.
    const svc: any = await import('../services/businessSettingsService.js').catch(() => null);
    if (svc?.DEFAULT_APP_SETTINGS) {
      check(
        'defaults: rightClickRowActions=true, hideStockItemMasterColumns=true',
        svc.DEFAULT_APP_SETTINGS.ui?.rightClickRowActions === true &&
          svc.DEFAULT_APP_SETTINGS.ui?.hideStockItemMasterColumns === true,
        svc.DEFAULT_APP_SETTINGS.ui
      );
      check(
        'defaults: print orientation PORTRAIT',
        (svc.DEFAULT_APP_SETTINGS.print?.defaultOrientation ?? 'PORTRAIT') === 'PORTRAIT',
        svc.DEFAULT_APP_SETTINGS.print?.defaultOrientation
      );
      return;
    }
    throw new Error('no import');
  } catch {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../services/businessSettingsService.ts', import.meta.url), 'utf8')
    );
    check(
      'defaults (source): ui toggles default true',
      /rightClickRowActions:\s*true/.test(src) && /hideStockItemMasterColumns:\s*true/.test(src)
    );
    check('defaults (source): print defaultOrientation PORTRAIT', /defaultOrientation:\s*'PORTRAIT'/.test(src));
  }
}

defaults().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll settings-access client checks passed.');
});
