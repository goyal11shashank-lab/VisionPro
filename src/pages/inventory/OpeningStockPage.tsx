import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Boxes,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Edit3,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Barcode,
  Layers,
  Calendar,
  FileSpreadsheet,
  ArrowDownLeft,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Info,
  ExternalLink,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { formatQuantity } from '../../utils/numberFormatting.js';

interface OpeningStockItem {
  id: string; // ledger ID
  batchId: string;
  barcode: string;
  identityKey?: string;
  formattedName: string;
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  primaryItemName?: string | null;
  uniqueItemId: string;
  uniqueItemName: string;
  uniqueItemCode?: string;
  sph: number;
  cyl: number;
  axis: number;
  add: number;
  side: string;
  quantityIn: number;
  balance: number;
  reason?: string | null;
  createdAt: string;
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
}

interface OpeningStockPageProps {
  onNavigate?: (path: string) => void;
}

export const OpeningStockPage: React.FC<OpeningStockPageProps> = ({ onNavigate }) => {
  const { hasPermission } = useAuth();
  const canEdit =
    hasPermission('inventory:opening_stock') ||
    hasPermission('inventory.opening_stock') ||
    hasPermission('inventory:edit') ||
    hasPermission('master:edit') ||
    hasPermission('master:manage');
  const canCreate =
    hasPermission('inventory:opening_stock') ||
    hasPermission('inventory.opening_stock') ||
    hasPermission('inventory:create') ||
    hasPermission('master:create') ||
    hasPermission('master:edit') ||
    hasPermission('master:manage');
  const canDelete =
    hasPermission('inventory:opening_stock') ||
    hasPermission('inventory.opening_stock') ||
    hasPermission('inventory:delete') ||
    hasPermission('master:delete') ||
    hasPermission('master:manage');

  const [items, setItems] = useState<OpeningStockItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [categories, setCategories] = useState<{ id: string; name: string; code: string }[]>([]);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  // Multi-selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Feedback notifications
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string; details?: string[] } | null>(null);

  // Modals state
  // 1. View Modal
  const [viewingItem, setViewingItem] = useState<OpeningStockItem | null>(null);

  // 2. Edit Modal
  const [editingItem, setEditingItem] = useState<OpeningStockItem | null>(null);
  const [editQty, setEditQty] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // 3. Single Delete Modal
  const [deletingItem, setDeletingItem] = useState<OpeningStockItem | null>(null);
  const [singleDeleting, setSingleDeleting] = useState<boolean>(false);
  const [singleDeleteError, setSingleDeleteError] = useState<string | null>(null);

  // 4. Bulk Delete Modal
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{
    totalRequested: number;
    deletedCount: number;
    failedCount: number;
    errors: string[];
    message: string;
  } | null>(null);

  // 5. Initialize / Create Opening Stock Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createBarcode, setCreateBarcode] = useState<string>('');
  const [createFoundBatch, setCreateFoundBatch] = useState<any | null>(null);
  const [createSearching, setCreateSearching] = useState<boolean>(false);
  const [createQty, setCreateQty] = useState<string>('10.00');
  const [createReason, setCreateReason] = useState<string>('Initial stock opening balance');
  const [createDate, setCreateDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fetch categories
  useEffect(() => {
    apiRequest<{ success: boolean; data: any[] }>('/api/optical-master/categories')
      .then(res => {
        if (res.data) setCategories(res.data);
      })
      .catch(() => {});
  }, []);

  // Fetch opening stock records
  const fetchOpeningStock = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== 'ALL') {
        params.append('categoryId', selectedCategory);
      }
      if (search.trim()) {
        params.append('search', search.trim());
      }
      params.append('limit', '100');
      params.append('offset', '0');

      const res = await apiRequest<{ items: OpeningStockItem[]; total: number }>(
        `/api/inventory/opening-stock/history?${params.toString()}`
      );
      setItems(res.items || []);
      setTotalCount(res.total || 0);
    } catch (err: any) {
      console.error('[FetchOpeningStock Error]', err);
      setError(err.message || 'Failed to fetch opening stock history');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, search]);

  useEffect(() => {
    fetchOpeningStock();
  }, [fetchOpeningStock]);

  // Aggregated metrics
  const metrics = useMemo(() => {
    let totalQty = 0;
    let totalPhysical = 0;
    let totalAvailable = 0;

    items.forEach(item => {
      totalQty += Number(item.quantityIn) || 0;
      totalPhysical += Number(item.physicalStock) || 0;
      totalAvailable += Number(item.availableStock) || 0;
    });

    return {
      recordsCount: items.length,
      totalQty,
      totalPhysical,
      totalAvailable,
    };
  }, [items]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  // Selection
  const allVisibleSelected = useMemo(() => {
    return paginatedItems.length > 0 && paginatedItems.every(r => selectedIds.has(r.id));
  }, [paginatedItems, selectedIds]);

  const someVisibleSelected = useMemo(() => {
    return paginatedItems.some(r => selectedIds.has(r.id));
  }, [paginatedItems, selectedIds]);

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedItems.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        paginatedItems.forEach(r => next.add(r.id));
        return next;
      });
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Open Edit Modal
  const handleOpenEdit = (item: OpeningStockItem) => {
    setEditingItem(item);
    setEditQty(item.quantityIn.toString());
    setEditReason(item.reason || '');
    setEditDate(item.createdAt ? new Date(item.createdAt).toISOString().split('T')[0] : '');
    setEditError(null);
  };

  // Submit Edit
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    const parsedQty = parseFloat(editQty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setEditError('Opening stock quantity must be a positive number.');
      return;
    }

    try {
      setEditSubmitting(true);
      setEditError(null);

      const res = await apiRequest<{ success: boolean; item: OpeningStockItem; message: string }>(
        `/api/inventory/opening-stock/${editingItem.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            quantity: parsedQty,
            reason: editReason.trim() || undefined,
            date: editDate ? new Date(editDate).toISOString() : undefined,
          }),
        }
      );

      setItems(prev =>
        prev.map(i => (i.id === editingItem.id ? { ...i, ...res.item, quantityIn: parsedQty } : i))
      );
      setEditingItem(null);
      setFeedback({
        type: 'success',
        text: `Opening stock for ${editingItem.barcode} (${editingItem.formattedName}) updated to ${parsedQty} PRS. Ledger balances recalculated successfully.`,
      });
      setTimeout(() => setFeedback(null), 6000);
      fetchOpeningStock();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update opening stock');
    } finally {
      setEditSubmitting(false);
    }
  };

  // Single Delete
  const handleConfirmSingleDelete = async () => {
    if (!deletingItem) return;
    try {
      setSingleDeleting(true);
      setSingleDeleteError(null);

      const res = await apiRequest<{ success: boolean; message: string }>(
        `/api/inventory/opening-stock/${deletingItem.id}`,
        { method: 'DELETE' }
      );

      setItems(prev => prev.filter(i => i.id !== deletingItem.id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(deletingItem.id);
        return next;
      });
      setDeletingItem(null);
      setFeedback({
        type: 'success',
        text: res.message || `Opening stock for batch ${deletingItem.barcode} deleted successfully.`,
      });
      setTimeout(() => setFeedback(null), 6000);
      fetchOpeningStock();
    } catch (err: any) {
      setSingleDeleteError(err.message || 'Failed to delete opening stock');
    } finally {
      setSingleDeleting(false);
    }
  };

  // Bulk Delete
  const handleConfirmBulkDelete = async () => {
    const ids = Array.from(selectedIds);
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
        message: string;
      }>('/api/inventory/opening-stock/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });

      if (res.deletedCount > 0 && res.failedCount === 0) {
        const deletedSet = new Set(ids);
        setItems(prev => prev.filter(i => !deletedSet.has(i.id)));
        setShowBulkDeleteModal(false);
        setSelectedIds(new Set());
        setFeedback({
          type: 'success',
          text: res.message || `Successfully deleted ${res.deletedCount} opening stock record(s).`,
        });
        setTimeout(() => setFeedback(null), 6000);
        fetchOpeningStock();
      } else {
        setBulkDeleteResult(res);
        if (res.deletedCount > 0) {
          fetchOpeningStock();
          setSelectedIds(new Set());
        }
      }
    } catch (err: any) {
      setBulkDeleteError(err.message || 'Failed to perform bulk delete of opening stock');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Search batch for initialization
  const handleSearchBatch = async () => {
    if (!createBarcode.trim()) return;
    try {
      setCreateSearching(true);
      setCreateError(null);
      setCreateFoundBatch(null);

      const res = await apiRequest<{ success: boolean; batches: any[] }>(
        `/api/optical-master/batches?search=${encodeURIComponent(createBarcode.trim())}`
      );
      if (res.batches && res.batches.length > 0) {
        setCreateFoundBatch(res.batches[0]);
      } else {
        setCreateError(`No optical batch found with barcode or power "${createBarcode.trim()}".`);
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to look up optical batch');
    } finally {
      setCreateSearching(false);
    }
  };

  // Submit Initialize Opening Stock
  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createFoundBatch) return;

    const qty = parseFloat(createQty);
    if (isNaN(qty) || qty <= 0) {
      setCreateError('Quantity must be greater than 0.');
      return;
    }

    try {
      setCreateSubmitting(true);
      setCreateError(null);

      const res = await apiRequest<{ success: boolean; message?: string }>(
        '/api/inventory/opening-stock',
        {
          method: 'POST',
          body: JSON.stringify({
            batchId: createFoundBatch.id,
            quantity: qty,
            reason: createReason.trim() || undefined,
            date: createDate ? new Date(createDate).toISOString() : undefined,
          }),
        }
      );

      setShowCreateModal(false);
      setCreateBarcode('');
      setCreateFoundBatch(null);
      setFeedback({
        type: 'success',
        text: res.message || `Opening stock of ${qty} PRS recorded for ${createFoundBatch.barcode}.`,
      });
      setTimeout(() => setFeedback(null), 6000);
      fetchOpeningStock();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to initialize opening stock');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Title */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-700 rounded-xl border border-blue-100 shadow-2xs">
              <Boxes className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>Opening Stock Management</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
                  {totalCount} Entries
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit, view, edit, delete, and initialize opening inventory balances with automatic running ledger balance reconciliation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={fetchOpeningStock}
              disabled={loading}
              className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              title="Refresh Records"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            </button>

            {canCreate && (
              <button
                type="button"
                onClick={() => {
                  setCreateBarcode('');
                  setCreateFoundBatch(null);
                  setCreateError(null);
                  setShowCreateModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Initialize Opening Stock</span>
              </button>
            )}
          </div>
        </div>

        {/* Aggregated KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Entries</div>
            <div className="text-lg font-bold text-slate-900 mt-0.5 font-mono">{metrics.recordsCount}</div>
          </div>
          <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100">
            <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">Opening Qty</div>
            <div className="text-lg font-bold text-blue-700 mt-0.5 font-mono">
              {formatQuantity(metrics.totalQty)} <span className="text-xs font-normal">PRS</span>
            </div>
          </div>
          <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
            <div className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">Current Stock</div>
            <div className="text-lg font-bold text-emerald-700 mt-0.5 font-mono">
              {formatQuantity(metrics.totalPhysical)} <span className="text-xs font-normal">PRS</span>
            </div>
          </div>
          <div className="p-3 bg-purple-50/50 rounded-xl border border-purple-100">
            <div className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider">Available Stock</div>
            <div className="text-lg font-bold text-purple-700 mt-0.5 font-mono">
              {formatQuantity(metrics.totalAvailable)} <span className="text-xs font-normal">PRS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{feedback.text}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating Selection Bar for Multiple Deletion */}
      {selectedIds.size > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between shadow-sm animate-in slide-in-from-top-1">
          <div className="flex items-center gap-2 text-xs text-amber-900 font-medium">
            <span className="px-2 py-0.5 bg-amber-200 rounded-full font-bold font-mono">
              {selectedIds.size}
            </span>
            <span>opening stock entry/entries selected</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
            >
              Clear Selection
            </button>

            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  setBulkDeleteError(null);
                  setBulkDeleteResult(null);
                  setShowBulkDeleteModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-3 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by barcode, power (e.g. -2.00, +1.50), product name, reason..."
            className="w-full pl-8 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
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

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={e => {
              setSelectedCategory(e.target.value);
              setPage(1);
            }}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none font-medium cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Opening Stock Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[11px] tracking-wider">
              <tr>
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={handleToggleSelectAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                    title="Select all on this page"
                  />
                </th>
                <th className="py-3 px-3">Batch & Power</th>
                <th className="py-3 px-3">Product Name</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3 text-right">Opening Qty</th>
                <th className="py-3 px-3 text-right">Current Stock</th>
                <th className="py-3 px-3 text-right">Available</th>
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3">Reason / Remarks</th>
                <th className="py-3 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 mx-auto text-blue-500 animate-spin mb-2" />
                    <p className="font-semibold text-xs">Loading opening stock records...</p>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-rose-500">
                    <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-rose-500" />
                    <p className="font-semibold text-xs">{error}</p>
                    <button
                      onClick={fetchOpeningStock}
                      className="mt-2 px-3 py-1 bg-rose-100 text-rose-800 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              ) : paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Boxes className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600 text-xs">No opening stock entries found</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {search || selectedCategory !== 'ALL'
                        ? 'Try clearing your filters or search keywords.'
                        : 'Click "Initialize Opening Stock" above to record initial batch inventory.'}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedItems.map(item => {
                  const isSelected = selectedIds.has(item.id);
                  const isStockZero = item.physicalStock === 0;
                  const isStockNegative = item.physicalStock < 0;

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      {/* Select Checkbox */}
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>

                      {/* Barcode & Power */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <Barcode className="h-3.5 w-3.5 text-slate-400" />
                          <span>{item.barcode}</span>
                        </div>
                        <div className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 font-mono">
                          {item.formattedName}
                        </div>
                      </td>

                      {/* Product Name */}
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900 text-xs truncate max-w-[200px]">
                          {item.uniqueItemName}
                        </div>
                        {item.primaryItemName && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                            {item.primaryItemName}
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {item.categoryName} ({item.categoryCode})
                        </span>
                      </td>

                      {/* Opening Qty */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700 text-xs">
                        +{formatQuantity(item.quantityIn)} <span className="text-[10px] font-normal text-slate-500">PRS</span>
                      </td>

                      {/* Current Stock */}
                      <td className="py-2.5 px-3 text-right font-mono text-xs whitespace-nowrap">
                        <span
                          className={`font-bold ${
                            isStockNegative
                              ? 'text-rose-600'
                              : isStockZero
                              ? 'text-slate-400'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatQuantity(item.physicalStock)}
                        </span>
                      </td>

                      {/* Available Stock */}
                      <td className="py-2.5 px-3 text-right font-mono text-xs whitespace-nowrap font-semibold text-slate-800">
                        {formatQuantity(item.availableStock)}
                      </td>

                      {/* Date */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </td>

                      {/* Reason */}
                      <td className="py-2.5 px-3 text-slate-600 text-xs truncate max-w-[180px]">
                        {item.reason || '—'}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {/* View Detail */}
                          <button
                            type="button"
                            onClick={() => setViewingItem(item)}
                            className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                            title="View Opening Stock Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          {/* Edit */}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(item)}
                              className="p-1 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors cursor-pointer"
                              title="Edit Opening Stock Quantity"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* Delete */}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingItem(item);
                                setSingleDeleteError(null);
                              }}
                              className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                              title="Delete Opening Stock Entry"
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
          <div className="bg-slate-50/80 px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div>
              Showing <span className="font-semibold">{(page - 1) * pageSize + 1}</span> to{' '}
              <span className="font-semibold">{Math.min(page * pageSize, items.length)}</span> of{' '}
              <span className="font-semibold">{items.length}</span> records
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-2 font-mono font-semibold">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- 1. VIEW DETAILS MODAL ---------------- */}
      {viewingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-2xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Opening Stock Entry Profile</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Batch Card */}
              <div className="p-3.5 bg-blue-50/60 rounded-xl border border-blue-100 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                      {viewingItem.categoryName} ({viewingItem.categoryCode})
                    </span>
                    <h4 className="font-bold text-sm text-slate-900 mt-0.5">{viewingItem.uniqueItemName}</h4>
                  </div>
                  <div className="font-mono text-xs font-bold bg-white px-2 py-1 rounded-md border border-blue-200 text-blue-800">
                    {viewingItem.barcode}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-blue-100 font-mono text-[11px] text-slate-700">
                  <span className="font-bold text-blue-900">Power:</span>
                  <span>{viewingItem.formattedName}</span>
                </div>
              </div>

              {/* Balances Grid */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">Opening Initialized</div>
                  <div className="text-base font-bold text-blue-700 font-mono mt-0.5">
                    {formatQuantity(viewingItem.quantityIn)}
                  </div>
                  <div className="text-[10px] text-slate-400">PRS</div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">Current Physical</div>
                  <div className="text-base font-bold text-slate-900 font-mono mt-0.5">
                    {formatQuantity(viewingItem.physicalStock)}
                  </div>
                  <div className="text-[10px] text-slate-400">PRS</div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase">Available Net</div>
                  <div className="text-base font-bold text-emerald-700 font-mono mt-0.5">
                    {formatQuantity(viewingItem.availableStock)}
                  </div>
                  <div className="text-[10px] text-slate-400">PRS</div>
                </div>
              </div>

              {/* Metadata Details */}
              <div className="space-y-2 pt-2 border-t border-slate-100 text-slate-600">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-semibold text-slate-500">Stock Ledger ID:</span>
                  <span className="font-mono text-slate-800">{viewingItem.id}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-semibold text-slate-500">Optical Batch ID:</span>
                  <span className="font-mono text-slate-800">{viewingItem.batchId}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-semibold text-slate-500">Record Created At:</span>
                  <span className="font-mono text-slate-800">
                    {new Date(viewingItem.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-semibold text-slate-500">Reason / Remarks:</span>
                  <span className="text-slate-800 font-medium">{viewingItem.reason || 'None specified'}</span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  Opening stock creates the starting balance anchor for this batch. Editing or deleting this entry will safely recalculate all subsequent transaction ledger balances.
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 2. EDIT MODAL ---------------- */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-2xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-amber-600" />
                <h3 className="font-bold text-sm text-slate-900">Edit Opening Stock Entry</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="font-bold text-slate-900">{editingItem.uniqueItemName}</div>
                <div className="flex justify-between items-center text-slate-600 mt-1 font-mono">
                  <span>Power: {editingItem.formattedName}</span>
                  <span className="text-blue-700 font-bold">{editingItem.barcode}</span>
                </div>
                <div className="flex justify-between items-center text-[11px] text-slate-500 mt-1.5 pt-1.5 border-t border-slate-200">
                  <span>Current Physical: {formatQuantity(editingItem.physicalStock)} prs</span>
                  <span>Available: {formatQuantity(editingItem.availableStock)} prs</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Opening Stock Quantity (PRS) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={editQty}
                  onChange={e => setEditQty(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Original quantity was {formatQuantity(editingItem.quantityIn)} PRS.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Date of Opening Stock
                </label>
                <input
                  type="date"
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason / Remarks
                </label>
                <textarea
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="Reason for opening stock modification..."
                  rows={2}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {editError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-800">
                <strong>Automatic Ledger Recalculation:</strong> Updating this starting entry will adjust current physical stock and automatically recalculate all chronological running balances.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  disabled={editSubmitting}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {editSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- 3. SINGLE DELETE MODAL ---------------- */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-2xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="p-4 bg-rose-50 border-b border-rose-200 flex items-center gap-2 text-rose-800">
              <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0" />
              <h3 className="font-bold text-sm">Delete Opening Stock Entry</h3>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-700">
                Are you sure you want to delete the initial opening stock of{' '}
                <strong className="text-slate-900 font-mono">
                  {formatQuantity(deletingItem.quantityIn)} PRS
                </strong>{' '}
                for batch <strong className="font-mono text-blue-700">{deletingItem.barcode}</strong> ({deletingItem.formattedName})?
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Stock:</span>
                  <span className="font-bold">{formatQuantity(deletingItem.physicalStock)} prs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Deduction:</span>
                  <span className="text-rose-600 font-bold">-{formatQuantity(deletingItem.quantityIn)} prs</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="text-slate-700 font-bold">Remaining Stock:</span>
                  <span className="font-bold">
                    {formatQuantity(deletingItem.physicalStock - deletingItem.quantityIn)} prs
                  </span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
                <strong>Safety Verification:</strong> Deletion will only proceed if remaining stock is sufficient and hasn't already been consumed by subsequent sales or orders.
              </div>

              {singleDeleteError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                  {singleDeleteError}
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                disabled={singleDeleting}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSingleDelete}
                disabled={singleDeleting}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {singleDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 4. BULK DELETE MODAL ---------------- */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-2xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="p-4 bg-rose-50 border-b border-rose-200 flex items-center gap-2 text-rose-800">
              <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0" />
              <h3 className="font-bold text-sm">Bulk Delete Opening Stock Entries</h3>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-700">
                You are about to delete{' '}
                <strong className="text-slate-900 font-mono">{selectedIds.size}</strong> selected opening stock entries.
              </p>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
                <strong>Inventory Protection:</strong> Each batch is verified to ensure its current available inventory can safely cover the deduction without creating negative stock.
              </div>

              {bulkDeleteError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                  {bulkDeleteError}
                </div>
              )}

              {bulkDeleteResult && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div
                    className={`p-3 rounded-xl border text-xs font-semibold ${
                      bulkDeleteResult.failedCount === 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    {bulkDeleteResult.message}
                  </div>
                  {bulkDeleteResult.errors.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-rose-700 font-mono">
                      {bulkDeleteResult.errors.map((err, idx) => (
                        <div key={idx}>• {err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
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
                  onClick={handleConfirmBulkDelete}
                  disabled={bulkDeleting}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} Entries`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 5. INITIALIZE OPENING STOCK MODAL ---------------- */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-2xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Initialize Opening Stock</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitCreate} className="p-5 space-y-4 text-xs">
              {/* Batch Barcode Lookup */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Optical Batch Barcode or Power <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={createBarcode}
                    onChange={e => {
                      setCreateBarcode(e.target.value);
                      setCreateFoundBatch(null);
                      setCreateError(null);
                    }}
                    placeholder="Enter or scan barcode (e.g. SV-001 or power)..."
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                  />
                  <button
                    type="button"
                    onClick={handleSearchBatch}
                    disabled={createSearching || !createBarcode.trim()}
                    className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg disabled:opacity-50 cursor-pointer"
                  >
                    {createSearching ? 'Searching...' : 'Lookup'}
                  </button>
                </div>
              </div>

              {/* Found Batch Card */}
              {createFoundBatch && (
                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1.5 animate-in fade-in">
                  <div className="flex justify-between items-center font-bold text-slate-900">
                    <span>Power: {createFoundBatch.formattedName || `${createFoundBatch.sph} / ${createFoundBatch.cyl}`}</span>
                    <span className="font-mono text-blue-700">{createFoundBatch.barcode}</span>
                  </div>
                  <div className="text-slate-600">{createFoundBatch.uniqueItemName || createFoundBatch.name}</div>
                  <div className="flex justify-between items-center pt-1 border-t border-blue-200 font-mono text-[11px]">
                    <span className="text-slate-500">Current Stock: {createFoundBatch.physicalStock || 0} prs</span>
                    <span className="text-emerald-700 font-bold">Available: {createFoundBatch.availableStock || 0} prs</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Initial Quantity (PRS) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={createQty}
                  onChange={e => setCreateQty(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Date of Opening Stock
                </label>
                <input
                  type="date"
                  value={createDate}
                  onChange={e => setCreateDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason / Notes
                </label>
                <input
                  type="text"
                  value={createReason}
                  onChange={e => setCreateReason(e.target.value)}
                  placeholder="Initial balance or migration remarks..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {createError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={createSubmitting}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting || !createFoundBatch}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {createSubmitting ? 'Recording...' : 'Record Opening Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
