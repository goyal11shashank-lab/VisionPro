import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, User, KeyRound, AlertCircle, CheckCircle2, ShieldCheck, Database, Building2, Mail, Phone, MapPin, Sparkles, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiRequest } from '../api/client.js';

export const LoginPage: React.FC = () => {
  const { login, bootstrapAdmin } = useAuth();

  // Bootstrap check state
  const [isCheckingBootstrap, setIsCheckingBootstrap] = useState<boolean>(true);
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean>(false);
  const [databaseConnected, setDatabaseConnected] = useState<boolean>(true);
  const [dbErrorMessage, setDbErrorMessage] = useState<string | null>(null);
  const [dbTip, setDbTip] = useState<string | null>(null);

  // Standard Login State
  const [identifier, setIdentifier] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // First-Admin Bootstrap State
  const [bootstrapData, setBootstrapData] = useState({
    fullName: '',
    username: '',
    email: '',
    mobile: '',
    password: '',
    businessName: '',
    tradeName: '',
    gstin: '',
    city: '',
    state: '',
  });
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(false);

  // Forgot password modal state
  const [isForgotModalOpen, setIsForgotModalOpen] = useState<boolean>(false);
  const [forgotIdentifier, setForgotIdentifier] = useState<string>('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [isForgotSubmitting, setIsForgotSubmitting] = useState<boolean>(false);

  const checkBootstrapStatus = async () => {
    setIsCheckingBootstrap(true);
    setDbErrorMessage(null);
    setDbTip(null);
    try {
      const data = await apiRequest('/api/auth/bootstrap-status');
      setDatabaseConnected(data.databaseConnected);
      setNeedsBootstrap(data.needsBootstrap);
      if (!data.databaseConnected) {
        setDbErrorMessage(data.error || 'Database connection unavailable. Please check the server configuration.');
        setDbTip(data.tip || null);
      }
    } catch (err: any) {
      setDatabaseConnected(false);
      setDbErrorMessage('Database connection unavailable. Please check the server configuration.');
      setDbTip('Verify NETLIFY_DB_URL or DATABASE_URL in your Netlify site settings.');
    } finally {
      setIsCheckingBootstrap(false);
    }
  };

  useEffect(() => {
    checkBootstrapStatus();
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[LOGIN_UI_SUBMIT] User clicked login submit');
    if (!identifier || !password) {
      setError('Please provide username/email/mobile and password.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      console.log('[LOGIN_API_REQUEST_SENT] Initiating POST /api/auth/login');
      await login(identifier, password);
      console.log('[LOGIN_API_SUCCESS] Login returned successfully, user state updating');
      console.log('[DASHBOARD_REDIRECT_STARTED] Transitioning to authenticated dashboard view');
    } catch (err: any) {
      console.warn('[LOGIN_API_FAILURE] Login failed:', err.message, 'Status:', err.status);
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBootstrapError(null);

    if (!bootstrapData.fullName || !bootstrapData.username || !bootstrapData.email || !bootstrapData.password || !bootstrapData.businessName) {
      setBootstrapError('Please fill in all mandatory setup fields.');
      return;
    }

    if (bootstrapData.password.length < 8) {
      setBootstrapError('Super Administrator password must be at least 8 characters long.');
      return;
    }

    setIsBootstrapping(true);
    try {
      await bootstrapAdmin(bootstrapData);
    } catch (err: any) {
      setBootstrapError(err.message || 'Failed to bootstrap initial Super Administrator.');
    } finally {
      setIsBootstrapping(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotIdentifier) return;
    setIsForgotSubmitting(true);
    setForgotMessage(null);
    try {
      const res = await apiRequest('/api/auth/forgot-password-request', {
        method: 'POST',
        body: JSON.stringify({ identifier: forgotIdentifier }),
      });
      setForgotMessage(res.message || 'Password reset request recorded.');
    } catch (err: any) {
      setForgotMessage(err.message || 'Failed to submit request.');
    } finally {
      setIsForgotSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className={`w-full ${needsBootstrap ? 'max-w-2xl' : 'max-w-md'} space-y-6 transition-all duration-300`}>
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-xl shadow-blue-600/30 mb-1">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Optical Billing & ERP
          </h1>
          <p className="text-sm text-slate-400">
            Multi-Tenant Enterprise PostgreSQL Architecture
          </p>
        </div>

        {/* Database Offline Error State */}
        {!databaseConnected && (
          <div className="p-4 rounded-2xl bg-red-950/80 border border-red-800 text-red-200 text-sm shadow-xl space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5 flex-1">
                <h4 className="font-semibold text-white">Database Connection Notice</h4>
                <p className="text-xs text-red-300 leading-relaxed">
                  {dbErrorMessage || 'Database connection unavailable. Please check the server configuration.'}
                </p>
                {dbTip && (
                  <div className="mt-2 p-2.5 rounded-lg bg-red-900/50 border border-red-800/60 text-[11px] text-red-200 font-mono">
                    💡 Tip: {dbTip}
                  </div>
                )}
              </div>
            </div>
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={checkBootstrapStatus}
                disabled={isCheckingBootstrap}
                className="px-3.5 py-1.5 rounded-lg bg-red-900 hover:bg-red-800 text-xs font-medium text-white transition-colors flex items-center gap-1.5 shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingBootstrap ? 'animate-spin' : ''}`} />
                <span>Retry Connection</span>
              </button>
            </div>
          </div>
        )}

        {/* Initial Super Admin Bootstrap Form */}
        {databaseConnected && needsBootstrap && !isCheckingBootstrap && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Initial Super Admin Bootstrap</h2>
                  <p className="text-xs text-slate-400">Configure your master administrator account and primary optical store.</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Setup Mode
              </span>
            </div>

            {bootstrapError && (
              <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{bootstrapError}</span>
              </div>
            )}

            <form onSubmit={handleBootstrapSubmit} className="space-y-5">
              {/* Section 1: Super Admin Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  1. Super Administrator Account
                </h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Full Name *</label>
                    <input
                      type="text"
                      value={bootstrapData.fullName}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, fullName: e.target.value })}
                      placeholder="e.g. Master Administrator"
                      required
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Admin Username *</label>
                    <input
                      type="text"
                      value={bootstrapData.username}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, username: e.target.value })}
                      placeholder="e.g. superadmin"
                      required
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Email Address *</label>
                    <input
                      type="email"
                      value={bootstrapData.email}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, email: e.target.value })}
                      placeholder="admin@opticalstore.com"
                      required
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Mobile Number (Optional)</label>
                    <input
                      type="text"
                      value={bootstrapData.mobile}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, mobile: e.target.value })}
                      placeholder="+91 9876543210"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Master Password (Min. 8 chars) *</label>
                  <input
                    type="password"
                    value={bootstrapData.password}
                    onChange={(e) => setBootstrapData({ ...bootstrapData, password: e.target.value })}
                    placeholder="Create a strong administrator password"
                    required
                    minLength={8}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Section 2: Primary Business Profile */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  2. Primary Optical Business Entity
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Business / Store Name *</label>
                    <input
                      type="text"
                      value={bootstrapData.businessName}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, businessName: e.target.value })}
                      placeholder="e.g. Vision Eye Care & Opticals"
                      required
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Trade / Legal Name (Optional)</label>
                    <input
                      type="text"
                      value={bootstrapData.tradeName}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, tradeName: e.target.value })}
                      placeholder="e.g. Vision Opticals Pvt Ltd"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">GSTIN (Optional)</label>
                    <input
                      type="text"
                      value={bootstrapData.gstin}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, gstin: e.target.value })}
                      placeholder="27ABCDE1234F1Z5"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">City (Optional)</label>
                    <input
                      type="text"
                      value={bootstrapData.city}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, city: e.target.value })}
                      placeholder="Mumbai"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">State (Optional)</label>
                    <input
                      type="text"
                      value={bootstrapData.state}
                      onChange={(e) => setBootstrapData({ ...bootstrapData, state: e.target.value })}
                      placeholder="Maharashtra"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Bootstrap */}
              <button
                type="submit"
                disabled={isBootstrapping}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 mt-4"
              >
                {isBootstrapping ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Initialize Super Admin & Launch ERP</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Standard Login Card */}
        {databaseConnected && !needsBootstrap && !isCheckingBootstrap && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
            {error && (
              <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* Identifier Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Username / Email / Mobile
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    id="login-identifier-input"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Enter username, email or mobile"
                    required
                    className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotIdentifier(identifier);
                      setForgotMessage(null);
                      setIsForgotModalOpen(true);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="login-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter account password"
                    required
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="login-submit-button"
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 mt-2"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Sign In to System</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Loading Spinner during initial check */}
        {isCheckingBootstrap && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl flex flex-col items-center justify-center gap-3 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            <span className="text-xs">Verifying database connectivity & bootstrap state...</span>
          </div>
        )}

        {/* Security & Multi-tenant Notice */}
        <div className="text-center text-xs text-slate-500 space-y-1">
          <p>Protected by PostgreSQL Row-Level Multi-Business Isolation</p>
          <p className="text-[11px] text-slate-600">All authentication attempts and actions are logged to immutable audit storage.</p>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {isForgotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-base">Account Recovery Architecture</h3>
              <button
                onClick={() => setIsForgotModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              For security reasons, password resets are processed via authenticated system administrators or registered enterprise verification channels.
            </p>

            {forgotMessage ? (
              <div className="p-3 rounded-xl bg-blue-950/60 border border-blue-800 text-blue-300 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
                <span>{forgotMessage}</span>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-3">
                <input
                  type="text"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  placeholder="Enter your username, email or mobile"
                  required
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={isForgotSubmitting}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium"
                >
                  {isForgotSubmitting ? 'Recording Request...' : 'Send Recovery Request'}
                </button>
              </form>
            )}

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setIsForgotModalOpen(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Back to Sign In
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
