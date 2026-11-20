/** Cash Book movement endpoint on a disposable DB: modes stay separate, no balance claimed, tenant scoped, draft/cancelled excluded. */
import assert from 'node:assert/strict';
import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import { pool, db } from '../db/index.js';
import { createExpressApp } from '../app.js';
import { generateAuthToken } from '../auth/jwt.js';
import { runMigrations } from '../db/migrate.js';
import { runMigration0003 } from '../db/migrations/0003_purchase_orders_and_draft_migration.js';
import { hashPassword } from '../auth/password.js';
import { businesses } from '../db/schema.js';
let mig = await runMigrations();
if (!mig.success) { await runMigration0003(); mig = await runMigrations(); }
if (!mig.success) throw new Error('migration failed');
await pool.query(`INSERT INTO users(username,full_name,password_hash,is_super_admin,status) VALUES('syn_sa','Synthetic SA',$1,true,'ACTIVE') ON CONFLICT DO NOTHING`, [await hashPassword('Syn#Admin123')]);
const server = createExpressApp().listen(0, '127.0.0.1');
await new Promise<void>(r => (server.listening ? r() : server.once('listening', r)));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
try {
  const { rows: [admin] } = await pool.query('SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1');
  const mk = async (n: string) => (await db.insert(businesses).values({ name: n, status: 'ACTIVE', state: 'Delhi' } as any).returning())[0];
  const A = await mk('CashMove A'); const B = await mk('CashMove B');
  const call = async (biz: string, path: string) => { const tok = generateAuthToken({ userId: admin.id, username: admin.username, isSuperAdmin: true, businessId: biz }); const r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok, 'X-Business-Id': biz } }); return { status: r.status, data: await r.json() as any }; };
  const party = async (biz: string, nm: string) => (await pool.query(`INSERT INTO parties (business_id,name,party_code,party_type,mobile,status,state) VALUES ($1,$2,$3,'CUSTOMER','9000000000','ACTIVE','Delhi') RETURNING id`, [biz, nm, nm.slice(0, 6) + Math.random().toString(36).slice(2, 6)])).rows[0].id;
  const pa = await party(A.id, 'CMParty');
  const pay = (n: string, type: string, mode: string, amt: number, status: string) => pool.query(`INSERT INTO payments (business_id,party_id,payment_number,payment_type,payment_mode,amount,unallocated_amount,status) VALUES ($1,$2,$3,$4,$5,$6,0,$7)`, [A.id, pa, n, type, mode, amt, status]);
  await pay('R1', 'RECEIPT', 'CASH', 1000, 'POSTED'); await pay('P1', 'PAYMENT', 'CASH', 300, 'POSTED');
  await pay('R2', 'RECEIPT', 'BANK', 500, 'POSTED'); await pay('R3', 'RECEIPT', 'CASH', 999, 'DRAFT'); await pay('R4', 'RECEIPT', 'CASH', 777, 'CANCELLED');
  const r = await call(A.id, '/api/payments/cash-movement');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.openingBalanceConfigured, false); assert.match(r.data.caveat, /not cash in hand/);
  assert.deepEqual(r.data.modes.CASH, { receipts: 1000, payments: 300, net: 700, count: 2 });
  assert.deepEqual(r.data.modes.BANK, { receipts: 500, payments: 0, net: 500, count: 1 });
  assert.equal(Object.keys(r.data.modes).length, 2, 'cash and bank are not merged');
  assert.equal(r.data.entries.length, 3, 'draft and cancelled excluded');
  assert.equal(r.data.cashInHand, undefined); assert.equal(r.data.balance, undefined);
  const other = await call(B.id, '/api/payments/cash-movement'); assert.equal(other.data.entries.length, 0, 'other business sees nothing');
  const future = await call(A.id, '/api/payments/cash-movement?from=2999-01-01&to=2999-12-31'); assert.equal(future.data.entries.length, 0);
  console.log('ALL PASS cash movement');
} finally { server.close(); await pool.end().catch(() => {}); }
