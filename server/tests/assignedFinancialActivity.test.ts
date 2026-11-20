import assert from 'node:assert/strict';import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import {pool} from '../db/index.js';import {getAssignedFinancialActivity} from '../services/assignedFinancialActivityService.js';
try{
 const {rows:[business]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic isolated activity') RETURNING id`);
 const {rows:[party]}=await pool.query(`INSERT INTO parties(business_id,party_code,name,party_type) VALUES($1,'ACTIVITY','Shared historical party','BOTH') RETURNING id`,[business.id]);
 const origins=[];for(const code of ['OWN','OTHER']){const {rows:[g]}=await pool.query(`INSERT INTO godowns(business_id,code,name) VALUES($1,$2,$2) RETURNING id`,[business.id,code]);origins.push(g.id);}const [own,other]=origins;
 const invoices=[];for(const [index,origin] of [own,other,null].entries()){const {rows:[invoice]}=await pool.query(`INSERT INTO sales_invoices(business_id,godown_id,party_id,invoice_number,invoice_date) VALUES($1,$2,$3,$4,'2026-11-20') RETURNING id`,[business.id,origin,party.id,['OWN_DOC','FOREIGN_SECRET','PARENT_SECRET'][index]]);invoices.push(invoice.id);}
 for(const table of ['customer_ledgers','supplier_ledgers']){
  // Every stored running balance is deliberately parent-wide and must never be returned.
  const insert=async(origin:string|null,reference:string|null,debit:number,credit:number,date='2026-11-20',refType='SALES_INVOICE')=>pool.query(`INSERT INTO ${table}(business_id,party_id,godown_id,transaction_type,reference_type,reference_id,debit,credit,balance,transaction_date) VALUES($1,$2,$3,'SALE',$4,$5,$6,$7,666999,$8)`,[business.id,party.id,origin,refType,reference,debit,credit,date]);
  await insert(own,invoices[0],10,0,'2026-11-19');
  await insert(null,invoices[0],0,2); // Historical reversal omitted origin, safe exact document attribution.
  await insert(other,invoices[1],902,0);await insert(null,invoices[2],901,0);
  await insert(own,invoices[1],903,0); // Explicit origin conflicts with known foreign document.
  await insert(own,invoices[2],904,0); // Known parent document has NULL origin, not unknown document.
  await insert(null,null,905,0,'2026-11-20','OPENING'); // No origin cannot establish an opening.
 }
 const snapshot=async()=>{const {rows}=await pool.query(`SELECT md5(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text)) AS h FROM (SELECT * FROM customer_ledgers UNION ALL SELECT * FROM supplier_ledgers)t`);return rows[0].h;};const before=await snapshot();
 for(const partyType of ['CUSTOMER','SUPPLIER']){
  const result=await getAssignedFinancialActivity({businessId:business.id,originId:own},{partyType});assert.equal(result.summary.entries,2);assert.equal(result.summary.debit,10);assert.equal(result.summary.credit,2);assert.equal(result.summary.netActivity,partyType==='CUSTOMER'?8:-8);assert.equal(result.reconciledOpening,false);assert.equal(result.openingBalance,null);assert.equal(result.closingBalance,null);const text=JSON.stringify(result);assert(!text.includes('666999')&&!text.includes('SECRET'));assert(result.data.some(row=>row.attribution==='REFERENCED_DOCUMENT'));
  const filtered=await getAssignedFinancialActivity({businessId:business.id,originId:own},{partyType,startDate:'2026-11-20',endDate:'2026-11-20',limit:1});assert.equal(filtered.summary.entries,1);assert.equal(filtered.summary.debit,0);assert.equal(filtered.summary.credit,2);
 }
 assert.equal(await snapshot(),before);await assert.rejects(()=>getAssignedFinancialActivity({businessId:business.id,originId:own},{partyType:'INJECT'}),/Choose/);
 console.log('PASS attributed activity: explicit own and missing-origin exact-document reversal retained; foreign, parent and conflicting references excluded; parent-wide stored balances never selected; no inferred opening/closing/outstanding; customer/supplier signs and date filters correct; no ledger writes.');
}finally{await pool.end();}
