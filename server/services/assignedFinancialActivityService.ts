import {pool} from '../db/index.js';
/** Attributed activity is not an independent opening or a migrated party balance. */
export async function getAssignedFinancialActivity(scope:{businessId:string;originId:string},filters:{partyType?:string;partyId?:string;startDate?:string;endDate?:string;page?:number;limit?:number}={}){
 if(!scope.businessId||!scope.originId)throw new Error('An assigned historical origin is required.');
 const kind=filters.partyType||'CUSTOMER';if(!['CUSTOMER','SUPPLIER'].includes(kind))throw new Error('Choose CUSTOMER or SUPPLIER.');
 for(const date of [filters.startDate,filters.endDate])if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Use dates in YYYY-MM-DD format.');
 const customer=kind==='CUSTOMER';const table=customer?'customer_ledgers':'supplier_ledgers';
 const page=Math.max(1,Number(filters.page)||1),limit=Math.min(100,Math.max(1,Number(filters.limit)||50));
 const params:any[]=[scope.businessId,scope.originId];
 const extra:string[]=[];
 if(filters.partyId){params.push(filters.partyId);extra.push(`l.party_id=$${params.length}`);}
 if(filters.startDate){params.push(filters.startDate);extra.push(`l.transaction_date >= $${params.length}::date`);}
 if(filters.endDate){params.push(filters.endDate);extra.push(`l.transaction_date < ($${params.length}::date+INTERVAL '1 day')`);}
 const attribution=`COALESCE(si.godown_id,pi.godown_id,sri.godown_id,pri.godown_id,pm.godown_id)`;
 const knownDocument=`COALESCE(si.id,pi.id,sr.id,pr.id,pm.id)`;
 const source=`FROM ${table} l JOIN parties p ON p.id=l.party_id AND p.business_id=l.business_id
 LEFT JOIN sales_invoices si ON l.reference_type IN ('SALES_INVOICE','SALES_INVOICE_CANCEL') AND si.id::text=l.reference_id AND si.business_id=l.business_id
 LEFT JOIN purchase_invoices pi ON l.reference_type IN ('PURCHASE_INVOICE','PURCHASE_INVOICE_CANCEL') AND pi.id::text=l.reference_id AND pi.business_id=l.business_id
 LEFT JOIN sales_returns sr ON l.reference_type IN ('SALES_RETURN','SALES_RETURN_CANCEL') AND sr.id::text=l.reference_id AND sr.business_id=l.business_id
 LEFT JOIN sales_invoices sri ON sri.id=sr.sales_invoice_id AND sri.business_id=l.business_id
 LEFT JOIN purchase_returns pr ON l.reference_type IN ('PURCHASE_RETURN','PURCHASE_RETURN_CANCEL') AND pr.id::text=l.reference_id AND pr.business_id=l.business_id
 LEFT JOIN purchase_invoices pri ON pri.id=pr.purchase_invoice_id AND pri.business_id=l.business_id
 LEFT JOIN payments pm ON l.reference_type IN ('PAYMENT','PAYMENT_RECEIPT','PAYMENT_CANCEL') AND pm.id::text=l.reference_id AND pm.business_id=l.business_id
 WHERE l.business_id=$1 AND ((l.godown_id=$2 AND (${knownDocument} IS NULL OR ${attribution}=$2)) OR (l.godown_id IS NULL AND ${attribution}=$2)) ${extra.length?'AND '+extra.join(' AND '):''}`;
 const client=await pool.connect();
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows:[summary]}=await client.query(`SELECT COUNT(*)::int AS count,COALESCE(SUM(l.debit),0) AS debit,COALESCE(SUM(l.credit),0) AS credit ${source}`,params);
  const {rows}=await client.query(`SELECT l.id,l.party_id,p.name AS party_name,l.transaction_date,l.transaction_type,l.reference_type,l.reference_id,l.debit,l.credit,CASE WHEN l.godown_id=$2 THEN 'EXPLICIT_ORIGIN' ELSE 'REFERENCED_DOCUMENT' END AS attribution,COALESCE(si.invoice_number,pi.invoice_number,sr.return_number,pr.return_number,pm.payment_number) AS document_number ${source} ORDER BY l.transaction_date DESC,l.created_at DESC,l.id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,limit,(page-1)*limit]);
  await client.query('COMMIT');
  const debit=Number(summary.debit),credit=Number(summary.credit);
  return {kind:'ATTRIBUTED_HISTORICAL_ACTIVITY',partyType:kind,reconciledOpening:false,openingBalance:null,closingBalance:null,notice:'Activity attributed to this historical stock origin only. Parent-wide stored balances are excluded. Unattributed or conflicting records are excluded. This is not an independent opening balance, outstanding balance or completed Business conversion.',summary:{entries:summary.count,debit,credit,netActivity:customer?debit-credit:credit-debit},data:rows.map(row=>({...row,debit:Number(row.debit),credit:Number(row.credit)})),pagination:{page,limit,totalItems:summary.count,totalPages:Math.max(1,Math.ceil(summary.count/limit))}};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
