/**
 * Batch barcode lookup (sales + purchases) through the REAL login, auth middleware and permission
 * checks on a disposable database. Verifies per-code results, tenant isolation and auth required.
 */
import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import { createExpressApp } from '../app.js';
import { pool, db } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { runMigration0003 } from '../db/migrations/0003_purchase_orders_and_draft_migration.js';
import { users, businesses, userBusinessAccess, roles, userRoles, uniqueItems, categories, opticalBatches } from '../db/schema.js';
import { hashPassword } from '../auth/password.js';
import { eq, and, isNull } from 'drizzle-orm';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, extra ?? ''); }
};

async function main() {
  let mig = await runMigrations();
  if (!mig.success) { await runMigration0003(); mig = await runMigrations(); }
  if (!mig.success) throw new Error('migration failed: ' + mig.message);
  const mk = async (name: string) => (await db.insert(businesses).values({ name, status: 'ACTIVE' } as any).returning())[0];
  const A = await mk('Scan A');
  const C = await mk('Scan C');
  const [manager] = await db.select().from(roles).where(and(eq(roles.code, 'MANAGER'), isNull(roles.businessId))).limit(1);
  const pw = 'Test#Pass123';
  const hash = await hashPassword(pw);
  for (const [name, biz] of [['scan_a', A], ['scan_c', C]] as any) {
    const [u] = await db.insert(users).values({ username: name, fullName: name, passwordHash: hash, status: 'ACTIVE', isSuperAdmin: false } as any).returning();
    await db.insert(userBusinessAccess).values({ userId: u.id, businessId: biz.id, isDefault: true });
    await db.insert(userRoles).values({ userId: u.id, roleId: manager.id, businessId: biz.id } as any);
  }
  const [cat] = await db.insert(categories).values({ businessId: A.id, name: 'SV', code: 'SV' } as any).returning();
  const [item] = await db.insert(uniqueItems).values({ businessId: A.id, name: 'Scan Lens', code: 'SCAN-LENS' } as any).returning();
  await db.insert(opticalBatches).values({ businessId: A.id, uniqueItemId: item.id, categoryId: cat.id, barcode: 'SCANB-1', sph: '1.00', cyl: '-0.50', identityKey: 'scan-1' } as any);

  const server = createExpressApp().listen(0, '127.0.0.1');
  await new Promise<void>(r => (server.listening ? r() : server.once('listening', r)));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (path: string, init: any = {}) => {
    const r = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
    let body: any = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const login = async (u: string, b: string) => (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: pw, businessId: b }) })).body?.token as string;
  try {
    const ta = await login('scan_a', A.id);
    const tc = await login('scan_c', C.id);
    const post = (kind: string, tok: string | null, codes: string[]) =>
      call(`/api/${kind}/barcode-lookup-batch`, { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {}, body: JSON.stringify({ codes }) });
    const withParty = await call('/api/sales/barcode-lookup-batch', { method: 'POST', headers: { Authorization: `Bearer ${ta}` }, body: JSON.stringify({ codes: ['SCANB-1'], partyId: '00000000-0000-0000-0000-000000000000' }) });
    check('sales: partyId adds last sale price field (none for unknown party) and still returns the batch', withParty.status === 200 && withParty.body?.results?.['SCANB-1']?.data?.batch?.barcode === 'SCANB-1' && (withParty.body.results['SCANB-1'].lastSalePrice ?? null) === null, withParty.body);
    const badParty = await call('/api/sales/barcode-lookup-batch', { method: 'POST', headers: { Authorization: `Bearer ${ta}` }, body: JSON.stringify({ codes: ['SCANB-1'], partyId: 'not-a-uuid' }) });
    check('sales: malformed partyId does not fail the lookup', badParty.status === 200 && !!badParty.body?.results?.['SCANB-1']?.data, badParty.body);
    for (const kind of ['sales', 'purchases']) {
      const ok = await post(kind, ta, ['scanb-1', 'NOPE-1', 'SCANB-1']);
      check(`${kind}: 200 with per-code results`, ok.status === 200 && !!ok.body?.results, ok);
      check(`${kind}: known barcode returns batch + item`, ok.body?.results?.['scanb-1']?.data?.batch?.barcode === 'SCANB-1' && ok.body.results['scanb-1'].data.uniqueItem?.name === 'Scan Lens', ok.body);
      check(`${kind}: unknown barcode returns error text only`, !!ok.body?.results?.['NOPE-1']?.error && !ok.body.results['NOPE-1'].data);
      const other = await post(kind, tc, ['SCANB-1']);
      check(`${kind}: other business cannot resolve this business barcode`, !!other.body?.results?.['SCANB-1']?.error && !other.body.results['SCANB-1'].data, other.body);
      const anon = await post(kind, null, ['SCANB-1']);
      check(`${kind}: unauthenticated rejected`, anon.status === 401 || anon.status === 403, anon.status);
    }
  } finally {
    server.close();
    await pool.end();
  }
  if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
  console.log('ALL PASS');
}
main().catch(e => { console.error(e); process.exit(1); });
