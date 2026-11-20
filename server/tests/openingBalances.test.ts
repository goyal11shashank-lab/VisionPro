/** Opening balances on a disposable DB: party-create posts one OPENING_BALANCE ledger row
 *  with the correct side/sign per party type, and the cash-movement endpoint reports
 *  opening/closing CASH balances once a cash opening is configured. */
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
import { PartyService } from '../services/partyService.js';
import { BusinessSettingsService } from '../services/businessSettingsService.js';

let mig = await runMigrations();
if (!mig.success) { await runMigration0003(); mig = await runMigrations(); }
if (!mig.success) throw new Error('migration failed');
await pool.query(`INSERT INTO users(username,full_name,password_hash,is_super_admin,status) VALUES('syn_sa','Synthetic SA',$1,true,'ACTIVE') ON CONFLICT DO NOTHING`, [await hashPassword('Syn#Admin123')]);
const { rows: [admin] } = await pool.query('SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1');

const server = createExpressApp().listen(0, '127.0.0.1');
await new Promise<void>(r => (server.listening ? r() : server.once('listening', r)));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const call = async (biz: string, path: string) => {
  const tok = generateAuthToken({ userId: admin.id, username: admin.username, isSuperAdmin: true, businessId: biz });
  const r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + tok, 'X-Business-Id': biz } });
  return { status: r.status, data: await r.json() as any };
};

