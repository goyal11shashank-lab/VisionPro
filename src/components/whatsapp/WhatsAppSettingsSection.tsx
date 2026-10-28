import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  QrCode,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Power,
  Phone,
  Clock,
  Sparkles,
  Info,
  Server,
  ShieldCheck,
  Send,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { getAuthHeaders } from '../../api/client.js';

interface WhatsAppSettingsProps {
  businessId: string;
  businessName?: string;
  tradeName?: string;
}

export const WhatsAppSettingsSection: React.FC<WhatsAppSettingsProps> = ({
  businessId,
  businessName,
  tradeName,
}) => {
  const [session, setSession] = useState<any>(null);
  const [settings, setSettings] = useState<any>({
    autoSendOnSave: false,
    autoSendRequireOptIn: true,
    messageTemplate: `Dear {{customer_name}},\n\nThank you for choosing {{business_name}}! Please find attached your Tax Invoice #{{invoice_number}} for {{invoice_total}} dated {{invoice_date}}.\n\nWarm regards,\n{{business_name}}`,
    includePdf: true,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [qrCountdown, setQrCountdown] = useState<number>(0);

  // Fetch status and settings
  const fetchStatusAndSettings = async (silent = false) => {
    if (!businessId) return;
    try {
      if (!silent) setLoading(true);
      const res = await fetch('/api/whatsapp/status', {
        headers: getAuthHeaders(businessId),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSession(data.session);
        if (data.settings) setSettings(data.settings);

        if (data.session?.qrExpiresAt) {
          const remainingSec = Math.max(
            0,
            Math.floor((new Date(data.session.qrExpiresAt).getTime() - Date.now()) / 1000)
          );
          setQrCountdown(remainingSec);
        } else {
          setQrCountdown(0);
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch WhatsApp settings', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatusAndSettings();
  }, [businessId]);

  // Active polling when connection is pending or in progress
  useEffect(() => {
    if (!session?.status) return;
    const shouldPoll =
      session.status === 'INITIALIZING' ||
      session.status === 'QR_REQUIRED' ||
      session.status === 'CONNECTING' ||
      session.status === 'RECONNECTING';

    if (!shouldPoll) return;

    const pollInterval = setInterval(() => {
      fetchStatusAndSettings(true);
    }, 2500);

    return () => clearInterval(pollInterval);
  }, [session?.status, businessId]);

  // QR expiration countdown timer
  useEffect(() => {
    if (qrCountdown <= 0) return;
    const interval = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [qrCountdown]);

  // Initiate QR session
  const handleInitiateSession = async () => {
    try {
      setActionLoading(true);
      setFeedback(null);
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: getAuthHeaders(businessId),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to start linking session');

      setFeedback({ type: 'success', message: 'QR Code challenge generated. Point your WhatsApp camera at the QR code below.' });
      setSession((prev: any) => ({
        ...prev,
        status: data.status || 'QR_REQUIRED',
        qrCodeData: data.qrCodeData,
        qrExpiresAt: data.qrExpiresAt,
      }));
      setQrCountdown(data.expiresInSeconds || 90);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error generating QR code' });
    } finally {
      setActionLoading(false);
    }
  };

  // Disconnect session
  const handleDisconnect = async () => {
    try {
      setActionLoading(true);
      setFeedback(null);
      const res = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: getAuthHeaders(businessId),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect');

      setFeedback({ type: 'success', message: 'WhatsApp session disconnected and credentials purged.' });
      await fetchStatusAndSettings();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error disconnecting' });
    } finally {
      setActionLoading(false);
    }
  };

  // Refresh status button
  const handleManualRefresh = async () => {
    try {
      setActionLoading(true);
      await fetchStatusAndSettings(true);
      setFeedback({ type: 'success', message: 'WhatsApp connection status refreshed.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: 'Failed to refresh status' });
    } finally {
      setActionLoading(false);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    try {
      setActionLoading(true);
      setFeedback(null);
      const res = await fetch('/api/whatsapp/test-connection', {
        method: 'POST',
        headers: getAuthHeaders(businessId),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          message: `${data.message} (${data.latencyMs}ms latency)`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: data.message || data.error || 'Connection test failed',
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to test connection' });
    } finally {
      setActionLoading(false);
    }
  };

  // Save settings
  const handleSaveSettings = async () => {
    try {
      setActionLoading(true);
      setFeedback(null);
      const res = await fetch('/api/whatsapp/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(businessId),
        },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');

      setFeedback({ type: 'success', message: 'WhatsApp integration settings saved successfully.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save settings' });
    } finally {
      setActionLoading(false);
    }
  };

  // Status mapping
  const rawStatus = session?.status || 'DISCONNECTED';
  const isConnected = rawStatus === 'CONNECTED';
  const isInitializing = rawStatus === 'INITIALIZING';
  const isQrRequired = (rawStatus === 'QR_REQUIRED' || rawStatus === 'CONNECTING') && !!session?.qrCodeData && qrCountdown > 0;
  const isReconnecting = rawStatus === 'RECONNECTING';
  const isError = rawStatus === 'ERROR';

  const renderStatusBadge = () => {
    if (isConnected) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Connected
        </span>
      );
    }
    if (isInitializing) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
          Initializing...
        </span>
      );
    }
    if (isQrRequired) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
          <QrCode className="w-3.5 h-3.5 text-amber-600" />
          QR Required (Scan on Phone)
        </span>
      );
    }
    if (isReconnecting) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
          Reconnecting...
        </span>
      );
    }
    if (isError) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
          Connection Error
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
        <Power className="w-3 h-3 text-slate-400" />
        Disconnected
      </span>
    );
  };

  // Preview template
  const sampleBizName = tradeName || businessName || 'Optical Store';
  const previewText = (settings.messageTemplate || '')
    .replace(/{{customer_name}}/g, 'Rajesh Kumar')
    .replace(/{{business_name}}/g, sampleBizName)
    .replace(/{{invoice_number}}/g, 'INV-00042')
    .replace(/{{invoice_total}}/g, '₹2,450.00')
    .replace(/{{invoice_date}}/g, new Date().toLocaleDateString('en-IN'));

  return (
    <div className="space-y-6">
      {/* Feedback banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-sm transition ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs font-semibold opacity-70 hover:opacity-100 underline ml-auto cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main WhatsApp Web Login Section */}
      <div id="section-whatsapp-web-login" className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">WhatsApp Web Login</h3>
              <p className="text-xs text-slate-500">
                Connect your business WhatsApp account using WhatsApp Multi-Device QR login (No official Cloud API credentials or fees required).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {renderStatusBadge()}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={actionLoading}
              title="Refresh connection status"
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${actionLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Content based on session status */}
        <div className="pt-6">
          {isConnected ? (
            /* Connected state */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-emerald-950">
                      {session?.connectedPushname || 'Connected WhatsApp Account'}
                    </h4>
                    <p className="text-xs font-mono font-medium text-emerald-800">
                      {session?.connectedPhone || 'Linked Phone Account'}
                    </p>
                    {session?.lastConnectedAt && (
                      <p className="text-[11px] text-emerald-600 mt-0.5">
                        Connected since: {new Date(session.lastConnectedAt).toLocaleString('en-IN')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    id="btn-test-whatsapp-connection"
                    type="button"
                    onClick={handleTestConnection}
                    disabled={actionLoading}
                    className="px-3.5 py-2 bg-white hover:bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg border border-emerald-300 transition shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    Test Connection
                  </button>
                  <button
                    id="btn-disconnect-whatsapp"
                    type="button"
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="px-3.5 py-2 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    Disconnect WhatsApp
                  </button>
                </div>
              </div>
            </div>
          ) : isQrRequired && session?.qrCodeData ? (
            /* QR Code Connecting State */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-xl border border-slate-200">
                <div className="bg-white p-3 rounded-xl shadow-md border border-slate-200">
                  <img
                    src={session.qrCodeData}
                    alt="WhatsApp QR Code Challenge"
                    className="w-60 h-60 object-contain"
                  />
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>
                    QR challenge expires in: <strong className="text-slate-900 font-mono">{qrCountdown}s</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleInitiateSession}
                  disabled={actionLoading}
                  className="mt-3 text-xs text-emerald-700 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh QR Code
                </button>
              </div>

              {/* Instructions */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-emerald-600" />
                  Scan QR code with your mobile phone:
                </h4>
                <ol className="space-y-2.5 text-xs text-slate-600 leading-relaxed list-decimal list-inside">
                  <li>
                    Open <strong>WhatsApp</strong> on your mobile phone (Personal or Business app).
                  </li>
                  <li>
                    Tap <strong>Menu (⋮)</strong> on Android, or <strong>Settings (⚙)</strong> on iPhone.
                  </li>
                  <li>
                    Tap <strong>Linked Devices</strong>, then tap <strong>Link a Device</strong>.
                  </li>
                  <li>
                    Point your camera at this QR code to authenticate.
                  </li>
                </ol>

                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-[11px] text-blue-800 flex items-start gap-2">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0 mt-0.5" />
                  <span>
                    Listening for scan confirmation... This screen will automatically update to <strong>Connected</strong> once your device verifies pairing.
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
                  >
                    Cancel Link
                  </button>
                </div>
              </div>
            </div>
          ) : isInitializing ? (
            /* Initializing State */
            <div className="p-10 text-center space-y-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h4 className="text-sm font-bold text-slate-900">Starting WhatsApp Session...</h4>
                <p className="text-xs text-slate-500">
                  Generating secure Multi-Device pairing challenge and preparing WebSockets connection.
                </p>
              </div>
            </div>
          ) : isReconnecting ? (
            /* Reconnecting State */
            <div className="p-8 text-center space-y-4 bg-amber-50/50 rounded-xl border border-amber-200">
              <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mx-auto">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h4 className="text-sm font-bold text-amber-900">Reconnecting WhatsApp Session...</h4>
                <p className="text-xs text-amber-700">
                  {session?.lastError || 'Temporary network disruption. Backoff reconnection in progress.'}
                </p>
              </div>
              <div className="flex justify-center gap-3">
                <button
                  id="btn-reconnect-whatsapp"
                  type="button"
                  onClick={handleInitiateSession}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Force Reconnect (New QR)
                </button>
                <button
                  id="btn-disconnect-reconnecting-whatsapp"
                  type="button"
                  onClick={handleDisconnect}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-white border border-amber-300 text-amber-800 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Disconnect WhatsApp
                </button>
              </div>
            </div>
          ) : (
            /* Disconnected / Error State */
            <div className="p-8 text-center space-y-4">
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mx-auto border border-emerald-100">
                <QrCode className="w-7 h-7" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h4 className="text-sm font-bold text-slate-900">
                  {isError ? 'WhatsApp Connection Notice' : 'No WhatsApp account currently linked'}
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {session?.lastError
                    ? `Previous note: ${session.lastError}`
                    : 'Link your WhatsApp account to enable persistent session management and automated voucher sharing.'}
                </p>
                {session?.lastDisconnectedAt && (
                  <p className="text-[11px] text-slate-400">
                    Last disconnected: {new Date(session.lastDisconnectedAt).toLocaleString('en-IN')}
                  </p>
                )}
              </div>
              <div className="flex justify-center items-center gap-2">
                <button
                  id="btn-connect-whatsapp"
                  type="button"
                  onClick={handleInitiateSession}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Connect WhatsApp</span>
                </button>
                <button
                  id="btn-refresh-whatsapp-status"
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-xl transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh Status</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Auto-Send & Dispatch Policies */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
        <div>
          <h3 className="text-base font-bold text-slate-900">Automation & Opt-In Rules</h3>
          <p className="text-xs text-slate-500">
            Configure automated dispatch policies after sales vouchers are saved.
          </p>
        </div>

        <div className="space-y-4">
          {/* Auto-Send Toggle */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
            <div>
              <label htmlFor="toggle-auto-send" className="text-xs font-bold text-slate-900 cursor-pointer">
                Auto-Send Invoice after Successful Save
              </label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Automatically enqueues and dispatches the sales invoice PDF via WhatsApp right after it is committed to the database.
              </p>
              {!isConnected && (
                <p className="text-[11px] text-amber-600 font-medium mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Recommended: keep disabled until your WhatsApp device is linked and tested.
                </p>
              )}
            </div>
            <input
              id="toggle-auto-send"
              type="checkbox"
              checked={settings.autoSendOnSave}
              onChange={(e) => setSettings({ ...settings, autoSendOnSave: e.target.checked })}
              className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer mt-0.5"
            />
          </div>

          {/* Opt-In Requirement Toggle */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
            <div>
              <label htmlFor="toggle-opt-in" className="text-xs font-bold text-slate-900 cursor-pointer">
                Require Customer WhatsApp Opt-In
              </label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Respects individual customer preferences. When enabled, invoices will only be dispatched to customers who have not opted out.
              </p>
            </div>
            <input
              id="toggle-opt-in"
              type="checkbox"
              checked={settings.autoSendRequireOptIn}
              onChange={(e) => setSettings({ ...settings, autoSendRequireOptIn: e.target.checked })}
              className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer mt-0.5"
            />
          </div>
        </div>
      </div>

      {/* Message Template Editor */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">Invoice Message Template</h3>
          <p className="text-xs text-slate-500">
            Customize the message text sent to customers alongside their invoice PDF.
          </p>
        </div>

        {/* Template Variables */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-semibold mr-1">Available Tags:</span>
          {['{{customer_name}}', '{{invoice_number}}', '{{invoice_total}}', '{{business_name}}', '{{invoice_date}}'].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSettings({ ...settings, messageTemplate: (settings.messageTemplate || '') + ' ' + tag })}
              className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] rounded border border-slate-200 transition cursor-pointer"
              title={`Click to insert ${tag}`}
            >
              + {tag}
            </button>
          ))}
        </div>

        <textarea
          rows={5}
          value={settings.messageTemplate}
          onChange={(e) => setSettings({ ...settings, messageTemplate: e.target.value })}
          className="w-full px-3 py-2.5 text-xs font-sans rounded-lg border border-slate-300 text-slate-800 leading-relaxed focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          placeholder="Enter message template..."
        />

        {/* Live Preview Box */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
            Live Sample Preview:
          </span>
          <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap font-sans shadow-xs">
            {previewText}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={actionLoading}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition disabled:opacity-50 cursor-pointer"
          >
            Save WhatsApp Settings
          </button>
        </div>
      </div>

      {/* Deployment & Feasibility Architecture Guide */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-3 text-xs text-slate-600 leading-relaxed">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <Server className="w-4 h-4 text-emerald-600" />
          <span>Hostinger Deployment Notice & Background Connection Architecture</span>
        </div>
        <p>
          <strong>Persistent Connection Requirements:</strong> WhatsApp Multi-Device connection relies on a persistent background WebSocket to <code>web.whatsapp.com</code> and stores encryption keys locally.
        </p>
        <ul className="list-disc list-inside space-y-1.5 pl-1 text-[11px]">
          <li>
            <strong>Hostinger Shared/Cloud cPanel Environments:</strong> Shared hosting plans terminate idle background Node processes after timeout periods and lack persistent disk retention across git redeployments. If your hosting kills background processes, active sessions will disconnect.
          </li>
          <li>
            <strong>Dedicated VPS / PM2 Worker (Recommended):</strong> For 24/7 background session persistence without reconnections, run the Node.js server under PM2 on a VPS (e.g. Hostinger VPS, Ubuntu 22.04) or a containerized persistent worker with attached disk.
          </li>
          <li>
            <strong>1-Click WhatsApp Web (Universal Fallback):</strong> In all environments, the invoice register provides a 1-click <code>wa.me</code> fallback link allowing staff to dispatch invoices via browser WhatsApp Web without server background dependencies.
          </li>
        </ul>
      </div>
    </div>
  );
};
