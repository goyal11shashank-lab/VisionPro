import React, { useState, useEffect } from 'react';
import { BookOpen, Search, ArrowUpRight, ArrowDownLeft, Building2, Calendar, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

export const CustomerLedgerPage: React.FC = () => {
  const { currentBusiness } = useAuth();
  const [parties, setParties] = useState<any[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ totalDebit: 0, totalCredit: 0, currentBalance: 0 });

  useEffect(() => {
    if (!currentBusiness) return;
    fetch('/api/parties', {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'X-Business-Id': currentBusiness.id,
      },
    })
      .then(r => r.json())
      .then(d => {
        const custs = (d.parties || []).filter(
          (p: any) => p.partyType === 'CUSTOMER' || p.partyType === 'BOTH'
        );
        setParties(custs);
        if (custs.length > 0) {
          setSelectedPartyId(custs[0].id);
        }
      })
      .catch(console.error);
  }, [currentBusiness]);

  useEffect(() => {
    if (!currentBusiness || !selectedPartyId) return;
    setLoading(true);
    fetch(`/api/sales/parties/${selectedPartyId}/ledger`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'X-Business-Id': currentBusiness.id,
      },
    })
      .then(r => r.json())
      .then(data => {
        const entries = data.entries || [];
        setLedgerEntries(entries);

        let dr = 0;
        let cr = 0;
        entries.forEach((e: any) => {
          dr += parseFloat(e.debit || '0');
          cr += parseFloat(e.credit || '0');
        });
        const bal = entries.length > 0 ? parseFloat(entries[0].balance || '0') : 0;
        setSummary({ totalDebit: dr, totalCredit: cr, currentBalance: bal });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentBusiness, selectedPartyId]);

  const selectedParty = parties.find(p => p.id === selectedPartyId);

  return (
    <div id="customer-ledger-container" className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Customer & Sales Ledger</h1>
            <p className="text-sm text-slate-500">
              Audit trail of customer debits (sales invoices), credits (reversals/receipts), and running balance
            </p>
          </div>
        </div>

        <div className="w-full sm:w-72">
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
            Select Customer
          </label>
          <select
            value={selectedPartyId}
            onChange={e => setSelectedPartyId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-medium"
          >
            {parties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.partyCode})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Balance Summary Cards */}
      {selectedParty && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase">Total Invoiced (Debits)</div>
            <div className="text-xl font-bold text-slate-900 font-mono mt-1">
              ₹{summary.totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase">Total Reversed / Receipts (Credits)</div>
            <div className="text-xl font-bold text-emerald-700 font-mono mt-1">
              ₹{summary.totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="bg-blue-50/70 p-5 rounded-xl border border-blue-200 shadow-sm">
            <div className="text-xs font-semibold text-blue-700 uppercase">Net Outstanding Balance</div>
            <div className="text-2xl font-bold text-blue-900 font-mono mt-1">
              ₹{summary.currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      )}

      {/* Ledger Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading ledger records...</div>
        ) : ledgerEntries.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            No ledger transactions found for this customer.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-right">Debit (₹)</th>
                  <th className="py-3 px-4 text-right">Credit (₹)</th>
                  <th className="py-3 px-4 text-right font-bold">Running Balance (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {ledgerEntries.map((row: any) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-sans text-slate-600">
                      {new Date(row.transactionDate).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          row.transactionType === 'SALE'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {row.transactionType}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-900 font-semibold">{row.referenceNumber || '—'}</td>
                    <td className="py-3 px-4 font-sans text-slate-600">{row.description || '—'}</td>
                    <td className="py-3 px-4 text-right text-slate-900 font-medium">
                      {parseFloat(row.debit) > 0 ? `₹${parseFloat(row.debit).toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-emerald-700 font-medium">
                      {parseFloat(row.credit) > 0 ? `₹${parseFloat(row.credit).toFixed(2)}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900">
                      ₹{parseFloat(row.balance).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
