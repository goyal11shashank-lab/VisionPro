import React from 'react';
import { AlertCircle } from 'lucide-react';
import { VoucherTotals } from './VoucherTypes';

interface VoucherFooterProps {
  voucherType: 'SALES' | 'PURCHASE';
  totals: VoucherTotals;
  gstMode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT';
  // Narration
  narration: string;
  onNarrationChange: (val: string) => void;
  // Previous balance
  previousBalance?: { balance: number; type: 'Dr' | 'Cr' } | number | null;
  // Legacy / optional props retained for compatibility
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
  previousBalance,
  errorMessage,
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
        {/* Left: Narration & Summary (col 7) */}
        <div className="lg:col-span-7 space-y-2">
          {/* Narration */}
          <div className="flex items-start gap-2">
            <span className="text-slate-600 font-bold shrink-0 pt-1 text-right w-16">
              Narration:
            </span>
            <textarea
              rows={2}
              value={narration ?? ''}
              onChange={e => onNarrationChange(e.target.value)}
              placeholder={
                isSales
                  ? 'Enter voucher remarks / terms (e.g. Optical lenses supplied against Rx)...'
                  : 'Enter supplier invoice remarks / delivery note ref...'
              }
              className="flex-1 min-w-0 p-1.5 text-xs font-sans border border-slate-300 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400 custom-scrollbar resize-none"
            />
          </div>

          <div className="flex items-center gap-4 pl-18 text-[11px] text-slate-500">
            <div>
              Total Items: <span className="font-bold text-slate-800 font-mono">{totals.totalItems}</span>
            </div>
            <div>
              Total Quantity:{' '}
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

          {/* Under GST: Bill Amount and Previous Balance */}
          <div className="border-t border-slate-200 pt-1 space-y-1">
            <div className="flex justify-between text-slate-700 text-xs">
              <span>Bill Amount:</span>
              <span className="font-semibold">
                ₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex justify-between text-slate-700 text-xs">
              <span>Previous Balance:</span>
              <span className={prevBalNum !== 0 ? 'font-semibold text-amber-800' : 'text-slate-500'}>
                {prevBalNum !== 0 ? (
                  <>
                    {signedPrevBal >= 0 ? '+ ' : '- '}₹{Math.abs(prevBalNum).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-[10px] ml-1 text-slate-500 font-sans font-normal">({prevBalType})</span>
                  </>
                ) : (
                  '₹0.00'
                )}
              </span>
            </div>
          </div>

          {/* Grand Total Bar - added with previous balance */}
          <div className="flex justify-between items-baseline font-bold text-slate-900 border-t-2 border-slate-800 pt-1 text-sm">
            <span className="tracking-wide">TOTAL:</span>
            <span className="text-base font-extrabold text-blue-900">
              ₹{finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
