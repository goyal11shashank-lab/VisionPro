import assert from 'node:assert/strict';
import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import {pool} from '../db/index.js';
import {createExpressApp} from '../app.js';
import {generateAuthToken} from '../auth/jwt.js';
import {DealerLogisticsService} from '../services/dealerLogisticsService.js';
import {PurchaseService} from '../services/purchaseService.js';
const server=createExpressApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.listening?r():server.once('listening',r));const port=(server.address() as any).port;
try{
 const {rows:[base]}=await pool.query(`SELECT ds.main_business_id,ds.dealer_business_id,dsl.main_unique_item_id,dsl.main_batch_id,dsl.rate FROM dealer_shipments ds JOIN dealer_shipment_lines dsl ON dsl.dealer_shipment_id=ds.id ORDER BY ds.created_at LIMIT 1`);
 assert(base,'Run lifecycle fixtures first');
 const {rows:[shipment]}=await pool.query(`INSERT INTO dealer_shipments(shipment_number,main_business_id,dealer_business_id,total_quantity,status) VALUES($1,$2,$3,4,'DISPATCHED') RETURNING id`,['SYN-RECEIVING-'+Date.now(),base.main_business_id,base.dealer_business_id]);
 const {rows:[line]}=await pool.query(`INSERT INTO dealer_shipment_lines(dealer_shipment_id,main_unique_item_id,main_batch_id,dispatched_quantity,rate,gst_rate) VALUES($1,$2,$3,4,$4,0) RETURNING id`,[shipment.id,base.main_unique_item_id,base.main_batch_id,base.rate]);
 const {rows:[user]}=await pool.query(`INSERT INTO users(username,full_name,password_hash,user_permissions_override) VALUES($1,'Synthetic receipt tester','not-a-login','{"sales:create":true,"inventory:edit":true,"master:edit":true,"purchase:view":true}') RETURNING id,username`,['syn_receipt_'+Date.now()]);
 await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true)`,[user.id,base.dealer_business_id]);
 const token=generateAuthToken({userId:user.id,username:user.username,isSuperAdmin:false,businessId:base.dealer_business_id});
 const headers={Authorization:'Bearer '+token,'X-Business-Id':base.dealer_business_id,'Content-Type':'application/json'};
 const snapshot=async()=>{const {rows:tables}=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);const result=[];for(const {tablename} of tables){const {rows:[r]}=await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename.replaceAll('"','""')}" t`);result.push([tablename,r.hash]);}return JSON.stringify(result);};
 const attempt={requestId:crypto.randomUUID(),receiptDate:'2026-11-20',remarks:'Synthetic half-pair partial inspection',lines:[{shipmentLineId:line.id,receivedQuantity:1,damagedQuantity:0.5,shortQuantity:0}]};
 const post=async(body:any,prefix='/api/dealer')=>{const r=await fetch(`http://127.0.0.1:${port}${prefix}/shipments/${shipment.id}/receive`,{method:'POST',headers,body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
 for(const prefix of ['/api/dealer','/api/inventory/dealer']){const before=await snapshot();assert.equal((await post(attempt,prefix)).status,403);assert.equal(await snapshot(),before);}
 await pool.query(`UPDATE users SET user_permissions_override='{"purchase:view":true,"purchase:create":true,"inventory:view":true}' WHERE id=$1`,[user.id]);
 const original=(PurchaseService as any)._postPurchaseInvoiceInternal;const beforeFail=await snapshot();
 try{(PurchaseService as any)._postPurchaseInvoiceInternal=async()=>{throw Error('SYN_RECEIPT_FAILURE');};const failed=await post(attempt);assert.equal(failed.status,400);assert.equal(failed.data.receiptOutcome,'NOT_POSTED');}finally{(PurchaseService as any)._postPurchaseInvoiceInternal=original;}
 assert.equal(await snapshot(),beforeFail,'Failed accounting or audit must leave no durable receipt token or counters');
 const [first,retry]=await Promise.all([post(attempt),post(attempt,'/api/inventory/dealer')]);assert.equal(first.status,200,JSON.stringify(first));assert.equal(retry.status,200,JSON.stringify(retry));assert.equal(first.data.goodsReceiptId,retry.data.goodsReceiptId);assert.equal(first.data.purchaseInvoiceId,retry.data.purchaseInvoiceId);assert.equal(first.data.shipmentStatus,'PARTIALLY_RECEIVED');
 const beforeRetry=await snapshot();assert.equal((await post(attempt)).data.goodsReceiptId,first.data.goodsReceiptId);assert.equal(await snapshot(),beforeRetry);
 const mismatch=await post({...attempt,lines:[{...attempt.lines[0],receivedQuantity:2}]});assert.equal(mismatch.status,400);assert.equal(mismatch.data.receiptOutcome,'REFERENCE_ALREADY_POSTED');assert.equal(await snapshot(),beforeRetry);
 const check=await DealerLogisticsService.getReceiptAttempt(base.dealer_business_id,shipment.id,attempt.requestId);assert(check.posted);assert.equal(check.result.goodsReceiptId,first.data.goodsReceiptId);assert.equal(await snapshot(),beforeRetry);
 await assert.rejects(()=>DealerLogisticsService.getReceiptAttempt(base.main_business_id,shipment.id,attempt.requestId),/access denied/);
 assert.equal((await DealerLogisticsService.getReceiptAttempt(base.dealer_business_id,shipment.id,crypto.randomUUID())).posted,false);
 const detail=await DealerLogisticsService.getShipmentDetails(shipment.id,base.dealer_business_id);assert.equal(Number(detail.lines[0].remaining_quantity),2.5);
 const receipts=await pool.query(`SELECT COUNT(*)::int AS n FROM dealer_goods_receipts WHERE dealer_shipment_id=$1`,[shipment.id]);assert.equal(receipts.rows[0].n,1);
 assert.equal((await post({...attempt,requestId:crypto.randomUUID(),lines:[{...attempt.lines[0],receivedQuantity:3}]})).status,400);assert.equal(await snapshot(),beforeRetry);
 // Simulate the database accepting COMMIT while its acknowledgement is lost.
 const {rows:[uncertainShipment]}=await pool.query(`INSERT INTO dealer_shipments(shipment_number,main_business_id,dealer_business_id,total_quantity,status) VALUES($1,$2,$3,1,'DISPATCHED') RETURNING id`,['SYN-UNKNOWN-'+Date.now(),base.main_business_id,base.dealer_business_id]);
 const {rows:[uncertainLine]}=await pool.query(`INSERT INTO dealer_shipment_lines(dealer_shipment_id,main_unique_item_id,main_batch_id,dispatched_quantity,rate,gst_rate) VALUES($1,$2,$3,1,$4,0) RETURNING id`,[uncertainShipment.id,base.main_unique_item_id,base.main_batch_id,base.rate]);
 const uncertainAttempt={...attempt,requestId:crypto.randomUUID(),dealerBusinessId:base.dealer_business_id,dealerShipmentId:uncertainShipment.id,userId:user.id,lines:[{shipmentLineId:uncertainLine.id,receivedQuantity:0.5,damagedQuantity:0,shortQuantity:0}]};
 const connect=pool.connect.bind(pool);let inject=true;
 (pool as any).connect=(...args:any[])=>{if(args.length)return (connect as any)(...args);return (async()=>{const client=await connect();const query=client.query.bind(client);return new Proxy(client,{get(target,key){if(key==='query')return async(...args:any[])=>{const result=await (query as any)(...args);if(inject&&args[0]==='COMMIT'){inject=false;throw Error('SYN_COMMIT_ACK_LOST');}return result;};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});})();};
 try{await assert.rejects(()=>DealerLogisticsService.confirmDealerGoodsReceipt(uncertainAttempt),(error:any)=>error.message==='SYN_COMMIT_ACK_LOST'&&error.receiptOutcome==='UNKNOWN');}finally{(pool as any).connect=connect;}
 const persisted=await DealerLogisticsService.getReceiptAttempt(base.dealer_business_id,uncertainShipment.id,uncertainAttempt.requestId);assert(persisted.posted);
 const beforeUnknownRetry=await snapshot();const recovered=await DealerLogisticsService.confirmDealerGoodsReceipt(uncertainAttempt);assert.equal(recovered.goodsReceiptId,persisted.result.goodsReceiptId);assert.equal(await snapshot(),beforeUnknownRetry);
 console.log('PASS committed-but-lost database acknowledgement reports UNKNOWN; persisted attempt is recoverable; identical retry never duplicates stock/accounting.');
 console.log('PASS receiving HTTP x2 mounts: sales/master/inventory mutation grants denied; purchase create allowed; partial good1/damaged0.5 leaves2.5; concurrent/repeated identical attempt posts once; changed payload rejects; failed accounting rolls back all tables; saved result read-only and recipient-scoped.');
 console.log('UI_FIXTURE '+JSON.stringify({businessId:base.dealer_business_id,userId:user.id,username:user.username,shipmentId:shipment.id,lineId:line.id}));
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
