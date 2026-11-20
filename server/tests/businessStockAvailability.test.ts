import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GodownService} from '../services/godownService.js';
import {DealerControlService} from '../services/dealerControlService.js';
import {DealerDashboardService} from '../services/dealerDashboardService.js';
import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';
assertSyntheticDatabase();
import {pool} from '../db/index.js';
import {createExpressApp} from '../app.js';
import {generateAuthToken} from '../auth/jwt.js';
import {findOrCreateOpticalBatch} from '../services/opticalMasterService.js';
import {DealerCatalogInitializationService} from '../services/dealerCatalogInitializationService.js';
const server=createExpressApp().listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
const port=(server.address() as any).port;
try{
 const {rows:[source]}=await pool.query(`SELECT id FROM businesses WHERE business_type='MAIN' ORDER BY created_at LIMIT 1`);
 const {rows:[item]}=await pool.query(`SELECT id,code,optical_category FROM unique_items WHERE business_id=$1 AND optical_category='SV' LIMIT 1`,[source.id]);
 const {batch}=await findOrCreateOpticalBatch({businessId:source.id,uniqueItemId:item.id,sph:-3.5,cyl:0});
 await pool.query(`UPDATE optical_stocks SET physical_stock=5,available_stock=5,reserved_stock=0 WHERE business_id=$1 AND batch_id=$2`,[source.id,batch.id]);
 // Neither receiver nor source requires a dealer/warehouse type or parent relationship.
 const {rows:[receiver]}=await pool.query(`INSERT INTO businesses(name,status,settings_config) VALUES('Synthetic independent receiving business','ACTIVE',$1) RETURNING id`,[JSON.stringify({businessStockLookup:{sourceBusinessId:source.id}})]);
 await pool.query(`UPDATE businesses SET settings_config=jsonb_set(COALESCE(settings_config,'{}'),'{stockVisibility}',$2::jsonb) WHERE id=$1`,[source.id,JSON.stringify({authorizedBusinessIds:[receiver.id]})]);
 const client=await pool.connect();try{await client.query('BEGIN');await DealerCatalogInitializationService.initializeDealerCatalog(client,source.id,receiver.id);await client.query('COMMIT');}finally{client.release();}
 const {rows:[user]}=await pool.query(`INSERT INTO users(username,full_name,password_hash,user_permissions_override) VALUES($1,'Synthetic availability user','not-login','{"inventory:view":true}') RETURNING id,username`,['stocklookup_'+Date.now()]);
 await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true)`,[user.id,receiver.id]);
 const token=generateAuthToken({userId:user.id,username:user.username,isSuperAdmin:false,businessId:receiver.id});
 const snapshot=async()=>{
   const {rows:tables}=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
   const hashes=[];for(const {tablename} of tables){const {rows:[row]}=await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename.replaceAll('"','""')}" t`);hashes.push([tablename,row.hash]);}return JSON.stringify(hashes);
 };
 const request=async(path:string,business=receiver.id)=>{const before=await snapshot();const r=await fetch(`http://127.0.0.1:${port}/api/business-stock/${path}`,{headers:{Authorization:'Bearer '+token,'X-Business-Id':business}});const data=await r.json();assert.equal(await snapshot(),before,'Read-only availability endpoint changed stored rows');return {status:r.status,data};};
 const query=`check?itemId=${item.id}&sph=-3.50&cyl=0&axis=0&add=0&side=NONE`;
 const catalogue=await request('catalogue');assert.equal(catalogue.status,200);assert(catalogue.data.items.some((row:any)=>row.id===item.id));assert(catalogue.data.items.every((row:any)=>Object.keys(row).sort().join(',')==='categoryCode,code,id,name'));
 const before=await pool.query(`SELECT COUNT(*) AS count FROM audit_logs`);
 let result=await request(query);assert.equal(result.status,200);assert.equal(result.data.available,true);assert.equal(result.data.ownAvailable,false);assert.deepEqual(Object.keys(result.data).sort(),['available','ownAvailable','sourceBusiness','success']);
 await pool.query(`UPDATE optical_stocks os SET physical_stock=1,available_stock=1 FROM optical_batches ob JOIN unique_items ui ON ui.id=ob.unique_item_id WHERE os.batch_id=ob.id AND ob.business_id=$1 AND ui.code=$2 AND ob.sph=-3.5 AND ob.cyl=0`,[receiver.id,item.code]);
 result=await request(query);assert.equal(result.data.ownAvailable,true);assert.equal(result.data.available,true);
 await pool.query(`UPDATE optical_stocks SET physical_stock=0,available_stock=0 WHERE business_id=$1 AND batch_id=$2`,[source.id,batch.id]);
 result=await request(query);assert.equal(result.data.available,false);assert.equal(result.data.ownAvailable,true);
 const wrongPower=await request(query.replace('-3.50','-3.25'));assert.equal(wrongPower.data.available,false);assert.equal(wrongPower.data.ownAvailable,false);
 const attemptedOverride=await request(query+'&sourceBusinessId='+receiver.id+'&mainWarehouseId='+receiver.id);assert.deepEqual(attemptedOverride.data,result.data);
 assert.equal((await request(query,source.id)).status,403,'Ordinary user must not open source business');
 assert.equal((await request(query.replace(item.id,crypto.randomUUID()))).status,404);
 assert.equal((await request(query.replace('sph=-3.50','sph=nonsense'))).status,400);
 assert.equal((await request(query.replace('axis=0','axis=90'))).status,400,'SV must reject hidden AXIS');
 assert.equal((await pool.query(`SELECT COUNT(*) AS count FROM audit_logs`)).rows[0].count,before.rows[0].count,'Read-only lookup must not create audit/accounting records');
 await pool.query(`UPDATE users SET user_permissions_override='{"inventory:view":true,"admin:manage_settings":true}' WHERE id=$1`,[user.id]);
 for(const path of ['/api/dealer/dashboard/search','/api/godowns/main-warehouse/stock-lookup','/api/godowns/main-warehouse-stock','/api/dealer/main-warehouse/availability','/api/dealer/main-warehouse/summary'].flatMap(path=>[path,path.replace('/api/','/api/inventory/')])) {
   const beforeLegacy=await snapshot();const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:{Authorization:'Bearer '+token,'X-Business-Id':receiver.id}});
   assert.equal(response.status,410,'Legacy quantity feed must be retired: '+path);assert.equal(await snapshot(),beforeLegacy);
 }
 await pool.query(`INSERT INTO businesses(name,status,business_type,parent_business_id) VALUES('Synthetic child must never become caller','ACTIVE','DEALER',$1)`,[receiver.id]);
 const ownSummaryBefore=await snapshot();const ownSummary=await fetch(`http://127.0.0.1:${port}/api/dealer/dashboard/summary`,{headers:{Authorization:'Bearer '+token,'X-Business-Id':receiver.id}});const ownSummaryData=await ownSummary.json() as any;assert.equal(ownSummary.status,200);assert.equal(ownSummaryData.dealerBusiness.id,receiver.id);assert(!('mainWarehouseAvailable' in ownSummaryData.kpis));assert.deepEqual(Object.keys(ownSummaryData.mainWarehouse),['name']);assert.equal(await snapshot(),ownSummaryBefore);
 // All control routes and both mounts deny ordinary users even with settings authority.
 const routeSource=readFileSync(new URL('../routes/mainDealers.ts',import.meta.url),'utf8');
 const controlRoutes=[...routeSource.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)];
 assert(controlRoutes.length>=35);
 const {rows:[superUser]}=await pool.query(`SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1`);
 const superToken=generateAuthToken({userId:superUser.id,username:superUser.username,isSuperAdmin:true,businessId:source.id});
 for(const prefix of ['/api/main/dealers','/api/dealers']){
   const r=await fetch(`http://127.0.0.1:${port}${prefix}/summary`,{headers:{Authorization:'Bearer '+superToken,'X-Business-Id':source.id}});assert.equal(r.status,200,'Intentional Super Admin access must remain');
 }
 const controlBefore=await snapshot();
 for(const [,method,template] of controlRoutes){
   const path=template.replace(/:[A-Za-z]+/g,source.id);
   for(const prefix of ['/api/main/dealers','/api/dealers']){
     const r=await fetch(`http://127.0.0.1:${port}${prefix}${path}`,{method:method.toUpperCase(),headers:{Authorization:'Bearer '+token,'X-Business-Id':receiver.id,'Content-Type':'application/json'},...(['post','put','patch'].includes(method)?{body:'{}'}:{})});
     assert.equal(r.status,403,method+' '+prefix+path+' must deny ordinary control access');
   }
 }
 assert.equal(await snapshot(),controlBefore,'Denied control reads/provisioning changed stored rows');
 await assert.rejects(()=>GodownService.searchMainWarehouseStock(source.id),/Super Administrator/);
 await assert.rejects(()=>GodownService.searchMainWarehouseStock(source.id,{isSuperAdmin:false}),/Super Administrator/);
 await assert.rejects(()=>DealerControlService.getDealerStock(source.id,receiver.id),/Super Administrator/);
 const safeService=await DealerDashboardService.getDealerDashboardSummary(receiver.id);assert(!('mainWarehouseAvailable' in safeService.kpis));assert.deepEqual(Object.keys(safeService.mainWarehouse),['name']);
 // A legacy DEALER caller stays itself and receives no source totals or private profile fields.
 await pool.query(`UPDATE businesses SET business_type='DEALER',parent_business_id=$2 WHERE id=$1`,[receiver.id,source.id]);
 for(const prefix of ['/api/dealer','/api/inventory/dealer']){
   const r=await fetch(`http://127.0.0.1:${port}${prefix}/dashboard/summary`,{headers:{Authorization:'Bearer '+token,'X-Business-Id':receiver.id}});const data=await r.json() as any;assert.equal(r.status,200);assert.equal(data.dealerBusiness.id,receiver.id);assert(!('mainWarehouseAvailable' in data.kpis));assert.deepEqual(Object.keys(data.mainWarehouse),['name']);
 }
 await pool.query(`UPDATE businesses SET business_type='MAIN',parent_business_id=NULL WHERE id=$1`,[receiver.id]);
 console.log('PASS all '+controlRoutes.length+' control routes x2 aliases denied to ordinary settings user, every table unchanged; legacy dealer summaries sanitized and raw services denied by default');
 const beforeRelink=await snapshot();
 const relink=await fetch(`http://127.0.0.1:${port}/api/businesses/${receiver.id}`,{method:'PUT',headers:{Authorization:'Bearer '+token,'X-Business-Id':receiver.id,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic independent receiving business',businessType:'DEALER',parentBusinessId:source.id})});
 assert.equal(relink.status,403,'Own settings permission must not grant parent/source relationship authority');
 assert.equal(await snapshot(),beforeRelink,'Unauthorized relink changed rows');
 for(const category of ['KT','PROG']){
   const {rows:[opticalItem]}=await pool.query(`SELECT id FROM unique_items WHERE business_id=$1 AND optical_category=$2 LIMIT 1`,[source.id,category]);
   const {batch:power}=await findOrCreateOpticalBatch({businessId:source.id,uniqueItemId:opticalItem.id,sph:-2,cyl:-0.75,axis:90,add:2,side:category==='PROG'?'R':'NONE'});
   await pool.query(`UPDATE optical_stocks SET physical_stock=2,available_stock=2,reserved_stock=0 WHERE batch_id=$1 AND business_id=$2`,[power.id,source.id]);
   const exact=`check?itemId=${opticalItem.id}&sph=-2&cyl=-0.75&axis=90&add=2&side=${category==='PROG'?'R':'NONE'}`;
   assert.equal((await request(exact)).data.available,true,category+' exact identity should be available');
   assert.equal((await request(exact.replace('axis=90','axis=180'))).data.available,false,'Different AXIS must not match');
   assert.equal((await request(exact.replace('add=2','add=3'))).data.available,false,'Different ADD must not match');
   if(category==='PROG')assert.equal((await request(exact.replace('side=R','side=L'))).data.available,false,'Different SIDE must not match');
 }
 await pool.query(`UPDATE businesses SET settings_config=jsonb_set(settings_config,'{stockVisibility}','{"authorizedBusinessIds":[]}'::jsonb) WHERE id=$1`,[source.id]);
 assert.equal((await request('catalogue')).status,403,'Receiver cannot grant itself visibility');
 assert.notEqual((await request(query)).status,200);
 console.log('PASS Business stock lookup: both booleans, exact item/power, no quantities/costs, caller-source override ignored, source grant enforced, independent businesses/no type or parent required, cross-business403');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();}
