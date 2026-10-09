import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileSpreadsheet,
  ArrowLeft,
  Printer,
  CheckCircle2,
  AlertTriangle,
  ShoppingCart,
  Trash2,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBusinessSettings } from '../../context/BusinessSettingsContext';
import { apiRequest } from '../../api/client';
import { VoucherHeader } from '../../components/voucher/VoucherHeader';
import { VoucherItemGrid } from '../../components/voucher/VoucherItemGrid';
import { VoucherFooter } from '../../components/voucher/VoucherFooter';
import { OpticalBatchModal } from '../../components/voucher/OpticalBatchModal';
import {
  TallyContextualPanel,
  ContextualPanelItem,
} from '../../components/voucher/TallyContextualPanel';
import {
  VoucherLineItem,
  ComputedVoucherLine,
  VoucherTotals,
  BatchAllocation,
  createEmptyVoucherLine,
  isVoucherLineEmpty,
  ensureTrailingBlankRow,
} from '../../components/voucher/VoucherTypes';
import { PrintPreviewModal } from '../../components/print/PrintPreviewModal';
import { PrintableVoucher } from '../../components/print/PrintableVoucher';
import { cleanNarrationNotes } from '../../utils/narrationHelper';
import { validateQuantity } from '../../utils/quantityValidator';

interface Props {
  onNavigate?: (path: string) => void;
  onSuccess?: (invoiceId: string) => void;
  editInvoiceId?: string | null;
  orderId?: string | null;
  onBack?: () => void;
}

