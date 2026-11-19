import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Send,
  ExternalLink,
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Phone,
  Clock,
  Settings,
  HelpCircle,
  X,
  FileText,
} from 'lucide-react';
import { getAuthHeaders } from '../../api/client.js';
import { WhatsAppStatusBadge } from './WhatsAppStatusBadge.js';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';

interface Props {
  invoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    grandTotal: string | number;
    partyId?: string;
    partyName?: string;
    partyMobile?: string;
    party?: {
      mobile?: string;
      alternateMobile?: string;
      name?: string;
      whatsappOptIn?: boolean;
    };
  };
  currentBusiness?: {
    id: string;
    name: string;
    tradeName?: string;
  } | null;
  onClose: () => void;
  onSuccess?: () => void;
  onOpenSettings?: () => void;
  onDownloadPdf?: () => void;
}

export const WhatsAppShareModal: React.FC<Props> = ({
  invoice,
  currentBusiness,
  onClose,
  onSuccess,
  onOpenSettings,
  onDownloadPdf,
}) => {
  useEscapeKey(true, onClose);
  const initialPhone =
    invoice.party?.mobile ||
    invoice.party?.alternateMobile ||
    invoice.partyMobile ||
    '';

  const [recipientPhone, setRecipientPhone] = useState(initialPhone);
  const [recipientName, setRecipientName] = useState(
    invoice.party?.name || invoice.partyName || 'Valued Customer'
  );
  const [messageText, setMessageText] = useState('');
  const [sessionStatus, setSessionStatus] = useState<string>('NOT_CONNECTED');
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [currentQueueStatus, setCurrentQueueStatus] = useState<string>('NONE');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setImageFile(null);
    setImagePreview(null);
    setImageError(null);
    if (currentBusiness?.id) {
      fetch(`/api/sales/invoices/${invoice.id}/image`, { headers: getAuthHeaders(currentBusiness.id) })
        .then(async response => {
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || 'Invoice image could not be created.');
          }
          const blob = await response.blob();
          if (!active) return;
          const fileName = `${invoice.invoiceNumber.replace(/[^\w-]+/g, '_')}.png`;
          setImageFile(new File([blob], fileName, { type: 'image/png' }));
          objectUrl = URL.createObjectURL(blob);
          setImagePreview(objectUrl);
        })
        .catch(error => { if (active) setImageError(error.message); });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [invoice.id, currentBusiness?.id]);

  const downloadInvoiceImage = () => {
    if (!imageFile || !imagePreview) return;
    const link = document.createElement('a');
    link.href = imagePreview;
    link.download = imageFile.name;
    link.click();
    setActionSuccess('Invoice PNG downloaded. Attach this image in the intended WhatsApp chat. No message has been sent.');
  };

  const shareInvoiceImage = async () => {
    if (!imageFile) return;
    setActionError(null);
    if (!navigator.canShare?.({ files: [imageFile] }) || !navigator.share) {
      downloadInvoiceImage();
      return;
    }
    try {
      await navigator.share({ files: [imageFile], title: `Invoice ${invoice.invoiceNumber}`, text: messageText });
      setActionSuccess('Image handed to your device share sheet. Choose WhatsApp and verify the recipient. Delivery is not confirmed here.');
    } catch (error: any) {
      if (error.name !== 'AbortError') setActionError('Image sharing is unavailable. Download the PNG and attach it in WhatsApp.');
    }
  };

  // Load session and invoice WhatsApp status
  const fetchStatusAndHistory = async () => {
    if (!currentBusiness?.id) return;
    try {
      setSessionLoading(true);

      // Fetch session status
      const sessionRes = await fetch('/api/whatsapp/status', {
        headers: getAuthHeaders(currentBusiness.id),
      });
      const sessionData = await sessionRes.json().catch(() => ({}));
      if (sessionRes.ok && sessionData.success) {
        setSessionStatus(sessionData.session?.status || 'NOT_CONNECTED');
        setConnectedPhone(sessionData.session?.connectedPhone || null);

        // Prepopulate default template if message is empty
        if (!messageText) {
          const template =
            sessionData.settings?.messageTemplate ||
            `Dear {{customer_name}},\n\nThank you for choosing {{business_name}}! Please find attached your Tax Invoice #{{invoice_number}} for {{invoice_total}} dated {{invoice_date}}.\n\nWarm regards,\n{{business_name}}`;

          const bizName = currentBusiness.tradeName || currentBusiness.name || 'Optical ERP';
          const formattedTotal = `₹${parseFloat(String(invoice.grandTotal)).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
          })}`;

          const populated = template
            .replace(/{{customer_name}}/g, recipientName)
            .replace(/{{business_name}}/g, bizName)
            .replace(/{{invoice_number}}/g, invoice.invoiceNumber)
            .replace(/{{invoice_total}}/g, formattedTotal)
            .replace(
              /{{invoice_date}}/g,
              new Date(invoice.invoiceDate).toLocaleDateString('en-IN')
            );

          setMessageText(populated);
        }
      }

      // Fetch invoice WhatsApp history
      const invRes = await fetch(`/api/whatsapp/invoices/${invoice.id}/status`, {
        headers: getAuthHeaders(currentBusiness.id),
      });
      const invData = await invRes.json().catch(() => ({}));
      if (invRes.ok && invData.success) {
        setCurrentQueueStatus(invData.status || 'NONE');
        setHistory(invData.history || []);
      }
    } catch (err: any) {
      console.error('Failed to load WhatsApp modal info', err);
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    fetchStatusAndHistory();
  }, [invoice.id, currentBusiness?.id]);

  // Phone validation
  const cleanPhoneDigits = recipientPhone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  const isValidIndianNumber =
    /^[6-9]\d{9}$/.test(cleanPhoneDigits) || /^91[6-9]\d{9}$/.test(cleanPhoneDigits);
  const isValidPhone = cleanPhoneDigits.length >= 10;

  // Normalized phone for wa.me
  const targetWaPhone = cleanPhoneDigits.startsWith('91')
    ? cleanPhoneDigits
    : cleanPhoneDigits.length === 10
    ? `91${cleanPhoneDigits}`
    : cleanPhoneDigits;

  const waMeUrl = `https://wa.me/${targetWaPhone}?text=${encodeURIComponent(messageText)}`;

  // Handle Send via Connected Session
  const handleSendViaSession = async () => {
    if (!isValidPhone) {
      setActionError('Please enter a valid 10-digit customer mobile number.');
      return;
    }

    try {
      setLoading(true);
      setActionError(null);
      setActionSuccess(null);

      const res = await fetch('/api/whatsapp/send-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(currentBusiness?.id),
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          recipientPhone,
          recipientName,
          customMessage: messageText,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success || data.result?.success === false) {
        throw new Error(
          data.error ||
          data.result?.error ||
          'Failed to send message via connected WhatsApp'
        );
      }

      setActionSuccess(
        data.result?.message ||
        `WhatsApp acknowledged the invoice message to ${recipientPhone}. Delivery/read status is not confirmed.`
      );
      fetchStatusAndHistory();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setActionError(err.message || 'Error sending via WhatsApp');
    } finally {
      setLoading(false);
    }
  };

  // Handle Retry
  const handleRetryJob = async (jobId: string) => {
    try {
      setLoading(true);
      setActionError(null);

      const res = await fetch(`/api/whatsapp/queue/${jobId}/retry`, {
        method: 'POST',
        headers: getAuthHeaders(currentBusiness?.id),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.result?.success === false) throw new Error(data.error || data.result?.error || 'Retry failed');

      setActionSuccess(data.result?.message || 'Retry request processed. Check the message status below.');
      fetchStatusAndHistory();
    } catch (err: any) {
      setActionError(err.message || 'Retry failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-emerald-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/50 rounded-lg">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold">Share Invoice on WhatsApp</h3>
                <WhatsAppStatusBadge status={currentQueueStatus} />
              </div>
              <p className="text-xs text-emerald-100 font-medium">
                Invoice #{invoice.invoiceNumber} • ₹
                {parseFloat(String(invoice.grandTotal)).toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-emerald-700 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {actionError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{actionError}</span>
              </div>
              {isValidPhone && (
                <a
                  href={waMeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 underline font-semibold text-rose-800 hover:text-rose-950 flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open text-only chat</span>
                </a>
              )}
            </div>
          )}

          {actionSuccess && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
          )}

          {/* Customer & Phone info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Customer Name
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                placeholder="Recipient Customer Name"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span>WhatsApp Mobile Number *</span>
                {isValidIndianNumber && (
                  <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Valid India Number
                  </span>
                )}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Phone className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border font-mono ${
                    isValidPhone
                      ? 'border-slate-300 focus:ring-emerald-500'
                      : 'border-amber-300 focus:ring-amber-500'
                  } focus:ring-2 focus:outline-none`}
                  placeholder="e.g. 9876543210 or +919876543210"
                />
              </div>
              {!isValidPhone && recipientPhone && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Enter 10-digit mobile number without spaces or special characters.
                </p>
              )}
            </div>
          </div>

          {/* Message Content Preview & Editor */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Message Preview
            </label>
            <textarea
              rows={5}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="w-full px-3 py-2.5 text-xs font-sans rounded-lg border border-slate-300 text-slate-800 leading-relaxed focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              placeholder="Enter message text..."
            />
          </div>

          <div className="border border-slate-200 rounded-xl p-3 space-y-3">
            <p className="text-xs font-semibold text-slate-700">Actual invoice image attachment</p>
            {imagePreview && <img src={imagePreview} alt={`Invoice ${invoice.invoiceNumber} image preview`} className="w-full max-h-72 object-contain bg-white" />}
            {imageError && <p className="text-xs text-rose-700">{imageError}</p>}
            {!imageFile && !imageError && <p className="text-xs text-slate-500">Preparing invoice PNG...</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={shareInvoiceImage} disabled={!imageFile} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Share image</button>
              <button type="button" onClick={downloadInvoiceImage} disabled={!imageFile} className="px-4 py-2 bg-slate-100 text-slate-800 border rounded-lg text-sm font-semibold disabled:opacity-50">Download image</button>
            </div>
            <p className="text-xs text-slate-500">Share image opens your device's share sheet where supported. Choose WhatsApp and the intended recipient. On desktop, download and attach the PNG manually. This does not mark the invoice as sent.</p>
          </div>

          {/* Connected Session Status Banner */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  sessionStatus === 'CONNECTED'
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-slate-300'
                }`}
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-800">
                  {sessionStatus === 'CONNECTED'
                    ? `Linked via ${connectedPhone || 'WhatsApp Web'}`
                    : 'WhatsApp Session: Not Connected'}
                </span>
                <p className="text-[11px] text-slate-500">
                  {sessionStatus === 'CONNECTED'
                    ? 'Authenticated socket active. Server send safety settings still apply.'
                    : 'Share or download the actual invoice image above, or manage the session in Settings.'}
                </p>
              </div>
            </div>

            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-xs font-semibold text-slate-600 hover:text-emerald-700 flex items-center gap-1 shrink-0 self-start sm:self-auto"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Manage Session</span>
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {/* Option 1: Direct Send via Connected Session */}
              {sessionStatus === 'CONNECTED' && (
                <button
                  type="button"
                  id="btn-whatsapp-send-session"
                  onClick={handleSendViaSession}
                  disabled={loading || !isValidPhone}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-sm transition disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>Send via Connected WhatsApp</span>
                </button>
              )}

              {/* Option 2: 1-Click WhatsApp Web / Desktop (wa.me) Fallback */}
              <a
                href={isValidPhone ? waMeUrl : '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (!isValidPhone) {
                    e.preventDefault();
                    setActionError('Please enter a valid mobile number first.');
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 ${
                  sessionStatus === 'CONNECTED'
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                } rounded-xl text-sm font-semibold transition ${
                  !isValidPhone ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open WhatsApp chat (text only)</span>
              </a>

              {/* Download PDF button so user can attach in WhatsApp */}
              {onDownloadPdf && (
                <button
                  type="button"
                  onClick={onDownloadPdf}
                  className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold border border-slate-300 flex items-center justify-center gap-1.5 transition"
                  title="Download invoice PDF to attach in WhatsApp chat"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
              )}
            </div>

            <p className="text-[11px] text-slate-400 text-center">
              The chat link opens text only. It cannot attach files. Use Share image on supported devices, or Download image and attach the PNG yourself.
            </p>
          </div>

          {/* Delivery History Section */}
          {history.length > 0 && (
            <div className="border-t border-slate-100 pt-4 space-y-2">
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Recent Message History
              </h4>
              <div className="space-y-1.5">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <WhatsAppStatusBadge status={item.status} />
                      <span className="font-mono text-slate-700">
                        {item.recipientPhone}
                      </span>
                      <span className="text-slate-400 text-[11px]">
                        • {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.errorMessage && (
                        <span className="text-[11px] text-rose-600 max-w-xs truncate" title={item.errorMessage}>
                          {item.errorMessage}
                        </span>
                      )}
                      {item.status === 'FAILED' && !item.metadata?.deliveryUncertain && (
                        <button
                          type="button"
                          onClick={() => handleRetryJob(item.id)}
                          className="px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
