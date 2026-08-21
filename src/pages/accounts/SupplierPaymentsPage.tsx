import React, { useState, useEffect } from 'react';
import {
  ArrowUpRight,
  Plus,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Printer,
  Building2,
  Calendar,
  AlertCircle,
  DollarSign,
  CreditCard,
  FileText,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  Ban,
  TrendingDown,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface PaymentAllocation {
  id?: string;
  documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE';
  documentId: string;
  documentNumber?: string;
  invoiceDate?: string;
  grandTotal?: number;
  paidAmount?: number;
  outstandingBalance?: number;
  allocatedAmount: number;
  notes?: string;
}

interface PaymentVoucher {
  id: string;
  paymentNumber: string;
  paymentType: 'RECEIPT' | 'PAYMENT';
  partyId: string;
  partyName?: string;
  partyPhone?: string;
  paymentDate: string;
  paymentMode: 'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CARD';
  amount: number | string;
  unallocatedAmount: number | string;
  referenceNumber?: string;
  bankName?: string;
  chequeNumber?: string;
  chequeDate?: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  notes?: string;
  cancellationReason?: string;
  createdBy?: string;
  postedBy?: string;
  createdAt: string;
  allocations?: PaymentAllocation[];
}

interface UnpaidPurchaseInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierInvoiceNumber?: string;
  grandTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentStatus: string;
}

