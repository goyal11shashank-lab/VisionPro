import assert from 'node:assert/strict';
import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import {pool} from '../db/index.js';import {createExpressApp} from '../app.js';import {generateAuthToken} from '../auth/jwt.js';
import {BusinessRelationshipService,supplierBusinessId} from '../services/businessRelationshipService.js';
import {BusinessIdentityService} from '../services/businessIdentityService.js';
const server=createExpressApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.listening?r():server.once('listening',r));const port=(server.address() as any).port;
try{
 const {rows:[admin]}=await pool.query(`SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1`);
 const {rows:[source]}=await pool.query(`INSERT INTO businesses(name,status,business_type,settings_config) VALUES('Synthetic generic supplier','ACTIVE','DEALER','{}') RETURNING id`);
 const {rows:[customer]}=await pool.query(`INSERT INTO businesses(name,status,business_type,settings_config) VALUES('Synthetic generic customer','ACTIVE','MAIN','{}') RETURNING id`);
 const {rows:[ordinary]}=await pool.query(`INSERT INTO users(username,full_name,password_hash,user_permissions_override) VALUES($1,'Synthetic settings owner','not-a-login','{"admin:manage_settings":true,"master:create":true,"parties:create":true,"godown:create":true}') RETURNING id,username`,['syn_identity_'+Date.now()]);
 await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true)`,[ordinary.id,customer.id]);
 const token=(u:any,superAdmin:boolean)=>generateAuthToken({userId:u.id,username:u.username,isSuperAdmin:superAdmin,businessId:customer.id});
 const api=async(path:string,method='GET',body?:any,superAdmin=false)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:'Bearer '+token(superAdmin?admin:ordinary,superAdmin),'X-Business-Id':customer.id,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json() as any};};
 const snapshot=async()=>{const {rows:tables}=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);const result=[];for(const {tablename} of tables){const {rows:[r]}=await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename.replaceAll('"','""')}" t`);result.push([tablename,r.hash]);}return JSON.stringify(result);};
 const before=await snapshot();assert.equal((await api('/api/businesses/unification-plan')).status,403);assert.equal((await api('/api/businesses/'+customer.id+'/relationships','PUT',{supplierBusinessId:source.id})).status,403);
 for(const prefix of ['/api/godowns','/api/inventory/godowns'])assert.equal((await api(prefix,'POST',{name:'Must not create a godown'})).status,410);
 await assert.rejects(()=>BusinessIdentityService.inspectUnification({isSuperAdmin:false}),/Super Administrator/);
 assert.equal(await snapshot(),before);
 const plan=await api('/api/businesses/unification-plan','GET',undefined,true);assert.equal(plan.status,200,JSON.stringify(plan));assert.equal(plan.data.dryRun,true);assert.equal(plan.data.readyForCutover,false);assert(plan.data.identities.some((b:any)=>b.businessId===customer.id));assert.equal(await snapshot(),before,'Read-only conversion inventory changed rows');
 const linked=await api('/api/businesses/'+customer.id+'/relationships','PUT',{supplierBusinessId:source.id},true);assert.equal(linked.status,200,JSON.stringify(linked));const resolved=await BusinessRelationshipService.resolveSupplier(customer.id);assert.equal(resolved.source.id,source.id,'MAIN customer may use DEALER supplier, type independent');
 const list=await api('/api/businesses','GET',undefined,true);const shown=list.data.find((b:any)=>b.id===customer.id);assert.equal(shown.entityKind,'BUSINESS');assert.equal(shown.supplierBusinessId,source.id);assert.equal(shown.supplierBusinessName,'Synthetic generic supplier');
 const beforeBad=await snapshot();assert.equal((await api('/api/businesses/'+customer.id+'/relationships','PUT',{supplierBusinessId:customer.id},true)).status,400);assert.equal(await snapshot(),beforeBad);
 await pool.query(`UPDATE businesses SET parent_business_id=$2 WHERE id=$1`,[customer.id,source.id]);
 const removed=await api('/api/businesses/'+customer.id+'/relationships','PUT',{supplierBusinessId:null},true);assert.equal(removed.status,200);await assert.rejects(()=>BusinessRelationshipService.resolveSupplier(customer.id),/No supplier/);
 assert.equal(supplierBusinessId({parent_business_id:source.id,settings_config:{businessRelationships:{configured:true,supplierBusinessId:null}}}),null,'Explicit unlink must not revive historical parent access');
 console.log('PASS Business identity API: Super Admin-only dry-run inventory performs no writes, new godown creation retired x2 mounts, generic type-independent supplier link/unlink preserves historical parent and explicit unlink never revives it, ordinary settings/master/party grants cannot relink.');
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
