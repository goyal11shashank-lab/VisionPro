import { Router, Request, Response } from 'express';
import { BusinessRelationshipService } from '../services/businessRelationshipService.js';
import { pool } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import { validateOpticalPower } from '../services/opticalMasterService.js';
const router = Router();
router.use(authenticateToken);
router.use(requireAnyPermission(['inventory:view','master:view','sales:view','sales:create','purchase:view','purchase:create']));
async function sourceFor(req: Request) {
  return (await BusinessRelationshipService.resolveSupplier(req.user!.currentBusinessId)).source;
}
router.get('/catalogue',async(req:Request,res:Response)=>{
  try {
    const source=await sourceFor(req);
    const {rows:items}=await pool.query(`SELECT ui.id,ui.name,ui.code,UPPER(COALESCE(ui.optical_category,c.code)) AS "categoryCode" FROM unique_items ui LEFT JOIN primary_items pi ON pi.id=ui.primary_item_id LEFT JOIN categories c ON c.id=pi.category_id WHERE ui.business_id=$1 AND ui.status='ACTIVE' ORDER BY ui.name,ui.code`,[source.id]);
    res.json({success:true,sourceBusiness:{name:source.name},items});
  }catch(error:any){res.status(403).json({error:error.message});}
});
router.get('/check',async(req:Request,res:Response)=>{
  try {
    const source=await sourceFor(req);
    const {rows:[item]}=await pool.query(`SELECT id,code,optical_category FROM unique_items WHERE id=$1 AND business_id=$2 AND status='ACTIVE'`,[req.query.itemId,source.id]);
    if(!item){res.status(404).json({error:'Item is not in the linked supplier catalogue.'});return;}
    for(const key of ['sph','cyl',...(item.optical_category!=='SV'?['add']:[])]) {
      const value=req.query[key];if(typeof value!=='string'||!value.trim()||!Number.isFinite(Number(value)))throw new Error(`Valid ${key.toUpperCase()} is required.`);
    }
    if(req.query.axis!==undefined&&(!Number.isFinite(Number(req.query.axis))||!Number.isInteger(Number(req.query.axis))))throw new Error('AXIS must be a whole degree.');
    const identity=validateOpticalPower(item.optical_category,String(req.query.sph),String(req.query.cyl),req.query.axis as string,req.query.add as string,req.query.side as string);
    const {rows:[result]}=await pool.query(`SELECT EXISTS(SELECT 1 FROM optical_batches ob JOIN optical_stocks os ON os.batch_id=ob.id AND os.business_id=ob.business_id WHERE ob.business_id=$1 AND ob.unique_item_id=$2 AND ob.status='ACTIVE' AND ob.sph=$3 AND ob.cyl=$4 AND ob.axis=$5 AND ob.add=$6 AND ob.side=$7 AND os.available_stock>0) AS available`,[source.id,item.id,identity.sphNum,identity.cylNum,identity.axisNum,identity.addNum,identity.sideNormalized]);
    const {rows:[own]}=await pool.query(`SELECT EXISTS(SELECT 1 FROM unique_items ui JOIN optical_batches ob ON ob.unique_item_id=ui.id AND ob.business_id=ui.business_id JOIN optical_stocks os ON os.batch_id=ob.id AND os.business_id=ui.business_id WHERE ui.business_id=$1 AND ui.code=$2 AND ui.optical_category=$3 AND ui.status='ACTIVE' AND ob.status='ACTIVE' AND ob.sph=$4 AND ob.cyl=$5 AND ob.axis=$6 AND ob.add=$7 AND ob.side=$8 AND os.available_stock>0) AS available`,[req.user!.currentBusinessId,item.code,item.optical_category,identity.sphNum,identity.cylNum,identity.axisNum,identity.addNum,identity.sideNormalized]);
    res.json({success:true,sourceBusiness:{name:source.name},available:result.available,ownAvailable:own.available});
  }catch(error:any){res.status(400).json({error:error.message});}
});
export default router;
