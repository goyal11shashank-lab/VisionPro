import React, { useState, useEffect } from 'react';
import {
  ShoppingCart,
  Plus,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Printer,
  Barcode,
  Calendar,
  Building2,
  AlertCircle,
  FileText,
  Trash2,
  RotateCcw,
  Sparkles,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface SalesOrderLineBatch {
  id?: string;
  batchId: string;
  quantity: number;
  barcode?: string;
  sph?: string | number;
  cyl?: string | number;
  axis?: string | number;
  add?: string | number;
  side?: string;
  availableStock?: number;
}

interface SalesOrderLine {
  id?: string;
  uniqueItemId: string;
  uniqueItemName?: string;
  uniqueItemCode?: string;
  quantity: number;
  rate: number;
  discountType: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  discountAmount?: number;
  taxableAmount?: number;
  gstRate: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  lineTotal?: number;
  batches: SalesOrderLineBatch[];
}

interface SalesOrder {
  id: string;
  businessId: string;
  partyId: string;
  partyName?: string;
  partyCode?: string;
  partyGstin?: string;
  partyState?: string;
  orderNumber: string;
  orderDate: string;
  subtotal: string | number;
  discountTotal: string | number;
  taxableAmount: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  roundOff: string | number;
  grandTotal: string | number;
  status: 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_CONVERTED' | 'CONVERTED' | 'CANCELLED';
  notes?: string;
  lines: SalesOrderLine[];
  createdAt: string;
}

export const SalesOrdersPage: React.FC<{ onNavigateToInvoice?: (orderId: string) => void }> = ({
  onNavigateToInvoice,
}) => {
  const { currentBusiness, hasPermission } = useAuth();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Form State
  const [parties, setParties] = useState<any[]>([]);
  const [uniqueItems, setUniqueItems] = useState<any[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [partyCreditInfo, setPartyCreditInfo] = useState<any>(null);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [orderNotes, setOrderNotes] = useState('');
  const [targetStatus, setTargetStatus] = useState<'DRAFT' | 'CONFIRMED'>('CONFIRMED');
  const [formLines, setFormLines] = useState<SalesOrderLine[]>([]);
  const [previewOrderNumber, setPreviewOrderNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Barcode / Matrix Quick Add Helper
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchOrders = async () => {
    if (!currentBusiness) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (search) params.append('search', search);

      const res = await fetch(`/api/sales/orders?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (!res.ok) throw new Error('Failed to load sales orders');
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [currentBusiness, statusFilter, search]);

  const loadFormData = async () => {
    if (!currentBusiness) return;
    try {
      // 1. Load Customer Parties (CUSTOMER or BOTH)
      const partiesRes = await fetch('/api/parties', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (partiesRes.ok) {
        const data = await partiesRes.json();
        const validParties = (data.parties || []).filter(
          (p: any) => p.partyType === 'CUSTOMER' || p.partyType === 'BOTH'
        );
        setParties(validParties);
      }

      // 2. Load Unique Items
      const itemsRes = await fetch('/api/optical-master/unique-items', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        setUniqueItems(data.uniqueItems || []);
      }

      // 3. Order Number preview
      const numRes = await fetch('/api/sales/orders/number-preview', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (numRes.ok) {
        const data = await numRes.json();
        setPreviewOrderNumber(data.orderNumber);
      }
    } catch (err) {
      console.error('Failed to load form prerequisites:', err);
    }
  };

  const handleOpenCreate = () => {
    setSelectedPartyId('');
    setPartyCreditInfo(null);
    setOrderDate(new Date().toISOString().split('T')[0]);
    setOrderNotes('');
    setFormLines([]);
    setActionError(null);
    setTargetStatus('CONFIRMED');
    setIsCreateOpen(true);
    loadFormData();
  };

  // Check customer credit info and state
  const handlePartyChange = async (partyId: string) => {
    setSelectedPartyId(partyId);
    if (!partyId) {
      setPartyCreditInfo(null);
      return;
    }
    try {
      const res = await fetch(`/api/sales/parties/${partyId}/credit-check`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
      });
      if (res.ok) {
        const info = await res.json();
        setPartyCreditInfo(info);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Add line item
  const handleAddLine = async (uniqueItemId?: string) => {
    const item = uniqueItems.find(i => i.id === uniqueItemId) || uniqueItems[0];
    if (!item) return;

    let prefilledRate = item.mrp ? parseFloat(item.mrp) : 400;

    // Check party last sale price
    if (selectedPartyId && item.id) {
      try {
        const priceRes = await fetch(`/api/sales/pricing/${selectedPartyId}/${item.id}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'X-Business-Id': currentBusiness!.id,
          },
        });
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          if (priceData.lastSalePrice !== null && priceData.lastSalePrice !== undefined) {
            prefilledRate = parseFloat(priceData.lastSalePrice);
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    // Fetch batches for this unique item
    let batches: SalesOrderLineBatch[] = [];
    try {
      const bRes = await fetch(`/api/sales/unique-items/${item.id}/batches?onlyInStock=true`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
      });
      if (bRes.ok) {
        const bData = await bRes.json();
        if (bData.batches && bData.batches.length > 0) {
          const firstBatch = bData.batches[0];
          batches = [
            {
              batchId: firstBatch.id,
              quantity: 1,
              barcode: firstBatch.barcode,
              sph: firstBatch.sph,
              cyl: firstBatch.cyl,
              axis: firstBatch.axis,
              add: firstBatch.add,
              side: firstBatch.side,
              availableStock: firstBatch.availableStock,
            },
          ];
        }
      }
    } catch (e) {
      console.error(e);
    }

    const newLine: SalesOrderLine = {
      uniqueItemId: item.id,
      uniqueItemName: item.name,
      uniqueItemCode: item.code,
      quantity: 1,
      rate: prefilledRate,
      discountType: 'NONE',
      discountValue: 0,
      gstRate: 12,
      batches: batches,
    };

    setFormLines(prev => [...prev, newLine]);
  };

  // Barcode Lookup Fast Add
  const handleBarcodeLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    try {
      setBarcodeLoading(true);
      setBarcodeMessage(null);

      const res = await fetch(`/api/sales/barcode-lookup/${encodeURIComponent(barcodeInput.trim())}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Barcode not found');
      }

      const data = await res.json();
      const batch = data.batch;
      const uItem = data.uniqueItem;
      const stock = data.stock;

      let defaultRate = uItem.mrp ? parseFloat(uItem.mrp) : 450;
      if (selectedPartyId) {
        const priceRes = await fetch(`/api/sales/pricing/${selectedPartyId}/${uItem.id}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'X-Business-Id': currentBusiness!.id,
          },
        });
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          if (priceData.lastSalePrice !== null) {
            defaultRate = parseFloat(priceData.lastSalePrice);
          }
        }
      }

      const newLine: SalesOrderLine = {
        uniqueItemId: uItem.id,
        uniqueItemName: uItem.name,
        uniqueItemCode: uItem.code,
        quantity: 1,
        rate: defaultRate,
        discountType: 'NONE',
        discountValue: 0,
        gstRate: 12,
        batches: [
          {
            batchId: batch.id,
            quantity: 1,
            barcode: batch.barcode,
            sph: batch.sph,
            cyl: batch.cyl,
            axis: batch.axis,
            add: batch.add,
            side: batch.side,
            availableStock: parseFloat(stock.availableStock || '0'),
          },
        ],
      };

      setFormLines(prev => [...prev, newLine]);
      setBarcodeInput('');
      setBarcodeMessage({
        type: 'success',
        text: `Added ${uItem.name} (SPH: ${batch.sph || '0.00'}, CYL: ${batch.cyl || '0.00'}) | Avail: ${stock.availableStock} pairs`,
      });
    } catch (err: any) {
      setBarcodeMessage({ type: 'error', text: err.message });
    } finally {
      setBarcodeLoading(false);
    }
  };

  // Calculate live financial summary
  const calculateTotals = () => {
    let subtotal = 0;
    let discountTotal = 0;
    let taxableAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    const selectedParty = parties.find(p => p.id === selectedPartyId);
    const isInterState =
      currentBusiness?.state &&
      selectedParty?.state &&
      currentBusiness.state.trim().toLowerCase() !== selectedParty.state.trim().toLowerCase();

    formLines.forEach(line => {
      const gross = line.quantity * line.rate;
      let disc = 0;
      if (line.discountType === 'PERCENTAGE') {
        disc = (gross * (line.discountValue || 0)) / 100;
      } else if (line.discountType === 'FIXED') {
        disc = line.discountValue || 0;
      }
      const taxable = Math.max(0, gross - disc);
      const tax = (taxable * (line.gstRate || 0)) / 100;

      subtotal += gross;
      discountTotal += disc;
      taxableAmount += taxable;

      if (isInterState) {
        igstAmount += tax;
      } else {
        cgstAmount += tax / 2;
        sgstAmount += tax / 2;
      }
    });

    const totalBeforeRound = taxableAmount + cgstAmount + sgstAmount + igstAmount;
    const grandTotal = Math.round(totalBeforeRound);
    const roundOff = grandTotal - totalBeforeRound;

    return {
      subtotal,
      discountTotal,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      roundOff,
      grandTotal,
      isInterState,
    };
  };

  const totals = calculateTotals();

  // Submit Sales Order
  const handleSubmitOrder = async () => {
    if (!selectedPartyId) {
      setActionError('Please select a customer party');
      return;
    }
    if (formLines.length === 0) {
      setActionError('Please add at least one line item');
      return;
    }

    try {
      setSubmitting(true);
      setActionError(null);

      const payload = {
        partyId: selectedPartyId,
        orderDate,
        notes: orderNotes,
        status: targetStatus,
        lines: formLines.map(l => ({
          uniqueItemId: l.uniqueItemId,
          quantity: l.quantity,
          rate: l.rate,
          discountType: l.discountType,
          discountValue: l.discountValue,
          gstRate: l.gstRate,
          batches: l.batches.map(b => ({
            batchId: b.batchId,
            quantity: b.quantity || l.quantity,
          })),
        })),
      };

      const res = await fetch('/api/sales/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create sales order');
      }

      setIsCreateOpen(false);
      fetchOrders();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Confirm Draft Order
  const handleConfirmOrder = async (orderId: string) => {
    try {
      setSubmitting(true);
      const res = await fetch(`/api/sales/orders/${orderId}/confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to confirm order');
      }
      setIsDetailOpen(false);
      fetchOrders();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel Order
  const handleCancelOrder = async (orderId: string) => {
    const reason = prompt('Enter cancellation reason (mandatory for audit):');
    if (!reason || !reason.trim()) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/sales/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to cancel order');
      }
      setIsDetailOpen(false);
      fetchOrders();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700 border border-slate-300">Draft (No Stock Reserved)</span>;
      case 'CONFIRMED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 border border-blue-300">Confirmed (Stock Reserved)</span>;
      case 'PARTIALLY_CONVERTED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300">Partially Invoiced</span>;
      case 'CONVERTED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">Fully Invoiced</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-100 text-rose-800 border border-rose-300">Cancelled (Released)</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  return (
    <div id="sales-orders-container" className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Sales Orders</h1>
              <p className="text-sm text-slate-500">
                Customer bookings with atomic inventory reservations and party-wise rate defaults
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-create-sales-order"
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Create Sales Order
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            id="input-search-orders"
            type="text"
            placeholder="Search by Order #, Customer, or Notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            id="select-status-filter"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PARTIALLY_CONVERTED">Partially Invoiced</option>
            <option value="CONVERTED">Fully Invoiced</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading sales orders...</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="inline-flex p-3 bg-slate-100 rounded-full text-slate-400">
              <ShoppingCart className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">No Sales Orders Found</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Create your first sales order to allocate optical batches and reserve stock automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3.5 px-4">Order #</th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Taxable</th>
                  <th className="py-3.5 px-4 text-right">Grand Total</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50 transition">
                    <td className="py-3.5 px-4 font-mono font-medium text-blue-600">
                      {order.orderNumber}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {new Date(order.orderDate).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900">{order.partyName}</div>
                      <div className="text-xs text-slate-400 font-mono">{order.partyGstin || order.partyState}</div>
                    </td>
                    <td className="py-3.5 px-4">{getStatusBadge(order.status)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-700">
                      ₹{parseFloat(String(order.taxableAmount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900">
                      ₹{parseFloat(String(order.grandTotal)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          id={`btn-view-order-${order.id}`}
                          onClick={() => {
                            setSelectedOrder(order);
                            setIsDetailOpen(true);
                          }}
                          className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {order.status === 'CONFIRMED' && onNavigateToInvoice && (
                          <button
                            id={`btn-convert-order-${order.id}`}
                            onClick={() => onNavigateToInvoice(order.id)}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition"
                            title="Convert to Sales Invoice"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                            Invoice
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE ORDER MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl my-8 overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Create Sales Order</h3>
                <p className="text-xs text-slate-500">
                  Target Document: <span className="font-mono text-blue-600 font-bold">{previewOrderNumber || 'Auto-generated'}</span>
                </p>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {actionError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Order Header Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Customer Party *
                  </label>
                  <select
                    id="select-order-party"
                    value={selectedPartyId}
                    onChange={e => handlePartyChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">Select Customer...</option>
                    {parties.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.partyCode}) - {p.state || 'Local'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Order Date *
                  </label>
                  <input
                    id="input-order-date"
                    type="date"
                    value={orderDate}
                    onChange={e => setOrderDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                  </input>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Booking Mode
                  </label>
                  <select
                    id="select-order-target-status"
                    value={targetStatus}
                    onChange={e => setTargetStatus(e.target.value as any)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none font-medium"
                  >
                    <option value="CONFIRMED">CONFIRMED (Reserve Inventory Now)</option>
                    <option value="DRAFT">DRAFT (Quotation / No Stock Reservation)</option>
                  </select>
                </div>
              </div>

              {/* Credit limit / Outstanding banner */}
              {partyCreditInfo && (
                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="text-slate-500">Current Outstanding:</span>{' '}
                      <span className="font-mono font-bold text-slate-800">₹{partyCreditInfo.currentBalance?.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Credit Limit:</span>{' '}
                      <span className="font-mono font-bold text-slate-800">
                        {partyCreditInfo.creditLimit > 0 ? `₹${partyCreditInfo.creditLimit?.toFixed(2)}` : 'Unlimited'}
                      </span>
                    </div>
                  </div>
                  {totals.isInterState ? (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold">
                      Inter-State (IGST Applicable)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold">
                      Intra-State (CGST + SGST Applicable)
                    </span>
                  )}
                </div>
              )}

              {/* Barcode Quick Scan Bar */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-blue-600" />
                    Quick Optical Barcode Scanner
                  </span>
                  <span className="text-xs text-slate-400">Scan or type optical batch barcode and hit Enter</span>
                </div>

                <form onSubmit={handleBarcodeLookup} className="flex gap-2">
                  <input
                    id="input-barcode-scanner"
                    type="text"
                    placeholder="Scan Barcode (e.g. BAR1_...)..."
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    disabled={barcodeLoading}
                    className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                  />
                  <button
                    type="submit"
                    disabled={barcodeLoading || !barcodeInput.trim()}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                  >
                    {barcodeLoading ? 'Scanning...' : 'Scan & Add'}
                  </button>
                </form>

                {barcodeMessage && (
                  <div
                    className={`text-xs p-2 rounded-lg ${
                      barcodeMessage.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {barcodeMessage.text}
                  </div>
                )}
              </div>

              {/* Line Items Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                    Sales Lines & Batch Allocation ({formLines.length})
                  </h4>
                  <button
                    id="btn-add-sales-line"
                    type="button"
                    onClick={() => handleAddLine()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Item
                  </button>
                </div>

                {formLines.length === 0 ? (
                  <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 text-sm">
                    No items added. Click &quot;Add Item&quot; or scan a barcode to add optical lines.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <tr>
                          <th className="py-2.5 px-3 w-1/3">Item & Optical Power</th>
                          <th className="py-2.5 px-3 w-20 text-center">Qty</th>
                          <th className="py-2.5 px-3 w-24 text-right">Rate (₹)</th>
                          <th className="py-2.5 px-3 w-24">Disc (%)</th>
                          <th className="py-2.5 px-3 w-20">GST %</th>
                          <th className="py-2.5 px-3 text-right">Total (₹)</th>
                          <th className="py-2.5 px-3 w-10 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {formLines.map((line, idx) => {
                          const gross = line.quantity * line.rate;
                          const disc =
                            line.discountType === 'PERCENTAGE'
                              ? (gross * line.discountValue) / 100
                              : line.discountValue;
                          const tax = ((gross - disc) * line.gstRate) / 100;
                          const total = gross - disc + tax;

                          return (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="py-3 px-3 space-y-1.5">
                                <div className="font-semibold text-slate-900">{line.uniqueItemName}</div>
                                {line.batches.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 font-mono rounded border border-blue-200">
                                      SPH: {line.batches[0].sph || '0.00'} | CYL: {line.batches[0].cyl || '0.00'}
                                    </span>
                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 font-mono rounded">
                                      Avail: {line.batches[0].availableStock ?? '—'}
                                    </span>
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-3">
                                <input
                                  type="number"
                                  min="1"
                                  value={line.quantity}
                                  onChange={e => {
                                    const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                                    setFormLines(prev =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              quantity: val,
                                              batches: l.batches.map(b => ({ ...b, quantity: val })),
                                            }
                                          : l
                                      )
                                    );
                                  }}
                                  className="w-full px-2 py-1 text-center font-mono rounded border border-slate-300 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                />
                              </td>

                              <td className="py-3 px-3">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={line.rate}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setFormLines(prev =>
                                      prev.map((l, i) => (i === idx ? { ...l, rate: val } : l))
                                    );
                                  }}
                                  className="w-full px-2 py-1 text-right font-mono rounded border border-slate-300 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                />
                              </td>

                              <td className="py-3 px-3">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={line.discountValue}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setFormLines(prev =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              discountType: val > 0 ? 'PERCENTAGE' : 'NONE',
                                              discountValue: val,
                                            }
                                          : l
                                      )
                                    );
                                  }}
                                  className="w-full px-2 py-1 text-center font-mono rounded border border-slate-300 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                />
                              </td>

                              <td className="py-3 px-3">
                                <select
                                  value={line.gstRate}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    setFormLines(prev =>
                                      prev.map((l, i) => (i === idx ? { ...l, gstRate: val } : l))
                                    );
                                  }}
                                  className="w-full px-1.5 py-1 font-mono rounded border border-slate-300 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                >
                                  <option value={0}>0%</option>
                                  <option value={5}>5%</option>
                                  <option value={12}>12%</option>
                                  <option value={18}>18%</option>
                                </select>
                              </td>

                              <td className="py-3 px-3 text-right font-mono font-semibold text-slate-900">
                                ₹{total.toFixed(2)}
                              </td>

                              <td className="py-3 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => setFormLines(prev => prev.filter((_, i) => i !== idx))}
                                  className="text-slate-400 hover:text-rose-600 p-1 transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Financial Calculation Breakdown */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row justify-between gap-6">
                <div className="flex-1 space-y-2">
                  <label className="block text-xs font-semibold text-slate-600 uppercase">
                    Order Remarks & Instructions
                  </label>
                  <textarea
                    rows={2}
                    value={orderNotes}
                    onChange={e => setOrderNotes(e.target.value)}
                    placeholder="e.g. Special prescription handling, rush delivery..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                  />
                </div>

                <div className="w-full md:w-72 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Taxable Value:</span>
                    <span className="font-mono">₹{totals.taxableAmount.toFixed(2)}</span>
                  </div>
                  {totals.isInterState ? (
                    <div className="flex justify-between text-slate-600">
                      <span>IGST:</span>
                      <span className="font-mono">₹{totals.igstAmount.toFixed(2)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-slate-600">
                        <span>CGST:</span>
                        <span className="font-mono">₹{totals.cgstAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>SGST:</span>
                        <span className="font-mono">₹{totals.sgstAmount.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>Round Off:</span>
                    <span className="font-mono">₹{totals.roundOff.toFixed(2)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-sm text-slate-900">
                    <span>Grand Total:</span>
                    <span className="font-mono text-blue-700">₹{totals.grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>

              <button
                id="btn-submit-sales-order"
                type="button"
                onClick={handleSubmitOrder}
                disabled={submitting || formLines.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {submitting ? (
                  'Processing...'
                ) : targetStatus === 'CONFIRMED' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm & Reserve Inventory
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    Save Draft Order
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW ORDER DETAIL MODAL */}
      {isDetailOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-slate-900 font-mono">{selectedOrder.orderNumber}</h3>
                  {getStatusBadge(selectedOrder.status)}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ordered on {new Date(selectedOrder.orderDate).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => setIsDetailOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Customer summary */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-500 uppercase">Customer:</span>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">{selectedOrder.partyName}</div>
                  <div className="font-mono text-slate-500">{selectedOrder.partyGstin || selectedOrder.partyState}</div>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-slate-500 uppercase">Order Value:</span>
                  <div className="text-base font-bold text-blue-700 font-mono mt-0.5">
                    ₹{parseFloat(String(selectedOrder.grandTotal)).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Order lines */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Item & Parameters</th>
                      <th className="py-2.5 px-3 text-center">Qty</th>
                      <th className="py-2.5 px-3 text-right">Rate</th>
                      <th className="py-2.5 px-3 text-right">Taxable</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedOrder.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">{l.uniqueItemName}</div>
                          {l.batches && l.batches.length > 0 && (
                            <div className="text-[11px] font-mono text-slate-500 mt-1">
                              Allocated Batch: SPH {l.batches[0].sph || '0.00'}, CYL {l.batches[0].cyl || '0.00'}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-medium">{l.quantity}</td>
                        <td className="py-3 px-3 text-right font-mono">₹{parseFloat(String(l.rate)).toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-mono">₹{parseFloat(String(l.taxableAmount || '0')).toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                          ₹{parseFloat(String(l.lineTotal || '0')).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedOrder.status === 'DRAFT' && (
                  <button
                    onClick={() => handleConfirmOrder(selectedOrder.id)}
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition"
                  >
                    Confirm & Reserve Stock
                  </button>
                )}

                {(selectedOrder.status === 'CONFIRMED' || selectedOrder.status === 'DRAFT') && (
                  <button
                    onClick={() => handleCancelOrder(selectedOrder.id)}
                    disabled={submitting}
                    className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition"
                  >
                    Cancel Order
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedOrder.status === 'CONFIRMED' && onNavigateToInvoice && (
                  <button
                    onClick={() => {
                      setIsDetailOpen(false);
                      onNavigateToInvoice(selectedOrder.id);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Convert to Invoice
                  </button>
                )}
                <button
                  onClick={() => setIsDetailOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded-lg transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
