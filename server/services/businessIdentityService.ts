import {pool} from '../db/index.js';
import {planBusinessUnification} from './businessUnificationPlan.js';
// Explicit allowlist. No identifier comes from a request or stored content.
const scopedTables=['optical_stocks','stock_ledger','stock_reservations','purchase_orders','purchase_invoices','supplier_ledgers','sales_orders','sales_invoices','customer_ledgers','payments'] as const;
export class BusinessIdentityService {
  static async inspectUnification(actor:{isSuperAdmin:boolean}) {
    if(!actor.isSuperAdmin)throw new Error('Business conversion inventory requires Super Administrator authority.');
    const client=await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {rows:businesses}=await client.query(`SELECT id,name,business_type AS "businessType",parent_business_id AS "parentBusinessId" FROM businesses ORDER BY id`);
      const {rows:locations}=await client.query(`SELECT id,business_id AS "businessId",name,status FROM godowns ORDER BY id`);
      const {rows:users}=await client.query(`SELECT id,username,is_super_admin AS "isSuperAdmin",assigned_godown_id AS "assignedGodownId" FROM users ORDER BY id`);
      const {rows:memberships}=await client.query(`SELECT user_id,business_id,is_default FROM user_business_access`);
      const references=new Map<string,Record<string,number>>();for(const location of locations)references.set(location.id,{});
      for(const table of scopedTables){
        const {rows}=await client.query(`SELECT godown_id,COUNT(*)::int AS n FROM ${table} WHERE godown_id IS NOT NULL GROUP BY godown_id`);
        for(const row of rows)if(references.has(row.godown_id))references.get(row.godown_id)![table]=row.n;
      }
      const {rows:reservations}=await client.query(`SELECT godown_id,COUNT(*)::int AS n FROM stock_reservations WHERE godown_id IS NOT NULL AND status='ACTIVE' GROUP BY godown_id`);
      const {rows:links}=await client.query(`SELECT destination_godown_id,COUNT(*)::int AS n FROM b2b_order_sync_logs GROUP BY destination_godown_id`);
      const result=planBusinessUnification({businesses,locations:locations.map(location=>({...location,references:references.get(location.id)||{},activeReservations:reservations.find(row=>row.godown_id===location.id)?.n||0,b2bLinks:links.find(row=>row.destination_godown_id===location.id)?.n||0})),users:users.map(user=>({...user,memberships:memberships.filter(row=>row.user_id===user.id).map(row=>({businessId:row.business_id,isDefault:row.is_default}))}))});
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
