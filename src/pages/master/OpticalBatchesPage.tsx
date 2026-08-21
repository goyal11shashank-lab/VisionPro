import React, { useState, useEffect } from 'react';
import { Barcode, Plus, Search, RefreshCw, CheckCircle2, XCircle, ShieldAlert, Filter, Sparkles, Eye, Layers, Copy, Check } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { OpticalBatch, UniqueItem, Category } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const OpticalBatchesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [batches, setBatches] = useState<OpticalBatch[]>([]);
  const [uniqueItems, setUniqueItems] = useState<UniqueItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedUniqueItem, setSelectedUniqueItem] = useState<string>('');
  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);

  // Find or Create Modal State
  const [showModal, setShowModal] = useState<boolean>(false);
  const [formData, setFormData] = useState({
    uniqueItemId: '',
    sph: '0.00',
    cyl: '0.00',
    axis: '0',
    add: '0.00',
    side: 'NONE' as 'NONE' | 'R' | 'L' | 'BE',
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createResult, setCreateResult] = useState<{ batch: OpticalBatch; isNew: boolean } | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [bRes, uRes, cRes] = await Promise.all([
        apiRequest<{ success: boolean; batches: OpticalBatch[] }>('/api/optical-master/batches'),
        apiRequest<{ success: boolean; uniqueItems: UniqueItem[] }>('/api/optical-master/unique-items'),
        apiRequest<{ success: boolean; categories: Category[] }>('/api/optical-master/categories'),
      ]);
      setBatches(bRes.batches || []);
      setUniqueItems(uRes.uniqueItems || []);
      setCategories(cRes.categories || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load optical batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenFindOrCreate = () => {
    const defaultU = uniqueItems[0]?.id || '';
    setFormData({
      uniqueItemId: defaultU,
      sph: '0.00',
      cyl: '0.00',
      axis: '0',
      add: '0.00',
      side: 'NONE',
    });
    setCreateResult(null);
    setShowModal(true);
  };

  // Determine selected item category to show appropriate fields
  const selectedItemObj = uniqueItems.find(u => u.id === formData.uniqueItemId);
  const currentCategoryCode = (selectedItemObj?.categoryCode || 'SV').toUpperCase();

  const handleCopyBarcode = (barcode: string) => {
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(barcode);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  const handleFindOrCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setCreateResult(null);

      const payload = {
        uniqueItemId: formData.uniqueItemId,
        sph: parseFloat(formData.sph) || 0,
        cyl: parseFloat(formData.cyl) || 0,
        axis: currentCategoryCode !== 'SV' ? parseFloat(formData.axis) || 0 : 0,
        add: currentCategoryCode !== 'SV' ? parseFloat(formData.add) || 0 : 0,
        side: currentCategoryCode === 'PROG' ? formData.side : 'NONE',
      };

      const res = await apiRequest<{ success: boolean; batch: OpticalBatch; isNew: boolean }>(
        '/api/optical-master/batches/find-or-create',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );

      setCreateResult({
        batch: res.batch,
        isNew: res.isNew,
      });
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Error creating or finding optical batch');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = batches.filter(b => {
    const matchesSearch = b.barcode.toLowerCase().includes(search.toLowerCase()) ||
      b.uniqueItemName?.toLowerCase().includes(search.toLowerCase()) ||
      b.uniqueItemCode?.toLowerCase().includes(search.toLowerCase()) ||
      b.identityKey.toLowerCase().includes(search.toLowerCase());
    const matchesCat = selectedCategory ? b.categoryId === selectedCategory : true;
    const matchesUnique = selectedUniqueItem ? b.uniqueItemId === selectedUniqueItem : true;
    return matchesSearch && matchesCat && matchesUnique;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Barcode className="h-7 w-7 text-indigo-600" />
            Optical Batches & Permanent Barcodes
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Exact optical power identities, canonical identity keys, permanent Code 128 barcodes, and initial stock registry.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {hasPermission('master:create') && (
            <button
              id="btn-find-or-create-batch"
              onClick={handleOpenFindOrCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs"
            >
              <Plus className="h-4 w-4" />
              Find / Generate Batch
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="input-search-batches"
            type="text"
            placeholder="Search by permanent barcode (OPT-...), power, or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          {error}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">Permanent Barcode</th>
                  <th className="px-6 py-4">Unique Item / SKU</th>
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Optical Powers</th>
                  <th className="px-6 py-4">Canonical Identity Key</th>
                  <th className="px-6 py-4">Physical Stock</th>
                  <th className="px-6 py-4">Available</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading optical batches...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                      No optical batches found. Use "Find / Generate Batch" to register powers.
                    </td>
                  </tr>
                ) : (
                  filtered.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 font-mono font-bold text-xs text-indigo-900 bg-indigo-50/80 border border-indigo-200 px-2 py-1 rounded w-fit">
                          <span>{b.barcode}</span>
                          <button
                            onClick={() => handleCopyBarcode(b.barcode)}
                            className="text-indigo-400 hover:text-indigo-700 transition-colors"
                            title="Copy Barcode"
                          >
                            {copiedBarcode === b.barcode ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {b.uniqueItemName}
                        <div className="text-xs text-slate-400 font-mono font-normal">
                          {b.uniqueItemCode}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {b.categoryCode || 'SV'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-mono text-xs text-slate-800 space-y-0.5">
                          <div><span className="text-slate-400 font-sans">SPH:</span> {Number(b.sph) > 0 ? `+${Number(b.sph).toFixed(2)}` : Number(b.sph).toFixed(2)}</div>
                          <div><span className="text-slate-400 font-sans">CYL:</span> {Number(b.cyl) > 0 ? `+${Number(b.cyl).toFixed(2)}` : Number(b.cyl).toFixed(2)}</div>
                          {b.categoryCode !== 'SV' && Number(b.axis) > 0 && (
                            <div><span className="text-slate-400 font-sans">AXIS:</span> {Number(b.axis).toFixed(0)}°</div>
                          )}
                          {b.categoryCode !== 'SV' && Number(b.add) > 0 && (
                            <div><span className="text-slate-400 font-sans">ADD:</span> +{Number(b.add).toFixed(2)}</div>
                          )}
                          {b.categoryCode === 'PROG' && b.side && b.side !== 'NONE' && (
                            <div><span className="text-slate-400 font-sans">SIDE:</span> {b.side}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500 max-w-xs truncate" title={b.identityKey}>
                        {b.identityKey}
                      </td>
                      <td className="px-6 py-4 font-mono font-semibold text-slate-900">
                        {Number(b.physicalStock || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 font-mono font-semibold text-emerald-700">
                        {Number(b.availableStock || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4">
                        {b.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            <XCircle className="h-3 w-3" />
                            Inactive
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Find or Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Find or Create Optical Batch
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter optical power specifications. If an identical batch exists, it will be returned. Otherwise, a permanent Code 128 barcode is automatically generated.
            </p>

            {createResult && (
              <div className={`p-4 mb-4 rounded-xl border text-xs ${createResult.isNew ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <CheckCircle2 className="h-4 w-4" />
                  {createResult.isNew ? 'New Permanent Batch Created!' : 'Existing Batch Matched (Idempotent)'}
                </div>
                <div className="font-mono text-xs">
                  <strong>Barcode:</strong> {createResult.batch.barcode}
                </div>
                <div className="font-mono text-xs truncate">
                  <strong>Identity Key:</strong> {createResult.batch.identityKey}
                </div>
              </div>
            )}

            <form onSubmit={handleFindOrCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Unique Item (SKU) *</label>
                <select
                  required
                  value={formData.uniqueItemId}
                  onChange={(e) => setFormData({ ...formData, uniqueItemId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select SKU Item</option>
                  {uniqueItems.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.code} - {u.name} ({u.categoryCode || 'SV'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                <div className="text-xs font-semibold text-indigo-900 mb-2">
                  Category Rules Applied: {currentCategoryCode} ({selectedItemObj?.categoryName || 'Single Vision'})
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">SPH Power *</label>
                    <input
                      type="number"
                      step="0.25"
                      required
                      value={formData.sph}
                      onChange={(e) => setFormData({ ...formData, sph: e.target.value })}
                      placeholder="-2.00"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">CYL Power *</label>
                    <input
                      type="number"
                      step="0.25"
                      required
                      value={formData.cyl}
                      onChange={(e) => setFormData({ ...formData, cyl: e.target.value })}
                      placeholder="-0.50"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                </div>

                {/* Kryptok or Progressive fields */}
                {currentCategoryCode !== 'SV' && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        AXIS (0 - 180°) {parseFloat(formData.cyl) !== 0 ? '*' : ''}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        step="1"
                        value={formData.axis}
                        onChange={(e) => setFormData({ ...formData, axis: e.target.value })}
                        placeholder="90"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">ADD Power</label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={formData.add}
                        onChange={(e) => setFormData({ ...formData, add: e.target.value })}
                        placeholder="+2.00"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Progressive Specific Side */}
                {currentCategoryCode === 'PROG' && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Eye / Side *</label>
                    <select
                      required
                      value={formData.side}
                      onChange={(e) => setFormData({ ...formData, side: e.target.value as any })}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                    >
                      <option value="R">Right Eye (R)</option>
                      <option value="L">Left Eye (L)</option>
                      <option value="BE">Both Eyes Pair (BE)</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Resolving...' : 'Find or Create Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
