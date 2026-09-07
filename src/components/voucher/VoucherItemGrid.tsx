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
import { formatOpticalBatchName } from '../../utils/searchNormalization';
import { VoucherLineItem, ComputedVoucherLine } from './VoucherTypes';

interface VoucherItemGridProps {
  voucherType: 'SALES' | 'PURCHASE';
  lines: VoucherLineItem[];
  computedLines: ComputedVoucherLine[];
  allItems: any[];
  onItemSelect: (rowIndex: number, uniqueItemId: string) => void;
  onBatchClick: (rowIndex: number) => void;
  onQuantityChange: (rowIndex: number, quantity: number) => void;
  onRateChange: (rowIndex: number, rate: number) => void;
  onDiscountChange: (rowIndex: number, discountValue: number) => void;
  onGstRateChange: (rowIndex: number, gstRate: number) => void;
  onRemoveLine: (rowIndex: number) => void;
  onAddBlankLine: () => void;
  focusRequest?: { row: number; col: string; key: number } | null;
}

export const VoucherItemGrid: React.FC<VoucherItemGridProps> = ({
  voucherType,
  lines,
  computedLines,
  allItems,
  onItemSelect,
  onBatchClick,
  onQuantityChange,
  onRateChange,
  onDiscountChange,
  onGstRateChange,
  onRemoveLine,
  onAddBlankLine,
  focusRequest,
}) => {
  const isSales = voucherType === 'SALES';

  // State to track expanded nested batch allocations per row
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

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

  // Refs map to handle programmatic keyboard cell-to-cell navigation
  const inputRefs = useRef<{ [key: string]: HTMLElement | null }>({});

  const setRef = (row: number, col: string, el: HTMLElement | null) => {
    inputRefs.current[`${row}-${col}`] = el;
  };

  const focusCell = (row: number, col: string) => {
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

  // Respond to programmatic focus requests from parent
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
      className="flex-1 flex flex-col min-h-0 bg-white border border-slate-300 rounded-md overflow-hidden shadow-2xs"
    >
      {/* Table header */}
      <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar">
        <table className="w-full border-collapse text-xs select-none">
          <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-300 sticky top-0 z-20 font-sans">
            <tr className="divide-x divide-slate-300">
              <th className="py-2 px-1 w-10 text-center text-slate-500 font-mono">#</th>
              <th className="py-2 px-3 text-left min-w-[240px]">
                Name of Item / Description
              </th>
              <th className="py-2 px-2 text-left w-[240px]">
                Batch / Optical Power Allocations
              </th>
              <th className="py-2 px-2 text-right w-24">Quantity</th>
              <th className="py-2 px-2 text-right w-28">Rate (₹)</th>
              <th className="py-2 px-2 text-right w-20">Disc %</th>
              <th className="py-2 px-2 text-right w-20">GST %</th>
              <th className="py-2 px-3 text-right w-32">Amount (₹)</th>
              <th className="py-2 px-1 w-10 text-center text-slate-400"></th>
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

              return (
                <React.Fragment key={line.id || idx}>
                  {/* Main Stock Item Row */}
                  <tr className="hover:bg-blue-50/20 divide-x divide-slate-200 transition-colors group">
                    {/* # Serial No & Expand Toggle */}
                    <td className="py-1 px-1 text-center text-slate-400 font-mono text-[11px]">
                      <div className="flex items-center justify-center gap-0.5">
                        {hasBatches && batchesCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleRowExpand(line.id)}
                            className="p-0.5 text-slate-500 hover:text-blue-700 hover:bg-slate-200 rounded transition-colors"
                            title={isExpanded ? 'Collapse Batches' : 'Expand Batches'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-blue-700" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </button>
                        ) : (
                          <span>{idx + 1}</span>
                        )}
                      </div>
                    </td>

                    {/* Name of Item (Searchable Inline Select) */}
                    <td className="py-0.5 px-1 font-sans">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 min-w-0">
                          <SearchableMasterSelect
                            ref={el => setRef(idx, 'item', el as any)}
                            value={line.uniqueItemId || ''}
                            displayValue={line.uniqueItemName || ''}
                            options={itemOptions}
                            placeholder="Type stock item name..."
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
                                  focusCell(idx, 'batch');
                                } else {
                                  focusCell(idx, 'qty');
                                }
                              } else {
                                onItemSelect(idx, '');
                              }
                            }}
                            className="w-full"
                            inputClassName="py-1 px-2 text-xs font-semibold text-slate-900 border-0 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 rounded-xs"
                            dropdownClassName="min-w-[340px]"
                          />
                        </div>
                      </div>
                    </td>

                    {/* Batch / Optical Power Allocations Column */}
                    <td className="py-0.5 px-1.5 font-sans">
                      {hasBatches && line.uniqueItemId ? (
                        <div className="flex items-center justify-between gap-1">
                          <button
                            ref={el => setRef(idx, 'batch', el)}
                            type="button"
                            onClick={() => onBatchClick(idx)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                onBatchClick(idx);
                              }
                            }}
                            className="flex-1 text-left py-1 px-2 rounded-xs border border-transparent hover:border-blue-300 hover:bg-blue-50/50 focus:border-blue-600 focus:bg-blue-50/50 focus:outline-none focus:ring-1 focus:ring-blue-600 flex items-center justify-between gap-1.5 transition-all"
                            title="Click or press Enter to edit batch power allocations"
                          >
                            <div className="flex-1 min-w-0 truncate">
                              {batchesCount === 0 ? (
                                <span className="text-xs text-amber-700 font-semibold italic flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                  <span>Allocate Batches (0)</span>
                                </span>
                              ) : batchesCount === 1 ? (
                                <span className="text-xs font-mono font-bold text-slate-800">
                                  {formatOpticalBatchName(line.batches[0])}
                                  <span className="text-[10px] text-blue-700 font-sans ml-1 font-semibold">
                                    (1 batch)
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-bold text-blue-800 bg-blue-50 rounded border border-blue-200">
                                  <span>{batchesCount} batches allocated</span>
                                  <Edit2 className="w-3 h-3 text-blue-500" />
                                </span>
                              )}
                            </div>

                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200 shrink-0 uppercase">
                              {line.categoryCode || 'SV'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="py-1 px-2 text-slate-300 font-mono text-center select-none">
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
                          onClick={() => onBatchClick(idx)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              onBatchClick(idx);
                            }
                          }}
                          className="w-full text-right py-1 px-2 text-xs font-mono font-bold text-blue-900 bg-blue-50/40 hover:bg-blue-100/60 focus:bg-blue-100/80 focus:ring-2 focus:ring-blue-600 rounded-xs cursor-pointer select-none flex items-center justify-end gap-1"
                          title="Quantity is calculated from batch allocations. Click or press Enter to edit allocations."
                        >
                          <span>{Number(line.quantity || 0).toFixed(2)}</span>
                          <span className="text-[9px] text-blue-600 font-sans font-normal">
                            PRS
                          </span>
                        </div>
                      ) : (
                        <input
                          ref={el => setRef(idx, 'qty', el)}
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={line.quantity !== undefined && line.quantity !== null ? line.quantity : ''}
                          onChange={e =>
                            onQuantityChange(idx, parseFloat(e.target.value) || 0)
                          }
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              focusCell(idx, 'rate');
                            }
                          }}
                          className="w-full text-right py-1 px-2 text-xs font-mono font-bold text-slate-900 border-0 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 rounded-xs"
                        />
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
                        onChange={e => {
                          const val = parseFloat(e.target.value);
                          onRateChange(idx, isNaN(val) ? 0 : Math.max(0, val));
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusCell(idx, 'disc');
                          }
                        }}
                        placeholder="0.00"
                        className="w-full text-right py-1 px-2 text-xs font-mono text-slate-900 font-semibold border-0 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 rounded-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                        onChange={e =>
                          onDiscountChange(idx, parseFloat(e.target.value) || 0)
                        }
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusCell(idx, 'gst');
                          }
                        }}
                        className="w-full text-right py-1 px-2 text-xs font-mono text-slate-700 border-0 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 rounded-xs"
                      />
                    </td>

                    {/* GST % */}
                    <td className="py-0.5 px-1 text-right">
                      <select
                        ref={el => setRef(idx, 'gst', el)}
                        value={line.gstRate !== undefined && line.gstRate !== null ? line.gstRate : 5}
                        onChange={e =>
                          onGstRateChange(idx, parseFloat(e.target.value) || 0)
                        }
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
                          }
                        }}
                        className="w-full text-right py-1 px-1 text-xs font-mono text-slate-700 border-0 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 rounded-xs"
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
                    <td className="py-1 px-3 text-right font-mono font-bold text-slate-900">
                      ₹
                      {comp.total.toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>

                    {/* Delete button */}
                    <td className="py-1 px-1 text-center">
                      <button
                        type="button"
                        onClick={() => onRemoveLine(idx)}
                        className="p-1 text-slate-300 hover:text-red-600 rounded transition-colors"
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
                          className="bg-slate-50/75 border-b border-slate-100 text-[11px] divide-x divide-slate-200/60"
                        >
                          {/* Blank for serial */}
                          <td className="py-1 px-1 text-center text-slate-400 font-mono text-[10px]">
                            ↳
                          </td>

                          {/* Nested Batch Details */}
                          <td className="py-1 pl-6 pr-2 text-slate-700 font-sans">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900">
                                {formattedName}
                              </span>
                              {b.barcode && (
                                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-0.5">
                                  <Hash className="w-2.5 h-2.5" />
                                  <span>{b.barcode}</span>
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Allocation description */}
                          <td className="py-1 px-2 text-slate-500 font-sans text-[11px] italic">
                            Allocated Batch #{bIdx + 1}
                          </td>

                          {/* Batch Allocation Qty */}
                          <td className="py-1 px-2 text-right font-mono font-bold text-blue-700">
                            {batchQty.toFixed(2)} PRS
                          </td>

                          {/* Batch Rate */}
                          <td className="py-1 px-2 text-right font-mono text-slate-500 text-[11px]">
                            ₹{batchRate.toFixed(2)}
                          </td>

                          {/* Disc */}
                          <td className="py-1 px-2 text-right font-mono text-slate-400 text-[10px]">
                            {line.discountValue ? `${line.discountValue}%` : '—'}
                          </td>

                          {/* GST */}
                          <td className="py-1 px-2 text-right font-mono text-slate-400 text-[10px]">
                            {line.gstRate}%
                          </td>

                          {/* Sub-allocated Amount */}
                          <td className="py-1 px-3 text-right font-mono font-medium text-slate-700">
                            ₹
                            {batchAmt.toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>

                          {/* Quick Edit */}
                          <td className="py-1 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => onBatchClick(idx)}
                              className="text-slate-400 hover:text-blue-600 p-0.5"
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
                <td colSpan={9} className="py-12 text-center text-slate-400 font-sans">
                  <div className="max-w-xs mx-auto space-y-2">
                    <Layers className="w-8 h-8 mx-auto text-slate-300" />
                    <p className="text-xs font-semibold text-slate-600">
                      No items added to voucher yet
                    </p>
                    <button
                      type="button"
                      onClick={onAddBlankLine}
                      className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
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
      <div className="bg-slate-50 border-t border-slate-200 px-3 py-1.5 flex items-center justify-between text-xs shrink-0 font-sans">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onAddBlankLine}
            className="flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:text-blue-900 hover:bg-blue-100/50 px-2 py-1 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Row (or press Enter on last cell)</span>
          </button>

          {hasAnyBatchLines && (
            <button
              type="button"
              onClick={allBatchLinesExpanded ? handleCollapseAll : handleExpandAll}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 px-2 py-0.5 rounded border border-slate-300 transition-colors"
            >
              {allBatchLinesExpanded ? 'Collapse All Batches' : 'Expand All Batches'}
            </button>
          )}
        </div>

        <div className="text-[11px] text-slate-500 font-sans flex items-center gap-3">
          <span>
            Total Lines: <strong className="text-slate-800 font-mono">{lines.length}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
