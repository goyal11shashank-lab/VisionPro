import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Users,
  ArrowUpDown,
  FileSpreadsheet,
  MessageSquare,
  Clock,
  Pencil,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { getStoredToken, apiRequest } from '../../api/client.js';
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
  balance?: number;
  currentBalance?: number;
  updatedAt?: string;
  createdAt?: string;
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

type PartySortOption = 'latest' | 'max_balance' | 'min_balance' | 'name_asc' | 'name_desc';

export const PartyLedgerPage: React.FC<{ onNavigate?: (path: string) => void }> = ({ onNavigate }) => {
  const { currentBusiness } = useAuth();
  const [parties, setParties] = useState<PartyInfo[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [partySortBy, setPartySortBy] = useState<PartySortOption>('latest');
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [selectedParty, setSelectedParty] = useState<PartyInfo | null>(null);

  // Date filters
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Ledger state
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<StatementSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Infinite scroll / lazy rendering for older entries
  const [visibleCount, setVisibleCount] = useState<number>(50);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Drill-down voucher modal
  const [drillDownVoucher, setDrillDownVoucher] = useState<{
    type: string;
    id: string;
    number: string;
    date: string;
    amount: number;
    notes?: string;
    allocations?: any[];
    items?: any[];
  } | null>(null);
  const [loadingVoucher, setLoadingVoucher] = useState(false);

  // Load all parties (customers and suppliers)
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
        const allParties = d.parties || [];
        setParties(allParties);
        if (allParties.length > 0 && !selectedPartyId) {
          setSelectedPartyId(allParties[0].id);
        }
      })
      .catch(err => {
        console.error('Failed to load parties:', err);
        setError('Failed to load party accounts.');
      });
  }, [currentBusiness]);

  // Fetch statement when party changes
  const fetchStatement = async (partyId: string, from?: string, to?: string) => {
    if (!currentBusiness || !partyId) return;
    setLoading(true);
    setError(null);
    setVisibleCount(50);

    try {
      const params = new URLSearchParams();
      if (from) params.append('fromDate', from);
      if (to) params.append('toDate', to);
      params.append('ledgerType', 'ALL');

      const res = await fetch(`/api/payments/statement/${partyId}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${getStoredToken()}`,
          'X-Business-Id': currentBusiness.id,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to fetch party ledger statement');
      }

      const data = await res.json();
      setSelectedParty(data.party);
      setEntries(data.entries || []);
      setSummary(data.summary);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading party ledger statement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPartyId) {
      fetchStatement(selectedPartyId, fromDate, toDate);
    }
  }, [selectedPartyId, fromDate, toDate, currentBusiness]);

  // Handle scroll down for infinite loading of older entries
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 80) {
      if (visibleCount < entries.length) {
        setVisibleCount(prev => Math.min(entries.length, prev + 50));
      }
    }
  };

  const handlePrint = async () => {
    if (!selectedParty) return;
    try {
      await printDocument({
        elementOrId: 'party-ledger-printable-table',
        title: `Party Ledger - ${selectedParty.name}`,
        filename: `Party_Ledger_${selectedParty.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`,
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
      const rType = entry.referenceType.toUpperCase();
      if (rType.includes('PURCHASE_INVOICE') || rType === 'BILL') {
        const res = await apiRequest<any>(`/api/purchases/${entry.referenceId}`);
        const inv = res.invoice || res;
        setDrillDownVoucher({
          type: 'PURCHASE_INVOICE',
          id: inv.id,
          number: inv.invoiceNumber || inv.invoice_number,
          date: inv.invoiceDate || inv.invoice_date,
          amount: parseFloat(inv.grandTotal || inv.grand_total || '0'),
          notes: inv.notes,
          items: inv.lines,
        });
      } else if (rType.includes('SALES_INVOICE') || rType === 'INVOICE') {
        const res = await apiRequest<any>(`/api/sales/invoices/${entry.referenceId}`);
        const inv = res.invoice || res;
        setDrillDownVoucher({
          type: 'SALES_INVOICE',
          id: inv.id,
          number: inv.invoiceNumber,
          date: inv.invoiceDate,
          amount: parseFloat(inv.grandTotal || '0'),
          notes: inv.notes,
          items: inv.lines,
        });
      } else if (rType.includes('PAYMENT') || rType.includes('RECEIPT') || rType === 'DISBURSEMENT') {
        const res = await apiRequest<any>(`/api/payments/${entry.referenceId}`);
        const pay = res.payment || res;
        setDrillDownVoucher({
          type: 'PAYMENT',
          id: pay.id,
          number: pay.paymentNumber || pay.receiptNumber,
          date: pay.paymentDate || pay.receiptDate,
          amount: parseFloat(pay.amount || '0'),
          notes: pay.notes,
          allocations: pay.allocations,
        });
      } else if (rType.includes('SALES_ORDER') || rType === 'ORDER') {
        const res = await apiRequest<any>(`/api/sales/orders/${entry.referenceId}`);
        const ord = res.order || res;
        setDrillDownVoucher({
          type: 'SALES_ORDER',
          id: ord.id,
          number: ord.orderNumber,
          date: ord.orderDate,
          amount: parseFloat(ord.grandTotal || '0'),
          notes: ord.notes,
          items: ord.lines,
        });
      } else if (rType.includes('PURCHASE_ORDER')) {
        const res = await apiRequest<any>(`/api/purchases/orders/${entry.referenceId}`);
        const ord = res.order || res;
        setDrillDownVoucher({
          type: 'PURCHASE_ORDER',
          id: ord.id,
          number: ord.orderNumber,
          date: ord.orderDate,
          amount: parseFloat(ord.grandTotal || '0'),
          notes: ord.notes,
          items: ord.lines,
        });
      } else if (rType.includes('SALES_RETURN')) {
        const res = await apiRequest<any>(`/api/sales/returns/${entry.referenceId}`);
        const ret = res.return || res;
        setDrillDownVoucher({
          type: 'SALES_RETURN',
          id: ret.id,
          number: ret.returnNumber,
          date: ret.returnDate,
          amount: parseFloat(ret.grandTotal || '0'),
          notes: ret.notes || ret.reason,
          items: ret.lines,
        });
      } else if (rType.includes('PURCHASE_RETURN')) {
        const res = await apiRequest<any>(`/api/purchase-returns/${entry.referenceId}`);
        const ret = res.return || res;
        setDrillDownVoucher({
          type: 'PURCHASE_RETURN',
          id: ret.id,
          number: ret.returnNumber,
          date: ret.returnDate,
          amount: parseFloat(ret.grandTotal || '0'),
          notes: ret.notes || ret.reason,
          items: ret.lines,
        });
      }
    } catch (err) {
      console.error('Error fetching voucher drill-down:', err);
    } finally {
      setLoadingVoucher(false);
    }
  };

  // Filter and sort parties
  const filteredAndSortedParties = useMemo(() => {
    const term = partySearch.toLowerCase().trim();
    const filtered = parties.filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      (p.partyCode || '').toLowerCase().includes(term) ||
      (p.phone || '').includes(term) ||
      (p.gstin || '').toLowerCase().includes(term)
    );

    return filtered.sort((a, b) => {
      const balA = Number(a.balance ?? a.currentBalance ?? 0);
      const balB = Number(b.balance ?? b.currentBalance ?? 0);
      const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();

      switch (partySortBy) {
        case 'max_balance':
          return balB - balA;
        case 'min_balance':
          return balA - balB;
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name_desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'latest':
        default:
          return dateB - dateA;
      }
    });
  }, [parties, partySearch, partySortBy]);

  const visibleEntries = useMemo(() => {
    return entries.slice(0, visibleCount);
  }, [entries, visibleCount]);

  // Total Outstanding across all parties
  const totalOutstanding = useMemo(() => {
    return parties.reduce((acc, p) => acc + Number(p.balance ?? p.currentBalance ?? 0), 0);
  }, [parties]);

  return (
    <div className="space-y-4" id="party-ledger-page-root">
      {/* Top Header / Summary */}
      <div className="bg-white px-6 py-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Party Ledger & Outstanding</h1>
            <p className="text-xs text-slate-500">
              Total Outstanding: <span className="font-bold text-slate-900 font-mono">₹{totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span> ({parties.length} Party Accounts)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => selectedPartyId && fetchStatement(selectedPartyId, fromDate, toDate)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handlePrint}
            disabled={!selectedParty || entries.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-700 disabled:opacity-50 shadow-xs transition"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Statement
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          {error}
        </div>
      )}

      {/* Master-Detail Layout matching reference UI */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Master Panel: Parties List with Search & Sort */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col h-[calc(100vh-210px)] min-h-[550px]">
          <div className="p-3.5 border-b border-slate-100 space-y-2 bg-slate-50/50">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search Party Name..."
                value={partySearch}
                onChange={e => setPartySearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-purple-500/20 font-medium"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value={partySortBy}
                onChange={e => setPartySortBy(e.target.value as PartySortOption)}
                className="w-full text-[11px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-hidden"
              >
                <option value="latest">Sort: Latest Transaction</option>
                <option value="max_balance">Sort: Max Current Balance</option>
                <option value="min_balance">Sort: Min Current Balance</option>
                <option value="name_asc">Sort: Alphabetical (A - Z)</option>
                <option value="name_desc">Sort: Alphabetical (Z - A)</option>
              </select>
            </div>
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1 pt-1">
              <span>Party Name</span>
              <span>Amount</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredAndSortedParties.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No parties found</div>
            ) : (
              filteredAndSortedParties.map(p => {
                const isSelected = p.id === selectedPartyId;
                const bal = Number(p.balance ?? p.currentBalance ?? 0);
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPartyId(p.id)}
                    className={`px-4 py-3 cursor-pointer transition-colors flex items-center justify-between ${
                      isSelected ? 'bg-purple-50/90 border-l-4 border-purple-600' : 'hover:bg-slate-50/80 bg-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className={`font-semibold text-xs truncate ${isSelected ? 'text-purple-950 font-bold' : 'text-slate-900'}`}>
                        {p.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5">
                        <span>{p.partyCode}</span>
                        <span>•</span>
                        <span className="uppercase">{p.partyType}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono text-xs font-bold">
                      <span className={bal < 0 ? 'text-rose-600' : 'text-slate-900'}>
                        {bal !== 0 ? `₹${Math.abs(bal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '0'}
                      </span>
                      <div className={`text-[10px] font-normal ${bal >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {bal !== 0 ? (bal >= 0 ? 'Dr' : 'Cr') : ''}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Detail Panel: Instant Party Statement with Infinite Scroll */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col h-[calc(100vh-210px)] min-h-[550px] overflow-hidden">
          {selectedParty ? (
            <>
              {/* Party Header info */}
              <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/30">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">{selectedParty.name}</h2>
                    <button
                      onClick={() => onNavigate?.(`/parties`)}
                      className="text-purple-600 hover:text-purple-800"
                      title="Edit Party"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Phone Number: <span className="font-mono font-medium text-slate-800">{selectedParty.phone || '—'}</span> {selectedParty.gstin ? `• GSTIN: ${selectedParty.gstin}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-xl text-right">
                    <div className="text-[10px] font-semibold text-purple-600 uppercase">Current Balance</div>
                    <div className="text-sm font-bold font-mono text-purple-900">
                      {summary?.closingBalanceFormatted || '₹0.00'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Transactions Table with Infinite Scroll */}
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
                <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">Transactions</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-medium">
                    Showing {Math.min(visibleCount, entries.length)} of {entries.length} entries (Scroll down for older)
                  </span>
                </div>
              </div>

              <div
                ref={tableContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto"
              >
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 text-slate-700 font-semibold uppercase tracking-wider sticky top-0 border-b border-slate-200 z-10">
                    <tr>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Number</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Total (₹)</th>
                      <th className="py-3 px-4 text-right">Balance (₹)</th>
                      <th className="py-3 px-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-slate-400">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-purple-600 mb-2" />
                          <span>Loading vouchers instantly...</span>
                        </td>
                      </tr>
                    ) : entries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-slate-400">
                          <BookOpen className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                          <p className="font-medium text-slate-600">No transactions recorded for this party</p>
                        </td>
                      </tr>
                    ) : (
                      visibleEntries.map(entry => {
                        const isClickable = Boolean(entry.referenceId && entry.referenceType);
                        const totalAmount = entry.debit > 0 ? entry.debit : entry.credit;
                        return (
                          <tr
                            key={entry.id}
                            onClick={() => isClickable && handleVoucherClick(entry)}
                            className={`transition-colors ${isClickable ? 'hover:bg-purple-50/60 cursor-pointer' : 'hover:bg-slate-50/40'}`}
                            title={isClickable ? 'Click to view voucher details' : undefined}
                          >
                            <td className="py-3 px-4 font-medium text-slate-900">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 text-slate-800 border border-slate-200">
                                {entry.voucherType || entry.transactionType}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-purple-700">
                              {entry.voucherNumber || '—'}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-600">
                              {new Date(entry.transactionDate).toLocaleString('en-IN', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">
                              {totalAmount > 0 ? `₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                              {entry.balanceFormatted}
                            </td>
                            <td className="py-3 px-2 text-center">
                              {isClickable && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVoucherClick(entry);
                                  }}
                                  className="p-1 text-slate-400 hover:text-purple-700 hover:bg-purple-50 rounded"
                                  title="View Voucher"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {visibleCount < entries.length && (
                  <div className="py-3 text-center bg-slate-50 text-xs text-purple-600 font-semibold border-t border-slate-100">
                    Scroll down to load more older entries ({entries.length - visibleCount} remaining)...
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400">
              <Users className="w-12 h-12 text-slate-300 mb-3" />
              <p className="font-semibold text-slate-700 text-sm">Select a party account from the left</p>
              <p className="text-xs text-slate-400 mt-1">Instant running statement and all vouchers will load here.</p>
            </div>
          )}
        </div>
      </div>

      {/* Drill-down Voucher Modal */}
      {drillDownVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                  {drillDownVoucher.type}
                </span>
                <h3 className="font-bold text-slate-900 text-lg mt-1 font-mono">
                  #{drillDownVoucher.number}
                </h3>
              </div>
              <button
                onClick={() => setDrillDownVoucher(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Date:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {new Date(drillDownVoucher.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Amount:</span>
                <span className="font-mono font-bold text-purple-700 text-sm">
                  ₹{drillDownVoucher.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {drillDownVoucher.notes && (
                <div>
                  <span className="text-slate-400 block mb-0.5">Narration / Notes:</span>
                  <p className="p-2 bg-slate-50 rounded-xl text-slate-700 font-medium">{drillDownVoucher.notes}</p>
                </div>
              )}

              {drillDownVoucher.items && drillDownVoucher.items.length > 0 && (
                <div>
                  <span className="text-slate-400 block mb-1 font-semibold">Line Items:</span>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50/50 space-y-1">
                    {drillDownVoucher.items.map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                        <span>{item.uniqueItemName || item.itemName || 'Item'} (Qty: {item.quantity})</span>
                        <span className="font-mono font-semibold">₹{Number(item.lineTotal || (item.quantity * item.rate)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {drillDownVoucher.allocations && drillDownVoucher.allocations.length > 0 && (
                <div>
                  <span className="text-slate-400 block mb-1 font-semibold">Invoice Allocations:</span>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50/50 space-y-1">
                    {drillDownVoucher.allocations.map((alloc: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                        <span>Invoice #{alloc.invoiceNumber || alloc.documentNumber}</span>
                        <span className="font-mono font-semibold">₹{Number(alloc.allocatedAmount || alloc.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setDrillDownVoucher(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-2xs">
          <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin text-purple-600" />
            <span className="text-xs font-semibold text-slate-700">Loading voucher details...</span>
          </div>
        </div>
      )}
    </div>
  );
};
