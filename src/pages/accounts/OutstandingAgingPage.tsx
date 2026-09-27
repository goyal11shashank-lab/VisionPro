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
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { getStoredToken } from '../../api/client.js';
import { printDocument } from '../../utils/printService.js';

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

interface InvoiceWiseOutstanding {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  creditDays: number;
  partyId: string;
  partyCode: string;
  partyName: string;
  partyPhone?: string;
  partyCity?: string;
  invoiceAmount: number;
  paidAmount: number;
  returnedAmount: number;
  paidOrAdjustedAmount: number;
  outstandingAmount: number;
  overdueDays: number;
  isOverdue: boolean;
  agingBucket: string;
  paymentStatus: string;
}

interface StatementEntry {
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
  balanceDrCr: string;
  balanceFormatted: string;
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
  };
  openingBalance: number;
  openingBalanceFormatted: string;
  closingBalance: number;
  closingBalanceFormatted: string;
  entries: StatementEntry[];
}

export const OutstandingAgingPage: React.FC<{ onNavigate?: (path: string) => void }> = ({ onNavigate }) => {
  const { currentBusiness } = useAuth();

  const [activeTab, setActiveTab] = useState<'CUSTOMERS' | 'SUPPLIERS'>('CUSTOMERS');
  const [viewMode, setViewMode] = useState<'SUMMARY' | 'INVOICES' | 'RECONCILIATION'>('SUMMARY');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNPAID' | 'PARTIAL' | 'OVERDUE'>('ALL');
  const [asOfDate, setAsOfDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Summaries
  const [customers, setCustomers] = useState<OutstandingCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<OutstandingSupplier[]>([]);

  // Invoice-wise
  const [invoiceBills, setInvoiceBills] = useState<InvoiceWiseOutstanding[]>([]);

  // Reconciliation diagnostics
  const [reconData, setReconData] = useState<any>(null);
  const [loadingRecon, setLoadingRecon] = useState(false);

  // Detailed Ledger Statement Modal
  const [statementPartyId, setStatementPartyId] = useState<string | null>(null);
  const [statementData, setStatementData] = useState<PartyStatement | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [statementFromDate, setStatementFromDate] = useState('');
  const [statementToDate, setStatementToDate] = useState('');
  const [isPrintingStatement, setIsPrintingStatement] = useState(false);

  const handlePrintStatement = async () => {
    if (!statementData) return;
    setIsPrintingStatement(true);
    try {
      await printDocument({
        elementOrId: 'party-statement-printable-content',
        title: `Account Statement - ${statementData.party?.name || 'Party'}`,
        filename: `Statement_${statementData.party?.name || 'Party'}`,
        orientation: 'landscape',
      });
    } catch (err) {
      console.error('Print statement failed:', err);
    } finally {
      setIsPrintingStatement(false);
    }
  };

  // Fetch Outstandings (Summary or Invoice-wise)
  const fetchOutstandings = async () => {
    if (!currentBusiness) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (asOfDate) params.append('asOfDate', asOfDate);

      if (viewMode === 'SUMMARY') {
        if (activeTab === 'CUSTOMERS') {
          const res = await fetch(`/api/payments/outstanding/customers?${params.toString()}`, {
            headers: {
              Authorization: `Bearer ${getStoredToken()}`,
              'X-Business-Id': currentBusiness.id,
            },
          });
          if (res.ok) {
            const data = await res.json();
            setCustomers(data.customers || (Array.isArray(data) ? data : data.data || []));
          }
        } else {
          const res = await fetch(`/api/payments/outstanding/suppliers?${params.toString()}`, {
            headers: {
              Authorization: `Bearer ${getStoredToken()}`,
              'X-Business-Id': currentBusiness.id,
            },
          });
          if (res.ok) {
            const data = await res.json();
            setSuppliers(data.suppliers || (Array.isArray(data) ? data : data.data || []));
          }
        }
      } else if (viewMode === 'INVOICES') {
        if (statusFilter !== 'ALL') params.append('status', statusFilter);
        const endpoint =
          activeTab === 'CUSTOMERS'
            ? `/api/payments/outstanding/invoices/customers?${params.toString()}`
            : `/api/payments/outstanding/invoices/suppliers?${params.toString()}`;

        const res = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${getStoredToken()}`,
            'X-Business-Id': currentBusiness.id,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setInvoiceBills(data.invoices || data.bills || data.data || []);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Reconciliation Diagnostics
  const fetchReconciliation = async () => {
    if (!currentBusiness) return;
    setLoadingRecon(true);
    try {
      const res = await fetch('/api/payments/reconciliation', {
        headers: {
          Authorization: `Bearer ${getStoredToken()}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setReconData(data);
      }
    } catch (err) {
      console.error('Reconciliation error:', err);
    } finally {
      setLoadingRecon(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'RECONCILIATION') {
      fetchReconciliation();
    } else {
      fetchOutstandings();
    }
  }, [currentBusiness, activeTab, viewMode, statusFilter, asOfDate, search]);

  // Fetch Party Statement
  const handleOpenStatement = async (partyId: string) => {
    if (!currentBusiness) return;
    try {
      setStatementPartyId(partyId);
      setLoadingStatement(true);

      const params = new URLSearchParams();
      if (statementFromDate) params.append('fromDate', statementFromDate);
      if (statementToDate) params.append('toDate', statementToDate);
      params.append('ledgerType', activeTab === 'CUSTOMERS' ? 'CUSTOMER' : 'SUPPLIER');

      const res = await fetch(`/api/payments/statement/${partyId}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${getStoredToken()}`,
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

  useEffect(() => {
    if (statementPartyId) {
      handleOpenStatement(statementPartyId);
    }
  }, [statementFromDate, statementToDate]);

  // Aggregate Totals
  const totalReceivables = customers.reduce((sum, c) => sum + (c.totalBalance > 0 ? c.totalBalance : 0), 0);
  const totalPayables = suppliers.reduce((sum, s) => sum + (s.totalBalance > 0 ? s.totalBalance : 0), 0);

  const totalOverdueCustomers = customers.reduce(
    (sum, c) => sum + ((c.aging?.bucket31To60 || 0) + (c.aging?.bucket61To90 || 0) + (c.aging?.bucketOver90 || 0)),
    0
  );
  const totalOverdueSuppliers = suppliers.reduce(
    (sum, s) => sum + ((s.aging?.bucket31To60 || 0) + (s.aging?.bucket61To90 || 0) + (s.aging?.bucketOver90 || 0)),
    0
  );

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Clock className="w-6 h-6" />
            </div>
            Outstanding & Accounting Reconciliation
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative receivables, payables, aging buckets, invoice-wise tracking, returns adjustment, and ledger reconciliation.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('SUMMARY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'SUMMARY' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Party Aging Summary
            </button>
            <button
              onClick={() => setViewMode('INVOICES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'INVOICES' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Invoice-Wise Breakdown
            </button>
            <button
              onClick={() => setViewMode('RECONCILIATION')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                viewMode === 'RECONCILIATION'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-purple-700 hover:text-purple-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Reconciliation
            </button>
          </div>

          {/* Party Type Toggle */}
          {viewMode !== 'RECONCILIATION' && (
            <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                onClick={() => setActiveTab('CUSTOMERS')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'CUSTOMERS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-emerald-600" />
                Customers
              </button>
              <button
                onClick={() => setActiveTab('SUPPLIERS')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'SUPPLIERS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                Suppliers
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SUMMARY METRICS CARDS */}
      {viewMode !== 'RECONCILIATION' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {activeTab === 'CUSTOMERS' ? 'Total Receivables' : 'Total Payables'}
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
                Active ledger balance across all {activeTab === 'CUSTOMERS' ? 'customers' : 'suppliers'}
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
                Requires follow-up based on contractual credit terms
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Historical As-Of Date
              </span>
              <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                <Calendar className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-2">
              <input
                type="date"
                value={asOfDate}
                onChange={e => setAsOfDate(e.target.value)}
                className="w-full text-sm font-semibold font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5"
              />
              <p className="text-xs text-slate-400 mt-1">
                Calculates historical outstanding strictly up to this date
              </p>
            </div>
          </div>
        </div>
      )}

      {/* FILTER BAR FOR INVOICE-WISE & SUMMARY */}
      {viewMode !== 'RECONCILIATION' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col md:flex-row gap-3 justify-between items-center">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${activeTab === 'CUSTOMERS' ? 'customer' : 'supplier'}, invoice no, city...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9.5 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {viewMode === 'INVOICES' && (
            <div className="flex items-center gap-1.5 self-start md:self-auto">
              <span className="text-xs text-slate-400 font-medium">Status:</span>
              {(['ALL', 'UNPAID', 'PARTIAL', 'OVERDUE'] as const).map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    statusFilter === st ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 1: PARTY AGING SUMMARY */}
      {viewMode === 'SUMMARY' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200/80">
                <tr>
                  <th className="px-5 py-3.5">Party Name</th>
                  <th className="px-5 py-3.5 text-right">Total Outstanding (₹)</th>
                  <th className="px-4 py-3.5 text-right text-emerald-700 bg-emerald-50/40">0–30 Days</th>
                  <th className="px-4 py-3.5 text-right text-amber-700 bg-amber-50/40">31–60 Days</th>
                  <th className="px-4 py-3.5 text-right text-orange-700 bg-orange-50/40">61–90 Days</th>
                  <th className="px-4 py-3.5 text-right text-rose-700 bg-rose-50/40">&gt; 90 Days</th>
                  <th className="px-4 py-3.5 text-center">Unpaid Vouchers</th>
                  <th className="px-5 py-3.5 text-right">Statement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                      Calculating real-time aging balances as of {asOfDate}...
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
                            <button
                              onClick={() => handleOpenStatement(c.partyId)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold border border-indigo-200 transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              Statement
                            </button>
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
                        <button
                          onClick={() => handleOpenStatement(s.partyId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold border border-indigo-200 transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Statement
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 2: INVOICE-WISE DETAILED REPORT */}
      {viewMode === 'INVOICES' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm">
              {activeTab === 'CUSTOMERS' ? 'Invoice-Wise Receivables Ledger' : 'Bill-Wise Payables Ledger'}
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              Showing {invoiceBills.length} document{invoiceBills.length !== 1 ? 's' : ''} (As of {asOfDate})
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200/80">
                <tr>
                  <th className="py-3 px-4">{activeTab === 'CUSTOMERS' ? 'Customer' : 'Supplier'}</th>
                  <th className="py-3 px-3">Invoice No.</th>
                  <th className="py-3 px-3">Invoice Date</th>
                  <th className="py-3 px-3">Due Date</th>
                  <th className="py-3 px-4 text-right">Invoice Amount (₹)</th>
                  <th className="py-3 px-4 text-right">Paid / Adjusted (₹)</th>
                  <th className="py-3 px-4 text-right">Outstanding (₹)</th>
                  <th className="py-3 px-3 text-center">Overdue Days</th>
                  <th className="py-3 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      Loading invoice-wise outstanding records...
                    </td>
                  </tr>
                ) : invoiceBills.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No invoices found matching criteria.
                    </td>
                  </tr>
                ) : (
                  invoiceBills.map(inv => (
                    <tr key={inv.invoiceId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 text-xs">{inv.partyName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{inv.partyCode}</div>
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-xs text-slate-800">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-600">
                        {new Date(inv.invoiceDate).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-600">
                        {new Date(inv.dueDate).toLocaleDateString('en-IN')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900">
                        ₹{inv.invoiceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-emerald-700">
                        ₹{inv.paidOrAdjustedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        {inv.returnedAmount > 0 && (
                          <span className="block text-[10px] text-slate-400">
                            (Ret: ₹{inv.returnedAmount.toFixed(2)})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-bold text-rose-700">
                        ₹{inv.outstandingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-xs">
                        {inv.overdueDays > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                            {inv.overdueDays}d overdue
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            Not Due
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            inv.paymentStatus === 'PAID'
                              ? 'bg-emerald-100 text-emerald-800'
                              : inv.paymentStatus === 'PARTIAL'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {inv.paymentStatus}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: ACCOUNTING RECONCILIATION DIAGNOSTICS */}
      {viewMode === 'RECONCILIATION' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Accounting Reconciliation Diagnostics Engine
                  </h2>
                  <p className="text-xs text-slate-500">
                    Performs end-to-end integrity audit across Party Ledgers, Invoice Payment Statuses, Returns Adjustments, and Allocation Bounds.
                  </p>
                </div>
              </div>
              <button
                onClick={fetchReconciliation}
                disabled={loadingRecon}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-700 disabled:opacity-50 shadow-xs"
              >
                <RefreshCw className={`w-4 h-4 ${loadingRecon ? 'animate-spin' : ''}`} />
                Run Audit Now
              </button>
            </div>

            {loadingRecon ? (
              <div className="py-12 text-center text-slate-400">
                <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2 text-purple-600" />
                Auditing accounting ledgers, invoices, returns, and payment allocations...
              </div>
            ) : reconData ? (
              <div className="pt-4 space-y-4">
                {/* Status banner */}
                <div
                  className={`p-4 rounded-xl border flex items-center gap-3 ${
                    reconData.summary?.isFullyReconciled
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  {reconData.summary?.isFullyReconciled ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
                  )}
                  <div>
                    <h3 className="font-bold text-sm">
                      {reconData.summary?.isFullyReconciled
                        ? '100% Reconciled: Zero Accounting Discrepancies Found'
                        : 'Action Needed: Ledger / Allocation Discrepancies Detected'}
                    </h3>
                    <p className="text-xs opacity-90 mt-0.5">
                      {reconData.summary?.isFullyReconciled
                        ? `All ${reconData.summary.totalPartiesChecked} party ledgers, ${reconData.summary.totalInvoicesChecked} invoices, and ${reconData.summary.totalPaymentsChecked} payment allocations match calculated ground truth.`
                        : 'Some ledger balances or invoice payment statuses require recalculation.'}
                    </p>
                  </div>
                </div>

                {/* Audit Metrics */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <span className="block text-xs text-slate-500 font-semibold uppercase">Party Ledgers</span>
                    <span className="text-xl font-bold text-slate-900">
                      {reconData.summary?.totalPartiesChecked || 0} Checked
                    </span>
                    <span className="block text-xs text-emerald-700 font-medium mt-1">
                      {reconData.summary?.discrepantPartiesCount === 0 ? '✓ All Balanced' : `${reconData.summary?.discrepantPartiesCount} Discrepant`}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <span className="block text-xs text-slate-500 font-semibold uppercase">Invoices & Bills</span>
                    <span className="text-xl font-bold text-slate-900">
                      {reconData.summary?.totalInvoicesChecked || 0} Checked
                    </span>
                    <span className="block text-xs text-emerald-700 font-medium mt-1">
                      {reconData.summary?.invoiceDiscrepanciesCount === 0 ? '✓ 100% Status Accuracy' : `${reconData.summary?.invoiceDiscrepanciesCount} Mismatched`}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <span className="block text-xs text-slate-500 font-semibold uppercase">Payment Allocations</span>
                    <span className="text-xl font-bold text-slate-900">
                      {reconData.summary?.totalPaymentsChecked || 0} Checked
                    </span>
                    <span className="block text-xs text-emerald-700 font-medium mt-1">
                      {reconData.summary?.paymentDiscrepanciesCount === 0 ? '✓ Zero Over-Allocation' : `${reconData.summary?.paymentDiscrepanciesCount} Discrepant`}
                    </span>
                  </div>
                </div>

                {/* Issues List (if any) */}
                {(!reconData.summary?.isFullyReconciled) && (
                  <div className="space-y-2 pt-2">
                    <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                      Identified Discrepancies
                    </h4>
                    <div className="space-y-2">
                      {reconData.partyDiscrepancies?.map((d: any, idx: number) => (
                        <div key={idx} className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
                          <strong>Party {d.partyName}:</strong> {d.issue}
                        </div>
                      ))}
                      {reconData.invoiceDiscrepancies?.map((d: any, idx: number) => (
                        <div key={idx} className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                          <strong>Invoice {d.invoiceNumber}:</strong> {d.issue}
                        </div>
                      ))}
                      {reconData.paymentDiscrepancies?.map((d: any, idx: number) => (
                        <div key={idx} className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
                          <strong>Payment {d.paymentNumber}:</strong> {d.issue}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* DETAILED PARTY STATEMENT MODAL */}
      {statementPartyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-lg">
                  {statementData?.party?.name || 'Party'} Statement of Account
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrintStatement}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 flex items-center gap-1.5 shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
                <button
                  onClick={() => setStatementPartyId(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Date filter inside modal */}
            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">From Date</label>
                <input
                  type="date"
                  value={statementFromDate}
                  onChange={e => setStatementFromDate(e.target.value)}
                  className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">To Date</label>
                <input
                  type="date"
                  value={statementToDate}
                  onChange={e => setStatementToDate(e.target.value)}
                  className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>

            {loadingStatement ? (
              <div className="py-12 text-center text-slate-400">
                <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                Loading statement entries...
              </div>
            ) : statementData ? (
              <div className="space-y-4" id="party-statement-printable-content">
                {/* Statement table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs text-slate-600 border-collapse">
                    <thead className="bg-slate-100/80 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Voucher Type</th>
                        <th className="py-2.5 px-3">Voucher No.</th>
                        <th className="py-2.5 px-3 text-right">Debit (₹)</th>
                        <th className="py-2.5 px-3 text-right">Credit (₹)</th>
                        <th className="py-2.5 px-3 text-right">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr className="bg-amber-50/50 font-semibold text-slate-800">
                        <td className="py-2 px-3 font-mono">{statementFromDate || 'Opening'}</td>
                        <td className="py-2 px-3">OPENING BALANCE</td>
                        <td className="py-2 px-3">—</td>
                        <td className="py-2 px-3 text-right">—</td>
                        <td className="py-2 px-3 text-right">—</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {statementData.openingBalanceFormatted}
                        </td>
                      </tr>
                      {statementData.entries.map(e => (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">
                            {new Date(e.transactionDate).toLocaleDateString('en-IN')}
                          </td>
                          <td className="py-2 px-3 font-medium">{e.voucherType}</td>
                          <td className="py-2 px-3 font-mono font-semibold">{e.voucherNumber}</td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-700">
                            {e.debit > 0 ? `₹${e.debit.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-purple-700">
                            {e.credit > 0 ? `₹${e.credit.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">
                            {e.balanceFormatted}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100/90 font-bold text-slate-900 border-t-2 border-slate-300">
                        <td colSpan={5} className="py-2.5 px-3 text-right uppercase">
                          Closing Balance:
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-sm">
                          {statementData.closingBalanceFormatted}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