export const NormalSalesVoucherPage: React.FC<Props> = ({ onNavigate, onSuccess, editInvoiceId, orderId, onBack }) => {
  const { currentBusiness, hasPermission } = useAuth();
  const { settings } = useBusinessSettings();

  // Master Data
  const [parties, setParties] = useState<any[]>([]);
  const [uniqueItemsList, setUniqueItemsList] = useState<any[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [autoInvokePrint, setAutoInvokePrint] = useState<boolean>(false);

  // Voucher Header State
  const detectedOrderId = (() => {
    if (orderId) return orderId;
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      return sp.get('orderId') || null;
    }
    return null;
  })();

  const [convertingOrderId, setConvertingOrderId] = useState<string | null>(detectedOrderId);
  const [convertedOrderNumber, setConvertedOrderNumber] = useState<string | null>(null);

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
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState<boolean>(false);

  // User Permissions
  const canDelete = Boolean(
    hasPermission('sales:delete') ||
    hasPermission('sales.delete') ||
    hasPermission('sales:invoice:delete') ||
    hasPermission('admin')
  );
  const canCancel = Boolean(
    hasPermission('sales:cancel') ||
    hasPermission('sales.cancel') ||
    hasPermission('sales:edit') ||
    hasPermission('sales.edit') ||
    hasPermission('admin')
  );

  // Tally Contextual Panel State
  const [contextualType, setContextualType] = useState<'PARTY' | 'STOCK_ITEM' | 'BATCH' | null>(null);
  const [contextualRowIndex, setContextualRowIndex] = useState<number | null>(null);
  const [contextualSearch, setContextualSearch] = useState<string>('');
  const [contextualSelectedIdx, setContextualSelectedIdx] = useState<number>(0);
  const [activeGridRow, setActiveGridRow] = useState<number>(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const openContextualParty = useCallback(() => {
    setContextualType('PARTY');
    setContextualRowIndex(null);
    setContextualSearch('');
    setContextualSelectedIdx(0);
  }, []);

  const openContextualItem = useCallback((rowIdx: number) => {
    setContextualType('STOCK_ITEM');
    setContextualRowIndex(rowIdx);
    setActiveGridRow(rowIdx);
    setContextualSearch('');
    setContextualSelectedIdx(0);
  }, []);

  const closeContextualPanel = useCallback(() => {
    setContextualType(null);
    setContextualRowIndex(null);
  }, []);

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
            setCreatedInvoice(inv);
            const partyId = inv.partyId || '';
            setSelectedPartyId(partyId);
            const foundParty = validCustomers.find((p: any) => p.id === partyId) || inv.party || null;
            setSelectedParty(foundParty);
            if (partyId) {
              apiRequest<any>(`/api/sales/parties/${partyId}/credit-check`)
                .then(creditRes => setPartyCreditInfo(creditRes))
                .catch(err => console.error('Credit check error:', err));
            }

            setInvoiceNumber(inv.invoiceNumber || '');
            if (inv.invoiceDate) setInvoiceDate(inv.invoiceDate.split('T')[0]);
            if (inv.dueDate) setDueDate(inv.dueDate.split('T')[0]);
            if (inv.gstMode) setGstMode(inv.gstMode);
            if (inv.paymentTerms) setPaymentTerms(inv.paymentTerms);
            if (inv.notes) {
              const refMatch = inv.notes.match(/Ref:\s*([^|]+)/i);
              if (refMatch && refMatch[1]) {
                setReferenceNumber(refMatch[1].trim());
              }
              const payModeMatch = inv.notes.match(/Payment Mode:\s*([^|]+)/i);
              if (payModeMatch && payModeMatch[1]) {
                setPaymentMode(payModeMatch[1].trim());
              }
              // Clean Payment Mode, Terms, and Ref out of narration state
              const cleanedNotes = cleanNarrationNotes(inv.notes)
                .replace(/(?:\|\s*)?Ref:\s*[^|]+/gi, '')
                .replace(/^[\s|]+|[\s|]+$/g, '')
                .trim();
              setNotes(cleanedNotes);
            }

            const loadedLines: VoucherLineItem[] = (inv.lines || []).map((l: any, i: number) => ({
              id: `row-${i}-${l.id || i}`,
              uniqueItemId: l.uniqueItemId,
              uniqueItemName: l.uniqueItem?.name || 'Item',
              uniqueItemCode: l.uniqueItem?.code || '',
              categoryCode: l.category?.code || l.uniqueItem?.categoryCode || 'SV',
              maintainBatches: l.uniqueItem?.maintainBatches !== false,
              unit: l.uniqueItem?.unit || 'PRS',
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
        } catch (err: any) {
          console.error('Failed to load edit invoice:', err);
          setFormError(err.message || 'Failed to load invoice for editing');
        }
      }

      // If converting an existing Sales Order, load sales order details, lines, and allocated batches
      if (!editInvoiceId && detectedOrderId) {
        try {
          const order = await apiRequest<any>(`/api/sales/orders/${detectedOrderId}`);
          if (order) {
            setConvertingOrderId(detectedOrderId);
            setConvertedOrderNumber(order.orderNumber || null);

            const partyId = order.partyId || '';
            if (partyId) {
              setSelectedPartyId(partyId);
              const foundParty = validCustomers.find((p: any) => p.id === partyId) || order.party || null;
              setSelectedParty(foundParty);
              apiRequest<any>(`/api/sales/parties/${partyId}/credit-check`)
                .then(creditRes => setPartyCreditInfo(creditRes))
                .catch(err => console.error('Credit check error:', err));
            }

            // Auto-detect GST Mode
            if (order.party?.state && currentBusiness?.state) {
              if (order.party.state.trim().toLowerCase() !== currentBusiness.state.trim().toLowerCase()) {
                setGstMode('INTER_STATE');
              } else {
                setGstMode('INTRA_STATE');
              }
            }

            if (order.paymentTerms) setPaymentTerms(order.paymentTerms);
            if (order.notes) setNotes(order.notes);
            if (order.orderNumber) setReferenceNumber(`SO: ${order.orderNumber}`);

            if (order.lines && order.lines.length > 0) {
              const loadedLines: VoucherLineItem[] = order.lines.map((l: any, idx: number) => {
                const batches: BatchAllocation[] = (l.batches || []).map((b: any) => ({
                  batchId: b.batchId || b.id,
                  sph: b.sph ?? '0.00',
                  cyl: b.cyl ?? '0.00',
                  axis: b.axis ?? '',
                  add: b.add ?? '',
                  side: b.side ?? 'NONE',
                  quantity: parseFloat(b.remainingReservedQty !== undefined ? b.remainingReservedQty : (b.quantity || '0')),
                  rate: parseFloat(b.rate !== undefined ? b.rate : (l.rate || '0')),
                  barcode: b.barcode || '',
                  availableStock: parseFloat(b.availableStock || b.quantity || '0'),
                }));

                const totalBatchQty = batches.reduce((sum, b) => sum + b.quantity, 0);
                const lineQty = batches.length > 0 ? totalBatchQty : parseFloat(l.quantity || '0');

                return {
                  id: `so-line-${idx}-${Date.now()}`,
                  uniqueItemId: l.uniqueItemId,
                  uniqueItemName: l.uniqueItemName || l.uniqueItem?.name || 'Stock Item',
                  uniqueItemCode: l.uniqueItemCode || l.uniqueItem?.code || '',
                  categoryCode: l.uniqueItem?.categoryCode || 'SV',
                  unit: l.unit || l.uniqueItem?.unit || 'PRS',
                  maintainBatches: l.uniqueItem?.maintainBatches !== false,
                  quantity: lineQty,
                  rate: parseFloat(l.rate || '0'),
                  discountType: l.discountType || 'NONE',
                  discountValue: parseFloat(l.discountValue || '0'),
                  gstRate: parseFloat(l.gstRate || '5'),
                  batches,
                };
              });

              setLines(ensureTrailingBlankRow(loadedLines, 'row'));
              return;
            }
          }
        } catch (err: any) {
          console.error('Failed to load sales order for conversion:', err);
          setFormError(err.message || 'Failed to load sales order for conversion');
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
  }, [currentBusiness?.id, editInvoiceId, detectedOrderId]);

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
              unit: (item as any).unit || 'PRS',
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
        for (const b of l.batches) {
          const bVal = validateQuantity(b.quantity, l.unit || 'PRS');
          if (!bVal.valid) {
            setFormError(`Line #${lineNum} (${itemName}) batch allocation: ${bVal.error}`);
            return;
          }
        }
      }

      const qVal = validateQuantity(l.quantity, l.unit || 'PRS');
      if (!qVal.valid) {
        setFormError(`Line #${lineNum} (${itemName}): ${qVal.error}`);
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
        salesOrderId: convertingOrderId || undefined,
        partyId: selectedPartyId,
        invoiceNumber: invoiceNumber.trim() || undefined,
        invoiceDate: invoiceDate,
        gstMode: gstMode,
        status: targetStatus,
        notes: (() => {
          const cleaned = cleanNarrationNotes(notes);
          return cleaned
            ? `${cleaned}${referenceNumber ? ` | Ref: ${referenceNumber}` : ''}`
            : (referenceNumber ? `Ref: ${referenceNumber}` : undefined);
        })(),
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

      const endpoint = editInvoiceId
        ? `/api/sales/invoices/${editInvoiceId}`
        : convertingOrderId
        ? `/api/sales/orders/${convertingOrderId}/convert`
        : '/api/sales/invoices';
      const method = editInvoiceId ? 'PUT' : 'POST';

      const result = await apiRequest<any>(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      setCreatedInvoice(result);
      setShowPrintModal(true);
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
    setConvertingOrderId(null);
    setConvertedOrderNumber(null);
    setSelectedPartyId('');
    setSelectedParty(null);
    setPartyCreditInfo(null);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setReferenceNumber('');
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

  const getPrintableInvoice = () => {
    if (createdInvoice) return createdInvoice;
    return {
      id: editInvoiceId || 'draft',
      invoiceNumber: invoiceNumber || 'DRAFT-INVOICE',
      invoiceDate: invoiceDate || new Date().toISOString(),
      dueDate: dueDate || invoiceDate,
      status: 'DRAFT',
      partyName: selectedParty?.name || 'Cash Customer',
      partyGstin: selectedParty?.gstin || '',
      partyAddress: selectedParty?.address || '',
      partyState: selectedParty?.state || '',
      partyPhone: selectedParty?.phone || '',
      party: selectedParty,
      taxableAmount: totals.taxableAmount,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      lines: computedLines.filter(l => l.uniqueItemId && l.quantity > 0).map(l => ({
        ...l,
        uniqueItemName: l.uniqueItemName,
        uniqueItemCode: l.uniqueItemCode,
        quantity: l.quantity,
        unit: 'PRS',
        rate: l.rate,
        taxableAmount: l.taxable,
        cgstAmount: l.cgst,
        sgstAmount: l.sgst,
        igstAmount: l.igst,
        lineTotal: l.total,
        batches: l.batches || [],
      })),
      notes: notes,
    };
  };

  // Contextual items list calculation
  const contextualItems: ContextualPanelItem[] = useMemo(() => {
    if (contextualType === 'PARTY') {
      const q = contextualSearch.trim().toLowerCase();
      const filtered = q
        ? parties.filter(p => {
            const name = (p.name || '').toLowerCase();
            const phone = (p.phone || p.mobile || '').toLowerCase();
            const city = (p.city || '').toLowerCase();
            return name.includes(q) || phone.includes(q) || city.includes(q);
          })
        : parties;
      return filtered.map(p => {
        const bal = Number(p.balance ?? p.currentBalance ?? 0);
        return {
          id: p.id,
          title: p.name,
          subtitle: `${p.phone || p.mobile || ''} ${p.city ? `• ${p.city}` : ''}`.trim() || undefined,
          badge: p.partyType === 'CUSTOMER' ? 'Sundry Debtors' : p.partyType,
          badgeColor: 'blue' as const,
          rightText: bal !== 0 ? `₹${Math.abs(bal).toFixed(2)} ${bal < 0 ? 'Cr' : 'Dr'}` : '₹0.00',
          rightSubText: p.gstin ? `GST: ${p.gstin}` : undefined,
          meta: p,
        };
      });
    }

    if (contextualType === 'STOCK_ITEM') {
      const q = contextualSearch.trim().toLowerCase();
      const filtered = q
        ? uniqueItemsList.filter(item => {
            const name = (item.name || '').toLowerCase();
            const code = (item.code || '').toLowerCase();
            return name.includes(q) || code.includes(q);
          })
        : uniqueItemsList;
      return filtered.map(item => {
        const cat = item.categoryCode || item.category?.code || 'SV';
        const price = Number(item.mrp || item.standardSellingPrice || 0);
        return {
          id: item.id,
          title: item.name,
          code: item.code,
          badge: cat,
          badgeColor: (cat === 'SV' ? 'blue' : cat === 'KT' ? 'amber' : cat === 'PROG' ? 'purple' : 'slate') as any,
          rightText: `₹${isNaN(price) ? '0.00' : price.toFixed(2)}`,
          rightSubText: `Stock: ${item.totalStock || item.stock || 0} ${item.unit || 'PRS'}`,
          meta: item,
        };
      });
    }

    return [];
  }, [contextualType, contextualSearch, parties, uniqueItemsList]);

  const handleConfirmContextualSelect = (item: ContextualPanelItem) => {
    if (contextualType === 'PARTY') {
      handlePartyChange(item.id);
      closeContextualPanel();
      setTimeout(() => {
        const refInput = document.getElementById('voucher-header-ref-no') as HTMLInputElement;
        if (refInput) {
          refInput.focus();
          refInput.select();
        } else {
          setFocusRequest({ row: 0, col: 'item', key: Date.now() });
        }
      }, 50);
    } else if (contextualType === 'STOCK_ITEM' && contextualRowIndex !== null) {
      const rIdx = contextualRowIndex;
      handleLineItemChange(rIdx, item.id);
      closeContextualPanel();
      const fullItem = item.meta || uniqueItemsList.find(i => i.id === item.id);
      if (fullItem && fullItem.maintainBatches !== false) {
        setTimeout(() => {
          setActiveBatchModalIndex(rIdx);
          if (lines[rIdx]) setActiveBatchLineId(lines[rIdx].id);
        }, 60);
      } else {
        setFocusRequest({ row: rIdx, col: 'qty', key: Date.now() });
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!editInvoiceId) return;
    try {
      setActionLoading(true);
      await apiRequest(`/api/sales/invoices/${editInvoiceId}`, { method: 'DELETE' });
      setShowDeleteConfirm(false);
      if (onBack) onBack();
      else if (onNavigate) onNavigate('/sales/invoices');
      else window.history.back();
    } catch (err: any) {
      setFormError(err.message || 'Failed to delete sales voucher');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!editInvoiceId) return;
    try {
      setActionLoading(true);
      await apiRequest(`/api/sales/invoices/${editInvoiceId}/cancel`, { method: 'POST' });
      setShowCancelConfirm(false);
      if (onBack) onBack();
      else if (onNavigate) onNavigate('/sales/invoices');
      else window.history.back();
    } catch (err: any) {
      setFormError(err.message || 'Failed to cancel sales voucher');
    } finally {
      setActionLoading(false);
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      // Escape closes contextual panel if open
      if (e.key === 'Escape') {
        if (contextualType !== null) {
          e.preventDefault();
          closeContextualPanel();
        }
      } else if (contextualType !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setContextualSelectedIdx(prev =>
            Math.min(prev + 1, Math.max(0, contextualItems.length - 1))
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setContextualSelectedIdx(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
          if (contextualItems[contextualSelectedIdx]) {
            e.preventDefault();
            handleConfirmContextualSelect(contextualItems[contextualSelectedIdx]);
          }
        }
      } else if (e.altKey && e.key.toLowerCase() === 'd' && editInvoiceId && canDelete) {
        e.preventDefault();
        setShowDeleteConfirm(true);
      } else if (e.altKey && e.key.toLowerCase() === 'x' && editInvoiceId && canCancel) {
        e.preventDefault();
        setShowCancelConfirm(true);
      } else if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const previewBeforePrint = settings?.print?.previewBeforePrint ?? true;
        setAutoInvokePrint(!previewBeforePrint);
        setIsPrintPreviewOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [
    contextualType,
    contextualItems,
    contextualSelectedIdx,
    editInvoiceId,
    canDelete,
    canCancel,
    closeContextualPanel,
    settings?.print?.previewBeforePrint,
  ]);

  return (
    <div
      id="normal-sales-voucher-page"
      className="flex flex-col h-full w-full bg-[#f1f5f9] select-none font-sans overflow-hidden"
    >
      {convertingOrderId && (
        <div
          id="so-conversion-banner"
          className="bg-amber-50 border-b border-amber-200 px-3 py-1 flex items-center justify-between text-xs text-amber-900 shrink-0"
        >
          <div className="flex items-center space-x-2">
            <ShoppingCart className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Converting from Sales Order: <strong className="font-mono font-semibold">{convertedOrderNumber || convertingOrderId}</strong>. Reserved batch allocations pre-hydrated.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setConvertingOrderId(null);
              setConvertedOrderNumber(null);
              setReferenceNumber('');
              setLines([createEmptyVoucherLine('row')]);
            }}
            className="text-amber-700 hover:text-amber-900 underline font-medium cursor-pointer"
          >
            Clear Order Link
          </button>
        </div>
      )}

      {/* Main Horizontal Workspace: Voucher on Left, Contextual Panel on Right */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        {/* Left: Complete Voucher Workspace */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-white border border-slate-300 rounded-xs shadow-2xs">
          {/* 1. Tally-style Voucher Header */}
          <VoucherHeader
            voucherType="SALES"
            isEditing={!!editInvoiceId}
            voucherNumber={invoiceNumber}
            onVoucherNumberChange={setInvoiceNumber}
            voucherDate={invoiceDate}
            onVoucherDateChange={setInvoiceDate}
            businessName={currentBusiness?.name}
            parties={parties}
            selectedPartyId={selectedPartyId}
            onPartyChange={handlePartyChange}
            onPartyFocus={openContextualParty}
            partyBalance={
              partyCreditInfo
                ? {
                    balance: Math.abs(
                      parseFloat(partyCreditInfo.currentBalance ?? partyCreditInfo.outstandingBalance ?? 0)
                    ),
                    type:
                      parseFloat(partyCreditInfo.currentBalance ?? partyCreditInfo.outstandingBalance ?? 0) < 0
                        ? 'Cr'
                        : 'Dr',
                    isOverLimit: partyCreditInfo.isCreditLimitExceeded,
                    creditLimit: partyCreditInfo.creditLimit,
                  }
                : undefined
            }
            referenceNumber={referenceNumber}
            onReferenceNumberChange={setReferenceNumber}
            gstMode={gstMode}
            onGstModeChange={setGstMode}
            submitting={submitting}
            onSavePost={() => handleSaveVoucher('POSTED')}
            onPrint={() => {
              const previewBeforePrint = settings?.print?.previewBeforePrint ?? true;
              setAutoInvokePrint(!previewBeforePrint);
              setIsPrintPreviewOpen(true);
            }}
            onBack={() => (onBack ? onBack() : onNavigate ? onNavigate('/sales/invoices') : window.history.back())}
          />

          {/* 2. Dominant Item Grid */}
          <div className="flex-1 min-h-0 p-1 flex flex-col overflow-hidden">
            <VoucherItemGrid
              voucherType="SALES"
              lines={lines}
              computedLines={computedLines}
              allItems={uniqueItemsList}
              focusRequest={focusRequest}
              activeRowIndex={activeGridRow}
              onActiveRowChange={setActiveGridRow}
              onItemFocus={openContextualItem}
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

          {/* 3. Tally-style Fixed Footer */}
          <VoucherFooter
            voucherType="SALES"
            totals={totals}
            gstMode={gstMode}
            narration={notes}
            onNarrationChange={setNotes}
            previousBalance={
              partyCreditInfo
                ? {
                    balance: Math.abs(
                      parseFloat(partyCreditInfo.currentBalance ?? partyCreditInfo.outstandingBalance ?? 0)
                    ),
                    type:
                      parseFloat(partyCreditInfo.currentBalance ?? partyCreditInfo.outstandingBalance ?? 0) < 0
                        ? 'Cr'
                        : 'Dr',
                  }
                : undefined
            }
            errorMessage={formError}
            isEditing={!!editInvoiceId}
            canDelete={canDelete}
            canCancel={canCancel}
            submitting={submitting}
            onSave={() => handleSaveVoucher('POSTED')}
            onDelete={() => setShowDeleteConfirm(true)}
            onCancelVoucher={() => setShowCancelConfirm(true)}
            onPrint={() => {
              const previewBeforePrint = settings?.print?.previewBeforePrint ?? true;
              setAutoInvokePrint(!previewBeforePrint);
              setIsPrintPreviewOpen(true);
            }}
            onBack={() => (onBack ? onBack() : onNavigate ? onNavigate('/sales/invoices') : window.history.back())}
          />
        </div>

        {/* Right: Tally Contextual Selection Panel */}
        <TallyContextualPanel
          isOpen={contextualType !== null}
          type={contextualType}
          title={contextualType === 'PARTY' ? 'List of Ledger Accounts' : 'List of Stock Items'}
          subtitle={
            contextualType === 'PARTY'
              ? 'Customer Accounts (Sundry Debtors)'
              : 'Optical Items Master'
          }
          searchQuery={contextualSearch}
          onSearchChange={setContextualSearch}
          items={contextualItems}
          selectedIndex={contextualSelectedIdx}
          onSelectIndex={setContextualSelectedIdx}
          onConfirmSelect={handleConfirmContextualSelect}
          onCreateNew={() => {
            if (contextualType === 'PARTY') {
              const btn = document.getElementById('voucher-header-party-select');
              btn?.click();
            } else if (contextualType === 'STOCK_ITEM' && contextualRowIndex !== null) {
              const sel = document.getElementById(`voucher-item-grid-select-${contextualRowIndex}`);
              sel?.click();
            }
          }}
          onClose={closeContextualPanel}
          isSales={true}
        />
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-rose-200 space-y-3">
            <div className="flex items-center gap-2 text-rose-600">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-900">Delete Sales Voucher?</h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete Voucher #{invoiceNumber}? This will reverse stock and ledger postings.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={actionLoading}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded shadow-xs cursor-pointer"
              >
                {actionLoading ? 'Deleting...' : 'Confirm Delete (Alt+D)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Voucher Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-amber-200 space-y-3">
            <div className="flex items-center gap-2 text-amber-600">
              <XCircle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-900">Cancel Sales Voucher?</h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to cancel Voucher #{invoiceNumber}? Its status will be marked CANCELLED and stock will be returned.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                disabled={actionLoading}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={actionLoading}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded shadow-xs cursor-pointer"
              >
                {actionLoading ? 'Cancelling...' : 'Confirm Cancel (Alt+X)'}
              </button>
            </div>
          </div>
        </div>
      )}

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
          unit={activeBatchLine.unit}
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
                    {editInvoiceId ? 'Sales Voucher Updated Successfully!' : 'Sales Voucher Saved Successfully!'}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Voucher #{createdInvoice.invoiceNumber} • Status: {createdInvoice.status}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPrintModal(false);
                  if (onSuccess && createdInvoice?.id) {
                    onSuccess(createdInvoice.id);
                  } else if (onBack) {
                    onBack();
                  }
                }}
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

            {/* Items Sold Table */}
            {(() => {
              const displayLines = (createdInvoice.lines && createdInvoice.lines.length > 0)
                ? createdInvoice.lines
                : computedLines.filter(l => l.uniqueItemId && l.quantity > 0);

              if (displayLines.length === 0) return null;

              return (
                <div className="border border-slate-200 rounded-md overflow-hidden text-xs">
                  <div className="bg-slate-100 px-3 py-1.5 font-bold text-[11px] text-slate-700 uppercase tracking-wider flex justify-between">
                    <span>Items Sold ({displayLines.length})</span>
                    <span>Amount</span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto bg-white">
                    {displayLines.map((l: any, idx: number) => {
                      const itemName = l.uniqueItemName || l.uniqueItem?.name || 'Optical Item';
                      const itemCode = l.uniqueItemCode || l.uniqueItem?.code;
                      const qty = parseFloat(String(l.quantity || 1));
                      const rate = parseFloat(String(l.rate || 0));
                      const total = parseFloat(String(l.lineTotal || (qty * rate)));
                      const batches = l.batches || [];

                      return (
                        <div key={l.id || idx} className="p-2.5 hover:bg-slate-50 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                              <span>{itemName}</span>
                              {itemCode && (
                                <span className="text-[10px] font-mono px-1 py-0.2 bg-slate-100 text-slate-600 rounded">
                                  {itemCode}
                                </span>
                              )}
                            </div>
                            {batches.length > 0 && (
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5 space-y-0.5">
                                {batches.map((b: any, bIdx: number) => {
                                  const sph = b.sph ?? b.batch?.sph ?? '0.00';
                                  const cyl = b.cyl ?? b.batch?.cyl ?? '0.00';
                                  const axis = b.axis ?? b.batch?.axis;
                                  return (
                                    <div key={bIdx}>
                                      SPH {sph}, CYL {cyl}{axis ? `, AXIS ${axis}` : ''}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {qty} {l.unit || 'PRS'} × ₹{rate.toFixed(2)}
                            </div>
                          </div>
                          <div className="font-mono font-bold text-slate-900 text-right whitespace-nowrap">
                            ₹{total.toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  id="btn-preview-tax-invoice"
                  onClick={() => {
                    setAutoInvokePrint(false);
                    setIsPrintPreviewOpen(true);
                  }}
                  className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shadow-xs"
                  title="Open Print Preview"
                >
                  <Printer className="w-4 h-4" />
                  Print Preview
                </button>
                <button
                  id="btn-print-tax-invoice"
                  onClick={() => {
                    const previewBeforePrint = settings?.print?.previewBeforePrint ?? true;
                    setAutoInvokePrint(!previewBeforePrint);
                    setIsPrintPreviewOpen(true);
                  }}
                  className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
                  title="Print Invoice (System Print Dialog)"
                >
                  <Printer className="w-4 h-4 text-slate-600" />
                  Print
                </button>
              </div>

              <div className="flex items-center gap-2">
                {editInvoiceId ? (
                  <button
                    id="btn-back-to-invoices"
                    onClick={() => {
                      setShowPrintModal(false);
                      if (onSuccess && createdInvoice?.id) {
                        onSuccess(createdInvoice.id);
                      } else if (onBack) {
                        onBack();
                      } else if (onNavigate) {
                        onNavigate('/sales/invoices');
                      } else {
                        window.history.back();
                      }
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
                  >
                    Back to Invoices
                  </button>
                ) : (
                  <button
                    id="btn-create-another-voucher"
                    onClick={handleResetForm}
                    className="px-3.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                  >
                    Create Another Voucher
                  </button>
                )}
                <button
                  id="btn-go-to-invoices-register"
                  onClick={() => {
                    setShowPrintModal(false);
                    if (onSuccess && createdInvoice?.id) {
                      onSuccess(createdInvoice.id);
                    } else if (onBack) {
                      onBack();
                    } else if (onNavigate) {
                      onNavigate('/sales/invoices');
                    } else {
                      window.history.back();
                    }
                  }}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors shadow-xs"
                >
                  View Invoices Register
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REUSABLE A4 PRINT PREVIEW MODAL */}
      {isPrintPreviewOpen && (
        <PrintPreviewModal
          isOpen={isPrintPreviewOpen}
          onClose={() => setIsPrintPreviewOpen(false)}
          title={`Tax Invoice - ${(createdInvoice || getPrintableInvoice()).invoiceNumber || ''}`}
          filename={`Invoice_${(createdInvoice || getPrintableInvoice()).invoiceNumber || 'INV'}`}
          defaultOrientation="portrait"
          autoInvokePrint={autoInvokePrint}
        >
          {({ documentId }) => (
            <PrintableVoucher
              id={documentId}
              business={currentBusiness}
              voucher={createdInvoice || getPrintableInvoice()}
              documentType="SALES_INVOICE"
              customTitle={settings?.print?.invoiceTitle || "TAX INVOICE"}
              copyLabel="Original for Recipient"
            />
          )}
        </PrintPreviewModal>
      )}
    </div>
  );
};
