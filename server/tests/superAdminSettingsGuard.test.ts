/**
 * Super Administrator enforcement on settings writes.
 *
 * Runs standalone (no DATABASE_URL needed):
 *   npx tsx server/tests/superAdminSettingsGuard.test.ts
 *
 * Part A: behavior of the real requireSuperAdmin middleware.
 * Part B: that middleware composed in a real express pipeline (stub auth) over HTTP.
 * Part C: wiring assertion that the settings write routes in businesses.ts are
 *         guarded by requireSuperAdmin (regression tripwire).
 */
import express from 'express';
import { readFileSync } from 'node:fs';
import { requireSuperAdmin } from '../middleware/permission.js';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, extra ?? '');
  }
}

function mockRes() {
  const out: any = { statusCode: 200, body: undefined as unknown };
  out.status = (code: number) => {
    out.statusCode = code;
    return out;
  };
  out.json = (body: unknown) => {
    out.body = body;
    return out;
  };
  return out;
}

// ---------- Part A: middleware behavior ----------

{
  let nexted: boolean = false;
  const res = mockRes();
  requireSuperAdmin({ user: { isSuperAdmin: true } } as any, res, () => {
    nexted = true;
  });
  check('A1 super admin passes requireSuperAdmin', nexted && res.statusCode === 200);
}

{
  let nexted: boolean = false;
  const res = mockRes();
  // Non-super even holding the old admin:manage_settings permission must be denied.
  requireSuperAdmin(
    { user: { isSuperAdmin: false, permissions: ['admin:manage_settings', 'admin:manage_roles'] } } as any,
    res,
    () => {
      nexted = true;
    }
  );
  check(
    'A2 non-super with admin:manage_settings is denied 403',
    nexted === false &&
      res.statusCode === 403 &&
      (res.body as any)?.error === 'FORBIDDEN_SUPER_ADMIN_REQUIRED',
    res.body
  );
}

{
  let nexted: boolean = false;
  const res = mockRes();
  requireSuperAdmin({} as any, res, () => {
    nexted = true;
  });
  check('A3 unauthenticated is denied 401', nexted === false && res.statusCode === 401);
}

// ---------- Part B: real express pipeline over HTTP ----------

async function partB() {
  const app = express();
  app.use(express.json());
  const stubAuth = (req: any, _res: any, next: any) => {
    if (req.headers['x-test-user'] === 'super') {
      req.user = { id: 'u1', isSuperAdmin: true, permissions: [] };
    } else if (req.headers['x-test-user'] === 'admin') {
      req.user = { id: 'u2', isSuperAdmin: false, permissions: ['admin:manage_settings'] };
    }
    next();
  };
  let handlerCalls = 0;
  app.put('/settings', stubAuth, requireSuperAdmin, (_req, res) => {
    handlerCalls += 1;
    res.json({ ok: true });
  });

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const put = (user?: string) =>
    fetch(`http://127.0.0.1:${port}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      body: JSON.stringify({ settings: { ui: { rightClickRowActions: false } } }),
    });

  const r1 = await put('admin');
  check('B1 non-super write denied 403 before handler', r1.status === 403 && handlerCalls === 0, r1.status);
  const b1 = (await r1.json()) as any;
  check('B2 denial error code', b1?.error === 'FORBIDDEN_SUPER_ADMIN_REQUIRED', b1);

  const r2 = await put('super');
  check('B3 super admin write reaches handler (200)', r2.status === 200 && handlerCalls === 1, r2.status);

  const r3 = await put(undefined);
  check('B4 unauthenticated denied 401', r3.status === 401, r3.status);

  server.close();
}

// ---------- Part C: route wiring tripwire ----------

function partC() {
  const src = readFileSync(new URL('../routes/businesses.ts', import.meta.url), 'utf8');

  const routeBlock = (method: string, path: string) => {
    const idx = src.indexOf(`router.${method}(\n  '${path}'`);
    if (idx < 0) return null;
    return src.slice(idx, idx + 900);
  };

  const put = routeBlock('put', '/settings');
  const restore = routeBlock('post', '/settings/restore-defaults');
  check('C1 PUT /settings route exists', put !== null);
  check(
    'C2 PUT /settings guarded by requireSuperAdmin',
    put !== null && put.includes('requireSuperAdmin'),
    put?.slice(0, 200)
  );
  check('C3 POST /settings/restore-defaults route exists', restore !== null);
  check(
    'C4 POST /settings/restore-defaults guarded by requireSuperAdmin',
    restore !== null && restore.includes('requireSuperAdmin'),
    restore?.slice(0, 200)
  );
  check(
    'C5 no settings write still guarded by the old admin:manage_settings permission',
    !/router\.(put|post|patch|delete)\(\s*\n\s*'\/settings[^)]*admin:manage_settings/s.test(src)
  );
}

partB()
  .then(() => partC())
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) FAILED`);
      process.exit(1);
    }
    console.log('\nAll super-admin settings guard checks passed.');
  })
  .catch((err) => {
    console.error('Test run error:', err);
    process.exit(1);
  });
