/** Batch deletion on a disposable DB through the real routes: an imported batch with only opening stock deletes; a used batch is blocked WITH a reason; dependencies endpoint works. */
import assert from 'node:assert/strict';
import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import { pool, db } from '../db/index.js';
import { createExpressApp } from '../app.js';
import { generateAuthToken } from '../auth/jwt.js';
import { runMigrations } from '../db/migrate.js';
import { runMigration0003 } from '../db/migrations/0003_purchase_orders_and_draft_migration.js';
import { hashPassword } from '../auth/password.js';
import { businesses, uniqueItems, categories, opticalBatches } from '../db/schema.js';
let mig = await runMigrations();
if (!mig.success) { await runMigration0003(); mig = await runMigrations(); }
if (!mig.success) throw new Error('migration failed');
await pool.query(`INSERT INTO users(username,full_name,password_hash,is_super_admin,status) VALUES('syn_sa','Synthetic SA',$1,true,'ACTIVE') ON CONFLICT DO NOTHING`, [await hashPassword('Syn#Admin123')]);
const server = createExpressApp().listen(0, '127.0.0.1');
await new Promise<void>(r => (server.listening ? r() : server.once('listening', r)));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
try {
  const { rows: [admin] } = await pool.query('SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1');
  const [A] = await db.insert(businesses).values({ name: 'Batch Del A', status: 'ACTIVE', state: 'Delhi' } as any).returning();
  const tok = generateAuthToken({ userId: admin.id, username: admin.username, isSuperAdmin: true, businessId: A.id });
  const call = async (path: string, method = 'GET', body?: any) => { const r = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + tok, 'X-Business-Id': A.id, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let data: any = null; try { data = await r.json(); } catch {} return { status: r.status, data }; };
  const [cat] = await db.insert(categories).values({ businessId: A.id, name: 'PROG', code: 'PROG' } as any).returning();
  const [item] = await db.insert(uniqueItems).values({ businessId: A.id, name: 'BCG FF PROG', code: 'BCGP' } as any).returning();
  const mkBatch = async (n: string) => (await db.insert(opticalBatches).values({ businessId: A.id, uniqueItemId: item.id, categoryId: cat.id, barcode: 'BD-' + n, sph: '-5.25', cyl: '0.00', identityKey: 'bd-' + n } as any).returning())[0];
  const clean = await mkBatch('clean'); const used = await mkBatch('used');
  for (const b of [clean, used]) await pool.query(`INSERT INTO optical_stocks (business_id,batch_id,physical_stock,reserved_stock,available_stock) VALUES ($1,$2,3,0,3)`, [A.id, b.id])
  // Imported batch: opening stock only (what batch import writes)
  await pool.query(`INSERT INTO stock_ledger (business_id,batch_id,transaction_type,reference_type,quantity_in,quantity_out,balance) VALUES ($1,$2,'OPENING_STOCK','IMPORT',3,0,3)`, [A.id, clean.id]);
  const dep = await call(`/api/optical-master/batches/${clean.id}/dependencies`);
  assert.equal(dep.status, 200, 'dependencies endpoint must not 500: ' + JSON.stringify(dep.data));
  console.log('PASS dependencies endpoint returns 200 (was: column ds.business_id does not exist)');
  // make "used" blocked by a ledger SALE row
  await pool.query(`INSERT INTO stock_ledger (business_id,batch_id,transaction_type,reference_type,quantity_in,quantity_out,balance) VALUES ($1,$2,'SALE','INVOICE',0,1,2)`, [A.id, used.id]);
  const res = await call('/api/optical-master/batches/bulk-delete', 'POST', { ids: [used.id, clean.id] });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  console.log('RESULT bulk-delete', JSON.stringify({ deleted: res.data.deletedCount, failed: res.data.failedCount, blocked: res.data.blockedBatches?.map((b: any) => b.reason), errors: res.data.errors }));
  assert.equal(res.data.deletedCount, 1, 'clean imported batch deletes');
  assert.equal(res.data.blockedBatches.length, 1, 'used batch blocked with a reason entry');
  assert.ok(res.data.blockedBatches[0].reason);
  assert.equal((await pool.query('SELECT 1 FROM optical_batches WHERE id=$1', [clean.id])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM optical_batches WHERE id=$1', [used.id])).rowCount, 1);
  console.log('ALL PASS batch deletion');
} finally { server.close(); await pool.end().catch(() => {}); }
