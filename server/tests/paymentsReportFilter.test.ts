import assert from 'node:assert/strict';
import { pool } from '../db/index.js';
import { ReportService } from '../services/reportService.js';
const url=new URL(process.env.DATABASE_URL||'');if(url.hostname!=='127.0.0.1'||url.pathname!=='/erp_audit')throw Error('Local audit only');
(async()=>{try{
const {rows:[{business_id:bid}]}=await pool.query("SELECT business_id FROM sales_invoices WHERE invoice_number='INV-000489' LIMIT 1");
const {rows:[{n}]}=await pool.query('SELECT count(*)::int n FROM payments WHERE business_id=$1',[bid]);
const all=await ReportService.getPaymentReport(bid,{paymentType:'ALL',paymentMode:'ALL'} as any);assert.equal(all.summary.totalPayments,n);assert.ok(n>0);
const searched=await ReportService.getPaymentReport(bid,{search:'Cash'});assert.ok(searched.summary.totalPayments>0);
console.log('Payment register ALL filters and joined party search PASS',n);
}finally{await pool.end()}})().catch(e=>{console.error(e);process.exitCode=1});
