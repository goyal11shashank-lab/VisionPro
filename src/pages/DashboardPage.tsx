import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  ShoppingCart,
  Truck,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Lock,
  AlertTriangle,
  AlertOctagon,
  RefreshCw,
  Building2,
  Users,
  ShieldCheck,
  History,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiRequest } from '../api/client.js';
import { DashboardMetrics } from '../types/index.js';

interface Props {
  onNavigate: (path: string) => void;
}

export const DashboardPage: React.FC<Props> = ({ onNavigate }) => {
  const { currentBusiness, user } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest('/api/dashboard/summary');
      setMetrics(data.metrics);
      setRecentActivity(data.recentActivity || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [currentBusiness?.id]);

  const currencySymbol = currentBusiness?.currency === 'INR' ? '₹' : currentBusiness?.currency || '₹';

  return (
    <div className="space-y-6">
      {/* Top Welcome & Business Overview Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-xl border border-slate-700/60 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                Multi-Tenant Isolation Active
              </span>
              <span className="text-xs text-slate-400">|</span>
              <span className="text-xs text-slate-300">{currentBusiness?.city || 'Headquarters'}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white">
              {currentBusiness?.name || 'Optical ERP'}
            </h2>
            <p className="text-xs text-slate-400 flex items-center gap-3">
              <span>Trade: <strong className="text-slate-200">{currentBusiness?.tradeName || 'Main Store'}</strong></span>
              {currentBusiness?.gstin && (
                <span>GSTIN: <strong className="text-slate-200">{currentBusiness?.gstin}</strong></span>
              )}
              <span>Logged in as: <strong className="text-blue-300">{user?.fullName} ({user?.isSuperAdmin ? 'Super Admin' : user?.roles?.[0]?.name || 'User'})</strong></span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-600 transition-colors flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
            <button
              onClick={() => onNavigate('/admin/business-settings')}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Business Settings</span>
            </button>
          </div>
        </div>
      </div>

      {/* 8 Primary Required Metrics Cards in sleek 4x2 grid */}
      <div className="space-y-4">
        {/* Row 1: Commercial & Financial stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Today's Sales */}
          <div id="card-todays-sales" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Today's Sales</span>
              <div className="p-1.5 rounded-md bg-blue-50 text-blue-600">
                <ShoppingCart className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {currencySymbol} {metrics ? metrics.todaysSales.amount.toFixed(2) : '0.00'}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                  {metrics && metrics.todaysSales.count > 0 ? `${metrics.todaysSales.count} invoices` : 'No transactions'}
                </span>
                <span className="text-[11px] text-slate-400">Zero state</span>
              </div>
            </div>
          </div>

          {/* 2. Today's Purchases */}
          <div id="card-todays-purchases" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Today's Purchases</span>
              <div className="p-1.5 rounded-md bg-purple-50 text-purple-600">
                <Truck className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {currencySymbol} {metrics ? metrics.todaysPurchases.amount.toFixed(2) : '0.00'}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                  {metrics && metrics.todaysPurchases.count > 0 ? `${metrics.todaysPurchases.count} bills` : 'No transactions'}
                </span>
                <span className="text-[11px] text-slate-400">Zero state</span>
              </div>
            </div>
          </div>

          {/* 3. Receivables */}
          <div id="card-receivables" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Receivables</span>
              <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {currencySymbol} {metrics ? metrics.receivables.amount.toFixed(2) : '0.00'}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                  {metrics && metrics.receivables.partyCount > 0 ? `${metrics.receivables.partyCount} customers` : 'System clean'}
                </span>
                <span className="text-[11px] text-slate-400">Zero state</span>
              </div>
            </div>
          </div>

          {/* 4. Payables */}
          <div id="card-payables" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Payables</span>
              <div className="p-1.5 rounded-md bg-amber-50 text-amber-600">
                <ArrowUpRight className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {currencySymbol} {metrics ? metrics.payables.amount.toFixed(2) : '0.00'}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                  {metrics && metrics.payables.partyCount > 0 ? `${metrics.payables.partyCount} suppliers` : 'System clean'}
                </span>
                <span className="text-[11px] text-slate-400">Zero state</span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Inventory stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 5. Total Stock */}
          <div id="card-total-stock" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Total Stock</span>
              <div className="p-1.5 rounded-md bg-cyan-50 text-cyan-600">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {metrics ? Number(metrics.totalStock.quantity).toFixed(2) : '0.00'} <span className="text-sm font-normal text-slate-500">prs</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                  {metrics && metrics.totalStock.skuCount > 0 ? `${metrics.totalStock.skuCount} SKUs` : 'Ready to import'}
                </span>
                <span className="text-[11px] text-slate-400">Valuation: {currencySymbol}0.00</span>
              </div>
            </div>
          </div>

          {/* 6. Reserved Stock */}
          <div id="card-reserved-stock" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Reserved Stock</span>
              <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600">
                <Lock className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {metrics ? Number(metrics.reservedStock.quantity).toFixed(2) : '0.00'} <span className="text-sm font-normal text-slate-500">prs</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                  {metrics && metrics.reservedStock.orderCount > 0 ? `${metrics.reservedStock.orderCount} orders` : 'Active orders: 0'}
                </span>
                <span className="text-[11px] text-slate-400">Zero state</span>
              </div>
            </div>
          </div>

          {/* 7. Low Stock */}
          <div id="card-low-stock" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Low Stock Items</span>
              <div className="p-1.5 rounded-md bg-amber-50 text-amber-600">
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {metrics ? metrics.lowStock.itemsCount : 0}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-amber-50 text-amber-700 border border-amber-200/60">
                  Check thresholds
                </span>
                <span className="text-[11px] text-emerald-600 font-semibold">Healthy</span>
              </div>
            </div>
          </div>

          {/* 8. Negative Stock */}
          <div id="card-negative-stock" className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Negative Stock</span>
              <div className="p-1.5 rounded-md bg-red-50 text-red-600">
                <AlertOctagon className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {metrics ? metrics.negativeStock.itemsCount : 0}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-red-50 text-red-700 border border-red-200/60">
                  Critical Alerts: 0
                </span>
                <span className="text-[11px] text-emerald-600 font-semibold">None</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sleek Foundation Readiness Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center text-center gap-4 shadow-2xs">
        <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-2xl">
          📋
        </div>
        <div className="max-w-lg space-y-1.5">
          <h3 className="text-base font-bold text-slate-900">Foundation Ready</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            The PostgreSQL core and role-based architecture are active for <span className="font-semibold text-slate-700">{currentBusiness?.name || 'Optical ERP'}</span>. Start by configuring your business settings or managing administrative users in the Administration module.
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <button
            onClick={() => onNavigate('/admin/business-settings')}
            className="px-5 py-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            Setup Business
          </button>
          <button
            onClick={() => onNavigate('/admin/users')}
            className="px-5 py-2.5 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-900 font-semibold text-xs transition-colors cursor-pointer"
          >
            Manage Users
          </button>
        </div>
      </div>

      {/* Two Column Section: Live Audit Activity & Architecture Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live Audit Trail for active business */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                <History className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Recent Audit Activities</h3>
                <p className="text-xs text-slate-500">Live events recorded in PostgreSQL audit logs</p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('/admin/audit-logs')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <span>View Full Trail</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2.5">
            {recentActivity.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                No recent activity recorded yet for this business.
              </div>
            ) : (
              recentActivity.map((act) => (
                <div
                  key={act.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <div>
                      <span className="font-semibold text-slate-800">{act.action}</span>
                      <span className="text-slate-400 mx-1.5">•</span>
                      <span className="text-slate-600 font-mono text-[11px]">{act.module} / {act.entityType}</span>
                    </div>
                  </div>
                  <div className="text-right text-slate-400 text-[11px]">
                    <div>{act.userName || 'System'}</div>
                    <div>{new Date(act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right 1 Col: Quick Administration Shortcuts & Stage 1 Architecture Checklist */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Foundation Architecture</span>
            </h3>
            <p className="text-xs text-slate-500">Stage 1 System Milestones</p>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>PostgreSQL & Drizzle ORM Schema Active</span>
            </div>
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Multi-Tenant Business Isolation</span>
            </div>
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Bcrypt Auth & 7 System Roles Seeded</span>
            </div>
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Netlify Functions API & Deployment Ready</span>
            </div>
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Immutable Audit Logs Persistence</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Administrative Modules</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onNavigate('/admin/users')}
                className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-left text-xs text-slate-700 font-medium transition-colors"
              >
                <Users className="w-4 h-4 text-blue-600 mb-1" />
                <span>Users ({user?.isSuperAdmin ? 'Full Control' : 'View'})</span>
              </button>
              <button
                onClick={() => onNavigate('/admin/roles')}
                className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-left text-xs text-slate-700 font-medium transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-purple-600 mb-1" />
                <span>Roles Matrix</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
