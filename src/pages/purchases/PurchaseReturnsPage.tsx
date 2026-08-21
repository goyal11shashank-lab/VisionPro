import React, { useState, useEffect } from 'react';
import {
  RotateCcw,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileSpreadsheet,
  Boxes,
  RefreshCw,
  Eye,
  Ban,
  Building2,
  Layers,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';

interface PurchaseReturn {
  id: string;
  businessId: string;
  purchaseInvoiceId: string;
  supplierPartyId: string;
  returnNumber: string;
  returnDate: string;
  subtotal: string;
  discountTotal: string;
  taxableAmount: string;
  igstAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  roundOff: string;
  grandTotal: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  reason?: string;
  notes?: string;
  createdAt: string;
  supplier?: {
    id: string;
    name: string;
    phone?: string;
    city?: string;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    grandTotal: string;
  };
  lines?: any[];
}

export const PurchaseReturnsPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Creation modal state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [invoicesList, setInvoicesList] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState<boolean>(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [invoiceSummary, setInvoiceSummary] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState<boolean>(false);

  // Return Line input state
  const [returnLines, setReturnLines] = useState<
    Array<{
      purchaseInvoiceLineId: string;
      uniqueItemId: string;
      productName: string;
      purchasedQty: number;
      returnableQty: number;
      rate: number;
      gstRate: number;
      returnQty: number;
      batches: Array<{
        batchId: string;
        purchaseLotId?: string;
        batchNumber: string;
        purchasedQty: number;
        returnableQty: number;
        rate: number;
        returnQty: number;
      }>;
    }>
  >([]);

  const [returnReason, setReturnReason] = useState<string>('');
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // View Details Modal
  const [viewReturn, setViewReturn] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // Cancel Modal
  const [cancelReturnId, setCancelReturnId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelling, setCancelling] = useState<boolean>(false);

  const fetchReturns = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (statusFilter !== 'ALL') params.append('status', statusFilter);

      const res = await apiRequest<{ items: PurchaseReturn[]; total: number }>(
        `/api/purchases/returns?${params.toString()}`
      );
      setReturns(res.items || []);
    } catch (err: any) {
      console.error('Failed to load purchase returns', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReturns();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReturns();
  };

  // Open Create Modal: Fetch POSTED purchase invoices
  const handleOpenCreateModal = async () => {
    setShowCreateModal(true);
    setSelectedInvoiceId('');
    setInvoiceSummary(null);
    setReturnLines([]);
    setReturnReason('');
    setReturnNotes('');
    setErrorMsg('');

    try {
      setLoadingInvoices(true);
      const res = await apiRequest<{ items: any[] }>(`/api/purchases?status=POSTED&limit=50`);
      setInvoicesList(res.items || []);
    } catch (err: any) {
      setErrorMsg('Failed to load posted purchase invoices: ' + err.message);
    } finally {
      setLoadingInvoices(false);
    }
  };

  // Select Purchase Invoice & Load Summary
  const handleSelectInvoice = async (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    setErrorMsg('');
    try {
      setLoadingSummary(true);
      const data = await apiRequest<any>(`/api/purchases/returns/invoice-summary/${invoiceId}`);
      setInvoiceSummary(data);

      // Pre-fill returnable lines
      const initializedLines = (data.lines || []).map((l: any) => ({
        purchaseInvoiceLineId: l.id,
        uniqueItemId: l.uniqueItemId,
        productName: l.uniqueItem?.name || 'Optical Item',
        purchasedQty: l.purchasedQuantity,
        returnableQty: l.returnableQuantity,
        rate: parseFloat(l.rate),
        gstRate: parseFloat(l.gstRate || '0'),
        returnQty: 0,
        batches: (l.batches || []).map((b: any) => ({
          batchId: b.batchId,
          purchaseLotId: b.purchaseLot?.id,
          batchNumber: b.batch?.batchNumber || 'Batch',
          purchasedQty: b.purchasedQuantity,
          returnableQty: b.returnableQuantity,
          rate: parseFloat(b.rate || l.rate),
          returnQty: 0,
        })),
      }));

      setReturnLines(initializedLines);
    } catch (err: any) {
      setErrorMsg('Failed to load purchase invoice items: ' + err.message);
    } finally {
      setLoadingSummary(false);
    }
  };

  // Update batch quantity and sync line quantity
  const handleBatchQtyChange = (lineIndex: number, batchIndex: number, val: number) => {
    const updated = [...returnLines];
    const line = updated[lineIndex];
    const b = line.batches[batchIndex];

    const safeVal = Math.max(0, Math.min(b.returnableQty, val));
    b.returnQty = safeVal;

    // Sum all batches for this line
    line.returnQty = line.batches.reduce((sum, item) => sum + (item.returnQty || 0), 0);
    setReturnLines(updated);
  };

  // Calculate live summary
  const calculateLiveTotals = () => {
    let subtotal = 0;
    let taxAmount = 0;

    for (const line of returnLines) {
      if (line.returnQty > 0) {
        const lineSubtotal = line.returnQty * line.rate;
        const lineTax = (lineSubtotal * line.gstRate) / 100;
        subtotal += lineSubtotal;
        taxAmount += lineTax;
      }
    }

    const totalBeforeRound = subtotal + taxAmount;
    const grandTotal = Math.round(totalBeforeRound);
    const roundOff = grandTotal - totalBeforeRound;

    return {
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      roundOff: roundOff.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      hasItems: returnLines.some(l => l.returnQty > 0),
    };
  };

  const totals = calculateLiveTotals();

  // Create Return Submit
  const handleCreateSubmit = async (shouldPost: boolean) => {
    setErrorMsg('');
    const activeLines = returnLines.filter(l => l.returnQty > 0);
    if (activeLines.length === 0) {
      setErrorMsg('Please enter a return quantity for at least one item.');
      return;
    }

    for (const l of activeLines) {
      const batchSum = l.batches.reduce((sum, b) => sum + (b.returnQty || 0), 0);
      if (Math.abs(batchSum - l.returnQty) > 0.001) {
        setErrorMsg(`Item "${l.productName}": batch allocations sum (${batchSum}) must equal return quantity (${l.returnQty}).`);
        return;
      }
    }

    try {
      setSubmitting(true);
      const payload = {
        purchaseInvoiceId: selectedInvoiceId,
        status: shouldPost ? 'POSTED' : 'DRAFT',
        reason: returnReason,
        notes: returnNotes,
        lines: activeLines.map(l => ({
          purchaseInvoiceLineId: l.purchaseInvoiceLineId,
          uniqueItemId: l.uniqueItemId,
          quantity: l.returnQty,
          rate: l.rate,
          gstRate: l.gstRate,
          batches: l.batches
            .filter(b => b.returnQty > 0)
            .map(b => ({
              batchId: b.batchId,
              purchaseLotId: b.purchaseLotId,
              quantity: b.returnQty,
              rate: b.rate,
            })),
        })),
      };

      await apiRequest('/api/purchases/returns', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setShowCreateModal(false);
      fetchReturns();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create purchase return');
    } finally {
      setSubmitting(false);
    }
  };

  // View Details
  const handleViewDetails = async (id: string) => {
    try {
      setLoadingDetail(true);
      const data = await apiRequest<any>(`/api/purchases/returns/${id}`);
      setViewReturn(data);
    } catch (err: any) {
      alert('Failed to load details: ' + err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Post Draft Return
  const handlePostReturn = async (id: string) => {
    if (!confirm('Are you sure you want to POST this Purchase Return? This will deduct stock from batches and reduce supplier outstanding.')) {
      return;
    }
    try {
      await apiRequest(`/api/purchases/returns/${id}/post`, { method: 'POST' });
      fetchReturns();
      if (viewReturn?.id === id) {
        handleViewDetails(id);
      }
    } catch (err: any) {
      alert('Failed to post purchase return: ' + err.message);
    }
  };

  // Cancel Return Submit
  const handleCancelSubmit = async () => {
    if (!cancelReturnId) return;
    try {
      setCancelling(true);
      await apiRequest(`/api/purchases/returns/${cancelReturnId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason }),
      });
      setCancelReturnId(null);
      setCancelReason('');
      fetchReturns();
      if (viewReturn?.id === cancelReturnId) {
        handleViewDetails(cancelReturnId);
      }
    } catch (err: any) {
      alert('Failed to cancel purchase return: ' + err.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Purchase Returns & Debit Notes</h1>
              <p className="text-sm text-slate-400">
                Return defective optical goods to suppliers, deduct stock from lots, and issue GST debit notes.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchReturns}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm transition-colors shadow-lg shadow-amber-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>New Purchase Return</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-slate-900/50 p-4 border border-slate-800/80 rounded-xl">
        <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search return #, supplier, bill..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
          />
        </form>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status:</span>
          {['ALL', 'POSTED', 'DRAFT', 'CANCELLED'].map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === st
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Returns Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4">Debit Note #</th>
                <th className="py-3.5 px-4">Purchase Bill #</th>
                <th className="py-3.5 px-4">Supplier</th>
                <th className="py-3.5 px-4">Return Date</th>
                <th className="py-3.5 px-4 text-right">Taxable</th>
                <th className="py-3.5 px-4 text-right">Grand Total</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
                    Loading purchase returns...
                  </td>
                </tr>
              ) : returns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No purchase returns found matching current filters.
                  </td>
                </tr>
              ) : (
                returns.map(ret => (
                  <tr key={ret.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-amber-400">
                      {ret.returnNumber}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {ret.invoice?.invoiceNumber || '-'}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-white">{ret.supplier?.name || 'Supplier'}</div>
                      <div className="text-xs text-slate-500">{ret.supplier?.city}</div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {new Date(ret.returnDate).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono">
                      ₹{parseFloat(ret.taxableAmount || '0').toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-white">
                      ₹{parseFloat(ret.grandTotal || '0').toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          ret.status === 'POSTED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : ret.status === 'DRAFT'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}
                      >
                        {ret.status === 'POSTED' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {ret.status === 'DRAFT' && <Clock className="w-3.5 h-3.5" />}
                        {ret.status === 'CANCELLED' && <XCircle className="w-3.5 h-3.5" />}
                        {ret.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewDetails(ret.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {ret.status === 'DRAFT' && (
                          <button
                            onClick={() => handlePostReturn(ret.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-xs font-medium border border-emerald-500/30 transition-all"
                          >
                            Post
                          </button>
                        )}
                        {ret.status !== 'CANCELLED' && (
                          <button
                            onClick={() => {
                              setCancelReturnId(ret.id);
                              setCancelReason('');
                            }}
                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors"
                            title="Cancel Return"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE RETURN MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl my-8">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">Create Purchase Return (Debit Note)</h3>
                  <p className="text-xs text-slate-400">
                    Select a posted purchase bill and specify items/batches to return to vendor.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {errorMsg && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-sm flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Step 1: Choose Invoice */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  1. Select Original Purchase Bill *
                </label>
                {loadingInvoices ? (
                  <div className="text-sm text-slate-400 py-3">Loading posted purchase bills...</div>
                ) : (
                  <select
                    value={selectedInvoiceId}
                    onChange={e => handleSelectInvoice(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="">-- Choose Posted Purchase Bill --</option>
                    {invoicesList.map(inv => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} — {inv.supplierParty?.name || inv.supplier?.name || 'Vendor'} — ₹{parseFloat(inv.grandTotal).toLocaleString('en-IN')} ({new Date(inv.invoiceDate).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Invoice Summary Header if selected */}
              {loadingSummary ? (
                <div className="py-8 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
                  Loading bill item history & costing lots...
                </div>
              ) : invoiceSummary && (
                <div className="space-y-6">
                  <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <div className="text-slate-500 uppercase">Supplier</div>
                      <div className="font-semibold text-white text-sm mt-0.5">{invoiceSummary.supplier?.name}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 uppercase">Bill Date</div>
                      <div className="font-medium text-slate-300 mt-0.5">
                        {new Date(invoiceSummary.invoice?.invoiceDate).toLocaleDateString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 uppercase">Bill Amount</div>
                      <div className="font-mono font-medium text-slate-200 mt-0.5">
                        ₹{parseFloat(invoiceSummary.invoice?.grandTotal || '0').toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 uppercase">Return Status</div>
                      <div className="font-medium text-emerald-400 mt-0.5">
                        {invoiceSummary.isEligible ? 'Eligible for Return' : 'Fully Returned'}
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Return Items and Batches */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      2. Return Item & Purchase Lot Allocations *
                    </label>
                    <div className="space-y-4">
                      {returnLines.map((line, lIdx) => (
                        <div
                          key={line.purchaseInvoiceLineId}
                          className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                            <div>
                              <span className="font-semibold text-white">{line.productName}</span>
                              <span className="ml-2 text-xs text-slate-400">
                                (Rate: ₹{line.rate.toFixed(2)} | GST: {line.gstRate}%)
                              </span>
                            </div>
                            <div className="text-xs text-slate-400">
                              Purchased: <strong className="text-slate-200">{line.purchasedQty}</strong> | Max Returnable:{' '}
                              <strong className="text-amber-400">{line.returnableQty}</strong>
                            </div>
                          </div>

                          {/* Batches for this line */}
                          <div className="space-y-2 pt-1">
                            <div className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                              <Boxes className="w-3.5 h-3.5 text-slate-500" />
                              Purchase Batches & Lots:
                            </div>
                            {line.batches.map((b, bIdx) => (
                              <div
                                key={b.batchId}
                                className="flex items-center justify-between gap-4 p-2.5 bg-slate-900/90 border border-slate-800/80 rounded-lg text-xs"
                              >
                                <div>
                                  <span className="font-mono text-slate-300 font-medium">{b.batchNumber}</span>
                                  <span className="text-slate-500 ml-2">
                                    (Max Returnable: {b.returnableQty} | Rate: ₹{b.rate})
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-400">Return Qty:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max={b.returnableQty}
                                    step="1"
                                    value={b.returnQty || 0}
                                    onChange={e =>
                                      handleBatchQtyChange(lIdx, bIdx, parseFloat(e.target.value) || 0)
                                    }
                                    className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-center text-white font-mono focus:outline-none focus:border-amber-500"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Return Reason & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                        Reason for Return
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Lens coating defect, damaged frame hinges..."
                        value={returnReason}
                        onChange={e => setReturnReason(e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                        Internal Notes
                      </label>
                      <input
                        type="text"
                        placeholder="Vendor return tracking notes..."
                        value={returnNotes}
                        onChange={e => setReturnNotes(e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* Live Calculation Box */}
                  <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="text-xs text-slate-400 space-y-1">
                      <div>Subtotal: ₹{totals.subtotal}</div>
                      <div>Estimated GST: ₹{totals.taxAmount}</div>
                      <div>Round Off: ₹{totals.roundOff}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Debit Note Total</div>
                      <div className="text-2xl font-bold font-mono text-amber-400">
                        ₹{totals.grandTotal}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="p-6 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={submitting || !totals.hasItems}
                  onClick={() => handleCreateSubmit(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={submitting || !totals.hasItems}
                  onClick={() => handleCreateSubmit(true)}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-lg shadow-amber-600/20"
                >
                  {submitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                  <span>Save & Post Return</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL */}
      {viewReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">{viewReturn.returnNumber}</h3>
                  <p className="text-xs text-slate-400">
                    Against Purchase Bill {viewReturn.invoice?.invoiceNumber} • Created{' '}
                    {new Date(viewReturn.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewReturn(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-950 rounded-xl text-xs">
                <div>
                  <span className="text-slate-500 uppercase">Supplier</span>
                  <div className="font-medium text-white mt-0.5">{viewReturn.supplier?.name}</div>
                </div>
                <div>
                  <span className="text-slate-500 uppercase">Status</span>
                  <div className="mt-0.5 font-semibold text-amber-400">{viewReturn.status}</div>
                </div>
                <div>
                  <span className="text-slate-500 uppercase">Taxable</span>
                  <div className="font-mono text-slate-300 mt-0.5">₹{viewReturn.taxableAmount}</div>
                </div>
                <div>
                  <span className="text-slate-500 uppercase">Grand Total</span>
                  <div className="font-mono font-bold text-amber-400 mt-0.5">₹{viewReturn.grandTotal}</div>
                </div>
              </div>

              {viewReturn.reason && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                  <span className="text-slate-500 font-medium">Return Reason:</span>
                  <p className="text-slate-300 mt-0.5">{viewReturn.reason}</p>
                </div>
              )}

              {/* Lines Table */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Returned Items & Batches
                </h4>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                        <th className="py-2.5 px-3">Item</th>
                        <th className="py-2.5 px-3">Batch</th>
                        <th className="py-2.5 px-3 text-right">Quantity</th>
                        <th className="py-2.5 px-3 text-right">Rate</th>
                        <th className="py-2.5 px-3 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {viewReturn.lines?.map((line: any) => (
                        <React.Fragment key={line.id}>
                          <tr className="bg-slate-900/40">
                            <td className="py-2.5 px-3 font-medium text-white">{line.uniqueItem?.name}</td>
                            <td className="py-2.5 px-3 text-slate-400">
                              {line.batches?.map((b: any) => b.batch?.batchNumber).join(', ') || '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">{line.quantity}</td>
                            <td className="py-2.5 px-3 text-right font-mono">₹{line.rate}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-200">
                              ₹{line.lineTotal}
                            </td>
                          </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                onClick={() => setViewReturn(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL RETURN MODAL */}
      {cancelReturnId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <Ban className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Cancel Purchase Return</h3>
            </div>
            <p className="text-xs text-slate-400">
              Are you sure? If posted, this will restore stock to batches/purchase lots and increase supplier outstanding.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Cancellation Reason</label>
              <input
                type="text"
                placeholder="Reason for cancellation..."
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setCancelReturnId(null)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white"
              >
                Go Back
              </button>
              <button
                disabled={cancelling}
                onClick={handleCancelSubmit}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
