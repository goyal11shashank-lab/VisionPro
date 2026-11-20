import type {PoolClient} from 'pg';
import {pool} from '../db/index.js';
/** One Business identity. Legacy MAIN/DEALER fields are read adapters, not new entity types. */
export function supplierBusinessId(record:any):string|null {
  const settings=record.settingsConfig || record.settings_config || {};
  if(settings.businessRelationships?.configured===true)return settings.businessRelationships.supplierBusinessId || null;
  return settings.businessRelationships?.supplierBusinessId || settings.businessStockLookup?.sourceBusinessId || record.parentBusinessId || record.parent_business_id || null;
}
export function sourceAllowsCustomer(source:any, customerId:string):boolean {
  const settings=source.settingsConfig || source.settings_config || {};
  return [settings.businessRelationships?.customerBusinessIds,settings.stockVisibility?.authorizedBusinessIds].some(grants=>Array.isArray(grants)&&grants.includes(customerId));
}
export class BusinessRelationshipService {
  static async resolveSupplier(customerBusinessId:string,client:PoolClient|typeof pool=pool) {
    const {rows:[customer]}=await client.query(`SELECT id,name,status,parent_business_id,settings_config FROM businesses WHERE id=$1`,[customerBusinessId]);
    if(!customer||customer.status!=='ACTIVE')throw new Error('Current Business is unavailable.');
    const sourceId=supplierBusinessId(customer);
    if(!sourceId||sourceId===customer.id)throw new Error('No supplier Business is linked.');
    const {rows:[source]}=await client.query(`SELECT id,name,trade_name,city,state,phone,email,status,parent_business_id,settings_config FROM businesses WHERE id=$1`,[sourceId]);
    if(!source||source.status!=='ACTIVE')throw new Error('Supplier Business is unavailable.');
    if(customer.parent_business_id!==source.id&&!sourceAllowsCustomer(source,customer.id))throw new Error('Supplier Business has not granted this relationship.');
    return {customer,source};
  }
  /** Generic relationship change, called only behind the Super Admin boundary. No data migration. */
  static async setSupplier(customerId:string,sourceId:string|null,actor:{isSuperAdmin:boolean;userId:string}) {
    if(!actor.isSuperAdmin)throw new Error('Only Super Administrator can change Business relationships.');
    if(sourceId===customerId)throw new Error('A Business cannot be its own supplier.');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      // Stable lock order also covers replacing an existing supplier.
      const {rows}=await client.query(`SELECT id,status,settings_config,parent_business_id FROM businesses ORDER BY id FOR UPDATE`);
      const customer=rows.find(row=>row.id===customerId);const source=sourceId?rows.find(row=>row.id===sourceId):null;
      if(!customer||customer.status!=='ACTIVE'||(sourceId&&(!source||source.status!=='ACTIVE')))throw new Error('Select active Business records.');
      const oldId=supplierBusinessId(customer);
      for(const row of rows.filter(row=>row.id===oldId||row.id===sourceId)){
        const settings=row.settings_config||{};const relation=settings.businessRelationships||{};
        const customers=new Set<string>(Array.isArray(relation.customerBusinessIds)?relation.customerBusinessIds:[]);customers.delete(customerId);if(row.id===sourceId)customers.add(customerId);
        await client.query(`UPDATE businesses SET settings_config=$2::jsonb,updated_at=NOW() WHERE id=$1`,[row.id,JSON.stringify({...settings,businessRelationships:{...relation,customerBusinessIds:[...customers]}})]);
      }
      const settings=customer.settings_config||{};
      await client.query(`UPDATE businesses SET settings_config=$2::jsonb,updated_at=NOW() WHERE id=$1`,[customerId,JSON.stringify({...settings,businessRelationships:{...settings.businessRelationships,supplierBusinessId:sourceId,configured:true}})]);
      await client.query(`INSERT INTO audit_logs(business_id,user_id,action,module,entity_type,entity_id,new_value) VALUES($1,$2,'UPDATE','BUSINESS','business_relationships',$4,$3::jsonb)`,[customerId,actor.userId,JSON.stringify({previousSupplierBusinessId:oldId,supplierBusinessId:sourceId}),customerId]);
      await client.query('COMMIT');return {success:true,supplierBusinessId:sourceId};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
