import { BusinessRelationshipService } from '../services/businessRelationshipService.js';
import { SalesService } from '../services/salesService.js';
import { DealerLogisticsService } from '../services/dealerLogisticsService.js';
import assert from 'node:assert/strict';
import { createExpressApp } from '../app.js';
import { pool } from '../db/index.js';
import { generateAuthToken } from '../auth/jwt.js';
import { PurchaseService } from '../services/purchaseService.js';
import { findOrCreateOpticalBatch } from '../services/opticalMasterService.js';

// Disposable synthetic database only. Never run against a business database.
assert(new URL(process.env.DATABASE_URL!).hostname === '127.0.0.1');
assert(new URL(process.env.DATABASE_URL!).pathname === '/erp_tenant_synth');
const app = createExpressApp();
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve));
const address = server.address() as {port: number};
try {
  const { rows: [dealer] } = await pool.query(`SELECT * FROM businesses WHERE business_type='DEALER' AND parent_business_id IS NOT NULL ORDER BY created_at LIMIT 1`);
  const { rows: [admin] } = await pool.query(`SELECT * FROM users WHERE is_super_admin=true LIMIT 1`);
  const { rows: [item] } = await pool.query(`SELECT * FROM unique_items WHERE business_id=$1 AND optical_category='SV' LIMIT 1`, [dealer.parent_business_id]);
  const batches = [];
  for (const sph of [-1.5, -2.5]) {
    const { batch } = await findOrCreateOpticalBatch({businessId:dealer.parent_business_id,uniqueItemId:item.id,sph,cyl:0});
    await pool.query(`UPDATE optical_stocks SET physical_stock=100,available_stock=100-reserved_stock WHERE business_id=$1 AND batch_id=$2`, [dealer.parent_business_id,batch.id]);
    batches.push(batch.id);
  }
  // Generic Business relationship, independent of stored legacy type/parent.
  const legacySettings=dealer.settings_config;
  await BusinessRelationshipService.setSupplier(dealer.id,dealer.parent_business_id,{isSuperAdmin:true,userId:admin.id});
  await pool.query(`UPDATE businesses SET business_type='MAIN',parent_business_id=NULL WHERE id=$1`,[dealer.id]);
  const token = generateAuthToken({userId:admin.id,username:admin.username,isSuperAdmin:true,businessId:dealer.id});
  const snapshot = async () => {
    const {rows} = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    const hashes = [];
    for (const {tablename} of rows) {
      const {rows:[row]} = await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename.replaceAll('"','""')}" t`);
      hashes.push([tablename,row.hash]);
    }
    return JSON.stringify(hashes);
  };
  const body = {idempotencyKey:'synthetic-linked-order-'+Date.now(),lines:[{uniqueItemId:item.id,quantity:1,rate:250,batches:[{batchId:batches[0],quantity:1}]},{uniqueItemId:item.id,quantity:2,rate:300,batches:[{batchId:batches[1],quantity:2}]}]};
  const request = async (payload: any = body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/dealer/order`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Business-Id':dealer.id},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    return {status:response.status,data:await response.json()};
  };
  const {rows:[viewer]} = await pool.query(`INSERT INTO users(username,full_name,password_hash,user_permissions_override) VALUES($1,'Read-only synthetic','not-a-login','{"master:view":true}') RETURNING id,username`,['route_viewer_'+Date.now()]);
  await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true)`,[viewer.id,dealer.id]);
  const viewerToken=generateAuthToken({userId:viewer.id,username:viewer.username,isSuperAdmin:false,businessId:dealer.id});
  const viewerBefore=await snapshot();
  const viewerResponse=await fetch(`http://127.0.0.1:${address.port}/api/dealer/order`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+viewerToken,'X-Business-Id':dealer.id},body:JSON.stringify(body)});
  assert.equal(viewerResponse.status,403,'Read-only master:view must not place orders');
  assert.equal(await snapshot(),viewerBefore);
  const before = await snapshot();
  const original = PurchaseService.createPurchaseOrder;
  try {
    PurchaseService.createPurchaseOrder = async () => {throw new Error('ISOLATED_PO_FAILURE');};
    const failed = await request();
    assert.equal(failed.status,400);
    assert.match(failed.data.error,/ISOLATED_PO_FAILURE/);
  } finally {PurchaseService.createPurchaseOrder=original;}
  assert.equal(await snapshot(),before,'Failed PO must roll back SO/reservations/dealer link/catalogue/sequence rows');
  await pool.query(`CREATE OR REPLACE FUNCTION synthetic_reject_order_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='DEALER_ORDER_PLACED' THEN RAISE EXCEPTION 'ISOLATED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_reject_order_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION synthetic_reject_order_audit()`);
  try {
    const auditBefore=await snapshot();
    const rejectedAudit=await request();
    assert.equal(rejectedAudit.status,400,'An audit failure must not leave a committed unaudited dealer order');
    assert.equal(await snapshot(),auditBefore,'Audit failure must roll back the full linked order');
  } finally {
    await pool.query(`DROP TRIGGER synthetic_reject_order_audit ON audit_logs; DROP FUNCTION synthetic_reject_order_audit()`);
  }
  const success = await request();
  assert.equal(success.status,201,JSON.stringify(success.data));
  assert(success.data.order.dealerPurchaseOrderId);
  const {rows:poBatches} = await pool.query(`SELECT ob.sph,plb.quantity,plb.rate FROM purchase_order_line_batches plb JOIN purchase_order_lines pol ON pol.id=plb.purchase_order_line_id JOIN optical_batches ob ON ob.id=plb.batch_id WHERE pol.purchase_order_id=$1 ORDER BY ob.sph`,[success.data.order.dealerPurchaseOrderId]);
  assert.deepEqual(poBatches.map(x=>[Number(x.sph),Number(x.quantity),Number(x.rate)]),[[-2.5,2,300],[-1.5,1,250]]);
  const retrySnapshot=await snapshot();
  const retry=await request();
  assert.equal(retry.status,200);
  assert.equal(retry.data.order.id,success.data.order.id);
  assert.equal(await snapshot(),retrySnapshot,'Idempotent retry must not add reservations or change rows');
  body.idempotencyKey += '-concurrent';
  const concurrent = await Promise.all([request(), request()]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,201]);
  assert.equal(concurrent[0].data.order.id,concurrent[1].data.order.id);
  const {rows: audits} = await pool.query(`SELECT action FROM audit_logs WHERE entity_id=ANY($1::text[])`, [[concurrent[0].data.order.id, concurrent[0].data.order.mainSalesOrderId, concurrent[0].data.order.dealerPurchaseOrderId]]);
  assert.equal(audits.length,3,'SO, PO and dealer order audits must be durable together');
  const invalidLines = [
    [{uniqueItemId:item.id,quantity:2,rate:250,batches:[{batchId:batches[0],quantity:1}]}],
    [{uniqueItemId:item.id,quantity:1,rate:-1,batches:[{batchId:batches[0],quantity:1}]}],
    [{uniqueItemId:item.id,quantity:1,rate:250,batches:[{batchId:batches[0],quantity:1},{batchId:batches[1],quantity:-1}]}],
    [1,2].map(()=>({uniqueItemId:item.id,quantity:60,rate:250,batches:[{batchId:batches[0],quantity:60}]})),
    [{uniqueItemId:crypto.randomUUID(),quantity:1,rate:250,batches:[{batchId:batches[0],quantity:1}]}],
  ];
  for (let i=0;i<invalidLines.length;i++) {
    const beforeInvalid=await snapshot();
    const invalid=await request({idempotencyKey:body.idempotencyKey+'-invalid'+i,lines:invalidLines[i]});
    assert.equal(invalid.status,400,JSON.stringify(invalid));
    assert.equal(await snapshot(),beforeInvalid,'Invalid/shortage request changed rows');
    if(i===3) assert.match(invalid.data.error,/Requested: 120.*Currently Available/);
  }
  const sameBatchLines=body.lines.map(line=>({...line,batches:[{batchId:batches[0],quantity:line.quantity}]}));
  const sameBatchOrder=await request({idempotencyKey:body.idempotencyKey+'-same-power',lines:sameBatchLines});
  assert.equal(sameBatchOrder.status,201,JSON.stringify(sameBatchOrder));
  for (const [currentOrder, currentLines] of [[success,body.lines],[sameBatchOrder,sameBatchLines]] as const) {
  const invoice=await SalesService.createSalesInvoice(dealer.parent_business_id,{partyId:currentOrder.data.order.salesOrder.partyId,salesOrderId:currentOrder.data.order.mainSalesOrderId,status:'POSTED',lines:currentLines});
  const {shipment}=await DealerLogisticsService.createShipment({mainBusinessId:dealer.parent_business_id,dealerBusinessId:dealer.id,mainSalesInvoiceId:invoice.id,mainSalesOrderId:currentOrder.data.order.mainSalesOrderId,dealerOrderId:currentOrder.data.order.id,dealerPurchaseOrderId:currentOrder.data.order.dealerPurchaseOrderId});
  const receipts=[];
  for (let part=0;part<2;part++) {
    const receipt=await DealerLogisticsService.confirmDealerGoodsReceipt({dealerBusinessId:dealer.id,dealerShipmentId:shipment.id,lines:shipment.lines.map((line:any)=>({shipmentLineId:line.id,receivedQuantity:Number(line.dispatched_quantity)/2}))});
    assert.equal(receipt.shipmentStatus,part===0?'PARTIALLY_RECEIVED':'RECEIVED');
    const {rows:priced}=await pool.query(`SELECT quantity,rate FROM purchase_invoice_lines WHERE purchase_invoice_id=$1 ORDER BY rate`,[receipt.purchaseInvoiceId]);
    assert.deepEqual(priced.map(r=>[Number(r.quantity),Number(r.rate)]),[[0.5,250],[1,300]],'Receipt must preserve commercial lines at different rates');
    const poState=await PurchaseService.getPurchaseOrderById(dealer.id,currentOrder.data.order.dealerPurchaseOrderId);
    const remainingLines=poState.lines.map((line:any)=>[Number(line.rate),line.invoicedQuantity,line.remainingQuantity]).sort((a:any,b:any)=>a[0]-b[0]);
    assert.deepEqual(remainingLines,part===0?[[250,0.5,0.5],[300,1,1]]:[[250,1,0],[300,2,0]],'Partial PO line remaining quantity must count every received unit only once');
    receipts.push(receipt.purchaseInvoiceId);
  }
  const {rows:[receiptTotals]}=await pool.query(`SELECT SUM(taxable_amount) AS taxable FROM purchase_invoices WHERE id=ANY($1::uuid[])`,[receipts]);
  assert.equal(Number(receiptTotals.taxable),850,'Two partial receipts must match original linked order taxable amount');
  }
  await pool.query(`UPDATE unique_items SET mrp=0,purchase_rate=0 WHERE id=$1`,[item.id]);
  await pool.query(`DELETE FROM party_item_prices WHERE business_id=$1 AND unique_item_id=$2`,[dealer.parent_business_id,item.id]);
  const priceBefore=await snapshot();
  const noPrice=await request({idempotencyKey:body.idempotencyKey+'-no-price',lines:[{uniqueItemId:item.id,quantity:1,batches:[{batchId:batches[0],quantity:1}]}]});
  assert.equal(noPrice.status,400,JSON.stringify(noPrice));
  assert.match(noPrice.data.error,/No configured dealer\/item price/);
  assert.equal(await snapshot(),priceBefore,'Missing-price request must not invent a price or write rows');
  await pool.query(`UPDATE businesses SET business_type='DEALER',parent_business_id=$2,settings_config=$3::jsonb WHERE id=$1`,[dealer.id,dealer.parent_business_id,JSON.stringify(legacySettings||{})]);
  console.log('PASS full linked order, dispatch and partial receiving between generic Business records, no type/parent required.');
  console.log('PASS dealer route atomic PO failure rollback, retry, two-power quantities/rates, concurrent idempotency and transactional audits');
} finally {
  await new Promise<void>(resolve => server.close(()=>resolve()));
  await pool.end();
}
