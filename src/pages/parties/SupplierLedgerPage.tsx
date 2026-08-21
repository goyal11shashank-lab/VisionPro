import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Building2,
  Search,
  RefreshCw,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  FileText,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Party, SupplierLedgerEntry } from '../../types/index.js';

export const SupplierLedgerPage: React.FC = () => {
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [entries, setEntries] = useState<SupplierLedgerEntry[]>([]);
  const [currentBalance, setCurrentBalance] = useState<string>('0.00');
  const [loading, setLoading] = useState<boolean>(true);
  const [ledgerLoading, setLedgerLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch Suppliers / Parties
  useEffect(() => {
    const fetchPartiesList = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiRequest<{ parties: Party[] }>('/api/parties?limit=100');
        const list = data.parties || [];
        setParties(list);
        if (list.length > 0) {
          setSelectedPartyId(list[0].id);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load parties for ledger');
      } finally {
        setLoading(false);
      }
    };
    fetchPartiesList();
  }, []);

  // Fetch Ledger when selectedPartyId changes
  const fetchLedger = async (partyId: string) => {
    if (!partyId) return;
    setLedgerLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{
        party: Party;
        entries: SupplierLedgerEntry[];
        currentBalance: string;
      }>(`/api/parties/${partyId}/ledger`);

      setSelectedParty(data.party);
      setEntries(data.entries || []);
      setCurrentBalance(data.currentBalance || '0.00');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch ledger statement');
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPartyId) {
      fetchLedger(selectedPartyId);
    }
  }, [selectedPartyId]);

  return (
    <div className="space-y-6" id="supplier-ledger-page-root">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Supplier Ledger & Statement of Accounts</h1>
            <p className="text-sm text-slate-500">
              Audit debit and credit records, purchase invoice dues, stock cancellation adjustments, and running balances.
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchLedger(selectedPartyId)}
          className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          title="Refresh Ledger"
        >
          <RefreshCw className={`w-4 h-4 ${ledgerLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Select Party Control & Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
            Select Supplier / Account
          </label>
          <select
            value={selectedPartyId}
            onChange={e => setSelectedPartyId(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
          >
            {parties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.partyCode}) — {p.partyType}
              </option>
            ))}
          </select>

          {selectedParty && (
            <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
              <div>GSTIN: <span className="font-mono text-slate-800 font-medium">{selectedParty.gstin || 'Unregistered'}</span></div>
              <div>Phone: <span className="text-slate-800">{selectedParty.mobile || '—'}</span></div>
              <div>City: <span className="text-slate-800">{selectedParty.city || '—'}, {selectedParty.state || ''}</span></div>
            </div>
          )}
        </div>

        {/* Current Payable Balance */}
        <div className="bg-gradient-to-br from-purple-900 to-indigo-950 p-5 rounded-2xl text-white shadow-xs flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">Net Outstanding Balance</span>
            <div className="text-2xl font-bold font-mono mt-1 text-white">
              ₹{Number(currentBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="text-xs text-purple-200 flex items-center gap-1 mt-3">
            <span>{Number(currentBalance) >= 0 ? 'Payable to Supplier (Credit balance)' : 'Advance Paid (Debit balance)'}</span>
          </div>
        </div>

        {/* Commercial Terms */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between text-xs space-y-2">
          <span className="font-bold text-slate-400 uppercase tracking-wider">Approved Credit Terms</span>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl bg-slate-50">
              <span className="text-slate-400 block">Credit Limit</span>
              <span className="font-bold text-slate-900 text-sm">
                ₹{Number(selectedParty?.creditLimit || 0).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50">
              <span className="text-slate-400 block">Credit Period</span>
              <span className="font-bold text-slate-900 text-sm">
                {selectedParty?.creditDays || 0} Days
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            Transactions posted via Purchase Invoices update this ledger in real-time.
          </p>
        </div>
      </div>

      {/* Ledger Statement Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Transaction History for {selectedParty?.name || 'Selected Supplier'}
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            {entries.length} recorded entries
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Date</th>
                <th className="px-4 py-3.5">Transaction Type</th>
                <th className="px-4 py-3.5">Reference / Notes</th>
                <th className="px-4 py-3.5 text-right">Debit (₹)</th>
                <th className="px-4 py-3.5 text-right">Credit (₹)</th>
                <th className="px-5 py-3.5 text-right">Running Balance (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {ledgerLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-purple-600" />
                      <span>Loading ledger transactions...</span>
                    </div>
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <BookOpen className="w-8 h-8 text-slate-300" />
                      <span className="font-medium text-slate-600">No transactions recorded yet</span>
                      <p className="text-xs text-slate-400">
                        Post a Purchase Invoice with this supplier to record the first credit transaction.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* Date */}
                    <td className="px-5 py-3.5 text-slate-700 font-medium">
                      {new Date(entry.transactionDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>

                    {/* Transaction Type */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-semibold ${
                        Number(entry.credit) > 0
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {Number(entry.credit) > 0 ? (
                          <ArrowUpRight className="w-3 h-3 text-purple-600" />
                        ) : (
                          <ArrowDownRight className="w-3 h-3 text-emerald-600" />
                        )}
                        <span>{entry.transactionType}</span>
                      </span>
                    </td>

                    {/* Reference & Notes */}
                    <td className="px-4 py-3.5">
                      <div className="font-mono text-slate-800">{entry.referenceType || '—'}</div>
                      {entry.notes && (
                        <div className="text-[11px] text-slate-400">{entry.notes}</div>
                      )}
                    </td>

                    {/* Debit */}
                    <td className="px-4 py-3.5 text-right font-mono font-medium text-emerald-700">
                      {Number(entry.debit) > 0 ? `₹${Number(entry.debit).toFixed(2)}` : '—'}
                    </td>

                    {/* Credit */}
                    <td className="px-4 py-3.5 text-right font-mono font-medium text-purple-800">
                      {Number(entry.credit) > 0 ? `₹${Number(entry.credit).toFixed(2)}` : '—'}
                    </td>

                    {/* Running Balance */}
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-slate-900">
                      ₹{Number(entry.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
