import React, { useState, useEffect } from 'react';
import { Barcode, Plus, Search, RefreshCw, CheckCircle2, XCircle, Trash2, AlertTriangle, ShieldAlert, Filter, Sparkles, Eye, Layers, Copy, Check, Edit3 } from 'lucide-react';
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
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);
  const [search, setSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedUniqueItem, setSelectedUniqueItem] = useState<string>('');
  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);

  // Delete State
  const [batchToDelete, setBatchToDelete] = useState<OpticalBatch | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Multi-select & Bulk delete state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

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

  // Edit Batch Modal State
  const [editingBatch, setEditingBatch] = useState<OpticalBatch | null>(null);
  const [editFormData, setEditFormData] = useState({
    uniqueItemId: '',
    sph: '0.00',
    cyl: '0.00',
    axis: '0',
    add: '0.00',
    side: 'NONE' as 'NONE' | 'R' | 'L' | 'BE',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

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
      setSelectedIds([]);
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

  const handleDeleteClick = (b: OpticalBatch) => {
    setBatchToDelete(b);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!batchToDelete) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      const res = await apiRequest<{ success: boolean; message: string }>(
        `/api/optical-master/batches/${batchToDelete.id}`,
        { method: 'DELETE' }
      );
      setFeedbackMessage({
        type: 'success',
        text: res.message || `Optical Batch "${batchToDelete.barcode}" was deleted successfully.`
      });
      setSelectedIds(prev => prev.filter(id => id !== batchToDelete.id));
      setBatchToDelete(null);
      setTimeout(() => setFeedbackMessage(null), 6000);
      fetchData();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete optical batch');
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.length === 0) return;
    try {
      setBulkDeleting(true);
      setBulkDeleteError(null);
      const res = await apiRequest<{
        success: boolean;
        totalRequested: number;
        deletedCount: number;
        failedCount: number;
        errors: string[];
        message: string;
      }>('/api/optical-master/batches/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });

      setShowBulkDeleteModal(false);
      setSelectedIds([]);

      if (res.deletedCount > 0 && res.failedCount === 0) {
        setFeedbackMessage({
          type: 'success',
          text: res.message || `Successfully deleted ${res.deletedCount} optical batch(es).`,
        });
      } else if (res.deletedCount > 0 && res.failedCount > 0) {
        setFeedbackMessage({
          type: 'error',
          text: res.message,
          details: res.errors,
        });
      } else {
        setFeedbackMessage({
          type: 'error',
          text: res.message || 'None of the selected optical batches could be deleted.',
          details: res.errors,
        });
      }

      setTimeout(() => setFeedbackMessage(null), 8000);
      fetchData();
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to perform bulk delete');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Determine selected item category to show appropriate fields
  const selectedItemObj = uniqueItems.find(u => u.id === formData.uniqueItemId);
  const currentCategoryCode = (selectedItemObj?.categoryCode || 'SV').toUpperCase();

  const editSelectedItemObj = uniqueItems.find(u => u.id === editFormData.uniqueItemId);
  const editCategoryCode = (editSelectedItemObj?.categoryCode || editingBatch?.categoryCode || 'SV').toUpperCase();

  const handleOpenEdit = (b: OpticalBatch) => {
    setEditingBatch(b);
    setEditFormData({
      uniqueItemId: b.uniqueItemId,
      sph: String(Number(b.sph) || 0),
      cyl: String(Number(b.cyl) || 0),
      axis: String(Number(b.axis) || 0),
      add: String(Number(b.add) || 0),
      side: (b.side as 'NONE' | 'R' | 'L' | 'BE') || 'NONE',
      status: (b.status as 'ACTIVE' | 'INACTIVE') || 'ACTIVE',
    });
    setEditError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBatch) return;
    try {
      setEditSubmitting(true);
      setEditError(null);

      const payload = {
        uniqueItemId: editFormData.uniqueItemId,
        sph: parseFloat(editFormData.sph) || 0,
        cyl: parseFloat(editFormData.cyl) || 0,
        axis: editCategoryCode !== 'SV' ? parseFloat(editFormData.axis) || 0 : 0,
        add: editCategoryCode !== 'SV' ? parseFloat(editFormData.add) || 0 : 0,
        side: editCategoryCode === 'PROG' ? editFormData.side : 'NONE',
        status: editFormData.status,
      };

      await apiRequest<{ success: boolean; batch: OpticalBatch }>(
        `/api/optical-master/batches/${editingBatch.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );

      setFeedbackMessage({
        type: 'success',
        text: `Optical Batch "${editingBatch.barcode}" updated successfully.`,
      });
      setEditingBatch(null);
      setTimeout(() => setFeedbackMessage(null), 5000);
      fetchData();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update optical batch');
    } finally {
      setEditSubmitting(false);
    }
  };

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

  const isAllSelected = filtered.length > 0 && filtered.every(item => selectedIds.includes(item.id));
  const isSomeSelected = filtered.some(item => selectedIds.includes(item.id)) && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const filteredIds = new Set(filtered.map(i => i.id));
      setSelectedIds(prev => prev.filter(id => !filteredIds.has(id)));
    } else {
      const newSelected = new Set([...selectedIds, ...filtered.map(i => i.id)]);
      setSelectedIds(Array.from(newSelected));
    }
  };

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const selectedBatches = batches.filter(i => selectedIds.includes(i.id));

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
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {hasPermission('master:create') && (
            <button
              id="btn-find-or-create-batch"
              onClick={handleOpenFindOrCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Find / Generate Batch
            </button>
          )}
        </div>
      </div>

      {feedbackMessage && (
        <div className={`p-4 rounded-xl text-sm flex flex-col gap-2 border ${feedbackMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {feedbackMessage.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /> : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />}
              <span className="font-medium">{feedbackMessage.text}</span>
            </div>
            <button onClick={() => setFeedbackMessage(null)} className="text-xs font-semibold hover:underline opacity-80 hover:opacity-100 cursor-pointer">
              Dismiss
            </button>
          </div>
          {feedbackMessage.details && feedbackMessage.details.length > 0 && (
            <ul className="text-xs list-disc list-inside space-y-1 mt-1 text-slate-700 pl-6 bg-white/60 p-2.5 rounded-lg border border-amber-200/60">
              {feedbackMessage.details.map((detail, idx) => (
                <li key={idx}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-indigo-50/90 border border-indigo-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {selectedIds.length}
            </div>
            <span className="text-sm font-semibold text-indigo-950">
              {selectedIds.length === 1 ? '1 batch selected' : `${selectedIds.length} batches selected`}
            </span>
            <span className="text-xs text-indigo-600 font-medium hidden md:inline">
              (out of {filtered.length} visible)
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {selectedIds.length < filtered.length && (
              <button
                type="button"
                onClick={() => setSelectedIds(filtered.map(i => i.id))}
                className="px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100/70 rounded-lg transition-colors cursor-pointer"
              >
                Select All ({filtered.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            >
              Clear Selection
            </button>
            {(hasPermission('master:delete') || hasPermission('master:edit')) && (
              <button
                type="button"
                id="btn-bulk-delete-optical-batches"
                onClick={() => {
                  setBulkDeleteError(null);
                  setShowBulkDeleteModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>
        </div>
      )}

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
                  <th className="w-10 px-4 py-4 text-center">
                    <input
                      type="checkbox"
                      id="checkbox-select-all-batches"
                      checked={isAllSelected}
                      ref={input => {
                        if (input) input.indeterminate = isSomeSelected;
                      }}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-5 py-4">Permanent Barcode</th>
                  <th className="px-5 py-4">Unique Item / SKU</th>
                  <th className="px-5 py-4">Category</th>
                  <th className="px-5 py-4">Optical Powers</th>
                  <th className="px-5 py-4">Canonical Identity Key</th>
                  <th className="px-5 py-4">Physical Stock</th>
                  <th className="px-5 py-4">Available</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading optical batches...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-slate-400">
                      No optical batches found. Use "Find / Generate Batch" to register powers.
                    </td>
                  </tr>
                ) : (
                  filtered.map((b) => {
                    const isSelected = selectedIds.includes(b.id);
                    return (
                      <tr
                        key={b.id}
                        onClick={() => setSelectedIds(prev => prev.includes(b.id) ? prev.filter(i => i !== b.id) : [...prev, b.id])}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? 'bg-indigo-50/40 hover:bg-indigo-50/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="w-10 px-4 py-4 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            id={`checkbox-batch-${b.barcode}`}
                            checked={isSelected}
                            onChange={(e) => handleToggleSelectRow(b.id, e as any)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5 font-mono font-bold text-xs text-indigo-900 bg-indigo-50/80 border border-indigo-200 px-2 py-1 rounded w-fit">
                            <span>{b.barcode}</span>
                            <button
                              onClick={() => handleCopyBarcode(b.barcode)}
                              className="text-indigo-400 hover:text-indigo-700 transition-colors cursor-pointer"
                              title="Copy Barcode"
                            >
                              {copiedBarcode === b.barcode ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-900">
                          {b.uniqueItemName}
                          <div className="text-xs text-slate-400 font-mono font-normal">
                            {b.uniqueItemCode}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                            {b.categoryCode || 'SV'}
                          </span>
                        </td>
                        <td className="px-5 py-4">
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
                        <td className="px-5 py-4 font-mono text-xs text-slate-500 max-w-xs truncate" title={b.identityKey}>
                          {b.identityKey}
                        </td>
                        <td className="px-5 py-4 font-mono font-semibold text-slate-900">
                          {Number(b.physicalStock || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-4 font-mono font-semibold text-emerald-700">
                          {Number(b.availableStock || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-4">
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
                        <td className="px-5 py-4 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {(hasPermission('master:edit') || hasPermission('master:create')) && (
                              <button
                                id={`btn-edit-batch-${b.barcode}`}
                                onClick={() => handleOpenEdit(b)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors cursor-pointer"
                                title="Edit Optical Batch & Powers"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            )}
                            {(hasPermission('master:delete') || hasPermission('master:edit')) && (
                              <button
                                id={`btn-delete-batch-${b.barcode}`}
                                onClick={() => handleDeleteClick(b)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                                title="Delete Optical Batch & Power Record"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
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
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Resolving...' : 'Find or Create Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {batchToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="p-2 bg-rose-50 rounded-xl border border-rose-200">
                <AlertTriangle className="h-6 w-6 text-rose-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                Delete Optical Batch & Powers?
              </h3>
            </div>

            <p className="text-sm text-slate-600 mb-3 leading-relaxed">
              Are you sure you want to delete Optical Batch <strong className="text-slate-900 font-mono font-bold">"{batchToDelete.barcode}"</strong> ({batchToDelete.uniqueItemName})?
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 mb-4 space-y-1.5">
              <div className="font-semibold text-slate-800">Database Safeguard Notice:</div>
              <p>
                If any <strong>Sales or Purchase Invoices / Orders</strong> are associated with this power batch, or if it has non-zero physical inventory lots, the deletion will be <strong>strictly blocked</strong> by the database to ensure integrity.
              </p>
            </div>

            {deleteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-start gap-2 mb-4">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBatchToDelete(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-delete-optical-batch"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? 'Deleting...' : 'Delete from Database'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div id="modal-bulk-delete-optical-batches" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete {selectedIds.length} Selected Optical Batches
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  You are about to permanently delete <span className="font-semibold text-slate-800">{selectedIds.length}</span> optical batch power records.
                </p>

                {/* List preview */}
                <div className="mt-3 max-h-36 overflow-y-auto bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1">
                  {selectedBatches.slice(0, 10).map(b => (
                    <div key={b.id} className="flex items-center justify-between text-slate-700">
                      <span className="font-mono font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{b.barcode}</span>
                      <span className="text-slate-600 truncate max-w-[200px]">{b.uniqueItemName} (SPH: {Number(b.sph).toFixed(2)})</span>
                    </div>
                  ))}
                  {selectedBatches.length > 10 && (
                    <p className="text-slate-400 italic pt-1 text-center">
                      ...and {selectedBatches.length - 10} more
                    </p>
                  )}
                </div>

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    Database Safeguards:
                  </p>
                  <p>
                    • Batches referenced in invoices, orders, or with active physical stock balances will not be deleted.
                  </p>
                </div>

                {bulkDeleteError && (
                  <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                    {bulkDeleteError}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => setShowBulkDeleteModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-bulk-delete-optical-batches"
                disabled={bulkDeleting}
                onClick={handleBulkDeleteConfirm}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                {bulkDeleting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Deleting {selectedIds.length} batches...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete {selectedIds.length} Batches
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit Batch Modal */}
      {editingBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-slate-900">
                Edit Optical Batch: <span className="font-mono text-indigo-600">{editingBatch.barcode}</span>
              </h3>
              <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                {editCategoryCode}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Update optical power parameters, SKU mapping, or status for this batch.
            </p>

            {editError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Unique SKU / Item *</label>
                <select
                  required
                  value={editFormData.uniqueItemId}
                  onChange={(e) => setEditFormData({ ...editFormData, uniqueItemId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {uniqueItems.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code}) - {u.categoryCode || 'SV'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Optical Parameters Form Grid */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                  Optical Power Specifications ({editCategoryCode})
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">SPH (Spherical) *</label>
                    <input
                      type="number"
                      step="0.25"
                      required
                      value={editFormData.sph}
                      onChange={(e) => setEditFormData({ ...editFormData, sph: e.target.value })}
                      placeholder="-2.00 / +1.50"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">CYL (Cylindrical) *</label>
                    <input
                      type="number"
                      step="0.25"
                      required
                      value={editFormData.cyl}
                      onChange={(e) => setEditFormData({ ...editFormData, cyl: e.target.value })}
                      placeholder="-0.50 / 0.00"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                  </div>

                  {editCategoryCode !== 'SV' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">AXIS (0 - 180°)</label>
                        <input
                          type="number"
                          min="0"
                          max="180"
                          step="1"
                          value={editFormData.axis}
                          onChange={(e) => setEditFormData({ ...editFormData, axis: e.target.value })}
                          placeholder="e.g. 90 / 180"
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">ADD (Addition Power)</label>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          value={editFormData.add}
                          onChange={(e) => setEditFormData({ ...editFormData, add: e.target.value })}
                          placeholder="e.g. +1.50 / +2.00"
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                        />
                      </div>
                    </>
                  )}
                </div>

                {editCategoryCode === 'PROG' && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Eye / Side *</label>
                    <select
                      required
                      value={editFormData.side}
                      onChange={(e) => setEditFormData({ ...editFormData, side: e.target.value as any })}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                    >
                      <option value="R">Right Eye (R)</option>
                      <option value="L">Left Eye (L)</option>
                      <option value="BE">Both Eyes Pair (BE)</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={editFormData.status}
                  onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingBatch(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {editSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
