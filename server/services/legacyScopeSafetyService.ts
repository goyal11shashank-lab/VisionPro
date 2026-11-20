import type {Request} from 'express';
import {pool} from '../db/index.js';
/** Fail closed for historical stock-assigned logins wherever a route lacks a proven scope adapter. */
export async function legacyScopeRouteAllowed(req:Request):Promise<boolean> {
  const user=req.user;if(!user?.assignedGodownId||user.isSuperAdmin)return true;
  const path=req.originalUrl.split('?')[0].replace(/\/$/,'');
  const read=req.method==='GET';
  if(read&&path==='/api/auth/me')return true;
  if(read&&path==='/api/inventory')return true;
  if(read&&['/api/reports/inventory','/api/reports/stock-ledger','/api/reports/sales','/api/reports/sales/details','/api/reports/sales/returns','/api/reports/purchases','/api/reports/purchases/details','/api/reports/purchases/returns','/api/reports/payments','/api/reports/assigned-financial-activity','/api/reports/assigned-b2b-history'].includes(path))return req.query.export!=='true';
  const legacy=path.replace('/api/inventory/godowns','/api/godowns');
  if(read&&['/api/godowns','/api/godowns/stock/balance',`/api/godowns/${user.assignedGodownId}/stock`].includes(legacy))return true;
  const collections=['/api/sales/orders','/api/sales/invoices','/api/purchases/orders','/api/purchases/invoices','/api/payments'];
  if(collections.includes(path))return read||req.method==='POST'; // These force assigned scope on both list and create.
  const direct=path.match(/^\/api\/(sales\/(orders|invoices)|purchases\/(orders|invoices)|payments)\/([0-9a-f-]{36})(?:\/(cancel|confirm|post|convert-to-invoice|invoice))?$/i);
  if(direct){
    const tables:Record<string,string>={'sales/orders':'sales_orders','sales/invoices':'sales_invoices','purchases/orders':'purchase_orders','purchases/invoices':'purchase_invoices',payments:'payments'};
    const table=tables[direct[1].toLowerCase()];const id=direct[4];
    const {rows}=await pool.query(`SELECT id FROM ${table} WHERE id=$1 AND business_id=$2 AND godown_id=$3`,[id,user.currentBusinessId,user.assignedGodownId]);
    if(rows.length!==1)return false;
    if(req.method!=='GET'&&req.body?.godownId&&req.body.godownId!==user.assignedGodownId)return false;
    return true;
  }
  return false;
}
