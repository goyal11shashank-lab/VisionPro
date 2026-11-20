import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import {pool} from '../db/index.js';import {createExpressApp} from '../app.js';import {generateAuthToken} from '../auth/jwt.js';import {hashPassword} from '../auth/password.js';
const server=createExpressApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.listening?r():server.once('listening',r));const port=(server.address() as any).port;
try{
 delete process.env.BUSINESS_LOGIN_BINDINGS_ENABLED;
 const {rows:[exists]}=await pool.query(`SELECT to_regclass('public.business_login_bindings') AS name`);if(!exists.name)await pool.query(readFileSync(new URL('../db/proposals/business-login-bindings.sql',import.meta.url),'utf8'));
 const {rows:businesses}=await pool.query(`SELECT id FROM businesses WHERE status='ACTIVE' ORDER BY id LIMIT 2`);assert.equal(businesses.length,2);const [a,b]=businesses.map(row=>row.id);
 const {rows:[user]}=await pool.query(`INSERT INTO users(username,full_name,password_hash,user_permissions_override) VALUES($1,'Synthetic canonical login',$2,'{"inventory:view":true}') RETURNING id,username,password_hash`,['syn_canonical_'+Date.now(),await hashPassword('SyntheticCanonical_Only17')]);
 for(const [id,def] of [[a,true],[b,false]])await pool.query(`INSERT INTO user_business_access(user_id,business_id,is_default) VALUES($1,$2,$3)`,[user.id,id,def]);
 const token=generateAuthToken({userId:user.id,username:user.username,isSuperAdmin:false,businessId:a});
 const api=async(path:string,business=a,method='GET',body?:any)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:'Bearer '+token,'X-Business-Id':business,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json() as any};};
 const membership=async()=>JSON.stringify((await pool.query(`SELECT * FROM user_business_access WHERE user_id=$1 ORDER BY business_id`,[user.id])).rows);
 const before=await membership();assert.equal((await api('/api/inventory',b)).status,200);
 await pool.query(`INSERT INTO business_login_bindings(user_id,business_id,decision_reference) VALUES($1,$2,'Synthetic explicit choice only')`,[user.id,a]);
 assert.equal((await api('/api/inventory',b)).status,200,'Feature disabled must not change current access');
 process.env.BUSINESS_LOGIN_BINDINGS_ENABLED='true';
 assert.equal((await api('/api/inventory',a)).status,200);assert.equal((await api('/api/inventory',b)).status,403);
 assert.equal((await api('/api/auth/switch-business',a,'POST',{targetBusinessId:b})).status,403);
 assert.equal((await api('/api/businesses/'+b)).status,403);
 const list=await api('/api/businesses');assert.deepEqual(list.data.map((row:any)=>row.id),[a]);const me=await api('/api/auth/me');assert.deepEqual(me.data.accessibleBusinesses.map((row:any)=>row.id),[a]);
 const login=async(businessId:string)=>{const r=await fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:'SyntheticCanonical_Only17',businessId})});return {status:r.status,data:await r.json() as any};};
 assert.equal((await login(b)).status,403);const correct=await login(a);assert.equal(correct.status,200,JSON.stringify(correct));assert.deepEqual(correct.data.accessibleBusinesses.map((row:any)=>row.id),[a]);
 assert.equal(await membership(),before,'Restricting active choices must not delete old memberships/defaults');assert.equal((await pool.query(`SELECT password_hash FROM users WHERE id=$1`,[user.id])).rows[0].password_hash,user.password_hash);
 const {rows:[admin]}=await pool.query(`SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1`);const adminToken=generateAuthToken({userId:admin.id,username:admin.username,isSuperAdmin:true,businessId:b});const ar=await fetch(`http://127.0.0.1:${port}/api/inventory`,{headers:{Authorization:'Bearer '+adminToken,'X-Business-Id':b}});assert.equal(ar.status,200);
 await pool.query(`DELETE FROM business_login_bindings WHERE user_id=$1`,[user.id]);assert.equal((await api('/api/inventory',b)).status,200,'Unmapped ordinary logins retain current access, no default-derived lockout');
 console.log('PASS opt-in explicit canonical binding: login/me/business list/detail/header/token/switch boundaries; historical memberships/defaults and password hash unchanged; Super Admin unchanged; disabled and unmapped ordinary users unchanged. No live mapping applied.');
}finally{delete process.env.BUSINESS_LOGIN_BINDINGS_ENABLED;await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
