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
  Barcode,
  Clock,
  Layers,
  FileSpreadsheet,
  Receipt,
  CreditCard,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { apiRequest } from '../api/client.js';

interface Props {
  onNavigate: (path: string) => void;
}

export const DashboardPage: React.FC<Props> = ({ onNavigate }) => {
  const { currentBusiness, user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest('/api/dashboard/summary');
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [currentBusiness?.id]);

  const currencySymbol = currentBusiness?.currency === 'INR' ? '₹' : currentBusiness?.currency || '₹';

  const stockKPIs = data?.stockKPIs || {};
  const todaysSales = data?.todaysSales || {};
  const todaysPurchases = data?.todaysPurchases || {};
  const todaysReceipts = data?.todaysReceipts || {};
  const todaysSupplierPayments = data?.todaysSupplierPayments || {};
  const outstandingSummary = data?.outstandingSummary || {};
  const alerts = data?.alerts || {};
  const stockByCategory = data?.stockByCategory || [];
  const topSelling = data?.topSellingProducts || [];
  const recentTransactions = data?.recentTransactions || [];

  return (
    <div className="space-y-6">
      {/* Top Welcome Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-xl border border-slate-700/60 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Live Aggregation Active
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
              <span>Logged in: <strong className="text-blue-300">{user?.fullName}</strong></span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-600 transition-colors flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh KPIs</span>
            </button>
            <button
              onClick={() => onNavigate('/reports/inventory')}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30 transition-all flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Reports Hub</span>
            </button>
          </div>
        </div>
      </div>

      {/* Operational Alerts Bar */}
      {(alerts.lowStockCount > 0 || alerts.negativeStockCount > 0 || alerts.overdueCustomerCount > 0 || alerts.overdueSupplierCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {alerts.lowStockCount > 0 && (
            <div
              onClick={() => onNavigate('/reports/inventory')}
              className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between cursor-pointer hover:bg-amber-100/80 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold">{alerts.lowStockCount} Batches</span> Low Stock
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-amber-600" />
            </div>
          )}

          {alerts.negativeStockCount > 0 && (
            <div
              onClick={() => onNavigate('/reports/inventory')}
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between cursor-pointer hover:bg-rose-100/80 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold">{alerts.negativeStockCount} Batches</span> Negative Stock
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-rose-600" />
            </div>
          )}

          {alerts.overdueCustomerCount > 0 && (
            <div
              onClick={() => onNavigate('/accounts/outstanding')}
              className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 flex items-center justify-between cursor-pointer hover:bg-purple-100/80 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-purple-600 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold">{alerts.overdueCustomerCount} Customers</span> Overdue
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-purple-600" />
            </div>
          )}

          {alerts.overdueSupplierCount > 0 && (
            <div
              onClick={() => onNavigate('/accounts/outstanding')}
              className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 flex items-center justify-between cursor-pointer hover:bg-indigo-100/80 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold">{alerts.overdueSupplierCount} Suppliers</span> Overdue
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-indigo-600" />
            </div>
          )}
        </div>
      )}

      {/* Row 1: Key Operational KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Today's Sales */}
        <div
          onClick={() => onNavigate('/sales/invoices')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-blue-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Today's Sales (Net)</span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {currencySymbol}{Number(todaysSales.net || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-semibold text-blue-600">{todaysSales.count || 0} Invoices</span>
              <span>Returns: {currencySymbol}{Number(todaysSales.returnsAmount || 0).toFixed(0)}</span>
            </div>
          </div>
        </div>

        {/* 2. Today's Purchases */}
        <div
          onClick={() => onNavigate('/purchase/invoices')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-purple-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Today's Purchases (Net)</span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {currencySymbol}{Number(todaysPurchases.net || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-semibold text-purple-600">{todaysPurchases.count || 0} Bills</span>
              <span>Returns: {currencySymbol}{Number(todaysPurchases.returnsAmount || 0).toFixed(0)}</span>
            </div>
          </div>
        </div>

        {/* 3. Receivables */}
        <div
          onClick={() => onNavigate('/accounts/outstanding')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-emerald-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Customer Receivables</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {currencySymbol}{Number(outstandingSummary.totalReceivables || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-emerald-700 font-semibold">{outstandingSummary.customerCount || 0} Customers</span>
              <span className="text-rose-600 font-bold">Overdue: {currencySymbol}{Number(outstandingSummary.customerOverdue || 0).toFixed(0)}</span>
            </div>
          </div>
        </div>

        {/* 4. Payables */}
        <div
          onClick={() => onNavigate('/accounts/outstanding')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-amber-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Supplier Payables</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {currencySymbol}{Number(outstandingSummary.totalPayables || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-amber-700 font-semibold">{outstandingSummary.supplierCount || 0} Suppliers</span>
              <span className="text-rose-600 font-bold">Overdue: {currencySymbol}{Number(outstandingSummary.supplierOverdue || 0).toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Physical & Optical Inventory Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Physical Stock */}
        <div
          onClick={() => onNavigate('/reports/inventory')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-cyan-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Physical Stock</span>
            <div className="p-2 rounded-xl bg-cyan-50 text-cyan-600">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {Number(stockKPIs.totalPhysicalStock || 0).toFixed(2)} <span className="text-xs font-normal text-slate-500">prs</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>{stockKPIs.totalBatches || 0} Batches</span>
              <span className="text-emerald-600 font-semibold">{stockKPIs.inStockBatches || 0} In Stock</span>
            </div>
          </div>
        </div>

        {/* Reserved Stock */}
        <div
          onClick={() => onNavigate('/reports/inventory')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-indigo-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Reserved In Orders</span>
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Lock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {Number(stockKPIs.totalReservedStock || 0).toFixed(2)} <span className="text-xs font-normal text-slate-500">prs</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>{stockKPIs.reservedBatches || 0} Batches reserved</span>
              <span className="text-slate-400">Order commitments</span>
            </div>
          </div>
        </div>

        {/* Available to Sell */}
        <div
          onClick={() => onNavigate('/reports/inventory')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-teal-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Available Stock</span>
            <div className="p-2 rounded-xl bg-teal-50 text-teal-600">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {Number(stockKPIs.totalAvailableStock || 0).toFixed(2)} <span className="text-xs font-normal text-slate-500">prs</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span className="text-teal-700 font-semibold">Physical - Reserved</span>
              <span className="text-emerald-600 font-bold">Ready to dispatch</span>
            </div>
          </div>
        </div>

        {/* Low / Negative Alerts */}
        <div
          onClick={() => onNavigate('/reports/inventory')}
          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs hover:border-amber-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Low / Zero Batches</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight">
              {stockKPIs.lowStockBatches || 0} <span className="text-xs font-normal text-slate-500">low</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">{stockKPIs.zeroStockBatches || 0} zero stock</span>
              <span className={stockKPIs.negativeStockBatches > 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-semibold'}>
                {stockKPIs.negativeStockBatches || 0} negative
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Visual Breakdown & Fast Moving Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stock Breakdown by Optical Category */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-slate-900 text-sm">Stock By Optical Category</h3>
            </div>
            <button
              onClick={() => onNavigate('/reports/inventory')}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
            >
              Full Register
            </button>
          </div>

          <div className="space-y-3">
            {stockByCategory.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                No inventory batches registered yet.
              </div>
            ) : (
              stockByCategory.map((cat: any) => (
                <div key={cat.categoryId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">{cat.categoryName}</span>
                    <span className="font-bold text-slate-900">{cat.physicalStock} prs</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(5, (cat.physicalStock / Math.max(1, stockKPIs.totalPhysicalStock)) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{cat.batchCount} Batches</span>
                    <span>Avail: {cat.availableStock} prs</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Selling Unique Items */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <h3 className="font-bold text-slate-900 text-sm">Top Fast-Moving Products (Last 30 Days)</h3>
            </div>
            <button
              onClick={() => onNavigate('/reports/analytics')}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
            >
              Analytics
            </button>
          </div>

          <div className="overflow-x-auto">
            {topSelling.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                No sales invoice transactions finalized yet.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px]">
                    <th className="py-2 px-3">Product Name</th>
                    <th className="py-2 px-3">SKU</th>
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 px-3 text-right">Qty Sold</th>
                    <th className="py-2 px-3 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {topSelling.map((item: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{item.name}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px]">{item.sku}</td>
                      <td className="py-2.5 px-3 text-slate-600">{item.category}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-blue-600">{item.totalQuantity}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-600">
                        {currencySymbol}{Number(item.totalAmount).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Row 4: Recent Live Transactions */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-sm">Recent Commercial Transactions</h3>
          </div>
          <button
            onClick={() => onNavigate('/reports/sales')}
            className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
          >
            View All
          </button>
        </div>

        <div className="overflow-x-auto">
          {recentTransactions.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No recent commercial transactions in current business context.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px]">
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Document #</th>
                  <th className="py-2 px-3">Party Name</th>
                  <th className="py-2 px-3 text-right">Grand Total</th>
                  <th className="py-2 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentTransactions.map((tx: any) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 text-slate-500 font-mono">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                        tx.type.includes('SALES') ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {tx.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{tx.docNumber}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{tx.partyName}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                      {currencySymbol}{Number(tx.grandTotal).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                        {tx.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
