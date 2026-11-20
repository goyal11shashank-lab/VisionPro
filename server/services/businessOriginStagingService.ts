import {pool} from '../db/index.js';
/** No HTTP route. Source-only staged identity conversion for an explicit reviewed plan. */
export class BusinessOriginStagingService {
  static async stage(input:{legacyLocationId:string;targetBusinessId:string;name:string;decisionReference:string},actor:{isSuperAdmin:boolean;userId:string}) {
    if(!actor.isSuperAdmin)throw new Error('Business identity staging requires Super Administrator authority.');
    if(!input.name.trim()||!input.decisionReference.trim())throw new Error('Explicit name and decision reference are required.');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const {rows:[origin]}=await client.query(`SELECT g.*,b.currency,b.financial_year_start,b.state,b.state_code FROM godowns g JOIN businesses b ON b.id=g.business_id WHERE g.id=$1 FOR UPDATE OF g`,[input.legacyLocationId]);
      if(!origin)throw new Error('Legacy stock scope does not exist.');
      if(origin.business_id===input.targetBusinessId)throw new Error('A separate Business identity is required, not a merge into its current owner.');
      const {rows:[prior]}=await client.query(`SELECT ob.business_id,ob.decision_reference,b.name FROM business_origin_bindings ob JOIN businesses b ON b.id=ob.business_id WHERE ob.legacy_godown_id=$1`,[origin.id]);
      if(prior){if(prior.business_id!==input.targetBusinessId || prior.name!==input.name.trim() || prior.decision_reference!==input.decisionReference.trim())throw new Error('This historical origin is already staged for a different Business.');await client.query('COMMIT');return {businessId:prior.business_id,state:'STAGED',idempotent:true};}
      const {rows:[reserved]}=await client.query(`SELECT COUNT(*)::int AS n FROM stock_reservations WHERE godown_id=$1 AND status='ACTIVE'`,[origin.id]);
      if(reserved.n>0)throw new Error('Active reservations require a cutover plan before staging this Business.');
      const {rows:[existing]}=await client.query(`SELECT id FROM businesses WHERE id=$1`,[input.targetBusinessId]);if(existing)throw new Error('Do not merge a legacy stock scope into an existing Business.');
      await client.query(`INSERT INTO businesses(id,name,status,currency,financial_year_start,state,state_code,settings_config,created_by) VALUES($1,$2,'INACTIVE',$3,$4,$5,$6,$7::jsonb,$8)`,[input.targetBusinessId,input.name.trim(),origin.currency,origin.financial_year_start,origin.state,origin.state_code,JSON.stringify({businessIdentity:{state:'STAGED',storageBusinessId:origin.business_id,legacyLocationId:origin.id,requiresHistoryAdapter:true}}),actor.userId]);
      await client.query(`INSERT INTO business_origin_bindings(business_id,storage_business_id,legacy_godown_id,decision_reference,created_by) VALUES($1,$2,$3,$4,$5)`,[input.targetBusinessId,origin.business_id,origin.id,input.decisionReference.trim(),actor.userId]);
      await client.query(`INSERT INTO audit_logs(business_id,user_id,action,module,entity_type,entity_id,new_value) VALUES($1,$2,'CREATE','BUSINESS','business_origin_bindings',$3,$4::jsonb)`,[input.targetBusinessId,actor.userId,input.targetBusinessId,JSON.stringify({state:'STAGED',storageBusinessId:origin.business_id,legacyLocationId:origin.id,preserveHistoricalReferences:true,credentialsChanged:false,membershipsChanged:false,stockMoved:false})]);
      await client.query('COMMIT');return {businessId:input.targetBusinessId,state:'STAGED',idempotent:false};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
