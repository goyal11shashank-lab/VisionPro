import React, { useEffect, useRef } from 'react';
import { AlertTriangle, HelpCircle, Layers, X } from 'lucide-react';

export interface StockItemChangeConfirmModalProps {
  isOpen: boolean;
  isSameCategory: boolean;
  oldItemName: string;
  newItemName: string;
  category: string;
  onConfirmSameCategory: () => void;
  onCancelSameCategory: () => void;
  onConfirmDifferentCategory: () => void;
  onCancelDifferentCategory: () => void;
}

export const StockItemChangeConfirmModal: React.FC<StockItemChangeConfirmModalProps> = ({
  isOpen,
  isSameCategory,
  oldItemName,
  newItemName,
  category,
  onConfirmSameCategory,
  onCancelSameCategory,
  onConfirmDifferentCategory,
  onCancelDifferentCategory,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        confirmBtnRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (isSameCategory) {
        onCancelSameCategory();
      } else {
        onCancelDifferentCategory();
      }
    }
  };

  if (isSameCategory) {
    return (
      <div
        id="stock-item-change-confirm-modal"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        onKeyDown={handleKeyDown}
      >
        <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-blue-200 overflow-hidden">
          {/* Header */}
          <div className="bg-blue-900 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-700 rounded text-cyan-300">
                <HelpCircle className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold tracking-wide uppercase font-sans">
                Change Stock Item?
              </h3>
            </div>
            <button
              type="button"
              onClick={onCancelSameCategory}
              className="text-blue-300 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 space-y-4 font-sans text-xs">
            <p className="text-slate-700 leading-relaxed text-xs">
              You are changing the Stock Item from{' '}
              <strong className="text-slate-950 font-bold font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300">
                {oldItemName}
              </strong>{' '}
              to{' '}
              <strong className="text-slate-950 font-bold font-mono bg-blue-50 text-blue-900 px-1.5 py-0.5 rounded border border-blue-200">
                {newItemName}
              </strong>
              . Both items belong to the{' '}
              <span className="font-bold text-blue-800 font-mono uppercase bg-blue-100/60 px-1 py-0.5 rounded">
                {category}
              </span>{' '}
              category. Do you want to retain the existing batch powers and quantities for the new Stock Item?
            </p>

            <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5 flex items-start gap-2 text-slate-600 text-[11px]">
              <Layers className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>
                Retained batch allocations and quantities will be automatically remapped to the new Stock Item&apos;s physical batches.
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 font-sans">
            <button
              type="button"
              id="btn-stock-item-change-no"
              onClick={onCancelSameCategory}
              className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors shadow-2xs cursor-pointer"
            >
              No, Keep Existing Item
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              id="btn-stock-item-change-yes"
              onClick={onConfirmSameCategory}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              Yes, Change Item & Keep Batches
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Different optical category warning
  return (
    <div
      id="stock-item-change-different-category-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-amber-300 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-600 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-700 rounded text-amber-100">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold tracking-wide uppercase font-sans">
              Optical Category Changed
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancelDifferentCategory}
            className="text-amber-200 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3 font-sans text-xs">
          <p className="text-slate-700 leading-relaxed text-xs">
            The selected Stock Item belongs to a different optical category. The existing batch allocations may not be compatible with the new item. If you continue, all current batch allocations and their quantities will be cleared.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2 text-amber-900 text-[11px]">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              You will need to re-enter batch powers according to the new category structure (e.g. Bifocal / Progressive / Single Vision).
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 font-sans">
          <button
            type="button"
            id="btn-stock-item-diff-cat-cancel"
            onClick={onCancelDifferentCategory}
            className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors shadow-2xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            id="btn-stock-item-diff-cat-confirm"
            onClick={onConfirmDifferentCategory}
            className="px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            Change Item & Clear Batches
          </button>
        </div>
      </div>
    </div>
  );
};
