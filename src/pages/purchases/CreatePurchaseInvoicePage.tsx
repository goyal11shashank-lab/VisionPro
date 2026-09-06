import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiRequest } from '../../api/client';
import { Party, UniqueItem } from '../../types/index';
import { VoucherHeader } from '../../components/voucher/VoucherHeader';
import { VoucherItemGrid } from '../../components/voucher/VoucherItemGrid';
import { VoucherFooter } from '../../components/voucher/VoucherFooter';
import { OpticalBatchModal } from '../../components/voucher/OpticalBatchModal';
import {
  VoucherLineItem,
  ComputedVoucherLine,
  VoucherTotals,
  BatchAllocation,
} from '../../components/voucher/VoucherTypes';

interface Props {
  editInvoiceId?: string | null;
  onBack: () => void;
  onSuccess: (invoiceId: string) => void;
}

export const CreatePurchaseInvoicePage: React.FC<Props> = ({
  editInvoiceId,
  onBack,
  onSuccess,
}) => {
  // Master Data
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [uniqueItemsList, setUniqueItemsList] = useState<UniqueItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [existingInvoiceNumber, setExistingInvoiceNumber] = useState<string>('');
  const [existingStatus, setExistingStatus] = useState<string>('');

  // Form State
  const [supplierPartyId, setSupplierPartyId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState<string>('');
  const [gstMode, setGstMode] = useState<'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT'>(
    'INTRA_STATE'
  );
  const [notes, setNotes] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<string>('CREDIT');
  const [paymentTerms, setPaymentTerms] = useState<string>('NET 30');
  const [dueDate, setDueDate] = useState<string>('');

  // Lines
  const [lines, setLines] = useState<VoucherLineItem[]>([]);

  // Optical Batch Modal state
  const [activeBatchModalIndex, setActiveBatchModalIndex] = useState<number | null>(
    null
  );

  // Barcode Scanner Quick Entry
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [barcodeLoading, setBarcodeLoading] = useState<boolean>(false);
  const [barcodeMsg, setBarcodeMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load suppliers, unique items, and existing invoice if editing
  useEffect(() => {
    const loadData = async () => {
      setLoadingInitial(true);
      try {
        const [supData, itemData] = await Promise.all([
          apiRequest<{ parties: Party[] }>('/api/parties?partyType=SUPPLIER&limit=100').catch(
            () => ({ parties: [] })
          ),
          apiRequest<UniqueItem[]>('/api/unique-items').catch(() => []),
        ]);

        const allSuppliers = supData.parties || [];
        setSuppliers(allSuppliers);
        const items = itemData || [];
        setUniqueItemsList(items);

        if (editInvoiceId) {
          const inv = await apiRequest<any>(`/api/purchases/invoices/${editInvoiceId}`);
          if (inv) {
            setExistingInvoiceNumber(inv.invoiceNumber);
            setExistingStatus(inv.status);
            setSupplierPartyId(inv.supplierPartyId || (inv.supplier?.id ?? ''));
            if (inv.invoiceDate) {
              setInvoiceDate(new Date(inv.invoiceDate).toISOString().split('T')[0]);
            }
            setSupplierInvoiceNumber(inv.supplierInvoiceNumber || '');
            if (inv.supplierInvoiceDate) {
              setSupplierInvoiceDate(
                new Date(inv.supplierInvoiceDate).toISOString().split('T')[0]
              );
            }
            setGstMode(inv.gstMode || 'INTRA_STATE');
            setNotes(inv.notes || '');

            if (inv.lines && inv.lines.length > 0) {
              const loadedLines: VoucherLineItem[] = inv.lines.map((l: any, i: number) => ({
                id: `edit-row-${i}`,
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
                  sph: parseFloat(b.batch?.sph ?? b.sph ?? 0),
                  cyl: parseFloat(b.batch?.cyl ?? b.cyl ?? 0),
                  axis: parseFloat(b.batch?.axis ?? b.axis ?? 0),
                  add: parseFloat(b.batch?.add ?? b.add ?? 0),
                  side: b.batch?.side || b.side || 'NONE',
                  quantity: parseFloat(b.quantity) || 1,
                  rate: parseFloat(b.rate ?? l.rate ?? 0),
                })),
              }));
              setLines(loadedLines);
            }
          }
        } else {
          if (allSuppliers.length > 0) {
            setSupplierPartyId(allSuppliers[0].id);
          }
          if (items.length > 0) {
            const first = items[0];
            const defaultRate = first.lastPurchasePrice
              ? parseFloat(first.lastPurchasePrice as any)
              : 250;
            const itemMaintainBatches = first.maintainBatches !== false;

            setLines([
              {
                id: 'p-row-1',
                uniqueItemId: first.id,
                uniqueItemName: first.name,
                uniqueItemCode: first.code,
                categoryCode: (first as any).categoryCode || (first as any).category?.code || 'SV',
                maintainBatches: itemMaintainBatches,
                quantity: 1,
                rate: defaultRate,
                discountType: 'NONE',
                discountValue: 0,
                gstRate: (first as any).taxRate ? parseFloat((first as any).taxRate) : 12,
                batches: itemMaintainBatches
                  ? [
                      {
                        sph: '0.00',
                        cyl: '0.00',
                        axis: '',
                        add: '',
                        side: 'NONE',
                        quantity: 1,
                        rate: defaultRate,
                      },
                    ]
                  : [],
              },
            ]);
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load master items for purchase form');
      } finally {
        setLoadingInitial(false);
      }
    };
    loadData();
  }, [editInvoiceId]);

  // Add a blank row
  const handleAddBlankLine = () => {
    if (uniqueItemsList.length === 0) return;
    const first = uniqueItemsList[0];
    const defaultRate = first.lastPurchasePrice
      ? parseFloat(first.lastPurchasePrice as any)
      : 250;
    const itemMaintainBatches = first.maintainBatches !== false;

    const newLine: VoucherLineItem = {
      id: `p-row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      uniqueItemId: first.id,
      uniqueItemName: first.name,
      uniqueItemCode: first.code,
      categoryCode: (first as any).categoryCode || (first as any).category?.code || 'SV',
      maintainBatches: itemMaintainBatches,
      quantity: 1,
      rate: defaultRate,
      discountType: 'NONE',
      discountValue: 0,
      gstRate: (first as any).taxRate ? parseFloat((first as any).taxRate) : 12,
      batches: itemMaintainBatches
        ? [
            {
              sph: '0.00',
              cyl: '0.00',
              axis: '',
              add: '',
              side: 'NONE',
              quantity: 1,
              rate: defaultRate,
            },
          ]
        : [],
    };
    setLines(prev => [...prev, newLine]);
  };

  // Select Item for a row
  const handleLineItemChange = (index: number, newItemId: string) => {
    const item = uniqueItemsList.find(i => i.id === newItemId);
    if (!item) return;

    const defaultRate = item.lastPurchasePrice
      ? parseFloat(item.lastPurchasePrice as any)
      : 250;
    const itemMaintainBatches = item.maintainBatches !== false;

    setLines(prev =>
      prev.map((line, idx) =>
        idx === index
          ? {
              ...line,
              uniqueItemId: item.id,
              uniqueItemName: item.name,
              uniqueItemCode: item.code,
              categoryCode:
                (item as any).categoryCode || (item as any).category?.code || 'SV',
              maintainBatches: itemMaintainBatches,
              rate: defaultRate,
              gstRate: (item as any).taxRate ? parseFloat((item as any).taxRate) : 12,
              batches: itemMaintainBatches
                ? [
                    {
                      sph: '0.00',
                      cyl: '0.00',
                      axis: '',
                      add: '',
                      side: 'NONE',
                      quantity: line.quantity || 1,
                      rate: defaultRate,
                    },
                  ]
                : [],
            }
          : line
      )
    );
  };

  // Barcode Lookup Fast Add
  const handleBarcodeLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    setBarcodeLoading(true);
    setBarcodeMsg(null);
    try {
      const data = await apiRequest<any>(
        `/api/purchases/barcode-lookup/${encodeURIComponent(barcodeInput.trim())}`
      );
      const batch = data.batch;
      const uItem = data.uniqueItem;

      if (!uItem) {
        throw new Error('Barcode does not match any known stock item');
      }

      const defaultRate = batch.rate
        ? Number(batch.rate)
        : uItem.lastPurchasePrice
        ? Number(uItem.lastPurchasePrice)
        : 250;

      const existingIdx = lines.findIndex(l => l.uniqueItemId === uItem.id);

      if (existingIdx >= 0) {
        const line = lines[existingIdx];
        const existingBatchIdx = line.batches.findIndex(
          b => b.batchId === batch.id
        );

        let updatedBatches = [...line.batches];
        if (existingBatchIdx >= 0) {
          updatedBatches[existingBatchIdx].quantity += 1;
        } else {
          updatedBatches.push({
            batchId: batch.id,
            sph: Number(batch.sph),
            cyl: Number(batch.cyl),
            axis: Number(batch.axis),
            add: Number(batch.add),
            side: batch.side || 'NONE',
            quantity: 1,
            rate: defaultRate,
          });
        }

        setLines(prev =>
          prev.map((l, i) =>
            i === existingIdx
              ? {
                  ...l,
                  quantity: l.quantity + 1,
                  batches: updatedBatches,
                }
              : l
          )
        );
      } else {
        const newLine: VoucherLineItem = {
          id: `p-row-${Date.now()}`,
          uniqueItemId: uItem.id,
          uniqueItemName: uItem.name,
          uniqueItemCode: uItem.code,
          categoryCode: uItem.categoryCode || 'SV',
          maintainBatches: uItem.maintainBatches !== false,
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
              side: batch.side || 'NONE',
              quantity: 1,
              rate: defaultRate,
            },
          ],
        };
        setLines(prev => [...prev, newLine]);
      }

      setBarcodeMsg({
        type: 'success',
        text: `Matched: ${uItem.name} [SPH ${batch.sph || '0.00'} CYL ${batch.cyl || '0.00'}]`,
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

  // Calculations
  const computedLines: ComputedVoucherLine[] = lines.map(line => {
    const gross = (line.quantity || 0) * (line.rate || 0);
    const disc =
      line.discountType === 'PERCENTAGE'
        ? (gross * (line.discountValue || 0)) / 100
        : line.discountType === 'FIXED'
        ? Math.min(gross, line.discountValue || 0)
        : (gross * (line.discountValue || 0)) / 100;
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
    totalItems: lines.length,
  };

  // Save / Post Invoice
  const handleSaveInvoice = async (andPost: boolean = false) => {
    if (existingStatus === 'CANCELLED') {
      setError(
        'Cannot edit this Purchase Invoice because it has been CANCELLED. Cancelled invoices are permanently read-only.'
      );
      return;
    }
    if (!supplierPartyId) {
      setError('Please select a Supplier A/c Name');
      return;
    }
    if (lines.length === 0) {
      setError('Invoice must contain at least 1 line item');
      return;
    }

    // Validate batch sums
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.maintainBatches && line.batches.length > 0) {
        const sumBatches = line.batches.reduce(
          (sum, b) => sum + Number(b.quantity),
          0
        );
        if (Math.abs(sumBatches - line.quantity) > 0.001) {
          setError(
            `Line ${i + 1} (${line.uniqueItemName}): Sum of batch quantities (${sumBatches}) must equal line quantity (${line.quantity})`
          );
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
        supplierInvoiceDate: supplierInvoiceDate
          ? new Date(supplierInvoiceDate)
          : undefined,
        gstMode,
        notes: notes.trim()
          ? `${notes.trim()} | Payment: ${paymentMode} | Terms: ${paymentTerms}`
          : `Payment: ${paymentMode} | Terms: ${paymentTerms}`,
        status: andPost ? 'POSTED' : 'DRAFT',
        lines: lines.map(l => ({
          uniqueItemId: l.uniqueItemId,
          quantity: l.quantity,
          rate: l.rate,
          discountType: l.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
          discountValue: l.discountValue,
          gstRate: gstMode === 'EXEMPT' ? 0 : l.gstRate,
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

      let resultId = editInvoiceId;

      if (editInvoiceId) {
        const updated = await apiRequest<{ id: string; invoiceNumber: string }>(
          `/api/purchases/invoices/${editInvoiceId}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
        resultId = updated.id;
      } else {
        const created = await apiRequest<{ id: string; invoiceNumber: string }>(
          '/api/purchases/invoices',
          {
            method: 'POST',
            body: JSON.stringify(payload),
          }
        );
        resultId = created.id;

        if (andPost) {
          await apiRequest(`/api/purchases/invoices/${created.id}/post`, {
            method: 'POST',
          });
        }
      }

      onSuccess(resultId!);
    } catch (err: any) {
      setError(err.message || 'Failed to save purchase invoice');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingInitial) {
    return (
      <div className="h-96 flex flex-col items-center justify-center gap-3 text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="text-sm font-medium">
          Loading procurement items and supplier directory...
        </span>
      </div>
    );
  }

  const activeBatchLine =
    activeBatchModalIndex !== null ? lines[activeBatchModalIndex] : null;

  return (
    <div
      id="normal-purchase-voucher-page"
      className="flex flex-col h-full w-full bg-slate-100 border border-slate-300 rounded-md overflow-hidden select-none font-sans"
    >
      {/* 1. Tally-style Voucher Header */}
      <VoucherHeader
        voucherType="PURCHASE"
        isEditing={!!editInvoiceId}
        voucherNumber={existingInvoiceNumber || 'AUTO'}
        voucherDate={invoiceDate}
        onVoucherDateChange={setInvoiceDate}
        parties={suppliers}
        selectedPartyId={supplierPartyId}
        onPartyChange={setSupplierPartyId}
        gstMode={gstMode}
        onGstModeChange={setGstMode}
        referenceNumber={supplierInvoiceNumber}
        onReferenceNumberChange={setSupplierInvoiceNumber}
        supplierInvoiceDate={supplierInvoiceDate}
        onSupplierInvoiceDateChange={setSupplierInvoiceDate}
        barcodeInput={barcodeInput}
        onBarcodeInput={setBarcodeInput}
        onBarcodeSubmit={handleBarcodeLookup}
        barcodeLoading={barcodeLoading}
        barcodeMsg={barcodeMsg}
        submitting={submitting}
        onSaveDraft={() => handleSaveInvoice(false)}
        onSavePost={() => handleSaveInvoice(true)}
        onBack={onBack}
      />

      {/* 2. Dominant Item Grid (65-75% screen height) */}
      <div className="flex-1 min-h-0 p-1 flex flex-col">
        <VoucherItemGrid
          voucherType="PURCHASE"
          lines={lines}
          computedLines={computedLines}
          allItems={uniqueItemsList}
          onItemSelect={handleLineItemChange}
          onBatchClick={idx => setActiveBatchModalIndex(idx)}
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
          onRemoveLine={idx => {
            setLines(prev => prev.filter((_, i) => i !== idx));
          }}
          onAddBlankLine={handleAddBlankLine}
        />
      </div>

      {/* 3. Tally-style Voucher Footer */}
      <VoucherFooter
        voucherType="PURCHASE"
        totals={totals}
        gstMode={gstMode}
        narration={notes}
        onNarrationChange={setNotes}
        paymentMode={paymentMode}
        onPaymentModeChange={setPaymentMode}
        paymentTerms={paymentTerms}
        onPaymentTermsChange={setPaymentTerms}
        dueDate={dueDate}
        onDueDateChange={setDueDate}
        errorMessage={error}
      />

      {/* 4. Optical Batch Power Allocation Modal */}
      {activeBatchModalIndex !== null && activeBatchLine && (
        <OpticalBatchModal
          isOpen={true}
          onClose={() => setActiveBatchModalIndex(null)}
          onApply={(batches, totalQty) => {
            setLines(prev =>
              prev.map((l, i) =>
                i === activeBatchModalIndex
                  ? {
                      ...l,
                      batches: batches,
                      quantity: totalQty !== undefined && totalQty > 0 ? totalQty : l.quantity,
                    }
                  : l
              )
            );
          }}
          mode="purchase"
          itemName={activeBatchLine.uniqueItemName}
          categoryCode={activeBatchLine.categoryCode}
          initialBatches={activeBatchLine.batches}
          availableBatches={[]}
          lineQuantity={activeBatchLine.quantity}
          lineRate={activeBatchLine.rate}
        />
      )}
    </div>
  );
};
