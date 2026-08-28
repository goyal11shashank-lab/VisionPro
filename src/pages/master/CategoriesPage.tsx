import React, { useState, useEffect } from 'react';
import { Layers, Plus, Search, RefreshCw, CheckCircle2, XCircle, Edit3, Trash2, ShieldAlert, AlertTriangle, CheckSquare, Square } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Category } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const CategoriesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);
  const [search, setSearch] = useState<string>('');
  
  // Single edit/create modal
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ name: '', code: '', description: '', status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' });
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Single delete modal
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Multi-select & Bulk delete
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{ success: boolean; categories: Category[] }>('/api/optical-master/categories');
      setCategories(res.categories || []);
      setSelectedIds([]);
    } catch (err: any) {
      setError(err.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setFormData({ name: '', code: '', description: '', status: 'ACTIVE' });
    setShowModal(true);
  };

  const handleOpenEdit = (cat: Category) => {
    setEditingCategory(cat);
    setFormData({ name: cat.name, code: cat.code, description: cat.description || '', status: cat.status });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      if (editingCategory) {
        await apiRequest(`/api/optical-master/categories/${editingCategory.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            status: formData.status,
          }),
        });
        setFeedbackMessage({ type: 'success', text: `Category "${formData.name}" updated successfully.` });
      } else {
        await apiRequest('/api/optical-master/categories', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        setFeedbackMessage({ type: 'success', text: `Category "${formData.name}" created successfully.` });
      }
      setTimeout(() => setFeedbackMessage(null), 5000);
      setShowModal(false);
      fetchCategories();
    } catch (err: any) {
      alert(err.message || 'Error saving category');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!categoryToDelete) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      const res = await apiRequest<{ success: boolean; message?: string }>(`/api/optical-master/categories/${categoryToDelete.id}`, {
        method: 'DELETE',
      });
      const deletedName = categoryToDelete.name;
      const deletedCode = categoryToDelete.code;
      setCategoryToDelete(null);
      setSelectedIds(prev => prev.filter(id => id !== categoryToDelete.id));
      setFeedbackMessage({
        type: 'success',
        text: res.message || `Category "${deletedName}" (${deletedCode}) deleted successfully.`,
      });
      setTimeout(() => setFeedbackMessage(null), 6000);
      fetchCategories();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete category');
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
      }>('/api/optical-master/categories/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });

      setShowBulkDeleteModal(false);
      setSelectedIds([]);

      if (res.deletedCount > 0 && res.failedCount === 0) {
        setFeedbackMessage({
          type: 'success',
          text: res.message || `Successfully deleted ${res.deletedCount} category/categories.`,
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
          text: res.message || 'None of the selected categories could be deleted.',
          details: res.errors,
        });
      }

      setTimeout(() => setFeedbackMessage(null), 8000);
      fetchCategories();
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to perform bulk delete');
    } finally {
      setBulkDeleting(false);
    }
  };

  const filtered = categories.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  const isAllSelected = filtered.length > 0 && filtered.every(c => selectedIds.includes(c.id));
  const isSomeSelected = filtered.some(c => selectedIds.includes(c.id)) && !isAllSelected;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const filteredIds = new Set(filtered.map(c => c.id));
      setSelectedIds(prev => prev.filter(id => !filteredIds.has(id)));
    } else {
      const newSelected = new Set([...selectedIds, ...filtered.map(c => c.id)]);
      setSelectedIds(Array.from(newSelected));
    }
  };

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const selectedCategories = categories.filter(c => selectedIds.includes(c.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Layers className="h-7 w-7 text-indigo-600" />
            Optical Categories
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Core category tier defining optical characteristics (Single Vision, Kryptok, Progressive).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="btn-refresh-categories"
            onClick={fetchCategories}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {hasPermission('master:create') && (
            <button
              id="btn-new-category"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs"
            >
              <Plus className="h-4 w-4" />
              New Category
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMessage && (
        <div
          className={`p-4 rounded-xl border flex flex-col gap-2 ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              {feedbackMessage.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              )}
              {feedbackMessage.text}
            </div>
            <button
              onClick={() => setFeedbackMessage(null)}
              className="text-xs opacity-70 hover:opacity-100 font-semibold uppercase tracking-wider px-2 py-0.5 rounded hover:bg-black/5"
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
        <div className="bg-indigo-50/90 border border-indigo-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {selectedIds.length}
            </div>
            <span className="text-sm font-semibold text-indigo-950">
              {selectedIds.length === 1 ? '1 category selected' : `${selectedIds.length} categories selected`}
            </span>
            <span className="text-xs text-indigo-600 font-medium hidden md:inline">
              (out of {filtered.length} visible)
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {selectedIds.length < filtered.length && (
              <button
                type="button"
                onClick={() => setSelectedIds(filtered.map(c => c.id))}
                className="px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100/70 rounded-lg transition-colors"
              >
                Select All ({filtered.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors"
            >
              Clear Selection
            </button>
            {(hasPermission('master:delete') || hasPermission('master:edit')) && (
              <button
                type="button"
                id="btn-bulk-delete-categories"
                onClick={() => {
                  setBulkDeleteError(null);
                  setShowBulkDeleteModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter and Search */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="input-search-categories"
            type="text"
            placeholder="Search categories by code (SV, KT, PROG) or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </div>
      </div>

      {/* Category Table */}
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
                      id="checkbox-select-all-categories"
                      checked={isAllSelected}
                      ref={input => {
                        if (input) input.indeterminate = isSomeSelected;
                      }}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-5 py-4">Code</th>
                  <th className="px-5 py-4">Category Name</th>
                  <th className="px-5 py-4">Description</th>
                  <th className="px-5 py-4">Optical Characteristics</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading category master records...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      No optical categories found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((cat) => {
                    const isSelected = selectedIds.includes(cat.id);
                    return (
                      <tr
                        key={cat.id}
                        onClick={() => setSelectedIds(prev => prev.includes(cat.id) ? prev.filter(i => i !== cat.id) : [...prev, cat.id])}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? 'bg-indigo-50/40 hover:bg-indigo-50/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="w-10 px-4 py-4 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            id={`checkbox-category-${cat.code}`}
                            checked={isSelected}
                            onChange={(e) => handleToggleSelectRow(cat.id, e as any)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {cat.code}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-900">
                          {cat.name}
                        </td>
                        <td className="px-5 py-4 text-slate-500 max-w-xs truncate">
                          {cat.description || '—'}
                        </td>
                        <td className="px-5 py-4">
                          {cat.code === 'SV' && (
                            <span className="text-xs text-slate-600 font-medium bg-slate-100 px-2 py-1 rounded">
                              SPH + CYL (No Axis / Add / Side)
                            </span>
                          )}
                          {cat.code === 'KT' && (
                            <span className="text-xs text-amber-700 font-medium bg-amber-50 px-2 py-1 rounded border border-amber-200">
                              SPH + CYL + AXIS + ADD (Bifocal)
                            </span>
                          )}
                          {cat.code === 'PROG' && (
                            <span className="text-xs text-emerald-700 font-medium bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                              SPH + CYL + AXIS + ADD + SIDE (R/L/BE)
                            </span>
                          )}
                          {!['SV', 'KT', 'PROG'].includes(cat.code) && (
                            <span className="text-xs text-slate-500">Custom Lens Config</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {cat.status === 'ACTIVE' ? (
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
                          <div className="flex items-center justify-end gap-1.5">
                            {(hasPermission('master:edit') || hasPermission('master:create') || hasPermission('master:manage')) && (
                              <button
                                id={`btn-edit-category-${cat.code}`}
                                onClick={() => handleOpenEdit(cat)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                title="Edit Category"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            )}
                            {(hasPermission('master:delete') || hasPermission('master:edit')) && (
                              <button
                                id={`btn-delete-category-${cat.code}`}
                                onClick={() => {
                                  setCategoryToDelete(cat);
                                  setDeleteError(null);
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                title="Delete Category"
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

      {/* Single Edit / Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {editingCategory ? `Edit Category: ${editingCategory.code}` : 'Create Optical Category'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {editingCategory ? 'Update category metadata.' : 'Add a new optical lens category.'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category Code *</label>
                <input
                  type="text"
                  required
                  disabled={!!editingCategory}
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. SV, KT, PROG"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Single Vision"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Category optical specifications and usage..."
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
                  {submitting ? 'Saving...' : editingCategory ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Single Delete Confirmation Modal */}
      {categoryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-rose-100">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete Category
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Are you sure you want to permanently delete category <span className="font-semibold text-slate-800">"{categoryToDelete.name}" ({categoryToDelete.code})</span>?
                </p>

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    Database Safeguards:
                  </p>
                  <p>
                    • Categories referenced in sales/purchase invoices or active orders cannot be deleted.
                  </p>
                  <p>
                    • If primary items or batches are linked, they must be unlinked or deleted first.
                  </p>
                </div>

                {deleteError && (
                  <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                    {deleteError}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setCategoryToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-delete-category"
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 transition-colors shadow-xs"
              >
                {deleting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-rose-100">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete {selectedIds.length} Selected Categories
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  You are about to permanently delete <span className="font-semibold text-slate-800">{selectedIds.length}</span> category records from the database.
                </p>

                {/* List preview */}
                <div className="mt-3 max-h-36 overflow-y-auto bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1">
                  {selectedCategories.slice(0, 10).map(c => (
                    <div key={c.id} className="flex items-center justify-between text-slate-700">
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-mono">{c.code}</span>
                    </div>
                  ))}
                  {selectedCategories.length > 10 && (
                    <p className="text-slate-400 italic pt-1 text-center">
                      ...and {selectedCategories.length - 10} more
                    </p>
                  )}
                </div>

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    Database Safeguards:
                  </p>
                  <p>
                    • Categories with active invoices or linked items will be automatically protected and reported in the summary.
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
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-bulk-delete-categories"
                disabled={bulkDeleting}
                onClick={handleBulkDeleteConfirm}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 transition-colors shadow-xs"
              >
                {bulkDeleting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Deleting {selectedIds.length} items...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete {selectedIds.length} Categories
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

