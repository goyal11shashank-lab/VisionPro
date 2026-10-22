import React from 'react';
import { History, RotateCcw, Trash2, CheckCircle2 } from 'lucide-react';

export interface VoucherDraftRecoveryBannerProps {
  savedAt: number;
  itemCount: number;
  partyName?: string;
  onRestore: () => void;
  onDiscard: () => void;
}

export const VoucherDraftRecoveryBanner: React.FC<VoucherDraftRecoveryBannerProps> = ({
  savedAt,
  itemCount,
  partyName,
  onRestore,
  onDiscard,
}) => {
  const formattedTime = new Date(savedAt).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      id="voucher-draft-recovery-banner"
      className="bg-amber-50 border-b border-amber-300 px-3 py-1.5 flex items-center justify-between text-xs text-amber-950 shrink-0 font-sans shadow-2xs"
    >
      <div className="flex items-center gap-2 min-w-0 pr-2">
        <div className="p-1 rounded bg-amber-200/80 text-amber-900 shrink-0">
          <History className="w-3.5 h-3.5" />
        </div>
        <span className="truncate">
          <strong>Recovered Unsaved Draft:</strong> A session draft from <strong>{formattedTime}</strong> ({itemCount} item{itemCount === 1 ? '' : 's'}{partyName ? ` • ${partyName}` : ''}) was found.
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          id="btn-restore-draft"
          onClick={onRestore}
          className="px-2.5 py-0.5 text-[11px] font-bold text-white bg-amber-700 hover:bg-amber-800 rounded shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Restore Draft</span>
        </button>
        <button
          type="button"
          id="btn-discard-draft"
          onClick={onDiscard}
          className="px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:text-red-700 hover:bg-amber-100 rounded transition-colors flex items-center gap-1 cursor-pointer"
        >
          <Trash2 className="w-3 h-3" />
          <span>Discard</span>
        </button>
      </div>
    </div>
  );
};
