import {hashPassword} from '../auth/password.js';
import assert from 'node:assert/strict';
import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import {pool} from '../db/index.js';
import {createExpressApp} from '../app.js';
import {generateAuthToken} from '../auth/jwt.js';
import {hiddenFromSuperAdmin} from '../services/businessVisibilityService.js';
import {PROTECTED_OPERATING_BUSINESS_ID} from '../services/businessDeletionSafetyService.js';
const server=createExpressApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.listening?r():server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
try{
 const {rows:[admin]}=await pool.query(`INSERT INTO users(username,full_name,password_hash,is_super_admin) VALUES($1,'Synthetic visibility admin',$2,true) RETURNING id,username`,['syn_visibility_admin_'+Date.now(),await hashPassword('synthetic-visibility-only')]);
 const {rows:[current]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic visibility session') RETURNING id`);
 const {rows:targets}=await pool.query(`INSERT INTO businesses(name,settings_config) VALUES('Synthetic hidden candidate','{"keep":{"nested":17}}'),('Synthetic bulk visible candidate','{}') RETURNING id`);
 const {rows:[ordinary]}=await pool.query(`INSERT INTO users(username,full_name,password_hash) VALUES($1,'Visibility ordinary staff','not-used') RETURNING id,username`,['syn_visibility_'+Date.now()]);
 await pool.query('INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,true),($3,$2,false)',[ordinary.id,targets[0].id,admin.id]);
 const token=(user:any,bid=current.id)=>generateAuthToken({userId:user.id,username:user.username,isSuperAdmin:user.id===admin.id,businessId:bid});
 const request=async(path:string,method='GET',body?:any,user=admin,bid=current.id)=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token(user,bid),'X-Business-Id':bid,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json() as any};};
 const hashes=async(excluded:string[]=[])=>{const {rows:tables}=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);const values=[];for(const {tablename}of tables){if(excluded.includes(tablename))continue;const {rows:[r]}=await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS h FROM public."${tablename.replaceAll('"','""')}" t`);values.push([tablename,r.h]);}return JSON.stringify(values);};
 const beforeAll=await hashes();
 assert.equal((await request('/api/businesses/admin-visibility','POST',{ids:[targets[0].id],hidden:'true'})).status,400);
 assert.equal((await request('/api/businesses/admin-visibility','POST',{ids:[targets[0].id],hidden:true},ordinary,targets[0].id)).status,403);
 // Protected ID is always visible, even if old JSON is corrupt or malicious.
 assert.equal(hiddenFromSuperAdmin({id:PROTECTED_OPERATING_BUSINESS_ID,settingsConfig:{adminVisibility:{hidden:true}}}),false);
 await pool.query(`INSERT INTO businesses(id,name) VALUES($1,'Synthetic protected operating Business') ON CONFLICT(id) DO NOTHING`,[PROTECTED_OPERATING_BUSINESS_ID]);
 const beforeProtected=await hashes();
 assert.equal((await request('/api/businesses/admin-visibility','POST',{ids:[targets[0].id,PROTECTED_OPERATING_BUSINESS_ID],hidden:true})).status,409);
 assert.equal(await hashes(),beforeProtected,'Mixed protected bulk request must change nothing');
 const immutable=await hashes(['businesses','audit_logs']);
 const {rows:[currentBefore]}=await pool.query('SELECT row_to_json(b)::text AS j FROM businesses b WHERE id=$1',[current.id]);
 const result=await request('/api/businesses/admin-visibility','POST',{ids:targets.map(t=>t.id),hidden:true});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.updatedCount,2);
 assert.equal(await hashes(['businesses','audit_logs']),immutable,'Hiding must never change users, roles, memberships, defaults, stock, documents or ledgers');
 const {rows:[currentAfter]}=await pool.query('SELECT row_to_json(b)::text AS j FROM businesses b WHERE id=$1',[current.id]);assert.equal(currentAfter.j,currentBefore.j);
 const {rows:[hidden]}=await pool.query('SELECT status,settings_config FROM businesses WHERE id=$1',[targets[0].id]);assert.equal(hidden.status,'ACTIVE');assert.equal(hidden.settings_config.keep.nested,17);assert.equal(hidden.settings_config.adminVisibility.hidden,true);
 const me=await request('/api/auth/me');assert.equal(me.status,200);assert.equal(me.body.accessibleBusinesses.find((b:any)=>b.id===targets[0].id).hiddenFromSuperAdmin,true,'Hidden is a display flag, not revoked membership');
 const ordinaryMe=await request('/api/auth/me','GET',undefined,ordinary,targets[0].id);assert.equal(ordinaryMe.status,200);assert.equal(ordinaryMe.body.currentBusiness.id,targets[0].id,'Existing ordinary session keeps working');
 const list=await request('/api/businesses');assert.equal(list.body.find((b:any)=>b.id===targets[0].id).hiddenFromSuperAdmin,true);assert.equal(list.body.find((b:any)=>b.id===PROTECTED_OPERATING_BUSINESS_ID).adminVisibilityLocked,true);
 const loginResponse=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:admin.username,password:'synthetic-visibility-only',businessId:current.id})});assert.equal(loginResponse.status,200);const login=await loginResponse.json() as any;assert.equal(login.accessibleBusinesses.find((b:any)=>b.id===targets[0].id).hiddenFromSuperAdmin,true,'Fresh login also marks hidden dropdown choices');
 const beforeReplay=await hashes();assert.equal((await request('/api/businesses/admin-visibility','POST',{ids:targets.map(t=>t.id),hidden:true})).body.updatedCount,0);assert.equal(await hashes(),beforeReplay,'Replay adds no writes or duplicate audit');
 assert.equal((await request('/api/businesses/admin-visibility','POST',{ids:targets.map(t=>t.id),hidden:false})).body.updatedCount,2);
 await pool.query(`CREATE FUNCTION syn_block_visibility_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='BUSINESS_HIDDEN_FROM_ADMIN' THEN RAISE EXCEPTION 'SYN_AUDIT_BLOCK'; END IF; RETURN NEW; END $$`);
 await pool.query('CREATE TRIGGER syn_visibility_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION syn_block_visibility_audit()');
 try{const beforeFailure=await hashes();assert.equal((await request('/api/businesses/admin-visibility','POST',{ids:targets.map(t=>t.id),hidden:true})).status,500);assert.equal(await hashes(),beforeFailure,'Audit failure rolls back the whole bulk hide');}finally{await pool.query('DROP TRIGGER syn_visibility_audit ON audit_logs');await pool.query('DROP FUNCTION syn_block_visibility_audit()');}
 assert(beforeAll);
 console.log('PASS visibility HTTP: SuperAdmin-only strict input; Lumina protected; bulk atomic; hide/show/replay/audit rollback; other tables unchanged including every user, membership and role; operational status and ordinary session unchanged; settings preserved; hidden targets recoverable in admin list and flagged for dropdown filtering. No live effects.');
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
