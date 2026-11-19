import assert from 'node:assert/strict';
import {pool} from '../db/index.js';
import {ReportService as R} from '../services/reportService.js';
import {ExportService as E} from '../services/exportService.js';
import * as XLSX from 'xlsx';
const u=new URL(process.env.DATABASE_URL||'');if(u.hostname!=='127.0.0.1'||u.pathname!=='/erp_restore')throw Error('Read-only backup restore only');
async function run(){
 const bid=(await pool.query("SELECT business_id FROM sales_invoices WHERE invoice_number='INV-000489' LIMIT 1")).rows[0].business_id;
 const dates={startDate:'2026-10-21',endDate:'2026-11-20'};
 for(const kind of ['sales','purchase']){
  const read=(f:any)=>kind==='sales'?R.getSalesDetailReport(bid,f):R.getPurchaseDetailReport(bid,f);
  const dataset=kind==='sales'?'SALES_DETAILS':'PURCHASE_DETAILS';
  const all=await read({...dates,limit:500});const page2=await read({...dates,limit:1,page:2});assert.deepEqual(all.summary,page2.summary);
  const expected=(await pool.query(`SELECT count(*)::int lines,sum(l.quantity)::numeric quantity,sum(l.line_total)::numeric amount FROM ${kind}_invoice_lines l JOIN ${kind}_invoices i ON l.${kind}_invoice_id=i.id WHERE i.business_id=$1 AND i.invoice_date BETWEEN $2 AND $3`,[bid,dates.startDate,dates.endDate])).rows[0];
  assert.equal(all.summary.totalLines,expected.lines);assert.equal(all.summary.totalQuantity,Number(expected.quantity));assert.equal(all.summary.totalAmount,Number(expected.amount));
  const exported=await E.exportDataset(bid,dataset,{...dates});assert.equal(exported.rowCount,all.pagination.totalItems);assert.ok(all.pagination.totalItems>all.summary.totalLines,'multi-batch pagination regression fixture required');
  const wb=XLSX.read(exported.buffer,{type:'buffer'});const metadata=XLSX.utils.sheet_to_json(wb.Sheets['Export Metadata']) as any[];assert.ok(metadata.some(r=>r.Parameter==='Amount Scope'&&r.Value.includes('Do not sum detail rows')));
  const empty=await read({...dates,search:'does-not-exist-audit'});assert.equal(empty.summary.totalLines,0);assert.equal(empty.summary.totalAmount,0);assert.equal(empty.pagination.totalItems,0);
  console.log('PASS',kind,'distinct commercial line totals, stable summary across pages, batch-row pagination/export count and scope warning');
 }
 const inv=await R.getSalesDetailReport(bid,{...dates,search:'INV-000489'});assert.equal(inv.summary.totalLines,1);assert.equal(inv.summary.totalQuantity,1);assert.equal(inv.summary.totalAmount,130);assert.equal(inv.pagination.totalItems,2);assert.equal(inv.data[0].quantity,1);assert.equal(inv.data[1].quantity,1);
 console.log('PASS invoice489 two batch rows, commercial summary1pair/130, no invented batch allocation');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
