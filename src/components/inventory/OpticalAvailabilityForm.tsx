import React, { useEffect, useState } from 'react';
import { Search, Glasses } from 'lucide-react';

export interface AvailabilityCatalogueItem { id: string; name: string; code: string; categoryCode: string; }
export interface AvailabilitySelection { item: AvailabilityCatalogueItem; sph: string; cyl: string; axis: string; add: string; side: string; }
export function OpticalAvailabilityForm({ catalogue, busy, onCheck, onEdit, resetKey }: { resetKey?: string; catalogue: AvailabilityCatalogueItem[]; busy: boolean; onCheck: (selection: AvailabilitySelection) => void; onEdit?: () => void }) {
  const [itemId, setItemId] = useState('');
  const [powers, setPowers] = useState({ sph: '', cyl: '', axis: '', add: '', side: '' });
  const [error, setError] = useState('');
  useEffect(()=>{setItemId('');setPowers({sph:'',cyl:'',axis:'',add:'',side:''});setError('');},[resetKey]);
  const item = catalogue.find(row => row.id === itemId);
  const category = item?.categoryCode.toUpperCase();
  const multi = category === 'KT' || category === 'PROG';
  const update = (key: keyof typeof powers, value: string) => { onEdit?.(); setError(''); setPowers(old => ({ ...old, [key]: value })); };
  const format = (key: 'sph'|'cyl'|'add') => {
    const value = powers[key].trim();
    if (value && Number.isFinite(Number(value))) update(key, `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}`);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!item || !['SV','KT','PROG'].includes(category!)) { setError('Select an SV, KT or progressive item first.'); return; }
    for (const key of ['sph','cyl',...(multi ? ['add'] : [])] as ('sph'|'cyl'|'add')[]) {
      if (!powers[key].trim() || !Number.isFinite(Number(powers[key]))) { setError(`Enter a valid ${key.toUpperCase()} power.`); return; }
    }
    if (multi && Number(powers.cyl) !== 0 && (!powers.axis.trim() || !Number.isInteger(Number(powers.axis)) || Number(powers.axis) < 0 || Number(powers.axis) > 180)) { setError('Enter AXIS as a whole degree from 0 to 180.'); return; }
    if (category === 'PROG' && !powers.side) { setError('Select Right, Left or Both eyes.'); return; }
    const signed = (value: string) => `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}`;
    onCheck({ item, sph: signed(powers.sph), cyl: signed(powers.cyl), axis: multi && Number(powers.cyl) !== 0 ? String(Number(powers.axis)) : '0', add: multi ? signed(powers.add) : '0', side: category === 'PROG' ? powers.side : 'NONE' });
  };
  const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base font-mono text-slate-900 focus:ring-2 focus:ring-blue-500';
  return <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5" aria-label="Optical stock check">
    <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Glasses size={23}/></div><div><h2 className="text-lg font-bold text-slate-900">Check stock availability</h2><p className="text-sm text-slate-500">Choose the item, enter its optical power, then check stock.</p></div></div>
    <div><label htmlFor="availability-item" className="mb-1.5 block text-sm font-semibold text-slate-700">1. Select item</label><select id="availability-item" value={itemId} onChange={event => { onEdit?.(); setItemId(event.target.value); setPowers({sph:'',cyl:'',axis:'',add:'',side:''}); setError(''); }} className={inputClass} required><option value="">Choose an item from the catalogue</option>{catalogue.map(row=><option key={row.id} value={row.id}>{row.name} [{row.code}]</option>)}</select></div>
    {item && <><div className="flex items-center gap-2"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{category === 'PROG' ? 'Progressive' : category === 'KT' ? 'KT · Bifocal' : 'SV · Single vision'}</span><span className="text-xs text-slate-500">Type comes from the selected item</span></div><div className="grid grid-cols-2 gap-4 md:grid-cols-5">
      {(['sph','cyl',...(multi?['axis','add']:[])] as ('sph'|'cyl'|'axis'|'add')[]).map(key=><div key={key}><label htmlFor={`availability-${key}`} className="mb-1.5 block text-sm font-semibold text-slate-700">{key==='axis'?'AXIS (°)':key.toUpperCase()+' (D)'}</label><input id={`availability-${key}`} type="text" inputMode="decimal" value={powers[key]} placeholder={key==='axis'?'0–180':key==='add'?'+2.00':'0.00'} onChange={event=>update(key,event.target.value)} onBlur={()=>{if(key!=='axis')format(key);}} className={inputClass}/></div>)}
      {category==='PROG'&&<div><label htmlFor="availability-side" className="mb-1.5 block text-sm font-semibold text-slate-700">SIDE</label><select id="availability-side" value={powers.side} onChange={event=>update('side',event.target.value)} className={inputClass}><option value="">Select eye</option><option value="R">R · Right</option><option value="L">L · Left</option><option value="BE">BE · Both eyes</option></select></div>}
    </div><p className="text-xs text-slate-500">Use signed diopters, for example SPH -2.00 and CYL -0.75.{multi?' ADD uses diopters, for example +2.00. AXIS is required for a non-zero CYL; zero CYL uses AXIS 0.':''}</p></>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={!item||busy} className="flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"><Search size={17}/>{busy?'Checking…':'Check availability'}</button>
  </form>;
}
