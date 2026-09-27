import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Search,
  RefreshCw,
  Package,
  Layers,
  Filter,
  CheckCircle2,
  AlertCircle,
  Eye,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Store,
  Sparkles,
  Info,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Send,
  X,
  ArrowRight,
  Check,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  MainWarehouseStockItem,
  MainWarehouseAvailabilityResponse,
  MainWarehouseSummaryResponse,
  DealerOrderItem,
} from '../../types/index.js';

interface DealerMainWarehouseAvailabilityPageProps {
  onNavigate?: (path: string) => void;
}

export const DealerMainWarehouseAvailabilityPage: React.FC<DealerMainWarehouseAvailabilityPageProps> = ({
  onNavigate,
}) => {
  const { currentBusiness, user } = useAuth();

  // State: Data
  const [items, setItems] = useState<MainWarehouseStockItem[]>([]);
  const [summary, setSummary] = useState<MainWarehouseSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // State: Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategoryCode, setSelectedCategoryCode] = useState<string>('ALL');
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);
  const [sphFilter, setSphFilter] = useState<string>('');
  const [cylFilter, setCylFilter] = useState<string>('');
  const [axisFilter, setAxisFilter] = useState<string>('');
  const [addFilter, setAddFilter] = useState<string>('');
  const [sideFilter, setSideFilter] = useState<string>('ALL');

  // State: Pagination
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(50);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Order Cart State (Batch ID -> DealerOrderItem)
  const [cart, setCart] = useState<Record<string, DealerOrderItem>>({});
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{ orderNumber: string; grandTotal: number; totalQuantity: number } | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Fetch Summary Metrics
  const fetchSummary = useCallback(async () => {
    try {
      const res = await apiRequest<MainWarehouseSummaryResponse>(
        '/api/dealer/main-warehouse/summary'
      );
      if (res.success) {
        setSummary(res);
      }
    } catch (err: any) {
      console.warn('[Dealer Summary] Error fetching warehouse summary:', err);
    }
  }, []);

  // Fetch Paginated Stock Availability
  const fetchAvailability = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(limit));

      if (searchTerm.trim()) {
        params.append('search', searchTerm.trim());
      }
      if (selectedCategoryCode && selectedCategoryCode !== 'ALL') {
        params.append('categoryCode', selectedCategoryCode);
      }
      if (inStockOnly) {
        params.append('inStockOnly', 'true');
      }
      if (sphFilter !== '') {
        params.append('sph', sphFilter);
      }
      if (cylFilter !== '') {
        params.append('cyl', cylFilter);
      }
      if (axisFilter !== '') {
        params.append('axis', axisFilter);
      }
      if (addFilter !== '') {
        params.append('add', addFilter);
      }
      if (sideFilter && sideFilter !== 'ALL') {
        params.append('side', sideFilter);
      }

      const res = await apiRequest<MainWarehouseAvailabilityResponse>(
        `/api/dealer/main-warehouse/availability?${params.toString()}`
      );

      if (res.success) {
        setItems(res.items || []);
        setTotalPages(res.pagination?.totalPages || 1);
        setTotalItems(res.pagination?.totalItems || 0);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch Main Warehouse availability.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    limit,
    searchTerm,
    selectedCategoryCode,
    inStockOnly,
    sphFilter,
    cylFilter,
    axisFilter,
    addFilter,
    sideFilter,
  ]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  // Handle Search Input Debounced/On Enter
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchAvailability();
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedCategoryCode('ALL');
    setInStockOnly(false);
    setSphFilter('');
    setCylFilter('');
    setAxisFilter('');
    setAddFilter('');
    setSideFilter('ALL');
    setPage(1);
  };

  // Cart Operations
  const addToCart = (item: MainWarehouseStockItem, qty: number = 1) => {
    setCart((prev) => {
      const existing = prev[item.batchId];
      const currentQty = existing ? existing.quantity : 0;
      const newQty = Math.min(item.mainWarehouseAvailable, currentQty + qty);

      if (newQty > 0) {
        return {
          ...prev,
          [item.batchId]: {
            batchId: item.batchId,
            uniqueItemId: item.uniqueItemId,
            uniqueItemName: item.uniqueItemName,
            uniqueItemCode: item.uniqueItemCode,
            barcode: item.barcode,
            formattedPower: item.formattedPower,
            availableStock: item.mainWarehouseAvailable,
            quantity: newQty,
          },
        };
      }
      return prev;
    });
  };

  const updateCartQty = (batchId: string, quantity: number) => {
    setCart((prev) => {
      const existing = prev[batchId];
      if (!existing) return prev;

      if (quantity <= 0) {
        const next = { ...prev };
        delete next[batchId];
        return next;
      } else {
        const cappedQty = Math.min(existing.availableStock, quantity);
        return {
          ...prev,
          [batchId]: { ...existing, quantity: cappedQty },
        };
      }
    });
  };

  const removeFromCart = (batchId: string) => {
    setCart((prev) => {
      const next = { ...prev };
      delete next[batchId];
      return next;
    });
  };

  const clearCart = () => {
    setCart({});
  };

  // Submit Order directly against Main Warehouse
  const handleSubmitOrder = async () => {
    const cartItems: DealerOrderItem[] = Object.values(cart);
    if (cartItems.length === 0) return;
    setSubmittingOrder(true);
    setOrderError(null);

    try {
      const lines = cartItems.map((c) => ({
        batchId: c.batchId,
        uniqueItemId: c.uniqueItemId,
        quantity: c.quantity,
      }));

      // Generate random idempotency key for this submission attempt
      const idempotencyKey = `DLR-ORD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const res = await apiRequest<{
        success: boolean;
        message: string;
        order: {
          id: string;
          orderNumber: string;
          grandTotal: number;
          totalQuantity: number;
          status: string;
        };
      }>('/api/dealer/order', {
        method: 'POST',
        body: JSON.stringify({
          lines,
          notes: orderNotes.trim() || undefined,
          idempotencyKey,
        }),
      });

      if (res.success) {
        setOrderSuccess({
          orderNumber: res.order.orderNumber,
          grandTotal: res.order.grandTotal,
          totalQuantity: res.order.totalQuantity,
        });
        clearCart();
        setOrderNotes('');
        // Refresh warehouse stock counts
        fetchSummary();
        fetchAvailability();
      }
    } catch (err: any) {
      setOrderError(err.message || 'Failed to place order with Main Warehouse.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const cartEntries: DealerOrderItem[] = Object.values(cart);
  const cartItemCount = Object.keys(cart).length;
  const totalCartUnits = cartEntries.reduce((sum, item) => sum + item.quantity, 0);
  const isDealer = currentBusiness?.businessType === 'DEALER';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5" />
              {isDealer ? 'Dealer Portal' : 'Warehouse Stock Feed'}
            </span>
            {summary?.mainWarehouse?.name && (
              <span className="text-xs text-slate-500 font-medium">
                Parent Warehouse: <strong className="text-slate-800">{summary.mainWarehouse.name}</strong>
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Main Warehouse Stock Availability
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Real-time read-only inventory visibility into the central warehouse catalog. Compare warehouse available stock against local inventory, and place stock reservation orders directly with HQ.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          {onNavigate && (
            <button
              onClick={() => onNavigate('/dealer/orders')}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Package className="w-3.5 h-3.5 text-slate-500" />
              <span>My Orders</span>
            </button>
          )}

          {cartItemCount > 0 && (
            <button
              onClick={() => setOrderModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs transition-colors animate-pulse"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Review Order ({totalCartUnits})</span>
            </button>
          )}

          <button
            id="dealer-refresh-btn"
            onClick={() => {
              fetchSummary();
              fetchAvailability();
            }}
            disabled={loading}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Warehouse Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              <span>Main Warehouse</span>
            </div>
            <div className="text-base font-bold text-slate-900 truncate">
              {summary.mainWarehouse.name}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {[summary.mainWarehouse.city, summary.mainWarehouse.state].filter(Boolean).join(', ') || 'Central Hub'}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-emerald-600" />
              <span>Total Available Units</span>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {summary.metrics.totalUnitsAvailable.toLocaleString()}
            </div>
            <div className="text-[11px] text-emerald-600 font-medium">
              Ready for immediate ordering
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>In-Stock Batches</span>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {summary.metrics.inStockBatches.toLocaleString()}
            </div>
            <div className="text-[11px] text-slate-400">
              Across {summary.metrics.totalBatches.toLocaleString()} catalog powers
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
              <span>Order Integration</span>
            </div>
            <div className="text-xs font-bold text-teal-800 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-teal-600" />
              Instant HQ Stock Lock
            </div>
            <div className="text-[11px] text-slate-400">
              Orders auto-reserve stock at HQ
            </div>
          </div>
        </div>
      )}

      {/* Filter and Matrix Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Main Keyword Search */}
          <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by lens name, barcode, code, or power (e.g. +1.50, SV CR39)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all font-medium"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs"
            >
              Search
            </button>
          </form>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Category Select */}
            <select
              value={selectedCategoryCode}
              onChange={(e) => {
                setSelectedCategoryCode(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Optical Categories</option>
              {summary?.categories?.map((cat) => (
                <option key={cat.id} value={cat.code}>
                  {cat.name} ({cat.inStockBatches} in stock)
                </option>
              ))}
            </select>

            <button
              onClick={handleResetFilters}
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Optical Diopter & Power Grid Filters */}
        <form onSubmit={handleSearchSubmit}>
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Sphere (SPH)
              </label>
              <input
                type="number"
                step="0.25"
                placeholder="e.g. -2.00 or +1.50"
                value={sphFilter}
                onChange={(e) => {
                  setSphFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Cylinder (CYL)
              </label>
              <input
                type="number"
                step="0.25"
                placeholder="e.g. -0.75"
                value={cylFilter}
                onChange={(e) => {
                  setCylFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Axis (0° - 180°)
              </label>
              <input
                type="number"
                min="0"
                max="180"
                placeholder="e.g. 90"
                value={axisFilter}
                onChange={(e) => {
                  setAxisFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Add Power
              </label>
              <input
                type="number"
                step="0.25"
                placeholder="e.g. 1.50"
                value={addFilter}
                onChange={(e) => {
                  setAddFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-col justify-between">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                In Stock Filter
              </label>
              <label className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={(e) => {
                    setInStockOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <span className="text-xs font-semibold text-slate-700">In Stock Only</span>
              </label>
            </div>
          </div>
        </form>
      </div>

      {/* Floating Cart Bar if items added */}
      {cartItemCount > 0 && !orderModalOpen && (
        <div className="sticky top-4 z-40 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center justify-between gap-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold flex items-center gap-2">
                <span>{cartItemCount} batch items selected</span>
                <span className="text-blue-400">({totalCartUnits} units)</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Ready to submit to {summary?.mainWarehouse?.name || 'Main Warehouse'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearCart}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setOrderModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
            >
              Review & Place Order
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
          <div>
            <div className="font-semibold">Unable to fetch warehouse feed</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {/* Stock Availability Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              Warehouse Catalog Batches & Powers
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
              {totalItems.toLocaleString()} items
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex items-center gap-1 text-emerald-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Main Warehouse Stock
            </span>
            <span className="text-slate-300">•</span>
            <span className="flex items-center gap-1 text-purple-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              Your Local Store Stock
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 border-b border-slate-100 uppercase tracking-wider text-[10px] font-semibold">
              <tr>
                <th className="px-5 py-3.5">Product & Item Details</th>
                <th className="px-5 py-3.5">Barcode / Batch Key</th>
                <th className="px-5 py-3.5">Optical Power / Specs</th>
                <th className="px-5 py-3.5 text-center">Main Warehouse Available</th>
                <th className="px-5 py-3.5 text-center">Your Local Available</th>
                <th className="px-5 py-3.5 text-right">Order Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Querying real-time stock from Main Warehouse...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    No items found matching the selected power or search query.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const hasMainStock = item.mainWarehouseAvailable > 0;
                  const hasLocalStock = item.dealerAvailable > 0;
                  const inCartItem = cart[item.batchId];

                  return (
                    <tr key={item.batchId} className="hover:bg-slate-50/60 transition-colors">
                      {/* Product Name */}
                      <td className="px-5 py-3.5">
                        <div>
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span>{item.uniqueItemName}</span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                              {item.categoryCode || 'CAT'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Code: <span className="font-mono text-slate-700">{item.uniqueItemCode}</span>
                            {item.primaryItemName && ` • ${item.primaryItemName}`}
                          </div>
                        </div>
                      </td>

                      {/* Barcode / Identity */}
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5">
                          <span className="font-mono text-[11px] px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-800 font-medium">
                            {item.barcode || '—'}
                          </span>
                        </div>
                      </td>

                      {/* Optical Power Specs */}
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5 font-mono text-[11px]">
                          <div className="font-semibold text-slate-900">
                            {item.formattedPower}
                          </div>
                          {(item.sph !== null || item.cyl !== null) && (
                            <div className="text-[10px] text-slate-400 flex items-center gap-2">
                              <span>SPH: {item.sph !== null ? (item.sph > 0 ? `+${item.sph.toFixed(2)}` : item.sph.toFixed(2)) : '0.00'}</span>
                              <span>CYL: {item.cyl !== null ? (item.cyl > 0 ? `+${item.cyl.toFixed(2)}` : item.cyl.toFixed(2)) : '0.00'}</span>
                              {item.axis !== null && <span>AX: {item.axis}°</span>}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Main Warehouse Available */}
                      <td className="px-5 py-3.5 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold border ${
                              hasMainStock
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-50 text-slate-400 border-slate-200'
                            }`}
                          >
                            {item.mainWarehouseAvailable} units
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5">
                            Physical: {item.mainWarehousePhysical}
                          </span>
                        </div>
                      </td>

                      {/* Dealer Local Available */}
                      <td className="px-5 py-3.5 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold border ${
                              hasLocalStock
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : 'bg-slate-50 text-slate-400 border-slate-200'
                            }`}
                          >
                            {item.dealerAvailable} units
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5">
                            Physical: {item.dealerPhysical}
                          </span>
                        </div>
                      </td>

                      {/* Order Action Column */}
                      <td className="px-5 py-3.5 text-right">
                        {hasMainStock ? (
                          inCartItem ? (
                            <div className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg p-1">
                              <button
                                onClick={() => updateCartQty(item.batchId, inCartItem.quantity - 1)}
                                className="p-1 text-slate-600 hover:text-red-600 rounded hover:bg-white"
                                title="Decrease quantity"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="px-2 font-mono font-bold text-xs text-blue-700">
                                {inCartItem.quantity}
                              </span>
                              <button
                                onClick={() => updateCartQty(item.batchId, inCartItem.quantity + 1)}
                                disabled={inCartItem.quantity >= item.mainWarehouseAvailable}
                                className="p-1 text-slate-600 hover:text-blue-600 rounded hover:bg-white disabled:opacity-40"
                                title="Increase quantity"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => addToCart(item, 1)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              Order
                            </button>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                            Out of Stock
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing{' '}
            <strong className="text-slate-800">
              {items.length > 0 ? (page - 1) * limit + 1 : 0}
            </strong>{' '}
            to{' '}
            <strong className="text-slate-800">
              {Math.min(page * limit, totalItems)}
            </strong>{' '}
            of <strong className="text-slate-800">{totalItems}</strong> entries
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-700 font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Review & Place Order Modal */}
      {orderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Review Order to Main Warehouse
                  </h2>
                  <p className="text-xs text-slate-500">
                    Target: {summary?.mainWarehouse?.name || 'Main Warehouse HQ'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOrderModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {orderSuccess ? (
                <div className="p-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Order Submitted Successfully!
                  </h3>
                  <p className="text-xs text-slate-600 max-w-md mx-auto">
                    Order <span className="font-mono font-bold text-blue-600">{orderSuccess.orderNumber}</span> has been confirmed and reserved in real-time at the Main Warehouse.
                  </p>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl max-w-xs mx-auto text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Reserved Units:</span>
                      <span className="font-bold text-slate-800">{orderSuccess.totalQuantity} units</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Total Order Value:</span>
                      <span className="font-bold text-emerald-700">
                        ₹{orderSuccess.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {orderError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <div>{orderError}</div>
                    </div>
                  )}

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[10px] font-semibold uppercase">
                        <tr>
                          <th className="px-3 py-2">Item / Power</th>
                          <th className="px-3 py-2">Barcode</th>
                          <th className="px-3 py-2 text-center">Available</th>
                          <th className="px-3 py-2 text-center">Order Qty</th>
                          <th className="px-3 py-2 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {cartEntries.map((cartItem) => (
                          <tr key={cartItem.batchId} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2.5">
                              <div className="font-semibold text-slate-900">
                                {cartItem.uniqueItemName}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500">
                                {cartItem.formattedPower}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600">
                              {cartItem.barcode}
                            </td>
                            <td className="px-3 py-2.5 text-center text-slate-500 font-mono">
                              {cartItem.availableStock}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                                <button
                                  onClick={() => updateCartQty(cartItem.batchId, cartItem.quantity - 1)}
                                  className="p-1 text-slate-600 hover:text-red-600 rounded"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="px-2 font-mono font-bold text-xs text-slate-900">
                                  {cartItem.quantity}
                                </span>
                                <button
                                  onClick={() => updateCartQty(cartItem.batchId, cartItem.quantity + 1)}
                                  disabled={cartItem.quantity >= cartItem.availableStock}
                                  className="p-1 text-slate-600 hover:text-blue-600 rounded disabled:opacity-40"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                onClick={() => removeFromCart(cartItem.batchId)}
                                className="p-1 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Order Notes */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Order Remarks / Dispatch Instructions (Optional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Urgent store dispatch requested, please pack with care..."
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Operational note */}
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-start gap-2">
                    <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                    <div>
                      <strong>Authoritative Reservation:</strong> Submitting this order generates an official Sales Order under the Main Warehouse and instantly locks the requested inventory batches. Local store stock will only be updated upon dispatch arrival and stock receipt.
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              {orderSuccess ? (
                <div className="flex items-center justify-end w-full gap-2">
                  {onNavigate && (
                    <button
                      onClick={() => {
                        setOrderModalOpen(false);
                        setOrderSuccess(null);
                        onNavigate('/dealer/orders');
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                    >
                      View in My Orders
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setOrderModalOpen(false);
                      setOrderSuccess(null);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-xs">
                    <span className="text-slate-500">Total Units to Reserve: </span>
                    <strong className="text-slate-900 font-mono">{totalCartUnits} units</strong>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOrderModalOpen(false)}
                      className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitOrder}
                      disabled={submittingOrder || cartItemCount === 0}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-colors disabled:opacity-50"
                    >
                      {submittingOrder ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          Confirm Order & Reserve Stock
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
