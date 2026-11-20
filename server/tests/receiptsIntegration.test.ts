/**
 * Customer receipt lifecycle against the REAL PaymentService + REAL routes on a
 * disposable local database (erp_tenant_synth). Never touches live data.
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
import { PaymentService } from '../services/paymentService.js';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, extra ?? ''); }
};
const rejects = async (name: string, p: Promise<unknown>, re: RegExp) => {
  try { await p; check(name, false, 'did not reject'); } catch (e: any) { check(name, re.test(String(e?.message)), e?.message); }
};
const num = (v: any) => Math.round(parseFloat(v) * 100) / 100;

async function main() {
  let mig = await runMigrations();
  if (!mig.success) { await runMigration0003(); mig = await runMigrations(); }
  if (!mig.success) throw new Error('migration failed: ' + mig.message);

  const mkBiz = async (name: string) => (await db.insert(businesses).values({ name, status: 'ACTIVE' } as any).returning())[0];
  const A = await mkBiz('Receipts A');
  const B = await mkBiz('Receipts B');
  const [manager] = await db.select().from(roles).where(and(eq(roles.code, 'MANAGER'), isNull(roles.businessId))).limit(1);
  const hash = await hashPassword('Test#Pass123');
  const [u] = await db.insert(users).values({ username: 'rcpt_staff', fullName: 'rcpt', passwordHash: hash, status: 'ACTIVE', isSuperAdmin: false } as any).returning();
  await db.insert(userBusinessAccess).values({ userId: u.id, businessId: A.id, isDefault: true });
  await db.insert(userRoles).values({ userId: u.id, roleId: manager.id, businessId: A.id } as any);

  const mkParty = async (biz: any, code: string, type = 'CUSTOMER', status = 'ACTIVE') =>
    (await pool.query(`INSERT INTO parties (business_id, party_code, name, party_type, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [biz.id, code, code, type, status])).rows[0].id as string;
  const cust = await mkParty(A, 'C1');
  const cust2 = await mkParty(A, 'C2');
  const supplierOnly = await mkParty(A, 'S1', 'SUPPLIER');
  const inactive = await mkParty(A, 'C3', 'CUSTOMER', 'INACTIVE');
  const custB = await mkParty(B, 'CB1');

  // Posted invoices with their ledger debit (same shape the sales module writes).
  const balanceOf = async (biz: any, party: string) => {
    const r = await pool.query(`SELECT balance FROM customer_ledgers WHERE business_id=$1 AND party_id=$2 ORDER BY created_at DESC, id DESC LIMIT 1`, [biz.id, party]);
    return r.rows.length ? num(r.rows[0].balance) : 0;
  };
  const mkInvoice = async (biz: any, party: string, no: string, total: number, date = '2026-11-01') => {
    const id = (await pool.query(`INSERT INTO sales_invoices (business_id, party_id, invoice_number, invoice_date, grand_total, status, payment_status) VALUES ($1,$2,$3,$4,$5,'POSTED','UNPAID') RETURNING id`, [biz.id, party, no, date, total.toFixed(2)])).rows[0].id as string;
    const bal = (await balanceOf(biz, party)) + total;
    await pool.query(`INSERT INTO customer_ledgers (business_id, party_id, transaction_type, reference_type, reference_id, debit, credit, balance, transaction_date, notes) VALUES ($1,$2,'INVOICE','SALES_INVOICE',$3,$4,'0.00',$5,$6,'inv')`, [biz.id, party, id, total.toFixed(2), bal.toFixed(2), date]);
    return id;
  };
  const payStatus = async (id: string) => (await pool.query('SELECT payment_status FROM sales_invoices WHERE id=$1', [id])).rows[0].payment_status as string;
  const inv1 = await mkInvoice(A, cust, 'I1', 1000);
  const inv2 = await mkInvoice(A, cust, 'I2', 500);
  const invOther = await mkInvoice(A, cust2, 'I3', 300);
  const invB = await mkInvoice(B, custB, 'IB1', 400);
  const mk = (extra: any = {}) => ({ paymentType: 'RECEIPT', partyId: cust, paymentMode: 'CASH', paymentDate: '2026-11-10', amount: 400, autoPost: true, ...extra });
  const uid = u.id;
  check('S0 opening balance 1500', (await balanceOf(A, cust)) === 1500);

  // Create / allocate
  const r1: any = await PaymentService.createPayment(A.id, mk({ allocations: [{ documentType: 'SALES_INVOICE', documentId: inv1, allocatedAmount: 400 }] }), uid);
  check('R1 partial receipt posts', r1.status === 'POSTED', r1.status);
  check('R1 invoice PARTIAL', (await payStatus(inv1)) === 'PARTIAL');
  check('R1 ledger credit reduces balance to 1100', (await balanceOf(A, cust)) === 1100, await balanceOf(A, cust));
  check('R1 receipt fully allocated (unallocated 0)', num(r1.unallocatedAmount ?? r1.unallocated_amount) === 0, r1.unallocatedAmount);

  const r2: any = await PaymentService.createPayment(A.id, mk({ amount: 600, allocations: [{ documentType: 'SALES_INVOICE', documentId: inv1, allocatedAmount: 600 }] }), uid);
  check('R2 invoice PAID after remaining 600', (await payStatus(inv1)) === 'PAID');
  check('R2 balance 500', (await balanceOf(A, cust)) === 500);

  const adv: any = await PaymentService.createPayment(A.id, mk({ amount: 200 }), uid);
  check('R3 advance receipt unallocated 200', num(adv.unallocatedAmount ?? adv.unallocated_amount) === 200);
  check('R3 advance reduces balance to 300', (await balanceOf(A, cust)) === 300);
  await PaymentService.allocatePayment(A.id, adv.id, [{ documentType: 'SALES_INVOICE', documentId: inv2, allocatedAmount: 150 }], uid);
  check('R4 allocate advance -> inv2 PARTIAL', (await payStatus(inv2)) === 'PARTIAL');
  const advAfter: any = await PaymentService.getPaymentById(A.id, adv.id);
  check('R4 unallocated now 50', num(advAfter.unallocatedAmount ?? advAfter.unallocated_amount) === 50, advAfter.unallocatedAmount);
  check('R4 allocation does not change ledger balance', (await balanceOf(A, cust)) === 300);
  await rejects('R4b allocate beyond remaining unallocated rejected', PaymentService.allocatePayment(A.id, adv.id, [{ documentType: 'SALES_INVOICE', documentId: inv2, allocatedAmount: 80 }], uid), /exceeds|available/i);

  // Validation
  await rejects('V1 zero amount', PaymentService.createPayment(A.id, mk({ amount: 0 }), uid), /greater than zero/);
  await rejects('V2 negative amount', PaymentService.createPayment(A.id, mk({ amount: -5 }), uid), /greater than zero/);
  await rejects('V3 over-allocation vs invoice outstanding', PaymentService.createPayment(A.id, mk({ amount: 900, allocations: [{ documentType: 'SALES_INVOICE', documentId: inv2, allocatedAmount: 900 }] }), uid), /exceeds|outstanding/i);
  await rejects('V4 allocation > receipt amount', PaymentService.createPayment(A.id, mk({ amount: 100, allocations: [{ documentType: 'SALES_INVOICE', documentId: inv2, allocatedAmount: 200 }] }), uid), /cannot exceed|exceed/i);
  await rejects('V5 other customer invoice', PaymentService.createPayment(A.id, mk({ allocations: [{ documentType: 'SALES_INVOICE', documentId: invOther, allocatedAmount: 50 }] }), uid), /does not belong/i);
  await rejects('V6 other-business invoice (tenant)', PaymentService.createPayment(A.id, mk({ allocations: [{ documentType: 'SALES_INVOICE', documentId: invB, allocatedAmount: 50 }] }), uid), /not found|does not belong/i);
  await rejects('V7 other-business party (tenant)', PaymentService.createPayment(A.id, mk({ partyId: custB }), uid), /not found|does not belong/i);
  await rejects('V8 supplier-only party', PaymentService.createPayment(A.id, mk({ partyId: supplierOnly }), uid), /only/i);
  await rejects('V9 inactive party', PaymentService.createPayment(A.id, mk({ partyId: inactive }), uid), /not active/i);
  await rejects('V10 purchase doc type on customer receipt', PaymentService.createPayment(A.id, mk({ allocations: [{ documentType: 'PURCHASE_INVOICE', documentId: inv2, allocatedAmount: 10 }] }), uid), /SALES_INVOICE/);
  check('V11 failed creates left balance unchanged', (await balanceOf(A, cust)) === 300);

  // Cancel
  const bPre = await balanceOf(A, cust);
  await PaymentService.cancelPayment(A.id, r2.id, 'test', uid);
  check('C1 cancel restores invoice to PARTIAL', (await payStatus(inv1)) === 'PARTIAL');
  check('C1 ledger reversal restores +600', (await balanceOf(A, cust)) === bPre + 600, await balanceOf(A, cust));
  await rejects('C2 double cancel rejected', PaymentService.cancelPayment(A.id, r2.id, 'again', uid), /already/i);
  await rejects('C3 edit cancelled rejected', PaymentService.updatePayment(A.id, r2.id, { amount: 10 } as any, uid), /cancelled/i);
  await rejects('C4 cancel from other business rejected', PaymentService.cancelPayment(B.id, r1.id, 'x', uid), /not found/i);

  // Edit posted receipt: change amount + allocation
  const before = await balanceOf(A, cust);
  await PaymentService.updatePayment(A.id, r1.id, { amount: 300, allocations: [{ documentType: 'SALES_INVOICE', documentId: inv1, allocatedAmount: 300 }] } as any, uid);
  const r1e: any = await PaymentService.getPaymentById(A.id, r1.id);
  check('E1 edited amount saved', num(r1e.amount) === 300, r1e.amount);
  check('E1 ledger balance reflects 100 less receipt', (await balanceOf(A, cust)) === before + 100, await balanceOf(A, cust));
  check('E1 invoice still PARTIAL', (await payStatus(inv1)) === 'PARTIAL');

  // Ledger chain consistency
  const chain = (await pool.query(`SELECT debit, credit, balance FROM customer_ledgers WHERE business_id=$1 AND party_id=$2 ORDER BY created_at, transaction_date`, [A.id, cust])).rows;
  let run = 0; let chainOk = true;
  const debitSum = chain.reduce((s: number, r: any) => s + num(r.debit), 0);
  const creditSum = chain.reduce((s: number, r: any) => s + num(r.credit), 0);
  check('L1 sum(debit)-sum(credit) equals latest balance', num(debitSum - creditSum) === (await balanceOf(A, cust)), { debitSum, creditSum, bal: await balanceOf(A, cust) });

  // Delete
  const live: any = await PaymentService.createPayment(A.id, mk({ amount: 100 }), uid);
  const balWith = await balanceOf(A, cust);
  await PaymentService.deletePayment(A.id, live.id, uid);
  check('D1 delete posted receipt restores balance +100', (await balanceOf(A, cust)) === balWith + 100, await balanceOf(A, cust));
  const gone = (await pool.query('SELECT count(*)::int n FROM payments WHERE id=$1', [live.id])).rows[0].n;
  check('D1 receipt row removed', gone === 0);

  // Backdated receipt then later entry: running balance must include it
  const bd: any = await PaymentService.createPayment(A.id, mk({ amount: 50, paymentDate: '2026-10-01' }), uid);
  const afterBd = await balanceOf(A, cust);
  const expectBd = debitCredit(await rows(A, cust));
  const nxt: any = await PaymentService.createPayment(A.id, mk({ amount: 10, paymentDate: '2026-11-15' }), uid);
  const afterNext = await balanceOf(A, cust);
  check('B1 backdated receipt latest balance accounts for it', afterBd === num(expectBd), { afterBd });
  check('B2 next receipt reduces balance by exactly 10', num(afterNext) === num(afterBd - 10), { afterBd, afterNext });
  const f = await rows(A, cust);
  check('B3 latest balance equals sum(debit)-sum(credit) after backdating', afterNext === num(debitCredit(f)), { afterNext, expect: debitCredit(f) });

  // Statement is chronological and agrees with the stored latest balance
  const st: any = await PaymentService.getPartyStatement(A.id, cust);
  const ents = st.entries as any[];
  let ordered = true;
  for (let i = 1; i < ents.length; i++) if (new Date(ents[i].transactionDate) < new Date(ents[i - 1].transactionDate)) ordered = false;
  check('B4 statement entries are in chronological order (backdated receipt sits before later ones)', ordered);
  check('B5 statement closing equals stored latest balance', num(ents[ents.length - 1].rawBalance) === (await balanceOf(A, cust)), { closing: ents[ents.length - 1].rawBalance, stored: await balanceOf(A, cust) });

  // Concurrency: many simultaneous receipts for one party must not lose a balance update
  const custC = await mkParty(A, 'CC1');
  await mkInvoice(A, custC, 'IC1', 5000);
  const startC = await balanceOf(A, custC);
  const N = 8;
  const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => PaymentService.createPayment(A.id, mk({ partyId: custC, amount: 100 + i, paymentDate: `2026-11-${10 + i}` }), uid)));
  const okN = results.filter(r => r.status === 'fulfilled').length;
  const paid = results.reduce((sum, r: any, i) => sum + (r.status === 'fulfilled' ? 100 + i : 0), 0);
  check('K1 all concurrent receipts posted', okN === N, results.filter(r => r.status === 'rejected').map((r: any) => r.reason?.message));
  const sumRows = debitCredit(await rows(A, custC));
  check('K2 ledger debits minus credits equals invoice minus receipts', num(sumRows) === num(startC - paid), { sumRows, expect: startC - paid });
  check('K3 stored latest balance equals the true total after concurrent posts', (await balanceOf(A, custC)) === num(sumRows), { stored: await balanceOf(A, custC), true: sumRows });
  const stC: any = await PaymentService.getPartyStatement(A.id, custC);
  check('K4 statement closing equals true total', num(stC.entries[stC.entries.length - 1].rawBalance) === num(sumRows));

  // HTTP layer with real auth
  const server = createExpressApp().listen(0, '127.0.0.1');
  await new Promise<void>(r => (server.listening ? r() : server.once('listening', r)));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (path: string, init: any = {}, token?: string) => {
    const r = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } , body: init.body });
    let body: any = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'rcpt_staff', password: 'Test#Pass123' }) });
  const tok = login.body?.token;
  check('H0 staff login', login.status === 200 && !!tok, login.body);
  const create = await call('/api/payments', { method: 'POST', body: JSON.stringify(mk({ amount: 25, allocations: [{ documentType: 'SALES_INVOICE', documentId: inv2, allocatedAmount: 25 }] })) }, tok);
  check('H1 POST /api/payments by staff creates receipt', create.status === 201 && create.body?.status === 'POSTED', create.body);
  const list = await call('/api/payments?paymentType=RECEIPT', {}, tok);
  check('H2 list includes the receipt', list.status === 200 && JSON.stringify(list.body).includes(create.body?.id ?? '??'), list.status);
  const xt = await call('/api/payments', { method: 'POST', body: JSON.stringify(mk({ partyId: custB })) }, tok);
  check('H3 staff cannot receipt a party of another business', xt.status === 400, xt.body);
  const nocreds = await call('/api/payments', { method: 'POST', body: JSON.stringify(mk()) });
  check('H4 unauthenticated rejected', nocreds.status === 401, nocreds.status);
  const cancel = await call(`/api/payments/${create.body?.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'http test' }) }, tok);
  check('H5 cancel via API', cancel.status === 200 && cancel.body?.status === 'CANCELLED', cancel.body);
  const xcancel = await call(`/api/payments/${r1.id}/cancel`, { method: 'POST', body: JSON.stringify({}) }, (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'rcpt_staff', password: 'Test#Pass123' }) })).body?.token);
  check('H6 own-business cancel still works (control)', xcancel.status === 200, xcancel.body);
  server.close();

  await pool.end();
  if (failures) { console.error(`${failures} receipt check(s) FAILED`); process.exit(1); }
  console.log('All receipt integration checks passed.');
}
async function rows(biz: any, party: string) {
  return (await pool.query(`SELECT debit, credit FROM customer_ledgers WHERE business_id=$1 AND party_id=$2`, [biz.id, party])).rows;
}
function debitCredit(rs: any[]) { return rs.reduce((s, r) => s + num(r.debit) - num(r.credit), 0); }
main().catch(e => { console.error(e); process.exit(1); });
