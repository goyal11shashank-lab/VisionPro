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
  Info,
} from 'lucide-react';
import { apiRequest } from '../../api/client';
import {
  formatOpticalBatchName,
  rankSearchMatch,
} from '../../utils/searchNormalization';
import { BatchAllocation, OpticalCategoryCode } from './VoucherTypes';

/**
 * Checks whether a quantity is a valid half-step (multiple of 0.5) and strictly > 0.
 * e.g., 0.5, 1, 1.5, 2, 2.5 are valid.
 * 0.1, 0.25, 1.2, 0, -1 are invalid.
 */
export function isValidHalfStepQty(qty: number): boolean {
  if (isNaN(qty) || qty <= 0) return false;
  const doubled = qty * 2;
  return Math.abs(Math.round(doubled) - doubled) < 0.0001;
}

interface OpticalBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (batches: BatchAllocation[], lineQty: number) => void;
  mode: 'sales' | 'purchase';
  itemName: string;
  itemCode?: string;
  uniqueItemId?: string;
  categoryCode?: OpticalCategoryCode | string;
  initialBatches: BatchAllocation[];
  availableBatches?: any[];
  lineQuantity?: number;
  lineRate?: number;
}

interface AllocationRecord {
  batch: any;
  quantityStr: string;
  error?: string | null;
}

