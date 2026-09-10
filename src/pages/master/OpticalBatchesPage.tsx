import React, { useState, useEffect, useCallback } from 'react';
import { 
  Barcode, Plus, Search, RefreshCw, CheckCircle2, XCircle, Trash2, 
  AlertTriangle, ShieldAlert, Filter, Sparkles, Eye, Layers, Copy, 
  Check, Edit3, FileSpreadsheet, BookOpen, ExternalLink, Info 
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { OpticalBatch, UniqueItem, Category } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { OpticalBatchImportModal } from '../../components/master/OpticalBatchImportModal.js';
import { StockItemLedgerModal } from '../../components/inventory/StockItemLedgerModal.js';
import { StockItemsListView } from '../../components/inventory/StockItemsListView.js';
import { StockItemBatchesView } from '../../components/inventory/StockItemBatchesView.js';
import { BatchLedgerView } from '../../components/inventory/BatchLedgerView.js';

type ViewMode = 'STOCK_ITEMS' | 'BATCHES' | 'BATCH_LEDGER';

export const OpticalBatchesPage: React.FC = () => {
  const { hasPermission } = useAuth();

  // Navigation / Drill-down state
  const [viewMode, setViewMode] = useState<ViewMode>('STOCK_ITEMS');
  const [selectedStockItem, setSelectedStockItem] = useState<UniqueItem | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<any | null>(null);

  // Master Data
  const [uniqueItems, setUniqueItems] = useState<UniqueItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);

  // Modals state
  // 1. Stock Item Ledger Modal
  const [ledgerItemId, setLedgerItemId] = useState<string | null>(null);
  const [ledgerItemName, setLedgerItemName] = useState<string>('');

  // 2. Excel Bulk Import Modal
  const [showImportModal, setShowImportModal] = useState<boolean>(false);

  // 3. Find or Create Batch Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
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

  // 4. Edit Batch Modal
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

  // 5. Delete Batch State
  const [batchToDelete, setBatchToDelete] = useState<OpticalBatch | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockedInfo, setDeleteBlockedInfo] = useState<{
    canDelete?: boolean;
    reasonSummary?: string;
    error?: string;
    references?: Array<{
      type: string;
      typeLabel: string;
      documentNumber: string;
      status: string;
      partyName: string;
      quantity: number;
      date: string;
    }>;
  } | null>(null);

  // 6. Inspect Dependencies Modal
  const [inspectBatch, setInspectBatch] = useState<OpticalBatch | null>(null);
  const [inspectData, setInspectData] = useState<any | null>(null);
  const [inspectLoading, setInspectLoading] = useState<boolean>(false);

  // Initial Fetch: Loads unique-items and categories (lightweight, highly scalable)
  const fetchStockItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [uRes, cRes] = await Promise.all([
        apiRequest<{ success: boolean; uniqueItems: UniqueItem[] }>('/api/optical-master/unique-items'),
        apiRequest<{ success: boolean; categories: Category[] }>('/api/optical-master/categories'),
      ]);
      setUniqueItems(uRes.uniqueItems || []);
      setCategories(cRes.categories || []);
    } catch (err: any) {
      console.error('[FetchStockItems Error]', err);
      setError(err.message || 'Failed to fetch optical catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStockItems();
  }, [fetchStockItems]);

  // Handle drill-down transitions
  const handleSelectStockItem = (item: UniqueItem) => {
    setSelectedStockItem(item);
    setSelectedBatch(null);
    setViewMode('BATCHES');
  };

  const handleSelectBatch = (batch: any) => {
    setSelectedBatch(batch);
    setViewMode('BATCH_LEDGER');
  };

  const handleBackToItems = () => {
    setSelectedStockItem(null);
    setSelectedBatch(null);
    setViewMode('STOCK_ITEMS');
    fetchStockItems(); // Refresh stock totals when returning
  };

  const handleBackToBatches = () => {
    setSelectedBatch(null);
    setViewMode('BATCHES');
  };

  const handleOpenItemLedger = (item: UniqueItem) => {
    setLedgerItemId(item.id);
    setLedgerItemName(item.name);
  };

  const handleOpenCreateBatch = (preselectedItemId?: string) => {
    setFormData({
      uniqueItemId: preselectedItemId || selectedStockItem?.id || (uniqueItems[0]?.id ?? ''),
      sph: '0.00',
      cyl: '0.00',
      axis: '0',
      add: '0.00',
      side: 'NONE',
    });
    setCreateResult(null);
    setShowCreateModal(true);
  };

  // Inspect Dependencies
  const handleInspectDependencies = async (b: OpticalBatch) => {
    setInspectBatch(b);
    setInspectLoading(true);
    setInspectData(null);
    try {
      const res = await apiRequest<{ success: boolean; data: any }>(
        `/api/optical-master/batches/${b.id}/dependencies`
      );
      setInspectData(res.data);
    } catch (err: any) {
      setInspectData({
        canDelete: false,
        error: err.message || 'Failed to check dependencies',
        references: [],
      });
    } finally {
      setInspectLoading(false);
    }
  };

  // Delete Batch
  const handleConfirmDelete = async () => {
    if (!batchToDelete) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      setDeleteBlockedInfo(null);
      const res = await apiRequest<{ success: boolean; message: string }>(
        `/api/optical-master/batches/${batchToDelete.id}`,
        { method: 'DELETE' }
      );
      setFeedbackMessage({
        type: 'success',
        text: res.message || `Optical Batch "${batchToDelete.barcode}" was deleted successfully.`
      });
      setBatchToDelete(null);
      setTimeout(() => setFeedbackMessage(null), 6000);
      fetchStockItems();
    } catch (err: any) {
      const detailedErr = err.data || {};
      setDeleteError(detailedErr.error || err.message || 'Failed to delete optical batch');
      if (detailedErr.references || detailedErr.reasonSummary || detailedErr.canDelete === false) {
        setDeleteBlockedInfo(detailedErr);
      }
    } finally {
      setDeleting(false);
    }
  };

  // Inactive Archive Batch
  const handleSetBatchInactive = async (batchId: string) => {
    try {
      setDeleting(true);
      await apiRequest(`/api/optical-master/batches/${batchId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'INACTIVE' }),
      });
      setFeedbackMessage({
        type: 'success',
        text: 'Optical Batch was set to INACTIVE / ARCHIVED. It will no longer appear in new transactions while preserving all audit history.',
      });
      setBatchToDelete(null);
      setDeleteBlockedInfo(null);
      setInspectBatch(null);
      setTimeout(() => setFeedbackMessage(null), 8000);
      fetchStockItems();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to mark batch inactive');
    } finally {
      setDeleting(false);
    }
  };

  // Edit Batch
  const handleOpenEdit = (b: OpticalBatch) => {
    setEditingBatch(b);
    setEditFormData({
      uniqueItemId: b.uniqueItemId || b.stockItemId || selectedStockItem?.id || '',
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

      const targetItem = uniqueItems.find(u => u.id === editFormData.uniqueItemId);
      const catCode = (targetItem?.opticalCategory || targetItem?.categoryCode || 'SV').toUpperCase();

      const payload = {
        uniqueItemId: editFormData.uniqueItemId,
        sph: parseFloat(editFormData.sph) || 0,
        cyl: parseFloat(editFormData.cyl) || 0,
        axis: catCode !== 'SV' ? parseFloat(editFormData.axis) || 0 : 0,
        add: catCode !== 'SV' ? parseFloat(editFormData.add) || 0 : 0,
        side: catCode === 'PROG' ? editFormData.side : 'NONE',
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
      fetchStockItems();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update optical batch');
    } finally {
      setEditSubmitting(false);
    }
  };

  // Create Batch
  const handleFindOrCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setCreateResult(null);

      const selectedItemObj = uniqueItems.find(u => u.id === formData.uniqueItemId);
      const currentCategoryCode = (selectedItemObj?.opticalCategory || selectedItemObj?.categoryCode || 'SV').toUpperCase();

      const cylVal = parseFloat(formData.cyl) || 0;
      const payload = {
        uniqueItemId: formData.uniqueItemId,
        sph: parseFloat(formData.sph) || 0,
        cyl: cylVal,
        axis: (cylVal !== 0) ? (parseFloat(formData.axis) || 0) : 0,
        add: (currentCategoryCode === 'KT' || currentCategoryCode === 'PROG') ? (parseFloat(formData.add) || 0) : 0,
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

      setFeedbackMessage({
        type: 'success',
        text: res.isNew 
          ? `New Optical Batch created: ${res.batch.barcode}` 
          : `Optical Batch already exists with barcode: ${res.batch.barcode}`,
      });
      setTimeout(() => setFeedbackMessage(null), 5000);
      fetchStockItems();
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to create optical batch',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedItemObj = uniqueItems.find(u => u.id === formData.uniqueItemId);
  const currentCategoryCode = (selectedItemObj?.opticalCategory || selectedItemObj?.categoryCode || 'SV').toUpperCase();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Global Feedback Banner */}
      {feedbackMessage && (
        <div 
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 shadow-sm transition-all ${
            feedbackMessage.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-start gap-3">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-sm font-semibold">{feedbackMessage.text}</p>
              {feedbackMessage.details && feedbackMessage.details.length > 0 && (
                <ul className="mt-1.5 space-y-1 text-xs text-rose-700 list-disc list-inside">
                  {feedbackMessage.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button 
            onClick={() => setFeedbackMessage(null)}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            &times;
          </button>
        </div>
      )}

      {/* Main Hierarchical View Router */}
      {viewMode === 'STOCK_ITEMS' && (
        <StockItemsListView
          items={uniqueItems}
          categories={categories}
          loading={loading}
          onRefresh={fetchStockItems}
          onSelectStockItem={handleSelectStockItem}
          onOpenLedger={handleOpenItemLedger}
          onCreateBatch={() => handleOpenCreateBatch()}
          onOpenImportModal={() => setShowImportModal(true)}
        />
      )}

      {viewMode === 'BATCHES' && selectedStockItem && (
        <StockItemBatchesView
          stockItem={selectedStockItem}
          onBackToItems={handleBackToItems}
          onSelectBatch={handleSelectBatch}
          onOpenItemLedger={handleOpenItemLedger}
          onCreateBatch={() => handleOpenCreateBatch(selectedStockItem.id)}
          onEditBatch={handleOpenEdit}
          onDeleteBatch={setBatchToDelete}
          onInspectBatch={handleInspectDependencies}
          onOpenImportModal={() => setShowImportModal(true)}
        />
      )}

      {viewMode === 'BATCH_LEDGER' && selectedBatch && (
        <BatchLedgerView
          batchId={selectedBatch.id}
          onBackToBatches={handleBackToBatches}
          onBackToItems={handleBackToItems}
        />
      )}

      {/* Modal 1: Stock Item Full Ledger (Across All Batches) */}
      {ledgerItemId && (
        <StockItemLedgerModal
          isOpen={true}
          itemId={ledgerItemId}
          uniqueItemId={ledgerItemId}
          itemName={ledgerItemName}
          uniqueItemName={ledgerItemName}
          onClose={() => {
            setLedgerItemId(null);
            setLedgerItemName('');
          }}
        />
      )}

      {/* Modal 2: Excel Bulk Import Modal */}
      {showImportModal && (
        <OpticalBatchImportModal
          isOpen={true}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            fetchStockItems();
            setShowImportModal(false);
          }}
          preselectedStockItemId={selectedStockItem?.id}
        />
      )}

      {/* Modal 3: Find or Create Single Optical Batch Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <Barcode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add Optical Power Batch</h3>
                  <p className="text-xs text-slate-500">Auto-generates unique barcode if new power</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateResult(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleFindOrCreateSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Stock Item *
                </label>
                <select
                  value={formData.uniqueItemId}
                  onChange={e => setFormData({ ...formData, uniqueItemId: e.target.value })}
                  required
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="" disabled>Select Stock Item</option>
                  {uniqueItems.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.code}) - {item.opticalCategory || item.categoryCode || 'SV'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Spherical (SPH) *
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    value={formData.sph}
                    onChange={e => setFormData({ ...formData, sph: e.target.value })}
                    required
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-900 focus:outline-none"
                    placeholder="e.g. -2.50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Cylindrical (CYL) *
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    value={formData.cyl}
                    onChange={e => setFormData({ ...formData, cyl: e.target.value })}
                    required
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-900 focus:outline-none"
                    placeholder="e.g. -1.00"
                  />
                </div>
              </div>

              {parseFloat(formData.cyl) !== 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Axis (0 - 180)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    step="1"
                    value={formData.axis}
                    onChange={e => setFormData({ ...formData, axis: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-900 focus:outline-none"
                    placeholder="e.g. 90"
                  />
                </div>
              )}

              {(currentCategoryCode === 'KT' || currentCategoryCode === 'PROG') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Addition (ADD)
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={formData.add}
                    onChange={e => setFormData({ ...formData, add: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono text-slate-900 focus:outline-none"
                    placeholder="e.g. +2.00"
                  />
                </div>
              )}

              {currentCategoryCode === 'PROG' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Side
                  </label>
                  <select
                    value={formData.side}
                    onChange={e => setFormData({ ...formData, side: e.target.value as any })}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none"
                  >
                    <option value="NONE">Both / Unspecified</option>
                    <option value="R">Right (R)</option>
                    <option value="L">Left (L)</option>
                    <option value="BE">Both Eyes (BE)</option>
                  </select>
                </div>
              )}

              {createResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>{createResult.isNew ? 'New Batch Created!' : 'Existing Batch Found'}</span>
                  </div>
                  <div className="font-mono text-xs">Barcode: {createResult.batch.barcode}</div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Processing...' : 'Save Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Edit Batch Modal */}
      {editingBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-indigo-600" />
                <div>
                  <h3 className="font-bold text-slate-900">Edit Optical Batch</h3>
                  <p className="text-xs text-slate-500 font-mono">Barcode: {editingBatch.barcode}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingBatch(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                &times;
              </button>
            </div>

            {editError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs mt-3">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">SPH</label>
                  <input
                    type="number"
                    step="0.25"
                    value={editFormData.sph}
                    onChange={e => setEditFormData({ ...editFormData, sph: e.target.value })}
                    required
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">CYL</label>
                  <input
                    type="number"
                    step="0.25"
                    value={editFormData.cyl}
                    onChange={e => setEditFormData({ ...editFormData, cyl: e.target.value })}
                    required
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                <select
                  value={editFormData.status}
                  onChange={e => setEditFormData({ ...editFormData, status: e.target.value as any })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE / ARCHIVED</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingBatch(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  {editSubmitting ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 5: Delete Batch Safe Confirmation */}
      {batchToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Optical Batch</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">Barcode: {batchToDelete.barcode}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              If this batch has existing transaction records or inventory stock, deletion will be blocked to maintain accounting integrity.
            </p>

            {deleteError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                <p className="font-semibold">{deleteError}</p>
                {deleteBlockedInfo?.references && (
                  <p className="text-[11px] text-rose-700">
                    Found {deleteBlockedInfo.references.length} document reference(s). Consider marking this batch as INACTIVE instead.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mt-5 pt-3 border-t border-slate-100">
              {deleteBlockedInfo && (
                <button
                  type="button"
                  onClick={() => handleSetBatchInactive(batchToDelete.id)}
                  disabled={deleting}
                  className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg"
                >
                  Set Inactive
                </button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    setBatchToDelete(null);
                    setDeleteBlockedInfo(null);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm"
                >
                  {deleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 6: Inspect Dependencies */}
      {inspectBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900">Dependencies Audit: {inspectBatch.barcode}</h3>
              <button onClick={() => setInspectBatch(null)} className="text-slate-400 hover:text-slate-600">
                &times;
              </button>
            </div>
            <div className="mt-4 text-xs">
              {inspectLoading ? (
                <div className="py-8 text-center text-slate-500">Auditing database dependencies...</div>
              ) : inspectData ? (
                <div className="space-y-2">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="font-semibold text-slate-800">
                      Total Document References: {inspectData.references?.length || 0}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
