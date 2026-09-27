import React, { useState, useEffect, useCallback } from 'react';
import {
  RotateCcw,
  CheckCircle2,
  Clock,
  Truck,
  Boxes,
  XCircle,
  Eye,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  FileText,
  AlertCircle,
  ShieldCheck,
  Send,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

interface MainDealerReturnsTabProps {
  dealerId?: string | null;
  onRefreshSummary?: () => void;
  onNavigate?: (path: string) => void;
}

export const MainDealerReturnsTab: React.FC<MainDealerReturnsTabProps> = ({
  dealerId,
  onRefreshSummary,
  onNavigate,
}) => {
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Active Return for review / receive
  const [activeReturn, setActiveReturn] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Review & Approve Form State
  const [approvedQuantities, setApprovedQuantities] = useState<Record<string, number>>({});
  const [approvalNotes, setApprovalNotes] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // Physical Receipt & Inspection Form State
  const [receiveNotes, setReceiveNotes] = useState('');
  const [receiptLines, setReceiptLines] = useState<
    Record<string, { receivedQty: number; acceptedQty: number; damagedQty: number }>
  >({});

  // Fetch returns
  const fetchReturns = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (dealerId) params.append('dealerBusinessId', dealerId);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await apiRequest<{ success: boolean; returns: any[] }>(
        `/api/main/dealers/returns?${params.toString()}`
      );
      setReturns(res.returns || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load returns list');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dealerId, statusFilter, searchQuery]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  // Open Review & Approve Modal
  const handleOpenReview = async (ret: any) => {
    try {
      setActionLoading(true);
      const res = await apiRequest<{ success: boolean; dealerReturn: any }>(
        `/api/main/dealers/returns/${ret.id}`
      );
      setActiveReturn(res.dealerReturn);
      setIsRejecting(false);
      setRejectionReason('');
      setApprovalNotes('');

      // Pre-fill approved quantities with requested quantities
      const initialApproved: Record<string, number> = {};
      for (const line of res.dealerReturn.lines || []) {
        initialApproved[line.id] = line.requested_quantity;
      }
      setApprovedQuantities(initialApproved);
      setReviewModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load return details');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Approval
  const handleSubmitApproval = async () => {
    if (!activeReturn) return;
    setActionLoading(true);
    setError(null);
    try {
      const lines = Object.entries(approvedQuantities).map(([lineId, approvedQty]) => ({
        lineId,
        approvedQuantity: approvedQty,
      }));

      const res = await apiRequest<{ success: boolean; message: string; dealerReturn: any }>(
        `/api/main/dealers/returns/${activeReturn.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            notes: approvalNotes.trim() || undefined,
            lines,
          }),
        }
      );

      setSuccessMsg(res.message);
      setReviewModalOpen(false);
      fetchReturns();
      if (onRefreshSummary) onRefreshSummary();
    } catch (err: any) {
      setError(err.message || 'Failed to approve return');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Rejection
  const handleSubmitRejection = async () => {
    if (!activeReturn) return;
    if (!rejectionReason.trim()) {
      setError('Please provide a reason for rejecting this return request');
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ success: boolean; message: string; dealerReturn: any }>(
        `/api/main/dealers/returns/${activeReturn.id}/reject`,
        {
          method: 'POST',
          body: JSON.stringify({
            rejectionReason: rejectionReason.trim(),
          }),
        }
      );

      setSuccessMsg(res.message);
      setReviewModalOpen(false);
      fetchReturns();
      if (onRefreshSummary) onRefreshSummary();
    } catch (err: any) {
      setError(err.message || 'Failed to reject return');
    } finally {
      setActionLoading(false);
    }
  };

  // Open Receive & Inspect Modal
  const handleOpenReceive = async (ret: any) => {
    try {
      setActionLoading(true);
      const res = await apiRequest<{ success: boolean; dealerReturn: any }>(
        `/api/main/dealers/returns/${ret.id}`
      );
      setActiveReturn(res.dealerReturn);
      setReceiveNotes('');

      // Pre-fill inspection lines:
      // remainingSent = sent_quantity - received_quantity
      const initialLines: Record<
        string,
        { receivedQty: number; acceptedQty: number; damagedQty: number }
      > = {};
      for (const l of res.dealerReturn.lines || []) {
        const remainingSent = Math.max(0, (l.sent_quantity || 0) - (l.received_quantity || 0));
        initialLines[l.id] = {
          receivedQty: remainingSent,
          acceptedQty: remainingSent,
          damagedQty: 0,
        };
      }
      setReceiptLines(initialLines);
      setReceiveModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load return items');
    } finally {
      setActionLoading(false);
    }
  };

  // Update receipt line numbers
  const handleReceiptLineChange = (
    lineId: string,
    field: 'receivedQty' | 'acceptedQty' | 'damagedQty',
    value: string,
    maxPending: number
  ) => {
    const num = parseFloat(value) || 0;
    setReceiptLines(prev => {
      const current = prev[lineId] || { receivedQty: 0, acceptedQty: 0, damagedQty: 0 };
      const updated = { ...current };

      if (field === 'receivedQty') {
        const clamped = Math.min(Math.max(0, num), maxPending);
        updated.receivedQty = clamped;
        updated.acceptedQty = Math.max(0, clamped - updated.damagedQty);
      } else if (field === 'acceptedQty') {
        updated.acceptedQty = Math.min(Math.max(0, num), updated.receivedQty);
        updated.damagedQty = Math.max(0, updated.receivedQty - updated.acceptedQty);
      } else if (field === 'damagedQty') {
        updated.damagedQty = Math.min(Math.max(0, num), updated.receivedQty);
        updated.acceptedQty = Math.max(0, updated.receivedQty - updated.damagedQty);
      }

      return { ...prev, [lineId]: updated };
    });
  };

  // Submit Physical Receipt & Post Sales Return
  const handleSubmitReceive = async () => {
    if (!activeReturn) return;

    // Validate quantities
    const lines = Object.entries(receiptLines).map(([lineId, l]: [string, any]) => ({
      lineId,
      receivedQuantity: l.receivedQty,
      acceptedQuantity: l.acceptedQty,
      damagedQuantity: l.damagedQty,
    }));

    const totalReceived = lines.reduce((acc, l) => acc + l.receivedQuantity, 0);
    if (totalReceived <= 0) {
      setError('Please specify a received quantity greater than 0');
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        success: boolean;
        message: string;
        sessionAcceptedTotal: number;
        dealerReturn: any;
      }>(`/api/main/dealers/returns/${activeReturn.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          notes: receiveNotes.trim() || undefined,
          lines,
        }),
      });

      setSuccessMsg(res.message);
      setReceiveModalOpen(false);
      fetchReturns();
      if (onRefreshSummary) onRefreshSummary();
    } catch (err: any) {
      setError(err.message || 'Failed to process return receipt');
    } finally {
      setActionLoading(false);
    }
  };

  // Open Details Modal
  const handleOpenDetail = async (ret: any) => {
    try {
      setActionLoading(true);
      const res = await apiRequest<{ success: boolean; dealerReturn: any }>(
        `/api/main/dealers/returns/${ret.id}`
      );
      setActiveReturn(res.dealerReturn);
      setDetailModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load details');
    } finally {
      setActionLoading(false);
    }
  };

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'REQUESTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5" />
            Review Needed
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Check className="w-3.5 h-3.5" />
            Approved (Awaiting Dispatch)
          </span>
        );
      case 'IN_TRANSIT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Truck className="w-3.5 h-3.5" />
            In Transit (Awaiting Intake)
          </span>
        );
      case 'PARTIALLY_RECEIVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
            <Boxes className="w-3.5 h-3.5" />
            Partially Received
          </span>
        );
      case 'RECEIVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed & Credited
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5" />
            Rejected
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600 border border-zinc-200">
            <X className="w-3.5 h-3.5" />
            Cancelled by Dealer
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-50 text-zinc-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div id="main-dealer-returns-container" className="space-y-4">
      {/* Alert Notices */}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter and Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50 p-3 rounded-xl border border-slate-200">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search return #, dealer, invoice #..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1 shrink-0">
            <Filter className="w-3 h-3" /> Status:
          </span>
          {[
            { id: 'ALL', label: 'All' },
            { id: 'REQUESTED', label: 'Needs Review' },
            { id: 'IN_TRANSIT', label: 'In Transit' },
            { id: 'RECEIVED', label: 'Completed' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors shrink-0 ${
                statusFilter === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <button
            onClick={() => {
              setRefreshing(true);
              fetchReturns();
            }}
            disabled={refreshing}
            className="p-1.5 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg transition-colors ml-1"
            title="Refresh returns"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Returns Table */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-xs">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-2" />
          Loading returns...
        </div>
      ) : returns.length === 0 ? (
        <div className="py-12 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-400 text-xs">
          <RotateCcw className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="font-semibold text-slate-700">No returns found</p>
          <p className="mt-0.5">No return requests matching your current filter.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-3.5 py-2.5">Return #</th>
                <th className="px-3.5 py-2.5">Dealer</th>
                <th className="px-3.5 py-2.5">Original Invoice</th>
                <th className="px-3.5 py-2.5">Status</th>
                <th className="px-3.5 py-2.5 text-center">Req / Appr</th>
                <th className="px-3.5 py-2.5 text-center">Sent</th>
                <th className="px-3.5 py-2.5 text-center">Accepted</th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {returns.map(ret => (
                <tr key={ret.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-3.5 py-2.5 font-mono font-semibold text-slate-900">
                    {ret.return_number}
                    <div className="text-[11px] font-sans font-normal text-slate-400">
                      {new Date(ret.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 font-medium text-slate-800">
                    {ret.dealer_name || 'Dealer'}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-slate-600">
                    {ret.purchase_invoice_number}
                  </td>
                  <td className="px-3.5 py-2.5">{getStatusBadge(ret.status)}</td>
                  <td className="px-3.5 py-2.5 text-center">
                    <span className="font-semibold">{ret.total_requested_qty}</span>
                    <span className="text-slate-400"> / </span>
                    <span className="font-semibold text-blue-600">{ret.total_approved_qty}</span>
                  </td>
                  <td className="px-3.5 py-2.5 text-center font-semibold text-indigo-600">
                    {ret.total_sent_qty > 0 ? ret.total_sent_qty : '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-center font-semibold text-emerald-600">
                    {ret.total_accepted_qty > 0 ? ret.total_accepted_qty : '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenDetail(ret)}
                        className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
                        title="View details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      {ret.status === 'REQUESTED' && (
                        <button
                          id={`review-return-${ret.id}`}
                          onClick={() => handleOpenReview(ret)}
                          className="px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-xs"
                        >
                          Review
                        </button>
                      )}

                      {(ret.status === 'IN_TRANSIT' || ret.status === 'PARTIALLY_RECEIVED') && (
                        <button
                          id={`receive-return-${ret.id}`}
                          onClick={() => handleOpenReceive(ret)}
                          className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors shadow-xs"
                        >
                          Receive
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

      {/* REVIEW & APPROVE MODAL */}
      {reviewModalOpen && activeReturn && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Review Return Request: {activeReturn.return_number}
                  </h3>
                  <p className="text-xs text-slate-500">
                    From: {activeReturn.dealer_name} • Invoice: {activeReturn.purchase_invoice_number}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setReviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                <div>
                  <span className="text-slate-500 block">Stated Reason:</span>
                  <span className="font-semibold text-slate-900">
                    {activeReturn.return_reason?.replace('_', ' ')}
                  </span>
                </div>
                {activeReturn.notes && (
                  <div>
                    <span className="text-slate-500 block">Dealer Remarks:</span>
                    <span className="italic text-slate-700">{activeReturn.notes}</span>
                  </div>
                )}
              </div>

              {!isRejecting ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 uppercase tracking-wider text-[11px]">
                      Requested Optical Batches & Approval Quantities
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const allAppr: Record<string, number> = {};
                        for (const l of activeReturn.lines || []) {
                          allAppr[l.id] = l.requested_quantity;
                        }
                        setApprovedQuantities(allAppr);
                      }}
                      className="text-blue-600 hover:text-blue-800 font-semibold"
                    >
                      Approve 100% Requested
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">Item</th>
                          <th className="py-2 px-3">Optical Power</th>
                          <th className="py-2 px-3 text-center">Requested</th>
                          <th className="py-2 px-3 text-right">Approved Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeReturn.lines?.map((l: any) => (
                          <tr key={l.id}>
                            <td className="py-2 px-3 font-medium text-slate-800">
                              {l.item_code}
                              <div className="text-[10px] text-slate-400">{l.item_name}</div>
                            </td>
                            <td className="py-2 px-3 font-mono">
                              SPH: {l.sph ?? 0} | CYL: {l.cyl ?? 0}
                              {l.axis ? ` | AX: ${l.axis}°` : ''}
                              {l.add ? ` | ADD: +${l.add}` : ''}
                            </td>
                            <td className="py-2 px-3 text-center font-semibold text-slate-700">
                              {l.requested_quantity}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max={l.requested_quantity}
                                value={approvedQuantities[l.id] ?? l.requested_quantity}
                                onChange={e => {
                                  const val = Math.min(
                                    Math.max(0, parseFloat(e.target.value) || 0),
                                    l.requested_quantity
                                  );
                                  setApprovedQuantities(prev => ({ ...prev, [l.id]: val }));
                                }}
                                className="w-20 px-2 py-1 text-right border border-slate-300 rounded font-semibold text-xs focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Approval Notes</label>
                    <input
                      type="text"
                      placeholder="e.g. Approved. Please dispatch with original packing."
                      value={approvalNotes}
                      onChange={e => setApprovalNotes(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </>
              ) : (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-rose-800 font-bold">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Reject Return Request
                  </div>
                  <p className="text-slate-600">
                    The dealer will be notified that this return request has been rejected. No goods should be dispatched.
                  </p>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Mandatory Rejection Reason:
                    </label>
                    <textarea
                      rows={3}
                      required
                      placeholder="Specify why this return cannot be accepted..."
                      value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg bg-white text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              {!isRejecting ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsRejecting(true)}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    Reject Return...
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setReviewModalOpen(false)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      id="confirm-approve-dealer-return-btn"
                      type="button"
                      disabled={actionLoading}
                      onClick={handleSubmitApproval}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs disabled:opacity-50"
                    >
                      {actionLoading ? 'Approving...' : 'Approve Return Request'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsRejecting(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Back to Approval
                  </button>
                  <button
                    id="confirm-reject-dealer-return-btn"
                    type="button"
                    disabled={actionLoading || !rejectionReason.trim()}
                    onClick={handleSubmitRejection}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs disabled:opacity-50"
                  >
                    {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RECEIVE & INSPECT MODAL */}
      {receiveModalOpen && activeReturn && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <Boxes className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Physical Intake & Inspection: {activeReturn.return_number}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Accepted items increment Main Warehouse saleable stock. Damaged items do not enter saleable inventory.
                  </p>
                </div>
              </div>
              <button onClick={() => setReceiveModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
              <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl text-emerald-900 flex justify-between">
                <div>
                  <span className="font-semibold block">Courier / Transit Information:</span>
                  <span>{activeReturn.courier_name || 'Direct Vehicle'}</span>
                  {activeReturn.tracking_number && (
                    <span className="ml-2 font-mono">AWB: {activeReturn.tracking_number}</span>
                  )}
                </div>
                <div>
                  <span className="font-semibold block">Dispatched Date:</span>
                  <span>
                    {activeReturn.dispatch_date
                      ? new Date(activeReturn.dispatch_date).toLocaleDateString()
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Inspection Matrix */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Item & Optical Power</th>
                      <th className="py-2.5 px-3 text-center">Sent</th>
                      <th className="py-2.5 px-3 text-center">Prev. Received</th>
                      <th className="py-2.5 px-3 text-center font-bold text-slate-900">
                        Received Qty
                      </th>
                      <th className="py-2.5 px-3 text-center font-bold text-emerald-700">
                        Accepted (Stock +)
                      </th>
                      <th className="py-2.5 px-3 text-center font-bold text-rose-700">
                        Damaged / Scrap
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeReturn.lines?.map((l: any) => {
                      const lineState = receiptLines[l.id] || {
                        receivedQty: 0,
                        acceptedQty: 0,
                        damagedQty: 0,
                      };
                      const pendingToReceive = Math.max(
                        0,
                        (l.sent_quantity || 0) - (l.received_quantity || 0)
                      );

                      return (
                        <tr key={l.id} className="hover:bg-slate-50/40">
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-slate-900">{l.item_code}</span>
                            <div className="font-mono text-[11px] text-slate-500">
                              SPH: {l.sph ?? 0} | CYL: {l.cyl ?? 0}
                              {l.axis ? ` | AX: ${l.axis}°` : ''}
                              {l.add ? ` | ADD: +${l.add}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">{l.sent_quantity}</td>
                          <td className="py-2.5 px-3 text-center text-slate-400">
                            {l.received_quantity || 0}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={pendingToReceive}
                              value={lineState.receivedQty}
                              onChange={e =>
                                handleReceiptLineChange(
                                  l.id,
                                  'receivedQty',
                                  e.target.value,
                                  pendingToReceive
                                )
                              }
                              className="w-16 px-1.5 py-1 text-center border border-slate-300 rounded font-semibold focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={lineState.receivedQty}
                              value={lineState.acceptedQty}
                              onChange={e =>
                                handleReceiptLineChange(
                                  l.id,
                                  'acceptedQty',
                                  e.target.value,
                                  pendingToReceive
                                )
                              }
                              className="w-16 px-1.5 py-1 text-center border border-emerald-300 bg-emerald-50/30 rounded font-semibold text-emerald-800 focus:ring-1 focus:ring-emerald-500"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={lineState.receivedQty}
                              value={lineState.damagedQty}
                              onChange={e =>
                                handleReceiptLineChange(
                                  l.id,
                                  'damagedQty',
                                  e.target.value,
                                  pendingToReceive
                                )
                              }
                              className="w-16 px-1.5 py-1 text-center border border-rose-300 bg-rose-50/30 rounded font-semibold text-rose-800 focus:ring-1 focus:ring-rose-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Physical Inspection Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Lenses inspected on focimeter; verified power and surface coating."
                  value={receiveNotes}
                  onChange={e => setReceiveNotes(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <button
                type="button"
                onClick={() => setReceiveModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                id="confirm-receive-dealer-return-btn"
                type="button"
                disabled={actionLoading}
                onClick={handleSubmitReceive}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs disabled:opacity-50 transition-colors"
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Posting Sales Return & Updating Stock...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Confirm Receipt & Issue Credit Note
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DETAILS AUDIT MODAL */}
      {detailModalOpen && activeReturn && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Return Audit Trail: {activeReturn.return_number}
                </h3>
              </div>
              <button onClick={() => setDetailModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block">Dealer:</span>
                  <span className="font-semibold text-slate-900">{activeReturn.dealer_name}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Status:</span>
                  {getStatusBadge(activeReturn.status)}
                </div>
                <div>
                  <span className="text-slate-400 block">Purchase Invoice:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {activeReturn.purchase_invoice_number}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Main Sales Return (Credit Note):</span>
                  <span className="font-mono font-semibold text-emerald-700">
                    {activeReturn.sales_return_number || 'Pending Intake'}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-700 mb-2">Item Breakdown:</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Item</th>
                        <th className="py-2 px-3">Optical Power</th>
                        <th className="py-2 px-3 text-center">Req</th>
                        <th className="py-2 px-3 text-center">Appr</th>
                        <th className="py-2 px-3 text-center">Sent</th>
                        <th className="py-2 px-3 text-center">Accepted</th>
                        <th className="py-2 px-3 text-center">Damaged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeReturn.lines?.map((l: any) => (
                        <tr key={l.id}>
                          <td className="py-2 px-3 font-medium text-slate-900">{l.item_code}</td>
                          <td className="py-2 px-3 font-mono text-[11px]">
                            SPH: {l.sph ?? 0} | CYL: {l.cyl ?? 0}
                          </td>
                          <td className="py-2 px-3 text-center">{l.requested_quantity}</td>
                          <td className="py-2 px-3 text-center text-blue-600 font-medium">
                            {l.approved_quantity}
                          </td>
                          <td className="py-2 px-3 text-center text-indigo-600 font-medium">
                            {l.sent_quantity}
                          </td>
                          <td className="py-2 px-3 text-center text-emerald-600 font-medium">
                            {l.accepted_quantity}
                          </td>
                          <td className="py-2 px-3 text-center text-rose-600 font-medium">
                            {l.damaged_quantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end bg-slate-50/50">
              <button
                onClick={() => setDetailModalOpen(false)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
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
