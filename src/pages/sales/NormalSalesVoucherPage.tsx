import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  ArrowLeft,
  Printer,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../api/client';
import { VoucherHeader } from '../../components/voucher/VoucherHeader';
import { VoucherItemGrid } from '../../components/voucher/VoucherItemGrid';
import { VoucherFooter } from '../../components/voucher/VoucherFooter';
import { OpticalBatchModal } from '../../components/voucher/OpticalBatchModal';
import {
  VoucherLineItem,
  ComputedVoucherLine,
  VoucherTotals,
  BatchAllocation,
  createEmptyVoucherLine,
  isVoucherLineEmpty,
  ensureTrailingBlankRow,
} from '../../components/voucher/VoucherTypes';

interface Props {
  onNavigate?: (path: string) => void;
  onSuccess?: (invoiceId: string) => void;
  editInvoiceId?: string | null;
  onBack?: () => void;
}

export const NormalSalesVoucherPage: React.FC<Props> = ({ onNavigate, onSuccess, editInvoiceId, onBack }) => {
  const { currentBusiness } = useAuth();

  // Master Data
  const [parties, setParties] = useState<any[]>([]);
  const [uniqueItemsList, setUniqueItemsList] = useState<any[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);

  // Voucher Header State
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [selectedParty, setSelectedParty] = useState<any>(null);
  const [partyCreditInfo, setPartyCreditInfo] = useState<any>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [dueDate, setDueDate] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState<string>('NET 30');
  const [gstMode, setGstMode] = useState<'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT'>(
    'INTRA_STATE'
  );
  const [paymentMode, setPaymentMode] = useState<string>('CREDIT');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Lines (initialized with a pristine blank row)
  const [lines, setLines] = useState<VoucherLineItem[]>([createEmptyVoucherLine('row')]);

  // Optical Batch Modal state
  const [activeBatchModalIndex, setActiveBatchModalIndex] = useState<number | null>(null);
  const [activeBatchLineId, setActiveBatchLineId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ row: number; col: string; key: number } | null>(null);

  const activeBatchLine = activeBatchLineId
    ? lines.find(l => l.id === activeBatchLineId) || null
    : activeBatchModalIndex !== null
    ? lines[activeBatchModalIndex] || null
    : null;

  // Barcode Lookup Fast Add
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [barcodeLoading, setBarcodeLoading] = useState<boolean>(false);
  const [barcodeMsg, setBarcodeMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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
      const items = itemsRes.uniqueItems || [];
      setUniqueItemsList(items);
      setInvoiceNumber(numRes.invoiceNumber);

      // Auto-set due date
      updateDueDate(invoiceDate, 'NET 30');

      // If editing existing invoice, load invoice data and lines
      if (editInvoiceId) {
        try {
          const inv = await apiRequest<any>(`/api/sales/invoices/${editInvoiceId}`);
          if (inv) {
            setSelectedPartyId(inv.partyId || '');
            setSelectedParty(inv.party || null);
            setInvoiceNumber(inv.invoiceNumber || '');
            if (inv.invoiceDate) setInvoiceDate(inv.invoiceDate.split('T')[0]);
            if (inv.dueDate) setDueDate(inv.dueDate.split('T')[0]);
            if (inv.gstMode) setGstMode(inv.gstMode);
            if (inv.notes) setNotes(inv.notes);

            const loadedLines: VoucherLineItem[] = (inv.lines || []).map((l: any, i: number) => ({
              id: `row-${i}-${l.id || i}`,
              uniqueItemId: l.uniqueItemId,
              uniqueItemName: l.uniqueItem?.name || 'Item',
              uniqueItemCode: l.uniqueItem?.code || '',
              categoryCode: l.category?.code || l.uniqueItem?.categoryCode || 'SV',
              maintainBatches: l.uniqueItem?.maintainBatches !== false,
              quantity: parseFloat(l.quantity) || 1,
              rate: parseFloat(l.rate) || 0,
              discountType: l.discountType || 'NONE',
              discountValue: parseFloat(l.discountValue) || 0,
              gstRate: parseFloat(l.gstRate) || 12,
              batches: (l.batches || []).map((b: any) => ({
                batchId: b.batchId || b.batch?.id,
                sph: b.batch?.sph ?? b.sph ?? '0.00',
                cyl: b.batch?.cyl ?? b.cyl ?? '0.00',
                axis: b.batch?.axis ?? b.axis ?? '',
                add: b.batch?.add ?? b.add ?? '',
                side: b.batch?.side || b.side || 'NONE',
                barcode: b.batch?.barcode || b.barcode,
                availableStock: parseFloat(b.batch?.availableStock ?? b.availableStock ?? 0),
                quantity: parseFloat(b.quantity) || 1,
                rate: parseFloat(b.rate ?? l.rate ?? 0),
              })),
            }));

            setLines(ensureTrailingBlankRow(loadedLines, 'row'));
            return;
          }
        } catch (err) {
          console.error('Failed to load edit invoice:', err);
        }
      }

      // Initialize with one blank row if empty
      setLines(prev => (prev.length === 0 ? [createEmptyVoucherLine('row')] : prev));
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

  // Add blank row
  const handleAddBlankLine = () => {
    setLines(prev => ensureTrailingBlankRow(prev, 'row'));
  };

  // Change selected item for an existing line
  const handleLineItemChange = async (index: number, newItemId: string) => {
    if (!newItemId) {
      setLines(prev =>
        prev.map((line, idx) =>
          idx === index ? { ...createEmptyVoucherLine('row'), id: line.id } : line
        )
      );
      return;
    }

    const item = uniqueItemsList.find(i => i.id === newItemId);
    if (!item) return;

    let prefilledRate = item.mrp
      ? parseFloat(item.mrp)
      : item.standardSellingPrice
      ? parseFloat(item.standardSellingPrice)
      : 450;

    if (selectedPartyId) {
      try {
        const priceData = await apiRequest<any>(
          `/api/sales/pricing/${selectedPartyId}/${item.id}`
        );
        if (priceData && priceData.lastSalePrice !== null) {
          prefilledRate = parseFloat(priceData.lastSalePrice);
        }
      } catch {
        // ignore
      }
    }

    const itemMaintainBatches = item.maintainBatches !== false;
    const existingLine = lines[index];
    const isSameItem = existingLine && existingLine.uniqueItemId === item.id;
    const existingBatches = isSameItem ? existingLine.batches : [];
    const existingQty =
      isSameItem && existingLine.quantity > 0
        ? existingLine.quantity
        : itemMaintainBatches
        ? 0
        : existingLine && existingLine.quantity > 0
        ? existingLine.quantity
        : 1;

    setLines(prev =>
      prev.map((line, idx) =>
        idx === index
          ? {
              ...line,
              uniqueItemId: item.id,
              uniqueItemName: item.name,
              uniqueItemCode: item.code,
              categoryCode: item.categoryCode || item.category?.code || 'SV',
              maintainBatches: itemMaintainBatches,
              rate: prefilledRate,
              gstRate:
                item.gstRate !== undefined
                  ? parseFloat(String(item.gstRate))
                  : item.taxRate
                  ? parseFloat(item.taxRate)
                  : 5,
              batches: existingBatches,
              quantity: existingQty,
            }
          : line
      )
    );

    // Auto-open batch allocation popup if maintainBatches is YES
    if (itemMaintainBatches) {
      setActiveBatchModalIndex(index);
      if (lines[index]) {
        setActiveBatchLineId(lines[index].id);
      }
    }
  };

  const handleLineBatchApply = (
    index: number,
    allocatedBatches: BatchAllocation[],
    totalQty?: number
  ) => {
    const targetId = activeBatchLineId || (lines[index] ? lines[index].id : null);
    setLines(prev => {
      const updated = prev.map((line, idx) => {
        const isTarget = targetId ? line.id === targetId : idx === index;
        if (!isTarget) return line;
        const newQty = totalQty !== undefined && totalQty > 0 ? totalQty : line.quantity;
        return {
          ...line,
          batches: allocatedBatches,
          quantity: newQty,
        };
      });
      // Guarantee next empty row exists immediately after completing batch line
      return ensureTrailingBlankRow(updated, 'row');
    });

    setActiveBatchModalIndex(null);
    setActiveBatchLineId(null);

    // Auto-focus rate field on the line that was just allocated
    setTimeout(() => {
      const focusIndex = targetId ? lines.findIndex(l => l.id === targetId) : index;
      if (focusIndex >= 0) {
        setFocusRequest({ row: focusIndex, col: 'rate', key: Date.now() });
      }
    }, 60);
  };

  // Barcode Lookup Fast Entry
  const handleBarcodeLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    setBarcodeLoading(true);
    setBarcodeMsg(null);
    try {
      const data = await apiRequest<any>(
        `/api/sales/barcode-lookup/${encodeURIComponent(barcodeInput.trim())}`
      );
      const batch = data.batch;
      const uItem = data.uniqueItem;

      if (!uItem) {
        throw new Error('No product linked to this barcode');
      }

      // Check if already in lines
      const existingIdx = lines.findIndex(l => l.uniqueItemId === uItem.id);

      if (existingIdx >= 0) {
        // Increment quantity or add this batch allocation to the existing stock item line
        setLines(prev =>
          prev.map((l, i) => {
            if (i !== existingIdx) return l;
            const batchList = [...(l.batches || [])];
            const bIdx = batchList.findIndex(b => b.batchId === batch?.id);
            if (bIdx >= 0) {
              batchList[bIdx] = {
                ...batchList[bIdx],
                quantity: batchList[bIdx].quantity + 1,
              };
            } else if (batch) {
              batchList.push({
                batchId: batch.id,
                sph: batch.sph || '0.00',
                cyl: batch.cyl || '0.00',
                axis: batch.axis || '',
                add: batch.add || '',
                side: batch.side || 'NONE',
                quantity: 1,
                barcode: batch.barcode,
                availableStock: parseFloat(
                  batch.availableStock || batch.quantityRemaining || 0
                ),
              });
            }
            const newTotalQty = batchList.reduce((s, b) => s + b.quantity, 0);
            return {
              ...l,
              batches: batchList,
              quantity: newTotalQty,
            };
          })
        );
        setBarcodeMsg({
          type: 'success',
          text: `Allocated barcode power to ${uItem.name}`,
        });
      } else {
        // Add new line
        let prefilledRate = uItem.mrp ? parseFloat(uItem.mrp) : 450;
        if (selectedPartyId) {
          try {
            const priceData = await apiRequest<any>(
              `/api/sales/pricing/${selectedPartyId}/${uItem.id}`
            );
            if (priceData?.lastSalePrice)
              prefilledRate = parseFloat(priceData.lastSalePrice);
          } catch {
            // ignore
          }
        }

        const newLine: VoucherLineItem = {
          id: `row-${Date.now()}`,
          uniqueItemId: uItem.id,
          uniqueItemName: uItem.name,
          uniqueItemCode: uItem.code,
          categoryCode: uItem.categoryCode || 'SV',
          maintainBatches: uItem.maintainBatches !== false,
          quantity: 1,
          rate: prefilledRate,
          discountType: 'NONE',
          discountValue: 0,
          gstRate: uItem.gstRate !== undefined ? parseFloat(String(uItem.gstRate)) : (uItem.taxRate ? parseFloat(uItem.taxRate) : 5),
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
                  availableStock: parseFloat(
                    batch.availableStock || batch.quantityRemaining || 0
                  ),
                },
              ]
            : [],
        };
        setLines(prev => [...prev, newLine]);
        setBarcodeMsg({
          type: 'success',
          text: `Added ${uItem.name} [SPH ${batch?.sph || '0.00'}]`,
        });
      }
      setBarcodeInput('');
    } catch (err: any) {
      setBarcodeMsg({
        type: 'error',
        text: err.message || 'Barcode lookup failed',
      });
    } finally {
      setBarcodeLoading(false);
    }
  };

  // Calculations
  const computedLines: ComputedVoucherLine[] = lines.map(line => {
    const gross = (line.quantity || 0) * (line.rate || 0);
    const disc =
      line.discountType === 'PERCENTAGE'
        ? (gross * (line.discountValue || 0)) / 100
        : line.discountType === 'FIXED'
        ? Math.min(gross, line.discountValue || 0)
        : (gross * (line.discountValue || 0)) / 100; // treat raw number as % if default
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
  const totalQuantity = lines.reduce((acc, l) => acc + (l.quantity || 0), 0);

  const totals: VoucherTotals = {
    subtotal,
    discountTotal,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTax,
    roundOff,
    grandTotal,
    totalQuantity,
    totalItems: lines.filter(l => !isVoucherLineEmpty(l)).length,
  };

  // Save Voucher (DRAFT or POSTED)
  const handleSaveVoucher = async (targetStatus: 'DRAFT' | 'POSTED') => {
    setFormError(null);

    if (!selectedPartyId) {
      setFormError('Please select a Customer / Party to create the invoice.');
      return;
    }

    const nonBlankLines = lines.filter(l => !isVoucherLineEmpty(l));

    if (nonBlankLines.length === 0) {
      setFormError('Invoice must contain at least one stock item line.');
      return;
    }

    for (let i = 0; i < nonBlankLines.length; i++) {
      const l = nonBlankLines[i];
      const lineNum = i + 1;
      const itemName = l.uniqueItemName || 'Item';

      if (!l.uniqueItemId) {
        setFormError(`Line #${lineNum}: Stock Item is required.`);
        return;
      }

      if (l.maintainBatches !== false) {
        if (!l.batches || l.batches.length === 0) {
          setFormError(`Line #${lineNum} (${itemName}): Batch allocations are required. Please allocate at least one batch.`);
          return;
        }
        const batchSum = l.batches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
        if (batchSum <= 0 || Math.abs(batchSum - l.quantity) > 0.001) {
          setFormError(`Line #${lineNum} (${itemName}): Sum of batch quantities (${batchSum.toFixed(2)}) must match line quantity (${l.quantity.toFixed(2)}).`);
          return;
        }
      }

      if (l.quantity <= 0) {
        setFormError(
          `Line #${lineNum} (${itemName}) has invalid quantity (${l.quantity}). Must be ≥ 0.5.`
        );
        return;
      }
      if (l.rate < 0) {
        setFormError(`Line #${lineNum} (${itemName}) has negative unit price.`);
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
          ? `${notes.trim()} | Payment Mode: ${paymentMode} | Terms: ${paymentTerms}${
              referenceNumber ? ` | Ref: ${referenceNumber}` : ''
            }`
          : `Payment Mode: ${paymentMode} | Terms: ${paymentTerms}${
              referenceNumber ? ` | Ref: ${referenceNumber}` : ''
            }`,
        lines: nonBlankLines.map(l => ({
          uniqueItemId: l.uniqueItemId,
          quantity: l.quantity,
          rate: l.rate,
          discountType: l.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
          discountValue: l.discountValue,
          gstRate: gstMode === 'EXEMPT' ? 0 : l.gstRate,
          batches:
            l.batches && l.batches.length > 0
              ? l.batches.map(b => ({
                  batchId: b.batchId,
                  sph: b.sph,
                  cyl: b.cyl,
                  axis: b.axis,
                  add: b.add,
                  side: b.side,
                  quantity: b.quantity,
                  rate: b.rate !== undefined ? b.rate : l.rate,
                }))
              : undefined,
        })),
      };

      const endpoint = editInvoiceId ? `/api/sales/invoices/${editInvoiceId}` : '/api/sales/invoices';
      const method = editInvoiceId ? 'PUT' : 'POST';

      const result = await apiRequest<any>(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      setCreatedInvoice(result);
      setShowPrintModal(true);
      if (onSuccess) {
        onSuccess(result.id);
      }
    } catch (err: any) {
      console.error('Save invoice error:', err);
      setFormError(
        err.message ||
          'Failed to save sales invoice. Please check batch quantities and try again.'
      );
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
    setLines([createEmptyVoucherLine('row')]);
    setFormError(null);
    loadPrerequisites();
  };

  const handleRemoveLine = (index: number) => {
    setLines(prev => {
      const updated = prev.filter((_, idx) => idx !== index);
      if (updated.length === 0) {
        return [createEmptyVoucherLine('row')];
      }
      return updated;
    });
  };

  return (
    <div
      id="normal-sales-voucher-page"
      className="flex flex-col h-full w-full bg-slate-100 border border-slate-300 rounded-md overflow-hidden select-none font-sans"
    >
      {/* 1. Tally-style Voucher Header */}
      <VoucherHeader
        voucherType="SALES"
        voucherNumber={invoiceNumber}
        onVoucherNumberChange={setInvoiceNumber}
        voucherDate={invoiceDate}
        onVoucherDateChange={setInvoiceDate}
        parties={parties}
        selectedPartyId={selectedPartyId}
        onPartyChange={handlePartyChange}
        partyBalance={
          partyCreditInfo
            ? {
                balance: parseFloat(partyCreditInfo.outstandingBalance || 0),
                type: 'Dr',
                isOverLimit: partyCreditInfo.isCreditLimitExceeded,
                creditLimit: partyCreditInfo.creditLimit,
              }
            : undefined
        }
        gstMode={gstMode}
        onGstModeChange={setGstMode}
        referenceNumber={referenceNumber}
        onReferenceNumberChange={setReferenceNumber}
        barcodeInput={barcodeInput}
        onBarcodeInput={setBarcodeInput}
        onBarcodeSubmit={handleBarcodeLookup}
        barcodeLoading={barcodeLoading}
        barcodeMsg={barcodeMsg}
        submitting={submitting}
        onSaveDraft={() => handleSaveVoucher('DRAFT')}
        onSavePost={() => handleSaveVoucher('POSTED')}
        onBack={() => (onBack ? onBack() : onNavigate ? onNavigate('/sales/invoices') : window.history.back())}
      />

      {/* 2. Dominant Item Grid (65-75% screen height) */}
      <div className="flex-1 min-h-0 p-1 flex flex-col">
        <VoucherItemGrid
          voucherType="SALES"
          lines={lines}
          computedLines={computedLines}
          allItems={uniqueItemsList}
          focusRequest={focusRequest}
          onItemSelect={handleLineItemChange}
          onBatchClick={idx => {
            setActiveBatchModalIndex(idx);
            if (lines[idx]) {
              setActiveBatchLineId(lines[idx].id);
            }
          }}
          onQuantityChange={(idx, qty) => {
            setLines(prev =>
              prev.map((l, i) =>
                i === idx
                  ? {
                      ...l,
                      quantity: qty,
                      batches:
                        l.batches.length === 1
                          ? [{ ...l.batches[0], quantity: qty }]
                          : l.batches,
                    }
                  : l
              )
            );
          }}
          onRateChange={(idx, rate) => {
            setLines(prev =>
              prev.map((l, i) => (i === idx ? { ...l, rate: rate } : l))
            );
          }}
          onDiscountChange={(idx, disc) => {
            setLines(prev =>
              prev.map((l, i) => (i === idx ? { ...l, discountValue: disc } : l))
            );
          }}
          onGstRateChange={(idx, gst) => {
            setLines(prev =>
              prev.map((l, i) => (i === idx ? { ...l, gstRate: gst } : l))
            );
          }}
          onRemoveLine={handleRemoveLine}
          onAddBlankLine={handleAddBlankLine}
        />
      </div>

      {/* 3. Tally-style Voucher Footer */}
      <VoucherFooter
        voucherType="SALES"
        totals={totals}
        gstMode={gstMode}
        narration={notes}
        onNarrationChange={setNotes}
        paymentMode={paymentMode}
        onPaymentModeChange={setPaymentMode}
        paymentTerms={paymentTerms}
        onPaymentTermsChange={terms => {
          setPaymentTerms(terms);
          updateDueDate(invoiceDate, terms);
        }}
        dueDate={dueDate}
        onDueDateChange={setDueDate}
        errorMessage={formError}
      />

      {/* 4. Optical Batch Power Allocation Modal */}
      {activeBatchModalIndex !== null && activeBatchLine && (
        <OpticalBatchModal
          isOpen={true}
          onClose={() => {
            setActiveBatchModalIndex(null);
            setActiveBatchLineId(null);
          }}
          onApply={(batches, totalQty) => {
            handleLineBatchApply(activeBatchModalIndex, batches, totalQty);
          }}
          mode="sales"
          itemName={activeBatchLine.uniqueItemName}
          itemCode={activeBatchLine.uniqueItemCode}
          uniqueItemId={activeBatchLine.uniqueItemId}
          categoryCode={activeBatchLine.categoryCode}
          initialBatches={activeBatchLine.batches}
          availableBatches={activeBatchLine.availableBatches || []}
          lineQuantity={activeBatchLine.quantity}
          lineRate={activeBatchLine.rate}
        />
      )}

      {/* 5. Invoice Created & Print Preview Modal */}
      {showPrintModal && createdInvoice && (
        <div
          id="modal-invoice-created"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in"
        >
          <div className="bg-white rounded-xl max-w-xl w-full p-5 shadow-2xl border border-slate-300 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Sales Voucher Saved Successfully!
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Voucher #{createdInvoice.invoiceNumber} • Status: {createdInvoice.status}
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

            <div className="p-3 bg-slate-50 rounded-md border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer A/c:</span>
                <span className="font-bold text-slate-900">
                  {createdInvoice.partyName || selectedParty?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice Date:</span>
                <span className="font-mono">
                  {new Date(createdInvoice.invoiceDate).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice Total:</span>
                <span className="font-mono font-bold text-emerald-700 text-sm">
                  ₹{parseFloat(createdInvoice.grandTotal || grandTotal).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Stock &amp; Ledger:</span>
                <span className="text-emerald-600 font-semibold">
                  {createdInvoice.status === 'POSTED'
                    ? '✓ Stock Deducted & Customer Ledger Debited'
                    : 'Draft Saved (Stock Reserved)'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                id="btn-print-tax-invoice"
                onClick={() => window.print()}
                className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
              >
                <Printer className="w-4 h-4 text-slate-600" />
                Print Voucher
              </button>

              <div className="flex items-center gap-2">
                <button
                  id="btn-create-another-voucher"
                  onClick={handleResetForm}
                  className="px-3.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                >
                  Create Another Voucher
                </button>
                <button
                  id="btn-go-to-invoices-register"
                  onClick={() =>
                    onNavigate ? onNavigate('/sales/invoices') : window.history.back()
                  }
                  className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shadow-xs"
                >
                  View Invoices Register
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
