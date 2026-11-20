import React, {useEffect,useState} from 'react';
import {apiRequest} from '../../api/client.js';
import {useAuth} from '../../context/AuthContext.js';
export const AssignedStockHistoryPage:React.FC=()=>{
 const {user}=useAuth();const [data,setData]=useState<any>(null);const [error,setError]=useState('');const [version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError('');apiRequest('/api/reports/inventory').then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[user?.assignedGodown?.id,version]);
 return <div className="p-3 md:p-6 max-w-6xl mx-auto space-y-4">
  <header className="bg-white border rounded-xl p-5 space-y-2"><h1 className="text-xl font-bold">{user?.assignedGodown?.name||'Assigned Business'} stock history</h1><p className="text-sm text-slate-600">Only the stock assigned to this login is shown. Its historical records remain in their original scope until the independent Business conversion is reviewed.</p><button onClick={()=>setVersion(v=>v+1)} className="min-h-11 px-4 border rounded-lg text-sm">Refresh assigned stock</button></header>
  {error&&<p role="alert" className="p-4 bg-red-50 text-red-700 rounded-xl">{error}</p>}
  {data&&<><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Batches',data.summary?.totalBatches],['Physical',data.summary?.totalPhysical],['Reserved',data.summary?.totalReserved],['Available',data.summary?.totalAvailable]].map(([label,value])=><div key={label} className="p-4 bg-white border rounded-xl"><p className="text-xs text-slate-500">{label}</p><p className="font-bold text-xl mt-1">{value??0}</p></div>)}</div>
  <section className="space-y-3" aria-label="Assigned stock history">{data.data?.length?data.data.map((row:any)=><article key={row.batchId} className="p-4 bg-white border rounded-xl space-y-2"><h2 className="font-semibold">{row.uniqueItemName}</h2><p className="text-xs text-slate-500">SPH {row.sph} / CYL {row.cyl} / AXIS {row.axis} / ADD {row.add} / {row.side}</p><p className="text-sm">Physical {row.physicalStock} · Reserved {row.reservedStock} · Available {row.availableStock}</p></article>):<p className="p-8 bg-white border rounded-xl text-slate-500 text-center">No stock recorded in this login's assigned history.</p>}</section></>}
  {!data&&!error&&<p>Loading assigned stock...</p>}
 </div>;
};
