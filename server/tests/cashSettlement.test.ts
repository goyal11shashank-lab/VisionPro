/**
 * Cash/Bank settlement of Sales and Purchase vouchers on a disposable real database:
 * atomic with the voucher, no double settlement, edit/cancel/delete reversal, credit unchanged,
 * and failure between invoice and settlement rolls the whole voucher back.
 */
import { assertSyntheticDatabase } from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import { pool, db } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { runMigration0003 } from '../db/migrations/0003_purchase_orders_and_draft_migration.js';
import { businesses, uniqueItems, categories, opticalBatches } from '../db/schema.js';
import { SalesService } from '../services/salesService.js';
import { PurchaseService } from '../services/purchaseService.js';
import { PaymentService } from '../services/paymentService.js';

let failures = 0;
const check = (n: string, ok: boolean, extra?: any) => { if (ok) console.log('PASS', n); else { failures++; console.error('FAIL', n, extra ?? ''); } };
const q = async (sql: string, p: any[] = []) => (await pool.query(sql, p)).rows;
const num = (v: any) => Math.round(parseFloat(v) * 100) / 100;

async function main() {
  let mig = await runMigrations();
  if (!mig.success) { await runMigration0003(); mig = await runMigrations(); }
  if (!mig.success) throw new Error('migration failed');
  const mk = async (name: string) => (await db.insert(businesses).values({ name, status: 'ACTIVE', state: 'Delhi' } as any).returning())[0];
  const A = await mk('Cash A'); const B = await mk('Cash B');
  const [cat] = await db.insert(categories).values({ businessId: A.id, name: 'SV', code: 'SV' } as any).returning();
  const [item] = await db.insert(uniqueItems).values({ businessId: A.id, name: 'Cash Lens', code: 'CASH-LENS' } as any).returning();
  const [batch] = await db.insert(opticalBatches).values({ businessId: A.id, uniqueItemId: item.id, categoryId: cat.id, barcode: 'CASHB-1', sph: '1.00', cyl: '-0.50', identityKey: 'cash-1' } as any).returning();
  const party = async (biz: string, name: string, type: string) => (await q(`INSERT INTO parties (business_id,name,party_code,party_type,mobile,status,state) VALUES ($1,$2,$3,$4,'9000000000','ACTIVE','Delhi') RETURNING id`, [biz, name, name.slice(0, 6) + Math.random().toString(36).slice(2, 6), type]))[0].id;
  const cust = await party(A.id, 'Cust One', 'CUSTOMER');
  const supp = await party(A.id, 'Supp One', 'SUPPLIER');
  const bal = async (id: string) => num((await q(`SELECT COALESCE((SELECT SUM(debit-credit) FROM customer_ledgers WHERE party_id=$1),0) + COALESCE((SELECT SUM(credit-debit) FROM supplier_ledgers WHERE party_id=$1),0) AS b`, [id]))[0].b);
  const pays = async (biz: string) => q(`SELECT id,payment_type,payment_mode,amount,status FROM payments WHERE business_id=$1 ORDER BY created_at`, [biz]);

  // stock in via a CREDIT purchase (no settlement)
  const p0 = await PurchaseService.createPurchaseInvoice(A.id, { supplierPartyId: supp, invoiceDate: new Date(), status: 'POSTED', lines: [{ uniqueItemId: item.id, quantity: 50, rate: 100, gstRate: 0, batches: [{ batchId: batch.id, quantity: 50, rate: 100 }] }] } as any);
  check('credit purchase creates no payment', (await pays(A.id)).length === 0);
  const suppBalCredit = await bal(supp);

  // CASH sale
  const s1: any = await SalesService.createSalesInvoice(A.id, { partyId: cust, invoiceDate: new Date(), status: 'POSTED', paymentMode: 'CASH', lines: [{ uniqueItemId: item.id, quantity: 3, rate: 200, gstRate: 0, batches: [{ batchId: batch.id, quantity: 3 }] }] } as any);
  let ps = await pays(A.id);
  check('cash sale creates exactly one posted CASH receipt for the total', ps.length === 1 && ps[0].payment_type === 'RECEIPT' && ps[0].payment_mode === 'CASH' && ps[0].status === 'POSTED' && num(ps[0].amount) === num(s1.grandTotal), ps);
  check('cash sale invoice is PAID and customer balance net zero', s1 && (await q(`SELECT payment_status FROM sales_invoices WHERE id=$1`, [s1.id]))[0].payment_status === 'PAID' && (await bal(cust)) === 0);

  const got: any = await SalesService.getSalesInvoiceById(A.id, s1.id);
  check('settled voucher reports settlementMode CASH when reopened', got.settlementMode === 'CASH', got.settlementMode);
  // CREDIT sale unchanged
  const s2: any = await SalesService.createSalesInvoice(A.id, { partyId: cust, invoiceDate: new Date(), status: 'POSTED', lines: [{ uniqueItemId: item.id, quantity: 1, rate: 200, gstRate: 0, batches: [{ batchId: batch.id, quantity: 1 }] }] } as any);
  check('credit sale creates no receipt and stays unpaid', (await pays(A.id)).length === 1 && (await bal(cust)) === num(s2.grandTotal));
  // DRAFT cash sale: no settlement until posted
  const s3: any = await SalesService.createSalesInvoice(A.id, { partyId: cust, invoiceDate: new Date(), status: 'DRAFT', paymentMode: 'CASH', lines: [{ uniqueItemId: item.id, quantity: 1, rate: 200, gstRate: 0, batches: [{ batchId: batch.id, quantity: 1 }] }] } as any);
  check('draft cash sale creates no receipt', (await pays(A.id)).length === 1);

  // Idempotent replay
  const k = 'idem-cash-1';
  const mkS = () => SalesService.createSalesInvoice(A.id, { partyId: cust, invoiceDate: new Date(), status: 'POSTED', paymentMode: 'CASH', idempotencyKey: k, lines: [{ uniqueItemId: item.id, quantity: 1, rate: 100, gstRate: 0, batches: [{ batchId: batch.id, quantity: 1 }] }] } as any);
  const r1: any = await mkS(); const r2: any = await mkS();
  check('idempotent replay returns same invoice and one extra receipt only', r1.id === r2.id && (await pays(A.id)).length === 2, (await pays(A.id)).length);

  // Edit a cash sale: total changes, settlement re-created for new total, old one cancelled
  const before = (await pays(A.id)).length;
  await SalesService.updateSalesInvoice(A.id, s1.id, { partyId: cust, invoiceDate: new Date(), status: 'POSTED', lines: [{ uniqueItemId: item.id, quantity: 4, rate: 200, gstRate: 0, batches: [{ batchId: batch.id, quantity: 4 }] }] } as any);
  ps = await pays(A.id);
  const active = ps.filter(p => p.status === 'POSTED' && p.payment_mode === 'CASH');
  const total1 = num((await q(`SELECT grand_total FROM sales_invoices WHERE id=$1`, [s1.id]))[0].grand_total);
  const s1Active = await q(`SELECT p.amount FROM payments p JOIN payment_allocations pa ON pa.payment_id=p.id WHERE pa.document_id=$1 AND pa.status='ACTIVE' AND p.status='POSTED'`, [s1.id]);
  check('edit: exactly one active settlement for the new total, old cancelled', s1Active.length === 1 && num(s1Active[0].amount) === total1 && ps.length === before + 1 && ps.filter(p => p.status === 'CANCELLED').length === 1, { s1Active, total1 });
  check('edit: customer balance still reflects only the credit sale', (await bal(cust)) === num(s2.grandTotal) + num(s3.grandTotal) * 0 , await bal(cust));

  // Cancel the cash sale: settlement reversed, no orphan
  await SalesService.cancelSalesInvoice(A.id, s1.id, 'test', undefined);
  check('cancel: no active settlement remains for the voucher', (await q(`SELECT 1 FROM payments p JOIN payment_allocations pa ON pa.payment_id=p.id WHERE pa.document_id=$1 AND pa.status='ACTIVE' AND p.status<>'CANCELLED'`, [s1.id])).length === 0);
  // Delete another cash sale (r1)
  await SalesService.deleteSalesInvoice(A.id, r1.id, undefined);
  check('delete: its receipt is cancelled, invoice gone', (await q(`SELECT 1 FROM sales_invoices WHERE id=$1`, [r1.id])).length === 0 && (await q(`SELECT 1 FROM payments p JOIN payment_allocations pa ON pa.payment_id=p.id WHERE pa.document_id=$1 AND p.status<>'CANCELLED'`, [r1.id])).length === 0);

  // Manual receipt allocated to a credit invoice still blocks cancel (existing guard preserved)
  await PaymentService.createPayment(A.id, { partyId: cust, paymentType: 'RECEIPT', paymentMode: 'CASH', amount: 50, allocations: [{ documentType: 'SALES_INVOICE', documentId: s2.id, allocatedAmount: 50 }], autoPost: true });
  let blocked = false; try { await SalesService.cancelSalesInvoice(A.id, s2.id, 'x', undefined); } catch { blocked = true; }
  check('manual receipt allocation still blocks cancel', blocked);

  // Failure between invoice and settlement: party of another business can't be settled -> whole voucher rolls back
  const invBefore = num((await q(`SELECT count(*) c FROM sales_invoices WHERE business_id=$1`, [A.id]))[0].c);
  const stockBefore = num((await q(`SELECT COUNT(*) AS physical_stock FROM stock_ledger WHERE batch_id=$1`, [batch.id]).catch(() => [{ physical_stock: 0 }]))[0]?.physical_stock ?? 0);
  const orig = (PaymentService as any).postPayment;
  (PaymentService as any).postPayment = async () => { throw new Error('injected settlement failure'); };
  let failed = false;
  try { await SalesService.createSalesInvoice(A.id, { partyId: cust, invoiceDate: new Date(), status: 'POSTED', paymentMode: 'CASH', lines: [{ uniqueItemId: item.id, quantity: 2, rate: 200, gstRate: 0, batches: [{ batchId: batch.id, quantity: 2 }] }] } as any); } catch { failed = true; }
  (PaymentService as any).postPayment = orig;
  const invAfter = num((await q(`SELECT count(*) c FROM sales_invoices WHERE business_id=$1`, [A.id]))[0].c);
  const stockAfter = num((await q(`SELECT COUNT(*) AS physical_stock FROM stock_ledger WHERE batch_id=$1`, [batch.id]).catch(() => [{ physical_stock: 0 }]))[0]?.physical_stock ?? 0);
  check('failure after invoice post: error surfaces, no invoice, no stock change, no payment left', failed && invAfter === invBefore && stockAfter === stockBefore && (await q(`SELECT 1 FROM payments WHERE business_id=$1 AND status='DRAFT'`, [A.id])).length === 0, { failed, invBefore, invAfter, stockBefore, stockAfter });

  // CASH purchase decreases cash (PAYMENT), supplier net unchanged
  const pc: any = await PurchaseService.createPurchaseInvoice(A.id, { supplierPartyId: supp, invoiceDate: new Date(), status: 'POSTED', paymentMode: 'CASH', lines: [{ uniqueItemId: item.id, quantity: 5, rate: 52, gstRate: 0, batches: [{ batchId: batch.id, quantity: 5, rate: 52 }] }] } as any);
  ps = await pays(A.id);
  const pp = ps.filter(p => p.payment_type === 'PAYMENT' && p.status === 'POSTED');
  check('cash purchase creates one posted CASH payment for the total', pp.length === 1 && pp[0].payment_mode === 'CASH' && num(pp[0].amount) === 260, pp);
  check('cash purchase leaves supplier balance as before', (await bal(supp)) === suppBalCredit, await bal(supp));
  await PurchaseService.cancelPurchaseInvoice(A.id, pc.id, 'test', undefined as any);
  check('purchase cancel reverses its payment', (await pays(A.id)).filter(p => p.payment_type === 'PAYMENT' && p.status === 'POSTED').length === 0);

  // BANK mode recorded as BANK (no account invented)
  const sb: any = await SalesService.createSalesInvoice(A.id, { partyId: cust, invoiceDate: new Date(), status: 'POSTED', paymentMode: 'BANK', lines: [{ uniqueItemId: item.id, quantity: 1, rate: 100, gstRate: 0, batches: [{ batchId: batch.id, quantity: 1 }] }] } as any);
  check('bank sale recorded as BANK receipt with no bank name invented', (await q(`SELECT 1 FROM payments WHERE business_id=$1 AND payment_mode='BANK' AND bank_name IS NULL AND status='POSTED'`, [A.id])).length === 1);

  // Selling more than the recorded stock saves (setting default allows negative stock) and stock goes negative
  const over: any = await SalesService.createSalesInvoice(A.id, { partyId: cust, invoiceDate: new Date(), status: 'POSTED', lines: [{ uniqueItemId: item.id, quantity: 500, rate: 10, gstRate: 0, batches: [{ batchId: batch.id, quantity: 500 }] }] } as any);
  const negStock = num((await q(`SELECT physical_stock FROM optical_stocks WHERE batch_id=$1 AND business_id=$2 LIMIT 1`, [batch.id, A.id]))[0]?.physical_stock);
  check('sale beyond recorded stock saves server-side and stock goes negative', !!over.id && negStock < 0, negStock);

  // Tenant: other business has nothing
  check('other business has no payments', (await pays(B.id)).length === 0);
  await pool.end();
  if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
  console.log('ALL PASS');
}
main().catch(e => { console.error(e); process.exit(1); });
