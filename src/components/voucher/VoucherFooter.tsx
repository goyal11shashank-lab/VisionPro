import React from 'react';
import {
  AlertCircle,
  Check,
  Send,
  Trash2,
  XCircle,
  Printer,
  CornerDownLeft,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { VoucherTotals } from './VoucherTypes';

interface VoucherFooterProps {
  voucherType: 'SALES' | 'PURCHASE';
  totals: VoucherTotals;
  gstMode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT';
  onGstModeChange?: (mode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT') => void;
  // Narration
  narration: string;
  onNarrationChange: (val: string) => void;
  // Editable Invoice-Level Controls
  courierCharges?: number;
  onCourierChargesChange?: (val: number) => void;
  discount?: number;
  onDiscountChange?: (val: number) => void;
  gstRate?: number;
  onGstRateChange?: (val: number) => void;
  // Previous balance
  previousBalance?: { balance: number; type: 'Dr' | 'Cr' } | number | null;
  // Form error if any
  errorMessage?: string | null;
  // Fixed Bottom Command Bar Actions
  isEditing?: boolean;
  canDelete?: boolean;
  canCancel?: boolean;
  submitting?: boolean;
  onSave?: () => void;
  onSaveAndNew?: () => void;
  onDelete?: () => void;
  onCancelVoucher?: () => void;
  onPrint?: () => void;
  onBack?: () => void;
}

export const VoucherFooter: React.FC<VoucherFooterProps> = ({
  voucherType,
  totals,
  gstMode,
  onGstModeChange,
  narration,
  onNarrationChange,
  courierCharges = 0,
  onCourierChargesChange,
  discount = 0,
  onDiscountChange,
  gstRate = 0,
  onGstRateChange,
  previousBalance,
  errorMessage,
  isEditing = false,
  canDelete = false,
  canCancel = false,
  submitting = false,
  onSave,
  onSaveAndNew,
  onDelete,
  onCancelVoucher,
  onPrint,
  onBack,
}) => {
  const isSales = voucherType === 'SALES';

  // Normalize previous balance
  const prevBalNum =
    typeof previousBalance === 'number'
      ? previousBalance
      : (previousBalance?.balance ?? totals.previousBalance ?? 0);

  const prevBalType =
    typeof previousBalance === 'object' && previousBalance?.type
      ? previousBalance.type
      : isSales
      ? (prevBalNum < 0 ? 'Cr' : 'Dr')
      : (prevBalNum < 0 ? 'Dr' : 'Cr');

  // For sales: Dr is positive receivable from customer, Cr is advance
  // For purchases: Cr is positive payable to supplier, Dr is advance
  let signedPrevBal = 0;
  if (isSales) {
    signedPrevBal = prevBalType === 'Cr' ? -Math.abs(prevBalNum) : Math.abs(prevBalNum);
  } else {
    signedPrevBal = prevBalType === 'Dr' ? -Math.abs(prevBalNum) : Math.abs(prevBalNum);
  }

  const finalTotal = Math.round((totals.grandTotal + signedPrevBal) * 100) / 100;

  return (
    <footer
      id="tally-voucher-footer"
      className="bg-white border-t border-slate-300 shadow-2xs shrink-0 select-none text-xs font-sans"
    >
      {/* Optional Form Error Banner */}
      {errorMessage && (
        <div className="mx-2.5 mt-1.5 p-1 px-2.5 bg-rose-50 border border-rose-300 text-rose-800 text-xs rounded flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
          <span className="font-bold">{errorMessage}</span>
        </div>
      )}

      {/* Main Totals & Narration Section */}
      <div className="px-2.5 py-1.5 grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-start">
        {/* Left: Narration & Quantities (col 7) */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-1.5 h-full">
          <div className="flex items-start gap-1.5">
            <span className="text-slate-900 font-extrabold shrink-0 pt-0.5 text-right w-16 text-[11px] uppercase tracking-tight">
              Narration:
            </span>
            <textarea
              id="voucher-narration-textarea"
              rows={2}
              value={narration ?? ''}
              onChange={e => onNarrationChange(e.target.value)}
              placeholder={
                isSales
                  ? 'Enter voucher remarks / terms (e.g. Optical lenses supplied against Rx)...'
                  : 'Enter supplier invoice remarks / delivery note ref...'
              }
              className="flex-1 min-w-0 p-1 text-xs font-bold text-slate-900 font-sans border border-slate-300 rounded bg-white focus:bg-white focus:ring-1 focus:ring-blue-600 placeholder:text-slate-400 placeholder:font-normal custom-scrollbar resize-none shadow-2xs"
            />
          </div>

          <div className="flex items-center gap-6 pl-18 text-[11px] text-slate-700">
            <div>
              <span className="font-bold text-slate-800 uppercase tracking-tight">Total Items:</span>{' '}
              <span className="font-black text-slate-950 font-mono text-xs ml-1">{totals.totalItems}</span>
            </div>
            <div>
              <span className="font-bold text-slate-800 uppercase tracking-tight">Total Quantity:</span>{' '}
              <span className="font-black text-slate-950 font-mono text-xs ml-1">{totals.totalQuantity}</span>
            </div>
          </div>
        </div>

        {/* Right: Dense Accounting Breakdown (col 5) */}
        <div className="lg:col-span-5 bg-slate-50 border border-slate-300 rounded p-2.5 space-y-1.5 font-mono text-xs shadow-2xs">
          {/* Subtotal (Gross) */}
          <div className="flex justify-between items-center text-slate-800 font-bold text-[11px]">
            <span className="uppercase tracking-tight">Subtotal (Gross):</span>
            <span className="font-black text-slate-900">
              ₹{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Editable Discount (₹) */}
          <div className="flex justify-between items-center text-emerald-800 font-bold text-[11px] bg-emerald-50/70 p-1 rounded border border-emerald-200">
            <span className="uppercase tracking-tight">Less Discount (₹):</span>
            <div className="flex items-center gap-1.5">
              {onDiscountChange ? (
                <input
                  id="voucher-footer-discount-input"
                  type="number"
                  min="0"
                  max={totals.subtotal}
                  step="any"
                  value={discount !== undefined && discount !== null ? discount : ''}
                  placeholder="0.00"
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    onDiscountChange(isNaN(val) ? 0 : Math.max(0, val));
                  }}
                  className="w-20 text-right py-0.5 px-1.5 text-xs font-mono font-black text-emerald-950 bg-white border border-emerald-400 rounded focus:border-blue-600 focus:ring-1 focus:ring-blue-600 shadow-2xs"
                />
              ) : null}
              <span className="font-black text-emerald-900 w-24 text-right">
                - ₹{(discount || totals.discountTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Taxable Amount */}
          <div className="flex justify-between items-center font-black text-slate-900 border-t border-slate-200 pt-1 text-[11px]">
            <span className="uppercase tracking-tight">Taxable Amount:</span>
            <span>₹{totals.taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          {/* GST Rate (%) & Applied Tax Breakdown */}
          <div className="bg-slate-100/90 p-1.5 rounded border border-slate-200 space-y-1">
            <div className="flex justify-between items-center text-slate-800 font-bold text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="uppercase tracking-tight">GST Rate:</span>
                {onGstModeChange ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = gstMode === 'INTER_STATE' ? 'INTRA_STATE' : 'INTER_STATE';
                      onGstModeChange(next);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-black uppercase border cursor-pointer hover:opacity-85 transition-opacity ${
                      gstMode === 'INTER_STATE'
                        ? 'bg-purple-100 text-purple-900 border-purple-300'
                        : gstMode === 'EXEMPT'
                        ? 'bg-slate-100 text-slate-700 border-slate-300'
                        : 'bg-emerald-100 text-emerald-950 border-emerald-300'
                    }`}
                    title="Click to toggle between Intrastate (CGST+SGST) and Interstate (IGST)"
                  >
                    {gstMode === 'INTER_STATE' ? 'IGST' : gstMode === 'EXEMPT' ? 'Exempt' : 'CGST+SGST'}
                  </button>
                ) : (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-black uppercase border ${
                      gstMode === 'INTER_STATE'
                        ? 'bg-purple-100 text-purple-900 border-purple-300'
                        : gstMode === 'EXEMPT'
                        ? 'bg-slate-100 text-slate-700 border-slate-300'
                        : 'bg-emerald-100 text-emerald-950 border-emerald-300'
                    }`}
                  >
                    {gstMode === 'INTER_STATE' ? 'IGST' : gstMode === 'EXEMPT' ? 'Exempt' : 'CGST+SGST'}
                  </span>
                )}
              </div>
              {onGstRateChange ? (
                <select
                  id="voucher-footer-gst-rate-select"
                  value={gstRate !== undefined ? gstRate : (totals.gstRate ?? 0)}
                  onChange={e => onGstRateChange(parseFloat(e.target.value) || 0)}
                  className="w-20 py-0.5 px-1.5 text-xs font-mono font-black text-slate-900 bg-white border border-slate-400 rounded focus:border-blue-600 focus:ring-1 focus:ring-blue-600 shadow-2xs cursor-pointer"
                >
                  <option value="0">0%</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18%</option>
                  <option value="28">28%</option>
                  {![0, 5, 12, 18, 28].includes(Number(gstRate)) && gstRate !== undefined && (
                    <option value={gstRate}>{gstRate}%</option>
                  )}
                </select>
              ) : (
                <span className="font-black text-slate-900 font-mono">{gstRate ?? totals.gstRate ?? 0}%</span>
              )}
            </div>

            {/* Split: CGST + SGST vs IGST */}
            {gstMode === 'INTRA_STATE' ? (
              <>
                <div className="flex justify-between text-slate-700 font-bold text-[10px] pl-1.5">
                  <span className="uppercase tracking-tight">
                    CGST ({((gstRate ?? totals.gstRate ?? 0) / 2).toFixed(1)}%):
                  </span>
                  <span>+ ₹{totals.cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-slate-700 font-bold text-[10px] pl-1.5">
                  <span className="uppercase tracking-tight">
                    SGST ({((gstRate ?? totals.gstRate ?? 0) / 2).toFixed(1)}%):
                  </span>
                  <span>+ ₹{totals.sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </>
            ) : gstMode === 'INTER_STATE' ? (
              <div className="flex justify-between text-slate-700 font-bold text-[10px] pl-1.5">
                <span className="uppercase tracking-tight">
                  IGST ({(gstRate ?? totals.gstRate ?? 0).toFixed(1)}%):
                </span>
                <span>+ ₹{totals.igstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ) : (
              <div className="flex justify-between text-slate-500 font-bold text-[10px] pl-1.5">
                <span className="uppercase tracking-tight">GST:</span>
                <span>EXEMPT (0%)</span>
              </div>
            )}
          </div>

          {/* Editable Courier Charges (₹) */}
          <div className="flex justify-between items-center text-slate-900 font-bold text-[11px] bg-blue-50/70 p-1 rounded border border-blue-200">
            <span className="uppercase tracking-tight">Courier Charges (₹):</span>
            <div className="flex items-center gap-1.5">
              {onCourierChargesChange ? (
                <input
                  id="voucher-footer-courier-input"
                  type="number"
                  min="0"
                  step="any"
                  value={courierCharges !== undefined && courierCharges !== null ? courierCharges : ''}
                  placeholder="0.00"
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    onCourierChargesChange(isNaN(val) ? 0 : Math.max(0, val));
                  }}
                  className="w-20 text-right py-0.5 px-1.5 text-xs font-mono font-black text-blue-950 bg-white border border-blue-400 rounded focus:border-blue-600 focus:ring-1 focus:ring-blue-600 shadow-2xs"
                />
              ) : null}
              <span className="font-black text-blue-900 w-24 text-right">
                + ₹{Number(courierCharges || totals.courierCharges || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Round Off */}
          {totals.roundOff !== 0 && (
            <div className="flex justify-between text-slate-600 font-bold text-[10px]">
              <span className="uppercase tracking-tight">Round Off:</span>
              <span>
                {totals.roundOff > 0 ? `+ ₹${totals.roundOff.toFixed(2)}` : `- ₹${Math.abs(totals.roundOff).toFixed(2)}`}
              </span>
            </div>
          )}

          {/* Bill Amount and Previous Balance */}
          <div className="border-t border-slate-200 pt-0.5 space-y-0.5 text-[11px]">
            <div className="flex justify-between text-slate-900 font-bold">
              <span className="uppercase tracking-tight">Bill Amount:</span>
              <span className="font-black text-slate-950">
                ₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex justify-between text-slate-700 font-bold">
              <span className="uppercase tracking-tight">Prev Balance:</span>
              <span className={prevBalNum !== 0 ? 'font-black text-amber-900' : 'text-slate-500'}>
                {prevBalNum !== 0 ? (
                  <>
                    {signedPrevBal >= 0 ? '+ ' : '- '}₹{Math.abs(prevBalNum).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-[10px] ml-1 text-slate-600 font-sans font-bold">({prevBalType})</span>
                  </>
                ) : (
                  '₹0.00'
                )}
              </span>
            </div>
          </div>

          {/* Grand Total Bar */}
          <div className="flex justify-between items-baseline font-black text-slate-950 border-t-2 border-slate-900 pt-1 text-sm">
            <span className="tracking-wider uppercase text-xs">TOTAL:</span>
            <span className="text-sm font-black text-blue-950">
              ₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Command Bar (Tally-Style Full-Width Strip) */}
      <div className="bg-[#0f2e54] text-white px-3 py-1 flex flex-wrap items-center justify-between border-t border-blue-950 font-mono text-xs">
        {/* Left Command Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-2 py-0.5 text-[11px] font-bold text-slate-200 bg-white/10 hover:bg-white/20 hover:text-white rounded border border-white/20 transition-colors flex items-center gap-1 cursor-pointer"
              title="Quit / Exit Voucher (Esc)"
            >
              <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-cyan-300">Esc</kbd>
              <span>Quit</span>
            </button>
          )}

          {onSaveAndNew && (
            <button
              type="button"
              disabled={submitting}
              onClick={onSaveAndNew}
              className="px-2.5 py-0.5 text-[11px] font-black text-white bg-emerald-600 hover:bg-emerald-500 rounded border border-emerald-400/50 shadow-2xs transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              title="Save Voucher and Open New (Ctrl+A)"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin text-cyan-200" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-cyan-300">Ctrl+A</kbd>
                  <span>Save &amp; New</span>
                </>
              )}
            </button>
          )}

          {onSave && (
            <button
              type="button"
              disabled={submitting}
              onClick={onSave}
              className="px-2.5 py-0.5 text-[11px] font-bold text-slate-200 bg-white/10 hover:bg-white/20 hover:text-white rounded border border-white/20 shadow-2xs transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              title="Accept & Save Voucher"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin text-cyan-200" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>{isEditing ? 'Accept (Update)' : 'Accept (Save)'}</span>
                </>
              )}
            </button>
          )}

          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="px-2.5 py-0.5 text-[11px] font-bold text-slate-200 bg-white/10 hover:bg-white/20 hover:text-white rounded border border-white/20 transition-colors flex items-center gap-1 cursor-pointer"
              title="Print Preview Voucher (Ctrl+P)"
            >
              <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-cyan-300">Ctrl+P</kbd>
              <Printer className="w-3 h-3" />
              <span>Print Preview</span>
            </button>
          )}

          {isEditing && canDelete && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="px-2 py-0.5 text-[11px] font-bold text-rose-200 bg-rose-900/60 hover:bg-rose-800 rounded border border-rose-700/50 transition-colors flex items-center gap-1 cursor-pointer"
              title="Delete Voucher (Alt+D)"
            >
              <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-rose-300">Alt+D</kbd>
              <span>Delete</span>
            </button>
          )}

          {isEditing && canCancel && onCancelVoucher && (
            <button
              type="button"
              onClick={onCancelVoucher}
              className="px-2 py-0.5 text-[11px] font-bold text-amber-200 bg-amber-900/60 hover:bg-amber-800 rounded border border-amber-700/50 transition-colors flex items-center gap-1 cursor-pointer"
              title="Cancel Voucher (Alt+X)"
            >
              <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-amber-300">Alt+X</kbd>
              <span>Cancel Voucher</span>
            </button>
          )}

          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="px-2 py-0.5 text-[11px] font-bold text-slate-200 bg-white/10 hover:bg-white/20 hover:text-white rounded border border-white/20 transition-colors flex items-center gap-1 cursor-pointer"
              title="Print Voucher (Alt+P)"
            >
              <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-cyan-300">Alt+P</kbd>
              <span>Print</span>
            </button>
          )}
        </div>

        {/* Right Status / Navigation Help */}
        <div className="flex items-center gap-3 text-[10px] text-cyan-200/80">
          <span>
            <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-cyan-300">F2</kbd> Date
          </span>
          <span>
            <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-cyan-300">Enter</kbd> Next
          </span>
          <span>
            <kbd className="px-1 py-0.2 bg-black/40 rounded text-[9px] text-cyan-300">Alt+C</kbd> Create Master
          </span>
        </div>
      </div>
    </footer>
  );
};
