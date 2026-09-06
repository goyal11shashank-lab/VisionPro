import React from 'react';
import { CreditCard, Calendar, AlertCircle } from 'lucide-react';
import { VoucherTotals } from './VoucherTypes';

interface VoucherFooterProps {
  voucherType: 'SALES' | 'PURCHASE';
  totals: VoucherTotals;
  gstMode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT';
  // Narration
  narration: string;
  onNarrationChange: (val: string) => void;
  // Payment terms
  paymentMode?: string;
  onPaymentModeChange?: (val: string) => void;
  paymentTerms?: string;
  onPaymentTermsChange?: (val: string) => void;
  dueDate?: string;
  onDueDateChange?: (val: string) => void;
  // Form error if any
  errorMessage?: string | null;
}

export const VoucherFooter: React.FC<VoucherFooterProps> = ({
  voucherType,
  totals,
  gstMode,
  narration,
  onNarrationChange,
  paymentMode = 'CREDIT',
  onPaymentModeChange,
  paymentTerms = 'NET 30',
  onPaymentTermsChange,
  dueDate = '',
  onDueDateChange,
  errorMessage,
}) => {
  const isSales = voucherType === 'SALES';

  return (
    <div
      id="tally-voucher-footer"
      className="bg-white border-t border-slate-300 shadow-xs px-3 py-2 shrink-0 select-none text-xs"
    >
      {errorMessage && (
        <div className="mb-2 p-1.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="font-semibold">{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Left: Narration & Payment Mode / Terms (col 7) */}
        <div className="lg:col-span-7 space-y-2">
          {/* Narration */}
          <div className="flex items-start gap-2">
            <span className="text-slate-600 font-bold shrink-0 pt-1 text-right w-16">
              Narration:
            </span>
            <textarea
              rows={2}
              value={narration}
              onChange={e => onNarrationChange(e.target.value)}
              placeholder={
                isSales
                  ? 'Enter voucher remarks / terms (e.g. Optical lenses supplied against Rx)...'
                  : 'Enter supplier invoice remarks / delivery note ref...'
              }
              className="flex-1 min-w-0 p-1.5 text-xs font-sans border border-slate-300 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400 custom-scrollbar resize-none"
            />
          </div>

          {/* Payment Mode, Terms & Due Date */}
          <div className="flex flex-wrap items-center gap-4 pl-18 text-[11px]">
            {onPaymentModeChange && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-semibold">Payment:</span>
                <select
                  value={paymentMode}
                  onChange={e => onPaymentModeChange(e.target.value)}
                  className="py-0.5 px-1.5 text-xs bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="CREDIT">Credit (Ledger)</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank Transfer / NEFT</option>
                  <option value="UPI">UPI / QR</option>
                  <option value="CARD">Card / POS</option>
                </select>
              </div>
            )}

            {onPaymentTermsChange && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-semibold">Terms:</span>
                <select
                  value={paymentTerms}
                  onChange={e => onPaymentTermsChange(e.target.value)}
                  className="py-0.5 px-1.5 text-xs bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  <option value="DUE_ON_RECEIPT">Due on Receipt</option>
                  <option value="NET 7">Net 7 Days</option>
                  <option value="NET 15">Net 15 Days</option>
                  <option value="NET 30">Net 30 Days</option>
                  <option value="NET 60">Net 60 Days</option>
                </select>
              </div>
            )}

            {onDueDateChange && dueDate && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-semibold">Due:</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => onDueDateChange(e.target.value)}
                  className="py-0.5 px-1 text-xs border border-slate-300 rounded bg-slate-50 font-mono"
                />
              </div>
            )}

            <div className="text-slate-400">
              Items: <span className="font-bold text-slate-800 font-mono">{totals.totalItems}</span> | Qty:{' '}
              <span className="font-bold text-slate-800 font-mono">{totals.totalQuantity}</span>
            </div>
          </div>
        </div>

        {/* Right: Dense Accounting Breakdown (col 5) */}
        <div className="lg:col-span-5 bg-slate-50 border border-slate-300 rounded p-2 space-y-1 font-mono text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal (Gross):</span>
            <span>₹{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          {totals.discountTotal > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Less Discount:</span>
              <span>- ₹{totals.discountTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}

          <div className="flex justify-between font-semibold text-slate-800 border-t border-slate-200 pt-0.5">
            <span>Taxable Amount:</span>
            <span>₹{totals.taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          {gstMode === 'INTRA_STATE' ? (
            <>
              <div className="flex justify-between text-slate-600 text-[11px]">
                <span>CGST:</span>
                <span>+ ₹{totals.cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-slate-600 text-[11px]">
                <span>SGST:</span>
                <span>+ ₹{totals.sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </>
          ) : gstMode === 'INTER_STATE' ? (
            <div className="flex justify-between text-slate-600 text-[11px]">
              <span>IGST:</span>
              <span>+ ₹{totals.igstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          ) : (
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>GST:</span>
              <span>EXEMPT</span>
            </div>
          )}

          {totals.roundOff !== 0 && (
            <div className="flex justify-between text-slate-500 text-[11px]">
              <span>Round Off:</span>
              <span>
                {totals.roundOff > 0 ? `+ ₹${totals.roundOff.toFixed(2)}` : `- ₹${Math.abs(totals.roundOff).toFixed(2)}`}
              </span>
            </div>
          )}

          {/* Grand Total Bar */}
          <div className="flex justify-between items-baseline font-bold text-slate-900 border-t-2 border-slate-800 pt-1 text-sm">
            <span className="tracking-wide">TOTAL:</span>
            <span className="text-base font-extrabold text-blue-900">
              ₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Tally Shortcut Key Strip */}
      <div className="mt-2 pt-1.5 border-t border-slate-200 flex flex-wrap items-center justify-between text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-4">
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded font-bold">F2</kbd> Date
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded font-bold">F3</kbd> Scan Barcode
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded font-bold">Enter</kbd> Next Cell
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded font-bold">Ctrl+A</kbd> Save &amp; Post
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-200 text-slate-800 rounded font-bold">Esc</kbd> Exit
          </span>
        </div>

        <div className="text-slate-400 font-sans">
          Accounting Standard: Optical ERP GST 2026
        </div>
      </div>
    </div>
  );
};
