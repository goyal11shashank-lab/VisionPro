import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search,
  X,
  Check,
  Plus,
  Trash2,
  Layers,
  AlertCircle,
  Hash,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest } from '../../api/client';
import {
  formatOpticalBatchName,
  rankSearchMatch,
} from '../../utils/searchNormalization';
import { BatchAllocation, OpticalCategoryCode } from './VoucherTypes';
import { useBusinessSettings } from '../../context/BusinessSettingsContext';

/**
 * Checks whether a quantity is a valid quantity for the item's unit:
 * - PRS (Pairs): strictly > 0 and multiples of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0).
 * - PCS (Pieces): strictly > 0 and whole integer only (e.g. 1, 2, 3...).
 */
export function isValidQtyForUnit(qty: number, unit: string = 'PRS'): boolean {
  if (isNaN(qty) || qty <= 0) return false;
  if (unit.toUpperCase() === 'PCS') {
    return Math.abs(Math.round(qty) - qty) < 0.0001;
  }
  const doubled = qty * 2;
  return Math.abs(Math.round(doubled) - doubled) < 0.0001;
}

export function isValidHalfStepQty(qty: number): boolean {
  return isValidQtyForUnit(qty, 'PRS');
}

export function parsePowerFromQuery(query: string) {
  if (!query) return { sph: '0.00', cyl: '0.00', axis: '' };
  const clean = query.trim();
  const parts = clean.split(/[\s/|,]+/);
  let sph = '0.00';
  let cyl = '0.00';
  let axis = '';
  if (parts.length >= 1 && !isNaN(parseFloat(parts[0]))) {
    const s = parseFloat(parts[0]);
    sph = s > 0 ? `+${s.toFixed(2)}` : s.toFixed(2);
  }
  if (parts.length >= 2 && !isNaN(parseFloat(parts[1]))) {
    const c = parseFloat(parts[1]);
    cyl = c > 0 ? `+${c.toFixed(2)}` : c.toFixed(2);
  }
  if (parts.length >= 3 && !isNaN(parseInt(parts[2], 10))) {
    axis = String(Math.min(180, Math.max(0, parseInt(parts[2], 10))));
  }
  return { sph, cyl, axis };
}

export interface OpticalBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (batches: BatchAllocation[], lineQty: number) => void;
  mode: 'sales' | 'purchase';
  allowBatchCreate?: boolean;
  itemName: string;
  itemCode?: string;
  uniqueItemId?: string;
  categoryCode?: OpticalCategoryCode | string;
  unit?: 'PRS' | 'PCS' | string;
  initialBatches: BatchAllocation[];
  availableBatches?: any[];
  lineQuantity?: number;
  lineRate?: number;
}

export interface AllocationRecord {
  rowId: string;
  batchId?: string;
  batch: any;
  quantityStr: string;
  error?: string | null;
  unresolved?: boolean;
}

