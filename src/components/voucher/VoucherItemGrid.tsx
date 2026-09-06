import React, { useRef, useEffect } from 'react';
import { Trash2, Layers, Plus, Sparkles, AlertCircle } from 'lucide-react';
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
}) => {
  const isSales = voucherType === 'SALES';

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

  // Convert Master items to Searchable options
  const itemOptions: SearchableOption[] = allItems.map(item => {
    const catCode = item.categoryCode || item.category?.code || 'SV';
    const rateText = isSales
      ? `MRP: ₹${item.mrp || item.standardSellingPrice || '0.00'}`
      : `Cost: ₹${item.lastPurchasePrice || item.purchaseRate || '0.00'}`;
    const batchTag = item.maintainBatches !== false ? 'BATCH' : 'NO-BATCH';

    return {
      id: item.id,
      label: item.name,
      subLabel: `${item.code || ''} • ${rateText} • GST: ${item.taxRate || 12}%`.trim(),
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
          <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-300 sticky top-0 z-20">
            <tr className="divide-x divide-slate-300">
              <th className="py-2 px-1 w-10 text-center text-slate-500 font-mono">#</th>
              <th className="py-2 px-3 text-left font-sans min-w-[240px]">
                Name of Item / Description
              </th>
              <th className="py-2 px-2 text-left font-sans w-[220px]">
                Batch / Optical Power
              </th>
              <th className="py-2 px-2 text-right font-sans w-24">Quantity</th>
              <th className="py-2 px-2 text-right font-sans w-28">Rate (₹)</th>
              <th className="py-2 px-2 text-right font-sans w-20">Disc %</th>
              <th className="py-2 px-2 text-right font-sans w-20">GST %</th>
              <th className="py-2 px-3 text-right font-sans w-32">Amount (₹)</th>
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
              const batchSummary =
                line.batches && line.batches.length > 0
                  ? line.batches
                      .map(b =>
                        formatOpticalBatchName({
                          sph: b.sph,
                          cyl: b.cyl,
                          axis: b.axis,
                          add: b.add,
                          side: b.side,
                        })
                      )
                      .join('; ')
                  : '';

              return (
                <tr
                  key={line.id || idx}
                  className="hover:bg-blue-50/20 divide-x divide-slate-200 transition-colors group"
                >
                  {/* # Serial No */}
                  <td className="py-1 px-1 text-center text-slate-400 font-mono text-[11px]">
                    {idx + 1}
                  </td>

                  {/* Name of Item (Searchable Inline Select) */}
                  <td className="py-0.5 px-1 font-sans">
                    <SearchableMasterSelect
                      ref={el => setRef(idx, 'item', el as any)}
                      value={line.uniqueItemId}
                      displayValue={line.uniqueItemName}
                      options={itemOptions}
                      placeholder="Type stock item name..."
                      onSelect={opt => {
                        if (opt) {
                          onItemSelect(idx, opt.id);
                          // Auto advance: if maintainBatches -> Batch cell; else -> Quantity
                          const item = allItems.find(i => i.id === opt.id);
                          if (item && item.maintainBatches !== false) {
                            focusCell(idx, 'batch');
                          } else {
                            focusCell(idx, 'qty');
                          }
                        }
                      }}
                      className="w-full"
                      inputClassName="py-1 px-2 text-xs font-medium text-slate-900 border-0 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 rounded-xs"
                      dropdownClassName="min-w-[340px]"
                    />
                  </td>

                  {/* Batch / Optical Power (Dynamic Column) */}
                  <td className="py-0.5 px-1.5 font-sans">
                    {hasBatches ? (
                      <button
                        ref={el => setRef(idx, 'batch', el)}
                        type="button"
                        onClick={() => onBatchClick(idx)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onBatchClick(idx);
                          } else if (e.key === 'Tab') {
                            // Let Tab proceed naturally
                          }
                        }}
                        className="w-full text-left py-1 px-2 rounded-xs border border-transparent hover:border-blue-300 hover:bg-blue-50/50 focus:border-blue-600 focus:bg-blue-50/50 focus:outline-none focus:ring-1 focus:ring-blue-600 flex items-center justify-between gap-1 transition-all"
                        title="Click or press Enter to edit optical power allocations"
                      >
                        <div className="flex-1 min-w-0 truncate">
                          {batchSummary ? (
                            <span className="text-xs font-mono font-bold text-slate-800">
                              {batchSummary}
                            </span>
                          ) : (
                            <span className="text-xs text-amber-600 font-medium italic flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              Select Power Batch...
                            </span>
                          )}
                        </div>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 shrink-0 uppercase">
                          {line.categoryCode || 'SV'}
                        </span>
                      </button>
                    ) : (
                      <div className="py-1 px-2 text-slate-300 font-mono text-center">
                        —
                      </div>
                    )}
                  </td>

                  {/* Quantity */}
                  <td className="py-0.5 px-1 text-right">
                    <input
                      ref={el => setRef(idx, 'qty', el)}
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity || ''}
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
                  </td>

                  {/* Rate */}
                  <td className="py-0.5 px-1 text-right">
                    <input
                      ref={el => setRef(idx, 'rate', el)}
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.rate !== undefined ? line.rate : ''}
                      onChange={e =>
                        onRateChange(idx, parseFloat(e.target.value) || 0)
                      }
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          focusCell(idx, 'disc');
                        }
                      }}
                      className="w-full text-right py-1 px-2 text-xs font-mono text-slate-900 border-0 bg-transparent hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-600 rounded-xs"
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
                      value={line.discountValue || ''}
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
                      value={line.gstRate}
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
                    </select>
                  </td>

                  {/* Amount (₹) */}
                  <td className="py-1 px-3 text-right font-mono font-bold text-slate-900">
                    ₹{comp.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              );
            })}

            {/* Empty state or Add Next Row prompt */}
            {lines.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400 font-sans">
                  <div className="max-w-xs mx-auto space-y-2">
                    <Layers className="w-8 h-8 mx-auto text-slate-300" />
                    <p className="text-xs font-semibold text-slate-600">No items added to voucher yet</p>
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
      <div className="bg-slate-50 border-t border-slate-200 px-3 py-1.5 flex items-center justify-between text-xs shrink-0">
        <button
          type="button"
          onClick={onAddBlankLine}
          className="flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:text-blue-900 hover:bg-blue-100/50 px-2 py-1 rounded transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Row (or press Enter on last cell)</span>
        </button>

        <div className="text-[11px] text-slate-500 font-sans">
          Total Lines: <span className="font-bold text-slate-800 font-mono">{lines.length}</span>
        </div>
      </div>
    </div>
  );
};
