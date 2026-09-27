import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  Building2,
  Calendar,
  FileText,
  Printer,
  RefreshCw,
  ExternalLink,
  CreditCard,
  Phone,
  Mail,
  ShieldCheck,
  ChevronRight,
  Eye,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { getStoredToken } from '../../api/client.js';
import { printDocument } from '../../utils/printService.js';
import { QuickPeriodKey, getDateRangeForPeriod } from '../../utils/datePeriods.js';

interface LedgerEntry {
  id: string;
  transactionDate: string;
  transactionType: string;
  voucherType: string;
  voucherNumber: string;
  referenceType?: string;
  referenceId?: string;
  debit: number;
  credit: number;
  balance: number;
  rawBalance: number;
  balanceDrCr: 'Dr' | 'Cr';
  balanceFormatted: string;
  notes?: string;
  createdAt: string;
}

interface PartyInfo {
  id: string;
  partyCode: string;
  name: string;
  partyType: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  gstin?: string;
  creditLimit?: number;
  creditDays?: number;
}

interface StatementSummary {
  openingBalance: number;
  openingBalanceDrCr: string;
  openingBalanceFormatted: string;
  totalDebit: number;
  totalCredit: number;
  netPeriodChange: number;
  closingBalance: number;
  closingBalanceDrCr: string;
  closingBalanceFormatted: string;
  recordsCount: number;
}

