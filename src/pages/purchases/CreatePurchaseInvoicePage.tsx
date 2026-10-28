import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { useBusinessSettings } from '../../context/BusinessSettingsContext';
import { OpticalBatchModal } from '../../components/voucher/OpticalBatchModal';
import { StockItemChangeModal } from '../../components/voucher/StockItemChangeModal';
import {
  isSameOpticalCategory,
  remapBatchAllocations,
  getOpticalCategory,
} from '../../components/voucher/batchAllocationHelper';
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
import { InlinePartyModal } from '../../components/common/InlinePartyModal';
import { determineGstMode, resolveEntityState, getDisplayStateName } from '../../utils/gstHelper';
import { useUnsavedChanges } from '../../context/UnsavedChangesContext';
import { VoucherDraftRecoveryBanner } from '../../components/common/VoucherDraftRecoveryBanner';
import {
  VoucherFormState,
  isVoucherDirty,
  hasEnteredVoucherData,
  normalizeVoucherSnapshot,
} from '../../utils/voucherDirtyHelper';
import {
  saveVoucherDraft,
  getVoucherDraft,
  clearVoucherDraft,
  VoucherDraft,
} from '../../utils/voucherDraftStorage';

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
  const { user, currentBusiness, hasPermission } = useAuth();
  const { setDirty } = useUnsavedChanges();
  const { settings } = useBusinessSettings();

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
  const [courierCharges, setCourierCharges] = useState<number>(0);
  const [invoiceDiscount, setInvoiceDiscount] = useState<number>(0);
  const [invoiceGstRate, setInvoiceGstRate] = useState<number>(0);
  const [partyStateOverride, setPartyStateOverride] = useState<string>('');

  // Auto-determine GST mode from purchasing business state and supplier state
  const bizState = useMemo(() => {
    return resolveEntityState(currentBusiness) || (currentBusiness?.state || 'Maharashtra').trim();
  }, [currentBusiness]);

  const partyState = useMemo(() => {
    if (partyStateOverride) return partyStateOverride;
    return resolveEntityState(selectedParty) || (selectedParty?.state || '').trim();
  }, [selectedParty, partyStateOverride]);

  const isPartyStateMissing = Boolean(supplierPartyId && !partyState);

  // Auto-determine GST mode whenever business, party, or partyState changes
  useEffect(() => {
    if (!supplierPartyId) {
      setGstMode('INTRA_STATE');
      return;
    }
    const computedMode = determineGstMode(
      currentBusiness,
      partyStateOverride ? { state: partyStateOverride } : selectedParty,
      bizState
    );
    setGstMode(computedMode);
  }, [bizState, selectedParty, partyStateOverride, supplierPartyId, currentBusiness]);

  const handlePartyStateChange = (newState: string) => {
    setPartyStateOverride(newState);
    if (selectedParty) {
      setSelectedParty((prev: any) => (prev ? { ...prev, state: newState } : prev));
    }
    const newGstMode = determineGstMode(currentBusiness, { state: newState }, bizState);
    setGstMode(newGstMode);
  };

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

  // Stock Item Change Confirmation Modal state
  const [stockItemChangeModal, setStockItemChangeModal] = useState<{
    rowIndex: number;
    oldLine: VoucherLineItem;
    newItem: any;
    isSameCategory: boolean;
    categoryCode: any;
  } | null>(null);

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

  // Unsaved Changes and Baseline Tracking
  const baselineSnapshotRef = useRef<VoucherFormState>(normalizeVoucherSnapshot(null));
  const [isBaselineReady, setIsBaselineReady] = useState<boolean>(false);
  const [availableDraft, setAvailableDraft] = useState<VoucherDraft | null>(null);

  // Compute current voucher snapshot for comparison and draft saving
  const currentVoucherSnapshot: VoucherFormState = useMemo(() => ({
    partyId: supplierPartyId,
    invoiceDate,
    dueDate,
    paymentMode,
    paymentTerms,
    referenceNumber: supplierInvoiceNumber,
    supplierInvoiceDate,
    notes,
    courierCharges,
    invoiceDiscount,
    invoiceGstRate,
    partyStateOverride,
    gstMode,
    lines: lines.map(l => ({
      uniqueItemId: l.uniqueItemId,
      quantity: l.quantity,
      rate: l.rate,
      discountType: l.discountType || 'NONE',
      discountValue: l.discountValue || 0,
      gstRate: l.gstRate || 0,
      batches: l.batches?.map(b => ({
        batchId: b.batchId,
        quantity: b.quantity,
        rate: b.rate,
        sph: b.sph,
        cyl: b.cyl,
        axis: b.axis,
        add: b.add,
        side: b.side,
      })) || [],
    })),
  }), [
    supplierPartyId,
    invoiceDate,
    dueDate,
    paymentMode,
    paymentTerms,
    supplierInvoiceNumber,
    supplierInvoiceDate,
    notes,
    courierCharges,
    invoiceDiscount,
    invoiceGstRate,
    partyStateOverride,
    gstMode,
    lines,
  ]);

  // Compute whether the voucher is truly dirty
  const isDirty = useMemo(() => {
    if (!isBaselineReady) return false;
    return isVoucherDirty(currentVoucherSnapshot, baselineSnapshotRef.current);
  }, [isBaselineReady, currentVoucherSnapshot]);

  // Inform central navigation and browser beforeunload guard
  useEffect(() => {
    setDirty(isDirty, 'You have unsaved changes in this Purchase Voucher. If you leave this page, your changes may be lost.');
  }, [isDirty, setDirty]);

  // Clean up dirty state on unmount
  useEffect(() => {
    return () => {
      setDirty(false);
    };
  }, [setDirty]);

  // Check for unsaved draft in local storage on mount / business change
  useEffect(() => {
    if (!currentBusiness?.id || !user?.id) return;
    const draft = getVoucherDraft(currentBusiness.id, user.id, 'PURCHASE', editInvoiceId || editOrderId || null);
    if (draft && draft.form && hasEnteredVoucherData(draft.form)) {
      setAvailableDraft(draft);
    }
  }, [currentBusiness?.id, user?.id, editInvoiceId, editOrderId]);

  // Auto-save draft on debounced modification when dirty
  useEffect(() => {
    if (!isBaselineReady || !isDirty || !currentBusiness?.id || !user?.id) return;
    if (!hasEnteredVoucherData(currentVoucherSnapshot)) return;

    const timer = setTimeout(() => {
      saveVoucherDraft(currentBusiness.id, user.id, 'PURCHASE', editInvoiceId || editOrderId || null, currentVoucherSnapshot);
    }, 1000);

    return () => clearTimeout(timer);
  }, [isBaselineReady, isDirty, currentVoucherSnapshot, currentBusiness?.id, user?.id, editInvoiceId, editOrderId]);

  const handleRestoreDraft = () => {
    if (!availableDraft?.form) return;
    const f = availableDraft.form;
    if (f.partyId) {
      setSupplierPartyId(f.partyId);
      const foundParty = suppliers.find(p => p.id === f.partyId);
      if (foundParty) setSelectedParty(foundParty);
    }
    if (f.invoiceDate) setInvoiceDate(f.invoiceDate);
    if (f.dueDate) setDueDate(f.dueDate);
    if (f.paymentMode) setPaymentMode(f.paymentMode);
    if (f.paymentTerms) setPaymentTerms(f.paymentTerms);
    if (f.referenceNumber !== undefined) setSupplierInvoiceNumber(f.referenceNumber || '');
    if (f.supplierInvoiceDate !== undefined) setSupplierInvoiceDate(f.supplierInvoiceDate || '');
    if (f.notes !== undefined) setNotes(f.notes || '');
    if (f.courierCharges !== undefined) setCourierCharges(Number(f.courierCharges || 0));
    if (f.invoiceDiscount !== undefined) setInvoiceDiscount(Number(f.invoiceDiscount || 0));
    if (f.invoiceGstRate !== undefined) setInvoiceGstRate(Number(f.invoiceGstRate || 0));
    if (f.partyStateOverride !== undefined) setPartyStateOverride(f.partyStateOverride || '');
    if (f.gstMode) setGstMode(f.gstMode as any);

    if (f.lines && f.lines.length > 0) {
      const restoredLines: VoucherLineItem[] = f.lines.map((l, idx) => {
        const itemMatch = uniqueItemsList.find(u => u.id === l.uniqueItemId);
        return {
          id: `restored-p-line-${Date.now()}-${idx}`,
          uniqueItemId: l.uniqueItemId || null,
          uniqueItemName: itemMatch?.name || 'Stock Item',
          uniqueItemCode: itemMatch?.itemCode || itemMatch?.code || '',
          categoryCode: itemMatch?.categoryCode || 'SV',
          unit: itemMatch?.unit || 'PRS',
          maintainBatches: itemMatch?.maintainBatches !== false,
          quantity: Number(l.quantity || 1),
          rate: Number(l.rate || 0),
          discountType: (l.discountType as any) || 'NONE',
          discountValue: Number(l.discountValue || 0),
          gstRate: Number(l.gstRate || 0),
          batches: (l.batches || []).map(b => ({
            batchId: b.batchId || '',
            quantity: Number(b.quantity || 0),
            rate: Number(b.rate || 0),
            sph: b.sph !== undefined && b.sph !== null ? String(b.sph) : '0.00',
            cyl: b.cyl !== undefined && b.cyl !== null ? String(b.cyl) : '0.00',
            axis: b.axis !== undefined && b.axis !== null ? String(b.axis) : '',
            add: b.add !== undefined && b.add !== null ? String(b.add) : '',
            side: (b.side as any) || 'NONE',
          })),
        };
      });
      setLines(ensureTrailingBlankRow(restoredLines, 'p-row'));
    }
    setAvailableDraft(null);
  };

  const handleDiscardDraft = () => {
    if (currentBusiness?.id && user?.id) {
      clearVoucherDraft(currentBusiness.id, user.id, 'PURCHASE', editInvoiceId || editOrderId || null);
    }
    setAvailableDraft(null);
  };

  // Tally Contextual Panel State
  const [contextualType, setContextualType] = useState<'PARTY' | 'STOCK_ITEM' | 'BATCH' | null>(null);
  const [contextualRowIndex, setContextualRowIndex] = useState<number | null>(null);
  const [contextualSearch, setContextualSearch] = useState<string>('');
  const [contextualSelectedIdx, setContextualSelectedIdx] = useState<number>(0);
  const [activeGridRow, setActiveGridRow] = useState<number>(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [isPartyModalOpen, setIsPartyModalOpen] = useState<boolean>(false);
  const [partyModalInitialName, setPartyModalInitialName] = useState<string>('');

  const openContextualParty = useCallback(() => {
    setContextualType(prev => {
      if (prev !== 'PARTY') {
        setContextualSearch('');
        setContextualSelectedIdx(0);
      }
      return 'PARTY';
    });
    setContextualRowIndex(null);
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
    setContextualSearch('');
    setContextualSelectedIdx(0);
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
          if (ord.courierCharges !== undefined && ord.courierCharges !== null) {
            setCourierCharges(parseFloat(ord.courierCharges) || 0);
          }
          if (ord.discountTotal !== undefined && ord.discountTotal !== null) {
            setInvoiceDiscount(parseFloat(ord.discountTotal) || 0);
          }
          if (ord.gstRate !== undefined && ord.gstRate !== null) {
            setInvoiceGstRate(parseFloat(ord.gstRate) || 0);
          }

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
              gstRate: l.gstRate !== undefined ? parseFloat(l.gstRate) : 0,
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
            baselineSnapshotRef.current = {
              partyId: initialSupId,
              invoiceDate: ord.orderDate ? new Date(ord.orderDate).toISOString().split('T')[0] : '',
              dueDate: '',
              paymentMode: 'CREDIT',
              paymentTerms: 'NET 30',
              referenceNumber: ord.supplierReference || '',
              supplierInvoiceDate: '',
              notes: ord.notes || '',
              courierCharges: ord.courierCharges ? parseFloat(ord.courierCharges) : 0,
              invoiceDiscount: ord.discountTotal ? parseFloat(ord.discountTotal) : 0,
              invoiceGstRate: ord.gstRate ? parseFloat(ord.gstRate) : 0,
              partyStateOverride: '',
              gstMode: ord.gstMode || 'INTRA_STATE',
              lines: loadedLines.map(l => ({
                uniqueItemId: l.uniqueItemId,
                quantity: l.quantity,
                rate: l.rate,
                discountType: l.discountType || 'NONE',
                discountValue: l.discountValue || 0,
                gstRate: l.gstRate || 0,
                batches: l.batches?.map(b => ({
                  batchId: b.batchId,
                  quantity: b.quantity,
                  rate: b.rate,
                  sph: b.sph,
                  cyl: b.cyl,
                  axis: b.axis,
                  add: b.add,
                  side: b.side,
                })) || [],
              })),
            };
            setIsBaselineReady(true);
          } else {
            setLines([createEmptyVoucherLine('p-row')]);
            baselineSnapshotRef.current = normalizeVoucherSnapshot(null);
            setIsBaselineReady(true);
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
          if (po.courierCharges !== undefined && po.courierCharges !== null) {
            setCourierCharges(parseFloat(po.courierCharges) || 0);
          } else if (po.order?.courierCharges !== undefined && po.order?.courierCharges !== null) {
            setCourierCharges(parseFloat(po.order.courierCharges) || 0);
          }
          if (po.discountTotal !== undefined && po.discountTotal !== null) {
            setInvoiceDiscount(parseFloat(po.discountTotal) || 0);
          } else if (po.order?.discountTotal !== undefined && po.order?.discountTotal !== null) {
            setInvoiceDiscount(parseFloat(po.order.discountTotal) || 0);
          }
          if (po.gstRate !== undefined && po.gstRate !== null) {
            setInvoiceGstRate(parseFloat(po.gstRate) || 0);
          } else if (po.order?.gstRate !== undefined && po.order?.gstRate !== null) {
            setInvoiceGstRate(parseFloat(po.order.gstRate) || 0);
          }

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
                gstRate: l.gstRate !== undefined ? parseFloat(l.gstRate) : 0,
                batches: hydratedBatches,
              };
            });
            setLines(ensureTrailingBlankRow(loadedLines, 'p-row'));
            baselineSnapshotRef.current = {
              partyId: initialSupId,
              invoiceDate: invoiceDate,
              dueDate: '',
              paymentMode: 'CREDIT',
              paymentTerms: 'NET 30',
              referenceNumber: po.supplierReference || po.order?.supplierReference || '',
              supplierInvoiceDate: '',
              notes: poNotes ? `Ref: PO #${poOrderNumber}. ${poNotes}` : `Ref: PO #${poOrderNumber}`,
              courierCharges: po.courierCharges ? parseFloat(po.courierCharges) : (po.order?.courierCharges ? parseFloat(po.order.courierCharges) : 0),
              invoiceDiscount: po.discountTotal ? parseFloat(po.discountTotal) : (po.order?.discountTotal ? parseFloat(po.order.discountTotal) : 0),
              invoiceGstRate: po.gstRate ? parseFloat(po.gstRate) : (po.order?.gstRate ? parseFloat(po.order.gstRate) : 0),
              partyStateOverride: '',
              gstMode: authoritativeGstMode,
              lines: loadedLines.map(l => ({
                uniqueItemId: l.uniqueItemId,
                quantity: l.quantity,
                rate: l.rate,
                discountType: l.discountType || 'NONE',
                discountValue: l.discountValue || 0,
                gstRate: l.gstRate || 0,
                batches: l.batches?.map(b => ({
                  batchId: b.batchId,
                  quantity: b.quantity,
                  rate: b.rate,
                  sph: b.sph,
                  cyl: b.cyl,
                  axis: b.axis,
                  add: b.add,
                  side: b.side,
                })) || [],
              })),
            };
            setIsBaselineReady(true);
          } else {
            setLines([createEmptyVoucherLine('p-row')]);
            baselineSnapshotRef.current = normalizeVoucherSnapshot(null);
            setIsBaselineReady(true);
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
          if (inv.courierCharges !== undefined && inv.courierCharges !== null) {
            setCourierCharges(parseFloat(inv.courierCharges) || 0);
          }
          if (inv.discountTotal !== undefined && inv.discountTotal !== null) {
            setInvoiceDiscount(parseFloat(inv.discountTotal) || 0);
          }
          if (inv.gstRate !== undefined && inv.gstRate !== null) {
            setInvoiceGstRate(parseFloat(inv.gstRate) || 0);
          }

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
              gstRate: l.gstRate !== undefined ? parseFloat(l.gstRate) : 0,
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
            baselineSnapshotRef.current = {
              partyId: initialSupId,
              invoiceDate: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().split('T')[0] : '',
              dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().split('T')[0] : '',
              paymentMode: inv.paymentMode || 'CREDIT',
              paymentTerms: inv.paymentTerms || 'NET 30',
              referenceNumber: inv.supplierInvoiceNumber || '',
              supplierInvoiceDate: inv.supplierInvoiceDate ? new Date(inv.supplierInvoiceDate).toISOString().split('T')[0] : '',
              notes: inv.notes || '',
              courierCharges: inv.courierCharges ? parseFloat(inv.courierCharges) : 0,
              invoiceDiscount: inv.discountTotal ? parseFloat(inv.discountTotal) : 0,
              invoiceGstRate: inv.gstRate ? parseFloat(inv.gstRate) : 0,
              partyStateOverride: '',
              gstMode: inv.gstMode || 'INTRA_STATE',
              lines: loadedLines.map(l => ({
                uniqueItemId: l.uniqueItemId,
                quantity: l.quantity,
                rate: l.rate,
                discountType: l.discountType || 'NONE',
                discountValue: l.discountValue || 0,
                gstRate: l.gstRate || 0,
                batches: l.batches?.map(b => ({
                  batchId: b.batchId,
                  quantity: b.quantity,
                  rate: b.rate,
                  sph: b.sph,
                  cyl: b.cyl,
                  axis: b.axis,
                  add: b.add,
                  side: b.side,
                })) || [],
              })),
            };
            setIsBaselineReady(true);
          } else {
            setLines([createEmptyVoucherLine('p-row')]);
            baselineSnapshotRef.current = normalizeVoucherSnapshot(null);
            setIsBaselineReady(true);
          }
        }
      } else {
        setLines(prev => (prev.length === 0 ? [createEmptyVoucherLine('p-row')] : prev));
        baselineSnapshotRef.current = normalizeVoucherSnapshot(null);
        setIsBaselineReady(true);
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
  const handlePartyChange = async (partyId: string, partyObj?: any) => {
    setSupplierPartyId(partyId);
    setPartyStateOverride('');
    let party = partyObj || suppliers.find(p => p.id === partyId) || null;
    
    // If not found in memory, fetch supplier details from API
    if (partyId && !party) {
      try {
        party = await apiRequest<any>(`/api/parties/${partyId}`);
      } catch (e) {
        console.warn('Could not fetch supplier details:', e);
      }
    }
    setSelectedParty(party);

    if (!party) {
      setPartyBalance(null);
      setGstMode('INTRA_STATE');
      return;
    }

    // Auto-detect GST Mode based on business vs supplier party state
    const newGstMode = determineGstMode(currentBusiness, party, bizState);
    setGstMode(newGstMode);

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

  const handleOpenPartyModal = (initialName?: string) => {
    setPartyModalInitialName(initialName ?? contextualSearch ?? '');
    setIsPartyModalOpen(true);
  };

  const handlePartyCreated = (newParty: any) => {
    if (!newParty || !newParty.id) return;

    const normalizedParty = {
      ...newParty,
      id: newParty.id,
      name: newParty.name,
      partyCode: newParty.partyCode || newParty.code || '',
      partyType: newParty.partyType || 'SUPPLIER',
      phone: newParty.phone || newParty.mobile || '',
      mobile: newParty.mobile || newParty.phone || '',
      city: newParty.city || '',
      state: newParty.state || '',
      gstin: newParty.gstin || '',
      currentBalance: newParty.currentBalance ?? newParty.openingBalance ?? 0,
      balance: newParty.balance ?? newParty.openingBalance ?? 0,
    };

    // 1. Immediately update suppliers array with the new party at the top
    setSuppliers(prev => [normalizedParty, ...prev.filter(p => p.id !== newParty.id)]);

    // 2. Select the supplier immediately
    setSupplierPartyId(newParty.id);
    setSelectedParty(normalizedParty);
    setPartyStateOverride('');

    // 3. Immediately auto-detect GST Mode based on the new supplier's state
    const newGstMode = determineGstMode(currentBusiness, normalizedParty, bizState);
    setGstMode(newGstMode);

    // 4. Update party balance
    setPartyBalance({
      balance: Math.abs(Number(normalizedParty.currentBalance || 0)),
      type: Number(normalizedParty.currentBalance || 0) >= 0 ? 'Cr' : 'Dr',
    });

    // 5. Instantly show in right-side panel:
    setContextualType('PARTY');
    setContextualSearch('');
    setContextualSelectedIdx(0);

    // Close the party modal
    setIsPartyModalOpen(false);

    // 6. Smoothly move focus to Reference Number input
    setTimeout(() => {
      const refInput = document.getElementById('voucher-header-ref-no') as HTMLInputElement;
      if (refInput) {
        refInput.focus();
        refInput.select();
      }
    }, 80);
  };

  // Add a blank row
  const handleAddBlankLine = () => {
    setLines(prev => ensureTrailingBlankRow(prev, 'p-row'));
  };

  // Applies confirmed or direct Stock Item selection
  const applyStockItemChange = async (
    index: number,
    newItem: any,
    retainBatches: boolean,
    previousBatches: BatchAllocation[] = []
  ) => {
    const defaultRate = newItem.lastPurchasePrice
      ? parseFloat(newItem.lastPurchasePrice as any)
      : (newItem as any).purchaseRate
      ? parseFloat((newItem as any).purchaseRate as any)
      : 250;
    const itemMaintainBatches = newItem.maintainBatches !== false;
    const catCode = getOpticalCategory(newItem);

    if (retainBatches && previousBatches.length > 0) {
      let targetBatches: any[] = [];
      try {
        const res = await apiRequest<{ batches: any[] }>(
          `/api/sales/unique-items/${newItem.id}/batches?limit=1000&onlyInStock=false`
        );
        targetBatches = res.batches || [];
      } catch (err) {
        console.warn('Failed to fetch batches for new item:', err);
      }

      const { remappedBatches, unmappedCount } = remapBatchAllocations(
        previousBatches,
        newItem.name,
        targetBatches,
        catCode
      );

      const retainedQty = remappedBatches.reduce(
        (sum, b) => sum + (Number(b.quantity) || 0),
        0
      );

      setLines(prev =>
        prev.map((line, idx) =>
          idx === index
            ? {
                ...line,
                uniqueItemId: newItem.id,
                uniqueItemName: newItem.name,
                uniqueItemCode: newItem.code,
                categoryCode: catCode,
                unit: (newItem as any).unit || 'PRS',
                maintainBatches: itemMaintainBatches,
                rate: defaultRate,
                gstRate:
                  newItem.gstRate !== undefined
                    ? parseFloat(String(newItem.gstRate))
                    : (newItem as any).taxRate
                    ? parseFloat((newItem as any).taxRate)
                    : 0,
                batches: remappedBatches,
                quantity: retainedQty,
                availableBatches: targetBatches,
              }
            : line
        )
      );

      if (unmappedCount > 0) {
        setError(
          `Item changed to "${newItem.name}". ${unmappedCount} batch power(s) are not available under this item. Please resolve them before saving.`
        );
      } else {
        setError(null);
      }

      // Return focus to grid
      setTimeout(() => {
        setFocusRequest({ row: index, col: 'rate', key: Date.now() });
      }, 60);
    } else {
      // Clear batches (new item or different category)
      setLines(prev =>
        prev.map((line, idx) =>
          idx === index
            ? {
                ...line,
                uniqueItemId: newItem.id,
                uniqueItemName: newItem.name,
                uniqueItemCode: newItem.code,
                categoryCode: catCode,
                unit: (newItem as any).unit || 'PRS',
                maintainBatches: itemMaintainBatches,
                rate: defaultRate,
                gstRate:
                  newItem.gstRate !== undefined
                    ? parseFloat(String(newItem.gstRate))
                    : (newItem as any).taxRate
                    ? parseFloat((newItem as any).taxRate)
                    : 0,
                batches: [],
                quantity: itemMaintainBatches ? 0 : 1,
                availableBatches: [],
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
      } else {
        setTimeout(() => {
          setFocusRequest({ row: index, col: 'qty', key: Date.now() });
        }, 60);
      }
    }
  };

  // Select Item for a row with safety checks
  const handleLineItemChange = async (index: number, newItemId: string) => {
    if (!newItemId) {
      setLines(prev =>
        prev.map((line, idx) =>
          idx === index ? { ...createEmptyVoucherLine('p-row'), id: line.id } : line
        )
      );
      return;
    }

    const newItem = uniqueItemsList.find(i => i.id === newItemId);
    if (!newItem) return;

    const existingLine = lines[index];
    const isChangingExistingItem = Boolean(
      existingLine &&
      existingLine.uniqueItemId &&
      existingLine.uniqueItemId !== newItem.id
    );

    const hasAllocations = Boolean(
      existingLine &&
      existingLine.batches &&
      existingLine.batches.length > 0 &&
      existingLine.batches.some(b => Number(b.quantity) > 0)
    );

    if (isChangingExistingItem && hasAllocations) {
      const oldCat = getOpticalCategory(existingLine);
      const isSameCategory = isSameOpticalCategory(existingLine, newItem);

      setStockItemChangeModal({
        rowIndex: index,
        oldLine: existingLine,
        newItem,
        isSameCategory,
        categoryCode: oldCat,
      });
      return;
    }

    await applyStockItemChange(index, newItem, false);
  };

  const handleConfirmItemChange = async () => {
    if (!stockItemChangeModal) return;
    const { rowIndex, oldLine, newItem, isSameCategory } = stockItemChangeModal;
    setStockItemChangeModal(null);
    await applyStockItemChange(rowIndex, newItem, isSameCategory, oldLine.batches);
  };

  const handleCancelItemChange = () => {
    if (!stockItemChangeModal) return;
    const rIdx = stockItemChangeModal.rowIndex;
    setStockItemChangeModal(null);
    setTimeout(() => {
      setFocusRequest({ row: rIdx, col: 'item', key: Date.now() });
    }, 60);
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
              : 0,
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
  const computedLines: ComputedVoucherLine[] = useMemo(() => {
    return lines.map(line => {
      const gross = Math.round((line.quantity || 0) * (line.rate || 0) * 100) / 100;
      return {
        ...line,
        gross,
        disc: 0,
        taxable: gross,
        tax: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: gross,
      };
    });
  }, [lines]);

  const subtotal = useMemo(() => {
    return computedLines.reduce((acc, l) => acc + l.gross, 0);
  }, [computedLines]);

  const discountTotal = useMemo(() => {
    return Math.round(Math.min(subtotal, Math.max(0, invoiceDiscount || 0)) * 100) / 100;
  }, [subtotal, invoiceDiscount]);

  const taxableAmount = useMemo(() => {
    return Math.round(Math.max(0, subtotal - discountTotal) * 100) / 100;
  }, [subtotal, discountTotal]);

  const effectiveGstRate = useMemo(() => {
    return gstMode === 'EXEMPT' ? 0 : Math.max(0, invoiceGstRate || 0);
  }, [gstMode, invoiceGstRate]);

  const totalTax = useMemo(() => {
    return Math.round(((taxableAmount * effectiveGstRate) / 100) * 100) / 100;
  }, [taxableAmount, effectiveGstRate]);

  const { cgstAmount, sgstAmount, igstAmount, cgstRate, sgstRate, igstRate } = useMemo(() => {
    if (effectiveGstRate === 0 || totalTax === 0 || gstMode === 'EXEMPT') {
      return { cgstAmount: 0, sgstAmount: 0, igstAmount: 0, cgstRate: 0, sgstRate: 0, igstRate: 0 };
    }
    if (gstMode === 'INTER_STATE') {
      return {
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: totalTax,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: effectiveGstRate,
      };
    }
    const halfRate = Math.round((effectiveGstRate / 2) * 100) / 100;
    const halfTax = Math.round((totalTax / 2) * 100) / 100;
    const remainderTax = Math.round((totalTax - halfTax) * 100) / 100;
    return {
      cgstAmount: halfTax,
      sgstAmount: remainderTax,
      igstAmount: 0,
      cgstRate: halfRate,
      sgstRate: halfRate,
      igstRate: 0,
    };
  }, [gstMode, effectiveGstRate, totalTax]);

  const rawGrandTotal = useMemo(() => {
    return Math.round((taxableAmount + totalTax + (courierCharges || 0)) * 100) / 100;
  }, [taxableAmount, totalTax, courierCharges]);

  const grandTotal = useMemo(() => {
    return Math.round(rawGrandTotal);
  }, [rawGrandTotal]);

  const roundOff = useMemo(() => {
    return Math.round((grandTotal - rawGrandTotal) * 100) / 100;
  }, [grandTotal, rawGrandTotal]);

  const totalQuantity = useMemo(() => {
    return lines.reduce((acc, l) => acc + (l.quantity || 0), 0);
  }, [lines]);

  const totals: VoucherTotals = {
    subtotal,
    discountTotal,
    taxableAmount,
    gstRate: effectiveGstRate,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    igstRate,
    igstAmount,
    totalTax,
    courierCharges: courierCharges || 0,
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
    if (currentBusiness?.id && user?.id) {
      clearVoucherDraft(currentBusiness.id, user.id, 'PURCHASE', editInvoiceId || editOrderId || null);
    }
    setCreatedInvoice(null);
    setShowPrintModal(false);
    setSupplierPartyId('');
    setSelectedParty(null);
    setPartyBalance(null);
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setSupplierInvoiceNumber('');
    setSupplierInvoiceDate('');
    setNotes('');
    setCourierCharges(0);
    setInvoiceDiscount(0);
    setInvoiceGstRate(0);
    setLines([createEmptyVoucherLine('p-row')]);
    setError(null);
    baselineSnapshotRef.current = normalizeVoucherSnapshot(null);
    setDirty(false);
    loadData();

    setTimeout(() => {
      const partyInput = document.getElementById('voucher-header-party-input') as HTMLInputElement;
      if (partyInput) {
        partyInput.focus();
        partyInput.select();
      }
    }, 120);
  };

  // Save / Post Invoice
  const handleSaveInvoice = async (andPost: boolean = false, isSaveAndNew: boolean = false): Promise<any | null> => {
    if (submitting) return null;
    if (existingStatus === 'CANCELLED') {
      setError(
        'Cannot edit this Purchase Invoice because it has been CANCELLED. Cancelled invoices are permanently read-only.'
      );
      return null;
    }
    if (!supplierPartyId) {
      setError('Please select a Supplier A/c Name');
      return null;
    }

    const nonBlankLines = lines.filter(l => !isVoucherLineEmpty(l));

    if (nonBlankLines.length === 0) {
      setError('Invoice must contain at least 1 stock item line');
      return null;
    }

    // Validate non-blank lines
    for (let i = 0; i < nonBlankLines.length; i++) {
      const line = nonBlankLines[i];
      const lineNum = i + 1;
      const itemName = line.uniqueItemName || 'Item';

      if (!line.uniqueItemId) {
        setError(`Line #${lineNum}: Stock Item is required.`);
        return null;
      }

      if (line.maintainBatches !== false) {
        if (!line.batches || line.batches.length === 0) {
          setError(`Line #${lineNum} (${itemName}): Batch allocations are required. Please allocate at least one batch.`);
          return null;
        }
        const unresolved = line.batches.filter(b => (b as any).unresolved || !b.batchId);
        if (unresolved.length > 0) {
          setError(
            `Line #${lineNum} (${itemName}): Contains ${unresolved.length} unresolved batch power(s). Please open batch allocations and select or create valid batches.`
          );
          return null;
        }
        const sumBatches = line.batches.reduce(
          (sum, b) => sum + Number(b.quantity || 0),
          0
        );
        if (sumBatches <= 0 || Math.abs(sumBatches - line.quantity) > 0.001) {
          setError(
            `Line #${lineNum} (${itemName}): Sum of batch quantities (${sumBatches}) must equal line quantity (${line.quantity})`
          );
          return null;
        }
      }

      const itemUnit = (uniqueItemsList.find(u => u.id === line.uniqueItemId)?.unit || line.unit || 'PRS').toUpperCase();
      const isDiscrete = ['PCS', 'PIECES', 'BOX', 'BOXES', 'NOS', 'PKT', 'PACKET', 'UNIT', 'UNITS'].includes(itemUnit);
      if (isDiscrete) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1) {
          setError(`Line #${lineNum} (${itemName}): Quantity must be a positive whole integer for unit ${itemUnit}.`);
          return null;
        }
      } else {
        if (line.quantity < 0.5 || Math.round(line.quantity * 2) !== line.quantity * 2) {
          setError(`Line #${lineNum} (${itemName}): Quantity must be in increments of 0.5 (min 0.5) for unit ${itemUnit}.`);
          return null;
        }
      }

      if (line.rate < 0) {
        setError(`Line #${lineNum} (${itemName}) has negative purchase price.`);
        return null;
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
          discountTotal: discountTotal,
          gstRate: effectiveGstRate,
          courierCharges: courierCharges || 0,
          notes: notes.trim() || undefined,
          lines: nonBlankLines.map(l => ({
            uniqueItemId: l.uniqueItemId,
            quantity: l.quantity,
            rate: l.rate,
            discountType: 'NONE',
            discountValue: 0,
            gstRate: effectiveGstRate,
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
        if (!isSaveAndNew) {
          setShowPrintModal(true);
        }

        if (onSuccess && resultOrder?.id) {
          onSuccess(resultOrder.id);
        }
        return resultOrder;
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
        discountTotal: discountTotal,
        gstRate: effectiveGstRate,
        courierCharges: courierCharges || 0,
        notes: notes.trim() || undefined,
        status: 'POSTED',
        lines: nonBlankLines.map(l => ({
          uniqueItemId: l.uniqueItemId,
          quantity: l.quantity,
          rate: l.rate,
          discountType: 'NONE',
          discountValue: 0,
          gstRate: effectiveGstRate,
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
              discountTotal: payload.discountTotal,
              gstRate: payload.gstRate,
              courierCharges: payload.courierCharges,
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
      if (currentBusiness?.id && user?.id) {
        clearVoucherDraft(currentBusiness.id, user.id, 'PURCHASE', editInvoiceId || editOrderId || null);
      }
      baselineSnapshotRef.current = currentVoucherSnapshot;
      setDirty(false);

      const showSuccessPopup = settings?.voucher?.showSuccessModalAfterSave ?? false;
      if (!isSaveAndNew || showSuccessPopup) {
        setShowPrintModal(true);
      } else {
        setShowPrintModal(false);
      }

      if (!isSaveAndNew && onSuccess && resultId) {
        onSuccess(resultId);
      }
      return finalInvoice;
    } catch (err: any) {
      setError(err.message || 'Failed to save purchase invoice');
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  // Save & New (Ctrl+A)
  const handleSaveAndNew = async () => {
    if (submitting) return;
    const showSuccessPopup = settings?.voucher?.showSuccessModalAfterSave ?? false;
    const saved = await handleSaveInvoice(true, true);
    if (saved && !showSuccessPopup) {
      handleResetForm();
    }
  };

  // Print Shortcut (Ctrl+P)
  const handlePrintShortcut = async () => {
    if (submitting) return;
    let inv = createdInvoice;
    if (!inv && !editInvoiceId && !editOrderId) {
      inv = await handleSaveInvoice(true, false);
      if (!inv) return;
    }
    setAutoInvokePrint(false);
    setIsPrintPreviewOpen(true);
  };

  const saveAndNewRef = useRef(handleSaveAndNew);
  saveAndNewRef.current = handleSaveAndNew;
  const printShortcutRef = useRef(handlePrintShortcut);
  printShortcutRef.current = handlePrintShortcut;

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
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxableAmount: totals.taxableAmount,
      gstRate: totals.gstRate,
      cgstRate: totals.cgstRate,
      cgstAmount: totals.cgstAmount,
      sgstRate: totals.sgstRate,
      sgstAmount: totals.sgstAmount,
      igstRate: totals.igstRate,
      igstAmount: totals.igstAmount,
      courierCharges: totals.courierCharges,
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
    setCourierCharges(0);
    setInvoiceDiscount(0);
    setInvoiceGstRate(0);
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
          subtitle: `${p.phone || p.mobile || ''} ${p.city ? `• ${p.city}` : ''} ${p.state ? `• ${p.state}` : ''}`.trim() || undefined,
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
          rightSubText: `GST: ${item.gstRate ?? (item as any).taxRate ?? 0}%`,
          meta: item,
        };
      });
    }

    return [];
  }, [contextualType, contextualSearch, suppliers, uniqueItemsList]);

  const contextualStateRef = useRef({
    type: contextualType,
    rowIndex: contextualRowIndex,
    items: contextualItems,
    selectedIdx: contextualSelectedIdx,
  });
  useEffect(() => {
    contextualStateRef.current = {
      type: contextualType,
      rowIndex: contextualRowIndex,
      items: contextualItems,
      selectedIdx: contextualSelectedIdx,
    };
  });

  const isPartyTarget = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    return (
      el.id === 'voucher-header-party-input' ||
      Boolean(el.closest('[data-contextual-owner="party"]')) ||
      Boolean(el.closest('#tally-contextual-panel'))
    );
  };

  const isStockItemTarget = (el: HTMLElement | null, rowIndex: number | null): boolean => {
    if (!el) return false;
    if (el.closest('#tally-contextual-panel')) return true;
    if (rowIndex === null) return false;
    return (
      el.id === `voucher-item-grid-select-${rowIndex}` ||
      Boolean(el.closest(`[data-contextual-owner="stock-item-${rowIndex}"]`))
    );
  };

  const isAnyStockItemInput = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    return Boolean(
      (el.id && el.id.startsWith('voucher-item-grid-select-')) ||
      el.closest('[data-contextual-owner^="stock-item-"]')
    );
  };

  const handleConfirmContextualSelect = useCallback((item: ContextualPanelItem) => {
    const currentType = contextualStateRef.current.type;
    const currentRowIndex = contextualStateRef.current.rowIndex;
    if (currentType === 'PARTY') {
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
    } else if (currentType === 'STOCK_ITEM' && currentRowIndex !== null) {
      const rIdx = currentRowIndex;
      closeContextualPanel();
      handleLineItemChange(rIdx, item.id);
    }
  }, [closeContextualPanel, handleLineItemChange, handlePartyChange]);

  // Close contextual panel when focus moves to an unrelated field (e.g. Purchase Price, Rate, Qty, Disc, GST, Amount) or when clicking outside
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const state = contextualStateRef.current;
      if (!state.type) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Keep open if interacting with the contextual panel itself
      if (target.closest('#tally-contextual-panel')) return;

      if (state.type === 'PARTY') {
        if (!isPartyTarget(target) && !isAnyStockItemInput(target)) {
          closeContextualPanel();
        }
      } else if (state.type === 'STOCK_ITEM') {
        if (!isStockItemTarget(target, state.rowIndex) && !isAnyStockItemInput(target) && !isPartyTarget(target)) {
          closeContextualPanel();
        }
      }
    };

    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      const state = contextualStateRef.current;
      if (!state.type) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Do not close if interacting with an active modal or dialog
      if (
        target.closest('[role="dialog"]') ||
        target.closest('.modal-container') ||
        target.closest('#inline-party-modal') ||
        target.closest('#inline-stock-item-modal')
      ) {
        return;
      }

      // Keep open if clicking inside the contextual panel
      if (target.closest('#tally-contextual-panel')) return;

      if (state.type === 'PARTY') {
        if (!isPartyTarget(target) && !isAnyStockItemInput(target)) {
          closeContextualPanel();
        }
      } else if (state.type === 'STOCK_ITEM') {
        if (!isStockItemTarget(target, state.rowIndex) && !isAnyStockItemInput(target) && !isPartyTarget(target)) {
          closeContextualPanel();
        }
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeContextualPanel]);

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
      const state = contextualStateRef.current;
      const active = document.activeElement as HTMLElement | null;

      // Escape closes contextual panel if open
      if (e.key === 'Escape') {
        if (state.type !== null) {
          e.preventDefault();
          closeContextualPanel();
          return;
        }
      }

      // Up/Down/Enter navigation: ONLY when the owning input or panel is actively focused!
      if (state.type === 'PARTY' && isPartyTarget(active)) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setContextualSelectedIdx(prev =>
            Math.min(prev + 1, Math.max(0, state.items.length - 1))
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setContextualSelectedIdx(prev => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          if (state.items[state.selectedIdx]) {
            e.preventDefault();
            handleConfirmContextualSelect(state.items[state.selectedIdx]);
          }
          return;
        }
      } else if (
        state.type === 'STOCK_ITEM' &&
        state.rowIndex !== null &&
        isStockItemTarget(active, state.rowIndex)
      ) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setContextualSelectedIdx(prev =>
            Math.min(prev + 1, Math.max(0, state.items.length - 1))
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setContextualSelectedIdx(prev => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          if (state.items[state.selectedIdx]) {
            e.preventDefault();
            handleConfirmContextualSelect(state.items[state.selectedIdx]);
          }
          return;
        }
      }

      // Hotkeys for voucher actions
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveInvoice(true, false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        saveAndNewRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        printShortcutRef.current();
      } else if (e.altKey && e.key.toLowerCase() === 'd' && (editInvoiceId || editOrderId) && canDelete) {
        e.preventDefault();
        setShowDeleteConfirm(true);
      } else if (e.altKey && e.key.toLowerCase() === 'x' && (editInvoiceId || editOrderId) && canCancel) {
        e.preventDefault();
        setShowCancelConfirm(true);
      } else if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        printShortcutRef.current();
      }
    };

    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [
    editInvoiceId,
    editOrderId,
    canDelete,
    canCancel,
    closeContextualPanel,
    handleConfirmContextualSelect,
  ]);

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

  return (
    <div
      id="normal-purchase-voucher-page"
      className="flex flex-col h-full w-full bg-[#f1f5f9] select-none font-sans overflow-hidden min-h-0"
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
        <div className="flex-1 min-w-0 flex flex-col h-full min-h-0 overflow-hidden bg-white border border-slate-300 rounded-xs shadow-2xs">
          {/* Unsaved Draft Recovery Banner */}
          {availableDraft && (
            <VoucherDraftRecoveryBanner
              savedAt={availableDraft.savedAt}
              itemCount={availableDraft.form.lines?.length || 0}
              partyName={
                availableDraft.form.partyId
                  ? suppliers.find(p => p.id === availableDraft.form.partyId)?.name
                  : undefined
              }
              onRestore={handleRestoreDraft}
              onDiscard={handleDiscardDraft}
            />
          )}

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
            onPartyCreated={handlePartyCreated}
            onRequestCreateParty={handleOpenPartyModal}
            onPartyFocus={openContextualParty}
            onPartyQueryChange={setContextualSearch}
            partyBalance={partyBalance || undefined}
            gstMode={gstMode}
            onGstModeChange={setGstMode}
            partyStateValidation={{
              bizState: getDisplayStateName(bizState),
              partyState: getDisplayStateName(partyState),
              isMissing: isPartyStateMissing,
              isInterState: gstMode === 'INTER_STATE',
            }}
            onPartyStateChange={handlePartyStateChange}
            referenceNumber={supplierInvoiceNumber}
            onReferenceNumberChange={setSupplierInvoiceNumber}
            supplierInvoiceDate={supplierInvoiceDate}
            onSupplierInvoiceDateChange={setSupplierInvoiceDate}
            submitting={submitting}
            onSavePost={() => handleSaveInvoice(true, false)}
            onSaveAndNew={handleSaveAndNew}
            onPrint={() => {
              setAutoInvokePrint(false);
              setIsPrintPreviewOpen(true);
            }}
            onBack={onBack}
          />

          {/* 2. Dominant Item Grid */}
          <div className="flex-1 min-h-0 p-1 flex flex-col overflow-hidden max-h-full">
            <VoucherItemGrid
              voucherType="PURCHASE"
              lines={lines}
              computedLines={computedLines}
              allItems={uniqueItemsList}
              focusRequest={focusRequest}
              activeRowIndex={activeGridRow}
              onActiveRowChange={setActiveGridRow}
              onItemFocus={openContextualItem}
              onItemQueryChange={setContextualSearch}
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
            onGstModeChange={setGstMode}
            narration={notes}
            onNarrationChange={setNotes}
            discount={invoiceDiscount}
            onDiscountChange={setInvoiceDiscount}
            gstRate={invoiceGstRate}
            onGstRateChange={setInvoiceGstRate}
            courierCharges={courierCharges}
            onCourierChargesChange={setCourierCharges}
            previousBalance={partyBalance}
            errorMessage={error}
            isEditing={isOrder ? !!editOrderId : !!editInvoiceId}
            canDelete={canDelete}
            canCancel={canCancel}
            submitting={submitting}
            onSave={() => handleSaveInvoice(true, false)}
            onSaveAndNew={handleSaveAndNew}
            onDelete={() => setShowDeleteConfirm(true)}
            onCancelVoucher={() => setShowCancelConfirm(true)}
            onPrint={handlePrintShortcut}
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
              handleOpenPartyModal(contextualSearch);
            } else if (contextualType === 'STOCK_ITEM' && contextualRowIndex !== null) {
              const sel = document.getElementById(`voucher-item-grid-select-${contextualRowIndex}`);
              sel?.focus();
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

      {/* 3.5 Stock Item Change Confirmation / Warning Modal */}
      {stockItemChangeModal && (
        <StockItemChangeModal
          isOpen={true}
          isSameCategory={stockItemChangeModal.isSameCategory}
          oldItemName={stockItemChangeModal.oldLine.uniqueItemName}
          oldItemCode={stockItemChangeModal.oldLine.uniqueItemCode}
          newItemName={stockItemChangeModal.newItem.name}
          newItemCode={stockItemChangeModal.newItem.code}
          categoryCode={stockItemChangeModal.categoryCode}
          allocationsCount={stockItemChangeModal.oldLine.batches?.length || 0}
          onConfirm={handleConfirmItemChange}
          onCancel={handleCancelItemChange}
        />
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

      {/* Inline Party Creation Modal */}
      {isPartyModalOpen && (
        <InlinePartyModal
          isOpen={isPartyModalOpen}
          onClose={() => {
            setIsPartyModalOpen(false);
            setTimeout(() => {
              const partyInput = document.getElementById('voucher-header-party-input');
              partyInput?.focus();
            }, 50);
          }}
          defaultPartyType="SUPPLIER"
          initialName={partyModalInitialName}
          onSuccess={handlePartyCreated}
        />
      )}
    </div>
  );
};

export const NormalPurchaseVoucherPage = CreatePurchaseInvoicePage;
