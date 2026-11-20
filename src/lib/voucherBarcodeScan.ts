import {
  createEmptyVoucherLine,
  isVoucherLineEmpty,
  ensureTrailingBlankRow,
  type VoucherLineItem,
  type BatchAllocation,
} from '../components/voucher/VoucherTypes.js';

/**
 * Applies one scanned barcode (server lookup result) to the voucher lines.
 * Pure: it never touches stock or the database. It only builds the new line list.
 * - Same stock item already on the voucher: add 1 to that power (batch) or add the power.
 * - New stock item: fills the empty row (or appends) with the item and that power, quantity 1.
 * - Sales: stock short for that power means nothing is added and the message says why. The limit is
 *   current available stock plus what this same saved voucher already holds of that power
 *   (originalQty), so editing a saved voucher never bypasses availability.
 * - Purchase: stock is incoming, so there is no stock limit; batch rate is set on the allocation.
 */
export interface ScanLookup {
  batch?: any;
  uniqueItem?: any;
  stock?: { availableStock?: string | number } | null;
}

export interface ScanResult {
  ok: boolean;
  lines: VoucherLineItem[];
  message: string;
}

export function formatBatchPower(b: any): string {
  const n = (v: any) => (v === undefined || v === null || v === '' ? null : String(v));
  const parts = [`SPH ${n(b?.sph) ?? '0.00'}`];
  if (n(b?.cyl) && Number(b.cyl) !== 0) parts.push(`CYL ${b.cyl}`);
  if (n(b?.axis) && Number(b.axis) !== 0) parts.push(`AXIS ${b.axis}`);
  if (n(b?.add) && Number(b.add) !== 0) parts.push(`ADD ${b.add}`);
  if (n(b?.side) && b.side !== 'NONE') parts.push(String(b.side));
  return parts.join(' ');
}

const availableOf = (d: ScanLookup): number => {
  const v = d.stock?.availableStock ?? d.batch?.availableStock ?? d.batch?.quantityRemaining ?? 0;
  const num = parseFloat(String(v));
  return Number.isFinite(num) ? num : 0;
};

export function applyScannedBatch(
  lines: VoucherLineItem[],
  data: ScanLookup,
  rate: number,
  opts: { purchase?: boolean; originalQty?: (batchId: string) => number; categoryCode?: string } = {}
): ScanResult {
  const batch = data?.batch;
  const item = data?.uniqueItem;
  if (!batch || !item) {
    return { ok: false, lines, message: 'No item is linked to this barcode' };
  }
  const power = formatBatchPower(batch);
  const available = availableOf(data);

  const idx = lines.findIndex(l => l.uniqueItemId && l.uniqueItemId === item.id);
  const currentQty =
    idx >= 0 ? (lines[idx].batches || []).find(b => b.batchId === batch.id)?.quantity || 0 : 0;

  const limit = available + (opts.originalQty ? opts.originalQty(batch.id) || 0 : 0);
  if (!opts.purchase && currentQty + 1 > limit) {
    return {
      ok: false,
      lines,
      message: `${item.name} ${power}: only ${limit} available, ${currentQty} already on this voucher`,
    };
  }

  const alloc = (qty: number): BatchAllocation => ({
    batchId: batch.id,
    sph: batch.sph || '0.00',
    cyl: batch.cyl || '0.00',
    axis: batch.axis || '',
    add: batch.add || '',
    side: batch.side || 'NONE',
    quantity: qty,
    barcode: batch.barcode,
    ...(opts.purchase ? { rate } : { availableStock: available }),
  });

  if (idx >= 0) {
    const next = lines.map((l, i) => {
      if (i !== idx) return l;
      const list = [...(l.batches || [])];
      const bi = list.findIndex(b => b.batchId === batch.id);
      if (bi >= 0) list[bi] = { ...list[bi], quantity: list[bi].quantity + 1 };
      else list.push(alloc(1));
      return { ...l, batches: list, quantity: list.reduce((s, b) => s + b.quantity, 0) };
    });
    return {
      ok: true,
      lines: next,
      message: `${item.name} ${power}: now ${currentQty + 1}`,
    };
  }

  const fresh: VoucherLineItem = {
    ...createEmptyVoucherLine('row'),
    uniqueItemId: item.id,
    uniqueItemName: item.name,
    uniqueItemCode: item.code,
    categoryCode: opts.categoryCode || item.categoryCode || 'SV',
    unit: item.unit || 'PRS',
    maintainBatches: item.maintainBatches !== false,
    quantity: 1,
    rate,
    gstRate:
      item.gstRate !== undefined && item.gstRate !== null
        ? parseFloat(String(item.gstRate))
        : item.taxRate
        ? parseFloat(item.taxRate)
        : 0,
    batches: [alloc(1)],
  };
  const lastBlank = lines.length > 0 && isVoucherLineEmpty(lines[lines.length - 1]);
  const base = lastBlank ? [...lines.slice(0, -1), { ...fresh, id: lines[lines.length - 1].id }] : [...lines, fresh];
  return {
    ok: true,
    lines: ensureTrailingBlankRow(base, 'row'),
    message: `${item.name} ${power}: added`,
  };
}
