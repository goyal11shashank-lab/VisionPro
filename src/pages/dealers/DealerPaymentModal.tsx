import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  IndianRupee,
  Calendar,
  CreditCard,
  Building2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';

interface DealerPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: any) => void;
  initialAmount?: number;
}

export const DealerPaymentModal: React.FC<DealerPaymentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialAmount,
}) => {
  // Loading & Data States
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parent & Invoice Data
  const [mainWarehouse, setMainWarehouse] = useState<any | null>(null);
  const [totalOutstanding, setTotalOutstanding] = useState<number>(0);
  const [pendingVerificationAmount, setPendingVerificationAmount] = useState<number>(0);
  const [invoices, setInvoices] = useState<any[]>([]);

  // Payment Form State
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState<'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CASH' | 'OTHER'>('BANK_TRANSFER');
  const [amount, setAmount] = useState<string>(initialAmount ? initialAmount.toString() : '');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [bankName, setBankName] = useState<string>('');
  const [chequeNumber, setChequeNumber] = useState<string>('');
  const [chequeDate, setChequeDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Row Allocations: map of purchaseInvoiceId -> allocatedAmount
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  // Duplicate Check
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  // Fetch unpaid invoices and current balances
  const fetchUnpaidInvoices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{
        success: boolean;
        mainWarehouse: any;
        totalOutstanding: number;
        pendingVerificationAmount: number;
        invoices: any[];
      }>('/api/dealer/payments/unpaid-invoices');

      if (res.success) {
        setMainWarehouse(res.mainWarehouse);
        setTotalOutstanding(res.totalOutstanding || 0);
        setPendingVerificationAmount(res.pendingVerificationAmount || 0);
        setInvoices(res.invoices || []);

        // If no amount set yet, default to total outstanding
        if (!initialAmount && res.totalOutstanding > 0) {
          setAmount(res.totalOutstanding.toString());
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load unpaid invoices');
    } finally {
      setLoading(false);
    }
  }, [initialAmount]);

  useEffect(() => {
    if (isOpen) {
      fetchUnpaidInvoices();
    }
  }, [isOpen, fetchUnpaidInvoices]);

  // Check duplicate when referenceNumber or amount changes
  const runDuplicateCheck = useCallback(async (ref: string, amtStr: string) => {
    const amtNum = parseFloat(amtStr);
    if (!ref || ref.trim().length < 3 || !amtNum || amtNum <= 0) {
      setDuplicateWarning(null);
      return;
    }
    try {
      setCheckingDuplicate(true);
      const res = await apiRequest<{
        success: boolean;
        possibleDuplicate: boolean;
        matchedAdvice?: any;
      }>('/api/dealer/payments/check-duplicate', {
        method: 'POST',
        body: JSON.stringify({
          amount: amtNum,
          referenceNumber: ref.trim(),
          paymentDate,
        }),
      });

      if (res.possibleDuplicate && res.matchedAdvice) {
        setDuplicateWarning(
          `Notice: An advice #${res.matchedAdvice.adviceNumber} with Ref "${res.matchedAdvice.referenceNumber}" (₹${res.matchedAdvice.amount}) is already in status '${res.matchedAdvice.status}'. Please confirm you are not submitting a duplicate payment.`
        );
      } else {
        setDuplicateWarning(null);
      }
    } catch (e) {
      // Ignore duplicate check error
    } finally {
      setCheckingDuplicate(false);
    }
  }, [paymentDate]);

  // Derived calculations
  const parsedAmount = Math.max(0, parseFloat(amount) || 0);
  const totalAllocated: number = (Object.values(allocations) as number[]).reduce((sum: number, val: number) => sum + (Number(val) || 0), 0);
  const unallocatedAmount: number = Math.max(0, Math.round((parsedAmount - totalAllocated) * 100) / 100);
  const isOverAllocated: boolean = totalAllocated > parsedAmount + 0.01;

  // Auto-allocate FIFO
  const handleAutoAllocateFIFO = () => {
    let remainingToAllocate = parsedAmount;
    const newAllocations: Record<string, number> = {};

    // Invoices are already sorted oldest first by the server
    for (const inv of invoices) {
      if (remainingToAllocate <= 0) break;
      const invBal = inv.outstandingAmount || 0;
      const alloc = Math.min(remainingToAllocate, invBal);
      if (alloc > 0) {
        newAllocations[inv.id] = Math.round(alloc * 100) / 100;
        remainingToAllocate = Math.round((remainingToAllocate - alloc) * 100) / 100;
      }
    }

    setAllocations(newAllocations);
  };

  // Allocate full balance of all invoices
  const handleAllocateAllInvoices = () => {
    let sum = 0;
    const newAllocations: Record<string, number> = {};
    for (const inv of invoices) {
      const bal = inv.outstandingAmount || 0;
      if (bal > 0) {
        newAllocations[inv.id] = bal;
        sum = Math.round((sum + bal) * 100) / 100;
      }
    }
    setAllocations(newAllocations);
    setAmount(sum.toString());
  };

  // Clear allocations
  const handleClearAllocations = () => {
    setAllocations({});
  };

  // Set row allocation manually
  const handleSetRowAllocation = (invId: string, maxBal: number, valueStr: string) => {
    const val = parseFloat(valueStr);
    if (isNaN(val) || val <= 0) {
      const next = { ...allocations };
      delete next[invId];
      setAllocations(next);
      return;
    }
    const safeVal = Math.min(val, maxBal);
    setAllocations({
      ...allocations,
      [invId]: Math.round(safeVal * 100) / 100,
    });
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedAmount <= 0) {
      setError('Payment amount must be greater than zero.');
      return;
    }
    if (isOverAllocated) {
      setError(`Allocated amount (₹${totalAllocated.toFixed(2)}) exceeds payment amount (₹${parsedAmount.toFixed(2)}).`);
      return;
    }
    if ((paymentMode === 'BANK_TRANSFER' || paymentMode === 'UPI') && !referenceNumber.trim()) {
      setError('Reference / UTR / Transaction ID is required for Bank Transfer and UPI payments.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Build allocations array
      const mappedAllocations = (Object.entries(allocations) as [string, number][])
        .filter(([_, amt]) => Number(amt) > 0)
        .map(([dealerPurchaseInvoiceId, allocatedAmount]) => ({
          dealerPurchaseInvoiceId,
          allocatedAmount: Number(allocatedAmount),
        }));

      const payload = {
        paymentDate,
        paymentMode,
        amount: parsedAmount,
        referenceNumber: referenceNumber.trim() || undefined,
        bankName: bankName.trim() || undefined,
        chequeNumber: chequeNumber.trim() || undefined,
        chequeDate: chequeDate || undefined,
        notes: notes.trim() || undefined,
        allocations: mappedAllocations,
      };

      const res = await apiRequest<{
        success: boolean;
        message: string;
        adviceNumber: string;
        dealerPaymentNumber: string;
        adviceId: string;
      }>('/api/dealer/payments/advices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.success) {
        onSuccess(res);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit payment advice.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 rounded-xl text-blue-400 border border-blue-400/20">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Record Payment to Main Warehouse</h2>
              <p className="text-xs text-slate-300">
                Post Supplier Payment & submit Payment Advice to Main Warehouse
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Action Failed</p>
                <p className="text-xs mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {duplicateWarning && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <p className="font-semibold text-xs uppercase tracking-wider text-amber-700">Possible Duplicate</p>
                <p className="text-xs mt-0.5">{duplicateWarning}</p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-slate-400">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium">Fetching Main Warehouse account & outstanding invoices...</p>
            </div>
          ) : (
            <form id="dealer-payment-form" onSubmit={handleSubmit} className="space-y-6">
              {/* Account Summary Strip */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Supplier / Main Warehouse
                  </span>
                  <div className="mt-1 font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    {mainWarehouse?.name || 'Main Warehouse'}
                  </div>
                  {mainWarehouse?.gstin && (
                    <span className="text-xs text-slate-500 font-mono">GSTIN: {mainWarehouse.gstin}</span>
                  )}
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Current Book Balance
                  </span>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    ₹{Number(totalOutstanding).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[11px] text-slate-500">From Dealer Supplier Ledger</span>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Awaiting Verification
                  </span>
                  <div className="mt-1 text-lg font-bold text-amber-600">
                    ₹{Number(pendingVerificationAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[11px] text-slate-500">Previously submitted advices</span>
                </div>
              </div>

              {/* Payment Details Form */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                    <IndianRupee className="w-4 h-4 text-blue-600" />
                    Payment Details
                  </h3>
                  <span className="text-[11px] text-slate-400">All amounts in INR (₹)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {/* Amount */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Payment Amount (₹) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          runDuplicateCheck(referenceNumber, e.target.value);
                        }}
                        placeholder="0.00"
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Payment Date */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Payment Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* Payment Mode */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Payment Mode <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as any)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS / IMPS)</option>
                      <option value="UPI">UPI / QR Code</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CASH">Cash</option>
                      <option value="OTHER">Other / Counter Deposit</option>
                    </select>
                  </div>

                  {/* Reference / UTR Number */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Reference / UTR / Transaction ID
                      {(paymentMode === 'BANK_TRANSFER' || paymentMode === 'UPI') && (
                        <span className="text-rose-500">*</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={referenceNumber}
                      onChange={(e) => {
                        setReferenceNumber(e.target.value);
                      }}
                      onBlur={(e) => runDuplicateCheck(e.target.value, amount)}
                      placeholder="e.g. UTR12345678 or UPI-TXN-99"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* Bank Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Remitting Bank Name
                    </label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="e.g. HDFC Bank, SBI"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* Cheque Details if CHEQUE */}
                  {paymentMode === 'CHEQUE' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Cheque Number <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={chequeNumber}
                          onChange={(e) => setChequeNumber(e.target.value)}
                          placeholder="e.g. 000123"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Cheque Date
                        </label>
                        <input
                          type="date"
                          value={chequeDate}
                          onChange={(e) => setChequeDate(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </>
                  )}

                  {/* Notes */}
                  <div className={paymentMode === 'CHEQUE' ? 'col-span-full' : 'sm:col-span-2 md:col-span-3'}>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Remarks / Notes for Main Warehouse Accounts
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Payment for Order #ORD-1002 and bulk invoice batch"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Invoice Allocation Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      Allocate Against Outstanding Purchase Invoices
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Select how this payment should be applied across your Main-issued invoices.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAutoAllocateFIFO}
                      disabled={parsedAmount <= 0}
                      className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      Auto-Allocate FIFO
                    </button>
                    <button
                      type="button"
                      onClick={handleAllocateAllInvoices}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition-colors"
                    >
                      Allocate All Invoices
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAllocations}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-500 border border-slate-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {invoices.length === 0 ? (
                  <div className="p-8 text-center text-slate-400">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-700">No Outstanding Invoices</p>
                    <p className="text-xs text-slate-500 mt-1">
                      All purchase invoices from Main Warehouse are fully paid. Any payment entered will be recorded as an On-Account Advance.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                          <th className="py-2.5 px-3">Purchase Invoice #</th>
                          <th className="py-2.5 px-3">Invoice Date</th>
                          <th className="py-2.5 px-3">Main Invoice Ref</th>
                          <th className="py-2.5 px-3 text-right">Total (₹)</th>
                          <th className="py-2.5 px-3 text-right">Outstanding (₹)</th>
                          <th className="py-2.5 px-3 text-right w-44">Allocated (₹)</th>
                          <th className="py-2.5 px-3 text-center w-20">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {invoices.map((inv) => {
                          const isOverdue = inv.daysOverdue > 0;
                          const currentAlloc = allocations[inv.id] || 0;

                          return (
                            <tr
                              key={inv.id}
                              className={`hover:bg-slate-50/80 transition-colors ${
                                currentAlloc > 0 ? 'bg-blue-50/40' : ''
                              }`}
                            >
                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                {inv.invoiceNumber}
                                {isOverdue && (
                                  <span className="ml-1.5 px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded">
                                    {inv.daysOverdue}d overdue
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {new Date(inv.invoiceDate).toLocaleDateString('en-IN')}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-500">
                                {inv.mainSalesInvoiceNumber || inv.supplierInvoiceNumber || '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-700 font-medium">
                                ₹{Number(inv.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                                ₹{Number(inv.outstandingAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1.5 text-slate-400 font-semibold text-xs">₹</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={inv.outstandingAmount}
                                    value={currentAlloc > 0 ? currentAlloc : ''}
                                    onChange={(e) =>
                                      handleSetRowAllocation(inv.id, inv.outstandingAmount, e.target.value)
                                    }
                                    placeholder="0.00"
                                    className="w-full pl-6 pr-2 py-1 text-right border border-slate-300 rounded font-semibold text-slate-900 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  />
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSetRowAllocation(
                                      inv.id,
                                      inv.outstandingAmount,
                                      inv.outstandingAmount.toString()
                                    )
                                  }
                                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
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

                {/* Allocation Summary Bar */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="flex items-center justify-between sm:justify-start gap-2">
                    <span className="text-slate-500 font-medium">Total Payment:</span>
                    <span className="font-bold text-slate-900">
                      ₹{parsedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex items-center justify-between sm:justify-start gap-2">
                    <span className="text-slate-500 font-medium">Total Allocated to Invoices:</span>
                    <span className={`font-bold ${isOverAllocated ? 'text-rose-600' : 'text-blue-600'}`}>
                      ₹{totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex items-center justify-between sm:justify-start gap-2">
                    <span className="text-slate-500 font-medium">Unallocated (On-Account Advance):</span>
                    <span className="font-bold text-emerald-600">
                      ₹{unallocatedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Informational Guidance Notice */}
              <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3.5 text-xs text-blue-900 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-blue-950">How this payment is processed:</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-blue-800 text-[11px]">
                    <li>
                      <strong>Authoritative Local Posting:</strong> A Supplier Payment voucher is immediately posted in your Dealer books, updating your Purchase Invoice balances and Supplier Ledger.
                    </li>
                    <li>
                      <strong>Payment Advice to Main Warehouse:</strong> A cross-business Payment Advice is dispatched with status <span className="font-semibold">SUBMITTED</span>.
                    </li>
                    <li>
                      <strong>Reconciliation & Receipt:</strong> When Main Warehouse verifies your bank credit, an official Customer Receipt will be posted in Main's books and linked to this voucher.
                    </li>
                  </ul>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>

          <button
            type="submit"
            form="dealer-payment-form"
            disabled={submitting || parsedAmount <= 0 || isOverAllocated || loading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 flex items-center gap-2 transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Submitting Payment Advice...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Record Payment & Submit Advice (₹{parsedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
