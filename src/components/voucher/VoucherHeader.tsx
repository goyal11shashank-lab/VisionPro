import React, { useRef, useEffect } from 'react';
import {
  FileSpreadsheet,
  ArrowLeft,
  Save,
  Send,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Printer,
  DollarSign,
  Building2,
} from 'lucide-react';
import { SearchableMasterSelect, SearchableOption } from '../common/SearchableMasterSelect';

interface VoucherHeaderProps {
  voucherType: 'SALES' | 'PURCHASE' | 'SALES_ORDER' | 'PURCHASE_ORDER';
  isEditing?: boolean;
  voucherNumber: string;
  onVoucherNumberChange?: (val: string) => void;
  voucherDate: string;
  onVoucherDateChange: (val: string) => void;
  // Party state
  parties: any[];
  selectedPartyId: string;
  onPartyChange: (partyId: string) => void;
  partyBalance?: { balance: number; type: 'Dr' | 'Cr'; isOverLimit?: boolean; creditLimit?: number };
  // Secondary voucher fields (optional / compatibility)
  gstMode?: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT';
  onGstModeChange?: (mode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT') => void;
  referenceNumber?: string;
  onReferenceNumberChange?: (val: string) => void;
  supplierInvoiceDate?: string;
  onSupplierInvoiceDateChange?: (val: string) => void;
  // Barcode quick scan (optional / compatibility)
  barcodeInput?: string;
  onBarcodeInput?: (val: string) => void;
  onBarcodeSubmit?: (e: React.FormEvent) => void;
  barcodeLoading?: boolean;
  barcodeMsg?: { type: 'success' | 'error'; text: string } | null;
  // Actions
  submitting: boolean;
  onSaveDraft?: () => void;
  onSavePost: () => void;
  onBack: () => void;
}

export const VoucherHeader: React.FC<VoucherHeaderProps> = ({
  voucherType,
  isEditing = false,
  voucherNumber,
  onVoucherNumberChange,
  voucherDate,
  onVoucherDateChange,
  parties,
  selectedPartyId,
  onPartyChange,
  partyBalance,
  referenceNumber = '',
  onReferenceNumberChange,
  supplierInvoiceDate = '',
  onSupplierInvoiceDateChange,
  submitting,
  onSaveDraft,
  onSavePost,
  onBack,
}) => {
  const isSales = voucherType === 'SALES' || voucherType === 'SALES_ORDER';
  const isOrder = voucherType === 'SALES_ORDER' || voucherType === 'PURCHASE_ORDER';
  const partySelectRef = useRef<any>(null);

  const partyOptions: SearchableOption[] = parties.map(p => ({
    id: p.id,
    label: p.name,
    subLabel: `${p.phone || ''} ${p.city ? `• ${p.city}` : ''} ${p.gstin ? `• GST: ${p.gstin}` : ''}`.trim(),
    tag: p.partyType,
    meta: p,
  }));

  // Global hotkeys (Ctrl+A for save, Esc for back)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        // Only trigger if not inside a textarea
        const target = e.target as HTMLElement;
        if (target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          onSavePost();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSavePost]);

