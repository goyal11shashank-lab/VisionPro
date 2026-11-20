export type ExistingBusiness = {id:string;name:string;businessType?:string|null;parentBusinessId?:string|null};
export type LegacyLocation = {id:string;businessId:string;name:string;status:string;references:Record<string,number>;activeReservations:number;b2bLinks:number};
export type ExistingLogin = {id:string;username:string;isSuperAdmin:boolean;assignedGodownId?:string|null;memberships:{businessId:string;isDefault:boolean}[]};
export type BusinessMapping = {legacyLocationId:string;targetBusinessId:string;targetName:string};
export type LoginMapping = {userId:string;businessId:string};
/**
 * Pure conversion planner. It has no database client and cannot provision, delete,
 * move stock, alter credentials, or silently make access/default decisions.
 * Historical references are preserved as origin bindings, never rewritten.
 */
export function planBusinessUnification(input:{businesses:ExistingBusiness[];locations:LegacyLocation[];users:ExistingLogin[];locationMappings?:BusinessMapping[];loginMappings?:LoginMapping[]}) {
  const blockers:{code:string;entityId:string;detail:string}[]=[];
  const ids=new Set(input.businesses.map(b=>b.id));
  const mappings=new Map<string,BusinessMapping>();
  const targetIds=new Set<string>();
  for(const mapping of input.locationMappings||[]){
    if(mappings.has(mapping.legacyLocationId)){blockers.push({code:'DUPLICATE_LOCATION_MAPPING',entityId:mapping.legacyLocationId,detail:'One origin cannot become multiple Businesses.'});continue;}
    if(!input.locations.some(l=>l.id===mapping.legacyLocationId)||!mapping.targetName.trim()){blockers.push({code:'INVALID_LOCATION_MAPPING',entityId:mapping.legacyLocationId,detail:'Use a known origin and a Business name.'});continue;}
    if(ids.has(mapping.targetBusinessId)||targetIds.has(mapping.targetBusinessId)){blockers.push({code:'WOULD_MERGE_BUSINESSES',entityId:mapping.legacyLocationId,detail:'A legacy stock scope must become its own Business, never be folded into an existing Business or another stock scope.'});continue;}
    mappings.set(mapping.legacyLocationId,mapping);targetIds.add(mapping.targetBusinessId);
  }
  const identities=input.businesses.map(b=>({businessId:b.id,name:b.name,kind:'EXISTING_BUSINESS' as const,legacyType:b.businessType||null,preserveId:true}));
  const promotions=input.locations.map(location=>{
    const mapping=mappings.get(location.id);
    if(!mapping)blockers.push({code:'LOCATION_BUSINESS_REQUIRED',entityId:location.id,detail:`Choose the new independent Business identity/name for ${location.name}. Stored stock and documents remain in their original scope until conversion is approved.`});
    if(location.activeReservations>0)blockers.push({code:'ACTIVE_RESERVATIONS',entityId:location.id,detail:'Conversion needs an explicit reservation cutover plan; do not move currently reserved stock.'});
    return {origin:{businessId:location.businessId,legacyLocationId:location.id},targetBusinessId:mapping?.targetBusinessId||null,targetName:mapping?.targetName||location.name,action:'ADD_INDEPENDENT_BUSINESS_WITH_ORIGIN_BINDING' as const,preserveHistoricalReferences:{...location.references},preserveB2bLinks:location.b2bLinks,stockAction:'NO_STOCK_MOVE_UNTIL_APPROVED_CUTOVER' as const,requiresReadScopeAdapter:true,requiresOpeningBalanceReconciliation:true};
  });
  const loginChoices=new Map((input.loginMappings||[]).map(m=>[m.userId,m.businessId]));
  const logins=input.users.map(user=>{
    if(user.isSuperAdmin)return {userId:user.id,username:user.username,mode:'ALL_BUSINESSES_UNCHANGED' as const,canonicalBusinessId:null,preserveCredentials:true,preserveHistoricalMemberships:true};
    let target=loginChoices.get(user.id)||null;
    if(user.assignedGodownId){
      const origin=mappings.get(user.assignedGodownId);
      if(!origin){blockers.push({code:'ASSIGNED_LOCATION_UNRESOLVED',entityId:user.id,detail:'Keep the assigned stock restriction until its independent Business mapping is approved. Parent-business access is not equivalent.'});target=null;}
      else if(target&&target!==origin.targetBusinessId){blockers.push({code:'ASSIGNMENT_CONFLICT',entityId:user.id,detail:'Chosen Business conflicts with the assigned legacy stock origin.'});target=null;}
      else target=origin.targetBusinessId;
    }else if(!target&&user.memberships.length===1)target=user.memberships[0].businessId;
    else if(!target){blockers.push({code:'LOGIN_BUSINESS_CHOICE_REQUIRED',entityId:user.id,detail:user.memberships.length?'Choose one Business explicitly; an existing default does not approve revoking other active access.':'Recover derived access before choosing a Business; no membership is not proof of no access.'});}
    if(target&&!ids.has(target)&&!targetIds.has(target)){blockers.push({code:'UNKNOWN_LOGIN_BUSINESS',entityId:user.id,detail:'Chosen Business does not exist in this conversion plan.'});target=null;}
    return {userId:user.id,username:user.username,mode:'ONE_BUSINESS_PENDING_APPROVED_CUTOVER' as const,canonicalBusinessId:target,preserveCredentials:true,preserveHistoricalMemberships:true};
  });
  return {version:1,dryRun:true,identities,promotions,logins,blockers,readyForCutover:false,requirements:['Owner-approved identity/access mapping','Historical scoped-read adapters before access cutover','Stock, reservations, ledgers and both inter-business linkage families reconciled','No legacy deletion or historical foreign-key rewrites','Reviewed reversible migration with independent verification'],legacyLogisticsFamilies:['dealer_orders/dealer_shipments/dealer_goods_receipts','godown-linked b2b_order_sync_logs']};
}
