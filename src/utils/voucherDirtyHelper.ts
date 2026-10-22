/**
 * Voucher Dirty-State Calculation and Baseline Comparison Helper
 * Accurately detects real unsaved modifications in Sales and Purchase vouchers
 * without falsely triggering on blank trailing rows or pristine form opens.
 */

export interface VoucherLineSnapshot {
  uniqueItemId?: string | null;
  quantity?: number | null;
  rate?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
  gstRate?: number | null;
  batches?: Array<{
    batchId?: string | null;
    quantity?: number | null;
    rate?: number | null;
    sph?: string | number | null;
    cyl?: string | number | null;
    axis?: string | number | null;
    add?: string | number | null;
    side?: string | null;
  }> | null;
}

export interface VoucherFormState {
  partyId?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  paymentMode?: string | null;
  paymentTerms?: string | null;
  referenceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  notes?: string | null;
  courierCharges?: number | null;
  invoiceDiscount?: number | null;
  invoiceGstRate?: number | null;
  partyStateOverride?: string | null;
  gstMode?: string | null;
  lines?: VoucherLineSnapshot[] | null;
}

/**
 * Normalizes a voucher state for deterministic, order-independent comparison.
 * Filters out trailing blank placeholder rows that have no item, quantity, or batches.
 */
export function normalizeVoucherSnapshot(state?: VoucherFormState | null) {
  if (!state) {
    return {
      partyId: '',
      invoiceDate: '',
      dueDate: '',
      paymentMode: 'CREDIT',
      referenceNumber: '',
      supplierInvoiceDate: '',
      notes: '',
      courierCharges: 0,
      invoiceDiscount: 0,
      invoiceGstRate: 0,
      partyStateOverride: '',
      gstMode: 'INTRA_STATE',
      lines: [],
    };
  }

  const partyId = (state.partyId || '').trim();
  const invoiceDate = (state.invoiceDate || '').trim();
  const dueDate = (state.dueDate || '').trim();
  const paymentMode = (state.paymentMode || 'CREDIT').trim();
  const referenceNumber = (state.referenceNumber || '').trim();
  const supplierInvoiceDate = (state.supplierInvoiceDate || '').trim();
  const notes = (state.notes || '').trim();
  const courierCharges = Math.round(Number(state.courierCharges || 0) * 100) / 100;
  const invoiceDiscount = Math.round(Number(state.invoiceDiscount || 0) * 100) / 100;
  const invoiceGstRate = Number(state.invoiceGstRate || 0);
  const partyStateOverride = (state.partyStateOverride || '').trim();
  const gstMode = (state.gstMode || 'INTRA_STATE').trim();

  // Filter out empty rows (blank rows added for UX)
  const activeLines = (state.lines || [])
    .filter(line => {
      const hasItem = Boolean(line.uniqueItemId && String(line.uniqueItemId).trim().length > 0);
      const hasQty = Number(line.quantity || 0) > 0;
      const hasBatches = Boolean(
        line.batches &&
        line.batches.length > 0 &&
        line.batches.some(b => Number(b.quantity || 0) > 0 || (b.batchId && String(b.batchId).trim().length > 0))
      );
      return hasItem || hasQty || hasBatches;
    })
    .map(line => {
      const rawBatches = (line.batches || [])
        .filter(b => Number(b.quantity || 0) > 0 || (b.batchId && String(b.batchId).trim().length > 0))
        .map(b => ({
          batchId: String(b.batchId || '').trim(),
          quantity: Number(b.quantity || 0),
          rate: Number(b.rate || 0),
          sph: String(b.sph ?? '').trim(),
          cyl: String(b.cyl ?? '').trim(),
          axis: String(b.axis ?? '').trim(),
          add: String(b.add ?? '').trim(),
          side: String(b.side ?? '').trim(),
        }))
        .sort((a, b) => {
          if (a.batchId !== b.batchId) return a.batchId.localeCompare(b.batchId);
          return a.quantity - b.quantity;
        });

      return {
        uniqueItemId: String(line.uniqueItemId || '').trim(),
        quantity: Number(line.quantity || 0),
        rate: Number(line.rate || 0),
        discountType: line.discountType || 'NONE',
        discountValue: Number(line.discountValue || 0),
        gstRate: Number(line.gstRate || 0),
        batches: rawBatches,
      };
    });

  return {
    partyId,
    invoiceDate,
    dueDate,
    paymentMode,
    referenceNumber,
    supplierInvoiceDate,
    notes,
    courierCharges,
    invoiceDiscount,
    invoiceGstRate,
    partyStateOverride,
    gstMode,
    lines: activeLines,
  };
}

/**
 * Checks if a voucher form differs in any real, persisted field from its saved baseline.
 */
export function isVoucherDirty(current: VoucherFormState, baseline: VoucherFormState): boolean {
  const normCurrent = normalizeVoucherSnapshot(current);
  const normBaseline = normalizeVoucherSnapshot(baseline);
  return JSON.stringify(normCurrent) !== JSON.stringify(normBaseline);
}

/**
 * Checks if the voucher has any entered data at all (useful for deciding whether to auto-save a draft).
 */
export function hasEnteredVoucherData(state: VoucherFormState): boolean {
  const norm = normalizeVoucherSnapshot(state);
  return (
    norm.partyId !== '' ||
    norm.referenceNumber !== '' ||
    norm.notes !== '' ||
    norm.courierCharges > 0 ||
    norm.invoiceDiscount > 0 ||
    norm.lines.length > 0
  );
}
