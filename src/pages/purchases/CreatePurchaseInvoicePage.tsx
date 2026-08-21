import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Building2,
  Plus,
  Trash2,
  Barcode,
  Search,
  CheckCircle2,
  XCircle,
  Save,
  Send,
  Layers,
  ArrowLeft,
  RefreshCw,
  Percent,
  Sparkles,
  Eye,
  Info,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Party, UniqueItem, OpticalBatch } from '../../types/index.js';

interface BatchRowState {
  batchId?: string;
  sph: number;
  cyl: number;
  axis: number;
  add: number;
  side: 'NONE' | 'R' | 'L' | 'BE';
  quantity: number;
  rate: number;
}

interface LineItemState {
  uniqueItemId: string;
  uniqueItemName: string;
  uniqueItemCode: string;
  categoryCode?: string;
  quantity: number;
  rate: number;
  discountType: 'PERCENTAGE' | 'FIXED' | 'NONE';
  discountValue: number;
  gstRate: number;
  batches: BatchRowState[];
  isBatchesOpen?: boolean;
}

export const CreatePurchaseInvoicePage: React.FC<{
  onBack: () => void;
  onSuccess: (invoiceId: string) => void;
}> = ({ onBack, onSuccess }) => {
  // Master Data
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [uniqueItemsList, setUniqueItemsList] = useState<UniqueItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);

  // Form State
  const [supplierPartyId, setSupplierPartyId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState<string>('');
  const [gstMode, setGstMode] = useState<'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT'>('INTRA_STATE');
  const [notes, setNotes] = useState<string>('');

  // Lines
  const [lines, setLines] = useState<LineItemState[]>([]);

  // Barcode Scanner Quick Entry
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [barcodeLoading, setBarcodeLoading] = useState<boolean>(false);
  const [barcodeMsg, setBarcodeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load suppliers and unique items
  useEffect(() => {
    const loadData = async () => {
      setLoadingInitial(true);
      try {
        const [supData, itemData] = await Promise.all([
          apiRequest<{ parties: Party[] }>('/api/parties?partyType=SUPPLIER&limit=100'),
          apiRequest<UniqueItem[]>('/api/unique-items'),
        ]);

        const allSuppliers = supData.parties || [];
        setSuppliers(allSuppliers);
        if (allSuppliers.length > 0) {
          setSupplierPartyId(allSuppliers[0].id);
        }

        setUniqueItemsList(itemData || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load master items for purchase form');
      } finally {
        setLoadingInitial(false);
      }
    };
    loadData();
  }, []);

  // Auto-detect GST mode from supplier state if available
  const handleSupplierChange = (supId: string) => {
    setSupplierPartyId(supId);
    const sup = suppliers.find(s => s.id === supId);
    if (sup?.state) {
      // If supplier state is different from business (default Karnataka), prompt or set INTER_STATE
      if (sup.state.toLowerCase() !== 'karnataka') {
        setGstMode('INTER_STATE');
      } else {
        setGstMode('INTRA_STATE');
      }
    }
  };

  // Add line item
  const handleAddLine = () => {
    if (uniqueItemsList.length === 0) return;
    const first = uniqueItemsList[0];
    const defaultRate = Number(first.lastPurchasePrice || first.purchaseRate || 0);

    const newLine: LineItemState = {
      uniqueItemId: first.id,
      uniqueItemName: first.name,
      uniqueItemCode: first.code,
      categoryCode: first.categoryCode,
      quantity: 1,
      rate: defaultRate,
      discountType: 'NONE',
      discountValue: 0,
      gstRate: 12,
      batches: [
        {
          sph: 0,
          cyl: 0,
          axis: 0,
          add: 0,
          side: 'NONE',
          quantity: 1,
          rate: defaultRate,
        },
      ],
      isBatchesOpen: false,
    };
    setLines([...lines, newLine]);
  };

  const handleRemoveLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleLineItemChange = (idx: number, uItemId: string) => {
    const selected = uniqueItemsList.find(u => u.id === uItemId);
    if (!selected) return;

    const rate = Number(selected.lastPurchasePrice || selected.purchaseRate || 0);
    const updated = [...lines];
    updated[idx] = {
      ...updated[idx],
      uniqueItemId: selected.id,
      uniqueItemName: selected.name,
      uniqueItemCode: selected.code,
      categoryCode: selected.categoryCode,
      rate,
      batches: updated[idx].batches.map(b => ({ ...b, rate })),
    };
    setLines(updated);
  };

  const handleQuantityChange = (idx: number, qty: number) => {
    const updated = [...lines];
    updated[idx].quantity = qty;
    // Adjust single batch if only 1 batch exists
    if (updated[idx].batches.length === 1) {
      updated[idx].batches[0].quantity = qty;
    }
    setLines(updated);
  };

  // Batch allocations for line
  const handleAddBatchToLine = (lineIdx: number) => {
    const updated = [...lines];
    const curLine = updated[lineIdx];
    curLine.batches.push({
      sph: 0,
      cyl: 0,
      axis: 0,
      add: 0,
      side: 'NONE',
      quantity: 1,
      rate: curLine.rate,
    });
    setLines(updated);
  };

  const handleRemoveBatchFromLine = (lineIdx: number, batchIdx: number) => {
    const updated = [...lines];
    updated[lineIdx].batches = updated[lineIdx].batches.filter((_, i) => i !== batchIdx);
    setLines(updated);
  };

  // Barcode Lookup for Fast Scanning Entry
  const handleBarcodeScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    setBarcodeLoading(true);
    setBarcodeMsg(null);
    try {
      const data = await apiRequest<{ batch: OpticalBatch; uniqueItem: UniqueItem }>(
        `/api/purchases/barcode-lookup/${encodeURIComponent(barcodeInput.trim())}`
      );

      const batch = data.batch;
      const uItem = data.uniqueItem;

      // Find if this unique item is already in lines
      const existingLineIdx = lines.findIndex(l => l.uniqueItemId === uItem.id);

      if (existingLineIdx >= 0) {
        // Add or increment batch in existing line
        const updated = [...lines];
        const line = updated[existingLineIdx];
        const existingBatchIdx = line.batches.findIndex(b => b.batchId === batch.id);

        if (existingBatchIdx >= 0) {
          line.batches[existingBatchIdx].quantity += 1;
        } else {
          line.batches.push({
            batchId: batch.id,
            sph: Number(batch.sph),
            cyl: Number(batch.cyl),
            axis: Number(batch.axis),
            add: Number(batch.add),
            side: batch.side,
            quantity: 1,
            rate: line.rate,
          });
        }
        line.quantity = line.batches.reduce((sum, b) => sum + b.quantity, 0);
        setLines(updated);
      } else {
        // Create new line with this batch
        const defaultRate = Number(uItem.lastPurchasePrice || uItem.purchaseRate || 0);
        const newLine: LineItemState = {
          uniqueItemId: uItem.id,
          uniqueItemName: uItem.name,
          uniqueItemCode: uItem.code,
          categoryCode: uItem.categoryCode,
          quantity: 1,
          rate: defaultRate,
          discountType: 'NONE',
          discountValue: 0,
          gstRate: 12,
          batches: [
            {
              batchId: batch.id,
              sph: Number(batch.sph),
              cyl: Number(batch.cyl),
              axis: Number(batch.axis),
              add: Number(batch.add),
              side: batch.side,
              quantity: 1,
              rate: defaultRate,
            },
          ],
          isBatchesOpen: true,
        };
        setLines([...lines, newLine]);
      }

      setBarcodeMsg({
        type: 'success',
        text: `Matched: ${uItem.name} [SPH ${batch.sph} CYL ${batch.cyl}]`,
      });
      setBarcodeInput('');
    } catch (err: any) {
      setBarcodeMsg({
        type: 'error',
        text: err.message || 'Barcode not found or invalid',
      });
    } finally {
      setBarcodeLoading(false);
    }
  };

  // Live Tax Calculations
  const calculateTotals = () => {
    let subtotal = 0;
    let discountTotal = 0;
    let taxableAmount = 0;
    let totalGst = 0;

    for (const line of lines) {
      const gross = line.quantity * line.rate;
      let disc = 0;
      if (line.discountType === 'PERCENTAGE') {
        disc = (gross * (line.discountValue || 0)) / 100;
      } else if (line.discountType === 'FIXED') {
        disc = line.discountValue || 0;
      }
      disc = Math.min(disc, gross);
      const taxable = Math.max(0, gross - disc);
      const gst = (taxable * (line.gstRate || 0)) / 100;

      subtotal += gross;
      discountTotal += disc;
      taxableAmount += taxable;
      totalGst += gst;
    }

    const netBeforeRounding = taxableAmount + totalGst;
    const roundedTotal = Math.round(netBeforeRounding);
    const roundOff = roundedTotal - netBeforeRounding;

    const cgstAmount = gstMode === 'INTRA_STATE' ? totalGst / 2 : 0;
    const sgstAmount = gstMode === 'INTRA_STATE' ? totalGst / 2 : 0;
    const igstAmount = gstMode === 'INTER_STATE' ? totalGst : 0;

    return {
      subtotal,
      discountTotal,
      taxableAmount,
      totalGst,
      cgstAmount,
      sgstAmount,
      igstAmount,
      roundOff,
      grandTotal: roundedTotal,
    };
  };

  const totals = calculateTotals();

  // Save / Post Invoice
  const handleSaveInvoice = async (andPost: boolean = false) => {
    if (!supplierPartyId) {
      setError('Please select a supplier');
      return;
    }
    if (lines.length === 0) {
      setError('Invoice must contain at least 1 line item');
      return;
    }

    // Validate batch sums
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.batches.length > 0) {
        const sumBatches = line.batches.reduce((sum, b) => sum + Number(b.quantity), 0);
        if (Math.abs(sumBatches - line.quantity) > 0.001) {
          setError(`Line ${i + 1} (${line.uniqueItemName}): Sum of batch quantities (${sumBatches}) must equal line quantity (${line.quantity})`);
          return;
        }
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        supplierPartyId,
        invoiceDate: new Date(invoiceDate),
        supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
        supplierInvoiceDate: supplierInvoiceDate ? new Date(supplierInvoiceDate) : undefined,
        gstMode,
        notes: notes.trim() || undefined,
        lines: lines.map(l => ({
          uniqueItemId: l.uniqueItemId,
          quantity: l.quantity,
          rate: l.rate,
          discountType: l.discountType,
          discountValue: l.discountValue,
          gstRate: l.gstRate,
          batches: l.batches.map(b => ({
            batchId: b.batchId,
            sph: b.sph,
            cyl: b.cyl,
            axis: b.axis,
            add: b.add,
            side: b.side,
            quantity: b.quantity,
            rate: b.rate,
          })),
        })),
      };

      const created = await apiRequest<{ id: string; invoiceNumber: string }>('/api/purchases/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (andPost) {
        await apiRequest(`/api/purchases/invoices/${created.id}/post`, {
          method: 'POST',
        });
      }

      onSuccess(created.id);
    } catch (err: any) {
      setError(err.message || 'Failed to save purchase invoice');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingInitial) {
    return (
      <div className="h-96 flex flex-col items-center justify-center gap-3 text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin text-purple-600" />
        <span className="text-sm font-medium">Loading procurement items and supplier directory...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto" id="create-purchase-page-root">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">New Purchase Invoice</h1>
            <p className="text-xs text-slate-500">
              Procure ophthalmic lenses, frames, and batches with automated GST reconciliation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleSaveInvoice(false)}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors shadow-xs"
          >
            <Save className="w-4 h-4 text-slate-500" />
            <span>Save as Draft</span>
          </button>
          <button
            type="button"
            onClick={() => handleSaveInvoice(true)}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors shadow-xs"
          >
            <Send className="w-4 h-4" />
            <span>Save & Post Inward</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2.5">
          <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Invoice Details Header Form */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Invoice Header & Supplier</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {/* Supplier */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Supplier / Vendor <span className="text-rose-500">*</span>
            </label>
            <select
              value={supplierPartyId}
              onChange={e => handleSupplierChange(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
            >
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.partyCode}) {s.city ? `— ${s.city}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Invoice Date */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Invoice Date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
            />
          </div>

          {/* GST Mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">GST Tax Mode</label>
            <select
              value={gstMode}
              onChange={e => setGstMode(e.target.value as any)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
            >
              <option value="INTRA_STATE">Intra-State (CGST + SGST)</option>
              <option value="INTER_STATE">Inter-State (IGST)</option>
              <option value="EXEMPT">Exempt / Nil-Rated</option>
            </select>
          </div>

          {/* Supplier Bill # */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Supplier Bill Number</label>
            <input
              type="text"
              placeholder="e.g. INV/2026/089"
              value={supplierInvoiceNumber}
              onChange={e => setSupplierInvoiceNumber(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
            />
          </div>

          {/* Supplier Bill Date */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Supplier Bill Date</label>
            <input
              type="date"
              value={supplierInvoiceDate}
              onChange={e => setSupplierInvoiceDate(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
            />
          </div>

          {/* Notes */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Remarks / Inward Gate Pass</label>
            <input
              type="text"
              placeholder="e.g. Monthly replenishment from Carl Zeiss warehouse"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-600"
            />
          </div>
        </div>
      </div>

      {/* Barcode Quick Scanner Box */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 p-4 rounded-2xl text-white shadow-xs">
        <form onSubmit={handleBarcodeScan} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-2 text-purple-200 text-xs font-semibold uppercase tracking-wider shrink-0">
            <Barcode className="w-5 h-5 text-purple-300" />
            <span>Barcode Quick Inward:</span>
          </div>
          <div className="relative flex-1 w-full">
            <input
              type="text"
              placeholder="Scan lens packet permanent barcode (e.g. OPT-SV-CR39-01)..."
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              className="w-full px-4 py-2 text-xs rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-purple-300 focus:outline-hidden focus:ring-2 focus:ring-purple-400"
            />
          </div>
          <button
            type="submit"
            disabled={barcodeLoading}
            className="px-4 py-2 bg-purple-500 hover:bg-purple-400 text-white text-xs font-bold rounded-xl transition-colors shrink-0"
          >
            {barcodeLoading ? 'Looking up...' : 'Add Scanned Item'}
          </button>
        </form>
        {barcodeMsg && (
          <div className={`mt-2 text-xs flex items-center gap-1.5 ${barcodeMsg.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
            {barcodeMsg.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            <span>{barcodeMsg.text}</span>
          </div>
        )}
      </div>

      {/* Line Items Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-bold text-slate-900">Purchase Line Items & Batch Matrix</h3>
          </div>
          <button
            type="button"
            id="btn-add-purchase-line"
            onClick={handleAddLine}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 text-xs font-bold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Item Row</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold uppercase border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3 min-w-[220px]">Unique Item Master</th>
                <th className="px-3 py-3 w-24">Qty (Prs)</th>
                <th className="px-3 py-3 w-28">Rate (₹)</th>
                <th className="px-3 py-3 w-32">Discount</th>
                <th className="px-3 py-3 w-24">GST %</th>
                <th className="px-3 py-3 text-right">Taxable (₹)</th>
                <th className="px-3 py-3 text-right">Total (₹)</th>
                <th className="px-4 py-3 text-center">Batch Powers</th>
                <th className="px-3 py-3 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FileSpreadsheet className="w-8 h-8 text-slate-300" />
                      <span className="font-semibold text-slate-600">No items added to invoice</span>
                      <p className="text-xs text-slate-400">Click "+ Add Item Row" or scan barcode above.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                lines.map((line, idx) => {
                  const gross = line.quantity * line.rate;
                  let disc = 0;
                  if (line.discountType === 'PERCENTAGE') {
                    disc = (gross * (line.discountValue || 0)) / 100;
                  } else if (line.discountType === 'FIXED') {
                    disc = line.discountValue || 0;
                  }
                  disc = Math.min(disc, gross);
                  const taxable = Math.max(0, gross - disc);
                  const gst = (taxable * (line.gstRate || 0)) / 100;
                  const lineTotal = taxable + gst;

                  return (
                    <React.Fragment key={idx}>
                      <tr className="hover:bg-slate-50/50 bg-white">
                        <td className="px-4 py-3 font-semibold text-slate-400">{idx + 1}</td>

                        {/* Item Select */}
                        <td className="px-4 py-3">
                          <select
                            value={line.uniqueItemId}
                            onChange={e => handleLineItemChange(idx, e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white"
                          >
                            {uniqueItemsList.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.name} ({u.code})
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Quantity */}
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={line.quantity}
                            onChange={e => handleQuantityChange(idx, Math.max(1, parseFloat(e.target.value) || 1))}
                            className="w-full px-2 py-1.5 text-xs font-semibold text-center bg-slate-50 border border-slate-200 rounded-lg"
                          />
                        </td>

                        {/* Rate */}
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.rate}
                            onChange={e => {
                              const updated = [...lines];
                              updated[idx].rate = parseFloat(e.target.value) || 0;
                              setLines(updated);
                            }}
                            className="w-full px-2 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                          />
                        </td>

                        {/* Discount */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <select
                              value={line.discountType}
                              onChange={e => {
                                const updated = [...lines];
                                updated[idx].discountType = e.target.value as any;
                                setLines(updated);
                              }}
                              className="px-1.5 py-1.5 text-[11px] bg-slate-50 border border-slate-200 rounded-lg"
                            >
                              <option value="NONE">None</option>
                              <option value="PERCENTAGE">%</option>
                              <option value="FIXED">₹</option>
                            </select>
                            {line.discountType !== 'NONE' && (
                              <input
                                type="number"
                                min="0"
                                value={line.discountValue}
                                onChange={e => {
                                  const updated = [...lines];
                                  updated[idx].discountValue = parseFloat(e.target.value) || 0;
                                  setLines(updated);
                                }}
                                className="w-16 px-1.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                              />
                            )}
                          </div>
                        </td>

                        {/* GST % */}
                        <td className="px-3 py-3">
                          <select
                            value={line.gstRate}
                            onChange={e => {
                              const updated = [...lines];
                              updated[idx].gstRate = parseFloat(e.target.value) || 0;
                              setLines(updated);
                            }}
                            className="w-full px-2 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                          >
                            <option value="0">0%</option>
                            <option value="5">5%</option>
                            <option value="12">12%</option>
                            <option value="18">18%</option>
                            <option value="28">28%</option>
                          </select>
                        </td>

                        {/* Taxable */}
                        <td className="px-3 py-3 text-right font-mono text-slate-700">
                          ₹{taxable.toFixed(2)}
                        </td>

                        {/* Line Total */}
                        <td className="px-3 py-3 text-right font-mono font-bold text-purple-700">
                          ₹{lineTotal.toFixed(2)}
                        </td>

                        {/* Batch Powers Toggle */}
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...lines];
                              updated[idx].isBatchesOpen = !updated[idx].isBatchesOpen;
                              setLines(updated);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 mx-auto ${
                              line.batches.length > 0
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <span>Powers ({line.batches.length})</span>
                          </button>
                        </td>

                        {/* Delete Row */}
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(idx)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Optical Power Matrix for this line */}
                      {line.isBatchesOpen && (
                        <tr className="bg-purple-50/20">
                          <td colSpan={10} className="p-4">
                            <div className="p-4 rounded-xl bg-white border border-purple-100 space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="text-xs font-bold text-slate-900">
                                    Optical Power Allocations for {line.uniqueItemName}
                                  </span>
                                  <span className="text-xs text-slate-400 block">
                                    Total line quantity: {line.quantity} prs • Allocated:{' '}
                                    {line.batches.reduce((sum, b) => sum + Number(b.quantity), 0)} prs
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleAddBatchToLine(idx)}
                                  className="px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold flex items-center gap-1"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Add Power Row</span>
                                </button>
                              </div>

                              <div className="space-y-2">
                                {line.batches.map((batch, bIdx) => (
                                  <div key={bIdx} className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-center text-xs">
                                    <div>
                                      <label className="text-[10px] text-slate-400 block">SPH</label>
                                      <input
                                        type="number"
                                        step="0.25"
                                        value={batch.sph}
                                        onChange={e => {
                                          const updated = [...lines];
                                          updated[idx].batches[bIdx].sph = parseFloat(e.target.value) || 0;
                                          setLines(updated);
                                        }}
                                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-slate-400 block">CYL</label>
                                      <input
                                        type="number"
                                        step="0.25"
                                        value={batch.cyl}
                                        onChange={e => {
                                          const updated = [...lines];
                                          updated[idx].batches[bIdx].cyl = parseFloat(e.target.value) || 0;
                                          setLines(updated);
                                        }}
                                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-slate-400 block">AXIS</label>
                                      <input
                                        type="number"
                                        min="0"
                                        max="180"
                                        value={batch.axis}
                                        onChange={e => {
                                          const updated = [...lines];
                                          updated[idx].batches[bIdx].axis = parseInt(e.target.value, 10) || 0;
                                          setLines(updated);
                                        }}
                                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-slate-400 block">ADD</label>
                                      <input
                                        type="number"
                                        step="0.25"
                                        value={batch.add}
                                        onChange={e => {
                                          const updated = [...lines];
                                          updated[idx].batches[bIdx].add = parseFloat(e.target.value) || 0;
                                          setLines(updated);
                                        }}
                                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-slate-400 block">SIDE</label>
                                      <select
                                        value={batch.side}
                                        onChange={e => {
                                          const updated = [...lines];
                                          updated[idx].batches[bIdx].side = e.target.value as any;
                                          setLines(updated);
                                        }}
                                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md"
                                      >
                                        <option value="NONE">NONE</option>
                                        <option value="R">RIGHT (OD)</option>
                                        <option value="L">LEFT (OS)</option>
                                        <option value="BE">BOTH</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-slate-400 block">QTY (Prs)</label>
                                      <input
                                        type="number"
                                        min="1"
                                        value={batch.quantity}
                                        onChange={e => {
                                          const updated = [...lines];
                                          updated[idx].batches[bIdx].quantity = parseFloat(e.target.value) || 1;
                                          setLines(updated);
                                        }}
                                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md font-bold text-purple-900"
                                      />
                                    </div>
                                    <div className="flex items-end justify-center">
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveBatchFromLine(idx, bIdx)}
                                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tax Summary & Totals Bottom Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row justify-between items-start gap-6">
        <div className="max-w-md space-y-2 text-xs text-slate-500">
          <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-xs">
            <Info className="w-4 h-4 text-purple-600" />
            <span>Deterministic Optical Stock Inward Rules</span>
          </div>
          <p>
            • Posting an invoice immediately updates physical inventory for each optical batch allocated.
          </p>
          <p>
            • Preserves historical purchase pricing in Purchase Lots for FIFO/weighted cost tracking.
          </p>
          <p>
            • Credits Supplier Ledger with running balance reconciliation.
          </p>
        </div>

        <div className="w-full md:w-80 space-y-2.5 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal (Gross):</span>
            <span className="font-mono font-medium">₹{totals.subtotal.toFixed(2)}</span>
          </div>

          {totals.discountTotal > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>Total Item Discounts:</span>
              <span className="font-mono font-medium">-₹{totals.discountTotal.toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between text-slate-800 font-semibold pt-1 border-t border-slate-100">
            <span>Taxable Value:</span>
            <span className="font-mono">₹{totals.taxableAmount.toFixed(2)}</span>
          </div>

          {gstMode === 'INTRA_STATE' ? (
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
          ) : (
            <div className="flex justify-between text-slate-600">
              <span>IGST:</span>
              <span className="font-mono">₹{totals.igstAmount.toFixed(2)}</span>
            </div>
          )}

          {totals.roundOff !== 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Round Off:</span>
              <span className="font-mono">₹{totals.roundOff.toFixed(2)}</span>
            </div>
          )}

          <div className="flex justify-between text-base font-bold text-purple-950 pt-2 border-t-2 border-purple-200">
            <span>Invoice Grand Total:</span>
            <span className="font-mono text-xl text-purple-800">₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
