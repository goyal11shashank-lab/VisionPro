import assert from 'node:assert/strict';import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import {pool} from '../db/index.js';import {createExpressApp} from '../app.js';import {generateAuthToken} from '../auth/jwt.js';
const server=createExpressApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.listening?r():server.once('listening',r));const port=(server.address() as any).port;
try{
 const {rows:[base]}=await pool.query(`SELECT ob.id AS batch_id,ob.business_id FROM optical_batches ob JOIN categories c ON c.id=ob.category_id LIMIT 1`);assert(base);
 const ids=[];for(const name of ['Assigned synthetic stock','Foreign synthetic stock']){const {rows:[g]}=await pool.query(`INSERT INTO godowns(business_id,code,name) VALUES($1,$2,$3) RETURNING id`,[base.business_id,'SCOPE-'+crypto.randomUUID().slice(0,8),name]);ids.push(g.id);}const [own,foreign]=ids;
 await pool.query(`UPDATE optical_stocks SET physical_stock=901,reserved_stock=0,available_stock=901 WHERE business_id=$1 AND batch_id=$2 AND godown_id IS NULL`,[base.business_id,base.batch_id]);
 for(const [gid,quantity] of [[own,3.5],[foreign,902]]){await pool.query(`INSERT INTO optical_stocks(business_id,batch_id,godown_id,physical_stock,reserved_stock,available_stock) VALUES($1,$2,$3,$4,0,$4)`,[base.business_id,base.batch_id,gid,quantity]);await pool.query(`INSERT INTO stock_ledger(business_id,batch_id,godown_id,transaction_type,quantity_in,balance,reason) VALUES($1,$2,$3,'OPENING_STOCK',$4,$4,$5)`,[base.business_id,base.batch_id,gid,quantity,gid===own?'OWN_SCOPED_HISTORY':'FOREIGN_HISTORY_MUST_NOT_LEAK']);}
 const {rows:[user]}=await pool.query(`INSERT INTO users(username,full_name,password_hash,assigned_godown_id,user_permissions_override) VALUES($1,'Synthetic assigned staff','not-a-login',$2,'{"inventory:view":true,"reports:view":true,"sales:view":true,"purchase:view":true,"accounts:view":true}') RETURNING id,username`,['syn_legacy_'+Date.now(),own]);
 const token=generateAuthToken({userId:user.id,username:user.username,isSuperAdmin:false,businessId:base.business_id});
 const api=async(path:string,method='GET')=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:'Bearer '+token,'X-Business-Id':base.business_id,'Content-Type':'application/json'},body:method==='POST'?'{}':undefined});return {status:r.status,data:await r.json() as any};};
 const snapshot=async()=>{const {rows:tables}=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);const result=[];for(const {tablename} of tables){const {rows:[r]}=await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS h FROM public."${tablename.replaceAll('"','""')}" t`);result.push([tablename,r.h]);}return JSON.stringify(result);};
 const before=await snapshot();
 for(const override of ['',`?godownId=${foreign}`,'?godownId=ALL','?godownId=MAIN']){
   const inventory=await api('/api/inventory'+override);assert.equal(inventory.status,200,JSON.stringify(inventory));assert.equal(inventory.data.items.length,1);assert.equal(inventory.data.items[0].physicalStock,3.5);
   const report=await api('/api/reports/inventory'+override);assert.equal(report.status,200,JSON.stringify(report));assert.equal(report.data.summary.totalPhysical,3.5);assert.equal(report.data.data.length,1);
 }
 const ledger=await api('/api/reports/stock-ledger?godownId='+foreign);assert.equal(ledger.status,200);assert.equal(ledger.data.data.length,1);assert(!JSON.stringify(ledger.data).includes('FOREIGN_HISTORY'));assert(JSON.stringify(ledger.data).includes('OWN_SCOPED_HISTORY'));
 for(const path of ['/api/dashboard/summary','/api/dealer/dashboard/summary','/api/inventory/dealer/dashboard/summary','/api/stock-items','/api/batches/'+base.batch_id+'/ledger','/api/search?q=synthetic','/api/reports/inventory?export=true','/api/reports/stock-ledger?export=true','/api/businesses/settings','/api/business-stock/catalogue'])assert.equal((await api(path)).status,403,'Unadapted historical route must fail closed '+path);
 assert.equal((await api('/api/godowns/'+foreign+'/stock')).status,403);assert.equal((await api('/api/inventory/godowns/'+foreign+'/stock')).status,403);
 const {rows:[party]}=await pool.query(`SELECT id FROM parties WHERE business_id=$1 LIMIT 1`,[base.business_id]);assert(party);
 const invoices=[];for(const gid of [null,foreign,own]){const {rows:[invoice]}=await pool.query(`INSERT INTO sales_invoices(business_id,godown_id,party_id,invoice_number,status) VALUES($1,$2,$3,$4,'DRAFT') RETURNING id`,[base.business_id,gid,party.id,'SYN-SCOPE-'+crypto.randomUUID()]);invoices.push(invoice.id);}
 for(const id of invoices.slice(0,2)){assert.equal((await api('/api/sales/invoices/'+id)).status,403);assert.equal((await api('/api/sales/invoices/'+id+'/cancel','POST')).status,403);}
 assert.equal((await api('/api/sales/invoices/'+invoices[2])).status,200);
 // Financial registers scope data, detail rows and every summary to the same origin.
 const {rows:[item]}=await pool.query(`SELECT unique_item_id FROM optical_batches WHERE id=$1`,[base.batch_id]);
 for(const [index,gid] of [null,foreign,own].entries()){
  const value=[901,902,3.5][index];const marker=['MAIN_SECRET','FOREIGN_SECRET','OWN_FINANCIAL'][index];
  await pool.query(`UPDATE sales_invoices SET invoice_number=$2,grand_total=$3,subtotal=$3 WHERE id=$1`,[invoices[index],marker+'-'+crypto.randomUUID().slice(0,8),value]);
  const {rows:[purchase]}=await pool.query(`INSERT INTO purchase_invoices(business_id,godown_id,supplier_party_id,invoice_number,invoice_date,status,grand_total,subtotal) VALUES($1,$2,$3,$4,NOW(),'DRAFT',$5,$5) RETURNING id`,[base.business_id,gid,party.id,marker+'-'+crypto.randomUUID().slice(0,8),value]);
  for(const [table,col,id] of [['sales_invoice_lines','sales_invoice_id',invoices[index]],['purchase_invoice_lines','purchase_invoice_id',purchase.id]])await pool.query(`INSERT INTO ${table}(${col},unique_item_id,quantity,rate,taxable_amount,line_total) VALUES($1,$2,1,$3,$3,$3)`,[id,item.unique_item_id,value]);
  for(const [table,col,partyCol,id] of [['sales_returns','sales_invoice_id','party_id',invoices[index]],['purchase_returns','purchase_invoice_id','supplier_party_id',purchase.id]])await pool.query(`INSERT INTO ${table}(business_id,${col},${partyCol},return_number,grand_total,subtotal) VALUES($1,$2,$3,$4,$5,$5)`,[base.business_id,id,party.id,marker+'-'+crypto.randomUUID().slice(0,8),value]);
  await pool.query(`INSERT INTO payments(business_id,godown_id,party_id,payment_number,payment_type,payment_mode,amount,unallocated_amount) VALUES($1,$2,$3,$4,'RECEIPT','CASH',$5,$5)`,[base.business_id,gid,party.id,marker+'-'+crypto.randomUUID().slice(0,8),value]);
 }
 const beforeFinancialReads=await snapshot();
 for(const path of ['sales','sales/details','sales/returns','purchases','purchases/details','purchases/returns','payments']){
  const result=await api('/api/reports/'+path+'?godownId='+foreign);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.data.length,1,path);const text=JSON.stringify(result.data);assert(!text.includes('MAIN_SECRET')&&!text.includes('FOREIGN_SECRET'),path);assert(text.includes('OWN_FINANCIAL'),path);
  const summary=result.data.summary;assert.equal(summary.grandTotal??summary.totalAmount,3.5,path);assert.equal((await api('/api/reports/'+path+'?export=true')).status,403,path);
 }
 assert.equal(await snapshot(),beforeFinancialReads,'Scoped report reads never rewrite historical records');
 console.log('PASS historical scoped financial reports: sales/purchase registers, detail, returns and payments show only own3.5, not parent901/foreign902; summaries match; exports remain denied; every table unchanged.');
 // Only the explicit fixture invoice insertions happened after the before snapshot.
 const afterFixtures=await snapshot();assert.equal((await api('/api/reports/inventory?godownId='+foreign)).data.summary.totalPhysical,3.5);assert.equal(await snapshot(),afterFixtures);
 assert(before!==afterFixtures);
 console.log('PASS legacy assigned-scope isolation: main901/foreign902 never leak into own3.5 inventory/report; client ALL/MAIN/foreign overrides ignored; stock-ledger history scoped; unadapted dashboard/search/export/settings/cross-Business routes denied; null/foreign document reads and mutations denied; own document retained; reads change no rows.');
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