export const SupplierLedgerPage: React.FC<{ onNavigate?: (path: string) => void }> = ({ onNavigate }) => {
  const { currentBusiness } = useAuth();
  const [parties, setParties] = useState<any[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [selectedParty, setSelectedParty] = useState<PartyInfo | null>(null);

  // Date filters
  const [quickPeriod, setQuickPeriod] = useState<QuickPeriodKey>('THIS_MONTH');
  const [fromDate, setFromDate] = useState<string>(() => getDateRangeForPeriod('THIS_MONTH').from || '');
  const [toDate, setToDate] = useState<string>(() => getDateRangeForPeriod('THIS_MONTH').to || '');

  // Ledger state
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<StatementSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drill-down voucher modal
  const [drillDownVoucher, setDrillDownVoucher] = useState<{
    type: string;
    id: string;
    number: string;
    date: string;
    amount: number;
    notes?: string;
    allocations?: any[];
  } | null>(null);
  const [loadingVoucher, setLoadingVoucher] = useState(false);

  // Load suppliers list
  useEffect(() => {
    if (!currentBusiness) return;
    fetch('/api/parties', {
      headers: {
        Authorization: `Bearer ${getStoredToken()}`,
        'X-Business-Id': currentBusiness.id,
      },
    })
      .then(r => r.json())
      .then(d => {
        const supps = (d.parties || []).filter(
          (p: any) => p.partyType === 'SUPPLIER' || p.partyType === 'BOTH'
        );
        setParties(supps);
        if (supps.length > 0 && !selectedPartyId) {
          setSelectedPartyId(supps[0].id);
        }
      })
      .catch(console.error);
  }, [currentBusiness]);

  // Fetch statement when party or date range changes
  const fetchStatement = async (partyId: string, from?: string, to?: string) => {
    if (!currentBusiness || !partyId) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (from) params.append('fromDate', from);
      if (to) params.append('toDate', to);
      params.append('ledgerType', 'SUPPLIER');

      const res = await fetch(`/api/payments/statement/${partyId}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${getStoredToken()}`,
          'X-Business-Id': currentBusiness.id,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to fetch supplier ledger statement');
      }

      const data = await res.json();
      setSelectedParty(data.party);
      setEntries(data.entries || []);
      setSummary(data.summary);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading supplier ledger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPartyId) {
      fetchStatement(selectedPartyId, fromDate, toDate);
    }
  }, [selectedPartyId, fromDate, toDate, currentBusiness]);

  const handlePeriodChange = (pKey: QuickPeriodKey) => {
    setQuickPeriod(pKey);
    const range = getDateRangeForPeriod(pKey);
    setFromDate(range.from || '');
    setToDate(range.to || '');
  };

  const handlePrint = async () => {
    if (!selectedParty) return;
    try {
      await printDocument({
        elementOrId: 'supplier-ledger-printable-table',
        title: `Supplier Ledger - ${selectedParty.name}`,
        filename: `Supplier_Ledger_${selectedParty.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`,
        orientation: 'landscape',
      });
    } catch (err) {
      console.error('Print failed:', err);
    }
  };

  // Voucher drill-down click
  const handleVoucherClick = async (entry: LedgerEntry) => {
    if (!entry.referenceId || !entry.referenceType) return;
    setLoadingVoucher(true);
    try {
      if (entry.referenceType === 'PURCHASE_INVOICE') {
        const res = await fetch(`/api/purchases/${entry.referenceId}`, {
          headers: {
            Authorization: `Bearer ${getStoredToken()}`,
            'X-Business-Id': currentBusiness?.id || '',
          },
        });
        if (res.ok) {
          const inv = await res.json();
          setDrillDownVoucher({
            type: 'PURCHASE_INVOICE',
            id: inv.id,
            number: inv.invoiceNumber || inv.invoice_number,
            date: inv.invoiceDate || inv.invoice_date,
            amount: parseFloat(inv.grandTotal || inv.grand_total || '0'),
            notes: inv.notes,
          });
        }
      } else if (entry.referenceType === 'PAYMENT') {
        const res = await fetch(`/api/payments/${entry.referenceId}`, {
          headers: {
            Authorization: `Bearer ${getStoredToken()}`,
            'X-Business-Id': currentBusiness?.id || '',
          },
        });
        if (res.ok) {
          const pay = await res.json();
          setDrillDownVoucher({
            type: 'PAYMENT',
            id: pay.id,
            number: pay.paymentNumber,
            date: pay.paymentDate,
            amount: parseFloat(pay.amount),
            notes: pay.notes,
            allocations: pay.allocations,
          });
        }
      } else if (entry.referenceType === 'PURCHASE_RETURN') {
        const res = await fetch(`/api/purchase-returns/${entry.referenceId}`, {
          headers: {
            Authorization: `Bearer ${getStoredToken()}`,
            'X-Business-Id': currentBusiness?.id || '',
          },
        });
        if (res.ok) {
          const ret = await res.json();
          setDrillDownVoucher({
            type: 'PURCHASE_RETURN',
            id: ret.id,
            number: ret.returnNumber,
            date: ret.returnDate,
            amount: parseFloat(ret.grandTotal || '0'),
            notes: ret.notes || ret.reason,
          });
        }
      }
    } catch (err) {
      console.error('Error fetching voucher drill-down:', err);
    } finally {
      setLoadingVoucher(false);
    }
  };

  const filteredParties = parties.filter(p =>
    (p.name || '').toLowerCase().includes(partySearch.toLowerCase()) ||
    (p.partyCode || '').toLowerCase().includes(partySearch.toLowerCase())
  );

  return (
    <div className="space-y-6" id="supplier-ledger-page-root">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Supplier Ledger & Statement of Accounts</h1>
            <p className="text-sm text-slate-500">
              Audit purchase bills, payments, debit notes/returns, opening balances, and chronological running balances.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => selectedPartyId && fetchStatement(selectedPartyId, fromDate, toDate)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
            title="Refresh Ledger"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handlePrint}
            disabled={!selectedParty || entries.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-purple-600 rounded-xl hover:bg-purple-700 disabled:opacity-50 shadow-xs"
          >
            <Printer className="w-4 h-4" />
            Print Statement
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">
          {error}
        </div>
      )}

      {/* Filter Row: Party selector & Date period controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Party Selector */}
        <div className="lg:col-span-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
            Select Supplier Account
          </label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search supplier..."
              value={partySearch}
              onChange={e => setPartySearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20"
            />
          </div>
          <select
            value={selectedPartyId}
            onChange={e => setSelectedPartyId(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500/20 font-medium"
          >
            {filteredParties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.partyCode})
              </option>
            ))}
          </select>

          {selectedParty && (
            <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">GSTIN:</span>
                <span className="font-mono font-medium">{selectedParty.gstin || 'Unregistered'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Phone:</span>
                <span>{selectedParty.phone || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Location:</span>
                <span>{selectedParty.city || '—'}, {selectedParty.state || ''}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Credit Terms:</span>
                <span className="font-semibold text-slate-900">{selectedParty.creditDays || 0} Days</span>
              </div>
            </div>
          )}
        </div>

        {/* Date Filter & Period Selector */}
        <div className="lg:col-span-8 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Period & Date Filters
            </span>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_QUARTER', 'THIS_FY', 'ALL_TIME'] as QuickPeriodKey[]).map(pKey => (
                <button
                  key={pKey}
                  onClick={() => handlePeriodChange(pKey)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                    quickPeriod === pKey
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {pKey.replace('_', ' ')}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => {
                    setFromDate(e.target.value);
                    setQuickPeriod('CUSTOM');
                  }}
                  className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => {
                    setToDate(e.target.value);
                    setQuickPeriod('CUSTOM');
                  }}
                  className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
          </div>

          {/* Quick Summary Cards */}
          {summary && (
            <div className="grid grid-cols-4 gap-2 pt-3 mt-3 border-t border-slate-100 text-center">
              <div className="bg-slate-50 p-2 rounded-xl">
                <span className="block text-[11px] text-slate-400 uppercase font-semibold">Opening Balance</span>
                <span className={`text-sm font-bold font-mono ${summary.openingBalanceDrCr === 'Cr' ? 'text-purple-700' : 'text-emerald-700'}`}>
                  {summary.openingBalanceFormatted}
                </span>
              </div>
              <div className="bg-slate-50 p-2 rounded-xl">
                <span className="block text-[11px] text-slate-400 uppercase font-semibold">Period Debits (Paid/Ret)</span>
                <span className="text-sm font-bold font-mono text-emerald-700">
                  ₹{summary.totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-slate-50 p-2 rounded-xl">
                <span className="block text-[11px] text-slate-400 uppercase font-semibold">Period Credits (Purchases)</span>
                <span className="text-sm font-bold font-mono text-purple-700">
                  ₹{summary.totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-purple-50 border border-purple-100 p-2 rounded-xl">
                <span className="block text-[11px] text-purple-600 uppercase font-semibold">Closing Balance</span>
                <span className={`text-sm font-bold font-mono ${summary.closingBalanceDrCr === 'Cr' ? 'text-purple-800' : 'text-emerald-800'}`}>
                  {summary.closingBalanceFormatted}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ledger Table Container */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden" id="supplier-ledger-printable-table">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">
              {selectedParty ? `${selectedParty.name} Statement` : 'Statement of Account'}
            </h2>
            <span className="text-xs text-slate-400">
              ({fromDate || 'Start'} to {toDate || 'Present'})
            </span>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full">
            {entries.length} Transaction{entries.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 border-collapse">
            <thead className="bg-slate-50/80 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-3">Voucher Type</th>
                <th className="py-3 px-3">Voucher No.</th>
                <th className="py-3 px-4">Reference / Remarks</th>
                <th className="py-3 px-4 text-right">Debit (₹)</th>
                <th className="py-3 px-4 text-right">Credit (₹)</th>
                <th className="py-3 px-4 text-right">Running Balance</th>
                <th className="py-3 px-2 text-center w-12">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Opening Balance Row */}
              {summary && (
                <tr className="bg-amber-50/40 font-medium text-slate-800">
                  <td className="py-2.5 px-4 font-mono text-xs">{fromDate || 'Opening'}</td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
                      OPENING BALANCE
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs text-slate-400">—</td>
                  <td className="py-2.5 px-4 text-xs text-slate-500">
                    Brought forward balance prior to {fromDate || 'selected period'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-400">—</td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-400">—</td>
                  <td className="py-2.5 px-4 text-right font-mono font-bold text-sm">
                    {summary.openingBalanceFormatted}
                  </td>
                  <td className="py-2.5 px-2 text-center text-slate-400">—</td>
                </tr>
              )}

              {/* Transactions */}
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                    Loading statement records...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No transactions found for the selected supplier in this period.
                  </td>
                </tr>
              ) : (
                entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                      {new Date(entry.transactionDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                          entry.voucherType.includes('Bill') || entry.voucherType.includes('Invoice')
                            ? 'bg-purple-100 text-purple-700'
                            : entry.voucherType.includes('Payment')
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {entry.voucherType}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold text-xs text-slate-900">
                      {entry.voucherNumber}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 max-w-xs truncate" title={entry.notes}>
                      {entry.notes || entry.referenceType || '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-emerald-700 font-medium">
                      {entry.debit > 0
                        ? `₹${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-purple-700 font-medium">
                      {entry.credit > 0
                        ? `₹${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-xs text-slate-900">
                      {entry.balanceFormatted}
                    </td>
                    <td className="py-3 px-2 text-center">
                      {entry.referenceId && (
                        <button
                          onClick={() => handleVoucherClick(entry)}
                          className="p-1 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                          title="View Voucher Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}

              {/* Closing Summary Row */}
              {summary && entries.length > 0 && (
                <tr className="bg-slate-100/80 font-bold text-slate-900 border-t-2 border-slate-300">
                  <td colSpan={4} className="py-3 px-4 text-right uppercase tracking-wider text-xs">
                    Period Totals & Closing Balance:
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-emerald-800">
                    ₹{summary.totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-purple-800">
                    ₹{summary.totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm font-black text-purple-950">
                    {summary.closingBalanceFormatted}
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down Voucher Modal */}
      {drillDownVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-slate-900 text-lg">
                  Voucher: {drillDownVoucher.number}
                </h3>
              </div>
              <button
                onClick={() => setDrillDownVoucher(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 p-3 rounded-xl">
                <span className="block text-xs text-slate-400">Voucher Type</span>
                <span className="font-semibold text-slate-800">{drillDownVoucher.type.replace('_', ' ')}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl">
                <span className="block text-xs text-slate-400">Voucher Date</span>
                <span className="font-semibold text-slate-800">
                  {new Date(drillDownVoucher.date).toLocaleDateString('en-IN')}
                </span>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl col-span-2">
                <span className="block text-xs text-slate-400">Total Voucher Amount</span>
                <span className="font-bold font-mono text-lg text-slate-900">
                  ₹{drillDownVoucher.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {drillDownVoucher.notes && (
                <div className="col-span-2 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl">
                  <span className="block text-slate-400 mb-0.5">Notes:</span>
                  {drillDownVoucher.notes}
                </div>
              )}
            </div>

            {drillDownVoucher.allocations && drillDownVoucher.allocations.length > 0 && (
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Payment Allocations ({drillDownVoucher.allocations.length})
                </h4>
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs">
                  {drillDownVoucher.allocations.map((alloc: any, i: number) => (
                    <div key={i} className="p-2.5 flex justify-between items-center">
                      <div>
                        <span className="font-mono font-semibold text-slate-800">{alloc.documentNumber || alloc.documentId}</span>
                        <span className="text-slate-400 ml-2">({alloc.documentType})</span>
                      </div>
                      <span className="font-mono font-bold text-purple-700">
                        ₹{parseFloat(alloc.allocatedAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setDrillDownVoucher(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
