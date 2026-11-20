import React, { useEffect, useRef, useState } from 'react';
import { Truck, RefreshCw, X } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';

type Shipment = { id:string; shipmentNumber:string; status:string; mainWarehouseName:string; dealerOrderNumber:string; totalQuantity:number; totalReceivedQuantity:number; trackingNumber?:string };
type Line = { id:string; unique_item_name:string; optical_category:string; sph:string; cyl:string; axis:number; add:string; side:string; dispatched_quantity:string; received_quantity:string; damaged_quantity:string; short_quantity:string; remaining_quantity:string };
type Details = { shipment:{id:string;shipment_number:string;status:string;dealer_business_id:string}; lines:Line[]; goodsReceipts:{id:string;receipt_number:string;purchase_invoice_number?:string}[] };
type Counts = { receivedQuantity:string; damagedQuantity:string; shortQuantity:string };
type Attempt = { requestId:string; receiptDate:string; remarks:string; lines:{shipmentLineId:string;receivedQuantity:number;damagedQuantity:number;shortQuantity:number}[] };
const zero = ():Counts => ({receivedQuantity:'0',damagedQuantity:'0',shortQuantity:'0'});
const fields = [['receivedQuantity','Good'],['damagedQuantity','Damaged'],['shortQuantity','Short']] as const;
const power = (line:Line) => `SPH ${line.sph} / CYL ${line.cyl}${line.optical_category!=='SV' ? ` / AXIS ${line.axis}° / ADD ${line.add}` : ''}${line.optical_category==='PROG' ? ` / ${line.side}` : ''}`;