try {
  const A = (await db.insert(businesses).values({ name: 'OpeningBal A', status: 'ACTIVE', state: 'Delhi' } as any).returning())[0];

  // --- Party opening balance ---
  const ledgerRows = async (table: string, partyId: string) =>
    (await pool.query(`SELECT transaction_type, debit::float AS debit, credit::float AS credit, balance::float AS balance FROM ${table} WHERE business_id=$1 AND party_id=$2`, [A.id, partyId])).rows;

  // CUSTOMER Dr -> customer_ledgers debit, balance +amount
  const custDr = await PartyService.createParty(A.id, { name: 'CustDr', partyType: 'CUSTOMER', openingBalance: 5000, openingBalanceType: 'Dr' }, admin.id);
  let rows = await ledgerRows('customer_ledgers', custDr.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].transaction_type, 'OPENING_BALANCE');
  assert.deepEqual([rows[0].debit, rows[0].credit, rows[0].balance], [5000, 0, 5000], 'customer Dr');

  // CUSTOMER Cr -> credit, balance -amount
  const custCr = await PartyService.createParty(A.id, { name: 'CustCr', partyType: 'CUSTOMER', openingBalance: 1200.5, openingBalanceType: 'Cr' }, admin.id);
  rows = await ledgerRows('customer_ledgers', custCr.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].debit, rows[0].credit, rows[0].balance], [0, 1200.5, -1200.5], 'customer Cr');

  // SUPPLIER Cr -> supplier_ledgers credit, balance +amount (Cr-positive)
  const supCr = await PartyService.createParty(A.id, { name: 'SupCr', partyType: 'SUPPLIER', openingBalance: 8000, openingBalanceType: 'Cr' }, admin.id);
  rows = await ledgerRows('supplier_ledgers', supCr.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].transaction_type, 'OPENING_BALANCE');
  assert.deepEqual([rows[0].debit, rows[0].credit, rows[0].balance], [0, 8000, 8000], 'supplier Cr');
  rows = await ledgerRows('customer_ledgers', supCr.id);
  assert.equal(rows.length, 0, 'supplier posts nothing to customer ledger');

  // SUPPLIER Dr -> debit, balance -amount
  const supDr = await PartyService.createParty(A.id, { name: 'SupDr', partyType: 'SUPPLIER', openingBalance: 300, openingBalanceType: 'Dr' }, admin.id);
  rows = await ledgerRows('supplier_ledgers', supDr.id);
  assert.deepEqual([rows[0].debit, rows[0].credit, rows[0].balance], [300, 0, -300], 'supplier Dr');

  // BOTH: Dr goes to customer side, Cr to supplier side
  const bothDr = await PartyService.createParty(A.id, { name: 'BothDr', partyType: 'BOTH', openingBalance: 700, openingBalanceType: 'Dr' }, admin.id);
  rows = await ledgerRows('customer_ledgers', bothDr.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].balance, 700, 'BOTH Dr -> customer ledger');
  const bothCr = await PartyService.createParty(A.id, { name: 'BothCr', partyType: 'BOTH', openingBalance: 900, openingBalanceType: 'Cr' }, admin.id);
  rows = await ledgerRows('supplier_ledgers', bothCr.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].balance, 900, 'BOTH Cr -> supplier ledger');

  // No opening balance -> no ledger rows
  const plain = await PartyService.createParty(A.id, { name: 'Plain', partyType: 'CUSTOMER' }, admin.id);
  rows = await ledgerRows('customer_ledgers', plain.id);
  assert.equal(rows.length, 0, 'no opening balance, no ledger row');

  // Zero / junk values -> no ledger rows
  const zero = await PartyService.createParty(A.id, { name: 'Zero', partyType: 'CUSTOMER', openingBalance: 0, openingBalanceType: 'Dr' }, admin.id);
  rows = await ledgerRows('customer_ledgers', zero.id);
  assert.equal(rows.length, 0, 'zero opening ignored');

  // Party statement reflects the opening balance
  const stmt = await call(A.id, `/api/parties/${custDr.id}/ledger?ledgerType=CUSTOMER`);
  assert.equal(stmt.status, 200, JSON.stringify(stmt.data));
  assert.equal(Number(stmt.data.summary?.closingBalance ?? stmt.data.summary?.currentBalance ?? NaN), 5000, 'statement closing reflects opening');

  // --- Cash opening balance ---
  const pa = custDr.id;
  const pay = (n: string, type: string, mode: string, amt: number, date: string) =>
    pool.query(`INSERT INTO payments (business_id,party_id,payment_number,payment_type,payment_mode,amount,unallocated_amount,status,payment_date) VALUES ($1,$2,$3,$4,$5,$6,0,'POSTED',$7)`, [A.id, pa, n, type, mode, amt, date]);
  await pay('OR1', 'RECEIPT', 'CASH', 2000, '2026-11-05');   // before from
  await pay('OP1', 'PAYMENT', 'CASH', 500, '2026-11-10');    // before from
  await pay('IR1', 'RECEIPT', 'CASH', 1000, '2026-11-15');   // in period
  await pay('IP1', 'PAYMENT', 'CASH', 250, '2026-11-18');    // in period
  await pay('IB1', 'RECEIPT', 'BANK', 4000, '2026-11-15');   // other mode, ignored
  await pay('OLD', 'RECEIPT', 'CASH', 999, '2026-10-01');    // before opening date, excluded

  // Unconfigured: no balances
  let r = await call(A.id, '/api/payments/cash-movement?from=2026-11-11&to=2026-11-20');
  assert.equal(r.data.openingBalanceConfigured, false);
  assert.equal(r.data.openingBalance, null);

  // Configure cash opening: 10000 on 2026-11-01
  await BusinessSettingsService.updateSettings(A.id, { settings: { accounts: { cashOpeningBalance: 10000, cashOpeningDate: '2026-11-01' } } }, admin.id);
  r = await call(A.id, '/api/payments/cash-movement?from=2026-11-11&to=2026-11-20');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.openingBalanceConfigured, true);
  assert.equal(r.data.cashOpeningDate, '2026-11-01');
  assert.equal(r.data.openingBalance, 10000 + 2000 - 500, 'opening as of from = configured + pre-period cash net');
  assert.equal(r.data.modes.CASH.net, 1000 - 250, 'period net only counts in-period rows');
  assert.equal(r.data.closingBalance, 11500 + 750, 'closing = opening + period net');

  // No from: opening equals configured opening
  r = await call(A.id, '/api/payments/cash-movement');
  assert.equal(r.data.openingBalance, 10000, 'no from -> opening is the configured value');

  // Restore-defaults style clearing: date cleared -> unconfigured again
  await BusinessSettingsService.updateSettings(A.id, { settings: { accounts: { cashOpeningBalance: 0, cashOpeningDate: '' } } }, admin.id);
  r = await call(A.id, '/api/payments/cash-movement?from=2026-11-11&to=2026-11-20');
  assert.equal(r.data.openingBalanceConfigured, false, 'clearing date unconfigures');

  console.log('ALL PASS opening balances');
} finally { server.close(); await pool.end().catch(() => {}); }
