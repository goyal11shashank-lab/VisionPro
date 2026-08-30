import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  Receipt,
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
  Building2,
  CreditCard,
  Printer,
  Calendar,
  DollarSign,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { apiRequest } from '../../api/client.js';

interface BatchRow {
  batchId?: string;
  sph?: number | string;
  cyl?: number | string;
  axis?: number | string;
  add?: number | string;
  side?: string;
  quantity: number;
  barcode?: string;
  availableStock?: number;
}

interface VoucherLine {
  uniqueItemId: string;
  uniqueItemName: string;
  uniqueItemCode: string;
  categoryCode?: string;
  baseName?: string;
  coatingName?: string;
  quantity: number;
  rate: number;
  discountType: 'NONE' | 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  gstRate: number;
  batches: BatchRow[];
  isPowerDetailsOpen?: boolean;
  availableBatches?: any[];
}

interface Props {
  onNavigate?: (path: string) => void;
  onSuccess?: (invoiceId: string) => void;
}

export const NormalSalesVoucherPage: React.FC<Props> = ({ onNavigate, onSuccess }) => {
  const { currentBusiness, hasPermission, user } = useAuth();

  // Master Data
  const [parties, setParties] = useState<any[]>([]);
  const [uniqueItemsList, setUniqueItemsList] = useState<any[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);

  // Form Header State
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [selectedParty, setSelectedParty] = useState<any>(null);
  const [partyCreditInfo, setPartyCreditInfo] = useState<any>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState<string>('NET 30');
  const [gstMode, setGstMode] = useState<'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT'>('INTRA_STATE');
  const [paymentMode, setPaymentMode] = useState<string>('CREDIT');
  const [salesType, setSalesType] = useState<string>('STANDARD_B2B');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Lines
  const [lines, setLines] = useState<VoucherLine[]>([]);

  // Barcode Lookup Fast Add
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [barcodeLoading, setBarcodeLoading] = useState<boolean>(false);
  const [barcodeMsg, setBarcodeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Submission & Post-Creation States
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<any | null>(null);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);

  // Load initial data (parties, items, number preview)
  const loadPrerequisites = async () => {
    if (!currentBusiness) return;
    setLoadingInitial(true);
    try {
      const [partiesRes, itemsRes, numRes] = await Promise.all([
        apiRequest<{ parties: any[] }>('/api/parties?limit=100'),
        apiRequest<{ uniqueItems: any[] }>('/api/optical-master/unique-items').catch(() =>
          apiRequest<any[]>('/api/unique-items').then(items => ({ uniqueItems: items }))
        ),
        apiRequest<{ invoiceNumber: string }>('/api/sales/invoices/number-preview').catch(() => ({
          invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
        })),
      ]);

      const validCustomers = (partiesRes.parties || []).filter(
        (p: any) => p.partyType === 'CUSTOMER' || p.partyType === 'BOTH'
      );
      setParties(validCustomers);
      setUniqueItemsList(itemsRes.uniqueItems || []);
      setInvoiceNumber(numRes.invoiceNumber);

      // Auto-set due date
      updateDueDate(invoiceDate, 'NET 30');
    } catch (err: any) {
      console.error('Error loading prerequisites:', err);
      setFormError(err.message || 'Failed to load initial data');
    } finally {
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    loadPrerequisites();
  }, [currentBusiness?.id]);

  // Handle party change & auto-detect GST mode + credit check
  const handlePartyChange = async (partyId: string) => {
    setSelectedPartyId(partyId);
    const party = parties.find(p => p.id === partyId) || null;
    setSelectedParty(party);

    if (!party) {
      setPartyCreditInfo(null);
      return;
    }

    // Auto-detect GST Mode
    if (party.state && currentBusiness?.state) {
      if (party.state.trim().toLowerCase() !== currentBusiness.state.trim().toLowerCase()) {
        setGstMode('INTER_STATE');
      } else {
        setGstMode('INTRA_STATE');
      }
    }

    // Fetch live party credit check & ledger balance
    try {
      const creditRes = await apiRequest<any>(`/api/sales/parties/${partyId}/credit-check`);
      setPartyCreditInfo(creditRes);
    } catch (err) {
      console.error('Credit check error:', err);
    }
  };

  // Due Date calculation helper
  const updateDueDate = (baseDate: string, terms: string) => {
    if (!baseDate) return;
    const d = new Date(baseDate);
    if (terms === 'IMMEDIATE' || terms === 'DUE_ON_RECEIPT') {
      setDueDate(baseDate);
    } else if (terms === 'NET 7') {
      d.setDate(d.getDate() + 7);
      setDueDate(d.toISOString().split('T')[0]);
    } else if (terms === 'NET 15') {
      d.setDate(d.getDate() + 15);
      setDueDate(d.toISOString().split('T')[0]);
    } else if (terms === 'NET 30') {
      d.setDate(d.getDate() + 30);
      setDueDate(d.toISOString().split('T')[0]);
    } else if (terms === 'NET 60') {
      d.setDate(d.getDate() + 60);
      setDueDate(d.toISOString().split('T')[0]);
    }
  };

  // Add empty or pre-selected item line
  const handleAddLine = async (uniqueItemId?: string) => {
    const item = uniqueItemsList.find(i => i.id === uniqueItemId) || uniqueItemsList[0];
    if (!item) {
      setFormError('No products available in Master. Please create Unique Items first.');
      return;
    }

    let prefilledRate = item.mrp ? parseFloat(item.mrp) : item.standardSellingPrice ? parseFloat(item.standardSellingPrice) : 450;
    
    // Check party-specific last sale price if customer is selected
    if (selectedPartyId && item.id) {
      try {
        const priceData = await apiRequest<any>(`/api/sales/pricing/${selectedPartyId}/${item.id}`);
        if (priceData && priceData.lastSalePrice !== null && priceData.lastSalePrice !== undefined) {
          prefilledRate = parseFloat(priceData.lastSalePrice);
        }
      } catch {
        // Fallback to item MRP
      }
    }

    // Fetch batches for this item
    let batches: BatchRow[] = [];
    let availableBatches: any[] = [];
    try {
      const bRes = await apiRequest<{ batches: any[] }>(`/api/sales/unique-items/${item.id}/batches?onlyInStock=true`);
      availableBatches = bRes.batches || [];
      if (availableBatches.length > 0) {
        const first = availableBatches[0];
        batches = [
          {
            batchId: first.id,
            sph: first.sph || '0.00',
            cyl: first.cyl || '0.00',
            axis: first.axis || '',
            add: first.add || '',
            side: first.side || 'NONE',
            quantity: 1,
            barcode: first.barcode,
            availableStock: parseFloat(first.availableStock || first.quantityRemaining || 0),
          },
        ];
      }
    } catch {
      // Non-batched fallback
    }

    const newLine: VoucherLine = {
      uniqueItemId: item.id,
      uniqueItemName: item.name,
      uniqueItemCode: item.code,
      categoryCode: item.categoryCode || item.category?.code,
      baseName: item.baseName || item.base?.name,
      coatingName: item.coatingName || item.coating?.name,
      quantity: 1,
      rate: prefilledRate,
      discountType: 'NONE',
      discountValue: 0,
      gstRate: item.taxRate ? parseFloat(item.taxRate) : 12,
      batches: batches,
      isPowerDetailsOpen: false,
      availableBatches: availableBatches,
    };

    setLines(prev => [...prev, newLine]);
  };

  // Change selected item for an existing line
  const handleLineItemChange = async (index: number, newItemId: string) => {
    const item = uniqueItemsList.find(i => i.id === newItemId);
    if (!item) return;

    let prefilledRate = item.mrp ? parseFloat(item.mrp) : 450;
    if (selectedPartyId) {
      try {
        const priceData = await apiRequest<any>(`/api/sales/pricing/${selectedPartyId}/${item.id}`);
        if (priceData && priceData.lastSalePrice !== null) {
          prefilledRate = parseFloat(priceData.lastSalePrice);
        }
      } catch {
        // ignore
      }
    }

    let batches: BatchRow[] = [];
    let availableBatches: any[] = [];
    try {
      const bRes = await apiRequest<{ batches: any[] }>(`/api/sales/unique-items/${item.id}/batches?onlyInStock=true`);
      availableBatches = bRes.batches || [];
      if (availableBatches.length > 0) {
        const first = availableBatches[0];
        batches = [
          {
            batchId: first.id,
            sph: first.sph || '0.00',
            cyl: first.cyl || '0.00',
            axis: first.axis || '',
            add: first.add || '',
            side: first.side || 'NONE',
            quantity: lines[index]?.quantity || 1,
            barcode: first.barcode,
            availableStock: parseFloat(first.availableStock || first.quantityRemaining || 0),
          },
        ];
      }
    } catch {
      // ignore
    }

    setLines(prev =>
      prev.map((line, idx) =>
        idx === index
          ? {
              ...line,
              uniqueItemId: item.id,
              uniqueItemName: item.name,
              uniqueItemCode: item.code,
              categoryCode: item.categoryCode || item.category?.code,
              baseName: item.baseName || item.base?.name,
              coatingName: item.coatingName || item.coating?.name,
              rate: prefilledRate,
              gstRate: item.taxRate ? parseFloat(item.taxRate) : 12,
              batches: batches,
              availableBatches: availableBatches,
            }
          : line
      )
    );
  };

  // Barcode Lookup Fast Entry
  const handleBarcodeLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    setBarcodeLoading(true);
    setBarcodeMsg(null);
    try {
      const data = await apiRequest<any>(`/api/sales/barcode-lookup/${encodeURIComponent(barcodeInput.trim())}`);
      const batch = data.batch;
      const uItem = data.uniqueItem;

      if (!uItem) {
        throw new Error('No product linked to this barcode');
      }

      // Check if already in lines
      const existingIdx = lines.findIndex(
        l => l.uniqueItemId === uItem.id && l.batches.some(b => b.batchId === batch?.id)
      );

      if (existingIdx >= 0) {
        // Increment quantity
        setLines(prev =>
          prev.map((l, i) =>
            i === existingIdx
              ? {
                  ...l,
                  quantity: l.quantity + 1,
                  batches: l.batches.map(b => (b.batchId === batch?.id ? { ...b, quantity: b.quantity + 1 } : b)),
                }
              : l
          )
        );
        setBarcodeMsg({
          type: 'success',
          text: `Incremented quantity for ${uItem.name} (${batch?.barcode || ''})`,
        });
      } else {
        // Add new line
        let prefilledRate = uItem.mrp ? parseFloat(uItem.mrp) : 450;
        if (selectedPartyId) {
          try {
            const priceData = await apiRequest<any>(`/api/sales/pricing/${selectedPartyId}/${uItem.id}`);
            if (priceData?.lastSalePrice) prefilledRate = parseFloat(priceData.lastSalePrice);
          } catch {
            // ignore
          }
        }

        const newLine: VoucherLine = {
          uniqueItemId: uItem.id,
          uniqueItemName: uItem.name,
          uniqueItemCode: uItem.code,
          categoryCode: uItem.categoryCode,
          quantity: 1,
          rate: prefilledRate,
          discountType: 'NONE',
          discountValue: 0,
          gstRate: uItem.taxRate ? parseFloat(uItem.taxRate) : 12,
          batches: batch
            ? [
                {
                  batchId: batch.id,
                  sph: batch.sph || '0.00',
                  cyl: batch.cyl || '0.00',
                  axis: batch.axis || '',
                  add: batch.add || '',
                  side: batch.side || 'NONE',
                  quantity: 1,
                  barcode: batch.barcode,
                  availableStock: parseFloat(batch.availableStock || batch.quantityRemaining || 0),
                },
              ]
            : [],
        };
        setLines(prev => [...prev, newLine]);
        setBarcodeMsg({
          type: 'success',
          text: `Added ${uItem.name} SPH ${batch?.sph || '0.00'} CYL ${batch?.cyl || '0.00'}`,
        });
      }
      setBarcodeInput('');
    } catch (err: any) {
      setBarcodeMsg({ type: 'error', text: err.message || 'Barcode lookup failed' });
    } finally {
      setBarcodeLoading(false);
    }
  };

  // Calculations
  const computedLines = lines.map(line => {
    const gross = (line.quantity || 0) * (line.rate || 0);
    const disc =
      line.discountType === 'PERCENTAGE'
        ? (gross * (line.discountValue || 0)) / 100
        : line.discountType === 'FIXED'
        ? Math.min(gross, line.discountValue || 0)
        : 0;
    const taxable = Math.max(0, gross - disc);
    const taxRate = gstMode === 'EXEMPT' ? 0 : line.gstRate || 0;
    const tax = (taxable * taxRate) / 100;
    const total = taxable + tax;

    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (gstMode === 'INTER_STATE') {
      igst = tax;
    } else if (gstMode === 'INTRA_STATE') {
      cgst = tax / 2;
      sgst = tax / 2;
    }

    return {
      ...line,
      gross,
      disc,
      taxable,
      tax,
      cgst,
      sgst,
      igst,
      total,
    };
  });

  const subtotal = computedLines.reduce((acc, l) => acc + l.gross, 0);
  const discountTotal = computedLines.reduce((acc, l) => acc + l.disc, 0);
  const taxableAmount = computedLines.reduce((acc, l) => acc + l.taxable, 0);
  const cgstAmount = computedLines.reduce((acc, l) => acc + l.cgst, 0);
  const sgstAmount = computedLines.reduce((acc, l) => acc + l.sgst, 0);
  const igstAmount = computedLines.reduce((acc, l) => acc + l.igst, 0);
  const totalTax = cgstAmount + sgstAmount + igstAmount;
  const rawGrandTotal = taxableAmount + totalTax;
  const grandTotal = Math.round(rawGrandTotal);
  const roundOff = grandTotal - rawGrandTotal;

  // Save Voucher (DRAFT or POSTED)
  const handleSaveVoucher = async (targetStatus: 'DRAFT' | 'POSTED') => {
    setFormError(null);

    if (!selectedPartyId) {
      setFormError('Please select a Customer / Party to create the invoice.');
      return;
    }

    if (lines.length === 0) {
      setFormError('Invoice must contain at least one item line.');
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.quantity <= 0) {
        setFormError(`Line #${i + 1} (${l.uniqueItemName}) has invalid quantity (${l.quantity}). Must be ≥ 1.`);
        return;
      }
      if (l.rate < 0) {
        setFormError(`Line #${i + 1} (${l.uniqueItemName}) has negative unit price.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        partyId: selectedPartyId,
        invoiceNumber: invoiceNumber.trim() || undefined,
        invoiceDate: invoiceDate,
        gstMode: gstMode,
        status: targetStatus,
        notes: notes.trim()
          ? `${notes.trim()} | Payment Mode: ${paymentMode} | Terms: ${paymentTerms}${referenceNumber ? ` | Ref: ${referenceNumber}` : ''}`
          : `Payment Mode: ${paymentMode} | Terms: ${paymentTerms}${referenceNumber ? ` | Ref: ${referenceNumber}` : ''}`,
        lines: lines.map(l => ({
          uniqueItemId: l.uniqueItemId,
          quantity: l.quantity,
          rate: l.rate,
          discountType: l.discountType,
          discountValue: l.discountValue,
          gstRate: gstMode === 'EXEMPT' ? 0 : l.gstRate,
          batches:
            l.batches && l.batches.length > 0
              ? l.batches.map(b => ({
                  batchId: b.batchId,
                  quantity: b.quantity,
                }))
              : undefined,
        })),
      };

      const result = await apiRequest<any>('/api/sales/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setCreatedInvoice(result);
      setShowPrintModal(true);
      if (onSuccess) {
        onSuccess(result.id);
      }
    } catch (err: any) {
      console.error('Save invoice error:', err);
      setFormError(err.message || 'Failed to create sales invoice. Please check batch quantities and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setCreatedInvoice(null);
    setShowPrintModal(false);
    setSelectedPartyId('');
    setSelectedParty(null);
    setPartyCreditInfo(null);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setLines([]);
    setFormError(null);
    loadPrerequisites();
  };

  return (
    <div id="normal-sales-voucher-container" className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            id="btn-back-to-invoices"
            onClick={() => onNavigate ? onNavigate('/sales/invoices') : window.history.back()}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Back to Sales Invoices Register"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                Regular Sales Voucher
              </span>
              <span className="text-xs text-slate-400 font-mono">Series: Auto GST</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Normal Sales Voucher</h1>
            <p className="text-xs text-slate-500">
              Standard optical tax invoice with party ledger posting, batch powers, and GST breakdown
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-switch-to-pos"
            onClick={() => onNavigate && onNavigate('/sales/pos')}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-xl border border-purple-200 transition-colors"
          >
            <Sparkles className="w-4 h-4 text-purple-600" />
            Switch to Fast POS
          </button>
          <button
            id="btn-save-draft"
            type="button"
            disabled={submitting || loadingInitial}
            onClick={() => handleSaveVoucher('DRAFT')}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4 text-slate-500" />
            Save as Draft
          </button>
          <button
            id="btn-save-post-invoice"
            type="button"
            disabled={submitting || loadingInitial}
            onClick={() => handleSaveVoucher('POSTED')}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-600/20 transition-all disabled:opacity-50"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Posting Invoice...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Save &amp; Post Invoice
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Notification */}
      {formError && (
        <div id="form-error-banner" className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{formError}</div>
          <button onClick={() => setFormError(null)} className="text-rose-500 hover:text-rose-800 font-bold">✕</button>
        </div>
      )}

      {/* Top Form Grid: Customer & Invoice Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer / Party Selection Card */}
        <div className="lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Building2 className="w-4 h-4 text-blue-600" />
              <span>Customer / Party Information</span>
            </div>
            <span className="text-[11px] text-rose-500 font-semibold">* Required</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">
                Select Customer <span className="text-rose-500">*</span>
              </label>
              <select
                id="select-voucher-customer"
                value={selectedPartyId}
                onChange={e => handlePartyChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="">-- Choose Optical Customer --</option>
                {parties.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.partyCode || 'NO-CODE'}) {p.city ? `• ${p.city}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Customer Details Box */}
            {selectedParty ? (
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{selectedParty.name}</span>
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                    {selectedParty.partyCode}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600 text-[11px]">
                  <div>
                    <span className="text-slate-400 block">GSTIN:</span>
                    <span className="font-mono font-medium text-slate-800">
                      {selectedParty.gstin || 'Unregistered / B2C'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">State / City:</span>
                    <span className="font-medium text-slate-800">
                      {selectedParty.state || 'Local'} {selectedParty.city ? `(${selectedParty.city})` : ''}
                    </span>
                  </div>
                </div>

                {partyCreditInfo && (
                  <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                    <div>
                      <span className="text-slate-400">Current Outstanding:</span>
                      <span className={`font-mono font-bold ml-1 ${
                        parseFloat(partyCreditInfo.outstandingBalance || 0) > 0 ? 'text-amber-600' : 'text-emerald-600'
                      }`}>
                        ₹{parseFloat(partyCreditInfo.outstandingBalance || 0).toFixed(2)}
                      </span>
                    </div>
                    {partyCreditInfo.creditLimit && (
                      <div>
                        <span className="text-slate-400">Limit:</span>
                        <span className="font-mono font-medium ml-1 text-slate-700">
                          ₹{parseFloat(partyCreditInfo.creditLimit).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 border border-dashed border-slate-200 rounded-xl text-center text-slate-400 text-xs">
                Select a customer above to view GSTIN, state, and ledger balance.
              </div>
            )}
          </div>
        </div>

        {/* Invoice Metadata Card */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Receipt className="w-4 h-4 text-blue-600" />
              <span>Voucher Header &amp; Compliance Details</span>
            </div>
            <span className="text-xs text-slate-400 font-mono">Invoice #{invoiceNumber}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block text-slate-600 font-medium mb-1">Invoice Number</label>
              <input
                id="input-voucher-number"
                type="text"
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="Auto generated"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Invoice Date</label>
              <input
                id="input-voucher-date"
                type="date"
                value={invoiceDate}
                onChange={e => {
                  setInvoiceDate(e.target.value);
                  updateDueDate(e.target.value, paymentTerms);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">GST Tax Mode</label>
              <select
                id="select-voucher-gst-mode"
                value={gstMode}
                onChange={e => setGstMode(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="INTRA_STATE">Intra-State (CGST + SGST)</option>
                <option value="INTER_STATE">Inter-State (IGST)</option>
                <option value="EXEMPT">Exempt / Non-GST (0%)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Payment Mode</label>
              <select
                id="select-voucher-payment-mode"
                value={paymentMode}
                onChange={e => setPaymentMode(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="CREDIT">Credit / Party Ledger</option>
                <option value="CASH">Cash Payment</option>
                <option value="UPI">UPI / QR Code</option>
                <option value="CARD">Debit / Credit Card</option>
                <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                <option value="CHEQUE">Bank Cheque</option>
                <option value="PARTIAL">Partial Payment</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Payment Terms</label>
              <select
                id="select-voucher-payment-terms"
                value={paymentTerms}
                onChange={e => {
                  setPaymentTerms(e.target.value);
                  updateDueDate(invoiceDate, e.target.value);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="NET 30">Net 30 Days</option>
                <option value="NET 15">Net 15 Days</option>
                <option value="NET 7">Net 7 Days</option>
                <option value="DUE_ON_RECEIPT">Due on Receipt</option>
                <option value="IMMEDIATE">Immediate / Cash</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Due Date</label>
              <input
                id="input-voucher-due-date"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Reference / PO #</label>
              <input
                id="input-voucher-reference"
                type="text"
                placeholder="Optional PO / Rx ref"
                value={referenceNumber}
                onChange={e => setReferenceNumber(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Invoice Notes / Remarks</label>
              <input
                id="input-voucher-notes"
                type="text"
                placeholder="Special instructions or delivery notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Barcode Fast Lookup Bar */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 rounded-2xl shadow-sm border border-slate-700">
        <form onSubmit={handleBarcodeLookup} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Barcode className="w-5 h-5 text-blue-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Optical Barcode Scanner:
            </span>
          </div>
          <div className="flex-1 w-full relative">
            <input
              id="input-voucher-barcode"
              type="text"
              placeholder="Scan or type optical batch barcode (e.g., BC-...) and press Enter"
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              className="w-full pl-3 pr-24 py-2 bg-slate-950/70 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <button
              id="btn-scan-barcode-submit"
              type="submit"
              disabled={barcodeLoading || !barcodeInput.trim()}
              className="absolute right-1 top-1 bottom-1 px-3 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-lg transition-colors disabled:opacity-40"
            >
              {barcodeLoading ? 'Scanning...' : 'Scan / Add'}
            </button>
          </div>
        </form>
        {barcodeMsg && (
          <div className={`mt-2.5 text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-2 ${
            barcodeMsg.type === 'success' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800' : 'bg-rose-950/60 text-rose-300 border border-rose-800'
          }`}>
            {barcodeMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span>{barcodeMsg.text}</span>
          </div>
        )}
      </div>

      {/* Invoice Line Items Section */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-sm">
              Invoice Products &amp; Power Items ({lines.length})
            </h3>
          </div>
          <button
            id="btn-add-voucher-line"
            type="button"
            onClick={() => handleAddLine()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Line Item
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="p-12 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-3">
            <div className="inline-flex p-3 bg-blue-50 text-blue-600 rounded-full">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">No items added to this sales voucher</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Click &quot;Add Line Item&quot; to select frames, ophthalmic lenses, contact lenses, or scan barcodes to auto-populate power specs.
            </p>
            <button
              type="button"
              onClick={() => handleAddLine()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add First Item
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-3 w-6 text-center">#</th>
                  <th className="py-3 px-3 min-w-[240px]">Product / Optical Specification</th>
                  <th className="py-3 px-3 w-24 text-center">Qty</th>
                  <th className="py-3 px-3 w-28 text-right">Rate (₹)</th>
                  <th className="py-3 px-3 w-28">Discount</th>
                  <th className="py-3 px-3 w-20">GST %</th>
                  <th className="py-3 px-3 text-right w-28">Taxable (₹)</th>
                  <th className="py-3 px-3 text-right w-28">Total (₹)</th>
                  <th className="py-3 px-3 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {computedLines.map((line, idx) => (
                  <React.Fragment key={idx}>
                    <tr className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 text-center text-slate-400 font-mono font-medium">
                        {idx + 1}
                      </td>

                      {/* Product Selector */}
                      <td className="py-3 px-3 space-y-1">
                        <select
                          id={`select-line-product-${idx}`}
                          value={line.uniqueItemId}
                          onChange={e => handleLineItemChange(idx, e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-900 bg-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        >
                          {uniqueItemsList.map(item => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.code || 'SKU'}) {item.categoryCode ? `[${item.categoryCode}]` : ''}
                            </option>
                          ))}
                        </select>

                        {/* Power & Optical Meta Bar */}
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          {line.batches && line.batches.length > 0 && line.batches[0].sph !== undefined && (
                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 font-mono font-medium rounded border border-emerald-200">
                              SPH: {line.batches[0].sph} | CYL: {line.batches[0].cyl || '0.00'}
                              {line.batches[0].axis ? ` | AX: ${line.batches[0].axis}°` : ''}
                              {line.batches[0].add ? ` | ADD: ${line.batches[0].add}` : ''}
                            </span>
                          )}
                          {line.batches && line.batches.length > 0 && line.batches[0].availableStock !== undefined && (
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 font-mono rounded text-[10px]">
                              Stock: {line.batches[0].availableStock}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setLines(prev =>
                                prev.map((l, i) =>
                                  i === idx ? { ...l, isPowerDetailsOpen: !l.isPowerDetailsOpen } : l
                                )
                              )
                            }
                            className="text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-0.5 text-[11px]"
                          >
                            {line.isPowerDetailsOpen ? (
                              <>
                                <ChevronUp className="w-3 h-3" /> Hide Power Details
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3" /> Edit Lens Power / Batch
                              </>
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="py-3 px-3">
                        <input
                          id={`input-line-qty-${idx}`}
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={e => {
                            const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                            setLines(prev =>
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
                          className="w-full px-2 py-1.5 text-center font-mono font-semibold rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                      </td>

                      {/* Rate */}
                      <td className="py-3 px-3">
                        <input
                          id={`input-line-rate-${idx}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.rate}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            setLines(prev => prev.map((l, i) => (i === idx ? { ...l, rate: val } : l)));
                          }}
                          className="w-full px-2 py-1.5 text-right font-mono font-semibold rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                      </td>

                      {/* Discount Type & Value */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1">
                          <select
                            value={line.discountType}
                            onChange={e => {
                              const t = e.target.value as any;
                              setLines(prev =>
                                prev.map((l, i) => (i === idx ? { ...l, discountType: t } : l))
                              );
                            }}
                            className="w-14 px-1 py-1.5 text-[11px] rounded-lg border border-slate-300 bg-white"
                          >
                            <option value="NONE">0</option>
                            <option value="PERCENTAGE">%</option>
                            <option value="FIXED">₹</option>
                          </select>
                          {line.discountType !== 'NONE' && (
                            <input
                              type="number"
                              min="0"
                              value={line.discountValue}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setLines(prev =>
                                  prev.map((l, i) => (i === idx ? { ...l, discountValue: val } : l))
                                );
                              }}
                              className="w-16 px-1.5 py-1.5 text-right font-mono rounded-lg border border-slate-300"
                            />
                          )}
                        </div>
                      </td>

                      {/* GST Rate */}
                      <td className="py-3 px-3">
                        <select
                          value={line.gstRate}
                          disabled={gstMode === 'EXEMPT'}
                          onChange={e => {
                            const val = parseFloat(e.target.value);
                            setLines(prev => prev.map((l, i) => (i === idx ? { ...l, gstRate: val } : l)));
                          }}
                          className="w-full px-1.5 py-1.5 font-mono rounded-lg border border-slate-300 bg-white"
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={12}>12%</option>
                          <option value={18}>18%</option>
                          <option value={28}>28%</option>
                        </select>
                      </td>

                      {/* Taxable Amount */}
                      <td className="py-3 px-3 text-right font-mono font-medium text-slate-700">
                        ₹{line.taxable.toFixed(2)}
                      </td>

                      {/* Line Total */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        ₹{line.total.toFixed(2)}
                      </td>

                      {/* Delete */}
                      <td className="py-3 px-3 text-center">
                        <button
                          id={`btn-delete-line-${idx}`}
                          type="button"
                          onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-md transition-colors"
                          title="Remove item line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Optical Power & Batch Selection Box */}
                    {line.isPowerDetailsOpen && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={9} className="p-3">
                          <div className="p-3 bg-white rounded-xl border border-blue-200 space-y-3">
                            <div className="flex items-center justify-between text-xs font-bold text-blue-900 border-b border-blue-100 pb-2">
                              <span>Optical Prescription &amp; Power Specification</span>
                              <span className="font-mono text-[11px] text-slate-500">
                                {line.availableBatches?.length || 0} batches available in stock
                              </span>
                            </div>

                            {/* Batch selector or manual power entry */}
                            {line.availableBatches && line.availableBatches.length > 0 ? (
                              <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-700">
                                  Select Existing Stock Batch:
                                </label>
                                <select
                                  value={line.batches[0]?.batchId || ''}
                                  onChange={e => {
                                    const bId = e.target.value;
                                    const b = line.availableBatches?.find(x => x.id === bId);
                                    if (b) {
                                      setLines(prev =>
                                        prev.map((l, i) =>
                                          i === idx
                                            ? {
                                                ...l,
                                                batches: [
                                                  {
                                                    batchId: b.id,
                                                    sph: b.sph,
                                                    cyl: b.cyl,
                                                    axis: b.axis,
                                                    add: b.add,
                                                    side: b.side,
                                                    quantity: l.quantity,
                                                    barcode: b.barcode,
                                                    availableStock: parseFloat(b.availableStock || b.quantityRemaining || 0),
                                                  },
                                                ],
                                              }
                                            : l
                                        )
                                      );
                                    }
                                  }}
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                                >
                                  {line.availableBatches.map(b => (
                                    <option key={b.id} value={b.id}>
                                      SPH: {b.sph || '0.00'} | CYL: {b.cyl || '0.00'} | Axis: {b.axis || '—'} | Add: {b.add || '—'} | Side: {b.side || 'BE'} | Barcode: {b.barcode || 'N/A'} (Stock: {b.availableStock || b.quantityRemaining || 0})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : null}

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                              <div>
                                <label className="block text-slate-500 font-medium mb-0.5">SPH (Sphere)</label>
                                <input
                                  type="text"
                                  placeholder="-2.00"
                                  value={line.batches[0]?.sph ?? ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setLines(prev =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              batches: l.batches.length
                                                ? l.batches.map(b => ({ ...b, sph: val }))
                                                : [{ sph: val, quantity: l.quantity }],
                                            }
                                          : l
                                      )
                                    );
                                  }}
                                  className="w-full px-2 py-1 rounded border border-slate-300 font-mono"
                                />
                              </div>

                              <div>
                                <label className="block text-slate-500 font-medium mb-0.5">CYL (Cylinder)</label>
                                <input
                                  type="text"
                                  placeholder="-0.50"
                                  value={line.batches[0]?.cyl ?? ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setLines(prev =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              batches: l.batches.length
                                                ? l.batches.map(b => ({ ...b, cyl: val }))
                                                : [{ cyl: val, quantity: l.quantity }],
                                            }
                                          : l
                                      )
                                    );
                                  }}
                                  className="w-full px-2 py-1 rounded border border-slate-300 font-mono"
                                />
                              </div>

                              <div>
                                <label className="block text-slate-500 font-medium mb-0.5">Axis (°)</label>
                                <input
                                  type="text"
                                  placeholder="90"
                                  value={line.batches[0]?.axis ?? ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setLines(prev =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              batches: l.batches.length
                                                ? l.batches.map(b => ({ ...b, axis: val }))
                                                : [{ axis: val, quantity: l.quantity }],
                                            }
                                          : l
                                      )
                                    );
                                  }}
                                  className="w-full px-2 py-1 rounded border border-slate-300 font-mono"
                                />
                              </div>

                              <div>
                                <label className="block text-slate-500 font-medium mb-0.5">ADD (Near)</label>
                                <input
                                  type="text"
                                  placeholder="+1.50"
                                  value={line.batches[0]?.add ?? ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setLines(prev =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              batches: l.batches.length
                                                ? l.batches.map(b => ({ ...b, add: val }))
                                                : [{ add: val, quantity: l.quantity }],
                                            }
                                          : l
                                      )
                                    );
                                  }}
                                  className="w-full px-2 py-1 rounded border border-slate-300 font-mono"
                                />
                              </div>

                              <div>
                                <label className="block text-slate-500 font-medium mb-0.5">Eye / Side</label>
                                <select
                                  value={line.batches[0]?.side || 'NONE'}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setLines(prev =>
                                      prev.map((l, i) =>
                                        i === idx
                                          ? {
                                              ...l,
                                              batches: l.batches.length
                                                ? l.batches.map(b => ({ ...b, side: val }))
                                                : [{ side: val, quantity: l.quantity }],
                                            }
                                          : l
                                      )
                                    );
                                  }}
                                  className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-xs font-semibold"
                                >
                                  <option value="NONE">Not Applicable</option>
                                  <option value="R">Right Eye (OD)</option>
                                  <option value="L">Left Eye (OS)</option>
                                  <option value="BE">Both Eyes (BE)</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Financial Summary Calculation Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Customer Ledger Balance Impact Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-slate-900 border-b border-slate-100 pb-2">
            <CreditCard className="w-4 h-4 text-blue-600" />
            <span>Customer Ledger Impact &amp; Settlement</span>
          </div>

          <div className="space-y-2 text-slate-600">
            <div className="flex justify-between">
              <span>Customer Name:</span>
              <span className="font-semibold text-slate-800">{selectedParty?.name || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Previous Outstanding Balance:</span>
              <span className="font-mono font-semibold">
                ₹{parseFloat(partyCreditInfo?.outstandingBalance || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>This Sales Invoice Total:</span>
              <span className="font-mono font-bold text-blue-700">+ ₹{grandTotal.toFixed(2)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900">
              <span>Net Outstanding Balance After Posting:</span>
              <span className="font-mono text-emerald-700">
                ₹{(parseFloat(partyCreditInfo?.outstandingBalance || 0) + grandTotal).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl text-[11px] text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">Ledger Posting Rule:</p>
            <p>
              When &quot;Save &amp; Post Invoice&quot; is triggered, optical batch physical stock is decremented immediately, and the customer ledger is debited atomically in PostgreSQL.
            </p>
          </div>
        </div>

        {/* GST & Grand Total Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center gap-2 font-bold text-slate-900 border-b border-slate-100 pb-2 text-xs">
            <Percent className="w-4 h-4 text-emerald-600" />
            <span>Tax &amp; Invoice Value Summary</span>
          </div>

          <div className="space-y-2 font-mono text-xs text-slate-700">
            <div className="flex justify-between font-sans">
              <span className="text-slate-500">Gross Subtotal:</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-sans">
              <span className="text-slate-500">Total Item Discount:</span>
              <span className="text-rose-600">- ₹{discountTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-sans font-semibold">
              <span className="text-slate-700">Taxable Base Amount:</span>
              <span>₹{taxableAmount.toFixed(2)}</span>
            </div>

            {gstMode === 'INTER_STATE' ? (
              <div className="flex justify-between font-sans">
                <span className="text-slate-500">Integrated GST (IGST):</span>
                <span>₹{igstAmount.toFixed(2)}</span>
              </div>
            ) : gstMode === 'INTRA_STATE' ? (
              <>
                <div className="flex justify-between font-sans">
                  <span className="text-slate-500">Central GST (CGST):</span>
                  <span>₹{cgstAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-sans">
                  <span className="text-slate-500">State GST (SGST):</span>
                  <span>₹{sgstAmount.toFixed(2)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between font-sans text-slate-400">
                <span>GST Tax (Exempt):</span>
                <span>₹0.00</span>
              </div>
            )}

            <div className="flex justify-between font-sans text-slate-500">
              <span>Round Off:</span>
              <span>{roundOff >= 0 ? `+ ₹${roundOff.toFixed(2)}` : `- ₹${Math.abs(roundOff).toFixed(2)}`}</span>
            </div>

            <div className="pt-3 border-t border-slate-300 flex justify-between items-baseline font-sans">
              <div>
                <span className="text-sm font-bold text-slate-900 block">Grand Total (₹)</span>
                <span className="text-[11px] text-slate-400 font-normal">Inclusive of all taxes</span>
              </div>
              <span className="text-2xl font-bold font-mono text-emerald-700">
                ₹{grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sticky Action Bar */}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur-md p-4 rounded-2xl border border-slate-200 shadow-xl flex items-center justify-between z-20">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-slate-700">Total Items: <strong className="font-mono text-slate-900">{lines.length}</strong></span>
          <span>•</span>
          <span className="font-semibold text-slate-700">Invoice Amount: <strong className="font-mono text-emerald-700 text-sm">₹{grandTotal.toFixed(2)}</strong></span>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-bottom-cancel"
            type="button"
            onClick={() => onNavigate ? onNavigate('/sales/invoices') : window.history.back()}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            id="btn-bottom-save-draft"
            type="button"
            disabled={submitting || loadingInitial}
            onClick={() => handleSaveVoucher('DRAFT')}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
          >
            Save as Draft
          </button>
          <button
            id="btn-bottom-save-post"
            type="button"
            disabled={submitting || loadingInitial}
            onClick={() => handleSaveVoucher('POSTED')}
            className="flex items-center gap-2 px-6 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-600/20 transition-all disabled:opacity-50"
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Posting Invoice...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Save &amp; Post Invoice
              </>
            )}
          </button>
        </div>
      </div>

      {/* Invoice Created & Print Preview Modal */}
      {showPrintModal && createdInvoice && (
        <div id="modal-invoice-created" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Sales Invoice Created Successfully!
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Invoice #{createdInvoice.invoiceNumber} • Status: {createdInvoice.status}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-bold text-slate-900">{createdInvoice.partyName || selectedParty?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice Date:</span>
                <span className="font-mono">{new Date(createdInvoice.invoiceDate).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Amount:</span>
                <span className="font-mono font-bold text-emerald-700 text-sm">
                  ₹{parseFloat(createdInvoice.grandTotal || grandTotal).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Stock &amp; Ledger:</span>
                <span className="text-emerald-600 font-semibold">
                  {createdInvoice.status === 'POSTED' ? '✓ Stock Deducted & Customer Ledger Debited' : 'Draft Saved (Stock Reserved)'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                id="btn-print-tax-invoice"
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <Printer className="w-4 h-4 text-slate-600" />
                Print Tax Invoice
              </button>

              <div className="flex items-center gap-2">
                <button
                  id="btn-create-another-voucher"
                  onClick={handleResetForm}
                  className="px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                >
                  Create Another Voucher
                </button>
                <button
                  id="btn-go-to-invoices-register"
                  onClick={() => onNavigate ? onNavigate('/sales/invoices') : window.history.back()}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm"
                >
                  View All Invoices
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
