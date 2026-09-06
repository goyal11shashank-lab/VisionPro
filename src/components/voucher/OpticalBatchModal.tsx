import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Check, Plus, Trash2, Layers, AlertCircle } from 'lucide-react';
import { formatOpticalBatchName, rankSearchMatch } from '../../utils/searchNormalization';
import { BatchAllocation, OpticalCategoryCode } from './VoucherTypes';

interface OpticalBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (batches: BatchAllocation[], lineQty?: number) => void;
  mode: 'sales' | 'purchase';
  itemName: string;
  categoryCode?: OpticalCategoryCode | string;
  initialBatches: BatchAllocation[];
  availableBatches?: any[];
  lineQuantity: number;
  lineRate: number;
}

export const OpticalBatchModal: React.FC<OpticalBatchModalProps> = ({
  isOpen,
  onClose,
  onApply,
  mode,
  itemName,
  categoryCode = 'SV',
  initialBatches,
  availableBatches = [],
  lineQuantity,
  lineRate,
}) => {
  const normCategory = (String(categoryCode || 'SV').toUpperCase()) as OpticalCategoryCode;
  const isSV = normCategory === 'SV';
  const isBifocalOrProg = normCategory === 'KT' || normCategory === 'PROG';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState<string>(
    initialBatches[0]?.batchId || ''
  );

  // For purchase mode or multiple allocations:
  const [allocations, setAllocations] = useState<BatchAllocation[]>(
    initialBatches.length > 0
      ? initialBatches
      : [
          {
            sph: '0.00',
            cyl: '0.00',
            axis: '',
            add: '',
            side: 'NONE',
            quantity: lineQuantity > 0 ? lineQuantity : 1,
            rate: lineRate,
          },
        ]
  );

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedBatchId(initialBatches[0]?.batchId || '');
      setAllocations(
        initialBatches.length > 0
          ? initialBatches
          : [
              {
                sph: '0.00',
                cyl: '0.00',
                axis: '',
                add: '',
                side: 'NONE',
                quantity: lineQuantity > 0 ? lineQuantity : 1,
                rate: lineRate,
              },
            ]
      );
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, initialBatches, lineQuantity, lineRate]);

  // Filter available batches using symbol-insensitive and power search
  const filteredAvailableBatches = useMemo(() => {
    if (!searchQuery.trim()) return availableBatches;
    return rankSearchMatch(availableBatches, searchQuery, b => ({
      id: b.id,
      name: formatOpticalBatchName({
        sph: b.sph,
        cyl: b.cyl,
        axis: b.axis,
        add: b.add,
        side: b.side,
      }),
      sph: b.sph,
      cyl: b.cyl,
      axis: b.axis,
      add: b.add,
      side: b.side,
      barcode: b.barcode,
      rawText: `${b.barcode || ''} ${b.batchNumber || ''}`,
    }));
  }, [availableBatches, searchQuery]);

  if (!isOpen) return null;

  const handleSelectExistingBatch = (b: any) => {
    const formatted = formatOpticalBatchName({
      sph: b.sph,
      cyl: b.cyl,
      axis: b.axis,
      add: b.add,
      side: b.side,
    });
    const selected: BatchAllocation = {
      batchId: b.id,
      sph: b.sph ?? '0.00',
      cyl: b.cyl ?? '0.00',
      axis: b.axis ?? '',
      add: b.add ?? '',
      side: b.side ?? 'NONE',
      quantity: lineQuantity > 0 ? lineQuantity : 1,
      barcode: b.barcode,
      availableStock: parseFloat(b.availableStock || b.quantityRemaining || 0),
    };
    onApply([selected], lineQuantity > 0 ? lineQuantity : 1);
    onClose();
  };

  const handleApplyAllocations = () => {
    const valid = allocations.filter(a => Number(a.quantity) > 0);
    const totalQty = valid.reduce((sum, a) => sum + Number(a.quantity), 0);
    onApply(valid, totalQty > 0 ? totalQty : lineQuantity);
    onClose();
  };

  const handleAddPurchaseRow = () => {
    setAllocations(prev => [
      ...prev,
      {
        sph: '0.00',
        cyl: '0.00',
        axis: '',
        add: '',
        side: 'NONE',
        quantity: 1,
        rate: lineRate,
      },
    ]);
  };

  const handleRemovePurchaseRow = (idx: number) => {
    setAllocations(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateAllocation = (idx: number, field: keyof BatchAllocation, value: any) => {
    setAllocations(prev =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 animate-in fade-in duration-150">
      <div
        className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-blue-400" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  Batch &amp; Optical Power Allocation
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-600/60 text-blue-100 border border-blue-400/30 uppercase">
                  Category: {normCategory}
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate max-w-md">{itemName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sales Mode: Select from In-Stock Batches */}
        {mode === 'sales' && (
          <div className="p-4 flex flex-col flex-1 min-h-0 overflow-hidden space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search power (e.g. -2.00, +1.50 cyl -0.50, barcode)..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-md bg-white">
              {filteredAvailableBatches.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  <AlertCircle className="w-6 h-6 mx-auto text-amber-500 mb-2" />
                  No matching in-stock batches found for this item.
                </div>
              ) : (
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Batch / Optical Power</th>
                      <th className="px-2 py-2">SPH</th>
                      <th className="px-2 py-2">CYL</th>
                      {isBifocalOrProg && <th className="px-2 py-2">ADD</th>}
                      <th className="px-2 py-2">SIDE</th>
                      <th className="px-2 py-2 text-right">In Stock</th>
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {filteredAvailableBatches.map(b => {
                      const isSelected = selectedBatchId === b.id;
                      const formattedName = formatOpticalBatchName({
                        sph: b.sph,
                        cyl: b.cyl,
                        axis: b.axis,
                        add: b.add,
                        side: b.side,
                      });
                      const stockQty = parseFloat(b.availableStock || b.quantityRemaining || 0);

                      return (
                        <tr
                          key={b.id}
                          onClick={() => handleSelectExistingBatch(b)}
                          className={`hover:bg-blue-50/80 cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50 font-semibold text-blue-900' : 'text-slate-800'
                          }`}
                        >
                          <td className="px-3 py-2">
                            <span className="font-semibold">{formattedName}</span>
                            {b.barcode && (
                              <span className="block text-[10px] text-slate-400 font-sans">
                                Barcode: {b.barcode}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {Number(b.sph) > 0 ? `+${Number(b.sph).toFixed(2)}` : Number(b.sph || 0).toFixed(2)}
                          </td>
                          <td className="px-2 py-2">
                            {Number(b.cyl) > 0 ? `+${Number(b.cyl).toFixed(2)}` : Number(b.cyl || 0).toFixed(2)}
                          </td>
                          {isBifocalOrProg && (
                            <td className="px-2 py-2">
                              {Number(b.add) > 0 ? `+${Number(b.add).toFixed(2)}` : '—'}
                            </td>
                          )}
                          <td className="px-2 py-2">{b.side || 'NONE'}</td>
                          <td className="px-2 py-2 text-right font-semibold text-emerald-700">
                            {stockQty}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleSelectExistingBatch(b);
                              }}
                              className="px-2 py-0.5 text-[11px] font-sans font-medium bg-blue-600 hover:bg-blue-700 text-white rounded"
                            >
                              Select
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Purchase Mode: Multi-allocation or Enter New Powers */}
        {mode === 'purchase' && (
          <div className="p-4 flex flex-col flex-1 min-h-0 overflow-hidden space-y-3">
            <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200">
              <span className="font-semibold">Procurement Optical Batch Allocation:</span> Enter or select
              optical powers for Category <span className="font-bold text-slate-800">{normCategory}</span>.
              Parameters are auto-configured for this category.
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-md bg-white">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5">SPH</th>
                    <th className="px-2 py-1.5">CYL</th>
                    <th className="px-2 py-1.5">AXIS</th>
                    {isBifocalOrProg && <th className="px-2 py-1.5">ADD</th>}
                    <th className="px-2 py-1.5">SIDE</th>
                    <th className="px-2 py-1.5 w-16">Qty</th>
                    <th className="px-2 py-1.5 w-20">Rate (₹)</th>
                    <th className="px-2 py-1.5 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {allocations.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="p-1">
                        <input
                          type="number"
                          step="0.25"
                          value={row.sph ?? 0}
                          onChange={e => handleUpdateAllocation(idx, 'sph', e.target.value)}
                          className="w-16 px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 font-mono text-center"
                        />
                      </td>
                      <td className="p-1">
                        <input
                          type="number"
                          step="0.25"
                          value={row.cyl ?? 0}
                          onChange={e => handleUpdateAllocation(idx, 'cyl', e.target.value)}
                          className="w-16 px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 font-mono text-center"
                        />
                      </td>
                      <td className="p-1">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="180"
                          value={row.axis ?? ''}
                          onChange={e => handleUpdateAllocation(idx, 'axis', e.target.value)}
                          placeholder="Axis"
                          className="w-14 px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 font-mono text-center"
                        />
                      </td>
                      {isBifocalOrProg && (
                        <td className="p-1">
                          <input
                            type="number"
                            step="0.25"
                            min="0"
                            value={row.add ?? ''}
                            onChange={e => handleUpdateAllocation(idx, 'add', e.target.value)}
                            placeholder="+Add"
                            className="w-14 px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 font-mono text-center"
                          />
                        </td>
                      )}
                      <td className="p-1">
                        <select
                          value={row.side || 'NONE'}
                          onChange={e => handleUpdateAllocation(idx, 'side', e.target.value)}
                          className="px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 font-sans"
                        >
                          <option value="NONE">NONE</option>
                          <option value="R">R (Right)</option>
                          <option value="L">L (Left)</option>
                          <option value="BE">BE (Both)</option>
                        </select>
                      </td>
                      <td className="p-1">
                        <input
                          type="number"
                          min="1"
                          value={row.quantity}
                          onChange={e => handleUpdateAllocation(idx, 'quantity', parseFloat(e.target.value) || 1)}
                          className="w-16 px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 font-mono text-right font-semibold"
                        />
                      </td>
                      <td className="p-1">
                        <input
                          type="number"
                          step="0.01"
                          value={row.rate ?? lineRate}
                          onChange={e => handleUpdateAllocation(idx, 'rate', parseFloat(e.target.value) || 0)}
                          className="w-20 px-1.5 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 font-mono text-right"
                        />
                      </td>
                      <td className="p-1 text-center">
                        {allocations.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemovePurchaseRow(idx)}
                            className="text-slate-400 hover:text-red-600 p-0.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleAddPurchaseRow}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Another Optical Power Batch
              </button>

              <div className="text-xs font-mono text-slate-600">
                Total Qty: <span className="font-bold text-slate-900">{allocations.reduce((sum, r) => sum + Number(r.quantity), 0)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Press <kbd className="px-1 py-0.5 bg-slate-200 rounded text-slate-700 font-mono">Esc</kbd> to exit
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyAllocations}
              className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Apply Batch Power
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