  return (
    <div
      id="tally-voucher-header"
      className="bg-white border-b border-slate-200 shadow-xs px-3 py-2 shrink-0 select-none"
    >
      {/* Topmost strip: Voucher Type & Controls */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title="Back / Exit (Esc)"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded text-xs font-black font-mono uppercase tracking-wider shadow-xs ${
                isOrder
                  ? 'bg-blue-700 text-white'
                  : isSales
                  ? 'bg-emerald-700 text-white'
                  : 'bg-indigo-700 text-white'
              }`}
            >
              {isOrder
                ? voucherType === 'SALES_ORDER'
                  ? 'Sales Order'
                  : 'Purchase Order'
                : isSales
                ? 'Sales Invoice'
                : 'Purchase Invoice'}
            </span>
            <span className="text-[11px] text-slate-800 font-bold font-mono">
              {isOrder
                ? isEditing
                  ? 'Order Alteration (Open / Editable)'
                  : 'Order Booking'
                : isEditing
                ? 'Accounting Voucher Alteration'
                : 'Actual Transaction Posting'}
            </span>
          </div>
        </div>

        {/* Voucher Number & Date */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-950 font-bold font-sans tracking-tight text-xs uppercase">{isOrder ? 'Order No:' : 'Voucher No:'}</span>
            {onVoucherNumberChange ? (
              <input
                type="text"
                value={voucherNumber ?? ''}
                onChange={e => onVoucherNumberChange(e.target.value)}
                className="w-28 px-1.5 py-0.5 text-xs font-black text-slate-950 border border-slate-400 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 shadow-2xs"
              />
            ) : (
              <span className="font-black text-slate-950 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">
                {voucherNumber || 'AUTO'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-950 font-bold font-sans tracking-tight text-xs uppercase">Date:</span>
            <input
              type="date"
              value={voucherDate ?? ''}
              onChange={e => onVoucherDateChange(e.target.value)}
              className="px-1.5 py-0.5 text-xs font-bold text-slate-950 border border-slate-400 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 ml-2 font-sans">
            {onSaveDraft && (
              <button
                type="button"
                disabled={submitting}
                onClick={onSaveDraft}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors disabled:opacity-50"
              >
                {isEditing ? 'Update Draft' : 'Draft'}
              </button>
            )}
            <button
              type="button"
              disabled={submitting}
              onClick={onSavePost}
              className={`px-3.5 py-1.5 text-xs font-bold text-white rounded shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                isOrder
                  ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                  : isSales
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
              }`}
              title={isOrder ? (isEditing ? 'Update Order' : 'Save Order') : (isEditing ? 'Update Invoice' : 'Save & Post Invoice')}
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{isEditing ? 'Updating...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isOrder
                      ? isEditing
                        ? 'Update Order'
                        : 'Save Order'
                      : isEditing
                      ? 'Update Invoice'
                      : 'Save Invoice'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Second Strip: Party Selection & Reference Details */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 items-center text-xs">
        {/* Party A/c Name */}
        <div className={`${isSales ? 'md:col-span-8' : 'md:col-span-6'} flex items-center gap-2`}>
          <span className="w-28 text-slate-950 font-extrabold shrink-0 text-right text-xs uppercase tracking-tight">
            Party A/c Name:
          </span>
          <div className="flex-1 min-w-0">
            <SearchableMasterSelect
              ref={partySelectRef}
              placeholder={isSales ? 'Type customer name/phone...' : 'Type supplier name...'}
              options={partyOptions}
              value={selectedPartyId}
              onSelect={opt => onPartyChange(opt ? opt.id : '')}
              className="w-full"
              inputClassName="py-1 text-xs font-bold text-slate-950 bg-white border-slate-400 rounded focus:ring-1 focus:ring-blue-600 shadow-2xs"
            />
          </div>
          {partyBalance && (
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono shrink-0 border ${
                partyBalance.isOverLimit
                  ? 'bg-red-50 text-red-700 border-red-200 font-bold'
                  : 'bg-slate-100 text-slate-900 border-slate-300 font-bold'
              }`}
            >
              Bal: ₹{partyBalance.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {partyBalance.type}
            </span>
          )}
        </div>

        {/* Reference / Supplier Invoice No */}
        <div className={`${isSales ? 'md:col-span-4' : 'md:col-span-3'} flex items-center gap-1.5`}>
          <span className="text-slate-950 font-extrabold shrink-0 text-xs uppercase tracking-tight">
            {isSales ? 'Ref No:' : 'Supp Inv:'}
          </span>
          <input
            type="text"
            value={referenceNumber ?? ''}
            onChange={e => onReferenceNumberChange && onReferenceNumberChange(e.target.value)}
            placeholder={isSales ? 'Order / Ref #' : 'Inv #'}
            className="flex-1 min-w-0 py-1 px-1.5 text-xs font-bold text-slate-950 border border-slate-400 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
          />
        </div>

        {/* Supplier Invoice Date for Purchase */}
        {!isSales && (
          <div className="md:col-span-3 flex items-center gap-1.5">
            <span className="text-slate-950 font-extrabold shrink-0 text-xs uppercase tracking-tight">
              Supp Date:
            </span>
            <input
              type="date"
              value={supplierInvoiceDate ?? ''}
              onChange={e => onSupplierInvoiceDateChange && onSupplierInvoiceDateChange(e.target.value)}
              className="flex-1 min-w-0 py-1 px-1.5 text-xs font-bold text-slate-950 border border-slate-400 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
            />
          </div>
        )}
      </div>
    </div>
  );
};
