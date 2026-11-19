import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {pool} from '../db/index.js';
import {ExportService} from '../services/exportService.js';
import {ReportService} from '../services/reportService.js';
const url=new URL(process.env.DATABASE_URL||'');if(url.hostname!=='127.0.0.1'||url.pathname!=='/erp_restore')throw Error('Read-only backup restore only');
async function main(){
 const inv=(await pool.query("SELECT business_id,party_id FROM sales_invoices WHERE invoice_number='INV-000489' LIMIT 1")).rows[0];
 const filters={startDate:'2026-10-21',endDate:'2026-11-20'};
 const expected=(await pool.query('SELECT count(*)::int n,coalesce(sum(grand_total),0)::numeric total FROM sales_invoices WHERE business_id=$1 AND invoice_date BETWEEN $2 AND $3',[inv.business_id,filters.startDate,filters.endDate])).rows[0];
 const report:any=await ReportService.getSalesReport(inv.business_id,filters);assert.equal(report.summary.totalInvoices,expected.n);assert.equal(report.summary.grandTotal,Number(expected.total));console.log('Sales report SQL reconciliation PASS',report.summary.totalInvoices,report.summary.grandTotal);
 for(const dataset of ['INVENTORY','STOCK_LEDGER','SALES_INVOICES','PURCHASE_INVOICES','PAYMENTS','CUSTOMER_OUTSTANDING','SUPPLIER_OUTSTANDING','PARTY_STATEMENT','PRODUCT_SALES','POWER_SALES'] as any[]){
  const f:any={...filters,partyId:inv.party_id,partyType:'CUSTOMER'};
  const output=await ExportService.exportDataset(inv.business_id,dataset,f);
  const book=XLSX.read(output.buffer,{type:'buffer'});const rows:any[]=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);assert.ok(book.SheetNames.includes('Export Metadata'));
  if(output.rowCount>0)assert.equal(rows.length,output.rowCount);
  for(const row of rows)for(const value of Object.values(row))assert.ok(!['NaN','Invalid Date'].includes(String(value)));
  if(dataset==='SALES_INVOICES'){assert.equal(output.rowCount,expected.n);const sum=rows.reduce((s,r)=>s+Number(r['Grand Total']||0),0);assert.equal(Math.round(sum*100),Math.round(Number(expected.total)*100));}
  console.log(dataset,'XLSX parses, rows',output.rowCount,'PASS');
 }
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
