import assert from 'node:assert/strict';
import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import {pool} from '../db/index.js';
import {createExpressApp} from '../app.js';
import {hashPassword} from '../auth/password.js';
import {buildSalesmanPermissions} from '../services/staffRolePolicy.js';
import {findOrCreateOpticalBatch} from '../services/opticalMasterService.js';
import {WhatsAppService} from '../services/whatsapp/whatsappService.js';
let transportCalls=0;
for(const name of ['initiateLinkSession','requestPairingCode','confirmAuthentication','disconnectSession','testConnection','enqueueInvoiceMessage','dispatchQueueItem','retryQueueItem','updateWhatsAppSettings']) (WhatsAppService as any)[name]=async()=>{transportCalls++;throw Error('FORBIDDEN_TRANSPORT');};
// Auto-save hook is stubbed too: this suite verifies accounting, not outbound delivery.
(WhatsAppService as any).handleInvoiceSavedAutoSend=async()=>{};
const server=createExpressApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.listening?r():server.once('listening',r));const port=(server.address() as any).port;
try{
const run=Date.now().toString(36);
const {rows:[business]}=await pool.query(`INSERT INTO businesses(name,status,state,state_code) VALUES($1,'ACTIVE','Maharashtra','27') RETURNING id`,['Synthetic Salesman '+run]);
const {rows:[role]}=await pool.query(`INSERT INTO roles(business_id,name,code,is_system) VALUES($1,'Salesman',$2,false) RETURNING id`,[business.id,'STAFF_'+run.toUpperCase()]);
const scope=buildSalesmanPermissions(['inventory:view','inventory.view']);
assert(!scope.includes('reports:view'),'Existing inventory-only report access must not become all reports');
for(const code of scope){await pool.query(`INSERT INTO permissions(module,action,code) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING`,[code.split(':')[0],'staff_fixture',code]);await pool.query(`INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2`,[role.id,code]);}
const secret='LocalSyntheticOnly_712!';const {rows:[user]}=await pool.query(`INSERT INTO users(username,full_name,password_hash,is_super_admin) VALUES($1,'Salesman',$2,false) RETURNING id,username`,['synthetic_sales_'+run,await hashPassword(secret)]);
await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true)`,[user.id,business.id]);await pool.query(`INSERT INTO user_roles(user_id,business_id,role_id) VALUES($1,$2,$3)`,[user.id,business.id,role.id]);
const login=await fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:secret})});assert.equal(login.status,200);const token=(await login.json() as any).token;
const api=async(path:string,method='GET',body?:any)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:'Bearer '+token,'X-Business-Id':business.id,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json() as any};};
const {rows:[party]}=await pool.query(`INSERT INTO parties(business_id,party_code,name,party_type,state) VALUES($1,'SYNTHETIC','Synthetic both party','BOTH','Maharashtra') RETURNING id`,[business.id]);
const {rows:[item]}=await pool.query(`INSERT INTO unique_items(business_id,name,code,optical_category,maintain_batches) VALUES($1,'Synthetic SV','SYNTHETIC_SV','SV',true) RETURNING id`,[business.id]);
const {rows:[category]}=await pool.query(`INSERT INTO categories(business_id,name,code) VALUES($1,'Synthetic Single Vision','SV') RETURNING id`,[business.id]);
const {batch}=await findOrCreateOpticalBatch({businessId:business.id,uniqueItemId:item.id,categoryId:category.id,sph:-1,cyl:0});
const lines=[{uniqueItemId:item.id,quantity:2,rate:10,gstRate:0,batches:[{batchId:batch.id,quantity:2}]}];
const po=await api('/api/purchases/orders','POST',{supplierPartyId:party.id,lines});assert.equal(po.status,201,JSON.stringify(po));
const pi=await api('/api/purchases/invoices','POST',{supplierPartyId:party.id,invoiceDate:'2026-11-20',status:'POSTED',lines});assert.equal(pi.status,201,JSON.stringify(pi));
const so=await api('/api/sales/orders','POST',{partyId:party.id,status:'DRAFT',lines});assert.equal(so.status,201,JSON.stringify(so));
const si=await api('/api/sales/invoices','POST',{partyId:party.id,status:'POSTED',invoiceDate:'2026-11-20',lines:[{...lines[0],quantity:1,batches:[{batchId:batch.id,quantity:1}]}]});assert.equal(si.status,201,JSON.stringify(si));
const paymentIds=[];
for(const paymentType of ['RECEIPT','PAYMENT']){const p=await api('/api/payments','POST',{partyId:party.id,paymentType,paymentMode:'CASH',amount:5,autoPost:true,allocations:[{documentType:paymentType==='RECEIPT'?'SALES_INVOICE':'PURCHASE_INVOICE',documentId:paymentType==='RECEIPT'?si.data.id:pi.data.id,allocatedAmount:5}]});assert.equal(p.status,201,JSON.stringify(p));assert.equal(p.data.status,'POSTED');paymentIds.push(p.data.id);}
const updatedSI=await api('/api/sales/invoices/'+si.data.id,'PUT',{partyId:party.id,status:'POSTED',invoiceDate:'2026-11-20',lines:[{...lines[0],rate:11,quantity:1,batches:[{batchId:batch.id,quantity:1}]}]});assert.equal(updatedSI.status,200,JSON.stringify(updatedSI));
const updatedPI=await api('/api/purchases/invoices/'+pi.data.id,'PUT',{supplierPartyId:party.id,status:'POSTED',invoiceDate:'2026-11-20',lines:[{...lines[0],rate:12}]});assert.equal(updatedPI.status,200,JSON.stringify(updatedPI));
assert.equal(updatedSI.data.paymentStatus,'PARTIAL');assert.equal(updatedPI.data.paymentStatus,'PARTIAL');
const {rows:[salesLine]}=await pool.query(`SELECT id FROM sales_invoice_lines WHERE sales_invoice_id=$1`,[si.data.id]);
const {rows:[purchaseLine]}=await pool.query(`SELECT id FROM purchase_invoice_lines WHERE purchase_invoice_id=$1`,[pi.data.id]);
const sr=await api('/api/sales/returns','POST',{salesInvoiceId:si.data.id,status:'POSTED',reason:'Synthetic return',lines:[{salesInvoiceLineId:salesLine.id,uniqueItemId:item.id,quantity:0.5,batches:[{batchId:batch.id,quantity:0.5}]}]});assert.equal(sr.status,201,JSON.stringify(sr));assert.equal(sr.data.status,'POSTED');
const pr=await api('/api/purchases/returns','POST',{purchaseInvoiceId:pi.data.id,status:'POSTED',reason:'Synthetic return',lines:[{purchaseInvoiceLineId:purchaseLine.id,uniqueItemId:item.id,quantity:0.5,batches:[{batchId:batch.id,quantity:0.5}]}]});assert.equal(pr.status,201,JSON.stringify(pr));assert.equal(pr.data.status,'POSTED');
const snapshot=async()=>{const {rows:tables}=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);const result=[];for(const {tablename} of tables){const {rows:[r]}=await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename.replaceAll('"','""')}" t`);result.push([tablename,r.hash]);}return JSON.stringify(result);};
const id=si.data.id;const pid=pi.data.id;assert(id&&pid,JSON.stringify({si,pi}));
const denied:[string,string,any?][]=[
['/api/sales/invoices/'+id,'DELETE'],['/api/purchases/invoices/'+pid,'DELETE'],['/api/purchases/'+pid,'DELETE'],
['/api/sales/invoices/'+id+'/cancel','POST',{reason:'not allowed'}],['/api/purchases/invoices/'+pid+'/cancel','POST',{reason:'not allowed'}],['/api/purchases/'+pid+'/cancel','POST',{reason:'not allowed'}],

['/api/inventory/opening-stock','POST',{}],['/api/inventory/opening-stock/'+id,'PATCH',{quantity:999}],['/api/inventory/opening-stock/'+id,'DELETE'],['/api/inventory/opening-stock/bulk-delete','POST',{ids:[id]}],
['/api/sales/returns/'+sr.data.id,'DELETE'],['/api/purchases/returns/'+pr.data.id,'DELETE'],['/api/sales/returns/'+sr.data.id+'/cancel','POST',{reason:'not allowed'}],['/api/purchases/returns/'+pr.data.id+'/cancel','POST',{reason:'not allowed'}],
['/api/payments/'+paymentIds[0]+'/cancel','POST',{reason:'not allowed'}],['/api/payments/'+paymentIds[0],'DELETE'],
['/api/businesses/settings','PUT',{config:{}}],['/api/whatsapp/send-invoice','POST',{invoiceId:id}],
];
for(const [path,method,body] of denied){const before=await snapshot();const r=await api(path,method,body);assert.equal(r.status,403,path+' '+JSON.stringify(r));assert.equal(await snapshot(),before,'Forbidden request changed tables: '+path);}
for(const path of ['/api/inventory','/api/reports/inventory','/api/reports/stock-ledger','/api/sales/invoices','/api/purchases/invoices','/api/payments']){const r=await api(path);assert.equal(r.status,200,path+' '+JSON.stringify(r));}
const {rows:[stock]}=await pool.query(`SELECT physical_stock,available_stock FROM optical_stocks WHERE business_id=$1 AND batch_id=$2`,[business.id,batch.id]);assert.equal(Number(stock.physical_stock),1);assert.equal(Number(stock.available_stock),1);
const {rows:[customerLedger]}=await pool.query(`SELECT SUM(debit-credit) AS net FROM customer_ledgers WHERE business_id=$1 AND party_id=$2`,[business.id,party.id]);assert.equal(Number(customerLedger.net),0); // 11 sale - 6 rounded credit note - 5 receipt.
const {rows:[supplierLedger]}=await pool.query(`SELECT SUM(credit-debit) AS net FROM supplier_ledgers WHERE business_id=$1 AND party_id=$2`,[business.id,party.id]);assert.equal(Number(supplierLedger.net),13);
assert.equal(transportCalls,0);
console.log('PASS Salesman real login; create SO/PO, posted SI/PI, posted invoice edits, posted sales/purchase returns, posted cash receipt/payment; stock/inventory-ledger report reads unchanged; '+denied.length+' forbidden direct endpoints403 with every public-table hash unchanged; no outbound transport.');
console.log('Fixture business/user IDs for local UI verification: '+business.id+' '+user.id);
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
