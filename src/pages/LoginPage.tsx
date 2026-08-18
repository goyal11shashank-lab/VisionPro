import React, { useState } from 'react';
import { Eye, EyeOff, Lock, User, KeyRound, AlertCircle, HelpCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiRequest } from '../api/client.js';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState<string>('admin');
  const [password, setPassword] = useState<string>('admin123');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Forgot password modal state
  const [isForgotModalOpen, setIsForgotModalOpen] = useState<boolean>(false);
  const [forgotIdentifier, setForgotIdentifier] = useState<string>('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [isForgotSubmitting, setIsForgotSubmitting] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) {
      setError('Please provide username/email/mobile and password.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await login(identifier, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = (userType: 'admin' | 'manager' | 'sales' | 'accounts') => {
    if (userType === 'admin') {
      setIdentifier('admin');
      setPassword('admin123');
    } else if (userType === 'manager') {
      setIdentifier('manager');
      setPassword('manager123');
    } else if (userType === 'sales') {
      setIdentifier('sales');
      setPassword('sales123');
    } else if (userType === 'accounts') {
      setIdentifier('accounts');
      setPassword('accounts123');
    }
    setError(null);
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
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-xl shadow-blue-600/30 mb-1">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Optical Billing & ERP
          </h1>
          <p className="text-sm text-slate-400">
            Multi-Business Inventory & Accounting Management
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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

          {/* Seeded Roles Quick Selector */}
          <div className="pt-4 border-t border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Seeded Production Roles:</span>
              <span className="text-[10px] text-blue-400">Click to autofill</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                id="quick-login-admin"
                type="button"
                onClick={() => handleQuickFill('admin')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-left text-xs transition-colors text-slate-200"
              >
                <div className="font-semibold text-blue-400">Super Admin</div>
                <div className="text-[10px] text-slate-400">admin / admin123</div>
              </button>

              <button
                id="quick-login-manager"
                type="button"
                onClick={() => handleQuickFill('manager')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-left text-xs transition-colors text-slate-200"
              >
                <div className="font-semibold text-emerald-400">Branch Manager</div>
                <div className="text-[10px] text-slate-400">manager / manager123</div>
              </button>

              <button
                id="quick-login-sales"
                type="button"
                onClick={() => handleQuickFill('sales')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-left text-xs transition-colors text-slate-200"
              >
                <div className="font-semibold text-purple-400">Sales Executive</div>
                <div className="text-[10px] text-slate-400">sales / sales123</div>
              </button>

              <button
                id="quick-login-accounts"
                type="button"
                onClick={() => handleQuickFill('accounts')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-left text-xs transition-colors text-slate-200"
              >
                <div className="font-semibold text-amber-400">Accounts Officer</div>
                <div className="text-[10px] text-slate-400">accounts / accounts123</div>
              </button>
            </div>
          </div>
        </div>

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
