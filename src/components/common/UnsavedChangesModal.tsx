import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X, ShieldAlert } from 'lucide-react';

export interface UnsavedChangesModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  onStay: () => void;
  onLeave: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  isOpen,
  title = 'Unsaved Changes',
  message = 'You have unsaved changes. If you leave this page, your changes may be lost.',
  onStay,
  onLeave,
}) => {
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the "Stay on Page" button by default when modal opens for maximum safety
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        stayButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key to stay on page
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onStay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onStay]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-modal-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs animate-in fade-in duration-150 select-none"
    >
      <div
        className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-300 overflow-hidden transform transition-all scale-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="bg-amber-500/10 border-b border-amber-200/80 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-900">
            <div className="p-1 rounded-md bg-amber-500/20 text-amber-700">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <h3 id="unsaved-modal-title" className="text-sm font-bold tracking-tight text-slate-900 font-sans">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onStay}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
            title="Stay on Page (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-3">
          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans">
            {message}
          </p>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1 font-sans">
            <p className="font-semibold text-slate-800">Choose an option:</p>
            <p>• <strong>Stay on Page:</strong> Keep editing without losing your entered items, batches, or party details.</p>
            <p>• <strong>Leave Without Saving:</strong> Discard your current edits and proceed with navigation.</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-2.5">
          <button
            ref={stayButtonRef}
            type="button"
            id="btn-unsaved-stay"
            onClick={onStay}
            className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs hover:border-slate-400 transition-colors cursor-pointer"
          >
            Stay on Page
          </button>
          <button
            type="button"
            id="btn-unsaved-leave"
            onClick={onLeave}
            className="px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs hover:shadow-xs transition-colors cursor-pointer"
          >
            Leave Without Saving
          </button>
        </div>
      </div>
    </div>
  );
};
