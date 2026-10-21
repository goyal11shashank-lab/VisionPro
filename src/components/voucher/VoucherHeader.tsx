import React, { useRef, useEffect, useState, useMemo } from 'react';
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
  Plus,
  BookOpen,
  X,
} from 'lucide-react';
import { SearchableMasterSelect, SearchableOption } from '../common/SearchableMasterSelect';
import { InlinePartyModal } from '../common/InlinePartyModal';
import { INDIAN_STATES_LIST, getDisplayStateName } from '../../utils/gstHelper';

interface VoucherHeaderProps {
  voucherType: 'SALES' | 'PURCHASE' | 'SALES_ORDER' | 'PURCHASE_ORDER';
  isEditing?: boolean;
  voucherNumber: string;
  onVoucherNumberChange?: (val: string) => void;
  voucherDate: string;
  onVoucherDateChange: (val: string) => void;
  businessName?: string;
  // Party state
  parties: any[];
  selectedPartyId: string;
  onPartyChange: (partyId: string, partyObj?: any) => void;
  onPartyCreated?: (newParty: any) => void;
  onRequestCreateParty?: (initialName?: string) => void;
  onPartyFocus?: () => void;
  onPartyQueryChange?: (query: string) => void;
  allowPartyCreate?: boolean;
  partyBalance?: { balance: number; type: 'Dr' | 'Cr'; isOverLimit?: boolean; creditLimit?: number };
  // Secondary voucher fields (optional / compatibility)
  gstMode?: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT';
  onGstModeChange?: (mode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT') => void;
  showLedger?: boolean;
  showRefNo?: boolean;
  partyStateValidation?: {
    bizState?: string;
    partyState?: string;
    isMissing?: boolean;
    isInterState?: boolean;
  };
  onPartyStateChange?: (stateName: string) => void;
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
  onSaveAndNew?: () => void;
  onPrint?: () => void;
  onBack: () => void;
}

export const VoucherHeader: React.FC<VoucherHeaderProps> = ({
  voucherType,
  isEditing = false,
  voucherNumber,
  onVoucherNumberChange,
  voucherDate,
  onVoucherDateChange,
  businessName,
  parties,
  selectedPartyId,
  onPartyChange,
  onPartyCreated,
  onRequestCreateParty,
  onPartyFocus,
  onPartyQueryChange,
  allowPartyCreate = true,
  partyBalance,
  gstMode = 'INTRA_STATE',
  onGstModeChange,
  showLedger = false,
  showRefNo = false,
  partyStateValidation,
  onPartyStateChange,
  referenceNumber = '',
  onReferenceNumberChange,
  supplierInvoiceDate = '',
  onSupplierInvoiceDateChange,
  submitting,
  onSaveDraft,
  onSavePost,
  onSaveAndNew,
  onPrint,
  onBack,
}) => {
  const isSales = voucherType === 'SALES' || voucherType === 'SALES_ORDER';
  const isOrder = voucherType === 'SALES_ORDER' || voucherType === 'PURCHASE_ORDER';
  const partySelectRef = useRef<any>(null);
  const partyInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Inline Party creation state
  const [isInlinePartyOpen, setIsInlinePartyOpen] = useState(false);
  const [typedPartyName, setTypedPartyName] = useState('');

  const selectedParty = useMemo(() => {
    return parties.find(p => p.id === selectedPartyId) || null;
  }, [parties, selectedPartyId]);

  const [partyInputText, setPartyInputText] = useState(selectedParty?.name || '');

  // Keep input text synced with selected party
  useEffect(() => {
    if (selectedParty) {
      setPartyInputText(selectedParty.name);
    } else if (!selectedPartyId) {
      if (document.activeElement !== partyInputRef.current) {
        setPartyInputText('');
      }
    }
  }, [selectedParty, selectedPartyId]);

  const partyOptions: SearchableOption[] = useMemo(() => {
    return parties.map(p => ({
      id: p.id,
      label: p.name,
      subLabel: `${p.phone || p.mobile || ''} ${p.city ? `• ${p.city}` : ''} ${p.gstin ? `• GST: ${p.gstin}` : ''}`.trim(),
      tag: p.partyType === 'CUSTOMER' ? 'Sundry Debtors' : 'Sundry Creditors',
      meta: p,
    }));
  }, [parties]);

  const handleInlinePartySuccess = (newParty: any) => {
    setPartyInputText(newParty?.name || '');
    setTypedPartyName('');
    if (onPartyCreated) {
      onPartyCreated(newParty);
    }
    onPartyChange(newParty.id, newParty);

    // Focus next field
    setTimeout(() => {
      const refInput = document.getElementById('voucher-header-ref-no') as HTMLInputElement;
      if (refInput) {
        refInput.focus();
        refInput.select();
      }
    }, 80);
  };

  // Keyboard hotkeys:
  // - Ctrl+A: Save & Post
  // - F2: Focus Date
  // - Alt+C: Inline Create Party
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          onSavePost();
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        dateInputRef.current?.focus();
        dateInputRef.current?.select();
      } else if (e.altKey && e.key.toLowerCase() === 'c') {
        // Alt+C triggers inline creation
        e.preventDefault();
        if (onRequestCreateParty) {
          onRequestCreateParty(partyInputText);
        } else {
          setTypedPartyName(partyInputText);
          setIsInlinePartyOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSavePost, onRequestCreateParty, partyInputText]);

