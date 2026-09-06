import React, { useRef, useEffect } from 'react';
import {
  FileSpreadsheet,
  ArrowLeft,
  Save,
  Send,
  Barcode,
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
  voucherType: 'SALES' | 'PURCHASE';
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
  // Secondary voucher fields
  gstMode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT';
  onGstModeChange: (mode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT') => void;
  referenceNumber?: string;
  onReferenceNumberChange?: (val: string) => void;
  supplierInvoiceDate?: string;
  onSupplierInvoiceDateChange?: (val: string) => void;
  // Barcode quick scan
  barcodeInput: string;
  onBarcodeInput: (val: string) => void;
  onBarcodeSubmit: (e: React.FormEvent) => void;
  barcodeLoading?: boolean;
  barcodeMsg?: { type: 'success' | 'error'; text: string } | null;
  // Actions
  submitting: boolean;
  onSaveDraft: () => void;
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
  gstMode,
  onGstModeChange,
  referenceNumber = '',
  onReferenceNumberChange,
  supplierInvoiceDate = '',
  onSupplierInvoiceDateChange,
  barcodeInput,
  onBarcodeInput,
  onBarcodeSubmit,
  barcodeLoading = false,
  barcodeMsg,
  submitting,
  onSaveDraft,
  onSavePost,
  onBack,
}) => {
  const isSales = voucherType === 'SALES';
  const partySelectRef = useRef<any>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const partyOptions: SearchableOption[] = parties.map(p => ({
    id: p.id,
    label: p.name,
    subLabel: `${p.phone || ''} ${p.city ? `• ${p.city}` : ''} ${p.gstin ? `• GST: ${p.gstin}` : ''}`.trim(),
    tag: p.partyType,
    meta: p,
  }));

  // Global hotkeys (F3 for barcode scan, Ctrl+A for save, Esc for back)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
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
              className={`px-2 py-0.5 rounded text-xs font-bold font-mono uppercase tracking-wider ${
                isSales
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 text-white'
              }`}
            >
              {isSales ? 'Sales Voucher' : 'Purchase Voucher'}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {isEditing ? 'Accounting Voucher Alteration' : 'Accounting Voucher Creation'}
            </span>
          </div>
        </div>

        {/* Voucher Number & Date */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-semibold font-sans">Voucher No:</span>
            {onVoucherNumberChange ? (
              <input
                type="text"
                value={voucherNumber}
                onChange={e => onVoucherNumberChange(e.target.value)}
                className="w-28 px-1.5 py-0.5 text-xs font-bold text-slate-900 border border-slate-300 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500"
              />
            ) : (
              <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {voucherNumber || 'AUTO'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-semibold font-sans">Date:</span>
            <input
              type="date"
              value={voucherDate}
              onChange={e => onVoucherDateChange(e.target.value)}
              className="px-1.5 py-0.5 text-xs font-medium text-slate-900 border border-slate-300 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 ml-2 font-sans">
            <button
              type="button"
              disabled={submitting}
              onClick={onSaveDraft}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors disabled:opacity-50"
            >
              Draft
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={onSavePost}
              className={`px-3 py-1 text-xs font-bold text-white rounded shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                isSales
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
              }`}
              title="Save & Post Voucher (Ctrl+A)"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Posting...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Save &amp; Post (Ctrl+A)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Second Strip: Party Selection & Ledger Accounting Details */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 pt-2 items-center text-xs">
        {/* Party A/c Name (col 5) */}
        <div className="md:col-span-5 flex items-center gap-2">
          <span className="w-24 text-slate-600 font-semibold shrink-0 text-right">
            Party A/c name:
          </span>
          <div className="flex-1 min-w-0">
            <SearchableMasterSelect
              ref={partySelectRef}
              placeholder={isSales ? 'Type customer name/phone...' : 'Type supplier name...'}
              options={partyOptions}
              value={selectedPartyId}
              onSelect={opt => onPartyChange(opt ? opt.id : '')}
              className="w-full"
              inputClassName="py-1 text-xs font-semibold bg-white border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {partyBalance && (
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono shrink-0 border ${
                partyBalance.isOverLimit
                  ? 'bg-red-50 text-red-700 border-red-200 font-bold'
                  : 'bg-slate-100 text-slate-700 border-slate-200 font-semibold'
              }`}
            >
              Bal: ₹{partyBalance.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {partyBalance.type}
            </span>
          )}
        </div>

        {/* GST / Taxation Mode (col 3) */}
        <div className="md:col-span-3 flex items-center gap-2">
          <span className="text-slate-600 font-semibold shrink-0">
            GST Ledger:
          </span>
          <select
            value={gstMode}
            onChange={e => onGstModeChange(e.target.value as any)}
            className="flex-1 py-1 px-1.5 text-xs bg-slate-50 border border-slate-300 rounded focus:bg-white focus:ring-1 focus:ring-blue-500 font-sans"
          >
            <option value="INTRA_STATE">Intra-State (CGST + SGST)</option>
            <option value="INTER_STATE">Inter-State (IGST)</option>
            <option value="EXEMPT">Exempt / Non-GST</option>
          </select>
        </div>

        {/* Reference / Supplier Invoice No (col 2) */}
        <div className="md:col-span-2 flex items-center gap-1.5">
          <span className="text-slate-600 font-semibold shrink-0">
            {isSales ? 'Ref No:' : 'Supp Inv:'}
          </span>
          <input
            type="text"
            value={referenceNumber}
            onChange={e => onReferenceNumberChange && onReferenceNumberChange(e.target.value)}
            placeholder={isSales ? 'Order / Ref #' : 'Inv #'}
            className="flex-1 min-w-0 py-1 px-1.5 text-xs border border-slate-300 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 font-mono"
          />
        </div>

        {/* Fast Barcode Scanner Quick Input (col 2) */}
        <div className="md:col-span-2">
          <form onSubmit={onBarcodeSubmit} className="relative flex items-center">
            <Barcode className="w-3.5 h-3.5 absolute left-2 text-slate-400 pointer-events-none" />
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcodeInput}
              onChange={e => onBarcodeInput(e.target.value)}
              placeholder="Scan Barcode (F3)..."
              disabled={barcodeLoading}
              className="w-full pl-7 pr-2 py-1 text-xs border border-slate-300 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 font-mono placeholder:text-slate-400"
            />
            {barcodeLoading && (
              <RefreshCw className="w-3 h-3 animate-spin absolute right-2 text-slate-400" />
            )}
          </form>
          {barcodeMsg && (
            <div
              className={`absolute mt-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded border z-30 ${
                barcodeMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {barcodeMsg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
