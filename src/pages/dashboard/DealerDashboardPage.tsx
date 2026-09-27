import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Boxes,
  Truck,
  ShoppingCart,
  Receipt,
  Search,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Eye,
  Plus,
  ShieldCheck,
  Building2,
  Phone,
  Mail,
  Lock,
  Unlock,
  ExternalLink,
  ChevronRight,
  AlertCircle,
  FileCheck,
  RotateCcw,
  IndianRupee,
  CreditCard,
  ReceiptText,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { DealerPaymentModal } from '../dealers/DealerPaymentModal.js';
import { DealerPaymentAdvicesList } from '../dealers/DealerPaymentAdvicesList.js';

interface DealerDashboardPageProps {
  onNavigate?: (path: string) => void;
}

export const DealerDashboardPage: React.FC<DealerDashboardPageProps> = ({ onNavigate }) => {
  const { currentBusiness, hasPermission } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payment Modals State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAdvicesModal, setShowAdvicesModal] = useState(false);

  // Dashboard Data State
  const [data, setData] = useState<{
    dealerBusiness?: any;
    mainWarehouse?: any;
    linkedSupplierPartyId?: string | null;
    kpis?: {
      myAvailableStock: number;
      myPhysicalStock: number;
      myReservedStock: number;
      mainWarehouseAvailable: number;
      onOrderQuantity: number;
      incomingQuantity: number;
      outstandingToMain: number;
      overdueAmount: number;
      paymentsAwaitingVerification?: number;
      paymentsAwaitingCount?: number;
    };
    returnStats?: {
      pendingRequests: number;
      approvedAwaitingDispatch: number;
      inTransit: number;
      totalReturnedQty: number;
    };
    recentReturns?: any[];
    needsAttention?: {
      shipmentsAwaitingReceipt: number;
      partiallyReceivedShipments: number;
      openOrdersCount: number;
      overdueAmount: number;
      paymentsAwaitingVerification?: number;
      paymentsAwaitingCount?: number;
      hasUrgentAction: boolean;
    };
    recentOrders?: any[];
    incomingShipments?: any[];
    lowStockItems?: any[];
    stockSharingEnabled?: boolean;
  }>({});

  // Quick Search for Main Stock
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Stock Sharing Setting
  const [sharingStock, setSharingStock] = useState<boolean>(false);
  const [sharingUpdating, setSharingUpdating] = useState(false);
  const [shareSuccessMsg, setShareSuccessMsg] = useState<string | null>(null);

  // Onboarding notifications
  const [justOnboarded, setJustOnboarded] = useState<boolean>(() => {
    return sessionStorage.getItem('dealer_just_onboarded') === 'true';
  });

  // Fetch Dashboard Summary
  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{ success: boolean; [key: string]: any }>(
        '/api/dealer/dashboard/summary'
      );
      if (res.success) {
        setData(res);
        setSharingStock(Boolean(res.stockSharingEnabled));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load dealer dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentBusiness?.id]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary, currentBusiness?.id]);

  // Handle Quick Search of Main Warehouse Stock
  const handleSearchMain = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      setSearchLoading(true);
      const res = await apiRequest<{ success: boolean; results: any[] }>(
        `/api/dealer/dashboard/search?q=${encodeURIComponent(q.trim())}&limit=6`
      );
      if (res.success) {
        setSearchResults(res.results || []);
      }
    } catch (err: any) {
      console.error('Search main stock failed:', err);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Handle Stock Sharing Toggle
  const handleToggleStockSharing = async () => {
    try {
      setSharingUpdating(true);
      setShareSuccessMsg(null);
      const newSetting = !sharingStock;
      const res = await apiRequest<{ success: boolean; shareStockWithMain: boolean; message: string }>(
        '/api/dealer/settings/stock-sharing',
        {
          method: 'POST',
          body: JSON.stringify({ shareStockWithMain: newSetting }),
        }
      );
      if (res.success) {
        setSharingStock(res.shareStockWithMain);
        setShareSuccessMsg(res.message);
        setTimeout(() => setShareSuccessMsg(null), 5000);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update stock sharing setting');
    } finally {
      setSharingUpdating(false);
    }
  };

  if (loading && !refreshing) {
    return (
      <div className="p-12 text-center text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading Dealer Operations Dashboard...</p>
      </div>
    );
  }

  const kpis = data.kpis || {
    myAvailableStock: 0,
    myPhysicalStock: 0,
    myReservedStock: 0,
    mainWarehouseAvailable: 0,
    onOrderQuantity: 0,
    incomingQuantity: 0,
    outstandingToMain: 0,
    overdueAmount: 0,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dealer Operations Dashboard</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              {currentBusiness?.name}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Linked to Main Warehouse:{' '}
            <span className="font-semibold text-slate-800">
              {data.mainWarehouse?.name || 'Primary Hub'}
            </span>{' '}
            {data.mainWarehouse?.city ? `(${data.mainWarehouse.city})` : ''}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setRefreshing(true);
              fetchSummary();
            }}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {onNavigate && (
            <>
              <button
                id="header-payment-advices-btn"
                onClick={() => setShowAdvicesModal(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition-colors"
              >
                <ReceiptText className="w-4 h-4 text-slate-600" />
                Payment Advices
                {(data.kpis?.paymentsAwaitingCount || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                    {data.kpis?.paymentsAwaitingCount}
                  </span>
                )}
              </button>
              <button
                id="header-record-payment-btn"
                onClick={() => setShowPaymentModal(true)}
                className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                Pay Main Warehouse
              </button>
              <button
                id="header-dealer-returns-btn"
                onClick={() => onNavigate('/dealer/returns')}
                className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm transition-colors"
              >
                <RotateCcw className="w-4 h-4 text-slate-600" />
                Returns to Main
                {(data.returnStats?.approvedAwaitingDispatch || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                    {data.returnStats?.approvedAwaitingDispatch}
                  </span>
                )}
              </button>
              <button
                id="header-order-stock-btn"
                onClick={() => onNavigate('/dealer/orders')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Order Stock from Main
              </button>
            </>
          )}
        </div>
      </div>

      {/* Onboarding Welcome Banner (Shown only right after setup completion) */}
      {justOnboarded && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Dealer setup complete!</strong> Your account is connected with {data.mainWarehouse?.name || 'Main Warehouse'}. You can now place stock orders and manage local inventory.
            </span>
          </div>
          <button
            onClick={() => {
              sessionStorage.removeItem('dealer_just_onboarded');
              setJustOnboarded(false);
            }}
            className="text-emerald-700 hover:text-emerald-900 font-semibold underline ml-4 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Onboarding Pending Banner (If not yet completed) */}
      {currentBusiness?.onboardingCompleted !== true && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Account Setup Pending:</strong> Your dealer business has not completed the onboarding confirmation wizard.
            </span>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('/dealer/onboarding')}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg shadow-2xs ml-4 shrink-0"
            >
              Launch Setup Wizard
            </button>
          )}
        </div>
      )}

      {/* First Order CTA for Dealers with Zero Order History */}
      {(!data.recentOrders || data.recentOrders.length === 0) && onNavigate && (
        <div className="p-5 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border border-blue-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-blue-600 text-white rounded-lg">
                <ShoppingCart className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-bold text-slate-900">Place Your First Stock Order</h3>
            </div>
            <p className="text-xs text-slate-600 max-w-xl">
              You have no order history yet. Browse live inventory and optical batch powers available at {data.mainWarehouse?.name || 'Main Warehouse'} and place your first requisition against your credit limit.
            </p>
          </div>
          <button
            onClick={() => onNavigate('/inventory/dealer-availability')}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-sm transition-colors shrink-0"
          >
            <Building2 className="w-4 h-4" />
            Order Stock from Main
          </button>
        </div>
      )}

      {/* Empty State Helper when Zero Local Stock */}
      {kpis.myAvailableStock === 0 && kpis.myPhysicalStock === 0 && onNavigate && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs text-slate-700">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-slate-500 shrink-0" />
            <span>
              <strong>No local stock yet:</strong> Check Main Warehouse availability to order lenses, frames, and batches.
            </span>
          </div>
          <button
            onClick={() => onNavigate('/inventory/dealer-availability')}
            className="text-blue-600 hover:text-blue-800 font-semibold underline ml-4 shrink-0"
          >
            Check Main Stock
          </button>
        </div>
      )}

      {/* 5 PRIMARY KPIS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: MY AVAILABLE STOCK */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              My Available Stock
            </span>
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{kpis.myAvailableStock}</span>
            <span className="text-xs text-slate-400 ml-1">units</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {kpis.myPhysicalStock} on hand | {kpis.myReservedStock} reserved
          </p>
        </div>

        {/* KPI 2: MAIN WAREHOUSE AVAILABLE */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Main Warehouse Available
            </span>
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-indigo-600">{kpis.mainWarehouseAvailable}</span>
            <span className="text-xs text-slate-400 ml-1">units</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Real-time unreserved stock at Main</p>
        </div>

        {/* KPI 3: ON ORDER */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">On Order</span>
            <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-amber-600">{kpis.onOrderQuantity}</span>
            <span className="text-xs text-slate-400 ml-1">units</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Open PO quantities with Main</p>
        </div>

        {/* KPI 4: INCOMING */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Incoming</span>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-blue-600">{kpis.incomingQuantity}</span>
            <span className="text-xs text-slate-400 ml-1">units</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Dispatched consignments in transit</p>
        </div>

        {/* KPI 5: OUTSTANDING TO MAIN */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Outstanding to Main
              </span>
              <div className="p-2 bg-rose-50 rounded-lg text-rose-600">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-bold text-rose-600">
                ₹{Number(kpis.outstandingToMain).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {kpis.overdueAmount > 0 ? `₹${Number(kpis.overdueAmount).toLocaleString('en-IN')} overdue` : 'No overdue'}
              </span>
              {data.linkedSupplierPartyId && onNavigate && (
                <button
                  onClick={() => onNavigate(`/parties/${data.linkedSupplierPartyId}`)}
                  className="text-[11px] font-semibold text-blue-600 hover:underline"
                >
                  Statement
                </button>
              )}
            </div>

            {(kpis.paymentsAwaitingVerification || 0) > 0 && (
              <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md flex items-center justify-between">
                <span>In-Verification:</span>
                <span className="font-bold">₹{Number(kpis.paymentsAwaitingVerification).toLocaleString('en-IN')}</span>
              </div>
            )}
          </div>

          <button
            id="kpi-record-payment-btn"
            onClick={() => setShowPaymentModal(true)}
            className="w-full mt-3 py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Record Payment
          </button>
        </div>
      </div>

      {/* COMPACT QUICK ACTIONS BAR */}
      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-600 mr-2">Quick Actions:</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPaymentModal(true)}
            className="px-3 py-1.5 bg-emerald-50 border border-emerald-300 rounded-lg font-semibold text-emerald-800 hover:bg-emerald-100 flex items-center gap-1.5 shadow-sm"
          >
            <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
            Pay Main Warehouse
          </button>

          <button
            onClick={() => setShowAdvicesModal(true)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
          >
            <ReceiptText className="w-3.5 h-3.5 text-slate-600" />
            Payment Advices
            {(data.kpis?.paymentsAwaitingCount || 0) > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                {data.kpis?.paymentsAwaitingCount}
              </span>
            )}
          </button>

          {onNavigate && (
            <>
              <button
                onClick={() => onNavigate('/dealer/orders')}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
              >
                <ShoppingCart className="w-3.5 h-3.5 text-blue-600" />
                Order Stock
              </button>

              <button
                onClick={() => onNavigate('/dealer/availability')}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
              >
                <Search className="w-3.5 h-3.5 text-indigo-600" />
                Main Availability
              </button>

              <button
                onClick={() => onNavigate('/dealer/orders')}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
              >
                <Package className="w-3.5 h-3.5 text-amber-600" />
                My Orders
              </button>

              <button
                onClick={() => onNavigate('/dealer/shipments')}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
              >
                <Truck className="w-3.5 h-3.5 text-blue-600" />
                Incoming Shipments
              </button>

              <button
                onClick={() => onNavigate('/dealer/receipts')}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
              >
                <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                Receive Goods (GRN)
              </button>

              <button
                onClick={() => onNavigate('/purchases/invoices')}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
              >
                <Receipt className="w-3.5 h-3.5 text-purple-600" />
                Purchase Invoices
              </button>

              <button
                id="quick-action-returns-btn"
                onClick={() => onNavigate('/dealer/returns')}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
                Returns to Main
                {(data.returnStats?.approvedAwaitingDispatch || 0) > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                    {data.returnStats?.approvedAwaitingDispatch}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* NEEDS ATTENTION ALERT */}
      {(data.needsAttention?.hasUrgentAction || (data.returnStats?.approvedAwaitingDispatch || 0) > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-900">Operational Actions Pending</h3>
              <div className="text-xs text-amber-800 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {(data.returnStats?.approvedAwaitingDispatch || 0) > 0 && (
                  <span>
                    • <strong>{data.returnStats?.approvedAwaitingDispatch}</strong> return request(s) approved by Main (ready for dispatch)
                  </span>
                )}
                {data.needsAttention && data.needsAttention.shipmentsAwaitingReceipt > 0 && (
                  <span>
                    • <strong>{data.needsAttention.shipmentsAwaitingReceipt}</strong> incoming shipments awaiting intake confirmation
                  </span>
                )}
                {data.needsAttention && data.needsAttention.partiallyReceivedShipments > 0 && (
                  <span>
                    • <strong>{data.needsAttention.partiallyReceivedShipments}</strong> consignments partially received
                  </span>
                )}
                {data.needsAttention && data.needsAttention.overdueAmount > 0 && (
                  <span>
                    • <strong>₹{Number(data.needsAttention.overdueAmount).toLocaleString('en-IN')}</strong> in overdue invoices to Main
                  </span>
                )}
                {(data.kpis?.paymentsAwaitingCount || 0) > 0 && (
                  <span>
                    • <strong>{data.kpis?.paymentsAwaitingCount}</strong> payment advice(s) (₹{Number(data.kpis?.paymentsAwaitingVerification || 0).toLocaleString('en-IN')}) submitted to Main awaiting verification
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(data.kpis?.paymentsAwaitingCount || 0) > 0 && (
              <button
                onClick={() => setShowAdvicesModal(true)}
                className="px-3.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 shadow-sm flex items-center gap-1.5"
              >
                <ReceiptText className="w-3.5 h-3.5" />
                View Advices
              </button>
            )}
            {(data.returnStats?.approvedAwaitingDispatch || 0) > 0 && onNavigate && (
              <button
                id="attention-dispatch-returns-btn"
                onClick={() => onNavigate('/dealer/returns')}
                className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 shadow-sm flex items-center gap-1.5"
              >
                <Truck className="w-3.5 h-3.5" />
                Dispatch Returns
              </button>
            )}
            {data.needsAttention && data.needsAttention.shipmentsAwaitingReceipt > 0 && onNavigate && (
              <button
                onClick={() => onNavigate('/dealer/shipments')}
                className="px-3.5 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 shadow-sm"
              >
                Confirm Goods Receipt
              </button>
            )}
          </div>
        </div>
      )}

      {/* MAIN WAREHOUSE QUICK SEARCH WIDGET */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-4 h-4 text-blue-600" />
              Quick Check Main Warehouse Stock
            </h2>
            <p className="text-xs text-slate-500">
              Instantly check real-time available optical inventory at {data.mainWarehouse?.name || 'Main Warehouse'}
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search item, category, batch..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                handleSearchMain(e.target.value);
              }}
              className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {searchLoading && (
          <div className="py-4 text-center text-xs text-slate-400">
            <RefreshCw className="w-4 h-4 animate-spin mx-auto text-blue-600 mb-1" />
            Searching Main inventory...
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2 text-center">SPH</th>
                  <th className="px-3 py-2 text-center">CYL</th>
                  <th className="px-3 py-2 text-right">Main Available</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {searchResults.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{item.primary_item_name}</td>
                    <td className="px-3 py-2 text-slate-500">{item.category_name}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{item.batch_number}</td>
                    <td className="px-3 py-2 text-center font-mono">{item.sph || '—'}</td>
                    <td className="px-3 py-2 text-center font-mono">{item.cyl || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-indigo-600">
                      {item.main_available_stock}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate(`/dealer/orders`)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
                        >
                          Order
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* TWO COLUMN CONTENT: INCOMING SHIPMENTS & RECENT ORDERS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incoming Shipments */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-4 h-4 text-blue-600" />
              Incoming Shipments from Main
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('/dealer/shipments')}
                className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1"
              >
                View all <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>

          {data.incomingShipments && data.incomingShipments.length > 0 ? (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5">Shipment #</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5 text-center">Qty</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.incomingShipments.map((ds: any) => (
                    <tr key={ds.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-medium text-blue-600">{ds.shipment_number}</div>
                        <div className="text-[11px] text-slate-400">
                          Invoice: {ds.invoice_number || '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">
                        {new Date(ds.dispatch_date).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold text-slate-900">
                        <div>{ds.total_quantity}</div>
                        {ds.pending_receipt_quantity > 0 && (
                          <div className="text-[10px] text-amber-600">
                            {ds.pending_receipt_quantity} pending
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-50 text-blue-700">
                          {ds.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {onNavigate && (
                          <button
                            onClick={() => onNavigate(`/dealer/shipments`)}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md shadow-sm"
                          >
                            Receive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-400">
              No shipments currently in transit.
            </div>
          )}
        </div>

        {/* Recent Orders */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-600" />
              Recent Dealer Orders
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('/dealer/orders')}
                className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1"
              >
                View all <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>

          {data.recentOrders && data.recentOrders.length > 0 ? (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5">Order #</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5 text-center">Units</th>
                    <th className="px-3 py-2.5 text-right">Value (₹)</th>
                    <th className="px-3 py-2.5 text-center">Lifecycle Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentOrders.map((o: any) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono font-medium text-blue-600">
                        {o.order_number}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">
                        {new Date(o.created_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-3 py-2.5 text-center font-medium text-slate-800">
                        {o.total_quantity}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-slate-900">
                        ₹{Number(o.grand_total).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2.5 text-center">
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
            <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-400">
              No orders placed recently.
            </div>
          )}
        </div>
      </div>

      {/* LOWER SECTION: LOW LOCAL STOCK & PRIVACY STOCK SHARING */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Low / Zero Local Stock Warning */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                Low / Zero Local Stock Items
              </h2>
              <p className="text-xs text-slate-500">
                Items running low in your local store that may need replenishment from Main Warehouse
              </p>
            </div>
          </div>

          {data.lowStockItems && data.lowStockItems.length > 0 ? (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2">Item Name</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2 text-center">Power</th>
                    <th className="px-3 py-2 text-right">Local Stock</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.lowStockItems.map((item: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">{item.primary_item_name}</td>
                      <td className="px-3 py-2 text-slate-500">{item.category_name}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{item.batch_number}</td>
                      <td className="px-3 py-2 text-center font-mono">
                        {item.sph ? `SPH ${item.sph}` : ''} {item.cyl ? `CYL ${item.cyl}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-rose-600">
                        {item.available_stock}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {onNavigate && (
                          <button
                            onClick={() => onNavigate('/dealer/orders')}
                            className="px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                          >
                            Reorder
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-400">
              All active inventory items have adequate available stock.
            </div>
          )}
        </div>

        {/* STOCK SHARING TOGGLE & PRIVACY CARD */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Inventory Sharing Control
              </h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                Optional
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              By default, your local inventory is <strong>strictly private</strong>. If you enable sharing,
              Main Warehouse can view your available quantities to coordinate order fulfillment.
            </p>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-800">Guaranteed Privacy:</div>
              <div>• Purchase costs and rates are NEVER shared.</div>
              <div>• Selling prices and margins are NEVER shared.</div>
              <div>• Local customer names and records are NEVER shared.</div>
            </div>

            {shareSuccessMsg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>{shareSuccessMsg}</span>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {sharingStock ? (
                <Unlock className="w-4 h-4 text-emerald-600" />
              ) : (
                <Lock className="w-4 h-4 text-slate-400" />
              )}
              <span className="text-xs font-semibold text-slate-800">
                {sharingStock ? 'Stock Sharing is ON' : 'Stock Sharing is OFF (Private)'}
              </span>
            </div>

            <button
              onClick={handleToggleStockSharing}
              disabled={sharingUpdating}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                sharingStock
                  ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
              }`}
            >
              {sharingUpdating ? 'Updating...' : sharingStock ? 'Disable Sharing' : 'Enable Sharing'}
            </button>
          </div>
        </div>
      </div>

      {/* DEALER PAYMENT ADVICES SECTION */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-emerald-600" />
              Dealer Payment Advices to Main
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Track submitted payments, bank reference details, invoice allocations, and verification status.
            </p>
          </div>
          <button
            onClick={() => setShowPaymentModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 shadow-sm transition-colors"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Record Payment
          </button>
        </div>

        <DealerPaymentAdvicesList
          onRefreshSummary={fetchSummary}
          onOpenPaymentModal={() => setShowPaymentModal(true)}
        />
      </div>

      {/* MAIN WAREHOUSE CONTACT INFO CARD */}
      {data.mainWarehouse && (
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white rounded-lg border border-slate-200 text-slate-700">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">{data.mainWarehouse.name}</div>
              <div className="text-slate-500">
                Primary Supply Warehouse • {data.mainWarehouse.city}, {data.mainWarehouse.state}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-slate-700">
            {data.mainWarehouse.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{data.mainWarehouse.phone}</span>
              </div>
            )}
            {data.mainWarehouse.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{data.mainWarehouse.email}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DEALER PAYMENT MODAL */}
      {showPaymentModal && (
        <DealerPaymentModal
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            fetchSummary();
            setShowPaymentModal(false);
          }}
        />
      )}

      {/* PAYMENT ADVICES MODAL */}
      {showAdvicesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <ReceiptText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Payment Advices Directory</h3>
                  <p className="text-xs text-slate-500">
                    All payment advices submitted to Main Warehouse with current verification status
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAdvicesModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <DealerPaymentAdvicesList
                onRefreshSummary={fetchSummary}
                onOpenPaymentModal={() => {
                  setShowAdvicesModal(false);
                  setShowPaymentModal(true);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
