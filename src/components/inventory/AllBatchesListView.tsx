import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Barcode, Search, RefreshCw, Trash2, AlertTriangle, Filter, 
  Eye, Check, Copy, BookOpen, Layers, Edit3, CheckCircle2, ChevronLeft, ChevronRight, Download, ShieldAlert
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { OpticalBatch, Category } from '../../types/index.js';
import { useAuth } from '../../context/AuthContext.js';
import { formatQuantity } from '../../utils/numberFormatting.js';

interface AllBatchesListViewProps {
  categories: Category[];
  onSelectBatch: (batch: any) => void;
  onEditBatch?: (batch: any) => void;
  onRefreshParent?: () => void;
}

export const AllBatchesListView: React.FC<AllBatchesListViewProps> = ({
  categories = [],
  onSelectBatch,
  onEditBatch,
  onRefreshParent,
}) => {
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('master:delete') || hasPermission('master.delete') || hasPermission('inventory:delete') || hasPermission('master:manage');
  const canEdit = hasPermission('master:edit') || hasPermission('master.edit') || hasPermission('master:manage');

  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'POSITIVE' | 'ZERO' | 'NEGATIVE'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Pagination
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  // Multi-selection
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());

  // Bulk Delete Modal
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{
    totalRequested: number;
    deletedCount: number;
    failedCount: number;
    errors: string[];
    blockedBatches?: any[];
    message: string;
  } | null>(null);

  // Single Delete Modal
  const [singleBatchToDelete, setSingleBatchToDelete] = useState<any | null>(null);
  const [singleDeleting, setSingleDeleting] = useState<boolean>(false);
  const [singleDeleteError, setSingleDeleteError] = useState<string | null>(null);
  const [singleDeleteBlocked, setSingleDeleteBlocked] = useState<any | null>(null);
  const [singleDeleteSafetyLoading, setSingleDeleteSafetyLoading] = useState<boolean>(false);
  const [singleDeleteSafetyInfo, setSingleDeleteSafetyInfo] = useState<any | null>(null);

  // Feedback banner
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);
  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);

  const fetchAllBatches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (selectedCategory) params.append('categoryId', selectedCategory);
      if (search.trim()) params.append('search', search.trim());

      const res = await apiRequest<{ success: boolean; batches: any[] }>(`/api/optical-master/batches?${params.toString()}`);
      setBatches(res.batches || []);
    } catch (err: any) {
      console.error('[FetchAllBatches Error]', err);
      setError(err.message || 'Failed to fetch optical batches');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, search]);

  useEffect(() => {
    fetchAllBatches();
  }, [fetchAllBatches]);

  // Client-side filtering for stock and status
  const filteredBatches = useMemo(() => {
    return batches.filter(batch => {
      const stock = Number(batch.physicalStock || 0);
      if (stockFilter === 'POSITIVE' && stock <= 0) return false;
      if (stockFilter === 'ZERO' && stock !== 0) return false;
      if (stockFilter === 'NEGATIVE' && stock >= 0) return false;

      if (statusFilter !== 'ALL' && batch.status !== statusFilter) return false;

      return true;
    });
  }, [batches, stockFilter, statusFilter]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredBatches.length / pageSize));
  const paginatedBatches = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredBatches.slice(start, start + pageSize);
  }, [filteredBatches, page, pageSize]);

  // Selection helpers
  const allVisibleSelected = useMemo(() => {
    return paginatedBatches.length > 0 && paginatedBatches.every(b => selectedBatchIds.has(b.id));
  }, [paginatedBatches, selectedBatchIds]);

  const someVisibleSelected = useMemo(() => {
    return paginatedBatches.some(b => selectedBatchIds.has(b.id));
  }, [paginatedBatches, selectedBatchIds]);

  const isIndeterminate = someVisibleSelected && !allVisibleSelected;

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedBatchIds(prev => {
        const next = new Set(prev);
        paginatedBatches.forEach(b => next.delete(b.id));
        return next;
      });
    } else {
      setSelectedBatchIds(prev => {
        const next = new Set(prev);
        paginatedBatches.forEach(b => next.add(b.id));
        return next;
      });
    }
  };

  const handleToggleSelectBatch = (id: string) => {
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyBarcode = (barcode: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(barcode);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  // Bulk Delete
  const handleOpenBulkDelete = () => {
    if (selectedBatchIds.size === 0) return;
    setBulkDeleteError(null);
    setBulkDeleteResult(null);
    setShowBulkDeleteModal(true);
  };

  const handleConfirmBulkDelete = async () => {
    const ids = Array.from(selectedBatchIds);
    if (ids.length === 0) return;

    try {
      setBulkDeleting(true);
      setBulkDeleteError(null);
      setBulkDeleteResult(null);

      const res = await apiRequest<{
        success: boolean;
        totalRequested: number;
        deletedCount: number;
        failedCount: number;
        errors: string[];
        blockedBatches?: any[];
        message: string;
      }>('/api/optical-master/batches/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });

      if (res.deletedCount > 0 && res.failedCount === 0) {
        // Complete success
        const deletedIds = new Set(ids);
        setBatches(prev => prev.filter(b => !deletedIds.has(b.id)));
        setShowBulkDeleteModal(false);
        setSelectedBatchIds(new Set());
        setFeedback({
          type: 'success',
          text: res.message || `Successfully deleted ${res.deletedCount} optical batch(es).`,
        });
        setTimeout(() => setFeedback(null), 6000);
        onRefreshParent?.();
      } else {
        // Partial or complete failure
        setBulkDeleteResult(res);
        if (res.deletedCount > 0) {
          const blockedIds = new Set(res.blockedBatches?.map((b: any) => b.batchId) || []);
          const actuallyDeleted = ids.filter(id => !blockedIds.has(id));
          const delSet = new Set(actuallyDeleted);
          setBatches(prev => prev.filter(b => !delSet.has(b.id)));
          setSelectedBatchIds(blockedIds);
          onRefreshParent?.();
        }
      }
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to perform bulk delete');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Single Delete
  const handleTriggerSingleDelete = (batch: any) => {
    setSingleBatchToDelete(batch);
    setSingleDeleteError(null);
    setSingleDeleteBlocked(null);
    setSingleDeleteSafetyInfo(null);
    setSingleDeleteSafetyLoading(true);

    apiRequest<{ success: boolean; data: any }>(`/api/optical-master/batches/${batch.id}/dependencies`)
      .then(res => {
        setSingleDeleteSafetyInfo(res.data);
      })
      .catch(err => {
        setSingleDeleteSafetyInfo({
          canDelete: false,
          error: err.message || 'Failed to check batch dependencies',
          references: [],
          stockInfo: {
            physicalStock: Number(batch.physicalStock || 0),
            openingQuantity: Number(batch.openingStock || 0),
          }
        });
      })
      .finally(() => {
        setSingleDeleteSafetyLoading(false);
      });
  };

  const handleConfirmSingleDelete = async () => {
    if (!singleBatchToDelete) return;
    try {
      setSingleDeleting(true);
      setSingleDeleteError(null);
      setSingleDeleteBlocked(null);

      const res = await apiRequest<{ success: boolean; message: string; error?: string }>(
        `/api/optical-master/batches/${singleBatchToDelete.id}`,
        { method: 'DELETE' }
      );

      setBatches(prev => prev.filter(b => b.id !== singleBatchToDelete.id));
      setSelectedBatchIds(prev => {
        const next = new Set(prev);
        next.delete(singleBatchToDelete.id);
        return next;
      });
      setSingleBatchToDelete(null);
      setSingleDeleteSafetyInfo(null);
      setFeedback({
        type: 'success',
        text: res.message || `Optical Batch "${singleBatchToDelete.barcode}" deleted successfully.`,
      });
      setTimeout(() => setFeedback(null), 5000);
      onRefreshParent?.();
    } catch (err: any) {
      const detailed = err.data || {};
      setSingleDeleteError(detailed.error || err.message || 'Failed to delete optical batch');
      if (detailed.references || detailed.reasonSummary || detailed.canDelete === false) {
        setSingleDeleteBlocked(detailed);
      }
    } finally {
      setSingleDeleting(false);
    }
  };

  const selectedBatchesList = useMemo(() => {
    return batches.filter(b => selectedBatchIds.has(b.id));
  }, [batches, selectedBatchIds]);

  const handleExportCSV = () => {
    const headers = ['Barcode', 'Power', 'Stock Item', 'Category', 'SPH', 'CYL', 'AXIS', 'ADD', 'SIDE', 'Physical Stock', 'Reserved', 'Available', 'Status'];
    const rows = filteredBatches.map(b => [
      b.barcode,
      b.formattedName || '',
      b.uniqueItemName || '',
      b.categoryName || '',
      b.sph,
      b.cyl,
      b.axis || 0,
      b.add || 0,
      b.side || 'NONE',
      b.physicalStock || 0,
      b.reservedStock || 0,
      b.availableStock || 0,
      b.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Optical_Batches_Register_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-3.5">
      {/* Feedback Banner */}
      {feedback && (
        <div className={`p-4 rounded-xl border flex items-start justify-between gap-3 shadow-xs ${
          feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <div className="flex items-start gap-3">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-sm font-semibold">{feedback.text}</p>
              {feedback.details && (
                <ul className="mt-1.5 space-y-1 text-xs text-rose-700 list-disc list-inside">
                  {feedback.details.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
            </div>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-600 p-1">&times;</button>
        </div>
      )}

      {/* Multi-Selection Action Toolbar */}
      {selectedBatchIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {selectedBatchIds.size}
            </span>
            <span className="text-xs font-semibold text-blue-900">
              {selectedBatchIds.size === 1 ? '1 optical batch selected' : `${selectedBatchIds.size} optical batches selected`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedBatchIds(new Set())}
              className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-white rounded-lg transition-colors cursor-pointer border border-slate-200 bg-white"
            >
              Deselect All
            </button>

            {canDelete && (
              <button
                type="button"
                id="btn-bulk-delete-all-batches"
                onClick={handleOpenBulkDelete}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Selected ({selectedBatchIds.size})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by Barcode, SPH, CYL, or Item name..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all font-mono"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={e => { setSelectedCategory(e.target.value); setPage(1); }}
            className="py-1.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
          >
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>

          <select
            value={stockFilter}
            onChange={e => { setStockFilter(e.target.value as any); setPage(1); }}
            className="py-1.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
          >
            <option value="ALL">All Stock Levels</option>
            <option value="POSITIVE">In Stock (&gt; 0)</option>
            <option value="ZERO">Zero Stock (= 0)</option>
            <option value="NEGATIVE">Negative Stock (&lt; 0)</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value as any); setPage(1); }}
            className="py-1.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAllBatches()}
            disabled={loading}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer border border-slate-200"
            title="Refresh Batches"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer border border-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Batches Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3 text-center w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                    onChange={handleToggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    title="Select/Deselect visible batches"
                  />
                </th>
                <th className="py-3 px-3">Barcode</th>
                <th className="py-3 px-3">Power (SPH / CYL)</th>
                <th className="py-3 px-3">Stock Item</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3 text-right">Physical Stock</th>
                <th className="py-3 px-3 text-right">Reserved</th>
                <th className="py-3 px-3 text-right">Available</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-normal">
              {loading && batches.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-500" />
                    <p className="text-xs font-semibold text-slate-600">Loading optical batches catalog...</p>
                  </td>
                </tr>
              ) : paginatedBatches.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Barcode className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No optical batches found</p>
                    <p className="text-xs text-slate-400 mt-1">Try adjusting search query or filters.</p>
                  </td>
                </tr>
              ) : (
                paginatedBatches.map(batch => {
                  const isSelected = selectedBatchIds.has(batch.id);
                  const phys = Number(batch.physicalStock || 0);
                  const res = Number(batch.reservedStock || 0);
                  const avail = Number(batch.availableStock || 0);

                  return (
                    <tr
                      key={batch.id}
                      onClick={() => onSelectBatch(batch)}
                      className={`transition-colors cursor-pointer group ${
                        isSelected ? 'bg-blue-50/70 border-l-4 border-l-blue-600' : 'hover:bg-blue-50/30'
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectBatch(batch.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      <td className="py-2.5 px-3 font-mono">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] text-slate-800">
                          <Barcode className="h-3 w-3 text-slate-400" />
                          <span>{batch.barcode}</span>
                          <button
                            onClick={e => handleCopyBarcode(batch.barcode, e)}
                            className="text-slate-400 hover:text-slate-700 p-0.5"
                            title="Copy Barcode"
                          >
                            {copiedBarcode === batch.barcode ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="font-mono font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {batch.formattedName || `${batch.sph} / ${batch.cyl}`}
                        </span>
                        {batch.axis ? <span className="ml-1 text-[10px] text-slate-500">Ax:{batch.axis}°</span> : null}
                        {batch.add ? <span className="ml-1 text-[10px] text-slate-500">Add:{batch.add}</span> : null}
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800 truncate max-w-[200px]" title={batch.uniqueItemName}>
                          {batch.uniqueItemName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">{batch.uniqueItemCode}</div>
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {batch.categoryName || batch.categoryCode || 'SV'}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold">
                        <span className={phys > 0 ? 'text-emerald-700' : phys < 0 ? 'text-rose-700' : 'text-slate-400'}>
                          {formatQuantity(phys)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono">
                        <span className={res > 0 ? 'text-amber-700 font-semibold' : 'text-slate-400'}>
                          {formatQuantity(res)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-semibold">
                        <span className={avail > 0 ? 'text-blue-700' : avail < 0 ? 'text-rose-700' : 'text-slate-400'}>
                          {formatQuantity(avail)}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          batch.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          {batch.status}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onSelectBatch(batch)}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="View Batch Ledger"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                          </button>

                          {canEdit && onEditBatch && (
                            <button
                              onClick={() => onEditBatch(batch)}
                              className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                              title="Edit Batch"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {canDelete && (
                            <button
                              onClick={() => handleTriggerSingleDelete(batch)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title="Delete Batch"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <div>
              Showing <span className="font-semibold text-slate-900">{Math.min(filteredBatches.length, (page - 1) * pageSize + 1)}</span> to{' '}
              <span className="font-semibold text-slate-900">{Math.min(filteredBatches.length, page * pageSize)}</span> of{' '}
              <span className="font-semibold text-slate-900">{filteredBatches.length}</span> batches
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 font-medium">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Bulk Delete Optical Batches */}
      {showBulkDeleteModal && (
        <div id="modal-bulk-delete-all-batches" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-8">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Delete {selectedBatchIds.size} Selected Optical Batches
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Permanent removal from optical batch master database
                </p>
              </div>
            </div>

            {/* Core Explanation as required by Phase 6 */}
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 space-y-1">
              <p className="font-semibold flex items-center gap-1.5 text-blue-950">
                <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0" />
                <span>Deletion Policy &amp; Accounting Safeguards</span>
              </p>
              <p className="text-[11px] text-blue-800 leading-normal">
                Opening stock does not prevent deletion. A batch can be deleted if it has not been used in a posted Sales Invoice or Purchase Invoice and has no other blocking dependencies.
              </p>
              <p className="text-[11px] text-blue-800 leading-normal">
                Batches with posted invoice usage or active trading dependencies will be protected to maintain unbroken audit trails.
              </p>
            </div>

            {bulkDeleteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                <p className="font-semibold">{bulkDeleteError}</p>
              </div>
            )}

            {bulkDeleteResult && (
              <div className="space-y-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <p className="font-semibold text-slate-800">{bulkDeleteResult.message}</p>
                {bulkDeleteResult.errors && bulkDeleteResult.errors.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-medium text-rose-700">Blocked Batches:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-600 max-h-40 overflow-y-auto">
                      {bulkDeleteResult.errors.map((e, idx) => (
                        <li key={idx}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Selected batch preview list */}
            {!bulkDeleteResult && (
              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50/50">
                {selectedBatchesList.slice(0, 10).map(b => (
                  <div key={b.id} className="p-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono font-bold text-slate-800">{b.formattedName || `${b.sph} / ${b.cyl}`}</span>
                      <span className="ml-2 font-mono text-[11px] text-slate-500">[{b.barcode}]</span>
                      <span className="ml-2 text-slate-600">{b.uniqueItemName}</span>
                    </div>
                    <div className="font-mono text-slate-600 text-right">
                      Stock: {b.physicalStock || 0}
                    </div>
                  </div>
                ))}
                {selectedBatchesList.length > 10 && (
                  <div className="p-2 text-center text-xs text-slate-400">
                    ...and {selectedBatchesList.length - 10} more batches
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowBulkDeleteModal(false);
                  setBulkDeleteResult(null);
                }}
                disabled={bulkDeleting}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {bulkDeleteResult ? 'Close' : 'Cancel'}
              </button>

              {!bulkDeleteResult && (
                <button
                  type="button"
                  id="btn-confirm-bulk-delete-all-batches"
                  onClick={handleConfirmBulkDelete}
                  disabled={bulkDeleting || selectedBatchIds.size === 0}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {bulkDeleting ? 'Verifying & Deleting...' : `Confirm & Delete (${selectedBatchIds.size})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Single Delete Batch */}
      {singleBatchToDelete && (
        <div id="modal-single-delete-batch" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <Trash2 className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900">Delete Optical Batch</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Barcode: <span className="font-semibold text-slate-800">{singleBatchToDelete.barcode}</span>
                </p>
              </div>
            </div>

            {/* Core Explanation as required by Phase 6 */}
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 space-y-1">
              <p className="font-semibold flex items-center gap-1.5 text-blue-950">
                <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0" />
                <span>Deletion Policy</span>
              </p>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                Opening stock does not prevent deletion. A batch can be deleted if it has not been used in a posted Sales Invoice or Purchase Invoice and has no other blocking dependencies.
              </p>
            </div>

            {/* Batch & Inventory Identity Card */}
            <div className="mt-3.5 border border-slate-200 bg-slate-50/70 rounded-xl p-3 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Stock Item:</span>
                  <span className="font-bold text-slate-900 truncate block">
                    {singleBatchToDelete.uniqueItemName || singleBatchToDelete.itemName || '—'}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({singleBatchToDelete.uniqueItemCode || singleBatchToDelete.itemCode || '—'})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Batch Powers:</span>
                  <span className="font-mono font-bold text-slate-900 block">
                    SPH {singleBatchToDelete.sph} • CYL {singleBatchToDelete.cyl}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {singleBatchToDelete.add ? `ADD +${singleBatchToDelete.add}` : ''} {singleBatchToDelete.side && singleBatchToDelete.side !== 'NONE' ? `• SIDE: ${singleBatchToDelete.side}` : ''}
                  </span>
                </div>
                <div className="pt-1 border-t border-slate-200/80">
                  <span className="text-slate-500 block">Opening Quantity:</span>
                  <span className="font-bold font-mono text-slate-900">
                    {singleDeleteSafetyLoading ? 'Checking...' : `${singleDeleteSafetyInfo?.stockInfo?.openingQuantity ?? singleBatchToDelete.openingStock ?? 0} PRS`}
                  </span>
                </div>
                <div className="pt-1 border-t border-slate-200/80">
                  <span className="text-slate-500 block">Current On-Hand Stock:</span>
                  <span className={`font-bold font-mono ${(singleDeleteSafetyInfo?.stockInfo?.physicalStock ?? singleBatchToDelete.physicalStock ?? 0) > 0 ? 'text-amber-800' : 'text-slate-900'}`}>
                    {singleDeleteSafetyLoading ? 'Checking...' : `${singleDeleteSafetyInfo?.stockInfo?.physicalStock ?? singleBatchToDelete.physicalStock ?? singleBatchToDelete.stock ?? 0} PRS`}
                  </span>
                </div>
              </div>
            </div>

            {/* Dependency loading state */}
            {singleDeleteSafetyLoading && (
              <div className="mt-3 p-2.5 bg-slate-100 rounded-xl text-center text-xs text-slate-600 flex items-center justify-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500" />
                <span>Verifying invoice and trading dependencies...</span>
              </div>
            )}

            {/* Safe to delete badge */}
            {!singleDeleteSafetyLoading && singleDeleteSafetyInfo && singleDeleteSafetyInfo.canDelete && !singleDeleteError && (
              <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Safe to delete. No posted Sales or Purchase Invoices reference this batch.</span>
              </div>
            )}

            {/* Error / Blocked Reason Message */}
            {singleDeleteError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5 text-rose-900">
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>Deletion Blocked</span>
                </p>
                <p className="font-medium text-[11px] leading-relaxed">{singleDeleteError}</p>
                {singleDeleteBlocked?.references && singleDeleteBlocked.references.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-rose-200/70">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-rose-900 mb-1">
                      Related Document(s) Blocking Deletion:
                    </p>
                    <div className="max-h-28 overflow-y-auto divide-y divide-rose-200/50 bg-white/80 rounded border border-rose-200 text-[11px]">
                      {singleDeleteBlocked.references.map((ref: any, idx: number) => (
                        <div key={idx} className="p-1.5 flex items-center justify-between">
                          <span className="font-medium">
                            {ref.typeLabel} #{ref.documentNumber || ref.documentId}
                          </span>
                          <span className="font-mono text-rose-700">
                            {ref.quantity ? `${ref.quantity} PRS` : ''} • {ref.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!singleDeleteError && singleDeleteSafetyInfo && !singleDeleteSafetyInfo.canDelete && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5 text-rose-900">
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>Deletion Blocked</span>
                </p>
                <p className="font-medium text-[11px] leading-relaxed">{singleDeleteSafetyInfo.error}</p>
                {singleDeleteSafetyInfo.references && singleDeleteSafetyInfo.references.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-rose-200/70">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-rose-900 mb-1">
                      Related Document(s) Blocking Deletion:
                    </p>
                    <div className="max-h-28 overflow-y-auto divide-y divide-rose-200/50 bg-white/80 rounded border border-rose-200 text-[11px]">
                      {singleDeleteSafetyInfo.references.map((ref: any, idx: number) => (
                        <div key={idx} className="p-1.5 flex items-center justify-between">
                          <span className="font-medium">
                            {ref.typeLabel} #{ref.documentNumber || ref.documentId}
                          </span>
                          <span className="font-mono text-rose-700">
                            {ref.quantity ? `${ref.quantity} PRS` : ''} • {ref.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setSingleBatchToDelete(null);
                  setSingleDeleteBlocked(null);
                  setSingleDeleteError(null);
                  setSingleDeleteSafetyInfo(null);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSingleDelete}
                disabled={singleDeleting || singleDeleteSafetyLoading || (singleDeleteSafetyInfo && !singleDeleteSafetyInfo.canDelete)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm cursor-pointer"
              >
                {singleDeleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirm Delete</span>
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
