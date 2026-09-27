import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ArrowLeft, Search, Plus, RefreshCw, Barcode, Copy, Check, 
  Eye, Edit3, Trash2, BookOpen, AlertTriangle, ChevronLeft, ChevronRight,
  ShieldAlert, Sparkles, FileSpreadsheet, Calendar, Download, Printer, Filter,
  CheckCircle2, XCircle, CheckSquare, Square, MinusSquare
} from 'lucide-react';
import { UniqueItem, OpticalBatch } from '../../types/index.js';
import { apiRequest } from '../../api/client.js';
import { formatQuantity } from '../../utils/numberFormatting.js';
import { useAuth } from '../../context/AuthContext.js';

interface StockItemBatchesViewProps {
  stockItem: UniqueItem;
  onBackToItems: () => void;
  onSelectBatch: (batch: any) => void;
  onOpenItemLedger: (item: UniqueItem) => void;
  onCreateBatch: () => void;
  onEditBatch: (batch: OpticalBatch) => void;
  onDeleteBatch?: (batch: OpticalBatch) => void;
  onInspectBatch: (batch: OpticalBatch) => void;
  onOpenImportModal: () => void;
  onBatchesUpdated?: () => void;
}

export const StockItemBatchesView: React.FC<StockItemBatchesViewProps> = ({
  stockItem,
  onBackToItems,
  onSelectBatch,
  onOpenItemLedger,
  onCreateBatch,
  onEditBatch,
  onDeleteBatch,
  onInspectBatch,
  onOpenImportModal,
  onBatchesUpdated,
}) => {
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('master:delete') || hasPermission('master:edit');
  const canEdit = hasPermission('master:edit') || hasPermission('master:create');

  const [batches, setBatches] = useState<any[]>([]);
  const [totals, setTotals] = useState<{ batchesCount: number; stock: number; reserved: number; available: number }>({
    batchesCount: 0,
    stock: 0,
    reserved: 0,
    available: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'POSITIVE' | 'ZERO' | 'NEGATIVE' | 'NON_ZERO'>('ALL');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);

  // Multiple selection state
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());

  // Bulk delete modal state
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

  // Single delete modal state (integrated for live inline refresh)
  const [singleBatchToDelete, setSingleBatchToDelete] = useState<any | null>(null);
  const [singleDeleting, setSingleDeleting] = useState<boolean>(false);
  const [singleDeleteError, setSingleDeleteError] = useState<string | null>(null);
  const [singleDeleteBlocked, setSingleDeleteBlocked] = useState<any | null>(null);

  // Status mutation state
  const [markingInactive, setMarkingInactive] = useState<boolean>(false);

  // Feedback notifications
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
    details?: string[];
  } | null>(null);

  // Optical category detection for coordinate columns
  const categoryCode = (stockItem.opticalCategory || stockItem.categoryCode || 'SV').toUpperCase();
  const isSV = categoryCode === 'SV' || categoryCode.includes('SINGLE');
  const isKT = categoryCode === 'KT' || categoryCode.includes('BIFOCAL') || categoryCode.includes('BF') || categoryCode.includes('KRYPTOK');
  const isProg = categoryCode === 'PROG' || categoryCode.includes('PROGRESSIVE');

  const showSph = true;
  const showCyl = true;
  const showAxis = isKT || isProg;
  const showAdd = isKT || isProg;
  const showSide = isProg || categoryCode.includes('CL');

  const formatPowerVal = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(Number(val))) return '—';
    const num = Number(val);
    return num > 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
  };

  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        status: statusFilter,
      });

      if (search.trim()) {
        params.append('search', search.trim());
      }
      if (stockFilter !== 'ALL') {
        params.append('stockFilter', stockFilter);
      }

      const res = await apiRequest<{
        success: boolean;
        stockItem: any;
        totals: { batchesCount: number; stock: number; reserved: number; available: number };
        batches: any[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/api/stock-items/${stockItem.id}/batches?${params.toString()}`);

      setBatches(res.batches || []);
      if (res.totals) {
        setTotals(res.totals);
      }
      if (res.pagination) {
        setTotalPages(res.pagination.totalPages || 1);
        setTotalCount(res.pagination.total || 0);
      }
    } catch (err: any) {
      console.error('[FetchBatches Error]', err);
      setError(err.message || 'Failed to fetch batches for stock item');
    } finally {
      setLoading(false);
    }
  }, [stockItem.id, page, limit, statusFilter, stockFilter, search]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Selection calculations
  const allVisibleSelected = useMemo(() => {
    return batches.length > 0 && batches.every(b => selectedBatchIds.has(b.id));
  }, [batches, selectedBatchIds]);

  const someVisibleSelected = useMemo(() => {
    return batches.some(b => selectedBatchIds.has(b.id));
  }, [batches, selectedBatchIds]);

  const isIndeterminate = someVisibleSelected && !allVisibleSelected;

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedBatchIds(prev => {
        const next = new Set(prev);
        batches.forEach(b => next.delete(b.id));
        return next;
      });
    } else {
      setSelectedBatchIds(prev => {
        const next = new Set(prev);
        batches.forEach(b => next.add(b.id));
        return next;
      });
    }
  };

  const handleToggleSelectBatch = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedBatchIds(new Set());
  };

  const handleSelectAllVisible = () => {
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      batches.forEach(b => next.add(b.id));
      return next;
    });
  };

  // Multiple Batch Delete
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
        setShowBulkDeleteModal(false);
        setSelectedBatchIds(new Set());
        setFeedbackBanner({
          type: 'success',
          text: res.message || `Successfully deleted ${res.deletedCount} optical batch(es).`,
        });
        setTimeout(() => setFeedbackBanner(null), 6000);
        await fetchBatches();
        onBatchesUpdated?.();
      } else {
        // Partial or complete block
        setBulkDeleteResult(res);
        if (res.deletedCount > 0) {
          const remainingIds = new Set(res.blockedBatches?.map((b: any) => b.batchId) || []);
          setSelectedBatchIds(remainingIds);
          await fetchBatches();
          onBatchesUpdated?.();
        }
      }
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to perform bulk delete');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Bulk Inactive Marking
  const handleBulkSetInactive = async (targetIds?: string[]) => {
    const ids = targetIds || Array.from(selectedBatchIds);
    if (ids.length === 0) return;

    try {
      setMarkingInactive(true);
      const res = await apiRequest<{
        success: boolean;
        updatedCount: number;
        message: string;
      }>('/api/optical-master/batches/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ ids, status: 'INACTIVE' }),
      });

      setFeedbackBanner({
        type: 'success',
        text: res.message || `Successfully marked ${res.updatedCount || ids.length} batch(es) as INACTIVE.`,
      });
      setTimeout(() => setFeedbackBanner(null), 6000);
      setShowBulkDeleteModal(false);
      setBulkDeleteResult(null);
      setSelectedBatchIds(new Set());
      await fetchBatches();
      onBatchesUpdated?.();
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err.message || 'Failed to update batch status to INACTIVE',
      });
    } finally {
      setMarkingInactive(false);
    }
  };

  // Single Batch Delete
  const handleTriggerSingleDelete = (batch: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSingleBatchToDelete(batch);
    setSingleDeleteError(null);
    setSingleDeleteBlocked(null);
  };

  const handleConfirmSingleDelete = async () => {
    if (!singleBatchToDelete) return;

    try {
      setSingleDeleting(true);
      setSingleDeleteError(null);
      setSingleDeleteBlocked(null);

      const res = await apiRequest<{ success: boolean; message: string }>(
        `/api/optical-master/batches/${singleBatchToDelete.id}`,
        { method: 'DELETE' }
      );

      setFeedbackBanner({
        type: 'success',
        text: res.message || `Optical Batch "${singleBatchToDelete.barcode}" was deleted successfully.`
      });
      setSingleBatchToDelete(null);
      setSelectedBatchIds(prev => {
        const next = new Set(prev);
        next.delete(singleBatchToDelete.id);
        return next;
      });
      setTimeout(() => setFeedbackBanner(null), 6000);
      await fetchBatches();
      onBatchesUpdated?.();
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

  const handleSingleSetInactive = async () => {
    if (!singleBatchToDelete) return;
    await handleBulkSetInactive([singleBatchToDelete.id]);
    setSingleBatchToDelete(null);
    setSingleDeleteBlocked(null);
  };

  const handleCopyBarcode = (barcode: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(barcode);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  const handleExportCSV = () => {
    const headers = ['Batch Name', 'Barcode', 'SPH', 'CYL'];
    if (showAxis) headers.push('AXIS');
    if (showAdd) headers.push('ADD');
    if (showSide) headers.push('SIDE');
    headers.push('Stock', 'Reserved', 'Available', 'Status');

    const rows = batches.map(b => {
      const row = [
        b.formattedName || '',
        b.barcode || '',
        formatPowerVal(b.sph),
        formatPowerVal(b.cyl),
      ];
      if (showAxis) row.push(b.axis !== null && b.axis !== undefined ? String(b.axis) : '—');
      if (showAdd) row.push(formatPowerVal(b.add));
      if (showSide) row.push(b.side || '—');
      row.push(String(b.stock || 0), String(b.reserved || 0), String(b.available || 0), b.status);
      return row;
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Batches_${stockItem.code}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Selected batches objects for modal preview
  const selectedBatchesList = useMemo(() => {
    return batches.filter(b => selectedBatchIds.has(b.id));
  }, [batches, selectedBatchIds]);

  return (
    <div className="space-y-3.5">
      {/* Breadcrumb & Top Bar */}
      <div className="flex items-center justify-between">
        <nav className="flex items-center gap-1.5 text-xs text-slate-500">
          <button
            onClick={onBackToItems}
            className="hover:text-blue-600 font-medium transition-colors cursor-pointer"
          >
            Stock Items
          </button>
          <span>/</span>
          <span className="font-semibold text-slate-900">{stockItem.name}</span>
          <span>/</span>
          <span className="text-blue-600 font-medium">Batches</span>
        </nav>
        <button
          onClick={onBackToItems}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Stock Items</span>
        </button>
      </div>

      {/* Global Feedback Banner */}
      {feedbackBanner && (
        <div
          className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 shadow-2xs transition-all ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedbackBanner.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-start gap-3">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : feedbackBanner.type === 'warning' ? (
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-xs sm:text-sm font-semibold">{feedbackBanner.text}</p>
              {feedbackBanner.details && feedbackBanner.details.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs list-disc list-inside opacity-90">
                  {feedbackBanner.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button
            onClick={() => setFeedbackBanner(null)}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            &times;
          </button>
        </div>
      )}

      {/* Stock Item Header Info Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-3.5 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-slate-900">{stockItem.name}</h1>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {stockItem.code}
              </span>
              <span className="px-2 py-0.5 rounded font-mono text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                {stockItem.opticalCategory || stockItem.categoryCode || 'SV'}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                Unit: {stockItem.unit || 'PRS'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Select multiple batch powers to perform bulk deletion or status updates, or drill down into batch ledgers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
              title="Print Batches Report"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print</span>
            </button>
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
              title="Export Batches to CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => onOpenItemLedger(stockItem)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
              title="View full item ledger across all batches"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Stock Item Ledger</span>
            </button>
            <button
              onClick={onOpenImportModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Bulk Import</span>
            </button>
            <button
              onClick={onCreateBatch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Batch</span>
            </button>
          </div>
        </div>

        {/* Aggregated Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 pt-3 border-t border-slate-100">
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Batches Defined</span>
            <span className="text-base font-mono font-bold text-slate-900">{totals.batchesCount}</span>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Stock</span>
            <span className={`text-base font-mono font-bold ${totals.stock < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {formatQuantity(totals.stock)} {stockItem.unit || 'PRS'}
            </span>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Reserved</span>
            <span className="text-base font-mono font-bold text-amber-700">{formatQuantity(totals.reserved)} {stockItem.unit || 'PRS'}</span>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Available</span>
            <span className={`text-base font-mono font-bold ${totals.available < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {formatQuantity(totals.available)} {stockItem.unit || 'PRS'}
            </span>
          </div>
        </div>
      </div>

      {/* Multiple Selection Action Toolbar */}
      {selectedBatchIds.size > 0 && (
        <div className="bg-indigo-50/95 border border-indigo-200 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs animate-in fade-in slide-in-from-top-1 duration-150 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-xs shadow-2xs">
              {selectedBatchIds.size}
            </span>
            <div>
              <span className="text-xs font-bold text-indigo-950">
                {selectedBatchIds.size === 1 ? '1 batch selected' : `${selectedBatchIds.size} batches selected`}
              </span>
              <span className="text-[11px] text-indigo-700 ml-1.5 hidden sm:inline">
                (out of {batches.length} visible on page)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end w-full sm:w-auto">
            {selectedBatchIds.size < batches.length && (
              <button
                type="button"
                onClick={handleSelectAllVisible}
                className="px-2.5 py-1.5 text-xs font-semibold text-indigo-700 bg-white hover:bg-indigo-100/70 border border-indigo-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
              >
                Select All on Page ({batches.length})
              </button>
            )}

            <button
              type="button"
              onClick={handleClearSelection}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
            >
              Clear Selection
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={() => handleBulkSetInactive()}
                disabled={markingInactive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors cursor-pointer shadow-2xs"
                title="Mark selected batches as Inactive"
              >
                <span>Set Inactive ({selectedBatchIds.size})</span>
              </button>
            )}

            {canDelete && (
              <button
                type="button"
                id="btn-bulk-delete-batches"
                onClick={handleOpenBulkDelete}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Selected ({selectedBatchIds.size})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-2.5 flex flex-col sm:flex-row gap-2.5 print:hidden">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search power or barcode (e.g. '250100', '-2.50/-1.00', or barcode)..."
            className="w-full pl-8 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              className="absolute right-3 top-2 text-xs text-slate-400 hover:text-slate-600 font-medium cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Stock Filter (Zero Stock Toggle) */}
          <select
            value={stockFilter}
            onChange={e => {
              setStockFilter(e.target.value as any);
              setPage(1);
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer font-medium"
            title="Filter by inventory stock status"
          >
            <option value="ALL">All Stock Levels</option>
            <option value="POSITIVE">In Stock (&gt; 0)</option>
            <option value="ZERO">Zero Stock (= 0)</option>
            <option value="NEGATIVE">Negative Stock (&lt; 0)</option>
            <option value="NON_ZERO">Non-Zero (≠ 0)</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>

          <select
            value={limit}
            onChange={e => {
              setLimit(parseInt(e.target.value, 10));
              setPage(1);
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>

          <button
            onClick={fetchBatches}
            disabled={loading}
            className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            title="Refresh batches"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Batches Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden print:border-none print:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                {/* Checkbox Column for Multiple Select */}
                <th className="py-2.5 px-3 w-10 text-center print:hidden">
                  <input
                    type="checkbox"
                    id="select-all-batches-checkbox"
                    checked={allVisibleSelected}
                    ref={el => {
                      if (el) {
                        el.indeterminate = isIndeterminate;
                      }
                    }}
                    onChange={handleToggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    title="Select/Deselect all visible batches on this page"
                  />
                </th>
                <th className="py-2.5 px-3.5">Batch / Power</th>
                <th className="py-2.5 px-3">Barcode</th>
                {showSph && <th className="py-2.5 px-2.5 text-right font-mono">SPH</th>}
                {showCyl && <th className="py-2.5 px-2.5 text-right font-mono">CYL</th>}
                {showAxis && <th className="py-2.5 px-2.5 text-right font-mono">AXIS</th>}
                {showAdd && <th className="py-2.5 px-2.5 text-right font-mono">ADD</th>}
                {showSide && <th className="py-2.5 px-2 text-center">SIDE</th>}
                <th className="py-2.5 px-3 text-right">Stock</th>
                <th className="py-2.5 px-3 text-right">Reserved</th>
                <th className="py-2.5 px-3 text-right">Available</th>
                <th className="py-2.5 px-3">Last Movement</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3.5 text-right print:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading && batches.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-16 text-center text-slate-500">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mb-2"></div>
                    <p className="text-xs font-medium">Loading batches for {stockItem.name}...</p>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-rose-600">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-rose-500" />
                    <p className="font-semibold text-xs">{error}</p>
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-16 text-center text-slate-400">
                    <Barcode className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No batches match the current filter</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {search || stockFilter !== 'ALL' ? 'Try clearing or changing your filters.' : 'Click "Create Batch" or "Bulk Import" to define optical powers.'}
                    </p>
                  </td>
                </tr>
              ) : (
                (batches || []).map(batch => {
                  const isSelected = selectedBatchIds.has(batch.id);
                  const stockNum = Number(batch.stock || 0);
                  const reservedNum = Number(batch.reserved || 0);
                  const availableNum = Number(batch.available || 0);

                  return (
                    <tr
                      key={batch.id}
                      onClick={() => onSelectBatch(batch)}
                      className={`transition-colors cursor-pointer group ${
                        isSelected 
                          ? 'bg-blue-50/80 border-l-4 border-l-blue-600' 
                          : 'hover:bg-blue-50/40'
                      }`}
                    >
                      {/* Checkbox Column */}
                      <td 
                        className="py-3 px-3 text-center print:hidden" 
                        onClick={e => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectBatch(batch.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          title={`Select batch ${batch.formattedName || batch.barcode}`}
                        />
                      </td>

                      {/* Batch / Power (Canonical optical format) */}
                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-slate-900 text-xs sm:text-sm group-hover:text-blue-700 transition-colors">
                          {batch.formattedName || '0.00 / 0.00'}
                        </div>
                        {batch.identityKey && (
                          <div className="text-[10px] text-slate-400 font-mono truncate max-w-[180px]" title={batch.identityKey}>
                            {batch.identityKey}
                          </div>
                        )}
                      </td>

                      {/* Barcode */}
                      <td className="py-3 px-3">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] text-slate-700">
                          <Barcode className="h-3 w-3 text-slate-400" />
                          <span>{batch.barcode}</span>
                          <button
                            onClick={e => handleCopyBarcode(batch.barcode, e)}
                            className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-slate-200 transition-colors cursor-pointer"
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

                      {/* SPH */}
                      {showSph && (
                        <td className="py-3 px-2.5 text-right font-mono font-semibold text-slate-800">
                          {formatPowerVal(batch.sph)}
                        </td>
                      )}

                      {/* CYL */}
                      {showCyl && (
                        <td className="py-3 px-2.5 text-right font-mono font-semibold text-slate-800">
                          {formatPowerVal(batch.cyl)}
                        </td>
                      )}

                      {/* AXIS */}
                      {showAxis && (
                        <td className="py-3 px-2.5 text-right font-mono text-slate-700">
                          {batch.axis !== null && batch.axis !== undefined ? `${batch.axis}°` : '—'}
                        </td>
                      )}

                      {/* ADD */}
                      {showAdd && (
                        <td className="py-3 px-2.5 text-right font-mono text-slate-700">
                          {formatPowerVal(batch.add)}
                        </td>
                      )}

                      {/* SIDE */}
                      {showSide && (
                        <td className="py-3 px-2 text-center font-mono text-slate-600">
                          {batch.side && batch.side !== 'NONE' ? (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold text-[10px]">
                              {batch.side}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}

                      {/* Stock */}
                      <td className={`py-3 px-3 text-right font-mono font-bold ${
                        stockNum < 0 ? 'text-rose-600 bg-rose-50/30' : 'text-slate-900'
                      }`}>
                        {formatQuantity(stockNum)}
                      </td>

                      {/* Reserved */}
                      <td className="py-3 px-3 text-right font-mono font-semibold text-amber-700">
                        {reservedNum > 0 ? formatQuantity(reservedNum) : '0'}
                      </td>

                      {/* Available */}
                      <td className={`py-3 px-3 text-right font-mono font-bold ${
                        availableNum < 0 ? 'text-rose-600 bg-rose-50/30' : 'text-emerald-700'
                      }`}>
                        {formatQuantity(availableNum)}
                      </td>

                      {/* Last Movement Date */}
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                        {batch.lastTransactionDate ? (
                          <span className="flex items-center gap-1 text-[11px]">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            <span>{new Date(batch.lastTransactionDate).toLocaleDateString()}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">No activity</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          batch.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {batch.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right print:hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onSelectBatch(batch)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
                            title="Open Batch Movement Ledger"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                            <span>Ledger</span>
                          </button>

                          <button
                            onClick={() => onEditBatch(batch)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Edit Batch Power"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            onClick={(e) => handleTriggerSingleDelete(batch, e)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Batch / Power"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div>
              Showing {batches.length} of {totalCount} batches
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="p-1.5 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-medium text-slate-700">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="p-1.5 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Multiple Batches Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div 
          id="modal-bulk-delete-batches" 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col p-6 shadow-2xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            <div className="flex items-start gap-4 overflow-y-auto flex-1 pr-1 overscroll-contain">
              <div className="p-3 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <Trash2 className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900">
                  Delete {selectedBatchIds.size} Selected Optical Batches
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Item: <span className="font-semibold text-slate-800">{stockItem.name}</span> ({stockItem.code})
                </p>

                {/* Information / Safeguards */}
                {!bulkDeleteResult && (
                  <>
                    <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                      You are about to delete <span className="font-bold text-slate-900">{selectedBatchIds.size}</span> selected optical batch records from the database.
                    </p>

                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                      <p className="font-semibold flex items-center gap-1.5">
                        <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                        <span>Accounting & Inventory Safeguards</span>
                      </p>
                      <p className="text-[11px] text-amber-800 leading-normal">
                        Only batches with <strong>zero stock</strong>, <strong>zero reservations</strong>, and <strong>zero transaction history</strong> (invoices, orders, returns, ledger entries) will be permanently deleted.
                      </p>
                      <p className="text-[11px] text-amber-800 leading-normal">
                        Batches with existing transaction records or physical stock will be protected to maintain unbroken audit trails.
                      </p>
                    </div>

                    {/* Selected Batches Preview Table */}
                    <div className="mt-3.5 border border-slate-200 rounded-xl overflow-hidden">
                      <div className="bg-slate-100/80 px-3 py-1.5 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider flex justify-between items-center">
                        <span>Selected Batches ({selectedBatchesList.length})</span>
                        <span className="font-normal text-slate-500 lowercase">scroll to preview</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
                        {selectedBatchesList.map(b => {
                          const stockVal = Number(b.stock || 0);
                          const hasStock = stockVal !== 0;
                          return (
                            <div key={b.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                              <div>
                                <span className="font-mono font-bold text-slate-900 mr-2">
                                  {b.formattedName || `${b.sph}/${b.cyl}`}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                  {b.barcode}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`font-mono text-xs font-semibold ${hasStock ? 'text-amber-700' : 'text-slate-600'}`}>
                                  {formatQuantity(stockVal)} {stockItem.unit || 'PRS'}
                                </span>
                                {hasStock && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-800 border border-amber-200">
                                    In Stock
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* Error Banner */}
                {bulkDeleteError && (
                  <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
                    {bulkDeleteError}
                  </div>
                )}

                {/* Post-execution Report / Blocked Batches Details */}
                {bulkDeleteResult && (
                  <div className="mt-4 space-y-3">
                    <div className="p-3 rounded-xl border bg-slate-50 border-slate-200 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>Deletion Summary</span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {bulkDeleteResult.totalRequested} requested
                        </span>
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        {bulkDeleteResult.deletedCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {bulkDeleteResult.deletedCount} Deleted
                          </span>
                        )}
                        {bulkDeleteResult.failedCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-semibold">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {bulkDeleteResult.failedCount} Protected / Blocked
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Blocked Batches List */}
                    {bulkDeleteResult.blockedBatches && bulkDeleteResult.blockedBatches.length > 0 && (
                      <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-3 text-xs space-y-2">
                        <p className="font-bold text-amber-900 flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          <span>Protected Batches (Cannot be deleted)</span>
                        </p>
                        <p className="text-[11px] text-amber-800">
                          The following batches have existing inventory movements or document references. They have been preserved to safeguard your books:
                        </p>
                        <div className="max-h-40 overflow-y-auto divide-y divide-amber-200/60 bg-white rounded-lg border border-amber-200 text-xs">
                          {bulkDeleteResult.blockedBatches.map((b: any, idx: number) => (
                            <div key={idx} className="p-2 space-y-0.5">
                              <div className="flex items-center justify-between font-bold text-slate-900">
                                <span className="font-mono">{b.barcode} (SPH: {formatPowerVal(b.sph)}, CYL: {formatPowerVal(b.cyl)})</span>
                                {b.stockInfo && (
                                  <span className="text-[11px] font-mono text-amber-800">
                                    Stock: {formatQuantity(b.stockInfo.physicalStock)}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-rose-700 font-medium">
                                {b.error || b.reason || 'Referenced by active documents or inventory'}
                              </p>
                            </div>
                          ))}
                        </div>

                        {canEdit && (
                          <div className="pt-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-600">
                              Would you like to deactivate them instead?
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const blockedIds = bulkDeleteResult.blockedBatches?.map((b: any) => b.batchId) || [];
                                handleBulkSetInactive(blockedIds);
                              }}
                              disabled={markingInactive}
                              className="px-3 py-1 text-xs font-semibold text-amber-800 bg-amber-200/80 hover:bg-amber-300 border border-amber-400 rounded-lg transition-colors cursor-pointer"
                            >
                              {markingInactive ? 'Updating...' : 'Mark Blocked Inactive'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100 shrink-0">
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => {
                  setShowBulkDeleteModal(false);
                  setBulkDeleteResult(null);
                  setBulkDeleteError(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                {bulkDeleteResult ? 'Close' : 'Cancel'}
              </button>

              {!bulkDeleteResult && (
                <button
                  type="button"
                  id="btn-confirm-bulk-delete-batches"
                  disabled={bulkDeleting || selectedBatchIds.size === 0}
                  onClick={handleConfirmBulkDelete}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                >
                  {bulkDeleting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Verifying &amp; Deleting {selectedBatchIds.size} Batches...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      <span>Confirm &amp; Delete {selectedBatchIds.size} Batches</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Single Batch Delete Modal */}
      {singleBatchToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-rose-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-full shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Optical Batch</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Barcode: {singleBatchToDelete.barcode} • {singleBatchToDelete.formattedName || `${singleBatchToDelete.sph}/${singleBatchToDelete.cyl}`}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              If this batch has existing transaction records or physical inventory, deletion will be blocked to maintain audit and accounting integrity.
            </p>

            {singleDeleteError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                <p className="font-semibold">{singleDeleteError}</p>
                {singleDeleteBlocked?.references && (
                  <p className="text-[11px] text-rose-700">
                    Found {singleDeleteBlocked.references.length} document reference(s). Consider marking this batch as INACTIVE instead.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mt-5 pt-3 border-t border-slate-100">
              {singleDeleteBlocked && canEdit ? (
                <button
                  type="button"
                  onClick={handleSingleSetInactive}
                  disabled={singleDeleting || markingInactive}
                  className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer"
                >
                  {markingInactive ? 'Updating...' : 'Set Inactive Instead'}
                </button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSingleBatchToDelete(null);
                    setSingleDeleteBlocked(null);
                    setSingleDeleteError(null);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSingleDelete}
                  disabled={singleDeleting}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs cursor-pointer"
                >
                  {singleDeleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
