import assert from 'node:assert/strict';
import {assertSyntheticDatabase} from './assertSyntheticDatabase.js';assertSyntheticDatabase();
import {pool} from '../db/index.js';
import {createExpressApp} from '../app.js';
import {generateAuthToken} from '../auth/jwt.js';
import {inspectBusinessDeletion,PROTECTED_OPERATING_BUSINESS_ID} from '../services/businessDeletionSafetyService.js';
try{
 const {rows:[current]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic retained session') RETURNING id`);
 const {rows:[empty]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic deletion candidate') RETURNING id`);
 assert.equal((await inspectBusinessDeletion(pool,PROTECTED_OPERATING_BUSINESS_ID,current.id)).canDelete,false);
 assert.equal((await inspectBusinessDeletion(pool,current.id,current.id)).canDelete,false);
 assert.equal((await inspectBusinessDeletion(pool,empty.id,current.id)).canDelete,true);
 await pool.query(`INSERT INTO dealer_shipments(main_business_id,dealer_business_id,shipment_number,total_quantity,status) VALUES($1,$2,$3,0,'DISPATCHED')`,[current.id,empty.id,'SYN-DELETE-'+Date.now()]);
 const linked=await inspectBusinessDeletion(pool,empty.id,current.id);assert.equal(linked.canDelete,false);assert(linked.dependencies.some(d=>d.table==='dealer_shipments'));
 const {rows:[roleOnly]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic role owner') RETURNING id`);
 await pool.query(`INSERT INTO roles(business_id,name,code) VALUES($1,'Synthetic shared role',$2)`,[roleOnly.id,'SYN_'+Date.now()]);
 assert((await inspectBusinessDeletion(pool,roleOnly.id,current.id)).dependencies.some(d=>d.table==='roles'));
 const {rows:[parentOnly]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic historical parent only') RETURNING id`);
 await pool.query(`INSERT INTO businesses(name,parent_business_id) VALUES('Synthetic historical child only',$1)`,[parentOnly.id]);
 assert((await inspectBusinessDeletion(pool,parentOnly.id,current.id)).dependencies.some(d=>d.label==='Historical child Business references'));
 const {rows:[configured]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic configured source') RETURNING id`);
 await pool.query(`UPDATE businesses SET settings_config=jsonb_build_object('businessRelationships',jsonb_build_object('supplierBusinessId',$2::text)) WHERE id=$1`,[current.id,configured.id]);
 assert((await inspectBusinessDeletion(pool,configured.id,current.id)).dependencies.some(d=>d.label==='Business configuration references'));
 await assert.rejects(()=>inspectBusinessDeletion({query:async()=>{throw Error('SYN_PERMISSION_DENIED');}} as any,empty.id,current.id),/SYN_PERMISSION_DENIED/);
 const {rows:[admin]}=await pool.query('SELECT id,username FROM users WHERE is_super_admin=true LIMIT 1');
 const server=createExpressApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.listening?r():server.once('listening',r));const port=(server.address() as any).port;
 try{
  const token=generateAuthToken({userId:admin.id,username:admin.username,isSuperAdmin:true,businessId:current.id});
  const remove=async(id:string)=>{const r=await fetch(`http://127.0.0.1:${port}/api/businesses/${id}`,{method:'DELETE',headers:{Authorization:'Bearer '+token,'X-Business-Id':current.id}});return {status:r.status,body:await r.json() as any};};
  const hashes=async()=>{const {rows:tables}=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);const result=[];for(const {tablename} of tables){const {rows:[r]}=await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS h FROM public."${tablename.replaceAll('"','""')}" t`);result.push([tablename,r.h]);}return JSON.stringify(result);};
  const before=await hashes();assert.equal((await remove(empty.id)).status,400);assert.equal((await remove(roleOnly.id)).status,400);assert.equal(await hashes(),before);
  const {rows:[pristine]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic truly empty HTTP deletion') RETURNING id`);
  const result=await remove(pristine.id);assert.equal(result.status,200,JSON.stringify(result));assert.equal((await pool.query('SELECT id FROM businesses WHERE id=$1',[pristine.id])).rowCount,0);
  const {rows:[rollback]}=await pool.query(`INSERT INTO businesses(name) VALUES('Synthetic audited deletion rollback') RETURNING id`);
  await pool.query(`CREATE FUNCTION syn_block_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='BUSINESS_DELETED' THEN RAISE EXCEPTION 'SYN_AUDIT_BLOCK'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER syn_cleanup_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION syn_block_cleanup_audit()');
  try{const beforeFailure=await hashes();assert.equal((await remove(rollback.id)).status,500);assert.equal(await hashes(),beforeFailure,'Audit failure must roll deletion back');}finally{await pool.query('DROP TRIGGER syn_cleanup_audit ON audit_logs');await pool.query('DROP FUNCTION syn_block_cleanup_audit()');}
  console.log('PASS deletion HTTP: linked/role-owned targets400 with all-table hashes unchanged; truly empty deletes with audit; injected audit failure500 rolls back target deletion.');
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
 console.log('PASS conservative Business deletion inventory: protected/current Business blocked; truly empty allowed; newer shipment cascade, owned roles and JSON counterpart links block; inspection errors fail closed. Disposable synthetic deletion only; no live deletion.');
}finally{await pool.end();}