export const IncomingBusinessShipmentsPage:React.FC = () => {
  const {currentBusiness} = useAuth();
  return <ReceivingList key={currentBusiness?.id} />;
};
const ReceivingList:React.FC = () => {
  const {currentBusiness,hasPermission} = useAuth();
  const [rows,setRows] = useState<Shipment[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [version,setVersion]=useState(0);
  const [selected,setSelected]=useState<string|null>(null);
  const allowed=hasPermission('purchase:view')||hasPermission('inventory:view');
  useEffect(()=>{let active=true;setLoading(true);setError('');if(!allowed){setLoading(false);return;}
    apiRequest<{shipments:Shipment[]}>('/api/dealer/shipments/incoming').then(result=>{if(active)setRows(result.shipments||[]);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[currentBusiness?.id,version,allowed]);
  if(!allowed)return <div className="p-6" role="alert">Your role cannot view incoming shipments.</div>;
  return <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
    <header className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-3"><Truck className="text-blue-600 shrink-0"/>Incoming Business Shipments</h1><p className="text-sm text-slate-500 mt-2">Goods addressed to {currentBusiness?.name || 'your business'}. Open a shipment to inspect its remaining items.</p></div>
      <button onClick={()=>setVersion(v=>v+1)} disabled={loading} className="border rounded-lg px-4 min-h-11 flex gap-2 items-center text-sm"><RefreshCw size={16}/>Refresh</button>
    </header>
    {error&&<p role="alert" className="bg-red-50 text-red-700 rounded-xl p-4">{error}</p>}
    <div className="space-y-3">{rows.map(row=><article key={row.id} className="bg-white border rounded-xl p-4 flex flex-wrap justify-between gap-4">
      <div className="space-y-1 min-w-0"><h2 className="font-mono font-semibold text-blue-700">{row.shipmentNumber}</h2><p className="text-sm break-words">{row.mainWarehouseName}</p><p className="text-xs text-slate-500">Order {row.dealerOrderNumber||'-'} · {row.status.replaceAll('_',' ')}</p><p className="text-sm">Dispatched {row.totalQuantity} · Good received {row.totalReceivedQuantity}</p>{row.trackingNumber&&<p className="text-xs break-all">Tracking {row.trackingNumber}</p>}</div>
      <button onClick={()=>setSelected(row.id)} className="self-center rounded-lg bg-blue-600 text-white px-4 min-h-11 text-sm font-medium">Inspect shipment</button>
    </article>)}{!rows.length&&<p className="bg-white rounded-xl p-8 text-center text-slate-500">{loading?'Loading incoming shipments...':'No incoming shipments for this business.'}</p>}</div>
    {selected&&<Inspection key={`${currentBusiness?.id}:${selected}`} shipmentId={selected} onClose={()=>setSelected(null)} onPosted={()=>setVersion(v=>v+1)}/>}
  </div>;
};
const Inspection:React.FC<{shipmentId:string;onClose:()=>void;onPosted:()=>void}> = ({shipmentId,onClose,onPosted}) => {
  const {currentBusiness,hasPermission,user}=useAuth();
  const canReceive=Boolean(user?.isSuperAdmin||hasPermission('purchase:create')||hasPermission('purchase.create')||hasPermission('purchase:receive'));
  const [details,setDetails]=useState<Details|null>(null);const [counts,setCounts]=useState<Record<string,Counts>>({});const [error,setError]=useState('');const [posting,setPosting]=useState(false);const [review,setReview]=useState(false);const [posted,setPosted]=useState<any>(null);
  const [date,setDate]=useState(()=>new Date().toLocaleDateString('sv-SE'));const [remarks,setRemarks]=useState('');const [loadVersion,setLoadVersion]=useState(0);
  const storageKey=`receiving-attempt:${currentBusiness?.id}:${shipmentId}`;
  const [pending,setPending]=useState<Attempt|null>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{return null;}});
  const live=useRef(true);const postingRef=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{let active=true;setError('');apiRequest<Details>('/api/dealer/shipments/'+shipmentId).then(data=>{if(active){setDetails(data);setCounts(Object.fromEntries(data.lines.map(line=>[line.id,zero()])));}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[shipmentId,loadVersion]);
  const lines=details?.lines||[];
  const values=lines.map(line=>({shipmentLineId:line.id,...Object.fromEntries(fields.map(([key])=>[key,Number(counts[line.id]?.[key]||0)]))})) as Attempt['lines'];
  const problems:string[]=[];
  values.forEach((value,index)=>{const amounts=fields.map(([key])=>value[key]);if(amounts.some(n=>!Number.isFinite(n)||n<0||!Number.isInteger(n*2)))problems.push(`Line ${index+1}: use non-negative multiples of 0.5.`);if(amounts.reduce((a,b)=>a+b,0)>Number(lines[index].remaining_quantity))problems.push(`Line ${index+1}: inspected total exceeds its remaining quantity.`);});
  const totals=fields.map(([key])=>values.reduce((sum,line)=>sum+line[key],0));
  const hasChanges=totals.some(n=>n>0);
  const eligible=canReceive&&details?.shipment.dealer_business_id===currentBusiness?.id&&!['RECEIVED','CANCELLED'].includes(details?.shipment.status||'');
  const close=()=>{if(posting)return;if(hasChanges&&!posted&&!pending&&!window.confirm('Discard these unposted inspection counts?'))return;onClose();};
  const reconcile=async()=>{
    if(!pending||postingRef.current)return;postingRef.current=true;setPosting(true);setError('');
    try {
      const result=await apiRequest<any>('/api/dealer/shipments/'+shipmentId+'/receipt-attempt/'+pending.requestId,{},0);
      if(!live.current)return;
      setReview(false);
      if(result.posted){sessionStorage.removeItem(storageKey);setPending(null);setPosted(result.result);setCounts({});onPosted();}
      setLoadVersion(v=>v+1);
      if(!result.posted)setError('No posted result found yet. Keep this attempt saved and use safe retry. A delayed request might still arrive; do not start a second inspection.');
    }catch(e:any){if(live.current)setError(e.message||'Could not confirm the saved attempt. Keep it saved and try again.');}
    finally{postingRef.current=false;if(live.current)setPosting(false);}
  };
  const submit=async(attempt:Attempt)=>{
    if(postingRef.current)return;postingRef.current=true;setPosting(true);setError('');
    try{sessionStorage.setItem(storageKey,JSON.stringify(attempt));setPending(attempt);}catch{postingRef.current=false;setPosting(false);setError('This browser could not save a safe receipt reference. No posting was sent. Enable session storage before trying again.');return;}
    try{const result=await apiRequest<any>('/api/dealer/shipments/'+shipmentId+'/receive',{method:'POST',body:JSON.stringify(attempt)},0);sessionStorage.removeItem(storageKey);if(live.current){setPending(null);setPosted(result);setReview(false);setCounts({});onPosted();setLoadVersion(v=>v+1);}}
    catch(e:any){if(live.current){setError(e.message||'Receipt result is not confirmed. Retry the same saved attempt; do not enter it again as a new receipt.');if(e.status===400&&e.data?.receiptOutcome==='NOT_POSTED'){sessionStorage.removeItem(storageKey);setPending(null);setReview(false);setLoadVersion(v=>v+1);}}}
    finally{postingRef.current=false;if(live.current)setPosting(false);}
  };
  return <div className="fixed inset-0 z-50 bg-slate-950/50 p-2 md:p-6 flex justify-center items-start" role="dialog" aria-modal="true" aria-label="Shipment inspection">
    <div className="bg-slate-50 rounded-2xl w-full max-w-5xl max-h-[96dvh] overflow-y-auto p-4 md:p-6 space-y-4">
      <header className="flex justify-between items-start gap-3"><div><h2 className="font-bold text-xl">Inspect {details?.shipment.shipment_number||'shipment'}</h2><p className="text-sm text-slate-500">Record only quantities counted in this inspection. Leave uninspected goods at zero.</p></div><button aria-label="Close inspection" onClick={close} disabled={posting} className="min-w-11 min-h-11 flex justify-center items-center border rounded-lg bg-white"><X size={20}/></button></header>
      {error&&<p role="alert" className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">{error}</p>}
      {posted&&<div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl"><strong>Receipt {posted.receiptNumber} posted.</strong><p>Good {posted.totalGoodReceived} · Damaged {posted.totalDamaged} · Short {posted.totalShort}</p><p>{posted.purchaseInvoiceId?'Purchase bill and stock/accounting posted.':'No good goods received, so no purchase bill was created.'}</p></div>}
      {pending&&!posted&&<div className="border border-amber-300 bg-amber-50 p-4 rounded-xl space-y-3"><p className="text-sm">An inspection attempt is saved. Its outcome may already be posted. Retry uses the same reference and counts, so it cannot post twice. Do not create a new attempt until its result is confirmed.</p><button disabled={posting} onClick={()=>submit(pending)} className="min-h-11 px-4 bg-blue-600 text-white rounded-lg">{posting?'Checking saved attempt...':'Retry saved receipt safely'}</button><button disabled={posting} onClick={reconcile} className="min-h-11 px-4 border border-amber-400 rounded-lg ml-2">Check result without posting</button></div>}
      {!details&&!error&&<p>Loading shipment details...</p>}
      {details&&<>
        {!eligible&&<p className="p-3 bg-white rounded-lg text-sm">{canReceive?'This shipment is complete or cannot be received by the selected business.':'Your role can inspect this shipment but cannot post goods receipts.'}</p>}
        {lines.map((line,index)=><section key={line.id} className="bg-white border rounded-xl p-4 space-y-3">
          <div><h3 className="font-semibold">{index+1}. {line.unique_item_name}</h3><p className="text-xs text-slate-500 mt-1">{power(line)}</p></div>
          <p className="text-sm">Dispatched {Number(line.dispatched_quantity)} · Previously good {Number(line.received_quantity)} · Damaged {Number(line.damaged_quantity)} · Short {Number(line.short_quantity)}</p>
          <p className="text-sm font-semibold text-blue-800">Remaining to inspect: {Number(line.remaining_quantity)}</p>
          {eligible&&!pending&&!posted&&<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{fields.map(([key,label])=><label key={key} className="text-sm font-medium">{label}<input aria-label={`Line ${index+1} ${label}`} type="number" min="0" step="0.5" max={line.remaining_quantity} inputMode="decimal" value={counts[line.id]?.[key]||'0'} onChange={e=>{setReview(false);setCounts(previous=>({...previous,[line.id]:{...(previous[line.id]||zero()),[key]:e.target.value}}));}} className="mt-1 block w-full rounded-lg border border-slate-300 p-3"/></label>)}</div>}
        </section>)}
        {eligible&&!pending&&!posted&&<>
          <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">Receipt date<input aria-label="Receipt date" type="date" value={date} onChange={e=>{setDate(e.target.value);setReview(false);}} className="w-full mt-1 p-3 border rounded-lg"/></label><label className="text-sm">Inspection notes<input aria-label="Inspection notes" value={remarks} onChange={e=>{setRemarks(e.target.value);setReview(false);}} className="w-full mt-1 p-3 border rounded-lg"/></label></div>
          {problems.length>0&&<p role="alert" className="text-red-700 text-sm">{problems.join(' ')}</p>}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm space-y-2"><p>Good {totals[0]} · Damaged {totals[1]} · Short {totals[2]}</p><p>Posting adds only good goods to this business's stock and posts a purchase bill/payable at the shipment's recorded rates and tax. Damaged and short goods are recorded but do not become good stock. Historical invoices are not changed.</p></div>
          {!review?<button disabled={!hasChanges||!!problems.length||!date} onClick={()=>setReview(true)} className="min-h-11 w-full sm:w-auto px-5 rounded-lg bg-blue-600 text-white disabled:opacity-40">Review receipt</button>:<div className="bg-white border rounded-xl p-4 space-y-3"><p className="font-semibold">Confirm these inspected counts for {date}?</p><p className="text-sm">This posts stock and accounts. Check the item powers, remaining counts and damaged/short quantities before confirming.</p><button onClick={()=>submit({requestId:crypto.randomUUID(),receiptDate:date,remarks,lines:values.filter(line=>fields.some(([key])=>line[key]>0))})} disabled={posting||!!problems.length||!hasChanges} className="min-h-11 w-full sm:w-auto px-5 rounded-lg bg-blue-700 text-white disabled:opacity-40">Confirm and post receipt</button></div>}
        </>}
        <section className="bg-white border rounded-xl p-4"><h3 className="font-semibold mb-2">Receipt history</h3>{details.goodsReceipts.length?details.goodsReceipts.map(receipt=><p className="text-sm py-1" key={receipt.id}>{receipt.receipt_number}{receipt.purchase_invoice_number?` · Bill ${receipt.purchase_invoice_number}`:''}</p>):<p className="text-sm text-slate-500">No receipts posted for this shipment.</p>}</section>
      </>}
    </div>
  </div>;
};
