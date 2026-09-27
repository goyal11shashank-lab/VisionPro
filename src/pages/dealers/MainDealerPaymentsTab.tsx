import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  Receipt,
  Building2,
  Calendar,
  IndianRupee,
  ShieldCheck,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

interface MainDealerPaymentsTabProps {
  dealerId?: string | null;
  onRefreshSummary?: () => void;
  onNavigate?: (path: string) => void;
}

interface CustomAllocationItem {
  mainSalesInvoiceId: string;
  allocatedAmount: number;
  notes?: string;
}

export const MainDealerPaymentsTab: React.FC<MainDealerPaymentsTabProps> = ({
  dealerId,
  onRefreshSummary,
  onNavigate,
}) => {
  const [advices, setAdvices] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    total: 0,
    totalAmount: 0,
    submittedCount: 0,
    submittedAmount: 0,
    verifiedCount: 0,
    verifiedAmount: 0,
    rejectedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Active Advice for Action
  const [activeAdvice, setActiveAdvice] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Verify Form State
  const [customAllocations, setCustomAllocations] = useState<
    Record<string, { mainSalesInvoiceId: string; allocatedAmount: number; notes?: string }>
  >({});
  const [receiptNotes, setReceiptNotes] = useState('');

  // Reject Form State
  const [rejectionReason, setRejectionReason] = useState('');

  // Fetch Payment Advices
  const fetchAdvices = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (dealerId) params.append('dealerBusinessId', dealerId);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await apiRequest<{
        success: boolean;
        advices: any[];
        stats: any;
      }>(`/api/main/dealers/payments/advices?${params.toString()}`);

      if (res.success) {
        setAdvices(res.advices || []);
        if (res.stats) setStats(res.stats);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch incoming payment advices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dealerId, statusFilter, searchQuery]);

  useEffect(() => {
    fetchAdvices();
  }, [fetchAdvices]);

  // Load Full Advice Details for Verification
  const handleOpenVerifyModal = async (adviceId: string) => {
    try {
      setActionLoading(true);
      setError(null);
      const res = await apiRequest<{ success: boolean; advice: any }>(
        `/api/main/dealers/payments/advices/${adviceId}`
      );
      if (res.success) {
        const adv = res.advice;
        setActiveAdvice(adv);
        setReceiptNotes(`Verified from Dealer Payment Advice ${adv.adviceNumber}`);

        // Initialize allocation overrides from server safe allocations
        const initialAllocMap: Record<string, any> = {};
        if (Array.isArray(adv.proposedAllocations)) {
          adv.proposedAllocations.forEach((p: any) => {
            if (p.mainSalesInvoiceId) {
              initialAllocMap[p.mainSalesInvoiceId] = {
                mainSalesInvoiceId: p.mainSalesInvoiceId,
                allocatedAmount: p.safeAllocationAmount ?? p.allocatedAmount,
                notes: p.notes || '',
              };
            }
          });
        }
        setCustomAllocations(initialAllocMap);
        setVerifyModalOpen(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to prepare verification data');
    } finally {
      setActionLoading(false);
    }
  };

  // Open Reject Modal
  const handleOpenRejectModal = (advice: any) => {
    setActiveAdvice(advice);
    setRejectionReason('');
    setRejectModalOpen(true);
  };

  // Open Details Modal
  const handleOpenDetailModal = async (adviceId: string) => {
    try {
      setActionLoading(true);
      const res = await apiRequest<{ success: boolean; advice: any }>(
        `/api/main/dealers/payments/advices/${adviceId}`
      );
      if (res.success) {
        setActiveAdvice(res.advice);
        setDetailModalOpen(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load details');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Verify & Post Customer Receipt Submit
  const handleConfirmVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAdvice) return;

    try {
      setActionLoading(true);
      setError(null);

      const mappedAllocations = (Object.values(customAllocations) as CustomAllocationItem[])
        .filter((a) => a.allocatedAmount > 0)
        .map((a) => ({
          mainSalesInvoiceId: a.mainSalesInvoiceId,
          allocatedAmount: a.allocatedAmount,
          notes: a.notes,
        }));

      const res = await apiRequest<{
        success: boolean;
        message: string;
        mainReceiptNumber: string;
      }>(`/api/main/dealers/payments/advices/${activeAdvice.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({
          customAllocations: mappedAllocations,
          notes: receiptNotes.trim() || undefined,
        }),
      });

      if (res.success) {
        setSuccessMsg(res.message);
        setVerifyModalOpen(false);
        setActiveAdvice(null);
        fetchAdvices();
        if (onRefreshSummary) onRefreshSummary();
        setTimeout(() => setSuccessMsg(null), 7000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify payment advice');
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Reject Submit
  const handleConfirmRejection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAdvice) return;
    if (!rejectionReason.trim()) {
      setError('Rejection reason is required.');
      return;
    }

    try {
      setActionLoading(true);
      setError(null);

      const res = await apiRequest<{
        success: boolean;
        message: string;
      }>(`/api/main/dealers/payments/advices/${activeAdvice.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          reason: rejectionReason.trim(),
        }),
      });

      if (res.success) {
        setSuccessMsg(res.message);
        setRejectModalOpen(false);
        setActiveAdvice(null);
        fetchAdvices();
        if (onRefreshSummary) onRefreshSummary();
        setTimeout(() => setSuccessMsg(null), 7000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reject payment advice');
    } finally {
      setActionLoading(false);
    }
  };

  // Derived calculation in verify modal
  const adviceAmount = activeAdvice ? parseFloat(activeAdvice.amount) || 0 : 0;
  const currentTotalAllocated: number = (Object.values(customAllocations) as CustomAllocationItem[]).reduce(
    (sum, a) => sum + (Number(a.allocatedAmount) || 0),
    0
  );
  const currentAdvance = Math.max(0, Math.round((adviceAmount - currentTotalAllocated) * 100) / 100);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-emerald-600" />
            Dealer Payment Advices & Verification Queue
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Review payments reported by Dealers, verify bank credit, and post official Customer Receipts to Main Books.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setRefreshing(true);
              fetchAdvices();
            }}
            disabled={refreshing}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Success Banner */}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2.5 animate-in fade-in duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Total Advices Received
          </span>
          <div className="mt-2 text-2xl font-bold text-slate-900">{stats.total || 0}</div>
          <p className="text-xs text-slate-400 mt-0.5">
            ₹{Number(stats.totalAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} total
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-200/80 bg-amber-50/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
              Pending Verification
            </span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-600">{stats.submittedCount || 0}</div>
          <p className="text-xs text-amber-700/80 mt-0.5">
            ₹{Number(stats.submittedAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} awaiting action
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
              Verified & Posted
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{stats.verifiedCount || 0}</div>
          <p className="text-xs text-emerald-700/80 mt-0.5">
            ₹{Number(stats.verifiedAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} collected
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200/80 bg-rose-50/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider">
              Rejected Advices
            </span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-600">{stats.rejectedCount || 0}</div>
          <p className="text-xs text-rose-700/80 mt-0.5">Discrepancy / Non-credit</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'SUBMITTED', 'VERIFIED', 'REJECTED'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL'
                ? 'All Advices'
                : st === 'SUBMITTED'
                ? `Pending Verification (${stats.submittedCount || 0})`
                : st === 'VERIFIED'
                ? 'Verified'
                : 'Rejected'}
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Dealer, Advice #, UTR..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Advices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium">Loading payment verification queue...</p>
          </div>
        ) : advices.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700">No Payment Advices Found</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {statusFilter === 'SUBMITTED'
                ? 'No payment advices currently awaiting verification. Everything is up to date!'
                : 'No payment advice records found matching the criteria.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Advice #</th>
                  <th className="py-3 px-4">Dealer Name</th>
                  <th className="py-3 px-4">Payment Date</th>
                  <th className="py-3 px-4">Mode / UTR Ref</th>
                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Customer Receipt #</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advices.map((adv) => (
                  <tr key={adv.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-blue-600 font-mono">
                      {adv.adviceNumber}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{adv.dealerName}</div>
                      {adv.dealerTradeName && (
                        <div className="text-[11px] text-slate-500">{adv.dealerTradeName}</div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-slate-600">
                      {new Date(adv.paymentDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{adv.paymentMode}</div>
                      {adv.referenceNumber ? (
                        <div className="text-[11px] font-mono text-slate-500">
                          UTR: {adv.referenceNumber}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400">No ref provided</div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right font-bold text-slate-900 text-sm">
                      ₹{Number(adv.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="py-3 px-4">
                      {adv.status === 'SUBMITTED' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          Pending Verification
                        </span>
                      ) : adv.status === 'VERIFIED' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          Rejected
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono text-emerald-700 font-semibold">
                      {adv.mainReceiptNumber || (
                        <span className="text-slate-400 font-normal text-[11px]">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        {adv.status === 'SUBMITTED' ? (
                          <>
                            <button
                              onClick={() => handleOpenVerifyModal(adv.id)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs transition-colors"
                              title="Verify bank credit and post Customer Receipt"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Verify & Post
                            </button>

                            <button
                              onClick={() => handleOpenRejectModal(adv)}
                              className="px-2 py-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 rounded-lg text-xs font-medium transition-colors"
                              title="Reject advice"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleOpenDetailModal(adv.id)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-500" />
                            View
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* VERIFY & ISSUE RECEIPT MODAL */}
      {verifyModalOpen && activeAdvice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-900 to-slate-900 text-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/20 rounded-xl text-emerald-400 border border-emerald-400/20">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Verify Payment & Issue Customer Receipt</h3>
                  <p className="text-xs text-slate-300">
                    Advice #{activeAdvice.adviceNumber} from {activeAdvice.dealerName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setVerifyModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <form id="verify-payment-form" onSubmit={handleConfirmVerification} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {/* Payment Summary Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 font-medium">Dealer:</span>
                  <div className="font-bold text-slate-900 text-sm mt-0.5">{activeAdvice.dealerName}</div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Payment Amount:</span>
                  <div className="font-bold text-emerald-700 text-base mt-0.5">
                    ₹{Number(activeAdvice.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Mode & Date:</span>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {activeAdvice.paymentMode} ({new Date(activeAdvice.paymentDate).toLocaleDateString('en-IN')})
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Reference / UTR #:</span>
                  <div className="font-mono font-bold text-slate-900 mt-0.5">
                    {activeAdvice.referenceNumber || '—'}
                  </div>
                </div>
              </div>

              {/* Invoice Allocations Revalidation Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="px-4 py-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <FileCheck className="w-4 h-4 text-emerald-600" />
                      Sales Invoice Allocation Verification
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Live verification against current Main Sales Invoice balances.
                    </p>
                  </div>
                </div>

                {activeAdvice.proposedAllocations && activeAdvice.proposedAllocations.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                          <th className="py-2.5 px-3">Main Sales Invoice #</th>
                          <th className="py-2.5 px-3">Dealer Purchase Inv #</th>
                          <th className="py-2.5 px-3 text-right">Current Outstanding (₹)</th>
                          <th className="py-2.5 px-3 text-right">Proposed (₹)</th>
                          <th className="py-2.5 px-3 text-right w-40">Verified Allocation (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeAdvice.proposedAllocations.map((p: any, idx: number) => {
                          const currentAlloc = customAllocations[p.mainSalesInvoiceId]?.allocatedAmount ?? p.safeAllocationAmount ?? 0;
                          const hasOverAlloc = p.isOverAllocated;

                          return (
                            <tr key={idx} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                                {p.mainSalesInvoiceNumber || '—'}
                                {hasOverAlloc && (
                                  <span className="ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                                    Partially Paid
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {p.dealerPurchaseInvoiceNumber}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold text-slate-700">
                                {p.currentMainOutstanding !== null
                                  ? `₹${Number(p.currentMainOutstanding).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-medium text-slate-500">
                                ₹{Number(p.allocatedAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1.5 text-slate-400 font-semibold text-xs">₹</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={p.currentMainOutstanding ?? undefined}
                                    value={currentAlloc > 0 ? currentAlloc : ''}
                                    onChange={(e) => {
                                      const val = Math.max(0, parseFloat(e.target.value) || 0);
                                      setCustomAllocations({
                                        ...customAllocations,
                                        [p.mainSalesInvoiceId]: {
                                          mainSalesInvoiceId: p.mainSalesInvoiceId,
                                          allocatedAmount: val,
                                        },
                                      });
                                    }}
                                    className="w-full pl-6 pr-2 py-1 text-right border border-slate-300 rounded font-semibold text-slate-900 text-xs focus:ring-1 focus:ring-emerald-500"
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No specific invoice allocations were provided. The full amount of ₹{adviceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} will stand as an On-Account Customer Advance.
                  </div>
                )}

                {/* Allocation Summary Bar */}
                <div className="p-3 bg-slate-50 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Receipt Amount: </span>
                    <span className="font-bold text-slate-900">
                      ₹{adviceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Allocated to Invoices: </span>
                    <span className="font-bold text-emerald-700">
                      ₹{currentTotalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">On-Account Advance: </span>
                    <span className="font-bold text-blue-700">
                      ₹{currentAdvance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Receipt Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Receipt Remarks / Voucher Note
                </label>
                <input
                  type="text"
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              {/* Accounting Guarantee Notice */}
              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl text-emerald-950 text-xs flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">Accounting Execution on Confirmation:</p>
                  <p className="text-[11px] text-emerald-800">
                    An authoritative Customer Receipt voucher is created and posted in Main Warehouse books. The Dealer's Customer Ledger balance will be credited by ₹{adviceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}, reducing open receivables.
                  </p>
                </div>
              </div>
            </form>

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setVerifyModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100"
              >
                Cancel
              </button>

              <button
                type="submit"
                form="verify-payment-form"
                disabled={actionLoading || currentTotalAllocated > adviceAmount + 0.01}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {actionLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Posting Receipt...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Confirm & Post Customer Receipt (₹{adviceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT PAYMENT ADVICE MODAL */}
      {rejectModalOpen && activeAdvice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-rose-600 text-white">
              <div className="flex items-center gap-2.5">
                <XCircle className="w-5 h-5" />
                <h3 className="font-bold text-base">Reject Payment Advice</h3>
              </div>
              <button
                onClick={() => setRejectModalOpen(false)}
                className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmRejection} className="p-6 space-y-4">
              <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-900 space-y-1">
                <p>
                  <strong>Advice:</strong> {activeAdvice.adviceNumber}
                </p>
                <p>
                  <strong>Dealer:</strong> {activeAdvice.dealerName}
                </p>
                <p>
                  <strong>Reported Amount:</strong> ₹
                  {Number(activeAdvice.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Rejection <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. UTR reference not found in bank statement, amount mismatch, or cheque bounced."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Rejecting this advice transitions its status to <span className="font-bold text-rose-600">REJECTED</span>. The Dealer's internal Supplier Payment is preserved in their book, and they will be notified to review the mismatch.
              </p>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectModalOpen(false)}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !rejectionReason.trim()}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {detailModalOpen && activeAdvice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Payment Advice Details
                </span>
                <h3 className="text-lg font-bold text-slate-900">
                  {activeAdvice.adviceNumber}
                </h3>
              </div>
              <button
                onClick={() => setDetailModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <span className="text-slate-500">Dealer:</span>
                  <div className="font-bold text-slate-900 mt-0.5">{activeAdvice.dealerName}</div>
                </div>
                <div>
                  <span className="text-slate-500">Amount:</span>
                  <div className="font-bold text-emerald-700 text-sm mt-0.5">
                    ₹{Number(activeAdvice.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Status:</span>
                  <div className="font-semibold text-slate-800 mt-0.5">{activeAdvice.status}</div>
                </div>
                <div>
                  <span className="text-slate-500">Payment Date:</span>
                  <div className="font-medium text-slate-800 mt-0.5">
                    {new Date(activeAdvice.paymentDate).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Mode / UTR:</span>
                  <div className="font-mono text-slate-800 mt-0.5">
                    {activeAdvice.paymentMode} {activeAdvice.referenceNumber ? `(${activeAdvice.referenceNumber})` : ''}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Main Customer Receipt #:</span>
                  <div className="font-mono font-bold text-emerald-700 mt-0.5">
                    {activeAdvice.mainReceiptNumber || '—'}
                  </div>
                </div>
              </div>

              {activeAdvice.status === 'REJECTED' && activeAdvice.rejectionReason && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800">
                  <span className="font-bold">Rejection Reason: </span>
                  <span>{activeAdvice.rejectionReason}</span>
                </div>
              )}

              {/* Allocations */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-100/70 border-b border-slate-200 font-bold uppercase tracking-wider text-slate-700">
                  Allocations Breakdown
                </div>
                {activeAdvice.proposedAllocations && activeAdvice.proposedAllocations.length > 0 ? (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3">Main Sales Invoice #</th>
                        <th className="py-2 px-3">Dealer Purchase Invoice #</th>
                        <th className="py-2 px-3 text-right">Allocated Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeAdvice.proposedAllocations.map((p: any, idx: number) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                            {p.mainSalesInvoiceNumber || '—'}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {p.dealerPurchaseInvoiceNumber}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-800">
                            ₹{Number(p.allocatedAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-4 text-center text-slate-500">
                    Full amount credited as Customer Advance (On-Account).
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setDetailModalOpen(false)}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100"
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
