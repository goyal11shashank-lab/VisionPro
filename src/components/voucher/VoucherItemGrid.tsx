import React, { useState, useRef, useEffect } from 'react';
import {
  Trash2,
  Layers,
  Plus,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Edit2,
  Hash,
} from 'lucide-react';
import { SearchableMasterSelect, SearchableOption } from '../common/SearchableMasterSelect';
import { InlineStockItemModal } from '../common/InlineStockItemModal';
import { formatOpticalBatchName } from '../../utils/searchNormalization';
import { VoucherLineItem, ComputedVoucherLine } from './VoucherTypes';

interface VoucherItemGridProps {
  voucherType: 'SALES' | 'PURCHASE';
  lines: VoucherLineItem[];
  computedLines: ComputedVoucherLine[];
  allItems: any[];
  onItemSelect: (rowIndex: number, uniqueItemId: string) => void;
  onItemCreated?: (newItem: any) => void;
  onItemFocus?: (rowIndex: number) => void;
  allowStockItemCreate?: boolean;
  onBatchClick: (rowIndex: number) => void;
  onQuantityChange: (rowIndex: number, quantity: number) => void;
  onRateChange: (rowIndex: number, rate: number) => void;
  onDiscountChange: (rowIndex: number, discountValue: number) => void;
  onGstRateChange: (rowIndex: number, gstRate: number) => void;
  onRemoveLine: (rowIndex: number) => void;
  onAddBlankLine: () => void;
  focusRequest?: { row: number; col: string; key: number } | null;
  activeRowIndex?: number | null;
  onActiveRowChange?: (rowIndex: number) => void;
}

