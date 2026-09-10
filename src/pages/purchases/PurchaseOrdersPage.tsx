import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Search,
  RefreshCw,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Trash2,
  Filter,
  Calendar,
  Building2,
  ShieldAlert,
  Pencil,
  Loader2,
  ArrowRight,
  ShoppingCart,
  Printer,
  Download,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { PurchaseOrder } from '../../types/index.js';
import { PurchaseOrderDetailModal } from '../../components/purchases/PurchaseOrderDetailModal.js';
import { CreatePurchaseInvoicePage } from './CreatePurchaseInvoicePage.js';
import { PrintPreviewModal } from '../../components/print/PrintPreviewModal.js';
import { PrintableVoucher } from '../../components/print/PrintableVoucher.js';
import { exportToExcel, ExcelColumn } from '../../utils/excelExporter.js';
import { exportToCsv } from '../../utils/csvExporter.js';

interface PurchaseOrdersPageProps {
  onNavigate?: (path: string) => void;
}

export const PurchaseOrdersPage: React.FC<PurchaseOrdersPageProps> = ({ onNavigate }) => {
  const { currentBusiness } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Views & Modals
  const [isCreatingOrder, setIsCreatingOrder] = useState<boolean>(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [convertingOrderId, setConvertingOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [confirmCancelOrder, setConfirmCancelOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [cancelReasonInput, setCancelReasonInput] = useState<string>('');
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  // Print Preview
  const [printPreviewOrder, setPrintPreviewOrder] = useState<any | null>(null);
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState<boolean>(false);

  const handleRowPrintPreview = async (ordId: string) => {
    try {
      const full = await apiRequest<{ order: PurchaseOrder }>(`/api/purchases/orders/${ordId}`);
      setPrintPreviewOrder(full.order);
    } catch {
      const fallback = orders.find(o => o.id === ordId);
      if (fallback) setPrintPreviewOrder(fallback);
    }
    setIsPrintPreviewOpen(true);
  };

  const handleExportExcel = () => {
    const columns: ExcelColumn[] = [
      { header: 'Order #', key: 'orderNumber', width: 16 },
      { header: 'Date', key: 'orderDate', width: 14 },
      { header: 'Vendor Name', key: 'supplier.name', width: 28 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Taxable (₹)', key: 'taxableAmount', type: 'currency', width: 16 },
      { header: 'CGST (₹)', key: 'cgstAmount', type: 'currency', width: 14 },
      { header: 'SGST (₹)', key: 'sgstAmount', type: 'currency', width: 14 },
      { header: 'IGST (₹)', key: 'igstAmount', type: 'currency', width: 14 },
      { header: 'Round Off (₹)', key: 'roundOff', type: 'currency', width: 12 },
      { header: 'Grand Total (₹)', key: 'grandTotal', type: 'currency', width: 18 },
    ];

    exportToExcel({
      filename: `purchase_orders_${new Date().toISOString().split('T')[0]}`,
      sheetName: 'Purchase Orders',
      reportTitle: 'Purchase Orders Register',
      businessName: currentBusiness?.name,
      filtersSummary: `Status: ${statusFilter}${search ? `, Search: "${search}"` : ''} | Total: ${orders.length} orders`,
      columns,
      data: orders,
    });
  };

  const handleExportCsv = () => {
    const columns: ExcelColumn[] = [
      { header: 'Order #', key: 'orderNumber' },
      { header: 'Date', key: 'orderDate' },
      { header: 'Vendor Name', key: 'supplier.name' },
      { header: 'Status', key: 'status' },
      { header: 'Taxable Amount', key: 'taxableAmount' },
      { header: 'CGST', key: 'cgstAmount' },
      { header: 'SGST', key: 'sgstAmount' },
      { header: 'IGST', key: 'igstAmount' },
      { header: 'Grand Total', key: 'grandTotal' },
    ];

    exportToCsv({
      filename: `purchase_orders_${new Date().toISOString().split('T')[0]}`,
      reportTitle: 'Purchase Orders Register',
      businessName: currentBusiness?.name,
      filtersSummary: `Status: ${statusFilter}${search ? `, Search: "${search}"` : ''}`,
      columns,
      data: orders,
    });
  };

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      params.append('limit', '100');

      const data = await apiRequest<{ orders: PurchaseOrder[]; total: number }>(
        `/api/purchases/orders?${params.toString()}`
      );
      setOrders(data.orders || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOrders();
  };

  const handleViewOrder = async (orderId: string) => {
    try {
      const order = await apiRequest<PurchaseOrder>(`/api/purchases/orders/${orderId}`);
      setSelectedOrder(order);
    } catch (err: any) {
      setError(err.message || 'Failed to load order details');
    }
  };

  const handleEditOrder = (orderId: string) => {
    setEditingOrderId(orderId);
    setIsCreatingOrder(true);
  };

  const handleConvertToInvoice = (orderId: string) => {
    if (selectedOrder) {
      setSelectedOrder(null);
    }
    setConvertingOrderId(orderId);
  };

  const handleCancelClick = (orderId: string, orderNumber: string) => {
    setCancelReasonInput('');
    setConfirmCancelOrder({ id: orderId, orderNumber });
  };

  const handleExecuteCancel = async () => {
    if (!confirmCancelOrder || cancellingOrderId) return;
    if (!cancelReasonInput.trim()) {
      setError('Please provide a cancellation reason.');
      return;
    }

    setCancellingOrderId(confirmCancelOrder.id);
    setError(null);
    try {
      await apiRequest(`/api/purchases/orders/${confirmCancelOrder.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReasonInput.trim() }),
      });
      setSuccessMsg(`Order ${confirmCancelOrder.orderNumber} successfully cancelled.`);
      setConfirmCancelOrder(null);
      setCancelReasonInput('');
      fetchOrders();
      if (selectedOrder && selectedOrder.id === confirmCancelOrder.id) {
        setSelectedOrder(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel purchase order');
    } finally {
      setCancellingOrderId(null);
    }
  };

  // If user clicked Convert to Invoice, show CreatePurchaseInvoicePage prefilled with order data
  if (convertingOrderId) {
    return (
      <CreatePurchaseInvoicePage
        fromPurchaseOrderId={convertingOrderId}
        onBack={() => setConvertingOrderId(null)}
        onSuccess={() => {
          setConvertingOrderId(null);
          fetchOrders();
        }}
        onNavigate={onNavigate}
      />
    );
  }

  // If creating or editing a Purchase Order, show CreatePurchaseInvoicePage with isOrder={true}
  if (isCreatingOrder) {
    return (
      <CreatePurchaseInvoicePage
        isOrder={true}
        editOrderId={editingOrderId}
        onBack={() => {
          setIsCreatingOrder(false);
          setEditingOrderId(null);
        }}
        onSuccess={() => {
          setIsCreatingOrder(false);
          setEditingOrderId(null);
          fetchOrders();
        }}
        onNavigate={onNavigate}
      />
    );
  }

  // Calculate quick stats
  const totalOrders = orders.length;
  const openOrders = orders.filter(o => o.status === 'OPEN').length;
  const convertedOrders = orders.filter(o => o.status === 'CONVERTED' || o.status === 'PARTIALLY_CONVERTED').length;
  const totalValue = orders
    .filter(o => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + parseFloat(o.grandTotal || '0'), 0);

  return (
    <div id="purchase-orders-page" className="flex flex-col h-full bg-slate-50">
      {/* Header Banner */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-slate-900 font-bold text-xl">
            <ShoppingCart className="w-6 h-6 text-blue-600" />
            <span>Purchase Orders</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Book supplier orders, reserve inventory, and convert them to actual purchase invoices.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            id="btn-refresh-po-list"
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            id="btn-create-new-purchase-order"
            onClick={() => {
              setEditingOrderId(null);
              setIsCreatingOrder(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Purchase Order</span>
          </button>
        </div>
      </div>

      {/* Quick Summary Cards */}
      <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Orders</div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">{totalOrders}</div>
        </div>
        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Open (Pending Inward)</div>
          <div className="text-xl font-bold font-mono text-blue-700 mt-1">{openOrders}</div>
        </div>
        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Converted to Invoices</div>
          <div className="text-xl font-bold font-mono text-emerald-700 mt-1">{convertedOrders}</div>
        </div>
        <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
          <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Active PO Value</div>
          <div className="text-xl font-bold font-mono text-indigo-700 mt-1">
            ₹{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mx-6 mb-3 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-800 font-bold">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="mx-6 mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-800 font-bold">✕</button>
        </div>
      )}

      {/* Search and Filter Strip */}
      <div className="px-6 pb-3 flex flex-col md:flex-row items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-80">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by PO #, Supplier, Ref..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold bg-slate-800 text-white rounded hover:bg-slate-900 transition-colors"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500 font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded font-medium text-slate-700 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
          >
            <option value="ALL">All Orders</option>
            <option value="OPEN">Open Only</option>
            <option value="PARTIALLY_CONVERTED">Partially Converted</option>
            <option value="CONVERTED">Fully Converted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
            <button
              id="btn-export-po-excel"
              onClick={handleExportExcel}
              disabled={orders.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition disabled:opacity-50"
              title="Export filtered purchase orders to Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              id="btn-export-po-csv"
              onClick={handleExportCsv}
              disabled={orders.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition disabled:opacity-50"
              title="Export filtered purchase orders to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100/75 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-2.5 px-3">Order No</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Supplier Name</th>
                <th className="py-2.5 px-3">Supplier Ref</th>
                <th className="py-2.5 px-3">Items</th>
                <th className="py-2.5 px-3 text-right">Order Amount</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600 mb-2" />
                    <span>Loading Purchase Orders...</span>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <ShoppingCart className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No purchase orders found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Create your first purchase order to reserve inventory and track inbound supplier procurement.
                    </p>
                    <button
                      onClick={() => setIsCreatingOrder(true)}
                      className="mt-3 px-3.5 py-1.5 bg-blue-600 text-white font-bold rounded text-xs hover:bg-blue-700 shadow-xs"
                    >
                      + Create Purchase Order
                    </button>
                  </td>
                </tr>
              ) : (
                orders.map(order => {
                  const isCancel = order.status === 'CANCELLED';
                  const isConverted = order.status === 'CONVERTED';
                  const isOpen = order.status === 'OPEN';

                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-slate-50/80 transition-colors font-sans"
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-600">
                        {order.orderNumber}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {new Date(order.orderDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {order.supplier?.name || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">
                        {order.supplierReference || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-mono">
                        {order.lines?.length || 0} line(s)
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        ₹{parseFloat(order.grandTotal || '0').toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold font-mono uppercase ${
                            order.status === 'OPEN'
                              ? 'bg-blue-100 text-blue-800'
                              : order.status === 'CONVERTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : order.status === 'PARTIALLY_CONVERTED'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleViewOrder(order.id)}
                            className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="View Order Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRowPrintPreview(order.id)}
                            className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Print Preview / Export PDF"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {isOpen && (
                            <>
                              <button
                                onClick={() => handleEditOrder(order.id)}
                                className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                title="Edit Purchase Order"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleConvertToInvoice(order.id)}
                                className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded font-semibold text-[11px]"
                                title="Convert Order to Actual Purchase Invoice"
                              >
                                <span>Inward</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleCancelClick(order.id, order.orderNumber)}
                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Cancel Order"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <PurchaseOrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onRefresh={fetchOrders}
          onConvert={handleConvertToInvoice}
        />
      )}

      {/* Cancel Order Confirmation Modal */}
      {confirmCancelOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-lg max-w-md w-full p-5 shadow-xl border border-slate-300 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h3 className="font-bold text-slate-900 text-base">
                Cancel Purchase Order #{confirmCancelOrder.orderNumber}?
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to cancel this purchase order? This action cannot be undone.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cancellation Reason <span className="text-red-500">*</span>:
              </label>
              <textarea
                value={cancelReasonInput}
                onChange={e => setCancelReasonInput(e.target.value)}
                placeholder="e.g. Supplier stock out, price renegotiated, duplicate entry"
                rows={2}
                className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-red-500 focus:outline-hidden"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmCancelOrder(null)}
                className="px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded border border-slate-300 font-semibold"
              >
                Keep Order
              </button>
              <button
                onClick={handleExecuteCancel}
                disabled={!cancelReasonInput.trim() || !!cancellingOrderId}
                className="px-4 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded font-bold transition-colors disabled:opacity-50"
              >
                {cancellingOrderId ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* REUSABLE PRINT PREVIEW MODAL */}
      {isPrintPreviewOpen && printPreviewOrder && (
        <PrintPreviewModal
          isOpen={isPrintPreviewOpen}
          onClose={() => {
            setIsPrintPreviewOpen(false);
            setPrintPreviewOrder(null);
          }}
          title={`Purchase Order - ${printPreviewOrder.orderNumber || ''}`}
          filename={`PurchaseOrder_${printPreviewOrder.orderNumber || 'PO'}`}
          defaultOrientation="portrait"
        >
          {({ documentId }) => (
            <PrintableVoucher
              id={documentId}
              business={currentBusiness}
              voucher={printPreviewOrder}
              documentType="PURCHASE_ORDER"
              customTitle="PURCHASE ORDER"
              copyLabel="Vendor Copy"
            />
          )}
        </PrintPreviewModal>
      )}
    </div>
  );
};
