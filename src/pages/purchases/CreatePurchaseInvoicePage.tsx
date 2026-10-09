import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileSpreadsheet,
  ArrowLeft,
  Printer,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShoppingCart,
  Trash2,
  XCircle,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../api/client';
import { Party, UniqueItem } from '../../types/index';
import { VoucherHeader } from '../../components/voucher/VoucherHeader';
import { VoucherItemGrid } from '../../components/voucher/VoucherItemGrid';
import { VoucherFooter } from '../../components/voucher/VoucherFooter';
import { OpticalBatchModal } from '../../components/voucher/OpticalBatchModal';
import {
  TallyContextualPanel,
  ContextualPanelItem,
} from '../../components/voucher/TallyContextualPanel';
import { PrintPreviewModal } from '../../components/print/PrintPreviewModal';
import { PrintableVoucher } from '../../components/print/PrintableVoucher';
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
  editInvoiceId?: string | null;
  fromPurchaseOrderId?: string | null;
  orderId?: string | null;
  isOrder?: boolean;
  editOrderId?: string | null;
  onBack?: () => void;
  onSuccess?: (id: string) => void;
  onNavigate?: (path: string) => void;
}

export const CreatePurchaseInvoicePage: React.FC<Props> = ({
  editInvoiceId,
  fromPurchaseOrderId,
  orderId,
  isOrder = false,
  editOrderId,
  onBack = () => window.history.back(),
  onSuccess,
  onNavigate,
}) => {
  const { currentBusiness, hasPermission } = useAuth();

  const detectedOrderId = (() => {
    if (fromPurchaseOrderId) return fromPurchaseOrderId;
    if (orderId) return orderId;
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      return sp.get('fromPurchaseOrderId') || sp.get('orderId') || sp.get('fromOrderId') || null;
    }
    return null;
  })();

  const [convertingOrderId, setConvertingOrderId] = useState<string | null>(
    !isOrder ? detectedOrderId : null
  );
  const [convertingOrderNumber, setConvertingOrderNumber] = useState<string | null>(null);

  // Master Data
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [uniqueItemsList, setUniqueItemsList] = useState<UniqueItem[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);
  const [existingInvoiceNumber, setExistingInvoiceNumber] = useState<string>('');
  const [existingStatus, setExistingStatus] = useState<string>('');
  const [linkedPurchaseOrderId, setLinkedPurchaseOrderId] = useState<string | null>(
    !isOrder ? detectedOrderId : null
  );
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>('');

  // Form State
  const [supplierPartyId, setSupplierPartyId] = useState<string>('');
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [partyBalance, setPartyBalance] = useState<{
    balance: number;
    type: 'Dr' | 'Cr';
  } | null>(null);

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

  // Lines (initialized with a pristine blank row)
  const [lines, setLines] = useState<VoucherLineItem[]>([createEmptyVoucherLine('p-row')]);

  // Optical Batch Modal state
  const [activeBatchModalIndex, setActiveBatchModalIndex] = useState<number | null>(null);
  const [activeBatchLineId, setActiveBatchLineId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ row: number; col: string; key: number } | null>(null);

  const activeBatchLine = activeBatchLineId
    ? lines.find(l => l.id === activeBatchLineId) || null
    : activeBatchModalIndex !== null
    ? lines[activeBatchModalIndex] || null
    : null;

  // Barcode Scanner Quick Entry
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [barcodeLoading, setBarcodeLoading] = useState<boolean>(false);
  const [barcodeMsg, setBarcodeMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Submission & Post-Save State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<any | null>(null);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState<boolean>(false);
  const [autoInvokePrint, setAutoInvokePrint] = useState<boolean>(false);

  // User Permissions
  const canDelete = Boolean(
    hasPermission('purchase:delete') ||
    hasPermission('purchase.delete') ||
    hasPermission('purchase:invoice:delete') ||
    hasPermission('admin')
  );
  const canCancel = Boolean(
    hasPermission('purchase:cancel') ||
    hasPermission('purchase.cancel') ||
    hasPermission('purchase:edit') ||
    hasPermission('purchase.edit') ||
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

  // Helper: Auto calculate Due Date based on payment terms
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

  // Load suppliers, items, preview number & edit data
  const loadData = async () => {
    setLoadingInitial(true);
    try {
      const [supData, itemData, numRes] = await Promise.all([
        apiRequest<{ parties: Party[] }>('/api/parties?limit=100').catch(() => ({ parties: [] })),
        apiRequest<{ uniqueItems: UniqueItem[] }>('/api/optical-master/unique-items').catch(() =>
          apiRequest<UniqueItem[]>('/api/unique-items').then(items => ({ uniqueItems: items })).catch(() => ({ uniqueItems: [] }))
        ),
        isOrder
          ? apiRequest<{ orderNumber: string }>('/api/purchases/orders/generate-number').catch(() => ({
              orderNumber: `PO-${Date.now().toString().slice(-6)}`,
            }))
          : apiRequest<{ invoiceNumber: string }>('/api/purchases/invoices/number-preview').catch(() =>
              apiRequest<{ invoiceNumber: string }>('/api/purchases/number-preview').catch(() => ({
                invoiceNumber: `PUR-${Date.now().toString().slice(-6)}`,
              }))
            ),
      ]);

      const allParties = supData.parties || [];
      const validSuppliers = allParties.filter(
        p => p.partyType === 'SUPPLIER' || p.partyType === 'BOTH'
      );
      setSuppliers(validSuppliers);

      const items = (itemData as any).uniqueItems || (Array.isArray(itemData) ? itemData : []);
      setUniqueItemsList(items);

      if (!editInvoiceId && !editOrderId) {
        setExistingInvoiceNumber(isOrder ? (numRes as any).orderNumber : (numRes as any).invoiceNumber);
        updateDueDate(invoiceDate, paymentTerms);
      }

      if (isOrder && editOrderId) {
        const ord = await apiRequest<any>(`/api/purchases/orders/${editOrderId}`);
        if (ord) {
          setCreatedInvoice(ord);
          setExistingInvoiceNumber(ord.orderNumber);
          setExistingStatus(ord.status);
          const initialSupId = ord.supplierPartyId || (ord.supplier?.id ?? '');
          setSupplierPartyId(initialSupId);
          const sup = validSuppliers.find(p => p.id === initialSupId) || ord.supplier || null;
          setSelectedParty(sup);

          if (ord.orderDate) {
            const parsedDate = new Date(ord.orderDate).toISOString().split('T')[0];
            setInvoiceDate(parsedDate);
          }
          if (ord.expectedDeliveryDate) {
            setExpectedDeliveryDate(new Date(ord.expectedDeliveryDate).toISOString().split('T')[0]);
          }
          setSupplierInvoiceNumber(ord.supplierReference || '');
          setGstMode(ord.gstMode || 'INTRA_STATE');
          setNotes(ord.notes || '');

          if (initialSupId) {
            try {
              const ledgerRes = await apiRequest<any>(`/api/parties/${initialSupId}/ledger`);
              if (ledgerRes && ledgerRes.currentBalance !== undefined) {
                const balNum = parseFloat(ledgerRes.currentBalance);
                setPartyBalance({
                  balance: Math.abs(balNum),
                  type: balNum >= 0 ? 'Cr' : 'Dr',
                });
              }
            } catch {
              // ignore
            }
          }

          if (ord.lines && ord.lines.length > 0) {
            const loadedLines: VoucherLineItem[] = ord.lines.map((l: any, i: number) => ({
              id: `po-edit-row-${i}-${l.id || i}`,
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
                sph: b.batch?.sph !== undefined ? parseFloat(b.batch.sph) : parseFloat(b.sph || 0),
                cyl: b.batch?.cyl !== undefined ? parseFloat(b.batch.cyl) : parseFloat(b.cyl || 0),
                axis: b.batch?.axis !== undefined ? parseFloat(b.batch.axis) : parseFloat(b.axis || 0),
                add: b.batch?.add !== undefined ? parseFloat(b.batch.add) : parseFloat(b.add || 0),
                side: b.batch?.side || b.side || 'NONE',
                quantity: parseFloat(b.quantity) || 1,
                rate: parseFloat(b.rate !== undefined ? b.rate : (l.rate || 0)),
              })),
            }));
            setLines(ensureTrailingBlankRow(loadedLines, 'p-row'));
          } else {
            setLines([createEmptyVoucherLine('p-row')]);
          }
        }
      } else if (!isOrder && detectedOrderId) {
        // Prefill from Purchase Order for Conversion to Actual Invoice
        const po = await apiRequest<any>(`/api/purchases/orders/${detectedOrderId}`);
        if (po) {
          setConvertingOrderId(detectedOrderId);
          setConvertingOrderNumber(po.orderNumber || po.order?.orderNumber || null);
          setLinkedPurchaseOrderId(detectedOrderId);

          const initialSupId = po.supplierPartyId || po.supplier?.id || (po.order?.supplierPartyId ?? '');
          setSupplierPartyId(initialSupId);
          const sup = validSuppliers.find(p => p.id === initialSupId) || po.supplier || null;
          setSelectedParty(sup);
          setSupplierInvoiceNumber(po.supplierReference || po.order?.supplierReference || '');

          // Authoritative GST mode
          let authoritativeGstMode: 'INTRA_STATE' | 'INTER_STATE' | 'EXEMPT' =
            po.gstMode || po.order?.gstMode || 'INTRA_STATE';
          if (authoritativeGstMode !== 'EXEMPT') {
            const supState = sup?.state || po.supplier?.state;
            if (currentBusiness?.state && supState) {
              authoritativeGstMode =
                currentBusiness.state.trim().toLowerCase() === supState.trim().toLowerCase()
                  ? 'INTRA_STATE'
                  : 'INTER_STATE';
            }
          }
          setGstMode(authoritativeGstMode);

          const poOrderNumber = po.orderNumber || po.order?.orderNumber;
          const poNotes = po.notes || po.order?.notes;
          setNotes(poNotes ? `Ref: PO #${poOrderNumber}. ${poNotes}` : `Ref: PO #${poOrderNumber}`);

          if (initialSupId) {
            try {
              const ledgerRes = await apiRequest<any>(`/api/parties/${initialSupId}/ledger`);
              if (ledgerRes && ledgerRes.currentBalance !== undefined) {
                const balNum = parseFloat(ledgerRes.currentBalance);
                setPartyBalance({
                  balance: Math.abs(balNum),
                  type: balNum >= 0 ? 'Cr' : 'Dr',
                });
              }
            } catch {
              // ignore
            }
          }

          const rawPoLines = po.lines || [];
          const linesToHydrate = rawPoLines.filter((l: any) => {
            const rem = l.remainingQuantity !== undefined ? parseFloat(l.remainingQuantity) : parseFloat(l.quantity || '0');
            return rem > 0;
          });

          if (linesToHydrate.length > 0) {
            const loadedLines: VoucherLineItem[] = linesToHydrate.map((l: any, i: number) => {
              const lineRemQty = l.remainingQuantity !== undefined ? parseFloat(l.remainingQuantity) : (parseFloat(l.quantity) || 1);
              const poBatches = (l.batches || []).filter((b: any) => {
                const bRem = b.remainingQuantity !== undefined ? parseFloat(b.remainingQuantity) : (parseFloat(b.quantity) || 0);
                return bRem > 0;
              });

              const hydratedBatches = poBatches.map((b: any) => {
                const bRem = b.remainingQuantity !== undefined ? parseFloat(b.remainingQuantity) : (parseFloat(b.quantity) || 0);
                return {
                  batchId: b.batchId || b.batch?.id,
                  sph: b.batch?.sph !== undefined ? parseFloat(b.batch.sph) : parseFloat(b.sph || 0),
                  cyl: b.batch?.cyl !== undefined ? parseFloat(b.batch.cyl) : parseFloat(b.cyl || 0),
                  axis: b.batch?.axis !== undefined ? parseFloat(b.batch.axis) : parseFloat(b.axis || 0),
                  add: b.batch?.add !== undefined ? parseFloat(b.batch.add) : parseFloat(b.add || 0),
                  side: b.batch?.side || b.side || 'NONE',
                  quantity: bRem,
                  rate: parseFloat(b.rate !== undefined ? b.rate : (l.rate || 0)),
                };
              });

              const totalBatchQty = hydratedBatches.reduce((acc: number, b: any) => acc + b.quantity, 0);
              const finalQty = hydratedBatches.length > 0 ? totalBatchQty : lineRemQty;

              return {
                id: `po-conv-row-${i}-${l.id || i}`,
                uniqueItemId: l.uniqueItemId,
                uniqueItemName: l.uniqueItem?.name || 'Item',
                uniqueItemCode: l.uniqueItem?.code || '',
                categoryCode: l.category?.code || l.uniqueItem?.categoryCode || 'SV',
                maintainBatches: l.uniqueItem?.maintainBatches !== false,
                unit: l.uniqueItem?.unit || 'PRS',
                quantity: finalQty,
                rate: parseFloat(l.rate) || 0,
                discountType: l.discountType || 'NONE',
                discountValue: parseFloat(l.discountValue) || 0,
                gstRate: parseFloat(l.gstRate) || 12,
                batches: hydratedBatches,
              };
            });
            setLines(ensureTrailingBlankRow(loadedLines, 'p-row'));
          } else {
            setLines([createEmptyVoucherLine('p-row')]);
          }
        }
      } else if (editInvoiceId) {
        const inv = await apiRequest<any>(`/api/purchases/invoices/${editInvoiceId}`).catch(() =>
          apiRequest<any>(`/api/purchases/${editInvoiceId}`)
        );
        if (inv) {
          setCreatedInvoice(inv);
          setExistingInvoiceNumber(inv.invoiceNumber);
          setExistingStatus(inv.status);
          const initialSupId = inv.supplierPartyId || (inv.supplier?.id ?? '');
          setSupplierPartyId(initialSupId);
          const sup = validSuppliers.find(p => p.id === initialSupId) || inv.supplier || null;
          setSelectedParty(sup);

          if (inv.invoiceDate) {
            const parsedDate = new Date(inv.invoiceDate).toISOString().split('T')[0];
            setInvoiceDate(parsedDate);
            updateDueDate(parsedDate, paymentTerms);
          }
          setSupplierInvoiceNumber(inv.supplierInvoiceNumber || '');
          if (inv.supplierInvoiceDate) {
            setSupplierInvoiceDate(
              new Date(inv.supplierInvoiceDate).toISOString().split('T')[0]
            );
          }
          setGstMode(inv.gstMode || 'INTRA_STATE');
          setNotes(inv.notes || '');

          // Fetch party ledger balance
          if (initialSupId) {
            try {
              const ledgerRes = await apiRequest<any>(`/api/parties/${initialSupId}/ledger`);
              if (ledgerRes && ledgerRes.currentBalance !== undefined) {
                const balNum = parseFloat(ledgerRes.currentBalance);
                setPartyBalance({
                  balance: Math.abs(balNum),
                  type: balNum >= 0 ? 'Cr' : 'Dr',
                });
              }
            } catch {
              // ignore
            }
          }

          if (inv.lines && inv.lines.length > 0) {
            const loadedLines: VoucherLineItem[] = inv.lines.map((l: any, i: number) => ({
              id: `p-edit-row-${i}-${l.id || i}`,
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
                sph: b.batch?.sph !== undefined ? parseFloat(b.batch.sph) : parseFloat(b.sph || 0),
                cyl: b.batch?.cyl !== undefined ? parseFloat(b.batch.cyl) : parseFloat(b.cyl || 0),
                axis: b.batch?.axis !== undefined ? parseFloat(b.batch.axis) : parseFloat(b.axis || 0),
                add: b.batch?.add !== undefined ? parseFloat(b.batch.add) : parseFloat(b.add || 0),
                side: b.batch?.side || b.side || 'NONE',
                quantity: parseFloat(b.quantity) || 1,
                rate: parseFloat(b.rate !== undefined ? b.rate : (l.rate || 0)),
              })),
            }));
            setLines(ensureTrailingBlankRow(loadedLines, 'p-row'));
          } else {
            setLines([createEmptyVoucherLine('p-row')]);
          }
        }
      } else {
        setLines(prev => (prev.length === 0 ? [createEmptyVoucherLine('p-row')] : prev));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load master items for purchase voucher');
    } finally {
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [editInvoiceId, editOrderId, fromPurchaseOrderId, isOrder, currentBusiness?.id]);

  // Handle supplier change & auto-detect GST mode + ledger balance
  const handlePartyChange = async (partyId: string) => {
    setSupplierPartyId(partyId);
    const party = suppliers.find(p => p.id === partyId) || null;
    setSelectedParty(party);

    if (!party) {
      setPartyBalance(null);
      return;
    }

    // Auto-detect GST Mode based on business vs party state
    if (party.state && currentBusiness?.state) {
      if (party.state.trim().toLowerCase() !== currentBusiness.state.trim().toLowerCase()) {
        setGstMode('INTER_STATE');
      } else {
        setGstMode('INTRA_STATE');
      }
    }

    // Fetch supplier running ledger balance
    try {
      const ledgerRes = await apiRequest<any>(`/api/parties/${partyId}/ledger`);
      if (ledgerRes && ledgerRes.currentBalance !== undefined) {
        const balNum = parseFloat(ledgerRes.currentBalance);
        setPartyBalance({
          balance: Math.abs(balNum),
          type: balNum >= 0 ? 'Cr' : 'Dr',
        });
      }
    } catch {
      setPartyBalance(null);
    }
  };

  // Add a blank row
  const handleAddBlankLine = () => {
    setLines(prev => ensureTrailingBlankRow(prev, 'p-row'));
  };

  // Select Item for a row
  const handleLineItemChange = (index: number, newItemId: string) => {
    if (!newItemId) {
      setLines(prev =>
        prev.map((line, idx) =>
          idx === index ? { ...createEmptyVoucherLine('p-row'), id: line.id } : line
        )
      );
      return;
    }

    const item = uniqueItemsList.find(i => i.id === newItemId);
    if (!item) return;

    const defaultRate = item.lastPurchasePrice
      ? parseFloat(item.lastPurchasePrice as any)
      : (item as any).purchaseRate
      ? parseFloat((item as any).purchaseRate as any)
      : 250;
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
              categoryCode:
                (item as any).categoryCode || (item as any).category?.code || 'SV',
              unit: (item as any).unit || 'PRS',
              maintainBatches: itemMaintainBatches,
              rate: defaultRate,
              gstRate:
                item.gstRate !== undefined
                  ? parseFloat(String(item.gstRate))
                  : (item as any).taxRate
                  ? parseFloat((item as any).taxRate)
                  : 5,
              batches: existingBatches,
              quantity: existingQty,
            }
          : line
      )
    );

    // Auto-open batch modal when maintainBatches is YES
    if (itemMaintainBatches) {
      setActiveBatchModalIndex(index);
      if (lines[index]) {
        setActiveBatchLineId(lines[index].id);
      }
    }
  };

  // Apply batch allocations from modal
  const handleLineBatchApply = (
    index: number | null,
    allocatedBatches: BatchAllocation[],
    totalQty?: number
  ) => {
    const targetId = activeBatchLineId || (index !== null && lines[index] ? lines[index].id : null);
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
      return ensureTrailingBlankRow(updated, 'p-row');
    });

    setActiveBatchModalIndex(null);
    setActiveBatchLineId(null);

    // Auto-focus rate field on the line that was just allocated
    setTimeout(() => {
      const focusIndex = targetId ? lines.findIndex(l => l.id === targetId) : (index ?? 0);
      if (focusIndex >= 0) {
        setFocusRequest({ row: focusIndex, col: 'rate', key: Date.now() });
      }
    }, 60);
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
          updatedBatches[existingBatchIdx] = {
            ...updatedBatches[existingBatchIdx],
            quantity: updatedBatches[existingBatchIdx].quantity + 1,
          };
        } else {
          updatedBatches.push({
            batchId: batch.id,
            sph: Number(batch.sph || 0),
            cyl: Number(batch.cyl || 0),
            axis: Number(batch.axis || 0),
            add: Number(batch.add || 0),
            side: batch.side || 'NONE',
            quantity: 1,
            rate: defaultRate,
            barcode: batch.barcode,
          });
        }

        const newTotalQty = updatedBatches.reduce((s, b) => s + b.quantity, 0);

        setLines(prev =>
          ensureTrailingBlankRow(
            prev.map((l, i) =>
              i === existingIdx
                ? {
                    ...l,
                    quantity: newTotalQty,
                    batches: updatedBatches,
                  }
                : l
            ),
            'p-row'
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
          gstRate:
            uItem.gstRate !== undefined
              ? parseFloat(String(uItem.gstRate))
              : (uItem as any).taxRate
              ? parseFloat((uItem as any).taxRate)
              : 5,
          batches: [
            {
              batchId: batch.id,
              sph: Number(batch.sph || 0),
              cyl: Number(batch.cyl || 0),
              axis: Number(batch.axis || 0),
              add: Number(batch.add || 0),
              side: batch.side || 'NONE',
              quantity: 1,
              rate: defaultRate,
              barcode: batch.barcode,
            },
          ],
        };
        setLines(prev => ensureTrailingBlankRow([...prev, newLine], 'p-row'));
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
    totalItems: lines.filter(l => !isVoucherLineEmpty(l)).length,
  };

  const handleRemoveLine = (idx: number) => {
    setLines(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      return updated.length === 0 ? [createEmptyVoucherLine('p-row')] : updated;
    });
  };

  const handleResetForm = () => {
    setCreatedInvoice(null);
    setShowPrintModal(false);
    setSupplierPartyId('');
    setSelectedParty(null);
    setPartyBalance(null);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setSupplierInvoiceNumber('');
    setSupplierInvoiceDate('');
    setNotes('');
    setLines([createEmptyVoucherLine('p-row')]);
    setError(null);
    loadData();
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

    const nonBlankLines = lines.filter(l => !isVoucherLineEmpty(l));

    if (nonBlankLines.length === 0) {
      setError('Invoice must contain at least 1 stock item line');
      return;
    }

    // Validate non-blank lines
    for (let i = 0; i < nonBlankLines.length; i++) {
      const line = nonBlankLines[i];
      const lineNum = i + 1;
      const itemName = line.uniqueItemName || 'Item';

      if (!line.uniqueItemId) {
        setError(`Line #${lineNum}: Stock Item is required.`);
        return;
      }

      if (line.maintainBatches !== false) {
        if (!line.batches || line.batches.length === 0) {
          setError(`Line #${lineNum} (${itemName}): Batch allocations are required. Please allocate at least one batch.`);
          return;
        }
        const sumBatches = line.batches.reduce(
          (sum, b) => sum + Number(b.quantity || 0),
          0
        );
        if (sumBatches <= 0 || Math.abs(sumBatches - line.quantity) > 0.001) {
          setError(
            `Line #${lineNum} (${itemName}): Sum of batch quantities (${sumBatches}) must equal line quantity (${line.quantity})`
          );
          return;
        }
      }

      const itemUnit = (uniqueItemsList.find(u => u.id === line.uniqueItemId)?.unit || line.unit || 'PRS').toUpperCase();
      const isDiscrete = ['PCS', 'PIECES', 'BOX', 'BOXES', 'NOS', 'PKT', 'PACKET', 'UNIT', 'UNITS'].includes(itemUnit);
      if (isDiscrete) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1) {
          setError(`Line #${lineNum} (${itemName}): Quantity must be a positive whole integer for unit ${itemUnit}.`);
          return;
        }
      } else {
        if (line.quantity < 0.5 || Math.round(line.quantity * 2) !== line.quantity * 2) {
          setError(`Line #${lineNum} (${itemName}): Quantity must be in increments of 0.5 (min 0.5) for unit ${itemUnit}.`);
          return;
        }
      }

      if (line.rate < 0) {
        setError(`Line #${lineNum} (${itemName}) has negative purchase price.`);
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      if (isOrder) {
        const orderPayload = {
          supplierPartyId,
          orderDate: new Date(invoiceDate),
          expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
          gstMode,
          supplierReference: supplierInvoiceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: nonBlankLines.map(l => ({
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
              rate: b.rate !== undefined ? b.rate : l.rate,
            })),
          })),
        };

        let resultOrder: any = null;
        if (editOrderId) {
          resultOrder = await apiRequest<any>(`/api/purchases/orders/${editOrderId}`, {
            method: 'PUT',
            body: JSON.stringify(orderPayload),
          });
        } else {
          resultOrder = await apiRequest<any>('/api/purchases/orders', {
            method: 'POST',
            body: JSON.stringify(orderPayload),
          });
        }

        setCreatedInvoice(resultOrder);
        setShowPrintModal(true);

        if (onSuccess && resultOrder?.id) {
          onSuccess(resultOrder.id);
        }
        return;
      }

      const payload = {
        supplierPartyId,
        purchaseOrderId: linkedPurchaseOrderId || undefined,
        invoiceDate: new Date(invoiceDate),
        supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
        supplierInvoiceDate: supplierInvoiceDate
          ? new Date(supplierInvoiceDate)
          : undefined,
        gstMode,
        notes: notes.trim() || undefined,
        status: 'POSTED',
        lines: nonBlankLines.map(l => ({
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
            rate: b.rate !== undefined ? b.rate : l.rate,
          })),
        })),
      };

      let resultId = editInvoiceId;
      let finalInvoice: any = null;

      if (editInvoiceId) {
        const updated = await apiRequest<any>(
          `/api/purchases/invoices/${editInvoiceId}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
        resultId = updated.id;
        finalInvoice = updated;

        if (updated.status !== 'POSTED') {
          finalInvoice = await apiRequest(`/api/purchases/invoices/${editInvoiceId}/post`, {
            method: 'POST',
          });
        }
      } else if (convertingOrderId) {
        // Atomic PO Conversion endpoint
        const created = await apiRequest<any>(
          `/api/purchases/orders/${convertingOrderId}/convert`,
          {
            method: 'POST',
            body: JSON.stringify({
              invoiceDate: payload.invoiceDate,
              supplierInvoiceNumber: payload.supplierInvoiceNumber,
              supplierInvoiceDate: payload.supplierInvoiceDate,
              gstMode: payload.gstMode,
              notes: payload.notes,
              lines: payload.lines,
              status: 'POSTED',
            }),
          }
        );
        resultId = created.id;
        finalInvoice = created;

        if (created.status !== 'POSTED') {
          finalInvoice = await apiRequest(`/api/purchases/invoices/${created.id}/post`, {
            method: 'POST',
          });
        }
      } else {
        const created = await apiRequest<any>(
          '/api/purchases/invoices',
          {
            method: 'POST',
            body: JSON.stringify(payload),
          }
        );
        resultId = created.id;
        finalInvoice = created;

        if (created.status !== 'POSTED') {
          finalInvoice = await apiRequest(`/api/purchases/invoices/${created.id}/post`, {
            method: 'POST',
          });
        }
      }

      setCreatedInvoice(finalInvoice);
      setShowPrintModal(true);

      if (onSuccess && resultId) {
        onSuccess(resultId);
      }
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

  const getPrintableVoucher = () => {
    if (createdInvoice) return createdInvoice;
    return {
      id: editOrderId || editInvoiceId || 'draft',
      orderNumber: isOrder ? (existingInvoiceNumber || 'DRAFT-PO') : undefined,
      invoiceNumber: !isOrder ? (existingInvoiceNumber || 'DRAFT-PUR') : undefined,
      invoiceDate: invoiceDate || new Date().toISOString(),
      orderDate: invoiceDate || new Date().toISOString(),
      status: 'DRAFT',
      partyName: selectedParty?.name || 'Procurement Supplier',
      partyGstin: selectedParty?.gstin || '',
      partyAddress: selectedParty?.address || '',
      partyState: selectedParty?.state || '',
      partyPhone: selectedParty?.phone || '',
      party: selectedParty,
      supplier: selectedParty,
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
      supplierInvoiceNumber: supplierInvoiceNumber,
    };
  };

  const handleUnlinkReset = () => {
    setConvertingOrderId(null);
    setConvertingOrderNumber(null);
    setLinkedPurchaseOrderId(null);
    setSupplierPartyId('');
    setSelectedParty(null);
    setPartyBalance(null);
    setSupplierInvoiceNumber('');
    setSupplierInvoiceDate('');
    setNotes('');
    setLines([createEmptyVoucherLine('p-row')]);
  };

  // Contextual items list calculation
  const contextualItems: ContextualPanelItem[] = useMemo(() => {
    if (contextualType === 'PARTY') {
      const q = contextualSearch.trim().toLowerCase();
      const filtered = q
        ? suppliers.filter(p => {
            const name = (p.name || '').toLowerCase();
            const phone = (p.phone || p.mobile || '').toLowerCase();
            const city = (p.city || '').toLowerCase();
            return name.includes(q) || phone.includes(q) || city.includes(q);
          })
        : suppliers;
      return filtered.map(p => {
        const bal = Number(p.balance ?? (p as any).currentBalance ?? 0);
        return {
          id: p.id,
          title: p.name,
          subtitle: `${p.phone || p.mobile || ''} ${p.city ? `• ${p.city}` : ''}`.trim() || undefined,
          badge: p.partyType === 'SUPPLIER' ? 'Sundry Creditors' : p.partyType,
          badgeColor: 'purple' as const,
          rightText: bal !== 0 ? `₹${Math.abs(bal).toFixed(2)} ${bal < 0 ? 'Dr' : 'Cr'}` : '₹0.00',
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
        const price = Number((item as any).lastPurchasePrice || (item as any).purchaseRate || (item as any).costPrice || 0);
        return {
          id: item.id,
          title: item.name,
          code: item.code,
          badge: cat,
          badgeColor: (cat === 'SV' ? 'blue' : cat === 'KT' ? 'amber' : cat === 'PROG' ? 'purple' : 'slate') as any,
          rightText: `₹${isNaN(price) ? '0.00' : price.toFixed(2)}`,
          rightSubText: `GST: ${item.gstRate ?? (item as any).taxRate ?? 5}%`,
          meta: item,
        };
      });
    }

    return [];
  }, [contextualType, contextualSearch, suppliers, uniqueItemsList]);

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
    const idToDelete = isOrder ? editOrderId : editInvoiceId;
    if (!idToDelete) return;
    try {
      setActionLoading(true);
      const url = isOrder
        ? `/api/purchases/orders/${idToDelete}`
        : `/api/purchases/invoices/${idToDelete}`;
      await apiRequest(url, { method: 'DELETE' });
      setShowDeleteConfirm(false);
      onBack();
    } catch (err: any) {
      setError(err.message || 'Failed to delete purchase record');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    const idToCancel = isOrder ? editOrderId : editInvoiceId;
    if (!idToCancel) return;
    try {
      setActionLoading(true);
      const url = isOrder
        ? `/api/purchases/orders/${idToCancel}/cancel`
        : `/api/purchases/invoices/${idToCancel}/cancel`;
      await apiRequest(url, { method: 'POST' });
      setShowCancelConfirm(false);
      onBack();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel purchase record');
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
      } else if (e.altKey && e.key.toLowerCase() === 'd' && (editInvoiceId || editOrderId) && canDelete) {
        e.preventDefault();
        setShowDeleteConfirm(true);
      } else if (e.altKey && e.key.toLowerCase() === 'x' && (editInvoiceId || editOrderId) && canCancel) {
        e.preventDefault();
        setShowCancelConfirm(true);
      } else if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setAutoInvokePrint(false);
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
    editOrderId,
    canDelete,
    canCancel,
    closeContextualPanel,
  ]);

  return (
    <div
      id="normal-purchase-voucher-page"
      className="flex flex-col h-full w-full bg-[#f1f5f9] select-none font-sans overflow-hidden"
    >
      {/* PO Conversion Banner */}
      {convertingOrderId && (
        <div
          id="po-conversion-banner"
          className="bg-amber-50 border-b border-amber-200 px-3 py-1 flex items-center justify-between text-xs text-amber-900 shrink-0"
        >
          <div className="flex items-center space-x-2">
            <ShoppingCart className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Converting Purchase Order: <strong className="font-mono font-semibold">{convertingOrderNumber || convertingOrderId}</strong>. Remaining quantities and optical batch allocations pre-hydrated.
            </span>
          </div>
          <button
            type="button"
            id="btn-unlink-po"
            onClick={handleUnlinkReset}
            className="text-amber-700 hover:text-amber-900 underline font-medium cursor-pointer"
          >
            Unlink / Reset to Clean Purchase Invoice
          </button>
        </div>
      )}

      {/* Main Horizontal Workspace: Voucher on Left, Contextual Panel on Right */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        {/* Left: Complete Voucher Workspace */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-white border border-slate-300 rounded-xs shadow-2xs">
          {/* 1. Tally-style Voucher Header */}
          <VoucherHeader
            voucherType={isOrder ? 'PURCHASE_ORDER' : 'PURCHASE'}
            isEditing={isOrder ? !!editOrderId : !!editInvoiceId}
            voucherNumber={existingInvoiceNumber || 'AUTO'}
            voucherDate={invoiceDate}
            onVoucherDateChange={val => {
              setInvoiceDate(val);
              updateDueDate(val, paymentTerms);
            }}
            businessName={currentBusiness?.name}
            parties={suppliers}
            selectedPartyId={supplierPartyId}
            onPartyChange={handlePartyChange}
            onPartyFocus={openContextualParty}
            partyBalance={partyBalance || undefined}
            gstMode={gstMode}
            onGstModeChange={setGstMode}
            referenceNumber={supplierInvoiceNumber}
            onReferenceNumberChange={setSupplierInvoiceNumber}
            supplierInvoiceDate={supplierInvoiceDate}
            onSupplierInvoiceDateChange={setSupplierInvoiceDate}
            submitting={submitting}
            onSavePost={() => handleSaveInvoice(true)}
            onPrint={() => {
              setAutoInvokePrint(false);
              setIsPrintPreviewOpen(true);
            }}
            onBack={onBack}
          />

          {/* 2. Dominant Item Grid */}
          <div className="flex-1 min-h-0 p-1 flex flex-col overflow-hidden">
            <VoucherItemGrid
              voucherType="PURCHASE"
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
            voucherType="PURCHASE"
            totals={totals}
            gstMode={gstMode}
            narration={notes}
            onNarrationChange={setNotes}
            previousBalance={partyBalance}
            errorMessage={error}
            isEditing={isOrder ? !!editOrderId : !!editInvoiceId}
            canDelete={canDelete}
            canCancel={canCancel}
            submitting={submitting}
            onSave={() => handleSaveInvoice(true)}
            onDelete={() => setShowDeleteConfirm(true)}
            onCancelVoucher={() => setShowCancelConfirm(true)}
            onPrint={() => {
              setAutoInvokePrint(false);
              setIsPrintPreviewOpen(true);
            }}
            onBack={onBack}
          />
        </div>

        {/* Right: Tally Contextual Selection Panel */}
        <TallyContextualPanel
          isOpen={contextualType !== null}
          type={contextualType}
          title={contextualType === 'PARTY' ? 'List of Ledger Accounts' : 'List of Stock Items'}
          subtitle={
            contextualType === 'PARTY'
              ? 'Supplier Accounts (Sundry Creditors)'
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
          isSales={false}
        />
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-rose-200 space-y-3">
            <div className="flex items-center gap-2 text-rose-600">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-900">
                Delete {isOrder ? 'Purchase Order' : 'Purchase Voucher'}?
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete {isOrder ? 'Order' : 'Invoice'} #{existingInvoiceNumber || 'this record'}? This will reverse inventory and ledger postings.
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

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-amber-200 space-y-3">
            <div className="flex items-center gap-2 text-amber-600">
              <XCircle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-slate-900">
                Cancel {isOrder ? 'Purchase Order' : 'Purchase Voucher'}?
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to cancel {isOrder ? 'Order' : 'Invoice'} #{existingInvoiceNumber || 'this record'}? Its status will be marked CANCELLED.
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
          mode="purchase"
          itemName={activeBatchLine.uniqueItemName}
          itemCode={activeBatchLine.uniqueItemCode}
          uniqueItemId={activeBatchLine.uniqueItemId}
          categoryCode={activeBatchLine.categoryCode}
          unit={activeBatchLine.unit}
          initialBatches={activeBatchLine.batches}
          availableBatches={[]}
          lineQuantity={activeBatchLine.quantity}
          lineRate={activeBatchLine.rate}
        />
      )}

      {/* 5. Purchase Voucher Created & Confirmation Modal */}
      {showPrintModal && createdInvoice && (
        <div
          id="modal-purchase-voucher-created"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in"
        >
          <div className="bg-white rounded-xl max-w-xl w-full p-5 shadow-2xl border border-slate-300 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isOrder ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600'}`}>
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {isOrder ? 'Purchase Order Saved Successfully!' : 'Purchase Invoice Saved & Posted Successfully!'}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {isOrder ? 'Order' : 'Invoice'} #{createdInvoice.orderNumber || createdInvoice.invoiceNumber || existingInvoiceNumber} • Status: {createdInvoice.status}
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
                <span className="text-slate-500">Supplier A/c:</span>
                <span className="font-bold text-slate-900">
                  {createdInvoice.supplier?.name || selectedParty?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{isOrder ? 'Order Date:' : 'Invoice Date:'}</span>
                <span className="font-mono">
                  {new Date(createdInvoice.orderDate || createdInvoice.invoiceDate || invoiceDate).toLocaleDateString()}
                </span>
              </div>
              {supplierInvoiceNumber && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{isOrder ? 'Supplier Ref #:' : 'Supplier Bill #:'}</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {supplierInvoiceNumber}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">{isOrder ? 'Order Total:' : 'Invoice Total:'}</span>
                <span className="font-mono font-bold text-indigo-700 text-sm">
                  ₹{parseFloat(createdInvoice.grandTotal || grandTotal).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status &amp; Inventory:</span>
                <span className={`font-semibold ${isOrder ? 'text-blue-600' : 'text-emerald-600'}`}>
                  {isOrder
                    ? '✓ Purchase Order Created (Open / Inward on Invoice)'
                    : '✓ Stock Inwarded to Inventory & Supplier Ledger Credited'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  id="btn-preview-purchase-voucher"
                  onClick={() => setIsPrintPreviewOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded transition-colors shadow-xs"
                >
                  <Printer className="w-4 h-4" />
                  Print Preview
                </button>
                <button
                  id="btn-print-purchase-voucher"
                  onClick={() => setIsPrintPreviewOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
                >
                  <Printer className="w-4 h-4 text-slate-600" />
                  Print {isOrder ? 'Order' : 'Invoice'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="btn-create-another-purchase-voucher"
                  onClick={handleResetForm}
                  className="px-3.5 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 transition-colors"
                >
                  {isOrder ? 'Create Another Order' : 'Create Another Invoice'}
                </button>
                <button
                  id="btn-go-to-purchase-invoices-register"
                  onClick={() =>
                    onNavigate
                      ? onNavigate(isOrder ? '/purchase/orders' : '/purchase/invoices')
                      : onBack()
                  }
                  className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded transition-colors shadow-xs"
                >
                  {isOrder ? 'View Purchase Orders' : 'View Invoices Register'}
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
          title={`${isOrder ? 'Purchase Order' : 'Purchase Invoice'} - ${(createdInvoice || getPrintableVoucher()).orderNumber || (createdInvoice || getPrintableVoucher()).invoiceNumber || existingInvoiceNumber || ''}`}
          filename={`${isOrder ? 'PO' : 'PI'}_${(createdInvoice || getPrintableVoucher()).orderNumber || (createdInvoice || getPrintableVoucher()).invoiceNumber || 'VOUCHER'}`}
          defaultOrientation="portrait"
          autoInvokePrint={autoInvokePrint}
        >
          {({ documentId }) => (
            <PrintableVoucher
              id={documentId}
              business={currentBusiness}
              voucher={createdInvoice || getPrintableVoucher()}
              documentType={isOrder ? 'PURCHASE_ORDER' : 'PURCHASE_INVOICE'}
              customTitle={isOrder ? 'PURCHASE ORDER' : 'PURCHASE INVOICE'}
              copyLabel="Original for Records"
            />
          )}
        </PrintPreviewModal>
      )}
    </div>
  );
};

export const NormalPurchaseVoucherPage = CreatePurchaseInvoicePage;
