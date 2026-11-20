/**
 * Business INACTIVE enforcement against the REAL login route and REAL
 * authenticateToken middleware on a disposable local database
 * (erp_tenant_synth). Requires DATABASE_URL + JWT_SECRET; run through a wrapper
 * that provisions the disposable database. Never touches live data.
 */
import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import { createExpressApp } from '../app.js';
import { pool, db } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { runMigration0003 } from '../db/migrations/0003_purchase_orders_and_draft_migration.js';
import { users, businesses, userBusinessAccess, roles, userRoles } from '../db/schema.js';
import { hashPassword } from '../auth/password.js';
import { eq, and, isNull } from 'drizzle-orm';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, extra ?? ''); }
};

async function main() {
  // Fresh disposable database: base schema may stop at purchase_orders until 0003 creates it.
  let mig = await runMigrations();
  if (!mig.success) {
    await runMigration0003();
    mig = await runMigrations();
  }
  if (!mig.success) throw new Error('migration failed: ' + mig.message);

  const mk = async (name: string, status = 'ACTIVE') =>
    (await db.insert(businesses).values({ name, status } as any).returning())[0];
  const A = await mk('Biz A Active');
  const B = await mk('Biz B Inactive', 'INACTIVE');
  const C = await mk('Biz C Active');

  const [managerRole] = await db.select().from(roles).where(and(eq(roles.code, 'MANAGER'), isNull(roles.businessId))).limit(1);
  if (!managerRole) throw new Error('MANAGER role missing after migration');
  const pw = 'Test#Pass123';
  const hash = await hashPassword(pw);
  const mkUser = async (username: string, isSuperAdmin: boolean, access: Array<[any, boolean]>) => {
    const [u] = await db.insert(users).values({ username, fullName: username, passwordHash: hash, status: 'ACTIVE', isSuperAdmin } as any).returning();
    for (const [biz, isDefault] of access) {
      await db.insert(userBusinessAccess).values({ userId: u.id, businessId: biz.id, isDefault });
      await db.insert(userRoles).values({ userId: u.id, roleId: managerRole.id, businessId: biz.id } as any);
    }
    return u;
  };
  await mkUser('staff_a', false, [[A, true]]);
  await mkUser('staff_b', false, [[B, true]]);
  await mkUser('multi_user', false, [[B, true], [A, false]]);
  await mkUser('multi_two_active', false, [[A, true], [C, false]]);
  await mkUser('super_user', true, [[B, true], [A, false]]);

  const server = createExpressApp().listen(0, '127.0.0.1');
  await new Promise<void>(r => (server.listening ? r() : server.once('listening', r)));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (path: string, init: any = {}) => {
    const r = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
    let body: any = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const login = (username: string, businessId?: string) =>
    call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: pw, businessId }) });
  const me = (token: string, extra: any = {}) => call('/api/auth/me', { headers: { Authorization: `Bearer ${token}`, ...extra } });

  try {
    // 1. Active business staff: login + authenticated call works.
    const a = await login('staff_a');
    check('I1 staff of ACTIVE business logs in', a.status === 200 && !!a.body?.token, a);
    const aMe = await me(a.body.token);
    check('I2 staff of ACTIVE business passes authenticateToken', aMe.status === 200, aMe);

    // 2. Inactive business staff: login stopped.
    const b = await login('staff_b');
    check('I3 staff of INACTIVE business cannot log in (403 BUSINESS_INACTIVE)', b.status === 403 && b.body?.error === 'BUSINESS_INACTIVE' && !b.body?.token, b);

    // 3. Explicit inactive selection by multi-business staff.
    const mExplicit = await login('multi_user', B.id);
    check('I4 explicit pick of INACTIVE business is blocked', mExplicit.status === 403 && mExplicit.body?.error === 'BUSINESS_INACTIVE', mExplicit);

    // 4. Owner rule: staff belong to one business; if it is inactive they are blocked, with no
    //    silent fallthrough to another business, even when they also have an ACTIVE access row.
    const mDefault = await login('multi_user');
    check('I5 default-INACTIVE multi-access staff is blocked, no fallthrough to another business',
      mDefault.status === 403 && mDefault.body?.error === 'BUSINESS_INACTIVE' && !mDefault.body?.token, mDefault);

    // 4b. One staff, one business: a multi-access login cannot pick a non-default business.
    const twoOther = await login('multi_two_active', C.id);
    check('I5c multi-access staff cannot pick a non-default business at login', twoOther.status === 403 && twoOther.body?.error === 'STAFF_SINGLE_BUSINESS' && !twoOther.body?.token, twoOther);
    const twoOwn = await login('multi_two_active', A.id);
    check('I5d multi-access staff may sign in to the default business explicitly', twoOwn.status === 200 && twoOwn.body?.currentBusiness?.id === A.id, twoOwn);

    // 4c. switch-business and /me follow the same rule (default business only), no rows changed.
    const twoLogin = await login('multi_two_active');
    const swTwo = await call('/api/auth/switch-business', { method: 'POST', headers: { Authorization: `Bearer ${twoLogin.body?.token}` }, body: JSON.stringify({ targetBusinessId: C.id }) });
    check('I5e multi-access staff cannot switch to a non-default business', swTwo.status === 403 && swTwo.body?.error === 'STAFF_SINGLE_BUSINESS', swTwo);
    const meTwo = await me(twoLogin.body?.token);
    check('I5f /me lists only the default business for that staff, with status', (meTwo.body?.accessibleBusinesses || []).length === 1 && meTwo.body.accessibleBusinesses[0].id === A.id && meTwo.body.accessibleBusinesses[0].status === 'ACTIVE', meTwo.body?.accessibleBusinesses);
    const rowsAfter = (await pool.query(`SELECT count(*)::int n FROM user_business_access`)).rows[0].n;
    check('I5g access rows untouched by the rule', rowsAfter === 8, rowsAfter);

    // 5. Existing session: token minted while B was ACTIVE must die once B goes INACTIVE.
    await db.update(businesses).set({ status: 'ACTIVE' }).where(eq(businesses.id, B.id));
    const bLive = await login('staff_b');
    check('I6 staff_b logs in while B is ACTIVE', bLive.status === 200 && !!bLive.body?.token, bLive);
    const before = await me(bLive.body.token);
    check('I7 existing session works while ACTIVE', before.status === 200, before);
    await db.update(businesses).set({ status: 'INACTIVE' }).where(eq(businesses.id, B.id));
    const after = await me(bLive.body.token);
    check('I8 SAME token is rejected after business goes INACTIVE (403 BUSINESS_INACTIVE)', after.status === 403 && after.body?.error === 'BUSINESS_INACTIVE', after);
    // Write-type route through the same middleware (create nothing: expect denial before handler)
    const write = await call('/api/users', { method: 'POST', headers: { Authorization: `Bearer ${bLive.body.token}` }, body: JSON.stringify({}) });
    check('I9 write endpoint also denied with BUSINESS_INACTIVE (middleware runs first)', write.status === 403 && write.body?.error === 'BUSINESS_INACTIVE', write);

    // 6. X-Business-Id header cannot be used to hop into an inactive business with an active-business token.
    const hop = await me(a.body.token, { 'X-Business-Id': B.id });
    check('I10 X-Business-Id pointing at INACTIVE business is not honored for staff', hop.status !== 200 || hop.body?.currentBusiness?.id !== B.id, hop);

    // 7. Switch-business into inactive business.
    const sw = await call('/api/auth/switch-business', { method: 'POST', headers: { Authorization: `Bearer ${mDefault.body.token}` }, body: JSON.stringify({ businessId: B.id }) });
    check('I11 switch-business into INACTIVE business is blocked for staff', sw.status >= 400, sw);

    // 8. Super admin unaffected.
    const s = await login('super_user', B.id);
    check('I12 super admin can still log into INACTIVE business', s.status === 200 && !!s.body?.token, s);
    const sMe = await me(s.body.token);
    check('I13 super admin passes middleware on INACTIVE business', sMe.status === 200, sMe);

    // 9. Two active businesses: default respected, no silent change.
    const two = await login('multi_two_active');
    check('I14 user with two ACTIVE businesses keeps their default', two.status === 200 && two.body?.currentBusiness?.id === A.id, two);

    // 10. Reactivate restores access; history rows untouched.
    await db.update(businesses).set({ status: 'ACTIVE' }).where(eq(businesses.id, B.id));
    const back = await login('staff_b');
    check('I15 reactivating the business restores staff login', back.status === 200 && !!back.body?.token, back);
    const [{ count }] = (await pool.query('select count(*)::int as count from user_business_access')).rows;
    check('I16 access rows unchanged by inactive/active toggling', count === 8, count);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    await pool.end();
  }
  if (failures) { console.error(`${failures} FAILED`); process.exit(1); }
  console.log('All inactive-business integration checks passed.');
}
main().catch(e => { console.error(e); process.exit(1); });
