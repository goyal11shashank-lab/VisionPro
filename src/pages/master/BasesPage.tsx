import React, { useState, useEffect } from 'react';
import { Boxes, Plus, Search, RefreshCw, CheckCircle2, XCircle, Edit3, Trash2, ShieldAlert, AlertTriangle, Sparkles, Tag } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Base, Category, Coating } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const BasesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [bases, setBases] = useState<Base[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [coatings, setCoatings] = useState<Coating[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);
  const [search, setSearch] = useState<string>('');
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingBase, setEditingBase] = useState<Base | null>(null);
  const [baseToDelete, setBaseToDelete] = useState<Base | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Multi-select & Bulk delete state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    family: '',
    coatingId: '',
    description: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    compatibleCategoryIds: [] as string[],
  });
  const [submitting, setSubmitting] = useState<boolean>(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [baseRes, catRes, coatRes] = await Promise.all([
        apiRequest<{ success: boolean; bases: Base[] }>('/api/optical-master/bases'),
        apiRequest<{ success: boolean; categories: Category[] }>('/api/optical-master/categories'),
        apiRequest<{ success: boolean; coatings: Coating[] }>('/api/optical-master/coatings'),
      ]);
      setBases(baseRes.bases || []);
      setCategories(catRes.categories || []);
      setCoatings(coatRes.coatings || []);
      setSelectedIds([]);
    } catch (err: any) {
      setError(err.message || 'Failed to load optical bases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenCreate = () => {
    setEditingBase(null);
    setFormData({
      name: '',
      code: '',
      family: '',
      coatingId: '',
      description: '',
      status: 'ACTIVE',
      compatibleCategoryIds: categories.map(c => c.id), // Default to all compatible
    });
    setShowModal(true);
  };

  const handleOpenEdit = (b: Base) => {
    setEditingBase(b);
    setFormData({
      name: b.name,
      code: b.code,
      family: b.family || '',
      coatingId: b.coatingId || '',
      description: b.description || '',
      status: b.status,
      compatibleCategoryIds: (b.compatibleCategories || []).map(c => c.id),
    });
    setShowModal(true);
  };

  const handleCategoryToggle = (catId: string) => {
    setFormData(prev => {
      const exists = prev.compatibleCategoryIds.includes(catId);
      if (exists) {
        return { ...prev, compatibleCategoryIds: prev.compatibleCategoryIds.filter(id => id !== catId) };
      } else {
        return { ...prev, compatibleCategoryIds: [...prev.compatibleCategoryIds, catId] };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.compatibleCategoryIds.length === 0) {
      alert('Base must be compatible with at least one Optical Category.');
      return;
    }
    try {
      setSubmitting(true);
      if (editingBase) {
        await apiRequest(`/api/optical-master/bases/${editingBase.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formData.name,
            family: formData.family,
            coatingId: formData.coatingId || null,
            description: formData.description,
            status: formData.status,
            compatibleCategoryIds: formData.compatibleCategoryIds,
          }),
        });
        setFeedbackMessage({ type: 'success', text: `Base "${formData.name}" updated successfully.` });
      } else {
        await apiRequest('/api/optical-master/bases', {
          method: 'POST',
          body: JSON.stringify({
            ...formData,
            coatingId: formData.coatingId || null,
          }),
        });
        setFeedbackMessage({ type: 'success', text: `Base "${formData.name}" created successfully.` });
      }
      setTimeout(() => setFeedbackMessage(null), 5000);
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Error saving base');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!baseToDelete) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      const res = await apiRequest<{ success: boolean; message?: string }>(`/api/optical-master/bases/${baseToDelete.id}`, {
        method: 'DELETE',
      });
      const deletedName = baseToDelete.name;
      const deletedCode = baseToDelete.code;
      setBaseToDelete(null);
      setSelectedIds(prev => prev.filter(id => id !== baseToDelete.id));
      setFeedbackMessage({
        type: 'success',
        text: res.message || `Base "${deletedName}" (${deletedCode}) was deleted from database successfully.`,
      });
      setTimeout(() => setFeedbackMessage(null), 6000);
      fetchData();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete optical base');
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
      }>('/api/optical-master/bases/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });

      setShowBulkDeleteModal(false);
      setSelectedIds([]);

      if (res.deletedCount > 0 && res.failedCount === 0) {
        setFeedbackMessage({
          type: 'success',
          text: res.message || `Successfully deleted ${res.deletedCount} base(s).`,
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
          text: res.message || 'None of the selected bases could be deleted.',
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

  const filtered = bases.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.code.toLowerCase().includes(search.toLowerCase()) ||
    (b.family && b.family.toLowerCase().includes(search.toLowerCase()))
  );

  const isAllSelected = filtered.length > 0 && filtered.every(b => selectedIds.includes(b.id));
  const isSomeSelected = filtered.some(b => selectedIds.includes(b.id)) && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const filteredIds = new Set(filtered.map(b => b.id));
      setSelectedIds(prev => prev.filter(id => !filteredIds.has(id)));
    } else {
      const newSelected = new Set([...selectedIds, ...filtered.map(b => b.id)]);
      setSelectedIds(Array.from(newSelected));
    }
  };

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const selectedBases = bases.filter(b => selectedIds.includes(b.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Boxes className="h-7 w-7 text-indigo-600" />
            Bases & Category Compatibility
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Optical lens substrate materials, families, default coatings, and category compatibility mapping.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="btn-refresh-bases"
            onClick={fetchData}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {hasPermission('master:create') && (
            <button
              id="btn-new-base"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Base
            </button>
          )}
        </div>
      </div>

      {feedbackMessage && (
        <div
          id="feedback-banner"
          className={`p-4 rounded-xl text-sm flex flex-col gap-2 border ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {feedbackMessage.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              )}
              <span className="font-medium">{feedbackMessage.text}</span>
            </div>
            <button
              onClick={() => setFeedbackMessage(null)}
              className="text-slate-400 hover:text-slate-600 text-xs px-2 py-1 cursor-pointer font-semibold uppercase tracking-wider"
            >
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
        <div className="bg-blue-50/90 border border-blue-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {selectedIds.length}
            </div>
            <span className="text-sm font-semibold text-blue-950">
              {selectedIds.length === 1 ? '1 base selected' : `${selectedIds.length} bases selected`}
            </span>
            <span className="text-xs text-blue-600 font-medium hidden md:inline">
              (out of {filtered.length} visible)
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {selectedIds.length < filtered.length && (
              <button
                type="button"
                onClick={() => setSelectedIds(filtered.map(b => b.id))}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100/70 rounded-lg transition-colors cursor-pointer"
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
                id="btn-bulk-delete-bases"
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

      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="input-search-bases"
            type="text"
            placeholder="Search bases by code (HC, HMC, BCG, PGHC, PCBCG) or family..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
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
                      id="checkbox-select-all-bases"
                      checked={isAllSelected}
                      ref={input => {
                        if (input) input.indeterminate = isSomeSelected;
                      }}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-5 py-4">Base Code</th>
                  <th className="px-5 py-4">Base Name</th>
                  <th className="px-5 py-4">Family</th>
                  <th className="px-5 py-4">Compatible Categories</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading optical bases & compatibility rules...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      No optical bases found.
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
                          isSelected ? 'bg-blue-50/40 hover:bg-blue-50/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="w-10 px-4 py-4 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            id={`checkbox-base-${b.code}`}
                            checked={isSelected}
                            onChange={(e) => handleToggleSelectRow(b.id, e as any)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-4 font-mono">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {b.code}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-900">
                          {b.name}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {b.family ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                              <Tag className="h-3 w-3" />
                              {b.family}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {b.compatibleCategories && b.compatibleCategories.length > 0 ? (
                              b.compatibleCategories.map(cat => (
                                <span key={cat.id} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  {cat.code}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-amber-600">No categories mapped</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {b.status === 'ACTIVE' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                              <XCircle className="h-3.5 w-3.5" />
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {(hasPermission('master:edit') || hasPermission('master:create') || hasPermission('master:manage')) && (
                              <button
                                id={`btn-edit-base-${b.id}`}
                                onClick={() => handleOpenEdit(b)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors cursor-pointer"
                                title="Edit Base & Compatibility"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            )}
                            {(hasPermission('master:delete') || hasPermission('master:edit')) && (
                              <button
                                id={`btn-delete-base-${b.id}`}
                                onClick={() => {
                                  setBaseToDelete(b);
                                  setDeleteError(null);
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                                title="Delete Base & Category Compatibility"
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

      {/* Delete Confirmation Modal */}
      {baseToDelete && (
        <div id="modal-delete-base" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-100">
                <AlertTriangle className="h-6 w-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Delete Optical Base</h3>
                <p className="text-xs text-slate-500">Remove base and compatibility mapping</p>
              </div>
            </div>

            <div className="space-y-3 py-2 text-sm text-slate-600">
              <p>
                Are you sure you want to permanently delete optical base{' '}
                <strong className="font-semibold text-slate-900">
                  {baseToDelete.name} ({baseToDelete.code})
                </strong>
                ?
              </p>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Base Code:</span>
                  <span className="font-mono font-bold text-slate-800">{baseToDelete.code}</span>
                </div>
                <div className="flex justify-between">
                  <span>Family:</span>
                  <span className="font-medium text-slate-800">{baseToDelete.family || 'None'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Compatible Categories:</span>
                  <span className="font-medium text-slate-800">
                    {baseToDelete.compatibleCategories?.map(c => c.code).join(', ') || 'None'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  <strong>Data Protection Rule:</strong> If any Sales or Purchase Invoices have already been created with products in this category/base, deletion is strictly prohibited to preserve historical records.
                </span>
              </div>

              {deleteError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="font-medium leading-relaxed">{deleteError}</div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 mt-2 border-t border-slate-100">
              <button
                id="btn-cancel-delete-base"
                type="button"
                disabled={deleting}
                onClick={() => {
                  setBaseToDelete(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-delete-base"
                type="button"
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
              >
                {deleting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Base
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div id="modal-bulk-delete-bases" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete {selectedIds.length} Selected Bases
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  You are about to permanently delete <span className="font-semibold text-slate-800">{selectedIds.length}</span> optical base records and their category mapping.
                </p>

                {/* List preview */}
                <div className="mt-3 max-h-36 overflow-y-auto bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1">
                  {selectedBases.slice(0, 10).map(b => (
                    <div key={b.id} className="flex items-center justify-between text-slate-700">
                      <span className="font-semibold">{b.name}</span>
                      <span className="text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-mono">{b.code}</span>
                    </div>
                  ))}
                  {selectedBases.length > 10 && (
                    <p className="text-slate-400 italic pt-1 text-center">
                      ...and {selectedBases.length - 10} more
                    </p>
                  )}
                </div>

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    Database Safeguards:
                  </p>
                  <p>
                    • Bases referenced in sales/purchase invoices or active orders cannot be deleted and will be protected automatically.
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
                id="btn-confirm-bulk-delete-bases"
                disabled={bulkDeleting}
                onClick={handleBulkDeleteConfirm}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                {bulkDeleting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Deleting {selectedIds.length} items...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete {selectedIds.length} Bases
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {editingBase ? `Edit Base: ${editingBase.code}` : 'Create Optical Base'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {editingBase ? 'Update base details and category compatibility.' : 'Define a new optical substrate base.'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Base Code *</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingBase}
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. HC, BCG, PGHC"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Family Group</label>
                  <input
                    type="text"
                    value={formData.family}
                    onChange={(e) => setFormData({ ...formData, family: e.target.value.toUpperCase() })}
                    placeholder="e.g. CLEAR, BLUE CUT"
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Base Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Clear Hard Multi-Coat"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Default Linked Coating</label>
                <select
                  value={formData.coatingId}
                  onChange={(e) => setFormData({ ...formData, coatingId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- No Default Coating --</option>
                  {coatings.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Compatible Optical Categories */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Compatible Optical Categories *
                </label>
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {categories.map(cat => {
                    const isChecked = formData.compatibleCategoryIds.includes(cat.id);
                    return (
                      <label key={cat.id} className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleCategoryToggle(cat.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-semibold text-slate-900">{cat.code}</span>
                        <span className="text-slate-500">- {cat.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Substrate specs, index, abbe value..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingBase ? 'Save Changes' : 'Create Base'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
