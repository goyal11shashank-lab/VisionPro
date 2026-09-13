import React, { useEffect, useState } from 'react';
import { 
  X, Receipt, Truck, ShoppingCart, RotateCcw, FileText, 
  ExternalLink, Calendar, User, CheckCircle2, Clock, 
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Copy, Check
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

interface VoucherDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  voucherId: string | null;
  voucherNo: string;
  transactionType?: string;
  referenceType?: string | null;
  onNavigate?: (path: string) => void;
}

export const VoucherDetailModal: React.FC<VoucherDetailModalProps> = ({
  isOpen,
  onClose,
  voucherId,
  voucherNo,
  transactionType = 'SALE',
  referenceType,
  onNavigate,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voucherData, setVoucherData] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setVoucherData(null);
      setError(null);
      return;
    }

    if (!voucherId) {
      // Opening stock or manual adjustment entry
      setVoucherData({
        isManual: true,
        voucherNo,
        transactionType,
        referenceType,
      });
      return;
    }

    const fetchVoucher = async () => {
      setLoading(true);
      setError(null);

      // Determine endpoint based on voucher prefix or transaction type
      const vNo = (voucherNo || '').toUpperCase();
      const tType = (transactionType || '').toUpperCase();
      let url = '';

      if (vNo.startsWith('SAL') || tType === 'SALE' || referenceType === 'INVOICE') {
        url = `/api/sales/invoices/${voucherId}`;
      } else if (vNo.startsWith('PUR') || tType === 'PURCHASE' || referenceType === 'BILL') {
        url = `/api/purchases/${voucherId}`;
      } else if (vNo.startsWith('SO') || tType === 'RESERVATION' || referenceType === 'ORDER') {
        url = `/api/sales/orders/${voucherId}`;
      } else if (vNo.startsWith('PO') || tType === 'PURCHASE_ORDER') {
        url = `/api/purchases/orders/${voucherId}`;
      } else if (vNo.startsWith('SR') || tType === 'SALES_RETURN') {
        url = `/api/sales/returns/${voucherId}`;
      } else if (vNo.startsWith('PR') || tType === 'PURCHASE_RETURN') {
        url = `/api/purchases/returns/${voucherId}`;
      } else {
        url = `/api/sales/invoices/${voucherId}`;
      }

      try {
        const res = await apiRequest<any>(url);
        setVoucherData(res.invoice || res.order || res.return || res);
      } catch (err: any) {
        // Fallback: try sales invoice or purchase invoice
        try {
          const fallbackRes = await apiRequest<any>(`/api/purchases/${voucherId}`);
          setVoucherData(fallbackRes.invoice || fallbackRes);
        } catch {
          setError(err.message || 'Could not fetch voucher details.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchVoucher();
  }, [isOpen, voucherId, voucherNo, transactionType, referenceType]);

  if (!isOpen) return null;

  const handleCopyNo = () => {
    navigator.clipboard.writeText(voucherNo);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getVoucherIcon = () => {
    const vNo = (voucherNo || '').toUpperCase();
    if (vNo.startsWith('PUR')) return <Truck className="h-5 w-5 text-indigo-600" />;
    if (vNo.startsWith('SO') || vNo.startsWith('PO')) return <ShoppingCart className="h-5 w-5 text-amber-600" />;
    if (vNo.startsWith('SR') || vNo.startsWith('PR')) return <RotateCcw className="h-5 w-5 text-rose-600" />;
    return <Receipt className="h-5 w-5 text-emerald-600" />;
  };

  const getVoucherTypeLabel = () => {
    const vNo = (voucherNo || '').toUpperCase();
    if (vNo.startsWith('PUR')) return 'Purchase Invoice (Bill)';
    if (vNo.startsWith('SO')) return 'Sales Order (Reservation)';
    if (vNo.startsWith('PO')) return 'Purchase Order';
    if (vNo.startsWith('SR')) return 'Sales Return (Credit Note)';
    if (vNo.startsWith('PR')) return 'Purchase Return (Debit Note)';
    if (vNo.startsWith('SAL') || vNo.startsWith('INV')) return 'Sales Invoice (Cash/Credit)';
    if (voucherNo === 'OPENING-STOCK') return 'Opening Stock Initialization';
    return transactionType || 'Transaction Voucher';
  };

  const handleNavigateToRegister = () => {
    if (!onNavigate) return;
    const vNo = (voucherNo || '').toUpperCase();
    if (vNo.startsWith('PUR')) {
      onNavigate('/purchase/invoices');
    } else if (vNo.startsWith('SO')) {
      onNavigate('/sales/orders');
    } else if (vNo.startsWith('PO')) {
      onNavigate('/purchase/orders');
    } else if (vNo.startsWith('SR')) {
      onNavigate('/sales/returns');
    } else if (vNo.startsWith('PR')) {
      onNavigate('/purchase/returns');
    } else {
      onNavigate('/sales/invoices');
    }
    onClose();
  };

  const lines = voucherData?.lines || voucherData?.items || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
              {getVoucherIcon()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-mono font-bold text-lg text-slate-900">{voucherNo}</h3>
                <button
                  onClick={handleCopyNo}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors"
                  title="Copy Voucher Number"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                {voucherData?.status && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    voucherData.status === 'POSTED' || voucherData.status === 'CONFIRMED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : voucherData.status === 'CANCELLED'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {voucherData.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium">{getVoucherTypeLabel()}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {loading ? (
            <div className="py-16 text-center text-slate-500 space-y-2">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
              <p className="text-xs font-medium">Fetching voucher details from database...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">Voucher Record Notice</p>
                <p className="text-xs mt-1 text-rose-700">{error}</p>
              </div>
            </div>
          ) : voucherData?.isManual ? (
            <div className="p-5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <FileText className="h-4 w-4 text-blue-600" />
                <span>System Initialization / Direct Stock Posting</span>
              </div>
              <p className="text-xs text-blue-700 leading-relaxed">
                This transaction was generated as an Opening Stock entry or direct inventory adjustment.
                It establishes baseline physical stock and valuation without requiring a commercial party invoice.
              </p>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-blue-200/60 text-xs">
                <div>
                  <span className="text-blue-500 block">Voucher Reference</span>
                  <span className="font-mono font-bold text-blue-900">{voucherNo}</span>
                </div>
                <div>
                  <span className="text-blue-500 block">Movement Type</span>
                  <span className="font-bold text-blue-900">{transactionType}</span>
                </div>
              </div>
            </div>
          ) : voucherData ? (
            <>
              {/* Party & Date Meta */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <div>
                  <span className="text-xs text-slate-500 block font-medium">Party / Counterparty</span>
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5 mt-0.5 truncate">
                    <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{voucherData.partyName || voucherData.supplierName || voucherData.customerName || 'Walk-in / Cash'}</span>
                  </div>
                  {voucherData.partyGstin && (
                    <span className="text-[11px] font-mono text-slate-500 block mt-0.5">
                      GSTIN: {voucherData.partyGstin}
                    </span>
                  )}
                </div>

                <div>
                  <span className="text-xs text-slate-500 block font-medium">Voucher Date</span>
                  <div className="font-medium text-slate-900 flex items-center gap-1.5 mt-0.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>
                      {voucherData.invoiceDate || voucherData.orderDate || voucherData.returnDate || voucherData.createdAt
                        ? new Date(voucherData.invoiceDate || voucherData.orderDate || voucherData.returnDate || voucherData.createdAt).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-xs text-slate-500 block font-medium">Grand Total</span>
                  <div className="font-mono font-bold text-emerald-700 text-base mt-0.5">
                    ₹{Number(voucherData.grandTotal || voucherData.totalAmount || voucherData.netAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Allocated Voucher Line Items ({lines.length})
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">#</th>
                        <th className="py-2.5 px-3 font-semibold">Stock Item / Description</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Quantity</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Unit Rate</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Taxable</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 bg-white">
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-slate-400 italic">
                            No individual line items found in this voucher.
                          </td>
                        </tr>
                      ) : (
                        lines.map((l: any, idx: number) => {
                          const qty = Number(l.quantity || l.qty || 0);
                          const rate = Number(l.unitPrice || l.rate || l.purchaseRate || 0);
                          const total = Number(l.totalAmount || l.lineTotal || l.amount || (qty * rate));
                          const taxable = Number(l.taxableAmount || (qty * rate));

                          const itemName = l.uniqueItemName || l.uniqueItem?.name || l.itemName || l.description || l.stockItemName || 'Optical Item';
                          const itemCode = l.uniqueItemCode || l.uniqueItem?.code;
                          const barcode = l.barcode || l.batches?.[0]?.barcode || l.batches?.[0]?.batch?.barcode;
                          const batches = l.batches || [];
                          const powerDescription = l.powerDescription || (batches.length > 0
                            ? batches.map((b: any) => {
                                const sph = b.sph ?? b.batch?.sph ?? '0.00';
                                const cyl = b.cyl ?? b.batch?.cyl ?? '0.00';
                                const axis = b.axis ?? b.batch?.axis;
                                const add = b.add ?? b.batch?.add;
                                const side = b.side ?? b.batch?.side;
                                return `${side && side !== 'NONE' ? `[${side}] ` : ''}SPH ${sph} CYL ${cyl}${axis ? ` Ax ${axis}` : ''}${add ? ` Add ${add}` : ''}`;
                              }).join(' | ')
                            : null);

                          return (
                            <tr key={l.id || idx} className="hover:bg-slate-50/70">
                              <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                              <td className="py-2 px-3">
                                <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                  <span>{itemName}</span>
                                  {itemCode && (
                                    <span className="text-[10px] font-mono px-1 py-0.5 bg-slate-100 text-slate-600 rounded">
                                      {itemCode}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                  {powerDescription && (
                                    <span className="text-[10px] text-slate-600 font-medium font-mono">
                                      Power: {powerDescription}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800">
                                {qty}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600">
                                ₹{rate.toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-600">
                                ₹{taxable.toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                                ₹{total.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Totals */}
              <div className="flex justify-end pt-2">
                <div className="w-full sm:w-64 space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex justify-between">
                    <span>Taxable Amount:</span>
                    <span className="font-mono font-medium text-slate-900">
                      ₹{Number(voucherData.taxableAmount || voucherData.totalTaxable || 0).toFixed(2)}
                    </span>
                  </div>
                  {Number(voucherData.cgstAmount || 0) > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>CGST:</span>
                      <span className="font-mono">₹{Number(voucherData.cgstAmount).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(voucherData.sgstAmount || 0) > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>SGST:</span>
                      <span className="font-mono">₹{Number(voucherData.sgstAmount).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(voucherData.igstAmount || 0) > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>IGST:</span>
                      <span className="font-mono">₹{Number(voucherData.igstAmount).toFixed(2)}</span>
                    </div>
                  )}
                  {Number(voucherData.roundOff || 0) !== 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>Round Off:</span>
                      <span className="font-mono">₹{Number(voucherData.roundOff).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1.5 border-t border-slate-200 font-bold text-slate-900 text-sm">
                    <span>Grand Total:</span>
                    <span className="font-mono text-emerald-700">
                      ₹{Number(voucherData.grandTotal || voucherData.totalAmount || voucherData.netAmount || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Immutable Audit Trail &bull; Stock Movement Verified
          </div>
          <div className="flex items-center gap-2">
            {onNavigate && voucherId && (
              <button
                onClick={handleNavigateToRegister}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 border border-slate-300 rounded-lg transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in Register</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