export const VoucherItemGrid: React.FC<VoucherItemGridProps> = ({
  voucherType,
  lines,
  computedLines,
  allItems,
  onItemSelect,
  onItemCreated,
  onItemFocus,
  allowStockItemCreate = true,
  onBatchClick,
  onQuantityChange,
  onRateChange,
  onDiscountChange,
  onGstRateChange,
  onRemoveLine,
  onAddBlankLine,
  focusRequest,
  activeRowIndex,
  onActiveRowChange,
}) => {
  const isSales = voucherType === 'SALES';

  // Inline Stock Item creation state
  const [isInlineItemOpen, setIsInlineItemOpen] = useState(false);
  const [activeCreateRowIndex, setActiveCreateRowIndex] = useState<number | null>(null);
  const [typedItemName, setTypedItemName] = useState('');

  // Internal active row tracker
  const [currentRowIdx, setCurrentRowIdx] = useState<number>(0);
  const effectiveActiveRow = activeRowIndex !== undefined && activeRowIndex !== null ? activeRowIndex : currentRowIdx;

  const setActiveRow = (idx: number) => {
    setCurrentRowIdx(idx);
    if (onActiveRowChange) onActiveRowChange(idx);
  };

  // State to track expanded nested batch allocations per row
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const handleStockItemCreated = (newItem: any) => {
    if (onItemCreated) {
      onItemCreated(newItem);
    }
    if (activeCreateRowIndex !== null) {
      const rowIdx = activeCreateRowIndex;
      onItemSelect(rowIdx, newItem.id);
      if (newItem.maintainBatches !== false) {
        setTimeout(() => {
          onBatchClick(rowIdx);
        }, 80);
      } else {
        setTimeout(() => {
          focusCell(rowIdx, 'qty');
        }, 80);
      }
    }
  };

  const toggleRowExpand = (lineId: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [lineId]: !prev[lineId],
    }));
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    lines.forEach(l => {
      if (l.maintainBatches !== false && l.batches && l.batches.length > 0) {
        next[l.id] = true;
      }
    });
    setExpandedRows(next);
  };

  const handleCollapseAll = () => {
    setExpandedRows({});
  };

  const hasAnyBatchLines = lines.some(
    l => l.maintainBatches !== false && l.batches && l.batches.length > 0
  );
  const allBatchLinesExpanded =
    hasAnyBatchLines &&
    lines
      .filter(l => l.maintainBatches !== false && l.batches && l.batches.length > 0)
      .every(l => expandedRows[l.id]);

  // Programmatic keyboard navigation
  const inputRefs = useRef<{ [key: string]: HTMLElement | null }>({});

  const setRef = (row: number, col: string, el: HTMLElement | null) => {
    inputRefs.current[`${row}-${col}`] = el;
  };

  const focusCell = (row: number, col: string) => {
    setActiveRow(row);
    setTimeout(() => {
      const el = inputRefs.current[`${row}-${col}`];
      if (el) {
        if ('focus' in el) (el as HTMLElement).focus();
        if ('select' in el && typeof (el as any).select === 'function') {
          (el as any).select();
        }
      }
    }, 40);
  };

  useEffect(() => {
    if (focusRequest) {
      focusCell(focusRequest.row, focusRequest.col);
    }
  }, [focusRequest]);

  // Convert Master items to Searchable options
  const itemOptions: SearchableOption[] = allItems.map(item => {
    const catCode = item.categoryCode || item.category?.code || 'SV';
    const rateText = isSales
      ? `MRP: ₹${item.mrp || item.standardSellingPrice || '0.00'}`
      : `Cost: ₹${item.lastPurchasePrice || item.purchaseRate || '0.00'}`;
    const itemGst = item.gstRate !== undefined ? item.gstRate : (item.taxRate !== undefined ? item.taxRate : 5);

    return {
      id: item.id,
      label: item.name,
      subLabel: `${item.code || ''} • ${rateText} • GST: ${itemGst}%`.trim(),
      tag: catCode,
      badgeColor:
        catCode === 'SV'
          ? 'blue'
          : catCode === 'KT'
          ? 'amber'
          : catCode === 'PROG'
          ? 'purple'
          : 'slate',
      meta: {
        ...item,
        categoryCode: catCode,
      },
    };
  });

  return (
    <div
      id="tally-item-grid-container"
      className="flex-1 flex flex-col min-h-0 bg-white border border-slate-300 rounded-xs overflow-hidden shadow-2xs select-none"
    >
      {/* Table header & scrollable rows */}
      <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar">
        <table className="w-full border-collapse text-xs select-none">
          <thead className="bg-[#1e3a5f] text-white font-extrabold border-b border-slate-400 sticky top-0 z-20 font-sans tracking-wide uppercase text-[11px] shadow-xs">
            <tr className="divide-x divide-blue-900/60">
              <th className="py-1.5 px-1 w-9 text-center text-cyan-200 font-black font-mono">#</th>
              <th className="py-1.5 px-2.5 text-left min-w-[240px] text-white font-extrabold">
                Name of Item / Description
              </th>
              <th className="py-1.5 px-2 text-left w-[220px] text-white font-extrabold">
                Batch / Optical Power Allocations
              </th>
              <th className="py-1.5 px-2 text-right w-24 text-white font-extrabold">Quantity</th>
              <th className="py-1.5 px-2 text-right w-28 text-white font-extrabold">Rate (₹)</th>
              <th className="py-1.5 px-2 text-right w-20 text-white font-extrabold">Disc %</th>
              <th className="py-1.5 px-2 text-right w-20 text-white font-extrabold">GST %</th>
              <th className="py-1.5 px-2.5 text-right w-32 text-white font-extrabold">Amount (₹)</th>
              <th className="py-1.5 px-1 w-8 text-center text-slate-300"></th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 font-mono bg-white">
            {lines.map((line, idx) => {
              const comp = computedLines[idx] || {
                gross: 0,
                disc: 0,
                taxable: 0,
                tax: 0,
                total: 0,
              };

              const hasBatches = line.maintainBatches !== false;
              const batchesCount = line.batches?.length || 0;
              const isExpanded = !!expandedRows[line.id];
              const isActiveRow = effectiveActiveRow === idx;

              return (
                <React.Fragment key={line.id || idx}>
                  {/* Main Stock Item Row */}
                  <tr
                    className={`divide-x divide-slate-200 transition-colors group ${
                      isActiveRow
                        ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-500/40'
                        : 'hover:bg-slate-50/80 bg-white'
                    }`}
                    onClick={() => setActiveRow(idx)}
                  >
                    {/* # Serial No & Expand Toggle */}
                    <td className="py-0.5 px-1 text-center text-slate-500 font-mono text-[11px] bg-slate-50/50">
                      <div className="flex items-center justify-center gap-0.5">
                        {hasBatches && batchesCount > 0 ? (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              toggleRowExpand(line.id);
                            }}
                            className="p-0.5 text-slate-500 hover:text-blue-800 hover:bg-blue-100 rounded transition-colors cursor-pointer"
                            title={isExpanded ? 'Collapse Batches' : 'Expand Batches'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-blue-800" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                            )}
                          </button>
                        ) : (
                          <span className="font-semibold text-slate-600">{idx + 1}</span>
                        )}
                      </div>
                    </td>

                    {/* Name of Item (Searchable Select with Contextual Panel integration) */}
                    <td className="py-0.5 px-1 font-sans">
                      <div
                        className="flex-1 min-w-0"
                        onFocusCapture={() => {
                          setActiveRow(idx);
                          onItemFocus?.(idx);
                        }}
                      >
                        <SearchableMasterSelect
                          id={`voucher-item-grid-select-${idx}`}
                          ref={el => setRef(idx, 'item', el as any)}
                          value={line.uniqueItemId || ''}
                          displayValue={line.uniqueItemName || ''}
                          options={itemOptions}
                          placeholder="Type stock item name..."
                          allowCreate={allowStockItemCreate}
                          createLabel={q => (q ? `+ Create Stock Item "${q}"` : '+ Create Stock Item')}
                          onCreate={query => {
                            setActiveCreateRowIndex(idx);
                            setTypedItemName(query);
                            setIsInlineItemOpen(true);
                          }}
                          onNextFocus={() => {
                            if (hasBatches && line.uniqueItemId) {
                              onBatchClick(idx);
                            } else {
                              focusCell(idx, 'qty');
                            }
                          }}
                          onSelect={opt => {
                            if (opt) {
                              onItemSelect(idx, opt.id);
                              const item = allItems.find(i => i.id === opt.id);
                              if (item && item.maintainBatches !== false) {
                                setTimeout(() => onBatchClick(idx), 60);
                              } else {
                                focusCell(idx, 'qty');
                              }
                            } else {
                              onItemSelect(idx, '');
                            }
                          }}
                          className="w-full"
                          inputClassName="py-0.5 px-1.5 text-xs font-bold text-slate-950 border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 rounded-xs bg-transparent"
                          dropdownClassName="min-w-[340px]"
                        />
                      </div>
                    </td>

                    {/* Batch / Optical Power Allocations Column */}
                    <td className="py-0.5 px-1 font-sans">
                      {hasBatches && line.uniqueItemId ? (
                        <div className="flex items-center justify-between gap-1">
                          <button
                            ref={el => setRef(idx, 'batch', el)}
                            type="button"
                            onClick={() => {
                              setActiveRow(idx);
                              onBatchClick(idx);
                            }}
                            onFocus={() => setActiveRow(idx)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                onBatchClick(idx);
                              }
                            }}
                            className="flex-1 text-left py-0.5 px-1.5 rounded-xs border border-transparent hover:border-blue-300 hover:bg-blue-50/70 focus:border-blue-600 focus:bg-blue-50/70 focus:outline-none focus:ring-1 focus:ring-blue-600 flex items-center justify-between gap-1.5 transition-all cursor-pointer"
                            title="Click or press Enter to edit batch power allocations"
                          >
                            <div className="flex-1 min-w-0 truncate">
                              {batchesCount === 0 ? (
                                <span className="text-[11px] text-amber-800 font-bold italic flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 shrink-0" />
                                  <span>Allocate Batches (0)</span>
                                </span>
                              ) : batchesCount === 1 ? (
                                <span className="text-[11px] font-mono font-black text-slate-900">
                                  {formatOpticalBatchName(line.batches[0])}
                                  <span className="text-[10px] text-blue-700 font-sans ml-1 font-bold">
                                    (1 batch)
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[11px] font-bold text-blue-900 bg-blue-100/80 rounded border border-blue-300">
                                  <span>{batchesCount} batches allocated</span>
                                  <Edit2 className="w-3 h-3 text-blue-600" />
                                </span>
                              )}
                            </div>

                            <span className="px-1 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300 shrink-0 uppercase">
                              {line.categoryCode || 'SV'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="py-0.5 px-1.5 text-slate-300 font-mono text-center select-none text-[11px]">
                          —
                        </div>
                      )}
                    </td>

                    {/* Quantity (Calculated from batch allocations when maintainBatches=true) */}
                    <td className="py-0.5 px-1 text-right">
                      {hasBatches ? (
                        <div
                          ref={el => setRef(idx, 'qty', el)}
                          tabIndex={0}
                          onClick={() => {
                            setActiveRow(idx);
                            onBatchClick(idx);
                          }}
                          onFocus={() => setActiveRow(idx)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              onBatchClick(idx);
                            } else if (e.key === 'ArrowUp' && idx > 0) {
                              e.preventDefault();
                              focusCell(idx - 1, 'qty');
                            } else if (e.key === 'ArrowDown' && idx < lines.length - 1) {
                              e.preventDefault();
                              focusCell(idx + 1, 'qty');
                            }
                          }}
                          className={`w-full text-right py-0.5 px-1.5 text-xs font-mono font-black ${
                            Number(line.quantity || 0) < 0
                              ? 'text-rose-700 bg-rose-50/70'
                              : 'text-blue-950 bg-blue-50/50'
                          } hover:bg-blue-100/70 focus:bg-blue-100 focus:ring-1 focus:ring-blue-600 rounded-xs cursor-pointer select-none flex items-center justify-end gap-1`}
                          title="Quantity is calculated from batch allocations. Press Enter to edit allocations."
                        >
                          <span className={Number(line.quantity || 0) < 0 ? 'text-rose-700 font-black' : ''}>
                            {Number(line.quantity || 0).toFixed(2)}
                          </span>
                          <span className={`text-[10px] font-sans font-bold uppercase ${Number(line.quantity || 0) < 0 ? 'text-rose-600' : 'text-blue-700'}`}>
                            {line.unit || 'PRS'}
                          </span>
                        </div>
                      ) : (
                        <div className="relative flex items-center">
                          <input
                            ref={el => setRef(idx, 'qty', el)}
                            type="number"
                            min={(line.unit || 'PRS').toUpperCase() === 'PCS' ? '1' : '0.5'}
                            step={(line.unit || 'PRS').toUpperCase() === 'PCS' ? '1' : '0.5'}
                            value={line.quantity !== undefined && line.quantity !== null ? line.quantity : ''}
                            onFocus={() => setActiveRow(idx)}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              const isPcs = (line.unit || 'PRS').toUpperCase() === 'PCS';
                              onQuantityChange(idx, isPcs ? Math.round(val) : val);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                focusCell(idx, 'rate');
                              } else if (e.key === 'ArrowUp' && idx > 0) {
                                e.preventDefault();
                                focusCell(idx - 1, 'qty');
                              } else if (e.key === 'ArrowDown' && idx < lines.length - 1) {
                                e.preventDefault();
                                focusCell(idx + 1, 'qty');
                              }
                            }}
                            className="w-full text-right py-0.5 pr-7 pl-1.5 text-xs font-mono font-black text-slate-950 border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 rounded-xs bg-transparent"
                          />
                          <span className="absolute right-1 text-[9px] text-slate-500 font-sans font-bold pointer-events-none uppercase">
                            {line.unit || 'PRS'}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Rate (₹) */}
                    <td className="py-0.5 px-1 text-right">
                      <input
                        ref={el => setRef(idx, 'rate', el)}
                        type="number"
                        step="any"
                        min="0"
                        value={line.rate !== undefined && line.rate !== null ? line.rate : ''}
                        onFocus={() => setActiveRow(idx)}
                        onChange={e => {
                          const val = parseFloat(e.target.value);
                          onRateChange(idx, isNaN(val) ? 0 : Math.max(0, val));
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusCell(idx, 'disc');
                          } else if (e.key === 'ArrowUp' && idx > 0) {
                            e.preventDefault();
                            focusCell(idx - 1, 'rate');
                          } else if (e.key === 'ArrowDown' && idx < lines.length - 1) {
                            e.preventDefault();
                            focusCell(idx + 1, 'rate');
                          }
                        }}
                        placeholder="0.00"
                        className="w-full text-right py-0.5 px-1.5 text-xs font-mono text-slate-950 font-black border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 rounded-xs bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </td>

                    {/* Disc % */}
                    <td className="py-0.5 px-1 text-right">
                      <input
                        ref={el => setRef(idx, 'disc', el)}
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={line.discountValue !== undefined && line.discountValue !== null ? line.discountValue : ''}
                        placeholder="0"
                        onFocus={() => setActiveRow(idx)}
                        onChange={e => onDiscountChange(idx, parseFloat(e.target.value) || 0)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusCell(idx, 'gst');
                          } else if (e.key === 'ArrowUp' && idx > 0) {
                            e.preventDefault();
                            focusCell(idx - 1, 'disc');
                          } else if (e.key === 'ArrowDown' && idx < lines.length - 1) {
                            e.preventDefault();
                            focusCell(idx + 1, 'disc');
                          }
                        }}
                        className="w-full text-right py-0.5 px-1 text-xs font-mono text-slate-900 font-bold border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 rounded-xs bg-transparent"
                      />
                    </td>

                    {/* GST % */}
                    <td className="py-0.5 px-1 text-right">
                      <select
                        ref={el => setRef(idx, 'gst', el)}
                        value={line.gstRate !== undefined && line.gstRate !== null ? line.gstRate : 5}
                        onFocus={() => setActiveRow(idx)}
                        onChange={e => onGstRateChange(idx, parseFloat(e.target.value) || 0)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            // Auto advance to next line or add row
                            if (idx === lines.length - 1) {
                              onAddBlankLine();
                              setTimeout(() => {
                                focusCell(idx + 1, 'item');
                              }, 50);
                            } else {
                              focusCell(idx + 1, 'item');
                            }
                          } else if (e.key === 'ArrowUp' && idx > 0) {
                            e.preventDefault();
                            focusCell(idx - 1, 'gst');
                          } else if (e.key === 'ArrowDown' && idx < lines.length - 1) {
                            e.preventDefault();
                            focusCell(idx + 1, 'gst');
                          }
                        }}
                        className="w-full text-right py-0.5 px-1 text-xs font-mono text-slate-900 font-bold border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 rounded-xs bg-transparent cursor-pointer"
                      >
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="12">12%</option>
                        <option value="18">18%</option>
                        <option value="28">28%</option>
                        {![0, 5, 12, 18, 28].includes(Number(line.gstRate)) && line.gstRate !== undefined && (
                          <option value={line.gstRate}>{line.gstRate}%</option>
                        )}
                      </select>
                    </td>

                    {/* Amount (₹) */}
                    <td className="py-0.5 px-2 text-right font-mono font-black text-slate-950 bg-slate-50/50">
                      ₹
                      {comp.total.toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>

                    {/* Delete button */}
                    <td className="py-0.5 px-1 text-center bg-slate-50/30">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onRemoveLine(idx);
                        }}
                        className="p-1 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded transition-colors cursor-pointer"
                        title="Remove Row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded Nested Batch Rows */}
                  {isExpanded &&
                    hasBatches &&
                    line.batches &&
                    line.batches.map((b, bIdx) => {
                      const batchQty = Number(b.quantity) || 0;
                      const batchRate = Number(line.rate) || 0;
                      const batchAmt = batchQty * batchRate;
                      const formattedName = formatOpticalBatchName({
                        sph: b.sph,
                        cyl: b.cyl,
                        axis: b.axis,
                        add: b.add,
                        side: b.side,
                        categoryCode: line.categoryCode,
                      });

                      return (
                        <tr
                          key={`${line.id}-batch-${bIdx}`}
                          className="bg-slate-50 border-b border-slate-200/80 text-[11px] divide-x divide-slate-200/60"
                        >
                          <td className="py-0.5 px-1 text-center text-slate-400 font-mono text-[10px]">
                            ↳
                          </td>

                          <td className="py-0.5 pl-6 pr-2 text-slate-800 font-sans">
                            <span className="font-mono font-black text-slate-950">
                              {formattedName}
                            </span>
                          </td>

                          <td className="py-0.5 px-2 text-slate-500 font-sans text-[10px] italic">
                            Allocated Batch #{bIdx + 1}
                          </td>

                          <td
                            className={`py-0.5 px-2 text-right font-mono font-black ${
                              batchQty < 0 ? 'text-rose-700 bg-rose-50/50' : 'text-blue-900'
                            }`}
                          >
                            {batchQty.toFixed(2)} {line.unit || 'PRS'}
                          </td>

                          <td className="py-0.5 px-2 text-right font-mono text-slate-700 font-bold text-[11px]">
                            ₹{batchRate.toFixed(2)}
                          </td>

                          <td className="py-0.5 px-2 text-right font-mono text-slate-500 text-[10px]">
                            {line.discountValue ? `${line.discountValue}%` : '—'}
                          </td>

                          <td className="py-0.5 px-2 text-right font-mono text-slate-500 text-[10px]">
                            {line.gstRate}%
                          </td>

                          <td className="py-0.5 px-2 text-right font-mono font-bold text-slate-800">
                            ₹
                            {batchAmt.toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>

                          <td className="py-0.5 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveRow(idx);
                                onBatchClick(idx);
                              }}
                              className="text-slate-400 hover:text-blue-700 p-0.5 cursor-pointer"
                              title="Edit Allocations"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </React.Fragment>
              );
            })}

            {/* Empty state prompt */}
            {lines.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-slate-400 font-sans">
                  <div className="max-w-xs mx-auto space-y-2">
                    <Layers className="w-7 h-7 mx-auto text-slate-300" />
                    <p className="text-xs font-semibold text-slate-600">
                      No items added to voucher yet
                    </p>
                    <button
                      type="button"
                      onClick={onAddBlankLine}
                      className="px-3 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-300 transition-colors cursor-pointer"
                    >
                      + Add First Item Line
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Grid Bottom Action Strip */}
      <div className="bg-slate-100 border-t border-slate-300 px-2.5 py-1 flex items-center justify-between text-xs shrink-0 font-sans">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onAddBlankLine}
            className="flex items-center gap-1.5 text-xs font-black text-blue-800 hover:text-blue-950 hover:bg-blue-100/60 px-2 py-0.5 rounded transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Row (or press Enter on GST)</span>
          </button>

          {hasAnyBatchLines && (
            <button
              type="button"
              onClick={allBatchLinesExpanded ? handleCollapseAll : handleExpandAll}
              className="text-[11px] font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-200 px-2 py-0.5 rounded border border-slate-300 transition-colors cursor-pointer"
            >
              {allBatchLinesExpanded ? 'Collapse All Batches' : 'Expand All Batches'}
            </button>
          )}
        </div>

        <div className="text-[11px] text-slate-700 font-sans flex items-center gap-3">
          <span>
            Total Voucher Lines: <strong className="text-slate-950 font-black font-mono text-xs">{lines.length}</strong>
          </span>
        </div>
      </div>

      {/* Inline Stock Item Creation Modal */}
      {isInlineItemOpen && (
        <InlineStockItemModal
          isOpen={isInlineItemOpen}
          onClose={() => {
            setIsInlineItemOpen(false);
            if (activeCreateRowIndex !== null) {
              const r = activeCreateRowIndex;
              setTimeout(() => {
                focusCell(r, 'item');
              }, 50);
            }
          }}
          initialName={typedItemName}
          onSuccess={handleStockItemCreated}
        />
      )}
    </div>
  );
};
