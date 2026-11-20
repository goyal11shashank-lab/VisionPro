import {pool} from '../db/index.js';
/** Opt-in candidate. Disabled until additive schema and explicit owner-reviewed mappings exist. */
export async function canonicalBusinessFor(user:{id:string;isSuperAdmin:boolean;assignedGodownId?:string|null}):Promise<string|null> {
  if(user.isSuperAdmin||process.env.BUSINESS_LOGIN_BINDINGS_ENABLED!=='true')return null;
  const {rows:[binding]}=await pool.query(`SELECT business_id FROM business_login_bindings WHERE user_id=$1`,[user.id]);
  if(!binding)return null; // Unmapped ordinary users are not silently assigned their default.
  if(user.assignedGodownId)throw new Error('Legacy assigned stock identity is not ready for Business login cutover. Preserve its current restriction.');
  return binding.business_id;
}
export function restrictBusinessChoices<T extends {businessId:string}>(choices:T[],canonicalId:string|null):T[] {
  if(!canonicalId)return choices;
  const selected=choices.filter(choice=>choice.businessId===canonicalId);
  if(selected.length!==1)throw new Error('Reviewed Business assignment lacks existing authorized membership. Access denied, no fallback.');
  return selected;
}