export const SupplierPaymentsPage: React.FC = () => {
  const { currentBusiness, hasPermission } = useAuth();

  // List State
  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modeFilter, setModeFilter] = useState<string>('ALL');
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>('ALL');

  // Supplier List for Select
  const [suppliers, setSuppliers] = useState<any[]>([]);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [partyId, setPartyId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CARD'>('BANK_TRANSFER');
  const [amount, setAmount] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [notes, setNotes] = useState('');
  const [autoPost, setAutoPost] = useState(true);

  // Invoices for Allocation
  const [unpaidInvoices, setUnpaidInvoices] = useState<UnpaidPurchaseInvoice[]>([]);
  const [allocationsMap, setAllocationsMap] = useState<Record<string, number>>({});
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // View Details Modal State
  const [viewVoucher, setViewVoucher] = useState<PaymentVoucher | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Cancel Modal State
  const [cancelModalVoucher, setCancelModalVoucher] = useState<PaymentVoucher | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Fetch Payment Vouchers
  const fetchVouchers = async () => {
    if (!currentBusiness) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('paymentType', 'PAYMENT');
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (modeFilter !== 'ALL') params.append('paymentMode', modeFilter);
      if (selectedSupplierFilter !== 'ALL') params.append('partyId', selectedSupplierFilter);
      if (search) params.append('search', search);

      const res = await fetch(`/api/payments?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });

      if (!res.ok) throw new Error('Failed to load supplier payments');
      const data = await res.json();
      setVouchers(data.payments || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Suppliers List
  const fetchSuppliers = async () => {
    if (!currentBusiness) return;
    try {
      const res = await fetch('/api/parties', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const sups = (data.parties || []).filter(
          (p: any) => p.partyType === 'SUPPLIER' || p.partyType === 'BOTH'
        );
        setSuppliers(sups);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchVouchers();
  }, [currentBusiness, statusFilter, modeFilter, selectedSupplierFilter, search]);

  useEffect(() => {
    fetchSuppliers();
  }, [currentBusiness]);

  // When supplier changes in create modal, load their unpaid purchase invoices
  useEffect(() => {
    if (!partyId || !currentBusiness) {
      setUnpaidInvoices([]);
      setAllocationsMap({});
      return;
    }

    const loadUnpaid = async () => {
      try {
        setLoadingInvoices(true);
        const res = await fetch(`/api/payments/unpaid-invoices/${partyId}?paymentType=PAYMENT`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'X-Business-Id': currentBusiness.id,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setUnpaidInvoices(data.unpaidInvoices || []);
          setAllocationsMap({});
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingInvoices(false);
      }
    };

    loadUnpaid();
  }, [partyId, currentBusiness]);

  // Compute live allocated sum & unallocated balance in Form
  const totalAmountNum = parseFloat(amount) || 0;
  const currentAllocatedSum: number = (Object.values(allocationsMap) as number[]).reduce((sum: number, val: number) => sum + (Number(val) || 0), 0);
  const remainingUnallocated: number = Math.max(0, parseFloat((totalAmountNum - currentAllocatedSum).toFixed(2)));

  // Auto-allocate FIFO
  const handleAutoAllocate = () => {
    let availableToAllocate = totalAmountNum;
    const newMap: Record<string, number> = {};

    for (const inv of unpaidInvoices) {
      if (availableToAllocate <= 0) break;
      const alloc = Math.min(availableToAllocate, inv.outstandingAmount);
      if (alloc > 0) {
        newMap[inv.id] = parseFloat(alloc.toFixed(2));
        availableToAllocate = parseFloat((availableToAllocate - alloc).toFixed(2));
      }
    }
    setAllocationsMap(newMap);
  };

  // Pay single purchase invoice in full
  const handlePayInFull = (inv: UnpaidPurchaseInvoice) => {
    const currentAlloc = allocationsMap[inv.id] || 0;
    const otherAllocs = currentAllocatedSum - currentAlloc;
    const available = Math.max(0, totalAmountNum - otherAllocs);
    const amountToApply = Math.min(inv.outstandingAmount, available);

    setAllocationsMap(prev => ({
      ...prev,
      [inv.id]: parseFloat(amountToApply.toFixed(2)),
    }));
  };

  // Handle single invoice manual input
  const handleAllocationChange = (invId: string, valStr: string) => {
    const val = parseFloat(valStr) || 0;
    const inv = unpaidInvoices.find(i => i.id === invId);
    if (!inv) return;

    const currentAlloc = allocationsMap[invId] || 0;
    const otherAllocs = currentAllocatedSum - currentAlloc;
    const maxPossible = Math.min(inv.outstandingAmount, Math.max(0, totalAmountNum - otherAllocs));

    const finalVal = Math.min(val, maxPossible);
    setAllocationsMap(prev => ({
      ...prev,
      [invId]: finalVal > 0 ? parseFloat(finalVal.toFixed(2)) : 0,
    }));
  };

  // Submit New Supplier Payment
  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBusiness) return;

    if (!partyId) {
      setFormError('Please select a supplier.');
      return;
    }
    if (totalAmountNum <= 0) {
      setFormError('Please enter a valid payment amount greater than ₹0.');
      return;
    }
    if (currentAllocatedSum > totalAmountNum) {
      setFormError('Total allocated amount cannot exceed total payment amount.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);

      const allocations = (Object.entries(allocationsMap) as [string, number][])
        .filter(([_, allocAmt]) => Number(allocAmt) > 0)
        .map(([invId, allocAmt]) => ({
          documentType: 'PURCHASE_INVOICE' as const,
          documentId: invId,
          allocatedAmount: Number(allocAmt),
        }));

      const payload = {
        paymentType: 'PAYMENT',
        partyId,
        paymentDate,
        paymentMode,
        amount: totalAmountNum,
        referenceNumber: referenceNumber || undefined,
        bankName: bankName || undefined,
        chequeNumber: chequeNumber || undefined,
        chequeDate: chequeDate || undefined,
        notes: notes || undefined,
        autoPost,
        allocations,
      };

      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to create supplier payment');
      }

      setShowCreateModal(false);
      resetForm();
      fetchVouchers();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setPartyId('');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentMode('BANK_TRANSFER');
    setAmount('');
    setReferenceNumber('');
    setBankName('');
    setChequeNumber('');
    setChequeDate('');
    setNotes('');
    setAutoPost(true);
    setAllocationsMap({});
    setFormError(null);
  };

  // Open Details Modal
  const handleOpenDetails = async (voucher: PaymentVoucher) => {
    if (!currentBusiness) return;
    try {
      setLoadingDetails(true);
      setViewVoucher(voucher);
      const res = await fetch(`/api/payments/${voucher.id}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (res.ok) {
        const full = await res.json();
        setViewVoucher(full);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Post Draft Voucher
  const handlePostVoucher = async (voucherId: string) => {
    if (!currentBusiness) return;
    try {
      const res = await fetch(`/api/payments/${voucherId}/post`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.message || 'Failed to post supplier payment voucher');
        return;
      }
      fetchVouchers();
      if (viewVoucher && viewVoucher.id === voucherId) {
        handleOpenDetails({ ...viewVoucher, status: 'POSTED' });
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Cancel Voucher
  const handleConfirmCancel = async () => {
    if (!currentBusiness || !cancelModalVoucher) return;
    try {
      setCancelling(true);
      const res = await fetch(`/api/payments/${cancelModalVoucher.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'X-Business-Id': currentBusiness.id,
        },
        body: JSON.stringify({ reason: cancelReason }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to cancel payment');
      }

      setCancelModalVoucher(null);
      setCancelReason('');
      fetchVouchers();
      if (viewVoucher && viewVoucher.id === cancelModalVoucher.id) {
        handleOpenDetails({ ...viewVoucher, status: 'CANCELLED' });
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCancelling(false);
    }
  };

  // Metrics Calculation
  const totalPaid = vouchers
    .filter(v => v.status === 'POSTED')
    .reduce((sum, v) => sum + parseFloat(String(v.amount)), 0);

  const totalAdvance = vouchers
    .filter(v => v.status === 'POSTED')
    .reduce((sum, v) => sum + parseFloat(String(v.unallocatedAmount || 0)), 0);

  const draftCount = vouchers.filter(v => v.status === 'DRAFT').length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <ArrowUpRight className="w-6 h-6" />
            </div>
            Supplier Payments & Outgoing Advances
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Issue supplier payments via Bank/Cheque/Cash, settle purchase invoices & track vendor debit balances.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="create-supplier-payment-btn"
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-medium text-sm transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Make Payment
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Disbursed (Posted)
            </span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <TrendingDown className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">
              ₹{totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-xs text-slate-400 mt-1">
              Debited directly to supplier ledgers
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Unallocated Advances
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-emerald-600">
              ₹{totalAdvance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className="text-xs text-slate-400 mt-1">
              Available to knock off against future purchase bills
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Draft Vouchers
            </span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900">{draftCount}</span>
            <p className="text-xs text-slate-400 mt-1">
              Pending authorization & bank release
            </p>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col md:flex-row gap-3 justify-between items-center">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search payment #, ref, supplier..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9.5 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Supplier Filter */}
          <select
            value={selectedSupplierFilter}
            onChange={e => setSelectedSupplierFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="ALL">All Suppliers</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Mode Filter */}
          <select
            value={modeFilter}
            onChange={e => setModeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="ALL">All Modes</option>
            <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
            <option value="CHEQUE">Cheque</option>
            <option value="UPI">UPI</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="ALL">All Status</option>
            <option value="POSTED">Posted</option>
            <option value="DRAFT">Draft</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Payment Vouchers Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200/80">
              <tr>
                <th className="px-5 py-3.5">Voucher #</th>
                <th className="px-5 py-3.5">Date</th>
                <th className="px-5 py-3.5">Supplier</th>
                <th className="px-5 py-3.5">Payment Mode</th>
                <th className="px-5 py-3.5 text-right">Amount (₹)</th>
                <th className="px-5 py-3.5 text-right">Unallocated (₹)</th>
                <th className="px-5 py-3.5 text-center">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                    Loading supplier payments...
                  </td>
                </tr>
              ) : vouchers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                    No supplier payments found.
                  </td>
                </tr>
              ) : (
                vouchers.map(v => {
                  const amt = parseFloat(String(v.amount));
                  const unalloc = parseFloat(String(v.unallocatedAmount || 0));

                  return (
                    <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-4 font-mono font-medium text-slate-900">
                        {v.paymentNumber}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {new Date(v.paymentDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-900">{v.partyName || 'Supplier'}</div>
                        {v.partyPhone && (
                          <div className="text-xs text-slate-400">{v.partyPhone}</div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium">
                          {v.paymentMode === 'CASH' && <DollarSign className="w-3.5 h-3.5 text-emerald-600" />}
                          {v.paymentMode === 'BANK_TRANSFER' && <Building2 className="w-3.5 h-3.5 text-blue-600" />}
                          {v.paymentMode === 'UPI' && <Sparkles className="w-3.5 h-3.5 text-purple-600" />}
                          {v.paymentMode === 'CHEQUE' && <FileText className="w-3.5 h-3.5 text-amber-600" />}
                          {v.paymentMode === 'CARD' && <CreditCard className="w-3.5 h-3.5 text-indigo-600" />}
                          <span>{v.paymentMode.replace('_', ' ')}</span>
                        </div>
                        {v.referenceNumber && (
                          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                            Ref: {v.referenceNumber}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-900">
                        ₹{amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {unalloc > 0 ? (
                          <span className="font-semibold text-emerald-600">
                            ₹{unalloc.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Knocked Off (₹0.00)</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center">
                        {v.status === 'POSTED' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                            <CheckCircle2 className="w-3 h-3" />
                            Posted
                          </span>
                        )}
                        {v.status === 'DRAFT' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/60">
                            <Clock className="w-3 h-3" />
                            Draft
                          </span>
                        )}
                        {v.status === 'CANCELLED' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/60">
                            <Ban className="w-3 h-3" />
                            Cancelled
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenDetails(v)}
                            title="View Payment Voucher Details"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {v.status === 'DRAFT' && (
                            <button
                              onClick={() => handlePostVoucher(v.id)}
                              title="Authorize & Post to Supplier Ledger"
                              className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium border border-blue-200 transition-colors"
                            >
                              Post
                            </button>
                          )}

                          {v.status === 'POSTED' && (
                            <button
                              onClick={() => {
                                setCancelModalVoucher(v);
                                setCancelReason('');
                              }}
                              title="Cancel & Reverse Supplier Ledger"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
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

      {/* CREATE PAYMENT MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full border border-slate-200 shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">New Supplier Payment</h3>
                  <p className="text-xs text-slate-500">Record outbound vendor disbursement & settle purchase invoices</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePayment} className="p-6 space-y-6">
              {formError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Top Controls Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Supplier */}
                <div className="space-y-1.5 sm:col-span-1">
                  <label className="text-xs font-semibold text-slate-700">Supplier *</label>
                  <select
                    value={partyId}
                    onChange={e => setPartyId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  >
                    <option value="">Select Supplier...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.city || s.state || 'Supplier'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Payment Date *</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                {/* Payment Mode */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Payment Mode *</label>
                  <select
                    value={paymentMode}
                    onChange={e => setPaymentMode(e.target.value as any)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  >
                    <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS/IMPS)</option>
                    <option value="CHEQUE">Cheque / Demand Draft</option>
                    <option value="UPI">UPI (Corporate / Mobile)</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Credit / Debit Card</option>
                  </select>
                </div>
              </div>

              {/* Amount & Mode Specifics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Total Paid Amount */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Total Amount Disbursed (₹) *</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      required
                      className="w-full pl-8 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Reference Number / UTR */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    {paymentMode === 'UPI' ? 'UPI UTR / Ref No' : paymentMode === 'CASH' ? 'Voucher Memo #' : 'Bank UTR / Transaction ID'}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. UTR987654321"
                    value={referenceNumber}
                    onChange={e => setReferenceNumber(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                {/* Bank Name (if non-cash) */}
                {paymentMode !== 'CASH' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700">Payer Bank & Account</label>
                    <input
                      type="text"
                      placeholder="e.g. ICICI Bank A/c 1234"
                      value={bankName}
                      onChange={e => setBankName(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                )}
              </div>

              {/* Cheque Details if Cheque */}
              {paymentMode === 'CHEQUE' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/70">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-amber-900">Cheque Number *</label>
                    <input
                      type="text"
                      placeholder="e.g. 000456"
                      value={chequeNumber}
                      onChange={e => setChequeNumber(e.target.value)}
                      required={paymentMode === 'CHEQUE'}
                      className="w-full px-3.5 py-2 bg-white border border-amber-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-amber-900">Cheque Date</label>
                    <input
                      type="date"
                      value={chequeDate}
                      onChange={e => setChequeDate(e.target.value)}
                      className="w-full px-3.5 py-2 bg-white border border-amber-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>
                </div>
              )}

              {/* INVOICE ALLOCATION SECTION */}
              <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/40 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Purchase Bill Allocation (Settlement)</h4>
                    <p className="text-xs text-slate-500">
                      Knock off against outstanding purchase bills or record as an unallocated supplier advance.
                    </p>
                  </div>

                  {unpaidInvoices.length > 0 && totalAmountNum > 0 && (
                    <button
                      type="button"
                      onClick={handleAutoAllocate}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold border border-blue-200 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Auto-Allocate (FIFO)
                    </button>
                  )}
                </div>

                {/* Allocation Summary Bar */}
                <div className="grid grid-cols-3 gap-3 p-3 bg-white rounded-xl border border-slate-200 text-center">
                  <div>
                    <span className="text-[11px] text-slate-500 block uppercase tracking-wider">Total Disbursed</span>
                    <span className="text-sm font-bold text-slate-900">₹{totalAmountNum.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500 block uppercase tracking-wider">Allocated to Bills</span>
                    <span className="text-sm font-bold text-blue-600">₹{currentAllocatedSum.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500 block uppercase tracking-wider">Remaining Advance</span>
                    <span className="text-sm font-bold text-emerald-600">₹{remainingUnallocated.toFixed(2)}</span>
                  </div>
                </div>

                {/* Unpaid Invoices Table */}
                {!partyId ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    Select a supplier above to view unpaid purchase invoices.
                  </div>
                ) : loadingInvoices ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    Loading unpaid purchase invoices...
                  </div>
                ) : unpaidInvoices.length === 0 ? (
                  <div className="py-6 text-center text-xs text-blue-700 bg-blue-50/50 rounded-xl border border-blue-100">
                    No pending unpaid invoices for this supplier. Full amount of ₹{totalAmountNum.toFixed(2)} will be logged as an Outgoing Advance.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-56 overflow-y-auto">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0">
                        <tr>
                          <th className="px-3 py-2">Invoice #</th>
                          <th className="px-3 py-2">Supplier Bill #</th>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2 text-right">Bill Total</th>
                          <th className="px-3 py-2 text-right">Already Paid</th>
                          <th className="px-3 py-2 text-right">Outstanding</th>
                          <th className="px-3 py-2 text-center">Allocate (₹)</th>
                          <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {unpaidInvoices.map(inv => {
                          const allocVal = allocationsMap[inv.id] || '';

                          return (
                            <tr key={inv.id} className="hover:bg-white transition-colors">
                              <td className="px-3 py-2.5 font-mono font-medium text-slate-900">
                                {inv.invoiceNumber}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 font-mono">
                                {inv.supplierInvoiceNumber || '-'}
                              </td>
                              <td className="px-3 py-2.5">
                                {new Date(inv.invoiceDate).toLocaleDateString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                })}
                              </td>
                              <td className="px-3 py-2.5 text-right font-medium">
                                ₹{inv.grandTotal.toFixed(2)}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-500">
                                ₹{inv.paidAmount.toFixed(2)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-rose-600">
                                ₹{inv.outstandingAmount.toFixed(2)}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={inv.outstandingAmount}
                                  placeholder="0.00"
                                  value={allocVal}
                                  onChange={e => handleAllocationChange(inv.id, e.target.value)}
                                  className="w-24 px-2 py-1 bg-white border border-slate-300 rounded-lg text-right font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => handlePayInFull(inv)}
                                  className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 text-[11px] font-medium transition-colors"
                                >
                                  Full
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

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Remarks / Memo</label>
                <textarea
                  rows={2}
                  placeholder="Disbursement purpose or bank transfer remarks..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Auto-post checkbox */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="autoPostSupplier"
                  checked={autoPost}
                  onChange={e => setAutoPost(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <label htmlFor="autoPostSupplier" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Post Immediately to Supplier Ledger (Debit Supplier Balance)
                </label>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50 shadow-xs"
                >
                  {submitting ? 'Saving...' : autoPost ? 'Save & Post Payment' : 'Save as Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW PAYMENT DETAILS MODAL */}
      {viewVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Payment Voucher: {viewVoucher.paymentNumber}</h3>
                  <p className="text-xs text-slate-500">Official vendor payment disbursement voucher & ledger record</p>
                </div>
              </div>
              <button
                onClick={() => setViewVoucher(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Slip Header Box */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 block">Supplier</span>
                  <span className="font-bold text-slate-900 text-sm">{viewVoucher.partyName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Payment Date</span>
                  <span className="font-semibold text-slate-900">
                    {new Date(viewVoucher.paymentDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Payment Mode</span>
                  <span className="font-semibold text-slate-900">{viewVoucher.paymentMode.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Status</span>
                  <span className="font-bold text-blue-600">{viewVoucher.status}</span>
                </div>
              </div>

              {/* Monetary Details */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-blue-50/50 border border-blue-100">
                <div>
                  <span className="text-xs text-blue-800 uppercase font-semibold">Total Disbursed</span>
                  <div className="text-2xl font-black text-blue-700">
                    ₹{parseFloat(String(viewVoucher.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-emerald-800 uppercase font-semibold">Unallocated Advance</span>
                  <div className="text-2xl font-black text-emerald-600">
                    ₹{parseFloat(String(viewVoucher.unallocatedAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Reference & Banking Details */}
              {(viewVoucher.referenceNumber || viewVoucher.bankName || viewVoucher.chequeNumber) && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                  <div className="font-bold text-slate-700 uppercase tracking-wider">Banking & Transaction Details</div>
                  {viewVoucher.referenceNumber && <div><span className="text-slate-400">Reference / UTR:</span> <span className="font-mono font-semibold">{viewVoucher.referenceNumber}</span></div>}
                  {viewVoucher.bankName && <div><span className="text-slate-400">Bank:</span> <span className="font-semibold">{viewVoucher.bankName}</span></div>}
                  {viewVoucher.chequeNumber && <div><span className="text-slate-400">Cheque #:</span> <span className="font-mono font-semibold">{viewVoucher.chequeNumber}</span> (Date: {viewVoucher.chequeDate})</div>}
                </div>
              )}

              {/* Invoices Settled Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Settled Purchase Bills</h4>
                {viewVoucher.allocations && viewVoucher.allocations.length > 0 ? (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-100 text-slate-700 font-semibold">
                        <tr>
                          <th className="px-3 py-2">Bill #</th>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2 text-right">Bill Total</th>
                          <th className="px-3 py-2 text-right">Allocated Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {viewVoucher.allocations.map(alloc => (
                          <tr key={alloc.id || alloc.documentId}>
                            <td className="px-3 py-2 font-mono font-medium text-slate-900">{alloc.documentNumber || 'Purchase Invoice'}</td>
                            <td className="px-3 py-2">{alloc.invoiceDate ? new Date(alloc.invoiceDate).toLocaleDateString('en-IN') : '-'}</td>
                            <td className="px-3 py-2 text-right">₹{alloc.grandTotal ? alloc.grandTotal.toFixed(2) : '-'}</td>
                            <td className="px-3 py-2 text-right font-bold text-blue-600">
                              ₹{parseFloat(String(alloc.allocatedAmount)).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                    No individual purchase bills were allocated. Full payment is held as an outgoing advance with the supplier.
                  </div>
                )}
              </div>

              {/* Cancellation Reason if Cancelled */}
              {viewVoucher.status === 'CANCELLED' && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  <span className="font-bold">Cancellation Reason: </span>
                  {viewVoucher.cancellationReason || 'Reversed by user'}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Print Payment Slip
                </button>

                <div className="flex items-center gap-2">
                  {viewVoucher.status === 'DRAFT' && (
                    <button
                      type="button"
                      onClick={() => handlePostVoucher(viewVoucher.id)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
                    >
                      Post to Ledger
                    </button>
                  )}
                  {viewVoucher.status === 'POSTED' && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelModalVoucher(viewVoucher);
                        setCancelReason('');
                      }}
                      className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Cancel Voucher
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setViewVoucher(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL CONFIRMATION MODAL */}
      {cancelModalVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Cancel Payment Voucher</h3>
                <p className="text-xs text-slate-500">Reverse payment #{cancelModalVoucher.paymentNumber} from supplier ledger</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Cancelling this voucher will reverse the ₹{parseFloat(String(cancelModalVoucher.amount)).toFixed(2)} debit from the supplier ledger and restore outstanding balances on any settled purchase bills.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Reason for Cancellation</label>
              <textarea
                rows={2}
                placeholder="e.g. Stopped cheque, duplicate entry..."
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCancelModalVoucher(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Go Back
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleConfirmCancel}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Confirm Reversal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
