import React, { useState, useEffect, useCallback } from 'react';
import {
  RotateCcw,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Plus,
  Search,
  Filter,
  Eye,
  Send,
  FileText,
  Building2,
  ChevronRight,
  Boxes,
  RefreshCw,
  X,
  AlertCircle,
  Calendar,
  Layers,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';

interface DealerReturnsPageProps {
  onNavigate?: (path: string) => void;
}

export const DealerReturnsPage: React.FC<DealerReturnsPageProps> = ({ onNavigate }) => {
  const { currentBusiness } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Returns list
  const [returns, setReturns] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState(false);

  // Selected Return
  const [selectedReturn, setSelectedReturn] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create Return Wizard State
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [returnableInvoices, setReturnableInvoices] = useState<any[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [invoiceDetails, setInvoiceDetails] = useState<any | null>(null);
  const [loadingInvoiceDetails, setLoadingInvoiceDetails] = useState(false);
  const [returnReason, setReturnReason] = useState('DEFECTIVE');
  const [customReason, setCustomReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [lineQuantities, setLineQuantities] = useState<Record<string, number>>({});
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Dispatch Modal State
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [courierName, setCourierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchQuantities, setDispatchQuantities] = useState<Record<string, number>>({});
  const [submittingDispatch, setSubmittingDispatch] = useState(false);

  // Cancel action state
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Fetch returns list
  const fetchReturns = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await apiRequest<{ success: boolean; returns: any[] }>(
        `/api/dealer/returns?${params.toString()}`
      );
      setReturns(res.returns || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load returns list');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  // Load Returnable Invoices when Create Modal Opens
  const handleOpenCreateModal = async () => {
    setShowCreateModal(true);
    setSelectedInvoiceId('');
    setInvoiceDetails(null);
    setLineQuantities({});
    setReturnReason('DEFECTIVE');
    setCustomReason('');
    setReturnNotes('');
    setInvoicesLoading(true);

    try {
      const res = await apiRequest<{ success: boolean; invoices: any[] }>(
        '/api/dealer/returns/returnable-invoices'
      );
      setReturnableInvoices(res.invoices || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load eligible purchase invoices');
    } finally {
      setInvoicesLoading(false);
    }
  };

  // Load Breakdown when invoice selected
  const handleSelectInvoice = async (invId: string) => {
    setSelectedInvoiceId(invId);
    if (!invId) {
      setInvoiceDetails(null);
      setLineQuantities({});
      return;
    }

    setLoadingInvoiceDetails(true);
    try {
      const res = await apiRequest<any>(`/api/dealer/returns/returnable-invoice/${invId}`);
      setInvoiceDetails(res);
      // Pre-fill 0 quantities for all batches
      const initialQtys: Record<string, number> = {};
      if (res.lines) {
        for (const line of res.lines) {
          if (line.batches) {
            for (const b of line.batches) {
              const key = `${line.lineId}_${b.batchId}`;
              initialQtys[key] = 0;
            }
          }
        }
      }
      setLineQuantities(initialQtys);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoice items');
    } finally {
      setLoadingInvoiceDetails(false);
    }
  };

  // Handle Quantity Change for a batch
  const handleQtyChange = (lineId: string, batchId: string, val: string, max: number, unit: string) => {
    const num = parseFloat(val);
    const key = `${lineId}_${batchId}`;
    if (isNaN(num) || num < 0) {
      setLineQuantities(prev => ({ ...prev, [key]: 0 }));
      return;
    }
    const clamped = Math.min(num, max);
    setLineQuantities(prev => ({ ...prev, [key]: clamped }));
  };

  // Submit Return Request
  const handleSubmitReturnRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceId || !invoiceDetails) {
      setError('Please select a purchase invoice');
      return;
    }

    const effectiveReason = returnReason === 'OTHER' ? customReason.trim() : returnReason;
    if (!effectiveReason) {
      setError('Please specify a return reason');
      return;
    }

    // Build line requests
    const linesToReturn: any[] = [];
    for (const line of invoiceDetails.lines || []) {
      for (const b of line.batches || []) {
        const key = `${line.lineId}_${b.batchId}`;
        const qty = lineQuantities[key] || 0;
        if (qty > 0) {
          linesToReturn.push({
            dealerPurchaseInvoiceLineId: line.lineId,
            dealerUniqueItemId: line.uniqueItemId,
            dealerBatchId: b.batchId,
            requestedQuantity: qty,
            reason: effectiveReason,
          });
        }
      }
    }

    if (linesToReturn.length === 0) {
      setError('Please enter a return quantity greater than 0 for at least one item');
      return;
    }

    setSubmittingCreate(true);
    setError(null);
    try {
      const res = await apiRequest<{ success: boolean; message: string; dealerReturn: any }>(
        '/api/dealer/returns',
        {
          method: 'POST',
          body: JSON.stringify({
            dealerPurchaseInvoiceId: selectedInvoiceId,
            returnReason: effectiveReason,
            notes: returnNotes.trim() || undefined,
            lines: linesToReturn,
          }),
        }
      );

      setSuccessMsg(res.message);
      setShowCreateModal(false);
      fetchReturns();
    } catch (err: any) {
      setError(err.message || 'Failed to submit return request');
    } finally {
      setSubmittingCreate(false);
    }
  };

  // View Return Details
  const handleViewDetails = async (returnId: string) => {
    setDetailLoading(true);
    setShowDetailModal(true);
    try {
      const res = await apiRequest<{ success: boolean; dealerReturn: any }>(
        `/api/dealer/returns/${returnId}`
      );
      setSelectedReturn(res.dealerReturn);
    } catch (err: any) {
      setError(err.message || 'Failed to load return details');
    } finally {
      setDetailLoading(false);
    }
  };

  // Open Dispatch Modal
  const handleOpenDispatch = (ret: any) => {
    setSelectedReturn(ret);
    setDispatchDate(new Date().toISOString().slice(0, 10));
    setCourierName('');
    setTrackingNumber('');
    setDispatchNotes('');

    // Pre-fill approved quantities
    const qtys: Record<string, number> = {};
    if (ret.lines) {
      for (const l of ret.lines) {
        qtys[l.id] = l.approved_quantity || 0;
      }
    }
    setDispatchQuantities(qtys);
    setShowDispatchModal(true);
  };

  // Submit Dispatch (Executes Purchase Return & Decrements Stock)
  const handleSubmitDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReturn) return;

    setSubmittingDispatch(true);
    setError(null);
    try {
      const lines = Object.entries(dispatchQuantities).map(([lineId, sentQty]) => ({
        lineId,
        sentQuantity: sentQty,
      }));

      const res = await apiRequest<{ success: boolean; message: string; dealerReturn: any }>(
        `/api/dealer/returns/${selectedReturn.id}/dispatch`,
        {
          method: 'POST',
          body: JSON.stringify({
            dispatchDate,
            courierName: courierName.trim() || undefined,
            trackingNumber: trackingNumber.trim() || undefined,
            notes: dispatchNotes.trim() || undefined,
            lines,
          }),
        }
      );

      setSuccessMsg(res.message);
      setShowDispatchModal(false);
      fetchReturns();
      if (showDetailModal && selectedReturn?.id === res.dealerReturn.id) {
        setSelectedReturn(res.dealerReturn);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch return');
    } finally {
      setSubmittingDispatch(false);
    }
  };

  // Cancel Return
  const handleCancelReturn = async (returnId: string) => {
    if (!confirm('Are you sure you want to cancel this return request?')) return;
    setCancellingId(returnId);
    setError(null);
    try {
      const res = await apiRequest<{ success: boolean; message: string; dealerReturn: any }>(
        `/api/dealer/returns/${returnId}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'Cancelled by Dealer' }),
        }
      );
      setSuccessMsg(res.message);
      fetchReturns();
      if (showDetailModal && selectedReturn?.id === returnId) {
        setSelectedReturn(res.dealerReturn);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel return');
    } finally {
      setCancellingId(null);
    }
  };

  // Status Badge Component
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'REQUESTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5" />
            Requested (Pending Approval)
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approved (Ready to Dispatch)
          </span>
        );
      case 'IN_TRANSIT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Truck className="w-3.5 h-3.5" />
            In Transit (Dispatched)
          </span>
        );
      case 'PARTIALLY_RECEIVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
            <Boxes className="w-3.5 h-3.5" />
            Partially Received
          </span>
        );
      case 'RECEIVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Received & Credited
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5" />
            Rejected by Main
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600 border border-zinc-200">
            <X className="w-3.5 h-3.5" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-50 text-zinc-700 border border-zinc-200">
            {status}
          </span>
        );
    }
  };

  return (
    <div id="dealer-returns-page" className="min-h-screen bg-zinc-50 p-4 md:p-6 lg:p-8">
      {/* Top Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-zinc-200 text-zinc-700">
                <Building2 className="w-3 h-3" />
                {currentBusiness?.name || 'Dealer Business'}
              </span>
              <span className="text-xs text-zinc-500">• Inter-Business Returns</span>
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
              <RotateCcw className="w-6 h-6 text-zinc-800" />
              Returns to Main Warehouse
            </h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Request controlled returns against original Purchase Invoices. Stock decreases upon dispatch, and credit notes are issued upon physical acceptance by Main Warehouse.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              id="refresh-returns-btn"
              onClick={() => {
                setRefreshing(true);
                fetchReturns();
              }}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <button
              id="new-return-request-btn"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Return Request
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="max-w-7xl mx-auto mb-4">
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm flex items-center justify-between">
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
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Filters Bar */}
        <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="returns-search-input"
              type="text"
              placeholder="Search return #, invoice #..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
            <span className="text-xs font-medium text-zinc-500 flex items-center gap-1 shrink-0">
              <Filter className="w-3.5 h-3.5" /> Status:
            </span>
            {[
              { id: 'ALL', label: 'All' },
              { id: 'REQUESTED', label: 'Requested' },
              { id: 'APPROVED', label: 'Approved' },
              { id: 'IN_TRANSIT', label: 'In Transit' },
              { id: 'RECEIVED', label: 'Received' },
              { id: 'REJECTED', label: 'Rejected' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Returns Table */}
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-zinc-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-zinc-400" />
              <p className="text-sm">Loading returns history...</p>
            </div>
          ) : returns.length === 0 ? (
            <div className="py-16 text-center text-zinc-500">
              <RotateCcw className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
              <p className="text-base font-semibold text-zinc-700">No returns found</p>
              <p className="text-sm text-zinc-400 max-w-sm mx-auto mt-1">
                You have not initiated any return requests to Main Warehouse yet.
              </p>
              <button
                onClick={handleOpenCreateModal}
                className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium text-zinc-900 bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors"
              >
                <Plus className="w-4 h-4" /> Create Return Request
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200 text-zinc-500 text-xs uppercase tracking-wider font-semibold">
                    <th className="py-3 px-4">Return #</th>
                    <th className="py-3 px-4">Original Purchase Invoice</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-center">Requested Qty</th>
                    <th className="py-3 px-4 text-center">Approved Qty</th>
                    <th className="py-3 px-4 text-center">Sent Qty</th>
                    <th className="py-3 px-4 text-center">Accepted Qty</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-zinc-700">
                  {returns.map(ret => (
                    <tr key={ret.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-semibold text-zinc-900">
                        {ret.return_number}
                        <div className="text-[11px] text-zinc-400 font-sans font-normal">
                          {new Date(ret.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-medium text-zinc-800">{ret.purchase_invoice_number}</span>
                        <div className="text-xs text-zinc-500">
                          {ret.return_reason?.replace('_', ' ')}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">{getStatusBadge(ret.status)}</td>
                      <td className="py-3.5 px-4 text-center font-medium">
                        {ret.total_requested_qty} PRS
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-blue-700">
                        {ret.total_approved_qty > 0 ? `${ret.total_approved_qty} PRS` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-indigo-700">
                        {ret.total_sent_qty > 0 ? `${ret.total_sent_qty} PRS` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-emerald-700">
                        {ret.total_accepted_qty > 0 ? `${ret.total_accepted_qty} PRS` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            id={`view-return-${ret.id}`}
                            onClick={() => handleViewDetails(ret.id)}
                            className="p-1.5 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
                            title="View Return Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {ret.status === 'APPROVED' && (
                            <button
                              id={`dispatch-return-${ret.id}`}
                              onClick={() => handleOpenDispatch(ret)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-xs transition-colors"
                              title="Dispatch Approved Return"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Dispatch
                            </button>
                          )}

                          {(ret.status === 'REQUESTED' || ret.status === 'APPROVED') && (
                            <button
                              id={`cancel-return-${ret.id}`}
                              onClick={() => handleCancelReturn(ret.id)}
                              disabled={cancellingId === ret.id}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Cancel Return Request"
                            >
                              <XCircle className="w-4 h-4" />
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
      </div>

      {/* CREATE RETURN MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="p-4 md:p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center shadow-xs">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900">Initiate Return Request</h2>
                  <p className="text-xs text-zinc-500">
                    Step 1: Select purchase invoice • Step 2: Choose batch quantities to return
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-5">
              {/* Select Purchase Invoice */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1.5">
                  1. Select Eligible Purchase Invoice from Main Warehouse
                </label>
                {invoicesLoading ? (
                  <div className="py-3 text-center text-sm text-zinc-400">Loading eligible invoices...</div>
                ) : returnableInvoices.length === 0 ? (
                  <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-xs border border-amber-200">
                    No eligible posted Purchase Invoices found from Main Warehouse.
                  </div>
                ) : (
                  <select
                    id="select-purchase-invoice-return"
                    value={selectedInvoiceId}
                    onChange={e => handleSelectInvoice(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                  >
                    <option value="">-- Choose a Purchase Invoice --</option>
                    {returnableInvoices.map(inv => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} • Date: {new Date(inv.invoice_date).toLocaleDateString()} • Items: {inv.lines_count} • Qty: {inv.total_quantity} • ₹{inv.grand_total.toFixed(2)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Invoice Breakdown and Optical Batches */}
              {loadingInvoiceDetails && (
                <div className="py-8 text-center text-zinc-400 text-sm flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading optical line powers and remaining returnable quantities...
                </div>
              )}

              {invoiceDetails && !loadingInvoiceDetails && (
                <div className="space-y-4">
                  {/* Return Reasons */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1.5">
                        2. Return Reason
                      </label>
                      <select
                        value={returnReason}
                        onChange={e => setReturnReason(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                      >
                        <option value="DEFECTIVE">Defective / Optical Distortion / Coating Issue</option>
                        <option value="WRONG_POWER">Wrong Power / Axis Shipped</option>
                        <option value="DAMAGED_TRANSIT">Damaged during transit</option>
                        <option value="OVERSTOCK">Overstock / Slow Moving Stock</option>
                        <option value="ORDER_CANCELLED">Patient Order Cancelled</option>
                        <option value="OTHER">Other Reason</option>
                      </select>
                    </div>

                    {returnReason === 'OTHER' && (
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1.5">
                          Specify Reason
                        </label>
                        <input
                          type="text"
                          value={customReason}
                          onChange={e => setCustomReason(e.target.value)}
                          placeholder="State exact return reason"
                          className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1.5">
                      3. Return Notes / Remarks (Optional)
                    </label>
                    <input
                      type="text"
                      value={returnNotes}
                      onChange={e => setReturnNotes(e.target.value)}
                      placeholder="e.g. Returned with original manufacturer seal and pouch"
                      className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm"
                    />
                  </div>

                  {/* Optical Line Breakdown */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                        4. Optical Batches & Return Quantities
                      </label>
                      <span className="text-xs text-zinc-400">
                        PRS: 0.5 step quantities • Max returnable enforced
                      </span>
                    </div>

                    <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white shadow-xs">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase">
                            <th className="py-2.5 px-3">Item / Category</th>
                            <th className="py-2.5 px-3">Optical Prescription</th>
                            <th className="py-2.5 px-3 text-center">Purchased</th>
                            <th className="py-2.5 px-3 text-center">Prev. Returned</th>
                            <th className="py-2.5 px-3 text-center">Max Returnable</th>
                            <th className="py-2.5 px-3 text-right">Return Qty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 text-zinc-700">
                          {invoiceDetails.lines?.map((line: any) =>
                            line.batches?.map((b: any) => {
                              const key = `${line.lineId}_${b.batchId}`;
                              const val = lineQuantities[key] ?? 0;
                              const isEligible = b.maximumReturnable > 0;

                              return (
                                <tr key={key} className={!isEligible ? 'bg-zinc-50/50 opacity-60' : 'hover:bg-zinc-50/30'}>
                                  <td className="py-2.5 px-3 font-medium text-zinc-900">
                                    {line.itemCode}
                                    <div className="text-[11px] text-zinc-400">{line.itemName}</div>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono">
                                    <span className="font-semibold text-zinc-800">
                                      SPH: {b.sph !== null ? (b.sph > 0 ? `+${b.sph}` : b.sph) : '0.00'}
                                    </span>
                                    {b.cyl !== null && b.cyl !== 0 && (
                                      <span className="ml-2 text-zinc-600">CYL: {b.cyl > 0 ? `+${b.cyl}` : b.cyl}</span>
                                    )}
                                    {b.axis !== null && b.axis !== 0 && (
                                      <span className="ml-2 text-zinc-600">AX: {b.axis}°</span>
                                    )}
                                    {b.add !== null && b.add !== 0 && (
                                      <span className="ml-2 text-zinc-600">ADD: +{b.add}</span>
                                    )}
                                    {b.side && b.side !== 'NONE' && (
                                      <span className="ml-2 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[10px]">
                                        {b.side}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-center">{b.purchasedQuantity}</td>
                                  <td className="py-2.5 px-3 text-center text-zinc-400">
                                    {b.postedReturnedQuantity + b.pendingReturnedQuantity}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-semibold text-emerald-700">
                                    {b.maximumReturnable} {line.unit}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    {isEligible ? (
                                      <input
                                        type="number"
                                        step={line.unit === 'PCS' ? '1' : '0.5'}
                                        min="0"
                                        max={b.maximumReturnable}
                                        value={val || ''}
                                        onChange={e =>
                                          handleQtyChange(
                                            line.lineId,
                                            b.batchId,
                                            e.target.value,
                                            b.maximumReturnable,
                                            line.unit
                                          )
                                        }
                                        placeholder="0"
                                        className="w-20 px-2 py-1 text-right border border-zinc-300 rounded font-semibold text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                                      />
                                    ) : (
                                      <span className="text-zinc-400 text-xs italic">Fully Returned</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 md:p-6 border-t border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>

              <button
                id="submit-dealer-return-request"
                type="button"
                disabled={submittingCreate || !invoiceDetails}
                onClick={handleSubmitReturnRequest}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition-colors shadow-sm"
              >
                {submittingCreate ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Submit Return Request
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DISPATCH RETURN MODAL */}
      {showDispatchModal && selectedReturn && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl max-w-xl w-full p-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-zinc-900">
                    Dispatch Approved Return: {selectedReturn.return_number}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Decrements Dealer stock and records Purchase Return debit note
                  </p>
                </div>
              </div>
              <button onClick={() => setShowDispatchModal(false)} className="text-zinc-400 hover:text-zinc-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitDispatch} className="space-y-4">
              <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs text-indigo-900">
                <p className="font-semibold mb-1">Approved Return Quantities by Main Warehouse:</p>
                <div className="space-y-1">
                  {selectedReturn.lines?.map((l: any) => (
                    <div key={l.id} className="flex justify-between">
                      <span>{l.item_code} (SPH: {l.sph}, CYL: {l.cyl}):</span>
                      <span className="font-semibold">{l.approved_quantity} {l.unit || 'PRS'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                    Dispatch Date
                  </label>
                  <input
                    type="date"
                    required
                    value={dispatchDate}
                    onChange={e => setDispatchDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-zinc-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                    Courier / Delivery Partner
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. BlueDart, DTDC, Local"
                    value={courierName}
                    onChange={e => setCourierName(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-zinc-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  Airway Bill / Tracking Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. AWB-98234827"
                  value={trackingNumber}
                  onChange={e => setTrackingNumber(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-zinc-300 rounded-lg text-sm"
                />
              </div>

              <div className="pt-3 border-t border-zinc-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  id="confirm-dispatch-dealer-return"
                  type="submit"
                  disabled={submittingDispatch}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors shadow-sm"
                >
                  {submittingDispatch ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Deducting Stock...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Confirm & Dispatch Return
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL MODAL */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
            <div className="p-4 md:p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-800 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900">
                    {selectedReturn ? selectedReturn.return_number : 'Return Details'}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Audit trail & document linkage
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDetailModal(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-5">
              {detailLoading || !selectedReturn ? (
                <div className="py-12 text-center text-zinc-400 text-sm">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-zinc-300" />
                  Loading details...
                </div>
              ) : (
                <>
                  {/* Status Timeline */}
                  <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200/80">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                        Current Status
                      </span>
                      {getStatusBadge(selectedReturn.status)}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-zinc-400 block">Requested Date:</span>
                        <span className="font-semibold text-zinc-800">
                          {new Date(selectedReturn.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 block">Approved By:</span>
                        <span className="font-semibold text-zinc-800">
                          {selectedReturn.approved_by_name || 'Pending Review'}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 block">Dispatch Date:</span>
                        <span className="font-semibold text-zinc-800">
                          {selectedReturn.dispatch_date
                            ? new Date(selectedReturn.dispatch_date).toLocaleDateString()
                            : 'Not yet dispatched'}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 block">Courier / AWB:</span>
                        <span className="font-semibold text-zinc-800">
                          {selectedReturn.courier_name
                            ? `${selectedReturn.courier_name} (${selectedReturn.tracking_number || 'N/A'})`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Linked Accounting Documents */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-white border border-zinc-200 rounded-xl shadow-xs">
                      <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block">
                        Source Purchase Invoice
                      </span>
                      <span className="font-semibold text-sm text-zinc-900 font-mono mt-0.5 block">
                        {selectedReturn.purchase_invoice_number}
                      </span>
                    </div>

                    <div className="p-3 bg-white border border-zinc-200 rounded-xl shadow-xs">
                      <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block">
                        Dealer Purchase Return (Stock -)
                      </span>
                      <span className="font-semibold text-sm text-indigo-700 font-mono mt-0.5 block">
                        {selectedReturn.purchase_return_number || 'Pending Dispatch'}
                      </span>
                    </div>

                    <div className="p-3 bg-white border border-zinc-200 rounded-xl shadow-xs">
                      <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block">
                        Main Sales Return (Credit Note)
                      </span>
                      <span className="font-semibold text-sm text-emerald-700 font-mono mt-0.5 block">
                        {selectedReturn.sales_return_number || 'Pending Receipt'}
                      </span>
                    </div>
                  </div>

                  {/* Rejection notice if any */}
                  {selectedReturn.rejection_reason && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                      <div>
                        <span className="font-bold">Rejection Reason from Main Warehouse:</span>
                        <p className="mt-0.5">{selectedReturn.rejection_reason}</p>
                      </div>
                    </div>
                  )}

                  {/* Lines Breakdown */}
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-2">
                      Returned Optical Line Items
                    </h3>
                    <div className="border border-zinc-200 rounded-xl overflow-hidden shadow-xs bg-white">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold uppercase">
                            <th className="py-2.5 px-3">Item</th>
                            <th className="py-2.5 px-3">Prescription</th>
                            <th className="py-2.5 px-3 text-center">Requested</th>
                            <th className="py-2.5 px-3 text-center">Approved</th>
                            <th className="py-2.5 px-3 text-center">Sent</th>
                            <th className="py-2.5 px-3 text-center">Accepted</th>
                            <th className="py-2.5 px-3 text-center">Damaged</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 text-zinc-700">
                          {selectedReturn.lines?.map((l: any) => (
                            <tr key={l.id}>
                              <td className="py-2.5 px-3 font-medium text-zinc-900">
                                {l.item_code}
                                <div className="text-[11px] text-zinc-400">{l.item_name}</div>
                              </td>
                              <td className="py-2.5 px-3 font-mono">
                                SPH: {l.sph ?? 0} | CYL: {l.cyl ?? 0}
                                {l.axis ? ` | AX: ${l.axis}°` : ''}
                                {l.add ? ` | ADD: +${l.add}` : ''}
                              </td>
                              <td className="py-2.5 px-3 text-center font-medium">{l.requested_quantity}</td>
                              <td className="py-2.5 px-3 text-center font-medium text-blue-700">
                                {l.approved_quantity}
                              </td>
                              <td className="py-2.5 px-3 text-center font-medium text-indigo-700">
                                {l.sent_quantity}
                              </td>
                              <td className="py-2.5 px-3 text-center font-medium text-emerald-700">
                                {l.accepted_quantity}
                              </td>
                              <td className="py-2.5 px-3 text-center font-medium text-rose-700">
                                {l.damaged_quantity}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="p-4 md:p-6 border-t border-zinc-100 flex items-center justify-end bg-zinc-50/50">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50"
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