  return (
    <div
      id="tally-voucher-header"
      className="bg-white border-b border-slate-300 shadow-2xs px-2.5 py-1.5 shrink-0 select-none text-xs font-sans"
    >
      {/* Topmost Command Strip: Tally Title, Voucher Type, No, Date & Actions */}
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Quit Voucher (Esc)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>

          {/* Tally Voucher Type Badge */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-black font-mono uppercase tracking-wider shadow-2xs ${
                isOrder
                  ? 'bg-blue-800 text-white'
                  : isSales
                  ? 'bg-emerald-800 text-white'
                  : 'bg-indigo-800 text-white'
              }`}
            >
              {isOrder
                ? voucherType === 'SALES_ORDER'
                  ? 'F8: Sales Order'
                  : 'F9: Purchase Order'
                : isSales
                ? 'F8: Sales'
                : 'F9: Purchase'}
            </span>

            <span className="text-[11px] text-slate-800 font-extrabold tracking-tight font-sans">
              Accounting Voucher {isEditing ? 'Alteration' : 'Creation'}
            </span>

            {businessName && (
              <span className="text-[11px] text-slate-500 font-mono hidden md:inline">
                • Company: <strong className="text-slate-800">{businessName}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Voucher Number, Date & Action Buttons */}
        <div className="flex items-center gap-3 text-xs shrink-0 font-mono">
          {/* Voucher No */}
          <div className="flex items-center gap-1">
            <span className="text-slate-700 font-bold font-sans uppercase text-[11px]">
              No.
            </span>
            {onVoucherNumberChange ? (
              <input
                type="text"
                value={voucherNumber ?? ''}
                onChange={e => onVoucherNumberChange(e.target.value)}
                className="w-24 px-1.5 py-0.5 text-xs font-black text-slate-900 border border-slate-400 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
              />
            ) : (
              <span className="font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">
                {voucherNumber || 'AUTO'}
              </span>
            )}
          </div>

          {/* Voucher Date with F2 hint */}
          <div className="flex items-center gap-1">
            <span
              className="text-slate-700 font-bold font-sans uppercase text-[11px] cursor-pointer hover:text-blue-700"
              onClick={() => dateInputRef.current?.focus()}
              title="Shortcut: F2"
            >
              Date:
            </span>
            <input
              ref={dateInputRef}
              id="voucher-header-date-input"
              type="date"
              value={voucherDate ?? ''}
              onChange={e => onVoucherDateChange(e.target.value)}
              className="px-1.5 py-0.5 text-xs font-bold text-slate-900 border border-slate-400 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
            />
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-1.5 font-sans">
            {onPrint && (
              <button
                type="button"
                id="btn-voucher-header-print"
                onClick={onPrint}
                className="px-2 py-0.5 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 rounded border border-slate-300 transition-colors flex items-center gap-1 shadow-2xs cursor-pointer"
                title="Print Voucher (Alt+P)"
              >
                <Printer className="w-3 h-3 text-slate-600" />
                <span>Print</span>
              </button>
            )}

            {onSaveDraft && (
              <button
                type="button"
                disabled={submitting}
                onClick={onSaveDraft}
                className="px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isEditing ? 'Update Draft' : 'Draft'}
              </button>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={onSavePost}
              className={`px-3 py-1 text-xs font-black text-white rounded shadow-2xs transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer ${
                isOrder
                  ? 'bg-blue-700 hover:bg-blue-800'
                  : isSales
                  ? 'bg-emerald-700 hover:bg-emerald-800'
                  : 'bg-indigo-700 hover:bg-indigo-800'
              }`}
              title="Accept & Post Voucher (Ctrl+A)"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Send className="w-3 h-3" />
                  <span>{isEditing ? 'Update' : 'Accept & New (Ctrl+A)'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Second Strip: Party Selection, Auto GST State & Optional Ref */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 pt-1.5 items-center text-xs">
        {/* Party A/c Name */}
        <div
          className={`${
            showLedger && showRefNo
              ? 'md:col-span-6'
              : showLedger || showRefNo
              ? 'md:col-span-8'
              : 'md:col-span-7'
          } flex items-center gap-2`}
          data-contextual-owner="party"
        >
          <label
            htmlFor="voucher-header-party-input"
            className="w-28 text-slate-900 font-extrabold shrink-0 text-right text-[11px] uppercase tracking-tight"
          >
            Party A/c name:
          </label>
          <div className="flex-1 min-w-0 relative flex items-center">
            {/* Search Icon */}
            <div className="absolute left-2.5 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </div>

            <input
              ref={partyInputRef}
              id="voucher-header-party-input"
              type="text"
              autoComplete="off"
              spellCheck="false"
              value={partyInputText}
              placeholder={
                isSales
                  ? 'Type customer name (select from right panel)...'
                  : 'Type supplier name (select from right panel)...'
              }
              onFocus={() => {
                onPartyFocus?.();
              }}
              onClick={() => {
                onPartyFocus?.();
              }}
              onBlur={() => {
                if (selectedParty) {
                  setPartyInputText(selectedParty.name);
                } else if (!selectedPartyId) {
                  setPartyInputText('');
                  onPartyQueryChange?.('');
                }
              }}
              onChange={e => {
                const val = e.target.value;
                setPartyInputText(val);
                setTypedPartyName(val);
                if (selectedPartyId && val !== selectedParty?.name) {
                  onPartyChange('');
                }
                onPartyQueryChange?.(val);
              }}
              onKeyDown={e => {
                if (e.key === 'Tab') {
                  const refInput = document.getElementById('voucher-header-ref-no') as HTMLInputElement;
                  if (refInput) {
                    refInput.focus();
                    refInput.select();
                  } else {
                    const firstItem = document.getElementById('voucher-item-grid-select-0');
                    if (firstItem) firstItem.focus();
                  }
                }
              }}
              className="w-full pl-8 pr-16 py-0.5 text-xs font-black text-slate-950 bg-white border border-slate-400 rounded focus:border-blue-600 focus:ring-1 focus:ring-blue-600 shadow-2xs placeholder:text-slate-400 placeholder:font-normal"
            />

            {/* Clear and Create New Actions */}
            <div className="absolute right-1.5 flex items-center gap-1">
              {(partyInputText || selectedPartyId) && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={e => {
                    e.stopPropagation();
                    setPartyInputText('');
                    setTypedPartyName('');
                    onPartyChange('');
                    onPartyQueryChange?.('');
                    partyInputRef.current?.focus();
                  }}
                  className="p-0.5 text-slate-400 hover:text-slate-600 rounded transition-colors"
                  title="Clear Party"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {allowPartyCreate && (
                <button
                  type="button"
                  id="btn-voucher-header-new-party"
                  tabIndex={-1}
                  onClick={e => {
                    e.stopPropagation();
                    if (onRequestCreateParty) {
                      onRequestCreateParty(partyInputText);
                    } else {
                      setTypedPartyName(partyInputText);
                      setIsInlinePartyOpen(true);
                    }
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors"
                  title="Create New Party (Alt+C)"
                >
                  + New
                </button>
              )}
            </div>
          </div>
          {partyBalance && (
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono shrink-0 border ${
                partyBalance.isOverLimit
                  ? 'bg-red-50 text-red-800 border-red-300 font-black'
                  : 'bg-slate-100 text-slate-900 border-slate-300 font-bold'
              }`}
              title={partyBalance.isOverLimit ? 'Credit limit exceeded!' : 'Current Account Balance'}
            >
              Bal: ₹{partyBalance.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {partyBalance.type}
            </span>
          )}
        </div>

