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
  X,
  Send,
  Eye,
  Pencil,
  FileCheck,
} from 'lucide-react';
import { PurchaseOrder, PurchaseOrderLine } from '../../types/index.js';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { PrintPreviewModal } from '../print/PrintPreviewModal.js';
import { PrintableVoucher } from '../print/PrintableVoucher.js';

interface PurchaseOrderDetailModalProps {
  order: PurchaseOrder;
  onClose: () => void;
  onRefresh: () => void;
  onConvert?: (orderId: string) => void;
}

export const PurchaseOrderDetailModal: React.FC<PurchaseOrderDetailModalProps> = ({
  order,
  onClose,
  onRefresh,
  onConvert,
}) => {
  const { currentBusiness } = useAuth();
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState<boolean>(false);

  const handleCancelOrder = async () => {
    if (!cancelReason.trim()) {
      setActionError('Please provide a reason for cancellation.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await apiRequest(`/api/purchases/orders/${order.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      setCancelModalOpen(false);
      onRefresh();
      onClose();
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel purchase order');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrint = () => {
    setIsPrintPreviewOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONVERTED':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>CONVERTED TO INVOICE</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5" />
            <span>CANCELLED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3.5 h-3.5" />
            <span>OPEN ORDER</span>
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-slate-900">
                  Purchase Order #{order.orderNumber}
                </h2>
                {getStatusBadge(order.status)}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Created on {new Date(order.orderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                {order.expectedDeliveryDate && ` • Expected Delivery: ${new Date(order.expectedDeliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-print-preview-purchase-order"
              onClick={() => setIsPrintPreviewOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
              title="Print Preview / Export PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Preview</span>
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-2xs transition-colors"
              title="Direct Print"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {actionError && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Supplier Info & Order Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                <Building2 className="w-3.5 h-3.5" />
                <span>Supplier Information</span>
              </div>
              <p className="text-sm font-bold text-slate-900">
                {order.supplier?.name || 'Unknown Supplier'}
              </p>
              {order.supplier?.partyCode && (
                <p className="text-xs text-slate-600">
                  <span className="text-slate-400 font-mono">Code:</span> {order.supplier.partyCode}
                </p>
              )}
              {order.supplier?.mobile && (
                <p className="text-xs text-slate-600">
                  <span className="text-slate-400">Phone:</span> {order.supplier.mobile}
                </p>
              )}
              {order.supplier?.gstin && (
                <p className="text-xs text-slate-600">
                  <span className="text-slate-400 font-mono">GSTIN:</span> {order.supplier.gstin}
                </p>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                <Calendar className="w-3.5 h-3.5" />
                <span>Order Specifics</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400">GST Mode:</span>
                  <p className="font-medium text-slate-800">{order.gstMode}</p>
                </div>
                <div>
                  <span className="text-slate-400">Supplier Ref:</span>
                  <p className="font-medium text-slate-800">{order.supplierReference || '—'}</p>
                </div>
                <div>
                  <span className="text-slate-400">Order Status:</span>
                  <p className="font-medium text-slate-800">{order.status}</p>
                </div>
                <div>
                  <span className="text-slate-400">Converted Invoice:</span>
                  <p className="font-medium text-slate-800">{order.convertedInvoiceId ? 'YES' : '—'}</p>
                </div>
              </div>
              {order.notes && (
                <p className="text-xs text-slate-600 pt-1 border-t border-slate-200">
                  <span className="text-slate-400">Notes:</span> {order.notes}
                </p>
              )}
            </div>
          </div>

          {/* Items & Allocation Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Ordered Optical Items & Batches
              </span>
              <span className="text-xs text-slate-500">
                {order.lines?.length || 0} line{(order.lines?.length || 0) > 1 ? 's' : ''}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100/75 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Item Description</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Purchase Rate (₹)</th>
                    <th className="py-2.5 px-3 text-right">Disc</th>
                    <th className="py-2.5 px-3 text-right">Taxable (₹)</th>
                    <th className="py-2.5 px-3 text-right">GST %</th>
                    <th className="py-2.5 px-3 text-right">Line Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {order.lines && order.lines.length > 0 ? (
                    order.lines.map((l: any, idx: number) => (
                      <React.Fragment key={l.id || idx}>
                        <tr className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-slate-900 block">
                              {l.uniqueItem?.name || 'Item'}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {l.uniqueItem?.code || ''}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                            {parseFloat(String(l.quantity)).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            ₹{parseFloat(String(l.rate)).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-500">
                            {parseFloat(String(l.discountAmount || 0)) > 0
                              ? `₹${parseFloat(String(l.discountAmount)).toFixed(2)}`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            ₹{parseFloat(String(l.taxableAmount)).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600">
                            {parseFloat(String(l.gstRate || 0))}%
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold font-mono text-slate-900">
                            ₹{parseFloat(String(l.lineTotal)).toFixed(2)}
                          </td>
                        </tr>

                        {/* Batches Sub-Rows */}
                        {l.batches && l.batches.length > 0 && (
                          <tr className="bg-slate-50/40">
                            <td colSpan={8} className="py-2 px-4">
                              <div className="pl-6 border-l-2 border-blue-300 py-1 space-y-1">
                                <span className="text-[11px] font-semibold text-blue-800 flex items-center gap-1.5">
                                  <Layers className="w-3 h-3" />
                                  <span>Optical Power Allocations:</span>
                                </span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {l.batches.map((b: any, bIdx: number) => {
                                    const batchInfo = b.batch || b;
                                    return (
                                      <div
                                        key={b.id || bIdx}
                                        className="bg-white border border-slate-200 p-2 rounded-lg text-[11px] flex items-center justify-between"
                                      >
                                        <div>
                                          <div className="font-mono text-slate-800 font-medium">
                                            SPH {parseFloat(String(batchInfo.sph || 0)) >= 0 ? '+' : ''}
                                            {parseFloat(String(batchInfo.sph || 0)).toFixed(2)}
                                            {batchInfo.cyl !== undefined && parseFloat(String(batchInfo.cyl)) !== 0 && (
                                              <>
                                                {' '}CYL {parseFloat(String(batchInfo.cyl)) >= 0 ? '+' : ''}
                                                {parseFloat(String(batchInfo.cyl)).toFixed(2)}
                                              </>
                                            )}
                                            {batchInfo.add !== undefined && parseFloat(String(batchInfo.add)) !== 0 && (
                                              <>
                                                {' '}ADD +{parseFloat(String(batchInfo.add)).toFixed(2)}
                                              </>
                                            )}
                                          </div>
                                          {batchInfo.side && batchInfo.side !== 'NONE' && (
                                            <span className="text-[10px] text-slate-500 uppercase">
                                              Side: {batchInfo.side}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-right">
                                          <span className="font-bold text-slate-900 block font-mono">
                                            {parseFloat(String(b.quantity)).toFixed(2)} prs
                                          </span>
                                          <span className="text-[10px] text-slate-500 font-mono">
                                            @ ₹{parseFloat(String(b.rate)).toFixed(2)}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400 text-xs">
                        No item lines found in this order
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals Section */}
          <div className="flex flex-col sm:flex-row justify-end">
            <div className="w-full sm:w-80 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-mono font-medium">
                  ₹{parseFloat(String(order.subtotal || 0)).toFixed(2)}
                </span>
              </div>
              {parseFloat(String(order.discountTotal || 0)) > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>Discount Total:</span>
                  <span className="font-mono font-medium">
                    -₹{parseFloat(String(order.discountTotal || 0)).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>Taxable Amount:</span>
                <span className="font-mono font-medium">
                  ₹{parseFloat(String(order.taxableAmount || 0)).toFixed(2)}
                </span>
              </div>

              {order.gstMode === 'INTER_STATE' ? (
                <div className="flex justify-between text-slate-600">
                  <span>IGST:</span>
                  <span className="font-mono font-medium">
                    ₹{parseFloat(String(order.igstAmount || 0)).toFixed(2)}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST:</span>
                    <span className="font-mono font-medium">
                      ₹{parseFloat(String(order.cgstAmount || 0)).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>SGST:</span>
                    <span className="font-mono font-medium">
                      ₹{parseFloat(String(order.sgstAmount || 0)).toFixed(2)}
                    </span>
                  </div>
                </>
              )}

              {parseFloat(String(order.roundOff || 0)) !== 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Round-off:</span>
                  <span className="font-mono font-medium">
                    {parseFloat(String(order.roundOff)) >= 0 ? '+' : ''}
                    ₹{parseFloat(String(order.roundOff)).toFixed(2)}
                  </span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-300 flex justify-between items-center text-sm font-bold text-slate-900">
                <span>Grand Total:</span>
                <span className="text-base font-mono text-blue-700">
                  ₹{parseFloat(String(order.grandTotal || 0)).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {order.status === 'OPEN' && (
              <button
                type="button"
                onClick={() => setCancelModalOpen(true)}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                <span>Cancel Order</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {order.status === 'OPEN' && onConvert && (
              <button
                type="button"
                onClick={() => onConvert(order.id)}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors disabled:opacity-50"
              >
                <FileCheck className="w-4 h-4" />
                <span>Convert to Purchase Invoice</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl shadow-2xs transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Cancellation Reason Dialog */}
        {cancelModalOpen && (
          <div className="fixed inset-0 z-60 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="p-2 rounded-xl bg-rose-50 border border-rose-100">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Cancel Purchase Order #{order.orderNumber}
                </h3>
              </div>

              <p className="text-xs text-slate-600">
                Are you sure you want to cancel this purchase order? This action will mark the order as CANCELLED.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reason for Cancellation <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="e.g. Vendor out of stock, cancelled by management, duplicate order..."
                  className="w-full h-20 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-hidden resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelModalOpen(false)}
                  disabled={actionLoading}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Go Back
                </button>
                <button
                  type="button"
                  onClick={handleCancelOrder}
                  disabled={actionLoading || !cancelReason.trim()}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* REUSABLE PRINT PREVIEW MODAL */}
      {isPrintPreviewOpen && (
        <PrintPreviewModal
          isOpen={isPrintPreviewOpen}
          onClose={() => setIsPrintPreviewOpen(false)}
          title={`Purchase Order - ${order.orderNumber || ''}`}
          filename={`PurchaseOrder_${order.orderNumber || 'PO'}`}
          defaultOrientation="portrait"
        >
          {({ documentId }) => (
            <PrintableVoucher
              id={documentId}
              business={currentBusiness}
              voucher={order}
              documentType="PURCHASE_ORDER"
              customTitle="PURCHASE ORDER"
              copyLabel="Vendor Copy"
            />
          )}
        </PrintPreviewModal>
      )}
    </div>
  );
};
