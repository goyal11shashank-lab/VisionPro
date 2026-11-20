import {pool} from '../db/index.js';
/** Read-only adapter. Original Business/origin/document IDs remain authoritative. No raw sync payload/error text. */
export async function getAssignedB2bHistory(scope:{businessId:string;originId:string},options:{page?:number;limit?:number;status?:string}={}){
 const page=Number.isSafeInteger(options.page)&&options.page!>0?options.page!:1;
 const limit=Number.isSafeInteger(options.limit)&&options.limit!>0?Math.min(options.limit!,100):25;
 const status=options.status||null;if(status&&!['SYNCED','FAILED','CONFLICT','PENDING'].includes(status))throw new Error('Invalid history status.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows:[origin]}=await client.query('SELECT id,name FROM godowns WHERE id=$1 AND business_id=$2',[scope.originId,scope.businessId]);
  if(!origin)throw new Error('Assigned historical origin was not found in this Business.');
  // Require a coherent destination PO AND exact existing source reference, not a log's self-asserted scope alone.
  const from=`FROM b2b_order_sync_logs l JOIN purchase_orders po ON po.id=l.destination_purchase_order_id AND po.business_id=l.business_id AND po.godown_id=l.destination_godown_id AND po.is_b2b_synchronized=true LEFT JOIN sales_orders so ON l.source_voucher_type='SALES_ORDER' AND so.id=l.source_voucher_id AND so.business_id=l.business_id AND po.main_sales_order_id=so.id LEFT JOIN sales_invoices si ON l.source_voucher_type='SALES_INVOICE' AND si.id=l.source_voucher_id AND si.business_id=l.business_id AND po.main_sales_invoice_id=si.id WHERE l.business_id=$1 AND l.destination_godown_id=$2 AND (so.id IS NOT NULL OR si.id IS NOT NULL) AND ($3::text IS NULL OR l.status=$3)`;
  const params=[scope.businessId,scope.originId,status];
  const {rows:[count]}=await client.query(`SELECT COUNT(*)::int AS n ${from}`,params);
  const {rows}=await client.query(`SELECT l.id,l.business_id AS "originalBusinessId",l.destination_godown_id AS "originalDestinationOriginId",l.source_voucher_type AS "sourceVoucherType",l.source_voucher_id AS "sourceVoucherId",CASE WHEN so.id IS NOT NULL THEN so.order_number ELSE si.invoice_number END AS "sourceVoucherNumber",po.id AS "destinationPurchaseOrderId",po.order_number AS "destinationPurchaseOrderNumber",l.event_type AS "eventType",l.status,l.created_at AS "createdAt",po.status AS "purchaseOrderStatus",po.b2b_sync_status AS "acceptanceStatus" ${from} ORDER BY l.created_at DESC,l.id LIMIT $4 OFFSET $5`,[...params,limit,(page-1)*limit]);
  await client.query('COMMIT');
  return {data:rows,origin:{id:origin.id,name:origin.name,originalBusinessId:scope.businessId},pagination:{page,limit,total:count.n,totalPages:Math.max(1,Math.ceil(count.n/limit))},readOnly:true,identityActivated:false,notice:'Only linked historical orders with matching original records are shown. Unlinked or conflicting sync records are excluded for review. This view does not convert a Business, post purchases or retry synchronization.'};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
