import React, { useState, useEffect, useCallback } from 'react';
import {
  Store,
  Building2,
  Package,
  Truck,
  Receipt,
  Search,
  RefreshCw,
  AlertCircle,
  X,
  ExternalLink,
  ChevronRight,
  Filter,
  CheckCircle2,
  Clock,
  Lock,
  Eye,
  Plus,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Scale,
  Calendar,
  IndianRupee,
  RotateCcw,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { MainDealerReturnsTab } from './MainDealerReturnsTab.js';
import { MainDealerPaymentsTab } from './MainDealerPaymentsTab.js';
import { CreateDealerModal } from './CreateDealerModal.js';
import { DealerAdministrationTab } from './DealerAdministrationTab.js';

interface DealerControlCenterPageProps {
  onNavigate?: (path: string) => void;
  initialDealerId?: string;
}

export const DealerControlCenterPage: React.FC<DealerControlCenterPageProps> = ({
  onNavigate,
  initialDealerId,
}) => {
  const { currentBusiness, user } = useAuth();

  // Summary KPIs
  const [summary, setSummary] = useState<{
    totalDealers: number;
    activeDealers: number;
    openDealerOrders: number;
    pendingDispatches: number;
    totalOutstanding: number;
    pendingReturns?: number;
    pendingPaymentsCount?: number;
    pendingPaymentsAmount?: number;
  }>({
    totalDealers: 0,
    activeDealers: 0,
    openDealerOrders: 0,
    pendingDispatches: 0,
    totalOutstanding: 0,
    pendingReturns: 0,
    pendingPaymentsCount: 0,
    pendingPaymentsAmount: 0,
  });

  // Top level view mode: Dealers Directory, Global Returns Queue, or Payment Verification
  const [mainView, setMainView] = useState<'dealers' | 'returns' | 'payments'>('dealers');

  // Dealers List State
  const [dealers, setDealers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [opFilter, setOpFilter] = useState<
    'ALL' | 'OUTSTANDING_ONLY' | 'PENDING_ORDERS' | 'PENDING_DISPATCH' | 'NO_RECENT_ORDERS'
  >('ALL');

  // Selected Dealer Detail View
  const [selectedDealerId, setSelectedDealerId] = useState<string | null>(initialDealerId || null);
  const [dealerDetails, setDealerDetails] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showCreateDealerModal, setShowCreateDealerModal] = useState(false);
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'orders'
    | 'invoices'
    | 'dispatches'
    | 'returns'
    | 'payments'
    | 'outstanding'
    | 'activity'
    | 'stock'
    | 'reconciliation'
    | 'administration'
  >('overview');

  // Tab Data States
  const [tabData, setTabData] = useState<{
    orders?: any[];
    invoices?: any[];
    dispatches?: any[];
    outstanding?: any;
    activity?: any[];
    stock?: any;
    reconciliation?: any;
  }>({});
  const [tabLoading, setTabLoading] = useState(false);

  const isMainWarehouse = currentBusiness?.businessType === 'MAIN' || user?.isSuperAdmin;

  // Fetch summary and dealers
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch Summary
      const sumRes = await apiRequest<{ success: boolean; summary: any }>(
        '/api/main/dealers/summary'
      );
      if (sumRes.success) {
        setSummary(sumRes.summary);
      }

      // 2. Fetch Dealers List
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (opFilter !== 'ALL') params.append('filter', opFilter);

      const listRes = await apiRequest<{ success: boolean; dealers: any[] }>(
        `/api/main/dealers?${params.toString()}`
      );
      if (listRes.success) {
        setDealers(listRes.dealers || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load dealer data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, statusFilter, opFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch single dealer details when selected
  const fetchDealerDetails = useCallback(async (dealerId: string) => {
    try {
      setDetailsLoading(true);
      const res = await apiRequest<{ success: boolean; details: any }>(
        `/api/main/dealers/${dealerId}/relationship`
      );
      if (res.success) {
        setDealerDetails(res.details);
      }
    } catch (err: any) {
      console.error('Failed to load dealer relationship details:', err);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDealerId) {
      fetchDealerDetails(selectedDealerId);
      setTabData({});
    }
  }, [selectedDealerId, fetchDealerDetails]);

  // Fetch sub-tab data dynamically
  const fetchTabData = useCallback(
    async (tab: string, dealerId: string) => {
      try {
        setTabLoading(true);
        if (tab === 'orders') {
          const res = await apiRequest<{ success: boolean; orders: any[] }>(
            `/api/main/dealers/${dealerId}/orders`
          );
          setTabData((prev) => ({ ...prev, orders: res.orders || [] }));
        } else if (tab === 'invoices') {
          const res = await apiRequest<{ success: boolean; invoices: any[] }>(
            `/api/main/dealers/${dealerId}/invoices`
          );
          setTabData((prev) => ({ ...prev, invoices: res.invoices || [] }));
        } else if (tab === 'dispatches') {
          const res = await apiRequest<{ success: boolean; dispatches: any[] }>(
            `/api/main/dealers/${dealerId}/dispatches`
          );
          setTabData((prev) => ({ ...prev, dispatches: res.dispatches || [] }));
        } else if (tab === 'outstanding') {
          const res = await apiRequest<{ success: boolean; [key: string]: any }>(
            `/api/main/dealers/${dealerId}/outstanding`
          );
          setTabData((prev) => ({ ...prev, outstanding: res }));
        } else if (tab === 'activity') {
          const res = await apiRequest<{ success: boolean; activity: any[] }>(
            `/api/main/dealers/${dealerId}/activity`
          );
          setTabData((prev) => ({ ...prev, activity: res.activity || [] }));
        } else if (tab === 'stock') {
          const res = await apiRequest<{ success: boolean; [key: string]: any }>(
            `/api/main/dealers/${dealerId}/stock`
          );
          setTabData((prev) => ({ ...prev, stock: res }));
        } else if (tab === 'reconciliation') {
          const res = await apiRequest<{ success: boolean; reconciliation: any }>(
            `/api/main/dealers/${dealerId}/reconciliation`
          );
          setTabData((prev) => ({ ...prev, reconciliation: res.reconciliation }));
        }
      } catch (err: any) {
        console.error(`Failed to load tab ${tab}:`, err);
      } finally {
        setTabLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedDealerId && activeTab !== 'overview') {
      fetchTabData(activeTab, selectedDealerId);
    }
  }, [selectedDealerId, activeTab, fetchTabData]);

  if (!isMainWarehouse) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-800">Dealer Control Center Restricted</h2>
          <p className="text-slate-600 mt-2">
            The Dealer Control Center is exclusive to Main Warehouse operations. You are currently in{' '}
            <span className="font-semibold text-slate-900">{currentBusiness?.name}</span> (
            {currentBusiness?.businessType}).
          </p>
          {onNavigate && (
            <button
              onClick={() => onNavigate('/dashboard')}
              className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800"
            >
              Return to Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dealer Control Center</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
              Main Warehouse
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Centralized commercial relationship management, live orders, dispatches, receivables, and inventory oversight.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setRefreshing(true);
              fetchData();
            }}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {isMainWarehouse && (
            <button
              onClick={() => setShowCreateDealerModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 shadow-sm"
            >
              <Building2 className="w-4 h-4 text-blue-400" />
              Create Dealer
            </button>
          )}

          {onNavigate && (
            <button
              onClick={() => onNavigate('/sales/orders/new')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Sales Order for Dealer
            </button>
          )}
        </div>
      </div>

      {/* Top KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Dealers</span>
            <div className="p-1.5 bg-slate-100 rounded-lg text-slate-700">
              <Building2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-slate-900">{summary.totalDealers}</span>
            <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
              {summary.activeDealers} Active
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Authorized dealers</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Open Orders</span>
            <div className="p-1.5 bg-amber-50 rounded-lg text-amber-600">
              <Package className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-amber-600">{summary.openDealerOrders}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Pending fulfillment</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Pending Dispatches</span>
            <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
              <Truck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-blue-600">{summary.pendingDispatches}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">In transit to dealers</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Outstanding</span>
            <div className="p-1.5 bg-rose-50 rounded-lg text-rose-600">
              <Receipt className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-slate-900">
              ₹{Number(summary.totalOutstanding).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Customer receivables</p>
        </div>

        {/* Pending Payments Verification KPI Card */}
        <div
          onClick={() => {
            setSelectedDealerId(null);
            setMainView('payments');
          }}
          className={`p-3.5 rounded-xl border shadow-sm cursor-pointer transition-all ${
            (summary.pendingPaymentsCount || 0) > 0
              ? 'bg-emerald-50/70 border-emerald-200 hover:bg-emerald-100/60'
              : 'bg-white border-slate-200 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Payments In-Queue
            </span>
            <div
              className={`p-1.5 rounded-lg ${
                (summary.pendingPaymentsCount || 0) > 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              <IndianRupee className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={`text-xl font-bold ${
                (summary.pendingPaymentsCount || 0) > 0 ? 'text-emerald-700' : 'text-slate-800'
              }`}
            >
              {summary.pendingPaymentsCount || 0}
            </span>
            {(summary.pendingPaymentsCount || 0) > 0 && (
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-200/80 px-1.5 py-0.5 rounded-full">
                Verify
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {(summary.pendingPaymentsAmount || 0) > 0
              ? `₹${Number(summary.pendingPaymentsAmount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
              : 'Dealer payment advices'}
          </p>
        </div>

        <div
          onClick={() => {
            setSelectedDealerId(null);
            setMainView('returns');
          }}
          className={`p-3.5 rounded-xl border shadow-sm cursor-pointer transition-all ${
            (summary.pendingReturns || 0) > 0
              ? 'bg-amber-50/70 border-amber-200 hover:bg-amber-100/60'
              : 'bg-white border-slate-200 hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Pending Returns
            </span>
            <div
              className={`p-1.5 rounded-lg ${
                (summary.pendingReturns || 0) > 0
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className={`text-xl font-bold ${
                (summary.pendingReturns || 0) > 0 ? 'text-amber-700' : 'text-slate-800'
              }`}
            >
              {summary.pendingReturns || 0}
            </span>
            {(summary.pendingReturns || 0) > 0 && (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-200/80 px-1.5 py-0.5 rounded-full">
                Review Needed
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Click to process</p>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Stock Privacy</span>
            <div className="p-1.5 bg-emerald-50 rounded-lg text-emerald-600">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md inline-block">
              Strictly Enforced
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Margins strictly isolated</p>
        </div>
      </div>

      {/* Top View Selector: Dealers Directory vs Dealer Returns Queue vs Payment Verification */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => {
            setMainView('dealers');
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            mainView === 'dealers' && !selectedDealerId
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          Authorized Dealers ({summary.totalDealers})
        </button>

        <button
          onClick={() => {
            setSelectedDealerId(null);
            setMainView('payments');
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            mainView === 'payments' && !selectedDealerId
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <IndianRupee className="w-3.5 h-3.5" />
          Payment Advices Verification
          {(summary.pendingPaymentsCount || 0) > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-500 text-white ml-0.5">
              {summary.pendingPaymentsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setSelectedDealerId(null);
            setMainView('returns');
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            mainView === 'returns' && !selectedDealerId
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Returns Queue
          {(summary.pendingReturns || 0) > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white ml-0.5">
              {summary.pendingReturns}
            </span>
          )}
        </button>
      </div>

      {/* Main Dealer List or Detail View */}
      {mainView === 'payments' && !selectedDealerId ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900">Dealer Payment Advices Verification Queue</h3>
            <p className="text-xs text-slate-500">
              Review dealer-submitted payment advices, verify against bank credits, and generate official customer receipts into Main Warehouse accounts.
            </p>
          </div>
          <MainDealerPaymentsTab onRefreshSummary={fetchData} onNavigate={onNavigate} />
        </div>
      ) : mainView === 'returns' && !selectedDealerId ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900">Dealer Returns Management Queue</h3>
            <p className="text-xs text-slate-500">
              Review and approve incoming dealer return requests, and physically inspect received goods to issue credit notes.
            </p>
          </div>
          <MainDealerReturnsTab onRefreshSummary={fetchData} onNavigate={onNavigate} />
        </div>
      ) : !selectedDealerId ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Controls & Filter Bar */}
          <div className="p-4 border-b border-slate-200 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search dealers by name, code, GSTIN, city, mobile..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Status Selector */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600">Status:</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active Only</option>
                  <option value="INACTIVE">Inactive Only</option>
                </select>
              </div>
            </div>

            {/* Operational Filter Pills */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3" /> Filter:
              </span>
              {[
                { key: 'ALL', label: 'All Dealers' },
                { key: 'OUTSTANDING_ONLY', label: 'Outstanding > ₹0' },
                { key: 'PENDING_ORDERS', label: 'Open Orders' },
                { key: 'PENDING_DISPATCH', label: 'Pending Dispatch' },
                { key: 'NO_RECENT_ORDERS', label: 'No Orders in 30 Days' },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setOpFilter(item.key as any)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    opFilter === item.key
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dealers Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Dealer</th>
                  <th className="px-4 py-3">City / Contact</th>
                  <th className="px-4 py-3 text-center">Orders</th>
                  <th className="px-4 py-3 text-center">In-Transit</th>
                  <th className="px-4 py-3 text-right">Outstanding (₹)</th>
                  <th className="px-4 py-3 text-center">Stock Sharing</th>
                  <th className="px-4 py-3 text-right">Last Order</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                      <div className="flex justify-center items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                        <span>Loading dealers...</span>
                      </div>
                    </td>
                  </tr>
                ) : dealers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                      <Store className="w-12 h-12 mx-auto text-slate-300 mb-2" />
                      <p className="text-base font-medium text-slate-700">No dealers found</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Try adjusting your search query or operational filter.
                      </p>
                    </td>
                  </tr>
                ) : (
                  dealers.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">{d.name}</div>
                        {d.tradeName && <div className="text-xs text-slate-500">{d.tradeName}</div>}
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          Code: {d.code || 'N/A'} {d.gstin ? `| GST: ${d.gstin}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-slate-800 font-medium">{d.city || 'N/A'}</div>
                        <div className="text-xs text-slate-500">{d.phone || d.email || '—'}</div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-semibold text-slate-800">{d.ordersCount}</span>
                          {d.openOrdersCount > 0 && (
                            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded mt-0.5">
                              {d.openOrdersCount} open
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {d.pendingDispatchCount > 0 ? (
                          <span className="px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 rounded-full">
                            {d.pendingDispatchCount} active
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium">
                        {d.outstanding > 0 ? (
                          <span className="text-rose-600 font-semibold">
                            ₹{d.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-slate-400">₹0.00</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {d.stockSharingEnabled ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> Shared
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            <Lock className="w-3 h-3" /> Private
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right text-xs text-slate-500">
                        {d.lastOrderDate ? (
                          <span>{new Date(d.lastOrderDate).toLocaleDateString('en-IN')}</span>
                        ) : (
                          <span className="text-slate-400">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedDealerId(d.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* SINGLE DEALER RELATIONSHIP VIEW */
        <div className="space-y-6">
          {/* Back Navigation Bar */}
          <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedDealerId(null)}
                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ArrowRight className="w-5 h-5 rotate-180" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900">
                    {dealerDetails?.dealer?.name || 'Dealer Details'}
                  </h2>
                  <span
                    className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                      dealerDetails?.dealer?.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {dealerDetails?.dealer?.status || 'ACTIVE'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
                  <span>Code: {dealerDetails?.dealer?.code || 'N/A'}</span>
                  <span>GSTIN: {dealerDetails?.dealer?.gstin || 'Not registered'}</span>
                  <span>
                    City: {dealerDetails?.dealer?.city || '—'}, {dealerDetails?.dealer?.state || '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {dealerDetails?.commercialParty?.id && onNavigate && (
                <button
                  onClick={() => onNavigate(`/parties/${dealerDetails.commercialParty.id}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Customer Party
                </button>
              )}
              {onNavigate && (
                <button
                  onClick={() => onNavigate(`/sales/orders/new`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Sales Order
                </button>
              )}
            </div>
          </div>

          {/* Sticky Commercial Relationship KPI Strip */}
          {dealerDetails?.kpis && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Open Orders
                </span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">
                  {dealerDetails.kpis.openOrders}
                </span>
                <span className="text-[11px] text-slate-400">
                  {dealerDetails.kpis.reservedQty} units reserved
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  In-Transit Qty
                </span>
                <span className="text-xl font-bold text-blue-600 mt-1 block">
                  {dealerDetails.kpis.inTransitQty}
                </span>
                <span className="text-[11px] text-slate-400">Pending intake at dealer</span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Total Outstanding
                </span>
                <span className="text-xl font-bold text-rose-600 mt-1 block">
                  ₹{Number(dealerDetails.kpis.totalOutstanding).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-[11px] text-slate-400">Customer ledger balance</span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Overdue Amount
                </span>
                <span
                  className={`text-xl font-bold mt-1 block ${
                    dealerDetails.kpis.overdueAmount > 0 ? 'text-amber-600' : 'text-slate-400'
                  }`}
                >
                  ₹{Number(dealerDetails.kpis.overdueAmount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-[11px] text-slate-400">
                  {dealerDetails.kpis.oldestDueDate
                    ? `Due: ${new Date(dealerDetails.kpis.oldestDueDate).toLocaleDateString('en-IN')}`
                    : 'No overdue'}
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Credit Limit
                </span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">
                  {dealerDetails.kpis.creditLimit > 0
                    ? `₹${Number(dealerDetails.kpis.creditLimit).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                    : 'Unlimited'}
                </span>
                <span className="text-[11px] text-slate-400">
                  {dealerDetails.kpis.creditDays ? `${dealerDetails.kpis.creditDays} days terms` : 'No days set'}
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Stock Sharing
                </span>
                <span className="mt-1 block">
                  {dealerDetails.dealer?.stockSharingEnabled ? (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Enabled
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Private (Off)
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-slate-400 block mt-1">
                  Last order:{' '}
                  {dealerDetails.kpis.lastOrderDate
                    ? new Date(dealerDetails.kpis.lastOrderDate).toLocaleDateString('en-IN')
                    : 'Never'}
                </span>
              </div>
            </div>
          )}

          {/* Relationship Sub-Tabs */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50/50 px-4">
              <nav className="flex space-x-6 overflow-x-auto" aria-label="Tabs">
                {[
                  { id: 'overview', label: 'Overview' },
                  { id: 'orders', label: 'Orders' },
                  { id: 'invoices', label: 'Invoices' },
                  { id: 'dispatches', label: 'Dispatches' },
                  { id: 'payments', label: 'Payment Advices' },
                  { id: 'outstanding', label: 'Outstanding & Ledger' },
                  { id: 'activity', label: 'Timeline' },
                  { id: 'stock', label: 'Dealer Stock' },
                  { id: 'reconciliation', label: 'Reconciliation' },
                  { id: 'administration', label: 'Administration' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`py-3.5 px-1 border-b-2 font-medium text-xs whitespace-nowrap transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-600 font-semibold'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="p-6">
              {detailsLoading ? (
                <div className="py-12 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
                  <span>Loading relationship data...</span>
                </div>
              ) : (
                <>
                  {/* 1. OVERVIEW TAB */}
                  {activeTab === 'overview' && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Commercial Profile */}
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-blue-600" />
                            Commercial Entity Profile
                          </h3>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <div>
                              <dt className="text-slate-500">Legal Name</dt>
                              <dd className="font-medium text-slate-800">{dealerDetails?.dealer?.name}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Trade Name</dt>
                              <dd className="font-medium text-slate-800">{dealerDetails?.dealer?.tradeName || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">GSTIN</dt>
                              <dd className="font-mono text-slate-800">{dealerDetails?.dealer?.gstin || 'None'}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Party Code</dt>
                              <dd className="font-mono text-slate-800">
                                {dealerDetails?.commercialParty?.party_code || 'Auto-mapped'}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Phone</dt>
                              <dd className="text-slate-800">{dealerDetails?.dealer?.phone || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Email</dt>
                              <dd className="text-slate-800">{dealerDetails?.dealer?.email || '—'}</dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-slate-500">Address</dt>
                              <dd className="text-slate-800">
                                {[
                                  dealerDetails?.dealer?.addressLine1,
                                  dealerDetails?.dealer?.addressLine2,
                                  dealerDetails?.dealer?.city,
                                  dealerDetails?.dealer?.state,
                                  dealerDetails?.dealer?.pincode,
                                ]
                                  .filter(Boolean)
                                  .join(', ') || '—'}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        {/* Recent Activity Summary */}
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                            <Truck className="w-4 h-4 text-blue-600" />
                            Pending Dispatches to Dealer
                          </h3>
                          {dealerDetails?.pendingDispatches && dealerDetails.pendingDispatches.length > 0 ? (
                            <div className="space-y-2">
                              {dealerDetails.pendingDispatches.map((ds: any) => (
                                <div
                                  key={ds.id}
                                  className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex items-center justify-between"
                                >
                                  <div>
                                    <div className="font-semibold text-slate-800">
                                      Shipment #{ds.shipment_number}
                                    </div>
                                    <div className="text-slate-500 text-[11px]">
                                      {ds.total_quantity} units via {ds.courier_name || 'Direct Vehicle'}
                                    </div>
                                  </div>
                                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-50 text-blue-700">
                                    {ds.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 py-4 text-center">
                              No active dispatches in transit for this dealer.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Recent Orders in Main */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-slate-800">Recent Dealer Orders</h3>
                          <button
                            onClick={() => setActiveTab('orders')}
                            className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1"
                          >
                            View all orders <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                        {dealerDetails?.recentOrders && dealerDetails.recentOrders.length > 0 ? (
                          <div className="border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                <tr>
                                  <th className="px-3 py-2">Order #</th>
                                  <th className="px-3 py-2">Date</th>
                                  <th className="px-3 py-2 text-center">Units</th>
                                  <th className="px-3 py-2 text-right">Value (₹)</th>
                                  <th className="px-3 py-2 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {dealerDetails.recentOrders.map((o: any) => (
                                  <tr key={o.id} className="hover:bg-slate-50">
                                    <td className="px-3 py-2 font-mono font-medium text-blue-600">
                                      {o.order_number}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500">
                                      {new Date(o.created_at).toLocaleDateString('en-IN')}
                                    </td>
                                    <td className="px-3 py-2 text-center font-medium text-slate-800">
                                      {o.total_quantity}
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                      ₹{Number(o.grand_total).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-700">
                                        {o.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center text-xs text-slate-400">
                            No orders recorded yet for this dealer.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 2. ORDERS TAB */}
                  {activeTab === 'orders' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-800">
                          Dealer Orders Placed with Main Warehouse
                        </h3>
                        {onNavigate && (
                          <button
                            onClick={() => onNavigate('/sales/orders/new')}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
                          >
                            New Order
                          </button>
                        )}
                      </div>

                      {tabLoading ? (
                        <div className="py-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-1" />
                          <span>Loading orders...</span>
                        </div>
                      ) : tabData.orders && tabData.orders.length > 0 ? (
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                              <tr>
                                <th className="px-4 py-3">Dealer Order #</th>
                                <th className="px-4 py-3">Order Date</th>
                                <th className="px-4 py-3">Main Sales Order</th>
                                <th className="px-4 py-3 text-center">Items</th>
                                <th className="px-4 py-3 text-center">Total Qty</th>
                                <th className="px-4 py-3 text-right">Grand Total (₹)</th>
                                <th className="px-4 py-3 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {tabData.orders.map((o: any) => (
                                <tr key={o.id} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-mono font-medium text-blue-600">
                                    {o.order_number}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500">
                                    {new Date(o.created_at).toLocaleDateString('en-IN')}
                                  </td>
                                  <td className="px-4 py-3 text-slate-700">
                                    {o.sales_order_number ? (
                                      <span className="font-mono">{o.sales_order_number}</span>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center text-slate-600">{o.item_count}</td>
                                  <td className="px-4 py-3 text-center font-medium text-slate-900">
                                    {o.total_quantity}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                    ₹{Number(o.grand_total).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-50 text-blue-700">
                                      {o.dealer_order_status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-400 text-xs">
                          No orders found for this dealer.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. INVOICES TAB */}
                  {activeTab === 'invoices' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-800">
                          Main Sales Invoices (Billing & Dispatch Tracking)
                        </h3>
                      </div>

                      {tabLoading ? (
                        <div className="py-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-1" />
                          <span>Loading invoices...</span>
                        </div>
                      ) : tabData.invoices && tabData.invoices.length > 0 ? (
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                              <tr>
                                <th className="px-4 py-3">Invoice #</th>
                                <th className="px-4 py-3">Invoice Date</th>
                                <th className="px-4 py-3">Due Date</th>
                                <th className="px-4 py-3 text-right">Invoice Amount (₹)</th>
                                <th className="px-4 py-3 text-right">Balance Due (₹)</th>
                                <th className="px-4 py-3 text-center">Dispatch Status</th>
                                <th className="px-4 py-3 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {tabData.invoices.map((inv: any) => (
                                <tr key={inv.id} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-mono font-medium text-slate-900">
                                    {inv.invoice_number}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500">
                                    {new Date(inv.invoice_date).toLocaleDateString('en-IN')}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500">
                                    {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-IN') : 'Immediate'}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                    ₹{Number(inv.grand_total).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold text-rose-600">
                                    ₹{Number(inv.balance).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {inv.dispatch_count > 0 ? (
                                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700">
                                        Dispatched
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-50 text-amber-700">
                                        Pending Dispatch
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-700">
                                      {inv.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-400 text-xs">
                          No invoices generated for this dealer yet.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4. DISPATCHES TAB */}
                  {activeTab === 'dispatches' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-800">
                          Consignments & Dispatches to Dealer
                        </h3>
                      </div>

                      {tabLoading ? (
                        <div className="py-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-1" />
                          <span>Loading dispatches...</span>
                        </div>
                      ) : tabData.dispatches && tabData.dispatches.length > 0 ? (
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                              <tr>
                                <th className="px-4 py-3">Shipment #</th>
                                <th className="px-4 py-3">Dispatch Date</th>
                                <th className="px-4 py-3">Invoice #</th>
                                <th className="px-4 py-3">Transporter / Tracking</th>
                                <th className="px-4 py-3 text-center">Dispatched Qty</th>
                                <th className="px-4 py-3 text-center">Receipt Intake</th>
                                <th className="px-4 py-3 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {tabData.dispatches.map((ds: any) => (
                                <tr key={ds.id} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-mono font-medium text-blue-600">
                                    {ds.shipment_number}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500">
                                    {new Date(ds.dispatch_date).toLocaleDateString('en-IN')}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-slate-700">
                                    {ds.invoice_number || '—'}
                                  </td>
                                  <td className="px-4 py-3 text-slate-700">
                                    <div>{ds.courier_name || 'Vehicle'}</div>
                                    {ds.tracking_number && (
                                      <div className="text-[11px] font-mono text-slate-400">
                                        AWB: {ds.tracking_number}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-center font-semibold text-slate-900">
                                    {ds.total_quantity}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="text-[11px]">
                                      <span className="text-emerald-600 font-semibold">
                                        {ds.received_quantity} received
                                      </span>
                                      {ds.pending_receipt_quantity > 0 && (
                                        <span className="text-amber-600 ml-1">
                                          ({ds.pending_receipt_quantity} pending)
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                                        ds.status === 'DELIVERED'
                                          ? 'bg-emerald-50 text-emerald-700'
                                          : 'bg-blue-50 text-blue-700'
                                      }`}
                                    >
                                      {ds.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-400 text-xs">
                          No shipments logged for this dealer.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4B. PAYMENT ADVICES TAB */}
                  {activeTab === 'payments' && (
                    <div className="space-y-4">
                      <MainDealerPaymentsTab dealerId={selectedDealerId || undefined} onRefreshSummary={fetchData} />
                    </div>
                  )}

                  {/* 5. OUTSTANDING & LEDGER TAB */}
                  {activeTab === 'outstanding' && (
                    <div className="space-y-6">
                      {/* Aging Analysis Cards */}
                      {tabData.outstanding?.aging && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                            Accounts Receivable Aging Analysis
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <span className="text-[11px] text-slate-500">Current (Not Overdue)</span>
                              <div className="text-base font-bold text-slate-800 mt-1">
                                ₹{Number(tabData.outstanding.aging.current).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <span className="text-[11px] text-slate-500">1 – 30 Days</span>
                              <div className="text-base font-bold text-amber-600 mt-1">
                                ₹{Number(tabData.outstanding.aging.days1to30).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <span className="text-[11px] text-slate-500">31 – 60 Days</span>
                              <div className="text-base font-bold text-amber-700 mt-1">
                                ₹{Number(tabData.outstanding.aging.days31to60).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <span className="text-[11px] text-slate-500">61 – 90 Days</span>
                              <div className="text-base font-bold text-rose-600 mt-1">
                                ₹{Number(tabData.outstanding.aging.days61to90).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <span className="text-[11px] text-slate-500">90+ Days</span>
                              <div className="text-base font-bold text-rose-700 mt-1">
                                ₹{Number(tabData.outstanding.aging.days90Plus).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Unpaid Invoices */}
                      {tabData.outstanding?.invoices && tabData.outstanding.invoices.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-700 mb-2">Unpaid Invoices Breakdown</h4>
                          <div className="border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                <tr>
                                  <th className="px-3 py-2">Invoice #</th>
                                  <th className="px-3 py-2">Date</th>
                                  <th className="px-3 py-2">Due Date</th>
                                  <th className="px-3 py-2 text-right">Total (₹)</th>
                                  <th className="px-3 py-2 text-right">Balance Due (₹)</th>
                                  <th className="px-3 py-2 text-center">Days Overdue</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {tabData.outstanding.invoices.map((inv: any) => (
                                  <tr key={inv.id} className="hover:bg-slate-50">
                                    <td className="px-3 py-2 font-mono font-medium text-slate-800">
                                      {inv.invoiceNumber}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500">
                                      {new Date(inv.invoiceDate).toLocaleDateString('en-IN')}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500">
                                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-IN') : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right text-slate-700">
                                      ₹{Number(inv.grandTotal).toLocaleString('en-IN')}
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-rose-600">
                                      ₹{Number(inv.balance).toLocaleString('en-IN')}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      {inv.daysOverdue > 0 ? (
                                        <span className="text-rose-600 font-semibold">{inv.daysOverdue} days</span>
                                      ) : (
                                        <span className="text-emerald-600">On time</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Customer Ledger */}
                      <div>
                        <h4 className="text-xs font-semibold text-slate-700 mb-2">Authoritative Customer Ledger</h4>
                        {tabData.outstanding?.ledger && tabData.outstanding.ledger.length > 0 ? (
                          <div className="border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                <tr>
                                  <th className="px-3 py-2">Date</th>
                                  <th className="px-3 py-2">Voucher</th>
                                  <th className="px-3 py-2">Narration</th>
                                  <th className="px-3 py-2 text-right">Debit (₹)</th>
                                  <th className="px-3 py-2 text-right">Credit (₹)</th>
                                  <th className="px-3 py-2 text-right">Balance (₹)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {tabData.outstanding.ledger.map((row: any) => (
                                  <tr key={row.id} className="hover:bg-slate-50">
                                    <td className="px-3 py-2 text-slate-500">
                                      {new Date(row.created_at).toLocaleDateString('en-IN')}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-slate-700">
                                      {row.voucher_type} #{row.voucher_number}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{row.narration || '—'}</td>
                                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                                      {Number(row.debit) > 0 ? `₹${Number(row.debit).toLocaleString('en-IN')}` : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium text-emerald-600">
                                      {Number(row.credit) > 0 ? `₹${Number(row.credit).toLocaleString('en-IN')}` : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-bold text-slate-900">
                                      ₹{Number(row.balance).toLocaleString('en-IN')}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center text-xs text-slate-400">
                            No ledger entries found.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 6. TIMELINE / ACTIVITY TAB */}
                  {activeTab === 'activity' && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-slate-800">
                        Relationship Chronological Timeline
                      </h3>
                      {tabLoading ? (
                        <div className="py-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-1" />
                          <span>Loading timeline...</span>
                        </div>
                      ) : tabData.activity && tabData.activity.length > 0 ? (
                        <div className="relative border-l-2 border-slate-200 ml-4 space-y-6 py-2">
                          {tabData.activity.map((ev: any, idx: number) => (
                            <div key={idx} className="relative pl-6">
                              <div className="absolute -left-2.5 top-1 w-5 h-5 rounded-full bg-white border-2 border-blue-600 flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-blue-600" />
                              </div>
                              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-slate-900">{ev.title}</span>
                                  <span className="text-slate-400 text-[11px]">
                                    {new Date(ev.date).toLocaleString('en-IN')}
                                  </span>
                                </div>
                                <p className="text-slate-600 mt-1">{ev.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-400 text-xs">
                          No timeline events logged for this dealer.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 7. DEALER STOCK TAB (PRIVACY SAFE) */}
                  {activeTab === 'stock' && (
                    <div className="space-y-4">
                      {tabLoading ? (
                        <div className="py-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-1" />
                          <span>Loading shared stock...</span>
                        </div>
                      ) : !tabData.stock?.sharingEnabled ? (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center max-w-lg mx-auto">
                          <div className="w-12 h-12 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center mx-auto mb-3">
                            <Lock className="w-6 h-6" />
                          </div>
                          <h4 className="text-base font-bold text-slate-800">Inventory Sharing Disabled</h4>
                          <p className="text-xs text-slate-500 mt-2">
                            {tabData.stock?.message ||
                              'This dealer has chosen to keep their local inventory private. Dealers can optionally enable inventory sharing from their dashboard settings.'}
                          </p>
                          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800 text-left">
                            <span className="font-semibold">Privacy Guarantee:</span> Even when enabled, Main
                            Warehouse is strictly restricted to available quantities only. Dealer purchase cost,
                            selling rate, margins, and customer data are never exposed.
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-xs text-emerald-800">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="w-5 h-5 text-emerald-600" />
                              <span>
                                Showing live shared inventory from{' '}
                                <strong className="font-semibold">{tabData.stock?.dealerName}</strong>. Purchase
                                cost, rates, and margins remain strictly private.
                              </span>
                            </div>
                            <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 rounded font-semibold text-[10px]">
                              Read-Only Quantities
                            </span>
                          </div>

                          {tabData.stock?.items && tabData.stock.items.length > 0 ? (
                            <div className="border border-slate-200 rounded-xl overflow-hidden">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                                  <tr>
                                    <th className="px-4 py-3">Item / Category</th>
                                    <th className="px-4 py-3">Batch Code</th>
                                    <th className="px-4 py-3 text-center">SPH</th>
                                    <th className="px-4 py-3 text-center">CYL</th>
                                    <th className="px-4 py-3 text-center">AXIS</th>
                                    <th className="px-4 py-3 text-center">ADD</th>
                                    <th className="px-4 py-3 text-right">Available Qty</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {tabData.stock.items.map((item: any, i: number) => (
                                    <tr key={i} className="hover:bg-slate-50">
                                      <td className="px-4 py-3 font-medium text-slate-900">
                                        <div>{item.primary_item_name}</div>
                                        <div className="text-[11px] text-slate-400">{item.category_name}</div>
                                      </td>
                                      <td className="px-4 py-3 font-mono text-slate-700">
                                        {item.batch_number}
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono">{item.sph || '—'}</td>
                                      <td className="px-4 py-3 text-center font-mono">{item.cyl || '—'}</td>
                                      <td className="px-4 py-3 text-center font-mono">{item.axis || '—'}</td>
                                      <td className="px-4 py-3 text-center font-mono">{item.add || '—'}</td>
                                      <td className="px-4 py-3 text-right font-bold text-emerald-600">
                                        {item.available_stock}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-400 text-xs">
                              Dealer currently has 0 available inventory units in stock.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 8. RECONCILIATION TAB (SUPER ADMIN & MAIN ADMIN) */}
                  {activeTab === 'reconciliation' && (
                    <div className="space-y-6">
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-start justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                            <Scale className="w-4 h-4 text-blue-600" />
                            Multi-Tenant Ledger Reconciliation Engine
                          </h3>
                          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                            Non-destructive ledger verification comparing Main Warehouse Customer Ledger
                            (receivable) against Dealer Supplier Ledger (payable). Legitimate differences are
                            highlighted based on transit timing.
                          </p>
                        </div>

                        <button
                          onClick={() => selectedDealerId && fetchTabData('reconciliation', selectedDealerId)}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Re-check
                        </button>
                      </div>

                      {tabLoading ? (
                        <div className="py-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-1" />
                          <span>Reconciling ledgers...</span>
                        </div>
                      ) : tabData.reconciliation ? (
                        <div className="space-y-6">
                          {/* Match Result Banner */}
                          <div
                            className={`p-4 rounded-xl border flex items-center justify-between ${
                              tabData.reconciliation.status === 'MATCHED'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-amber-50 border-amber-200 text-amber-900'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {tabData.reconciliation.status === 'MATCHED' ? (
                                <CheckCircle2 className="w-8 h-8 text-emerald-600 flex-shrink-0" />
                              ) : (
                                <AlertTriangle className="w-8 h-8 text-amber-600 flex-shrink-0" />
                              )}
                              <div>
                                <div className="text-sm font-bold">
                                  {tabData.reconciliation.status === 'MATCHED'
                                    ? 'Ledgers Fully Matched (Reconciled)'
                                    : `Ledger Discrepancy: ₹${Math.abs(tabData.reconciliation.difference).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                                </div>
                                <div className="text-xs opacity-90 mt-0.5">
                                  {tabData.reconciliation.notes?.[0]}
                                </div>
                              </div>
                            </div>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                                tabData.reconciliation.status === 'MATCHED'
                                  ? 'bg-emerald-200 text-emerald-900'
                                  : 'bg-amber-200 text-amber-900'
                              }`}
                            >
                              {tabData.reconciliation.status}
                            </span>
                          </div>

                          {/* Comparison Columns */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                                Main Warehouse (Receivable)
                              </span>
                              <div className="mt-2 text-2xl font-bold text-slate-900">
                                ₹{Number(tabData.reconciliation.mainCustomerBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                Authoritative balance in Main's Customer Ledger for this Dealer.
                              </p>
                              {tabData.reconciliation.lastMainLedgerDate && (
                                <div className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
                                  Last updated:{' '}
                                  {new Date(tabData.reconciliation.lastMainLedgerDate).toLocaleString('en-IN')}
                                </div>
                              )}
                            </div>

                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                                Dealer Business (Payable)
                              </span>
                              <div className="mt-2 text-2xl font-bold text-slate-900">
                                ₹{Number(tabData.reconciliation.dealerSupplierBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                Authoritative balance in Dealer's Supplier Ledger for Main Warehouse.
                              </p>
                              {tabData.reconciliation.lastDealerLedgerDate && (
                                <div className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
                                  Last updated:{' '}
                                  {new Date(tabData.reconciliation.lastDealerLedgerDate).toLocaleString('en-IN')}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Reconciliation Guidance */}
                          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
                            <span className="font-semibold text-slate-800 block">
                              Timing & Reconciliation Factors:
                            </span>
                            <ul className="list-disc pl-5 space-y-1">
                              <li>
                                In-transit consignments dispatched by Main that haven't been accepted via Goods
                                Receipt Note at the Dealer are not yet in Dealer's supplier ledger.
                              </li>
                              <li>
                                Customer receipt payments recorded in Main or payments made in Dealer awaiting bank
                                realization.
                              </li>
                              <li>
                                Neither ledger is altered automatically; authoritative independent tenant integrity
                                is strictly preserved.
                              </li>
                            </ul>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* 9. RETURNS TAB */}
                  {activeTab === 'returns' && (
                    <MainDealerReturnsTab
                      dealerId={selectedDealerId}
                      onRefreshSummary={fetchData}
                      onNavigate={onNavigate}
                    />
                  )}

                  {/* 10. ADMINISTRATION TAB */}
                  {activeTab === 'administration' && (
                    <DealerAdministrationTab
                      dealerId={selectedDealerId}
                      onRefreshDealer={() => fetchDealerDetails(selectedDealerId)}
                      onNavigate={onNavigate}
                      onDealerDeleted={() => {
                        setSelectedDealerId(null);
                        fetchData();
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE DEALER ONBOARDING MODAL */}
      <CreateDealerModal
        isOpen={showCreateDealerModal}
        onClose={() => setShowCreateDealerModal(false)}
        onSuccess={(newDealer) => {
          fetchData();
          if (newDealer?.id) {
            setSelectedDealerId(newDealer.id);
            setActiveTab('administration');
          }
        }}
      />
    </div>
  );
};
