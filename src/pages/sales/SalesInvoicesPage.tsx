import React, { useState, useEffect } from 'react';
import {
  Receipt,
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
  HelpCircle,
  ArrowLeftRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface SalesInvoiceLineBatch {
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

interface SalesInvoiceLine {
  id?: string;
  salesOrderLineId?: string;
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
  batches: SalesInvoiceLineBatch[];
}

interface SalesInvoice {
  id: string;
  businessId: string;
  partyId: string;
  partyName?: string;
  partyCode?: string;
  partyGstin?: string;
  partyState?: string;
  salesOrderId?: string;
  salesOrderNumber?: string;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: string | number;
  discountTotal: string | number;
  taxableAmount: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  roundOff: string | number;
  grandTotal: string | number;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  notes?: string;
  paymentTerms?: string;
  lines: SalesInvoiceLine[];
  createdAt: string;
}

export const SalesInvoicesPage: React.FC<{ initialConvertOrderId?: string }> = ({
  initialConvertOrderId,
}) => {
  const { currentBusiness, hasPermission } = useAuth();

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoice | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDirectCreateOpen, setIsDirectCreateOpen] = useState(false);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);

  // Form State
  const [parties, setParties] = useState<any[]>([]);
  const [uniqueItems, setUniqueItems] = useState<any[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [partyCreditInfo, setPartyCreditInfo] = useState<any>(null);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentTerms, setPaymentTerms] = useState('NET 30');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [targetStatus, setTargetStatus] = useState<'DRAFT' | 'POSTED'>('POSTED');
  const [formLines, setFormLines] = useState<SalesInvoiceLine[]>([]);
  const [previewInvoiceNumber, setPreviewInvoiceNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Convert Order State
  const [confirmedOrders, setConfirmedOrders] = useState<any[]>([]);
  const [selectedConvertOrderId, setSelectedConvertOrderId] = useState<string>(initialConvertOrderId || '');
  const [selectedConvertOrder, setSelectedConvertOrder] = useState<any>(null);
  const [convertLineQuantities, setConvertLineQuantities] = useState<Record<string, number>>({});

  // Barcode / Matrix Quick Add Helper
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchInvoices = async () => {
    if (!currentBusiness) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (search) params.append('search', search);

      const res = await fetch(`/api/sales/invoices?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (!res.ok) throw new Error('Failed to load sales invoices');
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [currentBusiness, statusFilter, search]);

  // Handle Initial Conversion Prompt
  useEffect(() => {
    if (initialConvertOrderId) {
      openConvertModal(initialConvertOrderId);
    }
  }, [initialConvertOrderId]);

  const loadFormData = async () => {
    if (!currentBusiness) return;
    try {
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

      const numRes = await fetch('/api/sales/invoices/number-preview', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (numRes.ok) {
        const data = await numRes.json();
        setPreviewInvoiceNumber(data.invoiceNumber);
      }
    } catch (err) {
      console.error('Failed to load form prerequisites:', err);
    }
  };

  const handleOpenDirectCreate = () => {
    setSelectedPartyId('');
    setPartyCreditInfo(null);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setPaymentTerms('NET 30');
    setInvoiceNotes('');
    setFormLines([]);
    setActionError(null);
    setTargetStatus('POSTED');
    setIsDirectCreateOpen(true);
    loadFormData();
  };

  const openConvertModal = async (orderId?: string) => {
    setIsConvertModalOpen(true);
    setActionError(null);
    try {
      const res = await fetch('/api/sales/orders?status=CONFIRMED', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setConfirmedOrders(data.orders || []);
      }

      if (orderId) {
        loadOrderForConversion(orderId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadOrderForConversion = async (orderId: string) => {
    setSelectedConvertOrderId(orderId);
    try {
      const res = await fetch(`/api/sales/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness!.id,
        },
      });
      if (res.ok) {
        const order = await res.json();
        setSelectedConvertOrder(order);
        const qtys: Record<string, number> = {};
        (order.lines || []).forEach((l: any) => {
          qtys[l.id] = l.quantity;
        });
        setConvertLineQuantities(qtys);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Party selection & credit check
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

  // Add line item directly
  const handleAddLine = async (uniqueItemId?: string) => {
    const item = uniqueItems.find(i => i.id === uniqueItemId) || uniqueItems[0];
    if (!item) return;

    let prefilledRate = item.mrp ? parseFloat(item.mrp) : 450;
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

    let batches: SalesInvoiceLineBatch[] = [];
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

    const newLine: SalesInvoiceLine = {
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

      const newLine: SalesInvoiceLine = {
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
        text: `Scanned ${uItem.name} (SPH: ${batch.sph || '0.00'}, CYL: ${batch.cyl || '0.00'}) | Avail: ${stock.availableStock} pairs`,
      });
    } catch (err: any) {
      setBarcodeMessage({ type: 'error', text: err.message });
    } finally {
      setBarcodeLoading(false);
    }
  };

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

  // Create Direct Invoice
  const handleSubmitDirectInvoice = async () => {
    if (!selectedPartyId) {
      setActionError('Please select a customer party');
      return;
    }
    if (formLines.length === 0) {
      setActionError('Please add at least one optical item line');
      return;
    }

    try {
      setSubmitting(true);
      setActionError(null);

      const payload = {
        partyId: selectedPartyId,
        invoiceDate,
        paymentTerms,
        notes: invoiceNotes,
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

      const res = await fetch('/api/sales/invoices', {
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
        throw new Error(err.message || 'Failed to create sales invoice');
      }

      setIsDirectCreateOpen(false);
      fetchInvoices();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Convert Sales Order to Invoice
  const handleExecuteConversion = async () => {
    if (!selectedConvertOrder) return;

    try {
      setSubmitting(true);
      setActionError(null);

      const lines = selectedConvertOrder.lines.map((l: any) => ({
        salesOrderLineId: l.id,
        uniqueItemId: l.uniqueItemId,
        quantity: convertLineQuantities[l.id] || l.quantity,
        rate: parseFloat(l.rate),
        discountType: l.discountType || 'NONE',
        discountValue: parseFloat(l.discountValue || '0'),
        gstRate: parseFloat(l.gstRate || '12'),
        batches: (l.batches || []).map((b: any) => ({
          batchId: b.batchId,
          quantity: convertLineQuantities[l.id] || l.quantity,
        })),
      }));

      const payload = {
        invoiceDate,
        paymentTerms,
        lines,
      };

      const res = await fetch(`/api/sales/orders/${selectedConvertOrder.id}/convert`, {
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
        throw new Error(err.message || 'Failed to convert sales order');
      }

      setIsConvertModalOpen(false);
      fetchInvoices();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel Posted Invoice
  const handleCancelInvoice = async (invoiceId: string) => {
    const reason = prompt('Enter invoice cancellation reason (mandatory for audit & ledger reversal):');
    if (!reason || !reason.trim()) return;

    try {
      setSubmitting(true);
      const res = await fetch(`/api/sales/invoices/${invoiceId}/cancel`, {
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
        throw new Error(err.message || 'Failed to cancel sales invoice');
      }

      setIsDetailOpen(false);
      fetchInvoices();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700 border border-slate-300">Draft Invoice</span>;
      case 'POSTED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">Posted (Stock Deducted & Ledger Debited)</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-100 text-rose-800 border border-rose-300">Cancelled (Reversed)</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  return (
    <div id="sales-invoices-container" className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Sales Invoices & Billing</h1>
              <p className="text-sm text-slate-500">
                GST tax invoicing with atomic stock ledger depletion and party last-sale pricing
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            id="btn-convert-sales-order"
            onClick={() => openConvertModal()}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium rounded-lg border border-indigo-200 shadow-sm transition"
          >
            <ArrowLeftRight className="w-4 h-4" />
            Convert from Sales Order
          </button>

          <button
            id="btn-create-direct-invoice"
            onClick={handleOpenDirectCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Direct Invoice (POS)
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            id="input-search-invoices"
            type="text"
            placeholder="Search by Invoice #, Customer Name, or SO reference..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            id="select-invoice-status-filter"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="POSTED">Posted (Finalized)</option>
            <option value="DRAFT">Draft</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading sales invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="inline-flex p-3 bg-slate-100 rounded-full text-slate-400">
              <Receipt className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">No Sales Invoices Found</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Create a direct counter sales invoice or convert a confirmed sales order.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3.5 px-4">Invoice #</th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Source Order</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Taxable</th>
                  <th className="py-3.5 px-4 text-right">Grand Total</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition">
                    <td className="py-3.5 px-4 font-mono font-medium text-emerald-700">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {new Date(inv.invoiceDate).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900">{inv.partyName}</div>
                      <div className="text-xs text-slate-400 font-mono">{inv.partyGstin || inv.partyState}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-500">
                      {inv.salesOrderNumber ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200 font-semibold">
                          {inv.salesOrderNumber}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Direct Sale</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">{getStatusBadge(inv.status)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-700">
                      ₹{parseFloat(String(inv.taxableAmount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                      ₹{parseFloat(String(inv.grandTotal)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        id={`btn-view-invoice-${inv.id}`}
                        onClick={() => {
                          setSelectedInvoice(inv);
                          setIsDetailOpen(true);
                        }}
                        className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded transition"
                        title="View Tax Invoice"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE DIRECT INVOICE MODAL */}
      {isDirectCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl my-8 overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Direct Sales Tax Invoice</h3>
                <p className="text-xs text-slate-500">
                  Target Number: <span className="font-mono text-emerald-700 font-bold">{previewInvoiceNumber || 'Auto-generated'}</span>
                </p>
              </div>
              <button
                onClick={() => setIsDirectCreateOpen(false)}
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

              {/* Invoice Header Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Customer Party *
                  </label>
                  <select
                    id="select-direct-invoice-party"
                    value={selectedPartyId}
                    onChange={e => handlePartyChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
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
                    Invoice Date *
                  </label>
                  <input
                    id="input-direct-invoice-date"
                    type="date"
                    value={invoiceDate}
                    onChange={e => setInvoiceDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Payment Terms
                  </label>
                  <select
                    value={paymentTerms}
                    onChange={e => setPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="NET 30">NET 30 Days</option>
                    <option value="NET 15">NET 15 Days</option>
                    <option value="COD">Cash on Delivery / Counter</option>
                    <option value="IMMEDIATE">Immediate Online</option>
                  </select>
                </div>
              </div>

              {/* Credit check & GST State notice */}
              {partyCreditInfo && (
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
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
                      Inter-State (IGST 12%)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold">
                      Intra-State (CGST 6% + SGST 6%)
                    </span>
                  )}
                </div>
              )}

              {/* Barcode Quick Scan Bar */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-emerald-600" />
                    Optical Lens Barcode Scanner
                  </span>
                  <span className="text-xs text-slate-400">Scan barcode from lens pouch or packet</span>
                </div>

                <form onSubmit={handleBarcodeLookup} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Scan Barcode (e.g. BAR1_...)..."
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    disabled={barcodeLoading}
                    className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                  />
                  <button
                    type="submit"
                    disabled={barcodeLoading || !barcodeInput.trim()}
                    className="px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
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
                    Invoice Lines ({formLines.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() => handleAddLine()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Item Line
                  </button>
                </div>

                {formLines.length === 0 ? (
                  <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 text-sm">
                    No items in invoice. Click &quot;Add Item Line&quot; or scan lens barcodes.
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
                              <td className="py-3 px-3 space-y-1">
                                <div className="font-semibold text-slate-900">{line.uniqueItemName}</div>
                                {line.batches.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-800 font-mono rounded border border-emerald-200">
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
                                  className="w-full px-2 py-1 text-center font-mono rounded border border-slate-300 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
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
                                  className="w-full px-2 py-1 text-right font-mono rounded border border-slate-300 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
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
                                  className="w-full px-2 py-1 text-center font-mono rounded border border-slate-300 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
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
                                  className="w-full px-1.5 py-1 font-mono rounded border border-slate-300 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
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
                    Invoice Notes
                  </label>
                  <textarea
                    rows={2}
                    value={invoiceNotes}
                    onChange={e => setInvoiceNotes(e.target.value)}
                    placeholder="e.g. Terms of warranty, patient reference..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                  />
                </div>

                <div className="w-full md:w-72 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Taxable Amount:</span>
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
                    <span className="font-mono text-emerald-800">₹{totals.grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsDirectCreateOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>

              <button
                id="btn-submit-direct-invoice"
                type="button"
                onClick={handleSubmitDirectInvoice}
                disabled={submitting || formLines.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {submitting ? (
                  'Processing...'
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Post Invoice (Deduct Stock & Update Ledger)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONVERT SALES ORDER MODAL */}
      {isConvertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-8 overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-indigo-900">Convert Confirmed Sales Order to Invoice</h3>
                <p className="text-xs text-indigo-600">
                  Consumes active stock reservations and generates final posted tax invoice
                </p>
              </div>
              <button
                onClick={() => setIsConvertModalOpen(false)}
                className="text-indigo-400 hover:text-indigo-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Order selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                  Select Confirmed Sales Order *
                </label>
                <select
                  id="select-convert-order"
                  value={selectedConvertOrderId}
                  onChange={e => loadOrderForConversion(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="">Select a Confirmed Sales Order...</option>
                  {confirmedOrders.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber} — {o.partyName} (₹{parseFloat(String(o.grandTotal)).toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedConvertOrder && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-500">Customer:</span>
                      <div className="text-sm font-bold text-slate-900">{selectedConvertOrder.partyName}</div>
                      <div className="font-mono text-slate-500">{selectedConvertOrder.partyGstin || selectedConvertOrder.partyState}</div>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-slate-500">Status:</span>
                      <div className="mt-0.5">{getStatusBadge(selectedConvertOrder.status)}</div>
                    </div>
                  </div>

                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Specify Quantities to Convert (Full or Partial)
                  </h4>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <tr>
                          <th className="py-2.5 px-3">Item & Power</th>
                          <th className="py-2.5 px-3 text-center">Ordered Qty</th>
                          <th className="py-2.5 px-3 text-center w-28">Convert Qty</th>
                          <th className="py-2.5 px-3 text-right">Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedConvertOrder.lines.map((l: any) => (
                          <tr key={l.id}>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-900">{l.uniqueItemName}</div>
                              {l.batches && l.batches.length > 0 && (
                                <div className="text-[11px] font-mono text-indigo-600 mt-0.5">
                                  Reserved Batch: SPH {l.batches[0].sph || '0.00'}, CYL {l.batches[0].cyl || '0.00'}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-mono font-medium text-slate-600">
                              {l.quantity}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <input
                                type="number"
                                min="1"
                                max={l.quantity}
                                value={convertLineQuantities[l.id] || l.quantity}
                                onChange={e => {
                                  const val = Math.min(
                                    l.quantity,
                                    Math.max(1, parseInt(e.target.value, 10) || 1)
                                  );
                                  setConvertLineQuantities(prev => ({ ...prev, [l.id]: val }));
                                }}
                                className="w-20 px-2 py-1 text-center font-mono rounded border border-slate-300 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                              />
                            </td>
                            <td className="py-3 px-3 text-right font-mono">
                              ₹{parseFloat(String(l.rate)).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsConvertModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>

              <button
                id="btn-execute-conversion"
                type="button"
                onClick={handleExecuteConversion}
                disabled={submitting || !selectedConvertOrder}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {submitting ? 'Converting...' : 'Generate & Post Tax Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW TAX INVOICE DETAIL & PRINT MODAL */}
      {isDetailOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden border border-slate-200">
            {/* Action Bar */}
            <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between print:hidden">
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold">{selectedInvoice.invoiceNumber}</span>
                {getStatusBadge(selectedInvoice.status)}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print / PDF
                </button>
                <button
                  onClick={() => setIsDetailOpen(false)}
                  className="text-slate-400 hover:text-white text-lg font-bold p-1"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Printable Optical GST Tax Invoice Form */}
            <div className="p-8 space-y-6 max-h-[75vh] overflow-y-auto text-slate-800 text-xs">
              {/* Business & Customer Header */}
              <div className="grid grid-cols-2 gap-6 pb-6 border-b border-slate-200">
                <div>
                  <div className="text-base font-bold text-slate-900 uppercase tracking-wide">
                    {currentBusiness?.name || 'Optical ERP Store'}
                  </div>
                  <div className="text-slate-600 mt-1">State: {currentBusiness?.state || 'Local'}</div>
                  <div className="font-mono text-slate-500">GSTIN: {currentBusiness?.gstin || '07AAAAA0000A1Z5'}</div>
                </div>

                <div className="text-right">
                  <h2 className="text-xl font-bold uppercase tracking-wider text-emerald-800">
                    TAX INVOICE
                  </h2>
                  <div className="mt-1 font-mono font-bold text-slate-900">{selectedInvoice.invoiceNumber}</div>
                  <div className="text-slate-600">
                    Date: {new Date(selectedInvoice.invoiceDate).toLocaleDateString()}
                  </div>
                  {selectedInvoice.salesOrderNumber && (
                    <div className="text-slate-500 font-mono">Ref SO: {selectedInvoice.salesOrderNumber}</div>
                  )}
                </div>
              </div>

              {/* Billed To Customer */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-500 uppercase tracking-wider text-[11px]">
                  Billed To (Customer):
                </span>
                <div className="text-sm font-bold text-slate-900 mt-1">{selectedInvoice.partyName}</div>
                <div className="grid grid-cols-2 gap-2 mt-1 text-slate-600">
                  <div>GSTIN / Tax ID: <span className="font-mono font-medium">{selectedInvoice.partyGstin || 'Unregistered'}</span></div>
                  <div>Place of Supply: <span className="font-medium">{selectedInvoice.partyState || 'Local'}</span></div>
                </div>
              </div>

              {/* Line Items Table with Optical Details */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Item & Optical Specification</th>
                      <th className="py-2.5 px-3 text-center">Qty (Pairs)</th>
                      <th className="py-2.5 px-3 text-right">Rate</th>
                      <th className="py-2.5 px-3 text-right">Taxable</th>
                      <th className="py-2.5 px-3 text-right">GST</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {selectedInvoice.lines.map((l, idx) => (
                      <tr key={idx}>
                        <td className="py-3 px-3 font-sans">
                          <div className="font-bold text-slate-900">{l.uniqueItemName}</div>
                          {l.batches && l.batches.length > 0 && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Power: SPH {l.batches[0].sph || '0.00'}, CYL {l.batches[0].cyl || '0.00'}
                              {l.batches[0].axis ? `, AXIS ${l.batches[0].axis}` : ''}
                              {l.batches[0].add ? `, ADD ${l.batches[0].add}` : ''}
                              {l.batches[0].barcode ? ` | Barcode: ${l.batches[0].barcode}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">{l.quantity}</td>
                        <td className="py-3 px-3 text-right">₹{parseFloat(String(l.rate)).toFixed(2)}</td>
                        <td className="py-3 px-3 text-right">₹{parseFloat(String(l.taxableAmount || '0')).toFixed(2)}</td>
                        <td className="py-3 px-3 text-right">
                          ₹{(parseFloat(String(l.cgstAmount || 0)) + parseFloat(String(l.sgstAmount || 0)) + parseFloat(String(l.igstAmount || 0))).toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-slate-900">
                          ₹{parseFloat(String(l.lineTotal || '0')).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              <div className="flex justify-end">
                <div className="w-72 space-y-1.5 font-mono text-xs">
                  <div className="flex justify-between text-slate-600 font-sans">
                    <span>Taxable Amount:</span>
                    <span>₹{parseFloat(String(selectedInvoice.taxableAmount)).toFixed(2)}</span>
                  </div>
                  {parseFloat(String(selectedInvoice.igstAmount || '0')) > 0 ? (
                    <div className="flex justify-between text-slate-600 font-sans">
                      <span>IGST:</span>
                      <span>₹{parseFloat(String(selectedInvoice.igstAmount)).toFixed(2)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-slate-600 font-sans">
                        <span>CGST:</span>
                        <span>₹{parseFloat(String(selectedInvoice.cgstAmount || '0')).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600 font-sans">
                        <span>SGST:</span>
                        <span>₹{parseFloat(String(selectedInvoice.sgstAmount || '0')).toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-slate-600 font-sans">
                    <span>Round Off:</span>
                    <span>₹{parseFloat(String(selectedInvoice.roundOff || '0')).toFixed(2)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-300 flex justify-between font-bold text-base text-slate-900 font-sans">
                    <span>Invoice Total:</span>
                    <span className="text-emerald-800 font-mono">₹{parseFloat(String(selectedInvoice.grandTotal)).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Cancellation Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between print:hidden">
              <div>
                {selectedInvoice.status === 'POSTED' && (
                  <button
                    id="btn-cancel-posted-invoice"
                    onClick={() => handleCancelInvoice(selectedInvoice.id)}
                    disabled={submitting}
                    className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 transition"
                  >
                    Cancel Invoice (Reverse Stock & Ledger)
                  </button>
                )}
              </div>

              <button
                onClick={() => setIsDetailOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded-lg transition"
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
