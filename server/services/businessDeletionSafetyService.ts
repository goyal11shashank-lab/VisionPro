import type {Pool,PoolClient} from 'pg';
export const PROTECTED_OPERATING_BUSINESS_ID='c43b93ef-8569-4857-80ff-faca53b4ed7c';
type Dependency={table:string;label:string;count:number};
/** Conservative deletion gate: no referenced row is silently removed or detached. */
export async function inspectBusinessDeletion(queryable:Pool|PoolClient,businessId:string,currentBusinessId:string){
 const dependencies:Dependency[]=[];
 if(businessId===PROTECTED_OPERATING_BUSINESS_ID||businessId===currentBusinessId||currentBusinessId===PROTECTED_OPERATING_BUSINESS_ID)return {canDelete:false,reason:'The protected operating Business or current Business cannot be deleted.',dependencies};
 const {rows:references}=await queryable.query(`SELECT ns.nspname AS schema_name,rel.relname AS table_name,att.attname AS column_name FROM pg_constraint fk JOIN pg_class rel ON rel.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace JOIN pg_attribute att ON att.attrelid=fk.conrelid AND att.attnum=fk.conkey[1] WHERE fk.contype='f' AND fk.confrelid='public.businesses'::regclass AND cardinality(fk.conkey)=1 ORDER BY 1,2,3`);
 const {rows:[unsupported]}=await queryable.query(`SELECT COUNT(*)::int AS n FROM pg_constraint WHERE contype='f' AND confrelid='public.businesses'::regclass AND cardinality(conkey)<>1`);
 if(unsupported.n)throw new Error('Business deletion cannot verify a composite reference.');
 const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
 for(const reference of references){
  const {rows:[row]}=await queryable.query(`SELECT COUNT(*)::int AS n FROM ${quote(reference.schema_name)}.${quote(reference.table_name)} WHERE ${quote(reference.column_name)}=$1`,[businessId]);
  if(row.n)dependencies.push({table:reference.table_name,label:reference.table_name+'.'+reference.column_name,count:row.n});
 }
 const {rows:[children]}=await queryable.query('SELECT COUNT(*)::int AS n FROM businesses WHERE parent_business_id=$1',[businessId]);
 if(children.n)dependencies.push({table:'businesses',label:'Historical child Business references',count:children.n});
 // JSON relationships have no foreign key, but deleting their target changes another Business's behavior.
 const {rows:[links]}=await queryable.query(`SELECT COUNT(*)::int AS n FROM businesses WHERE id<>$1 AND settings_config::text LIKE '%' || $1::text || '%'`,[businessId]);
 if(links.n)dependencies.push({table:'businesses',label:'Business configuration references',count:links.n});
 const {rows:[parties]}=await queryable.query(`SELECT COUNT(*)::int AS n FROM parties WHERE notes LIKE '%' || $1::text || '%'`,[businessId]);
 if(parties.n)dependencies.push({table:'parties',label:'Counterpart party references',count:parties.n});
 return {canDelete:dependencies.length===0,reason:dependencies.length?'Referenced records must be reviewed before deletion. No stock, history, role, user access, settings or audit record may cascade or detach.':null,dependencies};
}
