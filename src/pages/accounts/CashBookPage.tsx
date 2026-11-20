import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api/client.js';

type Entry = { id: string; paymentNumber: string; paymentDate: string; paymentType: string; paymentMode: string; amount: string; referenceNumber?: string | null; notes?: string | null; partyName: string };
type ModeTotals = { receipts: number; payments: number; net: number; count: number };

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';

export const CashBookPage: React.FC = () => {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState('CASH');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [modes, setModes] = useState<Record<string, ModeTotals>>({});
  const [truncated, setTruncated] = useState(false);
  const [openingConfigured, setOpeningConfigured] = useState(false);
  const [cashOpeningDate, setCashOpeningDate] = useState<string | null>(null);
  const [openingBalance, setOpeningBalance] = useState<number | null>(null);
  const [closingBalance, setClosingBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiRequest<any>(`/api/payments/cash-movement?from=${from}&to=${to}`)
      .then(res => {
        if (cancelled) return;
        setEntries(res.entries || []);
        setModes(res.modes || {});
        setTruncated(Boolean(res.truncated));
        setOpeningConfigured(Boolean(res.openingBalanceConfigured));
        setCashOpeningDate(res.cashOpeningDate || null);
        setOpeningBalance(typeof res.openingBalance === 'number' ? res.openingBalance : null);
        setClosingBalance(typeof res.closingBalance === 'number' ? res.closingBalance : null);
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Could not load cash movement'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const modeKeys = useMemo(() => {
    const k = Object.keys(modes);
    if (!k.includes('CASH')) k.unshift('CASH');
    return k;
  }, [modes]);
  const totals: ModeTotals = modes[mode] || { receipts: 0, payments: 0, net: 0, count: 0 };
  const rows = entries.filter(e => String(e.paymentMode).toUpperCase() === mode);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-extrabold text-slate-900">Cash Book (recorded movement)</h1>
        <p className="text-xs text-slate-600">Posted receipts and payments by mode. Cash and Bank vouchers made with "Paid via" appear here automatically.</p>
      </div>

      {openingConfigured ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <b>Opening balance configured{cashOpeningDate ? ` from ${cashOpeningDate}` : ''}.</b> Opening and closing balances below are for the CASH tab only. Other modes are recorded movement, not balances.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>Opening balance is not configured.</b> Set it under Settings &gt; Accounts &amp; Opening Balances. The net below is only the movement recorded in this period. It is not cash in hand and not a bank balance.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="flex flex-col gap-1 font-bold text-slate-700">From
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="border border-slate-300 rounded px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 font-bold text-slate-700">To
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="border border-slate-300 rounded px-2 py-1" />
        </label>
        <div className="flex gap-1">
          {modeKeys.map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`px-3 py-1 rounded border font-bold ${mode === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'}`}>
              {m}{modes[m] ? ` (${modes[m].count})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid gap-3 text-sm ${openingConfigured && mode === 'CASH' ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-3'}`}>
        {openingConfigured && mode === 'CASH' && (
          <div className="rounded border border-slate-200 bg-white p-3"><div className="text-[11px] font-bold uppercase text-slate-500">Opening cash (as of from date)</div><div className="text-base font-extrabold text-slate-900">₹{fmt(openingBalance ?? 0)}</div></div>
        )}
        <div className="rounded border border-slate-200 bg-white p-3"><div className="text-[11px] font-bold uppercase text-slate-500">Receipts recorded ({mode})</div><div className="text-base font-extrabold text-emerald-700">₹{fmt(totals.receipts)}</div></div>
        <div className="rounded border border-slate-200 bg-white p-3"><div className="text-[11px] font-bold uppercase text-slate-500">Payments recorded ({mode})</div><div className="text-base font-extrabold text-rose-700">₹{fmt(totals.payments)}</div></div>
        <div className="rounded border border-slate-200 bg-white p-3"><div className="text-[11px] font-bold uppercase text-slate-500">Net movement in period</div><div className="text-base font-extrabold text-slate-900">₹{fmt(totals.net)}</div>{!(openingConfigured && mode === 'CASH') && <div className="text-[10px] text-slate-500">Not a balance</div>}</div>
        {openingConfigured && mode === 'CASH' && (
          <div className="rounded border border-blue-200 bg-blue-50 p-3"><div className="text-[11px] font-bold uppercase text-blue-600">Closing cash (as of to date)</div><div className="text-base font-extrabold text-blue-800">₹{fmt(closingBalance ?? 0)}</div></div>
        )}
      </div>

      {error && <div className="text-xs text-rose-700">{error}</div>}
      {truncated && <div className="text-xs text-amber-800">Showing the latest 1000 entries only. Narrow the dates for exact totals.</div>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-700">
            <tr><th className="text-left p-2">Date</th><th className="text-left p-2">No.</th><th className="text-left p-2">Party</th><th className="text-left p-2">Type</th><th className="text-right p-2">Received</th><th className="text-right p-2">Paid</th><th className="text-left p-2">Reference / notes</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td className="p-3 text-slate-500" colSpan={7}>Loading...</td></tr>}
            {!loading && rows.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={7}>No posted {mode} receipts or payments in this period.</td></tr>}
            {rows.map(e => {
              const amt = parseFloat(e.amount) || 0;
              const isRec = e.paymentType === 'RECEIPT';
              return (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="p-2 whitespace-nowrap">{new Date(e.paymentDate).toLocaleDateString('en-IN')}</td>
                  <td className="p-2 font-mono">{e.paymentNumber}</td>
                  <td className="p-2">{e.partyName}</td>
                  <td className="p-2">{isRec ? 'Receipt' : 'Payment'}</td>
                  <td className="p-2 text-right text-emerald-700">{isRec ? fmt(amt) : ''}</td>
                  <td className="p-2 text-right text-rose-700">{!isRec ? fmt(amt) : ''}</td>
                  <td className="p-2 text-slate-600">{[e.referenceNumber, e.notes].filter(Boolean).join(' / ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