        {/* Sales / Purchase Ledger OR Auto GST State-of-Supply Classification */}
        {showLedger ? (
          <div className="md:col-span-3 flex items-center gap-1.5">
            <span className="text-slate-900 font-extrabold shrink-0 text-[11px] uppercase tracking-tight">
              {isSales ? 'Sales Ledger:' : 'Purchase Ledger:'}
            </span>
            {onGstModeChange ? (
              <select
                value={gstMode}
                onChange={e => onGstModeChange(e.target.value as any)}
                className="flex-1 min-w-0 py-0.5 px-1.5 text-xs font-bold text-slate-900 border border-slate-400 rounded bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
              >
                <option value="INTRA_STATE">Sales A/c (CGST+SGST)</option>
                <option value="INTER_STATE">Interstate A/c (IGST)</option>
                <option value="EXEMPT">Exempted Sales A/c</option>
              </select>
            ) : (
              <span className="flex-1 min-w-0 py-0.5 px-1.5 text-xs font-bold text-slate-800 bg-slate-100 border border-slate-300 rounded font-mono truncate">
                {isSales ? 'Sales A/c' : 'Purchase A/c'} ({gstMode === 'INTER_STATE' ? 'IGST' : gstMode === 'EXEMPT' ? 'Exempt' : 'CGST+SGST'})
              </span>
            )}
          </div>
        ) : (
          <div className={`${showRefNo ? 'md:col-span-3' : 'md:col-span-5'} flex items-center justify-end gap-2 flex-wrap`}>
            {partyStateValidation?.isMissing && selectedPartyId ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="truncate">Party state missing:</span>
                {onPartyStateChange ? (
                  <select
                    id="voucher-header-party-state-select"
                    onChange={e => onPartyStateChange(e.target.value)}
                    defaultValue=""
                    className="py-0.5 px-1 text-[11px] font-bold text-slate-900 bg-white border border-amber-400 rounded focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs cursor-pointer"
                  >
                    <option value="" disabled>Select State...</option>
                    {INDIAN_STATES_LIST.map(st => (
                      <option key={st.code} value={st.name}>
                        {st.code} - {st.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-semibold">State required for GST supply</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-slate-600 font-bold uppercase tracking-tight text-[10px]">
                  Place of Supply:
                </span>
                {onPartyStateChange && selectedPartyId ? (
                  <select
                    id="voucher-header-state-selector"
                    value={partyStateValidation?.partyState || ''}
                    onChange={e => onPartyStateChange(e.target.value)}
                    className="py-0.5 px-1.5 text-[11px] font-bold text-slate-900 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs max-w-40 truncate cursor-pointer hover:border-slate-400"
                    title="Change Party State / Place of Supply"
                  >
                    <option value="" disabled>Select State...</option>
                    {INDIAN_STATES_LIST.map(st => (
                      <option key={st.code} value={st.name}>
                        {st.name} ({st.code})
                      </option>
                    ))}
                  </select>
                ) : partyStateValidation?.partyState ? (
                  <span className="font-bold text-slate-800 font-mono text-[11px]">
                    {partyStateValidation.partyState}
                  </span>
                ) : null}

                {/* GST Mode Badge (clickable toggle if onGstModeChange is supplied) */}
                {onGstModeChange ? (
                  <button
                    type="button"
                    onClick={() => {
                      const nextMode = gstMode === 'INTER_STATE' ? 'INTRA_STATE' : 'INTER_STATE';
                      onGstModeChange(nextMode);
                    }}
                    className={`px-2 py-0.5 rounded font-mono font-black border text-[11px] shadow-2xs cursor-pointer hover:opacity-85 transition-opacity ${
                      gstMode === 'INTER_STATE'
                        ? 'bg-purple-50 text-purple-900 border-purple-300'
                        : gstMode === 'EXEMPT'
                        ? 'bg-slate-100 text-slate-700 border-slate-300'
                        : 'bg-emerald-50 text-emerald-950 border-emerald-300'
                    }`}
                    title="Click to toggle between Intrastate (CGST+SGST) and Interstate (IGST)"
                  >
                    {gstMode === 'INTER_STATE' ? 'INTERSTATE (IGST)' : gstMode === 'EXEMPT' ? 'EXEMPT' : 'INTRA-STATE (CGST + SGST)'}
                  </button>
                ) : (
                  <span
                    className={`px-2 py-0.5 rounded font-mono font-black border text-[11px] shadow-2xs ${
                      gstMode === 'INTER_STATE'
                        ? 'bg-purple-50 text-purple-900 border-purple-300'
                        : gstMode === 'EXEMPT'
                        ? 'bg-slate-100 text-slate-700 border-slate-300'
                        : 'bg-emerald-50 text-emerald-950 border-emerald-300'
                    }`}
                  >
                    {gstMode === 'INTER_STATE' ? 'INTERSTATE (IGST)' : gstMode === 'EXEMPT' ? 'EXEMPT' : 'INTRA-STATE (CGST + SGST)'}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Optional Reference / Supplier Invoice Details */}
        {showRefNo && (
          <div className="md:col-span-3 flex items-center gap-1.5">
            <span className="text-slate-900 font-extrabold shrink-0 text-[11px] uppercase tracking-tight">
              {isSales ? 'Ref No:' : 'Supp Inv:'}
            </span>
            <input
              id="voucher-header-ref-no"
              type="text"
              value={referenceNumber ?? ''}
              onChange={e => onReferenceNumberChange && onReferenceNumberChange(e.target.value)}
              placeholder={isSales ? 'Order / Ref #' : 'Inv #'}
              className="flex-1 min-w-0 py-0.5 px-1.5 text-xs font-bold text-slate-900 border border-slate-400 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
            />

            {!isSales && onSupplierInvoiceDateChange && (
              <input
                id="voucher-header-supp-date"
                type="date"
                value={supplierInvoiceDate ?? ''}
                onChange={e => onSupplierInvoiceDateChange(e.target.value)}
                className="w-28 py-0.5 px-1 text-[11px] font-bold text-slate-900 border border-slate-400 rounded bg-white focus:ring-1 focus:ring-blue-600 font-mono shadow-2xs"
                title="Supplier Invoice Date"
              />
            )}
          </div>
        )}
      </div>

      {/* Inline Party Creation Modal */}
      {isInlinePartyOpen && (
        <InlinePartyModal
          isOpen={isInlinePartyOpen}
          onClose={() => {
            setIsInlinePartyOpen(false);
            setTimeout(() => {
              partyInputRef.current?.focus();
            }, 50);
          }}
          defaultPartyType={isSales ? 'CUSTOMER' : 'SUPPLIER'}
          initialName={typedPartyName}
          onSuccess={handleInlinePartySuccess}
        />
      )}
    </div>
  );
};
