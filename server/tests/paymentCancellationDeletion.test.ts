import assert from 'node:assert/strict';
import {pool} from '../db/index.js';
import {PaymentService} from '../services/paymentService.js';
const url=new URL(process.env.DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/erp_receipt_edges')throw Error('Isolated edge-test DB only');
async function main(){
 const inv=(await pool.query("SELECT * FROM sales_invoices WHERE invoice_number='INV-000489' LIMIT 1")).rows[0];
 const user=(await pool.query('SELECT id FROM users WHERE is_super_admin=true LIMIT 1')).rows[0];
 const bid=inv.business_id;const uid=user.id;
 const baseline=(await pool.query("SELECT (SELECT count(*) FROM payments) payments,(SELECT count(*) FROM payment_allocations) allocations,(SELECT count(*) FROM customer_ledgers) ledgers")).rows[0];
 const dto:any={paymentType:'RECEIPT',partyId:inv.party_id,paymentMode:'CASH',paymentDate:'2026-11-20',amount:50,notes:'ISOLATED EDGE AUDIT',autoPost:true,allocations:[{documentType:'SALES_INVOICE',documentId:inv.id,allocatedAmount:50}]};
 await assert.rejects(()=>PaymentService.createPayment(bid,{...dto,amount:0},uid),/greater than zero/);console.log('Zero amount rejected PASS');
 await assert.rejects(()=>PaymentService.createPayment(bid,{...dto,amount:30},uid),/allocat/i);console.log('Allocation over receipt amount rejected PASS');
 await assert.rejects(()=>PaymentService.createPayment(bid,{...dto,amount:200,allocations:[{...dto.allocations[0],allocatedAmount:200}]},uid),/outstanding|exceed/i);console.log('Invoice over-allocation rejected PASS');
 const pay:any=await PaymentService.createPayment(bid,{...dto,idempotencyKey:'isolated-edges-20261120'},uid);
 const retry:any=await PaymentService.createPayment(bid,{...dto,idempotencyKey:'isolated-edges-20261120'},uid);assert.equal(pay.id,retry.id);console.log('Idempotent retry same payment PASS');
 let state=(await pool.query('SELECT payment_status FROM sales_invoices WHERE id=$1',[inv.id])).rows[0];assert.equal(state.payment_status,'PARTIAL');console.log('Partial allocation invoice status PASS');
 await PaymentService.cancelPayment(bid,pay.id,'Isolated cancellation audit',uid);
 state=(await pool.query('SELECT payment_status FROM sales_invoices WHERE id=$1',[inv.id])).rows[0];assert.equal(state.payment_status,inv.payment_status);console.log('Cancellation reverses invoice payment status PASS');
 await assert.rejects(()=>PaymentService.updatePayment(bid,pay.id,{amount:60},uid),/cancelled/i);console.log('Cancelled voucher edit rejected PASS');
 const cancelledInvoice=(await pool.query('SELECT updated_at FROM sales_invoices WHERE id=$1',[inv.id])).rows[0];
 await PaymentService.deletePayment(bid,pay.id,uid);
 const deletedInvoice=(await pool.query('SELECT updated_at FROM sales_invoices WHERE id=$1',[inv.id])).rows[0];assert.deepEqual(deletedInvoice,cancelledInvoice);console.log('Cancelled deletion does not resync invoice timestamp PASS');
 const orphan=(await pool.query('SELECT count(*)::int n FROM customer_ledgers WHERE reference_id=$1',[pay.id])).rows[0];console.log('Cancelled then deleted ledger rows remaining',orphan.n);
 const draft:any=await PaymentService.createPayment(bid,{...dto,autoPost:false,allocations:[]},uid);
 await PaymentService.updatePayment(bid,draft.id,{amount:75,notes:'ISOLATED EDGE AUDIT EDIT'},uid);
 const edited:any=await PaymentService.getPaymentById(bid,draft.id);assert.equal(edited.amount,75);assert.equal(edited.status,'DRAFT');
 await PaymentService.postPayment(bid,draft.id,uid);const posted:any=await PaymentService.getPaymentById(bid,draft.id);assert.equal(posted.status,'POSTED');assert.equal(posted.unallocatedAmount,75);console.log('Draft edit, post and advance balance PASS');
 await PaymentService.deletePayment(bid,draft.id,uid);
 const supplier=(await pool.query("SELECT id FROM parties WHERE business_id=$1 AND party_type IN ('SUPPLIER','BOTH') AND status='ACTIVE' LIMIT 1",[bid])).rows[0];
 if(supplier){
  const sp:any=await PaymentService.createPayment(bid,{paymentType:'PAYMENT',partyId:supplier.id,paymentMode:'CASH',paymentDate:'2026-11-20',amount:12,autoPost:true,notes:'ISOLATED SUPPLIER EDGE AUDIT'},uid);
  await PaymentService.cancelPayment(bid,sp.id,'Isolated supplier cancellation audit',uid);
  await PaymentService.deletePayment(bid,sp.id,uid);
  const remaining=(await pool.query('SELECT count(*)::int n FROM supplier_ledgers WHERE reference_id=$1',[sp.id])).rows[0];assert.equal(remaining.n,0);console.log('Supplier payment cancel/delete no orphan rows PASS');
 }
 const after=(await pool.query("SELECT (SELECT count(*) FROM payments) payments,(SELECT count(*) FROM payment_allocations) allocations,(SELECT count(*) FROM customer_ledgers) ledgers")).rows[0];
 console.log('Before',baseline,'After',after);assert.deepEqual(after,baseline);assert.equal(orphan.n,0);console.log('All receipt edge cases and counts PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
