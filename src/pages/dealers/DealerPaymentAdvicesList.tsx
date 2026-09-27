import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  CheckCircle2,
  Clock,
  XCircle,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Plus,
  AlertCircle,
  Building2,
  FileText,
  Calendar,
  IndianRupee,
  ChevronRight,
  X,
  Receipt,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { DealerPaymentModal } from './DealerPaymentModal.js';

interface DealerPaymentAdvicesListProps {
  onNavigate?: (path: string) => void;
}

export const DealerPaymentAdvicesList: React.FC<DealerPaymentAdvicesListProps> = ({
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

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedAdvice, setSelectedAdvice] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Fetch Advices
  const fetchAdvices = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await apiRequest<{
        success: boolean;
        advices: any[];
        stats: any;
      }>(`/api/dealer/payments/advices?${params.toString()}`);

      if (res.success) {
        setAdvices(res.advices || []);
        if (res.stats) setStats(res.stats);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load payment advices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchAdvices();
  }, [fetchAdvices]);

  // Open Details Modal
  const handleOpenDetails = async (adviceId: string) => {
    try {
      setDetailsLoading(true);
      const res = await apiRequest<{ success: boolean; advice: any }>(
        `/api/dealer/payments/advices/${adviceId}`
      );
      if (res.success) {
        setSelectedAdvice(res.advice);
      }
    } catch (err: any) {
      console.error('Failed to load advice details:', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-blue-600" />
            Payment Advices to Main Warehouse
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Track payments submitted to Main Warehouse, verification status, and linked Customer Receipts.
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

          <button
            onClick={() => setIsPaymentModalOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 flex items-center gap-2 transition-all"
          >
            <Plus className="w-4 h-4" />
            Record Payment to Main
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Total Advices
          </span>
          <div className="mt-2 text-2xl font-bold text-slate-900">{stats.total || 0}</div>
          <p className="text-xs text-slate-400 mt-0.5">
            ₹{Number(stats.totalAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} recorded
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-200/80 bg-amber-50/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
              Awaiting Verification
            </span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-600">{stats.submittedCount || 0}</div>
          <p className="text-xs text-amber-700/80 mt-0.5">
            ₹{Number(stats.submittedAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} pending
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
              Verified by Main
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{stats.verifiedCount || 0}</div>
          <p className="text-xs text-emerald-700/80 mt-0.5">
            ₹{Number(stats.verifiedAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} confirmed
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200/80 bg-rose-50/20 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider">
              Rejected
            </span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-600">{stats.rejectedCount || 0}</div>
          <p className="text-xs text-rose-700/80 mt-0.5">Review reasons below</p>
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
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL'
                ? 'All Advices'
                : st === 'SUBMITTED'
                ? 'Awaiting Verification'
                : st === 'VERIFIED'
                ? 'Verified'
                : 'Rejected'}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Advice / UTR / Voucher..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Advices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium">Loading payment advices...</p>
          </div>
        ) : advices.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700">No Payment Advices Found</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {statusFilter !== 'ALL'
                ? `No payment advices found matching status '${statusFilter}'.`
                : 'You have not recorded any payments to Main Warehouse yet.'}
            </p>
            <button
              onClick={() => setIsPaymentModalOpen(true)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700"
            >
              Record First Payment
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Advice #</th>
                  <th className="py-3 px-4">Payment Date</th>
                  <th className="py-3 px-4">Mode / Ref (UTR)</th>
                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Dealer Voucher #</th>
                  <th className="py-3 px-4">Main Receipt #</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advices.map((adv) => (
                  <tr key={adv.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-blue-600 font-mono">
                      {adv.adviceNumber}
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
                      {adv.referenceNumber && (
                        <div className="text-[11px] font-mono text-slate-500">
                          Ref: {adv.referenceNumber}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right font-bold text-slate-900 text-sm">
                      ₹{Number(adv.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="py-3 px-4">
                      {adv.status === 'SUBMITTED' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          Awaiting Verification
                        </span>
                      ) : adv.status === 'VERIFIED' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Verified by Main
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          Rejected
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono text-slate-700">
                      {adv.dealerPaymentNumber || '—'}
                    </td>

                    <td className="py-3 px-4 font-mono text-emerald-700 font-semibold">
                      {adv.mainReceiptNumber || (
                        <span className="text-slate-400 font-normal text-[11px]">—</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => handleOpenDetails(adv.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 mx-auto transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      <DealerPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onSuccess={(res) => {
          fetchAdvices();
        }}
      />

      {/* Details Drawer / Modal */}
      {selectedAdvice && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Payment Advice Details
                </span>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  {selectedAdvice.adviceNumber}
                  {selectedAdvice.status === 'VERIFIED' && (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full">
                      Verified
                    </span>
                  )}
                  {selectedAdvice.status === 'SUBMITTED' && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-semibold rounded-full">
                      Awaiting Verification
                    </span>
                  )}
                  {selectedAdvice.status === 'REJECTED' && (
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-800 text-xs font-semibold rounded-full">
                      Rejected
                    </span>
                  )}
                </h3>
              </div>
              <button
                onClick={() => setSelectedAdvice(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* If Rejected Banner */}
              {selectedAdvice.status === 'REJECTED' && selectedAdvice.rejectionReason && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs">
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <XCircle className="w-4 h-4 text-rose-600" />
                    Rejection Reason from Main Warehouse:
                  </div>
                  <p className="text-rose-700 bg-white/60 p-2.5 rounded-lg border border-rose-100 font-medium">
                    {selectedAdvice.rejectionReason}
                  </p>
                  <p className="text-[11px] text-rose-600 mt-2">
                    Note: Your Dealer Supplier Payment is preserved in your records. If this payment was rejected due to an incorrect UTR or bank mismatch, contact Main Warehouse or record an adjustment.
                  </p>
                </div>
              )}

              {/* Amount & Key Details */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <div>
                  <span className="text-slate-500 font-medium">Payment Amount:</span>
                  <div className="text-base font-bold text-slate-900 mt-0.5">
                    ₹{Number(selectedAdvice.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Payment Date:</span>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {new Date(selectedAdvice.paymentDate).toLocaleDateString('en-IN')}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Payment Mode:</span>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {selectedAdvice.paymentMode}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Reference / UTR #:</span>
                  <div className="font-mono text-slate-800 font-semibold mt-0.5">
                    {selectedAdvice.referenceNumber || '—'}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Bank Name:</span>
                  <div className="text-slate-800 mt-0.5 font-medium">
                    {selectedAdvice.bankName || '—'}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-medium">Submitted On:</span>
                  <div className="text-slate-700 mt-0.5">
                    {new Date(selectedAdvice.submittedAt).toLocaleString('en-IN', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </div>
                </div>
              </div>

              {/* Cross-Business Voucher Linking Box */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-blue-600" />
                  Dual-Entry Voucher Linkage
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Dealer Book (Supplier Payment)
                    </span>
                    <div className="font-bold text-slate-900 font-mono mt-1">
                      {selectedAdvice.dealerPaymentNumber || '—'}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Posted to Dealer Supplier Ledger
                    </p>
                  </div>

                  <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-200">
                    <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider">
                      Main Warehouse Book (Customer Receipt)
                    </span>
                    <div className="font-bold text-emerald-700 font-mono mt-1">
                      {selectedAdvice.mainReceiptNumber || 'Pending Verification'}
                    </div>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      {selectedAdvice.verifiedAt
                        ? `Verified on ${new Date(selectedAdvice.verifiedAt).toLocaleDateString('en-IN')}`
                        : 'Awaiting Main verification'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Proposed Invoice Allocations */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-100/70 border-b border-slate-200 font-bold text-xs text-slate-700 uppercase tracking-wider">
                  Invoice Allocations
                </div>
                {selectedAdvice.proposedAllocations && selectedAdvice.proposedAllocations.length > 0 ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3">Purchase Invoice #</th>
                        <th className="py-2 px-3">Main Sales Invoice #</th>
                        <th className="py-2 px-3 text-right">Allocated Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedAdvice.proposedAllocations.map((p: any, idx: number) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-semibold text-slate-900">
                            {p.dealerPurchaseInvoiceNumber}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-500">
                            {p.mainSalesInvoiceNumber || '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-800">
                            ₹{Number(p.allocatedAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No specific invoices were allocated. Full amount is On-Account Advance.
                  </div>
                )}
              </div>

              {selectedAdvice.notes && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <span className="font-semibold text-slate-700">Remarks: </span>
                  <span className="text-slate-600">{selectedAdvice.notes}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedAdvice(null)}
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
