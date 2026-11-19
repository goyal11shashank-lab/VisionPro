import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {pool} from '../db/index.js';
import {ExportService} from '../services/exportService.js';
import {ReportService} from '../services/reportService.js';
import {createExportSheet} from '../utils/exportSheet.js';
const url=new URL(process.env.DATABASE_URL||'');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/erp_restore')throw Error('Read-only backup restore only');
async function main(){
 const inv=(await pool.query("SELECT business_id,party_id FROM sales_invoices WHERE invoice_number='INV-000489' LIMIT 1")).rows[0];
 const bid=inv.business_id, dates={startDate:'2026-10-21',endDate:'2026-11-20'};
 const cases:any[]=[
  ['SALES_INVOICES',{...dates,search:'INV-000489'},()=>ReportService.getSalesReport(bid,{...dates,search:'INV-000489'})],
  ['SALES_INVOICES',{...dates,search:'does-not-exist-audit'},()=>ReportService.getSalesReport(bid,{...dates,search:'does-not-exist-audit'})],
  ['PURCHASE_INVOICES',{...dates,search:'PUR-000012'},()=>ReportService.getPurchaseReport(bid,{...dates,search:'PUR-000012'})],
  ['SALES_DETAILS',{...dates,search:'INV-000489'},()=>ReportService.getSalesDetailReport(bid,{...dates,search:'INV-000489'})],
  ['PURCHASE_DETAILS',{...dates,search:'PUR-000012'},()=>ReportService.getPurchaseDetailReport(bid,{...dates,search:'PUR-000012'})],
  ['INVENTORY',{sph:0,cyl:0},()=>ReportService.getInventoryReport(bid,{sph:0,cyl:0})],
  ['INVENTORY',{search:'BC LRB',sph:-1,cyl:-.5},()=>ReportService.getInventoryReport(bid,{search:'BC LRB',sph:-1,cyl:-.5})],
  ['INVENTORY',{search:'does-not-exist-audit'},()=>ReportService.getInventoryReport(bid,{search:'does-not-exist-audit'})],
  ['CUSTOMER_OUTSTANDING',{search:'Cash'},()=>ReportService.getOutstandingReport(bid,'CUSTOMER',{search:'Cash'})],
  ['SUPPLIER_OUTSTANDING',{search:'UHD'},()=>ReportService.getOutstandingReport(bid,'SUPPLIER',{search:'UHD'})],
  ['PAYMENTS',{...dates,search:'Cash'},()=>ReportService.getPaymentReport(bid,{...dates,search:'Cash'})],
  ['STOCK_LEDGER',{...dates,barcode:'not-found-audit'},()=>ReportService.getStockLedgerReport(bid,{...dates,barcode:'not-found-audit'})],
 ];
 for(const [dataset,filters,read] of cases){
  const report=await read();const output=await ExportService.exportDataset(bid,dataset,filters);
  assert.equal(output.rowCount,report.pagination.totalItems,`${dataset} ${JSON.stringify(filters)}`);
  const book=XLSX.read(output.buffer,{type:'buffer'});const rows:any[]=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
  if(dataset==='SALES_INVOICES'&&output.rowCount){assert.equal(rows.length,1);assert.equal(rows[0]['Invoice Number'],'INV-000489');assert.equal(rows[0]['Grand Total'],130);}
  if(dataset==='INVENTORY')for(const r of rows){if(filters.sph!==undefined){assert.equal(r.SPH,filters.sph);assert.equal(r.CYL,filters.cyl)}}
  console.log('PASS filter parity',dataset,JSON.stringify(filters),output.rowCount);
 }
 const outstandingAll=await ReportService.getOutstandingReport(bid,'CUSTOMER',{limit:500});
 const outstandingSmall=await ReportService.getOutstandingReport(bid,'CUSTOMER',{limit:1,page:2});
 assert.deepEqual(outstandingSmall.summary,outstandingAll.summary);
 const totalOverdue=outstandingAll.data.reduce((sum,r)=>sum+r.overdueBalance,0);
 const totalPositive=outstandingAll.data.reduce((sum,r)=>sum+Math.max(0,r.currentBalance),0);
 assert.ok(Math.abs(outstandingAll.summary.totalOverdue-totalOverdue)<.01);
 assert.ok(Math.abs(outstandingAll.summary.totalOutstanding-totalPositive)<.01);
 const cash=await ReportService.getOutstandingReport(bid,'CUSTOMER',{search:'Cash'});
 assert.equal(cash.summary.totalParties,1);
 assert.equal(cash.summary.totalOutstanding,Math.max(0,cash.data[0].currentBalance));
 console.log('PASS outstanding summaries across pages and filtered party');
 const ws=createExportSheet([{'Mobile':'08800181931','Barcode':'000123','Invoice Number':'001','Grand Total':'130.00','Credit Days':'0','SPH':'-0.50'}]);
 assert.equal(ws.A2.t,'s');assert.equal(ws.A2.v,'08800181931');assert.equal(ws.B2.t,'s');assert.equal(ws.C2.t,'s');assert.equal(ws.D2.t,'n');assert.equal(ws.D2.v,130);assert.equal(ws.E2.t,'n');assert.equal(ws.F2.v,-.5);assert.ok(ws['!autofilter']);
 console.log('PASS workbook numeric cells, preserved identifiers, autofilter');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
