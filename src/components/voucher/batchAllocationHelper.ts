import { BatchAllocation, OpticalCategoryCode } from './VoucherTypes';

/**
 * Normalizes an optical category code from various potential entity fields
 */
export function getOpticalCategory(item: any): OpticalCategoryCode {
  if (!item) return 'SV';
  const cat =
    item.opticalCategory ||
    item.categoryCode ||
    item.category?.code ||
    item.itemCategory ||
    item.optical_category ||
    'SV';
  const norm = String(cat).trim().toUpperCase();
  if (norm === 'SV' || norm === 'SINGLE_VISION' || norm === 'SINGLE VISION') return 'SV';
  if (norm === 'KT' || norm === 'KRYPTOK' || norm === 'BIFOCAL' || norm === 'BF') return 'KT';
  if (norm === 'PROG' || norm === 'PROGRESSIVE' || norm === 'PAL') return 'PROG';
  return 'SV';
}

/**
 * Checks whether two items belong to the same optical power category.
 * Strictly checks normalized optical category code ('SV', 'KT', 'PROG').
 */
export function isSameOpticalCategory(itemA: any, itemB: any): boolean {
  if (!itemA || !itemB) return false;
  const catA = getOpticalCategory(itemA);
  const catB = getOpticalCategory(itemB);
  return catA === catB;
}

/**
 * Re-validates and remaps batch allocations against the target item's available batches.
 * Preserves every allocation row (including duplicate power rows), quantities, rates, and order.
 * If a matching batch exists under the new stock item, it is linked.
 * If no matching batch exists, the row is preserved but clearly flagged as unresolved.
 */
export function remapBatchAllocations(
  existingBatches: BatchAllocation[],
  newItemName: string,
  targetBatches: any[],
  categoryCode: OpticalCategoryCode = 'SV'
): { remappedBatches: BatchAllocation[]; unmappedCount: number } {
  let unmappedCount = 0;

  const remappedBatches: BatchAllocation[] = (existingBatches || []).map(alloc => {
    const sphNum = parseFloat(String(alloc.sph ?? 0));
    const cylNum = parseFloat(String(alloc.cyl ?? 0));
    const axisNum = parseInt(String(alloc.axis ?? 0), 10) || 0;
    const addNum = parseFloat(String(alloc.add ?? 0));
    const sideStr = String(alloc.side || 'NONE').toUpperCase();

    // Look for a matching physical batch record under targetBatches
    const matched = targetBatches.find(candidate => {
      const cSph = parseFloat(String(candidate.sph ?? 0));
      const cCyl = parseFloat(String(candidate.cyl ?? 0));
      if (Math.abs(sphNum - cSph) > 0.001 || Math.abs(cylNum - cCyl) > 0.001) {
        return false;
      }

      if (categoryCode === 'KT' || categoryCode === 'PROG') {
        const cAxis = parseInt(String(candidate.axis ?? 0), 10) || 0;
        const cAdd = parseFloat(String(candidate.add ?? 0));
        if (cCyl !== 0 && axisNum !== cAxis) return false;
        if (Math.abs(addNum - cAdd) > 0.001) return false;
      }

      if (categoryCode === 'PROG') {
        const cSide = String(candidate.side || 'NONE').toUpperCase();
        if (sideStr !== 'NONE' && cSide !== 'NONE' && sideStr !== cSide) return false;
      }

      return true;
    });

    if (matched) {
      const availStock = parseFloat(
        matched.availableStock !== undefined
          ? matched.availableStock
          : matched.quantityRemaining !== undefined
          ? matched.quantityRemaining
          : 0
      );
      return {
        ...alloc,
        batchId: matched.id,
        barcode: matched.barcode,
        availableStock: availStock,
        unresolved: false,
        error: undefined,
      };
    } else {
      unmappedCount++;
      return {
        ...alloc,
        batchId: undefined, // Strip old item's batch ID
        barcode: undefined, // Strip old item's barcode
        availableStock: 0,
        unresolved: true,
        error: `Power not found in ${newItemName}`,
      };
    }
  });

  return { remappedBatches, unmappedCount };
}
