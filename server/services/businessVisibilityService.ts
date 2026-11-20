import type {Request} from 'express';
import {pool} from '../db/index.js';
import {recordAuditLog} from './auditService.js';
import {PROTECTED_OPERATING_BUSINESS_ID} from './businessDeletionSafetyService.js';

/** Visibility only. Never changes operational status, memberships, roles, defaults or documents. */
export function hiddenFromSuperAdmin(business:any):boolean {
 return business?.id!==PROTECTED_OPERATING_BUSINESS_ID && business?.settingsConfig?.adminVisibility?.hidden===true;
}
export class BusinessVisibilityError extends Error {constructor(public status:number,message:string){super(message);}}
export async function setBusinessAdminVisibility(ids:string[],hidden:boolean,userId:string,req?:Request){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize JSON settings writers, then lock/recheck all targets in a stable order.
  await client.query('LOCK TABLE businesses IN SHARE ROW EXCLUSIVE MODE');
  const {rows}=await client.query('SELECT id,name,status,settings_config FROM businesses WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
  if(rows.length!==ids.length)throw new BusinessVisibilityError(404,'One or more Businesses were not found. Nothing changed.');
  if(rows.some(b=>b.id===PROTECTED_OPERATING_BUSINESS_ID))throw new BusinessVisibilityError(409,'Lumina is protected and must remain visible. Nothing changed.');
  const changed=[];
  for(const business of rows){
   const previous=business.settings_config?.adminVisibility?.hidden===true;
   if(previous===hidden)continue;
   await client.query(`UPDATE businesses SET settings_config=jsonb_set(COALESCE(settings_config,'{}'::jsonb),'{adminVisibility}',COALESCE(settings_config->'adminVisibility','{}'::jsonb)||jsonb_build_object('hidden',$2::boolean),true),updated_at=NOW() WHERE id=$1`,[business.id,hidden]);
   await recordAuditLog({businessId:business.id,userId,action:hidden?'BUSINESS_HIDDEN_FROM_ADMIN':'BUSINESS_SHOWN_IN_ADMIN',module:'BUSINESS',entityType:'Business',entityId:business.id,previousValue:{hiddenFromSuperAdmin:previous},newValue:{hiddenFromSuperAdmin:hidden},req},client);
   changed.push(business.id);
  }
  await client.query('COMMIT');
  return {success:true,updatedCount:changed.length,changedIds:changed,hiddenFromSuperAdmin:hidden,message:hidden?'Hidden from the normal Super Admin list and dropdown. Data, staff access and operational status are unchanged.':'Restored to the normal Super Admin list and dropdown. Data, staff access and operational status are unchanged.'};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
