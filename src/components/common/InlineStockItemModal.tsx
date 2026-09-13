import React, { useState, useEffect, useRef } from 'react';
import { X, PackagePlus, Tag, Layers, Check, Loader2, Sparkles } from 'lucide-react';
import { apiRequest } from '../../api/client';

export interface InlineStockItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  onSuccess: (newItem: any) => void;
}

export const InlineStockItemModal: React.FC<InlineStockItemModalProps> = ({
  isOpen,
  onClose,
  initialName = '',
  onSuccess,
}) => {
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: initialName,
    code: '',
    opticalCategory: 'SV' as 'SV' | 'KT' | 'PROG' | 'OTHER',
    unit: 'PRS' as 'PRS' | 'PCS',
    maintainBatches: true,
    purchaseRate: 0,
    mrp: 0,
    gstRate: 5,
    description: '',
  });

  const [loadingCode, setLoadingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Suggest code based on item name or random sequence
      const cleanPrefix = (initialName || 'ITEM')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 4)
        .toUpperCase();
      const generatedCode = `${cleanPrefix || 'ITM'}-${Math.floor(1000 + Math.random() * 9000)}`;

      setFormData({
        name: initialName || '',
        code: generatedCode,
        opticalCategory: 'SV',
        unit: 'PRS',
        maintainBatches: true,
        purchaseRate: 0,
        mrp: 0,
        gstRate: 5,
        description: '',
      });
      setErrorMessage(null);

      // Focus name field
      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }, 50);
    }
  }, [isOpen, initialName]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, formData]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.name.trim()) {
      setErrorMessage('Stock Item Name is required.');
      nameInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase() || undefined,
        opticalCategory: formData.opticalCategory,
        unit: formData.unit,
        maintainBatches: formData.maintainBatches,
        purchaseRate: Number(formData.purchaseRate) || 0,
        mrp: Number(formData.mrp) || 0,
        gstRate: Number(formData.gstRate) || 0,
        description: formData.description.trim() || undefined,
        status: 'ACTIVE',
      };

      const newItem = await apiRequest<any>('/api/optical-master/unique-items', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      onSuccess(newItem);
      onClose();
    } catch (err: any) {
      console.error('[InlineStockItemModal] Failed to create stock item:', err);
      setErrorMessage(err?.message || err?.error || 'Failed to create stock item. Please check details.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      id="inline-stock-item-modal-backdrop"
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-3 animate-in fade-in duration-100"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="inline-stock-item-modal"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-600 rounded-lg text-white">
              <PackagePlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Create Stock Item</h2>
              <p className="text-[11px] text-slate-400">Creates stock item and selects into current voucher row</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
              Esc to Cancel • Ctrl+↵ to Save
            </span>
            <button
              type="button"
              id="btn-close-inline-stock-item"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {errorMessage && (
            <div
              id="inline-stock-item-error-banner"
              className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start gap-2"
            >
              <span className="font-bold shrink-0">Error:</span>
              <span className="flex-1">{errorMessage}</span>
            </div>
          )}

          {/* Item Name */}
          <div>
            <label className="block text-slate-700 font-bold mb-1">
              Stock Item Name <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="inline-stock-item-name"
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. 1.56 Blue Cut HC or Single Vision Hard Coat"
              className="w-full px-3 py-2 text-sm font-semibold border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          {/* Item Code & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Item Code / SKU
              </label>
              <input
                id="inline-stock-item-code"
                type="text"
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                placeholder="e.g. SV-156-BC"
                className="w-full px-3 py-2 font-mono uppercase border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Optical Category
              </label>
              <select
                id="inline-stock-item-category"
                value={formData.opticalCategory}
                onChange={e => setFormData({ ...formData, opticalCategory: e.target.value as any })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
              >
                <option value="SV">Single Vision (SV)</option>
                <option value="KT">Kryptok Bifocal (KT)</option>
                <option value="PROG">Progressive (PROG)</option>
                <option value="OTHER">Other / Non-Prescription</option>
              </select>
            </div>
          </div>

          {/* Unit & Maintain Batches */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Base Unit of Measurement
              </label>
              <select
                id="inline-stock-item-unit"
                value={formData.unit}
                onChange={e => setFormData({ ...formData, unit: e.target.value as any })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
              >
                <option value="PRS">PRS (Pairs)</option>
                <option value="PCS">PCS (Pieces)</option>
              </select>
            </div>

            <div className="pt-4">
              <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 select-none">
                <input
                  id="inline-stock-item-maintain-batches"
                  type="checkbox"
                  checked={formData.maintainBatches}
                  onChange={e => setFormData({ ...formData, maintainBatches: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <div>
                  <span className="font-semibold text-slate-800">Maintain Batches</span>
                  <p className="text-[10px] text-slate-500">Track SPH/CYL powers & batch inventory</p>
                </div>
              </label>
            </div>
          </div>

          {/* Rates & GST */}
          <div className="grid grid-cols-3 gap-2.5 pt-1 border-t border-slate-100">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                Purchase Rate (₹)
              </label>
              <input
                id="inline-stock-item-purchase-rate"
                type="number"
                min="0"
                step="0.01"
                value={formData.purchaseRate || ''}
                onChange={e => setFormData({ ...formData, purchaseRate: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                MRP / Sale (₹)
              </label>
              <input
                id="inline-stock-item-mrp"
                type="number"
                min="0"
                step="0.01"
                value={formData.mrp || ''}
                onChange={e => setFormData({ ...formData, mrp: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">
                GST Rate (%)
              </label>
              <select
                id="inline-stock-item-gst-rate"
                value={formData.gstRate}
                onChange={e => setFormData({ ...formData, gstRate: parseFloat(e.target.value) || 0 })}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
              >
                <option value="0">0% (Nil)</option>
                <option value="5">5% (Optical standard)</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-slate-600 font-semibold mb-1">
              Description / Notes (Optional)
            </label>
            <input
              id="inline-stock-item-description"
              type="text"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g. Hydrophobic Anti-Reflective Coating"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          {/* Actions Footer */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              id="btn-cancel-inline-stock-item"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg font-semibold transition-colors disabled:opacity-50"
            >
              Cancel (Esc)
            </button>
            <button
              type="submit"
              id="btn-save-inline-stock-item"
              disabled={submitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition-all active:scale-98 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving & Selecting...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save & Select (↵)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
