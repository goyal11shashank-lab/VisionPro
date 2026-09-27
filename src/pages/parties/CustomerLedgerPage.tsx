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

export const CustomerLedgerPage: React.FC<{ onNavigate?: (path: string) => void }> = ({ onNavigate }) => {
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

  // Load parties list
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
        const custs = (d.parties || []).filter(
          (p: any) => p.partyType === 'CUSTOMER' || p.partyType === 'BOTH'
        );
        setParties(custs);
        if (custs.length > 0 && !selectedPartyId) {
          setSelectedPartyId(custs[0].id);
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
      params.append('ledgerType', 'CUSTOMER');

      const res = await fetch(`/api/payments/statement/${partyId}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${getStoredToken()}`,
          'X-Business-Id': currentBusiness.id,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to fetch ledger statement');
      }

      const data = await res.json();
      setSelectedParty(data.party);
      setEntries(data.entries || []);
      setSummary(data.summary);
    } catch (err: any) {
      console.error('[CustomerLedger Fetch Error]', err);
      setError(err.message || 'Error loading ledger records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPartyId) {
      fetchStatement(selectedPartyId, fromDate, toDate);
    }
  }, [currentBusiness, selectedPartyId, fromDate, toDate]);

  // Handle Quick Period Change
  const handlePeriodChange = (period: QuickPeriodKey) => {
    setQuickPeriod(period);
    const range = getDateRangeForPeriod(period);
    setFromDate(range.from || '');
    setToDate(range.to || '');
  };

  // Print Statement
  const handlePrint = async () => {
    if (!selectedParty) return;
    try {
      await printDocument({
        elementOrId: 'customer-ledger-printable-content',
        title: `Customer Statement - ${selectedParty.name}`,
        filename: `Statement_${selectedParty.name}_${selectedParty.partyCode}`,
        orientation: 'landscape',
      });
    } catch (err) {
      console.error('Print failed:', err);
    }
  };

  // Voucher drill-down details
  const handleOpenVoucher = async (entry: LedgerEntry) => {
    if (!entry.referenceId || !currentBusiness) return;
    setLoadingVoucher(true);

    try {
      if (entry.referenceType === 'PAYMENT' || entry.transactionType === 'RECEIPT') {
        const res = await fetch(`/api/payments/${entry.referenceId}`, {
          headers: {
            Authorization: `Bearer ${getStoredToken()}`,
            'X-Business-Id': currentBusiness.id,
          },
        });
        if (res.ok) {
          const pay = await res.json();
          setDrillDownVoucher({
            type: 'CUSTOMER_RECEIPT',
            id: pay.id,
            number: pay.paymentNumber,
            date: pay.paymentDate,
            amount: parseFloat(pay.amount),
            notes: pay.notes,
            allocations: pay.allocations || [],
          });
          return;
        }
      }

      // Default fallback info
      setDrillDownVoucher({
        type: entry.voucherType,
        id: entry.referenceId,
        number: entry.voucherNumber,
        date: entry.transactionDate,
        amount: entry.debit > 0 ? entry.debit : entry.credit,
        notes: entry.notes,
      });
    } catch (err) {
      console.error('Error fetching voucher details:', err);
    } finally {
      setLoadingVoucher(false);
    }
  };

  const filteredParties = parties.filter(p =>
    (p.name || '').toLowerCase().includes(partySearch.toLowerCase()) ||
    (p.partyCode || '').toLowerCase().includes(partySearch.toLowerCase()) ||
    (p.mobile || '').includes(partySearch)
  );

  return (
    <div id="customer-ledger-container" className="w-full space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Customer & Sales Ledger</h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Chronological statement with deterministic running balance, opening balance computation, and Dr/Cr presentation.
            </p>
          </div>
        </div>

        {/* Customer Selector */}
        <div className="w-full lg:w-80">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Select Customer
          </label>
          <div className="relative">
            <select
              value={selectedPartyId}
              onChange={e => setSelectedPartyId(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-medium text-slate-900 shadow-2xs"
            >
              {parties.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.partyCode}) {p.city ? `— ${p.city}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Date Period Filters & Actions */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Quick Period Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500 uppercase mr-1">Period:</span>
          {(['THIS_MONTH', 'LAST_MONTH', 'THIS_FY', 'ALL'] as QuickPeriodKey[]).map(pKey => (
            <button
              key={pKey}
              onClick={() => handlePeriodChange(pKey)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                quickPeriod === pKey
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {pKey === 'THIS_MONTH'
                ? 'This Month'
                : pKey === 'LAST_MONTH'
                ? 'Last Month'
                : pKey === 'THIS_FY'
                ? 'This FY (Apr-Mar)'
                : 'All Time'}
            </button>
          ))}
        </div>

        {/* Custom From & To Pickers */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span>From</span>
            <input
              type="date"
              value={fromDate}
              onChange={e => {
                setQuickPeriod('CUSTOM');
                setFromDate(e.target.value);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span>To</span>
            <input
              type="date"
              value={toDate}
              onChange={e => {
                setQuickPeriod('CUSTOM');
                setToDate(e.target.value);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>

          <button
            onClick={() => fetchStatement(selectedPartyId, fromDate, toDate)}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handlePrint}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Statement</span>
          </button>
        </div>
      </div>

      {/* Customer Info Card */}
      {selectedParty && (
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
              {selectedParty.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">{selectedParty.name}</div>
              <div className="text-slate-500 flex items-center gap-2 mt-0.5">
                <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[11px]">
                  {selectedParty.partyCode}
                </span>
                {selectedParty.gstin && (
                  <span>GSTIN: <strong className="font-mono text-slate-700">{selectedParty.gstin}</strong></span>
                )}
                {selectedParty.city && <span>• {selectedParty.city}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {selectedParty.phone && (
              <div className="flex items-center gap-1.5 text-slate-600">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{selectedParty.phone}</span>
              </div>
            )}
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Credit Terms</span>
              <span className="font-medium text-slate-700">{selectedParty.creditDays || 0} Days</span>
            </div>
            {selectedParty.creditLimit !== undefined && selectedParty.creditLimit > 0 && (
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Credit Limit</span>
                <span className="font-semibold text-slate-900 font-mono">
                  ₹{selectedParty.creditLimit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Balance Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Opening Balance */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>Opening Balance</span>
              <span className="text-[10px] font-mono text-slate-400 font-normal">
                {fromDate ? `Before ${new Date(fromDate).toLocaleDateString()}` : 'Initial'}
              </span>
            </div>
            <div className="text-lg font-bold text-slate-900 font-mono mt-1.5 flex items-baseline gap-1.5">
              <span>₹{summary.openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                summary.openingBalanceDrCr === 'Dr' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
              }`}>
                {summary.openingBalanceDrCr}
              </span>
            </div>
          </div>

          {/* 2. Total Invoiced (Debits) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>Period Invoiced (Dr)</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="text-lg font-bold text-blue-700 font-mono mt-1.5">
              ₹{summary.totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>

          {/* 3. Total Received / Returns (Credits) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
              <span>Period Receipts/Cr (Cr)</span>
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-lg font-bold text-emerald-700 font-mono mt-1.5">
              ₹{summary.totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>

          {/* 4. Net Closing Balance */}
          <div className={`p-4 rounded-xl border shadow-xs ${
            summary.closingBalanceDrCr === 'Dr'
              ? 'bg-blue-50/70 border-blue-200 text-blue-900'
              : 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
          }`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between">
              <span>Closing Balance</span>
              <span className="text-[10px] font-mono">
                {toDate ? `As of ${new Date(toDate).toLocaleDateString()}` : 'Current'}
              </span>
            </div>
            <div className="text-xl font-bold font-mono mt-1 flex items-baseline gap-1.5">
              <span>₹{summary.closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                summary.closingBalanceDrCr === 'Dr' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
              }`}>
                {summary.closingBalanceDrCr === 'Dr' ? 'Dr (Receivable)' : 'Cr (Advance)'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Printable Area Wrapper */}
      <div id="customer-ledger-printable-content" className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-slate-400">Loading customer ledger records...</div>
        ) : error ? (
          <div className="p-12 text-center text-rose-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5">Date</th>
                  <th className="py-3 px-3">Voucher Type</th>
                  <th className="py-3 px-3">Voucher No.</th>
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-3.5 text-right">Debit (₹)</th>
                  <th className="py-3 px-3.5 text-right">Credit (₹)</th>
                  <th className="py-3 px-3.5 text-right">Running Balance</th>
                  <th className="py-3 px-4">Remarks / Notes</th>
                  <th className="py-3 px-3 text-center no-print">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {/* Opening Balance Row */}
                {summary && (
                  <tr className="bg-slate-50/70 font-semibold text-slate-700">
                    <td className="py-3 px-3.5 font-mono text-[11px]">
                      {fromDate ? new Date(fromDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-200 text-slate-800">
                        OPENING BALANCE
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">—</td>
                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                      {fromDate ? `Brought forward before ${new Date(fromDate).toLocaleDateString()}` : 'Opening'}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono">
                      {summary.openingBalanceDrCr === 'Dr' && summary.openingBalance > 0
                        ? `₹${summary.openingBalance.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono">
                      {summary.openingBalanceDrCr === 'Cr' && summary.openingBalance > 0
                        ? `₹${summary.openingBalance.toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                      {summary.openingBalanceFormatted}
                    </td>
                    <td className="py-3 px-4 text-slate-400 italic">Pre-period accumulated balance</td>
                    <td className="py-3 px-3 text-center no-print text-slate-300">—</td>
                  </tr>
                )}

                {/* Period Transactions */}
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No transactions recorded for this customer in the selected date period.
                    </td>
                  </tr>
                ) : (
                  entries.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3.5 font-mono text-slate-600 text-[11px] whitespace-nowrap">
                        {new Date(row.transactionDate).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                            row.transactionType === 'SALE'
                              ? 'bg-blue-50 text-blue-700 border border-blue-100'
                              : row.transactionType === 'RECEIPT' || row.transactionType === 'PAYMENT_RECEIVED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                              : row.transactionType === 'SALES_RETURN' || row.transactionType === 'CREDIT_NOTE'
                              ? 'bg-amber-50 text-amber-700 border border-amber-100'
                              : row.transactionType === 'CANCELLATION_REVERSAL'
                              ? 'bg-purple-50 text-purple-700 border border-purple-100'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {row.voucherType}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {row.voucherNumber}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {row.referenceType || '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono font-medium text-slate-900 whitespace-nowrap">
                        {row.debit > 0 ? `₹${row.debit.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono font-medium text-emerald-700 whitespace-nowrap">
                        {row.credit > 0 ? `₹${row.credit.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono font-bold whitespace-nowrap">
                        <span className={row.balanceDrCr === 'Dr' ? 'text-slate-900' : 'text-emerald-700'}>
                          ₹{row.balance.toFixed(2)}{' '}
                          <span className="text-[10px] font-semibold uppercase">{row.balanceDrCr}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 text-[11px] max-w-xs truncate" title={row.notes}>
                        {row.notes || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center no-print whitespace-nowrap">
                        <button
                          onClick={() => handleOpenVoucher(row)}
                          className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="View Voucher Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}

                {/* Closing Balance Row */}
                {summary && entries.length > 0 && (
                  <tr className="bg-slate-50 font-bold border-t-2 border-slate-300 text-slate-900">
                    <td className="py-3 px-3.5 font-mono text-[11px]">
                      {toDate ? new Date(toDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-900 text-white">
                        CLOSING BALANCE
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">—</td>
                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                      Period Net Change: {summary.netPeriodChange >= 0 ? `+₹${summary.netPeriodChange.toFixed(2)}` : `-₹${Math.abs(summary.netPeriodChange).toFixed(2)}`}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono text-blue-700">
                      ₹{summary.totalDebit.toFixed(2)}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono text-emerald-700">
                      ₹{summary.totalCredit.toFixed(2)}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono text-base font-extrabold text-blue-900">
                      {summary.closingBalanceFormatted}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-medium">
                      Total records: {summary.recordsCount}
                    </td>
                    <td className="py-3 px-3 text-center no-print">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Voucher Detail Modal */}
      {drillDownVoucher && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900">Voucher Details</h3>
              </div>
              <button
                onClick={() => setDrillDownVoucher(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Voucher Type</span>
                  <span className="font-bold text-slate-800 text-sm">{drillDownVoucher.type}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Voucher No.</span>
                  <span className="font-bold text-blue-700 font-mono text-sm">{drillDownVoucher.number}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Date</span>
                  <span className="font-mono text-slate-700">{new Date(drillDownVoucher.date).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Voucher Amount</span>
                  <span className="font-bold text-slate-900 font-mono text-sm">₹{drillDownVoucher.amount.toFixed(2)}</span>
                </div>
              </div>

              {drillDownVoucher.notes && (
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold mb-1">Remarks / Notes</span>
                  <p className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-slate-700">{drillDownVoucher.notes}</p>
                </div>
              )}

              {/* Linked Allocations */}
              {drillDownVoucher.allocations && drillDownVoucher.allocations.length > 0 && (
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold mb-1">
                    Invoice Allocations ({drillDownVoucher.allocations.length})
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {drillDownVoucher.allocations.map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <div>
                          <span className="font-mono font-semibold text-slate-800">{a.documentNumber || a.documentId}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{a.documentType}</span>
                        </div>
                        <span className="font-bold font-mono text-emerald-700">₹{parseFloat(a.allocatedAmount).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setDrillDownVoucher(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50"
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