export const OpticalBatchModal: React.FC<OpticalBatchModalProps> = ({
  isOpen,
  onClose,
  onApply,
  mode,
  allowBatchCreate,
  itemName,
  itemCode,
  uniqueItemId,
  categoryCode = 'SV',
  unit = 'PRS',
  initialBatches,
  availableBatches: propAvailableBatches = [],
  lineQuantity = 1,
  lineRate = 0,
}) => {
  const { settings } = useBusinessSettings();
  const canCreateBatch =
    allowBatchCreate !== undefined
      ? allowBatchCreate
      : mode === 'purchase'
      ? settings?.purchase?.allowNewBatchCreation ?? true
      : settings?.sales?.allowNewBatchCreation ?? true;

  const normCategory = (String(categoryCode || 'SV').toUpperCase()) as OpticalCategoryCode;
  const isBifocalOrProg = normCategory === 'KT' || normCategory === 'PROG';
  const unitDisplay = (unit || 'PRS').toUpperCase();
  const isPcs = unitDisplay === 'PCS';

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  // Cache of known batches for this unique item to allow instant client search
  const batchesCacheRef = useRef<any[]>([]);

  // Allocated batches: individual rows, each with its own rowId to allow entering same power multiple times
  const [allocations, setAllocations] = useState<AllocationRecord[]>([]);

  // Global form errors
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Batch creation drawer
  const [showCreateBatch, setShowCreateBatch] = useState(false);
  const [newSph, setNewSph] = useState('0.00');
  const [newCyl, setNewCyl] = useState('0.00');
  const [newAxis, setNewAxis] = useState('');
  const [newAdd, setNewAdd] = useState('');
  const [newSide, setNewSide] = useState<'NONE' | 'R' | 'L' | 'BE'>('NONE');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const prefillFromSearch = (query: string) => {
    const parsed = parsePowerFromQuery(query);
    if (parsed.sph !== '0.00' || parsed.cyl !== '0.00') {
      setNewSph(parsed.sph);
      setNewCyl(parsed.cyl);
      if (parsed.axis) setNewAxis(parsed.axis);
    }
  };

  // Input element refs for keyboard flow
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownListRef = useRef<HTMLDivElement>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Reset & initialize state on open
  useEffect(() => {
    if (!isOpen) return;

    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
    setActiveSearchIndex(0);
    setErrorMessage(null);
    setShowCreateBatch(false);

    // Populate initial allocations (each entry in initialBatches retains its own independent row)
    const initialRows: AllocationRecord[] = (initialBatches || []).map((b, idx) => {
      const batchObj = (b as any).batch || b;
      const rawId = b.batchId || (b as any).id || (b as any).batch?.id;
      const sphVal =
        batchObj.sph !== undefined && batchObj.sph !== null && batchObj.sph !== ''
          ? batchObj.sph
          : b.sph ?? '0.00';
      const cylVal =
        batchObj.cyl !== undefined && batchObj.cyl !== null && batchObj.cyl !== ''
          ? batchObj.cyl
          : b.cyl ?? '0.00';
      const axisVal =
        batchObj.axis !== undefined && batchObj.axis !== null ? batchObj.axis : b.axis ?? '';
      const addVal =
        batchObj.add !== undefined && batchObj.add !== null ? batchObj.add : b.add ?? '';
      const sideVal = batchObj.side || b.side || 'NONE';
      const barcodeVal = batchObj.barcode || b.barcode;
      const stockVal = Number(batchObj.availableStock ?? b.availableStock ?? 0);
      const isUnresolved = Boolean((b as any).unresolved || !rawId);

      const rowId = `init-row-${idx}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const formattedName = formatOpticalBatchName({
        sph: sphVal,
        cyl: cylVal,
        axis: axisVal,
        add: addVal,
        side: sideVal,
        categoryCode: normCategory,
      });

      return {
        rowId,
        batchId: rawId || undefined,
        batch: {
          id: rawId,
          sph: sphVal,
          cyl: cylVal,
          axis: axisVal,
          add: addVal,
          side: sideVal,
          barcode: barcodeVal,
          availableStock: stockVal,
          rate: b.rate !== undefined ? Number(b.rate) : undefined,
          formattedName,
        },
        quantityStr: String(b.quantity ?? 1),
        error: isUnresolved ? (b as any).error || 'Batch power not found for this item' : null,
        unresolved: isUnresolved,
      };
    });

    setAllocations(initialRows);

    // Initialize batch cache from props or fetch immediately from server
    if (propAvailableBatches && propAvailableBatches.length > 0) {
      batchesCacheRef.current = propAvailableBatches;
    } else {
      batchesCacheRef.current = [];
    }

    if (uniqueItemId) {
      apiRequest<{ batches: any[] }>(
        `/api/sales/unique-items/${uniqueItemId}/batches?limit=1000&onlyInStock=false`
      )
        .then(res => {
          if (res.batches && res.batches.length > 0) {
            batchesCacheRef.current = res.batches;
          }
        })
        .catch(err => {
          console.warn('Preload batches error:', err);
        });
    }

    // Auto-focus search input
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 60);
  }, [isOpen, initialBatches, normCategory, propAvailableBatches, uniqueItemId]);

  // Debounced search-driven batch querying
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setShowDropdown(false);
      setIsSearching(false);
      return;
    }

    setShowDropdown(true);
    setActiveSearchIndex(0);

    // If we have cached batches, do immediate client search to avoid delay
    if (batchesCacheRef.current.length > 0) {
      const clientMatches = rankSearchMatch(
        batchesCacheRef.current,
        trimmed,
        (b: any) => ({
          id: b.id,
          name:
            b.formattedName ||
            formatOpticalBatchName({
              sph: b.sph,
              cyl: b.cyl,
              axis: b.axis,
              add: b.add,
              side: b.side,
              categoryCode: normCategory,
            }),
          sph: b.sph,
          cyl: b.cyl,
          axis: b.axis,
          add: b.add,
          side: b.side,
          barcode: b.barcode,
          rawText: `${b.barcode || ''} ${b.batchNumber || ''}`,
        })
      );
      setSearchResults(clientMatches.slice(0, 25));
    }

    // Call server search with debounce to guarantee up-to-date stock
    let cancelled = false;
    setIsSearching(true);

    const timer = setTimeout(() => {
      if (!uniqueItemId) {
        setIsSearching(false);
        return;
      }

      apiRequest<{ batches: any[] }>(
        `/api/sales/unique-items/${uniqueItemId}/batches?search=${encodeURIComponent(
          trimmed
        )}&limit=25&onlyInStock=false`
      )
        .then(res => {
          if (cancelled) return;
          const batches = res.batches || [];
          setSearchResults(batches);
          // Merge newly found batches into cache
          const existingIds = new Set(batchesCacheRef.current.map(b => b.id));
          batches.forEach(b => {
            if (!existingIds.has(b.id)) {
              batchesCacheRef.current.push(b);
              existingIds.add(b.id);
            }
          });
        })
        .catch(err => {
          if (cancelled) return;
          console.warn('Batch search error:', err);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, uniqueItemId, normCategory]);

  // Keep dropdown highlighted item in view during arrow navigation
  useEffect(() => {
    if (!showDropdown || !dropdownListRef.current) return;
    const activeEl = dropdownListRef.current.children[activeSearchIndex] as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeSearchIndex, showDropdown]);

  // FIX 1: Select a batch from search and add a NEW allocation row without overwriting or merging!
  const handleSelectBatch = useCallback(
    (batch: any) => {
      setSearchQuery('');
      setShowDropdown(false);
      setErrorMessage(null);

      // Generate a distinct rowId for this entry
      const rowId = `alloc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const defaultQty = lineQuantity > 0 && allocations.length === 0 ? lineQuantity : 1;
      const formattedName =
        batch.formattedName ||
        formatOpticalBatchName({
          sph: batch.sph,
          cyl: batch.cyl,
          axis: batch.axis,
          add: batch.add,
          side: batch.side,
          categoryCode: normCategory,
        });

      const fullBatch = {
        ...batch,
        formattedName,
      };

      const newRow: AllocationRecord = {
        rowId,
        batchId: batch.id,
        batch: fullBatch,
        quantityStr: String(defaultQty),
        error: null,
        unresolved: false,
      };

      // Retain existing rows and append this new allocation row
      setAllocations(prev => [...prev, newRow]);

      // Automatically focus the new row's Quantity input so salesperson can type manually
      setTimeout(() => {
        const inputEl = qtyInputRefs.current[rowId];
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 50);
    },
    [allocations.length, lineQuantity, normCategory]
  );

  // Manual quantity change handler (plain text / numbers, no spinners)
  const handleQuantityTextChange = (rowId: string, val: string) => {
    setAllocations(prev =>
      prev.map(row => {
        if (row.rowId !== rowId) return row;
        let errorMsg: string | null = null;
        if (val.trim() !== '') {
          const num = parseFloat(val);
          if (isNaN(num) || num <= 0) {
            errorMsg = 'Quantity must be > 0';
          } else if (!isValidQtyForUnit(num, unitDisplay)) {
            errorMsg = isPcs
              ? 'Must be a whole integer (e.g. 1, 2, 3)'
              : 'Must be multiple of 0.5 (e.g. 0.5, 1, 1.5, 2)';
          }
        }
        return {
          ...row,
          quantityStr: val,
          error: errorMsg,
        };
      })
    );
    setErrorMessage(null);
  };

  // When Enter is pressed in Quantity input -> Accept quantity and return focus to Search for next entry
  const handleQuantityKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowId: string
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = allocations.find(r => r.rowId === rowId);
      const num = parseFloat(row?.quantityStr || '0');

      if (isNaN(num) || num <= 0 || !isValidQtyForUnit(num, unitDisplay)) {
        setAllocations(prev =>
          prev.map(r =>
            r.rowId === rowId
              ? {
                  ...r,
                  error: isPcs
                    ? 'Must be a positive whole number (e.g. 1, 2, 3)'
                    : 'Must be a positive multiple of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0)',
                }
              : r
          )
        );
        return;
      }

      // Quantity accepted; focus returns to Search box for next batch power entry
      setSearchQuery('');
      setShowDropdown(false);
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const curIndex = allocations.findIndex(r => r.rowId === rowId);
      const targetIndex = e.key === 'ArrowDown' ? curIndex + 1 : curIndex - 1;

      if (targetIndex >= 0 && targetIndex < allocations.length) {
        const nextRow = allocations[targetIndex];
        const nextEl = qtyInputRefs.current[nextRow.rowId];
        nextEl?.focus();
        nextEl?.select();
      } else if (e.key === 'ArrowUp' && curIndex === 0) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
  };

  // Remove a batch row from current voucher allocation
  const handleRemoveAllocation = (rowId: string) => {
    setAllocations(prev => prev.filter(r => r.rowId !== rowId));
    setErrorMessage(null);

    // Return focus to search input
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleClearAll = () => {
    setAllocations([]);
    setErrorMessage(null);
    searchInputRef.current?.focus();
  };

  // Inline resolution for an unresolved batch row
  const handleResolveUnresolvedRow = async (rowId: string) => {
    const row = allocations.find(r => r.rowId === rowId);
    if (!row || !uniqueItemId) return;

    if (!canCreateBatch) {
      setErrorMessage(
        'Batch creation is disabled in business settings. Please search and select an available batch.'
      );
      return;
    }

    try {
      setErrorMessage(null);
      const res = await apiRequest<any>('/api/optical-master/batches/find-or-create', {
        method: 'POST',
        body: JSON.stringify({
          uniqueItemId,
          sph: parseFloat(String(row.batch.sph || 0)) || 0,
          cyl: parseFloat(String(row.batch.cyl || 0)) || 0,
          axis: parseInt(String(row.batch.axis || 0), 10) || 0,
          add: parseFloat(String(row.batch.add || 0)) || 0,
          side: row.batch.side || 'NONE',
        }),
      });

      const resolvedBatch = res.batch;
      if (!resolvedBatch) throw new Error('Could not resolve or create optical batch');

      // Update the allocation row
      setAllocations(prev =>
        prev.map(r =>
          r.rowId === rowId
            ? {
                ...r,
                batchId: resolvedBatch.id,
                batch: {
                  ...resolvedBatch,
                  formattedName: formatOpticalBatchName({
                    sph: resolvedBatch.sph,
                    cyl: resolvedBatch.cyl,
                    axis: resolvedBatch.axis,
                    add: resolvedBatch.add,
                    side: resolvedBatch.side,
                    categoryCode: normCategory,
                  }),
                },
                unresolved: false,
                error: null,
              }
            : r
        )
      );

      // Add to local cache
      batchesCacheRef.current.unshift(resolvedBatch);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create missing batch for this power');
    }
  };

  // Total quantity calculation across all rows (including duplicate power rows)
  const totalAllocatedQty = useMemo(() => {
    return allocations.reduce((sum, r) => {
      const num = parseFloat(r.quantityStr || '0');
      return sum + (!isNaN(num) && num > 0 ? num : 0);
    }, 0);
  }, [allocations]);

  // Validate & Finish allocations
  const handleApply = () => {
    if (allocations.length === 0) {
      setErrorMessage('Please search and add at least one batch allocation.');
      searchInputRef.current?.focus();
      return;
    }

    const invalidEntries: string[] = [];
    const unresolvedEntries: string[] = [];
    const validAllocations: BatchAllocation[] = [];

    for (const row of allocations) {
      const num = parseFloat(row.quantityStr || '0');
      const batchName =
        row.batch.formattedName ||
        formatOpticalBatchName({
          sph: row.batch.sph,
          cyl: row.batch.cyl,
          axis: row.batch.axis,
          add: row.batch.add,
          side: row.batch.side,
          categoryCode: normCategory,
        });

      if (isNaN(num) || num <= 0 || !isValidQtyForUnit(num, unitDisplay)) {
        invalidEntries.push(`${batchName} (value: "${row.quantityStr || ''}")`);
      } else if (row.unresolved || !row.batchId) {
        unresolvedEntries.push(batchName);
      } else {
        validAllocations.push({
          batchId: row.batchId,
          sph: row.batch.sph ?? '0.00',
          cyl: row.batch.cyl ?? '0.00',
          axis: row.batch.axis ?? '',
          add: row.batch.add ?? '',
          side: row.batch.side ?? 'NONE',
          quantity: num,
          rate:
            row.batch.rate !== undefined && !isNaN(Number(row.batch.rate))
              ? Number(row.batch.rate)
              : lineRate,
          barcode: row.batch.barcode,
          availableStock: parseFloat(row.batch.availableStock || 0),
        });
      }
    }

    if (unresolvedEntries.length > 0) {
      setErrorMessage(
        `Unavailable target batches detected for: ${unresolvedEntries.join(
          ', '
        )}. These batches are not registered for ${itemName}. Please create or select valid batches.`
      );
      return;
    }

    if (invalidEntries.length > 0) {
      setErrorMessage(
        isPcs
          ? `Invalid quantity for: ${invalidEntries.join(
              ', '
            )}. All quantities for PCS items must be positive whole numbers (e.g. 1, 2, 3).`
          : `Invalid quantity for: ${invalidEntries.join(
              ', '
            )}. All quantities must be positive multiples of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0).`
      );
      return;
    }

    const calculatedTotalQty = validAllocations.reduce((s, a) => s + a.quantity, 0);
    onApply(validAllocations, calculatedTotalQty);
    onClose();
  };

  // Quick batch creation drawer submit
  const handleCreateNewBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uniqueItemId) {
      setCreateError('No Stock Item ID available to link new batch');
      return;
    }

    setCreatingBatch(true);
    setCreateError(null);
    try {
      const cylVal = parseFloat(newCyl) || 0;
      const isCylNonZero = cylVal !== 0;

      const res = await apiRequest<any>('/api/optical-master/batches/find-or-create', {
        method: 'POST',
        body: JSON.stringify({
          uniqueItemId,
          sph: parseFloat(newSph) || 0,
          cyl: cylVal,
          axis: isBifocalOrProg ? (isCylNonZero ? parseInt(newAxis, 10) || 0 : 0) : 0,
          add: isBifocalOrProg ? parseFloat(newAdd) || 0 : 0,
          side: normCategory === 'PROG' ? (newSide === 'NONE' ? 'R' : newSide) : 'NONE',
        }),
      });

      const created = res.batch;
      if (!created) {
        throw new Error('Batch creation response was invalid');
      }

      // Add to batch cache
      batchesCacheRef.current.unshift(created);

      // Select and add this newly created batch as a new row
      handleSelectBatch(created);
      setShowCreateBatch(false);
      setSearchQuery('');
      setShowDropdown(false);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create optical batch');
    } finally {
      setCreatingBatch(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 animate-in fade-in duration-150"
      onKeyDown={e => {
        if (e.key === 'Escape' && !showDropdown) {
          e.preventDefault();
          onClose();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          handleApply();
        }
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl border border-slate-300 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1 bg-blue-600/30 rounded text-blue-400 border border-blue-500/40">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-white tracking-wider uppercase">
                  {allocations.length > 0 ? 'Edit Batch Allocations' : 'Batch Allocations'}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black bg-blue-600 text-white border border-blue-400 uppercase tracking-wide">
                  {normCategory}
                </span>
                <span className="text-xs text-slate-300 font-bold truncate max-w-xs">
                  {itemName}
                </span>
                {itemCode && (
                  <span className="text-[11px] text-slate-400 font-mono">({itemCode})</span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5 font-sans">
                Type batch power to add. Press <kbd className="px-1 py-0.2 bg-slate-700 rounded text-[9px] font-mono">Enter</kbd> to accept quantity and add another power. Multiple entries of the same power are permitted.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 flex items-center justify-between text-xs text-rose-800 font-sans">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-500 hover:text-rose-700 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Search & Selection Bar */}
        <div className="p-3 bg-slate-100 border-b border-slate-300 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchQuery.trim()) setShowDropdown(true);
              }}
              onKeyDown={e => {
                if (showDropdown && searchResults.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveSearchIndex(prev =>
                      prev < searchResults.length - 1 ? prev + 1 : prev
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveSearchIndex(prev => (prev > 0 ? prev - 1 : prev));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const selected = searchResults[activeSearchIndex];
                    if (selected) {
                      handleSelectBatch(selected);
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowDropdown(false);
                    setSearchQuery('');
                  }
                } else if (e.key === 'Enter') {
                  if (!searchQuery.trim()) {
                    // Enter on empty search accepts allocations
                    if (allocations.length > 0) {
                      e.preventDefault();
                      handleApply();
                    }
                  } else if (canCreateBatch) {
                    // Quick-create batch with power parsed from query
                    e.preventDefault();
                    prefillFromSearch(searchQuery);
                    setShowCreateBatch(true);
                    setShowDropdown(false);
                  }
                } else if (e.key === 'ArrowDown' && allocations.length > 0) {
                  e.preventDefault();
                  const firstInput = qtyInputRefs.current[allocations[0].rowId];
                  firstInput?.focus();
                  firstInput?.select();
                }
              }}
              placeholder="Type batch power (e.g., -3.25/0.00, or 25 1, or barcode)..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-md font-mono text-slate-900 placeholder:text-slate-400 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setShowDropdown(false);
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Filtered Dropdown Popover */}
            {showDropdown && (
              <div
                ref={dropdownListRef}
                className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-300 rounded-md shadow-xl z-30 max-h-60 overflow-y-auto divide-y divide-slate-100"
              >
                {isSearching && searchResults.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-500 font-sans">
                    Searching batches...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="py-4 px-3 text-center text-xs text-slate-500 font-sans">
                    <p className="font-semibold text-slate-700">No matching batches found</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      No batch matching &quot;{searchQuery}&quot;
                    </p>
                    {canCreateBatch && (
                      <button
                        type="button"
                        onClick={() => {
                          prefillFromSearch(searchQuery);
                          setShowCreateBatch(true);
                          setShowDropdown(false);
                        }}
                        className="mt-2 px-3 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Create Missing Batch {searchQuery ? `"${searchQuery}"` : ''}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  searchResults.map((b, idx) => {
                    const isActive = idx === activeSearchIndex;
                    const allocatedCount = allocations.filter(r => r.batchId === b.id).length;
                    const formattedName =
                      b.formattedName ||
                      formatOpticalBatchName({
                        sph: b.sph,
                        cyl: b.cyl,
                        axis: b.axis,
                        add: b.add,
                        side: b.side,
                        categoryCode: normCategory,
                      });
                    const availStock = parseFloat(
                      b.availableStock !== undefined ? b.availableStock : b.quantityRemaining || 0
                    );

                    return (
                      <div
                        key={b.id}
                        onMouseDown={e => {
                          e.preventDefault();
                          handleSelectBatch(b);
                        }}
                        onMouseEnter={() => setActiveSearchIndex(idx)}
                        className={`px-3 py-2 text-xs flex items-center justify-between cursor-pointer font-mono transition-colors ${
                          isActive
                            ? 'bg-blue-50 text-blue-900 font-bold border-l-3 border-blue-600'
                            : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{formattedName}</span>
                          {b.barcode && (
                            <span className="text-[10px] text-slate-400 font-sans flex items-center gap-0.5">
                              <Hash className="w-2.5 h-2.5" />
                              {b.barcode}
                            </span>
                          )}
                          {allocatedCount > 0 && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-sans font-bold bg-blue-100 text-blue-800 border border-blue-200">
                              Added ({allocatedCount})
                            </span>
                          )}
                        </div>

                        <div className="text-right">
                          <span
                            className={`font-semibold ${
                              availStock < 0
                                ? 'text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded'
                                : availStock === 0
                                ? 'text-amber-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {availStock.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-1 font-sans uppercase">
                            {unitDisplay}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Create New Batch Form Drawer */}
        {canCreateBatch && showCreateBatch && (
          <form
            onSubmit={handleCreateNewBatch}
            className="bg-blue-50/70 border-b border-blue-200 px-4 py-3 shrink-0 animate-in fade-in"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                <span>Create Missing Optical Batch Power</span>
              </div>
              <span className="text-[11px] text-slate-500 font-sans">
                Category: <strong>{normCategory}</strong>
              </span>
            </div>

            {createError && (
              <div className="mb-2 p-2 bg-red-100 border border-red-200 rounded text-red-700 text-xs flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">SPH</label>
                <input
                  type="number"
                  step="0.25"
                  value={newSph}
                  onChange={e => setNewSph(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-950 uppercase tracking-wider mb-0.5">
                  CYL
                </label>
                <input
                  type="number"
                  step="0.25"
                  value={newCyl}
                  onChange={e => setNewCyl(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white font-bold"
                />
              </div>

              {isBifocalOrProg && (
                <div>
                  <label className="block text-[10px] font-black text-slate-950 uppercase tracking-wider mb-0.5">
                    AXIS
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={parseFloat(newCyl) === 0 ? '0' : newAxis}
                    onChange={e => setNewAxis(e.target.value)}
                    disabled={parseFloat(newCyl) === 0}
                    placeholder="0-180"
                    className={`w-full px-2 py-1 text-xs border rounded font-mono text-center font-bold ${
                      parseFloat(newCyl) === 0
                        ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-white border-slate-300'
                    }`}
                  />
                </div>
              )}

              {isBifocalOrProg && (
                <div>
                  <label className="block text-[10px] font-black text-slate-950 uppercase tracking-wider mb-0.5">
                    +ADD
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    value={newAdd}
                    onChange={e => setNewAdd(e.target.value)}
                    placeholder="+1.00"
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white font-bold"
                  />
                </div>
              )}

              {normCategory === 'PROG' && (
                <div>
                  <label className="block text-[10px] font-black text-slate-950 uppercase tracking-wider mb-0.5">
                    SIDE
                  </label>
                  <select
                    value={newSide === 'NONE' ? 'R' : newSide}
                    onChange={e => setNewSide(e.target.value as any)}
                    className="w-full px-1.5 py-1 text-xs border border-slate-300 rounded bg-white text-slate-950 font-bold"
                  >
                    <option value="R">R (Right)</option>
                    <option value="L">L (Left)</option>
                    <option value="BE">BE (Both)</option>
                  </select>
                </div>
              )}

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={creatingBatch}
                  className="w-full py-1 px-3 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded transition-colors shadow-2xs cursor-pointer"
                >
                  {creatingBatch ? 'Adding...' : '+ Add Power'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Allocated Batches Table */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-white flex flex-col">
          <div className="px-4 py-2 bg-slate-200 border-b border-slate-300 flex items-center justify-between text-xs font-black text-slate-950 uppercase tracking-wider">
            <span>Allocated Batches:</span>
            <span className="text-slate-700 font-bold font-mono">
              {allocations.length} {allocations.length === 1 ? 'row' : 'rows'} entered
            </span>
          </div>

          {allocations.length === 0 ? (
            <div className="py-12 px-4 text-center text-xs text-slate-400 font-sans my-auto">
              <Layers className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <p className="font-bold text-slate-700">No batches allocated yet</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Type batch power in the search box above (e.g.{' '}
                <span className="font-mono font-bold text-slate-700">-3.25/0.00</span> or{' '}
                <span className="font-mono font-bold text-slate-700">25 1</span>) and press Enter to add.
              </p>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-200 text-slate-950 font-black border-b-2 border-slate-300 sticky top-0 z-10 font-sans uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-2.5 px-3 text-slate-950 font-black">#</th>
                  <th className="py-2.5 px-3 text-slate-950 font-black">Batch / Power</th>
                  <th className="py-2.5 px-3 text-right text-slate-950 font-black">Available</th>
                  <th className="py-2.5 px-3 text-right w-36 text-slate-950 font-black">
                    Qty ({unitDisplay})
                  </th>
                  <th className="py-2.5 px-2 text-center w-12 text-slate-950 font-black">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {allocations.map((row, idx) => {
                  const b = row.batch;
                  const formattedName =
                    b.formattedName ||
                    formatOpticalBatchName({
                      sph: b.sph,
                      cyl: b.cyl,
                      axis: b.axis,
                      add: b.add,
                      side: b.side,
                      categoryCode: normCategory,
                    });
                  const availStock = parseFloat(
                    b.availableStock !== undefined ? b.availableStock : b.quantityRemaining || 0
                  );
                  const hasError = Boolean(row.error);
                  const isUnresolved = Boolean(row.unresolved || !row.batchId);

                  return (
                    <tr
                      key={row.rowId}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isUnresolved ? 'bg-amber-50/60' : ''
                      }`}
                    >
                      {/* Row Index */}
                      <td className="py-2.5 px-3 text-slate-400 font-sans text-[11px]">
                        #{idx + 1}
                      </td>

                      {/* Batch / Power */}
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <span>{formattedName}</span>
                          {isUnresolved && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-sans font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              <span>Power not in {itemName}</span>
                            </span>
                          )}
                        </div>

                        {b.barcode && (
                          <div className="text-[10px] text-slate-400 font-sans flex items-center gap-1 mt-0.5">
                            <Hash className="w-2.5 h-2.5" />
                            <span>{b.barcode}</span>
                          </div>
                        )}

                        {isUnresolved && canCreateBatch && (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={() => handleResolveUnresolvedRow(row.rowId)}
                              className="text-[10px] font-sans font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>Create batch for this power</span>
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Available Stock */}
                      <td className="py-2.5 px-3 text-right">
                        {isUnresolved ? (
                          <span className="text-[11px] text-amber-700 font-sans italic">
                            Unmapped
                          </span>
                        ) : (
                          <>
                            <span
                              className={`font-semibold ${
                                availStock < 0
                                  ? 'text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded'
                                  : availStock === 0
                                  ? 'text-amber-600'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {availStock.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-1 font-sans uppercase">
                              {unitDisplay}
                            </span>
                          </>
                        )}
                      </td>

                      {/* Manual Quantity Input */}
                      <td className="py-2 px-3 text-right">
                        <div className="flex flex-col items-end">
                          <input
                            ref={el => {
                              qtyInputRefs.current[row.rowId] = el;
                            }}
                            type="text"
                            inputMode="decimal"
                            value={row.quantityStr ?? ''}
                            onChange={e => handleQuantityTextChange(row.rowId, e.target.value)}
                            onKeyDown={e => handleQuantityKeyDown(e, row.rowId)}
                            placeholder="1.0"
                            className={`w-24 px-2 py-1 text-xs text-right border rounded font-mono font-bold focus:outline-none focus:ring-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                              hasError
                                ? 'bg-red-50 border-red-400 text-red-900 focus:ring-red-500'
                                : 'bg-white border-slate-300 text-slate-900 focus:ring-blue-600 focus:border-blue-600'
                            }`}
                          />
                          {hasError && (
                            <span className="text-[10px] text-red-600 font-sans mt-0.5">
                              {row.error}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Remove Action */}
                      <td className="py-2.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveAllocation(row.rowId)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                          title="Remove Allocation Row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Summary & Accounting Actions */}
        <div className="bg-slate-100 border-t border-slate-300 px-4 py-2.5 flex items-center justify-between gap-4 shrink-0 font-sans">
          {/* Left Totals */}
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-slate-500">Total Quantity: </span>
              <span className="font-bold text-blue-800 font-mono text-sm">
                {totalAllocatedQty.toFixed(2)} {unitDisplay}
              </span>
            </div>
            {lineRate > 0 && totalAllocatedQty > 0 && (
              <>
                <div className="h-3.5 w-px bg-slate-300" />
                <div>
                  <span className="text-slate-500">Total Value: </span>
                  <span className="font-bold text-slate-900 font-mono">
                    ₹{(totalAllocatedQty * lineRate).toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2">
            {allocations.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="px-2.5 py-1 text-xs text-slate-600 hover:text-red-700 hover:bg-slate-200 rounded transition-colors cursor-pointer"
              >
                Clear All
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded border border-slate-300 transition-colors cursor-pointer"
            >
              Cancel (Esc)
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Accept Allocations (Ctrl+Enter)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
