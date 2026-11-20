/**
 * Business INACTIVE enforcement (owner decision, Nov 20, 2026):
 * inactive business => staff login stopped, entries stopped, hidden from staff
 * dropdown; super admin and historical data unaffected.
 *
 * Runs standalone (no DATABASE_URL needed):
 *   npx tsx server/tests/businessInactivePolicy.test.ts
 *
 * Part A: policy function behavior.
 * Part B: express pipeline using the real policy in middleware position.
 * Part C: wiring tripwires on auth middleware + login route + Header dropdown.
 */
import express from 'express';
import { readFileSync } from 'node:fs';
import {
  businessUsableByStaff,
  businessInactiveBody,
  BUSINESS_INACTIVE_ERROR,
} from '../services/businessStatusPolicy.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, extra ?? '');
  }
}

// ---------- Part A ----------
check('A1 ACTIVE business usable', businessUsableByStaff({ id: 'b1', status: 'ACTIVE' }) === true);
check('A2 INACTIVE business not usable', businessUsableByStaff({ id: 'b1', status: 'INACTIVE' }) === false);
check('A3 SUSPENDED business not usable', businessUsableByStaff({ id: 'b1', status: 'SUSPENDED' }) === false);
check('A4 ARCHIVED business not usable', businessUsableByStaff({ id: 'b1', status: 'ARCHIVED' }) === false);
check('A5 missing business not usable', businessUsableByStaff(null) === false);
check('A6 undefined status not usable', businessUsableByStaff({ id: 'b1' }) === false);
const body = businessInactiveBody({ id: 'b1', name: 'Lumina Opticals Pvt Ltd', status: 'INACTIVE' });
check(
  'A7 error body shape',
  body.error === BUSINESS_INACTIVE_ERROR &&
    body.success === false &&
    body.message.includes('Lumina Opticals Pvt Ltd') &&
    body.message.includes('Super Administrator'),
  body
);

// ---------- Part B: real express pipeline with the policy in middleware position ----------
async function partB() {
  const app = express();
  const stubAuth = (biz: any, isSuperAdmin: boolean) => (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', isSuperAdmin };
    req.currentBusiness = biz;
    next();
  };
  // Mirrors the enforcement inserted into authenticateToken.
  const enforceActive = (req: any, res: any, next: any) => {
    if (!req.user.isSuperAdmin && !businessUsableByStaff(req.currentBusiness)) {
      res.status(403).json(businessInactiveBody(req.currentBusiness));
      return;
    }
    next();
  };
  let writes = 0;
  app.post('/entries', stubAuth({ id: 'b1', name: 'Shop B', status: 'INACTIVE' }, false), enforceActive, (_req, res) => {
    writes += 1;
    res.json({ ok: true });
  });
  app.post('/entries-super', stubAuth({ id: 'b1', name: 'Shop B', status: 'INACTIVE' }, true), enforceActive, (_req, res) => {
    writes += 1;
    res.json({ ok: true });
  });
  app.post('/entries-active', stubAuth({ id: 'b2', name: 'Shop A', status: 'ACTIVE' }, false), enforceActive, (_req, res) => {
    writes += 1;
    res.json({ ok: true });
  });

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const post = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST' });

  const r1 = await post('/entries');
  const b1 = (await r1.json()) as any;
  check('B1 staff blocked on inactive business (403)', r1.status === 403 && writes === 0, r1.status);
  check('B2 error code BUSINESS_INACTIVE', b1?.error === 'BUSINESS_INACTIVE', b1);

  const r2 = await post('/entries-super');
  check('B3 super admin still works on inactive business', r2.status === 200, r2.status);

  const r3 = await post('/entries-active');
  check('B4 staff works on active business', r3.status === 200, r3.status);

  server.close();
}

// ---------- Part C: wiring tripwires ----------
function partC() {
  const mw = readFileSync(new URL('../middleware/auth.ts', import.meta.url), 'utf8');
  const login = readFileSync(new URL('../routes/auth.ts', import.meta.url), 'utf8');
  const header = readFileSync(new URL('../../src/components/layout/Header.tsx', import.meta.url), 'utf8');

  check(
    'C1 authenticateToken enforces policy for non-super',
    /!userRecord\.isSuperAdmin && !businessUsableByStaff\(currentBusiness\)/.test(mw)
  );
  check(
    'C2 middleware returns 403 with policy body',
    /res\.status\(403\)\.json\(businessInactiveBody\(currentBusiness\)\)/.test(mw)
  );
  check(
    'C3 login route blocks staff login on inactive business',
    /!userRecord\.isSuperAdmin && selectedBusiness && !businessUsableByStaff\(selectedBusiness\)/.test(login)
  );
  check('C4 login block is audited', /LOGIN_BLOCKED_BUSINESS_INACTIVE/.test(login));
  check(
    'C5 login prefers an ACTIVE business when picking a default',
    /business\?\.status === 'ACTIVE'/.test(login)
  );
  check(
    'C6 staff dropdown shows only ACTIVE businesses',
    /user\?\.isSuperAdmin\|\|b\.status==='ACTIVE'/.test(header)
  );
}

partB()
  .then(() => partC())
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) FAILED`);
      process.exit(1);
    }
    console.log('\nAll business-inactive policy checks passed.');
  })
  .catch((err) => {
    console.error('Test run error:', err);
    process.exit(1);
  });
