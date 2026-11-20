/** Super Admin creates a business and ONE login for it through the real HTTP routes; the login sees only that business. Disposable DB only. */
import assert from 'node:assert/strict';
import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import { pool } from '../db/index.js';
import { createExpressApp } from '../app.js';
import { generateAuthToken } from '../auth/jwt.js';
import { runMigrations } from '../db/migrate.js';
import { runMigration0003 } from '../db/migrations/0003_purchase_orders_and_draft_migration.js';
import { hashPassword } from '../auth/password.js';
let mig = await runMigrations();
if (!mig.success) { await runMigration0003(); mig = await runMigrations(); }
if (!mig.success) throw new Error('migration failed');
await pool.query(`INSERT INTO users(username,full_name,password_hash,is_super_admin,status) VALUES('syn_sa','Synthetic SA',$1,true,'ACTIVE') ON CONFLICT DO NOTHING`, [await hashPassword('Syn#Admin123')]);
const server = createExpressApp().listen(0, '127.0.0.1');
await new Promise<void>(r => (server.listening ? r() : server.once('listening', r)));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const out: string[] = [];
const note = (s: string) => { out.push(s); console.log(s); };
try {
  const { rows: [admin] } = await pool.query('SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1');
  const { rows: [first] } = await pool.query(`INSERT INTO businesses(name,status,state) VALUES('Synthetic existing Lumina-like',  'ACTIVE','Delhi') RETURNING id`);
  const saTok = (b: string) => generateAuthToken({ userId: admin.id, username: admin.username, isSuperAdmin: true, businessId: b });
  const call = async (path: string, tok: string, biz: string, method = 'GET', body?: any) => {
    const r = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + tok, 'X-Business-Id': biz, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let data: any = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
  // 1. SA creates two businesses
  const bA = await call('/api/businesses', saTok(first.id), first.id, 'POST', { name: 'Synthetic Business A' });
  const bB = await call('/api/businesses', saTok(first.id), first.id, 'POST', { name: 'Synthetic Business B' });
  assert.equal(bA.status, 201, JSON.stringify(bA)); assert.equal(bB.status, 201);
  const A = bA.data.business.id, B = bB.data.business.id;
  note('PASS SA creates two businesses via POST /api/businesses');
  // 2. a role for staff
  const { rows: [role] } = await pool.query(`SELECT id FROM roles WHERE code='MANAGER' AND business_id IS NULL LIMIT 1`);
  // 3. SA creates ONE login for A only
  const u = await call('/api/users', saTok(A), A, 'POST', { username: 'syn_single_' + Date.now(), fullName: 'Synthetic Single', password: 'Syn#Single123', businessAssignments: [{ businessId: A, roleId: role.id, isDefault: true }] });
  assert.equal(u.status, 201, JSON.stringify(u));
  const uname = u.data.user?.username || u.data.username;
  note('PASS SA creates one login assigned to Business A only');
  const lg = async (bid?: string) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'Syn#Single123', businessId: bid }) }); return { status: r.status, data: await r.json() as any }; };
  const okA = await lg(A); assert.equal(okA.status, 200, JSON.stringify(okA.data));
  assert.deepEqual((okA.data.accessibleBusinesses || []).map((b: any) => b.id), [A]);
  note('PASS login works; accessibleBusinesses (dropdown source) is exactly [A]');
  const loginB = await lg(B);
  note(`RESULT login asking for Business B: HTTP ${loginB.status}, landed in ${loginB.data.currentBusiness?.id === A ? 'A (own business)' : loginB.data.currentBusiness?.id === B ? 'B (LEAK)' : String(loginB.data.currentBusiness?.id)}, dropdown=${(loginB.data.accessibleBusinesses || []).length}`);
  assert.equal(loginB.status, 403); assert.equal(loginB.data.currentBusiness, undefined); assert(!JSON.stringify(loginB.data).includes(B));
  const tok = okA.data.token;
  assert.equal((await call('/api/auth/me', tok, A)).data.accessibleBusinesses.length, 1);
  assert.equal((await call('/api/inventory', tok, B)).status, 403);
  assert.equal((await call('/api/auth/switch-business', tok, A, 'POST', { targetBusinessId: B })).status, 403);
  assert.equal((await call('/api/businesses/' + B, tok, A)).status, 403);
  const list = await call('/api/businesses', tok, A);
  assert.deepEqual((list.data || []).map((b: any) => b.id), [A]);
  note('PASS staff cannot read Business B via X-Business-Id, switch-business, business detail, or the business list');
  // 4. SA view: sees all
  const saMe = await call('/api/auth/me', saTok(A), A);
  const saIds = (saMe.data.accessibleBusinesses || []).map((b: any) => b.id);
  assert(saIds.includes(A) && saIds.includes(B) && saIds.includes(first.id));
  note(`INFO Super Admin dropdown lists all ${saIds.length} active businesses by design (staff see one)`);
  // 5. attempt to create a NEW staff login with two businesses
  const two = await call('/api/users', saTok(A), A, 'POST', { username: 'syn_two_' + Date.now(), fullName: 'Synthetic Two', password: 'Syn#Single123', businessAssignments: [{ businessId: A, roleId: role.id, isDefault: true }, { businessId: B, roleId: role.id }] });
  note(`RESULT creating a staff login with 2 businesses: HTTP ${two.status}`);
  assert.equal(two.status, 400);
  assert.equal((await pool.query(`SELECT 1 FROM users WHERE username LIKE 'syn_two_%'`)).rowCount, 0, 'rejected create leaves no user');
  const accBefore = JSON.stringify((await pool.query('SELECT * FROM user_business_access ORDER BY user_id,business_id')).rows);
  const upd = await call('/api/users/' + (await pool.query('SELECT id FROM users WHERE username=$1',[uname])).rows[0].id + '/business-access', saTok(A), A, 'PUT', { assignments: [{ businessId: A, roleId: role.id }, { businessId: B, roleId: role.id }], defaultBusinessId: A });
  assert.equal(upd.status, 400);
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM user_business_access ORDER BY user_id,business_id')).rows), accBefore, 'rejected update changes no access row');
  // Legacy login that already holds two access rows (written directly, as old data would be): only its default business is offered
  const lname = 'syn_legacy_' + Date.now();
  const { rows: [lu] } = await pool.query(`INSERT INTO users(username,full_name,password_hash,status) VALUES($1,'Synthetic Legacy',$2,'ACTIVE') RETURNING id`, [lname, await hashPassword('Syn#Single123')]);
  await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true),($1,$3,false)`, [lu.id, A, B]);
  await pool.query(`INSERT INTO user_roles(user_id,role_id,business_id) VALUES($1,$2,$3),($1,$2,$4)`, [lu.id, role.id, A, B]);
  const legacyRows = JSON.stringify((await pool.query('SELECT * FROM user_business_access WHERE user_id=$1 ORDER BY business_id', [lu.id])).rows);
  const lLogin = async (bid: string) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: lname, password: 'Syn#Single123', businessId: bid }) }); return { status: r.status, data: await r.json() as any }; };
  const l1 = await lLogin(A); assert.equal(l1.status, 200, JSON.stringify(l1.data)); assert.deepEqual(l1.data.accessibleBusinesses.map((b: any) => b.id), [A]);
  assert.equal((await lLogin(B)).status, 403);
  assert.deepEqual((await call('/api/auth/me', l1.data.token, A)).data.accessibleBusinesses.map((b: any) => b.id), [A]);
  assert.equal((await call('/api/inventory', l1.data.token, B)).status, 403);
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM user_business_access WHERE user_id=$1 ORDER BY business_id', [lu.id])).rows), legacyRows, 'legacy access rows unchanged');
  note('PASS legacy two-row login: login dropdown [A], other business 403, /me [A], X-Business-Id B 403, rows unchanged');
  // Ambiguous legacy logins fail closed: 0 defaults and 2 defaults
  for (const defs of [[false, false]]) {
    const an = 'syn_amb_' + defs.join('_') + '_' + Date.now();
    const { rows: [au] } = await pool.query(`INSERT INTO users(username,full_name,password_hash,status) VALUES($1,'Synthetic Ambiguous',$2,'ACTIVE') RETURNING id`, [an, await hashPassword('Syn#Single123')]);
    await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,$4),($1,$3,$5)`, [au.id, A, B, defs[0], defs[1]]);
    await pool.query(`INSERT INTO user_roles(user_id,role_id,business_id) VALUES($1,$2,$3),($1,$2,$4)`, [au.id, role.id, A, B]);
    const rowsBefore = JSON.stringify((await pool.query('SELECT * FROM user_business_access WHERE user_id=$1 ORDER BY business_id', [au.id])).rows);
    for (const bid of [A, B, undefined]) {
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: an, password: 'Syn#Single123', businessId: bid }) });
      const d: any = await r.json();
      assert.equal(r.status, 403, 'ambiguous login must be refused ' + JSON.stringify(defs)); assert.equal(d.token, undefined); assert.equal(d.error, 'ACCOUNT_CONFIGURATION');
      assert(!JSON.stringify(d).includes(A) && !JSON.stringify(d).includes(B));
    }
    // a token issued earlier (before the fix / before the rows changed) holds no capability either
    const oldTok = generateAuthToken({ userId: au.id, username: an, isSuperAdmin: false, businessId: A });
    for (const [path, biz, m, body] of [['/api/auth/me', A, 'GET'], ['/api/inventory', A, 'GET'], ['/api/inventory', B, 'GET'], ['/api/businesses', A, 'GET'], ['/api/businesses/' + B, A, 'GET'], ['/api/auth/switch-business', A, 'POST', { targetBusinessId: B }]] as any) {
      const r = await call(path, oldTok, biz, m, body);
      assert.equal(r.status, 403, `ambiguous token ${path} ${JSON.stringify(defs)} got ${r.status}`);
    }
    assert.equal(JSON.stringify((await pool.query('SELECT * FROM user_business_access WHERE user_id=$1 ORDER BY business_id', [au.id])).rows), rowsBefore, 'no access row changed');
    note(`PASS ambiguous legacy login (defaults=${defs.filter(Boolean).length}) fails closed: login 403 x3, /me, inventory A+B, list, detail, switch all 403 with an existing token; rows unchanged`);
  }
  await assert.rejects(pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true),($1,$3,true)`, [lu.id, first.id, B]), /user_biz_access_user_default_unique_idx/);
  note('PASS two default flags for one login are impossible at the database level (unique index), so 0 defaults is the only ambiguous shape');
  const saTwo = await call('/api/users', saTok(A), A, 'POST', { username: 'syn_sa2_' + Date.now(), fullName: 'Synthetic SA2', password: 'Syn#Single123', isSuperAdmin: true });
  note(`RESULT Super Admin account creation still allowed: HTTP ${saTwo.status}`);
  if (false) {
    const un = two.data.user?.username || two.data.username;
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: un, password: 'Syn#Single123', businessId: A }) });
    const d: any = await r.json();
    note(`RESULT that two-business login sees dropdown businesses: ${(d.accessibleBusinesses || []).length}`);
  }
} finally {
  await new Promise<void>(r => server.close(() => r()));
  await pool.end();
}
