import React, { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart,
  Search,
  RefreshCw,
  Package,
  CheckCircle2,
  Clock,
  Truck,
  Building2,
  FileText,
  AlertCircle,
  X,
  ExternalLink,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { DealerOrderRecord } from '../../types/index.js';

interface DealerOrdersListPageProps {
  onNavigate?: (path: string) => void;
}

export const DealerOrdersListPage: React.FC<DealerOrdersListPageProps> = ({ onNavigate }) => {
  const { currentBusiness } = useAuth();
  const [orders, setOrders] = useState<DealerOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  // Order Details Modal
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (search.trim()) params.append('search', search.trim());

      const res = await apiRequest<{ success: boolean; orders: DealerOrderRecord[] }>(
        `/api/dealer/orders?${params.toString()}`
      );
      if (res.success) {
        setOrders(res.orders || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load dealer orders');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const viewOrderDetails = async (id: string) => {
    setSelectedOrderId(id);
    setSelectedOrderDetails(null);
    setDetailsLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; order: any }>(`/api/dealer/orders/${id}`);
      if (res.success) {
        setSelectedOrderDetails(res.order);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load order details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Confirmed & Reserved
          </span>
        );
      case 'PACKED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
            <Package className="w-3 h-3" />
            Packed
          </span>
        );
      case 'DISPATCHED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full">
            <Truck className="w-3 h-3" />
            Dispatched
          </span>
        );
      case 'DELIVERED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Delivered / Completed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">
            <X className="w-3 h-3" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full">
            <Clock className="w-3 h-3" />
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-blue-100 text-blue-700">
              Dealer Procurement
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-semibold text-slate-600">
              Direct Main Warehouse Orders
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            My Warehouse Orders
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Track status, reserved stock, and delivery of orders submitted against your parent Main Warehouse.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onNavigate && (
            <button
              onClick={() => onNavigate('/inventory/dealer-availability')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
            >
              <Building2 className="w-4 h-4" />
              Place New Order
            </button>
          )}
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors disabled:opacity-50"
            title="Refresh Orders"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by Order # or notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>

          <div className="flex items-center gap-1 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-2" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="CONFIRMED">Confirmed & Reserved</option>
              <option value="PACKED">Packed</option>
              <option value="DISPATCHED">Dispatched</option>
              <option value="DELIVERED">Delivered</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Total Orders: <span className="font-bold text-slate-900">{orders.length}</span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Orders List Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 border-b border-slate-100 uppercase tracking-wider text-[10px] font-semibold">
              <tr>
                <th className="px-5 py-3.5">Order Number</th>
                <th className="px-5 py-3.5">Target Warehouse</th>
                <th className="px-5 py-3.5">Order Date</th>
                <th className="px-5 py-3.5 text-center">Items / Units</th>
                <th className="px-5 py-3.5 text-right">Grand Total</th>
                <th className="px-5 py-3.5 text-center">Warehouse Status</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading your orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                    <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    No orders found. You haven't submitted any orders to Main Warehouse yet.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        <span>{order.orderNumber}</span>
                      </div>
                      {order.notes && (
                        <div className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5">
                          {order.notes}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-3.5 font-medium text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span>{order.mainWarehouseName || 'Main Warehouse HQ'}</span>
                      </div>
                    </td>

                    <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px]">
                      {new Date(order.orderDate).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>

                    <td className="px-5 py-3.5 text-center">
                      <span className="font-semibold text-slate-900">{order.totalQuantity}</span>{' '}
                      <span className="text-slate-400 text-[11px]">units</span>
                      <div className="text-[10px] text-slate-400">
                        {order.itemCount} distinct lines
                      </div>
                    </td>

                    <td className="px-5 py-3.5 text-right font-mono font-bold text-slate-900">
                      ₹{order.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="px-5 py-3.5 text-center">
                      {getStatusBadge(order.status)}
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => viewOrderDetails(order.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                      >
                        Details
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Details Modal */}
      {selectedOrderId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Order Details: {selectedOrderDetails?.orderNumber || '...'}
                  </h2>
                  {selectedOrderDetails && getStatusBadge(selectedOrderDetails.status)}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Placed directly with {selectedOrderDetails?.mainWarehouseName || 'Main Warehouse'}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrderId(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {detailsLoading ? (
                <div className="py-12 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                  Loading line items and batch allocations...
                </div>
              ) : selectedOrderDetails ? (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="text-[11px] font-semibold text-slate-500">Total Units</div>
                      <div className="text-lg font-bold text-slate-900 font-mono">
                        {selectedOrderDetails.totalQuantity} units
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="text-[11px] font-semibold text-slate-500">Line Items</div>
                      <div className="text-lg font-bold text-slate-900 font-mono">
                        {selectedOrderDetails.itemCount} items
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="text-[11px] font-semibold text-slate-500">Total Value</div>
                      <div className="text-lg font-bold text-emerald-700 font-mono">
                        ₹{selectedOrderDetails.grandTotal?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  {/* Lines Breakdown */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                      Allocated Batches & Powers
                    </h3>
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[10px] font-semibold uppercase">
                          <tr>
                            <th className="px-3 py-2">Item / Specification</th>
                            <th className="px-3 py-2">Batch / Barcode</th>
                            <th className="px-3 py-2 text-center">Qty</th>
                            <th className="px-3 py-2 text-right">Unit Rate</th>
                            <th className="px-3 py-2 text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedOrderDetails.salesOrder?.lines?.map((line: any) => (
                            <tr key={line.id} className="hover:bg-slate-50/50">
                              <td className="px-3 py-2 font-medium text-slate-900">
                                {line.uniqueItem?.name || line.uniqueItemName || 'Stock Item'}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                                {line.batches && line.batches.length > 0 ? (
                                  line.batches.map((b: any) => (
                                    <div key={b.id}>
                                      {b.batch?.barcode || b.barcode || 'Batch'} (Qty: {b.quantity})
                                    </div>
                                  ))
                                ) : (
                                  'Standard Batch'
                                )}
                              </td>
                              <td className="px-3 py-2 text-center font-bold text-slate-800">
                                {line.quantity}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-slate-700">
                                ₹{parseFloat(line.rate || '0').toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                                ₹{parseFloat(line.lineTotal || '0').toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {selectedOrderDetails.notes && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">Order Notes: </span>
                      {selectedOrderDetails.notes}
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-end bg-slate-50/50">
              <button
                onClick={() => setSelectedOrderId(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