export const OpticalBatchModal: React.FC<OpticalBatchModalProps> = ({
  isOpen,
  onClose,
  onApply,
  mode,
  itemName,
  itemCode,
  uniqueItemId,
  categoryCode = 'SV',
  initialBatches,
  availableBatches: propAvailableBatches = [],
  lineQuantity = 1,
  lineRate = 0,
}) => {
  const normCategory = (String(categoryCode || 'SV').toUpperCase()) as OpticalCategoryCode;
  const isBifocalOrProg = normCategory === 'KT' || normCategory === 'PROG';

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  // Cache of known batches for this unique item to allow instant client search
  const batchesCacheRef = useRef<any[]>([]);

  // Allocated batches: map of batchId -> AllocationRecord, and array of IDs for order
  const [allocationsMap, setAllocationsMap] = useState<Record<string, AllocationRecord>>({});
  const [allocatedIds, setAllocatedIds] = useState<string[]>([]);

  // Global / form errors
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);

  // Purchase mode: New batch creation drawer
  const [showCreateBatch, setShowCreateBatch] = useState(false);
  const [newSph, setNewSph] = useState('0.00');
  const [newCyl, setNewCyl] = useState('0.00');
  const [newAxis, setNewAxis] = useState('');
  const [newAdd, setNewAdd] = useState('');
  const [newSide, setNewSide] = useState<'NONE' | 'R' | 'L' | 'BE'>('NONE');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
    setDuplicateNotice(null);
    setShowCreateBatch(false);

    // Populate initial allocations (only allocated batches are shown)
    const initialMap: Record<string, AllocationRecord> = {};
    const initialIds: string[] = [];

    (initialBatches || []).forEach(b => {
      const batchObj = (b as any).batch || b;
      const rawId = b.batchId || (b as any).id || (b as any).batch?.id;
      const sphVal = batchObj.sph !== undefined && batchObj.sph !== null && batchObj.sph !== '' ? batchObj.sph : (b.sph ?? '0.00');
      const cylVal = batchObj.cyl !== undefined && batchObj.cyl !== null && batchObj.cyl !== '' ? batchObj.cyl : (b.cyl ?? '0.00');
      const axisVal = batchObj.axis !== undefined && batchObj.axis !== null ? batchObj.axis : (b.axis ?? '');
      const addVal = batchObj.add !== undefined && batchObj.add !== null ? batchObj.add : (b.add ?? '');
      const sideVal = batchObj.side || b.side || 'NONE';
      const barcodeVal = batchObj.barcode || b.barcode;
      const stockVal = Number(batchObj.availableStock ?? b.availableStock ?? 0);

      const id = rawId || `${sphVal}_${cylVal}_${axisVal || 0}_${addVal || 0}_${sideVal}`;
      const qtyNum = Number(b.quantity);
      if (qtyNum > 0) {
        initialMap[id] = {
          batch: {
            id,
            sph: sphVal,
            cyl: cylVal,
            axis: axisVal,
            add: addVal,
            side: sideVal,
            barcode: barcodeVal,
            availableStock: stockVal,
            rate: b.rate !== undefined ? Number(b.rate) : undefined,
            formattedName: formatOpticalBatchName({
              sph: sphVal,
              cyl: cylVal,
              axis: axisVal,
              add: addVal,
              side: sideVal,
              categoryCode: normCategory,
            }),
          },
          quantityStr: String(qtyNum),
          error: null,
        };
        initialIds.push(id);
      }
    });

    setAllocationsMap(initialMap);
    setAllocatedIds(initialIds);

    // Initialize batch cache from props if provided
    if (propAvailableBatches && propAvailableBatches.length > 0) {
      batchesCacheRef.current = propAvailableBatches;
    } else {
      batchesCacheRef.current = [];
    }

    // Auto-focus search input
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 60);
  }, [isOpen, initialBatches, normCategory, propAvailableBatches]);

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

    // Call server search with debounce to guarantee up-to-date stock and cover thousands of records
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

  // Select a batch from search and add to allocations
  const handleSelectBatch = useCallback(
    (batch: any) => {
      const batchId = batch.id;
      setSearchQuery('');
      setShowDropdown(false);
      setErrorMessage(null);

      // Check if already allocated
      if (allocationsMap[batchId]) {
        // Do NOT duplicate; focus existing quantity input
        setDuplicateNotice(
          `Batch "${
            batch.formattedName ||
            formatOpticalBatchName({
              sph: batch.sph,
              cyl: batch.cyl,
              axis: batch.axis,
              add: batch.add,
              side: batch.side,
              categoryCode: normCategory,
            })
          }" is already added. Edit quantity below.`
        );
        setTimeout(() => setDuplicateNotice(null), 3000);

        setTimeout(() => {
          const inputEl = qtyInputRefs.current[batchId];
          if (inputEl) {
            inputEl.focus();
            inputEl.select();
          }
        }, 50);
        return;
      }

      // Add to allocated batches with default initial quantity
      const defaultQty = lineQuantity > 0 && allocatedIds.length === 0 ? lineQuantity : 1;
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

      setAllocationsMap(prev => ({
        ...prev,
        [batchId]: {
          batch: fullBatch,
          quantityStr: String(defaultQty),
          error: null,
        },
      }));
      setAllocatedIds(prev => [...prev, batchId]);

      // Automatically focus its Quantity field so salesperson can type manually
      setTimeout(() => {
        const inputEl = qtyInputRefs.current[batchId];
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 50);
    },
    [allocationsMap, allocatedIds.length, lineQuantity, normCategory]
  );

  // Manual quantity change handler (plain text / numbers, no spinners)
  const handleQuantityTextChange = (batchId: string, val: string) => {
    setAllocationsMap(prev => {
      const record = prev[batchId];
      if (!record) return prev;

      let errorMsg: string | null = null;
      if (val.trim() !== '') {
        const num = parseFloat(val);
        if (isNaN(num) || num <= 0) {
          errorMsg = 'Quantity must be > 0';
        } else if (!isValidHalfStepQty(num)) {
          errorMsg = 'Must be multiple of 0.5 (e.g. 0.5, 1, 1.5, 2)';
        }
      }

      return {
        ...prev,
        [batchId]: {
          ...record,
          quantityStr: val,
          error: errorMsg,
        },
      };
    });
    setErrorMessage(null);
  };

  // When Enter is pressed in Quantity input -> Accept quantity and return focus to Search
  const handleQuantityKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    batchId: string
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const record = allocationsMap[batchId];
      const num = parseFloat(record?.quantityStr || '0');

      if (isNaN(num) || num <= 0 || !isValidHalfStepQty(num)) {
        setAllocationsMap(prev => ({
          ...prev,
          [batchId]: {
            ...prev[batchId],
            error: 'Must be a positive multiple of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0)',
          },
        }));
        return;
      }

      // Quantity accepted; focus returns to Search box for next batch
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
      const curIndex = allocatedIds.indexOf(batchId);
      const targetIndex =
        e.key === 'ArrowDown' ? curIndex + 1 : curIndex - 1;

      if (targetIndex >= 0 && targetIndex < allocatedIds.length) {
        const nextId = allocatedIds[targetIndex];
        const nextEl = qtyInputRefs.current[nextId];
        nextEl?.focus();
        nextEl?.select();
      } else if (e.key === 'ArrowUp' && curIndex === 0) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
  };

  // Remove a batch from current voucher allocation
  const handleRemoveAllocation = (batchId: string) => {
    setAllocationsMap(prev => {
      const next = { ...prev };
      delete next[batchId];
      return next;
    });
    setAllocatedIds(prev => prev.filter(id => id !== batchId));
    setErrorMessage(null);

    // Return focus to search input
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleClearAll = () => {
    setAllocationsMap({});
    setAllocatedIds([]);
    setErrorMessage(null);
    searchInputRef.current?.focus();
  };

  // Total quantity calculation
  const totalAllocatedQty = useMemo(() => {
    return allocatedIds.reduce((sum, id) => {
      const rec = allocationsMap[id];
      const num = parseFloat(rec?.quantityStr || '0');
      return sum + (!isNaN(num) && num > 0 ? num : 0);
    }, 0);
  }, [allocatedIds, allocationsMap]);

  // Validate & Finish allocations
  const handleApply = () => {
    if (allocatedIds.length === 0) {
      setErrorMessage('Please search and add at least one batch allocation.');
      searchInputRef.current?.focus();
      return;
    }

    const invalidEntries: string[] = [];
    const validAllocations: BatchAllocation[] = [];

    for (const id of allocatedIds) {
      const record = allocationsMap[id];
      const num = parseFloat(record?.quantityStr || '0');
      const batchName =
        record.batch.formattedName ||
        formatOpticalBatchName({
          sph: record.batch.sph,
          cyl: record.batch.cyl,
          axis: record.batch.axis,
          add: record.batch.add,
          side: record.batch.side,
          categoryCode: normCategory,
        });

      if (isNaN(num) || num <= 0 || !isValidHalfStepQty(num)) {
        invalidEntries.push(`${batchName} (value: "${record?.quantityStr || ''}")`);
      } else {
        validAllocations.push({
          batchId: record.batch.id,
          sph: record.batch.sph ?? '0.00',
          cyl: record.batch.cyl ?? '0.00',
          axis: record.batch.axis ?? '',
          add: record.batch.add ?? '',
          side: record.batch.side ?? 'NONE',
          quantity: num,
          rate: record.batch.rate !== undefined && !isNaN(Number(record.batch.rate)) ? Number(record.batch.rate) : lineRate,
          barcode: record.batch.barcode,
          availableStock: parseFloat(record.batch.availableStock || 0),
        });
      }
    }

    if (invalidEntries.length > 0) {
      setErrorMessage(
        `Invalid quantity for: ${invalidEntries.join(
          ', '
        )}. All quantities must be positive multiples of 0.5 (e.g. 0.5, 1.0, 1.5, 2.0).`
      );
      // Focus the first invalid field
      const firstInvalidId = allocatedIds.find(id => {
        const n = parseFloat(allocationsMap[id]?.quantityStr || '0');
        return isNaN(n) || n <= 0 || !isValidHalfStepQty(n);
      });
      if (firstInvalidId) {
        const el = qtyInputRefs.current[firstInvalidId];
        el?.focus();
        el?.select();
      }
      return;
    }

    const calculatedTotalQty = validAllocations.reduce((s, a) => s + a.quantity, 0);
    onApply(validAllocations, calculatedTotalQty);
    onClose();
  };

  // Purchase mode: create new batch
  const handleCreateNewBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uniqueItemId) {
      setCreateError('No Stock Item ID available to link new batch');
      return;
    }

    setCreatingBatch(true);
    setCreateError(null);
    try {
      const res = await apiRequest<any>('/api/optical-master/batches/find-or-create', {
        method: 'POST',
        body: JSON.stringify({
          uniqueItemId,
          sph: parseFloat(newSph) || 0,
          cyl: parseFloat(newCyl) || 0,
          axis: newAxis ? parseInt(newAxis, 10) : 0,
          add: newAdd ? parseFloat(newAdd) : 0,
          side: newSide,
        }),
      });

      const created = res.batch;
      if (!created) {
        throw new Error('Batch creation response was invalid');
      }

      // Add to batch cache
      batchesCacheRef.current.unshift(created);

      // Select and add this newly created batch
      handleSelectBatch(created);
      setShowCreateBatch(false);
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
                <h3 className="text-sm font-bold text-white tracking-wide">
                  {allocatedIds.length > 0 ? 'Edit Batch Allocations' : 'Batch Allocations'}
                </h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-700/60 text-blue-200 border border-blue-500/30 uppercase">
                  {mode.toUpperCase()} • Category: {normCategory}
                </span>
                {itemCode && (
                  <span className="text-xs text-slate-400 font-mono">[{itemCode}]</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs font-semibold text-slate-200 truncate max-w-xs">
                  {itemName}
                </p>
                {allocatedIds.length > 0 && (
                  <span className="text-[11px] font-mono font-semibold text-emerald-300 bg-emerald-950/80 px-2 py-0.2 rounded border border-emerald-500/40 shrink-0">
                    {allocatedIds.length} batch{allocatedIds.length > 1 ? 'es' : ''} currently allocated • Total Qty: {totalAllocatedQty.toFixed(2)} PRS
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notices and Alerts */}
        {duplicateNotice && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 text-xs text-blue-800 flex items-center gap-2 shrink-0 animate-in fade-in">
            <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>{duplicateNotice}</span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-800 shrink-0">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-amber-600 hover:text-amber-800 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Search / Entry Section (Primary Batch Entry) */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0 relative">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700">
              Add Batch / Power:
            </label>
            {mode === 'purchase' && (
              <button
                type="button"
                onClick={() => setShowCreateBatch(prev => !prev)}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>{showCreateBatch ? 'Hide Power Creator' : '+ Create Missing Batch'}</span>
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchQuery.trim().length > 0) {
                  setShowDropdown(true);
                }
              }}
              onKeyDown={e => {
                if (showDropdown && searchResults.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveSearchIndex(i =>
                      Math.min(i + 1, searchResults.length - 1)
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveSearchIndex(i => Math.max(i - 1, 0));
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
                } else if (e.key === 'Enter' && !searchQuery.trim()) {
                  // If user presses Enter on empty search and allocations exist, accept
                  if (allocatedIds.length > 0) {
                    e.preventDefault();
                    handleApply();
                  }
                } else if (e.key === 'ArrowDown' && allocatedIds.length > 0) {
                  // Down arrow moves into allocated table
                  e.preventDefault();
                  const firstInput = qtyInputRefs.current[allocatedIds[0]];
                  firstInput?.focus();
                  firstInput?.select();
                }
              }}
              placeholder="Type batch power (e.g., 25 1 for -2.50/-1.00, or barcode)..."
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
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5"
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
                    {mode === 'purchase' && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateBatch(true);
                          setShowDropdown(false);
                        }}
                        className="mt-2 px-3 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Create This Missing Batch</span>
                      </button>
                    )}
                  </div>
                ) : (
                  searchResults.map((b, idx) => {
                    const isActive = idx === activeSearchIndex;
                    const isAlreadyAllocated = Boolean(allocationsMap[b.id]);
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
                          // Prevent input blur before click registers
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
                          {isAlreadyAllocated && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-sans font-bold bg-blue-100 text-blue-800 border border-blue-200">
                              Added
                            </span>
                          )}
                        </div>

                        <div className="text-right">
                          <span
                            className={`font-semibold ${
                              availStock <= 0 ? 'text-amber-600' : 'text-emerald-700'
                            }`}
                          >
                            {availStock.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-1 font-sans">PRS</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Purchase Mode: Create New Batch Form Drawer */}
        {mode === 'purchase' && showCreateBatch && (
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
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">CYL</label>
                <input
                  type="number"
                  step="0.25"
                  value={newCyl}
                  onChange={e => setNewCyl(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">AXIS</label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={newAxis}
                  onChange={e => setNewAxis(e.target.value)}
                  placeholder="0-180"
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white"
                />
              </div>

              {isBifocalOrProg && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">+ADD</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={newAdd}
                    onChange={e => setNewAdd(e.target.value)}
                    placeholder="+1.00"
                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white"
                  />
                </div>
              )}

              {isBifocalOrProg && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">SIDE</label>
                  <select
                    value={newSide}
                    onChange={e => setNewSide(e.target.value as any)}
                    className="w-full px-1.5 py-1 text-xs border border-slate-300 rounded bg-white text-slate-800"
                  >
                    <option value="NONE">NONE</option>
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
                  className="w-full py-1 px-3 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded transition-colors shadow-2xs"
                >
                  {creatingBatch ? 'Adding...' : '+ Add Power'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Allocated Batches Table (Only allocated batches are displayed) */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-white flex flex-col">
          <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
            <span>Allocated Batches:</span>
            <span className="text-slate-500 font-normal">
              {allocatedIds.length} {allocatedIds.length === 1 ? 'batch' : 'batches'} selected
            </span>
          </div>

          {allocatedIds.length === 0 ? (
            <div className="py-12 px-4 text-center text-xs text-slate-400 font-sans my-auto">
              <Layers className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-slate-600">No batches allocated yet</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Type batch power in the search box above (e.g. <span className="font-mono font-bold text-slate-600">25 1</span>) and press Enter to add.
              </p>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 z-10 font-sans">
                <tr>
                  <th className="py-2 px-3">Batch / Power</th>
                  <th className="py-2 px-3 text-right">Available</th>
                  <th className="py-2 px-3 text-right w-36">Qty (PRS)</th>
                  <th className="py-2 px-2 text-center w-12">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {allocatedIds.map(batchId => {
                  const record = allocationsMap[batchId];
                  if (!record) return null;
                  const b = record.batch;
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
                  const hasError = Boolean(record.error);

                  return (
                    <tr
                      key={batchId}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      {/* Batch / Power */}
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">
                          {formattedName}
                        </div>
                        {b.barcode && (
                          <div className="text-[10px] text-slate-400 font-sans flex items-center gap-1 mt-0.5">
                            <Hash className="w-2.5 h-2.5" />
                            <span>{b.barcode}</span>
                          </div>
                        )}
                      </td>

                      {/* Available Stock */}
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`font-semibold ${
                            availStock <= 0 ? 'text-amber-600' : 'text-emerald-700'
                          }`}
                        >
                          {availStock.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1 font-sans">PRS</span>
                      </td>

                      {/* Manual Quantity Input (NO SPINNER ARROWS, NO +/- BUTTONS) */}
                      <td className="py-2 px-3 text-right">
                        <div className="flex flex-col items-end">
                          <input
                            ref={el => {
                              qtyInputRefs.current[batchId] = el;
                            }}
                            type="text"
                            inputMode="decimal"
                            value={record.quantityStr ?? ''}
                            onChange={e => handleQuantityTextChange(batchId, e.target.value)}
                            onKeyDown={e => handleQuantityKeyDown(e, batchId)}
                            placeholder="1.0"
                            className={`w-24 px-2 py-1 text-xs text-right border rounded font-mono font-bold focus:outline-none focus:ring-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                              hasError
                                ? 'bg-red-50 border-red-400 text-red-900 focus:ring-red-500'
                                : 'bg-white border-slate-300 text-slate-900 focus:ring-blue-600 focus:border-blue-600'
                            }`}
                          />
                          {hasError && (
                            <span className="text-[10px] text-red-600 font-sans mt-0.5">
                              {record.error}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Remove Action */}
                      <td className="py-2.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveAllocation(batchId)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                          title="Remove Allocation"
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
                {totalAllocatedQty.toFixed(2)} PRS
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
            {allocatedIds.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="px-2.5 py-1 text-xs text-slate-600 hover:text-red-700 hover:bg-slate-200 rounded transition-colors"
              >
                Clear All
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
            >
              Cancel (Esc)
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded shadow-2xs transition-colors flex items-center gap-1.5"
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
