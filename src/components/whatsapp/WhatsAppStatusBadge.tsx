import React from 'react';
import { MessageSquare, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface Props {
  status?: string | null;
  className?: string;
  onClick?: () => void;
  showIconOnly?: boolean;
}

export const WhatsAppStatusBadge: React.FC<Props> = ({
  status = 'NONE',
  className = '',
  onClick,
  showIconOnly = false,
}) => {
  const normStatus = (status || 'NONE').toUpperCase();

  let badgeContent = null;
  switch (normStatus) {
    case 'SENT':
      badgeContent = (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 ${
            onClick ? 'cursor-pointer hover:bg-emerald-100' : ''
          } ${className}`}
          title="Invoice sent via WhatsApp"
          onClick={onClick}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          {!showIconOnly && <span>Sent</span>}
        </span>
      );
      break;

    case 'PROCESSING':
    case 'PENDING':
      badgeContent = (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse ${
            onClick ? 'cursor-pointer hover:bg-amber-100' : ''
          } ${className}`}
          title="Sending in progress..."
          onClick={onClick}
        >
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          {!showIconOnly && <span>Queued</span>}
        </span>
      );
      break;

    case 'FAILED':
      badgeContent = (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 ${
            onClick ? 'cursor-pointer hover:bg-rose-100' : ''
          } ${className}`}
          title="Failed to deliver. Click to retry or open WhatsApp."
          onClick={onClick}
        >
          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
          {!showIconOnly && <span>Failed</span>}
        </span>
      );
      break;

    default:
      badgeContent = (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 ${
            onClick ? 'cursor-pointer hover:bg-slate-200 hover:text-slate-800' : ''
          } ${className}`}
          title="Click to share invoice via WhatsApp"
          onClick={onClick}
        >
          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
          {!showIconOnly && <span>Share</span>}
        </span>
      );
      break;
  }

  return badgeContent;
};
