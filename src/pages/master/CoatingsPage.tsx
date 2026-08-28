import React, { useState, useEffect } from 'react';
import { Sparkles, Plus, Search, RefreshCw, CheckCircle2, XCircle, Edit3, Trash2, ShieldAlert, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Coating } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';

export const CoatingsPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [coatings, setCoatings] = useState<Coating[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);
  const [search, setSearch] = useState<string>('');
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingCoating, setEditingCoating] = useState<Coating | null>(null);
  const [coatingToDelete, setCoatingToDelete] = useState<Coating | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Multi-select & Bulk delete state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  const [formData, setFormData] = useState({ name: '', code: '', description: '', status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' });
  const [submitting, setSubmitting] = useState<boolean>(false);

  const fetchCoatings = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{ success: boolean; coatings: Coating[] }>('/api/optical-master/coatings');
      setCoatings(res.coatings || []);
      setSelectedIds([]);
    } catch (err: any) {
      setError(err.message || 'Failed to load coatings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoatings();
  }, []);

  const handleOpenCreate = () => {
    setEditingCoating(null);
    setFormData({ name: '', code: '', description: '', status: 'ACTIVE' });
    setShowModal(true);
  };

  const handleOpenEdit = (c: Coating) => {
    setEditingCoating(c);
    setFormData({ name: c.name, code: c.code, description: c.description || '', status: c.status });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      if (editingCoating) {
        await apiRequest(`/api/optical-master/coatings/${editingCoating.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            status: formData.status,
          }),
        });
        setFeedbackMessage({ type: 'success', text: `Coating "${formData.name}" updated successfully.` });
      } else {
        await apiRequest('/api/optical-master/coatings', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        setFeedbackMessage({ type: 'success', text: `Coating "${formData.name}" created successfully.` });
      }
      setTimeout(() => setFeedbackMessage(null), 5000);
      setShowModal(false);
      fetchCoatings();
    } catch (err: any) {
      alert(err.message || 'Error saving coating');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!coatingToDelete) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      const res = await apiRequest<{ success: boolean; message?: string }>(`/api/optical-master/coatings/${coatingToDelete.id}`, {
        method: 'DELETE',
      });
      const deletedName = coatingToDelete.name;
      const deletedCode = coatingToDelete.code;
      setCoatingToDelete(null);
      setSelectedIds(prev => prev.filter(id => id !== coatingToDelete.id));
      setFeedbackMessage({
        type: 'success',
        text: res.message || `Coating "${deletedName}" (${deletedCode}) was deleted from database successfully.`,
      });
      setTimeout(() => setFeedbackMessage(null), 6000);
      fetchCoatings();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete coating');
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
      }>('/api/optical-master/coatings/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });

      setShowBulkDeleteModal(false);
      setSelectedIds([]);

      if (res.deletedCount > 0 && res.failedCount === 0) {
        setFeedbackMessage({
          type: 'success',
          text: res.message || `Successfully deleted ${res.deletedCount} coating(s).`,
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
          text: res.message || 'None of the selected coatings could be deleted.',
          details: res.errors,
        });
      }

      setTimeout(() => setFeedbackMessage(null), 8000);
      fetchCoatings();
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to perform bulk delete');
    } finally {
      setBulkDeleting(false);
    }
  };

  const filtered = coatings.filter(c =>
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

  const selectedCoatings = coatings.filter(c => selectedIds.includes(c.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-indigo-600" />
            Coatings Master
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage anti-reflective, blue cut, hydrophobic, and photochromic optical coatings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="btn-refresh-coatings"
            onClick={fetchCoatings}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {hasPermission('master:create') && (
            <button
              id="btn-new-coating"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Coating
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
        <div className="bg-purple-50/90 border border-purple-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="bg-purple-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {selectedIds.length}
            </div>
            <span className="text-sm font-semibold text-purple-950">
              {selectedIds.length === 1 ? '1 coating selected' : `${selectedIds.length} coatings selected`}
            </span>
            <span className="text-xs text-purple-600 font-medium hidden md:inline">
              (out of {filtered.length} visible)
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {selectedIds.length < filtered.length && (
              <button
                type="button"
                onClick={() => setSelectedIds(filtered.map(c => c.id))}
                className="px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100/70 rounded-lg transition-colors cursor-pointer"
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
                id="btn-bulk-delete-coatings"
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
            id="input-search-coatings"
            type="text"
            placeholder="Search coatings by code (HC, HMC, BCG, BCB, BCD, PGHC) or name..."
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
                      id="checkbox-select-all-coatings"
                      checked={isAllSelected}
                      ref={input => {
                        if (input) input.indeterminate = isSomeSelected;
                      }}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-5 py-4">Coating Code</th>
                  <th className="px-5 py-4">Coating Name</th>
                  <th className="px-5 py-4">Description</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading optical coatings...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      No optical coatings found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const isSelected = selectedIds.includes(c.id);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedIds(prev => prev.includes(c.id) ? prev.filter(i => i !== c.id) : [...prev, c.id])}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? 'bg-purple-50/40 hover:bg-purple-50/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="w-10 px-4 py-4 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            id={`checkbox-coating-${c.code}`}
                            checked={isSelected}
                            onChange={(e) => handleToggleSelectRow(c.id, e as any)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-4 font-mono">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            {c.code}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-900">
                          {c.name}
                        </td>
                        <td className="px-5 py-4 text-slate-500 max-w-sm">
                          {c.description || '—'}
                        </td>
                        <td className="px-5 py-4">
                          {c.status === 'ACTIVE' ? (
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
                                id={`btn-edit-coating-${c.id}`}
                                onClick={() => handleOpenEdit(c)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors cursor-pointer"
                                title="Edit Coating"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            )}
                            {(hasPermission('master:delete') || hasPermission('master:edit')) && (
                              <button
                                id={`btn-delete-coating-${c.id}`}
                                onClick={() => {
                                  setCoatingToDelete(c);
                                  setDeleteError(null);
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                                title="Delete Coating"
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

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div id="modal-bulk-delete-coatings" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete {selectedIds.length} Selected Optical Coatings
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  You are about to permanently delete <span className="font-semibold text-slate-800">{selectedIds.length}</span> optical coating records from the database.
                </p>

                {/* List preview */}
                <div className="mt-3 max-h-36 overflow-y-auto bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1">
                  {selectedCoatings.slice(0, 10).map(c => (
                    <div key={c.id} className="flex items-center justify-between text-slate-700">
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-mono">{c.code}</span>
                    </div>
                  ))}
                  {selectedCoatings.length > 10 && (
                    <p className="text-slate-400 italic pt-1 text-center">
                      ...and {selectedCoatings.length - 10} more
                    </p>
                  )}
                </div>

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                    Database Safeguards:
                  </p>
                  <p>
                    • Coatings referenced in sales/purchase invoices or linked to existing primary items cannot be deleted and will be protected automatically.
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
                id="btn-cancel-bulk-delete-coatings"
                disabled={bulkDeleting}
                onClick={() => setShowBulkDeleteModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-bulk-delete-coatings"
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
                    Delete {selectedIds.length} Coating(s)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {coatingToDelete && (
        <div id="modal-delete-coating" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-100">
                <AlertTriangle className="h-6 w-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Delete Optical Coating</h3>
                <p className="text-xs text-slate-500">Remove coating from database</p>
              </div>
            </div>

            <div className="space-y-3 py-2 text-sm text-slate-600">
              <p>
                Are you sure you want to permanently delete optical coating{' '}
                <strong className="font-semibold text-slate-900">
                  {coatingToDelete.name} ({coatingToDelete.code})
                </strong>
                ?
              </p>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Coating Code:</span>
                  <span className="font-mono font-bold text-slate-800">{coatingToDelete.code}</span>
                </div>
                <div className="flex justify-between">
                  <span>Coating Name:</span>
                  <span className="font-medium text-slate-800">{coatingToDelete.name}</span>
                </div>
                {coatingToDelete.description && (
                  <div className="flex justify-between">
                    <span>Description:</span>
                    <span className="font-medium text-slate-800 truncate max-w-[200px]">{coatingToDelete.description}</span>
                  </div>
                )}
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  <strong>Data Protection Rule:</strong> If any Sales or Purchase Invoices have already been created with products using this coating, deletion is strictly prohibited to preserve historical records.
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
                id="btn-cancel-delete-coating"
                type="button"
                disabled={deleting}
                onClick={() => {
                  setCoatingToDelete(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-delete-coating"
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
                    Delete Coating
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
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              {editingCoating ? `Edit Coating: ${editingCoating.code}` : 'Create Optical Coating'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {editingCoating ? 'Update coating details.' : 'Define a new optical coating type.'}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Coating Code *</label>
                <input
                  id="input-coating-code"
                  type="text"
                  required
                  disabled={!!editingCoating}
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. BCG, HMC, BCD"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Coating Name *</label>
                <input
                  id="input-coating-name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Blue Cut Green"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  id="input-coating-description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Coating optical properties and specifications..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  id="select-coating-status"
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
                  id="btn-cancel-coating-modal"
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-save-coating-modal"
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Saving...' : editingCoating ? 'Save Changes' : 'Create Coating'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
