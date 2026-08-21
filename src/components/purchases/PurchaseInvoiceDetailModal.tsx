import React, { useState } from 'react';
import {
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Clock,
  Printer,
  Calendar,
  Building2,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Send,
  Eye,
} from 'lucide-react';
import { PurchaseInvoice, PurchaseInvoiceLine } from '../../types/index.js';
import { apiRequest } from '../../api/client.js';

interface PurchaseInvoiceDetailModalProps {
  invoice: PurchaseInvoice;
  onClose: () => void;
  onRefresh: () => void;
}

export const PurchaseInvoiceDetailModal: React.FC<PurchaseInvoiceDetailModalProps> = ({
  invoice,
  onClose,
  onRefresh,
}) => {
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');

  const handlePost = async () => {
    if (!confirm(`Are you sure you want to POST purchase invoice ${invoice.invoiceNumber}? This will immediately increase physical stock, create purchase lots, and credit the supplier ledger.`)) {
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await apiRequest(`/api/purchases/invoices/${invoice.id}/post`, {
        method: 'POST',
      });
      onRefresh();
      onClose();
    } catch (err: any) {
      setActionError(err.message || 'Failed to post purchase invoice');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      setActionError('Please state the cancellation reason');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await apiRequest(`/api/purchases/invoices/${invoice.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason }),
      });
      setCancelModalOpen(false);
      onRefresh();
      onClose();
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel purchase invoice');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!confirm(`Delete unposted draft invoice ${invoice.invoiceNumber}? This action cannot be undone.`)) {
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await apiRequest(`/api/purchases/invoices/${invoice.id}`, {
        method: 'DELETE',
      });
      onRefresh();
      onClose();
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete draft invoice');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'POSTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>POSTED (Stock Inwarded)</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>CANCELLED (Stock Reversed)</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>DRAFT (Pending Review)</span>
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-600 text-white shadow-xs">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-slate-900 font-mono">{invoice.invoiceNumber}</h2>
                {getStatusBadge(invoice.status)}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Date: {new Date(invoice.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                {invoice.supplierInvoiceNumber && ` • Vendor Bill #: ${invoice.supplierInvoiceNumber}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
              title="Print Invoice"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700 text-sm">
          {actionError && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Supplier & Invoice Summary Header */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Supplier Profile</span>
              <div className="font-bold text-slate-900 text-base">{invoice.supplier?.name}</div>
              <div className="text-xs text-slate-500 space-y-1">
                <div>Code: <span className="font-mono text-purple-700 font-semibold">{invoice.supplier?.partyCode}</span></div>
                {invoice.supplier?.gstin && <div>GSTIN: <span className="font-mono font-medium text-slate-800">{invoice.supplier.gstin}</span></div>}
                {invoice.supplier?.city && <div>Location: {invoice.supplier.city}, {invoice.supplier.state}</div>}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Tax & Terms Profile</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 block">GST Mode</span>
                  <span className="font-semibold text-slate-800">{invoice.gstMode}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Supplier Bill Date</span>
                  <span className="font-semibold text-slate-800">
                    {invoice.supplierInvoiceDate ? new Date(invoice.supplierInvoiceDate).toLocaleDateString('en-IN') : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Payment Terms</span>
                  <span className="font-semibold text-slate-800">{invoice.supplier?.creditDays || 0} Days</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Created On</span>
                  <span className="font-semibold text-slate-800">{new Date(invoice.createdAt).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Inward Items & Optical Power Batches</h3>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold uppercase border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Item Description & SKU</th>
                    <th className="px-3 py-3 text-right">Qty (Prs)</th>
                    <th className="px-3 py-3 text-right">Rate (₹)</th>
                    <th className="px-3 py-3 text-right">Discount</th>
                    <th className="px-3 py-3 text-right">Taxable (₹)</th>
                    <th className="px-3 py-3 text-right">GST Rate</th>
                    <th className="px-3 py-3 text-right">Tax (₹)</th>
                    <th className="px-4 py-3 text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.lines?.map((line, idx) => (
                    <React.Fragment key={line.id || idx}>
                      <tr className="hover:bg-slate-50/50 bg-white">
                        <td className="px-4 py-3 text-slate-400">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{line.uniqueItem?.name || line.uniqueItemId}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{line.uniqueItem?.code}</div>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{line.quantity}</td>
                        <td className="px-3 py-3 text-right font-mono">₹{Number(line.rate).toFixed(2)}</td>
                        <td className="px-3 py-3 text-right text-slate-500">
                          {line.discountType !== 'NONE' && Number(line.discountValue) > 0 ? (
                            <span>{line.discountValue}{line.discountType === 'PERCENTAGE' ? '%' : ' ₹'}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-800">₹{Number(line.taxableAmount || 0).toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-mono">{line.gstRate}%</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-800">₹{Number(line.gstAmount || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-bold font-mono text-purple-700">₹{Number(line.lineTotal || 0).toFixed(2)}</td>
                      </tr>

                      {/* Power Batch Allocations */}
                      {line.batches && line.batches.length > 0 && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={9} className="px-6 py-2">
                            <div className="text-[11px] text-slate-600 font-medium space-y-1">
                              <span className="text-slate-400 uppercase font-bold text-[10px] tracking-wider">Power Matrix Allocations:</span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {line.batches.map((b, bIdx) => (
                                  <div key={bIdx} className="p-2 rounded-lg bg-white border border-slate-200 flex items-center justify-between">
                                    <div>
                                      <span className="font-mono font-bold text-purple-900">
                                        SPH: {Number(b.batch?.sph ?? b.sph ?? 0) >= 0 ? `+${Number(b.batch?.sph ?? b.sph ?? 0).toFixed(2)}` : Number(b.batch?.sph ?? b.sph ?? 0).toFixed(2)}
                                        {Number(b.batch?.cyl ?? b.cyl ?? 0) !== 0 && ` | CYL: ${Number(b.batch?.cyl ?? b.cyl ?? 0).toFixed(2)}`}
                                        {Number(b.batch?.axis ?? b.axis ?? 0) !== 0 && ` | AXIS: ${b.batch?.axis ?? b.axis}`}
                                        {Number(b.batch?.add ?? b.add ?? 0) !== 0 && ` | ADD: +${Number(b.batch?.add ?? b.add ?? 0).toFixed(2)}`}
                                      </span>
                                      <div className="text-[10px] text-slate-400 font-mono">
                                        Barcode: {b.batch?.barcode || 'AUTO-RESOLVED'}
                                      </div>
                                    </div>
                                    <div className="text-right pl-2">
                                      <span className="font-bold text-slate-900">{b.quantity} prs</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tax Breakdown & Grand Total */}
          <div className="flex flex-col md:flex-row justify-between items-start gap-4 p-4 rounded-2xl bg-purple-50/30 border border-purple-100">
            <div className="space-y-1 max-w-sm">
              <span className="text-xs font-bold text-purple-900 uppercase">Notes & Special Instructions</span>
              <p className="text-xs text-slate-600 italic">{invoice.notes || 'No special remarks.'}</p>
            </div>

            <div className="w-full md:w-72 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Gross Subtotal:</span>
                <span className="font-mono font-medium">₹{Number(invoice.subtotal).toFixed(2)}</span>
              </div>
              {Number(invoice.discountTotal) > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Total Discount:</span>
                  <span className="font-mono font-medium">-₹{Number(invoice.discountTotal).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-700 font-semibold pt-1 border-t border-purple-100">
                <span>Taxable Amount:</span>
                <span className="font-mono">₹{Number(invoice.taxableAmount).toFixed(2)}</span>
              </div>

              {invoice.gstMode === 'INTRA_STATE' ? (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST ({invoice.cgstRate}%):</span>
                    <span className="font-mono">₹{Number(invoice.cgstAmount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>SGST ({invoice.sgstRate}%):</span>
                    <span className="font-mono">₹{Number(invoice.sgstAmount).toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-slate-600">
                  <span>IGST ({invoice.igstRate}%):</span>
                  <span className="font-mono">₹{Number(invoice.igstAmount).toFixed(2)}</span>
                </div>
              )}

              {Number(invoice.roundOff) !== 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Round Off:</span>
                  <span className="font-mono">₹{Number(invoice.roundOff).toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between text-base font-bold text-purple-950 pt-2 border-t-2 border-purple-200">
                <span>Grand Total:</span>
                <span className="font-mono text-lg text-purple-800">₹{Number(invoice.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {invoice.status === 'DRAFT' && (
              <button
                onClick={handleDeleteDraft}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-white text-rose-600 text-xs font-semibold hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Draft</span>
              </button>
            )}

            {invoice.status === 'POSTED' && (
              <button
                onClick={() => setCancelModalOpen(true)}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Cancel & Reverse Stock</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>

            {invoice.status === 'DRAFT' && (
              <button
                onClick={handlePost}
                disabled={actionLoading}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Post & Inward Stock</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cancellation Reason Modal */}
      {cancelModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-2.5 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-slate-900 text-base">Confirm Invoice Cancellation</h3>
            </div>
            <p className="text-xs text-slate-500">
              Cancelling will atomically reverse all physical stock added by this invoice, create reversal ledger records, and debit the supplier's balance.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Cancellation <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                placeholder="e.g. Supplier pricing mistake / goods returned to distributor"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
