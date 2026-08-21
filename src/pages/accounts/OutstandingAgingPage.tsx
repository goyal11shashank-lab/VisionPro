import React, { useState, useEffect } from 'react';
import {
  Clock,
  Search,
  Filter,
  Eye,
  ArrowDownLeft,
  ArrowUpRight,
  Printer,
  Calendar,
  Building2,
  Users,
  AlertTriangle,
  FileText,
  DollarSign,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface OutstandingCustomer {
  partyId: string;
  partyName: string;
  partyPhone?: string;
  partyCity?: string;
  creditLimit?: number;
  creditDays?: number;
  totalBalance: number;
  aging: {
    bucket0To30: number;
    bucket31To60: number;
    bucket61To90: number;
    bucketOver90: number;
  };
  unpaidInvoicesCount: number;
}

interface OutstandingSupplier {
  partyId: string;
  partyName: string;
  partyPhone?: string;
  partyCity?: string;
  totalBalance: number;
  aging: {
    bucket0To30: number;
    bucket31To60: number;
    bucket61To90: number;
    bucketOver90: number;
  };
  unpaidInvoicesCount: number;
}

interface StatementEntry {
  id: string;
  transactionDate: string;
  transactionType: string;
  referenceType?: string;
  referenceId?: string;
  debit: number;
  credit: number;
  balance: number;
  notes?: string;
}

interface PartyStatement {
  party: {
    id: string;
    name: string;
    partyType: string;
    phone?: string;
    email?: string;
    city?: string;
    state?: string;
    gstin?: string;
    currentBalance: number;
  };
  openingBalance: number;
  closingBalance: number;
  entries: StatementEntry[];
}

export const OutstandingAgingPage: React.FC<{ onNavigate?: (path: string) => void }> = ({ onNavigate }) => {
  const { currentBusiness } = useAuth();

  const [activeTab, setActiveTab] = useState<'CUSTOMERS' | 'SUPPLIERS'>('CUSTOMERS');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [customers, setCustomers] = useState<OutstandingCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<OutstandingSupplier[]>([]);

  // Detailed Ledger Statement Modal
  const [statementPartyId, setStatementPartyId] = useState<string | null>(null);
  const [statementData, setStatementData] = useState<PartyStatement | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [statementFromDate, setStatementFromDate] = useState('');
  const [statementToDate, setStatementToDate] = useState('');

  // Fetch Outstandings
  const fetchOutstandings = async () => {
    if (!currentBusiness) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);

      if (activeTab === 'CUSTOMERS') {
        const res = await fetch(`/api/payments/outstanding/customers?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'X-Business-Id': currentBusiness.id,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setCustomers(data.customers || []);
        }
      } else {
        const res = await fetch(`/api/payments/outstanding/suppliers?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'X-Business-Id': currentBusiness.id,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setSuppliers(data.suppliers || []);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutstandings();
  }, [currentBusiness, activeTab, search]);

  // Fetch Party Statement
  const handleOpenStatement = async (partyId: string) => {
    if (!currentBusiness) return;
    try {
      setStatementPartyId(partyId);
      setLoadingStatement(true);

      const params = new URLSearchParams();
      if (statementFromDate) params.append('fromDate', statementFromDate);
      if (statementToDate) params.append('toDate', statementToDate);

      const res = await fetch(`/api/payments/statement/${partyId}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setStatementData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStatement(false);
    }
  };

  // Re-fetch statement if date range changes
  useEffect(() => {
    if (statementPartyId) {
      handleOpenStatement(statementPartyId);
    }
  }, [statementFromDate, statementToDate]);

  // Aggregate Totals
  const totalReceivables = customers.reduce((sum, c) => sum + (c.totalBalance > 0 ? c.totalBalance : 0), 0);
  const totalPayables = suppliers.reduce((sum, s) => sum + (s.totalBalance > 0 ? s.totalBalance : 0), 0);

  const totalOverdueCustomers = customers.reduce(
    (sum, c) => sum + (c.aging.bucket31To60 + c.aging.bucket61To90 + c.aging.bucketOver90),
    0
  );
  const totalOverdueSuppliers = suppliers.reduce(
    (sum, s) => sum + (s.aging.bucket31To60 + s.aging.bucket61To90 + s.aging.bucketOver90),
    0
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Clock className="w-6 h-6" />
            </div>
            Outstanding Aging & Receivables / Payables
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time aging analysis across 0–30, 31–60, 61–90 and 90+ days aging buckets with running ledger statements.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('CUSTOMERS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'CUSTOMERS'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-4 h-4 text-emerald-600" />
            Customer Receivables
          </button>
          <button
            onClick={() => setActiveTab('SUPPLIERS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'SUPPLIERS'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Building2 className="w-4 h-4 text-blue-600" />
            Supplier Payables
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {activeTab === 'CUSTOMERS' ? 'Total Receivables (Due)' : 'Total Payables (Due)'}
            </span>
            <div
              className={`p-2 rounded-xl ${
                activeTab === 'CUSTOMERS' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
              }`}
            >
              {activeTab === 'CUSTOMERS' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">
              ₹
              {(activeTab === 'CUSTOMERS' ? totalReceivables : totalPayables).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <p className="text-xs text-slate-400 mt-1">
              Active ledger balance across all {activeTab === 'CUSTOMERS' ? 'customers' : 'vendors'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Overdue &gt; 30 Days
            </span>
            <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-rose-600">
              ₹
              {(activeTab === 'CUSTOMERS' ? totalOverdueCustomers : totalOverdueSuppliers).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <p className="text-xs text-slate-400 mt-1">
              Requires immediate collection / payment follow-up
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Accounts with Balances
            </span>
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">
              {activeTab === 'CUSTOMERS'
                ? customers.filter(c => Math.abs(c.totalBalance) > 0).length
                : suppliers.filter(s => Math.abs(s.totalBalance) > 0).length}
            </span>
            <p className="text-xs text-slate-400 mt-1">
              Active party accounts with open debit/credit lines
            </p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col md:flex-row gap-3 justify-between items-center">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={`Search ${activeTab === 'CUSTOMERS' ? 'customer' : 'supplier'} name, city, phone...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9.5 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Aging Analysis Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200/80">
              <tr>
                <th className="px-5 py-3.5">Party Name</th>
                <th className="px-5 py-3.5 text-right">Total Due (₹)</th>
                <th className="px-4 py-3.5 text-right text-emerald-700 bg-emerald-50/40">0–30 Days</th>
                <th className="px-4 py-3.5 text-right text-amber-700 bg-amber-50/40">31–60 Days</th>
                <th className="px-4 py-3.5 text-right text-orange-700 bg-orange-50/40">61–90 Days</th>
                <th className="px-4 py-3.5 text-right text-rose-700 bg-rose-50/40">&gt; 90 Days</th>
                <th className="px-4 py-3.5 text-center">Unpaid Bills</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                    Calculating real-time aging balances...
                  </td>
                </tr>
              ) : activeTab === 'CUSTOMERS' ? (
                customers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                      No customer receivables found.
                    </td>
                  </tr>
                ) : (
                  customers.map(c => {
                    const isCreditOverdue = c.creditLimit && c.totalBalance > c.creditLimit;

                    return (
                      <tr key={c.partyId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-4">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            {c.partyName}
                            {isCreditOverdue && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">
                                Over Credit Limit
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400">
                            {c.partyCity || 'India'} {c.partyPhone && `• ${c.partyPhone}`}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right font-bold text-slate-900">
                          ₹{c.totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-4 text-right font-medium text-emerald-700 bg-emerald-50/20">
                          {c.aging.bucket0To30 > 0
                            ? `₹${c.aging.bucket0To30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                        <td className="px-4 py-4 text-right font-medium text-amber-700 bg-amber-50/20">
                          {c.aging.bucket31To60 > 0
                            ? `₹${c.aging.bucket31To60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                        <td className="px-4 py-4 text-right font-medium text-orange-700 bg-orange-50/20">
                          {c.aging.bucket61To90 > 0
                            ? `₹${c.aging.bucket61To90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                        <td className="px-4 py-4 text-right font-bold text-rose-700 bg-rose-50/20">
                          {c.aging.bucketOver90 > 0
                            ? `₹${c.aging.bucketOver90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                            : '-'}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                            {c.unpaidInvoicesCount} Invoices
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleOpenStatement(c.partyId)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold border border-indigo-200 transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              Statement
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )
              ) : suppliers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                    No supplier payables found.
                  </td>
                </tr>
              ) : (
                suppliers.map(s => (
                  <tr key={s.partyId} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{s.partyName}</div>
                      <div className="text-xs text-slate-400">
                        {s.partyCity || 'India'} {s.partyPhone && `• ${s.partyPhone}`}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-slate-900">
                      ₹{s.totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-emerald-700 bg-emerald-50/20">
                      {s.aging.bucket0To30 > 0
                        ? `₹${s.aging.bucket0To30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '-'}
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-amber-700 bg-amber-50/20">
                      {s.aging.bucket31To60 > 0
                        ? `₹${s.aging.bucket31To60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '-'}
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-orange-700 bg-orange-50/20">
                      {s.aging.bucket61To90 > 0
                        ? `₹${s.aging.bucket61To90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '-'}
                    </td>
                    <td className="px-4 py-4 text-right font-bold text-rose-700 bg-rose-50/20">
                      {s.aging.bucketOver90 > 0
                        ? `₹${s.aging.bucketOver90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                        : '-'}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                        {s.unpaidInvoicesCount} Bills
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenStatement(s.partyId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold border border-indigo-200 transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Statement
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAILED PARTY STATEMENT MODAL */}
      {statementPartyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full border border-slate-200 shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Party Account Statement: {statementData?.party.name || 'Loading...'}
                  </h3>
                  <p className="text-xs text-slate-500">Chronological transaction register with running balance</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setStatementPartyId(null);
                  setStatementData(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Date Filters & Header Details */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs space-y-0.5">
                  <div className="font-bold text-slate-900 text-sm">{statementData?.party.name}</div>
                  <div className="text-slate-500">
                    {statementData?.party.city || 'India'} {statementData?.party.phone && `• ${statementData?.party.phone}`}
                  </div>
                  {statementData?.party.gstin && (
                    <div className="text-slate-400 font-mono">GSTIN: {statementData.party.gstin}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-500 block">From Date</label>
                    <input
                      type="date"
                      value={statementFromDate}
                      onChange={e => setStatementFromDate(e.target.value)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-500 block">To Date</label>
                    <input
                      type="date"
                      value={statementToDate}
                      onChange={e => setStatementToDate(e.target.value)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Statement Balances Summary */}
              {statementData && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider block">Opening Balance</span>
                    <span className="text-base font-bold text-slate-800">
                      ₹{statementData.openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider block">Current Ledger Balance</span>
                    <span className="text-base font-bold text-indigo-600">
                      ₹{statementData.party.currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 col-span-2 sm:col-span-1">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wider block">Closing Period Balance</span>
                    <span className="text-base font-bold text-slate-900">
                      ₹{statementData.closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}

              {/* Transactions Ledger Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Type & Reference</th>
                      <th className="px-3 py-2.5 text-right text-rose-700">Debit (₹)</th>
                      <th className="px-3 py-2.5 text-right text-emerald-700">Credit (₹)</th>
                      <th className="px-3 py-2.5 text-right font-bold">Running Balance (₹)</th>
                      <th className="px-3 py-2.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {loadingStatement ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          Fetching statement ledger...
                        </td>
                      </tr>
                    ) : !statementData || statementData.entries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          No ledger transactions found in selected date range.
                        </td>
                      </tr>
                    ) : (
                      statementData.entries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-700">
                            {new Date(e.transactionDate).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900">
                            {e.transactionType}
                            {e.referenceType && (
                              <span className="text-[11px] text-slate-400 font-normal block">
                                Ref: {e.referenceType}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-rose-600">
                            {e.debit > 0 ? `₹${e.debit.toFixed(2)}` : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-emerald-600">
                            {e.credit > 0 ? `₹${e.credit.toFixed(2)}` : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">
                            ₹{e.balance.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-slate-400 truncate max-w-xs">{e.notes || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Print Statement
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStatementPartyId(null);
                    setStatementData(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
