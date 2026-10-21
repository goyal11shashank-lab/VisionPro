import React, { useEffect, useRef } from 'react';
import { AlertTriangle, HelpCircle, X, Check, ArrowRight } from 'lucide-react';

export interface StockItemChangeModalProps {
  isOpen: boolean;
  isSameCategory: boolean;
  oldItemName: string;
  oldItemCode?: string;
  newItemName: string;
  newItemCode?: string;
  categoryCode: string; // e.g. 'SV' | 'KT' | 'PROG'
  allocationsCount?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const StockItemChangeModal: React.FC<StockItemChangeModalProps> = ({
  isOpen,
  isSameCategory,
  oldItemName,
  oldItemCode,
  newItemName,
  newItemCode,
  categoryCode,
  allocationsCount = 0,
  onConfirm,
  onCancel,
}) => {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const oldDisplay = oldItemCode ? `${oldItemName} (${oldItemCode})` : oldItemName;
  const newDisplay = newItemCode ? `${newItemName} (${newItemCode})` : newItemName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl border border-slate-300 w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div
          className={`px-4 py-3 text-white flex items-center justify-between border-b ${
            isSameCategory
              ? 'bg-slate-800 border-slate-700'
              : 'bg-amber-900 border-amber-800'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`p-1.5 rounded ${
                isSameCategory
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                  : 'bg-amber-600/40 text-amber-200 border border-amber-500/50'
              }`}
            >
              {isSameCategory ? (
                <HelpCircle className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-black tracking-wide uppercase">
                {isSameCategory ? 'Change Stock Item?' : 'Optical Category Changed'}
              </h3>
              <p className="text-[11px] text-slate-300 font-mono">
                Category: <span className="font-bold uppercase text-white">{categoryCode}</span>
                {allocationsCount > 0 && ` • ${allocationsCount} batch allocation(s)`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-xs font-sans">
          {/* Visual Item Transition Comparison */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between gap-3 font-mono">
            <div className="flex-1 min-w-0">
              <span className="text-[10px] text-slate-500 font-sans uppercase font-bold block mb-0.5">
                Current Item
              </span>
              <div className="font-bold text-slate-800 truncate" title={oldDisplay}>
                {oldDisplay}
              </div>
            </div>

            <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />

            <div className="flex-1 min-w-0 text-right">
              <span className="text-[10px] text-slate-500 font-sans uppercase font-bold block mb-0.5">
                New Item
              </span>
              <div className="font-bold text-blue-900 truncate" title={newDisplay}>
                {newDisplay}
              </div>
            </div>
          </div>

          {/* Explicit message as specified */}
          {isSameCategory ? (
            <div className="space-y-2 text-slate-700 leading-relaxed">
              <p>
                You are changing the Stock Item from{' '}
                <code className="px-1 py-0.5 bg-slate-100 rounded font-mono font-bold text-slate-900 border border-slate-200">
                  {oldItemName}
                </code>{' '}
                to{' '}
                <code className="px-1 py-0.5 bg-blue-50 rounded font-mono font-bold text-blue-900 border border-blue-200">
                  {newItemName}
                </code>
                . Both items belong to the <strong>{categoryCode}</strong> category.
              </p>
              <p className="font-semibold text-slate-900">
                Do you want to retain the existing batch powers and quantities for the new Stock Item?
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-slate-700 leading-relaxed">
              <p>
                The selected Stock Item belongs to a different optical category. The existing batch
                allocations may not be compatible with the new item.
              </p>
              <p className="font-semibold text-amber-900 bg-amber-50 p-2 rounded border border-amber-200">
                If you continue, all current batch allocations and their quantities will be cleared.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-100 border-t border-slate-200 px-5 py-3 flex items-center justify-end gap-3 font-sans">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-200/80 rounded border border-slate-300 transition-colors cursor-pointer"
          >
            {isSameCategory ? 'No, Keep Existing Item' : 'Cancel'}
          </button>

          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-bold text-white rounded shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer ${
              isSameCategory
                ? 'bg-blue-700 hover:bg-blue-800 focus:ring-2 focus:ring-blue-500'
                : 'bg-amber-700 hover:bg-amber-800 focus:ring-2 focus:ring-amber-500'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>
              {isSameCategory
                ? 'Yes, Change Item & Keep Batches'
                : 'Change Item & Clear Batches'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
